# Phase 6: orchestrator fixes between Workflows

## 2026-10-28: three tests that timed out only with every package running at once

The full validation after Workflow 6A (on `3ac1fc84`) failed only its unit-test step (`pnpm turbo run test --force --continue`, 797 s), in three tests. Each had passed in the agents' own runs, and each was a 20 s test timeout:

```text
@openverify/watchlist:test:  FAIL  src/zip/reader.test.ts > openSingleMemberZip > opens a stored member, and members written with a data descriptor
Error: Test timed out in 20000ms.
@openverify/watchlist:test:  FAIL  src/zip/reader.test.ts > openSingleMemberZip > reads an archive from an open file
Error: Test timed out in 20000ms.
@openverify/dashboard:test:  FAIL  src/app/webhooks/[id]/edit/page.test.tsx > edit webhook page > offers the webhook's configuration to change
Error: Test timed out in 20000ms.
Failed:    @openverify/dashboard#test, @openverify/watchlist#test
```

Every other step passed: integration, vision, Android, OpenAPI, e2e, both images, the benchmark, infra and gitleaks.

### Cause: the cost is in the tests, not in the code under test

**Measured alone on a quiet machine** (load average about 2):

| Test | Alone |
|---|---|
| ZIP: a stored member and data descriptors | 1,923 ms |
| ZIP: an archive from an open file | 658 ms |
| Webhook edit page: "offers the webhook's configuration to change" | 1,496 ms |
| New webhook page: "offers the webhook form with every event and API version" (same pattern) | 1,687 ms |

Under the validation's load, every package's suite ran at once with many workers each, and these tests slowed more than tenfold.

**ZIP reader tests.** The reader inflates the 209 KB member in milliseconds. The time went to the test's own checks.
- `joined` spread each chunk into a JavaScript number array: 23 ms.
- `expect(bytes).toEqual(CONTENT)` then compared two 209 KB typed arrays element by element: 647 ms a comparison, measured with vitest's `expect` in Node.
- "A stored member and data descriptors" makes three such comparisons.

`Buffer.concat` takes 0.1 ms and `Buffer.compare` 0.3 ms on the same bytes.

**Webhook pages.** Phase 6 added 45 report events, so the form now renders 84 event checkboxes (490 elements). Each step was timed in a throwaway copy of the test (`*.verify-tmp.test.tsx`, deleted afterwards).
- A page-wide `getByRole('checkbox', { name: 'inquiry.approved' })` computes the accessible name of every checkbox: 1,014 ms on a fresh render, and about 500 ms on a later one.
- `getByLabelText` over the whole form costs 410–650 ms on each fresh render.
- Scoping to the event's group, `within(getByRole('group', { name: 'Inquiry' })).getByRole('checkbox', …)`, costs 133–158 ms.
- The other queries in the test cost 6–150 ms each.

### Change

The tests' coverage is unchanged.
- **ZIP reader** (`packages/watchlist/src/zip/reader.test.ts`):
  - `joined` concatenates with `Buffer.concat`;
  - a new `expectContent` checks the length and then `Buffer.equals`, so the comparison is still an exact byte-for-byte comparison.
- **Webhook pages** (`apps/dashboard/src/app/webhooks/[id]/edit/page.test.tsx` and `new/page.test.tsx`):
  - each event checkbox is found by role within its group (Inquiry, Account);
  - each test now also checks which group the event sits in.

The query stays role-based. Each changed line carries a comment with the reason.

### After

```text
$ (cd packages/watchlist && pnpm exec vitest run src/zip/reader.test.ts --coverage.enabled=false --reporter=verbose)
 ✓ opens a deflated member and streams exactly its bytes, in several chunks 14ms      (was 686ms)
 ✓ opens a stored member, and members written with a data descriptor 8ms             (was 1923ms)
 ✓ reads an archive from an open file 9ms                                             (was 658ms)
      Tests  8 passed (8)
$ (cd apps/dashboard && pnpm exec vitest run "src/app/webhooks/[id]/edit/page.test.tsx" src/app/webhooks/new/page.test.tsx --coverage.enabled=false --reporter=verbose)
 ✓ edit webhook page > offers the webhook's configuration to change 766ms           (was 1496ms)
 ✓ new webhook page > offers the webhook form with every event and API version 870ms (was 1687ms)
      Tests  10 passed (10)
$ (cd apps/dashboard && pnpm exec tsc --noEmit -p . && pnpm exec eslint "src/app/webhooks/[id]/edit/page.test.tsx" src/app/webhooks/new/page.test.tsx)
(no output)
```

