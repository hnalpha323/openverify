# TDD evidence: Phase 4, Workflow 4A Stage 2, `vision-integrity`

The C41.1 cross-pose consistency, the synthetic-face cues with the XMP digital source type, the background layout, and the C41.2 background comparison in `services/vision`, test-first. Owned paths: `src/openverify_vision/replay.py`, `synthetic_face.py`, `background.py`, their tests (`tests/test_replay.py`, `tests/test_synthetic_face.py`, `tests/test_background.py`), the `# --- vision-integrity ---` blocks of `analysis.py` and `app.py` (the `/v1/compare/background` route), and this file.

Every command ran from `services/vision` after `source scripts/env.sh`, with `COVERAGE_FILE=/tmp/openverify-cov-vision-integrity` and `--cache-dir /tmp/openverify-mypy-vision-integrity`. Output is abbreviated.

**Inputs.** The unit tests draw their own frames with NumPy and OpenCV: a seeded colour texture, and the canonical face projected by the Stage 1 re-pose helper (`tools/repose.py`), so no real face's landmarks, embedding or crop is used. The 3-D re-pose renders that texture with the canonical mesh (fetched by `scripts/fetch_models.py`; the tests that need it skip without it, as `test_repose.py` does, and CI fetches it). The stability and background tests that use the three public-domain faces of `fixtures/manifest.json` (and YuNet) keep everything in memory and assert only scores and counts.

**Stub** (`2f72aa5`): `replay.structural_similarity` and the consistency constants, `synthetic_face.read_digital_source_type` and `canonical_landmark_distance`, `background.person_mask`, `FaceFinder` and `MAX_ORB_FEATURES`, so every RED test imports and `mypy src tools` passes.

## Slice 1: cross-pose consistency (C41.1, research §7)

**RED** (`2cc8857`): `tests/test_replay.py`.

```
$ uv run --frozen pytest tests/test_replay.py --no-cov -q
E       assert None == 0.6590017225891328 ± 1.0e-09          # our SSIM against scikit-image's
E       Failed: DID NOT RAISE ValueError                     # SSIM of two sizes
E       assert None == 0.6 ± 6.0e-07                         # the face cosine
E       AssertionError: assert None is not None              # planarity, raw and registered SSIM
E       assert None == 1.0 ± 1.0e-06                         # identical frames register exactly
24 failed, 3 passed in 8.87s     # the 3 passing pin "not measured": no second embedding, a region
                                 # too small for the SSIM window, a face box outside the frame
```

A first run of the bounded-copy test failed on `module 'openverify_vision.replay' has no attribute 'cv2'` (the stub imports no OpenCV), not the intended reason; the spy now patches `cv2.goodFeaturesToTrack` itself, and the test fails on the unmeasured planarity.

**GREEN** (`3753b20`):

```
$ uv run --frozen pytest tests/test_replay.py --no-cov -q
27 passed in 11.09s
$ uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-vision-integrity
Success: no issues found in 53 source files
```

Two defensive branches were then covered (`4c3d499`). The first attempt assumed two unrelated textures leave fewer than 8 points after the forward-backward check; they leave 20, with a median residual of 7.4 % of the face width (correctly "no plane"). That became its own test, and an untrackable (flat) side frame covers the branch:

```
E       AssertionError: assert Planarity(tracked_points=20, median_residual_ratio=0.07429, p90_residual_ratio=0.12384) is None
$ uv run --frozen pytest tests/test_replay.py -q --cov-fail-under=0
src/openverify_vision/replay.py                  165      0     26      0   100%
30 passed in 13.57s
```

