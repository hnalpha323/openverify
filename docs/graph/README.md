# The account graph

The graph links accounts that share a value: a confirmed email address, a government ID number, a device. It is bipartite (accounts on one side, keyed values on the other), and a query walks it breadth first from a start the operator gives. A link is a lead for a reviewer, never a decision: nothing in the graph declines, passes or fails an inquiry or an account.

## Kinds

Each value is stored as an HMAC key under the environment's blind-index subkey, never in plaintext (`graph_attributes`); the kind is a frozen small integer.

| Strength | Kinds |
|---|---|
| Strong | `government_id_number`, `chip_signature`, `crypto_address`, `email_address` (confirmed by a code), `phone_number` (confirmed by a code), `reference_id` |
| Medium | `email_address_unconfirmed`, `phone_number_unconfirmed`, `name_birthdate`, `address`, `device_fingerprint` |
| Weak | `device_class`, `browser_fingerprint`, `ip_address`, `name`, `birthdate`, `postal_code`, `email_domain` (never a free-mail domain) |

Where values come from:

- an account: its reference id and its fields (`*_unconfirmed`, `name_birthdate`, `address`, and the weak `name`, `birthdate`, `postal_code`, `email_domain`);
- an inquiry: its fields, the same way, once it reaches an account;
- its verifications: a government ID's number (the existing ID index), name, birthdate and address; a chip's indexes; a passed OTP verification's confirmed destination (the strong `email_address` and `phone_number`); a passed wallet's address index. A rejected handoff session's verifications are left out;
- its sessions: the device fingerprints (only under the device-recognition tier, and only made under the current key) and the evaluated address, never a `trust-all` address in production, a privacy relay, or a non-global or documentation range outside a sandbox.

## Settings

| Setting | Default | Needs |
|---|---|---|
| `graph-indexing` | on | `settings:privacy` |
| `graph-weak-kinds` | off | `settings:privacy` |
| `graph-components` | off | `settings:privacy` |
| `graph-query-retention-days` | 30 (1 to 365) | `settings:write` |

Turning a kind on marks it incomplete until the backfill reaches it; enabling device recognition marks the device kinds incomplete.

## Indexing

- In the transaction of `POST /accounts`, `PATCH /accounts/:id`, an inquiry's account resolution and `add-objects` and `remove-objects`; at a session's first flow call for its address (a failure there never fails the flow: a missed IP row is a gap in a weak kind).
- When an inquiry completes, fails or expires, a `graph_index_jobs` row is written; the `graph-index-sweep` (every 15 s) enqueues the `graph-index` job, which writes the verifications' and sessions' values. Five attempts, then `errored`.
- `graph-backfill` is a 60-second tick: while any kind of any environment is incomplete it walks one bounded batch of accounts, then inquiries, and does nothing otherwise. So it runs at startup until complete and picks up a switch within a minute.
- `graph-components` runs nightly at 03:00 UTC for the environments with `graph-components` on, giving each account a component of the accounts it shares a strong value with. `GET /api/v1/accounts/:id/graph-component` (`graph:read`) answers its `state`, `size` and `computed-at`: `disabled` while the setting is off, `not-computed` for an account newer than the last run, and `computed` otherwise. It is a route of its own, so a viewer, who never holds `graph:read`, receives no graph data on the account read. The run-local component id is not served, and the size is a lead (beta), never a decision.
- Consolidating accounts moves the rows; redacting an inquiry or an account deletes its rows and removes its account from every stored result. `ip-retention-days` deletes the `ip_address` rows past it in the daily pass, so an address no longer links accounts once it is gone.
- `pnpm --filter @openverify/api graph:reindex [--environment <env_...>] [--batch-size=<n>]` re-walks an environment and marks every kind complete. `blind-index:rebuild` re-keys the rows.

## Query templates

A template (`POST /api/v1/graph-query-templates`, `graph:write`) is versioned: a draft, then published (`POST /api/v1/graph-query-template-versions/:id/publish`). `GET /api/v1/graph-query-template-versions?filter[graph-query-template-id]=` (`graph:read`) lists its versions, newest first with a cursor, and its `latest-version` relationship names the newest by id. Its config:

```json
{
  "parameters": [{ "name": "account_id", "kind": "account_id" }],
  "start": [{ "kind": "account_id", "value": "{{account_id}}" }],
  "connect-kinds": ["email_address", "phone_number", "government_id_number"],
  "max-hops": 4,
  "node-limit": 100,
  "include-weak-kinds": false
}
```

Publishing refuses a weak connect kind without `include-weak-kinds` (`weak_kind_not_allowed`) and a placeholder no parameter declares (`graph_parameter_unbound`). Filters narrow the accounts a walk reaches: account types, statuses, tags and a created-at window given by parameters.

**Binding a parameter.** Most kinds take one string. Those a string cannot carry unambiguously take an object:

