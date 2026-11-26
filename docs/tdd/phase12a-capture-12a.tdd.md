# Phase 12A, Workflow 12A Stage 2: capture-12a (TDD evidence)

Agent: `capture-12a` (Workflow 12A Stage 2, in parallel with vision-12a and checks-12a). Base `b7a249af1` (the contracts-12a commit on `4ea2493bf`). Host: WSL2, every command after `source scripts/env.sh`; the full flow suite and every Gradle run under `flock /tmp/openverify-heavy.lock`.

Nothing was pushed or dispatched. The docker project `openverify-test` was not touched. No real photo and no OCR text from the live stack was read: the calibration images are the generator's synthetic, specimen-marked Quebec-format captures, written to a scratch directory and never committed.

## Scope (plan §4.1)

| # | What changed | Where |
|---|---|---|
| F1 | A document camera asks for `ideal` 4096 x 3072, then `applyConstraints` to the track's `getCapabilities()` maximum. The photo is `ImageCapture.takePhoto()`'s still where the browser has one, else the video frame. A face camera is unchanged (1920 x 1080, `captureFrame`) | `apps/flow/src/lib/document-photo.ts`, `components/camera-capture.tsx`, `flow/flow-environment.tsx` (`captureDocument`) |
| F2 | Every camera document photo is drawn into a canvas (the still decoded with `createImageBitmap(..., { imageOrientation: 'from-image' })`), long side at most 4096, JPEG 0.92; over `MAX_UPLOAD_BYTES` it is encoded again at 0.85, then 0.8x smaller up to four times, else a capture error. `stripJpegMetadata` cuts APP1 (EXIF, XMP), APP3-APP13, APP15 and COM from the bytes, keeping APP0, APP2 (ICC) and APP14 (Adobe colour transform) | `lib/document-photo.ts` |
| F3 | The guide region (85% of the preview's width, ID-1 shaped, mapped through `object-contain` onto the frame and then onto the still) is read back at most 1600 px wide and judged: too small under 800 px of upload width, blurry under a sharpness of 0.24. A problem opens the preview with a warning (`role="alert"`) and Retake only; from the third prompt for the same side "Use this photo anyway" is offered too. The count survives Cancel and is reset for the next side | `lib/photo-check.ts`, `components/capture-sequence.tsx`, `components/photo-preview.tsx` |
| F4 | On an ID's back the guide shows a dashed barcode band across its lower half and the hint "Make sure the barcode is sharp and inside the frame." | `components/camera-capture.tsx`, `steps/verification-capture-step.tsx` |
| i18n | `capture.barcodeHint` and `capture.photoCheck.{blurry, too-small, useAnyway}` in en (source) and fr, es, de, ar (machine-drafted, as the rest of those catalogs); the locale exports re-run | `apps/flow/src/i18n/locales/*.ts`, `contracts/fixtures/i18n/<locale>.json` (borrowed, written by `export-flow-locales.ts`; the consent texts and the catalog version are unchanged) |
| K1 | Android: the still is per preview. A document's (`AnalysisTarget` DOCUMENT or BARCODE) is `CAPTURE_MODE_MAXIMIZE_QUALITY` at the largest 4:3 size up to 4096 x 3072 (`FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER`); a selfie's keeps `CAPTURE_MODE_MINIMIZE_LATENCY` at 1920 x 1440. The analysis use case and `AnalysisSizes` are unchanged | `android/openverify-sdk/src/androidMain/.../camera/CameraXCaptureCamera.kt`, `StillKind.kt` |
| K2 | `ImageEncoding`: documents at 4096 px and quality 92, selfies at 2048 and 90 (`StillKind`); over the 10 MiB limit, 85 then smaller, else `CameraCaptureException` (which `takePictureOrNull` turns into "could not take the photo"). `PickedPhotos` uses the document cap, with a decode budget of 4096² pixels so a 40-megapixel pick still decodes at half size | `ImageEncoding.kt`, `PickedPhotos.kt` |

Files the user uploads in the web flow are sent as chosen (not re-encoded): the vision service's EXIF forensics read them.

## RED

### F3: the pure check (`photo-check.test.ts`, written first)

```text
$ cd apps/flow && pnpm exec vitest run src/lib/photo-check.test.ts
 FAIL  src/lib/photo-check.test.ts [ src/lib/photo-check.test.ts ]
Error: Cannot find module './photo-check' imported from /home/mhnoor/persona-opensource/apps/flow/src/lib/photo-check.test.ts
      Tests  no tests
```

The first implementation used the plan's measure, the Laplacian variance of the guide crop scaled to 800 px, with a placeholder bar of 60. The unit tests then failed only where the bar was still a placeholder:

```text
 FAIL  src/lib/photo-check.test.ts > assessGuideCrop > calls the same print blurry under a σ 2 blur
AssertionError: expected 60.52810310346574 to be less than 60
      Tests  2 failed | 14 passed (16)
```

(the other failure was the test's own `Math.max(...array)` overflowing the stack on 384,000 values, fixed in the test).

### F1, F2: `document-photo.test.ts`, written first

```text
$ pnpm exec vitest run src/lib/document-photo.test.ts
 FAIL  src/lib/document-photo.test.ts [ src/lib/document-photo.test.ts ]
Error: Failed to resolve import "./document-photo" from "src/lib/document-photo.test.ts". Does the file exist?
      Tests  no tests
```

### F1, F3, F4 in the components, the environment and the catalogs

```text
$ pnpm exec vitest run src/i18n/photo-check-keys.test.ts src/components/camera-capture.test.tsx src/components/capture-sequence.test.tsx src/steps/verification-capture-step.test.tsx src/flow/flow-environment.test.tsx
 Test Files  5 failed (5)
      Tests  30 failed | 53 passed | 1 skipped (84)
AssertionError: expected "vi.fn()" to be called with arguments: [ { constraints: { …(2) } } ]
TypeError: undefined is not a spy or a call to a spy!
TypeError: Cannot read properties of undefined (reading 'mockResolvedValue')
```

The 30 failures: the document constraints (still 1920 x 1080), `applyConstraints` never called, no `captureDocument` in the environment or the fake camera, no barcode band or hint, no retake prompt, no "use anyway", and the 14 catalog cases (no `capture.photoCheck` or `capture.barcodeHint` in any locale).

### K1, K2: the Android host tests, written first

```text
$ (cd android && flock /tmp/openverify-heavy.lock ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.camera.*')
e: .../CameraXCapturePipelineTest.kt:149:42 Unresolved reference 'stillUseCase'.
e: .../CameraXCapturePipelineTest.kt:149:55 Unresolved reference 'StillKind'.
e: .../CameraXCapturePipelineTest.kt:161:42 Unresolved reference 'stillUseCase'.
...
exit 1
```

## Calibration of the F3 bar

**Images.** `uv run --frozen python tools/synthetic_quebec.py images --out <scratch>/qc` (18 images: the nine named captures, front and back, standard back layout). Each was turned into an 8-bit grey PGM with Pillow's `L` conversion (the same Rec. 601 luma as `toGrey`):

```bash
(cd services/vision && uv run --frozen python -I -c "
import sys, pathlib
from PIL import Image
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
for p in sorted(src.glob('*.jpg')):
    Image.open(p).convert('L').save(out / (p.stem + '.pgm'))
" <scratch>/qc <scratch>/pgm)
node apps/flow/scripts/calibrate-photo-check.ts <scratch>/pgm            # a phone's 3:4 preview, 360 x 480
node apps/flow/scripts/calibrate-photo-check.ts <scratch>/pgm 640 480    # the sm: 4:3 preview
```

The script loads `apps/flow/src/lib/photo-check.ts` itself, crops the guide region the flow's geometry gives over each frame, and prints the check.

**The plan's measure does not separate the sets.** The Laplacian variance at 800 px, on the 360 x 480 geometry:

| Capture | Front | Back |
|---|---|---|
| phone-1080 | 284.8 | 857.1 |
| phone-1080-soft (must pass) | **80.2** | 283.7 |
| phone-1080-motion (must fail) | 49.2 | **123.9** |
| phone-1080-blur (must fail) | 17.4 | 66.8 |

The motion-blurred back (123.9) outscores the soft front (80.2): the variance grows with how much print a side carries (the back's PDF417 is dense) as much as with focus. No single bar passes `-soft` and fails `-motion` on both sides.

**The measure used.** `sharpnessOf`: after stretching the grey levels linearly (1st percentile to 0, 99th to 255), along each axis the energy of the second difference over the energy of the first difference, on the pixels whose central-difference slope on that axis is at least 32; the lower axis is the score. A Gaussian edge of width σ scores about 1/σ² whatever its contrast, both energies grow with the number of edges, and a motion blur shows on its own axis. Three candidates were measured first and rejected (an isotropic Laplacian-to-gradient ratio over edge pixels: contrast-dependent; the same with an adaptive edge threshold: `-soft` and `-motion` overlapped; directional with edge dilation: overlapped). The unit tests pin the properties: monotone in blur, zero once no edge is left, contrast-invariant within 10%, independent of how much of the image is print within 10%, a 6-pixel one-axis motion blur fails.

**The numbers** (`MIN_DOCUMENT_SHARPNESS = 0.24`, `MIN_GUIDE_WIDTH_PX = 800`):

```text
bars: sharpness >= 0.24, guide >= 800 px; view 360x480
| Side | Capture | Frame | Guide region (px) | Sharpness | Verdict |
|---|---|---|---|---|---|
| back | flat | 1100x700 | 935x587 | 0.898 | pass |
| back | phone-1080-blur | 1080x1920 | 1080x769 | 0.132 | blurry |
| back | phone-1080-glare | 1080x1920 | 1080x769 | 0.769 | pass |
| back | phone-1080-motion | 1080x1920 | 1080x769 | 0.143 | blurry |
| back | phone-1080-q75 | 1080x1920 | 1080x769 | 0.794 | pass |
| back | phone-1080-soft | 1080x1920 | 1080x769 | 0.339 | pass |
| back | phone-1080-tilt | 1080x1920 | 1080x769 | 0.793 | pass |
| back | phone-1080 | 1080x1920 | 1080x769 | 0.797 | pass |
| back | phone-full | 3024x4032 | 2570x1614 | 1.535 | pass |
| front | flat | 1100x700 | 935x587 | 1.128 | pass |
| front | phone-1080-blur | 1080x1920 | 1080x769 | 0.148 | blurry |
| front | phone-1080-glare | 1080x1920 | 1080x769 | 1.008 | pass |
| front | phone-1080-motion | 1080x1920 | 1080x769 | 0.172 | blurry |
| front | phone-1080-q75 | 1080x1920 | 1080x769 | 1.099 | pass |
| front | phone-1080-soft | 1080x1920 | 1080x769 | 0.429 | pass |
| front | phone-1080-tilt | 1080x1920 | 1080x769 | 1.059 | pass |
| front | phone-1080 | 1080x1920 | 1080x769 | 1.103 | pass |
| front | phone-full | 3024x4032 | 2570x1614 | 1.988 | pass |

bars: sharpness >= 0.24, guide >= 800 px; view 640x480
| back | phone-1080-blur | 1080x1920 | 1080x1366 | 0.121 | blurry |
| back | phone-1080-motion | 1080x1920 | 1080x1366 | 0.163 | blurry |
| back | phone-1080-soft | 1080x1920 | 1080x1366 | 0.321 | pass |
| front | phone-1080-blur | 1080x1920 | 1080x1366 | 0.148 | blurry |
| front | phone-1080-motion | 1080x1920 | 1080x1366 | 0.172 | blurry |
| front | phone-1080-soft | 1080x1920 | 1080x1366 | 0.456 | pass |
(every other capture passes, as at 360 x 480)
```

The lowest passing capture is the soft back (0.339) and the highest failing one the motion-blurred front (0.172); the bar is their geometric mean, 0.24, a factor of 1.41 above the failing side and 1.40 below the passing side. The size bar passes every generator capture (the smallest guide region is the flat scan's 935 px); a 720p stream (612 px of guide) is too small.

## GREEN

```text
$ pnpm exec vitest run src/lib/document-photo.test.ts src/lib/photo-check.test.ts
      Tests  37 passed (37)
$ pnpm exec vitest run src/lib src/components src/steps/verification-capture-step.test.tsx src/flow/flow-environment.test.tsx src/i18n
 Test Files  39 passed (39)
      Tests  476 passed | 1 skipped (477)
$ node apps/flow/scripts/export-flow-locales.ts --check
Out of date: contracts/fixtures/i18n/en.json, contracts/fixtures/i18n/es.json, contracts/fixtures/i18n/fr.json, contracts/fixtures/i18n/de.json, contracts/fixtures/i18n/ar.json. Run node apps/flow/scripts/export-flow-locales.ts
$ node apps/flow/scripts/export-flow-locales.ts && node apps/flow/scripts/export-flow-locales.ts --check
Wrote contracts/fixtures/i18n/en.json, contracts/fixtures/i18n/es.json, contracts/fixtures/i18n/fr.json, contracts/fixtures/i18n/de.json, contracts/fixtures/i18n/ar.json.
The locale exports are up to date.
$ (cd apps/dashboard && pnpm exec vitest run src/components/translations)      # reads the exports
      Tests  16 passed (16)
$ (cd packages/flow-spec && pnpm exec vitest run src/export-vectors.test.ts)
      Tests  18 passed (18)
```

Android, the camera host tests:

```text
$ (cd android && flock /tmp/openverify-heavy.lock ./gradlew --no-daemon -q :openverify-sdk:testAndroidHostTest --tests 'dev.openverify.sdk.camera.*')
exit 0
dev.openverify.sdk.camera.CameraXCapturePipelineTest 10 0 0
dev.openverify.sdk.camera.ImageEncodingTest 10 0 0
dev.openverify.sdk.camera.PickedPhotosTest 12 0 0
dev.openverify.sdk.camera.AnalysisSizesTest 11 0 0
... 23 classes, total 148 failed 0 skipped 0
```

`ImageEncodingTest` reads the quality back from the JPEG's luminance quantization table (the IJG base table scaled by the quality formula Skia's encoder applies): 92 for a document, 90 for a selfie, 85 after the fallback. A 4032 x 3024 document still keeps its size; a selfie of the same still is 1536 x 2048.

## Refactor

- `assessGuideCrop` takes the region's upload width apart from the copy it reads, since the browser reads a large region back at most 1600 px wide.
- The percentile walk of `stretchContrast` lost its unreachable fallback.
- Tests for the default browser paths (`ImageCapture` and `createImageBitmap` stubbed), a stream without a video track, and a canvas that cannot read back, for coverage of `document-photo.ts` (98% lines).
- The Android still is created per preview and cleared on unbind only when no newer preview replaced it.

## Gates

```text
$ (cd apps/flow && flock /tmp/openverify-heavy.lock pnpm run test)      # after the flow commit
 Test Files  144 passed (144)
      Tests  1741 passed | 1 skipped (1742)
All files          |    95.2 |    88.33 |   95.89 |   95.46 |
  ...ment-photo.ts |   98.27 |    91.04 |   94.73 |   99.09 | 121
  photo-check.ts   |     100 |    76.74 |     100 |     100 | 84,125-180,183
$ (cd apps/flow && pnpm run lint && pnpm run typecheck)
$ eslint .
$ tsc --noEmit && tsc --noEmit -p e2e && tsc --noEmit -p tsconfig.server.json && tsc --noEmit -p scripts
(both clean)
$ pnpm exec prettier --check <every file of both commits> docs/tdd/phase12a-capture-12a.tdd.md
All matched files use Prettier code style!
$ python3 -I scripts/fetch_models.py --only face_detection_yunet && python3 -I scripts/fetch_fixtures.py --only person_a_id
face_detection_yunet: present ... (MIT)
person_a_id: present ... (PD-USGov-NASA)
$ (cd android && flock /tmp/openverify-heavy.lock ./gradlew --no-daemon testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 7m 27s
346 actionable tasks: 96 executed, 22 from cache, 228 up-to-date
exit 0
```

Test results of that run (JUnit XML): `openverify-sdk` testAndroidHostTest 2747 tests, 0 failed (the key-map catalog tests read the re-exported web catalogs); `demo-app` testDebugUnitTest 97, 0 failed; `openverify-face` 51, 0 failed; `openverify-nfc` 116, 0 failed. `koverVerify` passed for every module; `lint` passed for every module.

`pnpm format:check` over the whole tree was not used as the gate, because the other Stage 2 agents' uncommitted files are in the working tree; the check above covers every file this agent changed.

## Notes for Stage 3 and the owner

- **The F3 measure is not the plan's.** The plan named the Laplacian variance; the calibration shows it cannot pass `-soft` and fail `-motion` on both sides (table above), so the check uses `sharpnessOf`. The check stays a hint: the user can always send the photo after two prompts, and the server judges it again.
- **Uploads are not re-encoded.** F2 covers camera photos. A file the user picks is sent as chosen, because the vision service's upload forensics read its EXIF; re-encoding it would hide an edit.
- **Device proof is the owner's.** `takePhoto()`, `applyConstraints` and CameraX's choice of a 4:3 still up to 4096 x 3072 in quality mode run only on a device; there is no emulator here. On the Pixel 9: the web flow's document photo should be about 3072 x 4080 (or the still Chrome gives), and the Android demo's about 3072 x 4080 at quality 92.
- The back's hint reads "barcode" on every back, as the plan says, including ID cards whose back carries an MRZ instead.
