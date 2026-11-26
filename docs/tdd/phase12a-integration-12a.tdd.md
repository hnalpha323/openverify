# Phase 12A, Workflow 12A Stage 3: integration-12a (TDD evidence)

Agent: `integration-12a`, alone and last in Workflow 12A, after contracts-12a (`b7a249af1`), capture-12a (`0b54b40cf`, `56820fde1`, `8aacde893`), vision-12a (`5b38ea794`) and checks-12a (`29456b4d6`). Base `4ea2493bf`. Host: WSL2, Docker Desktop. Every command ran after `source scripts/env.sh`. Heavy runs (the vision suite, the image builds, the package suites, Gradle) ran one at a time under `flock /tmp/openverify-heavy.lock`, and commits were path-scoped under `flock -w 120 /tmp/openverify-git.lock`.

- Nothing was pushed or dispatched. The docker project `openverify-test` was not touched: no container of it was stopped, started or recreated. Its containers keep running the images they started from; the `11c-local` tags were rebuilt as CLAUDE.md shows.
- No real card, no owner photo and no live OCR text was read. Every image is a capture of `services/vision/tools/synthetic_quebec.py` (the invented SPECIMEN holder TREMBLAY / MARIE, licence T1234-567890-12) or a Phase 3 Utopia variant, and the only face is person A's public-domain portrait of `fixtures/manifest.json`. The exploration scripts ran from the session scratchpad and printed shapes and verdicts, never the text read.

## 1. End to end on the synthetic captures (task step 1)

**Method.** Each capture of `synthetic_quebec.CAPTURES` was photographed on both sides: the front with person A's portrait, so that the portrait checks see a face, and the standard back. Both sides were posted to `/v1/analyze/government-id` of the vision app in process (`TestClient(create_app(settings))`), with the real YuNet, SFace and PP-OCRv6 models of `models/`. The answers were then parsed by the API's zod schema (`apps/api/src/vision/schemas.ts`), extracted with `extractGovernmentId`, checked with `evaluateGovernmentIdChecks` under the seeded default template "Government ID and selfie", and decided with `decideVerification`.

Three modes were run per capture:
- **both**: the barcode and the front;
- **viz**: the front's printed text alone, the decoded barcode removed from the back;
- **barcode**: the barcode alone, the front's OCR lines removed.

`id_compromised_detection` was left out of the decision column only, because every synthetic card prints SPECIMEN by design (C36 as amended by Phase 12A §3.1). With it, every row is `failed` on `specimen_marker_found` alone. The blur thresholds are the corrected calibration of §2.1 (67.1 and 8,583.33).

**Vision, per capture** (scratchpad harness, then `tools/quebec_e2e.py` for the four committed captures):

```text
flat 2.8s            front full_frame 20 lines portrait, docq 688.1 | back full_frame 5 lines, PDF417 = payload, docq 619.4
phone-1080 4.0s      front text_layout 18 lines portrait, docq 297.0 | back text_layout 5 lines, PDF417 = payload, docq 267.9
phone-1080-soft 3.8s front text_layout 15 lines portrait, docq 95.5  | back text_layout 5 lines, PDF417 = payload, docq 89.9
phone-1080-blur 3.7s front text_layout 15 lines portrait, docq 17.6  | back text_layout 5 lines, no barcode, docq 19.5
phone-1080-motion    front text_layout 15 lines portrait, docq 50.5  | back text_layout 6 lines, no barcode, docq 47.8
phone-1080-tilt 3.7s front text_layout 17 lines portrait, docq 312.8 | back text_layout 5 lines, PDF417 = payload, docq 277.6
phone-1080-glare     front text_layout 17 lines portrait, docq 263.4 | back text_layout 5 lines, PDF417 = payload, docq 272.8
phone-1080-q75       front text_layout 17 lines portrait, docq 294.9 | back text_layout 5 lines, PDF417 = payload, docq 265.9
phone-full 5.1s      front contour 21 lines portrait, docq 858.6     | back contour 5 lines, PDF417 = payload, docq 781.7
dense back: flat, phone-1080, -soft, -tilt, -q75, phone-full decode exactly the payload; -glare does not (vision-12a's known limit)
```

"PDF417 = payload" means the decoded bytes equal `Photo.payload` exactly. Every 1080x1920 frame is found by the `text_layout` fallback (V2), and the API schema accepts that method (C12).

