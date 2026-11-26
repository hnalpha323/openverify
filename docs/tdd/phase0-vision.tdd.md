# TDD evidence: Phase 0, vision-service

Slice owner: vision-service agent. Date: 2026-10-20.
Paths owned: `services/vision`, `models/` (manifest only), `scripts/fetch_models.py`.

## Plan task

PLAN §6, Phase 0, steps 4 (the `services/vision` half) and 5 (model fetch script with SHA-256 pinning and a license check). The work covers:
- a uv project on Python 3.12 (`openverify_vision`, src layout) with ruff lint and format, mypy strict and pytest at an 80% coverage gate;
- `quality.py`: `blur_score`, `glare_ratio`, `brightness` and `assess_quality`, which emits `id_blur_detection` and `id_glare_detection` as `{status, score, threshold}` (PLAN §4.1);
- a FastAPI app with `GET /health` and `POST /v1/quality`:
  - multipart upload;
  - 413 and 415 responses as problem+json;
  - `x-service-token` auth compared in constant time;
- `models/manifest.json` plus the stdlib-only `scripts/fetch_models.py`;
- a lazy YuNet wrapper, `faces.py`;
- a Dockerfile: `python:3.12-slim`, `uv sync --frozen`, a non-root user and a healthcheck.

Toolchain, checked against PyPI on 2026-10-20 and pinned through `uv.lock`:

| Package | Version | License |
|---|---|---|
| fastapi | 0.150.0 | MIT |
| uvicorn[standard] | 0.54.0 | BSD-3-Clause |
| pydantic / pydantic-settings | 2.14.1 / 2.16.0 | MIT |
| numpy | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| opencv-python-headless | 5.0.0.93 | Apache-2.0 |
| pillow | 13.0.0 | MIT-CMU |
| python-multipart | 0.0.32 | Apache-2.0 |
| onnxruntime | 1.31.0 | MIT |
| pytest / pytest-cov | 9.1.1 / 7.1.0 | MIT |
| httpx / httpx2 | 0.28.1 / 2.15.1 | BSD-3-Clause |
| ruff / mypy | 0.17.1 / 2.4.0 | MIT |

No `types-*` stub packages are needed. Every package the code imports ships `py.typed` or bundled stubs (`cv2/__init__.pyi`). onnxruntime is untyped, but `src/` does not import it yet.

Model licenses were verified by reading the LICENSE file in each source repo:

| Model | Source (pinned) | License evidence |
|---|---|---|
| YuNet `face_detection_yunet_2026may.onnx` | opencv_zoo @ `47534e2` | `models/face_detection_yunet/LICENSE`: "MIT License, Copyright (c) 2020 Shiqi Yu". Upstream libfacedetection.train is BSD-3-Clause |
| SFace `face_recognition_sface_2021dec.onnx` | opencv_zoo @ `47534e2` | `models/face_recognition_sface/LICENSE`: the full Apache License 2.0 text. README: "All files in this directory are licensed under Apache 2.0 License". The upstream zhongyy/SFace has no LICENSE file (see followups) |
| MiniFASNetV2 / V1SE ONNX | yakhyo/face-anti-spoofing release `weights` | Repo LICENSE @ `aea85c1` differs from the reference Apache-2.0 text only by whitespace. Upstream minivision-ai/Silent-Face-Anti-Spoofing LICENSE is Apache-2.0, "Copyright 2020 Minivision" |

Each sha256 was computed by downloading the file once. The opencv_zoo hashes equal the Git LFS oids, and the MiniFASNet hashes equal the digests GitHub publishes for the release assets.

OCR models were researched but **not** added. RapidOCR (GitHub LICENSE: Apache-2.0) and PaddleOCR (Apache-2.0) are permissive, but the ONNX files are hosted on ModelScope, which carries the license only as metadata ("Apache License 2.0"), with no LICENSE file. See followups.

## Tests (written first)

