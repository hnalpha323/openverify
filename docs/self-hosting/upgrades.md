# Upgrades

How to move an install to a new release (C277.1). **This is the chart's first release (0.1.0)**, so an upgrade from an earlier release of the chart is untested: there is none. What was tested is a `helm upgrade` of the same chart with changed values on kind (`deploy/helm/openverify/ci/kind.sh upgrade` with `ci/upgrade/kind-upgrade-values.yaml`, which re-runs the pre-upgrade hook and the smoke test; C265.4), at the Workflow 11C close (`docs/tdd/phase11-integration-11c.tdd.md` section 3).

## Steps

1. Read the release notes (`docs/release/notes.md`) and the release checklist's open lines (`docs/release/checklist.md`).
2. Take a backup and know your restore works ([backups-and-restore.md](backups-and-restore.md)).
3. Apply the migrations: `db:migrate` as the migration role, then `db:grant-runtime <runtime role>` ([database.md](database.md#two-roles)). The chart's pre-upgrade hook does both; the compose `app` profile's `migrate` service runs `db:migrate` at `up`. Two runs serialise on the migrate lock.
4. Roll the processes onto the new images.

**Migrations are forward-only.** Nothing reverses one: a rollback means restoring the backup taken in step 2, and losing what was written since.

## The migrations since Workflow 7C

Generated from `packages/db/drizzle/` (the files from `0025` on; `pnpm --filter @openverify/docs-tools docs:selfhost` refreshes the list):

<!-- openverify:selfhost-migrations:start -->
- `0025_phase7c`
- `0026_transaction_relations_page_index`
- `0027_phase8a`
- `0028_phase8b`
- `0029_phase8d`
- `0030_phase9a`
- `0031_phase9b`
- `0032_phase9d`
- `0033_phase10b`
- `0034_phase10c`
- `0035_phase11_connect`
- `0036_phase11_hardening`
- `0037_phase11f_session_amr`
<!-- openverify:selfhost-migrations:end -->

Each runs in `db:migrate`'s order; a migration that needs pgvector creates the extension itself. `0036_phase11_hardening` does not backfill `admitted_at` on verifications already `submitted` before the upgrade: they count as held, and the quota sweep admits them under their own job ids (Workflow 11B Stage 2 amendments, quotas item 4).

## Settings the upgrade brings

New settings start at their defaults; review them after the upgrade. `docs/settings/README.md` lists every environment and organisation setting with its default and range. The retention settings added since Workflow 7A:

- Workflow 7A (`docs/network/README.md`, `docs/flow/handoff.md`): `signal-component-retention-days` (default 30), `ip-retention-days` (unset by default: addresses are kept), `device-retention-days` (default 365); handoff tokens are deleted when they expire.
- Workflow 7B (`docs/transactions/README.md`, `docs/graph/README.md`, `docs/lists/README.md`): `transaction-retention-days`, `graph-query-retention-days` (default 30) and each list's `item-retention-days` (required on face and background lists).
- Phases 8 to 11: the workflow, case, audit-log, analytics and account-export settings (`workflow-run-retention-days`, `case-retention-days`, `audit-log-retention-days`, `analytics-retention-months`, `account-export-ttl-days` and the others in `docs/settings/README.md`).

## Defaults that changed in Workflow 11D

From the calibrations (`docs/calibration/watchlist-phase11.md`, `docs/calibration/lists-phase11.md`; Workflow 11D review amendments items 4 to 6):

- the watchlist re-key's batch is 10,000 rows (`REKEY_BATCH`) and the sync cleans the GIN pending lists every 50 batches (`GIN_CLEAN_EVERY_BATCHES`);
- the `retrieval-reach` lever is on and `incremental-key-df` is off (a large sync is slower with it on);
- the fuzzy-name candidate cap of lists is 5,000;
- the face-list threshold is 0.72, which misses about a quarter of true matches (FNIR 25.3% on studio portraits); the owner may set it back to 0.5. The background-list thresholds are not calibrated.

## Upgrading Node

The consent texts of a share (`docs/connect/consent.md`) render a duration through ICU (`Intl.NumberFormat`). If the Node version, and with it ICU, changes between the moment a consent text is served and the moment it is accepted, the accept can answer `consent_text_mismatch`; roll the API when few consents are open, and expect a user to reload. The same holds for any other process upgrade that changes ICU.

## PostgreSQL

A major-version upgrade is `pg_upgrade` with pgvector installed in the new cluster first ([database.md](database.md#a-major-version-upgrade-with-pg_upgrade)).
