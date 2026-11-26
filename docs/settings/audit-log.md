# The audit log

Every change an operator, a key or the system makes is written as an audit entry in its
environment. `audit_logs` is append-only: a database trigger refuses every update except the KEK
rewrap. This page covers C168.6 of [the Phase 9 plan](../plans/phase-9.plan.md) as built in
Workflow 9B (`api-access`): the explorer's filters, the address index and retention. The console's
explorer comes in Workflow 9C.

## The explorer's filters

`GET /api/v1/dashboard/audit-logs` and the server API's `GET /api/v1/user-audit-logs`
(`audit-logs:read`) take, besides the earlier `filter[action]`, `filter[actor-id]`,
`filter[resource-type]`, `filter[resource-id]` and creation-time filters:

| Filter                  | Meaning                                                         | Needs                            |
| ----------------------- | --------------------------------------------------------------- | -------------------------------- |
| `filter[action-prefix]` | actions starting with a dotted prefix, such as `inquiry.`       | `audit-logs:read`                |
| `filter[from]`          | entries at or after an ISO 8601 instant                         | `audit-logs:read`                |
| `filter[to]`            | entries before an ISO 8601 instant (`from` must be before `to`) | `audit-logs:read`                |
| `filter[ip]`            | entries made from one exact IPv4 or IPv6 address, never a range | `audit-logs:read` and `pii:view` |

`filter[ip]` without `pii:view` is 403, never an unfiltered list. Each page's next link keeps every
filter. A saved view of the audit log cannot store `filter[ip]`, because an address is personal
data.

Organisation-level actions (users, roles, invitations, MFA resets) are written in every environment
of the organisation, so the explorer of any one environment shows them; see
[roles](roles.md#where-the-per-environment-rules-apply) for the list, and
[organisation settings](roles.md#organisation-settings).

## The address index

An entry's address is stored encrypted, so it cannot be compared in SQL. `filter[ip]` therefore
reads a separate table, `audit_log_ip_index (audit_log_id, environment_id, ip_hmac)`, which holds an
HMAC of the address (IPv6 written in its canonical form first) under the environment's blind-index
subkey, label `openverify/audit-ip/v1`. The filter computes the same HMAC and matches exactly; the
address itself is never compared or logged.

- A row is written beside each new entry that has an address, when the process has the blind-index
  key (`OPENVERIFY_BLIND_INDEX_KEY`). Without the key no row is written, and `filter[ip]` answers 503
  rather than an unfiltered list.
- `pnpm --filter @openverify/api blind-index:rebuild` backfills and rewrites the index from the
  encrypted addresses (it prints `scanned N audit log addresses, re-indexed N`), so entries written
  before the index existed, or before a blind-index key change, are found again. It never updates
  `audit_logs`.
- An index row is deleted with its entry and with its environment.

## Retention

`audit-log-retention-days` is an environment setting: `null` by default, which keeps every entry as
before Phase 9, or 30 to 3,650 days. The C16 retention pass (the worker's, or
`pnpm --filter @openverify/api retention:run`) deletes, per environment and in batches, the entries
older than that, each with its index row, and reports the count as `deletedAuditLogs`. An
organisation-level action written in several environments is kept or deleted in each under that
environment's own setting. A user's "last sign-in" in the users list reads the sign-in's audit entry,
so it becomes `null` once that entry ages out.

Some regulations require audit records to be kept for a minimum time; choosing the retention is the
operator's decision, and the default deletes nothing.