All test images are synthetic, generated with numpy, cv2 or Pillow in `tests/synthetic.py`: checkerboards, flat fills, seeded noise and blur. There are no photos and no faces.

**`tests/test_quality.py` (41 tests):**
- A sharp checkerboard scores more than 10 times higher on blur than its Gaussian-blurred version.
- `blur_score` equals `cv2.Laplacian(...).var()`.
- Glare is measured as the fraction of near-saturated, low-saturation pixels. Saturated red and well-exposed white (225) do not count.
- The ROI is honoured, and invalid ROIs are rejected.
- Brightness is the mean intensity scaled to `[0, 1]`.
- Non-images are rejected.
- `assess_quality`:
  - pass and fail cases for each check;
  - scores exactly at the threshold pass;
  - the report has the shape `checks` plus `metrics`;
  - the thresholds are validated.

**`tests/test_imaging.py` (19 tests):**
- PNG, JPEG and WebP decode to BGR. Grayscale and RGBA input are normalised to 3-channel BGR.
- EXIF orientation is applied.
- Text, PDF, SVG, GIF, BMP and TIFF are unsupported.
- A truncated PNG is reported as corrupt.
- The pixel limit, and a decompression bomb, raise "too large".

**`tests/test_settings.py` (9), `tests/test_app.py` (22) and `tests/test_limits.py` (7 written first, then 4 more after GREEN):**
- Settings:
  - read from env with the `OPENVERIFY_VISION_` prefix;
  - the token is required and must be at least 32 characters;
  - the secret never appears in `repr`.
- Routes:
  - `/health` needs no auth;
  - `/v1/quality` returns the report and applies the configured thresholds;
  - the declared content type is ignored in favour of sniffing the bytes.
- Auth:
  - missing, empty, wrong or over-long tokens return 401;
  - a spy confirms `hmac.compare_digest` is called once, on equal-length digests.
- Error responses, all as problem+json:
  - 415 for non-images and for GIF;
  - 413 for a file over the upload limit, for a request far over the body limit, and for an image over the pixel limit;
  - 422 for a corrupt image;
  - 422 for a missing field, without echoing the submitted input;
  - 404, 405, and a generic 500 that does not leak the exception message;
  - the interactive docs are disabled.
- Body-limit middleware:
  - a Content-Length precheck;
  - streamed bodies are cut off;
  - a bad Content-Length returns 400;
  - lifespan events pass through.

**`tests/test_fetch_models.py` (37 written first, then 8 more after GREEN, including the file-mode regression test) and `tests/test_manifest.py` (4):**
- Manifest validation:
  - URLs must be https;
  - sha256 must be 64 lowercase hex characters;
  - licenses come from the SPDX permissive allowlist (CC-BY-NC, BUSL and AGPL are rejected);
  - filenames must be plain names (`../`, `/` and dotfiles are rejected);
  - sizes are checked, duplicate names and filenames are rejected, and malformed or missing manifests fail.
- Fetching:
  - download, then idempotent skip;
  - a checksum mismatch is refused and leaves no files behind;
  - a corrupted local copy is replaced;
  - a bad download never overwrites an existing file;
  - a download over the declared size is aborted.
- Against a real local `http.server`:
  - a real download works;
  - HTTP 404 is reported;
  - a redirect to a non-https URL is refused.
- CLI: exit codes, `--only`, and the default destination.
- The real `models/manifest.json`:
  - YuNet is listed as MIT from opencv_zoo, and SFace as Apache-2.0;
  - no URL points at a moving branch;
  - `*.onnx` is gitignored.

**`tests/test_faces.py` (16 tests):**
- The model is not loaded at construction.
- A missing model fails on first use with a `fetch_models.py` hint. A corrupt model is reported as unavailable.
- YuNet's 15-column rows are parsed into a box, five landmarks and a score. This uses a fake detector with hand-written rows.
- The model loads once, and `setInputSize` is called for each image.
- Grayscale input is converted to BGR.
- The **real YuNet** finds zero faces in four synthetic no-face images.

