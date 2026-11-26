# TDD evidence: Workflow 4A Stage 2, android-capture (C46.2)

- **Slice owner:** `android-capture` (Workflow 4A, Stage 2, in parallel with `vision-face`, `vision-integrity`, `checks-logic`, `fixtures` and `flow-capture`).
- **Date:** 2026-10-21.
- **Paths owned:** `android/**` and this file.
- **Input:** C46.2, with the C40 protocol it speaks (C40.2 create, C40.3 per-pose upload, C40.4 submit and device snapshot, C40.11 shared constants), the C42.3 matching consent, C45.1 (the default flow the tests now pin), and the 3B follow-up "an `UNKNOWN` verification status leads to a new attempt" (C48).
- **Golden fixtures read:** `contracts/fixtures/flow/selfie-capture.json`, `selfie-capture-created.json`, `selfie-capture-submit.json`, and `contracts/fixtures/api/flow-session.json`.
- **Dependencies:** none added. The Camera2 interop used for the frame rate is part of `androidx.camera:camera-camera2`, already a dependency.

Each change follows the same cycle:
1. A stub commit names what the tests need, so the RED commit compiles.
2. The tests are written and run, and fail for the intended reason (RED).
3. The smallest change makes them pass (GREEN), then the code is refactored with the suite green.

Where a test pins behaviour that already exists, RED is a temporary mutant of the implementation, never committed. The file was saved to the session scratchpad first and copied back afterwards; `git diff --stat` on it was empty each time.

**How the commands ran.** Every command ran from `android/` after `source scripts/env.sh`. The output is trimmed to the lines that matter. Failure messages come from `openverify-sdk/build/test-results/testDebugUnitTest/*.xml`. The API's capture routes answer 501 until Stage 3, so every test runs against MockWebServer, the golden fixtures, or `FakeFlowApi`.

## 1. An `UNKNOWN` verification status (3B follow-up)

The coordinator treated a status newer than the SDK (`UNKNOWN`) like a failed attempt. It created a new verification and spent one of the user's attempts, although the unknown attempt may still be running or already decided. Now an `UNKNOWN` latest attempt ends on the unsupported screen. That screen says this version of the app does not support the step and offers only Close. No attempt is created. A re-read was the other option the plan allowed. It was not chosen: while a verification is being processed, polling already re-reads it, so an `UNKNOWN` seen on resume is not transient.

**RED** (`2d5ed2f`):

```text
$ ./gradlew :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.flow.FlowCoordinatorTest' -q
88 tests completed, 2 failed
x [GOVERNMENT_ID] java.lang.IllegalStateException: No decision scripted for ver_01M5CK16P0D13FXHZSS4TCFB00
x [SELFIE]        java.lang.IllegalStateException: No decision scripted for ver_01M5CK16P0D13FXHZSS4TCFB00
```

The fake's message shows the bug: the coordinator created a new verification (`ver_…00`), uploaded the photos, submitted it and polled it.

**GREEN** (`9535839`): `FlowCoordinatorTest` 88 tests, 0 failed.

## 2. Wire models and the flow API clients (C40.2–C40.4, C42.3)

**Stub** (`6efc668`):
- the wire models in `model/SelfieCapture.kt`;
- `FlowApi.createSelfieCapture`, plus the new `capture` parameters of `uploadFile` and `submitVerification` and the `optionalTextKeys` parameter of `acceptConsent`;
- `ConsentStep.optionalTextKeys` and `FlowSession.faceTemplateRetentionDays`, both `@Transient`, so they are not decoded yet;
- `SelfieCaptureProtocol` with placeholder values.

**RED** (`73ef41f`):

```text
$ ./gradlew :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.api.*' --tests 'dev.openverify.sdk.model.*' \
    --tests 'dev.openverify.sdk.flow.SelfieCaptureProtocolTest' -q
164 tests completed, 36 failed
x FlowApiClientTest createSelfieCapture [CAMERA, UPLOAD]      UnsupportedOperationException: Selfie captures are not implemented yet (stub)
x FlowApiClientTest a created capture that breaks the contract (6 cases)   expected InvalidResponse but was UnsupportedOperationException
x FlowApiClientTest acceptConsent sends the optional texts ...  expected {..."optional-text-keys":["consent.biometric-matching"]...}
x FlowApiClientTest uploadFile sends a selfie pose with its capture id, nonce and elapsed time
                    expected [(kind), (capture-id), (nonce), (client-elapsed-ms)] but was [(kind)]
x FlowApiClientTest submitVerification names the capture ...   expected {"capture":{...}} but was {}
x FlowApiClientTest verification IDs that are not ver_ ULIDs (5)   expected IllegalArgumentException but was UnsupportedOperationException
x OneTimeLinkFlowApiTest the selfie capture calls reach the session's client   UnsupportedOperationException (stub)
x SelfieCaptureProtocolTest capture lifetime   expected <180> but was <0>
x SelfieCaptureProtocolTest camera stays open  expected <true> but was <false>
x ContractFixturesTest flow-session decodes ... the consent   expected ConsentStep(... optionalTextKeys=[consent.biometric-matching]) but was ([])
x ContractFixturesTest retention days   expected <365> but was <null>
x SelfieCaptureModelTest elapsed outside 0..600,000 (3), malformed id (4), malformed nonce (4): nothing was thrown;
                         the elapsed bound expected <600000> but was <0> (4)
```