The remaining time in the two page tests is the first render and the first queries of each test file. The unit-test step of the validation was run again after the change; its result is below.

```text
$ pnpm format:check; pnpm turbo run lint --force; pnpm turbo run typecheck --force; pnpm turbo run test --force --continue; gitleaks git --redact .
format rc=0 49s
lint rc=0 133s
typecheck rc=0 67s
test rc=0 752s   Tasks: 14 successful, 14 total; 17,030 tests passed
gitleaks rc=0    no leaks found, commits=2819
@openverify/watchlist:test:  ✓ src/zip/reader.test.ts (8 tests) 1253ms            (53198ms in the failing run)
@openverify/dashboard:test:  ✓ src/app/webhooks/new/page.test.tsx (4 tests) 7405ms
@openverify/dashboard:test:  ✓ src/app/webhooks/[id]/edit/page.test.tsx (6 tests) 5876ms  (22589ms in the failing run)
@openverify/watchlist:test: All files | 98.74 | 90.62 | 98.71 | 98.77
@openverify/dashboard:test: All files | 98.64 | 94.04 | 99.14 | 98.64
```

The other steps of the full validation (integration, vision, Android, OpenAPI, e2e, images, benchmarks, infra) passed on `3ac1fc84` and are untouched by these test-only changes.

## 2026-10-28: two failures that Workflow 6B's agents met outside their paths

Both were reported in the dashboard-reports agent's follow-ups after its final e2e run. Each passed on a re-run, so neither was a defect of the code under test, but each could fail a later validation or CI run.

### The API stopped when its startup reconciliation was slow

**Seen:** in one full-stack run, at a load average of 11, `api.log` read `watchlist sources not reconciled` 12 s after start, and the stack stopped with `OpenVerify API failed to start: A callback for onReady hook timed out`. The worker's reconciliation took 11 s at the same moment.

**Cause:** `apps/api/src/container.ts` reconciles the source rows (C76.4) in an `onReady` hook and awaits it. Fastify's onReady timeout (the plugin timeout, 10 s) turns a slow reconciliation into a failed start, although the hook's own comment says a failure is "logged, not fatal". The reconciliation is three small statements. Under that load they waited on I/O or on the worker's identical upsert, which takes the same row locks. The rows are not needed to serve: the stored rows keep working, and the worker reconciles too.

**Change:** ready waits at most `WATCHLIST_RECONCILE_READY_WAIT_MS` (5 s). After that it logs a warning, `watchlist sources still reconciling; the API is ready without them`, and lets the reconciliation finish in the background. A failure is still logged as before, and a synchronous throw is still caught. The timer is unreferenced and cleared.

**RED** (`67c2b01a`, the constant as a stub, unused). The test fakes `setTimeout` and gives a reconciliation that never settles:

```text
$ (cd apps/api && pnpm exec vitest run src/container.test.ts --coverage.enabled=false -t "watchlist sources at API startup")
 × is ready without waiting past its deadline for a slow reconciliation, and says so 104ms
AssertionError: expected false to be true // Object.is equality
 ❯ src/container.test.ts:284:21    expect(ready).toBe(true);
      Tests  1 failed | 2 passed | 15 skipped (18)
```

**GREEN** (`36215061`). The first attempt chained `.then` on the reconciliation's result, which three older tests leave `undefined` (`TypeError: Cannot read properties of undefined (reading 'then')`). An `async` wrapper with `try` keeps the old semantics:

```text
$ (cd apps/api && pnpm exec vitest run src/container.test.ts src/server.test.ts src/openapi.test.ts --coverage.enabled=false)
 Test Files  3 passed (3)
      Tests  43 passed (43)
$ (cd apps/api && pnpm exec tsc --noEmit -p . && pnpm exec eslint src/container.ts src/container.test.ts && pnpm exec prettier --check src/container.ts src/container.test.ts)
All matched files use Prettier code style!
```