## RED

Every RED below was committed as a `test(vision): ...` checkpoint before any implementation existed.

1. Quality. Command: `uv run pytest tests/test_quality.py`

```
tests/test_quality.py:12: in <module>
    from openverify_vision.quality import (
E   ModuleNotFoundError: No module named 'openverify_vision.quality'
=========================== short test summary info ============================
ERROR tests/test_quality.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
=============================== 1 error in 0.38s ===============================
exit=2
```

2. Imaging. Command: `uv run pytest tests/test_imaging.py`

```
collected 0 items / 1 error
E   ModuleNotFoundError: No module named 'openverify_vision.imaging'
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
exit=2
```

3. API. Command: `uv run pytest tests/test_settings.py tests/test_app.py tests/test_limits.py`

The first attempt failed for an **unintended** reason. Starlette 1.9's TestClient deprecates `httpx`, and `filterwarnings = error` turned that into a collection error:

```
E   ModuleNotFoundError: No module named 'httpx2'
E   starlette.exceptions.StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
```

After adding `httpx2` (BSD-3-Clause) as a dev dependency, the run failed for the intended reason:

```
collected 0 items / 3 errors
___________________ ERROR collecting tests/test_settings.py ____________________
E   ModuleNotFoundError: No module named 'openverify_vision.settings'
______________________ ERROR collecting tests/test_app.py ______________________
E   ImportError: cannot import name 'auth' from 'openverify_vision' (/home/mhnoor/persona-opensource/services/vision/src/openverify_vision/__init__.py)
____________________ ERROR collecting tests/test_limits.py _____________________
E   ModuleNotFoundError: No module named 'openverify_vision.limits'
```

4. Fetcher and manifest. Command: `uv run pytest tests/test_fetch_models.py tests/test_manifest.py`, piped through `grep | sort | uniq -c`:

```
      1 ========================= 1 passed, 40 errors in 1.03s =========================
     40 E   FileNotFoundError: [Errno 2] No such file or directory: '/home/mhnoor/persona-opensource/scripts/fetch_models.py'
```

The one passing test checks that `.gitignore` ignores `models/**/*.onnx`, which was already true.

5. Fetcher regression, found after GREEN by the real run. `mkstemp` creates weights as 0600, so the container's non-root user could not read them through the bind mount. Command: `uv run pytest tests/test_fetch_models.py -k world_readable`

```
E       AssertionError: assert (33152 & 511) == 420
======================= 1 failed, 44 deselected in 0.23s =======================
```

6. Faces. Command: `uv run pytest tests/test_faces.py`

```
collected 0 items / 1 error
E   ImportError: cannot import name 'faces' from 'openverify_vision' (/home/mhnoor/persona-opensource/services/vision/src/openverify_vision/__init__.py)
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
=============================== 1 error in 0.31s ===============================
```

## GREEN

1. Quality. Command: `uv run pytest tests/test_quality.py`

```
tests/test_quality.py .........................................          [100%]
src/openverify_vision/quality.py       88      0     14      0   100%
Required test coverage of 80% reached. Total coverage: 100.00%
============================== 41 passed in 0.49s ==============================
```

`mypy src` then flagged `cv2.cvtColor`'s `MatLike` return type, which was fixed with `np.asarray(..., dtype=np.uint8)`. The rerun gave `41 passed in 0.52s` and 100% coverage.

2. Imaging. In the file-only run, all 19 tests passed but the package gate failed because `quality.py` was not exercised: `19 passed`, `FAIL Required test coverage of 80% not reached. Total coverage: 27.01%`. The full suite:

```
src/openverify_vision/imaging.py       34      0      2      0   100%
TOTAL                                 121      0     16      0   100%
Required test coverage of 80% reached. Total coverage: 100.00%
60 passed in 1.02s
```