What the tests pin:
- our SSIM equals scikit-image's `structural_similarity(gaussian_weights=True, sigma=1.5, use_sample_covariance=False, data_range=255)` within 1e-9 on six pairs (identical; a 2 px shift with noise and JPEG q70; a 20 px shift; another texture; a non-square crop; a uniform image); a region under 16 px is not measured; two sizes are refused;
- the face cosine is the dot product of the two unit embeddings, `null` without both;
- byte-identical poses, the same pixels in other bytes (raw SSIM 1.0) and a 2x resized copy are duplicates; a turned print is not;
- a planar turn of a still (6, 12, 24 and -12 degrees, the print turned about a vertical axis through the face, JPEG q85) leaves a median residual below 0.33 % of the face width (research §7's planar maximum); a 3-D re-pose by the helper (12, -12, 24 degrees) leaves more than 0.62 % (research §7's 3-D minimum) and more than 5x the planar residual;
- identical frames fit one homography exactly and register at SSIM 1.0; registration raises the SSIM a planar turn took away (above 0.9);
- a featureless face, an untrackable side frame or no homography leave the planarity and registered SSIM `null`; no centre face compares the whole frames only; a face box outside the frame measures nothing but the hash;
- a 3200 x 2400 frame with a 785-pixel face is tracked on a copy at most 600 pixels on a side, with at most 200 points.

Measured on the seeded texture (`textured(9)`, canonical face 157 px wide, JPEG q85), median / p90 residual as a share of the face width, then registered / raw SSIM:

| Turn | 3-D re-pose | Planar print |
|---|---|---|
| 6° | 0.80 % / 1.97 %, 0.794 / 0.273 | 0.016 % / 0.034 %, 0.991 / 0.963 |
| 12° | 1.62 % / 4.51 %, 0.548 / 0.248 | 0.032 % / 0.070 %, 0.989 / 0.845 |
| 24° | 3.07 % / 13.3 %, 0.274 / 0.256 | 0.080 % / 0.198 %, 0.987 / 0.445 |
| -12° | 1.30 % / 4.89 %, 0.583 / 0.251 | 0.032 % / 0.078 %, 0.989 / 0.849 |
| -24° | 3.65 % / 10.3 %, 0.309 / 0.277 | 0.080 % / 0.206 %, 0.987 / 0.463 |

These are pipeline numbers on a synthetic texture (mesh depth only), not a calibration.

## Slice 2: the background layout (C41.1, research §8)

**RED** (`b93b4ea`): the layout half of `tests/test_background.py`.

```
$ uv run --frozen pytest tests/test_background.py --no-cov -q
E       assert None is not None            # six layout tests: the stub measures nothing
E       assert np.uint8(0) == 255          # the stub mask covers nobody
7 failed, 2 passed in 0.58s                # passing: no face -> None, the mask's shape
```

**GREEN** (`795de04`). `mypy` first refused `Returning Any` from the background-pixel helper (a NumPy comparison); it now returns an explicit boolean array. The Stage 1 test `test_the_stage_2_measurements_are_null_until_their_owners_fill_them` then failed, as the plan intends, on the centre's background:

```
E       AssertionError: assert {'layout': [53.58, 0.211, -0.71, ...], 'valid_cells': '1100001110000001...', 'coverage': 0.25} is None
```

Its one background line now asserts the 144-number layout through the route (the plan changes the behaviour it checked; contractDeviations lists it).

```
$ uv run --frozen pytest tests/test_background.py tests/test_selfie_v2.py tests/test_analysis_v2.py tests/test_contract_fixtures.py -q --no-cov
53 passed in 2.08s
```

