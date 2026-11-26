# TDD evidence: Phase 3, Workflow 3A Stage 2, `vision-ocr`

Scope (plan `docs/plans/phase-3.plan.md`, C32.1 `text` and `mrz`, C33 OCR models): the PP-OCRv6 small text models in `models/manifest.json`, the OCR runtime vendored from RapidOCR v3.10.0 on the existing onnxruntime (no `rapidocr`, `pyclipper` or `shapely`), visual-zone text lines with stroke-width statistics, and MRZ localisation with line OCR restricted to `[A-Z0-9<]`.

Every command ran from `services/vision` after `source scripts/env.sh`, with `COVERAGE_FILE=/tmp/openverify-cov-vision-ocr` for pytest and `--cache-dir /tmp/openverify-mypy-vision-ocr` for mypy. Output is abbreviated.

## 0. Stub (`0c1097e`)

`chore(vision)`: the names the RED tests import (`ocr/runtime.py`, `dictionary.py`, `geometry.py`, `detection.py`, `recognition.py`, `strokes.py`, the `ocr` constants, `mrz_locate.MRZ_ALPHABET`, `find_mrz_lines`, `guess_format`), with the Stage 1 behaviour unchanged.

```
$ uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-vision-ocr
Success: no issues found in 28 source files
$ uv run --frozen pytest tests/test_ocr.py tests/test_mrz_locate.py tests/test_analysis_v2.py tests/test_app_analyze.py --no-cov -q
40 passed in 1.66s
```

## 1. C33: the text models in the manifest

### RED

`tests/test_manifest.py::test_manifest_pins_the_pp_ocrv6_small_text_models_at_their_commits`: the detector, the recognizer and the recognizer's `inference.yml` (its character dictionary) are pinned at PaddlePaddle's Hugging Face commits `28fe589` and `b8f84f0`, under Apache-2.0, with the model card at the commit as the licence URL.

```
$ uv run --frozen pytest tests/test_manifest.py --no-cov -q
E       KeyError: 'text_recognition_ppocrv6_small_dict'
FAILED tests/test_manifest.py::test_manifest_pins_the_pp_ocrv6_small_text_models_at_their_commits[text_detection_ppocrv6_small]
FAILED tests/test_manifest.py::test_manifest_pins_the_pp_ocrv6_small_text_models_at_their_commits[text_recognition_ppocrv6_small]
FAILED tests/test_manifest.py::test_manifest_pins_the_pp_ocrv6_small_text_models_at_their_commits[text_recognition_ppocrv6_small_dict]
3 failed, 4 passed in 0.26s
```

### GREEN

Three entries in `models/manifest.json`. Each SHA-256 was computed from the downloaded file (`sha256sum`) and equals the Git LFS oid the Hugging Face API lists at the commit (`/api/models/PaddlePaddle/<repo>/revision/<commit>?blobs=true`). The licences were read from the model cards at the pinned commits (`license: apache-2.0`, author PaddlePaddle; neither repository has a LICENSE file) and from PaddleOCR's `LICENSE` at tag v3.7.0 (`b03f464`, the Apache License 2.0 text).

| Entry | File | Size | SHA-256 |
|---|---|---|---|
| `text_detection_ppocrv6_small` | `ppocrv6_small_det.onnx` | 9,880,512 | `d73e0058…c9410e` |
| `text_recognition_ppocrv6_small` | `ppocrv6_small_rec.onnx` | 21,159,378 | `5435fd74…a24634` |
| `text_recognition_ppocrv6_small_dict` | `ppocrv6_small_rec_inference.yml` | 150,579 | `ab078671…c77d1` |

The recognizer's character dictionary has no file of its own in the official repository: it is `PostProcess.character_dict` in `inference.yml`, so the manifest pins that file.

