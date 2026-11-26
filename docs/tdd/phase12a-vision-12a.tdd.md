# Phase 12A, Workflow 12A Stage 2: vision-12a (TDD evidence)

Agent: `vision-12a` (Workflow 12A, Stage 2, in parallel with capture-12a and checks-12a). Base `4ea2493bf` with contracts-12a's `b7a249af1`. Host: WSL2. Every command ran after `source scripts/env.sh`, from `services/vision`. The full suite ran under `flock /tmp/openverify-heavy.lock`.

- Nothing was pushed or dispatched, and the docker project `openverify-test` was not touched.
- No real card, owner photo or live OCR text was read. Every image is a capture of `tools/synthetic_quebec.py` (frozen, not edited) or a Phase 3 Utopia variant.
- Exploration and measurement scripts ran from the session scratchpad and are not committed. Their outputs are quoted below.

## Scope and deliverables

| # | What | Where |
|---|---|---|
| V1 | Bounded multi-pass PDF417 recovery: texture regions, upright crops, gate, enhancements. A decode that used all its error correction is reported only after a second pass confirms it | `src/openverify_vision/barcode.py` (`recover_pdf417`, called by `decode_side_barcodes` when no PDF417 was decoded) |
| V2 | The `text_layout` document fallback, and `"text_layout"` added to `DocumentMethod` (the one contract change) | `document.py` (`near_misses`, `detect_by_text_layout`), `analysis.py` (the side analysis falls back and reads the rectified card again; `QUAD_METHODS`), `schemas.py` |
| V3 | Document sharpness measured at a fixed width of 1,000 px, as a Laplacian of Gaussian (σ 0.8) on the side's text boxes; the calibration tool and its document | `document.py` (`measure_document_quality`), `tools/calibrate_blur_phase12a.py`, `docs/calibration/blur-phase12a.md` |
| V4 | The stroke measure ignores lines with fewer than 120 medial-axis samples (`MIN_AXIS_PIXELS` 10 → 120) | `ocr/strokes.py` |
| V5 | Gates | below |

New tests:
- `tests/test_barcode_pdf417_recovery.py` (39);
- `tests/test_document_text_layout.py` (29);
- `tests/test_document_blur_phase12a.py` (11);
- `tests/test_ocr_strokes_phase12a.py` (5);
- the shared helper `tests/quebec_captures.py`.

Changed tests:
- `tests/test_document_measures.py`: three tests encoded the old measure (raw Laplacian, at most 1,280 px). They now use the reference `document_cards.document_sharpness`.
- `tests/test_barcode.py`: the degenerate-quad test now stubs out `recover_pdf417`. It tests only the second pass's mapping, and the recovery would find the symbol that its fake `decode_barcodes` hides on the upload.

## Exploration (before the tests)

These are the measurements that shaped the tests. All are synthetic, and the scripts are in the scratchpad.

**Document miss.** At 1080x1920 the contour detector does find the card. The outline is supported (support 1.0, coherence 0.97) and ID-1-shaped (aspect 1.59), but it covers 0.262 of the frame, under the 0.3 gate: 0.86² / 1.586 × 1080 / 1920 = 0.262. The 3024x4032 frame gives 0.35. Refined, that outline is within 0.28% of the card's width of the true corners on every `phone-1080*` capture, front and back. The fallback therefore keeps those outlines (`near_misses`) and takes the one that holds the OCR lines.

**Barcode.**
- Rectifying through the true quad decodes the tilt captures. A dense-texture region crop (minimum-area rectangle, upscaled to 2,000 px) also decodes tilt and `dense phone-1080-soft`.
- `phone-1080-glare` (standard) decodes only through a local contrast stretch. Across 24 noise seeds (17-40), no single pass decoded more than 14. Stretch ×{Otsu, global histogram} at 2,800, 2,000 and 1,400 px covers 22 of 24 seeds.
- **The dense glare cannot be decoded with zxing-cpp.** On a pristine render (24 px/mm, no blur, noise or JPEG), the standard symbol decodes under the generator's glare and the dense symbol does not, raw or stretched.
  - Counting codewords under the clipped highlight (contrast under 2%): standard 28 of 260, dense 51 of 272.
  - The measured erasure limit of zxing-cpp 3.1.1 on a clean symbol, with a compact block of codewords whited out, is 44 (13 columns) and 46 (17 columns). Above it, decoding fails.
  - The test `test_the_dense_glare_erases_more_of_the_symbol_than_zxing_can_correct` keeps this evidence.
