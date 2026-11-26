# TDD evidence: Workflow 3A Stage 2, `fixtures` (C36 synthetic fixtures and calibration input)

- **Slice owner:** `fixtures` (Workflow 3A, Stage 2), in parallel with `vision-document`, `vision-ocr`, `vision-forensics` and `checks-logic`.
- **Date:** 2026-10-21.
- **Input:** `docs/plans/phase-3.plan.md` C33, C34 and C36, the Stage 1 handoff (generator version constant and stamp, the MRZ and AAMVA vectors).
- **Paths:** `services/vision/tools/` (except `make_contract_fixtures.py`) and their tests in `services/vision/tests/`.
- **Commits:** `67de847..d317e64` (43 commits), then this file.

Each item follows the same cycle:
1. A `chore` commit adds the names a test needs, doing nothing useful, so the RED test imports and passes mypy.
2. The test is run and seen failing for the intended reason (RED).
3. The smallest change makes it pass (GREEN).
4. Refactors keep the suite green.

Other agents edited the same tree at the same time, so RED windows were kept short. While iterating, the gate was ruff, ruff format and mypy on my files, plus my tests. All commands ran in `services/vision` after `source scripts/env.sh`, with `COVERAGE_FILE=/tmp/openverify-cov-fixtures`; tests ran with `--no-cov`. Output is trimmed to the lines that matter.

## 1. The MRZ vectors and the TD3 and MRV builders (C33)

Stub `67de847` (`Td3Data`, `MrvData`, `td3_lines` and `mrv_lines` raising `NotImplementedError`), RED `cd5dd4a`, GREEN `1567e96`, refactor `f8434e0` (one sex rule for every layout).

`tests/test_mrz_vectors.py` reads every file in `contracts/fixtures/mrz/`:
- it recomputes every stated check digit;
- it rebuilds every valid TD1, TD3, MRV-A and MRV-B vector from its `fields`;
- for each invalid vector that parses, it checks that the vector differs from its rebuilt lines in exactly one check digit.

`check_digit` already existed, so its 32 vector cases passed at once; they characterise it. The RED failures are the new builders.

```text
$ uv run --frozen pytest tests/test_mrz_vectors.py --no-cov -q
FAILED tests/test_mrz_vectors.py::test_the_builders_reproduce_every_valid_vector[icao-9303-p7-mrv-a]
FAILED tests/test_mrz_vectors.py::test_the_builders_reproduce_every_valid_vector[icao-9303-p7-mrv-b]
FAILED tests/test_mrz_vectors.py::test_the_builders_reproduce_every_valid_vector[icao-9303-p4-td3]
FAILED tests/test_mrz_vectors.py::test_an_invalid_vector_differs_from_its_rebuilt_lines_in_one_check_digit[td3-document-number-check-digit]
E       NotImplementedError
4 failed, 35 passed in 0.13s
```

```text
$ uv run --frozen pytest tests/test_mrz_vectors.py tests/test_icao_mrz.py --no-cov -q
83 passed in 0.13s
```

**Follow-up after `checks-logic` extended the vectors.** `checks-logic` then added `ocr-corrections.json` (vectors with `corrected_lines` and no `fields`) and the ICAO Part 5 long document number example (`STEVENSON`, `D23145890734`). In `f5496f4` the test learned the extended format:
- it rebuilds only vectors that state `fields`;
- it recomputes the check digits of every correction vector's `corrected_lines`, which must hold exactly when the vector says `valid`;
- it checks that the digit positions of `tests/mrz_checks.py` agree with every parsed vector.

The test's own assumption was the failure there. The long number was a real RED:

```text
$ uv run --frozen pytest tests/test_mrz_vectors.py tests/test_icao_mrz.py --no-cov -q
E           ValueError: document_number: 'D23145890734' is longer than 9 MRZ characters
E       AssertionError: Regex pattern did not match.
E         Expected regex: 'optional_data_1'
FAILED tests/test_mrz_vectors.py::test_the_builders_reproduce_every_valid_vector[icao-9303-p5-td1-long-document-number]
FAILED tests/test_icao_mrz.py::test_td1_rejects_fields_that_do_not_fit[override1-optional_data_1]
2 failed, 111 passed in 0.44s
```

GREEN `b99f971` implements the Part 5 rule:
- the number field keeps nine characters, and a filler takes the digit's place;
- the rest of the number, its check digit and a filler open the optional data;
- numbers of up to 23 characters fit.

The commit also adds a test for a long number followed by optional data that fits. That branch was otherwise untested, and the test passed at once.

```text
113 passed in 0.23s
```

