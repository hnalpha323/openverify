"""C60.1, C60.2, C60.4: the PDF tasks of the guarded child, ``analyze_pdf`` and
``render_pdf_page``.

``analyze`` opens the document with PDFium (a user password refuses it as ``pdf_encrypted``,
anything unreadable as ``pdf_unprocessable``, more than 50 pages as ``too_many_pages``), checks
each analysed page's box (at most 14,400 pt a side) and, through pypdf with 20 MB output caps,
that its content streams inflate within bounds; then it reads the analysed pages' text layers,
renders them in grey at ``min(200/72, sqrt(12 MP / (w*h)))`` for the parent's OCR, and measures
the document (metadata, XMP, revisions, repairs, markers, object streams, fonts, annotations,
form fields, actions, signatures and edits after them) with the raw-byte scanner. ``render_page``
renders one page in RGB at most 1,600 px a side. No PDF JavaScript runs: the PDFium build has no
V8. Standard library, pypdfium2 and pypdf only.

Where each measurement comes from:

- PDFium: the page count, boxes, text layer, renders, fonts, annotations (on the analysed
  pages), the Info dictionary, document-level JavaScript and attachments, signatures and their
  byte ranges, and whether the cross-reference table had to be repaired;
- pypdf: the content-stream bound check and the AcroForm's terminal fields (when pypdf cannot
  read the document, the widgets on the analysed pages are counted instead, and
  ``pdf_parser`` is ``null``);
- the raw-byte scanner: the XMP packet, EOF markers, revisions, linearization, object streams,
  the action names (escaped or in unreferenced objects too) and the increments after a
  signature.
"""

from __future__ import annotations

import contextlib
import ctypes
import io
import math
import warnings
from collections.abc import Iterator
from typing import Any, Final

import pypdf
import pypdfium2 as pdfium  # type: ignore[import-untyped]  # ships without type information
import pypdfium2.raw as pdfium_c  # type: ignore[import-untyped]  # likewise
from pypdf.errors import LimitReachedError
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, StreamObject

from openverify_vision.guarded.pdf_scan import PdfScan, scan_pdf
from openverify_vision.guarded.protocol import TaskRefusal
from openverify_vision.guarded.text import clip_text, pdf_date
from openverify_vision.guarded.text_layer import FontRegistry, page_lines
from openverify_vision.guarded.xmp_scan import scan_xmp

ANALYSIS_DPI_SCALE: Final = 200 / 72
ANALYSIS_MAX_PIXELS: Final = 12_000_000
PYPDF_OUTPUT_LIMIT: Final = 20_000_000
PYPDF_PAGE_TREE_LIMIT: Final = 1000
MAX_EMBEDDED_JPEG_BYTES: Final = 8 * 1024 * 1024
MAX_DOCUMENT_PAGES: Final = 50
MAX_PAGE_SIDE_PT: Final = 14_400.0
MAX_STRING_LENGTH: Final = 256
MAX_CONTENT_STREAMS: Final = 64
MAX_FORM_NESTING: Final = 3
MAX_FIELD_NODES: Final = 10_000
MAX_FIELD_DEPTH: Final = 32
SCANNED_SHARE: Final = 0.5
"""An image covering at least half the first page is its scan."""

_WHITE: Final = (255, 255, 255, 255)
_RENDER_FLAGS: Final = pdfium_c.FPDF_ANNOT


def analysed_pages(page_count: int) -> list[int]:
    """C60.1: the first three pages and the last, 1-based (``schemas.analysed_page_numbers``)."""
    return sorted({*range(1, min(page_count, 3) + 1), page_count})


# --- opening and bounds --------------------------------------------------------------------------


def _document(data: bytes) -> pdfium.PdfDocument:
    """``data`` opened by PDFium; a user password refuses it as ``pdf_encrypted``, anything
    PDFium cannot read as ``pdf_unprocessable``."""
    try:
        return pdfium.PdfDocument(data)
    except pdfium.PdfiumError as exc:
        if exc.err_code in {pdfium_c.FPDF_ERR_PASSWORD, pdfium_c.FPDF_ERR_SECURITY}:
            raise TaskRefusal("pdf_encrypted") from exc
        raise TaskRefusal("pdf_unprocessable") from exc


