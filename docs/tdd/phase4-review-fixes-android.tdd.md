# TDD evidence: Workflow 4B review fixes (Android)

- **Slice owner:** Android fixer (Workflow 4B, fix stage).
- **Date:** 2026-10-21.
- **Paths owned:** `android/` except `android/openverify-sdk/src/test/kotlin/dev/openverify/sdk/model/ContractFixturesTest.kt` (the TypeScript fixer's, for K202), and this file.
- **Input:** the Workflow 4B review of the Phase 4 Android SDK and demo (`8350c31..HEAD`). There were no blocking findings. Two MEDIUM findings were assigned here, H014 and H015, in that order.
- **Dependencies:** none added.
- **Contracts:** none changed. C40.3 ("create the capture before the first prompt") still holds; H014 only moves the point before the first prompt at which the capture is created.

Each change follows the cycle the Phase 4 Android slices used (`phase4-android-capture.tdd.md`):
1. A stub commit names what the tests need, so the RED commit compiles.
2. The tests are written and run, and fail for the intended reason (RED).
3. The smallest change makes them pass (GREEN). The code is then refactored with the suite green.

Some new tests pin behaviour that already held at RED. They are guards and are marked "passed at RED" below.

**How the commands ran.** Every command ran from `android/` after `source ../scripts/env.sh`. The output is trimmed to the lines that matter. Failure messages come from `openverify-sdk/build/test-results/testDebugUnitTest/*.xml`. There is no KVM, so every test is a JVM or Robolectric unit test.

## H014: the 180 s capture clock started before the camera permission gate

**Confirmed** by reading the code at `2ef103a`:
- `FlowCoordinator.verificationState` returned `Resolution.StartCapture` as soon as the selfie step resolved.
- `continueFrom` then called `startCapture`, which created (or reused) the verification and created the capture (`createSelfieCapture`). It also started the capture's monotonic mark (`ActiveCapture(created, CAMERA, timeSource.markNow())`), and only then showed `FlowState.Capture`.
- `InquiryFlowScreen` shows that state inside `CameraPermissionGate`. The rationale, a denial, a trip to Settings and the return therefore all ran on the capture's clock.
- On the first "Use this photo", `sendPose` checked `capture.expired()` (`CAPTURE_TTL`, 180 s). If the capture had expired, the photo was dropped and `restartCapture` ran. Each restart creates another capture, and the 11th create cancels the verification (C40.2 cap).
- The web flow creates the verification and the capture only after the camera shows its first frame (`apps/flow/src/steps/selfie-capture-step.tsx`).

A temporary variant of the RED test showed the failure scenario on the code at `8ac9ccb`. The variant leaves out the new state's assertions: the capture is created at `start()`, the virtual clock advances 10 minutes, the camera is reported ready, and one photo is kept. The variant was never committed: the test file was copied to the session scratchpad and copied back, and `git diff` then showed only the RED changes.

```text
$ ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.flow.FlowCoordinatorTest'
114 tests completed, 1 failed
x the selfie step creates nothing until the camera can be shown, so a slow camera permission does not use up the capture's lifetime (4B H014)
  expected: <Capture(... kind=SELFIE_RIGHT, index=1, ... restarted=false)>
  but was:  <Capture(... kind=SELFIE_CENTER, index=0, ... restarted=true)>
```

The photo of the first pose was thrown away and the prompts started again at pose 1, as the review described.

**Fix.**
- The first selfie start of a flow now shows `FlowState.AwaitingCamera(step)`. Nothing is created yet: no verification and no capture.
- `InquiryFlowScreen` renders that state inside `CameraPermissionGate`, with the loading screen.
- Once the gate shows its content (the permission is granted, now or earlier), a `LaunchedEffect` calls `FlowActions.cameraReady()`. `InquiryViewModel` passes the call to `FlowCoordinator.cameraReady()`.
- `cameraReady()` records that the camera can be shown. In `AwaitingCamera` it runs `startCapture`, so the verification, the capture and the capture's clock all start after the permission step.
- Later selfie starts in the same flow do not wait: a restart after a 409, an expiry or the cap, and a new attempt. Waiting again would only add a round of loading. Because those starts do not wait, a `StateFlow` that conflates two equal `AwaitingCamera` values can never leave the screen waiting with no effect left to fire.
- Government ID steps are unchanged. They create nothing before their photos, so the permission time costs them nothing.
- `AwaitingCamera` is an unfinished state for the host app: finishing or going back there reports `Canceled`.

**Stub** (`8ac9ccb`): `FlowState.AwaitingCamera`, a no-op `FlowCoordinator.cameraReady()`, `FlowActions.cameraReady()` and its view model and test-double members. The screen showed `AwaitingCamera` as plain loading, outside the gate, and never called the action. `InquiryResults` maps the state to `Canceled`.

**RED** (`3ab847f`):

```text
$ ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.flow.FlowCoordinatorTest' \
    --tests 'dev.openverify.sdk.InquiryViewModelTest' --tests 'dev.openverify.sdk.InquiryResultsTest' \
    --tests 'dev.openverify.sdk.ui.InquiryFlowScreenTest'
170 tests completed, 4 failed
x FlowCoordinatorTest  the selfie step creates nothing until the camera can be shown, so a slow camera permission does not use up the capture's lifetime (4B H014)
    expected: <AwaitingCamera(step=SelfieStep(id=selfie, poses=[CENTER, LEFT, RIGHT], liveness=ACTIVE, maxAttempts=3))>
    but was:  <Capture(step=SelfieStep(...), kind=SELFIE_CENTER, index=0, count=3, ... restarted=false)>
x InquiryViewModelTest the selfie capture is created once the screen reports the camera ready (4B H014)
    expected: <AwaitingCamera(...)> but was: <Capture(... kind=SELFIE_CENTER, index=0, count=3 ...)>
x InquiryFlowScreenTest the selfie step waits behind the camera permission and reports nothing before it is granted (4B H014)
    Failed: assertExists. ... could not find any node that satisfies: (Text ... contains 'Next, we need your camera to take photos of your ID document and a selfie. ...')
x InquiryFlowScreenTest with the camera permission, the waiting selfie step reports the camera ready, once (4B H014)
    expected:<[cameraReady]> but was:<[]>
BUILD FAILED in 55s
```

Passed at RED (guards):
- `once the camera was shown, a new capture starts at once, without waiting for the camera again`;
- `a government ID step does not wait for the camera, since it creates nothing before its photos`;
- `a camera reported ready on another screen changes nothing there`;
- `AwaitingCamera` in `InquiryResultsTest.unfinished` (`Canceled`).

The coordinator test helper is now `suspend` and calls `cameraReady()` unless `cameraReady = false`. The protocol tests therefore start where the user has already been through the camera wait, and their expectations (states, calls, uploads) are unchanged. Only the H014 tests pass `false`. `InquiryViewModelTest`'s device-snapshot test calls `viewModel.cameraReady()` after the session loads, as the screen does.

**GREEN** (`75cbeff`):

```text
$ ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest
BUILD SUCCESSFUL in 1m 12s
openverify-sdk: 624 tests, 0 skipped, 0 failed      (no "w:" compiler lines)
```

## H015: a hard 180 s capture limit with no notice, warning or extension

**Confirmed** by reading the code at `2ef103a`:
- `SelfieCaptureProtocol.CAPTURE_TTL` is 180 s, the server's `SELFIE_CAPTURE_TTL_SECONDS` (C40.2).
- `FlowCoordinator.sendPose` restarts a capture older than that. A 409 `selfie_capture_invalid` does the same.
- No string in `values/strings.xml` or `values-es/strings.xml` mentions a time limit. The only text after a restart is `openverify_selfie_capture_restarted` ("We need to take your selfies again. ...").
- Each restart creates another capture, and the 11th create cancels the verification (C40.2 cap).

**What is fixed here (the local part).** Each selfie prompt with no photo under review now says: "Take all your selfies within 3 minutes. If the time runs out, we start again from the first photo." The Spanish text is "Toma todos tus selfis en un plazo de 3 minutos. Si se acaba el tiempo, volvemos a empezar desde la primera foto."
- The minutes come from `CAPTURE_TTL.inWholeMinutes`, rounded down, so the notice never promises more time than the server gives.
- The text is a `plurals` resource: `one` and `other`, plus `many` for Spanish, because the CLDR plural rules that lint checks against list it for Spanish.
- The notice also shows on the first prompt of a restarted capture, next to the restart message. That prompt therefore states the reason the photos are taken again.
- Document prompts and photos under review do not show it.

**Not fixed here (skipped, see the end of this file):** a warning before the limit, and a way to extend it.

**Stub** (`16598a2`): the `openverify_selfie_time_limit` plurals in English and Spanish, not yet shown.

**RED** (`a3c8271`):

```text
$ ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.ui.CaptureScreenTest' \
    --tests 'dev.openverify.sdk.ui.SpanishMessagesTest'
28 tests completed, 1 failed
x CaptureScreenTest each selfie prompt says how long the user has to take the selfies, and what happens after (4B H015)
    Failed: assertExists. ... could not find any node that satisfies: (Text ... contains
    'Take all your selfies within 3 minutes. If the time runs out, we start again from the first photo.')
BUILD FAILED in 48s
```

Passed at RED (guards):
- `a document prompt and a photo under review say nothing about the selfie time limit`;
- `every SDK plural has its own Spanish text, for one and for several` (the stub already held the Spanish).

**GREEN** (`3aae7ce`): `CaptureScreen` shows the notice with `pluralStringResource`.

```text
$ ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest
BUILD SUCCESSFUL in 1m 12s
openverify-sdk: 627 tests, 0 skipped, 0 failed
```

## Refactor

`34cbf7d` changes documentation only. `CAPTURE_TTL` now says the capture is created once the camera can be shown and that the prompts state the limit. The `InquiryFlowScreen` KDoc says the waiting selfie step also sits behind the camera permission. The final gate below compiled it.

## Final gate

```text
$ ./gradlew --no-daemon testDebugUnitTest koverVerify assembleDebug lint
> Task :openverify-sdk:koverVerify
BUILD SUCCESSFUL in 1m 36s
openverify-sdk: 627 tests, 0 skipped, 0 failed
demo-app:        18 tests, 0 skipped, 0 failed
lint: openverify-sdk 0 errors, 10 warnings; demo-app 0 errors, 2 warnings; openverify-nfc 0 errors, 1 warning
```

The 10 SDK lint warnings were all there before these fixes: `GradleDependency`, `NewerVersionAvailable` and `OldTargetApi` in `gradle/libs.versions.toml` and `openverify-sdk/build.gradle.kts`. None concerns the new resources or code.

## Skipped: the H015 warning and extension (WCAG 2.2.1)

H015 also asks for a warning before the limit and a way to extend it ("I need more time"). Alternatively, a restart could say why and not count toward the capture cap. Neither can be done in `android/` alone:
- **No extension exists.** The server fixes a capture's `expires_at` at creation, and no route extends it (C40.2). The only way a client can get more time is a new capture. That supersedes the old capture and deletes its photos (C40.2 "Supersede"), so "more time" would restart at pose 1. It cannot keep the poses already uploaded.
- **The cap still counts.** Every new capture counts toward the cap of 10, and the 11th create cancels the verification and uses an attempt. Not counting restarts against the cap is a server rule (`apps/api`, `packages/`).
- **WCAG 2.2.1's "extend" option is out of reach.** It needs a warning at least 20 s ahead and at least ten extensions by a simple action. The cap does not allow that without a server change.
- **Both clients must match.** The web flow (`apps/flow`) would need the same behaviour.

A real fix is a C40.2 amendment: an extend route, or restarts outside the cap, plus the API and both clients. Those paths belong to the TypeScript fixer and the plan owner.
