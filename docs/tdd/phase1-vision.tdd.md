# TDD evidence: Phase 1, vision

- **Slice owner:** vision agent (Workflow 1A, Stage 1).
- **Date:** 2026-10-20.
- **Paths owned:**
  - `services/vision/**`
  - `contracts/fixtures/vision/**`
  - `scripts/fetch_fixtures.py`
  - `fixtures/manifest.json`
  - the gitignored `fixtures/faces/` and `fixtures/generated/`, plus their two `.gitignore` lines

## Plan task

`docs/plans/phase-1.plan.md`, Stage 1 "vision", which implements contract **C6** and the `vision/*` part of **C8**:

- **Endpoints.** `POST /v1/analyze/government-id` (`front` required, `back` optional), `POST /v1/analyze/selfie` (`center` required, `left` and `right` optional) and `POST /v1/embed/face` (`image`).
  - Auth is the same `x-service-token` dependency as `/v1/quality`.
  - Faces come from YuNet (`cv2.FaceDetectorYN`, input size set per image) and SFace (`alignCrop` then `feature`, 128 floats).
  - Every response reports `model_versions`. Models load lazily and once; missing weights give a 503 problem+json that names the fetch command.
- **Golden fixtures** in `contracts/fixtures/vision/*.json`, validated by pydantic, with synthetic embeddings only.
- **Public-domain face fixtures**, fetched with pinned hashes by `scripts/fetch_fixtures.py` (stdlib only).
- **Generators.** A synthetic TD1 ID (front and back) and Chromium fake-camera `.y4m` clips.
- **Real-model tests** that skip with an explicit reason when the weights or faces are absent.

## Face sources (public domain)

I read each file page's wikitext (`index.php?title=File:...&action=raw`) to confirm the license section, and checked the Commons API `imageinfo` for the URL, size and sha1. The sha1 of every download equals the Commons sha1, and the SHA-256 pins were computed from those downloads.