def _open(data: bytes) -> pdfium.PdfDocument:
    pdf = _document(data)
    pdf.init_forms()
    count = len(pdf)
    if count < 1:
        raise TaskRefusal("pdf_unprocessable")
    if count > MAX_DOCUMENT_PAGES:
        raise TaskRefusal("too_many_pages")
    return pdf


def _load(pdf: pdfium.PdfDocument, number: int) -> pdfium.PdfPage:
    """Page ``number`` (1-based); a page PDFium cannot load (a page tree that loops back on
    itself, say) makes the document unprocessable."""
    try:
        return pdf[number - 1]
    except pdfium.PdfiumError as exc:
        raise TaskRefusal("pdf_unprocessable") from exc


def _size(page: pdfium.PdfPage) -> tuple[float, float]:
    """The page's displayed width and height in points, refused unless both are in
    ``(0, 14400]`` and so is its box."""
    width, height = page.get_width(), page.get_height()
    try:
        left, bottom, right, top = page.get_bbox()
    except pdfium.PdfiumError as exc:  # PDFium found no box for the page
        raise TaskRefusal("pdf_unprocessable") from exc
    sides = (width, height, right - left, top - bottom)
    if not all(math.isfinite(side) and 0 < side <= MAX_PAGE_SIDE_PT for side in sides):
        raise TaskRefusal("pdf_unprocessable")
    return width, height


@contextlib.contextmanager
def _pypdf_limits() -> Iterator[None]:
    """C60.2: pypdf's output caps lowered to 20 MB, a page tree of at most 1,000 entries, no
    jbig2dec binary, and its warnings silenced (pypdf is lenient, ``strict=False``)."""
    with (
        warnings.catch_warnings(),
        pypdf.apply_configuration(
            maximum_declared_stream_length=PYPDF_OUTPUT_LIMIT,
            array_based_stream_maximum_output_length=PYPDF_OUTPUT_LIMIT,
            jbig2_maximum_output_length=PYPDF_OUTPUT_LIMIT,
            lzw_maximum_output_length=PYPDF_OUTPUT_LIMIT,
            run_length_maximum_output_length=PYPDF_OUTPUT_LIMIT,
            zlib_maximum_output_length=PYPDF_OUTPUT_LIMIT,
            image_maximum_buffer_size=PYPDF_OUTPUT_LIMIT,
            xmp_maximum_input_length=64 * 1024,
            page_tree_maximum_entries=PYPDF_PAGE_TREE_LIMIT,
            jbig2dec_binary=None,
        ),
    ):
        warnings.simplefilter("ignore")
        yield


def _reader(data: bytes) -> pypdf.PdfReader | None:
    """pypdf's reader, or ``None`` when it cannot read the document (an encryption it cannot
    open without ``cryptography``, or a file only PDFium's repair reads)."""
    try:
        reader = pypdf.PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted and not reader.decrypt(""):
            return None
        _ = reader.trailer["/Root"]
    except LimitReachedError as exc:
        raise TaskRefusal("pdf_unprocessable") from exc
    except Exception:  # noqa: BLE001 - a hostile file may break pypdf in any way; PDFium decides
        return None
    return reader


def _resolved(value: Any) -> Any:
    return value.get_object() if isinstance(value, IndirectObject) else value


