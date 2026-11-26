# TDD evidence: Workflow 8B Stage 1a, `contracts-8b` (Phase 8)

- **Slice owner:** the Workflow 8B Stage 1a `contracts-8b` agent. Its first call ran alone, so it could touch any path its deliverables needed.
- **Date:** 2026-11-02 (call 1 of 2).
- **Base:** `367560b4`.
- **Input:** the "Stage 1a: contracts-8b" bullet of `docs/plans/phase-8.plan.md`, in its order. This call covers the re-verification, the inventory's section 13, Common and (C). The drift and the decisions are in the plan's "Workflow 8B Stage 1a amendments (contracts-8b)". Call 2 adds (Q) and (F) beside `foundation-8b`'s (C) checkpoint.

Each change follows the same cycle:

1. **Stub** (`chore`). When a test needs a name that does not exist yet, a stub adds it first, so the RED commit compiles and typechecks.
2. **RED** (`test`). The test runs and fails for the intended reason.
3. **GREEN** (`feat`). The smallest change that passes it.

Every value in these tests and fixtures is synthetic. Every command ran after `source scripts/env.sh`, and each output below is cut to the lines that matter.

## Checkpoint commits

| Group | Commits |
|---|---|
| Re-verification and the inventory | `9641ab2e` |
| Common: ids (C129.1) | RED `4dcc8877`, GREEN `79f12efb` |
| Common: scopes and roles (C129.4) | RED `2c9ea00f`, GREEN `570652f4` |
| Common: a key's `case-template-ids` (C129.4, P14) | stub and RED `35026415`, GREEN `2ea55f65` |
| Common: problems (C129.7) | stub `49e99b32`, RED `973bfef2`, GREEN `96a00d8b` |
| Common: `temporal-polyfill` in `apps/api` (V14) | RED `0d20c4b2`, GREEN `952b47e3` |
| Common: `case-action` as a run's creator, `0028_phase8b` | RED `bb2b2f80`, GREEN `81243b8f` |
| Common: the four case rate-limit policies (C143.3) | RED `8bb798da`, GREEN `8112fbcf` |
| Common: the recurring filter's comment | `8e4534cb` |
| Common: the log rule's folders (C143.5) | RED `09c4ee95`, GREEN `aabd4da9` |
| **Common checkpoint** | **`aabd4da9`** |
| (C): core vocabularies and the case field subset | stub `28eb3929`, RED `77b96632`, GREEN `bac3faf4` |
| (C): contracts, events, fixtures, samples, dashboard, Android, OpenAPI | stub `bbdf5adc`, RED `d49043a0`, GREEN `0b606696` |
| (C): `@openverify/node` groups (F34) | stub `84848494`, RED `0e628432`, GREEN `92fed4c3` |
| (C): the case action contracts (C140.3, F33) | stub `b43398d6`, RED `72a5878f`, GREEN `8cfdcd30` |
| (C): the case actions' step errors | RED `c4d96cc2`, GREEN `8aab06df` |
| (C): the graph `create-case` bulk action (C140.6) | RED `e46d87c4`, GREEN `c0dec640` |
| (C): what the forced lint refused in the new tests | `83775f18` |
| **(C) checkpoint** | **`83775f18`**, then this record |

## Common

### Ids (C129.1)
```
$ (cd packages/contracts && pnpm exec vitest run src/ids.test.ts --coverage.enabled=false)   × maps every C1 object to its prefix   Tests  1 failed | 51 passed (52)
$ (cd packages/db && pnpm exec vitest run src/ids.test.ts --coverage.enabled=false)          × holds the Workflow 8B prefixes, as the contracts table does (C129.1)   Tests  1 failed | 4 passed (5)
GREEN: 81 passed (ids and decisions, contracts); 5 passed (db). contestRouteSchema reads idSchema('ctmpl').
```

### Scopes (C129.4, decision 68)
```
RED  core permissions.test.ts: 5 failed | 23 passed (28)  (the list, developer, reviewer, export and redaction holders, viewer reads)
     contracts vocabulary.test.ts: × lists the scopes the server API enforces
     dashboard permissions.test.ts: × orders the areas ... (Cases)
GREEN core 28 passed; contracts 431 passed (vocabulary, fixtures, roles); dashboard operators 77, roles pages 32 passed.
```
The dashboard's `REVIEWER_PERMISSIONS` list is typed `Permission[]`, so its new entries went in with GREEN: in the RED commit they would not have typechecked.

### A key's `case-template-ids` (C129.4, P14)
```
RED  api-keys.test.ts: 3 failed | 22 passed (25)
GREEN 25 passed
```

