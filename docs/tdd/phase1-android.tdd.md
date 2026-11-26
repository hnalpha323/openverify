# TDD evidence: Phase 1, android

Slice owner: android agent (Workflow 1A, Stage 2). Date: 2026-10-20.

## Plan task

`docs/plans/phase-1.plan.md`, Stage 2, **android**: the `openverify-sdk` building blocks on the locked contracts C1–C3 and C7–C8, plus the demo app wiring. The deliverables are:

- kotlinx.serialization models for the C1 envelopes and the C3 flow session, decoded from the C8 golden fixtures;
- an OkHttp flow API client tested with MockWebServer;
- a pure Kotlin `FlowCoordinator`;
- Compose screens for consent, document capture (CameraX), selfie (oval guide) and completion;
- the `OpenVerifyInquiry.Contract` with its hosting activity, and the demo app.

Validation command: `(cd android && ./gradlew testDebugUnitTest koverVerify assembleDebug lint)`.

## Dependencies added

All versions were checked against Maven Central or Google Maven on 2026-10-20, including the license in each POM.

| Dependency | Version | License | Scope |
|---|---|---|---|
| `org.jetbrains.kotlin.plugin.serialization` (Gradle plugin) | 2.4.21 | Apache-2.0 | build |
| `org.jetbrains.kotlinx:kotlinx-serialization-json` | 1.11.0 | Apache-2.0 | runtime |
| `org.jetbrains.kotlinx:kotlinx-coroutines-android` | 1.11.0 | Apache-2.0 | runtime |
| `com.squareup.okhttp3:okhttp` (resolves to `okhttp-android`) | 5.4.0 | Apache-2.0 | runtime |
| `androidx.camera:camera-core`, `-camera2`, `-lifecycle`, `-compose` | 1.6.2 | Apache-2.0 (camera-core also lists BSD-3-Clause) | runtime |
| `androidx.compose.foundation:foundation` | BOM 2026.06.01 (1.11.4) | Apache-2.0 | runtime |
| `androidx.activity:activity-compose` (moved from the demo app into the SDK) | 1.13.0 | Apache-2.0 | runtime |
| `androidx.lifecycle:lifecycle-runtime-compose`, `lifecycle-viewmodel-compose` | 2.9.4 | Apache-2.0 | runtime |
| `org.jetbrains.kotlinx:kotlinx-coroutines-test` | 1.11.0 | Apache-2.0 | test |
| `com.squareup.okhttp3:mockwebserver3` | 5.4.0 | Apache-2.0 | test |
| `org.robolectric:robolectric` | 4.17 | MIT | test |
| `androidx.test:core-ktx`, `androidx.test.ext:junit-ktx` | 1.7.0, 1.3.0 | Apache-2.0 | test |
| `androidx.compose.ui:ui-test-junit4`, `ui-test-manifest` | BOM 2026.06.01 (1.11.4) | Apache-2.0 | test, androidTest |
| `androidx.test:runner`, `androidx.test:rules` | 1.7.0 | Apache-2.0 | androidTest |
| `org.junit.vintage:junit-vintage-engine` | 5.14.4 | **EPL-2.0** | test runtime only |
| `junit:junit` (transitive, from Robolectric and ui-test-junit4) | 4.13.2 | **EPL-1.0** | test only |

Transitive runtime additions are all Apache-2.0: Dagger 2.59 and atomicfu (from camera-camera2), Okio, auto-value-annotations, listenablefuture and jspecify.

Version choices:

1. **OkHttp 5.4.0, not 5.5.0.** The AAR metadata of `okhttp-android:5.5.0` declares `minCompileSdk=37`, and the first build failed in `checkDebugUnitTestAarMetadata`. 5.4.0 (2026-06-08) declares `minCompileSdk=36`.
2. **kotlinx.serialization 1.11.0, not 1.12.0.** 1.12.0 was published on 2026-10-19, a day earlier. 1.11.0 (2026-04-09) works with Kotlin 2.4.21.
3. **CameraX 1.6.2.** Every CameraX AAR I use declares `minCompileSdk=36`; 1.7.0 is still alpha. `camera-compose` pulls Compose UI ≥ 1.7.8, which the BOM's 1.11.4 satisfies, so compileSdk 36 holds.
4. **Lifecycle 2.9.4** is the version the Compose BOM already resolved transitively. It is declared explicitly only because the SDK calls it directly. It is not an upgrade.