`test_icao_mrz.py` changed one existing case: a 10-character document number is no longer refused. It now overflows by the ICAO rule, so the refusal cases are a 24-character number and an overflow that leaves no room for the optional data.

## 2. The happy-path card carries no specimen marker (C36)

Refactor `96b574c` came first, with the suite green. It draws the card from a field layout (`front_fields`, `back_fields`), so `front_text()` and `back_text()` list every printed string. The renders are byte-identical to before (SHA-256 of both renders compared: `94d75d68…`, `6523efb0…`). `SAMPLE_HOLDER` and `SAMPLE_DOCUMENT` became `HAPPY_HOLDER` and `HAPPY_DOCUMENT`.

Then RED `5eddf83`. `tests/specimen_markers.py` holds the frozen C33 marker list: whole words, case-insensitive, accents folded. It is test data that proves the property and duplicates no check logic. The ICAO example persons and numbers are read from `contracts/fixtures/mrz/`.

```text
$ uv run --frozen pytest tests/test_synthetic_id.py tests/test_make_synthetic_fixtures.py --no-cov -q
E       AssertionError: assert ('SAMPLE', 'JANE') == ('CALDERWOOD', 'NORA')
E       AssertionError: assert {'NOT A REAL ...', 'SPECIMEN'} == set()
E         'NOT A REAL DOCUMENT'
E         'SAMPLE'
E         'SPECIMEN'
E       AssertionError: assert 'SPECIMEN - N...REAL DOCUMENT' == 'OpenVerify s...tic test card'
E       assert 1 >= 2
4 failed, 27 passed
```

GREEN `096f4eb` changes every printed value and keeps the geometry, colours, portrait placement and MRZ rendering:

| Item | Phase 1 card | C36 happy card |
|---|---|---|
| Holder | `SAMPLE`, `JANE`, born 12 August 1984 | `CALDERWOOD`, `NORA`, `F`, born 21 March 1988 |
| Document number | `SPEC12345` | `UT4829163` (document code `ID`, UTO) |
| Dates | issued 16 April 2024, expiring 15 April 2034 | issued 6 May 2024, expiring 5 May 2034 |
| Address | `1 SAMPLE STREET, UTOPIA CITY` | `27 HARBOUR ROAD, UTOPIA CITY` |
| Authority | `UTOPIA SPECIMEN AUTHORITY` | `UTOPIA CIVIL REGISTRY` |
| Header mark | `SPECIMEN` | `UTO` |
| Banner | `SPECIMEN - NOT A REAL DOCUMENT` | `OpenVerify synthetic test card` |

The commit also sets `GENERATOR_VERSION = 2`.

```text
128 passed in 1.98s
$ uv run --frozen pytest tests/test_real_faces.py --no-cov -q   # YuNet and SFace on the new card
7 passed in 5.33s
```

## 3. Rendering options for the variants

Stub `3ac9abf`, RED `ad641cb`, GREEN `16305f5`. The options are:
- `render_front(None, None)`: the framed portrait zone stays blank;
- `skip_values`: the labels are drawn, the values are not, and `value_box(field)` bounds the value;
- `render_back(mrz=…)`: the MRZ lines the variant gives.

```text
FAILED tests/test_synthetic_id.py::test_a_front_without_a_portrait_leaves_the_portrait_zone_blank
FAILED tests/test_synthetic_id.py::test_a_photo_needs_its_face_box - Assertio...
FAILED tests/test_synthetic_id.py::test_a_front_can_leave_a_field_value_blank_inside_its_value_box
FAILED tests/test_synthetic_id.py::test_a_back_draws_the_mrz_lines_it_is_given_inside_the_mrz_band
4 failed, 19 passed in 0.63s
```

```text
23 passed in 0.72s   (the card renders are unchanged: 7d191a7d…, 16040bac…)
```

## 4. The TD3 passport page and the MRV-A visa (`synthetic_travel.py`)

Stub `3f39df8`, RED `79294c2`, GREEN `2fc0a38`.

| Document | Size | MRZ | Document number |
|---|---|---|---|
| TD3 passport data page | 125 x 88 mm, 1500 x 1056 px | 2 x 44, `P<UTO…` | `UP7316408` |
| MRV-A visa | 120 x 80 mm, 1440 x 960 px | 2 x 44, `V<UTO…` | visa `UV5128374`, valid until 14 January 2031 |

Both carry the card's holder and the banner, and print no marker or ICAO example. `tests/mrz_checks.py` reads the digit positions of each layout independently of the builders.

```text
E       NotImplementedError
7 failed, 3 passed in 0.31s
```

```text
33 passed in 1.05s
```

## 5. The C36 variants (`synthetic_variants.py`)