def _content_streams(page: DictionaryObject) -> Iterator[StreamObject]:
    """A page's content streams and its form XObjects', nested at most three deep."""
    pending: list[tuple[Any, int]] = [(page, 0)]
    yielded = 0
    while pending and yielded < MAX_CONTENT_STREAMS:
        holder, depth = pending.pop()
        holder = _resolved(holder)
        if not isinstance(holder, DictionaryObject):
            continue
        contents = _resolved(holder.get("/Contents"))
        streams = list(contents) if isinstance(contents, ArrayObject) else [contents]
        if isinstance(holder, StreamObject):
            streams = [holder]
        for item in streams:
            stream = _resolved(item)
            if isinstance(stream, StreamObject):
                yielded += 1
                yield stream
        resources = _resolved(holder.get("/Resources"))
        xobjects = _resolved(resources.get("/XObject")) if isinstance(resources, dict) else None
        if depth < MAX_FORM_NESTING and isinstance(xobjects, dict):
            for xobject in xobjects.values():
                form = _resolved(xobject)
                if isinstance(form, StreamObject) and form.get("/Subtype") == "/Form":
                    pending.append((form, depth + 1))


def _check_contents(reader: pypdf.PdfReader | None, numbers: list[int]) -> None:
    """C60.2: refuse a page whose content inflates past pypdf's 20 MB caps, before PDFium
    parses it."""
    if reader is None:
        return
    try:
        pages = reader.pages
        for number in numbers:
            if number <= len(pages):
                for stream in _content_streams(pages[number - 1]):
                    stream.get_data()
    except LimitReachedError as exc:
        raise TaskRefusal("pdf_unprocessable") from exc
    except Exception:  # noqa: BLE001, S110 - a page pypdf cannot read is left to PDFium
        pass


# --- rendering -----------------------------------------------------------------------------------


def _render(
    pdf: pdfium.PdfDocument, page: pdfium.PdfPage, size: tuple[int, int], *, grey: bool
) -> bytes:
    """``page`` rendered to ``size`` with its annotations and form fields, as tight rows (grey,
    or RGB)."""
    width, height = size
    kind = pdfium_c.FPDFBitmap_Gray if grey else pdfium_c.FPDFBitmap_BGR
    bitmap = pdfium.PdfBitmap.new_native(width, height, kind, rev_byteorder=not grey)
    bitmap.fill_rect(_WHITE, 0, 0, width, height)
    flags = _RENDER_FLAGS | (0 if grey else pdfium_c.FPDF_REVERSE_BYTE_ORDER)
    if grey:
        flags |= pdfium_c.FPDF_GRAYSCALE
    pdfium_c.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, flags)
    if pdf.formenv:
        pdfium_c.FPDF_FFLDraw(pdf.formenv, bitmap, page, 0, 0, width, height, 0, flags)
    return bytes(bitmap.buffer)


def analysis_size(width_pt: float, height_pt: float) -> tuple[int, int]:
    """C60.2: the analysis raster at ``min(200/72, sqrt(12 MP / (w*h)))`` pixels per point."""
    scale = min(ANALYSIS_DPI_SCALE, math.sqrt(ANALYSIS_MAX_PIXELS / (width_pt * height_pt)))
    return max(1, math.ceil(width_pt * scale - 1e-6)), max(1, math.ceil(height_pt * scale - 1e-6))


def preview_size(width_pt: float, height_pt: float, max_side: int) -> tuple[int, int]:
    """C60.4: the preview at most ``max_side`` pixels a side and never above 200 dpi."""
    scale = min(max_side / max(width_pt, height_pt), ANALYSIS_DPI_SCALE)
    width = min(max_side, max(1, round(width_pt * scale)))
    height = min(max_side, max(1, round(height_pt * scale)))
    return width, height


# --- the first page's scan -----------------------------------------------------------------------


def _filters(image: Any) -> list[str]:
    names = []
    for index in range(max(0, pdfium_c.FPDFImageObj_GetImageFilterCount(image))):
        length = pdfium_c.FPDFImageObj_GetImageFilter(image, index, None, 0)
        buffer = ctypes.create_string_buffer(max(1, length))
        pdfium_c.FPDFImageObj_GetImageFilter(image, index, buffer, length)
        names.append(buffer.value.decode("latin-1"))
    return names