- Region crops gated by "zxing sees a PDF417, even undecodable" (`return_errors=True`) never fire on the fronts. They do fire on every back except blur and motion.

**Blur.**
- Whole-card Laplacian variance at 1,000 px has no single threshold for both sides: fronts need 32 < T < 47, backs 59 < T < 125, because the barcode is far sharper than print.
- On the printed lines' boxes, the front and back values match within 10%.
- The plan's literal pair (`blur_sigma` 1.2 at 2160x3840) is 1.58-2.27 times `phone-1080` on every variant tried. The generator blurs a capture twice: 0.5 frame px of lens blur while warping, which does not scale with the frame, then `blur_sigma`. So that pair is a sharper scene. With `blur_sigma` 1.48 the whole blur scales and the scene is the same: σ 0.8 smoothing at 1,000 px gives 1.21 (blur) and 1.10 (Tenengrad).

**Strokes.** These are per-line stroke excesses, `clamp01((cv / max(median, 0.05) - 1) / 2)`, computed on real-OCR crops of the rectified fronts.
- Before V4: `phone-1080` 0.218, `-soft` 0.162, `-q75` 0.182, `phone-full` 0.329. Utopia `happy` gives 0.239 and the handwritten line 0.736.
- The worst lines are the 2-character field numbers. Their crops have 6-118 medial-axis samples, against 153 or more for every line of three characters or more, the handwritten one included.
- Tried and rejected:
  - pre-smoothing (σ 0.5, 1.0);
  - junction exclusion;
  - trimmed, IQR and MAD dispersions;
  - clipping widths to 0.5-1.5× the median;
  - a 160 px measuring height.

  None of them brought every clean line to 0.1 or below without inflating Utopia `happy` or `blurred`, or hurting the handwritten line.

## RED

1. **Collection.** The four new test files were written first. Against the base code, collection failed on the missing API:

```text
$ uv run --frozen pytest tests/test_barcode_pdf417_recovery.py tests/test_document_text_layout.py tests/test_document_blur_phase12a.py tests/test_ocr_strokes_phase12a.py --no-cov -q -p no:cacheprovider
E   ImportError: cannot import name 'MAX_RECOVERY_PASSES' from 'openverify_vision.barcode'
E   ImportError: cannot import name 'detect_by_text_layout' from 'openverify_vision.document'
E   ModuleNotFoundError: No module named 'calibrate_blur_phase12a'
!!!!!!!!!!!!!!!!!!! Interrupted: 3 errors during collection !!!!!!!!!!!!!!!!!!!!
```

2. **Behaviour.** Stubs with the final signatures were added: `recover_pdf417` returning `None`, `detect_by_text_layout` returning `previous`, the measure constants, and the calibration tool, measuring with the old `measure_document_quality`. The tests then failed for their intended reasons:

