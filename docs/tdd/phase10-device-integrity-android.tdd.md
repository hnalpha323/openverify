# Phase 10, Workflow 10B: device-integrity-android (family I)

Owner: device-integrity-android (Stage 2). Scope: C210.1-C210.3 (the probes over `DeviceProbe`, the wire, the timing device test) and the SDK half of C211.3 (`requestIntegrityVerdict`, the integrity route encodings in `signals/IntegrityRequests.kt`). Base: contracts-10b checkpoint 10 (`489e799d`).

Every Gradle call ran as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon ...)`; the load average (`cat /proc/loadavg`) is written beside each timing.

## Slice 1: the probes (C210.1-C210.3)

### Stub

`DeviceSignals.collect` becomes `suspend` (Stage 1a amendment 19 handed it here). `AndroidDeviceSignals` gains `probe: DeviceProbe?` and `dispatcher` (default `Dispatchers.IO`); the context constructor passes `ContextDeviceProbe`. New stubs: `signals/DeviceProbe.kt` (`BuildFields`, `DeviceProbe`, `ContextDeviceProbe` answering nothing) and `signals/IntegrityIndicators.kt` (`IntegrityIndicators`, `IntegrityProbes.collect` answering three nulls). The signal tests that call `collect` run under `runTest`; the coordinator test that drives `AndroidDeviceSignals` passes its scheduler's dispatcher.

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.*'   # load 5.15, no lock wait
exit=0 (2 min 11 s)
```

### RED