def _device_box(
    page: Any, box: tuple[float, float, float, float], size: tuple[int, int]
) -> list[float]:
    xs, ys = [], []
    for x, y in ((box[0], box[1]), (box[2], box[3])):
        dx, dy = ctypes.c_int(), ctypes.c_int()
        pdfium_c.FPDF_PageToDevice(page, 0, 0, size[0], size[1], 0, x, y, dx, dy)
        xs.append(dx.value)
        ys.append(dy.value)
    return [
        float(min(xs)),
        float(min(ys)),
        float(max(1, max(xs) - min(xs))),
        float(max(1, max(ys) - min(ys))),
    ]


def _scanned_jpeg(
    page: pdfium.PdfPage, size: tuple[int, int]
) -> tuple[dict[str, Any], bytes] | None:
    """The largest DCTDecode image covering at least half the page, as its raw JPEG bytes."""
    left, bottom, right, top = page.get_bbox()
    page_area = (right - left) * (top - bottom)
    best: tuple[float, Any, tuple[float, float, float, float]] | None = None
    for index in range(pdfium_c.FPDFPage_CountObjects(page)):
        image = pdfium_c.FPDFPage_GetObject(page, index)
        if pdfium_c.FPDFPageObj_GetType(image) != pdfium_c.FPDF_PAGEOBJ_IMAGE:
            continue
        if _filters(image) != ["DCTDecode"]:
            continue
        x0, y0, x1, y1 = (ctypes.c_float() for _ in range(4))
        if not pdfium_c.FPDFPageObj_GetBounds(image, x0, y0, x1, y1):
            continue
        box = (max(x0.value, left), max(y0.value, bottom), min(x1.value, right), min(y1.value, top))
        area = max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])
        if area >= SCANNED_SHARE * page_area and (best is None or area > best[0]):
            best = (area, image, (x0.value, y0.value, x1.value, y1.value))
    if best is None:
        return None
    _, image, bounds = best
    length = pdfium_c.FPDFImageObj_GetImageDataRaw(image, None, 0)
    if not 0 < length <= MAX_EMBEDDED_JPEG_BYTES:
        return None
    buffer = ctypes.create_string_buffer(length)
    pdfium_c.FPDFImageObj_GetImageDataRaw(image, buffer, length)
    pixel_width, pixel_height = ctypes.c_uint(), ctypes.c_uint()
    pdfium_c.FPDFImageObj_GetImagePixelSize(image, pixel_width, pixel_height)
    matrix = pdfium_c.FS_MATRIX()
    pdfium_c.FPDFPageObj_GetMatrix(image, matrix)
    axis_aligned = abs(matrix.b) < 1e-6 and abs(matrix.c) < 1e-6  # noqa: PLR2004
    try:
        upright = page.get_rotation() == 0
    except pdfium.PdfiumError:  # an invalid /Rotate: the placement is not known to be square
        upright = False
    described = {
        "box": _device_box(page, bounds, size),
        "pixel_width": pixel_width.value,
        "pixel_height": pixel_height.value,
        "axis_aligned": axis_aligned and upright,
    }
    return described, buffer.raw[:length]


# --- the document --------------------------------------------------------------------------------


def _signature_ends(pdf: pdfium.PdfDocument) -> list[int]:
    """Where each signature's byte range ends."""
    ends = []
    for index in range(max(0, pdfium_c.FPDF_GetSignatureCount(pdf))):
        signature = pdfium_c.FPDF_GetSignatureObject(pdf, index)
        count = pdfium_c.FPDFSignatureObj_GetByteRange(signature, None, 0)
        if count < 2:  # noqa: PLR2004 - an offset and a length
            continue
        values = (ctypes.c_int * count)()
        pdfium_c.FPDFSignatureObj_GetByteRange(signature, values, count)
        pairs = zip(values[0::2], values[1::2], strict=False)
        ends.append(max(offset + length for offset, length in pairs))
    return ends


