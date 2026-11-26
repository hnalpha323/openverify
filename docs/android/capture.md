# Capture on Android

How the SDK takes ID, document and selfie photos (Phase 10, Workflow 10B; plan C201-C206). **The device guides and reports; the server judges** (ADR 0009). Nothing measured on the device passes, fails or is sent as a result: the server measures every photo again, so a photo the device would take can fail there, and the reverse.

## The frame pipeline

The capture screen binds three CameraX use cases together: the preview, the still capture (`ImageCapture`, the photo that is uploaded) and an RGBA analysis stream (`ImageAnalysis`, `STRATEGY_KEEP_ONLY_LATEST`, 4:3). The analysis frames feed the on-device guidance, at 8 frames a second on a fixed schedule:

| Capture | Analysis size | Guidance |
|---|---|---|
| ID front, ID back without a barcode hint, a passport page | 640 × 480 | document quality (below) |
| ID side the server marks barcode-bearing | 1,280 × 960 asked; what the camera grants (below) | document quality and "barcode found" |
| Selfie poses | 320 × 240 | selfie pose guidance, only with an installed face detector |
| A supporting document's page | none | the manual shutter |

- **The fallback.** A device that cannot bind the three use cases together binds the preview and the still alone. No frame reaches the guidance and the shutter is the main action, as it was before Phase 10. One `CaptureFailed(CAMERA_UNAVAILABLE)` event is sent only when no use case can be bound at all ([events](events.md)).
- **The size asked is not always the size given.** Beside the preview and a full-size still, CameraX holds the analysis stream to its preview class: the display's area, at most 1920 × 1080 and never under 640 × 480 (read from CameraX 1.6.2; one phone, a Pixel 9 on Android 17, gave 1,280 × 960 beside a 4,080 × 3,072 still, and no other device has been tried). A camera that lists no 4:3 size of 1,280 px inside that class gives the closest smaller one: an emulator with a 320 × 640 display gave 640 × 480. The SDK judges a barcode side by the first frame it gets, never by the size it asked for: a frame of 1,280 px or more is the read described below; on a smaller frame the hint reads only while the symbol nearly fills the guide, or cannot read reliably at all (a guide under 512 px across). A debuggable host sees the log codes `camera.barcode_analysis_narrow` and `camera.barcode_analysis_unreadable`. The hint gates nothing either way, and the photo is always the full-size still.
- **Frames stay on the device.** Each analysis frame is copied into one reused buffer per frame size, handed to the guidance for one callback, and written over by the next. Analysis reads the raw, unmirrored frame. No frame, face box, landmark or barcode byte is logged, saved, sent or kept past its callback.
- **The shutter always works.** It is on every capture screen: secondary while a guidance is working, primary when the guidance gives up (after 10 s, at once without frames, or after a failed auto-capture) and whenever there is no guidance. The capture screen scrolls when its words outgrow the window, so at a large font size the shutter can be below the fold and is reached by scrolling; at the default font size it is wholly on screen ([accessibility](accessibility.md)).
- **The screen stays on** while a capture screen, its review or the waiting screen is shown.
- **Overlays.** On Android 8 to 11 the shutter, "upload a photo instead" and "use this photo" ignore touches that arrive through another app's overlay.

## Document guidance

The document guidance ports the vision service's quality measures (Laplacian variance and Tenengrad sharpness, the glare share, the mean brightness) to shared Kotlin, plus two measures of our own (the framing edge ratio and, on a passport page, the MRZ band's edge density). It shows one hint at a time, in a fixed order: move closer, hold still, tilt away from the light, more light, fit the card in the frame, show the MRZ band on a passport page. A hint is announced to TalkBack only after it has held for 500 ms, so it is not repeated at 8 Hz.

- **Auto-capture** takes the still when every measure has held for 500 ms. The upload says so (`capture-trigger: auto`).
- **The constants** (`contracts/fixtures/flow/document-capture.json`) are provisional and calibrated on synthetic ID renders only: [the calibration report](../calibration/android-document-guidance.md). The measures match the server's own functions on the shared vectors (`contracts/fixtures/flow/document-quality-vectors.json`).
- **What it decides:** only when to take the photo and what hint to show, nothing else.

