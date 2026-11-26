# TDD evidence: Phase 3, Workflow 3A Stage 2, `vision-forensics`

Barcodes (zxing-cpp) and every C32.1 forensic measurement in `services/vision`, test-first. Owned paths: `src/openverify_vision/barcode.py`, `src/openverify_vision/forensics/` and their tests (`tests/test_barcode.py`, `tests/test_forensics*.py`, `tests/forensic_scenes.py`), plus the two `# --- vision-forensics ---` blocks in `analysis.py`.

Every command ran from `services/vision` after `source scripts/env.sh`, with `COVERAGE_FILE=/tmp/openverify-cov-vision-forensics` and `--cache-dir /tmp/openverify-mypy-vision-forensics`. Output is abbreviated.

Test images are drawn by the tests (`tests/forensic_scenes.py`): a card in the style of the fictional Utopia test card, whose "portrait" is a smooth blob on a neutral photo background, never a face. AAMVA payloads come from `contracts/fixtures/aamva/valid.json` and are rendered with `pdf417gen` only as barcode-only images on a plain background (C36).

## Slice 1: barcodes (C32.1)

**Stub** (`e706746`): `decode_side_barcodes(img, document)` and `MAX_DECODE_SIDE` in `barcode.py`, and the `forensics/geometry.py` names, so the tests import.

**RED** (`5596b14`): `tests/test_barcode.py`.

```
$ uv run --frozen pytest tests/test_barcode.py --no-cov -q
E       ValueError: not enough values to unpack (expected 1, got 0)      # the stub decodes nothing
E       assert 0 == 8
E       AssertionError: assert [] == [(b'ok', 'ok')]
E       assert [True] == [True, False]       # the side analysis reads the upload only
13 failed, 4 passed in 0.93s                 # the 4 passing: images without a barcode
```

**GREEN.** The first run left one failure, and it was the test's reference that was wrong:

```
E   AssertionError: (((162.33, 192.92), (1137.51, 148.47), ...), ((162.0, 193.0), (1142.0, 193.0), ...))
E   assert 44.53 <= 8.0
1 failed, 20 passed
```

The test compared the quad mapped back from the rectified pass with zxing-cpp's own quad on the perspective upload. Projecting the symbol's true corners through the canvas homography gives `[[162.3, 192.9], [1137.5, 148.5], [1170.8, 458.1], [143.1, 496.0]]`: the mapped quad is right within 0.3 px, and zxing-cpp's PDF417 detector only approximates the corners under perspective (44 px off at the top right). The test now compares against the true projected corners (tolerance 3 px).

Two defensive branches (a degenerate quad, a point sent to infinity) were taken out of `geometry.py`, driven by tests, and put back:

```
$ uv run --frozen pytest tests/test_barcode.py tests/test_forensics_geometry.py --no-cov -q
E   AssertionError: assert [Barcode(format='PDF417', ... quad=((5.0, 5.0), (5.0, 5.0), (5.0, 5.0), (5.0, 5.0)))] == []
E   AssertionError: assert array([[ 0.01817407, ...]]) is None          # rectified_to_upload of a degenerate quad
E   RuntimeWarning: divide by zero encountered in divide                 # map_points at the horizon
3 failed, 22 passed in 1.25s
```

RED committed as `c7c312c`, GREEN as `41b00ab`:

```
$ uv run --frozen pytest tests/test_barcode.py tests/test_forensics_geometry.py tests/test_analysis_v2.py -q --cov-fail-under=0
src/openverify_vision/barcode.py                 59      0     10      0   100%
29 passed in 2.03s
$ uv run --frozen mypy src/openverify_vision/barcode.py src/openverify_vision/forensics src/openverify_vision/analysis.py
Success: no issues found in 4 source files
```

What the barcode tests pin:
- both synthetic AAMVA vectors decode byte-exact from a clean render; `text` keeps LF, RS and CR (`Plain`), never `<LF>`;
- a perspective-warped, blurred (sigma 1), noisy (sigma 4), JPEG quality 60 photo decodes byte-exact;
- a greyscale numpy array decodes;
- no barcode on the card, a checkerboard, a 1x1 image or a uniform image;
- a 6000-pixel-wide upload reaches zxing-cpp at most `MAX_DECODE_SIDE` (2560) pixels wide, and its quad is scaled back to upload pixels (within 12 px);
- at most `MAX_BARCODES` (8), PDF417 first; a payload beyond the contract limits (base64 over 8192 characters, or text over 4096 UTF-16 code units, as zod counts) is left out, never truncated;
- the rectified pass: a barcode only it finds is mapped to upload pixels through the document quad (within 3 px of the true corners); one both passes find is reported once with its upload quad; without a rectified document only the upload is read; a degenerate quad maps nothing;
- the composition: `analyze_government_id_side` reads the upload, then the rectified document.

## Slice 2: the forensic measurements (C32.1)

