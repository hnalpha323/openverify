# openverify-face

Optional add-on to the OpenVerify Android SDK: an on-device face detector for the selfie step's capture guidance. It runs the YuNet model with ONNX Runtime.

> **Status (Workflow 10E of Phase 10, 2026-11-11).** The detector is built. It is tested on the host and, for inference, on one phone. **The network measurement of ONNX Runtime's telemetry has not been made on any device yet** (see [What was measured, and what was not](#what-was-measured-and-what-was-not)). Nothing has run on an emulator or in CI. No Maven coordinates resolve yet: the artifact is built from this repository.

## What it adds

Without a detector, a selfie step shows the server's prompts and the person presses the shutter. With this module installed, the SDK guides the person ("move closer", "turn left") and takes each photo when the pose is held. The shutter stays on screen and becomes the main control after 10 seconds.

```kotlin
OpenVerifyAndroid.install(
    OpenVerifyComponents(faceDetectorFactory = OpenVerifyFace.detectorFactory(context)),
)
```

Install it once, when your process starts. `detectorFactory` keeps only the application's assets and loads nothing of ONNX Runtime. The native library loads when a selfie capture screen first asks for a detector.

It is **guidance, never a result**:

- The server decides liveness and every other outcome, from the photos it receives.
- The guidance does not detect camera injection, a replayed video, a rooted device or a modified app.
- No liveness, presentation-attack, ICAO or BSI certification is claimed.

If the detector cannot start (the model fails its check, or ONNX Runtime's native library is not in your app for the device's ABI), the selfie screen keeps the manual shutter, exactly as without this module. Your app does not crash and the person can still finish.

## On-device face processing (for your biometric notice)

With this module installed, YuNet computes face boxes and five landmarks (eyes, nose tip, mouth corners) **on the device** for every analysed selfie frame:

- only while the selfie capture screen is shown, after the person consented;
- held for one frame: the detector's buffers are zeroed before each frame's call returns, and the SDK wipes its own copies before the frame's callback returns;
- never stored, logged or sent. Only the SDK's pose state ("looking left, held for 300 ms") outlives a frame, and it stays on the device.

Whether this is biometric processing under the law that applies to you is your decision as the operator. The facts above are what your notice can rely on.

## What your app's manifest receives

ONNX Runtime's own library manifest declares two things beyond `INTERNET` (which the SDK asks for already).

**A telemetry content provider** (`ai.onnxruntime.TelemetryInitializer`). Android would create it when your process starts. **This module removes it.**

One case is yours: if your app *also* depends on ONNX Runtime directly, and declares it ahead of this module, the merger reads ONNX Runtime's manifest first and this module's removal does not reach it. Remove the provider in your own manifest then:

```xml
<provider android:name="ai.onnxruntime.TelemetryInitializer" tools:node="remove" />
```

**`android.permission.ACCESS_NETWORK_STATE`.** This module does **not** remove it: a library that removed it would also take it from any other library of yours that needs it. Nothing in this module uses it. If your app has no other use for it, remove it in your own manifest:

```xml
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" tools:node="remove" />
```

Do not add `tools:selector` to either line. With the Android Gradle plugin 9.4.1, a remove marker with a selector rejects the named library's line but stays in the merged manifest as a declaration of its own.

## ONNX Runtime's telemetry

ONNX Runtime's Android library carries a telemetry client. This module switches it off in four layers:

1. **The manifest.** The telemetry provider is removed (above), so nothing starts with your process.
2. **The environment variable.** `ORT_DISABLE_TELEMETRY=1` is set in the process before this module creates the first `OrtEnvironment`.
3. **Every session.** `OrtEnvironment.setTelemetry(false)` is called before each session this module opens.
4. **A measurement on a device.** A device test runs the detector in an app that holds `INTERNET` and counts the app's bytes over a stated window. It passed on one phone (below).

### What was measured, and what was not

All of this is from one Pixel 9 (Android 17, arm64-v8a) on 2026-11-11. Nothing ran on an emulator, another device or another Android version.

**Measured** (`OrtTelemetryDeviceTest`, the test that needs no network): the detector ran in a new process of an app that holds `INTERNET`, has no telemetry provider and has removed `ACCESS_NETWORK_STATE`. In that process, and again in a second new process after the first was ended:

