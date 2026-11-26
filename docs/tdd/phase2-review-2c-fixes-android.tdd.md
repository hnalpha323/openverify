# TDD evidence: Workflow 2D review fixes (Android)

- **Slice owner:** Android fixer (Workflow 2D, fix stage).
- **Date:** 2026-10-20.
- **Paths owned:** `android/`, `THIRD_PARTY_LICENSES.md`, this file.
- **Input:** the Workflow 2D review of the Workflow 2C Android SDK and demo changes (`70369f2..5625a96`). There were no blocking findings. There was one MEDIUM finding, F017.
- **Dependencies:** none added, so `THIRD_PARTY_LICENSES.md` is unchanged.

Each fix follows the same cycle:
1. Write a regression test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

All commands ran from `android/` after `source ../scripts/env.sh`. The output is trimmed to the lines that matter. The failure messages come from `openverify-sdk/build/test-results/testDebugUnitTest/TEST-dev.openverify.sdk.camera.PickedPhotosTest.xml`.

## F017: a picked photo could exhaust memory and crash the host app

**Confirmed** by reading `android/openverify-sdk/src/main/kotlin/dev/openverify/sdk/camera/PickedPhotos.kt` and `ui/PhotoPicker.kt` at `5625a96`:

- **Sampling.** `toUpload` doubled `inSampleSize` while `longest / (sample * 2) >= 2 * MAX_DIMENSION` (4096). Its decoded bitmap therefore kept a longest side of 4096 to 8191 pixels:
  - an 8191 x 8191 image decoded in full, about 268 MB of ARGB_8888;
  - a 16000 x 16000 image decoded at 8000 x 8000, about 256 MB.
- **Pixel count.** Nothing limited the pixels a file declares. A highly compressible PNG far under the 25 MiB file cap can declare hundreds of megapixels.
- **No catch.** Nothing caught failures. `SystemPhotoPicker` ran `read` and `toUpload` in `scope.launch { withContext(Dispatchers.IO) { ... } }` with no `try`. An `OutOfMemoryError`, or any runtime exception from the provider, the decoder or the encoder, was therefore uncaught and ended the host app's process. The camera path already guards this in `takePictureOrNull`.
- **Encoder exception (found while writing the tests).** A 1 x 5000 image decoded at sample 1 and was scaled by 2048 / 5000. `Bitmap.createBitmap` then rounded its width to 0 and threw `IllegalArgumentException: width and height must be > 0` out of `toUpload`.

**Fix.**
1. `PickedPhotos.sampleSize(width, height)` picks the largest power of two that keeps the longest decoded side at `MAX_DIMENSION` (2048) or more. The decoded bitmap is therefore at most 4095 pixels on its longest side, about 67 MB at worst, the same order as a camera frame. The scale the encoder then applies is above 0.5, so a side of 1 pixel never rounds to 0.
2. `PickedPhotos.MAX_SOURCE_PIXELS = 40_000_000`. A larger image is refused from its header, before any pixel is decoded. The value matches the vision service's default `MAX_IMAGE_PIXELS` (`services/vision/README.md`). It bounds the decoder's working memory, such as interlaced-PNG and progressive-JPEG buffers, and its time, whatever the sampling.
3. `PickedPhotos.load(open)` is the picker's background work (`read`, then `toUpload`). It catches `Exception` and `OutOfMemoryError` and returns `null`, as `takePictureOrNull` does. `null` makes `CaptureScreen` set `uploadFailed`, so the user sees that the photo could not be used. `load` does not suspend, so no coroutine cancellation passes through it, and it rethrows nothing. `SystemPhotoPicker` calls `load` inside its `withContext(Dispatchers.IO)`.

### Preparatory refactor (behaviour unchanged)

Two pieces were named so the regression tests fail at run time for the intended reason rather than at compile time:
- `sampleSize(width, height)` holds the old sampling loop, unchanged;
- `load(open)` is `read(open = open)?.let(::toUpload)`, which `SystemPhotoPicker` already did inline.

```text
$ ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.camera.*' --tests 'dev.openverify.sdk.ui.*'
BUILD SUCCESSFUL in 1m
```

Commit `270744e`.

### Cycle 1: sampling, pixel count, thin image

