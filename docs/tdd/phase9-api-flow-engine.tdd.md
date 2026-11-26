# Phase 9, Workflow 9A Stage 3: api-flow-engine (family S)

The server flow engine (C150 on the server, C151), the screen submission route (C148.5), the
selfie-capture extension route (C171.4) and initial fields with the comparison source (C149.4).
Started after `foundation-9a`'s checkpoint (S) (`fca9a642`) and `flow-spec-logic`'s final commit
(`2ea6e155`). Every command below was run after `source scripts/env.sh`.

## Slice 1: the step record and the position on the inquiry (packages/db)

Owned file: `packages/db/src/repositories/inquiry-flow-steps.ts`. New names beside the frozen three:
`setInquiryFlowPositionInTx`, `setInquiryFlowOutcomeInTx`, `setInquiryFirstDeviceInTx`,
`setInquiryExpiresAtInTx`, `InquiryFlowPosition` (placeholders committed first, `f12e2bf1`).

### RED (`c89743c9`)

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/inquiry-flow-steps.test.ts --coverage.enabled=false
     × appends entries with the next seq, open until their exit, oldest first
     × keeps the existing notes and adds the exit notes, with the waited time and the mark
     × reads and writes an inquiry only in its own environment
     × moves the position and keeps the outcome, the first device once and the expiry
     × changes nothing in another environment
FlowRepositoryNotBuiltError: appendInquiryFlowStepInTx is not built yet (api-flow-engine)
FlowRepositoryNotBuiltError: setInquiryFlowPositionInTx is not built yet (api-flow-engine)
      Tests  5 failed (5)
```

### GREEN (`ce29688a`)

```
$ pnpm --filter @openverify/db exec vitest run src/repositories/inquiry-flow-steps.test.ts --coverage.enabled=false
      Tests  5 passed (5)
```

(A rerun minutes later failed in `createInquiryTemplate` on `foundation-9a`'s uncommitted (T) version
columns, which its migration did not hold yet: another agent's tree in motion, not this slice.)

## Slice 2: the engine (checkpoint "engine": advancing, required verifications, current-step refusals)

New name first: `positionFlowInTx` (`apps/api/src/flow-engine/position.ts`, a placeholder).

### RED

```
$ pnpm --filter @openverify/api exec vitest run src/flow-engine/engine.test.ts --coverage.enabled=false
     × starts at entry and moves on each exit, recording every step, until the completion
     × stays on a verification step after a failed attempt with attempts left
     × fails the inquiry when a verification ends without passing and has no exhausted edge
     × takes the exhausted port to the fallback, keeps the failure failed, and sends the inquiry to review
     × routes on an extracted value and fails the person at a failure step
     × never reads an errored check as not failed (H03): the onNull route is taken, and review flagged
     × sends the inquiry to review when a route reads a path the scope no longer has
     × ignores a decision of a verification the flow did not create (Phase 8 sandbox action)
     × never moves or settles a redacted inquiry, which still expires
     × positions a fresh inquiry at its first step and replays an earlier one, noted
     × refuses a verification of another step with flow_step_not_current, and accepts the current one
     × refuses a consent once the flow has moved past it
     × answers the verification steps entered, and every step of an inquiry the engine never positioned
AssertionError: expected { …(29) } to match object { flowStepId: 'consent', …(3) }
AssertionError: expected 201 to be 409
AssertionError: expected [ 'government_id', 'document' ] to deeply equal [ 'government_id' ]
AssertionError: promise resolved "undefined" instead of rejecting
      Tests  13 failed (13)
```

Each fails because the stubs move nothing and accept everything (the intended reason).

### GREEN

The engine: `flow-engine/engine.ts` (load, enter and leave entries, the walk through `nextPosition`
and `resumeAt`, actions through `runFlowActionInTx`, waits, halts, `settle` by `flowOutcome`),
`exits.ts` (each exit, applied to the current step only), `evaluator.ts` (`evaluateFlowCondition`
only, never `evaluateCondition`; an error and a review-class null flag review; a path the scope no
longer has is `missing`), `scope.ts` (C150.2 assembled on the server), `verification-state.ts`
(each step judged by the C7/C30.5/C50.5 rules, `verificationTypeState` now exported from
`jobs/inquiry-outcome.ts`), `pinned-flow.ts` (v1 migrated on read; an unreadable flow walks
nothing), `position.ts` (the start on `created -> pending` with the after-start window, and the
replay noted `position_backfilled`), `current-step.ts`, `required.ts`, and `settleInquiry`
deciding a positioned inquiry by the path (`services/inquiry-settlement.ts`).

```
$ pnpm --filter @openverify/api exec vitest run src/flow-engine/engine.test.ts --coverage.enabled=false
      Tests  13 passed (13)
