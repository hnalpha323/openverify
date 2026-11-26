# Database

PostgreSQL 17 with pgvector (C277.7). This page gives the roles the code expects, the settings Workflow 11D measured and recommends to the operator, and the major-version upgrade. **No code sets any of the role settings below** (11D set none of them, Workflow 11D review amendments item 7): they are your `ALTER ROLE` statements.

## Two roles

| Role | Used by | Rights |
|---|---|---|
| The migration role (`OPENVERIFY_MIGRATION_DATABASE_URL`) | `db:migrate`, `db:grant-runtime`, `seed:dev`, `kek:rewrap` | Owns the schema; creates the `vector` extension (each migration that needs it runs `CREATE EXTENSION IF NOT EXISTS vector`) |
| The runtime role (`DATABASE_URL`) | the API, the worker and the other commands | What `db:grant-runtime` grants, nothing more |

`pnpm --filter @openverify/api db:grant-runtime <role>` (`node dist/commands/db-grant-runtime.js <role>`), run as the migration role, grants the runtime role (`packages/db/src/runtime-role.ts`, C249.3): `USAGE` on the schema `public` (never `CREATE`); `SELECT, INSERT, UPDATE, DELETE` on every table and `USAGE, SELECT, UPDATE` on every sequence, with the same default privileges for what the migration role creates later; only `SELECT, INSERT` on the append-only tables (`audit_logs`, `connect_share_policies`), whose expired rows are deleted through a `SECURITY DEFINER` function the migration role owns; `MAINTAIN` on the few tables whose statistics the runtime refreshes; `EXECUTE` on the migration role's functions. It refuses a role that is a superuser, the role running it, or the owner of the database, the schema or any table: such a role could run DDL whatever is granted.

**Run `db:grant-runtime` after every `db:migrate`**: a migration's new tables get the default privileges, but a new function or append-only rule needs the grant again. The chart's migrate Job runs both in that order; the compose `app` profile runs `db:migrate` alone with one role ([install-compose.md](install-compose.md)). Without `OPENVERIFY_MIGRATION_DATABASE_URL`, `db:migrate` falls back to `DATABASE_URL` and warns in production.

Two `db:migrate` runs serialise on an advisory lock; one waits at most `OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS` (600 by default) and then exits 75. Migrations are forward-only ([upgrades.md](upgrades.md)).

## Timeouts

Workflow 11D's rule (C272.2): the runtime role's `statement_timeout` is twice the longest legitimate statement, rounded up to 10 s, and its `idle_in_transaction_session_timeout` twice the longest idle gap inside a transaction, at least 60 s. The migration role gets neither (a migration may run long).

- **`statement_timeout` 370 s for the runtime role**: twice the longest statement 11D measured, the 2,000,000-name watchlist sync's full key-frequency rebuild (`insert into watchlist_key_df`, 183.5 s; `docs/calibration/watchlist-phase11.md`). The sync runs that rebuild because `incremental-key-df` ships off (`packages/db/src/repositories/watchlist-switches.ts`), and `watchlists:rebuild-key-df` and the re-key run it whatever the switch. The load takes alone would have given 40 s.
- **`idle_in_transaction_session_timeout` 60 s**: the longest idle gap inside a transaction on the load stack was 1.31 s (a list import), so the rule's floor applies.
- **The timeout also bounds the C16 retention pass's batches.** The longest statement over every load take was the retention pass's batch delete of `api_logs` (18.3 s): a lower timeout would cut it.

```sql
ALTER ROLE openverify_runtime SET statement_timeout = '370s';
ALTER ROLE openverify_runtime SET idle_in_transaction_session_timeout = '60s';
```

Each takes effect for the role's new sessions; roll the API and the worker after it. A larger list than 2,000,000 names needs the figure measured again.

## JIT

**Turning JIT off for the runtime role is not recommended** (C272.1, Workflow 11D review amendments item 7). The rule recommends it only if no scenario's median p95 with JIT off is more than 5% above its median with JIT on; the reads were **3.93 times worse** with it off, while the writes moved the other way (0.33 times) and screening not at all (0.999 times). The read and write takes swing by a factor of 7 to 144 between takes of one configuration (one API process near its saturation), so three takes do not separate JIT's effect from that noise on that machine: read the figures and the method in `docs/calibration/load-phase11.md` ("Database tuning"), not a setting. The watchlist retrieval already turns JIT off for its own statements (`set local jit = off`, `packages/db/src/repositories/watchlist-reads.ts`).

## Connections

Each API and worker process opens up to 10 connections; at every knee 11D measured, the API process and the worker held **10 connections** each, the pool's whole default size, and the API's limit was its CPU, not its pool ([sizing.md](sizing.md#database-connections)). Size `max_connections` for 10 per API and worker replica plus the commands you run and a margin; the chart refuses values whose pools could exceed `external.postgres.maxConnections`.

## The server's log

Set `log_parameter_max_length=0` and `log_parameter_max_length_on_error=0` (C73.8), as compose sets on its server (`infra/docker-compose.yml`): otherwise a failing statement's bound parameters, a screened name among them, reach the server's log. Keep `log_statement` at its default (`none`).

## A major-version upgrade with `pg_upgrade`

Install pgvector's shared library, built for the new server, in the new cluster **before** running `pg_upgrade`, and do not run `CREATE EXTENSION` there: the extension's definition is copied from the old cluster. Run `pg_upgrade --check` first (with `--link` or `--clone` if you will use that mode); it changes no data. Then, in each database, `ALTER EXTENSION vector UPDATE` brings the extension to the installed version.

Sources, re-read on 2026-11-20: PostgreSQL 17's `pg_upgrade` page, <https://www.postgresql.org/docs/17/pgupgrade.html> (its steps on installing extension shared object files in the new cluster and on `--check`); pgvector's README at v0.8.6, the version compose pins, <https://raw.githubusercontent.com/pgvector/pgvector/v0.8.6/README.md> (its "Upgrading" section covers the extension's own update only and says nothing of `pg_upgrade`). Take a backup and run the restore drill first ([backups-and-restore.md](backups-and-restore.md)).