**Passed at RED.** These tests only check shapes the stub had already declared:
- the golden created capture decodes;
- the golden submit body decodes into every Kotlin member, and is written back with exactly its member names;
- no model prints the nonce or the camera label;
- the golden guidance equals the shared constants;
- a session from before Phase 4 decodes;
- consent without optional keys leaves the member out;
- a government ID upload has no capture fields.

**GREEN** (`ad44422`): all 556 SDK tests pass.
- **Self-validating models.** The models check themselves in `init`: a `self_` ULID id; a nonce of 22 base64url characters; prompts that start with `center`, with each pose once; `client-elapsed-ms` from 0 to 600,000. A created capture that breaks the contract therefore fails to decode, and `FlowHttp` reports it as `InvalidResponse`.
- **Upload fields.** The upload sends `kind`, `capture-id`, `nonce` and `client-elapsed-ms`, all before the file.
- **Submit body.** Submit sends `{"capture":{…}}` for a selfie and `{}` for a government ID.
- **Consent body.** Consent sends `optional-text-keys` only when the user ticked one, as servers from before Phase 4 expect.
- **No secrets printed.** No `toString` prints the nonce or a camera label.

## 3. The device snapshot and `image-mirrored` (C40.4)

**Stub** (`d9c9377`): `CameraFacts`, `toDeviceSnapshot()` returning an empty snapshot, and `CaptureCamera.deviceFacts()`.

**RED** (`0de60f9`):

```text
$ ./gradlew :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.camera.*' -q
49 tests completed, 7 failed
x CameraFactsTest a front camera's facts become the snapshot's label, settings and capabilities
    expected SelfieDeviceSnapshot(label=<redacted>, settings=SelfieDeviceSettings(width=1440, height=1920, frameRate=30.0, facingMode=USER ...
    but was SelfieDeviceSnapshot(all null)
x CameraFactsTest lens facing 0   expected <USER> but was <null>;  lens facing 1   expected <ENVIRONMENT> but was <null>
x CameraFactsTest a logical camera's ids are listed together   expected <0,2,3> but was <null>
x CameraFactsTest label cleaned and kept to 200 characters   NullPointerException
x CameraFactsTest without camera facts the snapshot still says how the photo is stored   expected imageMirrored=false but was null
x ImageEncodingTest the uploaded JPEG is never mirrored at any quarter turn, and the device snapshot says so
    rotation 0 expected:<false> but was:<null>
```

The pixel measurement in the last test already found no mirroring at RED. Only the snapshot's claim was missing.

**The mirroring test.** A frame with red, blue and green quadrants (top-left, top-right, bottom-left) goes through `ImageEncoding.uprightJpeg` at 0°, 90°, 180° and 270°. The test locates the markers in the decoded JPEG and computes the winding of the three markers. A rotation keeps the winding and a mirror reverses it. The test asserts that the measured state is "not mirrored", and that the snapshot's `image-mirrored` equals what was measured.

The CameraX side cannot run on the JVM, so it was checked in CameraX 1.6.2's bytecode:
- `ImageCapture.Builder.setMirrorMode` throws "setMirrorMode is not supported";
- the in-memory `OnImageCapturedCallback` delivers the sensor's frame, which is not mirrored;
- `ImageProxy.toBitmap()` applies no transform.

**GREEN** (`35b6fff`): 573 SDK tests pass. `lintDebug` reports only the warnings that already existed, and nothing about the opt-in. The mapping:
- **`label`:** the camera ids from `CameraInfo.getCameraIdentifier()`, joined with commas, cleaned of control and bidirectional characters, and cut to 200 code points, as the server's `sanitizeDeviceLabel` does.
- **`settings.facing-mode`:** a front lens becomes `user` and a back lens `environment`. An external lens names no facing mode.
- **`settings.width` and `height`:** the last photo's size, upright.
- **`settings.frame-rate`:** the upper bound of `CONTROL_AE_TARGET_FPS_RANGE` from each preview frame's capture result. It is read through a passive Camera2 interop session callback, with `@OptIn(ExperimentalCamera2Interop::class)`.
- **`capabilities.frame-rate-max`:** the highest supported frame rate.
- **`image-mirrored`:** `ImageEncoding.MIRRORS_IMAGES` (false).