```
$ python3 scripts/fetch_models.py
text_detection_ppocrv6_small: downloaded …/models/ppocrv6_small_det.onnx (Apache-2.0)
text_recognition_ppocrv6_small: downloaded …/models/ppocrv6_small_rec.onnx (Apache-2.0)
text_recognition_ppocrv6_small_dict: downloaded …/models/ppocrv6_small_rec_inference.yml (Apache-2.0)
$ uv run --frozen pytest tests/test_manifest.py tests/test_fetch_models.py --no-cov -q
52 passed in 2.07s
```

`.gitignore` ignores `models/**/*.onnx`, not `*.yml`, so the downloaded dictionary shows as untracked; reported as a follow-up for the `.gitignore` owner (`models/**/*.yml`).

## 2. The vendored OCR runtime (C32.1, C33)

RapidOCR v3.10.0 (`RapidAI/RapidOCR`, commit `bd941da`) was read in full for `python/rapidocr/ch_ppocr_det/{main,utils}.py`, `ch_ppocr_rec/{main,utils}.py`, `utils/process_img.py`, `inference_engine/onnxruntime/main.py`, `config.yaml`, `default_models.yaml`, `LICENSE` (Apache-2.0, "Copyright (c) 2021 RapidOCR Authors") and `MODEL_LICENSES.md`. The repository has no NOTICE file. Its det and rec mains carry PaddlePaddle's 2020 Apache-2.0 header, because the DB post-processing and CTC decoding come from PaddleOCR.

The modules below are rewritten from that source with attribution headers. The arithmetic is RapidOCR's:
- `ocr/geometry.py`: `get_mini_boxes`, `order_points_clockwise`, `get_rotate_crop_image`. **`unclip` is rewritten without pyclipper or shapely.** The distance is `cv2.contourArea * ratio / cv2.arcLength`, and the outline is the Minkowski sum of the convex box with a disc, built from the moved sides plus arc points and closed with `cv2.convexHull`. `cv2.minAreaRect` of that outline is the box grown by the distance on every side, which is what pyclipper's round-join offset gives for a convex box.
- `ocr/detection.py`: `resize_image_within_bounds`, `DetPreProcess`, `DBPostProcess` (`boxes_from_bitmap`, `box_score_fast`, `filter_det_res`), `sorted_boxes`, `map_boxes_to_original`. Defaults are from `config.yaml`: `limit_side_len` 736 `min`, `thresh` 0.3, `box_thresh` 0.5, `unclip_ratio` 1.6, dilation on, 1,000 candidates, sides bounded to 30–2,000 pixels. Four deliberate changes:
  - normalisation uses the model's own `inference.yml` (ImageNet mean and std), where RapidOCR's generic config has 0.5/0.5. On the synthetic card both read identical text;
  - a side never rounds to 0, so a hostile 1 × 40,000 upload does not raise;
  - when both bounds apply, the two size ratios are multiplied together. RapidOCR overwrites the first;
  - crops are taken from the source image in source pixels.
- `ocr/recognition.py`: `resize_norm_img` (48 pixels high, scaled to [-1, 1], right-padded, batches of 6 sorted by aspect ratio, at least 320 wide) and `CTCLabelDecode`. The class table is the blank, the dictionary, then a space. **New:** decoding can be limited to an alphabet. At each step the decoder takes the most probable allowed class, so a step whose best allowed class is the blank stays empty. It never adds a character the model did not score at that step, and the confidence is that class's own probability, not renormalised.
- `ocr/dictionary.py` (new): a strict reader for `PostProcess.character_dict` in `inference.yml`, without a YAML dependency.
- `ocr/strokes.py` (new): Otsu binarisation, with the ink being the class that does not dominate the border. The Euclidean distance transform's local maxima are the medial axis, and the width there is `2d - 1`.
- `ocr/runtime.py` (new): a lazily created onnxruntime CPU session, thread-safe, with the memory arena off as in RapidOCR. A missing or unreadable file raises `ModelNotAvailableError`.

### RED (`52ca6e7`, after the stub `4316c1f`)

