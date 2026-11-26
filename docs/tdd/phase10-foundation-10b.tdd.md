# Phase 10, Workflow 10B Stage 1b: foundation-10b (plumbing)

Agent: `foundation-10b`. Base `7d985a77`, 10B decisions `bf3a87e3`, Stage 1a ending at `489e799d` (contracts-10b checkpoint 10). Plumbing only: hooks, stubs, tables, routes frozen at 501, the queue, the provider kind, the rate policy; every algorithm stays with its owner. Every Gradle call ran as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)` in the foreground; "wait" is the time spent waiting for the Gradle lock, "total" the call's wall time including it, and the load is `cat /proc/loadavg` before the call (12 logical CPUs). Stage 2 agents ran beside this Stage throughout, so the shared tree held their uncommitted work during every run below.

## Checkpoint 1: the SDK hooks

### The hooks (each a call in a shared file to a stub in an owned file; review F05)

| Hook | Call site (shared) | Stub file, signature, stub answer | Owner |
| --- | --- | --- | --- |
| Capture trigger (C206.2) | `ui/CaptureScreen.kt`: the shutter runs `still(captureTriggerOf(auto = false))`; `still` calls `takeStill(camera, trigger, onCaptured)`, which hands `onCaptured(photo, facts, trigger)`; `ui/InquiryFlowScreen.kt` passes `actions::capture`; `FlowActions.capture(image, camera, trigger: CaptureTrigger? = null)`; `InquiryViewModel.capture` → `FlowCoordinator.capture(image, camera, trigger)`, kept in the photo's `Shot`, then `StepWork.shots[kind]` at `confirmCapture`; the uploads in `sendPose` and `process` pass `shot?.trigger` | `camera/CaptureTrigger.kt`: `internal fun captureTriggerOf(auto: Boolean): CaptureTrigger?`; stub `null` | `capture-pipeline` |
| Capture method (C206.1) | `FlowCoordinator`: `sendPose` and `process` pass `captureMethodOf(work.step, picked = shot?.picked == true)`; `sendDocument` passes `captureMethodOf(work.step, picked = true)` to `uploadDocument` | `camera/CaptureTrigger.kt`: `internal fun captureMethodOf(step: FlowStep, picked: Boolean): CaptureMethod?`; stub `null` | `capture-pipeline` |
| Auto-capture action (C202.4, C204.3) | `ui/CaptureScreen.kt`: `val autoCapture = screenAutoCapture { trigger -> still(trigger) }` (the same still action as the shutter; `capture-pipeline` hands it to the guidance's `run`) | `capture/AutoCapture.kt`: `internal fun screenAutoCapture(takeStill: suspend (CaptureTrigger?) -> Boolean): AutoCapture`; stub `AutoCapture { false }` (never takes a still) | `capture-pipeline` |
| Selfie window and extension (C204.5) | `FlowCoordinator.selfieCapture: StateFlow<SelfieCaptureWindow?>` (published when `work` or `work.capture` changes; `ActiveCapture.expiresAt` = creation + `CAPTURE_TTL`, `expired()` = `expiresAt.hasPassedNow()`), `suspend fun extendSelfieCapture()` (calls the extension with `ActiveCapture.window()` and adopts the answered `expiresAt` when the same capture is still open), constructor parameter `selfieExtension: suspend (FlowApi, SelfieCaptureWindow) -> SelfieCaptureWindow? = ::extendCapture`; `InquiryViewModel.selfieCapture` / `extendSelfieCapture()`; `FlowActions.selfieCapture` (default never open) and `extendSelfieCapture()` (default no-op); `ui/InquiryFlowScreen.kt` draws `SelfieCaptureExtension(window, actions::extendSelfieCapture)` over a selfie's `CaptureScreen` (in a `Box`) | `capture/selfie/Extension.kt`: `internal data class SelfieCaptureWindow(val id: String, val expiresAt: ComparableTimeMark)`; `internal suspend fun extendCapture(api: FlowApi, window: SelfieCaptureWindow): SelfieCaptureWindow?` (stub `null`: never extends); `@Composable internal fun SelfieCaptureExtension(window: SelfieCaptureWindow?, onExtend: () -> Unit, modifier: Modifier = Modifier)` (stub draws nothing) | `selfie-guidance` |
| Integrity request (C211.3) | `FlowCoordinator.requestIntegrityBeside(session)`: on a consented load (beside `sendSignalsBeside`, inside the same `consent != null && drives && not decided` guard) and after consent (with the session read after it); a child of the calling action (`CoroutineScope(currentCoroutineContext()).launch`), never awaited, any `Exception` swallowed, cancellation rethrown; skipped for `IntegrityVerdictRequest.None`. Constructor parameter `integrity: IntegrityVerdictRequest = IntegrityVerdictRequest.None`; `androidMain/InquiryViewModelFactory.kt` installs `integrityVerdictRequest(observed, components.integrityTokenProvider)` | `signals/Integrity.kt`: `internal fun interface IntegrityVerdictRequest { suspend fun requestIntegrityVerdict(session: FlowSession) }` with `companion object { val None }`; `internal fun integrityVerdictRequest(api: FlowApi, provider: IntegrityTokenProvider?): IntegrityVerdictRequest`; stub `IntegrityVerdictRequest.None` (requests nothing) | `device-integrity-android` |
| keepScreenOn (C201.5, KP10-13) | `ui/StatusScreens.kt` `WaitingScreen` calls `KeepScreenOn()` | `ui/KeepScreenOn.kt`: `@Composable internal expect fun KeepScreenOn()`; Android actual (`androidMain/.../ui/KeepScreenOn.android.kt`): `view.keepScreenOn` on `LocalView.current` with a per-view holder count, released on dispose; iOS actual (`iosMain/.../ui/KeepScreenOn.ios.kt`): nothing. Not a stub: foundation-10b's own; `capture-pipeline` calls it from the capture screens | `foundation-10b` |

The upload calls these thread through are `FlowCoordinator.kt`'s `api.uploadFile` in `sendPose` (a selfie pose, with its capture) and in `process` (the ID sides and a document's camera photo), and `api.uploadDocument` in `sendDocument`. `CaptureScreen.kt` was touched only at its capture action (the `onCaptured` type gained the trigger; the shutter's body became `still(...)`; `takeStill` is the action's testable body); it is `capture-pipeline`'s from here on.

**Golden owners** (androidHostTest `testing/Goldens.kt`): `CAPTURE_PIPELINE("capture-pipeline")`, `DOCUMENT_GUIDANCE("document-guidance")`, `PDF417_GUIDANCE("pdf417-guidance")`, `SELFIE_GUIDANCE("selfie-guidance")`, each with its folder (`.gitkeep`) under `src/androidHostTest/screenshots/`.

**Kover exclusions** (C219.2, Stage 1b amendment 8: the build reads every file in `kover-excludes/`), for the glue contracts-10b named:

| File | Pattern | Why |
| --- | --- | --- |
| `kover-excludes/capture-pipeline.txt` | `dev.openverify.sdk.camera.CameraXFrameAnalyzer*` | the CameraX `ImageAnalysis` analyzer in `androidMain/.../camera/` needs camera hardware; it runs only in the device test (C201.2, C219.5). The class name is proposed; `capture-pipeline` keeps or corrects it in its own file. |
| `kover-excludes/pdf417-guidance.txt` | `dev.openverify.sdk.capture.barcode.ZxingCppBarcodeReader*` | the zxing-cpp bridge in `androidMain/.../capture/barcode/` calls the native library; it runs only in the device test (C203.2, C219.5). The class name is proposed; `pdf417-guidance` keeps or corrects it. |

`CameraXCaptureCamera*` stays excluded by the build file itself (10A).

**Stub contracts pinned** in `flow/StateHooksTest.kt`, one case per owner, which the owner replaces: `capture-pipeline - the trigger and method stubs decide nothing, and the auto-capture stub never takes a still`; `selfie-guidance - the extension stub never extends, so the coordinator keeps the open capture's expiry`; `device-integrity-android - the integrity stub requests nothing, so a consented flow takes no challenge and sends no token`.

