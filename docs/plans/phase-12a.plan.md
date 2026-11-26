# Plan: Phase 12A, a real Quebec driver licence through a phone capture

**Source:** the owner's live test of 2026-11-22 (a real Quebec driver licence through the hosted web flow on a Pixel 9, the default template "Government ID and selfie"), the orchestrator's masked diagnostic of it (text shapes only, no value), and the code at base `4ea2493bf`. Written by contracts-12a, Workflow 12A Stage 1. Nothing here holds, copies or derives from the owner's photos or OCR text: every example below is synthetic, from `services/vision/tools/synthetic_quebec.py`.

## 1. Goal

A real Quebec driver licence captured by a phone, through the hosted web flow or the Android SDK, yields `name-first`, `name-last`, `birthdate`, `identification-number` and `expiration-date`:
- from the PDF417 barcode on the back when it can be read;
- from the printed front otherwise, each field carrying how it was read (`label`, `pattern` or `layout`).

A required field that still cannot be read sends the verification to manual review (`needs_review`) with its reasons, when the template opts in, instead of failing the inquiry. The seeded default template opts in.

What this phase does not promise. With the barcode read, the card can pass. With the front alone, the issuer is not established (C30.2: only an MRZ or an AAMVA header establishes it), so `id_number_format_inconsistency_detection` answers `input_missing` and the verification goes to review. That is the honest outcome, because a printed "QUEBEC" is weak evidence. Section 6 records this.

## 2. What the live test showed

The diagnostic is masked: shapes only.
- **Capture.** The web flow uploaded 1080x1920 JPEG frames of about 180 KB; the rectified card was about 1015x640 px.
- **Barcode.** The back gave `barcodes: []`, so the PDF417 path never ran.
- **OCR.** The front read well: 21 lines, confidence mostly 0.88-1.00.
- **Parsing.** `parseViz` read zero fields, for these reasons:
  - the number line `A9999-999999-99` is unlabeled;
  - the two name lines under it are unlabeled (their tiny field numbers are not read);
  - the birth date line is `DATE DE NAISSANCE (A-M-J):9999-9A-99`: a format hint, a colon glued to the value, a year-month-day date and a misread month digit;
  - the issue and expiry lines have a label glued to a Y-M-D date.
- **Blur.** `blur_score` was about 38.5 and 39.4 against vision's `DEFAULT_BLUR_MIN` 100, on all three attempts, although OCR confidence was high.
- **Handwriting.** `id_handwriting_detection` flagged clean print (score 0.39, confidence-drop 0.97).
- **Document detection.** Two attempts had `document.found: false` with 22-23 text lines and a portrait.
- **Outcome.** The template fails the verification when a required field is missing; three failed attempts fail the inquiry.

### 2.1 The same failures, reproduced on synthetic captures (baseline at `4ea2493bf`)

`synthetic_quebec.photograph` puts the synthetic card in a 1080x1920 frame at 86% of the width, the web guide's 85%. That gives a card of about 930 px, a JPEG of about 200 KB, and 2.76 px per PDF417 module at 10 mil. Today's vision code was run on each capture (the method and the raw output are in `docs/tdd/phase12a-contracts-12a.tdd.md`):

| Capture | Side | Back layout | Document found | Whole-image blur | Document blur | PDF417 decoded |
|---|---|---|---|---|---|---|
| flat (scan-like) | front / back | standard | yes / yes | 473.8 / 1022.0 | 473.8 / 1022.0 | - / yes |
| phone-1080 | front / back | standard | **no / no** | **75.1** / 188.0 | - | - / yes |
| phone-1080-soft (σ 1.2) | front / back | standard | no / no | 17.9 / 51.4 | - | - / yes |
| phone-1080-blur (σ 2.0) | front / back | standard | no / no | 6.4 / 13.6 | - | - / **no** |
| phone-1080-motion (7 px) | front / back | standard | no / no | 12.8 / 24.7 | - | - / **no** |
| phone-1080-tilt (7°, keystone 8%) | front / back | standard | no / no | 76.4 / 195.6 | - | - / **no** |
| phone-1080-glare | front / back | standard | no / no | 67.8 / 148.3 | - | - / **no** |
| phone-1080-q75 | front / back | standard | no / no | 74.2 / 191.3 | - | - / yes |
| phone-full (3024x4032) | front / back | standard | yes / yes | **16.7** / 33.8 | 251.0 / 595.7 | - / yes |
| phone-1080 / -soft / -tilt / -glare | back | dense (0.19 mm, 17 columns) | no | 148.6 / 34.5 / 152.4 / 111.8 | - | yes / **no** / **no** / **no** |