**Fields, checks and decision, per capture and mode.** The task's four variants are flat (sharp), phone-1080 (phone JPEG), phone-1080-soft (mild blur) and phone-1080-tilt (perspective); the other captures are shown for completeness.

| Capture | Mode | Required fields | `id_blur_detection` | `id_extracted_properties_detection` | `id_handwriting_detection` (advisory) | Decision without the specimen check |
|---|---|---|---|---|---|---|
| flat | both | 5/5 | passed | passed | passed | passed |
| flat | viz | 5/5 | passed | passed | passed | needs_review |
| flat | barcode | 5/5 | passed | passed | passed | needs_review |
| phone-1080 | both | 5/5 | passed | passed | passed | passed |
| phone-1080 | viz | 5/5 | passed | passed | passed | needs_review |
| phone-1080 | barcode | 5/5 | passed | passed | passed | needs_review |
| phone-1080-soft | both | 5/5 | passed | passed | passed | passed |
| phone-1080-soft | viz | 5/5 | passed | passed | passed | needs_review |
| phone-1080-soft | barcode | 5/5 | passed | passed | passed | needs_review |
| phone-1080-tilt | both | 5/5 | passed | passed | passed | passed |
| phone-1080-tilt | viz | 5/5 | passed | passed | passed | needs_review |
| phone-1080-tilt | barcode | 5/5 | passed | passed | passed | needs_review |
| phone-1080-q75 | both / viz / barcode | 5/5 each | passed | passed | passed | passed / needs_review / needs_review |
| phone-full | both / viz / barcode | 5/5 each | passed | passed | passed | passed / needs_review / needs_review |
| phone-1080-glare | both / viz / barcode | 5/5 each | passed | passed | **failed** (both, viz) / passed | passed / needs_review / needs_review |
| phone-1080-blur | both / viz | 4/5 (birthdate missing) | failed (`image_blurry`) | not_applicable (`required_fields_missing`) | passed | failed |
| phone-1080-motion | both / viz | 4/5 (birthdate missing) | failed (`image_blurry`) | not_applicable (`required_fields_missing`) | passed | failed |

How to read the table:
- **The five fields.** They come out of the barcode alone, the printed front alone, and both together on every legible capture. With both, every field has the sources `barcode` and `viz`, and none disagrees. From the front, the names are read via `layout`, the number via `pattern`, and the birth date via `label`.
- **The issuer.** With the barcode it is AAMVA 604428, CA/QC. From the front alone there is no issuer, so `id_number_format_inconsistency_detection` and `id_mrz_detection` answer `input_missing` and the verification goes to review. That is plan D12A-2, as designed.
- **The barcode-alone mode** goes to review because `id_extraction_inconsistency_detection` has no second source to compare (`input_missing`). It is a synthetic mode: a real front always yields some text.
- **Blur and motion** are failed by `id_blur_detection`, and the missing birth date goes to review rather than failing, as C6 and C7 intend. The decision is `failed` because a blurred capture should be retaken.
- **Glare:** see §4, finding F3.

**Before the fixes**, under the shipped `min-document-blur-score` 96.56 and under vision-12a's proposed 100.19 and 12,107.29, `phone-1080-soft` failed `id_blur_detection` in all three modes (front 95.5, back 89.9). §2.1 has the cause.

## 2. Integration defects, fixed test-first (task step 2)

### 2.1 The blur calibration measured what the analysis does not (borrowed: `services/vision/tools/calibrate_blur_phase12a.py`, its test, `docs/calibration/blur-phase12a.md`)

**Cause.** vision-12a calibrated `measure_document_quality` through the true quad on the printed lines' tight boxes. The analysis measures it on the OCR's own boxes, which are padded. The probe below (scratchpad `blur_probe.py`) shows the same rectified card on both sets of boxes:

```text
phone-1080         front printed   439.1 (0.097 of card, 25 boxes)  ocr   302.1 (0.150, 17)  whole    52.3
phone-1080         back  printed   410.2 (0.037 of card, 5 boxes)  ocr   271.4 (0.059, 5)  whole   178.5
phone-1080-soft    front printed   139.3 (0.097 of card, 25 boxes)  ocr    93.1 (0.156, 16)  whole    19.3
phone-1080-soft    back  printed   134.1 (0.037 of card, 5 boxes)  ocr    90.2 (0.058, 5)  whole    70.6
phone-1080-motion  front printed    74.9 (0.097 of card, 25 boxes)  ocr    51.1 (0.160, 15)  whole    12.3
phone-1080-motion  back  printed    66.6 (0.037 of card, 5 boxes)  ocr    48.0 (0.054, 6)  whole    32.0
phone-1080-blur    front printed    25.7 (0.097 of card, 25 boxes)  ocr    16.4 (0.170, 15)  whole     5.5
flat               front printed   616.1 (0.098 of card, 25 boxes)  ocr   430.2 (0.148, 19)  whole    71.8
phone-full         front printed  1111.5 (0.098 of card, 25 boxes)  ocr   845.4 (0.132, 21)  whole   123.8
```

The OCR's boxes cover about 1.5 times the area, and the card scores about 0.68 times as much on them. The measure still separates the sets: the ratio between them is unchanged. Only the scale was wrong.

**RED.** A new test judges every legible and blurred capture, as `analyze_government_id_side` measures it, against the values the calibration document proposes:

```text
$ flock -w 600 /tmp/openverify-heavy.lock uv run --frozen pytest tests/test_document_blur_phase12a.py --no-cov -q -p no:cacheprovider -k analysis
E       AssertionError: (90.795, 100.19)
E       AssertionError: (89.8641, 100.19)
FAILED tests/test_document_blur_phase12a.py::test_the_proposed_thresholds_judge_the_analysis_as_calibrated[front-phone-1080-soft]
FAILED tests/test_document_blur_phase12a.py::test_the_proposed_thresholds_judge_the_analysis_as_calibrated[back-phone-1080-soft]
2 failed, 16 passed, 11 deselected in 46.20s
```

**GREEN.** The tool now measures each capture through `analyze_government_id_side`. It uses the real text models and a detector that finds no face, since faces do not enter the measure and the synthetic portrait is a silhouette. The table was then regenerated:

```text
$ flock -w 600 /tmp/openverify-heavy.lock uv run --frozen python tools/calibrate_blur_phase12a.py
| `min-document-blur-score` | 67.1 | 89.86 (phone-1080-soft back) | 50.10 (phone-1080-motion front) | 1.339 |
| `min-document-tenengrad` | 8583.33 | 10885.2 (phone-1080-soft front) | 6768.2 (phone-1080-motion back) | 1.268 |
$ flock -w 900 /tmp/openverify-heavy.lock uv run --frozen pytest tests/test_document_blur_phase12a.py --no-cov -q -p no:cacheprovider
29 passed in 103.69s (0:01:43)
```

The margins match vision-12a's (1.338 and 1.275 before). The recomputation test now allows 2%, because ONNX Runtime's CPU kernels may round differently on another machine and move an OCR box by a pixel. The tests that need the text models skip without them, as the other model tests do; CI fetches the models. The prose of the calibration document says why the method changed. It also records that through the OCR's boxes the same-scene pair is 1.25 (front) and 1.24 (back) apart on `blur_score`, at the V3 bound. The V3 test itself still measures on the printed boxes, where the ratio is 1.21.

Commit `279b8e441` (`fix(vision)`).

### 2.2 OCR legibility rescued the C36 blurred card at the calibrated thresholds (borrowed: `packages/checks/src/phase1/government-id-checks.ts`, `blur-legibility.test.ts`)

**Cause.** C9 rescues a document-blurry side when its OCR reads at least 8 lines at a median confidence of 0.9 or more, provided the side reaches `LEGIBLE_MIN_SHARPNESS_SHARE` of each threshold. checks-12a set that share at 0.5 on the old scale. The text models read blurred print with high confidence. The C36 Utopia variants were rerun in process with the real models (scratchpad `utopia_probe.py`):

```text
happy front doc full_frame dq (677.812, 38249.7257) lines 18 median 1.0
blurred front doc full_frame dq (44.7394, 7624.5264) lines 18 median 0.999
screen-recapture front doc full_frame dq (195.0625, 16756.0971) lines 18 median 0.997
on-background front doc contour dq (349.306, 26547.4822) lines 18 median 1.0
```