### The API key expiry spec failed on a whole minute

**Seen:** `e2e/tests/ui-integrations.spec.ts` ("a developer creates an API key with an expiry…") failed with `locator.fill: Error: Malformed value`, filling `2026-10-28T09:14:00`.

**Cause:** `utcFieldValue` wrote seconds always. Chromium keeps a `datetime-local` value (step 1) without zero seconds, and Playwright's `fill` refuses a value the field does not keep. The expiry is "now + 30 s", so about one run in 60 fails. A probe against a bare `<input type="datetime-local" step="1">` in Playwright's Chromium (scratchpad, not committed):

```text
2026-10-28T09:14:00 -> locator.fill: Error: Malformed value
2026-10-28T09:14 -> filled, kept 2026-10-28T09:14
2026-10-28T09:14:30 -> filled, kept 2026-10-28T09:14:30
```

**Change** (`229948a7`, test only): `utcFieldValue` drops a `:00` seconds part. The same probe with the new helper:

```text
2026-10-28T09:14:00.412Z -> 2026-10-28T09:14 within 1 s: true
2026-10-28T09:00:00.000Z -> 2026-10-28T09:00 within 1 s: true
2026-10-28T09:14:30.999Z -> 2026-10-28T09:14:30 within 1 s: true
```

`tsc --noEmit`, ESLint and Prettier pass on the e2e package. The whole spec runs in the full validation after Workflow 6B.

### The C73.8 log check came back empty under load

**Seen:** in the full validation after Workflow 6B, `packages/db/src/postgres-logging.integration.test.ts` failed two of its three tests: the statement-logging test with `expected '' to contain 'select $1::text as name'` after its 10 s deadline, and the control with a 30 s test timeout. The machine was about three times slower than in the 6A validation then: the same file's migration tests took over 30 s where they had taken 9.5 to 10.4 s.

**Cause:** `logUntil` opened a new followed log stream for each try and dropped it after 500 ms. When Docker sends its first chunk later than the window, every window comes back empty, however long the deadline. The control also started its Postgres inside the test, so a slow container start counted against the 30 s test timeout and not the 180 s hook timeout every other container gets. A probe against a Testcontainers Postgres (scratchpad, not committed) shows the mechanism, on a quiet machine where the first chunk takes 8 to 9 ms:

```text
first chunk after 9 ms
first chunk after 9 ms
first chunk after 8 ms
window 1 ms x5: [ 0, 0, 0, 0, 0 ]
window 500 ms: true
```

**Change** (`b9ef8b82`, test only): `logUntil` reads one followed stream until the needle arrives, or for 20 s, inside the 30 s test timeout. An empty or late log still fails the check, as R003 requires. The control Postgres starts in `beforeAll`, next to the one under test.

```text
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/postgres-logging.integration.test.ts)
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  5.88s
$ (cd packages/db && pnpm exec eslint src/postgres-logging.integration.test.ts && pnpm exec prettier --check src/postgres-logging.integration.test.ts && pnpm typecheck)
All matched files use Prettier code style!
```

### Load turned into timeouts in the workspace-wide runs

**Seen:** the full validation after Workflow 6B failed other tests too, and a re-run of its unit and integration steps, with the load average sampled every 30 s, failed different ones:

| Run | Failed | Each one alone, or in earlier runs |
|---|---|---|
| Validation | emrtd: the fresh RSA chip set, 10.9 s against its 10 s budget | 3.2 s and 6.0 s in the two 6A runs |
| Validation | db: `createTestDatabase` twice in a `beforeAll`, past 60 s | the file takes 13 s alone |
| Validation | db integration: five tests past 30 s, one hook past 180 s | 9.5 to 10.4 s each in the 6A run |
| Re-run | flow: the business registration number test, past 20 s | 13.1 to 16.9 s in the earlier runs |
| Re-run | api: the dev seed's first test, past 20 s | 1.6 s alone; 16.8 to 18.4 s in the earlier runs |
| Re-run | db integration: the C34 lookups hook past 180 s, a migration 0018 test past 30 s | passed in the 6A run |