What the table shows:
- **Document detection** misses the card in every 1080x1920 frame, so there is no rectified card, no document quality, no aspect ratio (the visual-zone class needs one) and no second barcode pass. The live "document found: false" is the same miss.
- **Whole-image blur** penalises the desk and the frame size. An in-focus 1080 front scores 75, under 100. A 12-megapixel front scores 16.7 although its rectified card scores 251. This is the measure that failed live.
- **The barcode** is lost to tilt, glare, motion and blur, and a denser symbol is lost to mild softness too. A single zxing pass on the upload is not enough.

### 2.2 Root causes in the code

| Symptom | Cause | Owner |
|---|---|---|
| no PDF417 | `barcode.decode_barcodes` makes one zxing pass on the grey upload (≤ 2560 px). It makes a second pass on the rectified card only when a document was found, which never happens at 1080. There is no upscaling, sharpening, binarization, rotation, crop or glare handling | vision-12a |
| document not found | `document.detect_document` (contour and line candidates) misses a light card on a mid-tone desk at 1080x1920; there is no fallback from the text lines and the portrait | vision-12a |
| blur fail at high OCR confidence | `id_blur_detection` (`packages/checks/src/phase1/government-id-checks.ts`) uses vision's whole-image `quality.is_blurry` (Laplacian variance of the upload ≥ `DEFAULT_BLUR_MIN` 100), because `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS` sets no `min-blur-score`. It also uses the document measure (`min-document-blur-score` 96.56) when one exists. Nothing looks at OCR confidence | checks-12a (the verdict), vision-12a (the measure and its calibration) |
| zero VIZ fields | `parseViz` (`packages/checks/src/viz.ts`), for these reasons: `tokens()` keeps `LE2021` as one token, so a glued label is not recognized; `(A-M-J)` becomes part of the inline value; `TO_DIGIT` applies only to tokens already all digit-like (`0Z` passes but `9A` does not); the pattern fallback parses a whole line as a date, so `LABEL 2021-03-15` is not a date line; the number pattern `^[A-Z0-9]{6,12}$` refuses `T1234-567890-12`; there is no layout rule for unlabeled names | checks-12a |
| handwriting false positive | `handwritingScore` (`packages/checks/src/government-id/scores.ts`) is `0.6·stroke + 0.4·drop`. With no VIZ field read it scores every line, so a single lower-confidence line gives `drop` ≈ 0.97 and `0.4 × 0.97 = 0.388`, above `max-handwriting-score` 0.383, with `stroke` ≈ 0. Vision's stroke-width measure was not the cause | checks-12a (score); vision-12a only confirms the stroke measure on uniform print |
| inquiry failed | `id_extracted_properties_detection` fails with `required_fields_missing`, which is retryable. After `maxAttempts` (3) the inquiry fails (`apps/api/src/jobs/inquiry-outcome.ts`) | checks-12a |

## 3. The shared synthetic fixtures (contracts-12a, committed)

**Generator:** `services/vision/tools/synthetic_quebec.py`, tested by `services/vision/tests/test_synthetic_quebec.py` (17 tests, 96% branch coverage of the module). It is deterministic: every random choice comes from a capture's seed, and the JPEG bytes are identical run to run.

```bash
source scripts/env.sh && cd services/vision
uv run python tools/synthetic_quebec.py images [--out DIR] [--capture NAME ...]   # default DIR fixtures/generated/quebec-dl (git-ignored); writes {front,back}-<capture>.jpg and truth.json
uv run python tools/synthetic_quebec.py fixtures [--out DIR] [--check]           # default DIR contracts/fixtures/quebec-dl; --check exits 1 when a committed file is stale
```

After `fixtures`, run `pnpm exec prettier --write contracts/fixtures/quebec-dl/*.json`. The generator's test compares the files as JSON, not as text.

**Python API.** Import `from synthetic_quebec import ...`; `pythonpath` already holds `tools/`.