3. API. Command: `uv run pytest`

```
src/openverify_vision/limits.py        41      2     14      3    91%   23, 51->55, 67
TOTAL                                 287      2     40      3    98%
Required test coverage of 80% reached. Total coverage: 98.47%
============================== 98 passed in 2.71s ==============================
```

Four raw-ASGI tests were then added **after GREEN** to pin down the defensive branches: the constructor guard, conflicting or negative Content-Length, and `http.disconnect` passthrough. The result was `102 passed`, 100%.

One test was also changed between RED and GREEN, before it ever ran: `test_file_over_upload_limit_is_413` now uploads seeded noise instead of a checkerboard. A black/white checkerboard PNG compresses well, so it might not have reached the 1,000-byte limit that test needs.

4. Fetcher. File-only run: `41 passed in 1.88s`. The package gate shows 0% because the script is outside `openverify_vision`. The script's own coverage, measured with `--cov=../../scripts`, was 95%:

```
/home/mhnoor/persona-opensource/scripts/fetch_models.py     187      7     58      5    95%   122, 128, 149, 207, 254-255, 306
```

Seven edge tests were added **after GREEN**:
- unknown field;
- missing `license_url` or `source_repo`;
- non-string `upstream`;
- connection refused;
- an https redirect is followed;
- the script runs standalone under `python -I`.

`from_dict` was also split up (ruff PLR0912), and `redirect_request` gained `@override`. After the 0644 fix:

```
/home/mhnoor/persona-opensource/scripts/fetch_models.py     192      0     52      0   100%
============================== 49 passed in 2.03s ==============================
```

Real run of the fetcher with `python3 -I scripts/fetch_models.py ...`:
- the first command uses `--only face_detection_yunet --only face_recognition_sface`;
- the second fetches everything.

```
face_detection_yunet: downloaded /home/mhnoor/persona-opensource/models/face_detection_yunet_2026may.onnx (MIT)
face_recognition_sface: downloaded /home/mhnoor/persona-opensource/models/face_recognition_sface_2021dec.onnx (Apache-2.0)
exit=0
face_detection_yunet: present /home/mhnoor/persona-opensource/models/face_detection_yunet_2026may.onnx (MIT)
face_recognition_sface: present /home/mhnoor/persona-opensource/models/face_recognition_sface_2021dec.onnx (Apache-2.0)
anti_spoof_minifasnet_v2: downloaded /home/mhnoor/persona-opensource/models/MiniFASNetV2.onnx (Apache-2.0)
anti_spoof_minifasnet_v1se: downloaded /home/mhnoor/persona-opensource/models/MiniFASNetV1SE.onnx (Apache-2.0)
exit=0
```

5. Refactor (`refactor(vision): ...`). The image-validation helpers moved from `quality.py` into `imaging.py`. The suite stayed at `151 passed`, 100%.

6. Faces. Command: `uv run pytest tests/test_faces.py -v`

```
tests/test_faces.py::test_real_yunet_finds_no_face_in_synthetic_images[flat-gray] PASSED [ 81%]
tests/test_faces.py::test_real_yunet_finds_no_face_in_synthetic_images[checkerboard] PASSED [ 87%]
tests/test_faces.py::test_real_yunet_finds_no_face_in_synthetic_images[blurred-noise] PASSED [ 93%]
tests/test_faces.py::test_real_yunet_finds_no_face_in_synthetic_images[grayscale] PASSED [100%]
============================== 16 passed in 0.25s ==============================
```

Without the weights, as in CI before a fetch, with the YuNet file temporarily moved out of `models/`:

```
SKIPPED [4] tests/test_faces.py:203: /home/mhnoor/persona-opensource/models/face_detection_yunet_2026may.onnx missing; run scripts/fetch_models.py first
163 passed, 4 skipped in 4.96s
```

Coverage stayed at 100%.