## Test infrastructure decisions

- **Fixtures.** `contracts/fixtures` is added to the `openverify-sdk` unit-test resources (`sourceSets.test.resources.directories`). `ContractFixturesTest` lists `api/*.json` and `flows/*.json` from the classpath. It fails when a fixture is added without a Kotlin decoder.
- **Robolectric on AGP 9.4.1 / compileSdk 36 is feasible.**
  - Robolectric 4.17 runs the android-36 sandbox.
  - Its tests are JUnit 4, so the JUnit Vintage engine runs them on the same JUnit Platform as the Jupiter tests.
  - The unit-test JVM needs `--add-exports/--add-opens java.base/jdk.internal.access=ALL-UNNAMED`. Without them, every Robolectric test failed with `IllegalAccessException ... does not export jdk.internal.access` from `AndroidInterceptors$FileDescriptorInterceptor`, which I saw in a throwaway spike that was not committed.
  - `@GraphicsMode(NATIVE)` gives real JPEG encoding and decoding.
  - The screen tests use the compose-ui-test **v2** rules (`junit4.v2.createComposeRule`); the v1 rules are deprecated in 1.11.
- **Kover** measures code executed under Robolectric too. The gate still excludes `@Composable` and `@Preview` code, `ComposableSingletons` and generated classes. It now also excludes `dev.openverify.sdk.camera.CameraXCaptureCamera*`, which is CameraX glue that needs camera hardware. The image processing it calls (`ImageEncoding`) is covered.

## Cycles

Each cycle is a RED commit, then GREEN, then any refactor. The commands were run from `android/` after `source ../scripts/env.sh`. RED stubs are `TODO()` bodies, or empty composables, so failures happen at run time for the intended reason. The exception is cycle A, where the models did not exist yet.

### A. Wire models and C8 contract tests

Tests:
- `ContractFixturesTest` (19 cases): one dynamic test per fixture file, plus value checks for every fixture. The flow-session values are the inquiry, the five steps, the transitions and their JSONLogic, retry hints and consent; there are checks for kebab-case attributes, checks with their metadata, included files, the problem document, and the event payload decoded as an inquiry. The default template's flow must equal the session's flow. Unknown keys are ignored at every level, and inquiry `fields` (PII) never appear in `toString`.
- `WireModelTest` (16 cases):
  - `form`, `nfc` and unknown step types decode as `UnsupportedStep` and keep their type;
  - a known step with an unusable value decodes as `UnsupportedStep`;
  - a step without `id` or `type` is a malformed flow;
  - unknown statuses decode as `UNKNOWN` and are never encoded;
  - flows round-trip through JSON.

RED: `./gradlew :openverify-sdk:testDebugUnitTest`

```
> Task :openverify-sdk:compileDebugUnitTestKotlin FAILED
e: model/ContractFixturesTest.kt:30:68 Unresolved reference 'Flow'.
e: model/ContractFixturesTest.kt:33:38 Unresolved reference 'OpenVerifyJson'.
e: model/ContractFixturesTest.kt:33:70 Unresolved reference 'FlowSession'.
e: model/ContractFixturesTest.kt:34:65 Unresolved reference 'InquiryDocument'.
BUILD FAILED in 3s
```

Every error was an unresolved model type, or a knock-on inference error from one. Commit `b8f54ff`.

GREEN: `OpenVerifyJson` (`ignoreUnknownKeys`, `explicitNulls = false`), lenient `WireEnumSerializer` statuses, the JSON:API resources, and `FlowStepSerializer` with its `UnsupportedStep` fallback. The test results were `ContractFixturesTest tests=19 failures=0` and `WireModelTest tests=16 failures=0` (65 in the module with the Phase 0 tests). Commit `4357b1e`.

### B. Flow API client (OkHttp + MockWebServer)