```text
$ uv run --frozen pytest <the four files> --no-cov -q -p no:cacheprovider
FAILED tests/test_barcode_pdf417_recovery.py::test_the_standard_back_decodes_to_exactly_its_payload[phone-1080-tilt]
FAILED tests/test_barcode_pdf417_recovery.py::test_the_standard_back_decodes_to_exactly_its_payload[phone-1080-glare]
FAILED tests/test_barcode_pdf417_recovery.py::test_the_dense_back_decodes_to_exactly_its_payload[phone-1080-tilt]
FAILED tests/test_barcode_pdf417_recovery.py::test_the_recovered_quad_outlines_the_symbol_in_upload_pixels
FAILED tests/test_barcode_pdf417_recovery.py::test_the_rectified_card_gives_the_recovery_its_region_when_there_is_one
FAILED tests/test_barcode_pdf417_recovery.py::test_the_recovery_is_bounded_in_passes[phone-1080-blur]
FAILED tests/test_barcode_pdf417_recovery.py::test_the_recovery_is_bounded_in_passes[phone-1080-motion]
FAILED tests/test_document_text_layout.py::test_every_phone_frame_finds_the_card_within_three_percent[phone-1080-front]
... (all 16 phone-1080* front/back cases)
FAILED tests/test_document_text_layout.py::test_the_near_miss_outline_is_kept_for_the_fallback
FAILED tests/test_document_text_layout.py::test_the_live_shape_without_an_outline_is_found_from_the_text_and_the_portrait
FAILED tests/test_document_text_layout.py::test_a_face_beside_the_text_is_not_taken_into_the_card
FAILED tests/test_document_text_layout.py::test_a_text_layout_detection_validates_against_the_contract
FAILED tests/test_document_text_layout.py::test_the_portrait_of_a_text_layout_card_is_a_face_on_it
FAILED tests/test_document_text_layout.py::test_the_side_analysis_falls_back_to_the_text_layout_and_reads_the_rectified_card
FAILED tests/test_document_text_layout.py::test_the_real_ocr_lines_find_the_card_in_the_phone_frame[front]
FAILED tests/test_document_text_layout.py::test_the_real_ocr_lines_find_the_card_in_the_phone_frame[back]
FAILED tests/test_document_blur_phase12a.py::test_the_card_is_measured_at_a_fixed_width_on_its_text[640]
FAILED tests/test_document_blur_phase12a.py::test_the_card_is_measured_at_a_fixed_width_on_its_text[1000]
FAILED tests/test_document_blur_phase12a.py::test_the_card_is_measured_at_a_fixed_width_on_its_text[2600]
FAILED tests/test_document_blur_phase12a.py::test_without_enough_text_the_whole_card_is_measured
FAILED tests/test_document_blur_phase12a.py::test_one_scene_at_two_frame_sizes_scores_within_a_quarter[front]
FAILED tests/test_document_blur_phase12a.py::test_one_scene_at_two_frame_sizes_scores_within_a_quarter[back]
FAILED tests/test_document_blur_phase12a.py::test_the_plans_literal_pair_is_a_sharper_scene_not_the_same_one
FAILED tests/test_document_blur_phase12a.py::test_the_proposed_thresholds_pass_the_legible_captures_and_fail_blur_and_motion
FAILED tests/test_document_blur_phase12a.py::test_the_committed_calibration_is_the_recomputed_one
FAILED tests/test_document_blur_phase12a.py::test_the_calibration_command_checks_and_writes_the_document
FAILED tests/test_ocr_strokes_phase12a.py::test_a_single_glyph_is_too_few_samples_to_measure
FAILED tests/test_ocr_strokes_phase12a.py::test_clean_print_keeps_every_line_near_the_cards_typical_stroke[phone-1080]
FAILED tests/test_ocr_strokes_phase12a.py::test_clean_print_keeps_every_line_near_the_cards_typical_stroke[phone-1080-soft]
FAILED tests/test_ocr_strokes_phase12a.py::test_clean_print_keeps_every_line_near_the_cards_typical_stroke[phone-1080-q75]
43 failed, 37 passed in 70.12s (0:01:10)
```

   The 37 that passed are the baseline cases the plan already expected to pass: the backs that decoded before, the fronts yielding no PDF417, never a wrong payload, the desk, too-few-lines, a found document kept, and the shape tests.

3. **A RED found while measuring (V1, miscorrection).** The first V1 implementation passed its tests. A 24-seed sweep of the standard glare capture then reported, on seed 38, a PDF417 that zxing-cpp marked `valid` with a different payload: 318 bytes instead of 300, wrong from byte 30. All the passes' decodes were tabulated by zxing-cpp's unused error correction (`extra["UEC"]`), over the named backs, the 24 glare seeds and 12 dense-tilt seeds:

```text
right by UEC [(0.0, 26), (0.1, 14), (0.25, 2), (0.3, 8), ... (0.96, 2), (1.0, 183)]
wrong by UEC [(0.0, 2)]          # glare seeds 19 and 38
```

   The test `test_glare_at_any_noise_seed_decodes_right_or_not_at_all` and the two confirmation tests were written next. With the rule disabled (`_correction_left` forced to `True`), the sweep fails:

```text
$ uv run --frozen pytest tests/test_barcode_pdf417_recovery.py -k "glare_at_any_noise_seed or needs_a_second_pass" --no-cov -q -p no:cacheprovider
E           AssertionError: 38
E           assert {b"@\n\x1e\rA...ICECRtwi/a\r"} <= {b'@\n\x1e\rA... TEST DATA\r'}
FAILED tests/test_barcode_pdf417_recovery.py::test_glare_at_any_noise_seed_decodes_right_or_not_at_all
1 failed, 1 passed, 37 deselected in 25.27s
```

   The rule: a recovery decode with `UEC` 0 (or unknown) is held until a second pass decodes the same bytes.

4. **Existing tests.** After the implementation, `tests/test_barcode.py::test_a_degenerate_document_quad_maps_nothing_back_to_the_upload` failed as expected: the recovery found the PDF417 that the fake hides from the first pass. Only the second pass's mapping is under test there, so the test now stubs out `recover_pdf417`.

## GREEN

```text
$ uv run --frozen pytest tests/test_document_text_layout.py tests/test_document_measures.py --no-cov -q -p no:cacheprovider
29 passed (text layout) ... 80 passed in 67.46s (with test_document_blur_phase12a.py and test_document_measures.py)
$ uv run --frozen python tools/calibrate_blur_phase12a.py          # 25.5 s; writes the table in docs/calibration/blur-phase12a.md
$ uv run --frozen pytest tests/test_barcode_pdf417_recovery.py --no-cov -q -p no:cacheprovider
39 passed in 68.74s (0:01:08)
$ uv run --frozen pytest tests/test_ocr_strokes_phase12a.py tests/test_ocr_strokes.py tests/test_ocr.py --no-cov -q -p no:cacheprovider
38 passed in 8.93s
$ uv run --frozen pytest tests/test_barcode.py --no-cov -q -p no:cacheprovider
20 passed in 1.94s
```

### V1: recovery outcomes, passes and time

Each line shows the decode result, the number of zxing-cpp reads the recovery made (0 means the first two passes had already decoded it) and the side's barcode time in ms. The first block uses the detector only (no document at 1080); the second adds the `text_layout` document from the printed lines.

```text
side layout capture | detector only: result, recovery passes, ms | with text_layout doc: result, passes, ms
back standard flat | decoded 0 91 | decoded 0 85
back standard phone-1080 | decoded 0 68 | decoded 0 75
back standard phone-1080-soft | decoded 0 58 | decoded 0 78
back standard phone-1080-blur | - 2 113 | - 16 683
back standard phone-1080-motion | - 2 101 | - 4 208
back standard phone-1080-tilt | decoded 1 121 | decoded 0 72
back standard phone-1080-glare | decoded 4 345 | decoded 3 309
back standard phone-1080-q75 | decoded 0 38 | decoded 0 72
back standard phone-full | decoded 0 520 | decoded 0 454
back dense flat | decoded 0 47 | decoded 0 45
back dense phone-1080 | decoded 0 47 | decoded 0 82
back dense phone-1080-soft | decoded 1 167 | decoded 2 191
back dense phone-1080-blur | - 2 112 | - 4 168
back dense phone-1080-motion | - 2 97 | - 4 235
back dense phone-1080-tilt | decoded 1 146 | decoded 0 104
back dense phone-1080-glare | - 14 844 | - 16 1000
back dense phone-1080-q75 | decoded 0 54 | decoded 0 68
back dense phone-full | decoded 0 433 | decoded 0 522
front standard <every capture> | - 2 to 8 reads, 175-951 ms, never a PDF417
standard glare across seeds 17-40: 19 / 24 decoded, none wrong
```