def _terminal_fields(reader: pypdf.PdfReader) -> int | None:
    """The AcroForm's terminal fields, walked with a bound; ``None`` when it cannot be read."""
    try:
        root = _resolved(reader.trailer["/Root"])
        form = _resolved(root.get("/AcroForm"))
        if not isinstance(form, dict):
            return 0
        fields = _resolved(form.get("/Fields"))
        pending = [(item, 0) for item in fields] if isinstance(fields, list) else []
        seen: set[tuple[int, int]] = set()
        count = visited = 0
        while pending and visited < MAX_FIELD_NODES:
            item, depth = pending.pop()
            visited += 1
            if isinstance(item, IndirectObject):
                key = (item.idnum, item.generation)
                if key in seen:
                    continue
                seen.add(key)
            node = _resolved(item)
            if not isinstance(node, dict):
                continue
            kids = _resolved(node.get("/Kids"))
            named = (
                [kid for kid in kids if "/T" in _resolved(kid)] if isinstance(kids, list) else []
            )
            if named and depth < MAX_FIELD_DEPTH:
                pending.extend((kid, depth + 1) for kid in named)
            else:
                count += 1
    except Exception:  # noqa: BLE001 - an unreadable form is no count, not a failure
        return None
    return count


def _widgets(page: pdfium.PdfPage) -> int:
    count = 0
    for index in range(max(0, pdfium_c.FPDFPage_GetAnnotCount(page))):
        annotation = pdfium_c.FPDFPage_GetAnnot(page, index)
        if annotation:
            if pdfium_c.FPDFAnnot_GetSubtype(annotation) == pdfium_c.FPDF_ANNOT_WIDGET:
                count += 1
            pdfium_c.FPDFPage_CloseAnnot(annotation)
    return count


def _metadata(pdf: pdfium.PdfDocument) -> dict[str, str]:
    try:
        return {key: str(value) for key, value in pdf.get_metadata_dict(skip_empty=True).items()}
    except pdfium.PdfiumError:  # pragma: no cover - PDFium answers it for any open document
        return {}


def _actions(scan: PdfScan, pdf: pdfium.PdfDocument) -> dict[str, int]:
    names = scan.names
    return {
        "javascript": max(names["JS"], pdfium_c.FPDFDoc_GetJavaScriptActionCount(pdf)),
        "launch": names["Launch"],
        "submit_form": names["SubmitForm"],
        "goto_remote": names["GoToR"],
        "rich_media": names["RichMedia"] + names["RichMediaExecute"],
        "embedded_files": max(names["EmbeddedFile"], pdfium_c.FPDFDoc_GetAttachmentCount(pdf)),
    }


def _string(value: str | None) -> str | None:
    return None if value is None else clip_text(value, MAX_STRING_LENGTH)


def _date(value: str | None) -> str | None:
    return None if value is None else pdf_date(value)


def _measurements(
    pdf: pdfium.PdfDocument,
    reader: pypdf.PdfReader | None,
    scan: PdfScan,
    annotations: int,
    widgets: int,
) -> dict[str, Any]:
    info = _metadata(pdf)
    packet = scan.metadata_packet()
    fields = None if reader is None else _terminal_fields(reader)
    ends = _signature_ends(pdf)
    return {
        "producer": _string(info.get("Producer")),
        "creator": _string(info.get("Creator")),
        "creation_date": _date(info.get("CreationDate")),
        "modification_date": _date(info.get("ModDate")),
        "xmp": None if packet is None else scan_xmp(packet),
        "linearized": scan.linearized,
        "revisions": scan.revisions,
        "xref_repaired": not pdfium_c.FPDF_DocumentHasValidCrossReferenceTable(pdf),
        "eof_markers": scan.eof_markers,
        "bytes_after_last_eof": scan.bytes_after_last_eof,
        "object_streams": scan.object_streams,
        "annotations": annotations,
        "form_fields": widgets if fields is None else fields,
        "actions": _actions(scan, pdf),
        "signatures": len(ends),
        "edits_after_signature": bool(ends) and scan.edits_after(min(ends)),
    }