Stub `23cef4a` held every name. Each variant is a `Variant` with:
- `name`, `group` and `expect`, the §4.1 checks it is built to trip;
- per side, a `Side` with the image and the truth: `fields`, `text`, `mrz`, `quad`, the JPEG `quality` and, from item 9, `portrait`.

Every `expect` id is checked against `docs/PLAN.md` §4.1. Four RED/GREEN cycles:

| Cycle | RED | GREEN | RED run |
|---|---|---|---|
| Document data: happy, specimen-stamped, expired, bad MRZ check digit, MRZ and VIZ disagree, issued after expiry, under-age, PO box | `8033744` | `cd927dd` | `17 failed in 0.31s` (`NotImplementedError`) |
| Capture: blurred, glare, low resolution, photocopy, screen recapture, on a background | `c99cb33` | `c81aaac`, then `4099ce8` | `12 failed, 17 passed in 1.48s` |
| Tampering and content: portrait swap, copy-move, handwritten field, front reused as back, no portrait, not an ID | `be39232` | `8283330` | `10 failed, 29 passed in 6.35s` |
| Other classes and the sets: TD3, MRV-A, the C36 set in plan order, distinct holders, re-encodings | `f298239` | `341539f` | `6 failed, 39 passed in 6.60s` |

Each test asserts the property the variant must have:

| Variant | Property asserted |
|---|---|
| expired | The MRZ expiry is in the past, every check digit holds and the VIZ expiry agrees |
| bad MRZ check digit | It differs from the happy MRZ in exactly one character, the document number's digit; only that digit and the composite fail |
| MRZ and VIZ disagree | The MRZ is valid and the front's birth date differs; the other fields agree |
| issued after expiry | The issue date is after the (future) expiry |
| under-age | The holder is a minor on the expiry day (time-independent) |
| PO box | The address matches `P.O. BOX` |
| specimen-stamped | `SPECIMEN` is in the printed text of both sides, as red ink over more than 2% of the pixels |
| blurred | The uploaded front's variance of the Laplacian is below half the Phase 1 threshold, and the back is untouched |
| glare | The uploaded front's glare ratio is above 1.5 times the threshold |
| low resolution | At most 35% of the card width, aspect kept |
| photocopy | Equal channels, saturation below 3, no glare and still sharp |
| screen recapture | Display-grid energy (see item 9) and no glare |
| on a background | 1200 x 1500 frame, not of ID aspect; the quad covers 30-70% with a card aspect; un-warping the quad gives back the card (mean error below 12) |
| portrait swap | Another face whose patch went through JPEG quality 60 on its own grid: re-encoding it at 60 changes it less than a quarter as much as the genuine portrait. Nothing outside the portrait differs from one JPEG pass of the card |
| copy-move | The changed rectangle is textured and appears with an exact match elsewhere, without overlap |
| handwritten field | Blue ballpoint ink, a stroke-width spread over 1.4 times the printed value's, nothing else changed |
| front reused as back | The same pixels as the front, other JPEG bytes, no MRZ |
| no portrait | The portrait zone equals the background |
| not an ID | A page of text with no ID aspect, no MRZ and no marker |

Capture and tampering variants are also checked for determinism.

Measured while choosing the parameters, outside the committed tests, against the real portrait:
- **Handwriting.** A pen model retraces each glyph's skeleton at radius 1 or 3 px, by a smoothed random pressure, slanted, with a wandering baseline. The stroke-width spread is 0.474, against 0.251 for the printed value.
- **Glare.** Ratio 0.095.
- **Blur.** Sigma 1.8 gives a variance of the Laplacian of 15.

Process notes, recorded as they happened:
- `c81aaac` was committed with one ruff finding (a magic number) and three mypy errors in `synthetic_variants.py`. My command chain ran the commit after a failed check, because it used `;`. `4099ce8` fixed them. From then on, every commit ran behind a gate script (ruff, format and mypy on my files, then my tests) joined by `&&`.
- The handwriting parameters were tuned twice before the GREEN. The first prototype's spread was inflated: it measured the pen on top of the still-printed value.

## 6. AAMVA barcode-only images (`synthetic_aamva.py`)

Stub `22cd904`, RED `9f7dc34`, GREEN `e9fc1dc`. Every payload of `contracts/fixtures/aamva/`, valid and invalid, is rendered with pdf417gen as a PDF417 on a plain background:
- 13 columns, error correction level 5, 3 px modules;
- ink `#14181f` on `#e8e8e8`, which is below glare level;
- only two colours, never on a card.

zxing-cpp, the service's decoder, reads each one back to the payload's exact bytes. A vector id used twice is refused.

