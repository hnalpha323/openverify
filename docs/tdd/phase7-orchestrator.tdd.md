# Phase 7: orchestrator fixes between Workflows

## 2026-10-31: closing Workflow 7A

The full validation of `ce772d10` (`bash resume/validate-full.sh`) passed every step except `test` and `e2e`. An independent script refresh, and the orchestrator's own triage of the 7A reports, found two more defects to fix before the push.

### Three tests that failed only under load

`pnpm turbo run test --force --continue` took 1,062 s and failed three tests of about 19,600. The load average reached 47 on 12 CPUs. Another project's containers started on the same machine during the run.

```text
@openverify/emrtd:test:  FAIL  src/testing/utopia.test.ts > generation time (C65.3) > builds a fresh RSA chip set (a 3,072-bit CSCA, a 2,048-bit DSC and AA key) within 10 seconds
AssertionError: expected 12956.371923 to be less than 10000
@openverify/watchlist:test:  FAIL  scripts/benchmark-identity.test.mjs > the identity steps' outputs (Workflow 6D review, calibration-6d amendment 4) > gives each CLI its own file name, so one --out directory holds both records
Error: Test timed out in 60000ms.
@openverify/api:test:  FAIL  src/openapi.test.ts > OpenAPI document > matches the committed snapshot (pnpm --filter @openverify/api openapi:write)
Error: Test timed out in 60000ms.
```

That run is the RED for all three. None needs a new assertion, because no behaviour was wrong. Each fix changes what the test measures or costs:

| Test | Cause | Fix | Commit |
|---|---|---|---|
| `packages/emrtd/src/testing/utopia.test.ts` | Two wall-clock budgets measured the machine | Both budgets (10 s and 2 s) read CPU time through `process.cpuUsage`, unchanged in size | `570f0851` |
| `packages/watchlist/scripts/benchmark-identity.test.mjs` | It runs two real child processes, under the 60 s hang guard | A 180 s hang guard on this test. It is not a budget | `9d97734e` |
| `apps/api/src/openapi.test.ts` | The file built the app three times, once per test and once in a hook | One `beforeAll` builds the app and renders the document once; every test reads the result | `08772f87` |

GREEN, each alone, at a load of 0.65 to 1.36:

```text
pnpm --filter @openverify/emrtd exec vitest run src/testing/utopia.test.ts --coverage.enabled=false
      Tests  8 passed (8)        Duration  1.96s
pnpm --filter @openverify/watchlist exec vitest run scripts/benchmark-identity.test.mjs --coverage.enabled=false
      Tests  11 passed (11)      Duration  5.48s
pnpm --filter @openverify/api exec vitest run src/openapi.test.ts --coverage.enabled=false
      Tests  13 passed (13)      Duration  10.38s
```

### One full-stack test failed by a stalled stack

`pnpm e2e` passed 94 of 95. `tests/selfie-repeat.spec.ts` failed because "Take a selfie" never appeared within 90 s. This was not a slow page:

- The page showed "The verification service is having trouble" on attempt 1 of the ID step.
- The trace shows the second ID upload took 35.4 s and answered 500, after the first took 18.0 s.
- `e2e/.artifacts/logs/api.log` has an `S3ServiceException` ("The service is unavailable. Please retry.") from the object store at 19:01Z, then two Valkey `Command timed out` errors at 19:02Z.
- Those are the API log's only errors. All six requests over 5 s fall between 18:58 and 19:03Z.

The Docker stack stalled for about five minutes. No code was changed for it. The re-run on a quiet machine passed 95 of 95. The cause of the stall is inferred, not proven: another project's containers were running, and its logs are not ours to read.

The flow behaved correctly during the stall: it showed an honest error and offered a retry. The test has no retry of its own, by rule.

### Nested env files entered the apps image

`.dockerignore`'s `.env.*` is rooted, unlike the same line in `.gitignore`, so `e2e/.env.e2e` (mode 0600, gitignored, 5,417 B, the throwaway e2e stack's seeded credentials) entered the build context, and `COPY . .` copied it into the image. The Phase 11 refresh found it. No image has been published.

RED (`c5359490`), after adding the paths to `infra/tests/apps-image-context.test.sh`:

```text
FAIL - the apps image context leaves out e2e/.env.e2e (included)
FAIL - the apps image context leaves out apps/api/.env (included)
# 41 passed, 2 failed
```

GREEN (`6639840d`): `**/.env`, `**/.env.*` and `!**/.env.example`.

```text
# 43 passed, 0 failed
$ docker run --rm --entrypoint sh openverify/apps:dev -c 'ls -la e2e/.env.e2e'
ls: cannot access 'e2e/.env.e2e': No such file or directory
```