Tests: `IntegrityProbesTest` (every rule over a fake `DeviceProbe`: 32 reporting cases, 14 near misses, contract order, a throwing read records nothing for its rules, a family whose every rule threw is left out, an `Error` is not swallowed); `ContextDeviceProbeTest` (Robolectric: shadowed `Build`, the telephony feature, a fake file system under a temporary root, `Class.forName(name, false, loader)` over a class whose initialiser throws, review P22); `ContextDeviceProbeRulesTest` (Robolectric, parameterised: 14 rules through the platform probe with shadowed `Build` values and the fake file system); `AndroidDeviceSignalsTest` (+4: the codes beside the debugger facts, no probe without session integrity, the reads on the dispatcher given, `Dispatchers.IO` by default); `ContextDeviceFactsTest` (a context's body carries the three lists); `IndicatorContractTest` (commonTest: closed lists, each code once, at most 12); `NeverReadTest` (+2 and 6 patterns: fingerprint, package queries, network interfaces; the probe reads stay in `DeviceProbe.kt`; no `<queries>`); `IntegrityRequestFixturesTest` (`signals-android-integrity.json` through the real `FlowApiClient`). Device test `IntegrityProbesDeviceTest` (compiled locally, CI only).

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.*'   # load 6.06, no lock wait
154 tests completed, 84 failed      (exit 1, 5 min 6 s)
IntegrityProbesTest 51: expected <IntegrityIndicators(emulator=[build_hardware_goldfish_or_ranchu], root=[], hooking=[])> but was <IntegrityIndicators(emulator=null, ...)>
AndroidDeviceSignalsTest 3: expected <[integrity-probes]> but was <[]>
NeverReadTest 1: expected <[.../signals/DeviceProbe.kt]> but was <[]>
IntegrityRequestFixturesTest 1: signals-android-integrity.json differs from the body the SDK encodes
ContextDeviceProbeTest 10, ContextDeviceProbeRulesTest 14: expected <IntegrityIndicators(emulator=[], root=[], hooking=[])> but was <...null...>
ContextDeviceFactsTest 1 (lists null); IndicatorContractTest 3: expected <[android-integrity]> but was <[]>
```

### GREEN

`IntegrityProbes` (`signals/IntegrityIndicators.kt`): 16 rules in three families, each code in the contract's order; a rule whose read throws an `Exception` records nothing, a family with no answering rule is left out, an `Error` propagates. `ContextDeviceProbe` (`signals/DeviceProbe.kt`): the public `Build` fields, `hasSystemFeature(FEATURE_TELEPHONY)`, `File(root, path).exists()`, the maps' path column (distinct), each task's `comm`, `/proc/mounts`, `Class.forName(name, false, context.classLoader)`, the main looper thread's stack class names. `AndroidDeviceSignals.collect` reads on its dispatcher (`Dispatchers.IO`) and, under session integrity only, adds the three lists. `AndroidSignalContract.problems` refuses `android-integrity` when a list holds another family's code, a repeat, or more than 12. The fixture `contracts/fixtures/flow-requests/android/signals-android-integrity.json` was written by `UPDATE_CONTRACT_FIXTURES=1` through the real `FlowApiClient.sendSignals` and passes `prettier --check`.

```
$ UPDATE_CONTRACT_FIXTURES=1 ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.IntegrityRequestFixturesTest'   # exit 0 (after two lock-busy exits 75)
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.*'   # load 3.17, lock wait 230 s
exit=0: 154 tests, 0 failed, 0 skipped (IntegrityProbesTest 53, ContextDeviceProbeTest 10, ContextDeviceProbeRulesTest 14, AndroidDeviceSignalsTest 21, NeverReadTest 7, IndicatorContractTest 4, IntegrityRequestFixturesTest 2, ...)
```

## Slice 2: the SDK's integrity request (C211.3)

foundation-10b's hook (`804a7408`) calls `IntegrityVerdictRequest.requestIntegrityVerdict(session)` beside the flow after consent and on a consented load; the launch builds it with `integrityVerdictRequest(api, provider)` (`InquiryViewModelFactory.kt:75`). Note: foundation-10b's stub `signals/Integrity.kt` was in the shared tree, uncommitted, when this area's first stub commit `d979d7f9` added the whole `signals/` directory, so that commit carries foundation-10b's stub file unchanged (its own commits `6cfc8ab1` and `804a7408` then found it committed). Every later commit of this area names its files one by one.

### Stub

`IntegrityRequests` (`signals/IntegrityRequests.kt`): `CHALLENGE_ID`, `REQUEST_HASH`, `TOKEN_MAX_LENGTH`, and `challenge(http, apiBase, authorization)` / `token(http, apiBase, authorization, challengeId, token)` throwing `NotImplementedError`. The two no-argument delegations `FlowApiClient` calls are unchanged.

```
$ ./gradlew --no-daemon -q :openverify-sdk:compileCommonMainKotlinMetadata :openverify-sdk:compileAndroidMain   # load 5.25, lock wait 234 s
exit=0
```

### RED

Tests: `IntegrityVerdictRequestTest` (12: the challenge, the host's token for its hash and one post; no provider is `None` and asks for nothing; no ask, no consent or a decided inquiry reads nothing; at most once, concurrent calls included; a failed request is not tried again; a refused or unwired challenge, or one outside the contract, asks the host for nothing; a null, throwing, empty or over-long token sends nothing; the longest token is sent; a 409 `integrity_challenge_invalid` reads the session once; any other failure sends nothing more; a provider that never answers is cancelled with its caller); `IntegrityRequestsTest` (commonTest, 6: the routes, bodies, headers, the 202, the problem's code, an invalid answer, values never named); `IntegritySingleUsePostTest` (MockWebServer drops the connection after the first token body; OkHttp resends; the 409 is answered by one session read); `IntegrityCoordinatorTest` (3, through foundation-10b's hook); `IntegrityRequestFixturesTest` (+2: `integrity-challenge.json`, `integrity-token.json`); `IntegrityRequestsStubTest` (the unwired delegations fail as exceptions; `signals/Integrity.kt` may call the routes).

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.*'   # load 12.75, lock wait 73 s (after one exit 75)
180 tests completed, 23 failed (exit 1)
IntegrityVerdictRequestTest 10: expected <[challenge, token]> but was <[]> ...
IntegrityRequestsTest 6, IntegrityRequestFixturesTest 2: kotlin.NotImplementedError: integrity_requests_not_built: challenge|token
IntegrityCoordinatorTest 3: expected <1> but was <0>; IntegritySingleUsePostTest 1: expected <[GET .../session, POST .../integrity-challenges, ...]>
IntegrityRequestsStubTest 1: expected <UnsupportedOperationException> but was <NotImplementedError>
```

### GREEN

`signals/IntegrityRequests.kt`: `IntegrityRequests.challenge` posts `{}` to `/api/v1/flow/integrity-challenges` and decodes `FlowIntegrityChallenge`; `IntegrityRequests.token` checks the challenge id (`ich_` + ULID) and the token length (1 to 16,384, messages naming no value) and posts `{challenge-id, token}` to `/api/v1/flow/integrity-tokens` (202, no body). The no-argument delegations `FlowApiClient` calls throw `UnsupportedOperationException("flow_api_not_wired: ...")`, an exception, until integration-10b passes the client's `http`, `apiBase` and `authorization` (contractDeviation). `signals/Integrity.kt`: `integrityVerdictRequest(api, null)` is `None`; with a provider, `ProviderVerdictRequest` runs once per launch (a `Mutex` and a flag) when the session has consent, `integrity.request == true` and `ServerPosition.decided` is null; a challenge outside the contract, a null, failing, empty or over-long token, and any failure of either call send nothing more; a 409 `integrity_challenge_invalid` reads the session once. Log codes (`SdkLog`, constants): `integrity.challenge_failed`, `integrity.challenge_refused`, `integrity.token_unavailable`, `integrity.token_failed`, `integrity.challenge_invalid`. Fixtures `integrity-challenge.json` (`{}`) and `integrity-token.json` written by `UPDATE_CONTRACT_FIXTURES=1`; prettier clean; the API parses all three.

```
$ UPDATE_CONTRACT_FIXTURES=1 ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.IntegrityRequestFixturesTest'   # exit 0, load 15.72, lock wait 227 s
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.signals.*' --tests 'dev.openverify.sdk.flow.IntegrityHookTest' --tests 'dev.openverify.sdk.flow.StateHooksTest' --tests 'dev.openverify.sdk.privacy.*'   # load 4.79, lock wait 196 s
exit=0: 198 tests, 0 failed, 0 skipped
$ pnpm --filter @openverify/api exec vitest run src/routes/flow/flow-requests.android.test.ts --coverage.enabled=false
Test Files 1 passed; Tests 8 passed (exit 0)
```

## Slice 3: the activity tests wait for the body without blocking the main looper

Gate call (a) at `cf0eaef8` (load 5.91, lock wait 171 s): 2,312 tests, 4 failed. Three were selfie-guidance's work in progress (`SelfieExtensionTest`, `SelfieGuidanceTest`, `StateHooksTest`'s selfie-guidance pin). The fourth, `OpenVerifyInquiryActivityComponentsTest` "in a sandbox the installed outcome rides on the signals body", failed with `IllegalStateException: no signals call` after 5.2 s. Cause, confirmed by running that class with `OpenVerifyInquiryActivitySignalsTest` (load 3.89, lock wait 231 s: both of the components class's sandbox-outcome tests failed, `no signals call` after 5.1 and 5.3 s): `collect` now reads on `Dispatchers.IO` and the coordinator resumes on the main dispatcher to send, while those tests block Robolectric's paused main looper in `server.takeRequest(5 s)`, so the send runs only if the reads ended before the activity's launch stopped idling the looper. Before 10B, `collect` ran on the main thread inside the launch.

Fix in this area's own test (`signals/OpenVerifyInquiryActivitySignalsTest`): wait in 50 ms steps, idling the main looper between them (at most 10 s). Its two tests pass in that run (0.30 s and 0.14 s). The same change to `OpenVerifyInquiryActivityComponentsTest.signalsBody()` (android-sdk-api's 10A file, shared in 10B) is not made here; it is a contractDeviation for integration-10b.