The re-run's unit step reached a load average of 52.8 on 12 CPUs (sampled from 11:04 to 11:13). The cost is not in these tests: run alone, they are fast. All 14 packages run at once through turbo, at half the CPUs each, so a test takes many times longer there than alone (1.6 s against 18.4 s for the dev seed). The integration configs set no worker cap: the db and api suites ran Vitest's default of 11 workers each, and each test file starts its own Postgres, so up to 22 containers migrated at once.

**Change.** The timeouts are hang guards, not assertions. They now cover the inflation measured here, and a hang still fails:
- the shared per-test and per-hook timeout goes from 20 s to 60 s (`TEST_TIMEOUT_MS`);
- the PGlite hooks of db and api go from 60 s to 120 s;
- both integration suites are capped at `TEST_MAX_WORKERS` (half the CPUs), like the unit suites;
- db's integration tests get a minute, as api's already had.

RED (`04206892`): `vitest.test.ts` expects 60 s, and `workspace-conventions.test.ts` expects each integration config to cap its workers and give each test a minute.

```text
$ (cd packages/config && pnpm exec vitest run src/vitest.test.ts src/workspace-conventions.test.ts --coverage.enabled=false)
       × caps its workers as the unit configs do, and gives each test a minute 11ms
       × caps its workers as the unit configs do, and gives each test a minute 4ms
     × gives each test and hook headroom for a workspace-wide parallel run 7ms
AssertionError: expected 20000 to be 60000 // Object.is equality
AssertionError: expected 'import { defineConfig } from \'vitest…' to contain 'maxWorkers: TEST_MAX_WORKERS'
 Test Files  2 failed (2)
      Tests  3 failed | 50 passed (53)
```

GREEN (`45fbf056`):

```text
$ (cd packages/config && pnpm exec vitest run src/vitest.test.ts src/workspace-conventions.test.ts --coverage.enabled=false)
 Test Files  2 passed (2)
      Tests  53 passed (53)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/postgres-logging.integration.test.ts)
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

ESLint, Prettier and `tsc --noEmit` pass on the touched files. The full validation then runs again.

### The watchlist repository split before Workflow 6C

`23eb8e49` is a refactor with no change in behaviour. It splits `packages/db/src/repositories/watchlists.ts` so that the 6C matcher and ingestion agents own separate files (the plan's "Workflow 6C", "Before it starts"):
- `watchlist-reads.ts`: the frozen reads;
- `watchlist-key-df.ts`: the key frequencies;
- `watchlist-rows.ts`: internal helpers;
- `watchlists.ts`: the sync's writes.

The sources page's two reads of the report tables move to `report-templates.ts` and `reports.ts`, with their tests in `report-repositories.test.ts`. The package's exports are unchanged; the index adds the two new public files.

Evidence that nothing changed:
- **The code moved verbatim.** A check that every top-level block of the old file appears unchanged in the new files, once the added `export` keywords are ignored, found 135 of 139. The other four are two dropped section dividers, and the two moved report-table reads. Those two now cast `db.execute`'s rows inline, as `report-rescreen.ts` does, instead of calling the watchlist helper.
- **The tests moved unchanged.** All 23 tests of the old test file appear unchanged once whitespace is ignored. The only renames are `query` to `candidateQuery`, from the shared setup module, plus the line wrapping that rename causes.

```text
$ (cd packages/db && pnpm exec tsc --noEmit && pnpm exec eslint src/repositories)
$ (cd packages/db && pnpm exec vitest run src/repositories/watchlists.test.ts src/repositories/watchlist-reads.test.ts src/repositories/watchlist-key-df.test.ts src/repositories/report-repositories.test.ts --coverage.enabled=false)
 Test Files  4 passed (4)
      Tests  34 passed (34)
$ (cd packages/db && pnpm test)
 Test Files  77 passed (77)
      Tests  963 passed (963)
