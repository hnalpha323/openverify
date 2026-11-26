# Vision contract fixtures (C6, C32.1, C60)

Golden responses of the internal vision service:

| File | Endpoint | Pydantic model (`services/vision`) |
|---|---|---|
| `analyze-government-id.json` | `POST /v1/analyze/government-id`: a two-sided card of the fictional issuer Utopia | `GovernmentIdAnalysis` |
| `analyze-government-id-barcode.json` | `POST /v1/analyze/government-id`: a barcode-only image (C36), front only | `GovernmentIdAnalysis` |
| `analyze-selfie.json` | `POST /v1/analyze/selfie` | `SelfieAnalysis` |
| `embed-face.json` | `POST /v1/embed/face` | `FaceEmbeddingResult` |
| `analyze-document-pdf.json` | `POST /v1/analyze/document` (C60.1): a two-page born-digital PDF water bill of the fictional Utopia Water Board | `DocumentAnalysis` |
| `analyze-document-image.json` | `POST /v1/analyze/document` (C60.1): a photo of the same bill, read by OCR alone | `DocumentAnalysis` |
| `embed-face-chip.json` | `POST /v1/embed/face` with `subject=chip` (C60.4): the fixture card holder's chip portrait | `FaceEmbeddingResult` |
| `png-limits.json` | The PNG answers of `POST /v1/render/document-page`, `POST /v1/convert/portrait` (C60.4) and `POST /v1/mask/background` (C99.7): their media type and pixel bounds | `VisionPngLimits` |
| `rendition-image.json` | `POST /v1/renditions` (C135.3, Workflow 8B): an image re-encoded upright without metadata | `Rendition` |
| `rendition-pdf.json` | `POST /v1/renditions` (C135.3): a two-page PDF rendered to PNG pages | `Rendition` |
| `pdf-page-count.json` | `POST /v1/count/document-pages` (Workflow 11B): its path, media type, byte and page bounds and C60.1's refusal codes; exported by `page_count.page_count_limits()` and held by `tests/test_page_count.py` (rule 28) | `PageCountLimits` |

`services/vision/tests/test_contract_fixtures.py` validates every file against its pydantic model, field for field. The API worker validates the same files with zod.

## Shape notes

- **Field names** are snake_case.
- **Optional parts** (`sides.back`, `poses.left`, `poses.right`, `portrait`, `face`) are always present and are `null` when absent.
- **`bbox`** is `[x, y, width, height]` in pixels of the EXIF-upright upload. Width and height are positive; `x` and `y` can be negative when a face crosses the image edge.
- **`score`** is the detector confidence, in `[0, 1]`.
- **`embedding`** has exactly 128 floats and is L2-normalised, so cosine similarity is the dot product.
- **The back of an ID** never carries a `portrait`: no embedding is computed for it.
- **The ID portrait** (`sides.front.portrait`, Workflow 3B review K101) is the largest face on the document. When the card is found inside the photo (`document.method` `contour` or `lines`), only a face whose box centre lies inside `document.quad` counts; with none there is no portrait, no `portrait_clarity` and no portrait box for the document quality or the forensics. For `full_frame` or no document, it is the largest face on the upload. `faces` still lists every face.
- **`POST /v1/embed/face`** takes an optional multipart text field `subject`: `selfie` (the default when absent: the largest face on the image) or `document` (a government ID front, with the portrait rule above). With no face on a found card, `document` answers as for an image without a face (`face: null`, `face_count: 0`). Any other value is `422`. `face_count` is the number of faces `face` was chosen from.

## Government ID analysis v2 (C32.1, Phase 3)

Each side keeps the C6 fields (`quality`, `faces`, `portrait`), byte for byte, and gains: `document`, `document_quality`, `text`, `mrz`, `barcodes`, `portrait_clarity`, `forensics` and `phash`. `model_versions` gains `text_detector` and `text_recognizer`.

- **Vision measures, TypeScript decides** (C32.2): every score is raw, and thresholds and decisions live in `packages/checks`.
- **Not measured is `null`** (or `found: false`, or an empty list), never a made-up value: `document_quality` and `phash` without a rectified document, `portrait_clarity` on the back, `forensics` when the measurements could not be taken, `forensics.jpeg` for a PNG or WebP upload, the text model versions while no OCR model ran.
- **Coordinates.** `document.quad` and `barcodes[].quad` are in pixels of the upright upload, four corners clockwise from the top left. `text[].box` and `mrz.box` are in pixels of the rectified document when one was found, else of the upload.
- **`mrz.lines`** are raw: at most 3 lines of `[A-Z0-9<]`, each with a confidence. Parsing and check digits are TypeScript's job.
- **`barcodes[]`** carry the raw bytes (`bytes_b64`) and the plain text (zxing-cpp `text_mode=Plain`).
- **PII.** OCR text, MRZ lines and barcode payloads are personal data in a real response: the service never logs them and the API never stores them (C32.5). `forensics.exif` never carries GPS values, only `has_gps`.
- **Limits:** 200 text lines of 200 characters, 3 MRZ lines of 64 characters, 8 barcodes.

The card describes a fictional holder (`VALEMONT<<QUINN`) with a TD1 MRZ on the back whose check digits are valid. The barcode-only image carries an AAMVA-shaped payload for a fictional person, with the `ZC` subfile marking it as OpenVerify synthetic test data; no jurisdiction issued it. `services/vision/tests/test_contract_fixtures.py` also pins a digest of the C6 fields of `analyze-government-id.json`, so they stay as Phase 1 committed them.

## Document analysis (C60, Phase 5)