New tests in `PickedPhotosTest`:
- `a picked photo is decoded with its longest side from the upload size to under twice it (2D F017)`. Checks sample sizes 1, 1, 2, 2 and 4 for 60 x 40, 4095 x 10, 4096 x 10, 8191 x 4883 and 16000 x 16000. For longest sides from 2048 to 100000, the sample is a power of two, the longest side divided by it is in [2048, 4096), and orientation does not matter.
- `a photo of more than 40 megapixels is refused, however small its file (2D F017)`. The test writes the PNG by hand: a few kilobytes that declare 8000 x 5001 pixels. It is refused. 8000 x 5000 is accepted and uploads at 2048 x 1280.
- `a long, thin photo is used, not lost to an error in the encoder (2D F017)`. A 1 x 5000 PNG uploads at 1 x 2048.

RED:

```text
$ ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.camera.PickedPhotosTest'
PickedPhotosTest > a picked photo is decoded with its longest side from the upload size to under twice it (2D F017) FAILED
    java.lang.AssertionError: expected:<2> but was:<1>            (4096 x 10 still decoded in full)
PickedPhotosTest > a long, thin photo is used, not lost to an error in the encoder (2D F017) FAILED
    java.lang.IllegalArgumentException: width and height must be > 0
PickedPhotosTest > a photo of more than 40 megapixels is refused, however small its file (2D F017) FAILED
    java.lang.AssertionError: expected null, but was:<CapturedImage(image/jpeg, 16115 bytes)>
8 tests completed, 3 failed
BUILD FAILED in 31s
```

Commit `c3f2488`.

GREEN: the new sampling rule and `MAX_SOURCE_PIXELS`.

```text
$ ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.camera.PickedPhotosTest'
BUILD SUCCESSFUL in 24s
tests="8" skipped="0" failures="0" errors="0"
```

Commit `7d94564`. The existing `a large photo is scaled down like a camera frame` test still passes: 4200 x 1000 now decodes at sample 2 and still uploads at 2048 on its longest side.

### Cycle 2: no crash when loading fails

New tests in `PickedPhotosTest`:
- `a picked file is loaded as an upload`. This pins `load`'s normal path: a PNG gives a JPEG upload, and no stream gives `null`. It passed before the fix.
- `running out of memory while loading a picked photo gives no photo, not a crash (2D F017)`. The stream throws `OutOfMemoryError`.
- `any other failure while loading a picked photo gives no photo, not a crash (2D F017)`. The provider throws `IllegalStateException`.

RED:

```text
$ ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.camera.PickedPhotosTest'
PickedPhotosTest > any other failure while loading a picked photo gives no photo, not a crash (2D F017) FAILED
    java.lang.IllegalStateException: the provider failed
PickedPhotosTest > running out of memory while loading a picked photo gives no photo, not a crash (2D F017) FAILED
    java.lang.OutOfMemoryError: Failed to allocate a 268435456 byte allocation
11 tests completed, 2 failed
BUILD FAILED in 24s
```

Commit `9694aa6`.

GREEN: `load` catches `Exception` and `OutOfMemoryError` and returns `null`.

```text
$ ./gradlew --no-daemon :openverify-sdk:testDebugUnitTest --tests 'dev.openverify.sdk.camera.PickedPhotosTest'
BUILD SUCCESSFUL in 27s
tests="11" skipped="0" failures="0" errors="0"
```

Commit `00d05f6`.

Refactor: none needed.

## Final validation

The fixer's own run of the full gate was cut off when the workflow's fix stage ended, so the orchestrator re-ran it on `main` at `3508409` (every fix commit above included), with `--rerun-tasks` so nothing came from the build cache:

```text
$ ./gradlew --no-daemon --rerun-tasks testDebugUnitTest koverVerify assembleDebug lint
> Task :openverify-sdk:koverVerify
BUILD SUCCESSFUL in 2m 34s
162 actionable tasks: 162 executed
```

- **Unit tests:** `openverify-sdk` 428 and `demo-app` 18, with no failures, errors or skips.
- **Coverage:** `koverVerify` passed, so the 80% line gate holds.
- **Build and lint:** `assembleDebug` and `lint` passed.