### TDD

Stubs `6cfc8ab1` (the five stub files, `KeepScreenOn` expect/actuals doing nothing, the signatures: `FlowActions.capture(..., trigger)`, the coordinator's `integrity` and `selfieExtension` parameters, `selfieCapture` always `null`, `extendSelfieCapture()` a no-op, `CaptureScreen`'s `onCaptured` with a trigger the action still dropped; `UiTestDoubles.RecordingActions` records `triggers`; `CaptureScreenTest`'s one `onCaptured` lambda gains its third parameter, rule 12: the signature changed by plan; the golden owners and folders; the two Kover files).

**RED** `1460bd58`: `flow/CaptureHooksTest.kt` (8), `flow/IntegrityHookTest.kt` (7), `ui/KeepScreenOnTest.kt` (2), `ui/CaptureActionHookTest.kt` (3) and three cases added to `flow/StateHooksTest.kt`.

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests ...CaptureHooksTest --tests ...IntegrityHookTest --tests ...StateHooksTest --tests ...KeepScreenOnTest --tests ...CaptureActionHookTest
27 tests completed, 16 failed   (exit 1; 195 s; load 7.66)
KeepScreenOnTest > the waiting screen keeps the screen on while it is shown, and releases it when the state moves on FAILED   java.lang.AssertionError (keepScreenOn false)
KeepScreenOnTest > the screen stays on until the last of two holders leaves FAILED
IntegrityHookTest > after consent, the request runs once with the session read after it()   expected: <1> but was: <0>
IntegrityHookTest > a load of a session that already has consent requests it, ...           expected: <[government_id]> but was: <[]>
IntegrityHookTest > a request that fails is swallowed and the flow goes on()                expected: <1> but was: <0>
IntegrityHookTest > a request that never answers holds neither the consent nor the next action, ...   expected: <1> but was: <0>
StateHooksTest > selfie-guidance - the extension stub never extends, ...   IllegalStateException: Required value was null. (no window exposed)
CaptureActionHookTest > the still action hands on the photo, the camera's facts and the trigger it was given   expected:<[(CameraFacts(...), AUTO)]> but was:<[(CameraFacts(...), null)]>
```

The first run's three ID-side cases failed on the fake's "No decision scripted" (the test's own set-up); the fixture now scripts a pass, and the re-run of `CaptureHooksTest` (exit 1, 329 s including a lock wait, load 4.44) failed 7 of 8 for the intended reasons:

```
each ID side's upload carries the trigger its capture was given ...   expected: <[(null, AUTO), (null, MANUAL)]> but was: <[(null, null), (null, null)]>
a selfie pose's upload carries the trigger its capture was given()    expected: <[(null, AUTO)]> but was: <[(null, null)]>
a photo retaken before it is kept carries the retake's trigger()      expected: <[MANUAL, MANUAL]> but was: <[null, null]>
the open selfie capture's id and expiry are exposed, ...              IllegalStateException: Required value was null.
a capture replaced after a refusal exposes the new capture()          expected: <self_01M5CK3190XEVBM5ZXA76E1J01> but was: <null>
an extension moves the capture's expiry, ...                          NullPointerException (no window)
an extension that was not granted keeps the capture's expiry, ...     expected: <[null]> but was: <[]>
```

The eighth (`with no trigger and the stubs' answers, every upload is today's`) passes on the stubs by design: it is the proof that the stubs change nothing at run time.

**GREEN** `804a7408`: the coordinator threads `Shot.trigger` and `captureMethodOf` into each upload, publishes `selfieCapture`, adopts an extension, and launches the integrity request beside the flow; `takeStill` passes the trigger; `KeepScreenOn`'s Android actual; `WaitingScreen` calls it; the view model and the dispatch expose the window and the extend action.

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.*' --tests ...KeepScreenOnTest --tests ...CaptureActionHookTest --tests ...CaptureScreenTest --tests ...StatusScreensTest --tests ...InquiryViewModelTest --tests ...InquiryFlowScreenTest
BUILD SUCCESSFUL   (exit 0; 327 s including the lock wait; load 5.63)   481 tests, 0 skipped, 0 failed
```

`637efff1` wires the integrity request into each launch (`InquiryViewModelFactory.kt`, after capture-pipeline's borrowed edit of that file landed in `36dbb08b`).

### The Android gate at checkpoint 1 (the shared tree, with Stage 2's uncommitted work in it)

| Call | Wait | Total | Load | Result |
| --- | --- | --- | --- | --- |
| (a) `:openverify-sdk:testAndroidHostTest`, whole | 215 s | 336 s | 5.62 | exit 1: the test JVM ran out of heap after 471 tests (`Gradle Test Executor 1 ... OutOfMemoryError at ByteBuffer.java:436`), during capture-pipeline's uncommitted `camera/FrameAnalyzerTest`; the 11 failures were capture-pipeline's RED or uncommitted camera tests (`CameraXCapturePipelineTest` 4, `AnalysisTargetTest` 3, `FrameAnalyzerTest` 2) and `OpenVerifyInquiryActivityComponentsTest` 2 ("no signals call", over device-integrity-android's uncommitted `AndroidDeviceSignals.kt` and probes) |
| (a) `-PhostTestGroup=flow` | 204 s | 349 s | 4.47 | exit 0: 389 tests, 0 skipped, 0 failed (every coordinator suite, `StateHooksTest`, `CaptureHooksTest`, `IntegrityHookTest`) |
| (a) `-PhostTestGroup=ui` | (background notice; see below) | about 9 min | 4.8 | exit 1: 436 tests, 1 failed: `ResourcesTest > Res holds every string and plural the resource files define` over document-guidance's uncommitted `strings_document.xml` in five folders; `KeepScreenOnTest`, `CaptureActionHookTest`, `CaptureScreenTest`, `StatusScreensTest` passed |
| (e1) `:openverify-sdk:assemble` | 238 s (two earlier tries: exit 75, lock busy) | 342 s | 6.86 | exit 1 at `compileTestKotlinIos*`: `iosTest/.../IosDeviceSignalsTest.kt:13` calls `collect`, which device-integrity-android's committed `DeviceSignals.collect` made `suspend`; `compileKotlinIosArm64` and `compileKotlinIosSimulatorArm64` (the iOS klibs, with `KeepScreenOn.ios.kt`) passed |

The `ui` group ran past the 10-minute call cap while it waited for the lock and finished as a background task; its result is the log above. Every failure lies in another running agent's paths (rule 24): none is in a file this checkpoint touched, and every suite over this checkpoint's files passed. The whole eight-call gate runs again at this Stage's end (checkpoint 4).

## Checkpoint 2: (C) server, `files.capture_trigger`

What it builds (C206.2):
- `@openverify/core` `flow-records.ts`: `FILE_CAPTURE_TRIGGERS = ['auto', 'manual'] as const`, `type FileCaptureTrigger`; `packages/contracts/src/phase10b-foundation.test.ts` holds it equal to the contract's `CAPTURE_TRIGGERS`.
- `packages/db/src/tables/verifications.ts`: `files.capture_trigger` (`captureTrigger: text('capture_trigger').$type<FileCaptureTrigger>()`), the CHECK `files_capture_trigger_valid` (`capture_trigger is null or in ('auto', 'manual')`, a `oneOf`, never an enum); `repositories/files.ts` `NewFileInput.captureTrigger?: FileCaptureTrigger | null` (stored `?? null`; `replaceVerificationFile` passes it through `createFile`).
- Migration `packages/db/drizzle/0033_phase10b.sql` (with `meta/0033_snapshot.json` and its `_journal.json` entry), generated by `drizzle-kit generate --name phase10b` after `pnpm --filter @openverify/core build`; the journal's trailing newline put back, the snapshot through prettier, a two-line header comment; no hand edits.
- `apps/api/src/routes/flow/index.ts`: the upload reads `capture-trigger` (`CAPTURE_TRIGGER_FIELD`) through `z.enum(CAPTURE_TRIGGERS)`, once at most, a 400 for any other value (the message names the list, never the value); `UPLOAD_LIMITS` `fields: 7`, `parts: 8` (was 6 and 7). `services/flow.ts`: `Upload.captureTrigger`, stored as received (`captureTrigger: upload.captureTrigger ?? null`). `services/resources.ts` `fileResource` and `routes/dashboard/resources.ts` `toFileResource` serve `captureTrigger` beside `captureMethod` (the server and console resources); the flow's upload answer (`clientReported: false`) still echoes neither. The attribute's schema description ("Client-reported: ...") is contracts-10b's.

Existing tests changed with the plan (rule 12): `routes/selfie-stubs.test.ts` (the limits, 7 and 8); `routes/server/verifications-include-files.test.ts` (the attribute keys gain `capture-trigger`); `routes/dashboard/index.test.ts` (the console's file gains `'capture-trigger': null`).

**RED** `23af1e4e` (the column, constant and repository input declared; no migration):

```
packages/db$ pnpm exec vitest run src/phase10b-tables.test.ts src/migration-0033.test.ts --coverage.enabled=false   # exit 1, load 6.37
 × keeps the trigger the client reported beside its method, and null when it did not say   (42703: column "capture_trigger" does not exist)
 × refuses any other trigger
 × is the migration after 0032_phase9d            expected -1 to be 33
 × leaves every earlier file without a trigger, and keeps its method
 × holds the trigger to the two values, null allowed   Error: no constraint files_capture_trigger_valid
 Tests  5 failed | 1 passed (6)
apps/api$ pnpm exec vitest run src/routes/flow/capture-trigger.test.ts src/routes/selfie-stubs.test.ts --coverage.enabled=false   # exit 1, load 6.14
 × stores the trigger the client reports, beside its method     expected HTTP 201, got 400: ... Only one "kind" field, the capture fields and one "file" file are accepted.
 × stores no trigger when the client sent none                  got 500 (42703 on the files query)
 × refuses a trigger outside the list with 400 and stores nothing   (42703 on the read)
 × refuses a repeated trigger field with 400
 × echoes no capture fact in the flow answer, and serves both, client-reported, on the server API
 × take seven fields ... and eight parts   expected { ... } to match object { files: 1, fields: 7, parts: 8 }
 Tests  6 failed | 2 passed (8)
```

**GREEN** `13c68872` (the migration, the route, the service, the resources):

```
packages/db$ pnpm exec vitest run src/phase10b-tables.test.ts src/migration-0033.test.ts src/migrate.test.ts src/phase9a-embed-tables.test.ts --coverage.enabled=false   # exit 0: 44 passed
apps/api$ pnpm exec vitest run src/routes/flow/capture-trigger.test.ts src/routes/selfie-stubs.test.ts src/routes/server/verifications-include-files.test.ts src/routes/dashboard/index.test.ts src/routes/flow/selfie-flow-contract.test.ts src/routes/flow/phase9a-hooks.test.ts src/routes/flow/flow-requests.android.test.ts --coverage.enabled=false   # exit 0: 69 passed (load 5.45)
```

The Postgres 17 test `packages/db/src/migration-0033.integration.test.ts` (an empty database, and one upgraded from 0032 with a file in it) was not run at RED; its first run after GREEN failed on its own assertion (drizzle wraps the driver error, so the message names the query, not the constraint) and was corrected in `68e0743e` to read the constraint from the error's cause: `bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts src/migration-0033.integration.test.ts` exit 0, 2 passed, 15 s, load 7.58.

**PGlite migration time** (Risks; `createTestDatabase` twice in one process through `tsx` with `--conditions=@openverify/source`, each run under the e2e lock; cold = an empty `OPENVERIFY_TEST_DB_CACHE_DIR`, warm = the template cached by the cold run):

| | Cold, first | Warm, first | Second copy | Load (1 min) |
| --- | --- | --- | --- | --- |
| Before, at `637efff1` (0032 last) | 6,636, 6,435, 6,735 ms | 1,398, 1,372 ms | 1,128 to 1,333 ms | 4.0 to 4.8 |
| After checkpoint 2 (0033 with `files.capture_trigger`) | 6,811, 6,506 ms | 1,433, 1,432 ms | 1,055 to 1,268 ms | 7.4 to 8.4 |

The 120 s PGlite hook budget is untouched.

**Checkpoint gates** (beside the Stage 2 agents, rule 24):
- `packages/db`: `bash /tmp/openverify-heavy.sh pnpm exec vitest run --coverage --coverage.reportsDirectory=...` exit 0, 2,185 tests in 153 files, 91.06% statements (189 s, load 7.08).
- `apps/api`, the suites this change reaches: `bash /tmp/openverify-heavy.sh pnpm exec vitest run src/routes/flow src/routes/server src/routes/dashboard src/routes/selfie-stubs.test.ts --coverage.enabled=false` exit 0, 1,894 tests in 131 files (354 s, load 14.0); the whole API suite runs as 12 shards at checkpoint 4.
- `packages/contracts` exit 0, 4,426 tests, 99.12%; `packages/core` exit 0, 1,659 tests, 99.18%.

## Checkpoint 3: (I) server, the integrity plumbing

### What it builds

**Database** (`packages/db`; `@openverify/core` `flow-records.ts` gains `INTEGRITY_VERDICT_PROVIDERS = ['play-integrity', 'sandbox']`, `type IntegrityVerdictProvider`, held equal to the contract's `DEVICE_INTEGRITY_PROVIDERS` by `packages/contracts/src/phase10b-foundation.test.ts`):

| Table (`src/tables/integrity.ts`) | Columns | Constraints and indexes |
| --- | --- | --- |
| `inquiry_integrity_challenges` | `id` (pk, `ich_`), `environment_id`, `inquiry_id`, `session_id`, `request_hash`, `token` (sealed, nullable), `created_at`, `expires_at`, `consumed_at` | FKs `inquiry_integrity_challenges_inquiry_fk` (`environment_id, inquiry_id` → inquiries, cascade) and `inquiry_integrity_challenges_session_fk` (`environment_id, session_id` → inquiry_sessions, cascade), environment FK (cascade); unique `inquiry_integrity_challenges_environment_id_id_key`; index `inquiry_integrity_challenges_environment_id_inquiry_id_idx`, index `inquiry_integrity_challenges_expires_at_idx`; CHECKs `inquiry_integrity_challenges_request_hash_format` (`^[A-Za-z0-9_-]{43}$`), `inquiry_integrity_challenges_expires_after_created`, `inquiry_integrity_challenges_token_consumed` (a token only on a used challenge), `inquiry_integrity_challenges_id_format` |
| `inquiry_integrity_verdicts` | `environment_id`, `inquiry_id` (pk: one per inquiry), `provider`, `verdict` (sealed, not null), `decoded_at`, `created_at`, `updated_at` | FK `inquiry_integrity_verdicts_inquiry_fk` (cascade), environment FK (cascade); CHECK `inquiry_integrity_verdicts_provider_valid` (`oneOf` the two names); trigger `inquiry_integrity_verdicts_set_updated_at` (the migration's one hand edit) |

- **Sealing** (row AAD, `encrypted-columns.ts`): `ENCRYPTED_COLUMNS` gains `inquiry_integrity_challenges.token` and `inquiry_integrity_verdicts.verdict` (`aad: 'row'`); `SEALED.integrityChallengeToken` (`'inquiry_integrity_challenges.token'`, bound to the challenge id) and `SEALED.integrityVerdict` (`'inquiry_integrity_verdicts.verdict'`, bound to the inquiry id).
- **Rewrap** (`repositories/key-rotation.ts`): `REWRAP_TABLES` gains both tables (after `inquiry_decisions`); `ID_COLUMNS.inquiry_integrity_verdicts = 'inquiry_id'`.
- **Redaction** (`repositories/redaction.ts`): `deleteInquiryIntegrityRecordsInTx(tx, environmentId, inquiryIds): Promise<number>`, called by `redactInquiryRecords` beside `deleteInquiryFlowRecordsInTx`; the header's table gains the row.
- **Retention** (`repositories/retention.ts`): `INTEGRITY_CHALLENGE_RETENTION_HOURS = 24` (provisional, basis in its KDoc); `deleteExpiredIntegrityChallenges(db, options)` (a challenge a day past its expiry, with any token); `deleteIntegrityRecordsOfRedactedInquiries(db, options)` (a race's leftovers). The API's C16 pass (`apps/api/src/services/retention.ts`) runs both: `RetentionReport.deletedIntegrityChallenges` and `.cleanedIntegrityRecordInquiries`.
- **Repository stub** (`repositories/inquiry-integrity.ts`, `api-integrity`'s; export line `export * from './inquiry-integrity.js';` in `repositories/index.ts`): `IntegrityRepositoryNotBuiltError`, `integrityRepositoryNotBuilt(name)`, `type InquiryIntegrityChallenge` (the row without its sealed token), `NewInquiryIntegrityChallenge`, `createInquiryIntegrityChallengeInTx(tx, environmentId, challenge)`, `storeInquiryIntegrityTokenInTx(tx, environmentId, { challengeId, sessionId, token, now }): Promise<'stored' | 'invalid'>`, `takeInquiryIntegrityToken(db, environmentId, challengeId): Promise<{ inquiryId, requestHash, token } | null>`, `type InquiryIntegrityVerdictProjection`, `InquiryIntegrityVerdict`, `storeInquiryIntegrityVerdict(db, environmentId, verdict)`, `getInquiryIntegrityVerdict(db, environmentId, inquiryId)`; each rejects naming `api-integrity`.
- Migration `0033_phase10b.sql` regenerated by the recipe (my 0033 file, snapshot and journal entry removed, `drizzle-kit generate --name phase10b` after `pnpm --filter @openverify/core build`, the journal's newline back, prettier on the snapshot, the header and the trigger re-applied).

**API**:
- **Provider kind** (`providers/index.ts`): `PHASE10_PROVIDER_KINDS = ['deviceIntegrity']`, spread into `PROVIDER_KINDS` after `PHASE8_PROVIDER_KINDS`; `PROVIDER_ENV_PREFIXES.deviceIntegrity = 'OPENVERIFY_PROVIDER_DEVICE_INTEGRITY'`; `PROVIDER_NAMES` gains `'play-integrity'`; `PROVIDER_NAMES_BY_KIND.deviceIntegrity = ['play-integrity', 'sandbox']`; `PROCESS_PROVIDER_KINDS.api` gains `'deviceIntegrity'` (the worker's list is `PROVIDER_KINDS`); `createProviderBindings` binds `createDeviceIntegrityProvider(name, { outboundHttp, clock })`; production refuses the sandbox (the generic check), and an unbound kind binds nothing.
- **Ports** (`ports.ts`): `DeviceIntegrityDecodeRequest { token, requestHash }`, `type DeviceIntegrityVerdict = Readonly<Record<string, unknown>>`, `DeviceIntegrityProvider extends ProviderIdentity { name: 'play-integrity' | 'sandbox'; decode(request) }`, `Phase10Providers { deviceIntegrity? }` in `BoundProviders`; `IntegrityDecodeJob { environmentId, challengeId }`, `IntegrityDecodeQueue { enqueueIntegrityDecode(job) }`.
- **Stubs in `services/device-integrity/`** (`api-integrity`'s): `index.ts` `createDeviceIntegrityProvider(name, options): DeviceIntegrityProvider` (decode rejects `DeviceIntegrityNotBuiltError`, naming `api-integrity`), `type DeviceIntegrityProviderName`, `DeviceIntegrityProviderOptions { outboundHttp?, clock? }`; `session-member.ts` `integritySessionMember(deps, input: IntegritySessionMemberInput): Promise<FlowSessionIntegrity | null>` (stub `null`), with `IntegritySessionMemberInput { environmentId, environmentKind, inquiryId, sessionId, signals }`.
- **Session member hook**: `getFlowSession` (`services/flow.ts`, after `resolveThemeForSession`) calls `integritySessionMember(deps, {...})` and serves `...(integrity === null ? {} : { integrity })`.
- **Routes** (`routes/flow/integrity.ts`, `api-integrity`'s, registered by `flowRoutes` after `signalRoutes` as `integrityRoutes`): `POST /api/v1/flow/integrity-challenges` (body `flowIntegrityChallengeBodySchema`, 201 `flowIntegrityChallengeSchema`, problems 400 401 409 429 501) and `POST /api/v1/flow/integrity-tokens` (body `flowIntegrityTokenBodySchema`, `bodyLimit` `INTEGRITY_TOKEN_MAX_BODY_BYTES` = 16 KiB + 1,024, 202 `null`, problems 400 401 409 413 429 501), each `requireFlowSession` then `NotImplementedError`.
- **Rate policy**: `flow-integrity` in `RATE_LIMIT_POLICIES` (last), `RATE_LIMIT_DEFAULTS` 5, `RATE_LIMIT_POLICY_WINDOWS` 3600 (per inquiry; basis in its comment); the console's `POLICY_LABELS['flow-integrity'] = 'Device integrity, per inquiry'`; `plugins/rate-limit.ts` `FLOW_INTEGRITY_ROUTES` and its `preParsing` hook count both routes under `flow-integrity` keyed by `session.inquiryId`, beside `flow-session`.
- **Queue and job**: `jobs/integrity-queues.ts` `INTEGRITY_DECODE_QUEUE = 'integrity-decode'`, `INTEGRITY_DECODE_JOB`, `INTEGRITY_DECODE_JOB_OPTIONS` (5 attempts, exponential 5 s with jitter, removed on completion and failure), `createIntegrityDecodeQueue(options)` (lazy BullMQ, `jobId` the challenge id, ids only, refuses anything but `env_` and `ich_`); `jobs/integrity/decode.ts` (`api-integrity`'s) `IntegrityDecodeDeps { db, clock, logger, keyring, providers?, outboundHttp? }`, `IntegrityDecodeResult`, `INTEGRITY_DECODE_NOT_BUILT = 'integrity_decode_not_built'`, `processIntegrityDecode` (stub: `PermanentJobError`); `worker.ts` `WorkerIntegrityOptions { process? }`, `StartWorkersOptions.integrity`, `integrityDecodeProcessor(deps)`, the worker registered with the bound providers and the outbound client, and `main` passes `integrity: {}`; the API's producer `integrityDecodes` in `ApiDependencies` (`services/context.ts`) and the container (closed with the others).
- **The five registry entries** answer `null` with `collector_missing` already (contracts-10b's `computeInquirySignals`, `packages/checks/src/signals/compute.ts:85`); nothing to add.

Existing tests changed with the plan (rule 12): `packages/db/src/schema-v2.test.ts` (the encrypted-column list), `repositories/key-rotation.test.ts` (seeds the two sealed columns), `testing.test.ts` (the table list); `apps/api/src/providers/{index,phase5b-providers,phase6-providers,phase7-providers,phase8-providers}.test.ts` and `config.test.ts` (the kind list, positions and the API's kinds), `plugins/rate-limit.test.ts` and `packages/contracts/src/rate-limits.test.ts` (the policy maps), `services/context.test.ts` (the deps keys), `services/retention.test.ts` and `retention-run.test.ts` (the report's two counts).

### TDD

**(I) database.** RED `1bf464a2` (the tables, CHECKs, sealing, rewrap, redaction, retention and repository stubs declared; no migration): `pnpm exec vitest run phase10b-tables.test.ts migration-0033.test.ts schema-v2.test.ts repositories/key-rotation.test.ts` exit 1 (load 4.89), 11 failed: `relation "inquiry_integrity_challenges" does not exist` (42P01) in every table, rewrap, redaction and retention case and in the upgrade test; `rewraps every encrypted column, resumably, ...` (key-rotation) on the same relation. The repository-stub case passed (a pin). The first commit try was refused by gitleaks (`generic-api-key` on a test literal after `token:`); the literal was reworded, never allowlisted. (A first run failed earlier on a stale `@openverify/core` `dist`, which `packages/db`'s tests resolve; `pnpm --filter @openverify/core build` fixed it.)
GREEN `afb7ef60` (the migration; `testing.test.ts`'s table list; the rewrap case keeps the database's own KEK and a well-formed envelope, since its pass covers every row of the table): the db suite exit 0, 2,198 tests, 91.09% (193 s, load 4.76); `migration-0033.integration.test.ts` exit 0, 3 passed, 15 s.

**(I) API.** RED `50503131` (ports, queue, stub processor, provider and member stubs and the route file declared, nothing registered):

```
apps/api$ pnpm exec vitest run src/routes/integrity-routes.test.ts src/routes/flow/integrity-session-member.test.ts src/providers/phase10-providers.test.ts src/providers/index.test.ts src/worker-integrity.test.ts src/plugins/rate-limit.test.ts --coverage.enabled=false   # exit 1, load 8.77
 18 failed | 50 passed: the routes 404 (expected 501 / 400), the OpenAPI paths absent, the session member not served,
 the kind missing from every list, no integrity-decode worker, flow-integrity missing from the rules
packages/contracts$ ... src/phase10b-foundation.test.ts src/rate-limits.test.ts   # exit 1: 3 failed (the policy maps)
```

GREEN `d1f9e8a8`: the targeted run above plus `config*.test.ts`, `container.test.ts`, `context.test.ts`, `worker-flow.test.ts` and every provider test: exit 0, 686 tests in 56 files; contracts exit 0, 11 tests; the dashboard typechecks (`POLICY_LABELS` is a `Record` over every policy) and its integrations tests pass (101).

**Retention.** RED `48e1b124` (the two report counts stubbed at 0): `deletes integrity challenges a day past their expiry, and the records a redacted inquiry still holds` failed (`expected { ... } to match object { deletedIntegrityChallenges: 1, ... }`). GREEN `38a8c917`: `services/retention.test.ts`, `retention-run.test.ts`, `jobs/retention.test.ts` exit 0, 45 tests.

**PGlite migration time after checkpoint 3** (0033 with the two tables): cold 6,074 and 6,444 ms, warm 1,386 and 1,504 ms, second copy 1,019 to 1,229 ms, load 3.9 to 5.2 (under the e2e lock). Unchanged against the 0032 figures within the noise of the load.

**Checkpoint gates** (rule 24): `packages/db` exit 0 (above); `apps/api` `bash /tmp/openverify-heavy.sh pnpm exec vitest run src/routes src/providers src/services/retention.test.ts src/services/context.test.ts src/services/flow src/worker-integrity.test.ts src/worker-flow.test.ts src/retention-run.test.ts src/plugins src/container.test.ts src/config.test.ts src/config-phase7.test.ts --coverage.enabled=false` exit 0, 3,014 tests in 207 files (488 s, load 11.9). The whole API suite, every other gate and the OpenAPI snapshot run at checkpoint 4.

## Checkpoint 4: the OpenAPI snapshot and the final gates

**OpenAPI** (`014886bd`): `pnpm --filter @openverify/api openapi:write` exit 0 (sha256 `1377940d…` before), then again exit 0 with no change: `docs/api/openapi.json` sha256 `f4e3f754fa4d853793222e753c03eaf37b6ed49e14ef3f21701a0cc132ecf2c0` (+139 lines: the two integrity routes and `flow-integrity` in the rate-limit resource's enum). `phase9b-openapi-problems.test.ts` and `openapi.test.ts` exit 0 (68 tests).

**Gate fixes found by the final gates, each a commit of its own:**
- `bdfb4d0b` refactor: the forced lint refused the repository and service stubs' unused `_` parameters (`@typescript-eslint/no-unused-vars`, 15 in `packages/db`, 3 in `apps/api`) and a type assertion in a test; each stub is now a typed constant whose implementation takes no parameters (the names live in the type), behaviour unchanged.
- `de9bed70` test: the API's merged run failed `services/redaction.test.ts > the PII redaction test covers every table that stores PII > seeds every encrypted table except operator data` (the two new encrypted tables were not among `SUBJECT_PII_TABLES`). `seedPiiSubject` now seeds a token sealed in a challenge of the subject's session and the inquiry's verdict, both marked with `PII_MARKER`; `remainingCopies` opens both, so the redaction test proves the inquiry's redaction leaves neither (the four files that use the seed: exit 0, 69 tests).

**Final gates** (rule 24's list for this Stage, each its own foreground call; the load is the 1-minute figure before the call):

| Gate | Result | Time | Load |
| --- | --- | --- | --- |
| `flock /tmp/openverify-pnpm.lock pnpm install --frozen-lockfile` | exit 0 (lockfile up to date; no `minimumReleaseAgeExclude`) | 1 s | 4.4 |
| `pnpm format:check` | exit 0 | 123 s | 4.4 |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run typecheck lint --force --filter=@openverify/core` | exit 0 | 33 s | 4.9 |
| the same for `@openverify/contracts` | exit 0 | 122 s | 10.9 |
| the same for `@openverify/db` | exit 0 (after `bdfb4d0b`; the first run, exit 1, found the stubs' unused parameters) | 93 s | 4.3 |
| the same for `@openverify/api` (`--concurrency=1`, through the heavy script) | exit 0 | 355 s | 5.9 |
| the same for `@openverify/dashboard` (`--concurrency=1`, through the heavy script) | exit 0 | 278 s | 4.7 |
| `packages/core` test script | exit 0, 1,659 tests, 99.18% | 8 s | 4.4 |
| `packages/contracts` test script | exit 0, 4,428 tests, 99.12% | 20 s | 4.5 |
| `packages/db` test script (heavy) | exit 0, 2,198 tests in 153 files, 91.10% | 150 s | 4.8 |
| `apps/dashboard` test script (heavy) | exit 0, 6,755 tests in 580 files, 95.58% | 372 s | 9.4 |
| `apps/api`, 12 blob shards (heavy; 114 to 157 s each, load 3.3 to 13) and the merge | the first merge exit 1: 9,509 passed, 1 failed (the redaction coverage case above); after `de9bed70`, shard 1 (the redaction file's) again (132 s, load 4.0) and the merge **exit 0: 9,510 tests in 702 files, 94.42% statements** (52 s, load 13.1) |  |  |
| `pnpm --filter @openverify/watchlist benchmark:typecheck` / `benchmark:test` (rule 16: `@openverify/db`'s exports grew) | exit 0 / exit 0, 119 tests | 42 s / 10 s | 4.5 |
| `pnpm --filter @openverify/db test:integration` (heavy) | exit 0, 81 tests in 18 files (78 before + 3 of `migration-0033.integration.test.ts`) | 113 s | 3.1 |
| `apps/api` integration `--project graph` | exit 0, 13 tests (template 225,000 rows in 17,897 ms of 180 s) | 36 s | 12.6 |
| `apps/api` integration `--project api --shard=1/3`, `2/3`, `3/3` | exit 0: 93, 104, 88 tests | 89, 166, 89 s | 8.5, 18.3, 8.0 |
| `bash infra/tests/ci-workflow.test.sh` | exit 0, 264 passed | 8 s | |
| `bash infra/tests/compose.test.sh --static-only` | exit 0, 515 passed | 3 s | |

**The Android gate** (rule 17's eight calls, every Android agent's work committed, the tree clean):

| Call | Result | Total | Wait | Load |
| --- | --- | --- | --- | --- |
| (a) `:openverify-sdk:testAndroidHostTest` | **exit 1**: 2,312 tests, 0 skipped, 2 failed: `OpenVerifyInquiryActivityComponentsTest` "in production it is never sent, and the body still is" and "in a sandbox the installed outcome rides on the signals body" (`no signals call`); the class alone fails the same way (40 s, load 2.8) | 127 s | 0 | 9.6 |
| (b) `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | exit 0 (up to date over the committed goldens; 60 screenshot tests in its last results) | 11 s | 0 | 2.5 |
| (c) `koverVerify checkKotlinAbi` | **exit 1** at its `testAndroidHostTest` dependency (the same 2 failures); `checkKotlinAbi` alone exit 0 (9 s); `koverVerify koverXmlReport` with an init script that only lets the test task's failures through (`-I .../ignore-test-failures.gradle`, a measurement, not the gate) exit 0: **97.73% lines** (9,176 covered, 213 missed) | 130 s | 0 | 2.8 |
| (d1) `testDebugUnitTest assembleDebug` | exit 0 | 11 s | 0 | 1.9 |
| (d2) `:demo-app:assembleRelease :demo-app:bundleRelease` | exit 0 | 11 s | 0 | 2.2 |
| (e1) `:openverify-sdk:assemble` | exit 0 (the iOS klibs and `checkDependencyBoundary`) | 11 s | 0 | 2.7 |
| (e2) `lint` | exit 0 | 11 s | 0 | 2.7 |
| (f) `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | exit 0 | 11 s | 0 | 2.6 |

The calls (b) and (d1) to (f) were up to date: another agent had built the same committed tree minutes before. **The two failures are not this Stage's**: device-integrity-android's `docs/tdd/phase10-device-integrity-android.tdd.md` names the cause (`collect` now reads on `Dispatchers.IO`, and these tests block Robolectric's paused main looper in `server.takeRequest(5 s)`) and hands the fix of `OpenVerifyInquiryActivityComponentsTest.signalsBody()` (android-sdk-api's 10A file, shared in 10B) to integration-10b; neither class touches a hook of this Stage (these tests install no integrity provider, so `IntegrityVerdictRequest.None` returns before any launch). Reported as failed, with that owner.

The SDK host-test count rose from 1,960 (contracts-10b's close) to 2,312 with every 10B agent's tests; this Stage added 23 (`CaptureHooksTest` 8, `IntegrityHookTest` 7, `KeepScreenOnTest` 2, `CaptureActionHookTest` 3, `StateHooksTest` +3, minus none).

**Checkpoint 4** ends at the commit carrying this record.