All files          |   95.47 |     89.7 |   96.36 |   95.81 |
```

### The second validation: hook timeouts on the test database, and a report read that answered 500

The second full validation (on `ebd8b83c`) passed every step except four, each examined in turn:

| Step | What failed | Cause |
|---|---|---|
| Unit | four db test files, each with its own `beforeAll(…, 60_000)` | each test file built its test database by running every migration (below) |
| Integration | one api file: a container's port "not bound after 120000ms" | Docker Desktop's port forwarding; the db suite, now capped, passed all 12 files in 124 s (6A: 128 s) |
| Vision | two CPU-time budgets (5.09 s against 5 s, 13.7 s against 10 s) | the orchestrator's own db suite runs overlapped that step; never again during a validation |
| e2e | `ui-reports.spec.ts`: a poll of a report during its run answered 500, "has-match says whether some match is open" | a real race (below) |

#### The migrated test template on disk

`createTestDatabase` kept its migrated snapshot in module state. Vitest runs each test file in a fresh module, so every file ran every migration: 2 to 3 s alone, and past 60 s under the full validation's load. The template is now stored on disk, named by a SHA-256 of the migrations, the PGlite version and the extensions, and written atomically. A file that cannot be opened is rebuilt. The cache keeps the eight templates used most recently (each is about 45 MB), and drops partial writes abandoned for an hour.

RED (`6d1956f5` stub, `54aac178`):

```text
$ (cd packages/db && pnpm exec vitest run src/testing.test.ts --coverage.enabled=false -t "migrated template on disk")
     × stores the template the first file builds, named by a hash of the migrations 4196ms
     × opens the stored template in a new file instead of migrating again 3529ms
     × rebuilds a stored template it cannot open, and stores the new one 82ms
Error: migratedTemplatePath: not implemented
      Tests  3 failed | 48 skipped (51)
```

GREEN (`21349847`): `Tests 51 passed (51)`. The pruning: RED (`690c7841`):

```text
     × keeps the most recently used templates only, so changed migrations do not fill the disk 3173ms
     × marks a template as used when it opens it, so pruning keeps the ones in use 701ms
AssertionError: expected [ …(12) ] to deeply equal [ …(8) ]
AssertionError: expected 1793118310572 to be greater than 1793204651206
```

GREEN (`dfee3ffb`): `Tests 53 passed (53)`. The db package alone, coverage off, on a quiet machine. To disable the cache, the directory is put under `/dev/null`, where a recursive `mkdir` fails at once. Under `/proc`, Node's recursive `mkdirSync` spins forever, which first made this baseline look like a hang.

```text
$ OPENVERIFY_TEST_DB_CACHE_DIR=/dev/null/openverify-no-cache pnpm exec vitest run --coverage.enabled=false
 Test Files  77 passed (77)
      Tests  968 passed (968)
nocache wall 113.88 s
$ pnpm exec vitest run --coverage.enabled=false
      Tests  968 passed (968)
cached wall 50.75 s
```

#### A report resource from one snapshot

`reportResourceOf` received a report that its caller had read earlier, then read the matches in another statement, outside any transaction. A run that committed between the two reads left `has-match` false beside an open match, and the response schema's refinement answered 500. Every path that served a report did this: the single GET, the list, the console document, the sync creation, and the routes that serve a report after their own transaction. The resource is now built from one read-only repeatable-read transaction, which reads the report again with its matches and runs. Inside a caller's transaction it is a savepoint, and drizzle ignores the isolation level there.

RED (`5e52bf85`, `apps/api/src/jobs/report-types/matching-reports-db.test.ts`):

```text
     × serves a report read before its run completed as the run left it 165ms
     × reads the report and its matches in one read-only repeatable-read transaction 83ms