```
$ uv run --frozen pytest tests/test_ocr_dictionary.py tests/test_ocr_geometry.py tests/test_ocr_detection.py tests/test_ocr_recognition.py tests/test_ocr_strokes.py tests/test_ocr_runtime.py --no-cov -q
     44 NotImplementedError
     11 Failed: DID NOT RAISE DictionaryError
      6 assert None is not None
      … (the stub dictionary returns (), the stub stroke statistics None)
67 failed, 3 passed, 1 error in 0.77s
```

The 3 that passed are the "too small" and "no strokes" stroke cases and the read-once dictionary case: the stubs already answer `None` and `()` there. The error is the thread-exception warning from the concurrent-load test, which pytest's `filterwarnings = error` raises.

### GREEN

Three expectations in the RED tests were my own arithmetic mistakes, corrected to RapidOCR's numbers:
- the 4000 × 3000 image bounds to 1504 × **1984**, because Python rounds 62.5 to 62;
- the box score of a 100 × 20 blob of 0.9 is the mean over the **dilated** 101 × 21 box (0.849);
- the mapped-back margins are now computed from the unclip distance on the map rather than a constant.

```
$ uv run --frozen pytest tests/test_ocr_dictionary.py … tests/test_ocr_runtime.py -q --cov=openverify_vision.ocr
src/openverify_vision/ocr/detection.py          126      2     26      3    97%
src/openverify_vision/ocr/dictionary.py          73      1     24      1    98%
src/openverify_vision/ocr/geometry.py            60      0      6      0   100%
src/openverify_vision/ocr/recognition.py         77      0     14      0   100%
src/openverify_vision/ocr/runtime.py             46      0      6      0   100%
src/openverify_vision/ocr/strokes.py             26      1      4      1    93%
70 passed in 1.83s
```

## 3. The OCR engine and visual-zone `text` (C32.1)

`OcrEngine` loads the detector, the recognizer and the dictionary lazily, under a lock, once. `read_text` detects, crops (`rotate_crop`), recognises in batches and drops lines under RapidOCR's `text_score` of 0.5 or empty after trimming. It keeps at most 200 lines, each cut to 200 **UTF-16 code units**: the API's zod schema counts a string's JS length, and the dictionary has 904 characters outside the Basic Multilingual Plane, so a 200-code-point cut could still break the contract. Each line gets the stroke statistics of its crop. `recognize(images, alphabet=...)` is the MRZ's line reader. `visual_zone(lines, mrz_box)` drops the lines whose centre lies in the MRZ, so `text` is the visual zone, as in the golden fixture.

**Models absent ⇒ not measured.** Without the text models (or with a dictionary the reader refuses), `load()` logs a warning without PII and returns `False`, `read_text` reads nothing, and both versions are `null`. That is the Stage 1 contract ("`text_detector` and `text_recognizer` null while no OCR model ran"). A failure while a loaded model runs is raised, never read as no text.

### RED (`a2d0e08`)

```
$ uv run --frozen pytest tests/test_ocr.py tests/test_ocr_models.py --no-cov -q
FAILED tests/test_ocr.py::test_without_the_text_models_nothing_is_read_and_no_model_is_named
FAILED tests/test_ocr.py::test_the_loaded_engine_names_its_models
FAILED tests/test_ocr.py::test_each_line_comes_back_in_reading_order_with_its_box_confidence_and_strokes
FAILED tests/test_ocr.py::test_a_line_is_cut_to_200_utf16_code_units[astral]
FAILED tests/test_ocr.py::test_at_most_200_lines_are_reported
FAILED tests/test_ocr.py::test_an_inference_failure_is_raised_not_read_as_no_text
… (16 in all: the stub loads nothing and reads nothing)
ERROR tests/test_ocr_models.py::test_reads_the_visual_zone_of_a_rendered_card   (fixture: assert engine.load() is True)
16 failed, 5 passed, 2 errors in 0.81s
```

### GREEN

