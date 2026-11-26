# Phase 10, Workflow 10B Stage 3: integration-10b

Evidence for integration-10b (run alone, last): the hooks and defects the Stage 2 reports handed on, the known items, the docs, the OpenAPI regeneration, CI and the full validation. Base: `76bcb109` (api-integrity checkpoint 3). Every command ran after `source scripts/env.sh`; exit codes are read from the command, never a pipe.

## 1. OpenVerifyInquiryActivityComponentsTest waits on a paused main looper (foundation-10b, capture-pipeline, document-guidance, pdf417-guidance, selfie-guidance and device-integrity-android blockers)

Cause (device-integrity-android's record): since C210.3 the probes read on `Dispatchers.IO`, so the signals send resumes on the main looper, which Robolectric keeps paused while `signalsBody()` blocks it in `server.takeRequest(5, SECONDS)`.

RED (the test at `76bcb109`, load 1.28, no lock wait):

```
(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests dev.openverify.sdk.OpenVerifyInquiryActivityComponentsTest)
OpenVerifyInquiryActivityComponentsTest > in production it is never sent, and the body still is FAILED
    java.lang.IllegalStateException at OpenVerifyInquiryActivityComponentsTest.kt:247
OpenVerifyInquiryActivityComponentsTest > in a sandbox the installed outcome rides on the signals body FAILED
    java.lang.IllegalStateException at OpenVerifyInquiryActivityComponentsTest.kt:247
10 tests completed, 2 failed
rc=1 (44.7 s)
```

GREEN: `signalsBody()` waits in 50 ms steps and idles the main looper between them (device-integrity-android's recipe, its contractDeviation applied verbatim); still at most five other requests before the signals call.

```
same command: BUILD SUCCESSFUL in 47s, rc=0
```

## 2. FlowApiClient sends the integrity calls (device-integrity-android's hook gap, C211.3)

contracts-10b's no-argument stubs had no HTTP client, API base or authorization, so in production the integrity request sent nothing.

RED `015d1aaf`: `IntegrityRequestFixturesTest`'s two integrity cases and `IntegritySingleUsePostTest`'s adapter call the real `FlowApiClient`.

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests '...IntegrityRequestFixturesTest' --tests '...IntegritySingleUsePostTest'
integrity-challenge.json FAILED  java.lang.UnsupportedOperationException at IntegrityRequestFixturesTest.kt:68
integrity-token.json FAILED      java.lang.UnsupportedOperationException at IntegrityRequestFixturesTest.kt:68
IntegritySingleUsePostTest > a token post whose answer was lost ... FAILED
7 tests completed, 3 failed (rc=1)
```

GREEN: `FlowApiClient.createIntegrityChallenge()` = `IntegrityRequests.challenge(http, apiBase, authorization)`, `sendIntegrityToken` = `IntegrityRequests.token(...)`; the no-argument stubs and `IntegrityRequestsStubTest`'s first test are deleted. The fixtures are byte-identical (no `UPDATE_CONTRACT_FIXTURES` run).

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.*'   BUILD SUCCESSFUL in 1m 42s (rc=0)
```

## 3. The coordinator's capture hooks (selfie-guidance contractDeviation 2, capture-pipeline's C206.1 hook)

RED `0aef6043` (`flow/IntegrationCaptureHooksTest`, 4 tests):

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.flow.IntegrationCaptureHooksTest'
expected: <SelfieCaptureGuidance(maxCenterYawRatio=0.021, minSideYawRatioChange=0.077, holdMs=500)> but was: <null>
in a sandbox a photo may be picked only when the native entry allows uploads: expected: <true> but was: <false>
Unsupported(reason=government_id without camera capture) ==> expected: <true> but was: <false>
Capture(step=GovernmentIdStep(... captureMethods=[CAMERA], captureMethodsByDevice=...native=[UPLOAD]...)) ==> expected: <true> but was: <false>
4 tests completed, 4 failed (rc=1)
```

GREEN `e4a4158e`: `ActiveCapture.window()` = `SelfieCaptureWindow(id, expiresAt, created.attributes.guidance)`; `resolve`'s camera check and `uploadAllowed` read `nativeCaptureMethods(step)`. 4 of 4 pass.

## 4. The launch's capture guidance (selfie-guidance contractDeviation 3, capture-pipeline's missing hook)

Stub `dc2daa6b` (`InquiryLaunchScope.selfieWindow`, `captureGuidance = BuiltInCaptureGuidance`). RED `b0aff052` (`capture/LaunchCaptureGuidanceTest`, 3 tests):

```
LaunchCaptureGuidanceTest > a selfie prompt is guided with an installed detector and the open capture's thresholds() FAILED
7 tests completed, 1 failed (rc=1; IntegrationCaptureHooksTest's 4 pass in the same run)
```

GREEN: `InquiryLaunchScope.captureGuidance = SelfieGuidanceFactory(components.faceDetectorFactory, { selfieWindow?.value?.guidance }, next = BuiltInCaptureGuidance)`, one per launch; the activity sets `scope.selfieWindow = viewModel.selfieCapture`, calls `SelfieExtensions.reset()` on a new launch (`savedInstanceState == null`), and provides `LocalCaptureGuidance provides scope.captureGuidance` beside the screen environment.

```
--tests LaunchCaptureGuidanceTest --tests 'OpenVerifyInquiryActivity*' --tests IntegrationHooksTest: BUILD SUCCESSFUL in 58s (rc=0)
```

## 5. The signal jobs read the bound deviceIntegrity provider (api-integrity's missing hook 1, C211.5)

Stub `597dc7ba` (`InquirySignalsInputContext.deviceIntegrity?`, `InquirySignalsDeps.providers?`, read by nothing). RED `efc10fe7` (`apps/api/src/jobs/signals/device-integrity-hook.test.ts`, a consented session under the session-integrity tier, a stored sandbox verdict):

```
pnpm exec vitest run src/jobs/signals/device-integrity-hook.test.ts --coverage.enabled=false
× carries a stored sandbox verdict to the two Play Integrity signals of the inquiry   AssertionError: expected null to be 'strong'
× assembles the facts in the shared input when the context names the provider ...      AssertionError: expected undefined to match object { provider: ... }
Tests  2 failed | 1 passed (3)   rc=1
```

GREEN: `inquirySignalsInputInTx` adds `deviceIntegrity: await deviceIntegritySignalsInput(tx, ..., context.deviceIntegrity)` when the context names it; `deviceIntegrityContext(providers, kind)` (process.ts) gives `{ deviceIntegrity: providers[kind].deviceIntegrity ?? null }`, or nothing without bindings; `processInquirySignals` and `processFlowSignalSnapshot` spread it; `worker.ts` passes `providers: options.providers` to `inquirySignalsProcessor` and `flowSignalSnapshotProcessor`.

```
pnpm exec vitest run src/jobs/signals/ src/jobs/flow/signal-snapshot.test.ts src/worker --coverage.enabled=false
Test Files  16 passed (16)   Tests  140 passed (140)   rc=0
tsc --noEmit rc=0; eslint on the five files rc=0
```

## 6. The integrity routes drop the frozen 501; the OpenAPI snapshot regenerated (foundation-10b amendment 11)

RED `35bbf157` (`routes/integrity-routes.test.ts`, the OpenAPI case asserts no 501):

```
pnpm exec vitest run src/routes/integrity-routes.test.ts --coverage.enabled=false
× lists both routes under the flow API with their bodies and answers
AssertionError: expected [ '201', '400', '401', '409', …(2) ] to not include '501'
Tests  1 failed | 7 passed (8)   rc=1
```

GREEN: `problemResponses(400, 401, 409, 429)` and `(400, 401, 409, 413, 429)` in `routes/flow/integrity.ts`; `integrity-routes.test.ts` and `routes/flow/integrity.test.ts` 18 of 18 pass. `pnpm --filter @openverify/api openapi:write`: 12 lines removed from `docs/api/openapi.json`, sha256 `407571a0406cf2b1b0897be272388fcfe4a2f2f44470e0d8087062e5f7b3b0d4` (was `f4e3f754…c2c0`); `src/openapi.test.ts` passes without the write flag.

`@openverify/node` needs no regeneration: its resource types are `@openverify/contracts`' (`types.ts` re-exports `SelfieCaptureResource`, `VerificationResource`), so `capture-trigger` and the integrity schemas reach it through the contracts package; no `contracts/fixtures/api/*` file is generated from a route schema 10B changed (the 10B golden `flow-integrity-challenge.json` is contracts-10b's, parsed by `fixtures.test.ts`).

## 7. The composed stack passes the deviceIntegrity binding and Play Integrity's settings (an integration defect)

api-integrity's `.env.example` rows reached no container: `infra/docker-compose.yml` passed neither the binding nor the settings, so `--profile app` could never bind the kind.

RED `975a01d2`: `bash infra/tests/compose.test.sh --static-only` → `# 524 passed, 7 failed` (api/worker receive each DEVICE_INTEGRITY binding; worker receives each PLAY_INTEGRITY setting).

GREEN: the binding in `shared-provider-environment` (API and worker alike), the three settings in `worker-provider-environment` only. `# 531 passed, 0 failed` (rc=0).

## 8. The e2e stack binds the sandbox deviceIntegrity provider (C211.1, for the 10B spec)

RED `65afa816` (`e2e/src/env.test.ts`): `AssertionError: expected undefined to be 'sandbox'`, `Tests 1 failed | 24 passed (25)` (rc=1).

GREEN: `generateE2eEnv` sets `OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX=sandbox`, production empty, and the three Play Integrity settings empty, whatever the shell exports. `Tests 25 passed (25)` (rc=0).

## 9. The 10B full-stack spec (C224.3): `e2e/tests/device-integrity.spec.ts`

An API-driven client with the Android `User-Agent` and `OpenVerify-Flow-Spec: 2` runs the 10A Android flow (English): consent with the Android digests, one Android signals body, the session's integrity request (one challenge, one sandbox magic token, the worker's decode awaited through the verdict row's presence), the database step, the screen, the completion; then the frozen signals. Two tests, budget 90 s each.

Its RED is the units it rests on: §5 (the signal job read no provider: both Play Integrity signals `null`) and §8 (no provider bound on the stack: `integrity.request` never true). On the fresh stack (`e2e:stack:up` 106 s at load 1.6):

```
flock /tmp/openverify-e2e.lock sh -c 'OPENVERIFY_E2E_REUSE_STACK=1 pnpm --filter @openverify/e2e exec playwright test --project=chromium tests/device-integrity.spec.ts'
✓ emulator, hooking and debugger evidence and a strong sandbox verdict reach the signals, and nothing is declined (9.2s)
✓ a clean Android-only session reads no indicator as false, the low bot band and an unrecognized app (14.1s)
2 passed (26.2s)   rc=0   (load 3.75)
```

`signals.spec.ts` and `flow-android.spec.ts` on the same stack with the sandbox provider bound: 3 passed (23.6 s).

## 10. Decision 66's legal texts (contracts-10b blocker 1): the web side

RED `36176e17`:

```
pnpm --filter @openverify/flow-spec exec vitest run src/v2/copy-keys-play-integrity.test.ts
AssertionError: expected undefined to deeply equal { maxLength: 2000, …(4) }      Tests 1 failed (1)
pnpm --filter @openverify/flow exec vitest run src/i18n/integrity-notices.test.ts
AssertionError: expected undefined to deeply equal Any<String>                     (notice.play-integrity, each locale)
AssertionError: build properties: expected 'To protect your verification against …' to contain 'build properties'
Tests 6 failed | 6 passed (12)
```

GREEN: `COPY_KEYS['notice.play-integrity'] = noticeText()`; the five web catalogs gain `notice['play-integrity']` (names Google and what it receives: the app's package name, version and signing certificate, its licence status and an attestation of the device's integrity) and a new `nativeApp.notice['session-integrity']` (names the probes' reads: build properties, the app's own process with its memory map, thread names and loaded classes, the mount table, known files; only the names of the signs found are sent). The web's own `notice.session-integrity` is unchanged (decision 10B item 8). Non-English texts are machine-drafted (KP10-16: the owner's review). Then `pnpm --filter @openverify/flow i18n:export` (the five locale exports, the web rows of `consent-texts.json` appended under a new `web-a8a42feea15e8a73`, `catalog-version.ts`) and `UPDATE_CONTRACT_FIXTURES=1 pnpm --filter @openverify/flow-spec exec vitest run src/export-vectors.test.ts` (`copy-keys.json`, 21 keys).

```
flow-spec whole suite: 26 files, 470 passed; @openverify/flow src/i18n + src/lib: 300 passed; contracts: 112 files, 4428 passed
apps/api src/services/templates src/routes/flow/consent src/services/publish src/phase9*: 31 files, 355 passed; dashboard translations: 16 passed
```

## 11. Decision 66 on Android: the key map, the consent table and the digests

RED (the contract change of §10 at `1e40bad9`, before any Android edit):

```
./gradlew --no-daemon :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.i18n.*' --tests 'dev.openverify.sdk.consent.*' --tests ...MessagesTest --tests ...ConsentDigestScreenTest --tests ...ResourcesTest
CopyKeysFixtureTest > everyExportedKeyIsPlacedIgnoredOrUnsupportedByItsLegalMark() FAILED
CopyKeysFixtureTest > theSdksRulesAreTheExportedCopyKeys() FAILED
KeyMapCatalogTest > every locale's catalog holds exactly the key-mapped strings, in the web's words (C199_1)() FAILED
LegalKeyMapTest > every legal copy key is mapped to an SDK string with its mark, and every mapped flow key is a copy key (C199_1, C199_7)() FAILED
132 tests completed, 4 failed (rc=1)
```

GREEN:
- `i18n/key-map.json` gains `openverify_notice_play_integrity` (flowKey = catalogKey = `notice.play-integrity`, legal `notice`; 27 entries); `SDK_COPY_KEYS` and the resource map in `i18n/OperatorCopy.kt`; `ConsentTexts` in `ui/Messages.kt`; `review-status.json` lists the key (machine-drafted, from the web catalogs).
- `:openverify-sdk:generateLocaleStrings` rewrote `strings_catalog.xml` in the five folders (the new notice and the probe-naming session-integrity text); `:openverify-sdk:exportConsentTexts` appended 45 Android rows (9 keys x 5 locales) under `android-0.1.0-6ed3979d273c180e`.
- **A defect the second Android version exposed:** `consent-texts.android.test.ts` exported digests for every Android row of the append-only table, so the file held two catalog versions and `ConsentTextTest`/`ConsentDigestScreenTest` (which check the current SDK's texts) failed on the old one (`expected: <android-0.1.0-6ed3979d273c180e> but was: <android-0.1.0-75ddea08ad090412>`). The exporter now takes the latest Android version's rows (the last appended); earlier rows stay in the table and the server still accepts their digests. `UPDATE_CONTRACT_FIXTURES=1` rewrote `android-consent-digests.json`.
- Pins changed with the plan (rule 12): `OperatorCopyTest` 20 -> 21 rules (+ the new rule), `ConsentTextTest` 40 -> 45 current rows and its resource map, `MessagesTest`'s key set, `ConsentDigestScreenTest`'s step lists the new notice.
- `UPDATE_CONTRACT_FIXTURES=1 ... --tests ...ConsentRequestFixturesTest` rewrote `consent-built-in.json`, `consent-optional.json`, `consent-custom.json` (the new catalog version and digests).

```
Android: --tests 'dev.openverify.sdk.consent.*' ConsentDigestScreenTest MessagesTest 'dev.openverify.sdk.i18n.*': BUILD SUCCESSFUL (rc=0)
API: flow-requests.android.test.ts, src/services/templates, src/routes/flow/consent: 12 files, 116 passed
```

## 12. Publish applies play_integrity_notice_missing (api-integrity's missing hook 2, C211.9)

RED `e863b0ee` (`apps/api/src/services/publish/play-integrity-notice.test.ts`, a v2 flow whose consent shows `notice.session-integrity`, validated in `publish` mode and published with a sandbox `deviceIntegrity` provider bound):

```
pnpm exec vitest run src/services/publish/play-integrity-notice.test.ts --coverage.enabled=false
AssertionError: expected '{"status":"valid","problems":[]}' to contain 'play_integrity_notice_missing'
Tests  1 failed | 1 passed (2)   rc=1
```

GREEN: `publishRulesInTx` (`services/inquiry-templates.ts`) and `validateTemplateVersion` (`services/templates/operations.ts`) pass `deviceIntegrityBound: deps.providers[acting.environmentKind].deviceIntegrity !== undefined` to `flowPublishReport`.

```
pnpm exec vitest run src/services/publish src/services/templates src/routes/server/inquiry-template src/services/inquiry-templates --coverage.enabled=false
Test Files  30 passed (30)   Tests  233 passed (233)   tsc rc=0
```

## 13. The stack's v2 flows show notice.play-integrity; the SDK shows it too

With the sandbox `deviceIntegrity` provider bound on the stack (§8) and the rule applied (§12), every v2 flow whose consent shows `notice.session-integrity` is refused at publish. RED on a fresh stack (`e2e:stack:up` 191 s, load 2.5):

```
playwright test --project=chromium tests/flow-android.spec.ts tests/device-integrity.spec.ts tests/flow-branching.spec.ts
✘ device-integrity / flow-android / flow-branching: Error: [{"pointer":"/flow/steps/0","code":"play_integrity_notice_missing", ...}]
3 failed (rc=1)
```

GREEN (e2e): `consentStep()` (`e2e/tests/support/flow-v2.ts`, used by every v2 spec and the console helpers) and the 10A Android fixture (`e2e/src/android-flow.ts`, `e2e/fixtures/android-10a/flow.json` rewritten by `UPDATE_CONTRACT_FIXTURES=1` then prettier) add `notice.play-integrity`; `flow-android.spec.ts` and `device-integrity.spec.ts` send its digest. The same run: 8 passed (56.5 s).

Then `:openverify-sdk:stackTest` failed: `IllegalStateException: consent: the flow showed Unsupported(reason=consent text notice.play-integrity)`. Host twin RED `e2c1f449` (`flow/IntegrationConsentNoticeTest`): `Unsupported(reason=consent text notice.play-integrity) ==> expected: <true> but was: <false>`. GREEN: `FlowCoordinator.Settings.consentTextKeys` lists `notice.play-integrity`. `IntegrationConsentNoticeTest` + `FlowCoordinatorTest` pass; `stackTest` passes (33 s, rc=0).

## 14. CI: the SDK host-test floor and the device tests' measurement lines

Measured (gate call (a), §16): **2,319** SDK host tests, none skipped. Arithmetic: 1,934 (10A) + 26 (contracts-10b, 1,960) + 352 (foundation-10b 23, capture-pipeline 72, document-guidance 37, pdf417-guidance 39, selfie-guidance 66, device-integrity-android 115; 2,312 at their gates) + 8 (integration-10b: IntegrationCaptureHooksTest 4, LaunchCaptureGuidanceTest 3, IntegrationConsentNoticeTest 1) - 1 (IntegrityRequestsStubTest's stub case removed with the wiring) = 2,319.

RED `172ca175` (`bash infra/tests/ci-workflow.test.sh`):

```
FAIL - android: the test-count floor fails with one test fewer than 10B's floor (2318) (exit 0: ...; the floor is 1934)
FAIL - android: the test-count floor fails at Workflow 10A's earlier floor of 1934 (exit 0: ...)
FAIL - android-instrumented: prints the device tests' measurement lines (openverify-probes, OpenVerifyCameraTest) after the run
# 263 passed, 3 failed, 0 skipped   (rc=1)
```

GREEN: `ci.yml`'s floor step reads 2319 (name, argument, comment with the arithmetic); the emulator script prints `adb logcat -d -s openverify-probes OpenVerifyCameraTest || true` after `check-connected-results.sh`, so the probes' total time (C210.3) and the barcode copy costs (C201.2, F11) are in the job log of a passing run. The new device tests (`CameraXFramePipelineTest`, `ZxingCppBarcodeReaderDeviceTest`, `IntegrityProbesDeviceTest`) run through the existing `:openverify-sdk:connectedAndroidDeviceTest`. `# 266 passed, 0 failed, 0 skipped` (rc=0).

## 15. The passport guide on screen is the one the guidance measures (document-guidance's hook, C202.1)

Refactor `a3276bac` (`captureGuideAspect(state)` drives `CaptureGuide`, same frames; `CaptureScreenTest` passes). RED `632b0e40` (`ui/CaptureGuideAspectTest`): both cases fail (the card's 1.586 drawn on a passport-only front where the guidance measures 125/88), `26 tests completed, 2 failed`. GREEN: an ID side's frame is `DocumentGuide.aspectOf(state)`; `CaptureGuideAspectTest`, `CaptureScreen*` and `dev.openverify.sdk.capture.*` pass (rc=0). No golden changes: none is of a passport-only step.

This makes the SDK host-test count 2,321 (§14's 2,319 + these 2); the floor stays 2,319 (rule 17: at or above; the validation's gate (a) measures the final count).

## 16. The floor at the validation's count, and KP10-20

The validation's gate call (a) measured **2,321** host tests (three groups: ui 450, flow 394, rest 1,477), §15's two tests above §14's 2,319. RED `90934909`: `FAIL - android: the test-count floor fails with one test fewer than 10B's floor (2320) (... the floor is 2319)`, `# 265 passed, 1 failed`. GREEN: `ci.yml` reads 2321 (name, argument, comment); `# 266 passed, 0 failed, 0 skipped`.

KP10-20 (docs only, no test): `e2e/README.md`'s "Shards." bullet now gives this validation's run (below): 189 tests in 51, 45, 46 and 47, in 260, 327, 296 and 361 s, the stack start 106 s, the sweep 305 s, stackTest 35 s, the mocked suite 328 in 2.0 min; 9D's measurement stays as history.

## 17. The validation (Phase 9's order with 10A's amendments: the eight-call Android gate, the API in 8 blob shards, the sweep then stackTest)

Run alone, each step one foreground call, exit code read from the command; heavy calls through `OPENVERIFY_HEAVY_RESERVED=1 bash /tmp/openverify-heavy.sh`; no Gradle lock wait on any Android call. Tree at `68e1326a` (+ the floor and README commits, which touch no tested code).

| Step | Call | Exit | Time | Load | Result |
|---|---|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` (pnpm lock); `pnpm format:check` | 0, 0 | 0 s, 130 s | 2.9 | all files formatted |
| 2 | forced typecheck | 0 | 162 s | 1.6 | 17 tasks |
| 2 | forced lint: api / dashboard+contracts / other 14 | 0, 0, 0 | 188, 209, 303 s | 6.0, 2.0, 2.3 | 1, 2, 14 tasks |
| 3 | `fetch_models.py`, `fetch_data.py` | 0, 0 | 0 s each (cached) | 1.9 | |
| 4 | `build:variant-groups` | 0 | 7 s | 1.9 | |
| 5 | watchlist+e2e+db | 0 | 347 s | 1.6 | 820 (98.63%), 134 (96.81%), 2,205 (91.1%) |
| 5 | dashboard | 0 | 432 s | 2.0 | 6,755 (95.58%) |
| 5 | the other 12 | 0 | 214 s | 5.5 | contracts 4,428, checks 3,849, workflow-engine 1,990, core 1,659, flow 1,519 (94.84%), node 486, flow-spec 470, emrtd 318, config 290, signals 192, ui 58, all >= 80% |
| 5 | `@openverify/js` | 0 | 5 s | | 19 (100%) |
| 5 | API, 8 blob shards + merge | shards 1 (partial coverage, as designed); merge 0 | 177, 212, 226, 198, 206, 182, 173, 168 s; merge 36 s | 0.3 to 10.8 | **9,565 tests in 712 files, 94.41% statements** |
| 6 | `benchmark:typecheck`, `benchmark:test` | 0, 0 | 50, 11 s | 4.8 | 119 passed |
| 7 | db integration | 0 | 128 s | 2.4 | 81 |
| 7 | graph | 0 | 73 s | 17.0 | 13 (template 31.6 s of 180) |
| 7 | api 1/3, 2/3, 3/3 | 0, 0, 0 | 117, 198, 103 s | 6.7, 18.7, 6.4 | 97, 101, 90 |
| 8 | `uv lock --check`, ruff, format, mypy | 0 | 2 s | 14.7 | |
| 8 | pytest files 1-58 / 59-106 | 0, 0 | 302, 345 s | 12.0, 1.2 | 1,445 + 1,179 = 2,624, **97.41%** |
| 9a | `testAndroidHostTest -PhostTestGroup=ui/flow/rest` (split: the whole call took 299 s earlier) | 0, 0, 0 | 114, 47, 85 s | 1.0, 2.7, 3.3 | **450 + 394 + 1,477 = 2,321**, none skipped |
| 9b | `screenshotTest -Proborazzi.test.verify=true` | 0 | 45 s | 2.3 | 60 tests, 59 goldens, 2,724,240 bytes |
| 9c | `koverVerify checkKotlinAbi` | 0 | 164 s | 2.2 | `:openverify-sdk` 97.73% lines |
| 9d1 | `testDebugUnitTest assembleDebug` | 0 | 32 s | 3.4 | |
| 9d2 | `:demo-app:assembleRelease :demo-app:bundleRelease` | 0 | 82 s | 4.1 | |
| 9e1 | `:openverify-sdk:assemble` | 0 | 56 s | 5.3 | AAR, iOS klibs, checkDependencyBoundary |
| 9e2 | `lint` | 0 | 151 s | 6.1 | |
| 9f | `assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | 0 | 25 s | 3.8 | |
| 9 (cold) | fresh `GRADLE_USER_HOME`: `testDebugUnitTest assembleDebug :openverify-sdk:assemble :openverify-sdk:compileAndroidHostTest`; then CI's second call `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true checkKotlinAbi :demo-app:bundleRelease`; then `lint` | 0, 0, 0 | 198, 106, 156 s | 4.0, 8.1, 6.0 | dependency verification on from a cold home |
| 10 | `openapi:write` + `git diff --exit-code docs/api/openapi.json`; `workflow-docs:write` + diff | 0, 0, 0, 0 | 23 s | | sha256 `407571a0…b0d4` |
| 11 | mocked flow suite | 0 | 122 s | 3.4 | 328 passed |
| 11 | fresh stack (down + build, up) | 0, 0 | 4 s, 106 s | 10.3 | |
| 11 | chromium shards 1-4 | 0, 0, 0, 0 | 260, 327, 296, 361 s | 4.3, 1.0, 2.5, 2.7 | 51, 45, 46, 47 = 189 (`device-integrity.spec.ts` and `flow-android.spec.ts` in shard 1) |
| 11 | console sweep `--no-deps` | 0 | 305 s | 2.9 | 104 passed |
| 11 | `:openverify-sdk:stackTest` | 0 | 35 s | 1.8 | AndroidFlowStackTest |
| 11 | stack down | 0 | 4 s | | |
| 11b | WebKit theme-csp through Docker (`playwright:v1.64.1-noble`) | 0 | 16 s | 4.5 | 7 of 7 |
| 12 | `docker build` apps / vision / code-runner | 0, 0, 0 | 170, 9, 44 s | 4.3, 4.6, 4.6 | |
| 13 | infra/tests (11 scripts) | all 0 | 0-18 s | 1.6-4.6 | apps-image-context 43, check-connected-results 11, ci-workflow 266, code-runner 55, compose 557 (live), flow-headers 21, flow-server 38, gitleaks-config 10, install-gitleaks 31, pre-commit-hook 11, vision-container 55 |
| 14 | workflow benchmark (reported) | 0 | 141 s | 2.9 | effectful 15 / 47 / 47 steps/s at 1 / 8 / 32 clients; control-flow 88 / 195 / 197 |
| 14 | analytics benchmark (reported): `--teardown`, `--seed` x3, `--measure` | all 0 | 4, 458, 439, 495, 475 s | 1.3-2.3 | build 421 s for 365 days; 5-minute refresh 1.9 s; after-midnight refresh 32.7 s; reads 7-54 ms (30/90 days), 12-370 ms (400 days); the container stopped after |
| 15 | `gitleaks git --redact .` | 0 | 8 s | 1.6 | 6,410 commits, no leaks |

Not run for 10B (the plan's "10C on" lines): `fetch_bundletool.py`, `check-elf-alignment.py`, `check-size.py`, `publishAllPublicationsToStagingRepository` and the consumer check.

## 18. Known items

- **KP10-20** fixed (docs only): `e2e/README.md`'s "Shards." bullet gives this validation's run (§16, §17).
- **KP10-4** not fixed: open until 10B's push CI. Locally, CI's android calls passed from a fresh `GRADLE_USER_HOME` with dependency verification on (§17, step 9 cold); the screenshot comparison on the GitHub runner and `android-instrumented` (now with `CameraXFramePipelineTest`, `ZxingCppBarcodeReaderDeviceTest`, `IntegrityProbesDeviceTest`) are proved only by the push's run.
- **KP10-15 to KP10-19** deferred, carried with their reasons (the PROGRESS draft).

Checkpoint: this file's commit, "Workflow 10B integration-10b checkpoint 1".
