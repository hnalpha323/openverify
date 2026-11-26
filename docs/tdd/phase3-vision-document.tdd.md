# TDD evidence: Workflow 3A Stage 2, `vision-document` (C32.1 document, quality, portrait, pHash; 1B F021, F022)

- **Slice owner:** `vision-document` (Workflow 3A, Stage 2), in parallel with `vision-ocr`, `vision-forensics`, `checks-logic` and `fixtures`.
- **Date:** 2026-10-21.
- **Input:** `docs/plans/phase-3.plan.md` C32.1 and C32.3, the Stage 1 handoff (stub names, marked blocks), `docs/research/phase3-libraries.md` §4 and §5.
- **Owned paths:** `services/vision/src/openverify_vision/{document,quality,faces,recognition}.py`, the new modules `inference.py` (F021) and `service_token.py` (F022) that plan amendment 13 allows, the `vision-document` blocks, and their tests: `tests/test_document.py`, `tests/test_document_measures.py`, the helper `tests/document_cards.py`, `tests/test_inference.py`, `tests/test_service_token.py`, and additions to `tests/test_quality.py`, `test_faces.py` and `test_recognition.py`.
- **Commits:** `753d8b0..5281cf6`: 22 commits of this slice (21 on code and tests, then this file). In that range `2f55522` (`vision-ocr`) and `7f59c2e` (`vision-forensics`) also touch `app.py`, `test_app_analyze.py` and `test_analysis_v2.py` outside this slice's lines.

Each item follows the cycle RED (the test fails for the intended reason), GREEN (the smallest change that passes), refactor with the suite green. Names a RED test needed were stubbed first (`753d8b0`: `quality.glare_mask` and `quality.tenengrad` raising `NotImplementedError`, and `inference.py` with `InferenceError`, `INFERENCE_FAILED` and a no-op handler installer).

All commands ran in `services/vision` after `source scripts/env.sh`, with `COVERAGE_FILE=/tmp/openverify-cov-vision-document`. Output is trimmed to the lines that matter.

Every test image is drawn by the tests themselves (`tests/document_cards.py`: a plain card with a header band, an outlined portrait box, word-like bars and an MRZ-like band, optionally with rounded ID-1 corners, warped onto a textured surface through a known homography). No fixture from `tools/` is used.

## Design spike (before the tests)

A scratchpad prototype settled the design on the same synthetic scenes before any test was written. What it showed, and what the tests then pin:

| Finding | Consequence |
|---|---|
| A dark blue header on a dark brown table is the same grey (60 against 55 to 70), so a grey-only detector finds only "the card minus its header" (aspect 1.83, outside the window) and falls back to `full_frame` on a 4:3 photo | Canny runs on each colour channel; the line detector too |
| `approxPolyDP` puts the 4-gon's vertices on the arcs of rounded ID-1 corners (radius 3.18 mm): sides offset by up to 8 work pixels, edge support 0.33 | Each side is refitted to its contour points (the middle 70%) and the sides are intersected |
| The dilated edge band offsets the outline by about 2 work pixels (5 full-resolution pixels) | Each side is snapped to the strongest colour step along its normal (sub-pixel), at work scale and again at full resolution |
| `cornerSubPix` after the snapping: corner error 0.5-0.65 px without it, 0.6-5.6 px with it (square: 4.85, 4.32, 1.36, 0.83, 1.68, 2.22; rounded: 5.57, 3.52, 4.67, 0.57, 3.50, 4.54) | `cornerSubPix` is not used (contract deviation) |
| Measuring the aspect ratio as long side over short side makes the ICAO portrait box (35 x 45 mm, 0.78, inverted 1.29) a "TD3 page" | The aspect ratio keeps the image's orientation (width is the pair of sides closer to horizontal) |
| Line merging capped at 12 lines kept the long text rows and lost the card's short sides | Lines are split into a horizontal and a vertical family, 10 each, and every pair of pairs is scored at once (vectorised) |
| A checkerboard's grid lines and noise's edges give edge support everywhere (a checkerboard "found" with aspect 1.27, noise with area 0.91) | An outline also needs a consistent colour step across each side (coherence: 0.91-0.96 for cards, 0.0 for the grid, 0.19 for noise; threshold 0.35) |
| A card covering 12% of a 4:3 photo fails the 0.3 gate, and the 4:3 frame then reads as `full_frame`, so the "document" would be the table | A closed card-shaped outline (support 0.8, aspect within 6%, area at least 0.1) inside the frame rules `full_frame` out (contract clarification) |
| The pHash is unchanged (0 bits) under JPEG q40-q90 and scaling to 40%; other layouts differ by 20-34 bits; two cards of one design that differ only in their word bars differ by 8 bits | Test thresholds: at most 4 bits for re-encodings, at least 16 for other documents |