**Design, measured before the tests were written** (scratch experiments on the synthetic card, recorded so the thresholds in the tests are not arbitrary):

| Measurement | Method | Clean | Signal present |
|---|---|---|---|
| `jpeg.double_compression_score` | K-normalised Fourier periodicity of the block-DCT histograms (12 low-frequency modes, `cv2.dct` basis), the mean of the 3 strongest | 0.000 to 0.003 for one save at quality 50 to 95, and for a re-save at the same quality | 0.28 to 0.52 for the tests' re-saves at a finer quality; 0.10 at quality 100 (weak, documented) |
| `ela_score` | re-save at 30, 45, 60, 75, 90 through `ImageChops.difference`, each 16x16 cell normalised across the ladder (the "JPEG ghost"), portrait against the rest | 0.06 to 0.13 (saved once or twice) | 0.60 (uncompressed portrait), 0.95 to 0.99 (portrait from a quality-30 JPEG) |
| `screen_grid_score` | Welch spectrum of a 1024-pixel window at full resolution, periods of 2 to 10 pixels, JPEG `k/8` frequencies excluded | 0.00 to 0.02 | 0.68 to 1.00 |
| `moire_score` | Welch spectrum of the document at 512 pixels, periods of 5 to 64 pixels, off both axes | 0.00 | 0.74 to 0.86 |
| `color_cast_score` | log-chromaticity of each 4x4 cell's most neutral quarter, deviation from the median cell | 0.17 to 0.21, warm or cool light and re-encoding included (photocopy 0.0) | 0.85 to 0.94 |
| `copy_move_score` | tiled ORB self-matching, one displacement from one compact area | 0.00 | 0.66 to 0.78 |
| `portrait_boundary_score` | noise (Immerkaer, mean, 5x5-flat pixels) inside and outside the frame line nearest the face | 0.00 to 0.16 | 0.47 (noise-free or smoothed paste) to 1.00 (noisier paste) |
| `star_glyph.score` | Hu-moment distance and solidity of contours in the upper 45%, four binarizations | 0.01 to 0.17 | 0.87 to 0.99 |

Three choices differ from a first reading of the task, for reasons the experiments gave:
- **ELA is normalised across a ladder of five fixed qualities.** A single re-save (quality 90 or 95) scored an untouched card 0.6 to 0.8, because the portrait's texture re-compresses differently from flat card. Normalising each cell across the ladder removes texture's scale; untouched cards then score at most 0.21.
- **Colour cast uses log-chromaticity, not CIELAB.** A global cool cast scored 0.50 in Lab (a per-channel gain does not move every colour equally there, and bright pixels clip). In `(ln R/G, ln B/G)` a gain is a translation, which the median cell cancels.
- **The portrait noise estimate reads only pixels whose 5x5 neighbourhood is flat**, with Immerkaer's mean estimator. The median of the integer residual was too coarse (steps of 0.25), and anti-aliased guilloche next to the frame read as noise. The gap between untouched and spliced cards grew from 0.24 to 0.31.

**Stubs:** `10dff22` (the modules), `35e288a` (the caps, the IJG tables and the helper names the tests spy on).

**RED** (`b83fc96`): ten test files, 177 tests.

```
$ uv run --frozen pytest tests/test_forensics_{upload,exif,jpeg,ela,spectral,chroma,copy_move,portrait,star,geometry}.py --no-cov -q
     40 E       assert None is not None
     12 E       assert 0.0 > 0.5
      5 E       assert False is True              # StarGlyph(found=False, ...)
      3 E       assert ExifSummary(s...has_gps=False) == ExifSummary(s... has_gps=True)
      1 E       assert (16, 11, 10, 16, 24, 40, ...) == (1, 1, 1, 1, 1, 1, ...)   # IJG table stub
      1 E       assert [] == [512, 256]           # the cap spies saw no call
92 failed, 85 passed in 16.09s                    # the passing ones: "absent" cases a 0 stub meets
```

**GREEN**, module by module. Branches that the first tests did not drive were taken out, given a failing test, and put back (each RED committed on its own):

| RED commit | Test | Failure without the branch |
|---|---|---|
| `84d8756` | EXIF text from bytes, cut by UTF-16 code units | `assert None == 'Utopia Optics'`; 200 astral characters kept |
| `0a979c5` | a decode that is not the stored image keeps the grid at the origin | `assert (3, 0) == (0, 0)` |
| `3f06aa5` | ELA windows under four cells, empty region | `cv2.error: !_src.empty()`, `IndexError` in `mask_bounds` |
| `a8e22cd` | a colour cast needs three measurable cells | `RuntimeWarning: Mean of empty slice` |
| `85b45de` | a frame at the image edge is measured on its other sides | `IndexError: index -1 is out of bounds` |
| `f27d306` | straight one-pixel rules are not stars | `ZeroDivisionError: float division by zero` |