Tests: `FlowApiClientTest` (56 cases) and `CapturedImageTest` (7 cases).
- **Requests:** bearer token, Accept and User-Agent; base URLs with a path prefix; the JSON bodies of consent and create verification, with absent options left out; multipart `kind` and `file`, parsed back with `MultipartReader`; submit sends `{}`.
- **Polling:** stops on a decided status, and raises `StillProcessing` after the last attempt.
- **Error mapping:** 400/401/403/404/409/413/415/422/429/5xx/418 each map to their sealed type, with the problem body and the request ID (from the header, else from the problem). A non-JSON error body still maps. `Retry-After` is read, malformed success bodies are refused, redirects are not followed, and a refused connection is a `Network` error.
- **Cancellation:** cancelling the coroutine cancels the OkHttp call, as an `EventListener.canceled` assertion shows.
- **Argument validation:**
  - only `ovs_` tokens are accepted, and messages never echo them;
  - the base URL must be https except for local hosts, with no query or credentials;
  - verification IDs must be `ver_` ULIDs, so `..` can never become a dot segment.

RED: `./gradlew :openverify-sdk:testDebugUnitTest`

```
FlowApiClientTest > cancelling the caller cancels the HTTP call() FAILED
    kotlin.NotImplementedError at FlowApiClient.kt:32
FlowApiClientTest > these verification statuses end polling(String) > [1] passed FAILED
    kotlin.NotImplementedError at FlowApiClientTest.kt:237
128 tests completed, 58 failed
BUILD FAILED in 12s
```

There were 17 `NotImplementedError` and 41 `AssertionFailedError` failures; the latter were `assertThrows` receiving `NotImplementedError`, or validation that was not there yet. The only new tests that passed were the 5 "accepted base URL" cases, because the stub accepted everything. Commit `3c947b9`.

GREEN gave 128 tests and 0 failures, and `application line coverage: 98.062%`. OkHttp's `okhttp-android` variant works in plain JVM unit tests. Commit `b9401d9`.

### C. Navigation and FlowCoordinator

Tests:
- `JsonLogicTest` (36 cases): the subset `var`, `==`, `===`, `!=`, `!==`, `!`, `!!`, `and`, `or` and `in`, plus truthiness, defaults and refusal of anything else.
- `FlowNavigatorTest` (9 cases): transitions first, then list order.
- `FlowCoordinatorTest` (40 cases), against `FakeFlowApi`, an in-memory C3 server that decides each submitted verification from a scripted list. The cases are:
  - consent, and the ID front, back and selfie captured and reviewed in order;
  - retry hints, with a new verification for the retry;
  - the failure transition on a failed last attempt;
  - resume from a session (failed, passed, submitted, initiated, completed);
  - front-only IDs and multi-pose selfies;
  - unsupported steps, upload-only ID steps, unknown consent keys, transition loops and conditions outside the subset;
  - inquiry mismatch, and error mapping with retries that do not repeat finished work;
  - a conflict re-reads the session, and concurrent actions are ignored.

RED: `./gradlew :openverify-sdk:testDebugUnitTest`

```
FlowCoordinatorTest > a conflict re-reads the session on retry() FAILED
    kotlin.NotImplementedError at FlowCoordinatorTest.kt:498
FlowCoordinatorTest > a failed last attempt follows the transition to the failure step() FAILED
    kotlin.NotImplementedError at FlowCoordinatorTest.kt:233
213 tests completed, 85 failed
BUILD FAILED in 10s
```

There were 81 `NotImplementedError` and 4 `AssertionFailedError` failures; the latter were `assertThrows` receiving `NotImplementedError`. Commit `5e68e1f`. GREEN gave 213 tests, 0 failures and 98.5677% coverage. Commit `daf7cce`.

Follow-up cycle from self-review: a flow with no steps, or a capture step with nothing to capture, crashed the coordinator.

```
FlowCoordinatorTest > a flow without steps is unsupported() FAILED
    java.util.NoSuchElementException at FlowCoordinatorTest.kt:391
FlowCoordinatorTest > a capture step without photos to take is unsupported() FAILED
    java.util.NoSuchElementException at FlowCoordinatorTest.kt:400
42 tests completed, 2 failed
```

RED was `b6aa9d0`. The fix, `a3ef852`, reports both as `Unsupported`, and the suite went to 215 tests with 0 failures.

### D. Compose screens (Robolectric + compose-ui-test)