A value outside the server's bounds is left out rather than sent. The instrumented `CameraXCaptureCameraTest` also asserts the facts after a real capture: the lens facing, and a resolution whose orientation matches the photo's. It compiles locally and runs in CI only.

## 4. The coordinator: the C40 protocol and matching consent

**Stub** (`993f5ee`):
- `FlowState.Capture.sending` and `restarted`, and `FlowState.Consent.retentionDays`;
- `capture(image, camera)`, `pick(image)` and `acceptConsent(optionalTextKeys)`;
- the injected `Settings.timeSource`.

**The test double.** `FakeFlowApi` now behaves like a C40 server:
- it draws the side order of an active capture (right, then left, the reverse of the step's order);
- a new capture supersedes the open one and deletes its files;
- the cap of 10 cancels the verification and answers `selfie_capture_limit`;
- each pose is checked for its capture, nonce, expiry and prompt;
- submit checks that the capture is complete, and accepts an idempotent repeat;
- a selfie pose or submit without its capture is a test failure (C40.7).

`DEFAULT_FLOW` is now the C45.1 flow (three poses, active), as plan amendment 11 asks.

**RED** (`1b65186`):

```text
$ ./gradlew :openverify-sdk:testDebugUnitTest -q
592 tests completed, 33 failed   (FlowCoordinatorTest 31, InquiryViewModelTest 2)
x the selfie step creates its verification and a capture before the first prompt ...
    expected [getSession, createVerification:selfie, createSelfieCapture:camera] but was [getSession]
x each pose is sent with its capture's id and nonce ... before the next prompt   expected [upload:selfie-center] but was []
x the happy path / submit names the capture / centre-only step / review (2) / submit refused (2) / lost submit
    IllegalStateException: A selfie pose was sent without its capture
x a pose refused with selfie_capture_invalid / a capture older than its lifetime / the capture cap
    expected Capture(... restarted=true) but was Capture(SELFIE_LEFT ...)
x a pose sent after the server expired the capture   NoSuchElementException (no capture was ever created)
x a pose that could not be sent is sent again on retry   expected Error(NETWORK) but was Capture(SELFIE_LEFT, 1, 3)
x resuming an initiated selfie verification makes it a new capture   expected [getSession, createSelfieCapture:camera] but was [getSession]
x a photo picked in a sandbox ... / picked for a later prompt / outside a sandbox ignored   (a pick behaved as a camera photo)
x consent sends ... only the optional keys the user ticked   expected <[consent.biometric-matching]> but was <[]>
x the consent states (6, InquiryViewModelTest included)   expected Consent(..., retentionDays=365) but was retentionDays=null
x the lost-answer and unexpected-body call lists (4), resuming a submitted verification
    the list stops before the selfie step's createVerification:selfie, createSelfieCapture:camera
```

**GREEN** (`785cd63` and `ae28f05`). The first run after the implementation left 2 failures, in tests that passed at RED:

```text
592 tests completed, 2 failed
x resuming an initiated verification reuses it   expected: <0> but was: <1>
x a create that never reached the server is made again on retry ...   expected: <PASSED> but was: <INITIATED>
```

Both are government ID tests. One counted every create and the other read the last verification of any type. The selfie step now creates its verification before its first prompt, so both now see it. Commit `785cd63` scopes them to the government ID verification they are about. After that, all 592 tests pass.

**The behaviour:**
- **Before the first prompt.** The selfie step creates (or reuses) its verification and a `camera` capture. The prompts follow the capture's order.
- **Each pose.** It is sent as soon as the user keeps it, with `capture-id`, `nonce` and `client-elapsed-ms`, before the next prompt. The time runs from the capture's creation to the shutter, on the injected monotonic clock, not to the upload. While it is sent, the screen shows `sending`.
- **Submit.** It names the capture and its nonce. A camera capture adds `camera.toDeviceSnapshot()`; an upload capture sends no device snapshot.
- **A new capture.** It starts after:
  - a 409 `selfie_capture_invalid` or `selfie_capture_incomplete`, on a pose or on submit;
  - the capture reaching its lifetime on the device's clock, before any photo is sent to it;
  - a create answered 409 `selfie_capture_limit` (the verification was canceled).

  In each case the photos are dropped and the session is re-read, and the flow continues from the step. An initiated verification then gets a new capture, whose first prompt says why (`restarted`). A canceled one becomes a new attempt. A submitted or decided one is polled or passed.
- **Repeated submit.** A submit whose answer was lost is repeated with the same capture, which the server accepts again (C40.4).
- **Sandbox picks.** A photo picked from files in a sandbox moves the attempt to an `upload` capture when the user keeps it, so a capture never claims a camera it did not use. A photo picked for the first prompt (always `center`) is kept; on a later prompt the prompts start again. Outside a sandbox, `pick` is ignored.
- **Consent.** The required keys sent are exactly the step's `textKeys`. The optional keys sent are those the user ticked, the step offers and the SDK can show. An optional text the SDK cannot show does not make the step unsupported. The consent state carries the session's `face-template-retention-days`.

## 5. The screens (C42.3, C46.2) and the strings

**Stub** (`2614b2e`):
- the new `FlowActions` signatures and `TestTags.optionalConsent`;
- `ConsentTexts.optionalCheckboxes` (empty) and `consentText` (no filling);
- three new strings in English and Spanish:
  - the matching consent's checkbox label;
  - "Sending your photo…";
  - the message that the selfies are taken again.

The stub's screens kept their old behaviour. The tests' lambdas were adapted so that the stub compiles.

**RED** (`c7e5957`):

```text
$ ./gradlew :openverify-sdk:testDebugUnitTest -q
613 tests completed, 17 failed
x MessagesTest the optional matching consent has its own checkbox label   expected <{consent.biometric-matching=…}> but was <{}>
x MessagesTest the days placeholder is filled   expected <A template is kept for 365 days.> but was <… {{days}} days.>
x MessagesTest not offered without days   expected <null> but was <… {{days}} days.>
x ConsentScreenTest (3) and InquiryFlowScreenTest (1)   no node tagged openverify:consent-optional:consent.biometric-matching
x InquiryFlowScreenTest a photo picked in the sandbox goes through the actions   expected:<[pick]> but was:<[capture]>
x CaptureScreenTest a camera photo goes to the flow with what the camera reported   expected:<[CameraFacts(cameraIds=[1], ...)]> but was:<[null]>
x CaptureScreenTest ... the photo goes to the flow as picked   expected:<[CapturedImage(image/jpeg, 763 bytes)]> but was:<[]>
x CaptureScreenTest while a pose is sent ...   no node with text 'Sending your photo…'
x CaptureScreenTest the first prompt of a new capture says why   no node with the restart text
x CaptureScreenTest each prompt's title is a live region   Failed to assert (LiveRegion = 'Polite') on '[Turn your head to the right]' [Heading]
x CaptureScreenTest the camera stays open across a selfie's prompts and their review   expected:<[FRONT]> but was:<[FRONT, FRONT]>
x InquiryViewModelTest (3)   optional keys, a picked photo outside a sandbox, and a camera's facts did not reach the coordinator
```

**Passed at RED.** These six tests guard what must not change:
- a text without the placeholder is shown unchanged;
- an unticked box sends no key;
- no retention days means no optional box;
- a photo under review is not being sent;
- a prompt that is not a restart says nothing about one;
- a selfie photo under review hides the preview from screen readers.

**GREEN** (`fcc5b64`): all 613 SDK tests pass.
- **The consent screen.** Below the required agreement, it shows each optional text with `{{days}}` filled in, and its own checkbox, unticked. Continue depends on the required agreement only, and sends the ticked keys. A text that names the days is not offered when the session gives none: it cannot be shown truthfully without its retention period.
- **The capture screen:**
  - it sends camera photos with `camera.deviceFacts()`, and picked photos separately;
  - while a pose is sent, it shows "Sending your photo…" and disables Retake and Use;
  - on a new capture's first prompt, it shows the restart message;
  - each prompt's title is a polite live region, so a screen reader announces the next pose.
- **The camera stays open (C40.11 `camera-stays-open`).** A selfie keeps the camera preview composed under the photo being reviewed or sent. Its semantics are cleared and the photo has an opaque background, so the camera is not reopened for each prompt.

The prompts themselves (centre, left, right) already had English and Spanish strings. The new strings pass `SpanishMessagesTest`, which requires every string to have its own Spanish text.

## 6. Refactor and guards

- **Refactor** (`f1e3fd3`, then `7571669`):
  - `confirmCapture` keeps the government ID and selfie branches apart, instead of a `when` whose last condition ran `process()`;
  - the elapsed-time bound is `SelfieCaptureUpload.MAX_CLIENT_ELAPSED_MS` in the public model, so `model` no longer imports `flow`;
  - the stub notes on the new states became documentation.

  The suite was green before and after: 613, then 616 tests.
- **Guard** (`08b33b1`): a failed selfie attempt with attempts left (the C43 cascade: an insufficient turn alone) is retried on a new verification and capture, and its pose hint shows on every prompt. A mutant that showed no hints on a new capture's first prompt failed it: 108 tests, 1 failed, `expected: <Capture(... retryHints=[RetryHint(name=selfie_pose_detection, reasons=[pose_not_left])] ...`.
- **Guards** (`cf8369f`):
  - a capture create that failed on the network is retried without a second verification;
  - a failed move to an upload capture is made again on retry.

  The first mutant created the verification on every try; the second made the upload capture's retry do nothing. Under them, 110 tests ran and 7 failed:
  - the two new tests failed: `expected: <1> but was: <2>`, and the error state instead of the next prompt;
  - five protocol tests also caught the first mutant.

## Final gate

```text
$ (cd android && ./gradlew --no-daemon testDebugUnitTest koverVerify assembleDebug lint)     # at 7571669
BUILD SUCCESSFUL in 1m 48s
openverify-sdk: 616 tests, 0 failed, 0 skipped        (Phase 3 ended at 516)
demo-app:        18 tests, 0 failed
Kover (openverify-sdk): line 97.74% (1,557/1,593), instruction 90.90%, branch 71.78%; the gate is 80% line
lint: openverify-sdk GradleDependency 5, NewerVersionAvailable 4, OldTargetApi 1; demo-app OldTargetApi 1, GradleDependency 1
      (all warnings that already existed; no error)
$ ./gradlew :openverify-sdk:compileDebugKotlin :openverify-sdk:compileDebugUnitTestKotlin --rerun-tasks   # no "w:" lines
$ ./gradlew :openverify-sdk:compileDebugAndroidTestKotlin                                                 # compiles; runs in CI only
```

## Decisions (for the plan; `docs/plans/phase-4.plan.md` is not this agent's to edit)

1. **`UNKNOWN` status.** An `UNKNOWN` latest attempt shows the unsupported screen. It is never re-read, and never replaced by a new attempt.
2. **`client-elapsed-ms`.** It is the time from the capture's creation (when the create's answer arrived) to the shutter, on the device's monotonic clock, kept within 0 to 600,000. The upload time is the server's `received_at`.
3. **The capture's lifetime on the device's clock.** The clock starts when the create's answer arrives, after the server's. So a capture older than `capture-ttl-seconds` on that clock has expired on the server too. No photo is sent to it (data minimisation), and a new capture starts.
4. **After a refusing 409, the session is re-read first.** That covers a verification that is meanwhile submitted, decided or canceled, as well as an initiated one that needs a new capture. The codes are `selfie_capture_invalid` and `selfie_capture_incomplete` on a pose or on submit, and `selfie_capture_limit` on a create. Any other 409 keeps the existing behaviour: the "changed somewhere else" error, whose retry re-reads the session.
5. **Sandbox picks and the capture method.** A photo picked under a `camera` capture moves the attempt to an `upload` capture. The camera may still be used under an upload capture, since `upload` is the weaker claim. The device snapshot is sent for camera captures only.
6. **Optional consent.** An optional text is offered only when the SDK has its text and its checkbox label. A text that names `{{days}}` is offered only when the session gives the days. It sits below the required agreement, so that "as described above" covers only the required texts.
7. **The frame rate** comes from a passive Camera2 interop capture callback (`ExperimentalCamera2Interop`). No public CameraX API reports the frame rate in use, and setting a target frame rate could break binding on some devices. It cannot be verified without a device; the instrumented test checks the lens facing and the resolution, not the frame rate.
8. **The device snapshot** leaves out `webdriver` (there is no browser), `frame-stats` and `resize-mode`. Each member is optional (C40.4).

## Follow-ups

- A golden 409 problem fixture for each `SELFIE_CAPTURE_PROBLEM_CODES` value would let both clients test against the server's actual bodies. `contracts/fixtures/api` belongs to `api-flow`.
- The protocol has run only against the test double and MockWebServer: the routes answer 501 until Stage 3. Integration should run the SDK against the real Stage 3 routes. There is no Android e2e; instrumented tests run in CI.
- The frame rate read and the camera ids need a check on real devices: CI's emulator runs `CameraXCaptureCameraTest`, but does not check the frame rate.
- A native speaker should review the three new Spanish strings.