### Problems (C129.7)
```
RED  fixtures.test.ts: ENOENT problems/cases/... (25 failing tests)
GREEN fixtures.test.ts: 431 passed
```

### `temporal-polyfill` 1.0.5 in `apps/api` (V14)
```
RED  dependencies.test.ts: × gives the API the polyfill for business time, through the catalog   1 failed | 11 passed
$ flock /tmp/openverify-pnpm.lock pnpm install     -> lockfile +3 lines, no minimumReleaseAgeExclude, no build script
GREEN 12 passed
```

### `case-action` as a run's creator, migration `0028_phase8b`
```
RED  core vocabulary.test.ts: 1 failed; contracts workflow-runs.test.ts: 1 failed;
     db migration-0028.test.ts: × takes case-action as a creator, with a cact_ id
       (violates check constraint "workflow_runs_creator_valid")
$ pnpm --filter @openverify/core build && (cd packages/db && pnpm exec drizzle-kit generate --name phase8b)
     -> 0028_phase8b.sql: drop and re-add workflow_runs_creator_valid with 'case-action'
GREEN migration-0028 and -0027: 6 passed; core 11; contracts 48; apps/api tsc rc=0
```

### Rate limits (C143.3, review-8b R15)
```
RED  contracts rate-limits.test.ts: 2 failed | 6 passed; api plugins/rate-limit.test.ts: 1 failed | 17 passed
GREEN 25, 18 and dashboard integrations 88 passed
```

### The log rule (C143.5)
```
RED  config eslint-phase5.test.ts: 16 failed | 157 passed (173)
GREEN 173 passed
```

## (C)

### Core: vocabularies and `caseFieldSchemaProblems`
```
RED  (cd packages/core && pnpm exec vitest run src/cases)   16 failed | 1 passed (17)
GREEN 17 passed. version-rules.ts now exports fieldSchemaProblems, the field half of a version's rules.
```

### Contracts
The schemas were drafted first and then held back, so the RED run is real. Stubs (`z.never()` and builders that throw) took their place in `bbdf5adc`, and the drafts went in with GREEN.
```
RED  (cd packages/contracts && pnpm exec vitest run --coverage.enabled=false)
       Test Files  8 failed | 79 passed (87)    Tests  109 failed | 3384 passed (3493)
       case-actions 7, case-comments 6, case-templates 15, cases 1 (the golden fails to read), events 18,
       fixtures 60, vocabulary 2, workflows 1
GREEN Test Files 87 passed; Tests 3553 passed. apps/api tsc rc=0, dashboard tsc rc=0,
      webhooks/samples.test.ts 141 passed, openapi:write twice (stable).
```
Changed with the plan: `process-government-id.test.ts` reads `status` through a cast, because a case comment (which has no `status`) joined the payload union. `vocabulary.test.ts`'s unknown-name example became `case.agent-reviewed`.

### `@openverify/node`
```
RED  resources.test.ts: 37 failed | 225 passed (262)  (TypeError: c.cases.update is not a function, ...)
GREEN 262 passed
```

### Workflow engine: the case actions
```
RED  cases.test.ts: 14 failed | 5 passed (19)
GREEN src/actions: 410 passed
RED  errors.test.ts: 12 failed | 11 passed (23)
GREEN 23 passed; workflow-docs:write regenerated docs/workflows/errors.md; reference-docs.test.ts 4 passed
```

### The graph's `create-case` (C140.6)
```
RED  core graph-queries.test.ts: 1 failed; contracts graph-queries.test.ts: 1 failed;
     api graph-query-routes.test.ts -t C140.6: AssertionError: expected 400 to be 200
GREEN core 4, contracts 24, api graph-query-routes 18, dashboard graph 141 passed; apps/api and dashboard tsc rc=0
```

## A slip, and how it was put right

The `contracts` RED run needed the drafts out of the tree. I copied them to `scratchpad/real/`, a folder an earlier agent of this Workflow's shared scratchpad already held. Restoring "every file under it" also wrote that agent's stale copies of eight tracked files: `account-actions.ts`, `workflow-actions.ts`, `workflow-definition.ts`, `workflow-runs.ts`, `workflow-trigger-view.ts`, `workflows.ts`, core's `workflows/vocabulary.ts` and the engine's `actions/registry.ts`.

The next typecheck caught it, before any commit. The fix was reversible: the stale diff was saved as `scratchpad/stale-overwrite.patch` and reverse-applied. The contracts suite then passed in full (3,553 tests), and `git diff` showed only my own work. Nothing of it reached a commit. Later swaps used folders of their own.

