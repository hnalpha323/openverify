# TDD evidence: Workflow 3B review fixes (Python)

- **Slice owner:** Python fixer (Workflow 3B, fix stage).
- **Date:** 2026-10-21.
- **Input:** the Workflow 3B review of the vision service and its tools in Phase 3 (`f212cb5..HEAD`).
  - Blocking: K101 (HIGH, check correctness) and G010 (HIGH, denial of service).
  - MEDIUM, in priority order: K102 (licence and stale docs) and G011 (denial of service).
- **Paths owned:**
  - `services/vision/`, `models/manifest.json`, `scripts/fetch_models.py`, `contracts/fixtures/vision/`;
  - `infra/docker/apps.Dockerfile`, `infra/tests/compose.test.sh`, `THIRD_PARTY_LICENSES.md`;
  - this file.
- **Dependencies:** none added. `pyproject.toml`, `uv.lock` and `THIRD_PARTY_LICENSES.md` are unchanged.
- **Golden fixtures:** the vision contract fixtures (`contracts/fixtures/vision/*.json`) are byte-identical; only their README gains the K101 rule.

Each fix follows the same cycle:
1. Write a regression test and run it, to see it fail for the intended reason (RED).
2. Make the smallest change that passes it (GREEN).
3. Refactor with the suite green.

The test and the fix are separate path-scoped commits. Every command ran from `services/vision` after `source ../../scripts/env.sh`, unless shown otherwise. Pytest ran with `COVERAGE_FILE=/tmp/openverify-cov-python-fixer` and mypy with `--cache-dir /tmp/openverify-mypy-python-fixer`. Output is trimmed to the lines that matter.

**RED tests type-check.** `mypy src tools` (the gate) does not cover `tests/`. Each RED test file was therefore also checked with `MYPYPATH=../tools:. mypy <file>` from `tests/`. The new code added no error. The only errors reported are ones that already exist in the shared helpers (`document_cards.py`, `synthetic.py`) and in `test_app_analyze.py::test_default_engine_is_created_lazily_from_settings`, and the committed version of that file reports them too.

**Real-model before/after.** Several checks below run the real models (`models/`, fetched) on the HEAD source tree before a fix and on the fixed tree. The before tree is a `git archive` copy of `services/vision/src` at `9cf0311`, run with `PYTHONPATH` pointing at it. The scripts live in the session scratchpad and are not committed.

## Baseline

```
$ uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools --cache-dir …
All checks passed!
114 files already formatted
Success: no issues found in 45 source files
$ COVERAGE_FILE=… uv run --frozen pytest
TOTAL                                           4377      0    648      0   100%
1223 passed in 121.28s (0:02:01)
```

## K101 (HIGH): the ID portrait was the largest face on the whole upload

**Confirmed** at `9cf0311` by reading the code:
- `analysis.py` took `portrait = base.largest if front else None`, the largest face anywhere on the upload. That face was embedded as `sides.front.portrait`, measured for `portrait_clarity`, and handed to the document quality and the forensics as the portrait box.
- `app.py::_embed` (`POST /v1/embed/face`) embedded the largest face on the whole image. The API re-embeds stored ID fronts with it (`idPortraitOf` and the C34 inconsistent-repeat candidates).

**Contract** (Workflow 3B review K101, given by the orchestrator; the TypeScript fixer implements the API half):
- `POST /v1/embed/face` takes an optional multipart text field `subject`:
  - `selfie` (the default when absent) keeps today's behaviour, the largest face on the image;
  - `document` means a government ID front. When document detection finds a quad (`contour` or `lines`), the face is the largest one whose box centre lies inside the quad. For `full_frame` or `none`, it is the largest face on the whole image. With no face inside a found quad, the answer is exactly as for an image without a face;
  - any other value answers `422`.
- `/v1/analyze/government-id` applies the same `document` rule to the front's portrait, which feeds the embedding, `portrait_clarity` and the forensics portrait box. `faces` still lists every face.