| Kind | Value |
|---|---|
| `name` | `{ "name-first", "name-last" }` (keyed in both orders, so it starts two nodes) |
| `name_birthdate` | the same, plus `birthdate` |
| `address` | the six `address-*` members of a list item |
| `government_id_number` | `{ "issuing-authority-code", "identification-number", "id-class"? }` |
| `crypto_address` | `{ "chain-id", "address" }` |
| `chip_signature` | cannot be bound (no plaintext exists): 422 |
| `created_at` | an ISO time |

A parameter the template does not declare, or a value its kind cannot key, answers 422 at `/data/attributes/parameter-map/<name>`. A parameter of a person-identifying kind needs `pii:view` (403 `graph_parameter_not_allowed`).

## Queries

`POST /api/v1/graph-queries` (`graph:write`) answers 201 `submitted`; the `graph-query` job (one attempt; the `graph-query-sweep` retries a submitted query) runs it under a per-template claim, one running query per template. With `meta.run-sync: true` (`graphQueries.createSync` in `@openverify/node`) the API runs it at once (at most 10 seconds, two at a time per environment, else 429 `graph_sync_limited`). `rerun` and `cancel` act on a stored query.

- **Hops** are counted the public way: account to value is one, two accounts sharing a value two. `max-hops` is 2, 4 or 6 (default 4).
- **Node limit** 1 to 2,000 (default 100) over accounts and values together; reaching it sets `node-limit-reached`.
- **Fan-out:** a value held by more than 50 accounts is a hub; it is skipped and counted in `skipped-hub-values`.
- **Deadline:** 1 to 59 seconds (default 30); past it the query is `timed_out` with what it gathered.
- A value node joins a result only when two of its accounts hold it (a start value always does).
- **Honesty:** `kinds-not-indexed` lists the template's kinds not written now (indexing or weak kinds off, device recognition off) or still incomplete, and `index-complete` is false while any is.

A result's `explorer-url` is its page in the console, on `OPENVERIFY_DASHBOARD_PUBLIC_URL`; in production without that setting it is `null`, never `localhost`. A property node's id is `gn_` plus 22 random base64url characters, local to one result; it names no value. `GET /api/v1/graph-queries/:id/nodes/:nodeId/value` (`graph:read`, `pii:view`, the `graph-unmask` policy of 60 a minute per principal) answers one value and is audited (`graph-query.node-unmasked`). `params` are masked without `pii:view`, sealed at rest, and redacted after `graph-query-retention-days`.

Rate limits: `graph-queries` 30 a minute per environment, `graph-unmask` 60 a minute per principal.

## Bulk actions

`POST /api/v1/graph-queries/:id/actions` (`graph:read` plus the action's own scope) acts on the accounts of the stored result, selected by `account-ids` or `all` (at most 500, else 422 `selection_too_large`). Every non-preview call needs an `Idempotency-Key`; `preview: true` answers counts only.

| Action | Needs | |
|---|---|---|
| `add-tag`, `remove-tag` | `accounts:write` | |
| `set-account-status` | `accounts:write` | `active` or `archived` |
| `add-to-list` | `lists:write`, `pii:view` | the value of a kind that fits the list; face and background lists are refused (`biometric_list_not_bulk`) |
| `export` | `accounts:read`, `pii:view` | `text/csv`: `account-id`, `reference-id`, `status`, `tags`, `hop-distance`, `linking-kinds`; cells neutralised against formulas |

Each account's outcome is `done`, `skipped_redacted` or `skipped_consolidated`. Each call is audited with its counts. With `@openverify/node`, `graphQueries.exportCsv` answers the CSV text and sends an `Idempotency-Key`; `graphQueries.action` refuses `export`, whose answer is not a JSON document.

## Performance (C101.8, reported, not gated)

`pnpm --filter @openverify/api graph:benchmark` on 1,000,000 synthetic accounts and 6,005,000 rows (Postgres 17, 50 starts a scenario, Workflow 7B): strong kinds at 2 hops p95 8.4 ms (a mean of 17 nodes), at 4 hops 13.3 ms (29 nodes), at 6 hops 16.3 ms (41 nodes); with device, IP and name kinds at 4 hops 20.6 ms (235.6 nodes); a hub start 11.1 ms (29 nodes), which measures skipping the hub, in all 50 starts. No run timed out or reached the node limit.

Read these as the cost of a small neighbourhood, not of a full result: the synthetic graph links accounts in small rings, so no scenario comes near the 2,000-node limit, a fan-out cap or the 30 s deadline. The cost follows the accounts reached, not the table. The CI gate at 100,000 accounts is the one dense case, and it asserts the limits rather than timing them.

## Data protection

The graph is profiling in the GDPR's sense: an operator who turns it on records it in their DPIA, with its purpose (fraud rings, duplicate accounts), the kinds they index, the retention of stored results, and who may unmask. Weak kinds and components are off by default because they link people on little evidence. Values are pseudonymous keys; a plaintext value is only ever read back from the record that holds it, by an audited unmask.