```text
FAILED …test_each_payload_renders_as_a_pdf417_that_decodes_to_its_exact_bytes[dl-636014-real-id]
… (all six payloads of the seed vectors)
10 failed in 0.12s
```

**Process note.** `e9fc1dc` was committed with one failing test. Meanwhile `checks-logic` had added vectors whose marker subfile is jurisdiction-specific (`ZO` for Ontario, `ZT` for Texas), as the AAMVA README defines it, and my test had hard-coded `ZC`. The run that showed it was not part of the commit gate. `e7766b6` corrected the test to the README's rule.

```text
16 passed in 1.11s   (12 payloads, all decoded byte-exact)
```

## 7. The writer (`make_synthetic_fixtures.py`)

Stub `3dd751b`, RED `d597a60`, GREEN `7032df6`. The happy pair keeps its e2e file names. The writer adds:
- `variants/<name>-front.jpg` and `variants/<name>-back.jpg`;
- `aamva/<vector id>.png`;
- `variants.json`, with per variant its group, `expect`, description and, per side, the file and the truth, and per AAMVA vector its file.

Directories an older version left behind are replaced. The stamp is written last, and the output is byte-for-byte reproducible. The tests share one module-scoped run, so the file runs three generations instead of one per test.

```text
FAILED tests/test_make_synthetic_fixtures.py::test_generates_every_asset - As...
FAILED tests/test_make_synthetic_fixtures.py::test_the_index_lists_the_happy_card_and_every_variant_with_its_files
… (index, files, AAMVA, stale directories, version, stamp order)
8 failed, 10 passed in 1.12s
```

```text
18 passed in 13.53s
```

The happy pair stayed byte-identical to version 2's for the same faces (`cmp` of `id-front.jpg`, `id-back.jpg`, `selfie-a.jpg`, `selfie-b.y4m`). Three existing tests changed with the outputs C36 adds:
- `test_generates_every_asset` lists the new entries;
- `test_output_is_byte_for_byte_reproducible` compares every file;
- `test_it_stamps_its_version_after_writing_every_asset` compares with every file.

## 8. The calibration run (`calibrate_government_id.py`)

Stub `7e9c839`, RED `b134e64`, GREEN `48ebe34`. `measure()` runs `analyze_government_id_side` in process on the exact bytes the generator writes, over:
- the C36 set;
- four distinct holders and four re-encodings of the happy card (C34);
- every AAMVA image, as a back side.

It writes the C32.1 side analyses with the truth and the `model_versions`. The tests use stub analysers:
- a fixed face detector and a unit-vector recognizer;
- the OCR engine over an empty models directory, which reads nothing and reports no text model; the tool says so on stderr.

```text
E       NotImplementedError
8 failed in 1.06s
```

```text
8 passed in 10.50s
```

The test of `main`'s default selection was rewritten in the GREEN commit: it records what `main` passes to `measure` instead of analysing about 75 sides, which took most of 28 s. `measure` itself keeps its own tests. The GREEN commit also fails fast when the face models are missing, before building the set.

A refactor followed: `75b8489` moves the shared test inputs into `tests/fixture_inputs.py`. `471f5d8` builds the two-sided variants from a typed happy front and back pair; a whole regeneration with the real faces is byte-identical (`diff -r`).

## 9. Portrait names and a readable screen recapture

The first full calibration with the real models showed two problems:
- **Shared portraits.** Distinct holders that share a portrait photo are 0-6 bits apart in pHash. The report must be able to tell them apart from distinct photos.
- **Recapture too strong.** The recapture hid the portrait from YuNet (0 faces) and the back MRZ from OCR, so it tripped more than its own check.

Stub `b07ee6f`, RED `c8270ec`:

```text
FAILED tests/test_synthetic_variants.py::test_the_screen_recapture_keeps_the_card_about_as_bright_as_the_original
FAILED tests/test_synthetic_variants.py::test_every_side_names_the_portrait_photo_it_shows
FAILED tests/test_make_synthetic_fixtures.py::test_the_index_lists_the_happy_card_and_every_variant_with_its_files
FAILED tests/test_make_synthetic_fixtures.py::test_the_index_records_what_each_side_shows
4 failed, 61 passed in 28.96s
```

Test refactor `7ed94e4` measured the recapture at the display's pixel pitch instead: the 0.3-0.5 cycles per pixel band, at least three times the happy card. The old broad-band measure was the strongest peak above 0.08 cycles per pixel, at twice the happy card. It is stricter on the grid and unaffected by the MRZ's own periodicity on a happy back. The committed recapture scored 9.9 and 9.4 times on it before the change. GREEN `a665f07`:
- `Portrait.name`, the manifest entry, is recorded in every side's truth;
- the recapture keeps the display's brightness (subpixel leak 0.5, row gap 0.6, highlights capped at 230).