| Name | What |
|---|---|
| `QuebecHolder`, `QuebecLicence`, `HAPPY_HOLDER`, `HAPPY_LICENCE` | The invented values. Happy card: `TREMBLAY` / `MARIE`, born 1990-02-14, sex F, `100 RUE FICTIVE`, `MONTREAL QC H0H 0H0`; licence `T1234-567890-12`, class 5, issued 2021-03-15, expires 2029-02-14 |
| `compact_number(n)` | The number without dashes and spaces: `T123456789012` |
| `aamva_payload(holder, licence, *, version=10, file_type="ANSI ", printed_number=False, offset_shift=0)` | AAMVA 2020 Annex D under IIN `604428`. One `DL` subfile with all 22 mandatory 2020 elements, CCYYMMDD dates, `DCG CAN`, `DAJ QC`, `DAQ` compact; then the `ZQ` subfile `ZQA OPENVERIFY SYNTHETIC TEST DATA` |
| `render_front(holder, licence, *, px_per_mm=12, field_numbers=True, issuer="QUEBEC", portrait=None)` | `CardSide` with its `image` (1027x648 at 12 px/mm) and every `PrintedLine(text, role, box)`. Roles: `number`, `name-last`, `name-first`, `address-street-1`, `address-city`, `birthdate`, `issue-date`, `expiration-date`, `class`, `sex`, `height`, `header`, `banner`, `field-number`. `issuer="UTOPIA"` gives the negative case; `portrait=(photo, face_box)` pastes a public-domain face (`fixtures/manifest.json`) in place of the drawn silhouette |
| `render_back(..., back="standard" \| "dense", payload=None)` | `CardSide` with `barcode_box` and `payload`. `BACKS["standard"]` is 0.254 mm modules and 13 columns; `BACKS["dense"]` is 0.19 mm and 17 columns. Modules may span fractional pixels |
| `Capture(name, frame, card_width_share, tilt_deg, keystone, blur_sigma, motion_px, glare, jpeg_quality, noise, seed)`, `CAPTURES` | The named captures of the table above. Stage 2 calibrations may build more |
| `photograph(side, capture, *, holder, licence, back, portrait)` | `Photo` with `image` (the decoded JPEG, what vision receives), `jpeg`, `quad` (the card corners in the frame, clockwise from the top left), `card_width_px`, `module_px`, `payload`, `lines` (boxes at 12 px/mm) and `truth()` (JSON) |
| `ocr_cases()`, `aamva_cases()` | The content of the two committed fixtures |

**Committed fixtures:** `contracts/fixtures/quebec-dl/`, small JSON, no images.
- `ocr-lines.json`. Each case has `id`, `description`, `now` (`2026-11-22T00:00:00.000Z`), `lines` (`{text, confidence, box: [x, y, w, h]}` in rectified pixels at 12 px/mm, the shape of `TextLineInput` without the stroke fields), `expected` (`{field: {value, via}}`) and `absent` (fields that must not be read). The cases:
  - `printed`: every printed line, the field numbers as their own lines;
  - `phone-ocr`: the live shapes, synthetic values. No field numbers; `DATE DE NAISSANCE (A-M-J):1990-0Z-14`; `DELIVRE LE2021-03-15`; `SEXE:F`; `CLASSE(S):5`; `TAILLE (CM):165`;
  - `labels-unread`: issue and expiry labels misread (`DELIVRF LF2021-03-15`, `FXPIRF L 2029-02-14`); both dates by pattern;
  - `number-confusion`: `T1234-56789O-12`;
  - `not-quebec`: issuer `UTOPIA` and number `UT4829163`. The names are `absent`; the number is read by the existing pattern.

  The expected readings for `printed`, `phone-ocr` and `number-confusion`:
  - `identification-number`: `T123456789012`, via `pattern`;
  - `name-last`: `TREMBLAY`, via `layout`;
  - `name-first`: `MARIE`, via `layout`;
  - `birthdate`: `1990-02-14`, via `label`;
  - `issue-date`: `2021-03-15`, via `label`;
  - `expiration-date`: `2029-02-14`, via `label`;
  - `sex`: `F`, via `label`.
- `aamva.json`. Each case has `id`, `description`, `payload` and `expected` (`name-first`, `name-last`, `birthdate`, `sex`, `identification-number` (compact), `issue-date`, `expiration-date`, `address-subdivision`, `address-postal-code` (`H0H 0H0`), `issuing-authority-code` (`604428`)). The cases:
  - `qc-v10`: standard;
  - `qc-file-type-aamva`: header file type `AAMVA`;
  - `qc-printed-number`: `DAQ` with dashes;
  - `qc-offset-shift`: the DL designator's offset is 2 bytes off;
  - `qc-v08`: version 08 in the header.

**The fixtures are frozen for Stage 2.** No Stage 2 agent edits the generator, its test or `contracts/fixtures/quebec-dl/`. An agent that needs a new capture builds a `Capture(...)` in its own test. An agent that needs a generator change asks the orchestrator, which makes it as a contracts-12a amendment.

### 3.1 C36 amendment (Phase 12A)