`POST /v1/analyze/document` takes one multipart file `document`: a PDF (`%PDF-` within its first 1,024 bytes) or a JPEG, PNG or WebP photo, at most one upload (route limit: 1 x upload + 64 KiB). It answers measurements only; classification, extraction and every decision are TypeScript's (C60.5, C60.6).

- **`source`** is `pdf` or `image`. `pdf` is set exactly for a PDF; a photo is one page with no text layer and no page box.
- **`analysed_pages`** are the first three pages and the last, 1-based; `pages` holds one entry per analysed page, in that order. More than 50 pages is a 422 with `code: too_many_pages`.
- **Page coordinates.** Every `box` is `[x, y, width, height]` in pixels of the raster read: the PDF page rendered at `min(200/72, sqrt(12 MP / (w * h)))`, or the upright photo. `width_pt` and `height_pt` are the PDF page box (each at most 14,400 pt), `null` for a photo.
- **`text_layer`** lists every line of a PDF page, visible or not. `visible` is false for render mode 3, clipped or off-page text, text under an opaque fill, text filled in the background's colour, or text under 2 pt high, and `hidden_reason` then says which (`null` exactly when visible). Extraction reads visible lines only (C60.5).
- **`ocr`** lines and `text_layer_ocr_agreement` (`null` unless the page has both): at most 600 lines of 300 characters each, per page.
- **`pdf`**: Info and XMP metadata (XMP from a bounded byte scan, no XML parser), `revisions` (not counting a linearized first-page section), `xref_repaired`, `%%EOF` markers and trailing bytes, object streams, fonts (base name, subset tag, embedded), annotations, form fields, the dangerous actions only (a GoTo `/OpenAction` is not counted), signatures and `edits_after_signature` (DSS-only and DocTimeStamp-only increments excluded). Dates are ISO 8601 or `null`.
- **`image`**: EXIF software and dates, JPEG quality, double compression, ELA of the text cells and copy-move, for a photo (or a scanned page's embedded JPEG); `null` when there is no image to measure.
- **Errors** (problem+json with a `code`): 415 for a file that is neither a PDF nor an image, 413 for one too large, 422 `pdf_encrypted`, `pdf_unprocessable` or `too_many_pages`, and 503 `guarded_worker_failed` when the guarded child was killed or timed out (the job retries, then answers `execution_error`).
- **`POST /v1/mask/background`** (C99.7; multipart `image`) answers `image/png` of at most 640 px a side: the selfie with every face the finder sees and its head and shoulders painted out, carrying none of the upload's metadata. A frame without a face answers `422` with `code` `no_face_found`.
- **PNG answers** (`png-limits.json`): `POST /v1/render/document-page` (`document`, and `page`, 1-based, default 1) answers `image/png` of at most 1,600 px a side; `POST /v1/convert/portrait` (`image`: JPEG, JP2 or J2K) of at most 640 px; a JPEG 2000 above 4 MP is refused from its header.
- **`subject=chip`** on `POST /v1/embed/face`: the image is a chip's DG2 portrait (JPEG or JPEG 2000), decoded through the guarded child; the answer is as for a selfie.
- **Until built** (Workflow 5B Stage 1), each of these routes answers 501 with `code: not_implemented`, never a made-up measurement.

The bill is addressed to the fixture card's fictional holder at an invented street and town with an unassigned postal code (C65.1). One page-1 line is covered by an opaque box (`hidden_reason: covered`), to show a hidden line.

## Renditions (C135.3, Workflow 8B)

`POST /v1/renditions` takes one multipart file `source`: a JPEG, PNG or WebP image, or a PDF. It answers what a reviewer may see of it, never the file itself:

- **An image** is decoded with the service's guards, its EXIF orientation applied, every metadata segment (EXIF with GPS, XMP, ICC, PNG text chunks) dropped, and re-encoded as JPEG or PNG of at most 4,096 px a side: one page, `page_count` 1.
- **A PDF** has its first 20 pages rendered to PNG of at most 1,600 px a side by the guarded child. `page_count` is the whole document's; `truncated` says it holds more pages than were rendered.
- **`pages[]`** are numbered from 1, in order. Each carries its `media_type`, `width`, `height`, `byte_size` and `data_b64` (standard base64 of exactly `byte_size` bytes; a PNG's IHDR holds its width and height, a JPEG starts with a start-of-image marker). One page is at most 16 MiB before base64.
- **Its own limiter lane**: one slot and four queued, so verification processing keeps its two slots.
- **Errors**: as `POST /v1/analyze/document` (415, 413, 422 with a `code`, 503 `guarded_worker_failed`). Until built, the API's `createRendition` answers 501 `not_implemented` without sending anything.

The two fixtures are flat synthetic pixels, written without compression by `synthetic_png` in the generator, so their bytes never drift.

## Synthetic data only

The embeddings are seeded pseudo-random unit vectors written by `services/vision/tools/make_contract_fixtures.py`. They are never features of a real face. The quality numbers and boxes are plausible made-up values.

The vectors are constructed so that:
- the ID portrait (`analyze-government-id.json`, `sides.front.portrait`) and the selfie center face (`analyze-selfie.json`, `poses.center.face`) have a cosine similarity of **0.72**, a match above SFace's 0.363 threshold;
- the ID portrait and the `embed-face.json` face have a cosine similarity of **0.05**, which is not a match;
- the ID portrait and the chip portrait (`embed-face-chip.json`) have a cosine similarity of **0.72**, a match.

To regenerate (the test fails if the committed files drift from the generator):

```bash
(cd services/vision && uv run python tools/make_contract_fixtures.py)
pnpm exec prettier --write contracts/fixtures/vision/*.json
```
