# Phase 10, Workflow 10B Stage 2: capture-pipeline

Family (C), beside foundation-10b and the other Stage 2 agents, on contracts-10b's checkpoint 10 (`489e799d`). Every Gradle call ran as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)` in the foreground; each timing below names its lock wait and the load average (`/proc/loadavg`, 1-minute figure) when it started.

## KP10-14: the two camera events nothing emitted

C192.2 (Workflow 10A Stage 3 android-sdk-api 11) declares `CameraPermission(granted)` and `CaptureFailed(reason)`, but 10A emitted only `CameraPermission(true)` (the activity's `cameraReady`) and `CaptureFailed(CAMERA_ERROR | OUT_OF_MEMORY)` (`EventingCaptureCamera.takePicture`). A refusal stayed in `rememberCameraPermission`'s `deniedState`, and `CameraXCaptureCamera.Preview` caught every bind failure and only set `unavailable`.

### Stub (behaviour unchanged)

`be958e54`: `CameraXCaptureCamera` binds through the internal `CameraBinder` (`androidMain/.../camera/CameraBinder.kt`: `ProcessCameraBinder` over CameraX's provider on a device, a fake in host tests), and `CaptureCamera.reportUnavailableTo(listener)` exists with a no-op default.

### RED

`androidHostTest/.../camera/CameraEventsTest.kt` (Robolectric): the launch's scope made as the activity makes it (`ViewModelProvider(activity, InquiryLaunchScope.factory(...))`) with a recording listener; the permission refused through `onRequestPermissionsResult`; and `EventingCaptureCamera(CameraXCaptureCamera(context, binderOf = { fake }))` whose fake binds at most N use cases.

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests dev.openverify.sdk.camera.CameraEventsTest
6 tests completed, 3 failed            (exit 1; 2 min 42 s after a 2 min 20 s lock wait; load 4.48)
- a refused camera permission tells CameraPermission(false) once, through the launch's events
    expected:<[CameraPermission(granted=false)]> but was:<[]>
- each refusal is its own occurrence
    expected:<[CameraPermission(granted=false), CameraPermission(granted=false)]> but was:<[]>
- a preview that could bind no use case tells CaptureFailed(CAMERA_UNAVAILABLE) once, and says so
    expected:<[CaptureFailed(reason=CAMERA_UNAVAILABLE)]> but was:<[]>
(passing guards: a granted request tells no refusal; outside a flow launch a refusal builds no event;
 a fallback to preview and capture without analysis is not a failure)
```

### GREEN

- `events/FlowEvents.kt` (borrowed edit, named by KP10-14): `FlowEventTracker.cameraDenied()` emits `CameraPermission(granted = false)` once per call; `EventingCaptureCamera` registers `camera.reportUnavailableTo { tracker.captureFailed(CAMERA_UNAVAILABLE) }` when it is made, so the activity's camera (the only one wrapped) reports through the launch's tracker.
- `InquiryViewModelFactory.kt` (borrowed edit, the event wiring): `InquiryLaunchScope.of(owner)` answers the scope the flow activity's view-model store already holds, or `null`; it never makes one (a factory that throws is asked only when the store holds none).
- `ui/CameraPermission.android.kt` (borrowed edit): the system prompt's answer `allowed == false` calls `cameraDenied()` on the scope of the activity the composition runs in, found once through `LocalContext` (unwrapping `ContextWrapper`s); outside a flow launch nothing is told. No saved state changes.
- `camera/CameraXCaptureCamera.kt`: a bind that fails calls the registered listener once, beside `unavailable = true`.

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests dev.openverify.sdk.camera.CameraEventsTest \
    --tests 'dev.openverify.sdk.events.*' --tests dev.openverify.sdk.ui.CameraPermissionTest --tests dev.openverify.sdk.ui.CameraPermissionGateTest
exit 0; 142 s after a 233 s lock wait; load 4.52
42 tests, 0 failed (CameraEventsTest 6, CameraPermissionTest, CameraPermissionGateTest, FlowEventsTest, ObservedFlowApiTest, OpenVerifyEventAllowlistTest)
```

## C201: the frame pipeline

### Stub

`202763e5`: the names only, each answering nothing (no frame sampled, a new buffer every frame, no relay, every target `DOCUMENT`, every bind `Unavailable`, no copy, an analyzer that only closes), the `Preview(lens, analysis, modifier)` overload on `CaptureCamera` (its default shows the plain preview), and `CameraXCaptureCamera(context, forceTwoUseCases, binderOf)` with `analysisUseCase(target)` returning CameraX's defaults.

### RED

commonTest: `FrameSamplerTest`, `FrameBuffersTest`, `FrameRelayTest`, `UseCaseBindingTest`, `AnalysisTargetTest`; androidHostTest: `RgbaFramesTest`, `FrameAnalyzerTest` (a fake `ImageProxy`, plain JUnit 5), `CameraXCapturePipelineTest` (Robolectric, a fake `CameraBinder`).

The first run stopped on the test JVM's heap: the cost measurement built 240 full-size frames (1280 x 960) up front, about 1.2 GB. The frames now share one plane buffer and are built lazily.

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.camera.*' :openverify-sdk:compileKotlinIosArm64 --continue
115 tests completed, 29 failed    (exit 1; 105 s after a 119 s lock wait; load 4.99)
AnalysisTargetTest 3 of 3:      expected: <BARCODE> but was: <DOCUMENT>; DOCUMENT ==> expected: <1920> but was: <2560>; expected: <SELFIE> but was: <DOCUMENT>
CameraXCapturePipelineTest 4 of 6: expected:<[3]> but was:<[2]> (x3, the binds); DOCUMENT: no resolution selector
FrameAnalyzerTest 5 of 8:       List is empty (x3); expected: <2> but was: <0>; expected: <8> but was: <0>
FrameBuffersTest 2 of 3:        expected the same buffer, was a new one (x2)
FrameRelayTest 6 of 9:          expected: <HELD|RELEASED> but was: <NOT_WANTED> (x3); Expected at least one element;
                                Expected value to be true; the callback test waited 1 min (no frame ever came)
FrameSamplerTest 3 of 6:        at 24 fps ==> expected: <8> but was: <0>; expected: <5> but was: <0>; Expected value to be true
RgbaFramesTest 2 of 3:          expected: <true> but was: <false> (x2)
UseCaseBindingTest 4 of 4:      expected: <Analysing(value=camera)> but was: <Unavailable>; ... <WithoutAnalysis(value=camera)> ...;
                                expected: <[release]> but was: <[]>; Expected an exception of class CancellationException
(passing guards: the refusals of a bad plane, the fixture's rate, the sampler's range, the 4:3 shape of the stub is wrong
 only for DOCUMENT's first entry, no copy without a reader, a dropped non-RGBA frame, the CPU bound over a stub that copies nothing)
```

### GREEN

- `FrameSampler(hz)`: a fixed schedule from the first frame (`nextDue += interval`; a frame a whole interval late restarts the schedule at itself; a clock that goes back starts a new one); `GUIDANCE_HZ = 8`, the fixtures' value.
- `FrameBuffers`: one buffer per frame size, reused; `abandon()` after a held frame.
- `FrameRelay` (a `FrameSink`): per camera session a rendezvous channel; `deliver` hands a frame over (waiting at most 50 ms for the reader) and waits up to 1 s for the reader's callback to return (`RELEASED`, else `HELD`); undelivered handoffs are released by the channel; `frames()` waits for the next session, completes at once when it has no analysis, and completes when it ends; `wanted()` is true only while a reader collects an analysing session.
- `AnalysisTarget`: `DOCUMENT` 640, `BARCODE` 1280 (an ID's back), `SELFIE` 320, each at 4:3.
- `bindUseCases(three, two, release)`: `Analysing`, else `release` and `WithoutAnalysis`, else `Unavailable`; a cancellation propagates.
- `RgbaFrames.copy`: one bulk read for packed rows, row by row otherwise, through `java.nio.Buffer.position` (API 26 to 33 lack `ByteBuffer`'s override); refuses a pixel stride other than 4 or a short plane.
- `FrameAnalyzer`: samples, copies only when a reader is there, closes the `ImageProxy` in a `finally`, drops (with `camera.analysis_frame_dropped`) a frame it cannot read, delivers through `runBlocking` on the analysis thread, abandons a held buffer.
- `CameraXCaptureCamera`: `Preview(lens, analysis, modifier)` binds `Preview`, `ImageCapture` and the target's `ImageAnalysis` (RGBA, `STRATEGY_KEEP_ONLY_LATEST`, 4:3 at the target's size, closest higher then lower) in one call through `bindUseCases`; the fallback logs `camera.analysis_unavailable`; the analysis executor is `Dispatchers.IO.limitedParallelism(1)`; `frames()` is the relay's.
- `events/FlowEvents.kt` (borrowed edit, second): `EventingCaptureCamera` forwards `Preview(lens, analysis, modifier)` and `frames()`; without it the activity's wrapped camera would bind the default target and give no frames.
- Test fixes in the GREEN run (the code was right): a mixed `Int`/`Long` list compared as one list, a frame index recovered from its timestamp by truncating division, and a "held" case fed two sampled frames (frames 0 and 133 ms); each is now asserted as it was meant.
- Kover (`kover-excludes/capture-pipeline.txt`): foundation-10b's proposed `CameraXFrameAnalyzer*` is removed (the analyzer is `FrameAnalyzer`, covered); `ProcessCameraBinder*` is excluded (every line calls CameraX's provider; the device tests run it).

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.camera.*' --tests 'dev.openverify.sdk.events.*' :openverify-sdk:compileKotlinIosArm64 --continue
143 tests completed, 3 failed   (exit 1; 152 s after a 235 s lock wait; load 3.86)
the 3 failures are UploadRequestFixturesTest's, whose files are not written yet (its own RED, below); every pipeline test passes.
FrameAnalyzer CPU per sampled frame at 640x480: 0.202 ms; at 1280x960: 0.493 ms (thread CPU time, 120 frames after a warm-up, padded rows; load 3.9 to 4.9). An earlier run at load 4.7 read 0.296 and 0.994 ms.
```

## C224.4, C206: the upload request fixtures

### RED

`androidHostTest/.../camera/UploadRequestFixturesTest.kt`: the real `FlowApiClient` over Ktor's `MockEngine` encodes three uploads, and each `multipart/form-data` body, read back with OkHttp's `MultipartReader`, is the committed `.multipart.json` (`multipart.schema.json`: the fields as sent, in order; the file part's name, filename, content type and size, never its bytes). It also checks each file's `index.json` entry (owner `capture-pipeline`, `POST /api/v1/flow/verifications/:id/files`, `flowFileUploadFieldsSchema`, 10B). Synthetic values only (the golden capture's id and `E2eSyntheticNonce00000`).

```
(the GREEN run of C201 above)
UploadRequestFixturesTest - upload-government-id-camera.multipart.json: differs from the upload FlowApiClient encodes ... but was: <>
UploadRequestFixturesTest - upload-selfie-pose-auto.multipart.json: ... but was: <>
UploadRequestFixturesTest - upload-document.multipart.json: ... but was: <>
(the three index entries pass: contracts-10b listed them)
```

### GREEN

Written by the test itself under `UPDATE_CONTRACT_FIXTURES=1` (no hand edit), then checked by a plain run:

```
$ UPDATE_CONTRACT_FIXTURES=1 ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests dev.openverify.sdk.camera.UploadRequestFixturesTest ...
UploadRequestFixturesTest 6 tests, 0 failed (exit 1 only from slice 3's RED below; 114 s after a 120 s lock wait, one earlier attempt 75 (lock busy); load 13.7)
$ pnpm exec prettier --check contracts/fixtures/flow-requests/android/upload-*.multipart.json     -> All matched files use Prettier code style (exit 0)
$ (cd apps/api && pnpm exec vitest run src/routes/flow/flow-requests.android.test.ts --coverage.enabled=false)
Tests  8 passed (8)   (exit 0: the zod parse with flowFileUploadFieldsSchema, the kind-named file part)
```

- `upload-government-id-camera.multipart.json`: `kind front`, `capture-method camera`, `capture-trigger manual`; file `front.jpg`, `image/jpeg`.
- `upload-selfie-pose-auto.multipart.json`: `kind selfie-left`, `capture-id`, `nonce` (synthetic), `client-elapsed-ms 6250`, `capture-method camera`, `capture-trigger auto`; file `selfie-left.jpg`.
- `upload-document.multipart.json`: `kind document`, `capture-method upload` (no trigger: a picked file); file `document.pdf`, `application/pdf`.

## The capture screen's slots, C206 on the client, C201.5 and C213.1

### Stub

`f9226fd8`: `CaptureScreen(..., guidance: CaptureGuidanceFactory? = LocalCaptureGuidance.current)` (ignored; the local's default `null`), the test-only `CaptureShutterPrimary` semantics key (never set), `nativeCaptureMethods(step)` answering none. Foundation-10b's stubs of `captureTriggerOf`, `captureMethodOf` (null) and `screenAutoCapture` (never takes a still) stand.

### RED

commonTest `camera/CaptureTriggerTest`, `capture/AutoCaptureTest`; androidHostTest `ui/CaptureScreenSlotsTest` (Robolectric, a camera with analysis frames, a fake guidance and factory). The first attempts could not compile the host tests because of other agents' uncommitted test files in the shared tree (`BarcodeOverlayTest`, `IntegrityCoordinatorTest`, then `SelfieGuidanceFactoryTest`); the run was retried until they compiled, never edited.

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests ...CaptureTriggerTest --tests ...AutoCaptureTest --tests ...CaptureScreenSlotsTest \
    --tests ...CaptureScreenTest --tests ...CaptureActionHookTest --tests ...UploadRequestFixturesTest :openverify-sdk:assembleAndroidDeviceTest --continue
51 tests completed, 16 failed    (exit 1; 114 s after a 120 s lock wait; load 13.7; assembleAndroidDeviceTest passed, the new device test compiling)
CaptureTriggerTest 3 of 4:   expected: <AUTO> but was: <null>; expected: <[CAMERA, UPLOAD]> but was: <[]>; id ==> expected: <CAMERA> but was: <null>
AutoCaptureTest 1 of 2:      Expected value to be true (the stub never takes a still)
CaptureScreenSlotsTest 12 of 12: no guidance asked or run (expected:<[Capture(...)]>, expected:<[true]> but was:<[]>), no overlay,
                             no analysis target (expected:<[DOCUMENT, BARCODE, SELFIE, DOCUMENT]> but was:<[]>), CaptureShutterPrimary
                             undefined, keepScreenOn false on the ID, selfie, page and review screens, ObscuredTouchesFiltered undefined
(CaptureScreenTest 24 and CaptureActionHookTest 3 pass unchanged)
```

### GREEN

- `camera/CaptureTrigger.kt`: `captureTriggerOf(auto)` = `AUTO` or `MANUAL`; `captureMethodOf(step, picked)` = `UPLOAD` when picked (a sandbox only, C19), else `CAMERA`, for a government ID, document or selfie step, `null` for a step that takes no photo: what happened, never a guess; `nativeCaptureMethods(step)` = `captureMethodsByDevice.native ?: captureMethods` (government ID and document), empty otherwise.
- `capture/AutoCapture.kt`: `screenAutoCapture(takeStill)` = `AutoCapture { takeStill(captureTriggerOf(auto = true)) }`.
- `ui/CaptureScreen.kt`: the state's guidance (`guidance.create(state)`, remembered per step, kind, index and preview-or-review; never over the review) is closed when it leaves (`DisposableEffect`) and run over `camera.frames()` with the auto-capture (`LaunchedEffect`, on the composition's dispatcher); its `Overlay` is drawn over the guide; the shutter is always on screen, `Button` when `shutterPrimary` (or without a guidance) and `OutlinedButton` otherwise, with the test-only `CaptureShutterPrimary` semantics; the still action refuses a second still while one is being taken; `camera.Preview(lens, AnalysisTarget.of(kind), ...)`; `KeepScreenOn()` (foundation-10b's) on every capture screen and its review; `submitProtection()` (android-screens' API 26-30 rule) on the shutter, "upload a photo instead" and "use this photo". `LocalCaptureGuidance` defaults to `BuiltInCaptureGuidance` = `BarcodeGuidanceFactory(next = DocumentGuidanceFactory())`.
- `flow/StateHooksTest.kt`: capture-pipeline's pinned stub case replaced by its owner, as foundation-10b's record says and 10A's owners did ("the trigger and method are decided, and the auto-capture takes the still as auto"). `flow/CaptureHooksTest.kt` (foundation-10b's): its one case that pinned the stub's null method now expects the method the hook decides (renamed "with no trigger given, each upload names the method the hook decides and no trigger"). Both minimal, listed as deviations.

```
$ ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.camera.*' --tests ...AutoCaptureTest --tests 'dev.openverify.sdk.ui.Capture*' \
    --tests 'dev.openverify.sdk.ui.KeepScreenOn*' --tests ...CaptureHooksTest --tests ...StateHooksTest --tests 'dev.openverify.sdk.events.*' --tests ...IntegrationHooksTest \
    :openverify-sdk:compileKotlinIosArm64 --continue
206 tests completed, 1 failed  (exit 1; 125 s after a 199 s lock wait, one earlier attempt 75; load 5.0)
the one failure is selfie-guidance's own pinned case "selfie-guidance - the extension stub never extends" (expected <null> but was SelfieCaptureWindow(...)),
over its uncommitted Extension.kt; every capture-pipeline test passes (CaptureScreenSlotsTest 12, CaptureTriggerTest 4, AutoCaptureTest 2,
CaptureScreenTest 24, CaptureActionHookTest 3, CaptureHooksTest 8, KeepScreenOnTest 2, the camera and events suites); the iOS klib compiles.
```

## C219.5: the camera's device tests (CI emulator only)

`androidDeviceTest/.../camera/CameraXFramePipelineTest.kt`, compiled by `:openverify-sdk:assembleAndroidDeviceTest` (passed in the slice-3 RED run above) and run only by CI's `android-instrumented` after the orchestrator's push (rule 18). Each SDK assertion has a host twin; the device test checks the platform glue only:

| Device test | What only a device shows | Host twins |
|---|---|---|
| `threeUseCasesBindTogetherAndFramesArriveAtTheSampledRate` | CameraX binds Preview, ImageCapture and RGBA ImageAnalysis together on a real camera stack; over 4 s, at most 8 frames a second + 1, at least 1 a second, every gap at least 125 ms less one 15 fps frame; frames at least 640 px on the long side, rows packed | `CameraXCapturePipelineTest` (three in one call, frames keep coming), `FrameSamplerTest`, `FrameAnalyzerTest`, `FrameRelayTest` |
| `theForcedTwoUseCaseFallbackGivesNoFramesAndStillTakesThePhoto` | with `forceTwoUseCases = true`, `frames()` completes empty and `takePicture()` still gives a decodable JPEG | `CameraXCapturePipelineTest` (the hook forces two; frames complete empty), `UseCaseBindingTest` |
| `theBarcodeSideIsReadAtLeast1280WideAndItsCopyIsMeasuredAgainstAFullResolutionCrop` | the BARCODE target's frame size on the device (at least 1,280 when the camera has it); the copy CPU time (`Debug.threadCpuTimeNanos`, 30 copies) of that frame against the guide-area crop (90 % of the width, ID-1 shape) of the camera's largest YUV size, both logged under `OpenVerifyCameraTest` for the record | `AnalysisTargetTest`, `RgbaFramesTest`, `FrameAnalyzerTest` (the CPU bound) |

The existing `CameraXCaptureCameraTest` (10A) keeps running: preview and capture now bind with analysis beside them.

## Final gates (rule 17's eight calls, then `pnpm format:check`)

Each call `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)`, in the foreground through a wrapper that re-ran a call refused by the lock (exit 75) or by another agent's uncommitted test file that did not compile; the wait and the load are each call's last attempt.

| Call | Result | Run | Lock wait | Load (1 min) |
|---|---|---|---|---|
| (a) `:openverify-sdk:testAndroidHostTest` | exit 1: 2,312 tests, 0 skipped, 3 failed, none in capture-pipeline's paths: `OpenVerifyInquiryActivityComponentsTest` "in a sandbox the installed outcome rides on the signals body" and "in production it is never sent, and the body still is" (`no signals call`), and selfie-guidance's own `StateHooksTest` case over its uncommitted `Extension.kt` | 196 s | 58 s (one earlier attempt 75) | 4.5 |
| (b) `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | exit 0: 54 tests, 0 failed | 49 s | 73 s | 2.7 |
| (c) `koverVerify checkKotlinAbi` | exit 1 twice: its host-test run failed on the same two `OpenVerifyInquiryActivityComponentsTest` cases (2,312 tests, 2 failed), so Kover's line gate did not run; `checkKotlinAbi` alone passed in (d1) | 189 s | 154 s | 5.2 |
| (d1) `testDebugUnitTest assembleDebug` (+ `checkKotlinAbi`) | exit 0 | 49 s | 206 s (three earlier attempts 75) | 18.1 |
| (d2) `:demo-app:assembleRelease :demo-app:bundleRelease` | exit 0 | 118 s | 188 s (one earlier 75) | 5.8 |
| (e1) `:openverify-sdk:assemble` | exit 0 (the AAR, both iOS klibs, `checkDependencyBoundary`) | 12 s | 215 s | 9.2 |
| (e2) `lint` | exit 0 | 11 s | 132 s (one earlier 75) | 5.7 |
| (f) `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | exit 0 (`CameraXFramePipelineTest` compiles) | 12 s | 72 s | 4.6 |
| `pnpm format:check` | exit 0 | | | |

The two `OpenVerifyInquiryActivityComponentsTest` cases serve a consented session with `signals.integrity: true` and block the test thread on `MockWebServer.takeRequest` for the signals call; the flow stops at the camera-permission gate, so no capture-pipeline code runs, and foundation-10b's record shows the same two failing over device-integrity-android's probe work before any capture-pipeline GREEN. They are device-integrity-android's (`signals/`, its off-main-thread probes, `0b7e4867`); this agent did not edit them.

SDK host tests: 1,960 at contracts-10b's close; 2,312 in this run (every agent's); capture-pipeline added 72 (`CameraEventsTest` 6, `FrameSamplerTest` 6, `FrameBuffersTest` 3, `FrameRelayTest` 9, `UseCaseBindingTest` 4, `AnalysisTargetTest` 3, `RgbaFramesTest` 3, `FrameAnalyzerTest` 8, `CameraXCapturePipelineTest` 6, `UploadRequestFixturesTest` 6, `CaptureTriggerTest` 4, `AutoCaptureTest` 2, `CaptureScreenSlotsTest` 12), removed none, and replaced one pinned case in `StateHooksTest`. Goldens: none (0 bytes; `screenshots/capture-pipeline/` keeps its `.gitkeep`). Kover exclusion relied on: `dev.openverify.sdk.camera.ProcessCameraBinder*` (every line calls CameraX's provider; the device tests run it), beside 10A's `CameraXCaptureCamera*` in the build file.