- no ONNX Runtime telemetry class was loaded (read from the process's own heap dump, which did list the ONNX Runtime classes that ran);
- `ORT_DISABLE_TELEMETRY` was `1`, and this module had created the environment;
- no file appeared under the app's `files`, `databases`, `cache` or `no_backup` directories.

**Measured: the byte count** (`OrtTelemetryDeviceTest`, the second test; the same phone, awake, unlocked and on charge, at commit `d6af3cc37`). The test counts the app UID's bytes with Android's `TrafficStats`, from before a new process exists, through the first `OrtEnvironment`, eight frames of inference and the detector's close, to the end of a fixed 120-second quiet period, and then the same in a second new process; the test runner's own traffic is measured separately first, over 30 seconds. It refuses to measure on a phone that is asleep or dozing, because such a phone sends nothing whatever the app holds (two earlier runs on a dozing phone were refused and count for nothing).

| Window | Length | Received | Sent |
|---|---|---|---|
| The runner alone (control) | 30.0 s | 0 B | 0 B |
| A new process: environment, inference, close, quiet period | 124.4 s | 0 B | 0 B |
| A second new process, after the first was ended | 124.4 s | 0 B | 0 B |

**What this is, and is not.** It is a statement about those two windows, on that phone, on that day, with this module's four layers in place: the app's counters did not move. It is not a claim that ONNX Runtime never sends anything: nothing was measured on an emulator, on another device or Android version, over a longer period, or in an app that uses ONNX Runtime in other ways.

### If your app uses ONNX Runtime itself

`OrtEnvironment` is one per process. If your app created it before this module's first use, this module did not choose how it was created, and **your own ONNX Runtime configuration governs**: the environment variable may not have been set in time, and anything your code sent or queued is yours.

This module detects that case. In a debuggable build it logs the code `face.ort_environment_host_created` once. It still calls `setTelemetry(false)` on the shared environment before each of its own sessions. If you rely on ONNX Runtime's telemetry in your app, know that this switches it off for the process.

## The model

- `face_detection_yunet_2026may.onnx` from OpenCV Zoo, MIT. It is never committed to this repository.
- The build copies it into the AAR's assets (`assets/openverify-face/`) only after its SHA-256 matched `models/manifest.json`. The build never reaches the network: if the file is absent it fails and names the command below.
- On the device, the bytes are checked against the same SHA-256 again before every session. Any other bytes are refused.

To build this module, fetch the model first, from the repository root:

```bash
python3 -I scripts/fetch_models.py --only face_detection_yunet
```

Its tests also read one public-domain face, which is fetched and never committed or shipped:

```bash
python3 -I scripts/fetch_fixtures.py --only person_a_id
```

## How it runs

- One `OrtSession` per detector, on the CPU, with two intra-op threads. The SDK creates one detector per selfie prompt and closes it with the prompt.
- The native input and output buffers are allocated once per frame size and reused.
- The twelve output tensors are returned by their names (`cls_8` … `kps_32`), and the SDK decodes them in its common code.

## R8

The AAR carries its own consumer rule, which keeps ONNX Runtime's classes for its native library (it finds them by name). Your app needs no rule of its own for this module.

## Size

Only an app that adds this module carries ONNX Runtime's native library. Measured with bundletool on the minified demo (`docs/android/sizes.md`, which holds every ABI): on `arm64-v8a` the module adds 13.2 MB to the download and 34.7 MB installed, of which `libonnxruntime.so` is 34.2 MB uncompressed. The demo with the SDK and this module is 16.6 MB to download and 41.8 MB installed on that ABI.

A custom ONNX Runtime build with only YuNet's operators was planned as a size experiment. It was **not measured**: the build host has no Android NDK. The official AAR is what ships.

## Logging and errors

The module logs only constant codes (such as `face.model_digest_mismatch`), and only in a debuggable app. It never logs a frame, a box, a landmark, a score or an exception's text. Every exception it creates has a fixed message and no cause.

## Licences and notices

- This module's own code: Apache-2.0.
- **ONNX Runtime 1.31.0:** MIT. Its native library has **Eigen** compiled in, which is MPL-2.0. The project's licence rule allows that only by a recorded, narrow owner exception for this module (Phase 10 owner item P2; `THIRD_PARTY_LICENSES.md`, section 6): Eigen unmodified, as compiled into the official `onnxruntime-android` AAR, only inside this artifact. The core SDK never depends on this module or on ONNX Runtime; a build check fails if it does.
- **The YuNet model:** MIT. It was trained on the WIDER FACE dataset, whose card states CC BY-NC-ND 4.0; `THIRD_PARTY_LICENSES.md` section 3 explains the project's policy.

The AAR carries the notices as assets under `assets/openverify-face/`: [`NOTICE`](NOTICE) (with Eigen's source location), ONNX Runtime's licence and third-party notices ([`licenses/onnxruntime/`](licenses/onnxruntime/), copied from the `v1.31.0` tag), and the model's licence with the training-data notice ([`licenses/yunet/`](licenses/yunet/), copied from OpenCV Zoo at the pinned commit).

## Tests

- **Host** (`./gradlew :openverify-face:testDebugUnitTest`): the detector runs on the host JVM's build of the same ONNX Runtime version, so the session code is covered without a device. The tests hold the raw outputs to the vision service's, the decoded face to the server runtime's numbers on a public-domain frame, the manifest merge with a fake library, the order of the telemetry calls, and that nothing of a frame is left after a call.
- **Device** (`./gradlew :openverify-face:connectedDebugAndroidTest`): `YunetInferenceDeviceTest` (2 tests) and `OrtTelemetryDeviceTest` (2 tests; the byte count takes about 5 minutes, and its quiet periods are fixed and never shortened). On a Pixel 9 (Android 17) on 2026-11-11, three passed and the byte count stopped at its "the device is dozing" check. None has run on an emulator.

  The inference tests gave the server runtime's result on the device: the box and landmarks within 0.0005 pixels, the score and yaw ratio within 0.000001.

## Android only

`:openverify-sdk` is a Kotlin Multiplatform library; this module is a plain Android library that implements its `FaceDetectorFactory` seam. Nothing is built for iOS in this release.