`ContextDeviceProbeTest`'s default-root test now reads a file it made rather than the host's `/proc/self/maps` (portable; exit 0, load 5.13, lock wait 106 s).

## Final gates (checkpoint 1)

Each a separate foreground call under the Gradle lock; the exit code read from the call.

| Call | Result | Time, lock wait, load |
|---|---|---|
| (a) `:openverify-sdk:testAndroidHostTest` | exit 1: 2,312 tests, 0 skipped, 1 failed: `OpenVerifyInquiryActivityComponentsTest` "in a sandbox the installed outcome rides on the signals body" (`no signals call`, 5.2 s); an earlier run failed it and its production twin | 195 s, 48 s, 4.87 |
| (b) `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | exit 0, 60 tests (this area adds no golden) | 189 s, 91 s, 5.78 |
| (c) `koverVerify checkKotlinAbi --continue` | exit 1 at `testAndroidHostTest` (the same components test; `koverVerify` therefore not run); `checkKotlinAbi` passed for `:openverify-sdk` and `:openverify-nfc` | 347 s, 210 s, 9.92 |
| (d1) `testDebugUnitTest assembleDebug` | exit 0 | 136 s, 124 s, 14.64 |
| (d2) `:demo-app:assembleRelease :demo-app:bundleRelease` | exit 0 | 231 s, 215 s, 8.91 |
| (e1) `:openverify-sdk:assemble` (the iOS klibs) | exit 0 | 296 s, 192 s, 4.11 |
| (e2) `lint` | exit 0 | 550 s with one lock-busy exit 75 before it (lint itself 336 s), 213 s, 13.26 |
| (f) `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest :openverify-sdk:compileTestKotlinIosSimulatorArm64` | exit 0 | 327 s, 122 s, 13.34 |
| `pnpm format:check` | exit 0 | load 18.43 |
| `pnpm --filter @openverify/api exec vitest run src/routes/flow/flow-requests.android.test.ts` | exit 0, 8 tests (the three new fixtures parsed) | |

The one failing test is android-sdk-api's 10A file (shared in 10B). It blocks Robolectric's main looper in `server.takeRequest(5 s)` while the flow, since this area's plan-mandated change, resumes on the main thread after reading off it (slice 3). The fix is that test's `signalsBody()` idling the looper between 50 ms waits, as this area's own `OpenVerifyInquiryActivitySignalsTest` now does; it is recorded as a contractDeviation, not made here.

SDK host tests: the `signals` package went from 65 to 180 (+115, none removed, none skipped). This area records no golden and no Kover exclusion.