7. Docker. There is no unit test for this step; it was verified by running the image. The image was built with `docker build -t openverify-vision:phase0 services/vision` and run with a random token and `-v models:/models:ro`:

```
health=healthy after ~8s
uid=10001(openverify) gid=10001(openverify) groups=10001(openverify)
HTTP/1.1 200 OK
{"status":"ok"}
no-token -> 401 application/problem+json
{"checks":{"id_blur_detection":{"status":"passed","score":6703.125,"threshold":100.0},"id_glare_detection":{"status":"passed","score":0.0,"threshold":0.05}},"metrics":{"brightness":0.47058823529411764,"width":256,"height":256}}
with-token -> 200
faces in flat image: [] loaded: True
```

Started without a token, the container fails fast:

```
service_token
  Field required [type=missing, input_value={'models_dir': '/models'}, input_type=dict]
exit=1
```

The image is 683 MB.

## Final verification (services/vision)

```
$ uv run ruff check
All checks passed!
$ uv run ruff format --check
20 files already formatted
$ uv run mypy src
Success: no issues found in 9 source files
$ uv run pytest
src/openverify_vision/__init__.py       1      0      0      0   100%
src/openverify_vision/app.py           44      0      2      0   100%
src/openverify_vision/auth.py          16      0      2      0   100%
src/openverify_vision/faces.py         63      0      6      0   100%
src/openverify_vision/imaging.py       54      0     12      0   100%
src/openverify_vision/limits.py        41      0     14      0   100%
src/openverify_vision/problems.py      40      0      4      0   100%
src/openverify_vision/quality.py       67      0      4      0   100%
src/openverify_vision/settings.py      25      0      2      0   100%
TOTAL                                 351      0     46      0   100%
Required test coverage of 80% reached. Total coverage: 100.00%
============================= 167 passed in 4.73s ==============================
```

The script was checked with the same ruff config and `mypy --strict`:

```
All checks passed!
1 file already formatted
Success: no issues found in 1 source file
/home/mhnoor/persona-opensource/scripts/fetch_models.py     192      0     52      0   100%
============================== 49 passed in 2.06s ==============================
```

## Coverage

| Scope | Statements | Branches | Coverage |
|---|---|---|---|
| `openverify_vision` (gate: `--cov=openverify_vision --cov-fail-under=80`) | 351 | 46 | 100% |
| `scripts/fetch_models.py` (measured separately with `--cov=../../scripts`) | 192 | 52 | 100% |

## Decisions and deviations

- **File names.** Python modules use snake_case (`quality.py`, `fetch_models.py`) because Python cannot import kebab-case modules. The task names `scripts/fetch_models.py`, whereas PLAN §6 mentions `scripts/fetch-models.ts`.
- **Problem documents.** They use `type: about:blank`, so `title` is the HTTP status phrase. Validation errors carry an `errors` extension holding only `loc`, `msg` and `type`. Status mapping:
  - 415: unsupported format, sniffed from the bytes;
  - 413: file over `MAX_UPLOAD_BYTES`, or image over `MAX_IMAGE_PIXELS`;
  - 422: the bytes look like an allowed format but cannot be decoded.
- **Body limit.** The limit is `max_upload_bytes + 64 KiB` at the ASGI layer, plus a precise per-file check in the route.
- **Auth runs after multipart parsing.** FastAPI parses the form body before it resolves dependencies, so an unauthenticated request is size-capped and parsed, but never decoded.
- **YuNet version.** The manifest uses YuNet `2026may` (dynamic input shape), which the opencv_zoo README names as the default for OpenCV 5.x. `2023mar` also loads under `opencv-python-headless` 5.0.0.93.
- **Thresholds.** The defaults are `blur_min=100.0`, `glare_max=0.05`, and a glare pixel is one with HSV V≥250 and S≤40. They are provisional, pending Phase 3 calibration on ID crops.