Tests:
- `ConsentScreenTest` (5): the step's texts only; Continue disabled until the agreement checkbox is checked; no double submit while saving; Cancel.
- `CaptureScreenTest` (8): back-camera preview with the card guide, title and "Photo 1 of 2"; the back side; the shutter hands the photo over; a failed capture says so; review replaces the preview and offers Retake and Use this photo; retry hints; the selfie uses the front camera and the **oval guide**; Cancel.
- `StatusScreensTest` (8): loading, processing, completion, failure, retryable and non-retryable errors, unsupported.
- `CameraPermissionGateTest` (6): the rationale appears before any request; Allow requests only `CAMERA`; a grant shows the camera; an existing grant goes straight in; after a denial, the screen points to app Settings; Cancel.
- `InquiryFlowScreenTest` (8): each state's screen, and each action routed to `FlowActions`.
- `MessagesTest` (14): reason codes, the default template's message keys, flow errors and capture kinds each map to their own string.
- `ImageEncodingTest` (5): upright rotation, scaling to the maximum dimension, no upscaling, quarter turns only. These run with native graphics.

RED: `./gradlew :openverify-sdk:testDebugUnitTest`

```
ImageEncodingTest > the result is a JPEG FAILED
    kotlin.NotImplementedError at ImageEncodingTest.kt:25
CaptureScreenTest > the selfie uses the front camera and an oval guide FAILED
    java.lang.AssertionError at CaptureScreenTest.kt:126
CameraPermissionGateTest > without permission it explains why before asking FAILED
    java.lang.AssertionError at CameraPermissionGateTest.kt:52
269 tests completed, 54 failed
BUILD FAILED in 48s
```

All 54 new tests failed: 36 because a node was missing from an empty composable, 17 on `NotImplementedError` and 1 on an empty consent map. The 215 earlier tests still passed. Commit `a6a8f42`.

GREEN gave 269 tests, 0 failures and 97.2558% coverage. Commit `38079ab`. Refactor `a02d2da` moved to the v2 compose-ui-test rules, and the tests stayed at 269/269.

### E. Public API: `OpenVerifyInquiry.Contract` and activity

Tests:
- `InquiryResultsTest` (15): each terminal state maps to a result and reason; non-terminal states map to Canceled.
- `OpenVerifyInquiryRequestTest` (8): `inq_` IDs only; tokens are never echoed; no cleartext base URL; `toString` redacts the token.
- `OpenVerifyInquiryContractTest` (6, Robolectric): the launch intent targets the SDK activity; malformed extras give no request; every result round-trips; the result codes; missing data is Canceled; an unknown status maps to `UNKNOWN`.
- `InquiryViewModelTest` (8): the flow starts on creation; actions drive the coordinator; retry; cancel; finish; back; the first ending wins.
- `OpenVerifyInquiryActivityTest` (5, Robolectric + MockWebServer + the real client): consent appears from the session; back returns `Canceled(inquiryId)`; a 401 followed by Close returns `Failed(SESSION_EXPIRED)`; a malformed request fails without any request to the server; `FLAG_SECURE` is set.

RED: `./gradlew :openverify-sdk:testDebugUnitTest`

```
OpenVerifyInquiryActivityTest > a malformed request fails without contacting the server FAILED
    kotlin.NotImplementedError at OpenVerifyInquiryActivityTest.kt:50
OpenVerifyInquiryActivityTest > identity documents and selfies are kept out of screenshots and recents FAILED
    kotlin.NotImplementedError at OpenVerifyInquiryActivityTest.kt:50
311 tests completed, 41 failed
BUILD FAILED in 57s
```

There were 35 `NotImplementedError` and 6 `AssertionFailedError` failures. The only new test that passed was "a well-formed request is accepted", because the stub had no validation. Commit `051705c`.

GREEN gave 311 tests and 0 failures. Commit `41c09d6`. The refactor `d763c02` (results are read from the data only) kept 311/311.

`596f21f` hardened `CameraXCaptureCamera`: a CameraX start-up failure now shows "camera unavailable" instead of crashing. This is hardware glue outside the JVM suite. It was verified by compilation and lint locally, and by the instrumented test below in CI.

### F. Demo app