### RED (`9cf0311`)

`tests/test_analysis_v2.py`. The stages are recording fakes, so these tests pin the wiring:
- `test_the_portrait_is_the_largest_face_inside_a_found_quad[contour|lines]`: a quad around the small face only. The portrait, the clarity call, the document-quality box and the forensics box are the small face, and `faces` still lists both faces;
- `test_no_face_inside_a_found_quad_is_no_portrait[contour|lines]`: no portrait, clarity asked about `None`, and no portrait box;
- `test_a_full_frame_document_keeps_the_largest_face`: unchanged behaviour, so it passes at RED.

`tests/test_app_analyze.py` uses synthetic scenes from `document_cards.py`: a card warped onto a wood-like table, left in a 1600 x 1200 frame, beside a larger face-coloured oval (`LIVE_FACE`, 340 x 460, outside the card). Real document detection finds the card by `contour`, and the fake face detector reports the card's portrait box and `LIVE_FACE`.
- `test_embed_face_for_a_document_is_the_face_on_the_card`
- `test_embed_face_for_a_selfie_is_the_largest_face_in_the_image[None|selfie]`: today's behaviour, passes at RED.
- `test_embed_face_for_a_full_frame_card_is_unchanged`: a tightly cropped card (`full_frame`) answers the same with `subject=document` as without a subject. It passes at RED.
- `test_embed_face_for_a_document_with_no_face_on_it_is_no_face`: `{"face": null, "face_count": 0}`, and the recognizer is never called.
- `test_embed_face_refuses_an_unknown_subject`: `422` problem naming `subject`, and the value is not echoed back.
- `test_government_id_portrait_is_the_face_on_the_card`: portrait bbox and clarity width are the card's portrait. `document_quality.glare_ratio_portrait` and `forensics.portrait_boundary_score` are measured, because the box now lies on the rectified card.
- `test_government_id_with_no_face_on_the_card_has_no_portrait`

```
$ uv run --frozen pytest tests/test_analysis_v2.py tests/test_app_analyze.py --no-cov -q
E       assert (60.0, 40.0, 80.0, 100.0) == (10.0, 10.0, 20.0, 20.0)
E       AssertionError: assert EmbeddedFace(bbox=(60.0, 40.0, 80.0, 100.0), score=0.93, …) is None
E       assert [1170.0, 330.0, 340.0, 460.0] == approx([69.76…, 411.05…, 270.18…, 328.76…] ± 0.01)
E       assert 200 == 422
FAILED tests/test_analysis_v2.py::test_the_portrait_is_the_largest_face_inside_a_found_quad[contour]
FAILED tests/test_analysis_v2.py::test_the_portrait_is_the_largest_face_inside_a_found_quad[lines]
FAILED tests/test_analysis_v2.py::test_no_face_inside_a_found_quad_is_no_portrait[contour]
FAILED tests/test_analysis_v2.py::test_no_face_inside_a_found_quad_is_no_portrait[lines]
FAILED tests/test_app_analyze.py::test_embed_face_for_a_document_is_the_face_on_the_card
FAILED tests/test_app_analyze.py::test_embed_face_for_a_document_with_no_face_on_it_is_no_face
FAILED tests/test_app_analyze.py::test_embed_face_refuses_an_unknown_subject
FAILED tests/test_app_analyze.py::test_government_id_portrait_is_the_face_on_the_card
FAILED tests/test_app_analyze.py::test_government_id_with_no_face_on_the_card_has_no_portrait
9 failed, 42 passed in 8.75s
```

Each failure is the intended one: the live face (`LARGE`, or `LIVE_FACE` at 1170, 330) is taken for the portrait, and an unknown `subject` is accepted.

### GREEN (`70da189`)

