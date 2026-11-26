# Phase 9, Workflow 9A Stage 1b: foundation-9a (plumbing)

Evidence for `foundation-9a`'s deliverables, in the order the plan's bullet sets them: (0) the CI
measurement, then the checkpoints (S), (T), (F), (H), (A11Y) and (OPENAPI). Every command below was
run after `source scripts/env.sh`; outputs are abbreviated, exit codes are read from the command.

## (0) CI's real jobs at the Phase 9 base

### The measurement

The latest green run of `main` is CI 41802158981 (2026-11-04, `3cc18901`, Phase 8 done), read with
`gh run view 41802158981 --json jobs` (no run started, rule 21). `ci.yml` has not changed since that
run (`git log 3cc18901..HEAD -- .github/workflows/ci.yml` is empty; `turbo.json` gained only
`pnpm-workspace.yaml` in `@openverify/config#test`'s inputs), so no job's commands changed and none
is re-measured locally.

| Job | Time | Timeout | Last 25% starts at | Split? |
|---|---|---|---|---|
| node (typecheck, unit tests but api and dashboard) | 21.2 min | 25 | 18.75 | **yes** |
| unit-api shard 1 / shard 2 | 25.2 / 14.2 min | 40 | 30 | no |
| unit-api-coverage | 0.8 min | 20 | 15 | no |
| unit-dashboard | 9.0 min | 20 | 15 | no |
| lint | 8.6 min | 30 | 22.5 | no |
| integration | 13.8 min | 30 | 22.5 | no |
| e2e (mocked flow suite and full stack) | 17.1 min | 70 | 52.5 | no |
| vision | 9.6 min | 30 | 22.5 | no |
| android / android-instrumented | 8.9 / 7.2 min | 45 / 60 | | no |
| infra / format / secrets | 1.4 / 1.9 / 0.4 min | 10 | | no |

node's steps: typecheck 4.0 min, unit tests 16.7 min. Inside the unit-test step (turbo runs every
package at once on the runner's four cores), the vitest durations were: db 994.5 s, watchlist 770.4 s,
flow 728.2 s, checks 388.4 s, contracts 290.2 s, workflow-engine 275.2 s, emrtd 136.4 s, core 124.8 s,
signals 116.4 s, ui 97.9 s, node 73.3 s, e2e 43.5 s, flow-spec 32.7 s, config 29.5 s.

The split: db and watchlist leave node for a new job, `unit-db` (25 minutes), so node keeps the
typecheck (same heap and concurrency) and every other package's tests, and `infra/tests/ci-workflow.test.sh`
checks that node, unit-api, unit-dashboard and unit-db together test every package exactly once.

### RED

```
$ bash infra/tests/ci-workflow.test.sh   # exit 1
FAIL - job 'unit-db' exists
FAIL - node: runs every package's unit tests except the split ones (excluded ['@openverify/api', '@openverify/dashboard'])
FAIL - unit-db: installs with a frozen lockfile
FAIL - unit-db: runs the @openverify/db and @openverify/watchlist unit tests, and only those (runs [])
FAIL - unit-db: uploads its coverage reports
FAIL - unit-db: the job's timeout keeps the db suite's 16.6 minutes out of the last 25% (at least 25) (None)
# 219 passed, 6 failed, 0 skipped
```

### GREEN

`ci.yml`: node's unit-test step filters out db and watchlist too; the new `unit-db` job (25 minutes)
runs `pnpm turbo run test --filter=@openverify/db --filter=@openverify/watchlist` and uploads both
coverage folders. Typecheck stays in node with `--concurrency=2` under the 4 GB heap; lint is unchanged.

```
$ bash infra/tests/ci-workflow.test.sh   # exit 0
# 227 passed, 0 failed, 0 skipped
```

Local run of unit-db's command, under the e2e lock (12 cores here against CI's 4, so this shows the
command works, not CI's time): `pnpm turbo run test --force --filter=@openverify/db --filter=@openverify/watchlist`
exit 0 in 7 min 9 s (load 0.13 at start, 5.09 at the end); db 201.7 s (92.57% statements), watchlist 427.6 s
(98.63%). The CI time after the split is read at the Workflow's push (integration-9a re-measures, rule 21):
node is estimated at its 4.0 minutes of typecheck plus its remaining packages' step, whose longest suite
(flow, 728 s beside db and watchlist) bounds it, about 15 minutes of 25; unit-db at about 13 of 25.

## Checkpoint (S): the spec and the server engine's plumbing

### PGlite migration time (Risks), each under the e2e lock

The timer (`createTestDatabase` twice in one process through `tsx`): `firstMs` the first database of
a process, cold with an empty `OPENVERIFY_TEST_DB_CACHE_DIR`, warm from the cached template;
`secondMs` a second copy in the same process.

| | Cold, first | Warm, first | Second | Load (1 min) |
|---|---|---|---|---|
| Before, at `546a474f` (0030 = Stage 1a's seven CHECKs) | 4,921, 5,459, 4,733 ms | 1,443, 1,436, 1,274 ms | 872 to 1,220 ms | 3.4 to 4.4 |
| After (S), at `fca9a642` | 4,805, 4,760, 4,756 ms | 1,155, 1,216, 1,620 ms | 852 to 1,094 ms | 6.3 to 9.5 |

The three tables, eight columns and their CHECKs cost nothing a hook would notice; the 120 s hook
budget is untouched.

### Database (packages/core, packages/db)

RED (`446af90a`, the tables and repositories declared in TypeScript, the migration not yet
extended):

```
$ pnpm exec vitest run src/phase9a-flow-tables.test.ts src/migration-0030.test.ts --coverage.enabled=false   # exit 1
 × starts with no position, no first device and no outcome          error: column "flow_step_id" of relation "inquiries" does not exist
 × holds a position, a device kind, a platform and an outcome ...   (the same)
 × seals the fields given at creation for the row, and reads them back
 × lists the column for the rewrap, and kek:rewrap re-wraps it
 × keeps codes in their forms, and an exit, an error and a finish coherent
 × belongs to its inquiry: another environment cannot hold a row of it
 × carries its flow path, and only a flow failure does
 × nulls the initial fields and deletes the inquiry's flow records, and only its own
 × leaves an inquiry made before it with no position ...           error: column "flow_step_id" does not exist
 × leaves a decision made before it with no flow path ...          error: column "flow" does not exist
 × adds the step record, the action rows and the signal snapshots ... error: relation "inquiry_flow_steps" does not exist
 Tests  11 failed | 6 passed (17)
```

GREEN (`4ca0ac3a`, `0030_phase9a` regenerated by the amendment-17 recipe: core built, the file, its
snapshot and journal entry 30 removed, `drizzle-kit generate --name phase9a`, the journal's newline
back, prettier on the snapshot; Stage 1a's 0030 had no hand edits and this one has none):

```
$ pnpm exec vitest run src/phase9a-flow-tables.test.ts src/migration-0030.test.ts src/schema.test.ts src/testing.test.ts --coverage.enabled=false   # exit 0
 Test Files  4 passed (4)
      Tests  242 passed (242)
```

`testing.test.ts`'s table list gained the three tables (an existing test changed because the plan
adds tables). The checkpoint gate then found two more existing tests that list every encrypted
column (`schema-v2.test.ts`) and seed one value per column for the rewrap (`key-rotation.test.ts`);
both failed once `initial_fields` was listed and were changed for it (`fca9a642`).

### API (apps/api, packages/contracts)

RED (`62e59e22`): the tests with the stubs, the queue, the job and the sweep, and the route files,
over the shared files as they were (each hook-placement file at its previous commit):

```
$ pnpm exec vitest run src/phase9a-flow-plumbing.test.ts src/worker-flow.test.ts --coverage.enabled=false   # exit 1
 × lets the inquiry-signals job compute the signals of an inquiry pinned to a v2 flow     ZodError (storedFlow parsed v1 only)
 × asks for the current step and advances on consent, under the inquiry lock             expected "vi.fn()" to be called with arguments
 × refuses a consent the current step does not take, and records nothing                  expected 201 to be 409
 × asks for the current step before a verification is created                             expected "vi.fn()" to be called with arguments
 × refuses a template whose run_workflow grant the publisher lacks, at its pointer        expected 201 to be 422
 × publishes as before when the grants hold                                               called 0 times
 × names the accounts in its result and audit entry, read before the rows are deleted     expected undefined to deeply equal [ { …(2) } ]
 × answers 501 for a screen submission until api-flow-engine builds it                    expected 404 to be 501
 × answers 501 for a selfie capture extension until api-flow-engine builds it             expected 404 to be 501
 × needs a session token on both                                                          expected 404 to be 401
 × keeps the fields an inquiry is created with as its initial fields                      expected null to deeply equal { name_first: 'Alexis', ... }
 × masks a screen submission's values and the initial fields wherever a log keeps them    expected [ 'fields', 'note', … ] to contain
 × moves nothing and accepts everything                                                   (a once-rejection the unplaced hook never consumed)
 Tests  13 failed | 15 passed (28)
```

`worker-flow.test.ts` (9 tests) passed at RED: the worker's registration landed in the RED commit with
the job and the queue it registers, so it is a test of that commit, written with it.

GREEN (`2a0d2f54`, then `7916dec4` and `53908fbd` for lint and format):

```
$ pnpm exec vitest run src/phase9a-flow-plumbing.test.ts src/worker-flow.test.ts src/routes/flow src/jobs/signals src/services/retention.test.ts src/retention-run.test.ts --coverage.enabled=false   # exit 0
 Test Files  29 passed (29)
      Tests  447 passed (447)
```

Existing tests changed because the plan changes what they check: `jobs/records.test.ts` (an
`Inquiry` literal gains the seven flow columns as `null`), `services/context.test.ts`
(`flowSignalSnapshots` joins the dependency keys), `services/retention.test.ts` and
`retention-run.test.ts` (the report's `cleanedFlowRecordInquiries`),
`routes/flow/handoff-consent.test.ts` (it read `storedFlow`, which is gone; it reads
`storedFlowView`).

### Gates of checkpoint (S), each read from its exit code (`<prev>` = `e353621e`)

| Gate | Result | Time | Load (1 min) |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | exit 0 | | |
| `openapi:write` twice (the screen and extension routes registered) | exit 0, sha256 `d39a9a1a…6e97` both runs | | |
| `prettier --check --ignore-path=.gitignore` on every changed file | clean but three `services/` files already unformatted at `e353621e` (lines not mine, left as they are) | | |
| `pnpm turbo run typecheck --force --concurrency=2 --filter='...[e353621e]'` | exit 0, 16 tasks | | 4.5 |
| `pnpm turbo run lint --force --concurrency=2 --filter='[e353621e]'` | exit 0, 8 tasks | | 5.2 |
| core, contracts test scripts | exit 0; 99.84%, 99.19% statements | | 1.3 to 10.0 |
| db test script | exit 0 (after `fca9a642`); 92.61% statements | 2 m 38 s | 5.8 |
| API, blob shards 1-4 and the merge | merge exit 0: 588 files, 8,289 tests, 94.85% statements, 85.90% branches | 233, 245, 237, 213 s | 7.6 to 11.1 |
| `pnpm --filter @openverify/db test:integration` | exit 0, 78 tests | 93 s | 5.9 |
| `--project graph` | exit 0, 13 tests | 35 s | 14.7 |
| `--project api --shard=1/3`, `2/3`, `3/3` | exit 0: 75, 91, 75 tests | 64, 169, 71 s | 9.5, 14.2, 7.2 |
| `infra/tests/ci-workflow.test.sh` | exit 0, 227 passed | | |
| `infra/tests/compose.test.sh --static-only` | exit 0, 505 passed | | |
| `infra/tests/flow-headers.test.sh --static-only` | exit 0, 2 passed | | |

CHECKPOINT (S) DONE at fca9a6420fe7a19d63e94df7e0e72a43b0ed07c8

Handoff ((S)):
- **Migration.** `packages/db/drizzle/0030_phase9a.sql` (one file for 9A; extend it, never add 0031).
  `inquiries` gains `flow_step_id`, `flow_state` (`active`, `waiting`, `halted`, `ended`),
  `flow_previous_step_id`, `flow_spec_version` (smallint, 1 or 2), `first_device_kind`
  (`desktop-web`, `mobile-web`, `native`), `first_platform` (`web`, `android`), `flow_outcome` (jsonb
  `{ verificationTypesOnPath, fallbacksTaken, flags }`), `initial_fields` (sealed, AAD
  `inquiries.initial_fields#<inquiry id>`), CHECKs `inquiries_flow_state_valid`,
  `inquiries_flow_spec_version_valid`, `inquiries_flow_step_id_format` (both step-id columns,
  `^[a-z][a-z0-9_-]{0,63}$`), `inquiries_first_device_kind_valid`, `inquiries_first_platform_valid`,
  and the partial index `inquiries_flow_waiting_idx (environment_id, id) where flow_state = 'waiting'`.
  `inquiry_decisions.flow` (jsonb `{ templateVersionId, failureStepId, routes[{ stepId, port, onNull }] }`)
  with `inquiry_decisions_flow_coherent` (present exactly on `flow-failure`). Vocabularies in
  `@openverify/core` (`packages/core/src/flow-records.ts`): `FLOW_RECORD_STATES`,
  `FLOW_RECORD_DEVICE_KINDS`, `FLOW_RECORD_PLATFORMS`, `FLOW_RECORD_SPEC_VERSIONS`,
  `FLOW_ACTION_ROW_STATUSES` (`running`, `completed`, `errored`), `FLOW_RECORD_CODE_PATTERN`
  (`^[a-z][a-z0-9_:-]{0,127}$`), `FLOW_RECORD_STEP_ID_PATTERN`.
- **Tables** (`packages/db/src/tables/inquiry-flow.ts`, rows typed `InquiryFlowStepRow`,
  `InquiryFlowActionRow`, `InquiryFlowSignalSnapshotRow`), each with `(environment_id, inquiry_id)`
  to `inquiries` on delete cascade: `inquiry_flow_steps` (pk `(environment_id, inquiry_id, seq)`;
  `step_id`, `step_type`, `entered_at`, `exited_at`, `exit_port`, `outcome`, `waited_ms`,
  `sensitive` default false, `notes text[]`; CHECKs: seq > 0, formats, `exited_at` null exactly when
  `exit_port` is); `inquiry_flow_actions` (pk `(environment_id, inquiry_id, step_id, entry)`;
  `workflow_run_id` (`wfr_`, no FK), `status`, `error_type` (set exactly when `errored`),
  `target_account_id` (`acc_`), `copied_keys text[]`, `entered_at`, `finished_at` (null exactly when
  `running`); partial index `inquiry_flow_actions_running_idx (entered_at) where status = 'running'`);
  `inquiry_flow_signal_snapshots` (pk `(environment_id, inquiry_id, step_record_seq, name)`; FK
  `(environment_id, inquiry_id, step_record_seq)` to the step record, cascade; `value` jsonb,
  `tier`, `stage`, `null_reason` (set exactly when `value` is null), `computed_at`).
- **Repository stubs** (export lines in `packages/db/src/repositories/index.ts`; each rejects with
  `FlowRepositoryNotBuiltError` from `flow-repository.ts` naming its owner):
  `inquiry-flow-steps.ts` (`api-flow-engine`): `appendInquiryFlowStepInTx(tx, env, NewInquiryFlowStep)`,
  `exitInquiryFlowStepInTx(tx, env, inquiryId, seq, InquiryFlowStepExit)`,
  `listInquiryFlowSteps(db, env, inquiryId)`; `inquiry-flow-actions.ts` (`api-flow-actions`):
  `insertInquiryFlowActionInTx`, `finishInquiryFlowActionInTx(tx, env, { inquiryId, stepId, entry },
  InquiryFlowActionFinish)`, `listRunningInquiryFlowActions(db, { enteredBefore, limit })`,
  `listInquiryFlowActionCopies(db, env, inquiryId)`; `inquiry-flow-signal-snapshots.ts`
  (`api-flow-actions`): `insertInquiryFlowSignalSnapshotsInTx(tx, env, { inquiryId, stepRecordSeq },
  NewInquiryFlowSignalSnapshot[])`, `listInquiryFlowSignalSnapshots(db, env, key)`. Built, not stubs:
  `createInquiry`'s `initialFields` (sealed, empty means none), `getInquiryInitialFields(db, env, id)`,
  `NewInquiryDecision.flow`, `deleteInquiryFlowRecordsInTx(tx, env, inquiryIds)` (in `redaction.ts`),
  `deleteFlowRecordsOfRedactedInquiries(db, options)` (in `retention.ts`). `Inquiry` (the row type
  repositories return) carries the seven flow columns and never `initialFieldsSealed`.
- **Coverage lists.** `ENCRYPTED_COLUMNS` gains `inquiries.initial_fields` (row); `SEALED.inquiryInitialFields`;
  `inquiries` was already in `REWRAP_TABLES`, so `kek:rewrap` re-wraps it (tested).
  `redactInquiryRecords` nulls `initial_fields` and deletes the inquiry's step records, action rows and
  snapshots; the C16 pass's `cleanedFlowRecordInquiries` step deletes any a redacted inquiry still
  holds. `PII_MASKED_ATTRIBUTES` gains `values` (`PII_FLOW_SCREEN_ATTRIBUTES`) and `initial-fields`.
- **Hooks, each a call in a shared file to a stub in an owned file** (until built each behaves as before):
  - `apps/api/src/flow-engine/advance.ts` (`api-flow-engine`): `advanceFlowInTx(tx, deps: AdvanceFlowDeps,
    inquiry: FlowInquiryRef, exit: FlowExit): Promise<FlowAdvance>`, with `FlowAdvance { staged, after }`,
    `NO_FLOW_ADVANCE` and `runFlowAfterCommit(advance)`; `AdvanceFlowDeps { events, clock,
    flowSignalSnapshots? }`; `FlowExit` kinds `consent-recorded`, `verification-decided` (with
    `origin: 'flow' | 'workflow-action'`), `screen-submitted`, `action-finished`,
    `signal-snapshot-written`, `wait-elapsed`, `handoff-resolved`. Call sites: `jobs/process-verification.ts`
    (the decision transaction and `failVerificationAfterError`'s; the staged events dispatched and
    `runFlowAfterCommit` run after commit), `jobs/types/aamva.ts` (the silent attempt skipped; its after-commit
    work travels as `InquiryDecisionHookResult.flowAfter`, run by `afterDecision`),
    `workflows/actions/verifications/run-verification.ts` (sandbox `debug-forced-status`, `origin:
    'workflow-action'`), `services/flow.ts` `recordConsent` (now one transaction under the inquiry lock),
    `services/handoff/flow-handoffs.ts` (`continueHandoffHere`, `rejectCurrentHandoff`, `declineHandoff`,
    `redeemHandoff`).
  - `flow-engine/current-step.ts`: `assertCurrentStepInTx(tx, inquiry, attempt: FlowStepAttempt)`
    (kinds `consent`, `verification`, `upload`, `submission`, `screen`, `handoff` with `issue`,
    `continue-here`, `redeem`, `reject`, `decline`), called after the inquiry lock in `recordConsent`,
    `createFlowVerification`, `uploadFile`, `submitVerification` and the five handoff paths above (issue too).
  - `flow-engine/required.ts`: `requiredVerificationsForInquiry(tx, inquiry, flow)` in `settleInquiry`
    (`services/inquiry-settlement.ts`), answering `requiredVerifications(flow)`.
  - `flow-engine/initial-fields.ts`: `comparisonSourceFor(db, inquiry): Promise<ComparisonSource
    { fields, sources }>` in `jobs/government-id.ts` (`referencesOf`) and `jobs/types/database.ts`.
  - `flow-engine/selfie-extension.ts`: `extendSelfieCapture(deps, session, captureId):
    Promise<SelfieCaptureDocument>`, behind `POST /api/v1/flow/selfie-captures/:id/extend` (frozen in
    `routes/flow/index.ts`; params `extendSelfieCaptureParamsSchema`, 200 `selfieCaptureDocumentSchema`),
    501 until built.
  - `apps/api/src/flow-actions/` (`api-flow-actions`): `grants.ts`
    `flowActionGrantProblems({ db, environmentId, flow: AnyFlow, publisher: AuditActor }):
    Promise<FlowActionGrantProblem[]>`, called in `assertPublishable` (`services/inquiry-templates.ts`) before
    the publish hooks, each problem a 422 at `/data/attributes<pointer>`; `run-action.ts`
    `runFlowActionInTx(tx, deps, inquiry, { stepId, entry, action }): Promise<FlowActionOutcome>` (rejects
    `FlowActionNotBuiltError`); `run.ts` `startFlowRunInTx(tx, engineDeps, StartFlowRunInput)` (built:
    Phase 8's `startWorkflowRunInTx` with `triggerType: 'trigger-flow'`, creator `{ type: 'inquiry-flow',
    id: inq_ }`, `trigger` and `inputs` the declared inputs, `subjectIds: [inquiryId]`,
    `causedByPrincipal: null`, idempotency key `flowRunKeyOf` = `inquiry-flow:<inq>:<step>:<entry>`);
    `signal-snapshot.ts` `requestSignalSnapshot(queue, FlowSignalSnapshotJob)` (built: enqueues);
    `copies.ts` `flowActionCopyTargets(tx, { environmentId, inquiryId }): Promise<FlowActionCopyTarget[]>`,
    read by `services/redaction.ts` before `redactInquiryRecords`; its targets reach
    `RedactionResult.flowCopyTargets` and the `inquiry.redacted` audit metadata `flow-copy-account-ids`.
  - `flow-engine/stub-inputs.ts` `stubInputs(...)`: how a stub keeps its whole signature under lint.
- **Queue and jobs.** `apps/api/src/jobs/flow-queues.ts`: `FLOW_SIGNAL_SNAPSHOT_QUEUE`
  (`flow-signal-snapshot`, one job per branch entry, id `<inq>-<seq>`, `FLOW_SIGNAL_SNAPSHOT_JOB_OPTIONS`),
  `createFlowSignalSnapshotQueue`, `FLOW_ACTION_SWEEP_QUEUE` (`flow-action-sweep`),
  `FLOW_ACTION_SWEEP_INTERVAL_MS` (15 s). Ports: `FlowSignalSnapshotJob { environmentId, inquiryId,
  stepRecordSeq, names }`, `FlowSignalSnapshotQueue`. `ApiDependencies.flowSignalSnapshots` (the
  container builds it), `ProcessVerificationDeps.flowSignalSnapshots`, `StartWorkersOptions.flow:
  WorkerFlowOptions { signalSnapshots, processSignalSnapshot? }` (the worker's `main` passes it).
  `apps/api/src/jobs/flow/signal-snapshot.ts` (`api-flow-actions`): `processFlowSignalSnapshot(job,
  deps: FlowSignalSnapshotDeps)` (= `InquirySignalsDeps`: db, clock, logger, events, keyring,
  blindIndexKey, networkSnapshots), failing permanently with `flow_signal_snapshot_not_built`; the worker
  registers it through `flowSignalSnapshotProcessor`. `apps/api/src/jobs/repeatable/flow-actions.ts`
  (`api-flow-actions`): `flowActionSweepJob(deps)` = `unbuiltRepeatableJob`, registered by
  `phase9RepeatableJobs(deps, flow)` in `jobs/repeatable/index.ts` whenever the worker has `flow`.
- **Signals input.** `apps/api/src/jobs/signals/input.ts`: `inquirySignalsInputInTx(tx, inquiry, collect,
  { environment, computedAt }): Promise<InquirySignalsInput>` (the `inquiry-signals` job's reads, moved
  unchanged; the snapshot job calls it).
- **Stored-flow reader.** `apps/api/src/services/stored-flow.ts`: `storedAnyFlow(flow)`,
  `storedFlowView(flow)` (v1 as stored; v2 as its v1-typed steps without the additive members, no
  `screen`, `branch` or `action`, no transitions), `safeStoredFlowView(flow)`, `flowViewOf(parsed)`.
  `storedFlow` is gone; all 16 readers moved (template resources read `storedAnyFlow`).
- **Routes.** `routes/flow/screens.ts` (`api-flow-engine` owns it): `POST /api/v1/flow/screens/:stepId/submit`
  (params `flowScreenParamsSchema`, now `{ stepId }`; body `submitFlowScreenBodySchema`; 200
  `flowSessionResponseSchema`), 501 until built, registered in `routes/flow/index.ts`. The OpenAPI
  snapshot holds both new routes.
- **Initial fields.** `createInquiryInTx` (`services/inquiries.ts`) passes the create body's `fields` as
  `initialFields`.

## Checkpoint (T): templates, versions, copy and translations

Resumed after the first run stopped at the usage limit (2026-11-05). Committed before the stop:
`cfe9dc62` (RED) and `7ff2160c` (GREEN), the C154.1 version members, deployments, promotions and
simulation presets in `0030`; `84515fbe` (RED) and `b4ea03e5` (GREEN), the frozen routes, the two
policies, the session copy and theme hooks, the consent text check and the fields check;
`9358872a`, the OpenAPI snapshot. Added in this run:

- `e6e185af` (written after their GREEN; a mutation of `MASKED_MEMBERS` and the field-default
  masking turns both red): the simulate scope and a preview field default masked in the stored log
  a reader without `pii:view` reads, per route; the preset routes answering 501 to an operator and
  401 without a session (`routes/dashboard/simulation-presets-frozen.test.ts`; no test held them).
- `b391b698`: the redaction coverage test (`services/redaction.test.ts`, "seeds every encrypted
  table except operator data") failed once `simulation_presets` was encrypted; it gains
  `SIMULATION_PRESET_TABLES` (a user's preset goes with its user, no subject redaction reaches it).

```
$ pnpm exec vitest run src/phase9a-template-plumbing.test.ts --coverage.enabled=false    # exit 0, 25 passed
$ (mutation: PII_SIMULATION_PRESET_ATTRIBUTES and maskFieldDefault removed) -t "route by route"   # exit 1
     × keeps no simulated scope value of a simulate body in the log a reader without pii:view reads
     × keeps no field default of a preview body in the log, and keeps the field's configuration
```

PGlite (A/B of the migration folders at `fca9a642` and after (T), one process each, migrate then
dump, under the e2e lock): load 13 to 15: 11.6, 13.5, 13.7 s before against 12.4, 11.6, 11.5 s after;
load 1.3 to 1.6 (the clean measure): 4,472 and 4,489 ms before against 4,473 and 4,470 ms after.
`createTestDatabase` after (T) at load 9 to 10: cold 8.7, 9.7, 10.1 s, warm 1.9, 2.0, 2.5 s.

## Checkpoint (F): the flow client, its server, the preview and the embed

| Slice | RED | GREEN | Evidence |
|---|---|---|---|
| db: `files.capture_method`, `inquiries.redirect_uri`, embedding settings typed | `299b24bb` | `21a6d4c2` | RED 6 failed (`column "redirect_uri" does not exist`); GREEN 241 passed (4 files) |
| api: internal embed-policy route, token, `internal-embed-policy`, settings, redirect check, config | `62778136` (stubs), `fd2b5ca3` | `8bcaebda` | RED 13 + 3 failed (404 for 401, defaults, policy); GREEN 183 + 127 passed |
| infra: `.env.example` and compose variables | `526ea3c4` (run against the previous `.env.example`: 8 failed) | `8bcaebda` | `compose.test.sh --static-only` 515 passed |
| flow: `csp-policy.ts` | refactor `0739c397` (tests unchanged, 173 passed) | | |
| flow: server skeleton, tsconfig, preview input, slots, registries | `197986bf` (stubs), `1217a340` | `e0e39dfe`, `3bffe05a` | RED 7 failed (no `server.ts`, no input, no slot, registry not applied); GREEN flow 1,275 tests, 95.46% |
| config and sdk-js skeleton, CI node coverage | `5880ad48` (6 + 1 failed) | `2d7a7231` | config 61 passed; `ci-workflow.test.sh` 228 passed; `@openverify/js` 100% |

```
$ node --conditions=@openverify/source apps/flow/server.ts --help    # exit 0, stderr empty (V04: Node strips types through the workspace link)
Usage: node --conditions=@openverify/source apps/flow/server.ts [--help]
...  /embed/<id>   the embedded flow, framed by the inquiry's embed policy (at most 50 embed origins), else by nothing
$ flock /tmp/openverify-e2e.lock pnpm --filter @openverify/flow e2e    # exit 0, 80 passed (24.8 s; one earlier pass had
                                                                       #  crypto-wallet.spec.ts:134 fail once, see the report)
```

Existing tests changed because the plan changes what they check: `contracts/dashboard-api.test.ts`
and `phase9a-flow.test.ts` (the served defaults gain the embedding settings), `plugins/rate-limit.test.ts`
(the new policy), `services/context.test.ts` (the new dependency key), `jobs/records.test.ts` (the
`Inquiry` literal gains `redirectUri`), `db/migration-v5.integration.test.ts` (its Phase 4 files are
seeded by SQL, since the repository insert names `capture_method`), `config/workspace-conventions.test.ts`
(a package may be published under another name: `sdk-js` is `@openverify/js`), and `phase9a-flow-plumbing.test.ts`
(`a6eae08c`: it leaves the screen submission, the extension and `comparisonSourceFor`, which
`api-flow-engine` built and its own suites hold).

PGlite A/B, (T) against (F): load 12 to 15: 9.6, 8.8, 5.1 s against 11.2, 6.4, 5.0 s; load 1.3 to 1.6:
4,473 and 4,470 ms against 4,448 and 4,527 ms. `createTestDatabase` after (F), load 10: cold 5.3,
7.8 s, warm 1.3, 2.4 s.

## Checkpoint (H): theme plumbing

| Slice | RED | GREEN |
|---|---|---|
| db: `theme_sets`, `theme_set_revisions`, `theme_assets`, `inquiries.theme_set_id`, `default-theme-set-id` | `0baadf2f` (7 failed: relations missing) | `f9ef0ce4` (310 passed, 6 files) |
| api and flow: frozen routes, `theme-assets` policy, the hooks, the slot | `896d9653` (stubs), `07d04cea` (15 + 2 failed) | `c84c1eda` (123 + 16 passed), `1d023c55` (OpenAPI) |

PGlite A/B, (F) against (H), load 0.8 to 1.6: 4,523, 4,673, 4,511 ms against 4,524, 4,513, 4,554 ms
(and 4,527 and 4,448 against 4,515 and 4,514 in the second pass). `createTestDatabase` after (H),
load 1.3: cold 4,836 and 4,828 ms, warm 1,171 and 1,143 ms. The 120 s hook budget is untouched.

## Checkpoint (A11Y): accessibility test plumbing

`a946fc2a` (the pure half placeholders and the mocked helper placeholder), `8124c855` (RED: 5 failed
in `config/src/axe.test.ts`; the mocked spec 2 failed), `e0923cf1` (GREEN: 7 passed; the mocked spec 3
passed in 4.4 s, load 1.5). The spec's own expectation was corrected before the GREEN commit: axe
names the image `img`, its unique selector, not `img.logo`.

## The final gate (at `e0923cf1`), each read from its exit code

| Gate | Result | Time | Load |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | exit 0 | | |
| `openapi:write` twice | exit 0, sha256 `aba98161…5f67` both runs, no diff | | |
| `pnpm format:check` | exit 0 | | |
| `pnpm turbo run typecheck --force --concurrency=2` (4 GB heap) | exit 0, 17 tasks | 2 m 37 s | 1.7 |
| `pnpm turbo run lint --force` (4 GB heap): all but api `--concurrency=2`, then api alone | exit 0, 16 tasks; exit 0, 1 task | 4 m 18 s; 2 m 42 s | 2.6; 2.1 |
| `pnpm turbo run test --force --concurrency=3 --filter='!@openverify/api'` | exit 0, 16 of 16 (each package ≥ 80%: db 92.71%, flow 95.44%, js 100%, config 97.22%) | over 10 min | 2.9 to 38 |
| API, blob shards 1-4 and the merge | **merge exit 1**: 608 files, 8,472 tests, 8,454 passed, 18 failed, all 18 in `routes/flow/session-flow.test.ts` (`api-flow-engine`'s RED commit `61443e18`, whose GREEN is not committed); 94.52% statements, 85.27% branches | 3.9, 4.2, 3.7, 3.4 min | 2.5 to 8.2 |
| `pnpm --filter @openverify/db test:integration` | exit 0, 78 tests | 81 s | 6.2 |
| `--project graph` | exit 0, 13 tests (template 15.9 s) | 33 s | 6.2 |
| `--project api --shard=1/3`, `2/3`, `3/3` | **exit 1, 1, 0**: 79 + 2 failed, 93 + 4 failed, 76 passed; the six are `api.integration.test.ts` (2) and `services/handoff/handoff-races.integration.test.ts` (4), each refused `flow_step_not_current` by `api-flow-engine`'s current-step check (`87e507f9`); they failed the same way at my first (T) attempt, before any (F) commit | 57 s, 153 s, 69 s | 11.3, 13.3, 7.3 |
| `infra/tests/ci-workflow.test.sh`, `compose.test.sh --static-only`, `flow-headers.test.sh --static-only` | exit 0: 228, 515, 2 passed | | |
| mocked flow suite | exit 0, 83 passed | 23.8 s | 11.0 |
| fresh stack: down and `turbo run build --filter=@openverify/e2e^...`; up | exit 0 (5 tasks); exit 0 | ; 2 m 13 s | 5.9 |
| full stack shards 1/3, 2/3, 3/3, then down | **exit 0, 0, 1**: 46 passed (4.7 min), 46 passed (5.2 min), 42 passed, 1 failed, 2 did not run (4.5 min); the failure is `ui-reviewer.spec.ts:68`, whose `createVerification` was refused `flow_step_not_current` (the same `api-flow-engine` check); down exit 0 | | 3.2, 2.2, 2.7 |

Every failing gate fails only in `api-flow-engine`'s in-progress work (its RED test commit, and its
current-step refusal in three shared tests that create a verification before the flow reaches it),
none in a path these checkpoints changed; the report names them as blockers for `api-flow-engine`
and `integration-9a`.

## Checkpoint lines

Each line below is written after its gates ran. Every gate exited 0 except the three named in the
final gate's table, each failing only in `api-flow-engine`'s in-progress work and in no path these
checkpoints touch; the builders of (T), (F) and (H) build in files none of those failures reads.

CHECKPOINT (T) DONE at b391b69824ec0e0b0f8be2d2b8b92fc372c61697

Handoff ((T)):
- **Migration** `0030_phase9a` (one file for 9A; extend it, never add 0031). `inquiry_template_versions`
  gains the C154.1 members (`field_schemas` `[]`, `copy` `{}`, `enabled_locales` `['en']`,
  `default_locale` `'en'`, `theme_set_id`, `embed_origins` `[]`, `redirect_uri`, `redirect_uri_schemes`
  `[]`, `redirect_include_status` false, `help_url`, `privacy_url`, `description`, `publish_note`,
  `last_updater` (jsonb `{ type, id }`), `validation`, `acknowledgements` `[]`, `flow_sha256`), with
  their CHECKs; tables `deployments` (`dply_`, one per publish, `source_deployment_id`, creator),
  `inquiry_template_promotions`, `simulation_presets` (`ssp_`, `scope` sealed for the row,
  `SEALED.simulationPresetScope`, in `ENCRYPTED_COLUMNS` and `REWRAP_TABLES`, deleted with its user;
  `packages/db/src/tables/template-records.ts`). Repository stubs (`api-templates`):
  `packages/db/src/repositories/{deployments,simulation-presets}.ts` and the promotion in
  `inquiry-templates.ts`, exported from `repositories/index.ts`.
- **Frozen routes, 501 in their owners' files** (`api-templates`): `routes/server/inquiry-template-versions.ts`
  (`POST …/:id/validate`, `GET …/:id/diff`, `POST …/:id/preview`, `POST …/:id/simulate`; the last three
  and validate counted by `template-preview` first), `routes/server/inquiry-templates.ts` (`restore`,
  `copy`, `used-by`, `promote`), `routes/server/inquiry-template-translations.ts` (JSON and CSV, `GET` and
  `POST`, the imports counted by `translations-import` per environment), `routes/server/deployments.ts`
  (`GET /deployments`, `GET /deployments/:id`), `routes/dashboard/simulation-presets.ts` (`GET`, `POST`,
  `DELETE /simulation-presets[/:id]`, user session). Schemas from `packages/contracts/src/template-routes.ts`,
  `inquiry-template-translations.ts`, `deployments.ts`, `simulation-presets.ts`. A builder replaces the
  501 tests in `apps/api/src/phase9a-template-plumbing.test.ts` and `routes/dashboard/simulation-presets-frozen.test.ts`.
- **Policies**: `enforceRoutePolicy(rateLimiter, policy, subject, detail)` and `principalSubject(principal)`
  in `apps/api/src/plugins/rate-limit.ts`; `template-preview` (120 a minute per principal),
  `translations-import` (30 an hour per environment).
- **Hooks** (each a call in a shared file to a stub keeping today's answer):
  `resolveCopyForSession(db, { inquiry, version, stepId }): Promise<TemplateCopy | null>`
  (`services/templates/copy.ts`) and `resolveThemeForSession(db, { inquiry, version }): Promise<FlowTheme | null>`
  (`services/themes/resolve.ts`, `api-themes` in 9B), both in `getFlowSession` (`services/flow.ts`), a
  `null` leaving the member out; `checkConsentTextsInTx(tx, { environmentId, inquiryId, sessionId }, body)`
  (`services/templates/consent-texts.ts`) inside `recordConsent`'s transaction before the consent is
  written; `validateInquiryFieldsWrite(db, { kind: 'create' | 'patch' | 'screen' | 'copy-extractions',
  environmentId, versionId, inquiryId?, fields })` (`services/templates/fields.ts`) in the create and
  `PATCH` paths of `services/inquiries.ts`.
- **Masking**: `MASKED_MEMBERS` (`services/api-logs.ts`) gains `values` and `scope` (`PII_FLOW_SCREEN_ATTRIBUTES`,
  `PII_SIMULATION_PRESET_ATTRIBUTES`); every `field-schemas[].default` is nulled; `PII_MASKED_ATTRIBUTES` gains `scope`.
- **Errors**: `TemplateProblemError(code, detail, errors?, { headers?, members? })` in `apps/api/src/errors.ts`
  (codes of `TEMPLATE_PROBLEM_STATUSES`), placed at (F); use it for `precondition_failed`, `draft_exists`, ….

CHECKPOINT (F) DONE at 4a6191114b023b0acfcd1f1ab34effb2a7868e5c

Handoff ((F)):
- **Migration**: `files.capture_method` (`FILE_CAPTURE_METHODS` `upload`, `camera` in `@openverify/core`,
  CHECK `files_capture_method_valid`; `NewFileInput.captureMethod`, `StoredFile.captureMethod`); the upload
  path (`uploadFile`, `services/flow.ts`, `api-flow-engine`'s) does not pass it yet. `inquiries.redirect_uri`
  (≤ 2,048, `NewInquiryInput.redirectUri`, `Inquiry.redirectUri`; the inquiry resource does not serve it yet).
  `EnvironmentSettings` gains `allowed-embed-origins` and `allowed-redirect-origins`.
- **Internal route** (`flow-server-embed` owns the file): `GET /api/v1/internal/embed-policies/:inquiryId` in
  `apps/api/src/routes/internal/embed-policies.ts` (`embedPolicyRoutes`, registered in `app.ts` at
  `/api/v1/internal`; `hide: true`, `config.public`), params `embedPolicyParamsSchema`, 200
  `embedPolicyAnswerSchema`; an `onRequest` hook takes `Authorization: Bearer <token>` through
  `matchFlowServerToken(header, tokens): 'current' | 'previous' | null` (`apps/api/src/auth/flow-server-token.ts`,
  SHA-256 digests compared with `timingSafeEqual`, nothing accepted when unconfigured) and counts
  `internal-embed-policy` (6,000 a minute, subject `flow-server-current|previous`) before the handler
  calls `embedPolicyFor(db, inquiryId)`; `null` answers 404.
- **Stubs** in `apps/api/src/services/embed-origins.ts` (`flow-server-embed`): `embedPolicyFor` (rejects
  `NotImplementedError`, 501), `redirectUrlFor(db, { inquiry, environmentKind, status }): Promise<string | null>`
  (null), `checkInquiryRedirectUri(db, { environmentId, environmentKind, versionId, redirectUri })` (refuses
  every one with 422 `redirect_uri_not_allowed` at `/data/attributes/redirect-uri`; called in
  `createInquiryInTx`, which stores the URI once accepted), and `embeddingSettingsProblems(kind, changes):
  TemplateProblemError | null`, built: each entry of both lists through `checkOriginEntry` for the
  environment's kind (422 `embed_origin_invalid`, pointers `/allowed-embed-origins/<i>`), then a production
  wildcard without `meta.acknowledge-wildcards` (422 `embed_wildcard_unacknowledged`); called by
  `updateDashboardSettings`.
- **Settings** served with defaults: `allowed-embed-origins` `[]`, `allowed-redirect-origins` `null`
  (`DASHBOARD_SETTINGS_DEFAULTS` now holds both; audited with the change).
- **Configuration**: `OPENVERIFY_FLOW_SERVER_TOKEN`, `OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS` (API: ≥ 32 bytes,
  placeholders refused in production through `SECRETS`, a previous one alone is an issue; `Config.flowServerTokens`,
  `ApiDependencies.flowServerTokens`), `OPENVERIFY_FLOW_SERVER_API_URL`, `OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS`,
  `OPENVERIFY_DASHBOARD_CSP_MODE` in `.env.example`; compose passes the token to `api` and `flow`, the API URL
  and hops and `OPENVERIFY_DASHBOARD_PUBLIC_URL` to `flow`, `OPENVERIFY_FLOW_PUBLIC_URL` and the CSP mode to
  `dashboard`.
- **Flow app**: `apps/flow/src/security/csp-policy.ts` (`buildContentSecurityPolicy`, `ContentSecurityPolicyOptions`,
  `parseApiBaseUrl`, `apiOrigin`; no import; `security-meta.ts` and `api/api-base-url.ts` re-export);
  `apps/flow/server.ts` (skeleton: `--help` only; `flow-server-embed` owns it), imports
  `@openverify/contracts/origin-pattern`, `./src/security/csp-policy.ts`, `./src/security/response-headers.ts`;
  `tsconfig.server.json` (`allowImportingTsExtensions`, `erasableSyntaxOnly`, Node types) in the `typecheck`
  script, and `server.ts` also in `tsconfig.json` (so ESLint's project service finds it); `preview.html` →
  `src/preview/main.tsx` → `startPreview(document)` (`src/preview/start.ts`), a Vite input of its own
  (`build.rolldownOptions.input` `{ main, preview }`); `src/embed/embed-entry.tsx` `EmbedEntry({ flow, fallback })`
  (renders `fallback`) mounted at `<Route path="embed/:inquiryId">` in `routes.tsx`; `src/embed/bridge.ts`
  `mountEmbedBridge(host: EmbedBridgeHost): () => void` (no-op) called first in `main.tsx`.
- **Mock registries**: `registerFakeFlowExtension(area, { session?(session, fake), client?(fake) })` in
  `apps/flow/src/testing/fake-flow-registry.ts` (`FakeFlowApi` applies them; `MockedClient` exported;
  methods added to `FlowApiClient` after Phase 8 come only from an extension); `registerMockFlowExtension(area,
  { route?({ mock, request, method, path, reply, problem }), session?(session, mock) })` in
  `apps/flow/e2e/support/mock-flow-api.ts` (routes see every authenticated request below `/api/v1/flow`
  before the mock's own; `e2e/mock-registry.spec.ts`). Each owner keeps its answers in
  `src/testing/<area>.ts` and `e2e/support/mock-<area>.ts`.
- **Config and sdk-js**: `@openverify/config/eslint-logical-properties` (types and default to `flow-i18n`'s
  rule file; the root `eslint.config.js` still does not spread it, a config-protection hook refuses the edit);
  `packages/sdk-js` = `@openverify/js` (private until Phase 11; `exports['.']` `@openverify/source` →
  `src/index.ts`; dev dependencies `@openverify/config`, `@openverify/contracts`, `@types/node`,
  `@vitest/coverage-v8`, `jsdom`, `typescript`, `vite`, `vitest`; `vite.config.ts` library build `es` →
  `dist/index.js`, `iife` → `dist/openverify.iife.js`, global `OpenVerify`; `tsconfig.build.json` writes the
  types; `vitest.config.ts` jsdom; placeholder `src/index.ts` `EMBED_PROTOCOL_VERSION` and its test).
  `flow-server-embed` owns `packages/sdk-js/src/` and replaces the placeholder. CI's node job tests it
  (`ci-workflow.test.sh` checks); no turbo entry was needed.

CHECKPOINT (H) DONE at 1d023c55bbe0c1dd3239357b89426483fb4dcd38

Handoff ((H)) (frozen through 9A, V15; `api-themes` builds them in 9B):
- **Migration**: `theme_sets` (`theset_`, `name` 1-100, `status` `active`/`archived` with `archived_at` set
  exactly when archived, `styles` jsonb `{}`, `revision` ≥ 1, index `(environment_id, created_at desc, id
  desc)`), `theme_set_revisions` (pk `(environment_id, theme_set_id, revision)`, cascade with the set, `name`,
  `styles`, `creator_type`/`_id`, `restored_from` < `revision`), `theme_assets` (`tsa_`, `kind` logo or font,
  `media_type` `image/png`/`image/jpeg`/`font/woff2`, a logo 1-2,048 px and ≤ 256 KiB, a font ≤ 512 KiB with
  `licence_attested_by` (`usr_`) and `_at`, `unicode_range` ≤ 1,000, `storage_key` unique, `sha256`,
  `wrapped_dek`); `inquiries.theme_set_id` (FK to the set of its own environment). Vocabularies
  `THEME_RECORD_STATUSES`, `THEME_RECORD_ASSET_KINDS`, `THEME_RECORD_ASSET_MEDIA_TYPES` (`@openverify/core`).
  `ENCRYPTED_COLUMNS` gains `theme_assets.wrapped_dek` (aad `file`), `REWRAP_TABLES` `theme_assets`
  (tested through `kek:rewrap`); no row-sealed column, so no `SEALED` entry. No repository yet.
- **Routes, 501**: `apps/api/src/routes/server/theme-sets.ts` (`themeSetRoutes`: `GET`/`POST /theme-sets`,
  `GET`/`PATCH`/`DELETE /theme-sets/:id`, `GET /theme-sets/:id/revisions`, `POST /theme-sets/:id/restore`,
  `POST /theme-sets/assets` (multipart, body limit 576 KiB, `theme-assets` 30 an hour per environment counted
  first), `GET /theme-sets/assets/:id/content`), `apps/api/src/routes/flow/theme-assets.ts`
  (`themeAssetRoutes`, `GET /api/v1/flow/theme-assets/:id`, session token).
- **Hooks**: `themeSetPublishProblems(db, { environmentId, themeSetId })` (`services/themes/publish.ts`)
  called first inside `publishHookProblems` when `PublishContext.themeSetId` is given (a 422 at
  `/data/attributes/theme-set-id`); **`api-templates` passes `themeSetId`** with the version it publishes.
  `promoteThemeReferenceInTx(tx, { sourceEnvironmentId, targetEnvironmentId, themeSetId, actor,
  mayWriteThemeSets }): Promise<{ themeSetId, copied }>` (`services/themes/promote.ts`; none for none, 501
  otherwise), for `api-templates`' promote. `checkThemeSetChoice(db, { environmentId, themeSetId, pointer })`
  (`services/themes/settings.ts`) refuses any non-null set with 422 at its pointer: the `default-theme-set-id`
  setting (served, default `null`, in `DASHBOARD_SETTINGS_DEFAULTS`) and `POST /inquiries`' `theme-set-id`
  (stored once accepted).
- **Flow**: `applySessionTheme(session, styleVariant: StyleVariant | null)` (`apps/flow/src/theme/apply.ts`,
  no-op); `SessionThemeContext` and `useApplySessionTheme()` (`src/theme/session-theme.tsx`); `App` takes
  `styleVariant?: 'light' | 'dark' | null` and provides `(session) => applySessionTheme(session, styleVariant)`.
  `flow-renderer` calls `useApplySessionTheme()(session)` with each session it reads and passes the parsed
  `style-variant` to `App` (it owns `app.tsx` from here on).

CHECKPOINT (A11Y) DONE at e0923cf1909572d24751e009d2a48c82012cf007

Handoff ((A11Y)):
- `expectAccessible(page, { include?, exclude?, where?, exceptions? })` in `apps/flow/e2e/support/accessible.ts`
  (mocked flow suite) and `e2e/tests/support/accessible.ts` (full stack): axe with `AXE_WCAG_TAGS`, any violation
  fails as `rule (impact) at target: help`, the incomplete results attached as `axe-incomplete` (rule, impact,
  targets; never HTML).
- The pure half is `@openverify/config/axe` (`packages/config/src/axe.ts`): `AXE_WCAG_TAGS`, `axeViolationLines`,
  `A11Y_EXCEPTIONS_PATH`, `parseA11yExceptions`, `applyA11yExceptions`, `axeIncompleteSummary`, `AxeViolation`,
  `A11yException`; `e2e/src/axe.ts` re-exports the first two for `expectNoAxeViolations`, so there is one tag list.
- `e2e/a11y-exceptions.json` (`{ "$comment", "exceptions": [] }`; each exception `rule`, optional `target` and
  `where`, `reason`, `expires` `YYYY-MM-DD`; an expired one fails every call until removed).

CHECKPOINT (OPENAPI) DONE at e0923cf1909572d24751e009d2a48c82012cf007

Handoff ((OPENAPI)): `docs/api/openapi.json` sha256 `aba98161e9de577328bb4b6c40198785df969c71c8f16fb7dc8713ed64b75f67`
(committed at `1d023c55`; `openapi:write` twice at `e0923cf1` leaves it unchanged). The internal embed-policy
route is not in it.