What the table shows:
- **Bounds.** At most 16 reads of the 24-read bound, and at most about 1 s per side.
- **The required set.** Every capture the plan requires decodes to exactly its payload, except `dense phone-1080-glare`, which cannot (see Exploration and Deviations).
- **Bonus.** `dense phone-1080-soft` (not required) decodes.
- **Blur and motion.** These stay undecoded, never with a wrong payload.

### V2: the fallback

- On all 16 `phone-1080*` fronts and backs, `detect_document` misses and `detect_by_text_layout` finds the card, `method: "text_layout"`, with every corner within 3% of the card's width. It does so from the printed lines in frame pixels and from the real OCR's lines (`phone-1080` front and back).
- The live shape (22 text lines and a portrait, no outline at all) is found from the text's extent within 3%.
- A desk without a card, too few lines, card-unlike text, an outline that does not hold the text, and a holder's face beside the card all behave as specified.
- `analyze_government_id_side` falls back. It reads the upload's lines as evidence, then reads the rectified card again, reports `text_layout`, measures `document_quality` and finds the portrait on the card.

### V3: the calibration (`docs/calibration/blur-phase12a.md`)

| Key | Proposed | Lowest legible | Highest blurred | Margin |
|---|---|---|---|---|
| `min-document-blur-score` | 100.19 | 134.09 (phone-1080-soft back) | 74.86 (phone-1080-motion front) | 1.338 |
| `min-document-tenengrad` | 12107.29 | 15437.6 (phone-1080-soft back) | 9495.4 (phone-1080-motion front) | 1.275 |

The same scene at 1080 and 2160 scores 439.06 and 529.54 (front) and 410.20 and 497.23 (back) on blur, 1.21×, and 1.10× on Tenengrad.

The Utopia variants under the new measure, one-off with the real text models (`detect_document`, then `measure_document_quality` on the OCR boxes and on the whole card):

```text
happy                    front full_frame w= 1027 whole    111.8      6572 | text    681.2     38440
happy                    back  full_frame w= 1027 whole    203.9     12692 | text    645.6     39728
specimen-overprint       front full_frame w= 1027 whole    114.7      6944 | text    239.1     13897
blurred                  front full_frame w= 1027 whole      8.1      1710 | text     44.7      7626
glare                    front full_frame w= 1027 whole     87.7      5330 | text    552.9     31922
low-resolution           front full_frame w=  308 whole     25.3      3735 | text    143.4     18593
photocopy                front full_frame w= 1027 whole     98.4      6619 | text    497.1     32772
screen-recapture         front lines      w=  749 whole     32.0      3062 | text     97.5     13238
on-background            front contour    w= 1108 whole     58.2      4747 | text    344.8     26204
td3-passport             front full_frame w= 1500 whole    172.2      7208 | text    983.5     38465
not-an-id front no document
(every other variant: text 470-683 / 27,103-39,728; whole 109-204)
```

### V4: after the change

These are per-line stroke excesses on real-OCR crops (lines read, lines measured, worst three):

```text
phone-1080 lines, measured, worst3: (17, 15, [0.12, 0.072, 0.06])
phone-1080-soft lines, measured, worst3: (16, 15, [0.156, 0.144, 0.118])
phone-1080-q75 lines, measured, worst3: (17, 15, [0.115, 0.087, 0.076])
phone-full lines, measured, worst3: (21, 15, [0.153, 0.124, 0.082])
utopia happy (18, 18, [0.239, 0.136, 0.088])
utopia handwritten (18, 17, [0.711, 0.196, 0.1])
```

## Deviations from the plan, and findings for the orchestrator

1. **V1, dense glare.** `dense phone-1080-glare` is not decoded, and no zxing-cpp-based method can decode it.
   - The generator's clipped highlight leaves at least 51 codewords with no contrast at all. zxing-cpp 3.1.1 fails above about 44-46 erased codewords, and the pristine render under the same glare does not decode either.
   - The test asserts that it is never decoded wrong, and the infeasibility is itself a test.
   - Closing this needs either a generator amendment (contracts-12a: a smaller glare radius or position on the dense back) or a decoder with full erasure decoding (64 EC codewords). Neither is in vision-12a's scope.
