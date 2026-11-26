# Phase 9, Workflow 9A Stage 3: api-flow-actions (family S)

Evidence for `api-flow-actions`' deliverables (plan, Workflow 9A Stage 3, the `api-flow-actions`
bullet; C152, C150.7, C150.9, C178.2). Every command below was run after `source scripts/env.sh`;
outputs are abbreviated and every exit code is read from the command itself.

Started on foundation-9a's `CHECKPOINT (S) DONE at fca9a6420fe7a19d63e94df7e0e72a43b0ed07c8` (its
handoff in `docs/tdd/phase9-foundation-9a.tdd.md`) and flow-spec-logic's final handoff
(`2ea6e155`). `copy_extractions` waits for foundation-9a's checkpoint (T), whose
`validateInquiryFieldsWrite` stub it writes through.

Owned paths: `apps/api/src/flow-actions/`, `apps/api/src/jobs/repeatable/flow-actions.ts`,
`apps/api/src/jobs/flow/signal-snapshot.ts`,
`packages/db/src/repositories/{inquiry-flow-actions,inquiry-flow-signal-snapshots}.ts`, and the
tests beside each.

## Slice 1: the action rows and the snapshot rows (packages/db)

Placeholders (`d3738c2d`): `getInquiryFlowAction`, `listLatestInquiryFlowActions`,
`getWaitingBranchEntry`, `listWaitingBranchEntries`, `WaitingBranchEntry`, `InquiryFlowActionKey`;
`insertInquiryFlowActionInTx` widened to answer `null` for an entry that already has a row (the stub
had no caller but foundation's stub test).

RED:

```
$ pnpm exec vitest run src/repositories/inquiry-flow-actions.test.ts src/repositories/inquiry-flow-signal-snapshots.test.ts --coverage.enabled=false   # exit 1
 × is recorded once, running, and a repeat of the entry records nothing
 × belongs to its environment: another environment reads none of it
 × finishes once, with its copy target and keys, and a second finish changes nothing
 × records why an entry took its error port
 × lists running entries entered before the cutoff, oldest first, across environments
 × reads the newest entry per step, by step id
 × lists each entry that copied, by step and entry, never another inquiry’s
 × writes each name once, keeps the first value, and lists them by name
 × writes nothing for no snapshot, and another environment reads none
 × is the open branch entry of a waiting position, and nothing else
 × is never a closed entry, or an action the inquiry waits at
 × lists the waiting branch entries entered before the cutoff, oldest first
 FlowRepositoryNotBuiltError: insertInquiryFlowActionInTx is not built yet (api-flow-actions)
 Tests  12 failed (12)
```

GREEN: the entry inserted with `on conflict do nothing` (its primary key is the entry), finished only
while `running`, the running entries and the waiting branch entries ordered by `entered_at` with the
keys as tie-breakers, the latest entry per step by `distinct on (step_id)`, the copies where a target
and at least one key were recorded; a waiting branch entry is the inquiry's newest step-record entry,
open, of a `branch` step, at the position the inquiry waits at.

```
$ pnpm exec vitest run src/repositories/inquiry-flow-actions.test.ts src/repositories/inquiry-flow-signal-snapshots.test.ts --coverage.enabled=false   # exit 0
      Tests  12 passed (12)
```

Existing test changed because the plan changes what it checks: foundation-9a's
`packages/db/src/phase9a-flow-tables.test.ts` ("the repository stubs name their owners") loses its
six `api-flow-actions` entries and their imports, since they are built. Its three `api-flow-engine`
entries are `api-flow-engine`'s (that agent built them in `ce29688a`; the test then fails on them).

## Slice 2: the actions that finish at once, and the copy targets (apps/api)

Placeholders (`1721e49f`): `settleFlowActionInTx`, `FlowActionDeps` (optional `db`, `ids`,
`workflowSteps`, `workflowInFlightCap` beside `AdvanceFlowDeps`), the entry's optional `scope`
(`FlowScopeRoots`), the outcome's optional `notes`, `after` and `cancelDue`;
`flow-actions/workflow-scope.ts` (`flowWorkflowScopeInTx`, `FlowWorkflowFacts`);
`flow-actions/failure.ts` (`recordFlowFailureInTx`, `FlowFailurePath`, `FlowPathExit`,
`FlowFailureVerdict`); `grants.ts` (`flowActionPublishGrants`, `FlowRunGrantRecord`,
`flowActionAcknowledgements`).

RED (`apps/api/src/flow-actions/run-action.test.ts`):

```
$ pnpm exec vitest run src/flow-actions/run-action.test.ts --coverage.enabled=false   # exit 1
 × adds and removes literal tags once, staging inquiry.updated-tags, audited as the system
 × changes nothing and stages nothing when the tags are already as asked
 × records its reason code as a step-record note and moves nothing
 × writes the mapped values to the inquiry’s account once, and records the target and keys
 × takes error when the account type refuses a value, and writes and records nothing
 × takes error when a mapping reads the scope and none was given
 × records no target when every value was unknown
 × is never touched: no row, no tag, the error port
 FlowActionNotBuiltError: runFlowActionInTx is not built yet (api-flow-actions)
 Tests  8 failed (8)
```

GREEN: `flow-actions/instant-actions.ts` (`tagInquiryInTx`, `flagForReview`,
`updateAccountFieldsInTx`, each as the system: audit entries through `appendSystemAuditEntry` with
the inquiry and step ids; the account write in a savepoint through `updateAccountInTx`, so a refusal
leaves the flow's own transaction intact), `flow-actions/scope-values.ts` (`readScopeValue`,
`resolveMapping`, over `parsePath(…, FLOW_PATH_MEMBER)`), `runFlowActionInTx` (the row is the claim;
a repeat replays how the entry ended), `flowActionCopyTargets` over `listInquiryFlowActionCopies`.

```
$ pnpm exec vitest run src/phase9a-flow-plumbing.test.ts src/flow-actions --coverage.enabled=false   # exit 0
      Tests  27 passed (27)
```

Existing test changed because the plan changes what it checks: foundation-9a's
`apps/api/src/phase9a-flow-plumbing.test.ts` "refuses an action and keys a run per inquiry, step and
entry" asserted the stub's `FlowActionNotBuiltError`; it now asserts that an inquiry the action
cannot read takes the error port (the run-key assertion is unchanged), and the unused import went.

## Slice 3: run_workflow, its wait, its timeout and the workflows scope (apps/api)

RED (`apps/api/src/flow-actions/run-workflow.test.ts`, on Phase 8's engine harness):

```
$ pnpm exec vitest run src/flow-actions/run-workflow.test.ts --coverage.enabled=false   # exit 1
 × starts one run per entry, from the flow, with the declared inputs, and waits
 × takes next once the run completed, and reads its outputs from the run
 × takes error when the run errors, and reads no output
 × cancels the run at the timeout, outside the lock, and takes error
 × takes error when an operator canceled the run before its timeout
 × starts nothing for a latest version wider than the template’s publish allowed
 × starts nothing for a target with egress the template did not acknowledge
 × runs a pinned version, which no later publish can widen
 × starts nothing for a workflow that is paused, of another environment, or not a flow trigger
 × takes error when an input reads the scope and none was given
 FlowActionNotBuiltError: run_workflow is not built yet (api-flow-actions)
 Tests  10 failed (10)
```

The RED test was changed after its commit (`a3db1c0c`), before GREEN, for these reasons (none
weakens what it checks):
- The default target workflow (an output step only) ends inside the transaction that starts it, so
  "takes next once the run completed" could never observe a wait. It is split in two: "takes next at
  once when the run completes in the transaction that starts it" (new), and the original, now on a
  workflow whose run waits for the step queue (`queued()`: a scripted `tag_object` step, then the
  output).
- The completed and errored cases run a pinned version whose grant holds `inquiries:write`: with
  the empty grant, both scripted steps failed on Phase 8's `run_grant_insufficient` before the
  script ran, so the errored case did not prove the scripted error; it now asserts the script ran.
- The run count is compared as a number (PGlite answers `count(*)` as a number, not a string).

GREEN (`flow-actions/run-workflow.ts`: `enterRunWorkflowInTx`, `settleRunWorkflowInTx`,
`cancelTimedOutFlowRun`, `deadlineOf`, `flowEngineDepsOf`, `FLOW_RUN_POLL_MS`,
`RUN_WORKFLOW_ERROR_TYPES`; `run-action.ts` routes `run_workflow` to it and `settleFlowActionInTx`
settles a running entry; `workflow-scope.ts` builds the `workflows` root from the latest entry of each
`run_workflow` step of the pinned flow, outputs read from the run's sealed values only when it
completed):

```
$ pnpm exec vitest run src/flow-actions src/phase9a-flow-plumbing.test.ts --coverage.enabled=false   # exit 0
 Test Files  3 passed (3)
      Tests  38 passed (38)
$ pnpm exec tsc --noEmit   # exit 0
$ pnpm exec eslint src/flow-actions   # exit 0
```

The grant stored at publish: no column of `inquiry_template_versions` holds a `run_workflow` step's
target grant (C152.2 "stored on the template version with the publish acknowledgement";
`acknowledgements` is a strict `{ key, acknowledged-by, acknowledged-at }`). Until one exists
(a contract deviation in the report), a `latest-published` target is held to no scope and no PII
(fail closed) and its egress to the template's `egress:<step id>` acknowledgement; a pinned version is
immutable, so its own grant is the one the publish checked.

## Slice 4: the publish's grant check, the stored grants and the egress acknowledgements (apps/api)

RED (`apps/api/src/flow-actions/grants.test.ts`):

```
$ pnpm exec vitest run src/flow-actions/grants.test.ts --coverage.enabled=false   # exit 1
 × refuses a publisher without workflows:trigger, a grant scope or pii:view, at the step
 × reads a user’s permissions from its roles, and a revoked key as holding nothing
 × refuses a workflow of another environment, one with no flow version, and a foreign pin
 × records each step’s resolved version, its grant and its egress steps
 × stores nothing and asks nothing for a v1 flow or a target that cannot run
 AssertionError: expected [] to deeply equal [ { …(3) }, { …(3) } ]
 FlowActionNotBuiltError: flowActionPublishGrants is not built yet (api-flow-actions)
 Tests  5 failed | 1 passed (6)
$ pnpm exec tsc --noEmit   # exit 0
```

The one that passes at RED ("finds nothing for a v1 flow, or a publisher holding the trigger and
the grant") holds the stub's `[]`, which the built check must keep for those inputs.

GREEN (`flow-actions/target.ts`: `resolveFlowRunTarget(db, env, action, { running })`,
`FlowRunTarget`, `FlowRunTargetRefusal`, `RunWorkflowAction`, shared by the publish and the entry;
`grants.ts`: `flowActionGrantProblems` with codes `workflow_unknown`, `workflow_unpublished`
(at `/flow/steps/<i>/action/version`), `workflow_trigger_invalid` and `workflow_grant_missing`
(at `/flow/steps/<i>/action/workflowId`, naming the missing permissions, never a value), the
publisher's permissions read through Phase 8's `principalPermissions`; `flowActionPublishGrants`
and `flowActionAcknowledgements`):

```
$ pnpm exec vitest run src/flow-actions --coverage.enabled=false   # exit 0
      Tests  25 passed (25)
$ pnpm exec tsc --noEmit   # exit 0
$ pnpm exec eslint src/flow-actions   # exit 0
```

Nothing calls `flowActionPublishGrants` or `flowActionAcknowledgements` yet: `api-templates`' publish
path (`services/inquiry-templates.ts`, its file) requires the acknowledgements beside
`analyzeFlowForPublish`'s and stores the records once a column holds them (report, contract
deviations).

## Slice 5: the flow-failure decision record and its gates (C150.7)

RED (`apps/api/src/flow-actions/failure.test.ts`, PGlite, a sandbox and a production environment):

```
$ pnpm exec vitest run src/flow-actions/failure.test.ts --coverage.enabled=false   # exit 1
 × records the routes, the facts as codes with their tiers, the basis and the contest route
 × counts every route tried before the one taken, and else after all of them
 × writes nothing for a failure reached on verification outcomes only, or by no branch
 × writes nothing for a redacted inquiry
 × sends a production failure without a basis or contest route to review, recorded
 × needs a biometric basis on a biometric path in production, and records the onNull
 × checks the recorded consent for an explicit-consent basis
 FlowActionNotBuiltError: recordFlowFailureInTx is not built yet (api-flow-actions)
 Tests  7 failed (7)
$ pnpm exec tsc --noEmit   # exit 0
```

The RED test was changed once after its commit, before GREEN: its biometric case declared
`biometricBasis: 'contract'`, which the v2 schema refuses (a biometric basis is `explicit-consent` or
`substantial-public-interest`, C128.3), so the test's own flow did not parse; it now declares
`substantial-public-interest`. What it checks is unchanged.

GREEN (`flow-actions/failure.ts`: the routes deciding each branch exit, their `var` paths typed by
`flowScopeAt` for tier and stage, evidence kinds `verification`, `check`, `extraction`, `signal`,
`list-match`, `workflow-output`, `account`, `device`, `field`; Phase 8's `adverseRefusal` for the
gates, then `automated_decision_consent_missing`; written with `createInquiryDecision`, actor
`inquiry-flow`):

```
$ pnpm exec vitest run src/flow-actions --coverage.enabled=false   # exit 0
      Tests  32 passed (32)
$ pnpm exec tsc --noEmit   # exit 0
$ pnpm exec eslint src/flow-actions   # exit 0
```

## Slice 6: flow-action-sweep (C152.2, C150.9, V09)

Placeholder (`99b4d652`): `runFlowActionSweep(deps, { limit })`, `FlowActionSweepDeps`,
`FlowActionSweepResult` in `jobs/repeatable/flow-actions.ts`.

RED (`apps/api/src/jobs/repeatable/flow-actions.test.ts`, on Phase 8's engine harness; the engine's
`advanceFlowInTx` replaced by a recorder, since what it does with an exit is `api-flow-engine`'s):

```
$ pnpm exec vitest run src/jobs/repeatable/flow-actions.test.ts --coverage.enabled=false   # exit 1
 × finishes an entry whose run completed and advances it through next
 × leaves a run still in time waiting
 × cancels a run past its timeout, then takes error with timeout
 × never touches a redacted inquiry
 × logs an entry that fails with ids and a code, and settles it on the next pass
 × ends a branch wait past its maxSeconds, and leaves one still in time
 × runs a pass every 15 s, writing events to the outbox
 FlowActionNotBuiltError: runFlowActionSweep is not built yet (api-flow-actions)
 PermanentJobError: The job cannot succeed (repeatable_job_not_built)
 Tests  7 failed (7)
$ pnpm exec tsc --noEmit   # exit 0
```

The RED test was changed after its commit, before GREEN, for two reasons:
- `waitingOnRun` now runs the entry's `after` (the started run's wake), as the engine does after the
  entering transaction commits; without it the run's first step was never enqueued, so "a run that
  completed" never completed.
- The failure's log key is `reason`, not `code`: the C53.8 lint rule refuses a `code` key in a log
  call (an OTP code's name), so the stable value `flow_action_sweep_failed` is logged as `reason`.

GREEN (`jobs/repeatable/flow-actions.ts`: `runFlowActionSweep`, `FLOW_ACTION_SWEEP_LIMIT` 100,
`FLOW_ACTION_SWEEP_FAILED`, `flowActionSweepJob` a real repeatable job over
`createOutboxOnlyPublisher`; `flow-actions/pinned.ts`: `pinnedFlowV2(db, ref)`):

```
$ pnpm exec vitest run src/worker-flow.test.ts src/jobs/repeatable/flow-actions.test.ts src/flow-actions --coverage.enabled=false   # exit 0
 Test Files  6 passed (6)
      Tests  48 passed (48)
$ pnpm exec tsc --noEmit   # exit 0
```

Existing test changed because the plan changes what it checks: foundation-9a's
`apps/api/src/worker-flow.test.ts` "runs every 15 s as an unbuilt repeatable job, and only with the
flow" asserted the stub's `repeatable_job_not_built`; it keeps the name, schedule and the flow-only
registration, and the passes are this slice's test (the import of `REPEATABLE_JOB_NOT_BUILT` went).

## Slice 7: the flow-signal-snapshot job (C150.9, V06, V09)

RED (`apps/api/src/jobs/flow/signal-snapshot.test.ts`, PGlite; `advanceFlowInTx` replaced by a
recorder):

```
$ pnpm exec vitest run src/jobs/flow/signal-snapshot.test.ts --coverage.enabled=false   # exit 1
 × reads not_yet_collected before the first payload, so the route’s onNull decides (V06)
 × computes a client-collected signal from the payloads stored so far
 × writes each name once, keeping the first value
 × never computes a signal that is not flow-provisional, and waits for the rest
 × writes nothing once the branch’s wait has ended, or for a redacted inquiry
 PermanentJobError: The job cannot succeed (flow_signal_snapshot_not_built)
 Tests  5 failed (5)
$ pnpm exec tsc --noEmit   # exit 0
```

The RED test was changed after its commit, before GREEN: its two payload seeds used
`seedSessionSignalBody`'s default components (`{ integrity: {} }`), which no client can store
(`flowSignalsSchema` requires every integrity member) and which Phase 7's bot score cannot read;
they now seed sandbox outcome bodies (`{ 'sandbox-outcome': 'human' | 'bot' }`, C90.9), as
`jobs/signals/process.test.ts` does, and the payload case asserts a value (a number, null reason
`null`) instead of only "not `not_yet_collected`".

GREEN (`jobs/flow/signal-snapshot.ts`: `processFlowSignalSnapshot`, `NOT_YET_COLLECTED`; the names
filtered to the registry's flow-provisional signals, the entry re-read as the waiting branch entry
under the inquiry's lock, `computeInquirySignals` over `inquirySignalsInputInTx` with `collect` the
names, each value written once with the detail's tier and stage, `collector_missing` of a
client-collected signal written as `not_yet_collected`, and `advanceFlowInTx`
(`signal-snapshot-written`) once every name the job carries is stored):

```
$ pnpm exec vitest run src/jobs/flow src/worker-flow.test.ts --coverage.enabled=false   # exit 0
      Tests  14 passed (14)
$ pnpm exec tsc --noEmit   # exit 0
```

Existing test changed because the plan changes what it checks: `apps/api/src/worker-flow.test.ts`
"fails permanently until api-flow-actions builds it" asserted the stub's
`flow_signal_snapshot_not_built`; it now holds only the processor's half (a permanent failure of the
job becomes BullMQ's `UnrecoverableError`), with a process that fails permanently, and the job
itself is this slice's test.

## Slice 8: the Testcontainers tests of C178.2 (Postgres 17, the real engine)

`apps/api/src/flow-actions/flow-actions.integration.test.ts`, written after slices 3, 6 and 7 were
GREEN and after `api-flow-engine`'s checkpoint "engine" (`35ede768`) landed, so the flow is driven
by the real `positionFlowInTx` and `advanceFlowInTx`: it proves the built behaviour end to end on
Postgres rather than leading a change, and is recorded as such (no RED). One expectation was
corrected while writing it: a provisional snapshot that is written but still `null`
(`not_yet_collected`) does not end the wait at once (the walk waits while a `waitFor` fact is null,
C150.5); the branch follows its own `onNull` at the deadline, ended by the sweep, without review. A
snapshot with values ends the wait at once.

```
$ pnpm exec vitest run --config vitest.integration.config.ts --project api src/flow-actions/flow-actions.integration.test.ts   # exit 0
 ✓ waits on a run that completes, then takes next to completion
 ✓ waits on a run that errors, then takes error to the failure step
 ✓ cancels a run at its timeout, then takes error to the failure step
 ✓ ends one way only when the run completes as the sweep cancels it at its timeout (C151.11)
 ✓ starts nothing on a wider workflow version published after the template
 ✓ lets a branch right after consent follow its own onNull at its deadline, without review (V06)
 ✓ moves the branch as soon as a snapshot with its values arrives within the wait
 ✓ changes nothing when the snapshot arrives after the sweep ended the wait
 ✓ lists the account update_account_fields wrote, in its result and audit entry
      Tests  9 passed (9)
```

Coverage tests added after GREEN (each passed at once; they hold behaviour already built, the
merged API run having shown `failure.ts` at 69.7% and `run-action.ts` at 80.6% of branches):
`failure.test.ts` "names each kind of fact by its path ..." and "writes nothing for a v1 flow, or a
failure step the flow does not have"; `run-workflow.test.ts` "settles nothing for an entry never
entered, and replays a finished one".

```
$ pnpm exec vitest run src/flow-actions --coverage.enabled=false   # exit 0
      Tests  35 passed (35)
```

## Slice 9: copy_extractions (C152.3), after foundation-9a's checkpoint (T)

Started on `CHECKPOINT (T) DONE at b391b69824ec0e0b0f8be2d2b8b92fc372c61697` (its handoff:
`validateInquiryFieldsWrite(db, { kind: 'copy-extractions', environmentId, versionId, inquiryId?,
fields })` in `services/templates/fields.ts`, `api-templates`' to build; accepting every write until
then).

RED (`apps/api/src/flow-actions/run-action.test.ts`, the field rules spied so a refusal can be
staged):

```
$ pnpm exec vitest run src/flow-actions/run-action.test.ts --coverage.enabled=false   # exit 1
 × copies a decided verification’s known values into fields once, audited by key
 × copies from a verification in review too
 × takes error for a verification not decided, failed or absent, and writes nothing
 × takes error with the field rule’s code when the version refuses the write
 × writes nothing, and takes next, when every value is unknown
 FlowActionNotBuiltError: copy_extractions is not built yet (api-flow-actions)
 Tests  5 failed | 8 passed (13)
$ pnpm exec tsc --noEmit   # exit 0
```

GREEN (`flow-actions/instant-actions.ts`: `copyExtractionsInTx`; the scope's
`verifications.<fromStep>` read for its status and attributes; `passed` and `needs_review` are
decided, anything else is `verification_not_decided`; a closed inquiry is `inquiry_not_open`; the
known values merged through `updateInquiry` after `validateInquiryFieldsWrite` (`copy-extractions`),
whose `field_unknown`, `field_write_once` and `fields_too_large` become the error port's code; a
system audit entry `inquiry.updated` with `field-keys`; `run-action.ts` routes the kind to it, and no
action kind is a stub any more):

```
$ pnpm exec vitest run src/flow-actions --coverage.enabled=false   # exit 0
      Tests  40 passed (40)
$ pnpm exec tsc --noEmit   # exit 0
$ pnpm exec eslint src/flow-actions   # exit 0
```

## Final gates (rule 8; this bullet has no checkpoints)

Each read from its exit code; another agent's files moved under every whole-suite run.

| Gate | Result | Load (1 min) |
|---|---|---|
| `pnpm install --frozen-lockfile` | exit 0 | |
| `prettier --check` on the 26 files this bullet wrote or changed | clean | |
| `pnpm turbo run lint typecheck --force --concurrency=1 --filter=@openverify/api --filter=@openverify/db` (4 GB heap) | exit 1: `@openverify/api#lint` on `apps/api/src/services/templates/copy-rules.ts` only (api-templates' uncommitted draft, 6 errors); db lint and typecheck and api typecheck passed (7 m 29 s) | 18.5 → 9.2 |
| `pnpm turbo run typecheck --force --filter=@openverify/api --filter=@openverify/db` | exit 0 | 9.5 |
| `pnpm exec eslint` on every api file of this bullet | exit 0 | |
| `packages/db` test script | exit 0: 140 files, 2,057 tests, 92.63% statements | 8.1 → 24.7 |
| API suite, 4 blob shards and a merge (second run) | merge exit 1 on one test only, `routes/server/inquiry-template-publish.test.ts` (api-templates' committed RED `cf60373e`); 615 files, 8,531 tests, 94.17% statements, 84.85% branches; shards 537, 362, 323, 471 s | 14 to 25 |
| API suite, first run | merge exit 1 on `services/templates/fields.test.ts` only (api-templates' GREEN `1d6c03cb` landed mid-run; the file passes alone since) | 14 to 24 |
| `pnpm --filter @openverify/db test:integration` | exit 0, 78 tests | 10.7 → 23.0 |
| `--project graph` | exit 0, 13 tests | 16.5 |
| `--project api --shard=1/3`, `2/3`, `3/3` | exit 1, 1, 0: 81, 97, 76 tests; the 6 failures are `api.integration.test.ts` (2, `flow_step_not_current` on a flow route) and `handoff-races.integration.test.ts` (4), both on api-flow-engine's current-step refusal, not this bullet's code | 12.7 to 23.3 |
| `flow-actions.integration.test.ts` alone | exit 0, 9 tests, 24.4 s | 21.0 |

`src/flow-actions` 92.17% statements and 82.23% branches, `src/jobs/flow` 97.61% and 82.6%, in the
merged run.

## Handoff (api-flow-actions)

**Entry points** (`apps/api/src/flow-actions/`):
- `runFlowActionInTx(tx, deps: FlowActionDeps, ref, { stepId, entry, action, scope? })` →
  `FlowActionOutcome` (`done {port, errorType, staged, notes?, after?}` or `waiting {retryAfterMs,
  staged, after?, cancelDue?}`), once per entry (the row is the claim; a repeat replays or settles).
  `FlowActionDeps` = `AdvanceFlowDeps` + optional `db`, `ids`, `workflowSteps`, `workflowInFlightCap`.
- `settleFlowActionInTx(tx, deps, ref, entry)`: how a waiting entry stands (session poll, sweep);
  `action_not_entered` for an entry with no row. A `waiting` answer with `cancelDue` past the timeout:
  run `after` (the cancel, outside the lock), then settle again.
- `run-workflow.ts`: `enterRunWorkflowInTx`, `settleRunWorkflowInTx`, `cancelTimedOutFlowRun`
  (Phase 8's `cancelRun`, a system audit entry `workflow-run.canceled` with `reason:
  flow_action_timeout`), `deadlineOf`, `flowEngineDepsOf`, `FLOW_RUN_POLL_MS` 2,000,
  `RUN_WORKFLOW_ERROR_TYPES`: `workflow_not_found`, `workflow_not_running`, `workflow_not_published`,
  `workflow_trigger_invalid`, `workflow_grant_widened`, `scope_unavailable`, `run_errored`,
  `run_canceled`, `run_missing`, `timeout`.
- `target.ts`: `resolveFlowRunTarget(db, env, action, { running })`, `FlowRunTarget`.
- `grants.ts`: `flowActionGrantProblems({ db, environmentId, flow, publisher })` (codes
  `workflow_unknown`, `workflow_unpublished`, `workflow_trigger_invalid`, `workflow_grant_missing`;
  pointers `/flow/steps/<i>/action/{workflowId,version}`), `flowActionPublishGrants(context)` →
  `FlowRunGrantRecord[] { stepId, workflowId, workflowVersionId, scopes, pii, egress }`,
  `flowActionAcknowledgements(context)` → `egress:<step id>` keys.
- `instant-actions.ts`: `tagInquiryInTx`, `flagForReview` (note `flag_for_review:<code>`),
  `updateAccountFieldsInTx` (errors `scope_unavailable`, `account_fields_invalid`,
  `account_missing`, `account_redacted`), `copyExtractionsInTx` (errors `scope_unavailable`,
  `verification_not_decided`, `inquiry_not_open`, and the field rules' `field_unknown`,
  `field_write_once`, `fields_too_large`).
- `workflow-scope.ts`: `flowWorkflowScopeInTx(tx, ref)` → `workflows.<step id>` `{ status
  (completed | errored | canceled | timed-out | null while waiting), error-type, outputs }`, outputs
  from the run's sealed values only when completed.
- `failure.ts`: `recordFlowFailureInTx(tx, { clock, ids? }, ref, { templateVersionId, failureStepId,
  exits })` → `FlowFailureVerdict { outcome: fail | review, decision: DecisionMeta | null,
  errorCode }`. The record: kind `flow-failure`, actor `inquiry-flow` (the inquiry's id),
  `flow { templateVersionId, failureStepId, routes[{ stepId, port, onNull }] }` (branch exits only),
  `solely-automated` true, evidence one per path read `{ kind, id: null, name: <path>, status: null,
  tier, stage, confidence: null }`, the step's basis, contest route and biometric basis, `errorCode`
  `decision_basis_missing`, `biometric_consent_missing` (Phase 8's `adverseRefusal`) or
  `automated_decision_consent_missing`.
- `copies.ts`: `flowActionCopyTargets(db, ref)`; `pinned.ts`: `pinnedFlowV2(db, ref)`.

**Jobs.** `jobs/repeatable/flow-actions.ts`: `runFlowActionSweep(deps, { limit })` →
`{ settled, canceled, waitsEnded, failed }`, `FLOW_ACTION_SWEEP_LIMIT` 100,
`FLOW_ACTION_SWEEP_FAILED` (logged as `reason` with the ids), `flowActionSweepJob(deps)` every
15 s over `createOutboxOnlyPublisher`. `jobs/flow/signal-snapshot.ts`: `processFlowSignalSnapshot(job,
deps)` → `{ outcome: written | skipped, written }`, `NOT_YET_COLLECTED`.

**For integration-9a's specs.** `run_workflow`: publish a workflow version with trigger type
`trigger-flow` (empty config); a `latest-published` target runs only on a grant no wider than the
one the template's publish recorded, and with no record that is no scope and no PII (see the
report's deviation on the missing column), so the 9A spec should pin `version: wfv_…` or use a target
whose grant is empty; the run's outputs reach `workflows.<step id>.outputs.<name>` once it
completes and the sweep (15 s) or the session poll settles it. Signals: a branch on
`signals.inquiry/bot_score` right after consent snapshots `not_yet_collected` and waits until its
`maxSeconds`, then follows its own `onNull`; a sandbox body with `sandbox-outcome` gives a value
(bot 95, human 5) and moves the branch at once.