What the tests pin:
- the person mask covers the face, the hair above the box, a shoulder and the chest at the bottom edge, never the four corners, and is clipped to the frame;
- the layout is 48 cells of mean Lab, row by row from the top left (the left and right columns of a two-colour backdrop read their colour's OpenCV Lab within 0.5);
- a cell mostly covered by the person is `0` and takes the background mean; `coverage` is the share of valid cells;
- a saturated red person does not bleed into any valid cell (within 1.0 of the grey backdrop: the mask grows by twice the blur's sigma);
- a frame filled by the person has coverage 0, all cells `0`, and finite numbers;
- a backdrop shifted 12 px keeps its layout (distance under a third of another backdrop's);
- a 4000 x 3000 frame is blurred only as a copy at most 640 pixels long.

## Slice 3: the background comparison and its route (C41.2)

**RED** (`e3f3651`): the comparison and route half of `tests/test_background.py`.

```
$ uv run --frozen pytest tests/test_background.py --no-cov -q
E       NotImplementedError: background comparison is not implemented yet        # 7 tests
E       assert <HTTPStatus.NOT_IMPLEMENTED: 501> == 200                          # 4 route tests
E       AssertionError: assert 'candidate_1' in 'candidate_0: image data could not be decoded'
13 failed, 9 passed                     # the stub route numbered candidates by position
```

**GREEN** (`3cd8ec0`). The first run left two failures. `mypy` found no `cv2.ORB_create` in OpenCV 5's stubs (`cv2.ORB.create` is the typed factory). And the 640-pixel test found no match at all: its colour-keyed fake finder took magenta-ish shapes of the random room for the head (a 581-pixel "face" masking everything), a fixture defect; the test room now never draws the head's colour. The Stage 1 test that pinned the 501 stub now pins one result per candidate by field number (`[0, 4]`).

```
E       assert 0 >= 100          # BackgroundMatch(index=0, good_matches=0, inliers=0, inlier_ratio=0.0)
E       assert 200 == 501        # test_the_background_route_answers_501_until_it_is_implemented
$ uv run --frozen pytest tests/test_background.py tests/test_selfie_v2.py tests/test_app.py tests/test_app_analyze.py tests/test_limits.py -q --no-cov
117 passed in 12.37s
src/openverify_vision/background.py              132      0     20      0   100%
```

What the tests pin:
- a re-framed same room (research §8's re-frame: 30 px shift, scale 0.95, brightness +10, JPEG q75) has at least 100 inliers at a ratio of at least 0.5; another room has fewer than 50;
- the same richly textured person in front of two different rooms is not a match (the person is masked);
- a featureless candidate has 0 good matches, 0 inliers, ratio 0; an image compared with itself keeps at most 1,000 keypoints, ratio above 0.9;
- every image reaches the face finder at most 640 pixels long, in the function and through the route;
- the route answers one result per candidate, named by field number (`candidate_3` is index 3), `[]` without candidates, and names an unreadable candidate's field in its 422;
- with YuNet: a re-framed public-domain selfie matches, and another studio's portrait does not.

Measured (ORB 1,000 features, ratio 0.75, RANSAC 5 px at 640 px):

| Pair | Good matches | Inliers | Ratio |
|---|---|---|---|
| synthetic room vs its re-frame | 517 | 500 | 0.967 |
| synthetic room vs another room | 11 | 4 | 0.364 |
| same textured sitter, two rooms | 9 | 5 | 0.556 |
| person A selfie vs its re-frame (YuNet mask) | 510 | 505 | 0.990 |
| person A selfie vs person B selfie | 36 | 30 | 0.833 |
| person A selfie vs person A ID portrait | 49 | 17 | 0.347 |
| person B selfie vs person A ID portrait | 34 | 9 | 0.265 |

Research §8 measured 716 / 701 for the re-frame and 31 / 13 to 42 / 31 for the different backdrops; the order is the same. Comparing three public-domain candidates took 0.14 s.

## Slice 4: the XMP digital source type (C41.1, research §5.3 heuristic 9)

**RED** (`f5e96bb`): the XMP half of `tests/test_synthetic_face.py`. Packets are written by hand into a JPEG APP1 segment (after SOI) or a PNG `XML:com.adobe.xmp` iTXt chunk.

```
$ uv run --frozen pytest tests/test_synthetic_face.py --no-cov -q
E       assert None == 'trainedAlgorithmicMedia'       # attribute, element, rdf:resource, https, other prefix, bare code, spaced
E       assert None is not None                        # measure_synthetic on an upload
11 failed, 14 passed in 0.68s     # passing: every "reads as None" case, including the hostile ones
```

**GREEN** (`d3d67ca`), first run:

```
$ uv run --frozen pytest tests/test_synthetic_face.py tests/test_selfie_v2.py -q --cov-fail-under=0
src/openverify_vision/synthetic_face.py           53      2     14      0    97%   99-100      # the canonical stub
42 passed in 3.94s
```

What the tests pin:
- the IPTC code is read from an attribute, an element's text, an `rdf:resource`, with `http` or `https`, any namespace prefix, the bare code, and spaces around `=`; from a JPEG APP1 and from a PNG iTXt chunk;
- another vocabulary's URI, a code with a space, an empty or 300-character code, a non-ASCII value, or no `DigitalSourceType` all read as `None`; so do an upload without XMP, an empty upload, a property outside any XMP packet and a property after the packet's end;
- **hostile XMP:** a billion-laughs declaration whose root entity is an IPTC URI, with the value `&lol9;`, reads `None` in under 1 s (nothing is expanded); an external entity (`SYSTEM` an IPTC URI, or `file:///etc/hostname`) is never resolved; in a 68 KiB packet, a property after the first 64 KiB is not read and one before it is; 1,500 unreadable properties before a valid one stay bounded (at most 8 are read: `None`, in under 1 s); an 8 MiB upload of `<` bytes is searched in under 1 s;
- an upload reports its code, with or without a face; a camera capture never reads metadata.

## Slice 5: the synthetic-face cues (C41.1, research §5.3 heuristics 1-5)

Before the tests, a draft of each cue was measured on the public-domain faces and on drawn scenes in a scratch directory (not committed), and three draft definitions changed for reasons of principle, not to pass a fixture:
- the median-of-HH1 noise estimate is quantized on 8-bit data (only 0, 0.74 and 1.48 grey levels came out), so the cue uses the continuous Immerkaer estimate on the flattest pixels (the Phase 3 estimator);
- the two-sided noise ratio read 0.59 on a clean ID portrait, because skin texture makes a real face *noisier* than a suit or a backdrop; the research's failure mode is a face *smoother* than its surroundings, so only that direction counts;
- the tail slope swung between 0.03 and 1.2 across JPEG qualities where the backdrop's tail sat at the quantization floor (the log of nearly zero power); the spectra are now Welch-averaged, floored at the 8-bit quantization power, and the tail is measured only when the background's tail carries at least twice that floor. A pure level deficit (a smoothed face) is flat at the floor like white noise, so the slope cannot see it: the tail catches a tail that bends (up-convolution), the noise cue catches the smoothed face.

**RED** (`9bb0bfa`): the cue half of `tests/test_synthetic_face.py`.

```
$ uv run --frozen pytest tests/test_synthetic_face.py --no-cov -q
E       assert None is not None            # every cue unmeasured (15 plus 6 stability parametrisations)
E       assert None == 0.0 ± 1.0e-04       # the FFHQ-aligned square
22 failed, 27 passed in 7.40s              # passing: the XMP tests and the "None" edges
```

**GREEN** (`e9cf410`):

```
$ uv run --frozen pytest tests/test_synthetic_face.py -q --cov-fail-under=0
src/openverify_vision/synthetic_face.py          313     10     62     12    94%
49 passed in 11.07s
$ uv run --frozen pytest tests/test_selfie_v2.py tests/test_analysis_v2.py tests/test_contract_fixtures.py -q --no-cov
E           AssertionError: synthetic
E           assert {'spectral_tail_deviation': None, 'residual_peak_ratio': None, 'noise_inconsistency': 0.004, 'jpeg_grid_misalignment': 0.0351, ...} is None
1 failed, 43 passed
```

The Stage 1 composition test now asserts the synthetic cues are measured on a camera capture and its metadata is not read (contractDeviations lists it); `93 passed`. **Refactor** (`0466760`): the background-window search walks only free positions (the old loop had an exit no input could reach) and builds the inflated box without a type override. **Edges** (`7e4211b`): one expectation was wrong (a 40-pixel face has a 14-pixel neck, under the 16-pixel minimum); with a 60-pixel face the 21-pixel neck is used:

```
E       assert None is not None        # SyntheticScores(..., noise_inconsistency=None, ...)
$ uv run --frozen pytest tests/test_synthetic_face.py -q --cov-fail-under=0
src/openverify_vision/synthetic_face.py          315      0     62      0   100%
54 passed in 23.16s
```

What the tests pin, on a drawn 960 x 720 scene (a smooth backdrop, fine texture, sensor-like noise of sigma 2; the "face" a 200 x 240 box), one artefact at a time:
- a clean scene reads low on every cue (tail under 0.5, peak ratio under 3, noise under 0.1, landmark distance above 0.2), a PNG has no JPEG grid, and a clean JPEG q95 is aligned (under 0.1);
- a face up-convolved by 2 (area-halved, nearest-neighbour doubled, re-noised) bends the tail: at least 2.0 and 5x the clean scene's;
- a grating of 0.3 cycles per pixel in the face peaks at least 10x above the background, in PNG and JPEG q90; the same grating at 1/4 or 3/8 (JPEG and demosaic frequencies) stays under 3;
- a face blurred by sigma 2 reads at least 0.5 noise inconsistency; a face noisier than its surroundings reads 0;
- a face pasted from a JPEG q20 whose grid is shifted by (3, 5), the whole saved at q95, reads at least 0.5; the same paste on the aligned grid reads less;
- a flat backdrop leaves the tail unmeasured; a face filling the frame has no background window; a face too small for a spectrum still has its noise measured; a camera capture without a face measures nothing (`None`);
- the FFHQ-aligned square of a 1024-pixel frame is at distance 0; the canonical face in a 640 x 480 selfie frame is above 0.2; a 100-pixel crop moves it above 0.05; degenerate, non-finite or too few landmarks, or an empty frame, have no distance;
- a 5400 x 4050 frame with a 1300 x 1600 face filters only windows at most 256 pixels on a side;
- **stability:** every re-encoding (q95, q85, q75, resized 0.83 then q85, q75 then q90) of each public-domain face at 1,280 and 640 pixels, with YuNet's face, stays below a-priori "high" levels: tail under 4.0 (one decade across the tail band), peak ratio under 10 (one decade), noise and grid under 0.5 (mid-scale), landmark distance above 0.05 (5 % of the frame), and reads no digital source type.

Measured with the committed module on the test scenes (cue values; never a threshold):

| Input | Tail | Peak ratio | Noise | Grid | Landmarks |
|---|---|---|---|---|---|
| clean scene, PNG / q95 / q85 / q75 | 0.06 / 0.12 / 0.03 / 0.09 | 0.87 / 1.06 / 0.86 / 1.05 | 0 | - / 0.02 / 0.05 / 0.02 | 0.42 |
| face up-convolved x2, PNG / q90 | 2.68 / 4.50 | 4.85 / 2.53 | 0 | - / 0.20 | 0.42 |
| grating 0.3 c/px, PNG / q90 | 0.08 / 1.04 | 216 / 137 | 0 | - / 0 | 0.42 |
| grating 0.25 c/px (masked), PNG / q90 | 0.42 / 0.25 | 0.99 / 0.93 | 0 | - / 0.07 | 0.42 |
| grating 0.375 c/px (masked), PNG / q90 | 5.06 / 4.27 | 1.33 / 1.39 | 0 | - / 0.62 | 0.42 |
| face blurred sigma 2, PNG / q90 | 0.34 / 1.12 | 0.87 / 1.09 | 0.74 / 0.17 | - / 0.05 | 0.42 |
| shifted q20 paste, then q95 / q85 | 1.02 / 0.17 | 1.44 / 1.35 | 0.30 / 0.09 | 0.98 / 0.44 | 0.42 |
| aligned q20 paste, then q95 | 0.45 | 1.28 | 0.65 | 0.24 | 0.42 |

On the public-domain re-encodings with YuNet's face (3 faces x 1,280, 960 and 640 pixels x the 5 encodings of the stability test, 45 inputs): tail 0.03-2.19 on 25, `None` on 20; peak ratio 0.29-1.76; noise 0-0.10; grid 0-0.21; landmark distance 0.31-0.59. The tail is `None` on most clean studio portraits: downscaling a 30-megapixel original leaves almost no noise in the backdrop's tail.

Limits these numbers show: a smoothed face that is then compressed at q90 reads only 0.17 noise inconsistency (the encoder smooths the background too); a periodic pattern at a JPEG frequency confined to the face (the 3/8 grating) reads as a misaligned grid (0.62) and bends the tail; the cues are weak evidence, as C45.4 says.

## Measurements at 1,280 pixels (deliverable 6)

Each public-domain face at a 1,280-pixel long side as the centre, and the same portrait re-posed to +24° and -24° by the Stage 1 helper as the side poses (JPEG q90, YuNet faces and SFace embeddings in memory). Median of 10 runs (5 for the comparison) on the Xeon E5-1650 v3, while other agents ran their suites on the same machine:

| Stage | person A ID | person A selfie | person B selfie |
|---|---|---|---|
| consistency, left / right | 30.9 / 26.7 ms | 14.0 / 13.7 ms | 32.2 / 35.1 ms |
| synthetic, centre / left / right | 86.4 / 68.7 / 68.6 ms | 44.0 / 39.3 / 37.1 ms | 78.9 / 76.7 / 95.5 ms |
| background layout (centre) | 33.0 ms | 37.4 ms | 57.0 ms |
| comparison, probe + 5 candidates (YuNet included) | 188 ms | 318 ms | 423 ms |

So the integrity stages add at most about 0.35 s to a three-pose analysis (two consistencies, three synthetic, one layout), inside the C41.5 budget of 3 s for the whole analysis; the comparison is its own request.

What the re-posed real portraits measured (24°; never a threshold): face cosine to the centre 0.74-0.87; 74-128 tracked points; median residual 1.23-3.97 % of the face width (research §7: 0.62-2.2 % for 10-30°); registered SSIM 0.55-0.69 against raw 0.49-0.58; no duplicate. Background coverage of the centres: 0.29 (the tight ID portrait), 0.52 and 0.42.

## Final gates

```
$ uv run --frozen ruff check
All checks passed!
$ uv run --frozen ruff format --check
149 files already formatted
$ uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-vision-integrity
Success: no issues found in 57 source files
$ COVERAGE_FILE=/tmp/openverify-cov-vision-integrity uv run --frozen pytest
src/openverify_vision/background.py              132      0     20      0   100%
src/openverify_vision/replay.py                  165      0     26      0   100%
src/openverify_vision/synthetic_face.py          315      0     62      0   100%
TOTAL                                           6675     40   1004     20    99%
Required test coverage of 80% reached. Total coverage: 99.19%
1767 passed in 493.99s (0:08:13)
```

A first whole-suite run, while the `fixtures` agent was mid-way through its own uncommitted generator changes, showed 8 failures and 15 errors, all in `tests/test_make_synthetic_fixtures.py` and its tools (argument parsing of its new `--constants` and `--models` options); the same file passed alone a minute later (24 passed), and the rerun above is green. None touched this area's files.

```
$ flock /tmp/openverify-e2e.lock pnpm e2e        # with the Stage 1 selfie exclusion (e2e/src/exclusions.ts)
@openverify/flow:e2e:   29 passed (11.8s)
@openverify/e2e:e2e:   36 passed (3.6m)
 Tasks:    9 successful, 9 total
```

The five full-stack selfie specs Stage 1 excluded (`verification-completes`, `verification-fails`, `reload-between-uploads`, `government-id-review`, `ui-flow-links`) did not run; every other spec passed with the new measurements in every selfie analysis of the stack.