Two test adjustments, committed on their own as `6e0aa94`:
- A re-save at quality 100 scored 0.10, under the 0.15 of the finer-quality cases. It moved to its own test, which claims only "above every single compression" (> 0.05); its place in the list went to the common 80-then-95.
- Random noise joined the copy-move degenerate cases.

Dead guards were removed rather than tested: a `try` around EXIF parsing (3,000 fuzzed EXIF blocks raised nothing once Pillow's warnings are silenced), a tile-size guard and an empty-shift guard in copy-move.

The grid offset matters: on a stored 1009 x 637 JPEG shown rotated (orientation 6), the double-compression score is 0.0 at the origin and 0.41 on the encoder's grid (offset (5, 0)).

GREEN committed as `5a5c0a6`:

```
$ uv run --frozen pytest tests/test_forensics_*.py tests/test_barcode.py -q --cov-fail-under=0
src/openverify_vision/barcode.py                  59      0     10      0   100%
src/openverify_vision/forensics/chroma.py         64      0     10      0   100%
src/openverify_vision/forensics/copy_move.py      86      0     24      0   100%
src/openverify_vision/forensics/ela.py            87      0     12      0   100%
src/openverify_vision/forensics/exif.py           28      0      8      0   100%
src/openverify_vision/forensics/geometry.py       76      0     16      0   100%
src/openverify_vision/forensics/jpeg.py          106      0     22      0   100%
src/openverify_vision/forensics/portrait.py       91      0     18      0   100%
src/openverify_vision/forensics/spectral.py       87      0      8      0   100%
src/openverify_vision/forensics/star.py           77      0     18      0   100%
src/openverify_vision/forensics/upload.py         59      0      2      0   100%
210 passed in 27.04s
$ uv run --frozen mypy src/openverify_vision/forensics src/openverify_vision/barcode.py
Success: no issues found in 12 source files
```

## Slice 3: the composition, hostile inputs (C32.1)

**RED** (`e893a0f`): `tests/test_forensics.py` replaces the Stage 1 stub test.

```
$ uv run --frozen pytest tests/test_forensics.py --no-cov -q
     15 E       assert None is not None
15 failed, 1 passed                      # the passing one: unreadable bytes are not measured
```

The Stage 1 composition tests asserted the stub's `forensics: null` (`test_analysis_v2.py::test_the_stage_1_stubs_report_nothing_found`, `test_app_analyze.py::test_government_id_sides_carry_the_v2_measurements`). Following the pattern `vision-document` used for its own fields, the forensics assertion moved out of "the stubs measure nothing" and now states what is measured: present, and no JPEG history for a PNG (`7f59c2e`). On the composition test's 320-pixel checkerboard the moire score is 1.0, which is honest: a perfectly periodic diagonal pattern is what the measure looks for. The module docstring now says a card printed with fine oblique periodic patterns reads as moire too.

**GREEN** (`6bb9a8e`):

```
$ uv run --frozen pytest tests/test_analysis_v2.py tests/test_app_analyze.py tests/test_forensics.py --no-cov -q
54 passed in 9.77s
```

Hostile inputs:
- A 1x1 PNG, uniform 64-pixel and 1600-pixel JPEGs and a 3 x 900 sliver all return a valid `Forensics` with every score 0, no portrait score and no star.
- A 6000 x 3784 JPEG is measured.
- Every stage works on a bounded copy or window, each pinned by a spy test:

| Stage | Bound |
|---|---|
| zxing-cpp | 2560 px |
| block DCT | 16,384 blocks |
| ELA window | 2048 px |
| pixel-grid window | 1024 px |
| moire | 512 px |
| chroma | 512 px |
| colour cast | 256 px |
| ORB | 1024 px, 16 x 100 features |
| portrait frame | 2048 px |
| star search | 800 px |

## Measurement: forensics on a 1600-pixel card

A synthetic card of 1600 x 1009 pixels (star, portrait, camera noise, JPEG quality 90), full-frame document and portrait box. Ten runs after a warm-up, on an Intel Xeon E5-1650 v3 (12 threads, shared with four other agents' test runs):

```
forensics median 0.334 s (min 0.332, max 0.350)
  screen_grid_score        median 125.2 ms
  ela_score                median  72.6 ms
  portrait_boundary_score  median  59.4 ms
  copy_move_score          median  20.6 ms
  color_cast_score         median  15.1 ms
  jpeg_forensics           median  13.8 ms
  moire_score              median   9.9 ms
  chroma_stats             median   8.4 ms
  find_star_glyph          median   6.8 ms
  read_upload              median   0.2 ms
barcodes (upload + rectified) median 45.2 ms
```

So about 0.76 s for the forensics and barcodes of both sides, within the C32.4 budget of 5 s for the whole analysis (OCR included). The `integration` agent's committed benchmark measures the whole.