## 1. Document detection and rectification (C32.1)

RED `ef3c5bd`, amended `bd8e356` (the full-frame quad runs `(0, 0)` to `(W, H)`, the convention `vision-forensics`'s rectified-to-upload mapping already uses), greyscale test fixed `aeea2fd`, GREEN `962416f`.

### RED

```text
$ uv run --frozen pytest tests/test_document.py "tests/test_app_analyze.py::test_government_id_sides_carry_the_v2_measurements" --no-cov -q
FAILED tests/test_document.py::test_a_card_on_a_background_is_found_by_its_outline[upright-square-corners]   (8 parametrisations)
FAILED tests/test_document.py::test_the_rectified_card_has_the_id_1_proportions_at_the_photo_resolution
FAILED tests/test_document.py::test_the_quad_runs_clockwise_from_the_top_left_of_the_card
FAILED tests/test_document.py::test_a_passport_page_is_rectified_to_the_td3_proportions
FAILED tests/test_document.py::test_a_dark_header_on_a_dark_surface_still_bounds_the_card
FAILED tests/test_document.py::test_an_outline_broken_by_a_cable_is_found_from_its_line_segments[5.0] / [-12.0]
FAILED tests/test_document.py::test_corners_hidden_under_fingers_are_recovered[0.0] / [10.0] / [-15.0] / [25.0]
FAILED tests/test_document.py::test_a_tightly_cropped_card_is_the_whole_frame[square-corners] / [rounded-corners]
FAILED tests/test_document.py::test_inner_frames_of_a_tightly_cropped_card_never_win[0.06] / [0.1] / [0.17]
FAILED tests/test_document.py::test_the_part_of_a_tight_crop_below_its_header_is_not_the_card
FAILED tests/test_document.py::test_inner_frames_of_a_card_on_a_background_do_not_beat_its_outline
FAILED tests/test_document.py::test_a_frame_shaped_like_a_document_is_taken_as_a_tight_crop_whatever_it_shows
FAILED tests/test_document.py::test_a_card_too_small_in_the_frame_is_not_found_and_its_size_is_reported
FAILED tests/test_document.py::test_a_card_too_small_in_a_wide_photo_is_reported_the_same_way
FAILED tests/test_document.py::test_noise_has_edges_everywhere_but_no_outline
FAILED tests/test_document.py::test_a_greyscale_upload_is_accepted
FAILED tests/test_document.py::test_tiny_images_only_get_the_frame_test[20-12-full_frame]
FAILED tests/test_document.py::test_detection_rejects_non_images - Failed: DID NOT RAISE <class 'ValueError'>
FAILED tests/test_app_analyze.py::test_government_id_sides_carry_the_v2_measurements
E       AssertionError: assert 'none' == 'full_frame'
33 failed, 6 passed in 5.25s
```

Each found-document test fails at `assert detection.found is True` on the Stage 1 stub's `NOT_FOUND`. The 6 that pass expect nothing found (the photos, the grid, the tiny squares, the contract shape).

### GREEN

```text
$ uv run --frozen pytest tests/test_document.py "tests/test_app_analyze.py::test_government_id_sides_carry_the_v2_measurements" tests/test_analysis_v2.py --no-cov -q --durations=5
FAILED tests/test_document.py::test_a_greyscale_upload_is_accepted
E       AssertionError: assert 465.46808028862614 <= 2.0
1 failed, 42 passed in 12.02s
```

The detector answered `full_frame`, and that was right: in grey, the test card's dark header is the dark table, so no outline exists at the top. The test was about greyscale input, so `aeea2fd` gives it a card without the dark header (the colour test above it keeps the dark-header case).

```text
...........................................                              [100%]
43 passed in 8.67s
```

## 2. `document_quality` (C32.1)

RED `a23086a` (with portrait clarity and the pHash, below), test corrections `b770b91` and `163ca79`, GREEN `3c7dae9`.

### RED

```text
$ uv run --frozen pytest tests/test_document_measures.py tests/test_quality.py "tests/test_analysis_v2.py::test_the_stage_1_stubs_report_nothing_found" "tests/test_app_analyze.py::test_government_id_sides_carry_the_v2_measurements" --no-cov -q
E       NotImplementedError: tenengrad is implemented by vision-document (C32.1)
E       NotImplementedError: glare_mask is implemented by vision-document (C32.1)
tests/test_analysis_v2.py:215: AssertionError                      (portrait_clarity is None on the stub)
E       TypeError: expected string or bytes-like object, got 'NoneType'   (the ID-shaped back has no pHash on the stub)
FAILED tests/test_document_measures.py::test_blur_and_tenengrad_are_measured_on_the_rectified_document   (9 document_quality tests)
FAILED tests/test_document_measures.py::test_portrait_clarity_measures_the_face_crop                      (5 portrait_clarity tests)
FAILED tests/test_document_measures.py::test_the_hash_is_16_lowercase_hex_characters                     (20 pHash tests and parametrisations)
FAILED tests/test_quality.py::test_glare_mask_marks_exactly_the_pixels_glare_ratio_counts                 (7 quality tests)
43 failed, 56 passed in 3.47s
```

The passing ones: nothing is measured without a document or a portrait, a featureless document has no hash, a face box outside the image has no clarity, and every Phase 1 quality test.

### GREEN

```text
$ uv run --frozen pytest tests/test_document_measures.py --no-cov -q -k "quality or glare or blur or sharpness or tenengrad or portrait_box or outside_the_document or without_a_document"
E       assert 0.522432 > 0.7
```

The portrait box was mapped as a rectangle around its mapped corners: an upright face box around a portrait turned 12 degrees is inflated once on the photo and again on the rectified document. The implementation now fills the mapped box as a polygon (`fillConvexPoly`), which inflates it once, as the face detector reported it. Then:

```text
E       assert 0.694343 > 0.7
```

The turned portrait fills 0.688 of its upright box (the geometry, computed in the test), so the bound 0.7 was wrong. `b770b91` asserts the geometric share (within 0.03) and no glare at all on the text.

```text
$ uv run --frozen pytest tests/test_quality.py tests/test_document_measures.py tests/test_document.py --no-cov -q
25 failed, 110 passed in 10.54s      (the 25: portrait clarity and pHash, still stubs)
```

## 3. `portrait_clarity` (C32.1)

Test correction `163ca79`, GREEN `6d956f8`.

One RED test computed its reference by resizing the colour crop and then converting it to grey; the greyscale test requires grey and colour uploads to measure the same (to 1e-6). Both cannot hold, because uint8 rounding depends on the order. The spec is the grey crop, scaled down: `163ca79` corrects the reference before the implementation.

```text
$ uv run --frozen pytest tests/test_document_measures.py tests/test_analysis_v2.py --no-cov -q -k "clarity or portrait or face or landmarks or stage_1"
13 passed, 29 deselected in 1.44s
```

## 4. The pHash (C32.1)

GREEN `06637df`. The reference implementation in the test is written out by hand (the DCT-II as matrix products, not `cv2.dct`), and a golden value (`07420ff226bdf20f`, smallest coefficient gap to the median 0.09) pins the bit order.

```text
$ uv run --frozen pytest tests/test_document_measures.py tests/test_document.py tests/test_quality.py tests/test_analysis_v2.py "tests/test_app_analyze.py::test_government_id_sides_carry_the_v2_measurements" --no-cov -q
140 passed in 11.94s
```

## 5. 1B F021: typed inference failures (C32.3)

RED `09d4e87`, GREEN `537caa0`.

### RED

```text
$ uv run --frozen pytest tests/test_inference.py tests/test_faces.py tests/test_recognition.py --no-cov -q
     15 E       KeyError: 'code'       (3 endpoints x 5 failure kinds: the generic 500 has no code)
FAILED tests/test_faces.py::test_an_opencv_failure_while_detecting_is_an_inference_error
E       cv2.error: OpenCV(5.0.0) dnn: (-215:Assertion failed) in function 'forward'
FAILED tests/test_recognition.py::test_an_opencv_failure_while_embedding_is_an_inference_error[align] / [feature]
E       cv2.error: OpenCV(5.0.0) (-215:Assertion failed) in function 'alignCrop'
FAILED tests/test_recognition.py::test_a_degenerate_embedding_is_an_inference_error[wrong-size] / [zero]
E       RuntimeError: SFace returned an embedding of shape (64,)
FAILED tests/test_inference.py::test_the_failure_is_logged_with_its_kind_and_route
E       assert 0 == 1      (no record from openverify_vision.inference)
21 failed, 36 passed in 1.73s
```

### GREEN

```text
$ uv run --frozen pytest tests/test_inference.py tests/test_faces.py tests/test_recognition.py tests/test_app.py tests/test_app_analyze.py --no-cov -q
113 passed in 4.79s
```

`tests/test_app.py::test_unhandled_error_is_generic_500` is unchanged and still passes: other failures stay the generic 500.

## 6. 1B F022: the token before the body (C32.3)

RED `1337c52`, GREEN `4d976f0`. The main test drives the ASGI app directly and counts the calls to `receive`.

### RED

```text
$ uv run --frozen pytest tests/test_service_token.py --no-cov -q
     13 E       assert 1 == 0      (the body was received once before the token was checked)
FAILED tests/test_service_token.py::test_the_multipart_parser_never_runs_for_an_unauthenticated_request
E         Left contains one more item: <starlette.formparsers.MultiPartParser object at 0x78a7d7d3aa50>
FAILED tests/test_service_token.py::test_a_malformed_body_without_the_token_is_401_not_a_parse_error
E       assert 400 == 401   (FastAPI's body parse error comes before the token dependency)
FAILED tests/test_service_token.py::test_every_route_under_v1_needs_the_token
E       AssertionError: assert 404 == 401
16 failed, 2 passed in 1.17s
```

### GREEN

```text
$ uv run --frozen pytest tests/test_service_token.py tests/test_app.py tests/test_app_analyze.py tests/test_app_concurrency.py tests/test_inference.py tests/test_limits.py --no-cov -q
113 passed in 4.50s
```

`tests/test_app.py::test_token_is_compared_in_constant_time` still sees exactly one `compare_digest` call: the middleware reuses `auth.require_service_token`.

## 7. Refactors and guard tests

- `bb952a3` removes an unreachable normal flip from the edge coherence; flipping the normal flips every step and changes neither the norm of their sum nor the sum of their norms.
- `5863a5c` adds tests for the defensive branches. They pass on the code as written, so each was checked against a temporary mutant (saved copy restored after each run; `cmp` confirmed):

| Mutant | Test | Result |
|---|---|---|
| `route_path` returns the path for a request to the root path itself | `test_the_guard_sees_the_path_the_router_matches` (Starlette's own `get_route_path` is the oracle) | 1 failed |
| `_coherence` scores a degenerate side 1.0 | `test_a_degenerate_quad_is_left_as_it_is` | 1 failed |
| `_refine` keeps a refined quad the gates reject | `test_a_full_resolution_snap_the_gates_reject_keeps_the_found_quad` | 1 failed |
| `_portrait_mask` without the behind-the-camera check | first version of the vanishing-line test: **passed** (its box, wholly beyond the line, projects off the document). The test now uses a box across the line, whose mirrored corners would paint 3,842 of the document's 6,300 pixels | 1 failed |
| `_upload_to_rectified` ignores a missing quad | `test_a_document_without_a_quad_cannot_place_a_portrait` | 1 failed |
| `_segment_lines` without its early return when no segment is found | `test_a_flat_frame_has_no_line_segments_and_is_a_tight_crop` | 1 failed |
| `_intersect` gives parallel lines a crossing | `test_parallel_sides_meet_at_no_corner` | 1 failed |

After them, `document.py`, `quality.py`, `faces.py`, `recognition.py`, `inference.py` and `service_token.py` are at 100% line and branch coverage.

- `ad2cc43` and `9bdec3d` are docstring refactors (the measured `cornerSubPix` comparison, the rectified-document measures, the `InferenceError` the face wrappers raise).

## 8. Moire stripes are no outline (found on the generated variants)

RED `ce6378e`, GREEN `1b568ba`.

Running the detector over the fixtures agent's generated variants (`fixtures/generated/variants`, only read, never used by a test) found one wrong answer. `screen-recapture-back.jpg` came back as `lines`, with a slanted inner quad (area 0.686, support 0.60, coherence 0.77, corner angles 71 and 108-110 degrees) built from moire stripes. The test builder got its own RGB-stripe display simulation (`document_cards.on_screen`), written from the physics (three coloured columns per display pixel, a darker row, the display sampled at 0.72 of its pitch through a 1.5 degree turn), and it reproduces the failure.

### RED

```text
$ uv run --frozen pytest tests/test_document.py --no-cov -q -k screen
E       AssertionError: assert 'lines' == 'full_frame'
3 failed, 42 deselected in 1.63s
```

The line quads' scores (support, coherence): outlines broken by a cable or fingers 0.88-0.92 and 0.92-0.96; moire quads on the simulated screen 0.67-0.73 and 0.50-0.83, on the fixture 0.60 and 0.77. Their corner angles do not separate them (the simulated moire quads are within 2 degrees of square), so the fix uses the two scores.

### GREEN

A quad assembled from lines must have edge support of at least 0.8 (`LINE_MIN_EDGE_SUPPORT`) and coherence of at least 0.88 (`LINE_MIN_EDGE_COHERENCE`); a closed contour keeps 0.6 and 0.35.

```text
$ uv run --frozen pytest tests/test_document.py tests/test_document_measures.py --no-cov -q
85 passed in 12.31s
```

Over all 39 generated variants: 36 `full_frame` (tight crops, including the TD3 page and the MRV-A visa), 2 `contour` (the card photographed on a background, front and back), 1 `none` (not an ID).

## Existing tests changed because the plan changes their behaviour

- `tests/test_app_analyze.py::test_government_id_sides_carry_the_v2_measurements` (`ef3c5bd`, `a23086a`): the back is 160 x 100 noise, an ID-1-shaped frame, so C32.1 makes it a `full_frame` document with a pHash. The square checkerboard front is no document and has none. Only the `document` and `phash` lines changed; the other agents' lines are untouched.
- `tests/test_analysis_v2.py::test_the_stage_1_stubs_report_nothing_found` (`a23086a`): with a face on the front, `portrait_clarity` is measured (face width 80, landmark score 0.93), so it left the "nothing found" dictionary and is asserted on its own.
- `tests/test_document.py`: Stage 1's three stub tests are replaced; their two lasting claims (a grid is no document; without a document there is no quality or hash) are kept as tests.

## Measurements

Median of 10 runs of each stage, after one warm-up, on an Intel Xeon E5-1650 v3 at 3.50 GHz (12 threads), while four other agents ran their own suites on the same machine:

| Upload (1600 pixels wide) | Method | Detect | Quality | Clarity | pHash | Total |
|---|---|---|---|---|---|---|
| Tight crop, 1600 x 1009 | `full_frame` | 86.1 ms | 27.2 ms | 1.3 ms | 4.6 ms | 119 ms |
| Photo 1600 x 1200, card 1100 px wide | `contour` | 75.1 ms | 21.2 ms | 1.5 ms | 2.9 ms | 101 ms |
| Same photo with a cable across the card | `lines` | 193.9 ms | 20.5 ms | 2.2 ms | 3.7 ms | 220 ms |

Corner accuracy on 1600 x 1200 photos of a 1000-pixel card (largest corner error): 0.5-0.65 px (square or rounded corners, upright to 35 degrees, perspective up to 10%); 1.0 px after JPEG q50; 0.6-0.8 px after a Gaussian blur of sigma 3 and 6; 0.7 px at 400 x 300.

`document_quality` and the pHash on the generated synthetic cards (`fixtures/generated`, generator as of 2026-10-21 01:30; read only, for the calibration that `integration` owns):

| Image | Method | Size | blur_score | tenengrad | glare_ratio_text | phash |
|---|---|---|---|---|---|---|
| `id-front.jpg` | `full_frame` | 1027 x 648 | 1198 | 15482 | 0.00191 | e8c797c1c03cc83f |
| `id-back.jpg` | `full_frame` | 1027 x 648 | 1819 | 26721 | 0.002257 | 88b0f0c277b8cd4f |
| `variants/blurred-front.jpg` | `full_frame` | 1027 x 648 | 15 | 2654 | 0.0 | e8c797c1c03cc83f |
| `variants/glare-front.jpg` | `full_frame` | 1027 x 648 | 945 | 12470 | 0.09538 | b8c6d7e1c834303f |
| `variants/low-resolution-front.jpg` | `full_frame` | 308 x 194 | 2815 | 22550 | 0.002243 | e8c797c0e03cc83f |
| `variants/on-background-front.jpg` | `contour` | 1108 x 699 | 178 | 8289 | 6.2e-05 | e8c797c0e03cc83f |
| `variants/on-background-back.jpg` | `contour` | 1058 x 667 | 333 | 15345 | 4.8e-05 | 88b0f0c277b8cd4f |
| `variants/screen-recapture-front.jpg` | `full_frame` | 1110 x 700 | 1527 | 7937 | 0.000198 | 68c717c15a3c4c3f |
| `variants/screen-recapture-back.jpg` | `full_frame` | 1110 x 700 | 1725 | 12009 | 0.000228 | 5bb0509277b04f8f |
| `variants/photocopy-front.jpg` | `full_frame` | 1027 x 648 | 1428 | 14755 | 0.0 | e8c797c0e03ccc3e |
| `variants/front-as-back-back.jpg` | `full_frame` | 1027 x 648 | 1194 | 15514 | 0.002062 | e8c797c1c03cc83f |
| `variants/td3-passport-front.jpg` | `full_frame` | 1500 x 1056 | 704 | 14220 | 0.00083 | 1ee1c31fe0e13f0c |
| `variants/mrv-a-visa-front.jpg` | `full_frame` | 1440 x 960 | 671 | 14282 | 0.000799 | 1ee0e10fe0e07b1f |
| `variants/not-an-id-front.jpg` | `none` | none | - | - | - | - |

On the real models, the happy front's portrait clarity is a 166.55-pixel face, sharpness 411.55 and landmark score 0.9458; the analysis of both sides through the HTTP API (YuNet, SFace, OCR and forensics, models loaded on the first call) took 3.39 s.

## Final gates (2026-10-21, in the foreground, working tree at `106fdeb`, which includes `1b568ba`)

```text
$ cd services/vision && uv run --frozen ruff check
All checks passed!
$ uv run --frozen ruff format --check
112 files already formatted
$ uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-vision-document
Success: no issues found in 44 source files
$ COVERAGE_FILE=/tmp/openverify-cov-vision-document uv run --frozen pytest
src/openverify_vision/document.py                499      0    112      0   100%
src/openverify_vision/faces.py                    86      0      6      0   100%
src/openverify_vision/inference.py                25      0      2      0   100%
src/openverify_vision/quality.py                  91      0      6      0   100%
src/openverify_vision/recognition.py              56      0      8      0   100%
src/openverify_vision/service_token.py            42      0     10      0   100%
Required test coverage of 80% reached. Total coverage: 100.00%
1202 passed in 132.88s (0:02:12)
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   25 passed (8.5s)
@openverify/e2e:e2e:   ✓  38 [chromium] › tests/verification-completes.spec.ts:27:1 › an inquiry on the default template completes with every check passed (9.3s)
@openverify/e2e:e2e:   39 passed (3.4m)
 Tasks:    9 successful, 9 total
  Time:    3m23.934s
```

The e2e stack builds the vision image from this working tree, so the real service ran the detector, the measurements, the inference handler and the token guard on every government ID and selfie of the specs. The API worker parsed every v2 response with zod. An earlier run before the moire fix (on the tree after `9bdec3d`) also passed: 39 specs in 3.7 minutes.