### The flow headers contract in CI

RED (`c082b881`):

```text
FAIL - infra: runs bash infra/tests/flow-headers.test.sh --static-only
# 208 passed, 1 failed, 0 skipped
```

GREEN (`8ca4365c`): a step in the infra job.

```text
# 209 passed, 0 failed, 0 skipped
```

### The re-run

`validate-full.sh` tagged the apps image `openverify-apps:validate`, while the live half of `flow-headers.test.sh` reads `openverify/apps:dev`, so that half had been reading an 18-hour-old image. The script now applies both tags and runs `benchmark:test`.

The steps these changes could affect were re-run on `e8d93f55`: format, lint, typecheck, test, `benchmark:test`, OpenAPI, e2e, the apps image, infra and gitleaks. Every step answered rc=0, and infra printed no `FAILED`. The numbers are in `docs/PROGRESS.md`. Integration, vision, Android, the vision image and the benchmarks passed on `ce772d10`, and nothing they read has changed.

## 2026-11-01: closing Workflow 7B

Workflow 7B ended at `7d25d079` (two runs: `wf_1d1d87f2-ab4`, stopped by a usage limit, and the continuation `oc_mvxb21o2-e97f02`). The full validation of `7d25d079` (`bash resume/validate-full.sh`) passed every step except `integration`.

### Integration: one container per run never became reachable

`pnpm test:integration` ran three times. Each run failed exactly one file, a different one each time, before any of its tests ran; every other file passed (api 212 tests in 35 files, db 59 to 69 in 14 or 15):

```text
run 1  apps/api/src/services/locks.integration.test.ts   runMigrations: connect ECONNREFUSED 127.0.0.1:33748
run 2  apps/api/src/api.integration.test.ts              Port 33806 not bound after 120000ms (testcontainers HostPortWaitStrategy)
run 3  packages/db/src/db.integration.test.ts            Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle" (ECONNREFUSED)
```

Each of the three passes alone (`vitest run -c vitest.integration.config.ts <file>`: 8 and 10 tests). Twelve Testcontainers Postgres starts in parallel outside the suite all connected (21-28 s start, 21-120 ms connect), and plain `docker run -p` ports bound at once. Integration-7b ran the whole suite green on the same code inside the Workflow. The failure is the start of one container on this machine's Docker Desktop 29.7.2 (WSL2) under the suite's parallelism, not 7B's code. The validation is accepted on this evidence, and Workflow 7C gets known item `K7B-13`: one shared start helper that polls a real `select 1` and starts a fresh container when the port stays refused or unbound, with `afterAll` hooks that tolerate a `beforeAll` that never finished.

### CI: lint ran out of heap on the runner

CI run 41257053492 (the push of `919c95b3`) failed only the `node` job: `@openverify/contracts#lint` exhausted Node's default heap, about 2 GB on the 7 GB runner (exit 134), so its typecheck and unit tests never ran on GitHub. Reproduced locally:

```text
$ (packages/contracts) NODE_OPTIONS=--max-old-space-size=2048 pnpm exec eslint .
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
Exit status: 134
```

Peaks with a 6 GB heap (maximum resident set): lint api 3.35 GB, contracts 2.85 GB, dashboard 2.20 GB, db 1.79 GB, checks 1.65 GB; typecheck api 2.42 GB, dashboard 1.05 GB, contracts 0.90 GB. Two lint tasks together could pass 7 GB, so lint runs in a job of its own, one package at a time, under a 4 GB heap; typecheck stays in `node`, two at a time, under the same heap.