```text
251 passed in 46.04s   (my files' gate)
```

Version bump: RED `8245ef1` (`assert 3 >= 4`), GREEN `d317e64`, `GENERATOR_VERSION = 4`.

## 10. Measurements (full calibration run, real models)

`uv run --frozen python tools/calibrate_government_id.py` measured 30 variants and 12 AAMVA images in 1 min 54 s. The models were `yunet-2026may`, `sface-2021dec`, `pp-ocrv6-small-det` and `pp-ocrv6-small-rec`, with the other Stage 2 modules as they stood at `d317e64`.

**pHash.** Hamming distances of the front, 64 bits:

| Pair | Distance |
|---|---|
| Re-encodings of the happy card (q85, q75, q60, 90% resize) | 0, 0, 2, 2 |
| Distinct holders sharing a portrait photo | 0, 2, 4, 6 |
| Distinct holders with different photos | 10 (all six pairs) |
| Front reused as back, front to back | 0 |
| A genuine front and back | 28 |

**OCR on the happy card.**
- VIZ: 7 of 7 values read verbatim.
- TD1 MRZ: character errors of 2, 1 and 0 per 30-character line, all letter/digit confusions in letter-only positions: `I`→`1` in the document code and `O`→`0` in `UTO`, which C31.3 allows correcting.
- TD3 and MRV-A MRZs: 0 and 1 errors per 44-character line.

**Document detection.**
- The tightly cropped card is `full_frame`.
- The card on the desk is found by `contour`, with an area ratio of 0.409; the truth is 0.41.

**Capture variants.**
- Blurred front: a variance of the Laplacian of 15.
- Glare front: a glare ratio of 0.095.
- The screen recapture keeps its face, 15 text lines and a readable back MRZ.

**Barcodes.** All 12 AAMVA images decode.

**Timings.** Building the whole C36 set takes about 4 s with the real faces. A full generator run, selfie clips included, takes about 6 s.

## 11. Final gates

```text
$ uv run --frozen ruff check
All checks passed!
$ uv run --frozen ruff format --check
112 files already formatted
$ uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-fixtures
Success: no issues found in 44 source files
$ COVERAGE_FILE=/tmp/openverify-cov-fixtures uv run --frozen pytest
TOTAL                                           4205    142    634     55    95%
Required test coverage of 80% reached. Total coverage: 95.27%
1199 passed in 126.19s (0:02:06)
$ flock /tmp/openverify-e2e.lock uv run --frozen python tools/make_synthetic_fixtures.py
wrote …/fixtures/generated/variants.json (49075 bytes)          # stamp 4; 39 variant files, 12 AAMVA images
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   25 passed (9.0s)
@openverify/e2e:e2e:   ✓  38 [chromium] › tests/verification-completes.spec.ts:27:1 › an inquiry on the default template completes with every check passed (9.2s)
@openverify/e2e:e2e:   39 passed (3.5m)
```

Every tool this slice owns is at 100% line and branch coverage under its own tests: `calibrate_government_id.py`, `fake_camera.py`, `icao_mrz.py`, `make_synthetic_fixtures.py`, `synthetic_aamva.py`, `synthetic_id.py`, `synthetic_travel.py` and `synthetic_variants.py`.

## Orchestrator: the copy-move variant test failed on GitHub's runner

CI run 39584147501 (the push of `70e78f1`) failed one vision test; every other job passed. The test located the copied patch with `cv2.matchTemplate(..., cv2.TM_SQDIFF)` and asserted that the best score was exactly 0:

```text
tests/test_synthetic_variants.py:538: in test_the_copy_move_variant_repeats_a_textured_patch_of_the_front_elsewhere
>       assert best == 0
E       assert 20.0 == 0
================== 1 failed, 1222 passed in 63.61s (0:01:03) ===================
```

OpenCV sums the squared differences in floating point, so a perfect match need not score exactly 0 on another CPU. The check was also too weak: locally, a patch with one pixel changed still scored `0.0`, so the assertion could not tell a copy from a near-copy. The test now uses the best match only to locate the source and compares the source pixels with the patch exactly (`np.array_equal`).

Probe (`uv run --frozen python <scratch probe>`; the same match, then the exact comparison):

```text
as built: sqdiff=0.0 exact=True
one pixel changed: sqdiff=0.0 exact=False
```

GREEN: `uv run --frozen pytest tests/test_synthetic_variants.py --no-cov` gives `50 passed in 10.80s`; ruff, format and mypy are clean on the file.
