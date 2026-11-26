# Phase 11, Workflow 11B Stage 1b: foundation-11b (plumbing only)

TDD evidence of `foundation-11b`: the configuration and metrics registries, the 11B variables in
`config.ts`, the hooks in the shared files (each a call to a stub in its owner's file), migration
`0036` and its tables, the frozen routes, the queue, and the 10-minute measurements. Every timing
has `cat /proc/loadavg` beside it. Commands are run from the repository root after
`source scripts/env.sh` unless a `cd` is shown.

## Checkpoints

(each line is written the moment its commit lands; rule 27)

- checkpoint common: d56b4d196
- checkpoint A: 40dcd987c
- checkpoint D: 6b02a240d
- checkpoint P: eccc47dd0
- checkpoint snapshot: b3609c49a
- checkpoint final: 8173e5050

## Checkpoint common

### Stubs (owners named in each file's header)

| File                                                                                         | Owner         | What the stub keeps                                       |
| -------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------- |
| `apps/api/src/config/secret-files.ts` (`resolveSecretFiles`)                                 | platform-ops  | no `_FILE` form read; the environment unchanged           |
| `apps/api/src/config/store-tls.ts` (`readStoreTls`, `applyStoreTls`)                         | platform-ops  | no warning; nothing applied                               |
| `apps/api/src/worker-health/heartbeat.ts` (`startWorkerHeartbeat`)                           | platform-ops  | no file written                                           |
| `apps/api/src/worker-health/drain.ts` (`drainWorkers`)                                       | platform-ops  | closes the workers, as `close` did                        |
| `apps/api/src/http/internal-listener.ts` (`registerInternalRoutes`, `startInternalListener`) | platform-ops  | the internal routes on the public app; no second listener |
| `apps/api/src/http/hsts.ts` (`registerHsts`)                                                 | platform-ops  | no header                                                 |
| `apps/api/src/operator-auth/login-rate-limiter.ts` (`createSharedLoginRateLimiter`)          | auth-sessions | the in-memory limiter `createOperatorAuth` built itself   |

Stub commit `88b4edf33`. The stub tests (`foundation-11b-stubs.test.ts`, 8 tests) pass on the stubs
by design: they hold today's behaviour, which each owner replaces test-first.

### RED (`1f8a20eb8`)

```
$ cd apps/api && pnpm exec vitest run src/config-registry.test.ts src/metrics-registry.test.ts \
    src/config-phase11b.test.ts src/foundation-11b-stubs.test.ts --coverage.enabled=false
 Test Files  3 failed | 1 passed (4)
      Tests  47 failed | 14 passed (61)
  × registers every variable a process reads          (CONFIG_REGISTRY empty)
  × logs one event with the metric name, its value and its labels   (stub emits nothing)
  × reads both limits within their bounds ... reads the HSTS max-age (C255.1)   (fields fixed at defaults)
  × reads the migration URL, the timeout and the mode, through both hooks       (loadMigrateConfig stub)
$ ENV_FILE=<HEAD .env.example> bash infra/tests/compose.test.sh --static-only     (load 11.1)
# 565 passed, 19 failed
FAIL - .env.example declares OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS   (and the other 18)
```

`pnpm exec tsc --noEmit -p apps/api/tsconfig.json` exit 0 on the RED tree (164 s, load 11.4).

### GREEN (`88670f5bf`, hooks `e4138d059`, test fix `afa1edec7`)

```
$ cd apps/api && pnpm exec vitest run src/config-registry.test.ts src/metrics-registry.test.ts \
    src/config-phase11b.test.ts --coverage.enabled=false
 Test Files  3 passed (3)    Tests  53 passed (53)
$ pnpm exec vitest run src/app.test.ts src/container*.test.ts src/routes/internal/embed-policies.test.ts \
    src/server.test.ts src/worker-startup.test.ts src/worker.test.ts src/worker-network-startup.test.ts \
    src/worker-connect.test.ts src/config*.test.ts src/foundation-11b-stubs.test.ts \
    src/operator-auth/operator-auth.test.ts src/operator-auth/login-rate-limiter.test.ts   (load 6.9)
 Test Files  17 passed (17)    Tests  339 passed (339)
$ bash infra/tests/compose.test.sh --static-only     # 584 passed, 0 failed
$ tsc --noEmit (apps/api) exit 0 (124 s, load 9.2); eslint on every touched file exit 0
```

The RED corrections, both in my own new tests before GREEN: the migrate settings' env names
`OPENVERIFY_MODE: 'test'` (without it a process reads production mode, as the API does), and a
weak placeholder case dropped (a `change-me` value is never a valid postgres URL). The gate found one
more: the console now names `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX` in the queue panel's words
(quotas' `80ca6f5fe`) without reading it, so the process check counts reads (`env.NAME`, a quoted
name, a composed prefix), not mentions, with a positive control per process (`afa1edec7`).

### Gate: common (rule 24, beside the six Stage 2 agents)

Every call through a heavy slot (`OPENVERIFY_HEAVY_RESERVED=1 bash /tmp/openverify-heavy.sh`),
one foreground call each; the slot wait is inside the wall time.

| Call                              | Wall                                                         | Load before / after | Result                                                   |
| --------------------------------- | ------------------------------------------------------------ | ------------------- | -------------------------------------------------------- |
| API unit shards 1-12 of 12 (blob) | 189, 177, 227, 176, 165, 191, 205, 169, 181, 180, 140, 137 s | 8.2 to 17.3         | (a lone shard exits 1 on partial coverage)               |
| API merge                         | 48 s                                                         | 12.9 / 8.8          | 10,385 passed, 13 failed in 792 files; 92.51% statements |
| integration db                    | 124 s                                                        | 7.1 / 22.6          | 101 passed                                               |
| integration graph                 | 53 s                                                         | 19.9 / 13.1         | 13 passed                                                |
| integration api 1, 2, 3 of 3      | 125, 214, 131 s                                              | 12.7 to 25.0        | 109, 124, 179 passed                                     |

The merge's 13 failures: one was mine (fixed by `afa1edec7`, then 25 of 25 alone); the other 12 are
other agents' RED tests committed while they build, outside my paths (rule 24): quotas'
`services/quotas/cap-of.test.ts` (3), ingestion-11b's `watchlists/un-opt-in.test.ts` (8) and
`operator-patterns.test.ts` (1). The merge's exit is therefore 1 for reasons in their paths; the
80% gate itself holds (92.51% statements). `@openverify/db` did not change at this checkpoint.

**10-minute check:** the longest call was 227 s (API shard 3 at load 13.5 to 17.3), about 38% of
the cap, so every call of the API unit suite in 12 shards and of `pnpm test:integration` in its five
calls still fits 10 minutes; no split changes.

## Checkpoint A

Migration `0036_phase11_hardening` (generated by `drizzle-kit generate --name phase11_hardening`, the
one 11B migration, extended at each later checkpoint): `user_sessions.last_seen_at` (backfilled from
`updated_at`), `api_keys.pepper_key_id`, `users.password_login_allowed_until`, `organizations.slug`,
`sso_providers`, `user_sso_identities`, `sso_login_states`; the sealed columns
`sso_providers.client_secret`, `sso_login_states.nonce` and `.code_verifier` in `ENCRYPTED_COLUMNS`
and `REWRAP_TABLES`; the session policy hook in `principal-resolver.ts` with the route flag
`activity`; `endUserSessions` at both role writes; the SSO and end-sessions plugins frozen at 501.

Stubs `36338b8ce` (session-policy.ts, auth-sessions'; the frozen route files, sso-oidc's and
auth-sessions'; the three SEALED names; the `OPERATOR_AUTH_SECRET_TABLES` category).

### RED (`42366e150`)

```
$ cd packages/db && pnpm exec vitest run src/migration-0036.test.ts src/schema-v2.test.ts \
    src/testing.test.ts src/repositories/key-rotation.test.ts --coverage.enabled=false
 Test Files  4 failed (4)      Tests  8 failed | 194 passed | 4 skipped (206)
  × is the migration after 0035_phase11_connect, and the last
  × gives an earlier session its updated_at as last_seen_at (C245.1)   column "last_seen_at" does not exist
  × leaves an earlier key without a pepper id ... (C247.1)             column "pepper_key_id" does not exist
  × leaves an earlier user without a break-glass grant (C248.6)        column "password_login_allowed_until" does not exist
  × gives no organisation a sign-in name ... (C248.8)                  column "slug" does not exist
  × lists every encrypted column for the KEK rewrap / rewraps every encrypted column   relation "sso_providers" does not exist
$ cd apps/api && pnpm exec vitest run src/routes/dashboard/foundation-11b-a.test.ts --coverage.enabled=false
 Test Files  1 failed (1)      Tests  9 failed (9)
  × answers the public start and callback with 501, without a session
  × is called for every dashboard request with the session, the clock and the limits
  × runs before the permissions are read, and refuses the session when the policy throws
  × on PUT /users/:id/roles and on PATCH /users/:id with role ids
```

`tsc --noEmit` of `packages/db` exit 0 on the RED tree; `apps/api`'s only errors were in other
agents' new test files (`services/account-export/service.test.ts`, `watchlists/conditional-policy.test.ts`).

### GREEN (`308ceeb20`; test fixes `cd2ff0c18`, `5d5496388`; fix `62977eacf`)

The db gate found the plaintext-secret column test (`cd2ff0c18`, `5d5496388`: the sealed client
secret and the break-glass expiry named). After the restart, the typecheck found that the GREEN
commit's lint fix had dropped `async` from the four frozen plugins without returning a promise
(`FastifyPluginAsyncZod`); `62977eacf` returns `Promise.resolve()` as their siblings do. Then:

```
$ cd apps/api && pnpm exec vitest run src/routes/dashboard/foundation-11b-a.test.ts --coverage.enabled=false
 Test Files  1 passed (1)      Tests  9 passed (9)
$ eslint (the 13 apps/api files of A)   exit 0
$ tsc --noEmit -p apps/api   112 s (load 4.72 -> 2.78): the only errors are in other agents' files
  (auth-sessions' untracked session-policy.test.ts, 3; ingestion-11b's conditional-policy.test.ts, 1)
$ tsc --noEmit -p packages/db   exit 0
```

### Gate: A (rule 24, beside the six Stage 2 agents)

Run from 13:25 to 14:05 on a tree holding every A commit (the API shards from 13:29, after the db
fixes); the PC restarted at about 14:06 during integration api 2, which was run again with api 3
after the restart (14:46-14:55). Logs in the scratchpad's `gate-a/`.

| Call                           | Wall                                                         | Load before / after | Result                                                              |
| ------------------------------ | ------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------- |
| db unit (turbo, first run)     | 195 s                                                        | 4.72 / 15.43        | exit 1: the plaintext-secret test (fixed, `cd2ff0c18`, `5d5496388`) |
| db unit (turbo)                | 210 s                                                        | 8.48 / 15.81        | exit 0: 2,322 passed in 162 files                                   |
| contracts unit (turbo)         | 29 s                                                         | 15.81 / 13.23       | exit 0                                                              |
| API unit shards 1-12 of 12     | 148, 136, 184, 158, 174, 165, 149, 132, 136, 150, 131, 128 s | 9.47 to 13.67       | (a lone shard exits 1 on partial coverage)                          |
| API merge                      | 63 s                                                         | 11.25 / 6.34        | 10,634 passed, 4 failed in 816 files; 93.82% statements             |
| integration db                 | 110 s                                                        | 5.68 / 19.55        | 101 passed                                                          |
| integration graph              | 50 s                                                         | 19.55 / 12.05       | 13 passed                                                           |
| integration api 1 of 3         | 147 s                                                        | 11.17 / 20.25       | 111 passed                                                          |
| integration api 2 of 3 (rerun) | 295 s                                                        | 4.31 / 13.29        | 125 passed                                                          |
| integration api 3 of 3         | 153 s                                                        | 12.55 / 40.95       | 180 passed                                                          |

The merge's 4 failures are other agents' RED tests in their own paths, committed while they build
(rule 24): sso-oidc's `operator-auth/oidc/store.test.ts` (3) and platform-ops'
`http/internal-listener.test.ts` (1). The 80% gate holds (93.82% statements).

### PGlite migration time (Risks), cold and warm, two databases each

`pglite-time.mts` (scratchpad) calls `createTestDatabase` twice; cold sets
`OPENVERIFY_TEST_DB_CACHE_DIR` to a new empty directory. Before is the RED worktree at
`42366e150` (0035 the last migration), after is `main` (0036). Load 25 to 37 (other agents' suites).

| Tree                | Cold (first, second) | Warm (first, second) | Load           |
| ------------------- | -------------------- | -------------------- | -------------- |
| after (main), run 1 | 23,380 and 5,289 ms  | 6,136 and 4,225 ms   | 30.63 -> 37.08 |
| before (0035)       | 17,797 and 1,656 ms  | 2,506 and 2,004 ms   | 34.59 -> 32.71 |
| after (main), run 2 | 10,361 and 1,516 ms  | 2,055 and 1,537 ms   | 32.71 -> 25.86 |

At this load the spread between runs of the same tree (23.4 s and 10.4 s cold) is larger than the
difference 0036 makes; no PGlite hook neared its 120 s guard.

## Checkpoint D

Migration `0036` regenerated (drizzle-kit, header and hand-written tail restored) with
`account_exports` and the watchlist sources' `last_validated_at`, `validated_by`, `last_full_check_at`,
`last_etag` and `last_modified`; the `account-export` queue, worker and producer; the export and UN
opt-in routes frozen at 501 with the OpenAPI snapshot; the deletion hooks (both redaction cascades,
the C16 pass) and the validator hook (`sync.ts`). Plan amendments 5-10 of "Workflow 11B Stage 1b
amendments (foundation-11b)" (`22312774c`).

Stubs `d0b08fd8b`: `jobs/account-export-queues.ts` (mine; enqueuing nothing), `jobs/account-export/process.ts`
and `services/account-export/hooks.ts` (dsar-export's), `watchlists/conditional.ts` (ingestion-11b's),
`routes/server/account-exports.ts` (dsar-export's) and `routes/dashboard/watchlist-opt-in.ts`
(ingestion-11b's), unregistered, and the worker's `accountExport` option type.

### RED (`927f83415`), load 17.20 -> 13.60

```
$ cd apps/api && pnpm exec vitest run src/foundation-11b-d.test.ts --coverage.enabled=false
 Test Files  1 failed (1)      Tests  14 failed | 3 passed (17)
  × POST /api/v1/accounts/acc_.../export answers 501      (404 No route matches)
  × lists the four routes in the OpenAPI document
  × answers 501 for an admin, 401 without a session, and 400 for another source   (404)
  × enqueues ids only, the export’s id as the job id, one attempt     (expected [] ...)
  × starts with its options, and its job fails loudly until dsar-export builds it  (undefined)
  × services/redaction.ts calls accountExportHooks.subjectRedactedInTx(   (expected +0 to be 2)
  × watchlists/sync.ts calls checkSourceConditionally(
  (the three stub cases pass by design)
$ cd packages/db && pnpm exec vitest run src/migration-0036.test.ts src/schema-v2.test.ts \
    src/testing.test.ts src/repositories/key-rotation.test.ts --coverage.enabled=false
 Test Files  4 failed (4)      Tests  6 failed | 203 passed (209)
  error: relation "account_exports" does not exist
  error: column "last_validated_at" does not exist
```

`tsc --noEmit` (apps/api, heavy slot): the only errors were `services/retention.test.ts` (the report
key, held back to the GREEN) and ingestion-11b's `watchlists/conditional-policy.test.ts`.

### GREEN (`747da78dc`; fix `36206021c`)

The GREEN corrected three of my RED tests, each in the same commit: the table list's order
(`account_exports` sorts after `account_actions`), the check Postgres names first for a ready export
without its object (`account_exports_object_while_ready`, so the times case supplies the object), the
creator-type case (a duplicated column), and the worker case (the worker strips a failure's data, so
it asserts the rejection, not its message).

```
$ cd packages/db && pnpm exec vitest run src/migration-0036.test.ts --coverage.enabled=false
 Tests  12 passed (12)
$ cd apps/api && pnpm exec vitest run src/foundation-11b-d.test.ts src/services/context.test.ts \
    src/services/retention.test.ts src/retention-run.test.ts src/services/redaction.test.ts \
    src/watchlists/sync.test.ts src/watchlists/download.test.ts src/worker-connect.test.ts \
    src/worker.test.ts --coverage.enabled=false      (load 26.94 -> 24.83)
 Test Files  9 passed (9) after the worker case's fix      Tests  176 passed
$ pnpm --filter @openverify/api openapi:write (three runs, the last two identical)
$ probe (api Testcontainers project, alone): 2 passed, 25 s (load 5.58)
$ pnpm --filter @openverify/watchlist benchmark:typecheck   exit 0
$ pnpm --filter @openverify/watchlist benchmark:test        119 passed
```

The probe first failed on `POST /api/v1/accounts/{id}/export` (a seeded `acc` family answering
501 to both ids): `FROZEN_OPERATIONS` lists it apart while it answers 501 to both (amendment 10).

### Gate: D (rule 24)

| Call                                    | Wall                                                                                                                     | Load before / after | Result                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------- |
| db unit (turbo)                         | 202 s                                                                                                                    | 2.47 / 13.38        | exit 0: 2,333 passed in 163 files                        |
| API shards 1-3 of 12                    | 232, 290, 765 s                                                                                                          | 11.70 to 39.13      | shard 3 passed 10 minutes at load 40: K doubled (rule 8) |
| API shards 1-24 of 24 (fresh directory) | 449, 240, 205, 209, 360, 290, 221, 230, 299, 252, 142, 147, 186, 132, 151, 152, 185, 212, 203, 151, 159, 197, 222, 265 s | 16.92 to 39.21      | (a lone shard exits 1)                                   |
| API merge                               | 493 s                                                                                                                    | 32.76 / 28.38       | 10,746 passed, 23 failed in 839 files; 94.06% statements |
| integration db                          | 260 s                                                                                                                    | 31.12 / 38.22       | 105 passed                                               |
| integration graph                       | 134 s                                                                                                                    | 38.22 / 32.89       | 13 passed                                                |
| integration api 1, 2, 3 of 3            | 303, 487, 238 s                                                                                                          | 26.18 to 40.20      | 121; 125 and 1 failed; 185 and 5 failed                  |

The merge's 23 failures: one was mine, `kek-rewrap.test.ts`'s resume case, which expects the first
rewrap table to be `accounts` (fixed by `36206021c`, 17 of 17, and `key-rotation.test.ts` 3 of 3);
the other 22 are other agents' RED tests committed while they build, outside my paths (rule 24):
dsar-export's `services/account-export/{store,hooks}.test.ts` and `routes/server/account-exports.test.ts`
(12), ingestion-11b's `watchlists/conditional.test.ts` (9), and `routes/dashboard/foundation-11b-a.test.ts`'s
end-sessions 501 case, which auth-sessions' GREEN (`f9de86055`) outdated and whose owner removes it.
The integration failures are dsar-export's `account-export.integration.test.ts` (5, RED `1c724a655`)
and ingestion-11b's `conditional.integration.test.ts` (1, RED `5459ba818`). The 80% gate holds.

**10-minute check:** at load 33 to 40, one API shard of 12 took 765 s, past the cap, so the API unit
suite runs in 24 shards while the six Stage 2 agents' suites run (longest 449 s); the integration
calls still fit (longest 487 s). Recorded as plan amendment 2.

### PGlite migration time after D

Cold 6,116 and 1,247 ms, warm 1,533 and 1,285 ms (load 2.55 -> 2.73): within the noise of (A)'s.

## Checkpoint P

Migration `0036` regenerated with `queue_slots` (Phase 8's slot rows moved to its `workflow-step`
queue, `workflow_environment_slots` dropped), `admitted_at` on every capped queue's rows, the
migration role's two `SECURITY DEFINER` functions and the delete guards of `audit_logs` and
`connect_share_policies`; the admitted producers; the ceiling's pass-through; `GET /ready` frozen at 501. Plan amendments 11-17 (`23961817f`).

Stubs `655010315`: `services/quotas/admit.ts` (`admitOnProduce`, quotas') and
`jobs/admitted-producers.ts` (mine; passing through).

### RED (`0dc8f14ea`, then `0cd1254cb` for `/ready`), load 21.36 -> 16.90

```
$ cd apps/api && pnpm exec vitest run src/foundation-11b-p.test.ts src/workflows/engine/sweep.test.ts --coverage.enabled=false
 Test Files  2 failed (2)      Tests  11 failed | 12 passed (23)
  × enqueues an admitted verification’s job, and holds one the cap does not admit
  × container.ts builds both producers behind the hook
  × admits a verification at once and stamps its admitted_at with the clock   (column "admitted_at" does not exist)
  × runAuditLogRetention deletes through openverify_delete_expired_audit_logs, never directly
  × holds an environment at its cap, and a completion pulls the next   (relation "queue_slots" does not exist)
$ cd packages/db && pnpm exec vitest run src/migration-0036.test.ts src/testing.test.ts \
    src/phase8-engine-tables.test.ts src/repositories/workflow-engine-repositories.test.ts --coverage.enabled=false
 Test Files  4 failed (4)      Tests  8 failed | 197 passed (205)
$ cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/delete-guard.integration.test.ts   (28 s, load 14.73)
 Tests  2 failed | 1 passed (3)
  error: function openverify_delete_expired_audit_logs(unknown, unknown, integer) does not exist
  × refuses the runtime role’s own deletes ... (no guard: the delete succeeds)
$ (the /ready case) Tests  1 failed | 6 passed (7)   (no route)
```

### GREEN (`eb96a38ae`, `ff7a4a13b`, `517debbe9`)

drizzle-kit generated `queue_slots` while the schema still declared the old table; the old table was
then removed from the schema and from `meta/0036_snapshot.json`, and the copy and `DROP` are
hand-written; a second `drizzle-kit generate` answers "No schema changes, nothing to migrate".

```
$ cd packages/db && pnpm exec vitest run src/migration-0036.test.ts src/testing.test.ts \
    src/phase8-engine-tables.test.ts src/repositories/workflow-engine-repositories.test.ts \
    src/schema.test.ts src/schema-v2.test.ts --coverage.enabled=false      (load 21.71)
 Test Files  6 passed (6)      Tests  378 passed (378)
$ cd packages/db && ... --config vitest.integration.config.ts src/delete-guard.integration.test.ts \
    src/repositories/workflow-steps-rotation.integration.test.ts      (57 s, load 22.54 -> 26.59)
 Test Files  2 passed (2)      Tests  6 passed (6)
$ cd apps/api && pnpm exec vitest run src/foundation-11b-p.test.ts src/workflows/engine/sweep.test.ts \
    src/jobs/records.test.ts src/services/access/audit-maintenance.test.ts src/container.test.ts src/worker.test.ts
 117 passed after the stamp case compared ISO text (a raw execute answers the time as text)
$ tsc --noEmit (apps/api; packages/db) exit 0; eslint on every touched file exit 0
$ openapi:write three times, the last two identical (the /ready path, 47 lines)
```

`apps/api/src/jobs/records.test.ts`' full verification row gained `admittedAt: null` (rule 12).

### Gate: P (rule 24)

| Call                         | Wall                                                                                                                     | Load before / after | Result                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| db unit (turbo)              | 704 s                                                                                                                    | 20.30 / 26.97       | exit 0: 2,344 passed in 164 files; **past the 10-minute cap** at load 27 (it ran on in the background): the final gate runs db in two blob shards |
| API shards 1-24 of 24        | 443, 339, 238, 294, 504, 507, 487, 472, 415, 559, 432, 472, 499, 395, 289, 277, 327, 380, 396, 262, 139, 216, 272, 189 s | 19.69 to 47.85      | (a lone shard exits 1)                                                                                                                            |
| API merge                    | 303 s                                                                                                                    | 34.57 / 16.42       | 10,760 passed, 18 failed in 843 files; 93.97% statements                                                                                          |
| integration db               | 232 s                                                                                                                    | 24.03 / 45.43       | 110 passed                                                                                                                                        |
| integration graph            | 150 s                                                                                                                    | 45.43 / 35.54       | 13 passed                                                                                                                                         |
| integration api 1, 2, 3 of 3 | 245, 505, 259 s                                                                                                          | 32.91 to 40.90      | 114 and 1 failed; 133; 193                                                                                                                        |

The merge's 18 failures, none in what this checkpoint changed: five of my own frozen-route cases
outdated by their owners' GREENs while the shards ran (dsar-export's export routes, 4, removed from
`foundation-11b-d.test.ts` by `f439395ee`, 9 of 9; platform-ops' `/ready`, which its owner removed
with its GREEN `3c3112275`); auth-sessions' end-sessions case (its owner updated it); quotas' RED
`services/quotas/queue-rows.test.ts` (6) and dsar-export's `services/account-export/admission.test.ts`
(3); ingestion-11b's CPU budgets in `operator-patterns.test.ts` (2, at load 40); and
`services/graph/synthetic.test.ts` timing out at 60 s at load 40 (Phase 7's benchmark builder, not
in my paths; reported, not retried). The integration failure is quotas' RED
`services/quotas/admission.integration.test.ts` (`64c32d8e9`, twenty racing producers against the
stub that admits all). The 80% gate holds (93.97%).

**10-minute check:** at load 20 to 48 the longest API shard of 24 took 559 s and integration api 2
took 505 s, both inside the cap; the db unit suite in one call did not fit (704 s).

## Checkpoint snapshot

`pnpm --filter @openverify/api openapi:write` after checkpoint P (twice in `517debbe9`, the second
identical) and again on the final tree: `git diff --exit-code docs/api/openapi.json` exit 0. The
snapshot last moved with (P)'s `/ready` (`517debbe9`); (A)'s SSO and end-sessions routes moved it in
`308ceeb20` and (D)'s export and UN opt-in routes in `747da78dc`. Owners' GREENs since then moved it
with their own routes.

## Final gate (rule 24, beside the six Stage 2 agents)

Run on the final tree (23:01-23:43). The API unit suite and `pnpm test:integration` are gate P's
runs (22:00-23:00): after them the only change in my paths was `foundation-11b-d.test.ts`
(`f439395ee`, run alone, 9 of 9); no source of mine changed.

| Call                                                                                             | Wall                      | Load           | Result                                                                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` (pnpm lock)                                                     | 3 s                       |                | exit 0; no lockfile or workspace change                                                            |
| `pnpm format:check`                                                                              | 462 s                     | 27.95 after    | exit 0                                                                                             |
| `pnpm turbo run typecheck --force --filter=@openverify/db --filter=@openverify/api` (heavy slot) | 282 s                     | 21.29 after    | exit 0                                                                                             |
| `pnpm turbo run lint --force --concurrency=1 --filter=@openverify/api` (4 GB heap, heavy slot)   | 720 s                     | 20.13 after    | exit 0; **past 10 minutes** at load 20 to 30 (it ran on in the background)                         |
| the same with `--filter=@openverify/db`                                                          | 333 s                     | 28.13 after    | exit 0                                                                                             |
| db unit, two blob shards and a merge (from packages/db)                                          | 241, 189 s, merge 5 s     | 25.54 to 32.73 | merge exit 0: 2,357 passed in 165 files, 89.88% statements                                         |
| API unit, 24 shards and a merge (gate P)                                                         | 139 to 559 s, merge 303 s | 19.69 to 47.85 | 10,760 passed, 18 failed (other agents' RED and outdated owner cases, listed under gate P); 93.97% |
| integration db, graph, api 1-3 (gate P)                                                          | 232, 150, 245, 505, 259 s | 24.03 to 45.43 | 110, 13, 114 + 1 failed (quotas' RED), 133, 193                                                    |
| `benchmark:typecheck`, `benchmark:test`                                                          |                           |                | exit 0; 119 passed                                                                                 |
| `bash infra/tests/ci-workflow.test.sh`                                                           |                           |                | 411 passed, 0 failed, 0 skipped                                                                    |
| `bash infra/tests/compose.test.sh --static-only`                                                 |                           |                | 584 passed, 0 failed                                                                               |
| `openapi:write`, then `git diff --exit-code docs/api/openapi.json`                               |                           |                | exit 0                                                                                             |

**10-minute check (Rules, "Calls that fit 10 minutes"):** beside six agents at load 20 to 48, the API
unit suite needs 24 shards (one of 12 took 765 s), the db unit suite two blob shards (one call took
704 s) and the API's forced lint did not fit one call (720 s, 208 s at the 11A close). The
integration calls fit (longest 505 s). integration-11b, running alone, measures its own.
