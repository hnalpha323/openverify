# Phase 9 inventory at the Phase 9 base

Taken by `contracts-9a` (Workflow 9A Stage 1a) on 2026-11-04 at `e56e4e9c` (the Phase 9 base). The code is identical to `f0a32761`, which the plan cites: `git diff --stat f0a32761 e56e4e9c` touches only `docs/PROGRESS.md` and the Phase 8 and 9 plans. Every claim names its `path:line`. Where this inventory and `docs/plans/phase-9.plan.md` disagree, this inventory and the plan's "Workflow 9A Stage 1a amendments" win (the plan's own rule).

**The headline finding is section 1.** C151.6's v1 projection, as written, does not keep today's Android SDK out of a `Finalizing` loop when a verification step is exhausted while the person is on it. This was proved on the SDK with no production change. The plan treats that as a stop for Workflow 9A, so nothing below was built.

## 1. Today's Android SDK and the v1 projection (C151.6, V02, V03)

- **Steps the SDK treats as done:**
  - a consent step once `session.consent != null` (`android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/flow/FlowCoordinator.kt:560`);
  - a photo step (`government_id`, `selfie`) whose latest verification of its type is `PASSED`, `SKIPPED` or `NEEDS_REVIEW` (`FlowCoordinator.kt:652-653`);
  - an entry step (`phone_otp`, `email_otp`, `database`, `aamva` form, `crypto_wallet`, `document`, `database_business`, `business_website`) on the same three statuses (`:701`);
  - the silent `aamva` step on the same three (`:866`);
  - a `device_handoff` step once `session.handoff.done` (`:587`).
- **Where it finalises:** `Resolution.Finalize` at `FlowCoordinator.kt:668` (attempts used up) and `:671` (a failure without hints) for photo steps, `:714` and `:717` for entry steps, and `:868` for the silent `aamva` step. `finalize` (`:1210-1220`) re-reads the session up to `pollAttempts` times and then shows `Error(STILL_PROCESSING, canRetry = true)`, whose retry is `load` (`:1217`). This confirms Phase 8 outcome 38: the plan's `:598-600` is stale.
- **How it walks:**
  - `load` starts from the projection's first step (`:446`, `FlowNavigator.kt` `first`);
  - consent is recorded without a session re-read, and the walk continues over the steps it already holds (`:459-468`);
  - `FlowNavigator.next` follows transitions, then list order, and a step id missing from the list yields the list's **first** step (`FlowNavigator.kt:26-36`: `indexOfFirst` is `-1`, so `getOrNull(0)`).
- **What the plan missed:** after every verification is processed, the coordinator re-reads the session (`process`, `:1150`) and then calls `continueFrom(work.step)`, which resolves from **the step object it worked on**, not from the new list. The call sites are `:206-207` (`confirmCapture`), `:410`, `:792`, `:920`, `:940`, `:1013` and `:1065-1066`. `resolve` dispatches on that object's type (`:557-588`), so a government ID step whose attempts are used up resolves to `Finalize` through `verificationState` (`:668`), whatever the newly served projection lists.
- **Proved on the SDK** (an uncommitted host test, the file C151.6 names, over the existing `FakeFlowApi`, with no production Kotlin changed):
  - (a) consent → government ID → selfie → completion: passes, with no `Completed` before the completion step;
  - (b) consent → government ID → a branch into a v2-only step: passes, and the SDK stops on `Unsupported` at the `server-continuation` placeholder;
  - (c) consent → government ID exhausted → document → completion, served as C151.6 says (after the last failed attempt the projection is `[consent, document, completion]`, with the government ID left out): **fails**. The recorded states are `Processing(id_card) → Finalizing(id_card) → Error(STILL_PROCESSING, canRetry=true)`.
  - A candidate amended rule passes: a verification step with an `exhausted` edge has no v1 form, so a spec-1 client is served a placeholder there and stops on `Unsupported`.

  The test source and its report are in `docs/tdd/phase9-contracts-9a.tdd.md`.
- **Fixture rules:**
  - `Fixtures.list("api")` lists only the files directly inside `contracts/fixtures/api/`, and each needs a decoder or a `serverOnly` entry (`android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/model/ContractFixturesTest.kt:35-58`, `:62-209`, `:214-224`);
  - `problems/` is compared to an explicit list (`:244-250`), and `problems/flow/` has its own map (`:257`).
- **The test fake:** `FakeFlowApi` (`androidHostTest/.../flow/FakeFlowApi.kt:62`) is a final class. Its `flow` is a `var` (`:64`). Its `getSession` serves whatever `flow` holds (`:179-201`). A projection test can wrap it with `FlowApi by api` and swap `flow` per read, as the experiment did.

## 2. The flow definition (Starting point row 1)