2. **V1, standard glare.** The standard glare is near the symbol's error-correction limit. It decodes on the named capture and on 19 of 24 noise seeds, never wrong. The test guards 18 or more.
3. **V1, confirmation rule (added).** A recovery decode that used all its error correction (zxing-cpp `UEC` 0) is reported only when a second pass agrees, because two such decodes were miscorrections. The upload and rectified passes of C32.1 keep their behaviour and are not filtered.
4. **V3, the same-scene pair.** The plan's literal pair (`blur_sigma` 1.2 at 2160x3840) is not the same scene as `phone-1080`. The test uses `blur_sigma` 1.48, which scales all the optical blur with the frame, and also asserts that the literal pair is sharper.
5. **V3, text boxes.** The measure uses the side's text boxes. Without this, no single `min-document-blur-score` separates the fronts and the backs, since the barcode is three times sharper than print. A side with no OCR text is measured on the whole card. There the genuine Utopia fronts score 58-121, under the proposed 100.19, so the checks calibration with stub analysers, which have no text models, will see blur failures on whole-card rows.
6. **V4, the bound.** The plan's per-line bound of 0.1 is not met.
   - After the change (lines under 120 axis samples are not measured), the worst clean line is 0.12, 0.156 and 0.115 on `phone-1080`, `-soft` and `-q75`. The test holds 0.2. Utopia `happy` is still 0.239, unchanged since Phase 3.
   - **Finding for checks-12a / C10:** `HANDWRITING_STROKE_SIGNAL` 0.1 lies inside the clean-print noise floor of 0.12-0.24. A clean line at 0.156 with a confidence drop of 0.97 would score 0.6 × 0.156 + 0.4 × 0.97 = 0.48, which is above 0.383. A gate of about 0.3 or more on the stroke excess, or a minimum measured-line count, would keep the drop from reopening the live false positive.
7. **Contract.** `DocumentMethod` gains `"text_layout"`, the only response-schema change. `DocumentResult.near_misses` is internal, not in the contract.

## V5: gates

The full suite ran twice under the heavy lock. The first run (2826 passed, 96.11%) overlapped docstring-only edits to `document.py`, which shifted its line numbers in the coverage report. The second run is on the committed code:

```text
$ uv run --frozen ruff check
All checks passed!
$ uv run --frozen ruff format --check
220 files already formatted
$ uv run --frozen mypy src tools
Success: no issues found in 84 source files
$ uv run --frozen python tools/calibrate_blur_phase12a.py --check; echo "calibration check exit $?"
calibration check exit 0
$ uv run --frozen python tools/synthetic_quebec.py fixtures --check; echo "fixtures check exit $?"
fixtures check exit 0                      # the frozen generator and fixtures are untouched
$ flock -w 3000 /tmp/openverify-heavy.lock uv run --frozen pytest -q -p no:cacheprovider
src/openverify_vision/analysis.py                159      0     16      0   100%
src/openverify_vision/barcode.py                 245      2     58      3    98%   294->292, 414, 446
src/openverify_vision/document.py                628      1    136      1    99%   822
src/openverify_vision/ocr/strokes.py              31      0      6      0   100%
src/openverify_vision/schemas.py                 575      1     68      1    99%   699
tools/calibrate_blur_phase12a.py                 113      1     14      1    98%   235
TOTAL                                          13632    241   2602    149    97%
Required test coverage of 80% reached. Total coverage: 97.49%
2826 passed in 696.21s (0:11:36)
$ pnpm exec prettier --check services/vision/README.md docs/tdd/phase12a-vision-12a.tdd.md docs/calibration/blur-phase12a.md
All matched files use Prettier code style!
```

The base had 2742 tests at 97.40% (contracts-12a). vision-12a adds 84 tests.