ZodError: [
    "message": "has-match says whether some match is open"
AssertionError: expected "transaction" to be called with arguments: [ Any<Function>, { …(2) } ]
      Tests  2 failed | 5 skipped (7)
```

GREEN (`3d3c7b1e`): the file passes, 7 tests. The report suites (`src/services/reports`, the report routes, `src/jobs/reports`, `src/jobs/report-types`, and the inquiry routes) pass 287 tests in 27 files. `tsc --noEmit` and ESLint pass.

## 2026-10-29: the shortcut equivalence test timed out at a full validation's load

**RED.** The full validation of the 6C head (`7ced006b`) failed only its unit step, on `packages/watchlist/src/match/shortcuts.test.ts`. With 14 packages testing at once, each preset's equivalence test took longer than its 60 s timeout:

```
× keep every created match identical at exact, each shortcut alone and all together 90591ms
× keep every created match identical at strict, each shortcut alone and all together 157143ms
× keep every created match identical at tolerant, each shortcut alone and all together 96122ms
× keep every created match identical at custom, each shortcut alone and all together 91410ms
Error: Test timed out in 60000ms.
Tests  4 failed | 606 passed (610)
```

Alone, at a load average of 1.7 to 2.4, the same tests took 5.0 / 13.1 / 17.3 / 17.0 s. Each test made eight screening passes: one without any shortcut, one per shortcut alone, and one with all of them. Every pass covers 540 subjects against 60 candidates. fix-6c had recorded the risk (the plan's "Workflow 6C review amendments", item 10).

**GREEN** (`22d76091`). The passes are split into separate tests:
- each preset's baseline (no shortcut on) is screened once and shared by that preset's tests, and the assertion that it creates matches is its own test;
- each shortcut alone, and all together, is a test of its own, which runs one pass and compares with the baseline;
- the shortcut state is restored in a `finally`.

The subjects, the presets, the comparisons and the other four tests are unchanged.

```
pnpm --filter @openverify/watchlist exec vitest run src/match/shortcuts.test.ts --coverage.enabled=false --reporter=verbose
Tests  36 passed (36)   (load 4.28 -> 4.95)
slowest: the tolerant baseline 3236ms; shared-matrix alone at tolerant 3064ms; "do less work" 3751ms
```

Every test now takes at most 3.8 s alone, against 17.5 s before, so a slowdown of the size measured at the validation's load stays well within 60 s. The file's total time is unchanged (about 70 s), because Vitest runs a file's tests in turn. Typecheck, eslint and prettier pass.

## 2026-10-29: two more tests that measured the machine, found by re-running the unit step

The unit step was re-run after the shortcut split (`22d76091`). The watchlist package passed (638 tests), but two other tests failed for the first time, in packages that had passed in the first run:

```
@openverify/checks: × compares a street line of 100 KB of doors after commas in bounded time (C58.7) 636ms
  AssertionError: expected 245.73469600000044 to be less than 200
@openverify/flow:   × makes its verification when the screen opens, to mark what every match group needs (C52.2)
  Error: expect(element).toBeRequired()  (business-forms.test.tsx took 157852ms for 23 tests)
```

Both bounds are wall-clock limits. On their own, the two tests take 48 ms and 218 ms.

**The C58.7 bound.** C58.7 bounds the work a capped input costs, so the test must not measure what other processes add. `packages/checks/src/document/testing.ts` already provides `cpuMilliseconds` for exactly this. A throwaway probe (deleted after use) measured the 100 KB case:
- quiet: 42.1 ms on the wall clock and 69.3 ms of CPU;
- beside 24 busy loops on 12 CPUs (load average about 24): 287.1, 264.5 and 196.6 ms on the wall clock, against 90.7, 101.9 and 89.1 ms of CPU.

The wall clock crosses the 200 ms budget; CPU time stays well under it.

GREEN (`9a36c7af`, `f7323c35`): both address bounds, and the 11 other C58.7 bounds in `packages/checks` that still used `performance.now()`, are measured with `cpuMilliseconds`, with their budgets unchanged. All 12 files pass, 347 tests, both quiet and beside the 24 busy loops.

**The async wait.** `waitFor` and `findBy*` poll with testing-library's default limit of 1 s of wall clock. GREEN (`7705737a`): `apps/flow/vitest.setup.ts` sets `configure({ asyncUtilTimeout: 10_000 })`. A condition that never holds still fails, after 10 s instead of 1 s, and no assertion changes. Beside the 24 busy loops, `business-forms.test.tsx` passes 23 of 23, and the test that failed took 1,053 ms, which the old 1 s limit would have failed.
