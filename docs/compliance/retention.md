# Retention and backups

This is not legal advice.

Not reviewed by counsel.

How long the install keeps each kind of data, which settings change it, and what retention does not reach. Choosing windows that match your purposes, and telling people what they are, is yours.

## The retention pass

Every window below is an environment setting (C16; the console's settings, `settings:write`, or `settings:privacy` where noted on the feature's page). The worker's daily C16 pass applies them, and `pnpm --filter @openverify/api retention:run` runs one pass by hand (`--now=<ISO-8601>` moves only the cutoff). A pass redacts or deletes what is past its window; redaction is irreversible ([access requests](access-requests.md#erasure-redaction)).

## The settings and their defaults

The defaults are those of the contracts (`DASHBOARD_SETTINGS_DEFAULTS`, `packages/contracts/src/dashboard-api.ts`); this page's record test fails when a row and the code disagree. "Unset" means the data is kept until something else removes it.

| Setting | Default | What it removes |
|---|---|---|
| `account-export-ttl-days` | 7 days | An access export, after it is ready ([access requests](access-requests.md)) |
| `api-log-retention-days` | 30 days | Stored API logs |
| `audit-log-retention-days` | unset | Audit entries (30 to 3,650 days when set; unset keeps every entry) ([audit log](../settings/audit-log.md)) |
| `case-retention-days` | unset | Resolved cases, by redaction, counted from their resolution ([case redaction](../cases/redaction.md)) |
| `consent-proof-retention-days` | 0 days | The bare fact of a Connect consent record after the data it covered is gone ([sharing](sharing.md)) |
| `device-retention-days` | 365 days | Devices not seen for that long ([device and network data](device-and-network.md)) |
| `event-retention-days` | 90 days | Stored events |
| `face-template-retention-days` | 365 days | Face templates and selfie backgrounds, whatever the inquiry's own retention ([biometric data](biometric-data.md)) |
| `graph-query-retention-days` | 30 days | A graph query's parameters and stored results |
| `inquiry-retention-days` | unset | Finished inquiries, by redaction. **Unset keeps them forever: set it** |
| `ip-retention-days` | unset | Addresses on sessions, network evaluations and list matches; unset follows the inquiry |
| `report-retention-days` | unset | Reports, by redaction; unset follows the inquiry |
| `signal-component-retention-days` | 30 days | The collector's sealed components and behaviour bodies |
| `transaction-retention-days` | unset | Transactions, by redaction, except their `never` fields ([lists, the graph and transactions](lists-graph-transactions.md)) |
| `webhook-delivery-retention-days` | 30 days | Webhook delivery records |
| `workflow-run-history-retention-days` | 365 days | A finished workflow run's skeleton |
| `workflow-run-retention-days` | 30 days | A finished workflow run's values and trigger files ([workflows](../workflows/README.md)) |

Two more environment settings count in months, not days: `analytics-retention-months` and `analytics-assignee-retention-months` (both default 13), which bound the analytics rollups ([analytics](../analytics/README.md)).

Windows that are not environment settings:

- `item-retention-days` is set per list (up to 3,650 days; required on face and background lists), and an importer's file is kept until its import ends and then at most the lesser of `item-retention-days` and 7 days ([lists](../lists/README.md)).
- Connect share tokens that expired or failed are deleted 30 days after they ended; a redeemed token, the disclosure record, is kept while the source object or any copy exists ([sharing](sharing.md)).
- Removed watchlist entries are kept for `OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS`, an install setting.
- Case notifications are deleted after 90 days, case export files after 24 hours, and CSV exports after 24 hours.

## What retention does not reach

- **Backups.** A backup holds what the database and object storage held when it was taken, redacted data included, until the backup itself expires. Keep backup retention no longer than you need and no longer than you tell people; a restore brings back data that was redacted after the backup was taken, so re-apply redactions after a restore. How to back up and restore is the self-hosting guide's ([backups and restore](../self-hosting/backups-and-restore.md)).
- **Copies outside the install**: webhook receivers, downloaded exports, a Connect destination's copy, your own systems.
- **Access exports** can outlive a retention step that is not a redaction cascade by at most `account-export-ttl-days` (KP11-27: a report's and a transaction's redaction delete them since Workflow 11F, the other steps in the next release; [access requests](access-requests.md)).
