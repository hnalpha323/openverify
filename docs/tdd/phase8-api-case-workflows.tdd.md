# Phase 8, Workflow 8B Stage 3: `api-case-workflows`, first call

Base `a6fd616c` (foundation-8b's checkpoint (C)). Scope of this call: case actions and their routes,
the available actions and `run-action`, the case trigger (`triggerDocumentOf`, `objectIdFits`),
`current_case`'s provider, the case side of the human-step rule (`CASE_HOLDS_SUBJECT`), the case
row of the generic actions, the case template as a reference, the lift of
`contest_route_case_template_refused`, the review-request route, the review recipe, and the graph
explorer's "create case" bulk action. The eight case step implementations are the second call.

Every command ran after `source scripts/env.sh`, from the directory named. Outputs are abbreviated
to their summary lines; the full files are in the session scratchpad.

## Slice 1: the db side (`packages/db/src/repositories/case-actions.ts`, `case-references.ts`)

Stub commit `c8631fe2` (the new names reject with `CaseRepositoryNotBuiltError` naming
`api-case-workflows`), so the RED test compiles and typechecks.

RED `80020d60`, from `packages/db`:

```
$ pnpm exec vitest run src/repositories/case-actions.test.ts --coverage.enabled=false
 × creates one with its templates, reads, lists and updates it
 × offers a template its active actions, oldest first
 × names the templates this environment does not hold
 × opens its fields and names what it holds, newest first, with each kind's total
 × serves the newest 50 of a kind, and counts them all
 × reads a redacted case's fields as null
 × holds an object of any kind it was given, and a report of an inquiry
 × names the first inquiry and account it was given
 × reads an environment's active templates, by id and by name
CaseRepositoryNotBuiltError: createCaseAction is not built yet (api-case-workflows)
CaseRepositoryNotBuiltError: getWorkflowCase is not built yet (api-case-workflows)
AssertionError: expected [] to deeply equal [ 'case-template' ]
      Tests  9 failed (9)
```

GREEN `d00f03bd`:

```
$ pnpm exec vitest run src/repositories/case-actions.test.ts --coverage.enabled=false
      Tests  9 passed (9)
```

During GREEN, foundation-8b's checkpoint (Q) was mid-edit in the shared tree: `cases` gained the
SLA columns before its migration did, so `select()` of the whole row failed with `42703`. The
case read now names its columns one by one (`WORKFLOW_CASE_COLUMNS`), so a column a later
checkpoint adds is read only once this file names it. `case-plumbing.test.ts` (foundation-8b's) lost
`listCaseActionsForTemplate` from its "rejects until built" list, the one change the build makes.

## Slice 2: the case side of 8A's tables (`apps/api/src/workflows/actions/cases/`)

RED `a0fbbc5e`, from `apps/api`:

```
$ pnpm exec vitest run src/workflows/actions/cases/cases.test.ts --coverage.enabled=false
AssertionError: expected false to be true                   (caseObjectIdFits)
AssertionError: expected undefined to match object { type: 'case', ... }
AssertionError: expected [ 'current_case_unavailable' ] to deeply equal []
AssertionError: expected 'errored' to be 'completed'         (current_case at a run's start)
AssertionError: expected {} to deeply equal { ctmpl: 'case-template' }
AssertionError: expected [ { ...(3) } ] to deeply equal []     (contest_route_case_template_refused)
      Tests  14 failed (14)
```

GREEN `a389bea2`:

```
$ pnpm exec vitest run src/workflows/actions/cases/cases.test.ts --coverage.enabled=false
      Tests  14 passed (14)
```

Two corrections inside GREEN, each for a reason stated here:

- The RED test wrote its `case.resolved` event by SQL into `events.payload`, which is sealed
  (`encryptedJson`); the test now inserts through drizzle, so the payload is sealed as the publisher
  seals it.
- The review recipe's route compares the fetched case's `resolution` with `'Approved'` and
  `'Declined'`. The draft check refuses that with `pii_literal_in_condition`, because a fetched
  case reads as untyped personal data until `OBJECT_VIEW_NAMES.case` in
  `packages/workflow-engine/src/variables/scope.ts` (a shared file) names the case view. Comparing
  with a variable instead would only hide the rule, so the recipe is exported whole
  (`REVIEW_ON_REPORT_MATCH`) and held out of `CASE_RECIPE_ROWS`; the test now holds the draft
  check's only errors to those two comparisons. The one-line engine change is a contract deviation.

8A's `rules.test.ts` changed with the plan: "refuses a route that names a case template until
cases land" became "takes a route that names a case template beside its contact", and checks that
the template is a reference (`reference_unknown` for one the environment does not hold).

## Slice 3: the routes' services (`apps/api/src/services/cases/actions/service.ts`)

RED `b2b3ae7a`:

```
$ pnpm exec vitest run src/services/cases/actions/service.test.ts --coverage.enabled=false
AssertionError: {"title":"Not Implemented","status":501,"detail":"POST /case-actions is not built yet."...}: expected 501 to be 201
AssertionError: expected 501 to be 404
AssertionError: expected 501 to be 409
AssertionError: expected 501 to be 422
      Tests  13 failed (13)
```

GREEN `37c25409`:

```
$ pnpm exec vitest run src/services/cases/actions/service.test.ts --coverage.enabled=false
      Tests  13 passed (13)
```

`createCaseInTx` is `api-cases`' stub; the test replaces it with a fake that writes the case by SQL
on the template's published version, as `fakeCaseCreation` does without a row. The comment and
history repositories (`createCaseCommentRow`, `appendCaseHistory`) are `api-cases`' stubs too, and
are recorded by the test. foundation-8b's `case-routes.test.ts` marks the seven built routes
`built: true`, which leaves them out of its 501 list and keeps their scope refusals (`f02b1fbe`).

Added after GREEN (`edd4564c`): the review request's `case-create` fail modes (429 past the limit;
through when the limiter cannot answer). The first full-file run of that test answered 500, because
both fakes named a case `RV-<n>` from a counter reset per test, so a later test repeated a name
(`cases_environment_id_name_key`); each fake now counts once per file.

## Slice 4: the graph "create case" bulk action (`apps/api/src/services/graph/actions.ts`)

RED `2af4f48e`:

```
$ pnpm exec vitest run src/services/graph/create-case.test.ts --coverage.enabled=false
AssertionError: {"title":"Not Implemented","status":501,"detail":"Creating a case from a graph result is not built yet."...}: expected 501 to be 200
AssertionError: expected { data: { ...(2) } } to match object { data: { attributes: { ...(3) } } }
AssertionError: expected 501 to be 429
      Tests  4 failed (4)
```

GREEN `ee296de7`:

```
$ pnpm exec vitest run src/services/graph/create-case.test.ts src/routes/graph-query-routes.test.ts --coverage.enabled=false
      Tests  22 passed (22)
```

`graph-query-routes.test.ts`'s create-case test still answers 501 unchanged: the real path reaches
`createCaseInTx`, whose stub answers 501 until `api-cases` builds it.

## Gates (end of the first call, on a tree other Stage 3 agents were still writing)

Each read from its own exit code, output sent to a file; `cat /proc/loadavg` beside each.

| Gate | Exit | Time | Load (1 min) | Notes |
|---|---|---|---|---|
| `flock … pnpm install --frozen-lockfile` | 0 | <1 s | 32.8 | |
| `pnpm format:check` | 0 | | | |
| `pnpm turbo run lint typecheck --force --concurrency=2` | 124 | 590 s | 9.5 to 20 | did not fit one call, so split as rule 6 allows: |
| `pnpm turbo run typecheck --force --concurrency=4` | 0 | 238 s | 18.7 to 12.8 | 16 of 16 |
| `pnpm turbo run lint --force --continue --filter=!api --filter=!dashboard` | 1 | 320 s | 10.4 to 13.6 | 13 of 14; the one failure was `api-cases`' uncommitted `packages/db/src/repositories/case-bulk-actions.ts` |
| `pnpm turbo run lint --force --filter=@openverify/api` | 0 | 298 s | 13.6 to 13.0 | |
| `pnpm turbo run lint --force --filter=@openverify/dashboard` | 0 | 137 s | 12.6 to 10.1 | |
| `pnpm turbo run lint --force --filter=@openverify/db` (after `api-cases` committed) | 0 | 71 s | 10.6 | |
| `pnpm turbo run test --force --filter=@openverify/db` | 0 | 222 s | 10.4 to 22.4 | 1,933 tests in 124 files, 93.21% statements |
| API shard 1/4 (blob) | 1 | 376 s | 20.8 to 21.7 | partial coverage alone |
| API shard 2/4 (blob) | 1 | 336 s | 21.2 to 18.8 | partial coverage alone |
| API shard 3/4 (blob) | 1 | 250 s | 16.3 to 12.9 | partial coverage alone |
| API shard 4/4 (blob) | 1 | 230 s | 12.9 to 16.1 | partial coverage alone |
| API merge (`--merge-reports`, coverage gate) | 1 | 11 s | 13.9 | 7,972 passed, 3 failed, 546 files; 93.32% statements, 84.53% branches. The 3 failures are all in `src/services/cases/cases.test.ts`, `api-cases`' RED commit `2f3916ca`, whose GREEN was not yet committed |
| `pnpm --filter @openverify/db test:integration` | 0 | 107 s | 10.6 to 24.2 | 69 tests |
| `apps/api`: `--project graph` | 0 | 52 s | 22.4 to 14.4 | 13 tests; template built in 24,953 ms, copied in 4,487 ms |
| `apps/api`: `--project api --shard=1/3`, `2/3`, `3/3` | 0, 0, 0 | 79, 191, 76 s | 14.4 to 10.8 | 73, 88 and 73 tests |
| `pnpm --filter @openverify/watchlist benchmark:typecheck`, `benchmark:test` | 0, 0 | 73 s together | | the db index gained exports (rule 16) |

No file under `apps/flow` changed, so the mocked flow suite was not a gate of this call.

# Second call: the eight case steps

Base `d3919670` (api-queues-sla's record), on `api-cases`' and `api-queues-sla`'s services. Scope:
the eight case step handlers replacing `foundation-8b`'s `not_implemented` stubs, each in the effect
transaction as the run, each exactly once; the case row's tag and update through the case services;
the case read on `api-cases`' builder; a queue and a policy as references; the review statement
through the comment service; the dev seed's review template; "Review on report match" end to end on
the engine on its matched and errored paths (the scenario inputs `integration-8b` drives).

## Slice 5: the steps, the case row, references, the seed (one RED, one GREEN)

Stub `0960fc0f`: `REVIEW_TEMPLATE_KEY` in `seed/case-workflows.ts`, so the seed test compiles.

RED `608811b7`, from `packages/db` and `apps/api`:

```
$ pnpm exec vitest run src/repositories/case-actions.test.ts --coverage.enabled=false
 × names a template, a queue and an assignment policy
 × reads an environment’s active queues and its policies, by id and by name
AssertionError: expected [ 'case-template' ] to deeply equal [ 'case-template', 'case-queue', …(1) ]
TypeError: Cannot destructure property 'table' of 'referenceSource(...)' as it is undefined.
      Tests  2 failed | 9 passed (11)

$ pnpm exec vitest run src/workflows/actions/cases src/seed/case-workflows.test.ts --coverage.enabled=false
 × seeds a published review template once
 × tags a case through the case service, with its history and event
 × writes a case’s fields and its queue through the case services
 × is a reference by its prefix and its member, as a queue and a policy are
 × on a match: reviews, opens a case holding the inquiry and the report, and waits
 × ... (every create_case, assign_case, update_case_status, add_case_comment, add_case_to_queue,
     attach_objects_to_case, set/clear_case_sla test, and the exactly-once loop)
AssertionError: expected 'not_implemented' to be 'case_template_archived'
AssertionError: create_case: expected 'errored' to be 'completed'
ActionStepError: not_implemented
      Tests  28 failed | 13 passed (41)
```

GREEN `0c68a214`:

```
$ pnpm exec vitest run src/repositories/case-actions.test.ts src/repositories/case-joins.test.ts \
    src/repositories/workflow-definitions.test.ts --coverage.enabled=false
      Tests  34 passed (34)
$ pnpm exec vitest run src/workflows/actions/cases src/seed src/services/cases/actions \
    src/case-plumbing.test.ts src/case-joins.test.ts src/workflows/engine/actions.test.ts \
    src/workflows/publish src/workflows/recipes --coverage.enabled=false
 Test Files  20 passed (20)
      Tests  244 passed (244)
```

Corrections inside GREEN, each for a reason stated here:

- The test helper seeded its case as `<KEY>-1`, which the template's counter then gave the first
  case a step made (`cases_environment_id_name_key`); the seeded case is now number 900.
- `create_case`'s history holds `created` and then `object-attached` (api-cases' creation writes
  both); the first expectation named only the first.
- The review recipe's route read `steps.read_case.output.object.resolution` and got nothing: 8A's
  `fetch_object` answers a row's JSON:API resource, while the check types a fetched object as its
  flattened view (`triggerViewType`). The case row now answers the flattened view, so the path a
  definition is checked against is the path a run reads; the two `fetch` tests of the first call
  read the flattened members. The other rows are 8A's (a contract deviation).
- A run that marks for review writes a `review` decision record beside its `approve` or `decline`,
  so the recipe test finds the decision by kind instead of taking the first.
- My first-call service test faked `createCaseInTx` and the comment and history repositories while
  they were stubs; it now wraps the real creation path and reads the statement's comment and the
  history from the database.

Existing tests changed with the plan: `apps/api/src/case-plumbing.test.ts` (foundation-8b's) "each
have a handler, which ends its step with not_implemented" became "each have a transaction handler,
the case steps' own".

Refactor `9e33dec3`: the header of `steps.ts` says what `create_case` does past the budget (it
fails closed with `rate_limited`; deferring waits on the entry's retry).

## Gates (second call, on a tree `api-case-files` was still writing)

Each read from its own exit code, output sent to a file; `cat /proc/loadavg` beside each.

| Gate | Exit | Time | Load (1 min) | Notes |
|---|---|---|---|---|
| `flock … pnpm install --frozen-lockfile` | 0 | <5 s | 8.2 | no lockfile or workspace change |
| `pnpm format:check` | 0 | 99 s | 8.2 to 5.4 | |
| `pnpm turbo run lint typecheck --force --concurrency=4` (4 GiB heap) | 0 | 275 s | 5.0 to 6.5 | 32 of 32 |
| `pnpm turbo run test --force --filter=@openverify/db` | 0 | 115 s | 6.0 to 9.6 | 1,981 tests in 127 files, 93.33% statements |
| API shards 1-4 (`/tmp/acw2-gate-a`) | 1 each | 221, 262, 257, 202 s | 7.7 to 9.6 | partial coverage alone |
| API merge (`/tmp/acw2-gate-a`) | 1 | 11 s | 6.7 | 8,014 passed; 2 files failed to load: `api-case-files`' uncommitted `providers/attachment-scanner/index.ts` imported `./clamd.js` before its commit `4af88897`; both files pass alone after it (89 tests) |
| `pnpm --filter @openverify/db test:integration` | 0 | 111 s | 4.4 to 22.1 | 73 tests |
| `apps/api`: `--project graph` | 0 | 38 s | 20.4 to 13.5 | 13 tests; template built in 18,944 ms, copied in 1,571 ms |
| `apps/api`: `--project api --shard=1/3`, `2/3`, `3/3` | 0, 0, 0 | 63, 145, 60 s | 12.4 to 17.2 | 72, 91 and 74 tests |
| `pnpm --filter @openverify/watchlist benchmark:typecheck`, `benchmark:test` | 0, 0 | 52 s together | | 119 tests |
| API shards 1-4 again (`/tmp/acw2-gate-b`) | 1 each | 244, 240, 202, 193 s | 8.6 to 11.1 | partial coverage alone |
| API merge again (`/tmp/acw2-gate-b`) | 1 | 10 s | 9.2 | 8,116 passed, 1 failed in 565 files; 93.95% statements, 85% branches. The failure is `case-file-plumbing.test.ts` "binds a scanner in the worker whose stub never answers clean", which still expects foundation-8b's 501 stub that `api-case-files` replaced in `4af88897` |

My files in the merged coverage: `workflows/actions/cases` 95.26% statements, 84.23% branches;
`services/cases/actions` 90%, 75.22%. No file under `apps/flow` changed, so the mocked flow suite was
not a gate of this call.
