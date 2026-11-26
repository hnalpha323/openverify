# Phase 11, Workflow 11A Stage 1b: `foundation-11a` (TDD evidence)

Plumbing only: the Connect tables in migration `0035_phase11_connect.sql`, repository stubs with their `*.cross-env.ts` twins, route plugins frozen at 501 behind the install switch, queues with `notBuilt` processors, the hooks that call each Stage 3 owner's stub, the import boundary, and the OpenAPI snapshot. Every timing below carries its 1-minute load average and its lock wait. Helpers live in this session's scratchpad (`f11/g.sh`, `f11/e2e.sh`, `f11/pglite.sh`, `f11/vision.sh`, with `gate.sh`, `api-shard.sh` and `gradle.sh` from Stage 1a).

## Checkpoint split (the measured validation split)

All calls in the main tree at `a089e66cf` (Stage 1a's end, Stage 1b's start), one at a time, foreground, each under its lock (lock wait 0 s on every call), with `connect-logic` running beside them. The table, the splits chosen and the reason for `a089e66cf` rather than the base are item 1 of "Workflow 11A Stage 1b amendments (foundation-11a)" in `docs/plans/phase-11.plan.md`. The commands, as run:

- PGlite: `flock -E 75 -w 240 /tmp/openverify-e2e.lock` around, twice, `OPENVERIFY_TEST_DB_CACHE_DIR=<empty dir> node --conditions=@openverify/source --import tsx --input-type=module -e "<createTestDatabase twice, timed>"` from `apps/api` (cold), then the same with the filled directory (warm). Output: `cold run 1 load=[0.19 1.00 2.01] first 5985 ms second 1898 ms`; `warm run 1 first 1302 ms second 2331 ms`; `cold run 2 first 6520 ms second 1105 ms`; `warm run 2 first 1226 ms second 1039 ms`.
- API: `cd apps/api && pnpm exec vitest run --coverage --coverage.reportsDirectory=/tmp/ov-f11-api-base/coverage-<k> --shard=<k>/8 --reporter=blob --outputFile=/tmp/ov-f11-api-base/blobs/blob-<k>-8.json` through `bash /tmp/openverify-heavy.sh` (slot 0 allowed), k = 1..8: rc=1 each (a lone shard's partial coverage, no failed test), 150, 199, 186, 186, 168, 152, 175, 165 s; merge `pnpm exec vitest run --merge-reports=/tmp/ov-f11-api-base/blobs --coverage --coverage.reportsDirectory=/tmp/ov-f11-api-base/coverage-merged` rc=0, 36 s: `Test Files 730 passed (730)`, `Tests 9728 passed (9728)`, `All files | 94.41 | 85.12 | 96.65 | 94.57`.
- Dashboard: `pnpm turbo run test --force --filter=@openverify/dashboard -- --coverage.reportsDirectory=/tmp/ov-f11-cov-dashboard` rc=0, 458 s (load 5.36 / 7.67), 581 files, 95.59%; two blob shards rc=1, 229 and 231 s, merge rc=0, 7 s, `Tests 6803 passed (6803)`.
- `pnpm turbo run test --force --filter=@openverify/watchlist --filter=@openverify/e2e --filter=@openverify/db` rc=0, 403 s (e2e 139, db 2,219, watchlist 820 tests); `--filter=@openverify/db` alone rc=0, 174 s; `--filter=@openverify/watchlist --filter=@openverify/e2e` rc=0, 279 s.
- The other 12 (`--filter='!@openverify/api' --filter='!@openverify/dashboard' --filter='!@openverify/watchlist' --filter='!@openverify/e2e' --filter='!@openverify/db' -- --coverage.reportsDirectory=coverage/f11-<name>`) rc=0, 177 s; `pnpm --filter @openverify/js test` rc=0, 5 s.
- `pnpm turbo run typecheck --force` rc=0, 142 s. `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint --force --concurrency=1` with `--filter=@openverify/api` rc=0, 203 s; `--filter=@openverify/dashboard --filter=@openverify/contracts` rc=0, 223 s; the other 14 rc=0, 321 s.
- `pnpm --filter @openverify/db test:integration` rc=0, 90 s, 83 passed; `--project graph` rc=0, 33 s, 13; `--project api --shard=<i>/3` rc=0, 77, 157, 90 s, 99, 103, 107.
- Android (after the three fetches, each "present"): `:openverify-sdk:testAndroidHostTest --rerun -PhostTestGroup=ui|flow|rest` rc=0, 151, 45, 98 s (rest 1,758, 0 skipped); `screenshotTest -Proborazzi.test.verify=true --rerun` rc=0, 51 s; calls (3) to (8), (10) and (11) rc=0 in 10 to 25 s each (up to date); `python3 -I -m unittest discover -s scripts/tests` `Ran 98 tests ... OK`; the three static checks rc=0, 13 s, `check-size: passed`.
- `pnpm --filter @openverify/flow e2e` (e2e lock) rc=0, 119 s, `332 passed (1.9m)`.
- e2e: down and `pnpm turbo run build --filter=@openverify/e2e^...` rc=0, 30 s; `e2e:stack:up` (`-w 120`) rc=0, 102 s; `--project=chromium --shard=<i>/4` rc=0: 279 s `48 passed`, 339 s `48 passed`, 289 s `49 passed`, 347 s `47 passed`; `--project=console-sweep --no-deps` rc=0, 301 s, `104 passed`; `:openverify-sdk:stackTest --rerun` (e2e lock outside, Gradle lock inside) rc=0, 45 s, two classes, each `tests="1" skipped="0" failures="0" errors="0"`; `e2e:stack:down` rc=0.
- Vision: `uv run ruff check && uv run ruff format --check && uv run mypy src tools` rc=0; `uv run pytest -q --cov-fail-under=0 <first 54 files>` rc=0, 186 s, `1260 passed`; the other 54 rc=0, 394 s, `1379 passed`.
- `infra/tests/*.test.sh`, one call each: `ci-workflow.test.sh` `# 409 passed, 0 failed, 0 skipped` (11 s), `compose.test.sh` 567 passed, the others passed except `flow-headers.test.sh`, `# 9 passed, 1 failed` on "the apps image openverify/apps:dev exists" (the image is not built on this host since the WSL restart).

Checkpoint commit: `22b7bf906` (`docs(plan,tdd): Workflow 11A foundation-11a checkpoint split ...`).

## Checkpoint C (connections and tokens)

**Database** (`packages/db`):
- RED `1fbb21b40`: `pnpm exec vitest run src/phase11a-connect-tables.test.ts --coverage.enabled=false` exit 1, `Tests 11 failed | 1 passed (12)`: `error: relation "connect_connections" does not exist`, `expected [ { table: 'accounts', …(2) }, …(84) ] to deep equally contain { table: 'connect_connections', …(2) }`, `expected 'undefined' to be 'function'`; `tsc --noEmit` and `eslint` exit 0 on the RED file.
- GREEN `453afd3a0`: `vitest run src/phase11a-connect-tables.test.ts src/schema-v2.test.ts src/repositories/key-rotation.test.ts src/migration-0034.test.ts` first `1 failed | 86 passed`: my RED test's failure-reason case updated an `expired` row, which the `_expired` check refused first; corrected to use a fresh token, then `12 passed`. `testing.test.ts`'s table list and `key-rotation.test.ts`'s seed changed with the tables (`138 passed` with the new test). The 0035 upgrade test's (C) case was written after the migration (no RED claimed): `4 passed`. The watchlist benchmark (rule 16, `packages/db/src/index.ts` re-exports changed): `pnpm benchmark:typecheck` exit 0, `pnpm benchmark:test` exit 0.

**The import rule** (`packages/config`):
- RED `8f44c0135`: `vitest run src/eslint-connect.test.ts` exit 1, `Tests 10 failed | 8 passed (18)` (no rule: every refusal case reported nothing).
- GREEN `ba8b748e0`: `vitest run src/eslint-connect.test.ts src/eslint-phase5.test.ts` exit 0, `193 passed`.

**API** (`apps/api`):
- RED `979d4138e`: `vitest run src/routes/connect-routes.test.ts src/routes/dashboard/connect.test.ts src/services/connect/cross-tenant.source.test.ts src/worker-connect.test.ts` exit 1, `Tests 39 failed | 1 passed (40)`: `No route matches GET /api/v1/connect/connections ... expected 404 to be 501`, `expected undefined to deeply equal { every: 60000 }`, `expected [] to deeply equal [ 'get', 'post' ]`; `tsc --noEmit` and `eslint` exit 0 on the RED files.
- GREEN `397bde957`: first `3 failed | 37 passed`: two of my RED tests reused one Idempotency-Key per URL, so the second POST to `/connect/connections` replayed the first answer (C12), and the peek case's path was shared by the policy; and the worker strips failure data, so the sweep fails as `NotImplementedError`. Corrected (a fresh key per call, an unshared path, the message read from `runConnectTokenExpiry` itself), then `47 passed` with `context.test.ts`; `value-lists.test.ts` 7 passed. `openapi:write` regenerated the snapshot (ten operations).
- Gate fix `0ac64acae`: the merged API run failed `redaction.test.ts > seeds every encrypted table except operator data` on the new sealed table; `CONNECT_AGREEMENT_TABLES` added; the shard holding it (1 of 12) re-run and merged again.

**Gates** (rule 23, beside `connect-logic`; lock wait 0 s; heavy calls through `/tmp/openverify-heavy.sh`):

| Call | Exit | Wall | Load before / after | Result |
|---|---|---|---|---|
| forced typecheck | 0 | 135 s | 0.96 / 5.40 | |
| forced lint api | 0 | 193 s | 5.40 / 1.55 | |
| forced lint, the other 14 (db, config) | 0 | 306 s | 0.49 / 1.56 | |
| db unit | 0 | 159 s | 2.53 / 9.19 | 2,232 tests, 90.86% |
| config unit | 0 | 4 s | 9.19 / 8.53 | 308, 97.22% |
| API, 12 blob shards | 1 each (partial coverage) | 100 to 136 s | 1.02 to 9.03 | |
| API merge (after `0ac64acae` and shard 1 again, 114 s) | 0 | 47 s | 8.42 / 4.45 | 9,775 in 735 files, 94.45% |
| integration db / graph | 0 / 0 | 88 / 32 s | 4.10 to 16.29 | 83 / 13 |
| integration api 1 of 3 | 1, then 0 | 91, then 89 s | 10.87 to 14.15 | `src/cache/index.integration.test.ts`: 3 failed (`MaxRetriesPerRequestError`, `Valkey is unavailable (reconnecting)`), then 99 passed |
| integration api 2 of 3 | 0 | 162 s | 14.07 / 8.33 | 103 |
| integration api 3 of 3 | 1, then 0 | 133, then 85 s | 6.71 to 15.10 | `src/services/otp/limits.integration.test.ts`: 8 failed (`expected { allowed: false, …(1) } to deeply equal { allowed: true }`), then 107 passed |
| `openapi:write`, `git diff --exit-code docs/api/openapi.json` | 0, 0 | | | |
| `bash infra/tests/ci-workflow.test.sh` | 0 | | | 409 passed, 0 skipped |
| PGlite after (C) (e2e lock) | | cold 5,247 and 5,242 ms; warm 1,242 and 1,217 ms | 6.20 to 8.16 | |

The two integration failures are in Phase 5 files 11A does not touch; their causes are not established (Stage 1b amendment 11). `pnpm exec prettier --check` passed on every file touched (with `--ignore-path=.gitignore` under `apps/api/src/services/`).

Checkpoint commit: `931da7f3a`.

## Checkpoint R (redemption and provenance)

- RED `1338280e6`: db `vitest run src/phase11a-connect-tables.test.ts` exit 1, `Tests 9 failed | 12 passed (21)` (`expected undefined to be 'jsonb YES'`, `expected [] to deeply equal [ …(9) ]`); api `vitest run src/services/connect/cloned-results.hooks.test.ts` exit 1, 9 of 11 failed (`column "provenance" ... does not exist` (42703), `Cannot find module '/src/services/connect/cloned-results.js'`, `expected '/**\n * C151.1-C151.3 ...' to contain 'countedVerifications('`); both typecheck.
- GREEN db `17f0d4bdf`: the columns in 0035 (regenerated): `vitest run src/phase11a-connect-tables.test.ts src/migration-0035.test.ts src/testing.test.ts src/schema-v2.test.ts` exit 0, 219 passed (the upgrade test's (R) cases written with it, no RED claimed); `benchmark:typecheck` exit 0.
- GREEN api `7efc92c7a`: the hooks. The whole-repo typecheck first failed on `src/jobs/records.test.ts` (fixture rows spelling out every column); the members added. `vitest run src/services/connect/cloned-results.hooks.test.ts src/services/inquiry-settlement.test.ts src/services/analytics/rollup-sql.test.ts src/jobs/records.test.ts src/flow-engine src/workflows/actions/objects` exit 0, `Test Files 15 passed`, `Tests 159 passed`.
- RED `8642756b2`: `vitest run src/worker-connect.test.ts` exit 1, `2 failed | 2 passed (4)` (`expected undefined to be defined`, `expected 'undefined' to be 'function'`). GREEN `a86a2e66c`: 4 passed; with `context.test.ts` and `container.test.ts`, 33 passed.

**Gates** (rule 23; lock wait 0 s):

| Call | Exit | Wall | Load before / after | Result |
|---|---|---|---|---|
| forced typecheck | 0 | 130 s | 1.32 / 6.00 | |
| forced lint api / the other 14 | 0 / 0 | 192 / 311 s | 1.34 to 6.00 | |
| db unit | 0 | 159 s | 1.34 / 8.93 | 2,243, 90.88% |
| API, 12 blob shards, then the merge | 1 each, merge 0 | 98 to 135 s, merge 47 s | 7.03 to 9.52 | 9,787 in 736 files, 94.44% |
| integration db / graph / api 1-3 | 0 each | 89 / 33 / 79, 162, 84 s | 3.53 to 16.07 | 83 / 13 / 99, 103, 107 |
| `openapi:write`, `git diff --exit-code` | 0, 0 | | | |
| `ci-workflow.test.sh` | 0 | | | 409 passed |
| PGlite after (R) (e2e lock) | | cold 5,432 and 5,325 ms; warm 1,249 and 1,232 ms | 6.74 to 8.55 | |

Checkpoint commit: `c3512dd32`.

## Checkpoint K (consent and the share-consent step)

- RED `f1762f351` (db): `vitest run src/phase11a-connect-tables.test.ts` exit 1, `8 failed | 20 passed (28)` (the tables, the sealed columns, the stubs and the twin do not exist). GREEN `ed8cb5066`: first `4 failed | 225 passed` across the db files: the (C) tests' tokens cited random record ids, which the new foreign key refuses; corrected so each token cites a record it inserts (`insertConsentRecord`), and the 0035 upgrade test's token too; then `28 passed`, and with the upgrade, table-list, schema and rewrap tests 233 passed. `benchmark:typecheck` exit 0.
- RED `2a80cf1e4` (api): `vitest run src/routes/connect-consent-routes.test.ts` exit 1, `23 failed (23)`. GREEN `8e199fbe5`: 23 passed; with `connect-routes.test.ts`, `services/connect`, the retention tests: 108 passed; with the OpenAPI, redaction, flow routes, flow engine, publish and template suites: `Test Files 67 passed`, `Tests 796 passed`. The mocked flow API's change has no test of its own (no screen calls the exits yet); the mocked suite below is its evidence.

**Gates** (rule 23; lock wait 0 s):

| Call | Exit | Wall | Load before / after | Result |
|---|---|---|---|---|
| forced typecheck | 0 | 144 s | 1.55 / 4.16 | |
| forced lint api / the other 14 | 0 / 0 | 189 / 319 s | 1.46 to 4.16 | |
| db unit | 0 | 169 s | 1.49 / 9.18 | 2,250, 90.75% |
| API, 12 blob shards, then the merge | 1 each, merge 0 | 103 to 144 s, merge 48 s | 6.74 to 10.18 | 9,810 in 737 files, 94.45% |
| integration db / graph / api 1-3 | 0 each | 119 / 38 / 98, 176, 91 s | 3.77 to 16.35 | 83 / 13 / 99, 103, 107 |
| mocked flow suite (e2e lock) | 0 | 135 s | 11.28 / 12.42 | 332 passed |
| `openapi:write`, `git diff --exit-code` | 0, 0 | | | |
| `ci-workflow.test.sh` | 0 | | | 409 passed |
| PGlite after (K) (e2e lock) | | cold 5,447 and 5,632 ms; warm 1,291 and 1,322 ms | 5.33 to 6.65 | |

Checkpoint commit: `02b04af94`.

## Checkpoint openapi (the snapshot and the whole gate)

The snapshot moved with each checkpoint's routes (Stage 1b amendment 10) and is current: `pnpm --filter @openverify/api openapi:write` exit 0, `git diff --exit-code docs/api/openapi.json` exit 0. The whole gate (orchestrator decision 20), lock waits 0 s:

| Call | Exit | Wall | Load before / after | Result |
|---|---|---|---|---|
| `pnpm install --frozen-lockfile` (pnpm lock) | 0 | 0 s | | lockfile up to date |
| `pnpm format:check` | 0 | 115 s | / 1.71 | all files |
| forced lint dashboard and contracts | 0 | 230 s | 1.58 / 1.85 | |
| dashboard, 2 blob shards, then the merge | 1, 1, merge 0 | 209, 233 s, 7 s | 1.85 to 6.97 | 6,803 in 581 files, 95.59% |
| watchlist and e2e | 0 | 295 s | 5.58 / 1.16 | 820, 139 |
| the other 12 packages, then `@openverify/js` | 0, 0 | 195 s, 5 s | 1.16 / 14.07 | |
| e2e: down and the build / `e2e:stack:up` | 0 / 0 | 33 / 108 s | 3.14 to 11.22 | |
| e2e: chromium shards 1-4 | 0 each | 257, 332, 302, 364 s | 1.62 to 2.66 | 48, 48, 49, 47 |
| e2e: console sweep / stackTest / down | 0 / 0 / 0 | 310 / 39 / 3 s | 1.70 to 2.91 | 104 / 2 classes, 1 of 1 each |

The forced typecheck, the lint of api and of the other 14, the db and API suites and the five integration calls ran at checkpoint K on the same code (item 21; `02b04af94` changed documents only).
