# openverify-vision

Internal Python 3.12 FastAPI service that runs the image-based checks for OpenVerify. Today it provides:
- image quality: blur, glare and exposure;
- face detection with YuNet;
- face embeddings with SFace;
- the government ID analysis (Phase 3, C32.1): document detection, OCR with the PP-OCRv6 small models, the MRZ, PDF417 barcodes, portrait clarity, forensic scores and a perceptual hash;
- the document analysis (Phase 5, C60): PDFs parsed in a sandboxed child with pypdfium2 and pypdf, page previews, and chip portraits decoded in the same child.

Liveness follows in a later phase. The API worker (`apps/api`) calls the service over the internal network; it is not meant to be exposed publicly.

## Development

```bash
source ../../scripts/env.sh                    # puts uv on PATH
uv sync                                        # create .venv with runtime + dev deps
python3 ../../scripts/fetch_models.py          # pinned model weights into ../../models
python3 ../../scripts/fetch_fixtures.py        # public-domain test faces into ../../fixtures/faces
uv run python tools/make_synthetic_fixtures.py # synthetic ID + fake-camera clips into ../../fixtures/generated
uv run ruff check && uv run ruff format --check
uv run mypy src tools
uv run pytest                                  # enforces --cov-fail-under=80
```

`tests/test_real_faces.py` runs the real models on the public-domain faces. It is skipped, with the fetch commands as the reason, until both fetch scripts have run. It generates its own copy of the synthetic assets in a temporary directory. Run it with `-s` to print the similarity scores.

Run locally:

```bash
OPENVERIFY_VISION_SERVICE_TOKEN=change-me-to-a-long-random-value \
OPENVERIFY_VISION_MODELS_DIR=../../models \
uv run uvicorn openverify_vision.app:create_app --factory --port 8000
```

## Configuration