C36 (`docs/plans/phase-3.plan.md`) renders cards only for the fictional issuer Utopia, and draws AAMVA payloads only as barcode-only images, never onto a card. Phase 12A amends it for `synthetic_quebec.py` only, because the Quebec layout rule must see a document that reads as a Quebec licence:
- the card prints the jurisdiction's name and title in plain text (`QUEBEC`, `PERMIS DE CONDUIRE`) on the plain synthetic background, with no emblem, seal, design or colour of the real card;
- **every side prints the specimen marker**: `SPECIMEN` in the header and the banner `SPECIMEN - OPENVERIFY SYNTHETIC TEST CARD`;
- the PDF417 payload carries the `ZQ` synthetic subfile;
- the holder, address and number are invented. `H0H 0H0` is Canada Post's well-known fictional postal code;
- images are generated into git-ignored or temporary directories and never committed.

Because the cards are specimen-marked, a full verification of them trips the specimen checks by design. Stage 2 acceptance is about extraction, barcodes, quality and routing, not a `passed` verification of a specimen.

## 4. Changes by agent

The paths below are exclusive. Each agent writes `docs/tdd/phase12a-<label>.tdd.md` with the commands it ran and their output, commits only its paths (`flock -w 120 /tmp/openverify-git.lock git commit ... -- <paths>`), and runs heavy suites one at a time under `flock /tmp/openverify-heavy.lock`. No agent pushes, dispatches CI, logs OCR text, or touches the docker project `openverify-test`.

### 4.1 capture-12a: `apps/flow/**` and `android/openverify-sdk/**` (camera and encoding only)

**What was read.**
- **Web.**
  - `apps/flow/src/components/camera-capture.tsx` asks `getUserMedia` for `width: { ideal: 1920 }, height: { ideal: 1080 }` for documents as for selfies.
  - `apps/flow/src/lib/capture-frame.ts` draws the `<video>` frame at its own size and encodes a JPEG at `PHOTO_QUALITY` 0.92, which already meets the bar.
  - The government ID step is `apps/flow/src/steps/verification-capture-step.tsx` (`facingMode: 'environment', guide: 'document'`).
  - Nothing checks sharpness or size before upload.
  - The back uses the same guide as the front.
- **Android.**
  - `android/openverify-sdk/src/androidMain/kotlin/dev/openverify/sdk/camera/CameraXCaptureCamera.kt` binds `ImageCapture` with `CAPTURE_MODE_MINIMIZE_LATENCY` and `TARGET_RESOLUTION = Size(1920, 1440)`.
  - `ImageEncoding.kt` caps the long side at `MAX_DIMENSION = 2048` and encodes at `JPEG_QUALITY = 90`.
  - **Both are below the bar.**

**Changes and acceptance tests** (Vitest in `apps/flow`, host tests in `android/openverify-sdk`):