## Gates at the end of this call (run alone, at `eaa8344f`)

Each exit code was read from the command itself, never through a pipe.

| Gate | Result | Time and load |
|---|---|---|
| `pnpm install --frozen-lockfile`, `pnpm format:check` | rc 0, rc 0 | |
| `pnpm turbo run lint typecheck --force --continue` (heap 4 GB) | rc 0, 32 of 32 tasks | 259 s, load 2.8 to 6.1 |
| `pnpm turbo run test --force --continue --filter=!@openverify/api` | rc 0, 15 of 15 tasks. Core 1,234 tests at 99.86% statements, contracts 3,554 at 99.27%, workflow-engine 1,958 at 98.02%, node 433 at 98.48%, db 1,831 at 92.94%, dashboard 4,811 at 97.93% | 533 s, load 5.6 to 16 |
| API unit suite: two blob shards, then the merge | shards 372 s and 332 s; merge rc 0, 7,691 tests in 530 files, 95.08 / 86.17 / 96.8 / 95.16 | load 1.6 to 7.9 |
| `pnpm --filter @openverify/db test:integration` | rc 0, 69 tests in 15 files | 74 s, load 6.2 |
| `--project graph` | rc 0, 13 tests; the template built in 14.2 s, copied in 1.4 s | 30 s, load 10.4 |
| `--project api --shard=1/3`, `2/3`, `3/3` | rc 0 each: 73, 88 and 73 tests, 41 files | 46 s, 142 s and 59 s, load 5.9 to 14.5 |
| `./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests ...ContractFixturesTest` | rc 0, 88 tests, none skipped or failed (read from the XML) | 33 s, load 13.3 |
| `openapi:write` twice; `git diff --exit-code docs/api/openapi.json` | rc 0, rc 0, no diff | |
| `workflow-docs:write`; `git diff --exit-code docs/workflows` | rc 0, no diff | |

**Two tests failed once in a check before these gates, and passed in the gate.** A mid-call run of the forced non-API tests (rc 1, 558 s, load up to 13.5) failed two tests that this call does not touch:
- `packages/workflow-engine/src/code-runner/socket.test.ts`, "answers on the same connection": `expect.poll`'s 1 s default ran out while a child started;
- `apps/flow/src/steps/selfie-capture-step.test.tsx`, "takes each side pose once the head turned ...": `waitFor(onSubmitted)` ran out at the 10 s `asyncUtilTimeout`.

Each passed alone, and again under 48 busy loops on 12 cores at a load of 22. A probe ruled out the cause I suspected first: the "hold still" text was not left over from the previous pose. So neither failure was reproduced. They are not called flaky. They are reported to their owners (followups), with what is known.

# Call 2 of 2: (Q), then (F)

- **Date:** 2026-11-02 (call 2 of 2), beside `foundation-8b`'s (C) checkpoint.
- **Base:** `78ad06a0`. `foundation-8b` committed in the same range; every commit below is path-scoped and holds only this agent's files. `apps/api/src/ports.ts` was committed when it held no hunk of theirs.
- **Input:** the bullet's "(Q)" and "(F)" commit groups. The decisions are in this call's `contractDeviations`, for `integration-8b` to record as Stage 1a amendments; this call does not edit the plan.

The same cycle as call 1: stub (`chore`), RED (`test`), GREEN (`feat`). The drafts were written and run first, then held back in a scratch folder of this call's own (`c8b2/`, not one an earlier agent used), so each RED run is against the stubs.

## Checkpoint commits

| Group | Commits |
|---|---|
| (Q): core vocabularies, contracts, the case's SLA state, goldens, Android, OpenAPI | stub `6e882365`, RED `f7e83596`, GREEN `bd653284` |
| (Q): `@openverify/node` groups (F34) | stub `b43c39c5`, RED `1dd9014c`, GREEN `6308a21c` |
| **(Q) checkpoint** | **`6308a21c`** |
| (F): core vocabularies, contracts, the rendition schemas on both sides, `createRendition`'s signature and stub, goldens, Android, OpenAPI | stub `48c3f402`, RED `b3ba324d`, GREEN `75e0924b` |
| (F): `@openverify/node` (F34) | stub `a19f3594`, RED `fc6173e1`, GREEN `ad640f6c` |
| **(F) checkpoint** | **`ad640f6c`**, then this record |

## (Q): queues, assignment and SLA (C132, C133)