All settings are environment variables with the `OPENVERIFY_VISION_` prefix (see `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `SERVICE_TOKEN` | *(required, ≥32 chars)* | Shared secret expected in the `x-service-token` header on `/v1/*` |
| `MAX_UPLOAD_BYTES` | `10485760` | Largest accepted file per field. A larger file gets `413`. The whole request may carry three such files |
| `MAX_IMAGE_PIXELS` | `40000000` | Largest accepted decoded image (width × height). A larger image gets `413` |
| `MODELS_DIR` | `models` | Directory holding the files fetched by `scripts/fetch_models.py` |
| `BLUR_THRESHOLD` | `100.0` | Minimum variance of the Laplacian. Below it, `id_blur_detection` fails and `is_blurry` is true |
| `GLARE_THRESHOLD` | `0.05` | Maximum glare-pixel ratio. Above it, `id_glare_detection` fails and `has_glare` is true |
| `BRIGHTNESS_MIN` | `0.15` | Mean brightness (0 to 1) below which `is_too_dark` is true |
| `BRIGHTNESS_MAX` | `0.9` | Mean brightness above which `is_too_bright` is true |
| `FACE_SCORE_THRESHOLD` | `0.9` | Minimum YuNet confidence for a detection to count as a face |
| `MAX_CONCURRENT_JOBS` | `2` | Requests decoded and analysed at once. Each decoded image can take hundreds of MB, and inference is serialised anyway |
| `MAX_QUEUED_JOBS` | `8` | Further requests that wait for a free job slot. Beyond them, the image endpoints answer `503` with `Retry-After` |

The default thresholds are provisional. Phase 3 calibrates the quality thresholds on synthetic ID fixtures, and Phase 4 calibrates the face thresholds.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | none | Liveness probe, returns `{"status": "ok"}` |
| `POST` | `/v1/quality` | `x-service-token` | Multipart field `image` (JPEG, PNG or WebP). Returns blur/glare check results and brightness |
| `POST` | `/v1/analyze/government-id` | `x-service-token` | Fields `front` (required) and `back` (optional). Per side: `quality`, every face (`bbox`, `score`), and the front `portrait` with its embedding. `back.portrait` is always `null` |
| `POST` | `/v1/analyze/selfie` | `x-service-token` | Field `center` (required); `left` and `right` are optional. Per pose: `quality`, every face, and the largest `face` with its embedding |
| `POST` | `/v1/embed/face` | `x-service-token` | Field `image`, and the optional text field `subject`: `selfie` (the default), `document` or `chip` (any other value is `422`). Returns the largest `face` with its embedding and `face_count`, the number of faces it was chosen from. With `document`, the image is a government ID front; see the portrait rule below. With `chip`, it is a chip's DG2 portrait (JPEG, JP2 or J2K, at most 4 MP), decoded in the guarded child and read like a selfie |
| `POST` | `/v1/analyze/document` | `x-service-token` | Field `document`: a PDF (`%PDF-` within its first 1,024 bytes) or a JPEG, PNG or WebP photo, sniffed from its bytes. Returns the C60.1 measurements (see "Documents" below) |
| `POST` | `/v1/render/document-page` | `x-service-token` | Field `document` and the form field `page` (1-based, default 1). Returns the page as a PNG of at most 1,600 pixels a side and at most 200 dpi (`image/png`). A photo has one page |
| `POST` | `/v1/mask/background` | `x-service-token` | Field `image`: a selfie. Returns it as a PNG of at most 640 pixels a side with every face the finder sees and its head and shoulders painted out, carrying none of the upload's metadata (C99.7, the copy a selfie-background list item keeps). The mask is the face-box region, not a segmentation, so an arm or a hand outside it stays. Without a face it answers `422` with `code` `no_face_found` |
| `POST` | `/v1/convert/portrait` | `x-service-token` | Field `image`: a chip portrait (JPEG, JP2 or J2K, at most 4 MP). Returns it as a PNG of at most 640 pixels a side |
| `POST` | `/v1/renditions` | `x-service-token` | Field `source`: a JPEG, PNG, WebP or PDF. Returns JSON (`Rendition`): an image upright and without metadata, as a JPEG or PNG of at most 4,096 px a side, or a PDF's first 20 pages as PNG images of at most 1,600 px a side, rendered by the guarded child; `truncated` when the PDF has more. Runs on its own lane (one running, four queued) and stops 40 s after the request arrived |

The response shapes are the C6 contract in `docs/plans/phase-1.plan.md`. The golden examples are in `contracts/fixtures/vision/`, and the pydantic models are in `src/openverify_vision/schemas.py`. All three analysis responses carry `model_versions` (`yunet-2026may`, `sface-2021dec`).

**Faces:**
- YuNet only finds faces up to about 380 pixels wide in its input. Detection therefore runs on copies scaled to a 640- and a 320-pixel long side (never upscaled), and duplicates are merged.
- Boxes are reported in pixels of the EXIF-upright upload. The largest face is the primary one.
- **The ID portrait** (Workflow 3B review K101) is the largest face *on the document*. It applies to the front's `portrait` in `/v1/analyze/government-id` (its embedding, `portrait_clarity`, and the portrait box the document quality and the forensics measure) and to `/v1/embed/face` with `subject=document`.
  - When the card is found inside the photo (`document.method` `contour`, `lines` or `text_layout`), only faces whose box centre lies inside its quad count. A person holding their card up beside their own, larger face therefore never has that face taken for the card's portrait. With no face inside the quad, there is no portrait: `/v1/embed/face` answers `face: null, face_count: 0`.
  - For `full_frame` or no document, the largest face on the whole upload counts.
  - `faces` still lists every face on the upload.

**Phone captures (Phase 12A, `docs/plans/phase-12a.plan.md`):**
- **Document fallback.** When the detectors find no card, the side's OCR lines (and, on the front, its faces) locate it, reported as `document.method` `text_layout`. This happens for a card that covers less than 30% of a tall phone frame. The card is either the outline under the area gate that holds the lines, or the lines' extent grown to a card. The card found this way is read again, rectified.
- **Sharpness.** `document_quality.blur_score` and `tenengrad` are measured on the rectified card resized to 1,000 pixels wide and smoothed (σ 0.8), over the side's text boxes, so they follow focus rather than the frame's size (`docs/calibration/blur-phase12a.md`).
- **PDF417 recovery.** When neither the upload nor the rectified card decodes a PDF417, a bounded recovery (at most 24 zxing-cpp reads) crops the barcode's region and tries upscaling, contrast stretching, binarizations and small rotations. It reports a symbol only when zxing-cpp decodes it whole, and a decode that used all its error correction only once a second pass agrees.

**Embeddings:**
- An embedding is the 128-float SFace feature, L2-normalised, so cosine similarity is a dot product. OpenCV Zoo's "same person" threshold is 0.363.
- Embeddings are biometric data. The service never stores them, and none is computed for the back of an ID.

**Models** load lazily, once, on the first request that needs them. If a weight file is missing, these endpoints answer `503` until `scripts/fetch_models.py` has run; no restart is needed.

Errors are RFC 9457 `application/problem+json` documents:

| Status | Cause |
|---|---|
| `401` | Bad token |
| `413` | File, request or image too large (a chip portrait over 4 MP) |
| `415` | Not a supported image, or a document that is neither a PDF nor a JPEG, PNG or WebP |
| `422` | Corrupt image, missing field or a page beyond the document; for a PDF, `code` `pdf_encrypted` (a user password), `pdf_unprocessable` (unreadable, a page box over 14,400 pt, a content stream that inflates past 20 MB, a page that cannot be loaded, a PDF the raw scanner cannot read to its end within its bounds (3,000,000 tokens, 200,000 objects, or a stream without `endstream`), whose revisions, markers, actions and edits after a signature would otherwise go unmeasured, or a PDF that stops the analysis' guarded child on its own CPU, address-space or output limit, which a retry would hit again) or `too_many_pages` (over 50) |
| `503` | Face models unavailable, or the service is busy (with `Retry-After`); `code` `guarded_worker_failed` when the guarded child could not start, passed its 30 s kill timer, was killed otherwise (`SIGKILL`, as the container's out-of-memory killer sends it), failed in its own code or answered something that does not validate; when a page render or a portrait child stopped on its limits; or when the document's OCR passed its 40 s deadline (the API retries, then answers `execution_error`) |

Upload errors on the multi-file endpoints start with the field name, for example `back: ...`.

## Documents (C60)

Vision measures; the document checks in `packages/checks/src/document/` classify, extract and decide (C60.5, C60.6).

**The guarded child (C60.2).** Every PDF and every chip portrait decode runs in a fresh `python -I -B -m openverify_vision.guarded.worker` (`src/openverify_vision/guarded/`) with an empty environment and the bytes on stdin. Before the document is read it sets `PR_SET_NO_NEW_PRIVS` and its rlimits, and it imports only the standard library, pypdfium2, pypdf and Pillow (a test asserts that no NumPy, OpenCV, onnxruntime or pydantic is loaded). The parent writes and reads through one `select` loop, so neither side can block the other, and validates every answer with pydantic (`guarded/results.py`) and every raster against the size its header declares.

| Limit | Value |
|---|---|
| `RLIMIT_AS` | 1.5 GiB |
| `RLIMIT_CPU` | 20 s (`SIGXCPU`; `SIGKILL` at 21 s) |
| `RLIMIT_FSIZE`, `RLIMIT_CORE`, `RLIMIT_NPROC` | 0 (no file grows, no core dump, no process or thread) |
| `RLIMIT_NOFILE` | 64 |
| Kill timer | 30 s, wall clock |
| Output cap | 64 MiB of stdout |
| Pages | at most 50; the first three and the last are analysed |
| Page box | at most 14,400 pt a side |
| Analysis raster | `min(200/72, sqrt(12 MP / (w*h)))` pixels per point, grey |
| pypdf | 20 MB output caps, 1,000 page-tree entries, no `jbig2dec`, `strict=False` |
| XMP | a bounded scan of at most 64 KiB, never an XML parser; `<!DOCTYPE` and `<!ENTITY` refuse the packet |
| Chip portraits | header first, refused above 4 MP before any pixel is decoded |

The child stops memory and CPU exhaustion, decompression bombs, runaway pages, file writes, core dumps, new threads and processes, privilege gain through setuid, the service token reaching the child, and a child flooding the parent. For the token, the empty environment is not enough on its own: the child runs as the same user, and `/proc/<ppid>/environ` and `/proc/<ppid>/fd` need only that, since Yama restricts attaching, not reading. So `create_app` makes the vision process non-dumpable (`PR_SET_DUMPABLE` 0), which keeps a child out of its `/proc` entries (the token Docker started it with, the spooled uploads, its memory) whatever the host's `ptrace_scope`; `execve` makes each child dumpable again for its own entries (Workflow 5C review P018). It does not stop code running inside it from opening a socket on the vision network or reading what the vision user can read; the container and the internal network are the other two layers (C60.2).

**What `/v1/analyze/document` measures (C60.1).**
- **Pages.** For a PDF, each analysed page's box in points, its grey raster's size, its text layer as lines (text, box in raster pixels, font ids, font size) each `visible` or not with its `hidden_reason`: `render_mode_invisible` (modes 3 and 7), `off_page`, `clipped` (outside its clip, each clip read as its bounding box), `too_small` (under 2 pt high), `covered` (nine tenths of it under an opaque fill, image or shading drawn after it) or `background_fill` (within 8 levels of the colour behind it, or a transparent fill). Annotations are not read for this: their appearance is in the raster.
- **OCR.** On a page with visible text-layer lines, the OCR reads each visible line's own box (padded by 0.3 of its height), so `ocr` holds one reading per visible line and `text_layer_ocr_agreement` is the length-weighted similarity of each line with its box's reading (0 where nothing was read). Text drawn only as an image on such a page is not read. A page without visible text (a scan) is read whole, by text detection and recognition, and has no agreement. A photo is read whole. Without the text models, `ocr` is empty and the text model versions are `null`: not measured, never "no text". The OCR's work is bounded, not only its answer (Workflow 5C review P009): a document's recognition may cost 2,400 line units (a line's width in line heights, from 320/48 to 64, about 2 ms each on the development machine), shared equally among the analysed pages still to read. Each page's lines are read in order until its share is spent; the lines after that have no reading and do not count in the agreement. The reading stops 40 s after the analysis began, answered 503 `guarded_worker_failed`, since the API waits 45 s.
- **`pdf`.** Producer, creator and dates from the Info dictionary; the XMP fields; linearization; revisions (`startxref` sections, the first-page section of a linearized file not counted); whether PDFium repaired the cross-reference table; the `%%EOF` markers and the bytes after the last one (trailing whitespace not counted); object streams; the fonts of the analysed pages; annotations on the analysed pages; the AcroForm's terminal fields (or, when pypdf cannot read the document, the widgets on the analysed pages); the dangerous actions (`/JS`, `/Launch`, `/SubmitForm`, `/GoToR`, `/RichMedia`, `/EmbeddedFile`, read by a raw-byte scanner that decodes escaped names and reads FlateDecode object streams, so an unreferenced object counts too; a GoTo `/OpenAction` does not); signatures; and whether an increment after a signature's byte range changes the document (an increment that only adds a DSS, only a document timestamp, or only a later signature with its field, widget, appearance and the AcroForm and page entries it needs, does not; any other object in it, the document information and XMP metadata included, does).
- **`image`.** For a photo, or a PDF whose first page is mostly one DCTDecode scan: the EXIF software and dates (with their offsets), the JPEG quality and double compression, `ela_text_cell_score` (each OCR line's JPEG ghost against the median of the other lines; it needs the photo's own 8x8 grid, so a misaligned paste shows as double compression instead; `null` with fewer than four lines) and copy-move.

`tools/benchmark_document.py` measures the Workflow 5B budget: the median time to analyse a synthetic 3-page born-digital bill through the app in process with the real text models, over 10 runs, with each stage timed. `--enforce` fails over the 4 s budget. `--sample dense` times four analysed pages of 600 visible lines instead, the most the OCR is asked to read, against a 10 s budget.

## Test fixtures and tools

- **`scripts/fetch_fixtures.py`** (stdlib only) downloads the faces listed in `fixtures/manifest.json` into the gitignored `fixtures/faces/`.
  - Only US federal government works are accepted (Wikimedia Commons `{{PD-USGov...}}`).
  - Each file is pinned by SHA-256 and size.
  - Person A has two different photos (ID portrait and selfie); person B is a different person.
- **`tools/make_synthetic_fixtures.py`** writes these files to the gitignored `fixtures/generated/`. Every document is synthetic, of the fictional issuer Utopia (`UTO`), and the output is deterministic:

  | File | Contents |
  |---|---|
  | `id-front.jpg`, `id-back.jpg` | The C36 happy card: a TD1 card of a fictional holder with person A's portrait and no specimen marker. The back carries a valid TD1 MRZ, built by `tools/icao_mrz.py` with our own check-digit code. The e2e suite uploads this pair |
  | `variants/<name>-front.jpg`, `variants/<name>-back.jpg` | Every C36 variant of the card (`tools/synthetic_variants.py`), each built to trip one check: for example `blurred`, `glare`, `expired`, `portrait-swap` (person B's photo), `screen-recapture`, `on-background`, `specimen-stamped`. Also the TD3 passport page and the MRV-A visa, front only |
  | `aamva/<vector id>.png` | Every payload of `contracts/fixtures/aamva/` as a barcode-only PDF417 on a plain background, never on a card (`tools/synthetic_aamva.py`) |
  | `variants.json` | Per variant: its group, the checks it must trip and, per side, the file and what it shows (fields, printed text, MRZ lines, document corners, JPEG quality). Per AAMVA vector: its file |
  | `selfie-a.jpg`, `selfie-b.jpg` | VGA stills |
  | `selfie-a.y4m`, `selfie-b.y4m` | 640x480 4:2:0 clips for Chromium's fake camera, 2 s at 15 fps |
  | `.generator-version` | The generator's version, written last. `e2e/setup/stack.ts` regenerates the set when it differs |

  Use a clip with `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=fixtures/generated/selfie-a.y4m`.
- **`tools/make_contract_fixtures.py`** regenerates `contracts/fixtures/vision/*.json` (C6 and C32.1) from seeded synthetic embeddings.
- **`tools/calibrate_government_id.py`** (C36 calibration, step one) runs every variant, distinct happy cards of other fictional holders, re-encodings of the happy card and every AAMVA image through the government ID analysis with the real models. It writes the raw measurements to `fixtures/generated/calibration/`. `packages/checks/scripts/calibration-report.ts` then scores them with the real evaluators.
- **`tools/benchmark_government_id.py`** measures the C32.4 budget: the median time to analyse both sides of the happy card at 1,600 pixels, over 10 runs, through the app in process, with each stage timed. `--enforce` fails over the 5 s budget.

## Docker

```bash
docker build -t openverify-vision services/vision
docker run --rm -p 8000:8000 \
  -e OPENVERIFY_VISION_SERVICE_TOKEN=change-me-to-a-long-random-value \
  -v "$PWD/models:/models:ro" openverify-vision
```

The image runs as a non-root user and expects model weights to be mounted at `/models`. `tools/` and `tests/` are not part of the image. `NOTICE` (the attribution of the vendored RapidOCR code and the text models) is shipped at `/app/NOTICE`.
