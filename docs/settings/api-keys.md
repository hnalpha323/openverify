# API keys

An API key belongs to one environment and holds API scopes; its token is shown once, when the key is
created, cloned or rotated. This page covers C169.1 to C169.4 of
[the Phase 9 plan](../plans/phase-9.plan.md) as built in Workflow 9B (`api-keys-webhooks`): one-call
rotation, the note, the age warning and the attribute blocklist. All routes are under `/api/v1` and
need `api-keys:write` to change a key (`api-keys:read` to read one). A key never holds more than its
creator holds in the key's environment.

## Rotation

`POST /api/v1/api-keys/:id/rotate` makes a new key and ends the old one in one transaction:

```json
{ "meta": { "previous-expires-in-seconds": 86400, "name": "Back office (rotated)" } }
```

- `previous-expires-in-seconds` (0 to 2,592,000, 30 days) is how long the old token keeps working;
  0 ends it at once. The old key ends at the **earliest** of its own expiry, its revocation and now
  plus that time, so a rotation never extends a key. `name` is optional (the old name by default).
- The new key copies the old one's scopes, allowed IP ranges, API version, case-template
  restriction, attribute blocklist and note. It gets a new token and no expiry of its own: its
  `expires-at` is `null` until you set one with `POST /api/v1/api-keys/:id/expire` (Workflow 9D
  records this as the behaviour, K9-30). The old key's own resource serves its end as
  `expires-at`, the same time as the answer's `meta.previous-expires-at`.
- The caller must hold every scope it copies (403 naming the ones it lacks) and be able to see any
  case template the key is restricted to. If the old key or the caller cannot see personal data, the
  new key is PII-masked. A key of another environment is 404.
- The answer is 201 with the new key, its token **once** under `meta.token`, and
  `meta.previous-key-id` and `meta.previous-expires-at`: until that time both tokens work, so deploy
  the new one before it.
- One audit entry, `api-key.rotated`, is written on the new key, naming the old key and its end;
  neither token is in it. A key that already ended can be rotated (its end stays as it was).

Rotating regularly replaces the manual procedure of creating a key, deploying it and expiring the old
one. A rotation is not a revocation: when a token has leaked, end the old key at once
(`previous-expires-in-seconds: 0`, or `POST /api/v1/api-keys/:id/expire`).

## The note

`note` is an optional free-text note of at most 255 characters with no control characters, set on
create or update (`null` removes it), served on the key and copied by clone and rotate. Stored API
logs show it only to readers who hold `pii:view`; keep secrets and personal data out of it anyway.

## Age

Every key the API serves carries `age-warning`: `true` when it was created more than
`api-key-age-warning-days` ago (an environment setting, 90 by default, 1 to 3,650, read on every
call). A rotated key is a new key, so its age starts again. The warning only marks a key; nothing
expires or stops because of it.

## The attribute blocklist

`attribute-blocklist` lists attribute names (at most 100, kebab-case, no duplicates; the same
grammar as a webhook's blocklist) that are removed from **every** document served to that key, set on
create or update (a list replaces the old one) and copied by clone and rotate. The rule
([`services/api-keys/blocklist.ts`](../../apps/api/src/services/api-keys/blocklist.ts)):

- a resource keeps its `type`, `id`, `relationships` and `links`; its `attributes` and `meta` lose
  every blocked name at any depth (blocking `fields` drops the whole fields object);
- an embedded document, such as an event's `payload` or a job's result, keeps its structure, and
  each resource in it follows the same rule;
- a document's `meta` loses the blocked names;
- a problem keeps `type`, `title`, `status`, `detail`, `instance`, `code` and `errors` (pointers,
  never values), and loses a blocked extension member.

It is applied once, after a response is serialized and before it is stored for idempotent replay or
in the API logs, so a replayed answer and a stored log hold the stripped body too. It covers top-level
`data`, `included`, the payload of `GET /events` and `GET /events/:id`, bulk-report results, the
`meta` of asynchronous jobs and problems. An export a key creates records the key's blocklist and
leaves those columns out of the CSV. Bodies that are not JSON (a file's bytes, a CSV) pass as they
are; a JSON body that does not parse is not sent.

A blocklist narrows what one integration reads; it is not access control. Use scopes, PII masking
and the case-template restriction to decide what a key may do, and the blocklist to keep attributes
an integration has no use for out of its responses and logs.

## Tokens in source code

Every OpenVerify bearer token has a fixed shape (`ov_sbx_` or `ov_prod_` for keys, then 43
base64url characters). This repository's [`.gitleaks.toml`](../../.gitleaks.toml) has a rule,
`openverify-bearer-token`, that finds them in commits; its allowlist admits test tokens that carry
the word `synthetic`. You can copy the rule into your own repositories' secret scanning.

## Not built

OAuth client credentials, key inflection (versioned attribute names), payload filters and
template-restricted keys beyond the case-template restriction are not built.