### Core and contracts
```
RED  (cd packages/core && pnpm exec vitest run src/cases --coverage.enabled=false)
       Test Files  2 failed | 1 passed (3)   Tests  6 failed | 16 passed (22)
       AssertionError: expected [] to deeply equal [ 'active', 'archived' ]   (queues.test.ts, 5;
       and vocabulary.test.ts "states every limit": a stub limit of 0)
     (cd packages/contracts && pnpm exec tsc --noEmit -p .)   rc 0
     (cd packages/contracts && pnpm exec vitest run --coverage.enabled=false)
       Test Files  6 failed | 84 passed (90)   Tests  20 failed | 3601 passed (3621)
       case-queues, case-policies, case-calendars: ENOENT contracts/fixtures/api/case-queue.json ...
       cases.test.ts: the SLA state, the PII list, the filter and include, assign, next (6)
       fixtures.test.ts: the six new goldens (13); vocabulary.test.ts: the resource types (1)
GREEN core 22 passed; contracts 3643 passed (90 files); apps/api webhooks/samples.test.ts and
      plugins/openapi-platform.test.ts 146 passed; eslint on every changed file rc 0;
      ./gradlew :openverify-sdk:testAndroidHostTest --tests ...ContractFixturesTest rc 0;
      openapi:write twice, the second identical: components CaseQueue, CaseAssignmentPolicy,
      CaseSlaPolicy, CaseCalendar and their Input forms, no path changed.
```
Changed with the plan: `cases.test.ts`'s record gains `slaState: 'running'` (its golden runs an SLA), the null-SLA test destructures `slaState` too, and the "refuses a member it does not declare" example became `priority`, because `sla-state` is now declared.

### `@openverify/node`
```
RED  (cd packages/node && pnpm exec vitest run src/resources.test.ts --coverage.enabled=false)
       Tests  20 failed | 262 passed (282)   Error: not built
GREEN 9 files, 453 passed
```

## (F): files, renditions and exports (C135, C138, F36)

### Core, contracts, the API's vision client and the vision service
```
RED  (cd packages/core && pnpm exec vitest run src/cases --coverage.enabled=false)
       Test Files  2 failed | 2 passed (4)   Tests  6 failed | 21 passed (27)
       AssertionError: expected [] to deeply equal [ 'pending', 'ready', 'failed', 'deleted' ] ...
     (cd packages/contracts && pnpm exec vitest run --coverage.enabled=false)   tsc rc 0
       Test Files  6 failed | 86 passed (92)   Tests  15 failed | 3660 passed (3675)
       case-attachments: TypeError: Cannot read properties of undefined (reading '0') (no golden
       attachment yet); case-exports: ENOENT case-export.json; cases.test.ts (F) 3; events.test.ts
       the filename rule 1; fixtures.test.ts the goldens and rendition_unavailable 9; vocabulary 1
     (cd apps/api && pnpm exec vitest run src/vision --coverage.enabled=false)
       FAIL src/vision/renditions.test.ts  Error: ENOENT ... contracts/fixtures/vision/rendition-image.json
     (cd services/vision && uv run pytest -q tests/test_schemas_renditions.py tests/test_contract_fixtures.py)
       12 failed, 31 passed (the stub models refuse every member; the goldens are missing)
GREEN core 27 passed; contracts 3692 passed (92 files); apps/api src/vision and
      webhooks/samples.test.ts 277 passed (5 files); vision 43 passed, ruff check and format
      clean, mypy src tools: no issues in 78 files; Android ContractFixturesTest rc 0;
      openapi:write twice, the second identical: CaseExport and CaseExportInput, no path changed.
```
`createRendition`'s stub test passes from the stub commit on, because the stub is the deliverable: it sends nothing and answers 501 `not_implemented`, as an unbuilt route does. `vision-renditions` replaces it and its test.

### `@openverify/node`
```
RED  (cd packages/node && pnpm exec vitest run --coverage.enabled=false)
       Tests  8 failed | 453 passed (461)   Error: not built
GREEN 9 files, 461 passed
```