```
$ uv run --frozen pytest tests/test_ocr.py tests/test_ocr_models.py --no-cov -q -s
'UTOPIA'           read 'UTOPIA'             accuracy 1.000
'Given names'      read 'Given names'        accuracy 1.000
'14 02 1990'       read '14 02 1990'         accuracy 1.000
'X12K45P78'        read 'X12K45P78'          accuracy 1.000
… (16 lines)
visual zone: 16 lines, mean per-character accuracy 1.0000
23 passed in 1.93s
$ uv run --frozen pytest tests/test_ocr*.py tests/test_mrz_locate.py tests/test_analysis_v2.py tests/test_app_analyze.py --no-cov -q
132 passed in 3.86s
```

## 4. MRZ localisation and line OCR (C32.1 `mrz`)

### RED

`tests/test_mrz_locate.py` (localisation on rendered zones, `guess_format`, `locate_mrz` with a fake line reader) and `tests/test_mrz_locate_models.py` (the real recognizer on every well-formed ICAO vector, clean and degraded; the 1,600-pixel timing).

```
$ uv run --frozen pytest tests/test_mrz_locate.py tests/test_mrz_locate_models.py --no-cov -q
FAILED tests/test_mrz_locate.py::test_finds_each_line_of_the_zone_top_to_bottom[TD1]
FAILED tests/test_mrz_locate.py::test_finds_a_slightly_skewed_zone
FAILED tests/test_mrz_locate.py::test_the_format_follows_the_line_count_length_and_document_code[mrv-a]
FAILED tests/test_mrz_locate.py::test_reads_each_line_with_the_mrz_alphabet
FAILED tests/test_mrz_locate_models.py::test_reads_the_icao_examples[clean]
… (19 in all: the stub finds no line and guesses no format)
19 failed, 13 passed in 7.10s
```

### GREEN

`mrz_locate.py`:
1. On the lower half of the document, a blackhat with a kernel about one character wide (2.5% of the document width, so it holds from TD1 to TD3);
2. the horizontal Scharr gradient, a closing, Otsu, a wider horizontal closing and one erosion;
3. the components at least 60% of the width and 8 times wider than tall;
4. the lowest run of two or three of them, at most 1.5 line heights apart and within 15% in width.

Each line is cropped along its own slope (`minAreaRect`, padded 0.6 line heights along and 0.35 across) and read with `OcrEngine.recognize(..., alphabet=MRZ_ALPHABET)`. A line read as nothing is left out, fewer than two lines is no zone, and lines are cut to the contract's 64 characters. `format_guess` comes from the count and lengths (±2), with visas told apart by the document code `V`.

```
$ uv run --frozen pytest tests/test_mrz_locate.py tests/test_mrz_locate_models.py --no-cov -q -s
[clean] icao-9303-p5-td1: 87/90 ['1<UT0D231458907<<<<<<<<<<<<<<<', '7408122F1204159UT0<<<<<<<<<<<6', 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<']
[clean] icao-9303-p6-td2: 71/72 ['I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<', 'D231458907UT07408122F1204159<<<<<<<6']
[clean] icao-9303-p4-td3: 88/88 …   [clean] icao-9303-p7-mrv-a: 88/88 …   [clean] icao-9303-p7-mrv-b: 72/72 …
[clean] 10 MRZs, per-character accuracy 827/838 = 0.9869, confusions {'I->1': 3, 'O->0': 8}
[jpeg-60] 10 MRZs, per-character accuracy 825/838 = 0.9845, confusions {'I->1': 3, 'O->0': 10}
[scale-0.6] 10 MRZs, per-character accuracy 827/838 = 0.9869, confusions {'I->1': 3, 'O->0': 8}
[blur-1.0] 10 MRZs, per-character accuracy 827/838 = 0.9869, confusions {'I->1': 3, 'O->0': 8}
OCR + MRZ on both sides of a 1600 x 1009 card: median 1.377 s of [1.579, 1.377, 1.377, 1.372, 1.37]
32 passed in 13.82s
```

