# Phase 10, Workflow 10E, Stage 2: face-onnx (TDD evidence)

`android/openverify-face`: YuNet through ONNX Runtime behind the SDK's `FaceDetectorFactory` seam (C204.2, C204.8, C205.2 to C205.5, C213.3, C215.1, C219.5; owner item P2, granted narrowly). Written by face-onnx on 2026-11-11, on top of contracts-10e's checkpoint `130e35581`. Every command below was run from `android/` after `source scripts/env.sh`, under the Gradle lock, as `flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>`; lock waits were 0 s unless a line says otherwise.

No CI run is counted on. What ran on a device ran on **one Pixel 9 (Android 17, API 37, arm64-v8a), over wireless adb, on the owner's Wi-Fi network**. Nothing ran on an emulator.

## 1. The ORT custom-build spike (C205.5): not measured

- `df -h /tmp`: 727 G free. Disk was not the obstacle.
- `ls ~/Android/Sdk`: `build-tools cmdline-tools emulator licenses platform-tools platforms system-images`. **No `ndk/`.** The ONNX Runtime 1.31.0 Android build needs the NDK, and installing one is not this agent's step (the 10E decisions, item 18).
- So the spike was **not started**. Nothing was cloned; `/tmp/openverify-ort-spike/` does not exist; no background job ran.
- Recorded: "not measured: no Android NDK". The official `onnxruntime-android` 1.31.0 AAR stays, as C205.5 says when the spike gives no number.
- For the owner, if the spike is ever run: the plan adopts a custom build only if it saves at least 20 MB on arm64 **and** builds reproducibly in CI. The CI half cannot be shown without Actions minutes. The official library is 34,208,680 bytes for arm64-v8a, uncompressed (contracts-10e's reading of the AAR).

## 2. The vector file (C219.5, C221.8)

`contracts/fixtures/flow/yunet-face-frame-vectors.json`: what the server's own runtime finds on the public-domain frame `person_a_id` of `fixtures/manifest.json` (3000 x 4000, `PD-USGov-NASA`), given as the SDK gives a camera frame. Numbers only (1.9 KB): sizes, one score, one box, five landmarks, one yaw ratio. Written by the assert-only `services/vision/tests/test_android_yunet_vectors.py`.

RED (`be372ba69`), the file absent:

```
$ (cd services/vision && uv run pytest tests/test_android_yunet_vectors.py --no-cov -q)
E   Failed: yunet-face-frame-vectors.json is absent: run this test with UPDATE_CONTRACT_FIXTURES=1   (x4)
4 failed
```

GREEN (`276081bbb`): written once with `UPDATE_CONTRACT_FIXTURES=1`, formatted with Prettier, then asserted without the variable:

```
4 passed in 0.72s
```

The result: one face, score 0.951985, box `[108.08, 74.99, 102.768, 153.429]` in the 320 x 427 input, yaw ratio -0.0710777.

Note on the gate's command: `uv run pytest tests/test_android_yunet_vectors.py` alone exits 1, because the vision project's coverage gate (80% over the whole package) applies to any run, and one test file covers 9.5% of it. The file is run with `--no-cov`; the whole vision suite, which is where the coverage gate means something, is integration-10e's.

## 3. The detector, its model and its telemetry layers (host)

### Stubs (`5626a34bf`)

The two `VerifiedCopy` tasks (registered, not yet packaged, copying nothing), `YunetModel`, `AssetModelSource`, `verifiedBytes()` without a check, `OrtAccess`, `OrtPlatform`, `OrtEnvironments` without the variable, the detection or the telemetry call, `OrtFaceDetector` returning empty outputs. The public factory still returned Stage 1a's stand-in. YuNet's MIT licence was copied by command from OpenCV Zoo at the pinned commit:

```
$ curl -fsSL https://raw.githubusercontent.com/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/LICENSE -o licenses/yunet/LICENSE.txt
$ sha256sum licenses/yunet/LICENSE.txt
c83b8120c50ccbd4c4f96edf53141bdd566ebb8f8e9227e415326aa1b1aba958
```

### RED (`a7344ffb7`)

```
$ ./gradlew --no-daemon :openverify-face:testDebugUnitTest          (57 s, load 1.6)
51 tests completed, 25 failed
BUILD FAILED
```

Each failed for the reason it tests. A sample, from the result XML:

```
YunetModelTest
  the build packaged the fetched model as the artifact's asset ...   FileNotFoundException: openverify-face/face_detection_yunet_2026may.onnx
  the notices the artifact must carry are packaged beside the model   FileNotFoundException: openverify-face/NOTICE
  bytes with another digest are refused ...                           expected IllegalStateException to be thrown, but nothing was thrown
  a source that cannot be read is refused ...                         expected IllegalStateException but was java.io.IOException
OrtEnvironmentsTest (8 of 8)
  the telemetry variable is set before the first environment ...      expected:<[setVariable ORT_DISABLE_TELEMETRY=1, createEnvironment]> but was:<[existingEnvironment]>
  telemetry is switched off before every session, on two threads      expected:<[disableTelemetry, createSession threads=2, ...]> but was:<[createSession threads=1, ...]>
  bytes that are not a model are refused ...                          expected IllegalStateException but was ai.onnxruntime.OrtException
  a native library that is not in the app is an exception ...         expected:<[... native library did not load]> but was:<[not asked for]>
OrtFaceDetectorTest (9 of 10)
  the drawn face gives the raw outputs ...                            values of cls_8 expected:<320> but was:<0>
  nothing of a frame is left in the detector ...                      AssertionError
  the native buffers are reused while the frame size stays the same   expected not same
  a model with another digest never reaches ONNX Runtime              expected IllegalStateException but was ai.onnxruntime.OrtException
OpenVerifyFaceTest
  the factory makes a detector over the packaged model ...            IllegalStateException: openverify-face: the detector is not built yet
FaceFrameInferenceTest
  the fixture frame gives the server runtime's boxes ...              ArrayIndexOutOfBoundsException: Index 0 out of bounds for length 0
```

Passing at RED, and why: `MergedManifestTest` (7) and `OrtTelemetryClassesTest` (2) test what Stage 1a already built (the manifest's remove marker) and what the AAR holds; `MergedManifestTest` carries its own control ("without this module ONNX Runtime's telemetry provider reaches the app"). `ReferenceDecoderTest` (3) tests the tests' own decoder against committed vectors.

### GREEN (`fc6700c16`)

```
$ ./gradlew --no-daemon :openverify-face:testDebugUnitTest :openverify-sdk:testAndroidHostTest \
    --tests 'dev.openverify.sdk.privacy.*' --tests 'dev.openverify.sdk.signals.NeverReadTest'   (61 s, load 2.7)
BUILD SUCCESSFUL
openverify-face: 51 tests, 0 skipped, 0 failures, 0 errors
openverify-sdk privacy and NeverRead: 115 tests, 0 failures     (ExceptionCanaryTest holds the 12 rows of exception-rows.txt)
```

The copy task's refusals (it never reaches the network; run with `--offline`):

```
$ ./gradlew --no-daemon --offline :openverify-face:copyYunetModel -PopenverifyModelsDir=<an empty directory>
> face_detection_yunet_2026may.onnx is absent. Fetch it first, from the repository root: python3 -I scripts/fetch_models.py --only face_detection_yunet
$ ./gradlew --no-daemon --offline :openverify-face:copyYunetModel -PopenverifyModelsDir=<a directory with other bytes under that name>
> face_detection_yunet_2026may.onnx does not have its pinned SHA-256. Fetch it again, from the repository root: python3 -I scripts/fetch_models.py --only face_detection_yunet
$ ./gradlew --no-daemon --offline :openverify-face:copyYunetModel :openverify-face:copyFaceFixture
BUILD SUCCESSFUL
```

### Coverage, and why there is no Kover exclusion

Contracts-10e reserved one exclusion line for "the ONNX Runtime session glue, which needs the native library". It is not used: the host tests run the glue on the JVM build of the same ONNX Runtime version (`com.microsoft.onnxruntime:onnxruntime` 1.31.0, test scope), under Robolectric.

```
$ ./gradlew --no-daemon :openverify-face:koverVerify :openverify-face:checkKotlinAbi :openverify-face:koverXmlReport   (30 s)
BUILD SUCCESSFUL
line coverage: 133 of 137 (97.1%); the 4 missed lines are OrtFaceDetector's two OrtException handlers (inference, input tensor) and the close handler
```

`api/openverify-face.api` is unchanged: the one public member is `OpenVerifyFace.detectorFactory(Context): FaceDetectorFactory`.

### What the measurements were

Largest differences from the committed numbers, printed by the tests themselves (sizes of differences only):

| Run | Raw outputs on the drawn face | Box and landmarks on the fixture frame | Score | Yaw ratio |
|---|---|---|---|---|
| Host JVM, ONNX Runtime 1.31.0 for x86-64, Java's JPEG decoder | 0.0000050 | 0.00042 px | 0.00000035 | 0.00000003 |
| Pixel 9, ONNX Runtime's Android library for arm64-v8a, the platform's JPEG decoder | 0.0000056 | 0.00042 px | 0.00000035 | 0.00000017 |

So the tolerances first written (1.5 px, 0.02, 0.03; raw 0.002) were far wider than anything seen. They were tightened in `958714cf3` to 0.25 px, 0.005 and 0.005, and 0.0001 for raw outputs: provisional, with this table as their basis. C204.1's 1e-9 does not apply across runtimes: that tolerance compares two decoders on identical float inputs, and here the inputs come from different JPEG decoders and different builds of ONNX Runtime.

## 4. The merged manifest (C205.2, fourth layer, host)

`MergedManifestTest` (7 cases) runs the Android Gradle plugin's own manifest merger (`manifest-merger` 32.4.1, test scope) as an app build does, over a host app, this module's manifest as its AAR carries it (AGP's processed copy, passed by the build), ONNX Runtime's manifest as the build resolved it, and a fake library that declares `ACCESS_NETWORK_STATE`.

What it found while being written, each now a case:

- **The control.** Without this module the provider `ai.onnxruntime.TelemetryInitializer` reaches the app.
- **With this module** the provider is gone and no marker is left as a declaration.
- **This module takes no permission away**: the fake library keeps `ACCESS_NETWORK_STATE`; ONNX Runtime's own request for it arrives too, unless the host removes it, and then only `INTERNET` arrives.
- **New: a library's remove marker reaches only manifests merged after it.** A host that itself depends on ONNX Runtime, ahead of this module, has ONNX Runtime's manifest merged first, and the provider stays (`expected:<[]> but was:<[ai.onnxruntime.TelemetryInitializer]>` on the first run). The host's own marker removes it. The README says so.
- **The demo's manifests** with `face` (its main manifest, its `src/face` overlay, the SDK's manifest, this module's, ONNX Runtime's) hold no telemetry provider, no `ACCESS_NETWORK_STATE` and no permission outside `manifest-allowlist/sdk-face.json`. The built app's whole manifest is held to that allowlist by `:demo-app`'s own `MergedManifestTest` (gate call 11, `sdk,face` and `sdk,nfc,face`: exit 0).

Two things the merger needed, both in the build file as test configuration:

- **Guava's JRE flavour.** The merger holds a Guava supplier as a `java.util.function.Supplier`; an Android module's classpaths resolve Guava's Android flavour, whose supplier is not one (`IncompatibleClassChangeError` at `XmlNode.getOriginalId`). A component metadata rule gives Guava's Android variants the JRE jar of the same version. The locked module and version do not change, and that jar was already in `verification-metadata.xml`. Guava is on this module's unit-test classpaths only.
- **The merger's logger type** (`com.android.utils.ILogger`) is in a library the merger brings at run time only, so the test reaches `newMerger` by reflection. No dependency was added.

## 5. The consumer rule (C215.1), on the minified demo

`consumer-rules.pro` holds one rule: `-keep class ai.onnxruntime.** { *; }`. ONNX Runtime's own AAR keeps only its telemetry classes.

With the rule (`-PopenverifyDemoArtifacts=sdk,face :demo-app:assembleRelease`, 256 s, exit 0), from `demo-app/build/outputs/mapping/release/mapping.txt`:

```
88 classes of ai.onnxruntime, each under its own name, among them
ai.onnxruntime.OrtException -> ai.onnxruntime.OrtException:
ai.onnxruntime.TensorInfo -> ai.onnxruntime.TensorInfo:
dev.openverify.face.OrtFaceDetector -> x03:        (this module's own classes are renamed: nothing keeps them)
```

The control, the same build with the rule taken out of the file and put back afterwards (139 s, exit 0):

```
32 classes of ai.onnxruntime left, 21 under their own names
ai.onnxruntime.OrtException -> a13:
ai.onnxruntime.TensorInfo, OnnxMap, OnnxSequence, MapInfo: not in the mapping (removed)
```

The native library creates `TensorInfo` and throws `OrtException` by name, so without the rule the first inference in a minified app would fail. This is R8's output only: **the minified demo was not run with the detector on a device.**

The smoke build still holds with face: `-PopenverifyDemoArtifacts=sdk,face :demo-app:assembleMinifiedSmokeAndroidTest` ran `traceSmokeTestKeepRules` and `checkSmokeTestReferences` and exited 0 (251 s).

## 6. The device tests

Four tests in two classes, `:openverify-face:connectedDebugAndroidTest`, results under `android/openverify-face/build/outputs/androidTest-results/connected/debug/`.

| Class | Method | Host twin |
|---|---|---|
| `YunetInferenceDeviceTest` | `theFixtureFrameGivesTheServerRuntimesBoxesLandmarksAndYawRatio` | `FaceFrameInferenceTest` |
| `YunetInferenceDeviceTest` | `theDrawnFaceGivesTheRawOutputsTheVisionRuntimeRecordedEachUnderItsName` | `OrtFaceDetectorTest` (raw outputs, names, shapes) |
| `OrtTelemetryDeviceTest` | `noTelemetryClassIsLoadedAndNoFileAppearsWhenTheDetectorRunsAndAgainAfterARestart` | `OrtEnvironmentsTest`, `OrtTelemetryClassesTest`, `MergedManifestTest` |
| `OrtTelemetryDeviceTest` | `noBytesAreCountedBeyondTheRunnersOwnFromBeforeTheFirstEnvironmentThroughAQuietPeriodAndAgainAfterARestart` | none for the byte count: only a device counts bytes |

The inference itself has a host twin (the JVM build of ONNX Runtime, the same reference tensor and decoder from `src/sharedTest`). The SDK's own `AnalysisFrame`, `YunetTensor` and `YunetDecoder` are internal to the SDK, so the tests carry a reference copy of that path, held to committed vectors by `ReferenceDecoderTest`.

### The run on the phone

A Pixel 9 (Android 17), at commit `4c7cf5129`, one foreground call under the device lock. Gradle's exit was failed, as on every wireless serial (KP10-31); the result is the instrumentation's XML:

```
<testsuites tests="4" failures="1" errors="0" skipped="0" ...>
theFixtureFrameGivesTheServerRuntimesBoxesLandmarksAndYawRatio                          passed (0.380 s)
theDrawnFaceGivesTheRawOutputsTheVisionRuntimeRecordedEachUnderItsName                  passed (0.361 s)
noTelemetryClassIsLoadedAndNoFileAppearsWhenTheDetectorRunsAndAgainAfterARestart        passed (9.350 s)
noBytesAreCountedBeyondTheRunnersOwn...AndAgainAfterARestart                            FAILED (30.818 s)
  java.lang.AssertionError: at the start: the device is dozing, which restricts the network (unlock it or put it on charge)
```

Our tag's lines from that run's logcat:

```
drawn face: largest raw difference from the vision runtime: 5.6349182129267206E-6
fixture frame: largest differences from the server runtime: pixels=4.2124176025026827E-4 score=3.531718125726613E-7 yaw-ratio=1.7123219414605373E-7
```

**The byte count was not taken.** The phone was locked, on battery and in deep doze (`mState=IDLE`, `mScreenLocked=true`, `mCharging=false`, read once from `dumpsys deviceidle`, state lines only). A dozing phone restricts the network, so a count of zero would prove nothing, and the test refuses to measure. Its screen-on activity does wake the screen (`isInteractive` held), but this phone stays in doze until it is unlocked, which no agent does. Nothing was changed on the phone to get past this.

How the test came to check that, in order, because each step was a real failure on the phone:

1. First run: `first process: ONNX Runtime was loaded before the measurement began`. The probe asked the class loader with `findLoadedClass`, and on Android that call loads the class it is asked about (every telemetry class then read as "loaded"). The probe now reads the loaded classes from the process's own heap dump (`Debug.dumpHprofData`, `LOAD CLASS` records), written to the code cache and deleted at once.
2. Second run: the 120-second quiet period took 7 minutes 51 seconds and the call ran past its 10 minutes (it finished on its own; nothing was killed). `SystemClock.sleep` counts a clock that stops while the processor sleeps. The quiet period is now timed on the real-time clock and asserted to be 120 to 125 seconds, the screen is kept on, and the device is asserted awake and not dozing at each end.
3. Third and fourth runs: `the device is dozing`. The windows of runs 1 and 2 had read "0 B received, 0 B sent", and those numbers are void for the same reason. They are quoted nowhere as a result.

So, per rule 26's three parts, for the byte count: (a) the host tests of what it rests on are green (`OrtEnvironmentsTest`, `MergedManifestTest`, `OrtTelemetryClassesTest`); (b) the device test is written, compiled and lint-checked, with its 120 s never shortened; (c) it did not pass on the phone: a "device proof open" line.

## 7. C204.8 and C213.3 for this module

- `OrtFaceDetectorTest`: "nothing of a frame is left in the detector once detect has returned" (the native input and twelve output buffers are zero; the test first shows the outputs did hold a face) and "the arrays handed back are new for each frame and the detector keeps none of them".
- The module logs only through `FaceLog`, with constant codes: `face.model_unreadable`, `face.model_digest_mismatch`, `face.ort_environment_failed`, `face.ort_environment_host_created`, `face.ort_library_unavailable`, `face.ort_session_failed`, `face.inference_failed`, `face.session_close_failed`. The SDK's `LogScanTest` holds every call to a string literal.
- Every exception the module creates has a fixed message and no cause: 12 rows in `src/test/resources/privacy/exception-rows.txt`, held by the SDK's `ExceptionCanaryTest`. A failure of ONNX Runtime (`OrtException`) and a native library that did not load (`LinkageError`) both become an `IllegalStateException` with a fixed message, so the SDK's selfie screen falls back to the shutter instead of the app crashing.

## 8. The final gate (rule 17's eleven calls, in order, in one session)

Tree at `4c7cf5129` plus this file. Load is `/proc/loadavg`'s first figure as each call began; no call waited for the Gradle lock.

| Call | What | Exit | Time | Load | Result |
|---|---|---|---|---|---|
| 1 | SDK host tests, `ui` | **1** | 144 s, again 261 s | 7.6, 4.3 | 522 tests, 1 failed: `A11yTimingTest` (below) |
| 1 | `flow` | 0 | 208 s | 2.9 | 416 |
| 1 | `rest` | 0 | 114 s | 6.4 | 1,752 |
| 2 | screenshots, verify | 0 | 112 s | 3.1 | |
| 3 | `koverVerify checkKotlinAbi` | **1** | 262 s | 2.7 | the same one test; with `--continue` every other task passed, `:openverify-face:koverVerify` and `:openverify-face:checkKotlinAbi` among them |
| 4 | `testDebugUnitTest assembleDebug` | 0 | 65 s | 3.2 | face 51, nfc 111, demo 88 and 8 |
| 5 | release APK, bundle, both AARs | 0 | 40 s | 3.4 | |
| 6 | `:openverify-sdk:assemble` | 0 | 31 s | 4.5 | |
| 7 | `lint` | 0 | 96 s | 3.8 | |
| 8 | device-test compile, four modules | 0 | 51 s | 4.8 | |
| 9 | the scripts' own tests | **1** | 2 s | | 89 tests, 1 failed: `test_openverify_face_ships_no_rule_of_its_own_yet` (below) |
| 9 | `check-elf-alignment.py`, `check-consumer-rules.py`, `check-size.py` | 0, 0, 0 | | | "openverify-face-release.aar ships 1 consumer rule(s), as committed" |
| 10 | staged repository; consumer check | 0, 0 | 57 s, 308 s | 4.1, 5.0 | |
| 11 | demo `sdk,nfc`; `sdk,face`; `sdk,nfc,face` | 0, 0, 0 | 158, 116, 185 s | 7.9, 3.6, 3.1 | 96 and 9 in each (nfc-reader's tests included) |

Also: `(cd services/vision && uv run pytest tests/test_android_yunet_vectors.py --no-cov && uv run ruff check && uv run ruff format --check)` exit 0 (4 passed; `mypy src tools` clean); `pnpm format:check` exit 0 (192 s).

**The two failures, neither in this module's code:**

- **`A11yTimingTest`, "every duration in the shipped sources is one the accessibility page classifies"** (SDK host tests, `ui`; so also call 3). The durations it does not know are all in `openverify-nfc` (`JmrtdChipSession.kt`: `EXCHANGE_TIMEOUT_MS`; `NfcChipReader.kt`: two `withTimeoutOrNull`, `5.minutes`, `1.minutes`). `openverify-face` holds no duration. Re-run after 30 minutes: the same. Owner: nfc-reader's sources; the test and `docs/android/accessibility.md` are integration-10e's to extend.
- **`test_openverify_face_ships_no_rule_of_its_own_yet`** (`android/scripts/tests/test_check_consumer_rules.py`, a shared file this agent may not edit). It pins this module's consumer rules to none "yet"; the deliverable (C215.1) and section 5 above require the rule. The test's replacement is in the report's contractDeviations, for integration-10e.