def analyze(data: bytes) -> tuple[dict[str, Any], list[bytes]]:
    """The ``analyze_pdf`` answer: measurements, then one grey raster per analysed page and the
    first page's scanned JPEG, if any."""
    with _pypdf_limits():
        pdf = _open(data)
        try:
            numbers = analysed_pages(len(pdf))
            reader = _reader(data)
            _check_contents(reader, numbers)
            fonts = FontRegistry()
            pages: list[dict[str, Any]] = []
            rasters: list[bytes] = []
            extra: list[bytes] = []
            annotations = widgets = 0
            for number in numbers:
                page = _load(pdf, number)
                try:
                    width_pt, height_pt = _size(page)
                    size = analysis_size(width_pt, height_pt)
                    lines = page_lines(page.raw, fonts, size, pdf.raw)
                    rasters.append(_render(pdf, page, size, grey=True))
                    annotations += max(0, pdfium_c.FPDFPage_GetAnnotCount(page))
                    widgets += _widgets(page)
                    scan_of_page = _scanned_jpeg(page, size) if number == 1 else None
                finally:
                    page.close()
                embedded = None
                if scan_of_page is not None:
                    embedded = {"frame": len(numbers) + len(extra), **scan_of_page[0]}
                    extra.append(scan_of_page[1])
                pages.append(
                    {
                        "number": number,
                        "width_pt": round(width_pt, 3),
                        "height_pt": round(height_pt, 3),
                        "raster": {"frame": len(rasters) - 1, "width": size[0], "height": size[1]},
                        "text_layer": lines,
                        "embedded_jpeg": embedded,
                    }
                )
            try:
                scan = scan_pdf(data)
            except (ValueError, OverflowError) as exc:  # a bound the scanner missed (P017)
                raise TaskRefusal("pdf_unprocessable") from exc
            if scan.truncated:
                # Revisions, markers, actions and edits after a signature past where the scan
                # stopped are unknown; never report them as a clean document (P012).
                raise TaskRefusal("pdf_unprocessable")
            header = {
                "ok": True,
                "page_count": len(pdf),
                "pages": pages,
                "fonts": fonts.fonts,
                "pdf": _measurements(pdf, reader, scan, annotations, widgets),
                "versions": {
                    "pdf_renderer": f"pdfium-{pdfium.PDFIUM_INFO}",
                    "pdf_parser": None if reader is None else f"pypdf-{pypdf.__version__}",
                },
            }
        finally:
            pdf.close()
    return header, [*rasters, *extra]


def count_pages(data: bytes, max_pages: int) -> tuple[dict[str, Any], list[bytes]]:
    """The ``count_pdf_pages`` answer (Workflow 11B, ``page_count.py``): PDFium's page count of
    the document, read from its page tree; no page is loaded or rendered and no form is set up.
    No page is ``pdf_unprocessable``; more than ``max_pages`` is ``too_many_pages``."""
    pdf = _document(data)
    try:
        count = len(pdf)
    finally:
        pdf.close()
    if count < 1:
        raise TaskRefusal("pdf_unprocessable")
    if count > max_pages:
        raise TaskRefusal("too_many_pages")
    return {"ok": True, "page_count": count}, []


def render_page(data: bytes, page: int, max_side: int) -> tuple[dict[str, Any], list[bytes]]:
    """The ``render_pdf_page`` answer: page ``page`` (1-based) as RGB, at most ``max_side`` px
    a side and at most 200 dpi."""
    with _pypdf_limits():
        pdf = _open(data)
        try:
            count = len(pdf)
            if not 1 <= page <= count:
                raise TaskRefusal("page_out_of_range")
            _check_contents(_reader(data), [page])
            handle = _load(pdf, page)
            try:
                size = preview_size(*_size(handle), max_side)
                rgb = _render(pdf, handle, size, grey=False)
            finally:
                handle.close()
        finally:
            pdf.close()
    header = {
        "ok": True,
        "page_count": count,
        "raster": {"frame": 0, "width": size[0], "height": size[1]},
    }
    return header, [rgb]