The test reads every well-formed vector in `contracts/fixtures/mrz/` at run time, so it picked up the two vectors `checks-logic` added meanwhile (10 MRZs).

**C31.3 analysis of the misreads, so no fallback switch.** Every format was found and guessed right, and every line came back at its exact length. The only errors are a letter read as a digit in a letter-only position: `I→1` in the TD1 document code (`I<`), and `O→0` in the issuing state or nationality `UTO`. That is at most one character in any field, and exactly the class C31.3 lets the MRZ parser correct (a digit where the format needs a letter, one per field). The check-digit fields (document number, dates, composite) were all read right. PP-OCRv6 small therefore stays the recognizer.

For the record, in a scratch spike I ran the pre-approved fallback, RapidOCR's ONNX `en_PP-OCRv5_rec_mobile` (v3.10.0, SHA-256 `c3461add…924be8`, not added to the manifest), with the same pipeline on the 5 ICAO examples:
- clean renders: 344/410 = 0.839;
- scale 0.8: 0.924;
- scale 0.6: 0.993.

It dropped `<` fillers in long runs, so lines came back too short (`len` errors), which positional parsing cannot absorb. PP-OCRv6 small scored 0.988–0.990 on the same 5 under every condition. The fallback is worse, so there was no switch.

## 5. My marked blocks in `analysis.py` and `app.py`

- `analysis.py`: `text = ocr.visual_zone(reader.read_text(target), mrz.box)`. The MRZ lines are reported in `mrz` only, as in the golden fixture. `document.measure_document_quality` therefore gets the visual-zone boxes.
- `app.py` (`_government_id`): `reader.load()` before either side. `GovernmentIdAnalysis(model_versions=…)` is evaluated before the front side is analysed, so a lazy load inside `read_text` would leave a front-only first request naming no text model.

### RED (`09d18d4`; the fakes moved to `tests/ocr_fakes.py` in the green refactor `02c7a70`)

```
$ uv run --frozen pytest tests/test_ocr_composition.py --no-cov -q
E       Left contains 3 more items, first extra item: TextLine(text='I<UTOD231458907', …)
E       AssertionError: assert None == 'pp-ocrv6-small-det'
FAILED tests/test_ocr_composition.py::test_the_side_text_is_the_visual_zone_and_the_mrz_lines_stay_in_mrz
FAILED tests/test_ocr_composition.py::test_the_first_request_names_the_text_models_it_ran
2 failed, 2 passed in 1.50s
```

### GREEN

```
$ uv run --frozen pytest tests/test_ocr_composition.py tests/test_analysis_v2.py tests/test_app_analyze.py tests/test_app.py tests/test_app_concurrency.py tests/test_contract_fixtures.py --no-cov -q
89 passed in 5.85s
```

## 6. Attribution (`services/vision/NOTICE`, `THIRD_PARTY_LICENSES.md`)

### RED (`e3a4d05`)

```
$ uv run --frozen pytest tests/test_ocr_notice.py --no-cov -q
E       FileNotFoundError: [Errno 2] No such file or directory: '…/services/vision/NOTICE'
E       AssertionError: assert 'RapidOCR v3.10.0 (vendored source, commit `bd941da`' in '# Third-party licenses…'
2 failed, 3 passed in 0.10s
```

The three that passed check the headers of the vendored files, written with them in section 2.

### GREEN

- `services/vision/NOTICE` credits RapidOCR v3.10.0 (commit, copyright line, Apache-2.0) and PaddleOCR (its 2020 copyright line), lists the derived files and their sources, and names the runtime-loaded models (repository, commit, files). The models are not bundled.
- `THIRD_PARTY_LICENSES.md` gets:
  - §2.1.4, RapidOCR as vendored source;
  - §2.2, the `rapidocr` package marked not adopted;
  - §3, the three PP-OCRv6 files with size, SHA-256 and licence evidence, replacing the "to verify on adoption" PaddleOCR row, and the C33 fallback marked not adopted.

