# Phase 8, Workflow 8D Stage 1: api-carry-engine

The engine and code-runner family of the API items Workflow 8C carried: V8C-2, R004, R005, K8-6,
K8-7 and K8-12, each test-first. Commands ran after `source scripts/env.sh`, from `apps/api` unless a
line says otherwise; output is abbreviated to the lines that matter. Every value is synthetic.

## 1. V8C-2: the create_case SLA test reads the clock the step was given

`create_case > starts a wall-clock SLA in the unit it names` read `before = Date.now()` after its
fixture, while the case unit computes the expiry from `services.clock`, the action harness's fixed
clock made in `beforeAll`. Under load more than 5 s passes between the two, so the expiry fell about
190 ms short of `before + 2 h - 5 s` in the orchestrator's validation of 3e0652f1.

RED: the test sets the step's clock a minute behind the wall clock (restored when it finishes), which
makes the load gap certain, and keeps the wall-clock assertion.

```
$ pnpm exec vitest run src/workflows/actions/cases/steps.test.ts -t 'starts a wall-clock SLA' --coverage.enabled=false
     × starts a wall-clock SLA in the unit it names 5443ms
AssertionError: expected 1793758227083 to be greater than or equal to 1793758282100
      Tests  1 failed | 21 skipped (22)        (exit 1; loadavg 43.38 31.20 16.92)
```

GREEN: the test reads the step's clock (`harness.services.clock`) before the run and asserts the
deadline is exactly two hours past it; the fixed clock does not move, so no margin is needed and the
wall clock is never read. The 5 s margin was not widened.

```
$ pnpm exec vitest run src/workflows/actions/cases/steps.test.ts --coverage.enabled=false
 Test Files  1 passed (1)
      Tests  22 passed (22)        (exit 0; loadavg 7.04 24.82 19.30)
```

## 2. R004: the rotation reads one entry per environment, and a capped environment takes its turn

Two failures: `listEnvironmentsWithReadySteps` read every ready, unenqueued step of every environment
(DISTINCT over the join), so its cost grew with the backlog; and `admit` returned before
`touchWorkflowEnvironmentSlot` when an environment was at its cap, so a capped environment kept its old
`last_served_at` and its place at the head of the 500-environment window.

RED (two tests):

- `apps/api/src/workflows/engine/sweep.test.ts`, "sends a capped environment to the back of the
  rotation (R004)": an environment with an in-flight cap of 1 and two runs; after a sweep that admits
  nothing, its `last_served_at` is still `null`.
- `packages/db/src/repositories/workflow-steps-rotation.integration.test.ts` (new, Postgres 17): five
  environments, one with a backlog of 20,000 ready steps; the query `listEnvironmentsWithReadySteps`
  sends is captured from the pool and run again under `EXPLAIN (ANALYZE, FORMAT JSON)`; the rows it
  reads from `workflow_run_steps` (produced plus removed by filter, over every loop) must stay under
  500. Its two answer tests (due, unenqueued work only, longest unserved first; the limit) pass on the
  old query too, so the rewrite is held to them.

```
$ pnpm exec vitest run src/workflows/engine/sweep.test.ts --coverage.enabled=false
     × sends a capped environment to the back of the rotation (R004) 1625ms
AssertionError: expected null to be an instance of Date
      Tests  1 failed | 15 passed (16)        (exit 1)
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/repositories/workflow-steps-rotation.integration.test.ts)
the rotation read 20105 step rows over a backlog of 20000
     × reads far fewer than one environment's 20000 ready steps 83ms
AssertionError: {"Node Type":"Limit", ... "Node Type":"Seq Scan", "Relation Name":"workflow_run_steps",
  "Actual Rows":20005, ... "Rows Removed by Filter":100 ...}: expected 20105 to be less than 500
      Tests  1 failed | 2 passed (3)        (exit 1; loadavg 16.28 21.05 18.68)
```

GREEN:

- `packages/db/src/repositories/workflow-steps.ts`, `listEnvironmentsWithReadySteps`: a recursive
  skip scan of `workflow_run_steps_ready_idx` (`environment_id > previous ... order by environment_id
  limit 1`) walks the distinct environments with a ready step, one index probe each; per environment
  two `limit 1` probes ordered by the index (`due_at <= now`, and `due_at is null`), each with
  `enqueued_at is null`, ask whether it has due, unenqueued work. A first draft with two `exists`
  probes read 40,220 rows: the planner ran the `due_at is null` probe as a sequential scan, because
  most rows of the table have a null `due_at`; the probes ordered by the index's columns take the
  index. Order: `last_served_at asc nulls first`, then environment id (ties). No index and no
  migration: the partial index the engine already had serves it.
- `apps/api/src/workflows/engine/dispatcher.ts`, `admit`: the sweep touches the slot first, whether it
  then admits anything or not, so an environment at its cap (or whose ready steps all wait behind
  their action's cap) takes its turn and goes to the back. A completion still never writes the slot.

```
$ (cd packages/db && pnpm exec vitest run --config vitest.integration.config.ts src/repositories/workflow-steps-rotation.integration.test.ts --silent=false)
the rotation read 36 step rows over a backlog of 20000
      Tests  3 passed (3)        (exit 0; loadavg 16.31 17.32 17.67)
$ pnpm exec vitest run src/workflows/engine/sweep.test.ts src/workflows/engine/waits.test.ts src/workflows/triggers/triggers-engine.test.ts --coverage.enabled=false
      Tests  49 passed (49)        (exit 0)
$ (cd packages/db && pnpm exec vitest run src/repositories/workflow-engine-repositories.test.ts --coverage.enabled=false)
      Tests  24 passed (24)        (exit 0)
```

## 3. R005: backpressure and cancellation on the code runner's socket

The failure: the pool's waiting list was an unbounded FIFO; the socket client's one timer per request
included the server's queue time, and when it fired it ended the whole connection, so one slow
evaluation failed every evaluation in flight on it as `sandbox_crashed` (`socket_timeout`); and the
server never learned that a connection went, so its queued jobs still ran and were thrown away.

Stub (`c871e8a1`, its own commit so the RED tests compile): the reason `runner_busy` in
`CODE_RUNNER_FAILURE_REASONS`, `PoolInternals.maxWaiting`, and an optional `AbortSignal` on
`CodeRunnerPool.submit`, each unused.

RED (five tests):

- `pool.test.ts`, "backpressure (Workflow 8D R005)": a pool of one silent child with a waiting list of
  one answers a third evaluation `runner_busy` at once, before the other two settle; a waiting job
  whose caller aborted answers `socket_closed` and no second child starts; an already aborted caller
  is answered at once with no child.
- `socket.test.ts`: a fake server that answers nothing until the first evaluation timed out, then
  answers both; the timed-out evaluation is `socket_timeout`, the other one still gets its value on
  the same connection, and the late answer of the first is dropped. And the server aborts the signal
  it handed the pool for a connection's request once that connection closes.

```
$ (cd packages/workflow-engine && pnpm exec vitest run src/code-runner/pool.test.ts src/code-runner/socket.test.ts -t 'R005|backpressure' --coverage.enabled=false)
     × times out one evaluation alone, keeps the connection, and drops its late answer (R005) 316ms
     × cancels what a connection left waiting when it goes (R005) 1074ms
     × answers runner_busy at once past its waiting list, and starts nothing for it 1603ms
     × drops a waiting evaluation whose caller went away, before any child takes it 1030ms
     × answers at once for a caller already gone 518ms
AssertionError: expected { ok: false, code: 'timeout', …(2) } to deeply equal { ok: false, …(4) }   (x3)
AssertionError: expected { ok: false, …(4) } to deeply equal { ok: true, value: 7, console: [] }
AssertionError: expected undefined to be true // Object.is equality
      Tests  5 failed | 97 skipped (102)        (exit 1; loadavg 16.26 16.24 17.11)
```

GREEN:

- `pool.ts`: `submit(request, cancelled?)` answers `runner_busy` at once when `maxWaiting` jobs
  already wait (default `size × waiting-per-child`, a new provisional limit of 4 in
  `EVALUATE_CODE_LIMITS`: four evaluations at the 5 s ceiling queue for 20 s, inside the client's 30 s
  margin), answers `socket_closed` for a caller already gone, and drops a waiting job whose signal
  aborts; the listener is detached when a child takes the job or the pool closes.
- `socket-server.ts`: each connection holds an `AbortController` aborted on `close`, and hands its
  signal to `pool.submit`.
- `socket-client.ts`: an evaluation's timer (limit + kill grace + 30 s margin) settles that
  evaluation alone with `socket_timeout` and remembers its id; a late `value`, `error` or `crashed`
  for it is dropped, its late console lines are still capped at 50, and past 64 unanswered ids
  (`ABANDONED_MAX`, ours) the connection ends, as before, so a server that answers nothing is left.
- No new protocol frame: `runner_busy` travels in the existing `crashed` frame, which only the socket
  carries, and maps to `sandbox_crashed` (which follows the step's `retry`, as before). The child is
  unchanged.
- Docs: `docs/workflows/limits.md` regenerated (`waiting-per-child`); `docs/workflows/evaluate-code.md`
  gains the backpressure paragraph.

Two tests were written with the GREEN, not before it: the 64-id cap (`abandonedMax: 1` in the test)
and the late console cap. Both pass on the GREEN code; on the RED code the first connection ended at
the first timeout, so neither branch existed to test.

```
$ (cd packages/workflow-engine && pnpm exec vitest run src/code-runner src/actions --coverage.enabled=false)
 Test Files  15 passed (15)
      Tests  644 passed (644)        (exit 0; loadavg 17.43 16.57 17.12)
$ pnpm --filter @openverify/api workflow-docs:write        (exit 0; limits.md +1 row)
$ pnpm exec vitest run src/workflows/reference-docs.test.ts src/workflows/actions/code --coverage.enabled=false
      Tests  29 passed (29)        (exit 0)
```

## 4. K8-6: an action's wait sees what finished after the action's read

The failure (plan amendments 84, 126): `rerun_report` reads its reports, finds the next one pending
and waits on it. Under Read Committed the read takes its own statement snapshot; the wait records
`pg_current_snapshot()` later, at its registration. A report that finished between the two is
visible in the wait's snapshot, so neither the registration's check nor the wait-match job resolves
the wait, and the step ends `report_timed_out`: a false timeout, never a false result.

The choice (a contractDeviation): neither of the two fixes the item names closes the race alone. A
multi-key wait still takes its snapshot after the read, so the last pending report finishing in the
gap still times out; a re-read at the timeout turns the false timeout into a delay as long as the
timeout (an hour by default). The engine instead takes the action's wait snapshot **before the
handler runs** (the first statement of a `transaction` handler's transaction, or a statement just
before an `outside` handler), and the wait records that snapshot. Whatever committed before it, the
handler's read sees; whatever committed after it, the wait's check or the job resolves. The step's
outputs and the one-key wait stay as they are.

RED, `apps/api/src/workflows/engine/wait-races.integration.test.ts` (Postgres 17), "an action’s own
wait (K8-6)": a `run_report` handler held by a gate between its read and its `waiting` answer; the
test commits the report's `report/watchlist.ready` event on another connection in that gap, releases
the handler, then runs the wait-match job. The step must be `ready`, resolved by that event.

```
$ pnpm exec vitest run --config vitest.integration.config.ts --project api src/workflows/engine/wait-races.integration.test.ts
     × resolves on its object’s event committed between the action’s read and its wait 412ms
AssertionError: expected 'waiting' to be 'ready' // Object.is equality
      Tests  1 failed | 10 passed (11)        (exit 1; loadavg 16.19 16.41 16.98)
```

GREEN:

- `packages/db/src/repositories/workflow-steps.ts`: `currentWorkflowSnapshot(tx)` answers
  `pg_current_snapshot()::text`; `WorkflowWaitEntry.snapshot` (optional) is what `enterWorkflowWait`
  records as `waiting_snapshot` (`::pg_snapshot`), `pg_current_snapshot()` when absent, so a wait
  step, a time wait and every other caller are unchanged.
- `apps/api/src/workflows/engine/executor.ts`: `runInTransaction` takes the snapshot as the first
  statement of the handler's transaction, `runOutside` just before an `outside` handler runs;
  `applyResult` hands it to `waitClaimed`, which passes it to `enterEventWaitInTx`
  (`EventWait.snapshot`). The registration still takes the correlation lock before the step row and
  still excludes its own transaction's events (`waiting_xact`), so the two-sided argument of C119.3
  holds with the earlier snapshot.
- The race test ran on: once the wait resolved at its registration, the drain claimed the step again
  and the test handler had no `resume`, so the step failed `execution_error`. The handler gained a
  `resume` answering a ready report, and the test asserts the step was resolved by that event, then
  succeeded, and the run completed. On the RED code the step stays `waiting` with no event, so it
  still fails there.
- `rerun-report.ts`'s header says why its waits in turn are no longer a false timeout.

```
$ pnpm exec vitest run --config vitest.integration.config.ts --project api src/workflows/engine/wait-races.integration.test.ts
      Tests  11 passed (11)        (exit 0; loadavg 16.84 15.88 16.65)
$ pnpm exec vitest run src/workflows/engine src/workflows/actions/reports src/workflows/actions/graph src/workflows/actions/verifications --coverage.enabled=false
 Test Files  7 passed (7)
      Tests  89 passed (89)        (exit 0)
$ (cd packages/db && pnpm exec vitest run src/repositories/workflow-engine-repositories.test.ts src/repositories/workflow-plumbing.test.ts --coverage.enabled=false)
      Tests  37 passed (37)        (exit 0)
$ (cd packages/db && pnpm exec tsc --noEmit -p tsconfig.json); (cd apps/api && pnpm exec tsc --noEmit -p tsconfig.json)
(both exit 0)
```

## REQUEST for api-carry-cases (K8-7): the new action's wait events in the publish-time wait index

`rescreen_account_reports` (key added in `1170c73e`) waits for `report/<type>.ready` and
`.errored`, as `run_report` and `rerun_report` do. `apps/api/src/workflows/publish/index-rows.ts` is
api-carry-cases' path (K8-10), so this is a request, not an edit:

- In `actionWaitEvents`, add `case 'rescreen_account_reports':` beside `case 'run_report':` and
  `case 'rerun_report':`, answering `REPORT_TERMINAL_EVENTS`.
- Test first, in `index-rows.test.ts`: `waitEventNames` of a definition holding one
  `rescreen_account_reports` step includes every name of `REPORT_TERMINAL_EVENTS` (it answers none
  today).

Until it lands, the action records the index row itself when it first waits (as a draft's test run
does, amendment 36); its reports are enqueued only after that transaction commits, so no report it
made can finish before the row exists, but a published version should not rely on that.

## 5. K8-7: the re-screen recipe screens each stale monitored report of the account

The failure (plan amendments 64, 126; C127.12, C140.5): `rescreen-on-account-field-change` was one
`run_report` from a template the operator named, whatever changed, because no action listed an
account's monitored reports.

The choice: a new internal action, `rescreen_account_reports` v1 (ours), rather than a selector
whose list a loop feeds to `run_report`. C127.12 asks for a new report "from the same template with
the account's current fields", and only the server can say which account field a report's query
member reads: the same rule as the report engine's query sources (`completion.ts`: a member reads
the account field of the same name with `-` as `_`). A definition could not build that query
without reading every PII field into the run.

- Config `{ account-id, timeout-seconds? }`; grant `reports:write` and `accounts:read` (it reads the
  account, Phase 6 decision 39), no `pii` (as `run_report` with `fields`: the values go from the
  account into the report service, never into the run); delivery exactly once, then a wait; stage
  `ga`, as `rerun_report`.
- Output `{ reports[] {report-id, status, has-match}, count, monitored-count, any-match, errored[] }`:
  `any-match` is `null` unless every new report is `ready`, and `null` when nothing was re-screened
  (`count` 0), never `false`.
- Monitored means `next_run_at` set, not paused, not redacted (the custom-list re-screen's rule).
  More than 100 monitored reports is `report_selector_limit`, nothing made.

Stub (`1170c73e`, its own commit so the RED tests compile): the key after `rerun_report` in
`WORKFLOW_ACTION_KEYS`, the config and output schemas in `reports.ts` and `contracts.ts`, the
catalogue row, the contract example, the two key-count tests of `registry.test.ts` (35 to 36, 43 to
44; a plan change, listed as a deviation), `docs/workflows/actions.md` regenerated, and an API handler
that fails `execution_error`. Request `1dd8384a` asks api-carry-cases for the publish-time wait index.

RED:

- `apps/api/src/workflows/actions/actions-objects.test.ts`, "rescreen_account_reports (K8-7)": a
  stale monitored report gets one new report from its template with the account's current value,
  origin `workflow`, and the step waits for it, then answers it; an unchanged, an unmonitored and a
  paused report are left alone (`monitored-count` 2); nothing stale answers `any-match: null`; 101
  monitored reports answer `report_selector_limit` with none made; a redacted account is
  `subject_redacted`, an unknown one `object_not_found`.
- `apps/api/src/workflows/recipes/recipes.test.ts`: the recipe's one action is
  `rescreen_account_reports` on `{{ trigger.id }}` and it needs nothing named; the route lists
  `needs-configuration: []` for it. The install test that publish refuses an unfilled draft now
  installs "Review on report match", whose placeholders are refused, since the re-screen recipe has
  none (a test the plan's change moves; a deviation).

```
$ pnpm exec vitest run src/workflows/actions/actions-objects.test.ts -t 'rescreen_account_reports' --coverage.enabled=false
     × screens the current value of each monitored report whose field changed, from its template 270ms
     × answers nothing re-screened with no answer, never no match 233ms
     × refuses more monitored reports than its selector cap, making none 453ms
     × ends a redacted account with subject_redacted, and an unknown one object_not_found 163ms
AssertionError: execution_error: expected 'errored' to be 'in_progress'
AssertionError: execution_error: expected 'errored' to be 'completed'
      Tests  4 failed | 58 skipped (62)        (exit 1; loadavg 7.59 10.30 13.69)
$ pnpm exec vitest run src/workflows/recipes --coverage.enabled=false
     × re-screens each stale monitored report of the account, with nothing to name (K8-7) 17ms
     × lists each recipe with its trigger and what it needs 551ms
      Tests  2 failed | 5 passed (7)        (exit 1)
$ pnpm exec tsc --noEmit -p tsconfig.json        (exit 0)
```

GREEN:

- `apps/api/src/workflows/actions/reports/rescreen-account-reports.ts`: the handler. It reads the
  account (`object_not_found`, `subject_redacted`), its reports through `listAccountReportIds` and
  `getReports`, keeps the monitored ones (past 100, `report_selector_limit`), builds each stale
  report's query from the account's current fields, creates the new report through
  `createReportInTx` (`origin: workflow`, refusals as step errors, a body the contract refuses is
  `report_input_missing` with the field, as `run_report`), records it as the step's object, and
  waits through `rerun_report`'s `advance` (now exported), carrying `monitored-count` across the
  waits. Subjects: the account as read, each new report as written. The reports are enqueued after
  commit; the report sweep is the outbox.
- `apps/api/src/workflows/recipes/rows.ts`: the recipe's one step is `rescreen_account_reports` on
  `{{ trigger.id }}` with a 3,600 s timeout, and it needs nothing named; `docs/workflows/recipes.md`
  says how it chooses and drops the "limit of this recipe" paragraph.

```
$ pnpm exec vitest run src/workflows/actions/actions-objects.test.ts src/workflows/recipes src/workflows/reference-docs.test.ts src/workflows/engine/actions.test.ts --coverage.enabled=false
      Tests  74 passed (74)        (exit 0; loadavg 12.09 10.80 13.01)
$ pnpm exec tsc --noEmit -p tsconfig.json        (exit 0)
```

## 6. K8-12: a test run's synthetic payload is held to its trigger's view

The failure (plan amendments 43, 126): `POST /workflows/:id/test-runs` checked a synthetic
`trigger-payload` only as a JSON object (and, for `trigger-api`, by the declared inputs), so a run
could start from a payload no event could carry.

The C119 decision (default): a synthetic payload is the flattened trigger view a run reads, and it
may be **partial**. A member it leaves out reads as `null` in the run (so a route on it follows its
`on-null`, as for a real event with that member null); a member it carries must fit the view: its
type, and, for a member the view does not hold, nothing (refused). An explicit `null` where the view
holds no null is refused, as a real event never carries it. The view is the definition's trigger
root type (C115.3: the common view of the trigger's events, a case and a case comment included since
8B; the object view of an account, case, recurring or direct trigger), so a test run reads what a
real run reads. `{}` stays valid, so the existing tests that send it stand. A refusal is 422
`trigger_input_invalid` with the pointer `/data/attributes/trigger-payload/<member path>`, never the
value (C143.5). `trigger-api` keeps its check by the declared inputs.

Stub (`6785e6c8`, a refactor with no behaviour change): `triggerRootType`, the scope's existing
`triggerType`, exported from `@openverify/workflow-engine`.

RED, `apps/api/src/workflows/runs/service.test.ts`, "a synthetic payload is held to its event’s view
(K8-12, C119)", on an `inquiry.completed` trigger: `{}` and `{ id, status }` are taken (201; passes
already, the guard of the partial rule); `{ status: 7031 }` must be 422 at `.../status` without the
number in the body; `{ not-a-member: ... }` 422 at `.../not-a-member` without the value; `{ id: null }`
422 at `.../id`.

```
$ pnpm exec vitest run src/workflows/runs/service.test.ts -t 'synthetic payload' --coverage.enabled=false
       × refuses a member of the wrong type at its pointer, echoing nothing 95ms
       × refuses a member the view does not hold, and an explicit null where none may be 56ms
AssertionError: {"data":{"type":"workflow-run", ... "trigger-snapshot":{"id":"inq_...","status":7031}} ...}: expected 201 to be 422
AssertionError: {"data":{"type":"workflow-run", ... "trigger-snapshot":{"not-a-member":"a synthetic value"}} ...}: expected 201 to be 422
      Tests  2 failed | 1 passed | 26 skipped (29)        (exit 1)
$ pnpm exec tsc --noEmit -p tsconfig.json        (exit 0)
```

GREEN: `apps/api/src/workflows/runs/test-runs.ts`, `payloadProblem`: `checkValue` of the payload
against `triggerRootType(definition)`, keeping every problem but a `value_missing` whose member the
payload leaves out (`absentAt` walks the RFC 6901 pointer); the first problem left is 422
`trigger_input_invalid` at `/data/attributes/trigger-payload<pointer>`. A definition with no trigger
root has nothing to check. A fifth case was added with the GREEN (a list member: `tags: ['synthetic',
null]` is refused at `.../tags/1`), so the pointer walk through a list is covered.

```
$ pnpm exec vitest run src/workflows/runs --coverage.enabled=false
      Tests  39 passed (39)        (exit 0)
$ pnpm exec vitest run src/workflows/runs/service.test.ts -t 'synthetic payload' --coverage.enabled=false
      Tests  3 passed | 26 skipped (29)        (exit 0)
$ pnpm exec tsc --noEmit -p tsconfig.json        (exit 0)
```

## Coverage tests added at the gate (engine branches)

The first merged gate measured `workflows/engine` at 80.37% branches (80.45% after the 8C review),
`workflows/runs` at 75.65% (74.30%). Two tests were added on the green code, so the engine folder
does not fall:

- `waits.test.ts`, "an outside action whose object finished before it waited (K8-6)": an `outside`
  handler commits its object's event before it answers `waiting`; the registration resolves the wait
  at once, on PGlite (the path `enterEventWaitInTx` takes when a candidate its snapshot does not see
  exists, which only the Postgres race file reached before). It is K8-6's `outside` branch, which
  had no RED of its own; to show it holds that fix, the registration-time snapshot was put back for
  one run (`applyResult(..., await currentWorkflowSnapshot(tx))` in `runOutside`): `expected
  'waiting' to be 'ready'`, exit 1; the file was then restored from a copy (`git diff` empty).
- `sweep.test.ts`, "admits no more than its room from what it over-reads": a cap of one and two ready
  steps; the admission loop stops at its room (`dispatcher.ts` lines 100%).

```
$ pnpm exec vitest run src/workflows/engine/sweep.test.ts src/workflows/engine/waits.test.ts (coverage of the two files)
      Tests  46 passed (46)
 dispatcher.ts     |     100 |    94.44 |     100 |     100 |
 ...-resolution.ts |    95.4 |    78.18 |     100 |    95.4 |        (was 86.2 lines, 72.72 branches)
```

## Lint at the gate

The forced lint refused five things of mine, each fixed with no change of behaviour: two
unnecessary assertions in `workflow-steps.ts` (`d26cf1a7`), and in the tests an unreachable null
check on an inquiry's account id, an unnecessary `as never` on an event name, and a type parameter
used once in `service.test.ts`'s pointer reader.