At 67.1 and 8,583.33 the floor at one half is 33.6 and 4,292. The `blurred` front (44.74 and 7,624.5, 18 lines at 0.999) clears it, and so does the `phone-1080-motion` front (50.49 and 6,727, 15 lines at 0.976), so both would pass `id_blur_detection` on their OCR.

**RED** (the thresholds are pinned in the test and checked against the calibration document):

```text
$ pnpm exec vitest run src/phase1/blur-legibility.test.ts --coverage.enabled=false
     × never rescues the C36 blurred front by its confident OCR 12ms
     × never rescues the motion-blurred phone front by its confident OCR 2ms
      Tests  2 failed | 12 passed (14)
```

The received value was `status: 'passed'` with `legible-by-ocr-sides: ['front']`.

**GREEN.** `LEGIBLE_MIN_SHARPNESS_SHARE` is now 0.8. Every capture the calibration calls blurred scores at most 1 / 1.339 = 0.75 of the blur threshold, and the C36 `blurred` front scores 0.67, so all of them stay failed. A side within a fifth under the thresholds can still be rescued. Four existing expectations at 60 against 96.56 (0.62, a rescue under the old floor) now use 85 (0.88). The plainly-blurred case now uses 77 (0.797) with a Tenengrad of 4,300 (0.79).

```text
$ pnpm exec vitest run src/phase1/blur-legibility.test.ts --coverage.enabled=false
      Tests  14 passed (14)
$ flock -w 900 /tmp/openverify-heavy.lock pnpm --filter @openverify/checks test
 Test Files  189 passed (189)
      Tests  3938 passed (3938)
All files          |   98.76 |    91.45 |   99.35 |   98.75 |
```

Commit `8c382b638` (`fix(checks)`).

### 2.3 The end-to-end proof as committed tests (`services/vision/tools/quebec_e2e.py`, `contracts/fixtures/quebec-dl/vision/`, `apps/api/src/jobs/quebec-phone-capture.test.ts`)

The proof of §1 is now repeatable, in two parts:
- **The service's answers.** `tools/quebec_e2e.py` records the answers for the four named variants in `contracts/fixtures/quebec-dl/vision/<capture>.json`. That is a borrowed path: the generated, synthetic answers sit beside contracts-12a's frozen fixtures, which are not edited. `tests/test_quebec_e2e.py` checks that each file validates, that the back carries exactly the payload, and that the document and portrait are found. It also checks that each file is still the service's answer today: the same text lines, method and barcodes, and the measures within 2%.
- **The API side.** `quebec-phone-capture.test.ts` runs what the worker runs on these answers, as §1 describes. For each capture it checks that the five fields come out in all three modes with the right sources, that the names are read via `layout` and the number via `pattern`, and that the issuer comes from the barcode only. Every capture check passes at the calibrated thresholds, and the only required failure is the specimen marker. Without the specimen check, the decision is `passed` with the barcode and `needs_review` from the printed text alone.

**RED** (before the answers were recorded):

```text
$ flock -w 900 /tmp/openverify-heavy.lock uv run --frozen pytest tests/test_quebec_e2e.py --no-cov -q -p no:cacheprovider
E       AssertionError: assert [] == ['flat', 'pho...ne-1080-tilt']
E       FileNotFoundError: [Errno 2] No such file or directory: '.../contracts/fixtures/quebec-dl/vision/flat.json'
$ pnpm exec vitest run src/jobs/quebec-phone-capture.test.ts --coverage.enabled=false
      Tests  32 failed (32)    (ENOENT on each of the four answers)
```

**GREEN:**

```text
$ flock -w 900 /tmp/openverify-heavy.lock uv run --frozen python tools/quebec_e2e.py && pnpm exec prettier --write contracts/fixtures/quebec-dl/vision/*.json
flat; front: document full_frame, 20 lines, 0 barcodes, portrait True, document blur 688.1202; back: document full_frame, 5 lines, 1 barcodes, portrait False, document blur 619.3625
phone-1080; front: document text_layout, 18 lines, 0 barcodes, portrait True, document blur 296.9593; back: document text_layout, 5 lines, 1 barcodes, portrait False, document blur 267.9298
phone-1080-soft; front: document text_layout, 15 lines, 0 barcodes, portrait True, document blur 95.4788; back: document text_layout, 5 lines, 1 barcodes, portrait False, document blur 89.8641
phone-1080-tilt; front: document text_layout, 17 lines, 0 barcodes, portrait True, document blur 312.7602; back: document text_layout, 5 lines, 1 barcodes, portrait False, document blur 277.6247
$ flock -w 900 /tmp/openverify-heavy.lock uv run --frozen pytest tests/test_quebec_e2e.py --no-cov -q -p no:cacheprovider
15 passed in 25.79s
$ pnpm exec vitest run src/jobs/quebec-phone-capture.test.ts --coverage.enabled=false
      Tests  32 passed (32)
```