```
$ uv run --frozen pytest tests/test_ocr_notice.py --no-cov -q
5 passed in 0.04s
$ pnpm exec prettier --check THIRD_PARTY_LICENSES.md docs/tdd/phase3-vision-ocr.tdd.md models/manifest.json
All matched files use Prettier code style!
```

## 7. Pinning tests and two refinements

**Pinned after GREEN** (`04aa981`; these passed when written and are not RED evidence). They cover the branches the behaviour tests left open:
- the DB post-processing without dilation, a box still thin after unclip, and a box that shrinks to a few image pixels;
- a lone quote inside a quoted dictionary entry;
- a dot with too little medial axis;
- a long visual-zone line far above the MRZ;
- a fourth stacked line, with the zone keeping the lowest three.

`refactor` `413e598`: `OcrEngine.load()` takes its lock on every call. The unlocked fast path is gone, so the covered branches no longer depend on thread timing, and an uncontended lock costs nothing next to inference. With these, every `ocr/` module and `mrz_locate.py` is at 100% line and branch coverage.

**Stroke width on real cards.** On the generated synthetic card through the full analysis (real document detector and models), printed values had a stroke-width CV of 0.33–0.57. Their strokes are 2–3 pixels wide, and the whole-pixel distance transform reads them as 1, 3 or 5, which would make print look as uneven as handwriting.

RED (`f0b8e42`), card-style values (card ink and paper, JPEG q92):
```
$ uv run --frozen pytest tests/test_ocr_strokes.py --no-cov -q
E       assert 0.4249 < 0.3
E       assert 0.3807 < 0.3
E       assert 0.3451 < 0.3
E       assert 0.3493 < 0.3
4 failed, 9 passed in 0.62s
```
GREEN: a crop lower than 96 pixels is measured on a bicubic copy enlarged to 96 pixels, and the widths are divided back into the crop's own pixels. In a scratch spike, CV for print became 0.10–0.25, while a handwriting-like line with varied pen widths stayed at 0.29.
```
$ uv run --frozen pytest tests/test_ocr*.py tests/test_mrz_locate*.py --no-cov -q
145 passed in 19.71s
```

## 8. A recognizer output the dictionary does not fit is a typed inference failure (1B F021)

`vision-document`'s `openverify_vision.inference` (`537caa0`) answers `InferenceError`, `cv2.error` and onnxruntime's run errors with a typed 500 `inference_failed`. The OCR's onnxruntime failures already propagate raw and are covered. The CTC decoder's width check raised a plain `ValueError`, which would answer the generic 500. It now raises `InferenceError`.

RED (`a4b74b5`):
```
$ uv run --frozen pytest tests/test_ocr_recognition.py tests/test_ocr_composition.py tests/test_ocr.py --no-cov -q
E           ValueError: model output (1, 4, 7) does not have the 5 classes of the dictionary
E       KeyError: 'code'
2 failed, 35 passed in 2.90s
```
GREEN:
```
$ uv run --frozen pytest tests/test_ocr*.py tests/test_mrz_locate*.py --no-cov -q
146 passed in 19.09s
```

## 9. Measurements

All on the development machine (Intel Xeon E5-1650 v3, 6 cores / 12 threads, CPU only).

**Accuracy (PP-OCRv6 small, the shipped recognizer).**
- Visual zone, 16 rendered card lines (`tests/test_ocr_models.py`): mean per-character accuracy 1.0000.
- MRZ, the 10 well-formed vectors of `contracts/fixtures/mrz/` rendered at 2.54 mm pitch (`tests/test_mrz_locate_models.py`), positional per-character accuracy:

  | Condition | Accuracy | Confusions |
  |---|---|---|
  | clean | 827/838 = 0.9869 | `I→1` ×3, `O→0` ×8 |
  | scale 0.6 | 0.9869 | same |
  | Gaussian blur σ 1 | 0.9869 | same |
  | JPEG q60 | 825/838 = 0.9845 | `I→1` ×3, `O→0` ×10 |

  Every format was guessed right and every line came back at its exact length.