## "Barcode found"

On an ID side the server marks barcode-bearing (today: a retry after `barcode_not_found`), the SDK reads PDF417 symbols with zxing-cpp (Apache-2.0, bundled native code) at most four times a second and shows "Barcode found" for 1.5 s when a symbol carries an AAMVA header. The guide ("Fit the barcode in the box") is drawn, and a frame read, only while the analysis frame can carry a barcode read: a frame too narrow for a readable symbol hides it, and nothing shows before the first frame. **It is a hint only.** It never takes the photo and gates nothing, the decoded bytes are wiped before the frame callback returns, and nothing decoded leaves the device: the server reads the barcode from the uploaded photo. The host calibration decodes the synthetic symbols from 512 px wide (1.62 pixels a module), so the symbol must fill 40% of a 1,280 px analysis frame, and more of a smaller one (above); the device test `ZxingCppBarcodeReaderDeviceTest` decodes the committed images on a device at 950 and 640 px, not a 1,280 px camera frame.

## Selfie guidance

The selfie guidance is the web flow's, ported to shared Kotlin and held to its vectors (`contracts/fixtures/flow/selfie-guidance-vectors.json`): YuNet's input and decoding, the yaw ratio and the guidance machine, with the server's pose thresholds from the open capture. Each prompt is auto-captured once, from the frame in which the pose held; the still is the `ImageCapture` photo, never the 320 px analysis frame. Hints are announced once settled, and "left" means the person's own left.

- **It needs a face detector.** The core SDK ships none. Without an installed `FaceDetectorFactory` the selfie keeps the manual shutter with the server's prompts.
- **`openverify-face` is one** (Workflow 10E; optional, Apache-2.0): `OpenVerifyAndroid.install(OpenVerifyComponents(faceDetectorFactory = OpenVerifyFace.detectorFactory(context)))` runs the YuNet model through ONNX Runtime on the device. The model travels in the module's AAR and is checked against its pinned SHA-256 before every session. A detector that cannot be created, or that fails, leaves the shutter for that prompt. The module's README ([`android/openverify-face/README.md`](../../android/openverify-face/README.md)) says what it adds to your manifest, how ONNX Runtime's telemetry is switched off and what was measured.
  - **What proves it.** On the build host, ONNX Runtime's JVM build of the same version gives the server runtime's box, landmarks and yaw ratio on a public-domain fixture frame within the vector file's tolerance (`contracts/fixtures/flow/yunet-face-frame-vectors.json`). On one phone (a Pixel 9, Android 17, arm64-v8a) the Android library gave the same numbers, and the app's byte counters did not move over the measured telemetry window ([privacy](privacy.md#what-stays-on-the-device)). No emulator and no other device has run it. Auto-capture with a real face in front of a real camera is proved on the host with a fake detector only.
  - **It is guidance.** It is not liveness, not presentation-attack detection and not a check; no certification is claimed.
  - A host may also install its own detector through the same seam.
- **Detection on the device** runs only on the selfie capture screen, after consent, one frame at a time: the boxes and landmarks are zeroed before each frame callback returns ([selfie checks](../checks/selfie.md#on-device-guidance-on-android)).
- **More time (WCAG 2.2.1).** Twenty seconds before the capture's 180 s limit a polite warning offers "More time", which extends the capture by 180 s, up to ten times. A request whose answer is lost is never sent again by the SDK; a 409 is answered by reading the session.

## What the upload reports

Every photo upload carries two client-reported members (C206), stored on the file and served on the API's file resources, never by the flow API:

- `capture-method`: `camera` or `upload` (a photo picked in a sandbox), how this photo was really taken;
- `capture-trigger`: `auto` (the guidance took it) or `manual` (the shutter).

Both are what the client says. They are evidence for a reviewer, never a check result, and a modified client can send anything. What the SDK offers for an ID step is the step's `capture-methods-by-device.native` entry when it names one, else its `capture-methods`.

## Accessibility

The guidance hints are polite live regions, announced once they settle; the shutter is always reachable and labelled; the time warning's count is said once. A manual TalkBack, font-scale and keyboard pass on a device is a release gate (Phase 11).