| Fixture | Source page | License template | Author | SHA-256 | Used for |
|---|---|---|---|---|---|
| `person_a_id` | [File:Christina_M._Hammock_portrait.jpg](https://commons.wikimedia.org/wiki/File:Christina_M._Hammock_portrait.jpg) (2014, JSC2014-E-007974) | `{{PD-USGov-NASA}}` | NASA/Robert Markowitz | `926c4ddf…1698` | ID portrait |
| `person_a_selfie` | [File:Christina_Koch_official_portrait_in_an_EMU.jpg](https://commons.wikimedia.org/wiki/File:Christina_Koch_official_portrait_in_an_EMU.jpg) (2018, JSC2018-E-095073) | `{{PD-USGov-NASA}}` | NASA/Bill Stafford | `522624d4…8f35` | selfie and fake camera, person A |
| `person_b_selfie` | [File:Kayla_Barron_official_portrait.jpg](https://commons.wikimedia.org/wiki/File:Kayla_Barron_official_portrait.jpg) (2017, JSC2017-E-118421) | `{{PD-USGov-NASA}}` | NASA/Bill Stafford | `cb807f22…2cd4` | negative case, person B |

Person A has two genuinely different photos, four years apart; one has glasses and one does not. No augmentation was needed.

**Choosing the photos.** Six candidates, all `{{PD-USGov-NASA}}`, were probed with the real models before the choice. Pairwise SFace cosine at a 640-px working size:
- **Same person (Koch):** 0.556, 0.676 and 0.718.
- **Different people:** 0.073 to 0.357. Two other NASA astronauts reached 0.357, which is close to 0.363.

For person B I picked the candidate that is clearly separated from person A's ID portrait (0.13 to 0.16). The plan's risk table asks for "a clear match and a clear non-match".

## Design notes and findings

- **YuNet misses large faces.** The probe scaled face crops to several sizes:
  - Faces wider than about 380 px in YuNet's input were never detected (0 of 6 photos).
  - At a 320-px long side, every face was detected.

  A selfie or a high-resolution upload would therefore lose its face. `analysis.FaceEngine.find_faces` runs YuNet on copies scaled to a 640- and a 320-px long side (never upscaled), maps the boxes back to source pixels, and merges duplicates with greedy NMS (IoU > 0.3).
- **Embeddings.** SFace aligns the face on the full-resolution source image. Aligning on smaller copies changed the cosines by at most ±0.04 in the probe, with no consistent gain.
- **Response shape.**
  - Embeddings are L2-normalised: cosine is invariant to scale, and the TS side can use a dot product. The pydantic model rejects a non-unit vector.
  - `bbox` values are rounded to 2 decimals and `score` to 4, clamped to [0, 1]. Degenerate boxes are dropped.
- **Biometric minimisation.** No embedding is computed for the back of an ID, so `back.portrait` is always `null`. Nothing is stored.
- **Request limits.** The body limit is now 3 × `MAX_UPLOAD_BYTES` + 64 KiB, because a selfie request carries three files. Before, a second 10 MB file was rejected by the middleware.
  - Upload errors on these endpoints start with the field name, for example `back: ...`.
  - Every upload is decoded before the models load, so client errors (413, 415, 422) win over a 503.
- **503 detail.** It names `python3 scripts/fetch_models.py` but never the server path, which is logged instead. Weights fetched later are picked up without a restart.
- **New settings.** `OPENVERIFY_VISION_BRIGHTNESS_MIN` = 0.15 and `OPENVERIFY_VISION_BRIGHTNESS_MAX` = 0.9 drive `is_too_dark` and `is_too_bright`. `OPENVERIFY_VISION_FACE_SCORE_THRESHOLD` = 0.9 is YuNet's confidence threshold.
- **MRZ placement.** The synthetic card puts its TD1 MRZ on the **back**, because ICAO 9303 Part 5 places a TD1 MRZ on the back. The task text said "front". This is recorded as a deviation in the report.
  - The front carries the portrait (zone V, left: 3 mm, 11 mm, 25 x 32 mm at 12 px/mm), the name SAMPLE, JANE, `SPEC12345`, the dates, and a "SPECIMEN - NOT A REAL DOCUMENT" mark. The issuing state is ICAO's fictional Utopia (`UTO`).
- **MRZ code.** `tools/icao_mrz.py` is our own code, not the GPL `mrz` package.
  - It reproduces ICAO's TD1 specimen (`I<UTOD231458907…`, `7408122F1204159UTO…6`) exactly.
  - The repo's independent TS parser (`packages/checks/src/mrz.ts`) parsed the synthetic card's MRZ with every check digit valid: document 2, birth 9, expiry 9, composite 6.
- **Fake camera.** The clips are YUV4MPEG2 with header `W640 H480 F15:1 Ip A1:1 C420jpeg`, 30 frames (2 s), and about 1% deterministic drift.
  - OpenCV's `COLOR_BGR2YUV_I420` was confirmed to be BT.601 limited range (white maps to Y=235, black to 16), which is what Chromium assumes for I420.
- **No new dependencies.** Pillow, numpy and opencv-python-headless were already runtime dependencies. The generators live in `services/vision/tools/`, which the image never copies and `.dockerignore` excludes.

## TDD cycles

Commands ran from `services/vision` after `source ../../scripts/env.sh`. Each RED was committed as `test(vision): ...` before any implementation existed.

### 1. ICAO 9303 TD1 MRZ (`tools/icao_mrz.py`)

**RED** (`43e9e70`):
```
$ uv run pytest tests/test_icao_mrz.py --no-cov
E   ModuleNotFoundError: No module named 'icao_mrz'
ERROR tests/test_icao_mrz.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
exit=2
```

**GREEN** (`005997e`). The first GREEN run showed 8 failures, all in the test file itself: it copied a `slots=True` dataclass through `__dict__`. The test was fixed to use `dataclasses.replace` and the implementation was not changed.
```
$ uv run pytest tests/test_icao_mrz.py --no-cov -q
44 passed in 0.07s
```

**Cross-check against the TS parser** (a scratch vitest file outside the repo):
```
IDUTOSPEC123452<<<<<<<<<<<<<<<
8408129F3404159UTO<<<<<<<<<<<6
SAMPLE<<JANE<<<<<<<<<<<<<<<<<<
parseMrz → format TD1, checkDigits documentNumber/birthDate/expirationDate/composite valid: true, valid: true
```

### 2. Public-domain face fetcher (`scripts/fetch_fixtures.py`, `fixtures/manifest.json`)

**RED** (`6a009b8`):
```
$ uv run pytest tests/test_fetch_fixtures.py tests/test_fixture_manifest.py --no-cov -q
E   FileNotFoundError: [Errno 2] No such file or directory: '/home/mhnoor/persona-opensource/scripts/fetch_fixtures.py'
2 failed, 1 passed, 51 errors in 0.69s
```
The one test that passed checks that no image is tracked under `fixtures/`, which was vacuously true at that point.

**GREEN** (`d258b38`), including a real fetch from Wikimedia (first run, then a second run to confirm idempotency):
```
$ uv run pytest tests/test_fetch_fixtures.py tests/test_fixture_manifest.py --no-cov -q
54 passed in 1.87s
$ python3 -I scripts/fetch_fixtures.py
person_a_id: downloaded …/fixtures/faces/person-a-id.jpg (PD-USGov-NASA)
person_a_selfie: downloaded …/fixtures/faces/person-a-selfie.jpg (PD-USGov-NASA)
person_b_selfie: downloaded …/fixtures/faces/person-b-selfie.jpg (PD-USGov-NASA)
$ python3 -I scripts/fetch_fixtures.py
person_a_id: present …   person_a_selfie: present …   person_b_selfie: present …
$ git status --short -uall fixtures
?? fixtures/manifest.json        # the photos are ignored
```

### 3. C6 endpoints

The modules are `schemas.py`, `quality.summarize_quality`, `recognition.py`, `analysis.py`, `app.py` and `settings.py`.

**RED** (`15046f0`):
```
$ uv run pytest --no-cov -q tests/test_schemas.py tests/test_quality.py tests/test_settings.py tests/test_faces.py tests/test_recognition.py tests/test_analysis.py tests/test_app_analyze.py
E   ModuleNotFoundError: No module named 'openverify_vision.analysis'   (x2)
E   ModuleNotFoundError: No module named 'openverify_vision.schemas'
E   ImportError: cannot import name 'summarize_quality' from 'openverify_vision.quality'
E   ImportError: cannot import name 'recognition' from 'openverify_vision'
E   ImportError: cannot import name 'DETECTOR_VERSION' from 'openverify_vision.faces'
6 errors in 0.69s
$ uv run pytest --no-cov -q tests/test_settings.py
FAILED tests/test_settings.py::test_defaults - AttributeError: 'Settings' obj...
FAILED ...[brightness_min--0.1] / [brightness_max-1.1] / [face_score_threshold-0.0] / [face_score_threshold-1.0]
FAILED tests/test_settings.py::test_reads_face_and_exposure_settings
FAILED tests/test_settings.py::test_brightness_range_must_not_be_inverted
FAILED tests/test_settings.py::test_quality_thresholds_come_from_settings
8 failed, 8 passed in 0.32s
```

**GREEN** (`6bf8260`). An unused `FaceDetector.model_path` property was removed before the commit to restore 100% coverage.
```
$ uv run pytest -q
TOTAL                                    762      0     96      0   100%
Required test coverage of 80% reached. Total coverage: 100.00%
377 passed in 9.26s
```

**REFACTOR** (`4cb061f`): the endpoint helpers no longer use `assert` to narrow optional uploads. The suite stayed at 432 passed and 100% coverage.

### 4. Golden contract fixtures (`contracts/fixtures/vision/*.json`)

**RED** (`d9405e9`):
```
$ uv run pytest --no-cov -q tests/test_contract_fixtures.py
E   ModuleNotFoundError: No module named 'make_contract_fixtures'
1 error in 0.22s
```

**GREEN** (`3f44e24`):
```
$ uv run python tools/make_contract_fixtures.py && pnpm exec prettier --write contracts/fixtures/vision/*.json
$ uv run pytest --no-cov -q tests/test_contract_fixtures.py
13 passed in 0.18s
```
- Every file validates with `model_validate_json(strict=True)` and round-trips exactly.
- The committed files equal the generator output.
- The embeddings are seeded unit vectors. cos(ID portrait, selfie center) = 0.72 and cos(ID portrait, embed-face) = 0.05.

### 5. Synthetic ID, fake camera and real-face match

**RED** (`e62b37a`):
```
$ uv run pytest --no-cov -q tests/test_synthetic_id.py tests/test_fake_camera.py tests/test_make_synthetic_fixtures.py tests/test_real_faces.py
E   ModuleNotFoundError: No module named 'fake_camera'    (x3)
E   ModuleNotFoundError: No module named 'synthetic_id'
4 errors in 0.55s
```

**GREEN** (`8b6cb71`). Changes made during GREEN:
- The CLI test leaked an unclosed `Image.open` (an error under `filterwarnings=error`) and now closes it.
- Visual inspection of the rendered cards showed a missing `é` glyph in Pillow's bundled font and an overflowing "Authority" value. Both were fixed in the renderer.

```
$ uv run pytest --no-cov -q tests/test_synthetic_id.py tests/test_fake_camera.py tests/test_make_synthetic_fixtures.py
35 passed in 1.41s
```

## Real-model results

These use real YuNet 2026may and SFace 2021dec, through the HTTP API, on the public-domain faces.

```
$ uv run pytest --no-cov -q -s tests/test_real_faces.py
ID front: faces=[{'bbox': [104.23, 211.16, 166.31, 228.49], 'score': 0.946}] quality={'blur_score': 1211.98, 'is_blurry': False, 'glare_ratio': 0.0019, 'has_glare': False, 'brightness': 0.6234, 'is_too_dark': False, 'is_too_bright': False}
ID back: quality={'blur_score': 1858.33, 'is_blurry': False, 'glare_ratio': 0.0023, 'has_glare': False, 'brightness': 0.7300, ...}
selfie-a.jpg vs ID portrait(A): cosine=0.6243 quality={'blur_score': 476.53, 'is_blurry': False, 'brightness': 0.5853, ...}
selfie-b.jpg vs ID portrait(A): cosine=0.1453 quality={'blur_score': 323.15, 'is_blurry': False, 'brightness': 0.2495, ...}
selfie-a.y4m frames vs ID portrait(A): [0.6384, 0.7012, 0.6823, 0.6413, 0.6687]
selfie-b.y4m frames vs ID portrait(A): [0.1498, 0.1549, 0.1454, 0.1695, 0.1599]
source photos: A-id vs A-selfie=0.7281, A-id vs B-selfie=0.1344
7 passed in 4.24s
```

**Every frame of the default e2e clips.** Each of the 30 frames was sent through `POST /v1/analyze/selfie` as a JPEG at quality 90:
```
selfie-a.y4m: fps=15 frames=30 face_counts=[1] blurry=0 too_dark=0 too_bright=0 cosine min=0.5930 max=0.7019 mean=0.6567
selfie-b.y4m: fps=15 frames=30 face_counts=[1] blurry=0 too_dark=0 too_bright=0 cosine min=0.1234 max=0.1755 mean=0.1530
```

| Check | Result |
|---|---|
| Synthetic ID front yields exactly one portrait | yes (1 face, score 0.946) |
| Selfie(A) vs ID portrait(A) > 0.363 | 0.6243 (still), 0.5930 to 0.7019 (all clip frames) |
| Selfie(B) vs ID portrait(A) < 0.363 | 0.1453 (still), 0.1234 to 0.1755 (all clip frames) |
| ID front and back pass blur and glare; selfies pass blur and exposure | yes |

**Without the faces.** I moved `fixtures/faces/` aside temporarily. The real-face tests skip with an explicit reason, and coverage stays at 100%:
```
SKIPPED [1] tests/test_real_faces.py:113: real-model fixtures missing (fixtures/faces/person-a-id.jpg, fixtures/faces/person-a-selfie.jpg, fixtures/faces/person-b-selfie.jpg); run python3 scripts/fetch_models.py and python3 scripts/fetch_fixtures.py
Required test coverage of 80% reached. Total coverage: 100.00%
425 passed, 7 skipped in 10.68s
```

**Runtime image.** The Dockerfile is unchanged. I built a throwaway tag, ran two containers, then removed both containers and the tag:
```
$ docker run (models mounted) ... POST /v1/analyze/government-id front+back
model_versions {'detector': 'yunet-2026may', 'recognizer': 'sface-2021dec'} | front faces 1 | portrait embedding len 128 | back faces 0
$ POST /v1/analyze/selfie center=selfie-a.jpg
center faces 1 | left None | right None
$ docker run (no models) ... POST /v1/embed/face
{"type":"about:blank","title":"Service Unavailable","status":503,"detail":"face models are not available; fetch them with `python3 scripts/fetch_models.py` into OPENVERIFY_VISION_MODELS_DIR"} HTTP 503 application/problem+json
```

## Final gates

```
$ uv lock --check            → Resolved 50 packages
$ uv run ruff check          → All checks passed!
$ uv run ruff format --check → 40 files already formatted
$ uv run mypy src tools      → Success: no issues found in 17 source files
$ uv run pytest -rs          → 432 passed; TOTAL 1140 stmts, 0 miss, 136 branches → 100.00%
$ pnpm exec prettier --check contracts/fixtures/vision/*.json fixtures/manifest.json → All matched files use Prettier code style!
```