- The fallback `en_PP-OCRv5_rec_mobile` was measured in a scratch spike and not adopted (section 4).

**The generated synthetic card through the full analysis.** These are `GENERATOR_VERSION` 3 fixtures run through the HTTP app with every real model and `vision-document`'s detector:

| Variant | Front visual zone (lines read exactly) | Back visual zone | MRZ |
|---|---|---|---|
| happy | 18/18 | 13/13 | TD1, 87/90 positional (`I→1` in the document code, `O→0` twice in `UTO`) |
| on-background (contour quad, rectified) | 18/18 | 13/13 | 87/90 |
| TD3 passport | 28/28 | (single page) | TD3, 87/88 |
| MRV-A visa | 26/26 | (single page) | MRVA, 87/88 |
| expired, bad check digit, MRZ/VIZ mismatch, issued after expiry, under-age, PO box, portrait swap, no portrait, copy-move (20/20) | 18/18 | 13/13 | 87/90 |
| blurred | 17/18 | 13/13 | 87/90 |
| photocopy | 17/18 | 11/13 | 87/90 |
| glare | 14/18 | 13/13 | 87/90 |
| low resolution | 13/18 | 13/13 | 87/90 |
| screen recapture | 4/18 | 0/13 | not found |

Stroke width on the handwritten-field variant: the handwritten "NORA" measures 4.67 px with CV 0.43. Printed values measure 2.4–2.8 px with CV 0.12–0.21, and labels 1.7–1.9 px with CV 0.13–0.18.

**Time (C32.4; the budget belongs to `integration`).**
- OCR + MRZ on both sides of a rendered 1600 × 1009 card: median 1.377 s of 5 runs (`tests/test_mrz_locate_models.py`).
- OCR + MRZ on the generated card upscaled to 1600 × 1010, both sides: median 1.837 s of 10.
- The whole `/v1/analyze/government-id` on that card, both sides (faces, document, OCR, MRZ, barcodes, forensics): median 2.567 s of 10, inside the 5 s budget.

## 10. Final gates

```
$ python3 scripts/fetch_models.py
… text_detection_ppocrv6_small: present … text_recognition_ppocrv6_small: present … text_recognition_ppocrv6_small_dict: present
$ cd services/vision && uv run --frozen ruff check
All checks passed!
$ uv run --frozen ruff format --check
112 files already formatted
$ uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-vision-ocr
Success: no issues found in 44 source files
$ COVERAGE_FILE=/tmp/openverify-cov-vision-ocr uv run --frozen pytest
src/openverify_vision/mrz_locate.py              126      0     28      0   100%
src/openverify_vision/ocr/__init__.py            106      0     18      0   100%
src/openverify_vision/ocr/detection.py           126      0     26      0   100%
src/openverify_vision/ocr/dictionary.py           73      0     24      0   100%
src/openverify_vision/ocr/geometry.py             60      0      6      0   100%
src/openverify_vision/ocr/recognition.py          78      0     14      0   100%
src/openverify_vision/ocr/runtime.py              46      0      6      0   100%
src/openverify_vision/ocr/strokes.py              31      0      6      0   100%
TOTAL                                           4202     27    634     17    99%
Required test coverage of 80% reached. Total coverage: 99.09%
FAILED tests/test_make_synthetic_fixtures.py::test_the_version_is_bumped_for_the_portrait_names_and_the_readable_recapture
1 failed, 1198 passed in 173.89s
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   25 passed (10.5s)
@openverify/e2e:e2e:   39 passed (3.5m)
 Tasks:    9 successful, 9 total
```

The one failure is the `fixtures` agent's RED test for its next generator version, which was in flight in the shared tree at that moment. It is not in this area. Earlier full runs that day also showed the other Stage 2 agents' RED tests in flight (forensics, F021/F022), each turning green as its owner landed GREEN.