**The thresholds matter.** With the calibration document temporarily set back to vision-12a's 100.19 and 12,107.29 (then restored), the same API test fails on the soft capture:

```text
     × passes the capture checks at the calibrated blur thresholds 12ms
     × fails the SPECIMEN card on the specimen marker, by design, and on nothing else required 8ms
     × passes with the barcode, and goes to review from the printed text alone (D12A-2) 7ms
      Tests  3 failed | 29 passed (32)
```

Commit `753b21d4e` (`test(api)`).

### 2.4 Two stale generated documents (borrowed: `docs/calibration/blur-phase12a.md`, `docs/checks/catalog.md`)

The first `pnpm test` (below) failed in `@openverify/docs-tools` on what Stage 2 left behind:
- `docs/calibration/blur-phase12a.md` had no calibration summary block (`calibration.test.ts`: `docs/calibration/blur-phase12a.md: expected [ 'no summary block' ] to deeply equal []`). Every report under `docs/calibration/` needs one (C279.1).
- `docs/checks/catalog.md` differed from a fresh render (`check-catalog.test.ts`, `index.test.ts`). The cause was checks-12a's new keys `missing-fields-outcome`, `legible-text-min-confidence` and `legible-text-min-lines`.

The fix adds the block, which reports the proposed 67.1 and 8,583.33 as `reported` rows, and re-renders the catalog with `pnpm --filter @openverify/docs-tools docs:catalog`:

```text
routes: 1 files written
catalog: 4 files written            (only docs/checks/catalog.md changed)
$ pnpm exec vitest run --coverage.enabled=false        (packages/docs-tools)
 Test Files  51 passed (51)
      Tests  444 passed (444)
```

Commit `8a5201004` (`docs(calibration)`). Stage 3 re-renders the catalog again once it applies the thresholds.

## 3. Images and gates (task steps 3 and 4)

Every Docker step and every suite ran under `flock /tmp/openverify-heavy.lock`. The images were built at `753b21d4e`; the later commit `8a5201004` touches only documents.

**Images.** All five changed since `4ea2493bf`:
- api, from `packages/checks`, `core`, `contracts` and `apps/api`;
- dashboard, from `apps/dashboard` and `packages/contracts`;
- flow, from `apps/flow`;
- vision, from `services/vision`;
- code-runner, because `@openverify/workflow-engine` depends on `core` and `contracts`.

Each was built as CLAUDE.md shows:

```text
BUILD ok api 193s
BUILD ok dashboard 132s
BUILD ok flow 604s             (the times include waiting for the lock)
BUILD ok flow-noguidance 861s
BUILD ok code-runner 184s
BUILD ok vision 242s
$ bash infra/tests/images.test.sh <mode>        (one call each)
static # 149 passed, 0 failed
pins # 28 passed, 0 failed
override # 33 passed, 0 failed
api # 58 passed, 0 failed
dashboard  (the first call's flock -w 1800 expired while pnpm test held the lock; nothing ran) -> again alone: # 27 passed, 0 failed
flow # 33 passed, 0 failed
flow-noguidance # 32 passed, 0 failed
vision # 28 passed, 0 failed
code-runner # 27 passed, 0 failed
```

**Gates:**