- `analysis.py`:
  - `document_faces(faces, detection)` keeps the faces whose box centre lies inside the quad (`cv2.pointPolygonTest` ≥ 0) when the method is `contour` or `lines` (`QUAD_METHODS`). Otherwise it returns every face;
  - `embedded_face(img, engine, face)` is the one place a face is embedded;
  - `ImageAnalysis.largest` became `found`, every detected face, largest first. Only `analysis.py` used `largest`;
  - `analyze_government_id_side` takes the first face of `document_faces(base.found, detected.detection)` as the portrait on the front, and embeds it only then.
- `schemas.py`: `EmbedSubject = Literal["selfie", "document"]`.
- `app.py`: `embed_face` takes `subject: Annotated[EmbedSubject, Form(...)] = "selfie"`, so FastAPI answers any other value with the existing `422` problem. For `document`, `_embed` finds the faces, runs `document.detect_document` and embeds the first face on the document. The `selfie` path is unchanged.
- `README.md` documents `subject` and the portrait rule.

```
$ uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools --cache-dir …
All checks passed!
114 files already formatted
Success: no issues found in 45 source files
$ COVERAGE_FILE=… uv run --frozen pytest
src/openverify_vision/analysis.py                119      0     12      0   100%
src/openverify_vision/app.py                     145      0      6      0   100%
TOTAL                                           4397      0    650      0   100%
1236 passed in 122.72s (0:02:02)
```