- `packages/flow-spec/src/flow.ts`:
  - `FLOW_SPEC_VERSION = 1` at `:19`;
  - `metadataSchema` with `specVersion: z.literal(1)` at `:51-59`;
  - 16 step schemas in `stepSchema` at `:459-476` (the 14 the plan names plus `form` and Phase 7's `device_handoff`), with `STEP_TYPES` at `:478-496`;
  - `transitionSchema` at `:500-507`;
  - `flowSchema` with its `superRefine` (ids, endpoints, terminals) at `:509-546`;
  - `safeParseFlow` (dotted `path`) at `:572-584`.
- The package index is `packages/flow-spec/src/index.ts:1-5` (`flow.js`, `json-schema.js`). `schema:export` writes only `schema/flow.schema.json` (`packages/flow-spec/package.json`).
- **Patterns compile today.** v1's `textFieldSchema.validation.pattern` is checked with `new RegExp(pattern, 'u')` (`flow.ts:69-76`, `:86-90`). `flowV1Schema` must keep this unchanged (C147.1), so rule 18's "no `new RegExp` on operator text" holds only for v2: v2 patterns go through C148.3's matcher.
- `SUPPORTED_FLOW_STEP_TYPES` is at `packages/contracts/src/inquiry-templates.ts:151`, `checkFlowMatchesConfig` at `:181`, `checkFlowPublishable` at `:234` and `templatePublishProblems` at `:573`.

## 3. Where conditions run, and readers of a stored flow

- **Web:**
  - `resolveFlowPosition` is at `apps/flow/src/flow/flow-position.ts:303` and `terminalPosition` at `:148`;
  - `readVar`'s fallback `null` is at `apps/flow/src/flow/json-logic.ts:44-45`;
  - the context is `flowConditionContext` (`packages/contracts/src/flow-api.ts:130-137`).
- **`storedFlow`** (`apps/api/src/services/resources.ts:56-58`, `flowSchema.parse`) has 13 call sites:
  - `workflows/actions/verifications/run-verification.ts:93`;
  - `jobs/signals/process.ts:150`;
  - `services/crypto-challenges/create.ts:74`;
  - `services/resources.ts:87`;
  - `services/flow.ts:139`;
  - `services/signals/flow-signals.ts:135`;
  - `services/inquiry-templates.ts:281`, `:299` and `:566`;
  - `services/chip-challenges/create.ts:55`;
  - `services/inputs/index.ts:154`;
  - `services/otp/context.ts:74`;
  - `services/handoff/flow-handoffs.ts:166`.
- **Three more readers** parse with `flowSchema.safeParse` and read a v2 flow as a failure:
  - `jobs/process-verification.ts:189` throws `PermanentJobError('invalid_template')`, so on a v2 flow every verification of the inquiry fails;
  - `jobs/face-index-rebuild.ts:104`;
  - `services/lists/biometric/source-selfie.ts:77`.

  All 16 need `foundation-9a`'s v2-safe reader (Phase 8 outcome 10).
- **Publish contexts typed on the v1 `Flow`:** `services/publish/index.ts:37` (`PublishContext.flow`), `services/publish/signal-config.ts:40` and `services/publish/handoff.ts:24`. Each walks steps by type. Two things change on a v2 flow:
  - v2 steps of v1 types gain optional members (`captureMethodsByDevice`, `onFallback`, `prefillFrom`, the failure step's bases), which today's strict v1 step schemas refuse;
  - the new `screen`, `branch` and `action` steps are unknown to these readers.

  So the v2-safe reader must give a v1 consumer the v2 steps of v1 types without the additive members (or the consumers move to a shared step view), and must treat `screen`, `branch` and `action` as steps the consumer does not know.
- **`biometric.ts`:** `templateHoldsSelfie` walks `version.flow.steps` by `type` (`workflows/actions/decisions/biometric.ts:12-20`), and `holdsSelfie` walks any shape (`workflows/publish/facts.ts:31-39`), so both read v2 correctly.

## 4. Verification decision sites and required verifications (C151.2, C151.3)

- **`requiredVerifications`** is defined at `apps/api/src/jobs/inquiry-outcome.ts:61`, with `decideInquiryOutcome` at `:142` and `isRetryableFailure` at `:171`. Its one call site is `apps/api/src/services/inquiry-settlement.ts:73`, inside `settleInquiry` (`:52-125`).
- **Every verification decision** (a move to `passed`, `failed`, `requires_retry`, `needs_review` or `skipped`) commits in one of these transactions, where `advanceFlowInTx` belongs:
  1. `processVerification`'s decision transaction: `apps/api/src/jobs/process-verification.ts:335-409`. The move is at `:347`, and the decision hooks run at `:399-407`; the advance goes after them, under the inquiry lock taken at `:340`.
  2. `failVerificationAfterError`'s transaction: `process-verification.ts:506-547`, with the move to `failed` at `:511`.
  3. The silent AAMVA attempt, created and moved to `skipped` (or `submitted`) inside the government ID's decision hook: `apps/api/src/jobs/types/aamva.ts:232`, running inside site 1's transaction.
  4. Phase 8's `run_verification` action with `debug-forced-status` (sandbox only, `workflows/actions/verifications/run-verification.ts:78-80`, the move at `:125`). It decides a verification a workflow created outside the flow, and the inquiry is not settled there. `api-flow-engine` decides whether such a verification can be the current step's; by C151.4 it cannot be the flow's own attempt, which only the flow API creates.

  Settlement after the commit runs at `process-verification.ts:306`, `:412`, `:449` and `:472`. Those are where `requiredVerificationsForInquiry` replaces `requiredVerifications(flow)` (through `inquiry-settlement.ts:73`).
- **Other moves:**
  - `submitted` at `services/flow.ts:654` and `services/otp/records.ts:135`;
  - `confirmed` at `services/otp/confirm.ts:128`;
  - `canceled` at `services/flow.ts:730`, `services/verifications.ts:198`, `services/handoff/flow-handoffs.ts:698`, `services/crypto-challenges/create.ts:100` and `services/chip-challenges/create.ts:80`.

  These are not decisions and need no advance; a canceled attempt is retried on the same step.

## 5. Inputs of the two inquiry-comparison checks (C149.4)

- `id_inquiry_comparison`:
  - `referencesOf` passes `inquiryFields: nonEmpty(job.inquiry.fields)` (`apps/api/src/jobs/government-id.ts:337-348`), called at `:501-503`;
  - the evaluator is `packages/checks/src/government-id/id-inquiry-comparison.ts:1`.
- `database_inquiry_comparison`:
  - `inquiryFields: Object.keys(fields).length === 0 ? null : fields` (`apps/api/src/jobs/types/database.ts:128-134`);
  - the evaluator is `packages/checks/src/database/database-inquiry-comparison.ts:28`, with the input at `packages/checks/src/database/inputs.ts:87-90`.
- `comparisonSourceFor` goes at those two input builders.

## 6. Organisation creation (C168.2)

One function, `createOrganization` (`packages/db/src/repositories/organizations.ts:24-33`), with the column default `require_mfa ... default(false)` at `packages/db/src/tables/tenancy.ts:31`. Its callers:
- `apps/api/src/seed/dev-seed.ts:509`;
- `packages/db/src/testing.ts:250`;
- `apps/api/scripts/graph-benchmark.ts:128`;
- `apps/api/scripts/face-scan-benchmark.ts:142`;
- the dashboard route test support, `apps/api/src/routes/dashboard/dashboard.test-support.ts:182`.

No API route creates an organisation. The contract's default is at `packages/contracts/src/dashboard-api.ts:373`, and the plan's `:191` is stale.

## 7. Phase 7 interfaces 9A reads

- **List screenings before completion (C150.2):** none, as planned and as built.
  - `createListScreeningInTx` (`apps/api/src/services/lists/screening.ts:57-59`) writes only when `writesListScreening` holds;
  - `writesListScreening = writesSignalComputation` (`screening.ts:35`) is the first move `pending → completed | failed | expired` or `created → expired` (`apps/api/src/services/signals/computation.ts:27-32`).

  So `lists.*` stays refused in flows, and no `waitFor` can name a list.
- **The device type source (C150.2 `device.kind`):** `inquiry_sessions.device_type` and `mobile_sdk_name` (`packages/db/src/tables/inquiries.ts:298`, `:300`, CHECKed at `:389`).
  - The values are `SESSION_DEVICE_TYPES = ['desktop', 'smartphone', 'tablet', 'tv']` (`packages/contracts/src/devices.ts:217`) and `MOBILE_SDK_NAMES = ['openverify-android', 'openverify-ios']` (`:219`).
  - They are written at the first flow call by `recordSessionDeviceInTx` (comment at `tables/inquiries.ts:291-294`).
  - The handoff's mobile test reads the same pair (`services/handoff/steps.ts:91-95`).
  - `mobile-sdk-name` includes `openverify-ios`, so the mapping's "set → `native`" covers both, though no iOS SDK exists.
- **Signal computation (C150.9):**
  - `computeInquirySignals` (`packages/checks/src/signals/compute.ts:539`) is pure, and `COMPUTED_SIGNAL_NAMES` (`compute.ts:71-85`) lists 13 names, never `inquiry/list_match_count`.
  - Its input is assembled by private code in `apps/api/src/jobs/signals/process.ts:126-178` (sessions, networks, signal bodies, consent, the government ID country through `governmentIdCountryOf` at `:328`), bound to the outbox row (`lockPendingSignalComputation`, `:132`).
  - `servedInquirySignals` (`apps/api/src/services/signals/served.ts:108`) merges `list_match_count` from the screening row.
- **The registry** is `SIGNAL_REGISTRY` (`packages/core/src/signal-registry.ts:326-488`). `SignalDefinition` (`:88-121`) has no flow-provisional member, and `signal()` (`:300-318`) sets the defaults. Flow-provisional by inputs, the value C150.9 asks `contracts-9a` to set, with the client-collected entries (V06: `collectionTier` not `server`) marked:

  | Signal | Inputs | Collection tier | Flow-provisional |
  |---|---|---|---|
  | `bot_score` (v2) | integrity, behaviour, request-headers | session-integrity (client) | true |
  | `behavior_threat_level` (v2) | integrity, behaviour | session-integrity (client) | true |
  | `automation_artefact_count` | integrity | session-integrity (client) | true |
  | `session_count` | sessions | server | true |
  | `network_threat_level` | network | server | true |
  | `tor_detected` | network, tor-exit-addresses | server | true |
  | `datacenter_detected` | network, cloud-ranges | server | true |
  | `vpn_detected` | network, asn-seeds | server | true |
  | `proxy_detected` | network, ipReputation (stored with the session's network row) | server | true |
  | `country_from_session` | network, dbip-country-lite | server | true |
  | `country_comparison` | network, dbip-country-lite, **government-id-extraction** | server | **false** |
  | `max_session_distance` | network, dbip-city-lite | server | true |
  | `handoff_count` | sessions, handoffs | server | true |
  | `list_match_count` | **lists** | server | **false** |

- **Null reasons:**
  - `SIGNAL_NULL_REASONS` is at `packages/contracts/src/signals.ts:40-69`, ending in `list_screening_pending`, `list_unscreened`, `no_lists_selected`;
  - `ON_NULL_DEFAULTS` is at `signals.ts:131-155`;
  - the mirror is `packages/checks/src/signals/vocabulary.ts:14-38`, with `GAP_NULL_REASONS` at `:80`;
  - the tests that pin both are `packages/contracts/src/signals.test.ts:42-135` and `packages/checks/src/signals/vocabulary.test.ts:29-50`.
- **`IDENTITY_FIELD_STEP_TYPES`** (`packages/checks/src/signals/bot-score.ts:67-74`) is `form`, `phone_otp`, `email_otp`, `database`, `aamva`, `database_business`, and has no `screen`. Default recorded in the amendments: a paste into a v2 screen's identity field counts as no evidence. `bot_score` stays at version 2 and its digest is unchanged; adding `screen` is a version-3 change for a later owner decision.
- **Handoff exits and session gates (C151.2 "handoff resolved", C151.4):** all in `apps/api/src/services/handoff/`, not `services/flow.ts`.
  - `isSessionHandedOff` (`guard.ts:15`) refuses non-GET flow routes of an issuing session.
  - The exits are `continueHandoffHere` (`flow-handoffs.ts:567`), `redeemHandoff` (`:1009`), `rejectCurrentHandoff` (`:641`, which moves a completed inquiry to review at `:721`) and `declineHandoff` (`:939`). Issue and preview are `issueHandoff` (`:446`) and `previewHandoff` (`:861`).
  - `currentHandoffStep` (`steps.ts`, called at `flow-session.ts:50`) finds the "current" handoff step by walking the v1 flow in list order. On a v2 flow it must read the server's position.
  - The routes are `apps/api/src/routes/flow/handoffs.ts:51-190`.

## 8. Phase 8 interfaces 9A uses

- **Vocabularies.** All three are text columns held by `oneOf` CHECKs over `packages/core` lists; none is a Postgres enum, so each new value is a recreated CHECK with a migration test.
  - `WORKFLOW_TRIGGER_TYPES` (8 types, `packages/core/src/workflows/vocabulary.ts:40-49`) is held by `workflow_versions_trigger_type_valid` (`packages/db/src/tables/workflows.ts:278-279`), `workflow_triggers_kind_valid` (`:378`) and `workflow_runs_trigger_type_valid` (`:584`).
  - `WORKFLOW_RUN_CREATOR_TYPES` (`vocabulary.ts:126-134`) is held by `workflow_runs_creator_valid` (`workflows.ts:586-588`).
  - `DECISION_KINDS` (`packages/core/src/workflows/decisions.ts:12`) is held by `inquiry_decisions_kind_valid` (`packages/db/src/tables/decisions.ts:126`).
  - `DECISION_ACTOR_TYPES` (`decisions.ts:17`, `user`, `api-key`, `workflow-run`) is held by `inquiry_decisions_actor_type_valid` (`tables/decisions.ts:136`), and the actor id's format by `deciderIdFormat(...)` (`:137`).
  - `DECISION_EVIDENCE_KINDS` (`decisions.ts:46-56`) lives in the `evidence` jsonb (`tables/decisions.ts:88`), with no CHECK.
  - The contract actor union is `decisionActorSchema` (`packages/contracts/src/decisions.ts:67-71`) and the run member `decisionRunSchema` (`:90`, nullable on the record at `:145`).
- **The trigger table:**
  - `triggerType(definition)` is at `packages/workflow-engine/src/variables/scope.ts:156-178`, one case per trigger type;
  - the trigger configs are in `packages/contracts/src/workflow-definition.ts` (for example `:198`, `trigger('trigger-account', noConfig)`).
- **Actions' triggers:** `ActionRegistryEntry.triggers` is at `packages/workflow-engine/src/actions/registry.ts:164-165`, where **`null` serves every trigger type**. The graph check refuses a misfit only when the list is non-null (`packages/workflow-engine/src/graph/check.ts:474`), and the console's palette does the same (`apps/dashboard/src/components/workflows/editor/palette-model.ts:161`). So adding `trigger-flow` to the union would let every `null` action serve flows, against C152.2's "none until listed" (an amendment).
- **The run service:** `startWorkflowRunInTx` (`apps/api/src/workflows/engine/start-run.ts:89`). Cancellation is `cancelWorkflowRun` (`apps/api/src/workflows/runs/service.ts:391`) over `cancelRun` (`apps/api/src/workflows/runs/control.ts:90`).
- **Decisions:** `recordInquiryDecisionInTx` (`apps/api/src/services/decisions/record.ts:64`).
- **C128.4:**
  - the publish fact is `templateIsBiometric` (`apps/api/src/workflows/publish/facts.ts:28`, `:103`), from `biometricTemplates` (`:42`);
  - the run-time step test is `stepIsBiometric` (`apps/api/src/workflows/actions/decisions/biometric.ts:22`);
  - the run-time consent check is `adverseRefusal` and `consentHolds` (`apps/api/src/workflows/actions/decisions/gate.ts:27`, `:49`), keyed on `consent.automated-decision` (`gate.ts:13`).
- **Typing and evaluation entry points (C150.12):**
  - `typeCheckCondition(expression, scope: ScopeType)` (`packages/workflow-engine/src/expressions/typing.ts:580`), whose `ConditionTyping` (`:30-36`) has `reads[]` and `readsNullable`;
  - `evaluateCondition(expression, scope: EvaluationScope)` (`packages/workflow-engine/src/expressions/evaluate.ts:711-716`) answers `{ outcome: 'value' | 'null' | 'error' }` (`:31-33`) and never names the operand that met a null. That is the only part `flow-spec-logic`'s borrowed edit may add.
- **Used by and promote:** `findWorkflowReferences` and `WORKFLOW_REFERENCE_KINDS` (`packages/db/src/repositories/workflow-versions.ts:409`, `:72-81`); the kinds include `inquiry-template`.
- **The workflow publish path:** `publishWorkflowVersion` (`workflow-versions.ts:163`); facts are loaded at `apps/api/src/workflows/publish/publish.ts:397`.

## 9. The API's template, session and flow files

- **The session builder:** `getFlowSession` (`apps/api/src/services/flow.ts:189-270`). Its members come from `flowSessionSignalsOf` (signals), `flowSessionHandoffOf` (`services/handoff/flow-session.ts`) and `flowDecisionContestRouteOf`. The schema is `flowSessionResponseSchema` (`packages/contracts/src/flow-api.ts:40-68`), a strict object whose `flow` is `flowSchema` (`:42`).
- **Flow routes:** `apps/api/src/routes/flow/index.ts`:
  - `/session` at `:220`, `/consent` at `:236`, `/verifications` at `:260`, `/verifications/:id/files` at `:285`, `/verifications/:id/submit` at `:333`, `/verifications/:id/selfies` (the selfie-capture create) at `:370` and `/verifications/:id` at `:406`;
  - `SELFIE_CAPTURE_TTL_SECONDS` and `SELFIE_CAPTURE_LIMIT` are enforced in `services/flow.ts:771-811`.

  The selfie-capture extension route of C171.4 belongs in this file. The other flow route files are `crypto-wallet.ts`, `government-id-nfc.ts`, `handoffs.ts`, `inputs.ts`, `otp.ts`, `signals.ts` and `openapi.ts`.
- **Publish:**
  - `publishTemplateVersion` (`apps/api/src/services/inquiry-templates.ts:553`), with `assertPublishable` at `:119`;
  - the hooks: `publishHookProblems` and `PUBLISH_HOOKS` (`apps/api/src/services/publish/index.ts:54`, `:67`), `reportConfigPublishProblems`, `handoffPublishProblems`, `listConfigPublishProblems` and `signalConfigPublishProblems` (imported at `inquiry-templates.ts:64-68`);
  - the version row is published by `publishInquiryTemplateVersion` (`packages/db/src/repositories/inquiry-templates.ts:396`).
- **ETag, `If-Match` and 412:** none anywhere in `apps/api/src`. The only `etag` strings are outbound response-header allowlists (`workflows/actions/https/client-pool.ts:31`, `watchlists/download.ts:55`, `network/download.ts:48`).
- **The flow's mock API:**
  - `apps/flow/e2e/support/mock-flow-api.ts` (`flowLink` `:49`, `oneTimeLink` `:54`, `selfieFlow` `:63`, `defaultFlow` `:78`, `phase5Flow` `:103`), with `flow-steps.ts`, `phase5.ts` and `synthetic-png.ts` beside it;
  - `apps/flow/src/testing/fake-flow-api.ts`, with `flow-fixtures.ts`, `golden-problems.ts`, `fake-camera.ts` and `synthetic-faces.ts`;
  - neither has a registration hook yet (Stage 1b (F)).
- **The flow's response headers (C107.9):** `FLOW_RESPONSE_HEADERS` (`apps/flow/src/security/response-headers.ts`), passed to `preview.headers` in `apps/flow/vite.config.ts:28-29`. Compose serves the build with `vite preview` (`infra/docker-compose.yml:533-553`; the plan's `:438-453` is stale). The `<meta>` policy's comment is at `apps/flow/src/security/security-meta.ts:6-7`.
- **Directional icons in `apps/flow`:** none. No component under `apps/flow/src` draws an arrow, chevron or other directional glyph (the only SVG is the QR code, `src/handoff/qr-code.tsx`). So `flow-i18n`'s `mirrored` flag has no existing icon file to borrow. It is a helper, or a rule for the icons `flow-renderer` adds (back, next, the language selector's chevron).

## 10. Re-verified rows of the plan's "Starting point"

| Row | At the base | Drift |
|---|---|---|
| Templates and versions | `MAX_INQUIRY_FIELDS = 100` (`packages/contracts/src/inquiries.ts:48`, its refine at `:64-65`); `published_at` on versions (`packages/db/src/tables/inquiry-templates.ts`) | none |
| Flow API | as the plan says, plus Phase 7's `signals`, `handoff`, `handoff-context` and Phase 8's `decision-contest-route` (`flow-api.ts:55-67`) | additive members |
| Web flow | `SUPPORTED_LANGUAGES = ['en', 'es']` (`apps/flow/src/i18n/languages.ts:1`); `i18next` `^26.5.2`, `react-i18next` `^17.1.0` (`apps/flow/package.json:21`, `:27`) | none |
| Console | headers at `apps/dashboard/next.config.ts:9-14`; "a later phase" at `:5` | none |
| Design tokens | 12 colour tokens as `oklch()` in `@theme static` (`packages/ui/src/styles.css:20-32`), `color-scheme: light` at `:37` | none |
| Permissions | 58 API scopes (`packages/core/src/permissions.ts:9`), 9 operator permissions (`:92-104`); `NOT_FOR_VIEWERS` at `:146-153`; `BUILTIN_ROLES` at `:163`; `PERMISSION_INFO` in `apps/dashboard/src/components/operators/permissions.ts` | the plan's 28 and 8 were research-time counts |
| Team and MFA | `INVITATION_TOKEN_PREFIX = 'ovi_'` (`packages/contracts/src/tokens.ts:18`); `require_mfa` default false (`tenancy.ts:31`); `audit_logs.ip` encrypted (`packages/db/src/tables/audit-logs.ts:40`) | the plan's `tenancy.ts:30` and `dashboard-api.ts:191` are stale (`:31`, `:373`) |
| Webhooks | `WEBHOOK_RETRY_OFFSETS_SECONDS` (`packages/contracts/src/webhooks.ts:41`), jitter `:44`, attempts `:45` | none |
| Settings and configuration | `OPENVERIFY_FLOW_PUBLIC_URL` and `OPENVERIFY_FLOW_CORS_ORIGINS` (`apps/api/src/config.ts:550-551`, read at `:1022`, `:1148`), `OPENVERIFY_DASHBOARD_PUBLIC_URL` (`:1158`) | the plan's `:376-377` and `:871` are stale |
| Packages and records | no `packages/sdk-js`; ADRs 0001-0007; migrations end at `0029_phase8d.sql` | the next free number is **0030** |

## 11. Tooling and records

- **Release age:** `pnpm-workspace.yaml` sets no `minimumReleaseAge` (it has `overrides: jsdoc-type-pratt-parser: 9.2.2` at `:98-100`). `services/vision/pyproject.toml` has no `[tool.uv]` `exclude-newer`, and `services/vision/uv.lock` has no `[options]` table. The date gate holds: `date -u` read 2026-11-04T09:14Z, past 2026-11-03T02:25Z.
- **`eslint-plugin-jsx-a11y`:** its latest, 6.10.2, peers `eslint` `^3 || ... || ^9` (`pnpm view`, 2026-11-04). The workspace pins `eslint: ^10.13.0` (`pnpm-workspace.yaml:12`), so decision 54 stands.
- **Built-in translations:** no recorded human review. `es` was written by build agents (for example `86fa58f5`, `b14e4193`), with no review note in `apps/flow/src/i18n/` or anywhere under `docs/`. So `es`, `fr`, `de` and `ar` ship `machine-drafted` (C161.5).
- **The e2e stack:** three shards (`e2e/README.md:19-31`): 137 full-stack tests in 66 files, in shards of 46, 46 and 45. One used stack holds one clean pass because of `otp-ip-hour`.
- **Axe:** in the catalog and `e2e/package.json` only. `e2e/src/axe.test.ts` fails any other importer (Phase 8 outcome 14).

## Workflow 9B re-verification (contracts-9b)

Taken by `contracts-9b` (Workflow 9B Stage 1a) on 2026-11-06 at `6a290723` (Workflow 9B's base; 9A pushed at `8bd5c545`, CI 42070468737, and `docs/PROGRESS.md` records Workflow 9A done at line 20). Every claim names its `path:line` at that commit. Drift is recorded in `docs/plans/phase-9.plan.md`, "Workflow 9B Stage 1a amendments (contracts-9b)", whose item numbers are given here as (B<n>).

### 12. The files the 9B bullets leave to "the inventory"

| What the bullet says | The file and line at the base |
|---|---|
| The response serializer (`applyKeyAttributeBlocklist`) | **There is no document-level serializer.** `plugins/api-version.ts:118-125` is an `onSend` hook that only sets `OpenVerify-Version` on server-API routes (`isServerApiRoute`, `:70-73`); the payload passes through. Responses are serialized by `fastify-type-provider-zod`'s compiler (`app.ts:147`), and masking is applied per route by `auth/pii.ts`. The hook site is a new `onSend` hook in `plugins/api-version.ts`, after `:118`, on the serialized JSON (B3) |
| The user-session auth plugin | `routes/dashboard/authenticate.ts:32` (`authenticateOperator`), which reads `findUserSessionContext` (`operator-auth/session-context.ts:42`), where `permissionsForRoles(roles)` unions every role at `:83`; sign-in's environment defaults to `sandbox` at `operator-auth/operator-auth.ts:271`, then the other kind (`:299-300`) |
| `webhooks/dispatcher.ts` (`deliveryAttemptHeaders`) | `attemptDelivery` (`webhooks/dispatcher.ts:200-218`): custom headers first, then the dispatcher's own (`content-type`, `user-agent`, event id, signature, version) |
| The mailer's From construction | `createMailer` (`mail/index.ts:39-66`) sends the install-wide `from` (`OPENVERIFY_MAIL_FROM`, `:16-17`) at `:58`; `MailMessage` (`ports.ts`) has no sender member (B33) |
| The case-action availability filter | `runnableTarget` (`services/cases/actions/service.ts:465`), called only by `listAvailableCaseActions` (`:484`, `:505`); `runCaseAction` (`:366`) does not call it (B37) |
| The report resource builder | `buildReportResource` (`packages/contracts/src/reports.ts:1442`), served through `reportResource` (`apps/api/src/services/reports/resources.ts:313`) and `reportResourceOf` (`services/reports/reports.ts:138`) |
| Phase 8's case transition service | `setCaseStatusInTx` (`services/cases/service.ts:542`); `CaseStatusChange` (`services/cases/sla/status-hook.ts:24`) carries the caller's publisher (`:31-32`) |
| The organisation-creation paths | One function, `createOrganization` (`packages/db/src/repositories/organizations.ts:24`), the column default `require_mfa ... default(false)` at `packages/db/src/tables/tenancy.ts:31`. Callers: `apps/api/src/seed/dev-seed.ts:509`, `packages/db/src/testing.ts:250`, `apps/api/scripts/graph-benchmark.ts:128`, `apps/api/scripts/face-scan-benchmark.ts:142`, `apps/api/src/routes/dashboard/dashboard.test-support.ts:182`. Three db test files insert organisations by SQL and take the column default: `packages/db/src/constraints.test.ts`, `v1-fixtures.test-support.ts`, `db.integration.test.ts`. No API route creates an organisation |
| The inquiry and transaction list services (`inquiryListFilters`, `transactionListFilters`) | `listInquiries` (`services/inquiries.ts:483`) and `listTransactions` (`services/transactions/transactions.ts:261`), whose `filter[identifier]` is read at `:267-268` without `requirePiiView` |
| `services/settings.ts` and `routes/dashboard/settings.ts` | `RETENTION_KEYS` (the environment keys the route stores, `services/settings.ts:~40-96`), `getDashboardSettings` (`:115`), `updateDashboardSettings` (`:192`), `require-mfa` on the organisation at `:272-273`; routes at `routes/dashboard/settings.ts:13-72` |
| `services/redaction.ts` (`recordRedactedContributionInTx`) | `redactInquiry` (`services/redaction.ts:367`); the 9A hook `flowActionCopyTargets` runs at `:387`, just before `redactInquiryRecords` clears anything (`:388`): the analytics hook goes beside it |
| `services/retention.ts` | `runRetention` (`services/retention.ts:336`) |
| `blind-index:rebuild` and its coverage | `apps/api/scripts/blind-index-rebuild.ts` (`runBlindIndexRebuild` `:106`; the transaction field keys step `:146` through `rebuildTransactionFieldKeys`, `services/transactions/rebuild.ts:43`) |
| `routes/server/verifications.ts`, `routes/dashboard/trust-anchors.ts` | `GET /verifications/:id` (`routes/server/verifications.ts:17-46`); `GET /dashboard/trust-anchors` (`routes/dashboard/trust-anchors.ts:88-108`) |

### 13. Workflow 9A as built (the "Handover to 9B", line by line)

- **Theme plumbing (owner `api-themes`):**
  - `themeSetPublishProblems(db, { environmentId, themeSetId })` (`services/themes/publish.ts:25`) refuses any non-null set (`:30-33`); it runs first in `publishHookProblems` (`services/publish/index.ts:80-97`) when `PublishContext.themeSetId` (`:46`) is set, and the template publish passes the version's `theme-set-id` (`services/inquiry-templates.ts:154`, `:198`, `:921`). Confirmed.
  - `promoteThemeReferenceInTx` (`services/themes/promote.ts:35`) is called by the template promote (`services/templates/operations.ts:800`); a non-null set answers 501 (`NotImplementedError`). Confirmed.
  - `resolveThemeForSession` (`services/themes/resolve.ts:24`) answers `null` (`:29`); called from `getFlowSession` (`services/flow.ts:272`). Confirmed.
  - `checkThemeSetChoice` (`services/themes/settings.ts:23`) guards `default-theme-set-id` (`services/settings.ts:251`) and the inquiry's `theme-set-id` (`services/inquiries.ts:340`). Confirmed.
  - `applySessionTheme` (`apps/flow/src/theme/apply.ts:16`), `useApplySessionTheme` (`src/theme/session-theme.tsx:16`), provided in `app.tsx:53`, `:88` and called from `flow/flow-renderer.tsx:32`. Confirmed.
  - The contrast stub (`packages/core/src/contrast/index.ts`): `CONTRAST_PALETTE_TOKENS` `:16`, the three minimums `:36-38`, the sixteen `CONTRAST_PAIRS` `:76-93`, `ContrastFinding` `:99`, `ContrastNotBuiltError` `:108`, `relativeLuminance` `:127`, `contrastRatio` `:135`, `checkPaletteContrast` `:144`. Confirmed.
  - Frozen routes: `themeSetRoutes` (`routes/server/theme-sets.ts:55`, 501 at `:57`, the upload under `theme-assets` at `:219`) and `themeAssetRoutes` (`routes/flow/theme-assets.ts:16`); policy `theme-assets` 30 an hour per environment (`packages/contracts/src/rate-limits.ts:59`, `:114`, `:156`). Confirmed.
  - Tables `theme_sets`, `theme_set_revisions`, `theme_assets` (`packages/db/src/tables/theme-sets.ts:38`, `:75`, `:118`) and `inquiries.theme_set_id` (`tables/inquiries.ts:141`, its foreign key `:170`). `theme_assets.wrapped_dek` (aad `file`) is in `ENCRYPTED_COLUMNS` (`packages/db/src/encrypted-columns.ts:120`) and `REWRAP_TABLES` (`repositories/key-rotation.ts:60`); `SEALED` (`encrypted-columns.ts`) holds no theme member. Confirmed.
- **What 9A already added of C174:** ids `theset`, `dply`, `tsa`, `ssp` (`packages/contracts/src/ids.ts:116-119`, `packages/db/src/ids.ts:114-117`); scopes `theme-sets:read`, `theme-sets:write`, `deployments:read` (`packages/core/src/permissions.ts`, the end of `API_SCOPES`; developer's list ends with them; viewer reads both reads through `VIEWER_PERMISSIONS`); settings `allowed-embed-origins`, `allowed-redirect-origins`, `default-theme-set-id` (`packages/contracts/src/dashboard-api.ts:271-279`, defaults `:422-424`, served `services/settings.ts:163-166`); policies `template-preview`, `translations-import`, `internal-embed-policy`, `theme-assets` (`rate-limits.ts:52-59`); problem tables `CASE_PROBLEM_STATUSES` (`packages/contracts/src/problem.ts:551`), `FLOW_ENGINE_PROBLEM_STATUSES` (`:601`), `TEMPLATE_PROBLEM_STATUSES` (`:646`), `FLOW_DEFINITION_PROBLEM_CODES`, `THEME_PROBLEM_STATUSES` (`:698`). 9B adds only the rest (amendments B5 to B8).
- **Migration:** `packages/db/drizzle/0030_phase9a.sql` is the newest; 9B's is `0031` (B34: no new migration file here).
- **What the rollups read:** `inquiry_flow_steps` (`packages/db/src/tables/inquiry-flow.ts:43-100`: `seq` `:49`, `step_id` `:50`, `step_type` `:52`, `entered_at` `:53`, `exited_at` `:55`, `exit_port` `:57`, `outcome` `:59`, `waited_ms` `:61`, `sensitive` `:63`, `notes` `:65`); the inquiry's `flow_step_id`, `flow_state`, `flow_previous_step_id`, `flow_spec_version`, `first_device_kind`, `first_platform` and `flow_outcome` (`tables/inquiries.ts:114-124`, CHECKs `:148-165`); `files.capture_method` (`tables/verifications.ts:196`, CHECK `:228-229` over `FILE_CAPTURE_METHODS` = `upload`, `camera`, `packages/core/src/flow-records.ts:55`). Confirmed.
- **`updated_at` and its indexes (C163.4's dirty days):** `inquiries.updated_at` (`tables/inquiries.ts:143`) has only the partial retention index `inquiries_retention_updated_at_idx` (`:228-232`, terminal and unredacted); `verifications.updated_at` (`tables/verifications.ts:79`) and `verification_checks.updated_at` (`:138`) have no index; `cases.updated_at` (`tables/cases.ts:426`) has `cases_environment_id_updated_at_id_idx` (`:486-489`). So `foundation-9b` (A) adds `(environment_id, updated_at)` indexes on `inquiries`, `verifications` and `verification_checks`, and none on `cases` (B2).
- **The session response** (`packages/contracts/src/flow-api.ts:97-145`): `position`, `step`, `values`, `theme`, `copy`, `locales`, `embed`, `completion`, `spec-version`, every one optional. No `links` member (family (F) adds it).
- **The settings route and how 9A added its settings:** a shape object spread into `dashboardSettingsSchema` and the `PATCH` body (`embeddingSettingsShape`, `dashboard-api.ts:271-279`, `:387`, `:474`), its defaults merged into `DASHBOARD_SETTINGS_DEFAULTS` (`:421-424`), the keys added to `RETENTION_KEYS` and served by `getDashboardSettings` (`services/settings.ts:91-95`, `:163-166`), and the console's `Record`-typed lists kept typechecking by an excluded name type (`apps/dashboard/src/components/operators/settings-fields.ts:92-109`). The 9B settings follow the same form (common).
- **The publish acknowledgement form:** `{ key, acknowledged-by: usr_, acknowledged-at }` (`packages/contracts/src/inquiry-template-versions.ts:112-116`), stored in `inquiry_template_versions.acknowledgements` (`tables/inquiry-templates.ts:126-127`), keys of `TEMPLATE_ACKNOWLEDGEMENT_KINDS` (`:88`). Confirmed.
- **Mock registration:** `registerFakeFlowExtension` (`apps/flow/src/testing/fake-flow-registry.ts:30`) and `registerMockFlowExtension` (`apps/flow/e2e/support/mock-flow-api.ts:451`). Confirmed.
- **CI:** 14 jobs with the timeouts the handover lists (read from `.github/workflows/ci.yml`); the SDK host-test floor is 1364 (`ci.yml:398`). Confirmed.

### 14. S4-12's carried items, at the files they name

| Item (owner, orchestrator decision 1) | At the base | Placement |
|---|---|---|
| Preview resolve (C156.1; `api-templates-carry`) | `POST .../:id/preview` answers 501 in `routes/server/inquiry-template-versions.ts`, pinned by `apps/api/src/phase9a-template-plumbing.test.ts`; `previewInquiryTemplateVersionBodySchema` and `templatePreviewDocumentSchema` (`packages/contracts/src/template-routes.ts:148-187`) carry no contrast answer | Confirmed; (F) adds the gate's answer (B46); `api-themes` exports the version's resolved theme from `services/themes/resolve.ts` |
| Simulate and the presets (C156.4; `api-templates-carry`) | 501 in the same route file and in `routes/dashboard/simulation-presets.ts`; the preset repository is built (`packages/db/src/repositories/simulation-presets.ts:29`, `:47`, over `SEALED.simulationPresetScope`, `encrypted-columns.ts:143`) | Confirmed; (F) completes the scope and step members (B46) |
| `embed-origins` and `redirect-uri` publish checks (C158.2, C158.4; `api-templates-carry`) | stored and served as sent; the checks are `services/embed-origins.ts` (`redirectUriRefusal`, `allowedEmbedOrigins`) | Confirmed, inside the given paths |
| flow-spec 2 on `POST /inquiry-templates` (`api-templates-carry`) | `requireFlowV1` (`services/inquiry-templates.ts`) on creation, pinned by `routes/server/inquiry-template-flow-v2.test.ts` | Confirmed |
| `flow_run_grants` (amendment 31; column `foundation-9b` (F), publish `api-templates-carry`) | `recordedGrantOf` (`apps/api/src/flow-actions/run-workflow.ts:83-89`) reads `flowRunGrants` from the version row, which has none; `FlowRunGrantRecord` (`flow-actions/grants.ts:134-142`) is an API-internal type; `flowActionPublishGrants` (`:148`) has no caller; **`flowActionAcknowledgements` is already called** (`services/publish/flow-v2.ts:187`) | The requirement half is built (B45); only storing the grants remains; (F) moves the record type to `@openverify/core` |
| `biometricTemplates` (amendment 42; `api-templates-carry`) | private in `apps/api/src/workflows/publish/facts.ts:42`; the analyses get `templateIsBiometric: null` (`services/publish/flow-v2.ts:175`) | Confirmed: the `export` keyword and the call inside the given paths |
| The resume expiry window (amendment 21; `api-flow-carry`) | `extendExpiryOnResumeInTx` (`apps/api/src/flow-engine/expiry.ts:26`) **has no caller**; the paths are `resumeInquiry` (`services/inquiries.ts:708`) and `redeemOneTimeLink` (`services/one-time-links.ts:132`) | Confirmed; borrowed lines in those two services (B44) |
| The per-inquiry `meta.expiration-after-*` keys (amendment 21; columns `foundation-9b` (F), use `api-flow-carry`) | `createInquiryMetaSchema` (`packages/contracts/src/inquiries.ts:248-253`) is accepted on `POST /inquiries` and **read by no API code**: all four keys, `one-time-link-expiration-seconds` included, are silently ignored | (F) names the columns; the one-time link key needs a third column (B44) |
| `comparison-source` (amendment 21; `api-flow-carry`) | `comparisonSourceFor` (`flow-engine/initial-fields.ts:25`) answers `{ fields, sources }`; the builders pass only `fields` (`jobs/government-id.ts:346`, `jobs/types/database.ts:130`); the inputs are `GovernmentIdReferences.inquiryFields` (`packages/checks/src/government-id/inputs.ts:98`) and `DatabaseCheckInput.inquiryFields` (`packages/checks/src/database/inputs.ts:90`) | Confirmed; (F) adds `inquiryFieldSources` and the metadata key |
| The session's `links` (amendment 47; `api-flow-carry`) | no member in `flowSessionResponseSchema` (`flow-api.ts:97-145`); the version holds `help-url` and `privacy-url` (`inquiry-template-versions.ts:170-171`) | (F) adds the member |
| Prefill by input name (amendment 49; `api-flow-carry`) | `valuesOf` (`flow-engine/session.ts:133-151`) keys `values` by field key, also for a map `prefillFrom` (`prefillFields`, `:101-108`) | No member needed (B48) |
| The handed-off v2 phone's consent (amendment 23; `api-flow-carry`) | `flowSessionMembers` (`flow-engine/session.ts:173-232`) serves only the current step's client view | No member needed (B48) |

### 15. Phase 8 as built (re-read at the base)

- **`user_notifications`** (`packages/db/src/tables/cases.ts:1020`): `kind` a text column (`:1028`) held by `user_notifications_kind_valid` over `CASE_NOTIFICATION_KINDS` (`:1048`; `assigned`, `sla-breached`, `mentioned`, `packages/core/src/cases/vocabulary.ts:157`); `case_id` NOT NULL (`:1029`) with `user_notifications_case_fk` (`:1035`). The routes need `cases:read` (`routes/dashboard/notifications.ts:29`, `:51`) and filter by case visibility (`services/cases/notifications.ts:51`, `filterCaseVisibility`). Confirmed.
- **Exports (C138):** `apps/api/src/services/cases/exports/` (`service.ts`, `job.ts`, `retention.ts`, `selection.ts`, `print.ts`), `case_exports` (`packages/db/src/tables/case-files.ts:355`), `export_too_large` past `CASE_LIMITS['export-bytes']` (`exports/job.ts:282`, `:335`) and past 10,000 cases (`selection.ts:127`), the `case-export-sweep` registration (`jobs/repeatable/index.ts:441-446`); `cases:export` admin-only (`permissions.ts`, absent from every other built-in role). Confirmed.
- **Case templates and actions:** the transition service and its change type as in section 12; `listAvailableCaseActions` (`services/cases/actions/service.ts:484`) and `runCaseAction` (`:366`); `layout-modules` with `required-permissions` (`packages/contracts/src/case-templates.ts:133`, `:198`); `CASE_HISTORY_KINDS` (`packages/core/src/cases/vocabulary.ts:126`) with `HISTORY_WORDS` (`apps/dashboard/src/components/cases/reviewer/case-words.ts:78`). Confirmed.
- **The From address:** install-wide (section 12). Confirmed.
- **K8-27:** the case template publish refuses with unnamed 422s (`services/cases/templates.ts:211`, `:236`, `:713`); `compileCaseSearch` (`services/cases/search.ts:202`); a scan that errored is a plain `ConflictError` (`services/cases/attachments/scanning.ts:64-67`); `CASE_PROBLEM_STATUSES` is at `problem.ts:551` (not `:546`); `CASE_PROBLEM_WORDS` at `apps/dashboard/src/components/cases/case-words.ts:31`. Open, as the plan says. The golden problems sit in `contracts/fixtures/problems/cases/`, which the Android SDK never lists (B7).

### 16. Phase 7 and Phase 6 as built

- **List screenings:** `LIST_SCREENING_STATUSES` `pending`, `completed`, `partial`, `errored` (`packages/core/src/lists.ts:270`), `LIST_MATCH_STATUSES` `open`, `dismissed` (`:225`); `list_screenings` keyed by environment and inquiry (`packages/db/src/tables/lists.ts:539-588`: `match_count` `:550`, `unscreened` `:552`, `not_applicable` `:554`, `review_cause` `:556`); `list_matches` unique on inquiry, item and source (`:436`, `:488`); `createListScreeningInTx` (`apps/api/src/services/lists/screening.ts:57`). Confirmed; the `filter[list-match]` default is amendment A-15.
- **Transactions:** `searchable` on the field schema (`packages/core/src/transactions/field-schemas.ts:31`, `:48`); `transaction_field_keys (environment, transaction, field_key, value_key)` (`packages/db/src/tables/transactions.ts:513-520`), keyed under `identifier-transaction-field` (`services/transactions/write-checks.ts:145-156`) and rebuilt by `rebuildTransactionFieldKeys`; `filter[identifier]` without a PII check (section 12). Confirmed; the default is A-16.
- **The CSV writer:** `writeCsv`, `neutraliseCell`, `stripNeutraliser` (`packages/checks/src/csv/index.ts:42`, `:28`, `:33`); `readCsv` (`packages/checks/src/csv/read.ts:223`). Confirmed.
- **The signal registry:** 14 entries (`SIGNAL_REGISTRY`, `packages/core/src/signal-registry.ts`), each with `valueType`, `values` and `range` (`:98-102`) and no bins; `inquiry/list_match_count` is merged from `list_screenings` when served (`apps/api/src/services/signals/served.ts:108`). Confirmed; (A) names the bins (B13).
- **Scopes, roles and policies:** `API_SCOPES` (`packages/core/src/permissions.ts:9-88`), `OPERATOR_PERMISSIONS` (`:98-110`), `NOT_FOR_VIEWERS` (`:154`), `BUILTIN_ROLES` (`:171-278`); the 7B policies `lists-write`, `lists-match`, `importers`, `graph-queries`, `graph-unmask` (`packages/contracts/src/rate-limits.ts:20-26`). Redaction coverage lists in `apps/api/src/services/redaction.test-support.ts`: `SUBJECT_PII_TABLES` `:67`, `OPERATOR_PII_TABLES` `:111`, `THIRD_PARTY_LIST_PII_TABLES` `:118`, `GRAPH_QUERY_PII_TABLES` `:126`, `WORKFLOW_RUN_PII_TABLES` `:133`, `DECISION_PII_TABLES` `:145`, `WORKFLOW_SECRET_TABLES` `:151`, `CASE_PII_TABLES` `:164`, and 9A's `SIMULATION_PRESET_TABLES` `:178`, `THEME_ASSET_TABLES` `:184`. Confirmed.
- **Reports (Phase 6):** run notes `report_runs.notes` (`packages/db/src/tables/reports.ts:379`, CHECK `:420` over `REPORT_RUN_NOTES`); the create service `createReportInTx` (`apps/api/src/services/reports/reports.ts:512`); the origin is the **Postgres enum** `report_origin` (`packages/db/src/tables/enums.ts:185-191`) over `REPORT_ORIGINS` (`packages/core/src/report-state-machine.ts:134`), so `bulk` is an `ALTER TYPE ... ADD VALUE` (B34).
- **Verifications and the trust store:** the verification resource already has a `files` relationship (`packages/contracts/src/verifications.ts:216-218`, built at `:619-621`) and its document may include files (`:338`); `include` takes only `selfies` (`VERIFICATION_INCLUDES`, `:343`) and there is no `redacted-at` (B38). The trust store answer already serves both install flags as `settings { refresh-enabled, icao-crls-allowed }` (`packages/contracts/src/trust-anchors.ts:102-107`, served at `routes/dashboard/trust-anchors.ts:88-108`), so C173.4's API part needs nothing (B40).
- **Tokens:** `packages/contracts/src/tokens.ts` holds `ovs_` (`:10`), `ovu_` (`:11`), `ovo_` (`:14`), `ovm_` (`:16`), `ovi_` (`:18`) and Phase 7's `ovh_` (`:23`), each 43 base64url characters (`:51`); API keys are `ov_sbx_`/`ov_prod_`. The gitleaks rule covers `ovh_` too (B1).
