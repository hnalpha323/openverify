# Phase 10, Workflow 10B Stage 2: pdf417-guidance

C203 (PDF417 guidance, behaviour M26; reviews F11, F19, H21), built beside capture-pipeline, document-guidance, selfie-guidance, device-integrity-android, api-integrity and foundation-10b on contracts-10b's Stage 1a tree (`489e799d`). Every Gradle call ran as `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)` in the foreground; the working tree is shared, so a full host-test count includes the other agents' tests in it at that moment. Exit 75 is "lock busy" and was retried, never counted as a failure.

Pure logic is in `commonMain/.../capture/barcode/` with its suites in `commonTest` (run by `testAndroidHostTest` now, on the iOS simulator in the next release); the zxing-cpp bridge is in `androidMain/.../capture/barcode/`; tests that need the JVM (reflection, Robolectric, resource files) are in `androidHostTest/.../capture/barcode/`; the native glue is covered by one device test that runs only in CI.

## Slice 1: the hint (C203.3)

### Stub (`d15e6adf`)

`AamvaHeader.matches` answering false, `isBarcodeBearing` answering false, `BarcodeGuidance` reading nothing (`READ_INTERVAL_MS` and `FOUND_HOLD_MS` 0), `BarcodeGuidanceFactory` returning the document guidance.

### RED (`5f25b167`)

- `commonTest` `AamvaHeaderTest` (5): the AAMVA vectors of `contracts/fixtures/aamva/` through `readContractFixture`: every valid vector matches, an invalid one matches exactly when the server does not refuse it with `aamva_header_invalid`; version 01's 19-byte header; 15 refused prefixes; the bytes are not changed.
- `commonTest` `BarcodeBearingTest` (5): the `barcode_not_found` reason marks the back of a two-sided or back-only ID and the front of a front-only one; nothing without it; only a `government_id` side.
- `commonTest` `BarcodeGuidanceTest` (15) over a fake reader: found for an AAMVA header only; the returned array wiped before `onFrame` returns; the frame read inside its callback; at most one read per `READ_INTERVAL_MS` of camera time; an earlier timestamp read again; found held for `FOUND_HOLD_MS` and then dropped; a failing reader finds nothing while cancellation propagates; `run` never takes the photo and the shutter is primary; close closes the reader; the factory keeps the document guidance on other sides and with no reader (opening none), gives the hint alone without a document guidance, and beside one reads each frame before the document guidance sees it, passes the document guidance's `AutoCapture` and `shutterPrimary` through and closes both.
- `androidHostTest` `BarcodeBytesReachabilityTest` (3): no array the reader returned is reachable by reflection from the guidance, alone or beside a document guidance, after the callback; and a control that the walk finds a held array.

`:openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.capture.barcode.*'`: exit 1, `27 tests completed, 19 failed`, each for the stub's reason (`expected: <FOUND> but was: <SEARCHING>`, `the read rate is bounded`, `one missed read does not drop the hint`, `the reader was asked ==> expected: <2> but was: <0>`, `dl-636014-real-id` for the header, `Expected value to be true.` for the barcode side). An earlier attempt did not compile because of another agent's in-flight `flow/CaptureHooksTest.kt` (`No parameter with name 'selfieExtension'`); it was re-run after that agent's commit, never edited.

### GREEN (`5aa37a07`)

- `AamvaHeader.kt`: the server's `readHeader` (`packages/checks/src/aamva.ts`) over bytes: `@`, LF, RS, CR, `ANSI `, six IIN digits, the two-digit version, from version 02 the jurisdiction version, then a non-zero two-digit entry count.
- `BarcodeBearing.kt`: `BARCODE_NOT_FOUND` and `isBarcodeBearing(state)`.
- `BarcodeGuidance.kt`: `BarcodeHint`, `Pdf417Guidance` (`READ_INTERVAL_MS` 250, `FOUND_HOLD_MS` 1,500, `ANALYSIS_WIDTH_PX` 1,280, each provisional with its basis in KDoc), `BarcodeGuidance` (the bytes wiped with `fill(0)` in a `finally`, a reader exception logged as `barcode.read_failed`), `BarcodeGuidanceFactory` and the private `BarcodeBesideDocument`.
- The reachability test's first RED version walked into the test's own fake reader, which keeps what it returned on purpose, so it found the arrays there; the walk now skips that reader (a `skipping` argument with its own control case), in the same commit.