RED (`ea4a2668`), `infra/tests/ci-workflow.test.sh`: `# 207 passed, 7 failed` (the `lint` job, its install, its one-at-a-time command and heap, lint gone from `node`, typecheck's concurrency and heap). GREEN (`f2cf099e`), `.github/workflows/ci.yml`: `# 216 passed, 0 failed, 0 skipped`, actionlint clean. The push after 7B is the first CI run of the new job.

### nodemailer

`docs/tdd/c67-dependency-bumps.tdd.md`, 2026-11-01: 10.1.6, test-first (`5aba8ce8`, `a973e6ea`, `256d29af`).

### The integration suite's container starts and the graph build (K7B-13, decision 17)

A fourth run of `pnpm test:integration` failed `graph-engine.integration.test.ts`: `Hook timed out in 180000ms`. Its `beforeAll` built the 100,000-account graph (225,000 rows) under the suite's load. Both items were fixed before 7C.

**K7B-13: one start helper.** `startIntegrationPostgres` (`packages/db/src/integration-postgres.ts`, re-exported by `@openverify/db/testing`) does the following:

- It starts the pinned image with `POSTGRES_TEST_COMMAND` and a 60 s Testcontainers startup timeout (the default is 120 s), so a retry still fits the 180 s hook.
- It polls a real `select 1` through the mapped port, with backoff from 100 ms doubling to 2 s, for up to 60 s.
- When a start throws, or the port still refuses at the deadline, it stops that container and starts a fresh one, at most twice. Each retry is written to stderr with its reason, and URL credentials are masked.
- After three failures it throws one error naming every attempt.

`POSTGRES_TEST_COMMAND` moved into the helper's module, because a re-export cycle left the helper undefined under Vite's runner. The helper keeps per-caller options: `image`; `imageCommand: true`, used only by the log test's control; and `configure`, used for the watchlist benchmark's labels and reuse. All 45 integration files, `graph-benchmark.ts` and the watchlist `benchmark-postgres.mjs` start through it. Every `afterAll` closes only what its `beforeAll` made (`ifSet(pool)?.end()`). The convention test now requires `new PostgreSqlContainer(` only in the helper, and `imageCommand: true` only in the log control and the helper's unit test. No hook or test timeout changed.

RED (`65ee106e`):

```text
$ (packages/db) vitest run src/integration-postgres.test.ts
Error: Cannot find module './integration-postgres.js' imported from .../integration-postgres.test.ts
 Test Files  1 failed (1)
$ (packages/db) vitest run src/testing.test.ts -t POSTGRES_TEST_COMMAND
 × starts every Testcontainers Postgres of the repository through startIntegrationPostgres (K7B-13), which passes it
AssertionError: expected [ …(49) ] to deeply equal [ Array(1) ]   (the 47 files that built their own container, 2 scripts included)
```

GREEN (`a1fe8850`, `9264e3ac`): 15 of 15 targeted tests pass. The injected starter and connector cover these cases:

- One start throws, the next container's port stays refused, and the third answers. The second container is stopped, the backoff runs 100, 200, 400, 800 ms and so on up to 2,000 ms, and two retries are logged.
- Every attempt fails, and the helper gives up with `integration Postgres did not start after 3 attempts: attempt 1: no select 1 within 10 s: connect ECONNREFUSED 127.0.0.1:40001; attempt 2: start: (HTTP code 500) server error - ports are not available; attempt 3: ...`.

The other cases are no password in a log or error, a failed stop, the real `selectOne` against a closed port, the container definition (image, command, 60 s timeout, `configure`) and the convention test.

**Decision 17: the graph build moves to a template database.**

- **Template database.** The integration config splits into two Vitest projects. `api` holds every file but one. `graph` holds `graph-engine.integration.test.ts`, and its global setup (`apps/api/vitest.graph-template.ts`) runs only in a run that includes that file. The setup starts a container through the helper and migrates a database `graph_engine_template`. It builds the graph there with `buildSyntheticGraph` (same seed, kinds and accounts), marks the database `is_template true allow_connections false`, and provides its URI and environment. A 180 s guard still covers the build.
- **Hook.** The file's `beforeAll` now runs only `create database graph_engine_<random> template graph_engine_template`. The file keeps all 12 cases and adds a 13th: the copy holds the seeded email, phone, hub and IP keys `buildSyntheticGraph` writes for sampled accounts.
- **Concurrent build.** `buildSyntheticGraph` already used `INSERT ... SELECT generate_series` in 50,000-account transactions. Its cost is the indexes, checks and foreign keys of 325,000 rows: about 6 s per 50,000 accounts and 4 s per 50,000 graph rows, alone. Under the suite's load, one backend among dozens got a third of a CPU, so the build alone in the global setup still took 124 to 134 s. `buildSyntheticGraph` therefore gained `concurrency` (default 1, so the benchmark is unchanged): batches are independent, and each row is a function of `n`, the seed and the total. A concurrent build resumes from batch 0. The template is built as 8 batches of 12,500 at once.
- **Equivalence.** On PGlite, 2,000 accounts in 12 batches of 170, 4 at a time, give exactly the sequential build's accounts and rows (all 4,700, compared column by column). A concurrent build missing an earlier batch rebuilds it. The old sequential path stays, because the benchmark's resumable build uses it.

RED (`f314f114`, `5a22cd8c`):

```text
$ (apps/api) vitest run -c vitest.integration.config.ts src/services/graph/graph-engine.integration.test.ts
TypeError: Cannot read properties of undefined (reading 'accounts')     (no template provided)
$ (apps/api) vitest run src/services/graph/synthetic.test.ts
 × resumes a concurrent build from the first batch ...  expected { rows: 6300 } to deeply equal { rows: 7000 }
 × refuses a concurrency below one  promise resolved "{ accounts: 10, rows: 70, batches: 1 }" instead of rejecting
```

GREEN (`97b1fe47`, `49e6281b`): `synthetic.test.ts` 3 of 3 and `benchmark.test.ts` 1 of 1 pass. A run without the graph file (`locks`, `api`: 8 tests) builds no template.

Measurements (hook = the file's `beforeAll`; 12 CPUs, Docker Desktop 29.7.2, WSL2):

| | Alone | Under `pnpm test:integration` |
|---|---|---|
| Before (`d90eff26`): hook built the graph | 38.6 s | 139.9 s (earlier 146 s, 177 s, and one timeout past 180 s) |
| After: hook copies the template | 1.8 s, 3.9 s | 4.5 s, 5.3 s |
| After: template build in the global setup, sequential (`97b1fe47`) | 41.3 s | 134.4 s, 124.5 s |
| After: template build, 8 batches at once (`49e6281b`) | 20.2 s | 64.2 s, 69.8 s |

The two consecutive gate runs on `49e6281b` both answered rc=0. No `integration Postgres: ... starting a fresh container` line appeared in these runs or in the two runs on `97b1fe47`:

```text
run 1  db 15 files, 69 tests passed (110.5 s); api 36 files, 217 tests passed (293.0 s); graph-engine 13 tests 6.1 s; turbo 4m54.5s
run 2  db 15 files, 69 tests passed (122.2 s); api 36 files, 217 tests passed (308.2 s); graph-engine 13 tests 6.8 s; turbo 5m10.7s
```

The other gates on `49e6281b` all answered rc=0:

- `pnpm turbo run lint typecheck --force`: 30 of 30 tasks.
- `pnpm format:check`.
- `pnpm --filter @openverify/api test`: 435 files, 5,880 tests, 95.61% lines.
- `pnpm --filter @openverify/db test`: 100 files, 1,525 tests, 95.17% lines.
- `pnpm --filter @openverify/watchlist benchmark:typecheck`.

## Closing 7C: the test that needed a file CI does not have

CI run `41334061210`, `unit-api` shard 1, failed `custom-list.test.ts` "runs the fuzzy method a list allows" with 0 matches. `matchFirstNames` falls back to `loadMatcherData()`, which reads the generated `data/variant-groups.json`. No unit job builds that file, so the list read `probe_unavailable` there and the test passed here. The worker has the file, so this was a test-isolation defect, not a product bug. The custom-list job also had no way to take other matcher data, unlike the rescreen and watchlist jobs.

RED (`953be170`): `ReportJobDeps` gains an optional `matcherData`, the job does not read it yet, and a new test injects `{ status: 'missing' }`. Today's test could not be the RED, because it passes here. The handoff's `{ status: 'unavailable' }` is not a member of `MatcherData`; `missing` is.

```text
$ (apps/api) vitest run src/jobs/report-types/custom-list.test.ts --coverage.enabled=false
 × screens with the matcher data it was given, so a list it cannot read says so 28ms
AssertionError: expected [ { …(7) } ] to deeply equal []
Tests  1 failed | 10 passed (11)
```

GREEN (`770b5823`): the job passes `deps.matcherData?.()` to `matchLists`. The worker gives none, so it still loads the file. All 11 tests pass, and every run in the file now uses a synthetic matcher.

**The hidden-data sweep ran in a clean checkout, not by moving one file aside.** A detached worktree at `770b5823` holds tracked files only: `data/` has `malicious-feeds.json` and `manifest.json`, with no fetched file, no `variant-groups.json` and no `.env`. That is stricter than the plan's check, and the real `data/` was never touched.

```text
$ pnpm install --frozen-lockfile --offline && pnpm turbo run test --force --continue
Tasks:    15 successful, 15 total
Cached:   0 cached, 15 total
Time:     16m56.153s
api 443 files, 5,957 tests; dashboard 327, 4,775; checks 180, 3,791; contracts 72, 2,655; db 102, 1,534;
core 32, 1,186; flow 79, 1,096; watchlist 69, 819; config 3, 187; signals 23, 192; flow-spec 5, 117;
node 8, 320; emrtd 18, 318; e2e 15, 110; ui 8, 54
```

**Positive control.** The same checkout with the three files back at `3cd74e2a` reproduces CI's failure exactly, so the sweep can see this defect:

```text
$ (apps/api) vitest run src/jobs/report-types/custom-list.test.ts --coverage.enabled=false
 × runs the fuzzy method a list allows, with its score 52ms
AssertionError: expected [] to have a length of 1 but got +0
Tests  1 failed | 9 passed (10)
```

No other unit test depends on fetched data at `770b5823`. The sweep covers the test step only: it does not show that lint, typecheck or build pass without fetched data.