### Two runs that did not count
- The first GREEN `openapi:write` pair: the second write exited 1, because `foundation-8b`'s uncommitted 8A joins left `actions/objects/table.ts` reading `CASE_OBJECT_ROWS` before it was defined while the app loaded. Nothing was written by it. Both writes were run again once their tree loaded, each exiting 0 and the second identical to the first; the committed snapshot is that pair's, and its only changes are the components named above.
- A RED typecheck of each family first failed in a test (an index of a stub's `any`, and an attribute the real schema did not yet declare). The tests were changed to read the golden through a cast before the RED commit, so each RED commit typechecks.

## The socket test of amendment 31, made deterministic

The forced non-API gate's first run in this call (rc 1, 591 s, load 4 to 14) failed one test outside this call's work, the one amendment 31 reported: `packages/workflow-engine/src/code-runner/socket.test.ts`, "answers on the same connection", `AssertionError: expected 1 to be 2 ... Matcher did not succeed in time`. Its wait was `expect.poll`'s 1 s default, while the evaluation it waits for runs in a child. 48 busy loops on 12 cores (load 39) did not reproduce it alone (3 runs, 32 passed each), so the gate run is the failing evidence. `008d877d` waits for the frames on their `data` event instead, bounded by the test's own 60 s guard: `dial()` returns `framesReach(count)`. The file then passed alone (32) and in the package's whole script (1,958 tests, 98.02% statements), and in the gate's second run.

## Gates at the end of this call

Run beside `foundation-8b`, whose work was moving in `apps/api` and `packages/db` until its last commit at `c85389bc`; the forced lint, the format check and the snapshot checks ran on that final tree. Each exit code was read from the command itself, never through a pipe; every output went to a file.

| Gate | Result | Time and load |
|---|---|---|
| `pnpm install --frozen-lockfile`, `pnpm format:check` | rc 0, rc 0 (and rc 0 again at the end) | load 1.7 to 2.6 |
| `pnpm turbo run lint typecheck --force --continue --concurrency=4` (heap 4 GB) | first run rc 1: 30 of 32, lint of `apps/api` and `packages/db` on `foundation-8b`'s case stubs only; at the end rc 0, 32 of 32 | 400 s at load 2.3 to 7.5; 377 s at load 3.6 to 7.1 |
| `pnpm turbo run test --force --continue --filter=!@openverify/api` | rc 0, 15 of 15: core 1,246 tests at 99.8% statements, contracts 3,692 at 99.3, node 461 at 98.53, workflow-engine 1,958 at 98.02, db 1,871 at 93.25, dashboard 4,811 at 97.93, checks 3,815 at 98.77, flow 1,103 at 95.48 | 590 s, load 11 to 17 |
| API unit suite, four blob shards and the merge | shards 367, 359, 201 and 181 s (each rc 1 on its partial coverage alone, no failed test); merge rc 0: 7,804 tests in 536 files, 94.9 / 86.21 / 95.97 / 95.01 | load 3 to 22 |
| `pnpm --filter @openverify/db test:integration` | rc 0, 69 tests in 15 files | 95 s, load 7 to 16 |
| `--project graph` | rc 0, 13 tests; the template built in 17.8 s, copied in 1.5 s | 35 s, load 11 to 15 |
| `--project api --shard=1/3`, `2/3`, `3/3` | rc 0 each: 73, 88 and 73 tests in 14, 14 and 13 files | 87 s, 324 s and 75 s, load 11 to 23 |
| `./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --rerun --tests ...ContractFixturesTest` | rc 0, 88 tests, none failed or skipped (from the XML) | 47 s, load 11.6 |
| `openapi:write` twice; `git diff --exit-code docs/api/openapi.json` | rc 0, rc 0, no diff | |
| `workflow-docs:write`; `git diff --exit-code docs/workflows` | rc 0, no diff | |
| `bash infra/tests/ci-workflow.test.sh` | rc 0, 219 passed | |
| `pnpm --filter @openverify/flow e2e` (under the e2e lock) | rc 0, 79 passed | 25 s, load 12.5 |
| A fresh stack: down and the build line, then `e2e:stack:up` | rc 0, rc 0 | 57 s; 129 s, load 17 to 19 |
| Full stack, `--shard=1/3`, `2/3`, `3/3` on that stack | rc 0 each: 38, 39 and 36 passed (113) | 205 s, 342 s and 258 s, load 4 to 18 |
| `e2e:stack:down` | rc 0; the stack's record was already gone, and the down removed no live holder | |
| Vision (this call changed its schemas): ruff check, ruff format, mypy | rc 0 each, 78 source files | |
| Vision pytest, in two calls with the coverage appended | first half rc 0, 1,476 passed (347 s, load 5 to 19); second half rc 1: 1,082 passed, 1 failed, total coverage 97.45% (439 s, load 11 to 14) | |

**The vision failure is outside this call's work.** `tests/test_pdf_measure.py::test_a_page_too_dense_to_judge_is_unprocessable` measured 12.1 s of CPU against its 10 s bound, run beside the other half's load; alone it passes in 3.15 s. Its bound is CPU time already, so the extra CPU is likely spent by worker threads that spin while they wait under contention. It goes to its owner (rule 6); this call did not touch it.