```text
$ pnpm format:check                      All matched files use Prettier code style!   (2 min 32 s)
$ pnpm lint                              exit 0
$ pnpm typecheck                         exit 0        (both 499 s)
$ pnpm test   (first call, 593 s)        exit 1: @openverify/docs-tools 5 failed (section 2.4); turbo stopped there
$ pnpm test   (after 8a5201004, 2,156 s, load 4.2 at the start and 5.6 at the end)
 Tasks:    20 successful, 20 total
  api 11,046 (93.43% statements); dashboard 7,386 (95.68%); contracts 4,906; checks 3,938 (98.76%);
  db 2,395; workflow-engine 2,042; core 2,013 (99.24%); flow 1,741 + 1 skipped (95.2%); watchlist 840;
  flow-spec 527; node 508; config 459; docs-tools 444; emrtd 338; signals 192; e2e 161; ui 58; react 55;
  js 19; demo-web 18
$ (cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools && uv run pytest)
All checks passed! / 222 files already formatted / Success: no issues found in 85 source files
Required test coverage of 80% reached. Total coverage: 97.47%
======================= 2859 passed in 815.42s (0:13:35) =======================
$ pnpm --filter @openverify/flow e2e      349 passed (2.3m)
$ (cd android && ./gradlew testDebugUnitTest testAndroidHostTest koverVerify assembleDebug :openverify-sdk:assemble lint)
BUILD SUCCESSFUL in 3m 29s
346 actionable tasks: 17 executed, 329 up-to-date
$ pnpm release:check                     release:check (default): 0 errors, 64 owner items
```

Notes on the gates:
- **The vision suite** grew from vision-12a's 2,826 tests to 2,859: the 18 analysis-threshold cases and the 15 end-to-end tests.
- **Android.** No Android source changed after capture-12a's gate. Gradle found 329 of 346 tasks up to date, the test tasks among them.
- **Which e2e suite.** The computed task names `pnpm --filter @openverify/e2e e2e` "for the mocked flow suite". `e2e/README.md` says the mocked flow suite is `pnpm --filter @openverify/flow e2e`, and that is the suite run here. The full-stack suite (`@openverify/e2e`) was not run, because it serves its processes on the loopback ports that the running `openverify-test` stack holds (3000, 3001, 5173, 5432, 6379, 9000, 1025 and 8025). The orchestrator's validation runs it once that stack is down.
- **`apps/api test:integration`** was not run here. checks-12a asked Stage 3 to run it, and it belongs to the orchestrator's full validation.
- **Owner items.** `release:check` lists 64 owner items, against 63 at Workflow 11G's close. None is Phase 12A's; the count was not traced further.

## 4. Findings left open (not fixed here)

- **F1. Stage 3 must apply 67.1 and 8,583.33, not 100.19 and 12,107.29.** `GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_blur_detection` still holds the Phase 3 values (96.56, no Tenengrad); applying them is the orchestrator's step 1, and was not done here. Under 96.56 `phone-1080-soft` fails blur (front 95.5, back 89.9). The C9 floor is now 0.8 of whatever is applied.
- **F2. The checks calibration (C36) reads old-scale measurements.** Its committed Utopia measurements are on the Phase 3 measure (blurred 15.0). Under the Phase 12A vision, in this agent's in-process run on their text boxes, the Utopia cards score: genuine sides 349-775 (`on-background` 349.3 lowest, `happy` front 677.8), `low-resolution` front 142.1, `blurred` front 44.74, `screen-recapture` front 195.1. A rerun of that calibration with live analysers would move its blur rows. The `screen-recapture` front passes blur at 67.1 (it failed at 100.19); `id_electronic_replica_detection` is the check that targets it.
- **F3. `id_handwriting_detection` false positive under glare (advisory, beta).** On `phone-1080-glare` the 5-character given-name line sits under the generator's highlight. Its stroke excess is 0.82 with no confidence drop, so it scores 0.492 against 0.383, from the stroke term alone (0.6 × 0.82). The highlight washes out part of the strokes before the crop's global Otsu threshold. The check is advisory in the default template, so the decision is unchanged. A fix belongs to vision's stroke measure (skip or locally binarise a line partly under a clipped highlight) and needs the C36 handwriting calibration rerun, so it was not made in this stage. The other captures' worst field lines score 0.08-0.19.
- **F4. The back of a Quebec licence never qualifies for the C9 rescue.** It prints about 5 lines, under `legible-text-min-lines` 8. A soft back is judged on its document measure alone, which passes at 67.1 on every legible capture here. A decoded PDF417 on the side is stronger legibility evidence than OCR and could be a later rule.
- **F5. Dense back under glare stays undecoded** (vision-12a's deviation, confirmed end to end). The front still yields the five fields, and the verification goes to review.