`… --tests 'dev.openverify.sdk.capture.barcode.*'`: exit 0, 28 tests.

## Slice 2: the zxing-cpp bridge (C203.2)

### Stub (`6d658539`) and RED (`327b34b9`)

`ZxingCppBarcodeReader` decoding nothing; `pdf417Options()` the library defaults; `firstPdf417` choosing none. `androidHostTest` `ZxingCppBarcodeReaderTest` (6, Robolectric): the options (PDF417 only, `PLAIN`, `tryRotate`, `tryDownscale`, `tryHarder`, no `tryInvert`, not pure, `LOCAL_AVERAGE`, one symbol, no errors returned); the first decoded PDF417's own array (skipping another format, an error and an empty result); `ErrorType.NONE` counts; none is null; Android's `platformBarcodeReader()` is the bridge; without the native library the reader decodes nothing and never throws.

`… --tests 'dev.openverify.sdk.capture.barcode.ZxingCppBarcodeReaderTest'`: exit 1, `6 tests completed, 4 failed` (`expected:<[PDF_417]> but was:<[]>`, `expected same:<[B@…> was not:<null>` twice, the platform reader).

### GREEN (`b8ec7542`)

`Pdf417Results.kt` (`pdf417Options`, `firstPdf417`), `ZxingCppBarcodeReader.kt` (one `ARGB_8888` bitmap per frame size, `copyPixelsFromBuffer` from the frame's RGBA bytes wrapped once per producer buffer, the read on `Dispatchers.Default` under a `Mutex`, the native library loaded on the first read and `barcode.reader_unavailable` logged once when it cannot load, `close()` releasing at once or after the read in progress), `BarcodeReader.android.kt` returning it. `kover-excludes/pdf417-guidance.txt` keeps foundation-10b's pattern `dev.openverify.sdk.capture.barcode.ZxingCppBarcodeReader*` (the comment rewritten by its owner).

`… --tests 'dev.openverify.sdk.capture.barcode.*'`: exit 0, 34 tests.

## Slice 3: the overlay and its words (C203.3, C199.1)

### Stub (`8b8370f7`)

`strings_pdf417.xml` in the five folders (`openverify_pdf417_guide` "Fit the barcode in the box", `openverify_pdf417_found` "Barcode found"; es, fr, de and ar drafted by this agent, machine-drafted), the two keys in `i18n/review-status.json` (the named borrowed edit, the file clean before it), `BarcodeTags`, an overlay drawing nothing.

### RED (`a6c6d9e5`)

`BarcodeOverlayTest` (4, Robolectric): the guide and the hint in a polite live region, searching and found; the Arabic text with a right-to-left layout; the guidance's own `Overlay` following its hint after a frame. `BarcodeWordsTest` (2): every locale has the two hints, and none says read, valid, verified or accepted in its language (review H21). `… --tests 'dev.openverify.sdk.capture.barcode.Barcode*'`: exit 1, `28 tests completed, 4 failed` (`The component with TestTag = 'openverify:barcode-guide' is not displayed!`, `Expected exactly '1'` node with the text); the two words tests pass on the stub's strings.

### GREEN (`119687d1`)

`BarcodeOverlay.kt`: a 3.5:1 outline (the synthetic symbol's 950 x 269) centred in the card guide, white while searching and the theme's primary when found, and the hint above it on a dark chip, `liveRegion = Polite`. `… --tests 'dev.openverify.sdk.capture.barcode.*'`: exit 0.

### Goldens (`6fd9ee4c`)

`BarcodeScreenshotTest`: `barcode-guide-searching`, `barcode-guide-found` (English, light, font scale 1.0) and `barcode-guide-found-ar-dark` (Arabic, dark, font scale 2.0), over a plain grey stand-in for the preview (synthetic, no document or face), recorded only by `:openverify-sdk:screenshotTest -Proborazzi.test.record=true --tests 'dev.openverify.sdk.capture.barcode.BarcodeScreenshotTest'` (exit 0), each image read before the commit. Three goldens, 29,324 bytes.

## Slice 4: the committed images and the host calibration (C203, C219.5; reviews F11, F19)

### RED (`b21b0180`)

`services/vision/tests/test_android_pdf417_assets.py` (7): the images under `android/openverify-sdk/src/androidDeviceTest/resources/capture/barcode/` equal `synthetic_aamva.py`'s `render_barcode` pixel for pixel at full size and box-downscaled to 640 px; the folder holds those and `index.json` only; the index equals what the vectors give; each image is under 8 KB; the vision environment's zxing-cpp is the AAR's version (`libs.versions.toml` `zxingCpp`); each image decodes to its exact payload with the Android reader's options; the calibration. It writes only under `UPDATE_CONTRACT_FIXTURES=1`. `uv run ruff check`, `ruff format --check` and `mypy` on the file: clean.

`uv run pytest tests/test_android_pdf417_assets.py --no-cov`: `5 failed, 2 passed` (`dl-636014-real-id-full.png is missing: run with UPDATE_CONTRACT_FIXTURES=1`; the calibration and the version check pass, since they read no committed image).

### GREEN (`cf13e9e0`)

`UPDATE_CONTRACT_FIXTURES=1 uv run pytest tests/test_android_pdf417_assets.py --no-cov`: 7 passed; the plain run: 7 passed. Six PNGs (3,540 to 5,019 bytes, 25,632 in all) and `index.json` (2,112 bytes).

### The host calibration (zxing-cpp 3.1.1, pdf417gen 0.8.1, Pillow 13.0.0)

The four valid AAMVA vectors, rendered by the generator (290 modules plus a 40 px quiet zone each side, 3 px a module, 950 px), downscaled box and bilinear, read with the Android options:

| Width (px) | 950 | 896 | 832 | 768 | 704 | 640 | 576 | 544 | 512 | 480 | 448 | 416 | 384 | 352 | 320 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Pixels a module | 3.00 | 2.83 | 2.63 | 2.43 | 2.22 | 2.02 | 1.82 | 1.72 | 1.62 | 1.52 | 1.41 | 1.31 | 1.21 | 1.11 | 1.01 |
| All decode, both resamplings | yes | yes | yes | yes | yes | yes | yes | yes | yes | no | no | no | no | no | no |

The narrowest reliable width is 512 px, 1.62 pixels a module (480 decodes after bilinear scaling only; 320 decoded in an earlier probe by aliasing luck, never at 448 to 352). So at C201.2's document analysis width (640 px) the symbol must span 80% of the frame's width, a card held very close; at C201.2's 1,280 px for a barcode-bearing side, 40%, which a card filling its guide gives. Synthetic barcode-only renders only: nothing about real camera frames, lenses, focus, motion blur or lighting. The read therefore stays a hint and never gates the auto-capture in 10B; the switch to a gate waits for the CI device test to confirm the host result on the emulator (review F11).

## Slice 5: the device test (C219.5)

`androidDeviceTest/.../capture/barcode/ZxingCppBarcodeReaderDeviceTest.kt` (4): the index lists each vector at full size and at 640 px; zxing-cpp decodes every image, through `ZxingCppBarcodeReader` and an RGBA_8888 `AnalysisFrame`, to the payload's SHA-256, with the header judged as the index says; a 640 px frame delivered at rotation 90, 180 and 270; the guidance says found for the AAMVA images only. It runs only on CI's emulator; every assertion about SDK logic has its host twin.

`:openverify-sdk:assembleAndroidDeviceTest`: exit 0 (lock wait 183 s, load 3.27). The test APK `openverify-sdk-androidTest.apk` holds `capture/barcode/*.png` and `index.json` as Java resources and `lib/{arm64-v8a,armeabi-v7a,x86,x86_64}/libzxingcpp_android.so` (`unzip -l`), so the test reads its images through the class loader on the emulator. Committed as `6eef2fac`.

## Kover

`kover-excludes/pdf417-guidance.txt`: `dev.openverify.sdk.capture.barcode.ZxingCppBarcodeReader*`, because zxing-cpp's constructor loads `libzxingcpp_android.so`, which exists only on a device; the device test covers it, and its options and result choice (`Pdf417Results.kt`) are host-tested. A filtered run (`testAndroidHostTest --tests 'dev.openverify.sdk.capture.barcode.*' koverXmlReport`, exit 0, lock wait 168 s) gives the package 79 of 84 lines (94.0%): every class at 100% but `BarcodeOverlayKt`'s 5 lines outside its `@Composable` body.

## Final gates (rule 24: this agent gates what it touched)

Each Android call is `(cd android && flock -E 75 -w 240 /tmp/openverify-gradle.lock ./gradlew --no-daemon <tasks>)`; "wait" is the lock wait, "total" the whole call, load is `/proc/loadavg` before and after.

| Call | Result | Total | Wait | Load |
|---|---|---|---|---|
| (a) `:openverify-sdk:testAndroidHostTest` | exit 1 at `de9bed70`: 2,312 tests, 0 skipped, 2 failed, none in this area: `OpenVerifyInquiryActivityComponentsTest` "in a sandbox the installed outcome rides on the signals body" and "in production it is never sent, and the body still is" (`no signals call`, 5.2 and 5.7 s). Same in three runs over 50 minutes and with the class alone. device-integrity-android's TDD file (its gate) gives the cause: `collect` now reads on `Dispatchers.IO` while the test blocks Robolectric's paused main looper in `takeRequest`; it fixed its own twin test and left this shared 10A file to integration-10b as a contractDeviation. Earlier attempts: exit 75 twice (lock busy 240 s). | 208 s | 41 s | 8.80, 10.92 |
| (b) `:openverify-sdk:screenshotTest -Proborazzi.test.verify=true` | exit 0: 60 tests, 0 failed (this area's 3). An earlier run (exit 1) failed only selfie-guidance's 6 goldens before its record commit `718c4bb8`. | 141 s | 129 s | 13.56, 9.77 |
| (c) `koverVerify checkKotlinAbi` | exit 1 twice: its host-test run failed on the same two `OpenVerifyInquiryActivityComponentsTest` cases, so the line gate did not run. `checkKotlinAbi` alone: exit 0 (80 s, wait 42 s, load 12.59); every declaration of this area is internal, so the dumps are unchanged. | 190 s | 41 s | 11.91, 4.13 |
| (d1) `testDebugUnitTest assembleDebug` | exit 0 | 238 s | 227 s | 4.05, 5.13 |
| (d2) `:demo-app:assembleRelease :demo-app:bundleRelease` | exit 0 | 201 s | 190 s | 5.12, 4.56 |
| (e1) `:openverify-sdk:assemble` (the AAR, the iOS klibs, `checkDependencyBoundary`) | exit 0 | 89 s | 75 s | 4.60, 5.93 |
| (e2) `lint` | exit 0 (two earlier attempts exit 75) | 79 s | 58 s | 13.70, 15.98 |
| (f) `:openverify-sdk:assembleAndroidDeviceTest :demo-app:assembleAndroidTest` | exit 0 (two earlier attempts exit 75) | 40 s | 26 s | 14.29, 12.33 |
| `pnpm format:check` | exit 0 | 210 s | | |
| `(cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest)` | exit 0: ruff clean, 203 files formatted, mypy 80 files clean, 2,624 passed, coverage 97.41% | 896 s | | 8.32 |

SDK host tests: 1,960 at contracts-10b's close (`489e799d`); 2,312 in the shared tree at `de9bed70` (every Stage 2 agent's); this area adds 39 (`AamvaHeaderTest` 5, `BarcodeBearingTest` 5, `BarcodeGuidanceTest` 14, `BarcodeBytesReachabilityTest` 3, `ZxingCppBarcodeReaderTest` 6, `BarcodeOverlayTest` 4, `BarcodeWordsTest` 2), 3 screenshot tests and 4 device tests.