| # | Change | Acceptance test |
|---|---|---|
| F1 | Document capture at full camera resolution. When `ImageCapture` and `takePhoto()` exist (Chrome on Android), the photo is `takePhoto()`'s still. Otherwise the stream is asked for the camera's maximum: `getCapabilities()` then `applyConstraints`, or `ideal` 4096x3072 as a fallback, and the frame is drawn. Selfies are unchanged | A fake track with `ImageCapture` gives a photo from `takePhoto` at its size. Without it, the constraints ask for the maximum and the frame is drawn at the video's size. Selfie constraints are unchanged |
| F2 | Every document photo is re-encoded through a canvas: orientation applied, no EXIF or other metadata, long side ≤ 4096 px, JPEG 0.92. When the bytes exceed `MAX_UPLOAD_BYTES` (10 MiB), quality steps down to 0.85 and then the image is downscaled | The encoded blob is `image/jpeg` at quality 0.92, its long side is capped, an oversize result is re-encoded under the limit, and no EXIF APP1 segment is present (the bytes are checked) |
| F3 | A pre-upload check of the guide region: sharpness (Laplacian variance of a grey crop of the guide, scaled to a fixed width) and size (the guide's width in photo pixels). Below the bar, a retake prompt appears with the reason (blurry, too small), translated in `en fr es de ar`. The photo is never sent silently. After two prompts for the same side, "use this photo anyway" is offered, so a user is never blocked | A pure function on pixel arrays: sharp synthetic text scores above the bar and a σ 2 blur below it. The bar is calibrated on the generator's `phone-1080`, `-soft`, `-blur` and `-motion` fronts and backs (`images` command), with the numbers recorded in the TDD file: soft passes, blur and motion fail. Component tests cover the prompt, its i18n keys in all five locales, and the third-time "use anyway" |
| F4 | The back is framed for the barcode: on the back side the guide adds the hint "Make sure the barcode is sharp and inside the frame" (five locales) and shows a barcode band inside the card outline | A component test for the back hint and band; an i18n completeness test |
| K1 | Android document stills at the sensor's highest 4:3 size (`ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY` or an explicit maximum) with `CAPTURE_MODE_MAXIMIZE_QUALITY`. The selfie still and the analysis stream keep their C201.2 sizes and combination rule | A host test of the use-case configuration: document versus selfie selector and mode. `AnalysisSizes` tests stay green |
| K2 | `ImageEncoding` for documents: `MAX_DIMENSION` 4096, `JPEG_QUALITY` 92. `PickedPhotos` uses the same cap. Selfies keep 2048/90 unless a test shows the same need | `ImageEncodingTest`: document encoding keeps a 4032x3024 bitmap at full size and quality 92; selfie encoding is unchanged; `MIRRORS_IMAGES` still false |

**Gates:**
- `pnpm --filter @openverify/flow lint typecheck test` (coverage ≥ 80%);
- `(cd android && ./gradlew testDebugUnitTest testAndroidHostTest koverVerify :openverify-sdk:assemble lint)`, under the heavy lock;
- `pnpm format:check` on the changed files.

Device tests on the Pixel 9 are the owner's (wireless adb); there is no emulator here.

### 4.2 vision-12a: `services/vision/**`, except the generator and its test

**Constraint.** The vision response contract changes in one place only: `DocumentMethod` gains `"text_layout"` (V2, frozen here; checks-12a adds it to the API side as C12). Otherwise the models in `schemas.py` used by `/v1/analyze`, the existing `contracts/fixtures/vision/*.json` and the API's zod client stay as they are. The whole-image `quality` object keeps its Phase 1 meaning (C6). If another field is needed, the agent stops and asks the orchestrator.

| # | Change | Acceptance test (pytest, captures from `synthetic_quebec`) |
|---|---|---|
| V1 | **PDF417 robustness** in `barcode.py`, a bounded sequence of passes that stops at the first PDF417 that decodes: the upload; the rectified card; a crop of the barcode region (the zxing position of a failed detection, or the back's lower-middle band); 2x upscaling (Lanczos) when modules are under about 3 px; unsharp masking; several binarizations (zxing's own, Otsu, adaptive Gaussian at two block sizes); small rotations and deskew (±3°, ±6°, and the angle of the region's dominant lines); and glare suppression (clipped highlights inpainted or masked before binarizing). A decode is reported only when zxing returns the full symbol (its own error correction); a partial or ambiguous result is never reported. The number of passes and the time are bounded (≤ 24 passes, measured and recorded) | Exactly the payload bytes (`Photo.payload`) are decoded from the back of: `flat`, `phone-1080`, `-soft`, `-tilt`, `-glare`, `-q75` and `phone-full` (standard layout), and `flat`, `phone-1080`, `-tilt`, `-glare`, `-q75` and `phone-full` (dense layout). `phone-1080-blur` and `-motion` may stay undecoded, but must never report a wrong payload; decoding either is recorded as a bonus, not required. A front never yields a PDF417. The baseline in §2.1 is the RED |
| V2 | **Fallback document quad** in `document.py`/`analysis.py`: when the detectors find no card, fit an ID-1 quad (aspect 1.586 ± tolerance) from the OCR line boxes and, on the front, the portrait box. The extent is the lines' minimum-area rectangle grown by the card's margins, then refined by `_snap_sides` against edges. It is reported with `found: true` and `method: "text_layout"` (the one new enum value of 12A: `DocumentMethod` in `schemas.py`), so no consumer mistakes it for a contour or line fit | On every `phone-1080*` front and back, the document is found (by any method), with each corner within 3% of the card width of `Photo.quad`. A `text_layout` result validates against the response schema. On a frame with no card (desk only), nothing is found. The live shape is a test: 22 text lines and a portrait, and the contour detector misses |
| V3 | **Blur on the rectified card at a normalized size.** `measure_document_quality` measures the Laplacian variance and Tenengrad on the card resized (up or down) to a fixed width, about 1000 px, so the score depends on focus, not on frame size or desk area. Calibrate on the generator's captures: a front and back threshold that passes `flat`, `phone-1080`, `-soft`, `-tilt`, `-q75`, `-glare` and `phone-full`, and fails `-blur` (σ 2.0) and `-motion`, with the margin recorded. Write `docs/calibration/blur-phase12a.md` (the method, each capture's score, and the proposed `min-document-blur-score` and `min-document-tenengrad`) | One scene at two frame sizes scores within 25%: `Capture(frame=(1080, 1920))` and `Capture(frame=(2160, 3840), blur_sigma=1.2, noise=1.5)`, everything else equal (optical blur scales with the frame). The calibration table is reproduced by a test that recomputes it. The proposed thresholds separate the sets above |
| V4 | **Handwriting on uniform print.** Confirm that `ocr/strokes.py`'s `stroke_width_cv` on the synthetic front's lines (`phone-1080`, `-soft`, `-q75`) is uniform: no line's `clamp01((cv / median_cv - 1) / 2)` exceeds 0.1. If one does, fix the measure | The stated bound, per line, on the three captures |
| V5 | No regressions: the Utopia, passport and visa fixtures, the contract fixtures and the calibration tests stay green | The full `uv run pytest` (coverage ≥ 80%), `ruff check`, `ruff format --check` and `mypy src tools` |

**Hand-off.** Until C12 lands, an API built from main refuses `text_layout`. Stage 3 merges both before any end-to-end run. The values V3 proposes are applied to `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_blur_detection` (`packages/core/src/check-config.ts`) by Stage 3, not by vision-12a or checks-12a.

### 4.3 checks-12a: the packages and the API

Paths:
- `packages/checks/**`;
- `packages/core/**`, except the numeric values of `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_blur_detection`;
- `packages/contracts/src/inquiry-templates.ts` and its test;
- `contracts/fixtures/flows/default-gov-id-selfie.json`;
- `apps/api/**`.

**What was read.**
- `extractGovernmentId` (`packages/checks/src/extraction/extract.ts`) runs `parseViz` per side with `{ dateOrder, now }`. The date order is `MDY` only for a US AAMVA issuer.
- `VizFieldReading.via` is `'label' | 'pattern'`. Nothing outside `viz.ts` reads `via` today. `handwritingScore` reads `readings[*].lineIndex`.
- `parseAamva` throws on a header whose file type is not `ANSI ` and on a designator that does not locate its subfile. It reads Canadian dates as CCYYMMDD (`DCG CAN` or a Canadian IIN). IIN 604428 is listed as Quebec.
- `establishDocument` sets the class from VIZ keywords (`PERMIS DE CONDUIRE` is one) only with a document aspect ratio, which V2 restores.
- `id_number_format_inconsistency_detection` has grammars for US jurisdictions only. A Canadian AAMVA card answers `input_missing`, which blocks (it is not in `NON_BLOCKING_NOT_APPLICABLE_REASONS`), so the verification goes to review.
- `decideVerification` (`packages/core/src/decision-engine.ts`) decides as follows: a required failed check → `failed`; a required `not_applicable` check with a blocking reason → `needs_review`.
- `inquiry-outcome.ts` handles a `needs_review` verification: the inquiry is `completed`, then `needs_review` (C30.5).

| # | Change | Acceptance test |
|---|---|---|
| C1 | **`parseViz` reads the Quebec shapes** (`viz.ts`).<br>• Format hints in parentheses, made of letter groups joined by `-`, `/` or `.` (`(A-M-J)`, `(AAAA-MM-JJ)`, `(Y-M-D)`, `(YYYY/MM/DD)`, `(JJ.MM.AAAA)`, `(MM/DD/YYYY)`), are dropped from labels. A day-first or month-first hint sets that line's date order.<br>• A label glued to its value is split at a letter-to-digit boundary (`LE2021-03-15`) and at `:` (`SEXE:F`).<br>• Year-month-day dates are read.<br>• The OCR confusions O→0, S→5, I/l→1, B→8, Z→2 are mapped only inside date and number tokens, at digit positions, never in names.<br>• The pattern fallback finds one date token inside a line that has other words. A line with two dates assigns nothing. | Every case of `contracts/fixtures/quebec-dl/ocr-lines.json` (read from the test by path): exactly the `expected` fields with their `value` and `via`, and none of `absent`. `parseVizDate` unit tests for each hint and confusion; `SIMONS`, `BOIS` and `ZOE` as names are unchanged. All existing `viz.test.ts` cases are unchanged |
| C2 | **Quebec number and layout.**<br>• The number pattern `^[A-Z]\d{4}[- ]?\d{6}[- ]?\d{2}$`, after confusions at digit positions only, reads `identification-number` compact (`T123456789012`), via `pattern`, when no label read a number and exactly one line matches.<br>• **The Quebec layout rule** applies only when the document reads as a Quebec licence: either `options.jurisdiction` is `{ country: 'CA', code: 'QC' }` (from the AAMVA issuer), or a line folds to the token `QUEBEC` and the number pattern matched one line.<br>• The rule takes the two lines directly under the number line: top within three number-line heights below it, left within two heights of it or overlapping it, not a label or inline label, not MRZ, date or number shaped, valid names without digits. The first is `name-last`, the second `name-first`, both via `layout`. The rule assigns both or neither and never overrides a label reading.<br>• New option `VizParseOptions.jurisdiction?: { country: string; code: string } \| null`; `extractGovernmentId` passes the AAMVA issuer.<br>• French labels added: `NUMERO DE PERMIS`, `NO DE PERMIS`, `N DE PERMIS` (number). The other French labels the task names already exist | The `ocr-lines.json` cases. A unit test that the rule is off without either Quebec signal (`not-quebec`). One that it is on with `jurisdiction` QC and no `QUEBEC` line. One where only one name line qualifies (neither name is read). One with a label reading `NOM` (the label wins) |
| C3 | **`via: 'layout'`** joins `VizFieldReading['via']`. The extraction keeps each VIZ reading's `via` in `VizSource.readings`. `id_extraction_inconsistency_detection` names the VIZ `via` of each field it compares (metadata `viz-via: {field: via}`) so the inconsistency can be weighed. Its verdict rules do not change in 12A | The check's metadata for a barcode-versus-VIZ comparison of a layout-read name |
| C4 | **AAMVA tolerance** (`aamva.ts`).<br>• The header file type `AAMVA` is accepted beside `ANSI `.<br>• A designator whose offset does not locate its subfile falls back to finding the subfile's type right after the designator block and at the designated length. When both fail it still throws `aamva_subfile_designator_invalid`.<br>• For IIN 604428, `DAQ` is normalized compact.<br>• A tolerated deviation is reported as a new non-throwing issue (`aamva_header_nonstandard`, `aamva_designator_offset_mismatch`), so `valid` is false for it | Every case of `contracts/fixtures/quebec-dl/aamva.json`: the `expected` fields. `qc-v10` has `valid: true` and no issue; the tolerance cases carry their issue. The existing vectors of `contracts/fixtures/aamva/` are unchanged |
| C5 | **The extraction end to end** | With `extractGovernmentId`: phone-ocr lines plus the `qc-v10` barcode give the five required fields, consolidated, sources agreeing. The barcode alone gives the five. The phone-ocr lines alone give the five. `labels-unread` lines alone give the five |
| C6 | **Review routing.** `idExtractedPropertiesDetectionConfigSchema` gains `'missing-fields-outcome': z.enum(['fail', 'review']).optional()`; the registry default is `'fail'`, so behaviour is unchanged. With `'review'`, missing required fields give `not_applicable` with `['required_fields_missing']` and the same `missing-fields` metadata. That reason is not in `NON_BLOCKING_NOT_APPLICABLE_REASONS`, so `decideVerification` gives `needs_review` with the check in `reviewCheckIds`. `input_missing` behaviour is unchanged. No change to `decideVerification` | Check unit tests for `fail`, `review` and `input_missing`. A `decideVerification` test where the only problem is the review outcome gives `needs_review` and is not `retryable`. Another where another required check failed still gives `failed` |
| C7 | **The seeded template opts in.** `DEFAULT_GOVERNMENT_ID_CONFIG` sets `id_extracted_properties_detection.config = { 'missing-fields-outcome': 'review' }`, and `contracts/fixtures/flows/default-gov-id-selfie.json` matches. `seed:dev` publishes it as a new version (C36: existing inquiries keep theirs) | The contracts test that the default template equals the fixture. An `apps/api` seed test that the seeded latest version carries the option |
| C8 | **The API routes it.** No change to `process-verification.ts` is expected | An `apps/api` job test (`process-verification.test.ts` style, fakes as in the suite): a government ID whose extraction lacks `name-first` under the default template. The verification becomes `needs_review`, the inquiry `completed` then `needs_review` (`inquiry.marked-for-review`), and no `inquiry.failed` |
| C9 | **Blur verdict** (`government-id-checks.ts`, `idBlurDetection`). A side with `document_quality` is judged on the document measures only, not on the whole-image `is_blurry`, which stays for sides without a document. New optional keys `legible-text-min-confidence` (unit, default 0.9) and `legible-text-min-lines` (int, default 8): a side the document measure calls blurry, whose OCR lines have a median confidence ≥ the minimum over at least that many lines, is legible. It is not failed for `image_blurry`, and metadata `legible-by-ocr-sides` names it | Unit tests: a live-shaped side (whole-image 38.5, document measure passing) passes. A document-blurry side with 21 lines at a median of 0.95 passes with `legible-by-ocr-sides`. A blurry side with 5 lines, or a median of 0.6, fails. A side with no document is judged as before |
| C10 | **Handwriting score** (`scores.ts`). The confidence drop alone cannot reach the threshold: with `stroke` < 0.1 a line's score is capped below `max-handwriting-score`. Fallback scoring of all lines applies only when fewer than two VIZ fields were read, and then needs a stroke signal as well. The `handwritten-field` variant still trips | Unit tests: the live shape (stroke 0.003, one line with drop 0.97, no field read) scores < 0.383. The C36 `handwritten-field` calibration expectation is unchanged |
| C11 | **Quebec number grammar** (`id_number_format_inconsistency_detection`). A shape-only grammar `ca-dl-qc` (`^[A-Z]\d{12}$` compact) applies when the AAMVA issuer is CA/QC. It has no checksum, and the docs comment says so. A VIZ-only document (no issuer) keeps `input_missing` | Pass for `T123456789012`, fail for `T12345678901`, `input_missing` with no issuer |
| C12 | **The `text_layout` document method.** The API accepts V2's new value: add `'text_layout'` to the document `method` enum in `apps/api/src/vision/schemas.ts`, `apps/api/src/ports.ts` and `packages/checks/src/phase1/inputs.ts`. Nothing branches on the method today | An API vision-client test: an analysis whose document `method` is `text_layout` parses. An unknown method is still refused |

**Gates:**
- `pnpm --filter @openverify/checks --filter @openverify/core --filter @openverify/contracts --filter @openverify/api lint typecheck test` (coverage ≥ 80% each);
- `pnpm --filter @openverify/api test:integration` if a touched path has integration tests, under the heavy lock;
- `pnpm format:check`.

### 4.4 Stage 3, integration (the orchestrator)

1. Apply V3's proposed `min-document-blur-score` and `min-document-tenengrad` to `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_blur_detection`, then rerun the checks calibration tests.
2. Regenerate the docs (`pnpm --filter @openverify/docs-tools docs:catalog`), which covers `docs/checks/*` for the new config keys, and update `docs/PROGRESS.md`.
3. An end-to-end proof on the synthetic captures: post `phone-1080` front and back JPEGs to a locally running vision service, feed its answer to `extractGovernmentId`, and get the five fields. Do it without the barcode as well, and with each capture of §2.1.
4. The full validation per CLAUDE.md, one heavy suite at a time.
5. The owner's retest of his real card on the Pixel 9: web flow and Android demo. That is the only test with real data, and nothing from it is recorded except pass or fail per field.

## 5. Stage 2 order and dependencies

The three Stage 2 agents run in parallel. None needs another's code:
- capture-12a calibrates its pre-check on the generator's images;
- vision-12a tests on the generator's captures;
- checks-12a tests on the committed JSON fixtures.

There are two hand-offs: V3's thresholds, applied in Stage 3, and the `text_layout` enum value, which vision-12a emits (V2) and checks-12a accepts (C12). The value is frozen by this plan, so both can code against it.

## 6. Decisions and open questions

- **D12A-1. Review, not retake-then-review.** With the option on, a missing field goes to review on the first attempt, so the user is not asked to retake. A retake might have read the barcode, but the live test shows retakes repeating the same miss, and the decision engine has no attempt count. A `review-on-last-attempt` value is left for later (**Q12A-1** for the owner).
- **D12A-2. VIZ-only is review.** VIZ-only Quebec cards go to review through `id_number_format_inconsistency_detection` `input_missing`, because a printed jurisdiction name does not establish the issuer (C30.2). **Q12A-2**: whether to let a VIZ "QUEBEC" header plus the number pattern establish a CA/QC issuer at a lower assurance.
- **D12A-3. The vision response contract changes only by the `text_layout` document method (V2, C12).** OCR confidence enters the blur verdict in `packages/checks` (C9), where the OCR lines already are, not in vision, so the C6 `quality` object and `document_quality` keep their fields.
- **D12A-4. Synthetic Quebec-format cards (the C36 amendment, §3.1)** are always specimen-marked and never committed as images.
- **Q12A-3.** The real Quebec PDF417's exact AAMVA version, file type and jurisdiction subfile are unknown here. They must not be learned from the owner's card in logs. C4's tolerance cases are the known real-world deviations; the owner's retest decides whether more are needed.