$ pnpm exec vitest run src/routes src/workflows --coverage.enabled=false        # exit 0
 Test Files  169 passed (169)
      Tests  2913 passed (2913)
$ pnpm exec vitest run src/jobs src/providers ... src/rate-limit --coverage.enabled=false   # exit 0
 Test Files  230 passed (230)
      Tests  3282 passed (3282)
$ pnpm exec vitest run src/services src/flow-engine src/flow-actions src/*.test.ts --coverage.enabled=false
 FAIL  src/flow-actions/failure.test.ts > ... needs a biometric basis on a biometric path   (api-flow-actions' uncommitted work: its flow fixture)
 FAIL  src/services/redaction.test.ts > ... seeds every encrypted table   (foundation-9a's uncommitted (T) simulation_presets)
      Tests  2 failed | 2176 passed (2178)
```

Decisions taken while making it green (each is in the report's deviations):
- The handoff exits (C96.1, C96.3 on the server's position): continuing here and a redemption
  leave the handoff step through `next`; a decline moves nothing (the step shows again); the
  desktop's rejection of a redeemed phone is accepted while the position is past that redemption,
  closes the phone's open entry with port `rejected` and enters the handoff step anew, noted
  `handoff_rejected`.
- A handed-off session records its own consent after the flow passed its consent step (C94.6),
  which moves nothing; the RED test "refuses a consent once the flow has moved past it" was
  therefore rewritten to refuse a screen and a handoff instead, and to take that consent.
- Existing tests changed because C151.4 lets only the current step take input: the steps before
  the target are seeded passed (`passStepsBefore`, `flow-engine/testing.ts`) in the flow route
  tests, `jobs/types/kyb-flow.test.ts` and `services/otp/testing.ts`; the selfie route templates
  put the selfie after consent (`selfieAfterConsent`); `session-cap-objects.test.ts` puts the
  position at the handoff step directly, since a desktop with an open capture no longer reaches
  it through the flow.

### A test written after the GREEN (passes on its first run)

"ends in review through completed, so the completion writes its signals, list screening and graph
rows": a flow that ends in review moves `pending -> completed -> needs_review` in one transaction
(the state machine has no `pending -> needs_review`), so the completion's outbox rows exist:
`inquiry_signal_computations`, `list_screenings` (the version screens a named list) and
`graph_index_jobs`, each with trigger `completed`, and `inquiry.completed` is staged. A list
screening that later finds the inquiry in `needs_review` records `inquiry_already_decided` without a
move (`apps/api/src/jobs/lists/screen.ts`), as expected.

```
$ pnpm exec vitest run src/flow-engine/engine.test.ts --coverage.enabled=false
      Tests  14 passed (14)
```

### Gates of checkpoint "engine"

| Gate | Result | Load (1 min) |
|---|---|---|
| `tsc --noEmit -p apps/api/tsconfig.json` | exit 0 | 13 |
| `eslint` on every file of the GREEN and this test | exit 0 | 13 |
| `prettier --check` (services files with `--ignore-path=.gitignore`) | clean | |
| API tests without coverage, in three calls (all of `src/`) | 8,373 passed; 2 failing files belong to other agents' uncommitted work (above) | 13 to 15 |
| `packages/db` `inquiry-flow-steps.test.ts` | 5 passed (slice 1) | |

The whole API suite with its coverage gate runs at the end (rule 8's blob shards and merge).

CHECKPOINT engine DONE at 35ede7685075a750e58f0a60e0901c0932587d58

Handoff (engine):
- Entry points (`apps/api/src/flow-engine/`), each in the caller's transaction under the inquiry row
  lock: `advanceFlowInTx(tx, deps, { environmentId, inquiryId }, exit)` answers `FlowAdvance
  { staged, after }` (dispatch `staged` after the commit, then `runFlowAfterCommit(advance)`);
  `positionFlowInTx(tx, deps, ref)` positions an unpositioned inquiry (the start on
  `created -> pending` with the after-start window, or the replay noted `position_backfilled`);
  `assertCurrentStepInTx(tx, ref, attempt)` throws 409 `flow_step_not_current`
  (`flowStepNotCurrent()`, `problems.ts`); `requiredVerificationsForInquiry(tx, inquiry, flow)`.
- Engine internals other owners may call: `loadEngine(tx, deps, ref)` and `settle(ctx)`
  (`engine.ts`), `followAction(ctx, entry, step, outcome)` for an action outcome,
  `ENGINE_NOTES` (`waited_for_facts`, `edge_missing`, `flag_for_review:<code>`, `handoff_rejected`).
- Evaluation: `flowConditionEvaluator(flow, scope)` and `conditionPaths(condition)`
  (`evaluator.ts`); the scope `assembleFlowScope(db, input)` answers `{ values, reviewClassPaths }`
  (`scope.ts`). Steps: `stepVerificationOutcome(step, verifications, sources)`
  (`verification-state.ts`). The pinned flow: `pinnedFlowOf(db, inquiry)` (`pinned-flow.ts`).
- Test support: `passStepsBefore(api, inquiryId, type)` (`flow-engine/testing.ts`) seeds passed
  attempts of the steps before `type`'s, before the request that positions the inquiry.

## Slice 3: the session members (checkpoint "session")

New names first (`chore`): `flowSessionMembers`, `prepareFlowSessionInTx`, `FLOW_WAIT_POLL_MS`,
`FlowSessionMembersInput`, `FlowSessionMembers` (`apps/api/src/flow-engine/session.ts`, rejecting
"not built"). The wiring into `getFlowSession` (`services/flow.ts`) waits for `foundation-9a`'s (T)
checkpoint, as the prompt says; the members are built and tested on their own first.

### RED

```
$ pnpm exec vitest run src/flow-engine/session.test.ts --coverage.enabled=false
     × api/flow-projections/linear-1-consent.json ... × api/flow-projections/step-screen.json   (16 golden cases)
     × answers null for an inquiry the engine never positioned
     × names the position and serves spec 1 without a step to a client that declared only 1
     × serves a spec-2 client the client view and only the screen’s own values, masked and write-once ones as set
     × serves a verification step with prefillFrom that one field, and an unset masked value as null
     × asks a waiting client to poll, and never sends a branch to any client
     × starts a fresh inquiry at entry with the session’s device as the first device, once
     × ends a branch wait the poll finds past its deadline, and leaves one still in time
Error: flowSessionMembers is not built yet (api-flow-engine).
Error: prepareFlowSessionInTx is not built yet (api-flow-engine).
      Tests  23 failed (23)
```

### GREEN

`flowSessionMembers` builds the members from the stored position, record and verifications;
`flow` is `projection(flow, { current, exited (the record's exits in order), verificationStatuses
(each step's decided status), consentRecorded (the session's consent member), customConsentCopy
(the version's copy replaces a consent step's text) })`; `prepareFlowSessionInTx` positions an
unpositioned inquiry (`ensurePosition`), writes the first device from the session row
(`deviceKindOf`; platform `android` for the Android SDK, `web` for no SDK) once, and polls a wait
(a branch past `waitFor.maxSeconds` is resumed with `wait-elapsed` semantics; a `run_workflow`
entry is settled through `settleFlowActionInTx`).

```
$ pnpm exec vitest run src/flow-engine --coverage.enabled=false
      Tests  37 passed (37)
```

## Slice 4: the selfie-capture extension (C171.4; checkpoint "screens")

### RED

```
$ pnpm exec vitest run src/routes/flow/selfie-capture-extend.test.ts --coverage.enabled=false
     × moves the expiry by 180 s ten times, outside the cap, and the capture still takes its upload
     × refuses an eleventh extension, and an expired capture, with selfie_capture_not_extendable
     × refuses a submitted capture with 409, and another inquiry’s capture with 404
Error: expected HTTP 200, got 501: {... "detail":"Extending a selfie capture is not built yet (api-flow-engine)." ...}
AssertionError: expected 501 to be 409
      Tests  3 failed (3)
```

### GREEN

`extendSelfieCapture` (`flow-engine/selfie-extension.ts`): under the inquiry's lock, the session's
own capture of the current step (C151.4), locked; refused unless `initiated` and unexpired and
extended fewer than `SELFIE_CAPTURE_EXTENSION_LIMIT` (10, ours, WCAG 2.2.1's minimum) times, the
count read from its lifetime; `expires_at` moves by 180 s; the answer is the `selfie` resource,
which has no nonce.

```
$ pnpm exec vitest run src/routes/flow/selfie-capture-extend.test.ts --coverage.enabled=false
      Tests  3 passed (3)
```

## Slice 5: initial fields and the comparison source (C149.4)

### RED

```
$ pnpm exec vitest run src/flow-engine/initial-fields.test.ts --coverage.enabled=false
     × takes the initial value of a field set at creation, and the current value of any other
     × reads the current fields as entered when the inquiry was created without any
     × keeps a field emptied later at its initial value
AssertionError: expected { fields: { …(3) }, sources: {} } to deeply equal { fields: { …(3) }, sources: { …(3) } }
-     "name_first": "Quinn",
+     "name_first": "Rowan",
      Tests  3 failed (3)
```

### GREEN

`comparisonSourceFor` reads `getInquiryInitialFields` and answers each key's initial value when
the creation set it (not `null`), else its current value, with `sources` naming which.

```
$ pnpm exec vitest run src/flow-engine/initial-fields.test.ts src/jobs/process-government-id.test.ts src/jobs/types/database.test.ts --coverage.enabled=false
      Tests  39 passed (39)
```

Not built here, a missing hook (in the report's deviations): both call sites
(`jobs/government-id.ts` `referencesOf`, `jobs/types/database.ts`) read only `fields` and drop
`sources`, so the checks' evidence cannot carry `comparison-source` yet.

## Slice 6: the screen submission (C148.5; checkpoint "screens")

### RED

```
$ pnpm exec vitest run src/routes/flow/screens.test.ts --coverage.enabled=false
     × refuses a screen that is not the current step with 409 flow_step_not_current
     × validates every visible value again, at its pointer, without echoing a value
     × writes the values, normalising Arabic-Indic digits, discards a hidden one, and moves on through next
     × requires a shown component: the detail of the other plan
     × takes a button’s own port, recorded as sensitive, and refuses a button the screen lacks
     × answers a resubmission of a step already left with the current session and changes nothing
AssertionError: expected 501 to be 409
Error: expected HTTP 200, got 501: {... "detail":"Submitting a screen is not built yet (api-flow-engine)." ...}
      Tests  6 failed (6)
```

### GREEN

`submitFlowScreen` (`flow-engine/screen-submission.ts`) under the inquiry's lock: positions an
unpositioned inquiry first, answers a resubmission of a screen already left with no change, refuses
any other step (409), validates the visible components (`validateScreenSubmission`: digits
normalised, `required`, lengths in code points, patterns through `compilePattern`/`matchPattern`,
ranges, options, countries; email and phone through the Phase 5 destination validators; each
refusal at `/values/<field>` or `/button`, never the value), merges and checks `fields` through
`validateInquiryFieldsWrite` (kind `screen`), writes it, and exits through the button's port.
The route answers `getFlowSession`.

```
$ pnpm exec vitest run src/routes/flow/screens.test.ts --coverage.enabled=false
      Tests  6 passed (6)
$ pnpm exec vitest run src/routes/flow src/flow-engine --coverage.enabled=false
 Test Files  29 passed (29)
      Tests  425 passed (425)
```

## Slice 7: the inquiry's flow attributes (C151.8, C151.13; checkpoint "outcome")

New names first (`chore`): `flowInquiryAttributes`, `inquiryCompletedMeta`,
`FlowInquiryAttributes` (`apps/api/src/flow-engine/inquiry-attributes.ts`).

### RED

```
$ pnpm exec vitest run src/flow-engine/inquiry-attributes.test.ts --coverage.enabled=false
     × names the step left and the step the person is on, to everyone, after plain exits
     × hides a step reached through a route that read a field, without PII visibility only
     × hides a previous step that was itself reached sensitively, and names no next step once ended
     × answers null names for an inquiry the engine never positioned
     × serves the stored outcome on the inquiry and as inquiry.completed’s meta
Error: flowInquiryAttributes is not built yet (api-flow-engine).
Error: inquiryCompletedMeta is not built yet (api-flow-engine).
      Tests  5 failed (5)
```

### GREEN

`flowInquiryAttributes(db, inquiry, mask)`: the names from the position; a name is `null` without
PII visibility when any exit since the person-visible step before it is sensitive;
`next-step-name` is `null` once `ended`; `flow-outcome` the stored codes in public form.
`inquiryCompletedMeta(inquiry)`: `{ 'flow-outcome' }`, or `undefined` without one.

```
$ pnpm exec vitest run src/flow-engine/inquiry-attributes.test.ts --coverage.enabled=false
      Tests  5 passed (5)
```

Not wired here, missing hooks (in the report's deviations): the inquiry resource is built in
shared files (`services/inquiries.ts` `inquiryResourceOf`, `services/resources.ts`
`inquiryResource`, and `@openverify/contracts`' `buildInquiryResource`, whose `InquiryRecord`
has no member for these attributes), and `inquiry.completed`'s payload is staged by
`transitionInquiryInTx` (shared), which takes no `meta` for it.

## Slice 8: the expiry windows (C151.10; checkpoint "outcome")

New name first (`chore`): `extendExpiryOnResumeInTx` (`apps/api/src/flow-engine/expiry.ts`).

### RED

```
$ pnpm exec vitest run src/flow-engine/expiry.test.ts --coverage.enabled=false
     × moves a nearer expiry to now plus the default day
     × takes the version’s after-resume window, and never shortens a later expiry
     × leaves a decided, redacted or never-expiring inquiry as it is
     ✓ becomes started-at plus the after-start window when the version sets it, and stays otherwise
Error: extendExpiryOnResumeInTx is not built yet (api-flow-engine).
      Tests  3 failed | 1 passed (4)
```

The after-start case passes at once: `position.ts` applies the window since the engine's GREEN
(`87e507f9`); the test was written after it, and is recorded as such.

### GREEN

`extendExpiryOnResumeInTx(tx, inquiry, now)`: for an open, unredacted inquiry, the pinned
version's resolved `inquiry-expiration-after-resume-seconds`; the expiry moves only when
`now + window` is later. The RED's "never-expiring" case was dropped while making it green:
`inquiries.expires_at` is `NOT NULL`, so no such inquiry exists (the test's own setup failed on
the column's constraint).

```
$ pnpm exec vitest run src/flow-engine/expiry.test.ts --coverage.enabled=false
      Tests  4 passed (4)
```

Not wired here, missing hooks (in the report's deviations): the resume paths
(`POST /inquiries/:id/resume` and the one-time link redemption, in shared files) call no
expiry hook, and `POST /inquiries`' `meta.expiration-after-*` keys have no column to keep a
per-inquiry window.

## Slice 9: the backfill per factory path (C151.14; checkpoint "outcome")

Tests written after the engine's GREEN, which built the start and the replay (`87e507f9`); each
passed on its first run but one, whose expectation missed the branch the default flow's v1
transitions migrate into (`government_id-routes`, C147.10), corrected before the commit:

```
$ pnpm exec vitest run src/flow-engine/backfill.test.ts --coverage.enabled=false
     × positions an inquiry of the harness on its consent, and replays past its passed ID
+     "government_id-routes",
+     "else",
      Tests  1 failed | 2 passed (3)
(expectation corrected)
      Tests  3 passed (3)
```

The factories: `createTestInquiry` (`@openverify/db/testing`, an inquiry moved to `pending` and
holding a passed ID: the replay stops at the unrecorded consent, noted), the harness's
`createInquiry` (`POST /inquiries`, then a consent: the replay passes the ID), and a fresh harness
inquiry (no note). `createTestInquiryOnEarlierSchema` seeds rows for migration tests only; the
rows it writes have no position, which is the case the first test covers.

## Slice 10: the races (C151.11, Testcontainers; checkpoint "outcome")

`apps/api/src/flow-engine/flow-engine-races.integration.test.ts` (project `api`): two tabs on one
screen; a verification decision holding the inquiry's lock while a screen submission waits; the
session poll and the sweep ending one branch wait; two `action-finished` exits of one waiting
action (the run's cancellation itself is `api-flow-actions`' integration test).

### RED (a defect the race found)

```
$ pnpm exec vitest run --config vitest.integration.config.ts --project api src/flow-engine/flow-engine-races.integration.test.ts
     × two tabs submitting one screen: one exit, the other a resubmission that changes nothing
+   "ConflictError: The inquiry is already completed.",
      Tests  1 failed | 3 passed (4)
```

The second tab's resubmission met the open-inquiry check after the first tab's submission ended
the flow, and answered 409 where C148.5 answers the session.

### GREEN (`fix`)

The submission locks the inquiry and answers a resubmission of a step the path left (also once
the flow ended) before the open-inquiry check; a redacted inquiry still answers 410.

```
$ pnpm exec vitest run --config vitest.integration.config.ts --project api src/flow-engine/flow-engine-races.integration.test.ts
      Tests  4 passed (4)
$ pnpm exec vitest run src/routes/flow/screens.test.ts --coverage.enabled=false
      Tests  6 passed (6)
```

### The caps (C151.2), a test written after the engine's GREEN

"halts the flow with flow_loop_limit on the 21st entry of one step, and takes no input then": a
screen whose button leads back to itself is entered 20 times; the 21st entry halts the flow
(`flowState: halted`, the note `flow_loop_limit`, the inquiry still `pending` for an operator to
expire or resume) and the screen is no longer the current step's input. Passed on its first run.

```
$ pnpm exec vitest run src/flow-engine/engine.test.ts -t caps --coverage.enabled=false
      Tests  1 passed | 14 skipped (15)
```

### The scope's `session.handoff.state` (C150.2)

RED:
```
$ pnpm exec vitest run src/flow-engine/engine.test.ts -t scope --coverage.enabled=false
     × reads Phase 7’s handoff state of the flow’s handoff step in session.handoff.state
AssertionError: expected [ [ 'consent', 'next' ], …(3) ] to deeply equal [ [ 'consent', 'next' ], …(3) ]
      (the route read null and took else)
```

GREEN: `assembleFlowScope` reads `listInquiryHandoffSteps` and serves the state of the flow's first
`device_handoff` step that has a row (`null` without one).
```
$ pnpm exec vitest run src/flow-engine --coverage.enabled=false
      Tests  54 passed (54)
```

### RED (the session route)

`routes/flow/session-flow.test.ts`: each golden case through `GET /flow/session` (the stored state
written by `storeFlowPosition`, `flow-engine/testing.ts`), compared as the body's `flow` member's
JSON text; and the screen route's session with and without `OpenVerify-Flow-Spec`.

```
$ pnpm exec vitest run src/routes/flow/session-flow.test.ts --coverage.enabled=false
     × api/flow-projections/branch-1-consent.json ... (16 cases)
     × sends the next step’s client view and values to a client that declared spec 2, and names the version served
     × serves spec 1 without a step to a client that declared none
AssertionError: expected '{"metadata":{"specVersion":1,"id":"pr…' to be '{"metadata":{"specVersion":1,"id":"pr…'
AssertionError: expected undefined to match object { 'step-id': 'consent' }
AssertionError: expected undefined to be '2'
      Tests  18 failed (18)
```

Each fails because `getFlowSession` still serves the template's v1 view with no position (its
wiring waits for `foundation-9a`'s (T) checkpoint, which places the copy and theme hooks there).

### GREEN (the session wired, after `foundation-9a`'s (T) checkpoint `b391b698`)

`getFlowSession(deps, session, { specVersions })` (`services/flow.ts`): under the inquiry's lock,
`prepareFlowSessionInTx` (start, replay, first device, the poll); `startInquiry` after it for an
inquiry whose flow cannot be walked; then `flowSessionMembers`, an unpositioned inquiry keeping its
version's v1 view. The screen route reads `OpenVerify-Flow-Spec` (`parseFlowSpecHeader`) and names
the version served in the response header.

A decision taken while making it green (in the report's deviations): a version stored as
flow-spec 1 keeps serving its own v1 flow, transitions included. Phase 1's
`routes/flow/session.test.ts` ("returns the inquiry, the flow and no consent yet") turned red when
the projection was served for it: the default template's v1 transitions migrate into branches
(C147.10), where the projection stops, so today's Android SDK would stop after the ID step of
every v1 template with transitions. The projection is served for flow-spec 2 versions; a test of
`session.test.ts` pins the v1 case.

```
$ pnpm exec vitest run src/routes/flow/session-flow.test.ts src/routes/flow/screens.test.ts --coverage.enabled=false
      Tests  24 passed (24)
$ pnpm exec vitest run src/routes --coverage.enabled=false
 Test Files  115 passed (115)
      Tests  1948 passed (1948)
$ pnpm exec vitest run src/services src/flow-engine src/flow-actions src/*.test.ts --coverage.enabled=false   (after the handoff test change)
$ pnpm exec vitest run src/services/handoff --coverage.enabled=false
      Tests  38 passed (38)
$ pnpm exec vitest run src/jobs src/providers ... src/rate-limit --coverage.enabled=false
 Test Files  232 passed (232)
      Tests  3294 passed (3294)
```

Existing tests changed because the session now positions the inquiry, so C151.4 applies from the
first session read: `routes/flow/phase5-submit.test.ts` and two cases of
`routes/flow/verifications.test.ts` reach their step first (`reachStep`, which seeds the steps
before it and records the consent) and count only the type they test;
`services/handoff/flow-handoffs-cases.test.ts` records the consent (and passes its phone step)
before issuing a handoff at the handoff step.

## Slice 11: the (F) members and the upload's capture method (C158.5, C159.4, C153.2)

After `foundation-9a`'s (F) checkpoint (`4a619111`). New name first (`chore`): `Upload.captureMethod`
(`services/flow.ts`), not yet written.

### RED

```
$ pnpm exec vitest run src/routes/flow/session-flow.test.ts src/services/flow-upload-capture-method.test.ts --coverage.enabled=false
     × stores the method the client reports, and null when it reports none
     × names the origins that may frame the flow and the completion redirect, on every read (C158.5, C159.4)
     × sends no redirect a current list no longer allows, and no origin of an empty list
AssertionError: expected { front: null, back: null } to deeply equal { front: 'camera', back: null }
AssertionError: expected undefined to deeply equal { Object (allowed-origins) }
      Tests  3 failed | 18 passed (21)
```

### GREEN

`getFlowSession` adds `embed { allowed-origins }` (the flow server's own list, `embedPolicyFor`'s
`frame-ancestors`, `[]` for an unknown inquiry or an inactive template) and `completion
{ redirect-url }` (`redirectUrlFor`, re-checked on every read, `null` when none is allowed);
`uploadFile` stores `captureMethod ?? null`.

```
$ pnpm exec vitest run src/routes/flow/session-flow.test.ts src/services/flow-upload-capture-method.test.ts --coverage.enabled=false
      Tests  21 passed (21)
$ pnpm exec vitest run src/routes src/services/handoff src/services/signals src/flow-engine --coverage.enabled=false
 Test Files  128 passed (128)
      Tests  2072 passed (2072)
```

Not wired here, a missing hook (in the report's deviations): the multipart reader of
`routes/flow/index.ts` (shared) refuses any field but `kind`, the capture fields and `file`, so
a client's `capture-method` is a 400 until it reads the field into `Upload.captureMethod`.

## Final gates: what they found, fixed test-first against the existing suites

The integration gate (`--project api`) ran the Phase 1 and Phase 7 suites over the wired session:

```
$ pnpm exec vitest run --config vitest.integration.config.ts --project api --shard=1/3
 FAIL  src/api.integration.test.ts > ... creates an inquiry, resumes it, uploads both ID sides and a selfie, and submits
 FAIL  src/api.integration.test.ts > ... starts one verification for parallel creates on the real database (F002, F012)
Error: expected HTTP 201, got 409: {... "code":"flow_step_not_current"}
$ pnpm exec vitest run --config vitest.integration.config.ts --project api --shard=2/3
 FAIL  src/services/handoff/handoff-races.integration.test.ts > (4 races)
-   "handoff_token_invalid",
+   "rejected",
Expected: "handoff_not_available"   Received: "rejected"
```

- Phase 1's HTTP path created the selfie while the ID was only submitted; C151.4 refuses that (the
  web flow and the SDK wait for the decision, `processing`). The test now plays the worker's
  decision of the ID (its status and the flow's exit in one transaction) before the selfie, and
  the parallel-creates case creates the current step's type (the ID). Changed because the plan
  changes what they check.
- The handoff races: a handoff resolved on an inquiry never positioned positioned it at its
  consent, so every later handoff request met `flow_step_not_current` instead of Phase 7's codes.
  `handoff-resolved` no longer positions an inquiry (only the session read, a consent and a
  screen do), and once the path left the handoff step through a resolution, a late issue,
  redemption, decline or continue-here is answered by Phase 7's own state (`resolvedHandoffEntry`).

```
$ pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/handoff/handoff-races.integration.test.ts
      Tests  4 passed (4)
$ pnpm exec vitest run src/flow-engine src/services/handoff src/routes/flow --coverage.enabled=false
      Tests  498 passed (498)
```

## Final gates (on `25f3e3b4`, beside other Stage 3 agents), each read from its exit code

| Gate | Result | Time | Load (1 min) |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | exit 0 | | |
| `prettier --check` on every file of mine (services files with `--ignore-path=.gitignore`) | exit 0 | | |
| `pnpm turbo run typecheck --force --concurrency=1 --filter=@openverify/api --filter=@openverify/db` | exit 0, 2 of 2 | 236 s | 13.0 |
| `pnpm turbo run lint --force --concurrency=1 --filter=@openverify/db` | exit 0 | 119 s | 13.3 |
| `pnpm turbo run lint --force --concurrency=1 --filter=@openverify/api` (4 GB heap) | exit 0 | 452 s | 13.9 |
| `pnpm --filter @openverify/db test` | exit 0: 140 files, 2,057 tests, 92.61% statements | 258 s | 15.9 |
| API, blob shards 1-4 and the merge | merge exit 0: 616 files, 8,528 tests, 94.04% statements, 84.59% branches | 386, 368, 351, 422 s | 12.8 to 28.9 |
| `pnpm --filter @openverify/db test:integration` | exit 0, 78 tests | 108 s | 12.1 |
| `--project graph` | exit 0, 13 tests (template built in 20.1 s) | 41 s | 21.4 |
| `--project api --shard=1/3`, `2/3`, `3/3` | exit 0: 81, 97, 76 tests | 115, 258, 127 s | 27.4, 21.6, 15.2 |

The first forced `lint typecheck` call for both packages together reached the 10-minute cap
(exit 124) and was split as rule 8 says. An earlier typecheck failed only in another agent's
untracked file (`services/publish/flow-v2.ts`); the forced run above passed. The benchmark's checks
were not run: no file rule 16 names was changed.

CHECKPOINT session DONE at 25f3e3b4843bbaa44509ae7a148bc19e3e3d3dfa

Handoff (session): `getFlowSession(deps, session, { specVersions })` (`services/flow.ts`) runs
`prepareFlowSessionInTx` under the inquiry's lock and serves `flowSessionMembers`
(`flow-engine/session.ts`): `position`, `step` and `values` (spec 2 only), `locales`, `flow`
(the golden projection byte for byte for flow-spec 2 versions; a flow-spec 1 version keeps its own
v1 flow), `spec-version`, `embed { allowed-origins }` and `completion { redirect-url }`. Fixtures:
`contracts/fixtures/api/flow-projections/` through `projection-cases.json`
(`flow-engine/session.test.ts`, `routes/flow/session-flow.test.ts`). Test helpers
`storeFlowPosition`, `reachStep`, `DEFAULT_CONSENT_BODY` (`flow-engine/testing.ts`).

CHECKPOINT screens DONE at 25f3e3b4843bbaa44509ae7a148bc19e3e3d3dfa

Handoff (screens): `POST /api/v1/flow/screens/:stepId/submit` (`routes/flow/screens.ts` →
`submitFlowScreen`, `flow-engine/screen-submission.ts`; problems 409 `flow_step_not_current`, 410
redacted, 422 refusals at `/values/<field>` or `/button`, and `validateInquiryFieldsWrite`'s); it
reads `OpenVerify-Flow-Spec` and names the version served in the response header.
`POST /api/v1/flow/selfie-captures/:id/extend` (`extendSelfieCapture`,
`flow-engine/selfie-extension.ts`; `SELFIE_CAPTURE_EXTENSION_LIMIT` 10; 404 another inquiry's
capture, 409 `selfie_capture_not_extendable`, 409 `flow_step_not_current`).

CHECKPOINT outcome DONE at 25f3e3b4843bbaa44509ae7a148bc19e3e3d3dfa

Handoff (outcome): `flowInquiryAttributes(db, inquiry, mask)` and `inquiryCompletedMeta(inquiry)`
(`flow-engine/inquiry-attributes.ts`), `extendExpiryOnResumeInTx(tx, inquiry, now)`
(`flow-engine/expiry.ts`) and `comparisonSourceFor` (`flow-engine/initial-fields.ts`) are built and
tested; their calls in shared files are missing hooks (the report's deviations). The backfill per
factory path (`flow-engine/backfill.test.ts`) and the races (`flow-engine/flow-engine-races.integration.test.ts`,
project `api`) pass.
