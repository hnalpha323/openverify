# TDD evidence: `vision-renditions` (Phase 8, Workflow 8B Stage 2)

Base: `808bb32f` (contracts-8b's second call, with the (F) checkpoint `214858b6`). Owned paths:
`services/vision/src/openverify_vision/renditions.py`, `services/vision/tests/test_renditions.py`,
three edits in `services/vision/src/openverify_vision/app.py`, and `createRendition` in
`apps/api/src/vision/` (`index.ts` and `renditions.test.ts`). Every command below was run after
`source scripts/env.sh`; every gate's exit code was read from the command, its output sent to a
file.

## What was built (C135.3, F25, F36, V16)

- **`POST /v1/renditions`** (`renditions.py`), one multipart file `source`, answering the frozen
  pydantic `Rendition` (contracts-8b amendment 43).
  - **An image** (JPEG, PNG or WebP by its first bytes) is decoded with the upload guards of
    `decode_image`: the formats restricted, the pixel count checked against `max_image_pixels`
    before any pixel is decoded, Pillow's `DecompressionBombError` answered 413. Its EXIF
    orientation is applied, 16-bit grey is scaled (not clipped), and transparency is shown on
    white. The pixels are copied into a fresh image (`Image.frombytes`), so nothing of the
    source's `info` (EXIF, XMP, ICC, text chunks, comment, dpi) can reach an encoder, then scaled
    to at most 4,096 px a side. A JPEG is re-encoded as a JPEG at quality 90; a PNG or WebP as a
    PNG, or as a JPEG when the PNG would pass the 16 MiB byte limit; JPEG falls to 75 and 50 before
    a 413.
  - **A PDF** is never parsed in the service: each of its first 20 pages is rendered by the guarded
    child's existing `render_pdf_page` task, one child a page, as a PNG of at most 1,600 px a side.
    The first page's answer gives the page count; more than 20 is `truncated`. Each answer is
    validated with `RenderAnswer`, its raster's side and frame length checked, and a page count
    that changes between children is a 503. Refusals answer as the document routes do:
    `pdf_encrypted`, `pdf_unprocessable`, `too_many_pages` (over the child's 50) as coded 422s; a
    child stopped on its own limits is `pdf_unprocessable`; any other failure is 503
    `guarded_worker_failed`.
  - **Anything else** is 415, an image that cannot be decoded 422.
  - **The deadline:** `RENDITION_DEADLINE_SECONDS` (40 s, provisional, as the analysis') runs from
    the request's arrival, queueing included. Each page's child is killed at what is left of it,
    and past it the route answers 503 `guarded_worker_failed`, inside the API's 45 s guarded
    timeout.
- **Its own lane** (F25): `app.state.rendition_limiter = JobLimiter(1, 4)`; a sixth rendition is
  503 busy with `Retry-After`, and the verification jobs' limiter is untouched.
- **The three `app.py` edits** (V16): the router line (`app.include_router(renditions.router)`,
  with the module import beside `document_analysis`'s), the limiter-lane line, and
  `renditions.RENDITIONS_PATH` in `SINGLE_UPLOAD_PATHS`, which gives it one upload's body limit in
  `route_limits`.
- **`createRendition`** (`apps/api/src/vision/index.ts`): `post('v1/renditions', { source },
  renditionSchema, {}, guardedTimeoutMs)`, then each page's base64 decoded into the port's
  `VisionRendition`. Errors are the client's existing ones: a contract miss is
  `VisionResponseError` (issue paths only), a status is `VisionServiceError` with its problem code,
  a timeout or network failure `VisionUnavailableError`.

## Commits

| Step | Commit | What |
|---|---|---|
| Stub | `ec9683e6` | `chore(vision)`: the route at 501, its lane and its body limit (the three `app.py` edits) |
| RED (vision) | `34338e83` | `test(vision)`: 38 tests; the stub gains the names they reach and still answers 501 |
| RED (api) | `0c629bfb` | `test(api)`: the client tests replace the stub's test |
| GREEN (vision) | `88acceaf` | `feat(vision)`: the route |
| GREEN (api) | `ecac68f7` | `feat(api)`: the client |
| Refactor | `9bab2e15` | `refactor(vision)`: the image is scaled as it is decoded |

## RED

The stub was committed first so the RED tests import and typecheck; the vision stub's
`render_source` raised `NotImplementedError`, and the route answered 501 `not_implemented`.

```
$ (cd services/vision && uv run ruff check src/openverify_vision/renditions.py tests/test_renditions.py)
All checks passed!
$ (cd services/vision && timeout 400 uv run pytest -q -p no:cacheprovider --no-cov tests/test_renditions.py)
E       AssertionError: {"type":"about:blank","title":"Not Implemented","status":501,"detail":"this analysis is not built yet","code":"not_implemented"}
...
>           assert lane.reached.wait(WAIT_SECONDS)
E           assert False
FAILED tests/test_renditions.py::test_a_jpeg_with_gps_exif_comes_back_without_it
FAILED tests/test_renditions.py::test_the_exif_orientation_is_applied
FAILED tests/test_renditions.py::test_a_png_text_chunk_is_stripped
FAILED tests/test_renditions.py::test_a_decompression_bomb_is_refused[8000-6000]
FAILED tests/test_renditions.py::test_a_decompression_bomb_is_refused[20000-20000]
FAILED tests/test_renditions.py::test_a_pdf_gives_page_images
FAILED tests/test_renditions.py::test_verification_keeps_its_slots_while_renditions_queue
... (35 in all)
35 failed, 3 passed in 22.97s           (rc 1, load 0.27)
```

Every failure is the stub's 501, and the lane test's lane is never reached, because the stub
does not use it. The three that passed already hold with the stub: the service token, the route's
one-upload body limit (the `SINGLE_UPLOAD_PATHS` edit), and the lane's size and separateness.

```
$ (cd apps/api && pnpm exec tsc --noEmit -p tsconfig.json)        # rc 0
$ (cd apps/api && pnpm exec eslint src/vision/renditions.test.ts)  # rc 0
$ (cd apps/api && pnpm exec vitest run src/vision/renditions.test.ts --coverage.enabled=false)
     × posts the source as the multipart file `source` and decodes each page
     ...
Caused by: VisionServiceError: Vision service answered 501 not_implemented (/v1/renditions)
      Tests  9 failed | 5 passed (14)    (rc 1)
```

The five that passed are contracts-8b's schema tests in the same file.

## GREEN

```
$ (cd services/vision && timeout 400 uv run pytest -q -p no:cacheprovider --cov=openverify_vision.renditions --cov-report=term-missing --cov-fail-under=0 tests/test_renditions.py)
src/openverify_vision/renditions.py              179      0     36      0   100%
41 passed in 27.28s                      (rc 0)
$ (cd apps/api && pnpm exec vitest run src/vision/ --coverage.enabled=false)
 Test Files  4 passed (4)
      Tests  144 passed (144)            (rc 0)
```

Two test changes went with the GREEN commit, neither weakening a test:
- the JPEG fallback test's source was a one-pixel checkerboard, which a PNG compresses to almost
  nothing, so it could never exercise the fallback. It is now blurred noise (about 330 KB as a
  PNG, 52 KB as a JPEG at quality 90, measured), with the limit at 60,000 bytes and an assertion
  that the PNG source is over it;
- added for coverage: a PNG signature no decoder identifies (415), a broken WebP (422), and a
  child answer that names a frame it does not send (503).

## Refactor

`9bab2e15`: the scaling moved into `_upright`, so `_encoded` reads one image nothing changes
after. The same 41 tests passed (`41 passed in 28.33s`, 100% of `renditions.py`).

## Gates (each exit 0, read from the exit code)

| Gate | Result | Time | Load (1 min) |
|---|---|---|---|
| `(cd services/vision && uv run ruff check && uv run ruff format --check && uv run mypy src tools)` | 0; 199 files formatted, 79 sources | 1 s (mypy cached) | 2.17 |
| first half: `timeout 590 uv run pytest -q -p no:cacheprovider --cov-fail-under=0 $(ls tests/test_*.py \| awk 'NR<=58')` | 0; 1,470 passed | 286 s | 2.07 to 5.05 |
| second half: `timeout 590 uv run pytest -q -p no:cacheprovider --cov-append $(ls tests/test_*.py \| awk 'NR>58')` | 0; 1,130 passed, total coverage 97.48% | 337 s | 4.72 to 5.32 |
| `docker build services/vision` | 0 | 33 s | 4.97 |
| `pnpm --filter @openverify/api typecheck` | 0 | 78 s | 4.12 |
| `pnpm --filter @openverify/api lint` (`NODE_OPTIONS=--max-old-space-size=4096`) | 0 on the second run; the first (rc 1, 200 s) failed only in another agent's uncommitted files under `apps/api/src/workflows/actions/cases/` | 215 s | 5.52 to 5.62 |
| `pnpm exec vitest run src/vision/` (from `apps/api`) | 0; 144 tests in 4 files | 3 s | 6.68 |

103 vision test files now (2,600 tests); `test_renditions.py` is file 77, after the split point
of 58, so the second half grew by 41 tests and 58 stands.

## Measurements (under `/tmp/openverify-e2e.lock`, one step, load 5.42 to 5.60)

A dev-only script (not committed) posting synthetic inputs through `TestClient`:
- a 12 MP JPEG (3.2 MB, blurred noise): 0.43, 0.35 and 0.31 s;
- the one-page bill PDF: 0.32, 0.29 and 0.30 s;
- a 23-page PDF (20 rendered, one guarded child a page): 6.42 and 7.22 s, well inside the 40 s
  deadline.