**Real models, the reported scenario.** The happy card (`id-front.jpg`, person A's public-domain portrait) was placed 1000 pixels wide on a table. A 480-pixel oval crop of person B's selfie, larger than the card's portrait, was put beside it, and the scene was encoded as a JPEG at quality 92:

```
BEFORE document contour faces [[1202.86, 464.74, 228.51, 278.86], [120.1, 492.55, 172.55, 220.07]]
  portrait bbox [1202.86, 464.74, 228.51, 278.86] | clarity width 228.51 | glare_ratio_portrait None
  portrait vs selfie-a (the card's holder) 0.215 | vs selfie-b (the person holding it) 0.923
  embed subject=document bbox [1202.86, 464.74, 228.51, 278.86] face_count 2
AFTER document contour faces [[1202.86, 464.74, 228.51, 278.86], [120.1, 492.55, 172.55, 220.07]]
  portrait bbox [120.1, 492.55, 172.55, 220.07] | clarity width 172.55 | glare_ratio_portrait 0.0
  portrait vs selfie-a (the card's holder) 0.686 | vs selfie-b (the person holding it) 0.111
  embed subject=document bbox [120.1, 492.55, 172.55, 220.07] face_count 1
```

Before the fix, person B holding person A's card scored 0.923 against their own selfie. That is above SFace's 0.363 threshold, so `id_selfie_comparison` would have passed for any card held up. After the fix, the portrait is the card's: 0.686 against its holder, and 0.111 against the person holding it.

**Unchanged results.** The full analysis and `/v1/embed/face` (with and without `subject=document`) were run on these fixtures before and after the fix: the happy card (`id-front.jpg` + `id-back.jpg`, the pair the e2e suite uploads) and the variants `on-background`, `portrait-swap`, `no-portrait`, `td3-passport` and `not-an-id`. Every response is identical, all 18 of them. Every fixture front except `on-background` is `full_frame` or `none`, and on `on-background` the portrait lies inside the quad.

## G010 (HIGH): elongated uploads made unbounded text-detector inputs

**Confirmed:**
- `ocr/detection.py::detect_text` first bounds the image: the longer side to at most 2000 and the shorter side to at least 30, both rounded to multiples of 32;
- `detection_input` then scales the shorter side up to 736 (`limit_type` `min`), with no bound on the longer side;
- it normalised with float64 mean and standard deviation arrays, so it held two float64 copies of the map before the cast back to float32.

The resulting detector inputs, computed from the shapes alone:

```
4000x30: bounded 1984x32 -> detector input 45632x736 = 33.6 Mpx
1500x8: bounded 5632x32 -> detector input 129536x736 = 95.3 Mpx
1x5000: bounded 32x1984 -> detector input 736x45632 = 33.6 Mpx
1027x648: bounded 1027x648 -> detector input 1152x736 = 0.8 Mpx
```

### RED (`551ff71`)

`tests/test_ocr_detection.py`:
- `test_an_elongated_upload_never_makes_a_detector_input_over_the_side_bound[4000x30|1x5000|1500x8]` runs `detect_text` on a recording fake model. The expected inputs:
  - 4000x30 gives `(1, 3, 32, 1984)`;
  - 1x5000 gives `(1, 3, 1984, 32)`;
  - 1500x8 gives none: capped to the longer side, its 32 rows round to nothing. That means no text and no error, as `detection_input` already answers for a side that rounds to nothing.
- `test_the_detector_input_is_normalised_in_float32` measures peak memory with `tracemalloc`. NumPy and OpenCV allocations are traced. Normalising a 736 x 736 image peaked at 5.0 times the output batch with float64 statistics. In place in float32 it peaks at 2.0 times; the test allows 3.

The 1500x8 case allocates gigabytes on the old code, so RED ran under a virtual-memory limit:

```
$ (ulimit -v 9000000; /usr/bin/time -f "maxrss %M KB, %e s" uv run --frozen pytest tests/test_ocr_detection.py --no-cov -q)
E       assert 32568992 <= (3 * 6500352)
E       assert [(1, 3, 736, 45632)] == [(1, 3, 32, 1984)]
E       assert [(1, 3, 45632, 736)] == [(1, 3, 1984, 32)]
E       assert [(1, 3, 736, 129536)] == []
FAILED tests/test_ocr_detection.py::test_the_detector_input_is_normalised_in_float32
FAILED tests/test_ocr_detection.py::test_an_elongated_upload_never_makes_a_detector_input_over_the_side_bound[4000x30]
FAILED tests/test_ocr_detection.py::test_an_elongated_upload_never_makes_a_detector_input_over_the_side_bound[1x5000]
FAILED tests/test_ocr_detection.py::test_an_elongated_upload_never_makes_a_detector_input_over_the_side_bound[1500x8]
4 failed, 22 passed in 10.79s
maxrss 5753784 KB, 12.02 s
```

### GREEN (`e97204c`)

In `detection_input`:
- the ratio is also capped at `max_side_len / max(height, width)`, so the longer side never passes 2000. PaddleOCR's `limit_type: max` uses the same arithmetic;
- the map is normalised in place in float32: `/= 255`, `-=` and `/=` with float32 statistics.

The vendored file's header lists both changes (Apache-2.0 §4(b)). `bound_side_lengths`, RapidOCR's arithmetic, is unchanged: its 32 x 5632 output for 1500x8 is about 0.5 MB, and the cap bounds what is built from it.

```
$ /usr/bin/time -f "maxrss %M KB, %e s" uv run --frozen pytest tests/test_ocr_detection.py tests/test_ocr.py tests/test_ocr_notice.py tests/test_ocr_composition.py tests/test_mrz_locate.py --no-cov -q
83 passed in 2.95s
maxrss 272808 KB, 3.79 s
```

**Real models,** `POST /v1/analyze/government-id` in process, white PNGs, after a warm-up request that loads the models:

```
BEFORE 4000x30 (510 bytes): HTTP 200 in 14.6 s, maxrss 4363 MB (after loading the models 372 MB), text lines 0
AFTER  4000x30 (510 bytes): HTTP 200 in 0.0 s, maxrss 369 MB (after loading the models 369 MB), text lines 0
BEFORE 1x5000 (3213 bytes): HTTP 200 in 14.9 s, maxrss 4452 MB (after loading the models 351 MB), text lines 0
AFTER  1x5000 (3213 bytes): HTTP 200 in 0.0 s, maxrss 344 MB (after loading the models 344 MB), text lines 0
BEFORE 1500x8 (136 bytes): HTTP 500 in 34.3 s, maxrss 10161 MB (after loading the models 343 MB), body {"type":"about:blank","title":"Internal Server Error","status":500,"detail":"the image analysis could not run on this up…
AFTER  1500x8 (136 bytes): HTTP 200 in 0.0 s, maxrss 403 MB (after loading the models 403 MB), text lines 0
```

The BEFORE 1500x8 run was under `ulimit -v 16000000`. onnxruntime failed allocating after about 10 GB, and the API worker would have retried that `inference_failed` answer.

**Unchanged results.** The 18 fixture responses of K101 are identical again, OCR text and confidences included. The float32 normalisation differs from float64 by at most 1.2e-7 per input value.

## K102 (MEDIUM): the vision image lacked NOTICE; stale docstrings and README

**Confirmed:**
- Compose builds the vision image from `services/vision/Dockerfile` (context `../services/vision`), not `infra/docker/apps.Dockerfile`. Its runtime stage copied only the virtual environment, so the vendored RapidOCR files shipped inside it (with their headers) but `NOTICE` did not. `.dockerignore` does not exclude `NOTICE`. The fix is therefore in `services/vision/Dockerfile`; `infra/docker/apps.Dockerfile` (the TypeScript apps image) is unchanged.
- `analyze_government_id_side` and the `test_analysis_v2.py` module docstring said barcodes are read on the upload. `barcode.decode_side_barcodes` reads the upload, then the rectified document, and maps those quads back to upload pixels.
- `services/vision/README.md`'s "Test fixtures and tools" described only the Phase 1 card and selfies, and its introduction still said OCR, MRZ and PDF417 "follow in later phases".

### RED (`456d5f9`)

`tests/test_ocr_notice.py::test_the_vision_image_ships_the_notice_next_to_the_application` reads the Dockerfile's runtime stage. It expects a `COPY … NOTICE /app/NOTICE` line there, and expects `NOTICE` not to be dockerignored. `compose.test.sh` checks the rendered compose file, not Dockerfiles, so the assertion sits with the other attribution tests.

```
$ uv run --frozen pytest tests/test_ocr_notice.py --no-cov -q
E       AssertionError: 
E         RUN groupadd --system --gid 10001 openverify \
E         …
E         COPY --from=build /app/.venv /app/.venv
E         …
E       assert None
FAILED tests/test_ocr_notice.py::test_the_vision_image_ships_the_notice_next_to_the_application
1 failed, 5 passed in 0.07s
```

### GREEN (`8be84db`, docs `1377773`, `5da6854`)

`COPY NOTICE /app/NOTICE` in the runtime stage.

```
$ uv run --frozen pytest tests/test_ocr_notice.py --no-cov -q
6 passed in 0.04s
$ docker build -q -t openverify/vision:k102-check services/vision      # from the repository root, 51 s
$ docker run --rm --entrypoint sh openverify/vision:k102-check -c 'ls -l /app && head -3 /app/NOTICE && id'
-rw-r--r-- 1 root root 2842 Oct 21 05:05 NOTICE
OpenVerify vision service
Copyright 2026 The OpenVerify Authors
uid=10001(openverify) gid=10001(openverify) groups=10001(openverify)
$ docker rmi openverify/vision:k102-check
```

The documentation changes:
- **Docstrings.** Both docstrings now say barcodes are read on the upload, then on the rectified document. `test_the_front_wires_every_stage` now pins both reads, so the assertion is stronger, not weaker: `[id(image) for each decode_barcodes call] == [id(IMAGE), id(RECTIFIED)]`.
- **README fixtures table.** It now lists the C36 happy card, `variants/`, `aamva/`, `variants.json` and `.generator-version`.
- **README tools.** It describes `tools/calibrate_government_id.py` and `tools/benchmark_government_id.py`.
- **README introduction.** It names the Phase 3 government ID analysis.
- **README Docker section.** It says `NOTICE` ships at `/app/NOTICE`.
- **Vision contract README** (`contracts/fixtures/vision/README.md`): states the K101 portrait rule and the `subject` field. The fixtures themselves are unchanged.

**Follow-up, not fixed here.** The image carries no copy of the Apache License text itself (Apache-2.0 §4(a)):
- `NOTICE` names the repository's root `LICENSE` and the licence URL;
- the root `LICENSE` is outside the `services/vision` build context, so the Dockerfile cannot copy it;
- shipping it means either a copy under `services/vision/` or a wider build context. That choice is for the plan.

These documentation changes have no behaviour of their own to put under a RED test. The behaviour they describe is pinned by `test_barcode.py::test_the_side_analysis_reads_barcodes_on_the_upload_and_the_rectified_document` and the wiring test above.

## G011 (MEDIUM): every detected box was recognised, but only 200 lines reported

**Confirmed.** `OcrEngine.read_text` cropped and recognised every quad `detect_text` returned (`max_candidates` is 1000), then stopped appending at `MAX_TEXT_LINES` = 200. Measuring with the real models showed a second cost axis the finding mentions: the width of a recognition batch. A batch is as wide as its widest line. Steady-state recognizer time per batch of six:

```
batch (6, 3, 48, 320) ratio 7: median 79 ms
batch (6, 3, 48, 1536) ratio 32: median 515 ms
batch (6, 3, 48, 3072) ratio 64: median 998 ms
batch (6, 3, 48, 4800) ratio 100: median 1506 ms
```

On the 55 generated fixture images (both sides of every variant, plus the AAMVA images), `detect_text` on the analysed image finds at most 30 lines per image. The longest line is 33.6 times its height, a TD3 MRZ line, and the 99th percentile is 23.5.

### RED (`27103ba`)

- `tests/test_ocr.py::test_only_the_lines_that_can_be_reported_are_recognised`: 250 detected lines, all readable, give 200 lines from 200 recognitions.
- `tests/test_ocr_recognition.py::test_a_very_long_line_is_squeezed_to_64_times_the_line_height`: a line 200 times its height is batched 64 x 48 = 3072 wide, and both lines are still read.

```
$ uv run --frozen pytest tests/test_ocr.py tests/test_ocr_recognition.py --no-cov -q
E       assert 250 == 200
E       assert [(2, 3, 48, 9600)] == [(2, 3, 48, 3072)]
FAILED tests/test_ocr.py::test_only_the_lines_that_can_be_reported_are_recognised
FAILED tests/test_ocr_recognition.py::test_a_very_long_line_is_squeezed_to_64_times_the_line_height
2 failed, 32 passed in 1.34s
```

### GREEN and refactor (`697d4b9`)

- `read_text` reads `detect_text(...)[:MAX_TEXT_LINES]`, the first 200 lines in reading order.
  - The refactor removed the in-loop `break`: with at most 200 quads, it could no longer cut anything short.
  - When every line reads, the result is the same as before. When some of the first 200 lines read as nothing, fewer than 200 are returned, where the old code would have gone on to later ones. That can only happen on a page with more than 200 detected lines, which is no identity document.
- `recognition.MAX_LINE_RATIO = 64`: a batch is at most 64 times as wide as it is high, and `recognition_input` squeezes a longer line to that width. The cap is about twice the longest real line. It applies to the MRZ reader too, whose lines are at most about 34.
- `DetectionParams.max_candidates` is unchanged at RapidOCR's 1000. `findContours` order is not score order, so lowering it could drop real lines; the truncation after the reading-order sort bounds the recognition work instead.

```
$ uv run --frozen pytest tests/test_ocr.py tests/test_ocr_recognition.py tests/test_ocr_detection.py tests/test_mrz_locate.py tests/test_ocr_composition.py tests/test_ocr_notice.py --no-cov -q
99 passed in 3.22s
```

**Real models,** `OcrEngine.read_text`, two runs each:
- A 2000 x 1300 page of 2673 six-character words, the reported case, which the detector reads as 1000 separate boxes:
  - before: 14.9 s and 15.2 s, 200 lines;
  - after: 3.8 s and 4.0 s, the same 200 lines, compared field for field.
- A 2000 x 1300 page of 2006 words packed into 59 lines up to 99 times their height:
  - before: 19.7 s and 15.2 s;
  - after: 11.5 s and 11.2 s, 59 lines.

The 18 fixture responses of K101 are still identical.

**What remains** (not fixed here: a design change, reported for the plan):
- The worst case is now bounded but still over the C32.4 budget. A page built for it, with 200 lines each at least 64 times its height, costs about 34 batches of about 1 s.
- Bringing that under 5 s needs a total recognition budget per side: a cap on the summed batch widths, with the rest not read and reported as such. That changes what `text` means for very dense pages, so it belongs in the plan rather than in a local fix.

## Final gates

```
$ uv run --frozen ruff check && uv run --frozen ruff format --check && uv run --frozen mypy src tools --cache-dir /tmp/openverify-mypy-python-fixer && COVERAGE_FILE=/tmp/openverify-cov-python-fixer uv run --frozen pytest
All checks passed!
114 files already formatted
Success: no issues found in 45 source files
TOTAL                                           4401      0    648      0   100%
Required test coverage of 80% reached. Total coverage: 100.00%
======================= 1243 passed in 136.39s (0:02:16) =======================

$ bash infra/tests/compose.test.sh --static-only          # repository root; the file is not changed by this slice
# 165 passed, 0 failed
```

The live part of `compose.test.sh` was not run. It brings up the shared `openverify` project and its volumes, and this slice changes neither the compose file nor that test.

**Full-stack e2e,** first run (08:18 to 08:23, under the lock):

```
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   29 passed (10.7s)
@openverify/e2e:e2e:   ✘  43 [chromium] › tests/verification-completes.spec.ts:63:1 › an inquiry on the default template completes with every required check passed (39.6s)
    Locator: getByRole('table', { name: 'Government ID checks' }).getByRole('row').filter({ has: getByRole('rowheader', { name: 'id_blur_detection', exact: true }) })
    Expected substring: "Passed"
    Error: element(s) not found
@openverify/e2e:e2e:   1 failed
@openverify/e2e:e2e:   43 passed (4.7m)
real	4m58.262s
```

This is the blocker `docs/tdd/phase3-surfaces-dashboard.tdd.md` records ("The fold breaks `verification-completes.spec.ts`"). Since C37, the passed rows sit inside the closed "Other checks" disclosure, so Playwright finds no row. The spec is in `e2e/`, outside this slice's paths. Vision is not the cause. The failure snapshot, read from the HTML report's data, shows:
- the government ID verification `Passed`, with "Other checks: 24 passed, 7 not applicable";
- `id_repeat_detection` failed, but it is optional and the suite reuses the happy card;
- the selfie `Passed` with "All checks: 3 passed", `selfie_id_comparison` included;
- the spec's own API assertions before line 182 passed.

**Full-stack e2e, re-run** (08:26 to 08:30, under the lock), as the team rules ask for a failure in another fixer's paths. By then the TypeScript fixer's working tree held the surfaces-dashboard patch to `verification-completes.spec.ts`, and its K101 API half (`3b00bbc`) sends `subject=document` when it re-embeds a stored front:

```
$ flock /tmp/openverify-e2e.lock pnpm e2e
@openverify/flow:e2e:   29 passed (8.9s)
@openverify/e2e:e2e:   ✓  43 [chromium] › tests/verification-completes.spec.ts:63:1 › an inquiry on the default template completes with every required check passed (9.9s)
@openverify/e2e:e2e:   44 passed (3.9m)
 Tasks:    9 successful, 9 total
real	4m28.694s
```
