# Phase 11, Workflow 11B, Stage 2: platform-ops (family P)

C249 (TLS settings and warnings, `_FILE` secrets, the migration role, `db:grant-runtime`, the
migrate lock), C250 (`/ready`, the heartbeat and `worker-health`, the internal listener, the drain,
`org:create`, the metrics registry), C255.1 (the optional HSTS header), and the known item
K7C-R008. Beside foundation-11b and the other Stage 2 agents (rule 24: no e2e gate, no other
package's suites). Every command below was run from the repository root after
`source scripts/env.sh` unless it says `cd`; load averages are `cat /proc/loadavg`'s first three
figures.

## 1. K7C-R008: graph:benchmark refuses an install's database

- Stub `64d6bb26f`: `prepareBenchmarkTarget(db, migrate)` and `GraphBenchmarkTargetError` in
  `apps/api/scripts/graph-benchmark.ts` (the known item's path; a named borrowed edit), today's
  behaviour (migrate, then the scratch environment).
- RED `6bbd5ec32` (`apps/api/src/graph-benchmark-target.test.ts`):

  ```
  $ (cd apps/api && pnpm exec vitest run src/graph-benchmark-target.test.ts --coverage.enabled=false)   # load 0.78
  FAIL ... refuses a target that holds another organization, before any migration or write
  AssertionError: promise resolved "env_01M7AW97TTKDVRSP7EERECR1A4" instead of rejecting
  FAIL ... names the reason without naming the organization it found
  AssertionError: expected 'env_01M7AW99QSV853Q43HQ2S4C17V' to be an instance of GraphBenchmarkTargetError
  Tests  2 failed | 2 passed (4)
  ```

- GREEN `4e35ac42b`: `refuseInstallDatabase` before any migration: no `organizations` table is
  accepted (an empty database); any organization other than `Graph benchmark (synthetic)` refuses
  with a message that names no organization.

  ```
  $ (cd apps/api && pnpm exec vitest run src/graph-benchmark-target.test.ts src/services/graph-hooks.test.ts --coverage.enabled=false)   # load 5.20
  Test Files  2 passed (2)
  Tests  33 passed (33)
  ```

## 2. C249.4 and C249.3: the migrate lock and the migration role

- RED `b5ecac3c3` (`packages/db/src/migrate-lock.test.ts`, `apps/api/src/migrate.test.ts`,
  `apps/api/src/migrate.integration.test.ts`). Its stub commit stopped on a lint error in the same
  shell chain while the RED commit went through, so the names arrived with the GREEN `982f54c37`
  directly after (recorded as a deviation; the tree did not typecheck between the two commits).

  ```
  $ (cd packages/db && pnpm exec vitest run src/migrate-lock.test.ts --coverage.enabled=false)   # load 7.03
  × bounds the wait, takes the lock, runs the work, then releases the lock
  × fails with migrate_lock_timeout when the wait runs out, running nothing
  × passes any other failure of the lock through unchanged
  × releases the lock when the work fails
  × takes and releases a real advisory lock        AssertionError: expected +0 to be 1
  × counts the migrations the database records as applied   AssertionError: expected +0 to be 36
  Tests  6 failed | 1 passed (7)
  $ (cd apps/api && pnpm exec vitest run src/migrate.test.ts --coverage.enabled=false)
  Tests  6 failed | 3 passed (9)
  $ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/migrate.integration.test.ts)   # load 8.84
  × serialises two runs started at once: the second finds nothing to do
    Error: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
    Caused by: error: duplicate key value violates unique constraint "pg_namespace_nspname_index"
  × exits 75 with migrate_lock_timeout while another run holds the lock, migrating nothing
    AssertionError: expected +0 to be 75
  Tests  2 failed | 1 passed (3)
  ```

  Without the lock, two runs at once race on Drizzle's `CREATE SCHEMA` and one fails: the intended
  reason.

- GREEN `982f54c37`: `withMigrateLock(connection, timeoutSeconds, work)` (`packages/db`) sets
  `lock_timeout` for the wait, takes `pg_advisory_lock(migrateLockKey())`, clears the setting,
  runs the work and unlocks in a `finally`; `55P03` becomes `MigrateLockTimeoutError`
  (`migrate_lock_timeout`). `appliedMigrationCount(db)`. In `apps/api/src/migrate.ts`:
  `migrateDatabase({lock})` and `migrationsApplied`, `migrateSettingsFromEnv`,
  `migrateStartWarnings` (`migration_url_unset`, production only), `runMigrateCommand` (exit 0, 75
  or 1).

  ```
  $ (cd packages/db && pnpm exec vitest run src/migrate-lock.test.ts src/migrate.test.ts --coverage.enabled=false)   # load 6.34
  Tests  39 passed (39)
  $ (cd apps/api && pnpm exec vitest run src/migrate.test.ts --coverage.enabled=false)
  Tests  9 passed (9)
  $ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/migrate.integration.test.ts)
  Tests  3 passed (3)    Duration 26.55s
  ```

- `migrationRoleEnv`: stub `aae1d8dba`, RED `3cf2d79f4` (1 of 11 failed: `expected { …(3) } to
  deeply equal { …(3) }`), GREEN `a9ca5107a` (11 of 11).
- The script lines (named borrowed edits) `5728ed365`: `scripts/migrate.ts` runs
  `runMigrateCommand` with the `openverify-migrate` logger; `seed-dev.ts` and `kek-rewrap.ts` read
  the migration role through `migrationRoleEnv`. `src/kek-rewrap.test.ts` and `src/migrate.test.ts`:
  28 of 28.

## 3. C250.5: org:create

- Stub `15fdf7dfe` (`apps/api/src/commands/org-create.ts`), RED `917b5036b`
  (`apps/api/src/commands/org-create.test.ts`):

  ```
  $ (cd apps/api && pnpm exec vitest run src/commands/org-create.test.ts --coverage.enabled=false)   # load 16.44
  × creates the organisation, both environments, the template and an invited admin, and mails the invitation
  × refuses a second run with the same name and writes nothing
  ...
  AssertionError: expected 'org:create is not built yet (platform…' to contain 'OPENVERIFY_SMTP_URL'
  Tests  13 failed | 1 passed (14)
  ```

- GREEN `71191a4c1`: `runOrgCreate` and the script's `main(argv, env, io)` answering its exit code;
  `package-scripts.test.ts` holds the built command (rule 12).

  ```
  $ (cd apps/api && pnpm exec vitest run src/package-scripts.test.ts src/commands/org-create.test.ts src/services/access/mfa-default.test.ts --coverage.enabled=false)   # load 19.1
  Tests  30 passed (30)
  ```

  The environments' order in the test is by `kind::text` (the enum sorts sandbox first).

## 4. Commits made before the restart whose evidence was not yet written here

The owner's PC restarted at about 14:06 EST on 2026-11-13 and the first run's console output for
the steps below was lost. Each RED and GREEN result here is the one its commit message recorded
when it was made (quoted from the message, not re-created); the GREEN state is re-proved by the
fresh runs in section 5.

| Step | Stub | RED (as its message records) | GREEN (as its message records) |
| --- | --- | --- | --- |
| C249.3 `grantRuntimeRole` (`packages/db/src/runtime-role.ts`) | `e77a57f94` | `dc814597c`: 9 of 15 unit and the whole Postgres 17 file fail on the stub | `61e11d81b`: 15 of 15; Postgres 17 13 of 13 |
| C249.3 `db:grant-runtime` (`apps/api/src/commands/db-grant-runtime.ts`) | `054714b3b` | `d306801b9`: 7 of 7 fail on the stub | `1ce760738`: 7 of 7, `package-scripts.test.ts` holds the built command (rule 12) |
| C249.3 `createRuntimeRole` (`@openverify/db/testing`) | `9c740214a` | `6edd6c390`: the URI connects as a granted non-owner role, twice | `400941a14`: 14 of 14 on Postgres 17 |
| C250.2 `worker-health` | `03588449f` | `cbab1c15c`: 9 of 9 fail on the stub | `8feab75c3`: 9 of 9 |
| C255.1 the flow server (borrowed edits of `apps/flow/server.ts`, `infra/tests/flow-headers.test.sh`) | `badf153e2` (after its RED, a quoting slip) | `77f92c968`: 13 of 14 fail on the stub | `88572a4a8`: flow server tests 72 of 72; `flow-headers.test.sh --static-only` 11 of 11 |
| C255.1 the console (borrowed edit of `apps/dashboard/next.config.ts`) | `530b3fcc5` | `6a07b88f1`: 5 of 18 fail on the stub | `c06354512`: 18 of 18 |
| C249.2 `resolveSecretFiles` | foundation-11b's hook | `8e956d927`: 9 of 9 fail on the stub | `96ab11f73`: 10 of 10 |
| C249.1 `readStoreTls`, `applyStoreTls` | `29658e543` | `9cc6e4b09`: 14 of 20 fail on the stub | `96ebb69a4`: 20 of 20; config 144 of 144; `store-tls.integration.test.ts` 1 of 1 (a real TLS server, a per-run CA from openssl) |
| C249.1-C249.4 migrate's settings through `loadMigrateConfig` | `3f62b7996` | `c46c5808a`: 7 of 20 fail | `b002b791e`: 20 of 20; integration 3 of 3 |
| C250.2 the heartbeat, C250.7 `worker_heartbeat_age_ms` | `f82277425` | `168e30c55`: 4 of 4 fail on the stub | `f554d380a`: 5 of 5 |
| C250.4 the drain | `ffaff49cf` | `2aa8c1eef`: 2 of 2 fail on the stub; the Valkey 9.1 and BullMQ close semantics test 1 of 1 | `778f2bdfa`: 2 of 2 |
| C255.1 the API (`apps/api/src/http/hsts.ts`) | foundation-11b's hook | `dbd14ad68`: 5 of 6 fail on the stub | `dd891f5c6`: 6 of 6 |
| C250.3 the internal listener | `137f6fb04` | `b87a669e0`: 3 of 7 fail on the stub | section 5 (committed after the restart) |

Each stub's behaviour test in `apps/api/src/foundation-11b-stubs.test.ts` left that file in the RED
or GREEN commit that replaced it, as the file's header asks (named borrowed edits).

## 5. After the restart: C250.3 GREEN and the re-run of every GREEN

The C250.3 GREEN was in the working tree, uncommitted, when the PC restarted (saved by the
orchestrator in `R/phase11-prep/11b-resume/uncommitted-at-restart.patch`). Its log key is `event`,
not `code`: the Phase 5 log rule refuses `code` there, and the test reads the same key.

```
$ (cd apps/api && pnpm exec vitest run src/http/internal-listener.test.ts src/foundation-11b-stubs.test.ts --coverage.enabled=false)   # load 2.79 -> 7.89
Test Files  2 passed (2)
Tests  9 passed (9)
$ (cd apps/api && pnpm exec eslint src/http/internal-listener.ts src/http/internal-listener.test.ts src/foundation-11b-stubs.test.ts)   # exit 0
$ pnpm exec prettier --check <the three files>   # exit 0
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec tsc --noEmit)   # exit 2, 5 errors, all in other agents' files being built at the time:
  src/routes/dashboard/end-sessions.ts, src/routes/dashboard/sso.ts, src/watchlists/conditional-policy.test.ts
```

GREEN `c2e941678`. Then every platform-ops unit file, re-run on the tree at `c2e941678`:

```
$ (cd apps/api && pnpm exec vitest run <the 15 platform-ops test files> --coverage.enabled=false)   # load 32.60 -> 33.90 (other agents' suites)
Test Files  15 passed (15)
Tests  140 passed (140)
Duration  86.99s
$ (cd packages/db && pnpm exec vitest run src/runtime-role.test.ts src/migrate-lock.test.ts --coverage.enabled=false)
Tests  22 passed (22)
$ (cd apps/flow && pnpm exec vitest run src/server/server-hsts.test.ts src/server/server-headers.test.ts --coverage.enabled=false)
Tests  36 passed (36)
$ (cd apps/dashboard && pnpm exec vitest run src/next-config-hsts.test.ts --coverage.enabled=false)   # load 25.86 after
Tests  6 passed (6)
```

## 6. C250.7: the documents may name only registered metrics

- Stub `b29eeff9f` (`apps/api/src/metrics-documents.ts`), RED `3921bd359`
  (`apps/api/src/metrics-documents.test.ts`):

  ```
  $ (cd apps/api && pnpm exec vitest run src/metrics-documents.test.ts --coverage.enabled=false)   # load 5.64
  × reads every way an alert names the metric field, each name once in order
  × reads a CSV row of the ASVS checklist the same way
  × answers the names the registry does not hold
  AssertionError: expected [] to deeply equal [ 'worker_heartbeat_age_ms', …(5) ]
  Tests  3 failed | 2 passed (5)
  ```

- GREEN `173c6a0c5`: a document names a metric as an alert matches the event's field
  (`metric: <name>`, `metric=<name>`, `"metric": "<name>"`; the word whole, any case; a snake_case
  name with an underscore, quoted or not). `docs/security/threat-model.md`,
  `docs/self-hosting/monitoring.md` and `docs/security/asvs-5.0.0-l2.csv` are read when they exist
  (none does yet; 11E writes them).

  ```
  $ (cd apps/api && pnpm exec vitest run src/metrics-documents.test.ts src/metrics-registry.test.ts --coverage.enabled=false)
  Tests  11 passed (11)
  ```

## 7. C250.7: Workflow 7A's metrics (named borrowed edits)

- RED `993873e21` (borrowed edits of `network/sync.test.ts` and `network/snapshots.test.ts`; new
  `services/handoff/send-budget-metric.test.ts`):

  ```
  $ (cd apps/api && pnpm exec vitest run src/services/handoff/send-budget-metric.test.ts src/network/sync.test.ts src/network/snapshots.test.ts --coverage.enabled=false)   # load 2.87
  × logs network_sources_stale at each re-check: the public sources stale, never checked or not loaded
  × counts each error or refusal as network_sync_failed, never an applied sync (C250.7, Workflow 11B)
  × counts a send refused because the budget store did not answer, and not a spent budget
  AssertionError: expected [] to deeply equal [ 8 ]
  AssertionError: expected [] to deeply equal [ { level: 'info', …(2) }, …(1) ]
  AssertionError: expected [] to deeply equal [ { value: 1, labels: { …(1) } } ]
  Tests  3 failed | 29 passed (32)
  ```

- GREEN `a5f6364d9`: `network_sync_failed` (counter, no label) from the sync's finish line on an
  `error` or `refused_*` outcome; `network_sources_stale` (gauge, no label) at each snapshot
  re-check; `handoff_send_budget_unavailable` (counter, `environmentId`) where the send budget or
  the SMS guards fail closed (the 503 unchanged). Borrowed edits: `network/sync.ts`,
  `network/snapshots.ts`, `services/handoff/flow-handoffs.ts`.

  ```
  $ (cd apps/api && pnpm exec vitest run src/services/handoff/send-budget-metric.test.ts src/network/ src/metrics-registry.test.ts src/metrics-documents.test.ts src/services/handoff/ --coverage.enabled=false)   # load 5.45 -> 9.05
  Test Files  15 passed (15)
  Tests  161 passed (161)
  ```

## 8. C250.1: the readiness check

- Stub `208ba11c9` (`apps/api/src/http/readiness.ts`), RED `21f43ca7b`:

  ```
  $ (cd apps/api && pnpm exec vitest run src/http/readiness.test.ts --coverage.enabled=false)
  × answers 503 naming each store that failed, and no error text
  × counts a store that does not answer within its deadline as unavailable
  × asks both stores at once, so two slow stores cost one deadline
  × counts a probe that throws before it returns a promise as unavailable
  Tests  4 failed | 2 passed (6)
  ```

- GREEN `8faa0ce31`: each store raced against its own cleared 1 s timer; 6 of 6. The route
  (`routes/system.ts`) waits for foundation-11b to freeze `GET /ready` with the OpenAPI snapshot.

## 9. C249.5: a per-process Valkey user

`6c715c93b` (`apps/api/src/config/valkey-user.integration.test.ts`; a proof of behaviour that
already held, so no RED: the URL's user always reached ioredis and BullMQ). First run: 4 of 5, the
DEBUG case answering `ERR DEBUG command not allowed` (Valkey refuses DEBUG to every client unless
`enable-debug-command` is set); the test accepts either refusal for DEBUG.

```
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/config/valkey-user.integration.test.ts)   # load 5.89 -> 7.58, 27 s
Tests  5 passed (5)
```

## 10. C249.3: the syncs and blind-index:rebuild as the runtime role

- `57261a935`: `network.integration.test.ts`' setup (a named borrowed edit) migrates as the owner
  and runs every sync and the loader as the runtime role from `createRuntimeRole`; its last test
  proves the role is not the owner and that no connection received a `WARNING`. 8 of 8 (16 s,
  load 5.78).
- `7d4ca3372`: `apps/api/src/blind-index-rebuild.integration.test.ts`: the whole
  `runBlindIndexRebuild` as the runtime role re-indexes an extraction and merges and deletes a
  device that meets its twin, with no `WARNING`. 2 of 2 (19 s, load 6.48).
- A probe of what the watchlist sync needs (a throwaway `pgvector/pgvector:pg17` container, removed
  after): as a role holding `MAINTAIN` on the table, `select gin_clean_pending_list(...)` answers
  `ERROR: must be owner of index` on PostgreSQL 17.11, so the GIN cleanup must move into
  foundation-11b's `SECURITY DEFINER` function before the watchlist sync can run as the runtime role.

## 11. C249.3: the GIN cleanup through the migration role's function (after foundation-11b's (P) GREEN)

- RED `387072ab7` (`packages/db/src/runtime-role.integration.test.ts`, platform-ops' file):

  ```
  $ (cd packages/db && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts src/runtime-role.integration.test.ts)   # load 20.85
  × rebuilds a watchlist source's key frequencies, the sync's and the re-key's last step, with no WARNING
  Error: Failed query: select gin_clean_pending_list('watchlist_names_keys_idx'::regclass),
  Caused by: error: must be owner of index watchlist_names_keys_idx   (code 42501)
  Tests  1 failed | 15 passed (16)
  ```

- GREEN `e062f98d8` (a named borrowed edit of `packages/db/src/repositories/watchlist-key-df.ts`):
  `select openverify_gin_clean_pending_lists(${sourceId})`.

  ```
  $ (cd packages/db && ... src/runtime-role.integration.test.ts)   # load 21.53 -> 28.28, 87 s
  Tests  16 passed (16)
  $ (cd packages/db && pnpm exec vitest run src/repositories/watchlist --coverage.enabled=false)
  Tests  39 passed (39)
  $ pnpm --filter @openverify/watchlist benchmark:typecheck   # exit 0, 486 s, load 32.13
  $ pnpm --filter @openverify/watchlist benchmark:test       # exit 0, 119 passed
  ```

- `06eec1074` (a named borrowed edit of `apps/api/src/watchlists/watchlists.integration.test.ts`'
  setup; the C78.7 gate block, its header and assertions unchanged, rule 16): the owner migrates,
  every sync, read and the gate run as the runtime role, and a last test re-keys
  `uk-sanctions-list` as that role, proves it is not the owner and that no statement raised a
  `WARNING`. 7 of 7, 481 s at load 28.8 (the C78.7 line: p50 74.9 ms, p95 418.8 ms, cap-binds
  0/300).

## 12. C250.1: `GET /ready`

- RED `1eb7ac5f2` (`apps/api/src/routes/system-ready.test.ts`), over foundation-11b's frozen 501
  (`517debbe9`):

  ```
  $ (cd apps/api && pnpm exec vitest run src/routes/system-ready.test.ts --coverage.enabled=false)
  × answers 200 ready while Postgres and Valkey answer, without a credential and unlimited
    AssertionError: {"type":"about:blank","title":"Not Implemented","status":501,...}: expected 501 to be 200
  × answers 503 naming Valkey when the cache client cannot read, with no error text
  × answers 503 naming Postgres when SELECT 1 fails
  × is not ready in an app built without stores
  Tests  4 failed (4)
  ```

- GREEN `3c3112275`: `readinessProbesOf(api)` (`SELECT 1` through the pool; a read of the
  never-written key `openverify:ready` through the API's Valkey cache client), `NO_STORES`, the
  route over `checkReadiness`. Named borrowed edits: `app.ts` passes the probes to `systemRoutes`;
  `foundation-11b-p.test.ts` drops the frozen 501's test.

  ```
  $ (cd apps/api && pnpm exec vitest run src/routes/system-ready.test.ts src/http/readiness.test.ts src/foundation-11b-p.test.ts src/http/internal-listener.test.ts src/openapi.test.ts src/app.test.ts --coverage.enabled=false)   # load 38.43
  Test Files  6 passed (6)
  Tests  65 passed (65)
  $ (cd apps/api && pnpm exec tsc --noEmit)   # exit 0, no error
  ```

- `1dbc34b59` (`apps/api/src/http/readiness.integration.test.ts`): Postgres 17 and Valkey 9.1, 200,
  then 503 naming Valkey after its container stops, then both after Postgres stops. 1 of 1 (60 s,
  load 28.62). Its first run failed building `/health`'s serializer (a bare Fastify without the zod
  compilers); the test now sets them.

## 13. The end gates (rule 24, beside the other Stage 2 agents)

Load ran 10 to 47 through these calls (six agents' suites); every heavy call went through
`/tmp/openverify-heavy.sh`. Splits taken under that load (rule 8: a shard at its cap doubles K in a
fresh directory): the API unit suite at K=24 (K=12's first shard reached its cap at 340 s with a
234 s slot wait), the dashboard at K=8 (K=2 and K=4 each had a shard at its cap), db at K=4 (one
whole run reached 560 s at load 35), and the API and db lints by folder (each whole run passed
535-580 s).

| Gate | Result | Load (before / after) |
| --- | --- | --- |
| `@openverify/api` typecheck (`tsc --noEmit`) | exit 0 (274 s) | 30.10 / 17.13 |
| `@openverify/api` lint: `src/services/[a-h]*`, `src/services/[i-z]*`, `src/routes src/jobs src/workflows`, the rest | exit 0 each (261, 282, 369, 379 s) | 21.65 to 40.01 |
| `@openverify/api` unit: 24 blob shards and the merge | merge exit 0: 10,792 passed in 848 files, 94.17% statements | 10.79 to 40.6 |
| `@openverify/db` typecheck | exit 0 (245 s) | 27.09 |
| `@openverify/db` lint: `src/repositories`, the rest | the rest exit 0 (384 s); `src/repositories` one error, in `queue-slots.test.ts` (another agent's untracked file, not mine) | 32.65 to 40.28 |
| `@openverify/db` unit: 4 blob shards and the merge | merge exit 0: 2,357 passed in 165 files, 89.88% | 22 to 47 |
| `@openverify/flow` typecheck, lint, test | exit 0 each; 1,639 passed in 135 files, 94.95% | 24.96 to 27.40 |
| `@openverify/dashboard` typecheck (`next typegen && tsc`), lint | exit 0 each (147, 339 s) | 16.17 to 21.95 |
| `@openverify/dashboard` unit: 8 blob shards and the merge | merge exit 0: 7,092 passed in 619 files, 95.65% | 13.84 to 28.68 |
| integration db | exit 0: 110 passed (271 s) | 10.33 / 40.74 |
| integration graph | exit 0: 13 passed (119 s) | 39.56 / 21.07 |
| integration api 1/3, 2/3, 3/3 | exit 0: 115, 133, 193 passed (176, 262, 167 s) | 15.6 to 26.3 |
| `pnpm format:check` | exit 0 (188 s) | 13.30 / 9.78 |
| `benchmark:typecheck`, `benchmark:test` | exit 0 each; 119 passed | 32.13 / 28.72 |
| `infra/tests/compose.test.sh --static-only` | 584 passed | 26.65 |
| `infra/tests/flow-headers.test.sh --static-only` | 11 passed | 26.44 |

The first run of integration api 2/3 (271 s, load 21.4) failed 7 tests, all in auth-sessions'
`src/operator-auth/valkey-login-rate-limiter.integration.test.ts` (each attempt answered
`LoginUnavailableError`, the limiter's fail-closed 503); the file alone passed 8 of 8 (16 s) and the
same shard again passed 133 of 133. That file is not platform-ops'; it is reported to its owner,
never retried as a gate of mine (the gate above is the second, complete run).

`apps/api/src/services/handoff/flow-handoffs.ts` is not Prettier-clean under
`--ignore-path=.gitignore` because of one import that was already unformatted before my borrowed
edit (`'../inquiry-sessions.js'`); I left it as it was (rule 1: the minimal change), and
`format:check` skips `services/`.