Test: `DemoFormTest` (10 cases):
- pasted values become a request, trimmed;
- any missing or malformed value gives no request;
- the default base URL is `http://10.0.2.2:3000` (the API's default port 3000, as the emulator reaches the host);
- each result type has its own text.

RED: `./gradlew :demo-app:testDebugUnitTest`

```
DemoFormTest > pasted values become a request, without surrounding whitespace() FAILED
    kotlin.NotImplementedError at DemoFormTest.kt:19
10 tests completed, 9 failed
BUILD FAILED in 3s
```

The only test that passed was the constant check. Commit `b084a8c`. GREEN gave `DemoFormTest 10 0 0`. Commit `dc39994`.

### Instrumented test (CI only)

`openverify-sdk/src/androidTest/.../CameraXCaptureCameraTest` grants `CAMERA`, composes the real CameraX preview, retries `takePicture()` until binding completes, and checks that the result is an upright JPEG within the size limits. It is skipped on devices without a camera.

There is no KVM here, so it was **compiled, not run**: `./gradlew :openverify-sdk:assembleDebugAndroidTest` gave `BUILD SUCCESSFUL in 1m 31s`. Commit `0385db8`.

## Final gate

`./gradlew testDebugUnitTest koverVerify assembleDebug lint :openverify-sdk:koverLog`:

```
application line coverage: 97.4104%
BUILD SUCCESSFUL in 1m 23s
openverify-sdk tests 311 failed 0
demo-app tests 10 failed 0
```

Kover line coverage (`koverXmlReport`): 978 of 1004 lines.

| Package | Lines |
|---|---|
| `dev.openverify.sdk` (contract, results, view model, activity) | 89/90 (98.9%) |
| `dev.openverify.sdk.api` | 160/162 (98.8%) |
| `dev.openverify.sdk.model` | 321/327 (98.2%) |
| `dev.openverify.sdk.flow` | 253/255 (99.2%) |
| `dev.openverify.sdk.camera` (excluding CameraX glue) | 30/31 (96.8%) |
| `dev.openverify.sdk.ui` (non-composable helpers) | 108/122 (88.5%) |
| `dev.openverify.sdk.mrz` | 17/17 (100%) |

Lint has no errors. The remaining warnings (`GradleDependency`, `NewerVersionAvailable`, `OldTargetApi`) are the deliberate pins: compileSdk/targetSdk 36 while 37 exists, Compose BOM 2026.09.00, lifecycle 2.11.0, JUnit 6.1.3, OkHttp and MockWebServer 5.5.0, and kotlinx.serialization 1.12.0.

Merged manifest of the demo app (debug and release):
- **Permissions:** `INTERNET` (normal) and `CAMERA` (the only runtime permission, requested by `CameraPermissionGate` after its rationale). `androidx.core` adds its own signature-level `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`.
- **Components:** `OpenVerifyInquiryActivity` is `exported=false`.
- **Network security config:** release `res/xml/network_security_config.xml` is `cleartextTrafficPermitted="false"` only. The debug APK's file (from `aapt2 dump xmltree`) allows cleartext only for `10.0.2.2`, `localhost` and `127.0.0.1`.

## Deviations and decisions

1. **"CAMERA only" permissions.** CAMERA is the only runtime permission. The SDK also declares `INTERNET`, a normal install-time permission it cannot work without.
2. **http is refused by the client except for local hosts.** This applies even when a host app allows cleartext. The session token never travels in clear text to a remote host. Redirects are not followed, so the token stays on the API origin.
3. **Upload-only government ID steps are unsupported** (`captureMethods` without `camera`). Phase 1 has camera capture only, with no gallery picker yet.
4. **Consent texts:**
   - The SDK records consent only for text keys it can show (`consent.biometric`, `consent.processing`). Any other key makes the flow `Unsupported`.
   - The strings follow the web flow's English copy, and the SDK sends `locale: "en"`, because it has English strings only.
5. **JSONLogic `==` uses JSON value equality, without JavaScript type coercion,** so `1 == "1"` is false. Numbers compare by value.
6. **Resume rules, with the server as the authority:**
   - A step is done when its latest verification passed.
   - A failed verification is retried while the inquiry is `pending`.
   - A `submitted` verification is polled again rather than recaptured.
   - An `initiated` verification is reused rather than creating a new one.
7. **Request shapes the API should accept:**
   - submit sends the JSON body `{}`;
   - the multipart upload sends `kind` before `file`;
   - the file name is `<kind>.<ext>`, never the user's own.
8. **Privacy on the device:**
   - photos stay in memory and are re-encoded without EXIF metadata;
   - the activity uses `FLAG_SECURE`;
   - the demo keeps the session token out of saved state;
   - `toString` never prints tokens, image bytes or inquiry `fields`.
