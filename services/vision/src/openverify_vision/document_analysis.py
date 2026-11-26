"""C60.1, C60.4: the document analysis, the page render, the portrait conversion and the chip
portrait decode behind ``/v1/analyze/document``, ``/v1/render/document-page``,
``/v1/convert/portrait`` and ``/v1/embed/face`` with ``subject=chip``.

Every PDF and every JPEG 2000 decode runs in the guarded child (:mod:`openverify_vision.guarded`,
C60.2), never in this process; this module validates the child's answer, runs the OCR and the
image forensics on what it returned, and builds the contract's models. A photo (JPEG, PNG,
WebP) is decoded here, as every upload was before.

- **A page with visible text-layer lines** (born digital): each visible line's own box is read
  by the OCR on the page's grey raster (C60.5 compares a field's text-layer value with the OCR of
  its box), so ``ocr`` holds one reading per visible line read and ``text_layer_ocr_agreement`` how
  far they agree. Text drawn only as an image on such a page is not read. Hidden lines are
  reported with their reason and never read.
- **A page without one** (a scan, or text only in render mode 3) is read whole, by text
  detection and recognition; its agreement is ``null``.
- **The first page's scan**, when a DCTDecode image covers at least half of it, is measured as a
  photo is (``image``), its OCR boxes mapped into the scan's pixels when it lies square.
- **The OCR's work is bounded** (Workflow 5C review P009), not only its answer: a document's
  recognition may cost :data:`OCR_UNITS_PER_DOCUMENT` line units, shared among its analysed
  pages, and each page's lines are read in order until its share is spent. A line left unread
  has no reading and does not count in the agreement (not measured is not read as nothing). The
  reading stops :data:`ANALYSIS_DEADLINE_SECONDS` after the analysis began, answered 503.

Refusals answer their C60.1 status (``pdf_encrypted``, ``pdf_unprocessable``, ``too_many_pages``
as 422 codes; 415; 413). A PDF that stops the analysis' child on its own limits (CPU, address
space, output) is ``pdf_unprocessable`` too, since a retry would stop it the same way (Workflow
5C review P003). A child that was killed otherwise, timed out, could not start or answered
something that does not validate, a render or portrait child past its limits, and an OCR past
its deadline answer 503 ``guarded_worker_failed``.
Document text, fields and portraits are PII: returned to the API, never logged.
"""

from __future__ import annotations

import io
import logging
import time
from collections.abc import Sequence
from http import HTTPStatus
from typing import TYPE_CHECKING, Final, Literal, NoReturn, Protocol

import cv2
import numpy as np
from PIL import Image
from pydantic import ValidationError

from openverify_vision.document_forensics import measure_image
from openverify_vision.document_text import text_layer_ocr_agreement
from openverify_vision.guarded import DEFAULT_LIMITS, GuardLimits
from openverify_vision.guarded.results import (
    PageAnswer,
    PdfAnalysisAnswer,
    PortraitAnswer,
    RasterRef,
    RenderAnswer,
)
from openverify_vision.guarded.runner import (
    GuardedAnswer,
    GuardedRefusal,
    GuardedWorkerError,
    run_guarded,
)
from openverify_vision.imaging import (
    CorruptImageError,
    ImageDecodeError,
    ImageTooLargeError,
    UnsupportedImageError,
    decode_image,
)
from openverify_vision.ocr.recognition import RecognitionBudget, RecognitionDeadlineError
from openverify_vision.problems import ProblemError
from openverify_vision.schemas import (
    GUARDED_WORKER_FAILED,
    JPEG2000_MAX_PIXELS,
    MAX_DOCUMENT_LINES,
    PORTRAIT_MAX_SIDE_PX,
    RENDER_MAX_SIDE_PX,
    BoundingBox,
    DocumentAnalysis,
    DocumentImageMeasurements,
    DocumentModelVersions,
    DocumentOcrLine,
    DocumentPage,
    PdfMeasurements,
)

if TYPE_CHECKING:
    from openverify_vision.imaging import ImageArray
    from openverify_vision.settings import Settings

__all__ = [
    "GUARD_LIMITS",
    "DocumentReader",
    "analyze_document",
    "convert_portrait",
    "decode_chip_portrait",
    "render_document_page",
    "run_guarded",
    "sniff_document",
]

logger = logging.getLogger(__name__)

GUARD_LIMITS: GuardLimits = DEFAULT_LIMITS
"""The guarded child's limits for every task here (C60.2); tests lower them."""

PDF_HEADER: Final = b"%PDF-"
PDF_HEADER_WINDOW: Final = 1024
"""C52.4: a document is a PDF when ``%PDF-`` lies within its first 1,024 bytes."""

MAX_ANALYSIS_RASTER_PIXELS: Final = 12_100_000
"""The child renders at most 12 MP a page (C60.2), with rounding room."""

OCR_UNITS_PER_DOCUMENT: Final = 2400.0
"""Workflow 5C review P009: the most recognition one document may cost, in line heights of the
recognizer's input width (:func:`~openverify_vision.ocr.recognition.line_units`). The synthetic
3-page benchmark bill costs about 730; 2,400 is about 230 such lines, or 5 s of recognition on
the development machine (2 ms a unit) where the 2,400 boxes of four dense pages took 46 s. Each
analysed page gets an equal share of what is left; a page that needs less leaves the rest to
the pages after it."""

ANALYSIS_DEADLINE_SECONDS: Final = 40.0
"""Workflow 5C review P009: the reading stops this long after the analysis began and the
request answers 503 ``guarded_worker_failed``. The API waits 45 s for a guarded route
(``DEFAULT_GUARDED_VISION_TIMEOUT_MS``), so vision never reads on for an answer the API no
longer waits for. Within the unit budget it is a backstop for a host far slower than ours."""

_REFUSALS: Final = {
    "pdf_encrypted": (HTTPStatus.UNPROCESSABLE_ENTITY, "the PDF is encrypted with a password"),
    "pdf_unprocessable": (HTTPStatus.UNPROCESSABLE_ENTITY, "the PDF cannot be processed"),
    "too_many_pages": (HTTPStatus.UNPROCESSABLE_ENTITY, "the PDF has more than 50 pages"),
    "unsupported_format": (HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "not a supported format"),
    "too_large": (HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "the image has too many pixels"),
    "corrupt": (HTTPStatus.UNPROCESSABLE_ENTITY, "the image could not be decoded"),
    "page_out_of_range": (HTTPStatus.UNPROCESSABLE_ENTITY, "the document has no such page"),
}
_CODED: Final = frozenset({"pdf_encrypted", "pdf_unprocessable", "too_many_pages"})


class DocumentReader(Protocol):
    """What the analysis needs of the OCR engine (:class:`~openverify_vision.ocr.OcrEngine`)."""

    def load(self) -> bool: ...

    @property
    def detector_version(self) -> str | None: ...

    @property
    def recognizer_version(self) -> str | None: ...

    def read_document(
        self, img: ImageArray, budget: RecognitionBudget | None = None
    ) -> list[DocumentOcrLine]: ...

    def read_regions(
        self,
        img: ImageArray,
        boxes: Sequence[BoundingBox],
        budget: RecognitionBudget | None = None,
    ) -> list[DocumentOcrLine | None]: ...


def sniff_document(data: bytes) -> Literal["pdf", "image"] | None:
    """A JPEG, PNG or WebP by its first bytes, else a PDF by ``%PDF-`` in its first 1,024
    bytes, as the API sniffs a ``document`` upload (C52.4)."""
    if data.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n")) or (
        data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    ):
        return "image"
    if PDF_HEADER in data[:PDF_HEADER_WINDOW]:
        return "pdf"
    return None


# --- the guard -----------------------------------------------------------------------------------


def _worker_failed(reason: str) -> NoReturn:
    raise ProblemError(
        HTTPStatus.SERVICE_UNAVAILABLE,
        f"the document could not be processed in time ({reason}); retry later",
        code=GUARDED_WORKER_FAILED,
    )


def _refused(code: str) -> ProblemError:
    status, detail = _REFUSALS[code]
    return ProblemError(status, f"document: {detail}", code=code if code in _CODED else None)


def _guarded(
    task: str,
    data: bytes,
    params: dict[str, object] | None = None,
    *,
    over_limits: str | None = None,
) -> GuardedAnswer:
    """``task`` in a guarded child; a child that stopped on its own limits is refused with
    ``over_limits`` when given (Workflow 5C review P003), else answered 503 as any failure."""
    try:
        return run_guarded(task, data, params, limits=GUARD_LIMITS)
    except GuardedRefusal as refusal:
        raise _refused(refusal.code) from refusal
    except GuardedWorkerError as failure:
        if failure.over_limits and over_limits is not None:
            raise _refused(over_limits) from failure
        _worker_failed(failure.reason)


def _frame(answer: GuardedAnswer, raster: RasterRef, channels: int) -> bytes:
    """The raster's frame, checked against the size the header declares."""
    if raster.frame >= len(answer.frames):
        _worker_failed("missing_frame")
    frame = answer.frames[raster.frame]
    if len(frame) != raster.width * raster.height * channels:
        _worker_failed("frame_size")
    return frame


def _png(rgb: bytes, width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.frombytes("RGB", (width, height), rgb).save(buffer, format="PNG")
    return buffer.getvalue()


def _decode(data: bytes, settings: Settings) -> ImageArray:
    """A photo upload, as the image routes decode one (415, 413, 422)."""
    try:
        return decode_image(data, max_pixels=settings.max_image_pixels)
    except UnsupportedImageError as exc:
        raise ProblemError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, f"document: {exc}") from exc
    except ImageTooLargeError as exc:
        raise ProblemError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, f"document: {exc}") from exc
    except CorruptImageError as exc:
        raise ProblemError(HTTPStatus.UNPROCESSABLE_ENTITY, f"document: {exc}") from exc


def _unsupported() -> NoReturn:
    raise ProblemError(
        HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
        "document: not a PDF or a JPEG, PNG or WebP image",
    )


# --- the analysis --------------------------------------------------------------------------------


def _versions(
    reader: DocumentReader, renderer: str | None = None, parser: str | None = None
) -> DocumentModelVersions:
    return DocumentModelVersions(
        text_detector=reader.detector_version,
        text_recognizer=reader.recognizer_version,
        pdf_renderer=renderer,
        pdf_parser=parser,
    )


def _scan_boxes(lines: Sequence[DocumentOcrLine], page: PageAnswer) -> list[BoundingBox]:
    """The OCR boxes (page raster pixels) in the pixels of the page's scan, when it lies
    square; none otherwise."""
    scan = page.embedded_jpeg
    if scan is None or not scan.axis_aligned:
        return []
    x0, y0, width, height = scan.box
    fx, fy = scan.pixel_width / width, scan.pixel_height / height
    return [
        ((x - x0) * fx, (y - y0) * fy, w * fx, h * fy)
        for x, y, w, h in (line.box for line in lines)
    ]


def _scan_measurements(
    answer: GuardedAnswer, page: PageAnswer, lines: Sequence[DocumentOcrLine], settings: Settings
) -> DocumentImageMeasurements | None:
    scan = page.embedded_jpeg
    if scan is None:
        return None
    if scan.frame >= len(answer.frames):
        _worker_failed("missing_frame")
    jpeg = answer.frames[scan.frame]
    try:
        bgr = decode_image(jpeg, max_pixels=settings.max_image_pixels)
    except ImageDecodeError:
        return None
    return measure_image(jpeg, bgr, _scan_boxes(lines, page))


def _page(
    answer: GuardedAnswer, page: PageAnswer, reader: DocumentReader, budget: RecognitionBudget
) -> tuple[DocumentPage, list[DocumentOcrLine]]:
    raster_ref = page.raster
    if raster_ref.width * raster_ref.height > MAX_ANALYSIS_RASTER_PIXELS:
        _worker_failed("raster_size")
    raster = np.frombuffer(_frame(answer, raster_ref, 1), dtype=np.uint8).reshape(
        raster_ref.height, raster_ref.width
    )
    visible = [line for line in page.text_layer if line.visible]
    agreement = None
    if visible:
        readings = reader.read_regions(raster, [line.box for line in visible], budget)
        ocr = [reading for reading in readings if reading is not None]
        if ocr:
            # The readings cover the lines the budget let the OCR read; a line left unread is
            # not measured, which is not the same as read as nothing (scored 0).
            agreement = text_layer_ocr_agreement(
                [line.text for line in visible[: len(readings)]],
                [None if reading is None else reading.text for reading in readings],
            )
    else:
        ocr = reader.read_document(raster, budget)
    document_page = DocumentPage(
        number=page.number,
        width=raster_ref.width,
        height=raster_ref.height,
        width_pt=page.width_pt,
        height_pt=page.height_pt,
        text_layer=page.text_layer,
        ocr=ocr[:MAX_DOCUMENT_LINES],
        text_layer_ocr_agreement=agreement,
    )
    return document_page, ocr


def _analyze_pdf(
    data: bytes, settings: Settings, reader: DocumentReader, deadline: float
) -> DocumentAnalysis:
    # The same document stops the child the same way every time, so a retry cannot cure it.
    answer = _guarded("analyze_pdf", data, over_limits="pdf_unprocessable")
    try:
        result = PdfAnalysisAnswer.model_validate(answer.header)
        reader.load()
        pages: list[DocumentPage] = []
        image = None
        units = OCR_UNITS_PER_DOCUMENT
        for index, page in enumerate(result.pages):
            budget = RecognitionBudget(units / (len(result.pages) - index), deadline)
            document_page, ocr = _page(answer, page, reader, budget)
            units -= budget.spent
            pages.append(document_page)
            if page.number == 1:
                image = _scan_measurements(answer, page, ocr, settings)
        return DocumentAnalysis(
            model_versions=_versions(
                reader, result.versions.pdf_renderer, result.versions.pdf_parser
            ),
            source="pdf",
            page_count=result.page_count,
            analysed_pages=[page.number for page in result.pages],
            pages=pages,
            pdf=PdfMeasurements.model_validate({**result.pdf, "fonts": result.fonts}),
            image=image,
        )
    except ValidationError as exc:
        logger.warning("guarded analyze_pdf answer did not validate (%d errors)", exc.error_count())
        _worker_failed("malformed_output")


def _analyze_photo(
    data: bytes, settings: Settings, reader: DocumentReader, deadline: float
) -> DocumentAnalysis:
    photo = _decode(data, settings)
    reader.load()
    ocr = reader.read_document(photo, RecognitionBudget(OCR_UNITS_PER_DOCUMENT, deadline))
    height, width = photo.shape[:2]
    page = DocumentPage(
        number=1,
        width=width,
        height=height,
        width_pt=None,
        height_pt=None,
        text_layer=[],
        ocr=ocr[:MAX_DOCUMENT_LINES],
        text_layer_ocr_agreement=None,
    )
    return DocumentAnalysis(
        model_versions=_versions(reader),
        source="image",
        page_count=1,
        analysed_pages=[1],
        pages=[page],
        pdf=None,
        image=measure_image(data, photo, [line.box for line in ocr]),
    )


def analyze_document(data: bytes, settings: Settings, reader: DocumentReader) -> DocumentAnalysis:
    """Every C60.1 measurement of an uploaded PDF or photo, its OCR within
    :data:`OCR_UNITS_PER_DOCUMENT` and :data:`ANALYSIS_DEADLINE_SECONDS`."""
    deadline = time.monotonic() + ANALYSIS_DEADLINE_SECONDS
    kind = sniff_document(data)
    try:
        if kind == "pdf":
            return _analyze_pdf(data, settings, reader, deadline)
        if kind == "image":
            return _analyze_photo(data, settings, reader, deadline)
    except RecognitionDeadlineError:
        logger.warning("document analysis passed its %.0f s deadline", ANALYSIS_DEADLINE_SECONDS)
        _worker_failed("deadline")
    _unsupported()


# --- the preview and the portraits ---------------------------------------------------------------


def _fit(image: ImageArray, side: int) -> ImageArray:
    height, width = image.shape[:2]
    if max(height, width) <= side:
        return image
    scale = side / max(height, width)
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return np.asarray(cv2.resize(image, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


def render_document_page(data: bytes, page: int, settings: Settings) -> bytes:
    """Page ``page`` (1-based) of a PDF or photo as a PNG of at most 1,600 px a side (C60.4); a
    photo has one page."""
    kind = sniff_document(data)
    if kind is None:
        _unsupported()
    if kind == "image":
        photo = _decode(data, settings)
        if page != 1:
            raise ProblemError(HTTPStatus.UNPROCESSABLE_ENTITY, "document: a photo has one page")
        rgb = cv2.cvtColor(_fit(photo, RENDER_MAX_SIDE_PX), cv2.COLOR_BGR2RGB)
        return _png(rgb.tobytes(), rgb.shape[1], rgb.shape[0])
    answer = _guarded("render_pdf_page", data, {"page": page, "max_side": RENDER_MAX_SIDE_PX})
    return _rgb_png(answer, RenderAnswer, RENDER_MAX_SIDE_PX)


def _rgb_png(
    answer: GuardedAnswer, model: type[RenderAnswer] | type[PortraitAnswer], side: int
) -> bytes:
    raster = _rgb_raster(answer, model, side)
    return _png(_frame(answer, raster, 3), raster.width, raster.height)


def _rgb_raster(
    answer: GuardedAnswer, model: type[RenderAnswer] | type[PortraitAnswer], side: int
) -> RasterRef:
    try:
        raster = model.model_validate(answer.header).raster
    except ValidationError:
        _worker_failed("malformed_output")
    if raster.width > side or raster.height > side:
        _worker_failed("raster_size")
    return raster


def convert_portrait(data: bytes, settings: Settings) -> bytes:
    """A chip portrait (JPEG, JP2 or J2K, at most 4 MP) as a PNG of at most 640 px a side."""
    del settings  # the 4 MP bound of C60.4 is the contract's, not the upload's
    params: dict[str, object] = {
        "max_side": PORTRAIT_MAX_SIDE_PX,
        "max_pixels": JPEG2000_MAX_PIXELS,
    }
    answer = _guarded("decode_portrait", data, params)
    return _rgb_png(answer, PortraitAnswer, PORTRAIT_MAX_SIDE_PX)


def decode_chip_portrait(data: bytes, settings: Settings) -> ImageArray:
    """A chip portrait (JPEG, JP2 or J2K, at most 4 MP) decoded through the guarded child, as
    BGR for the face engine."""
    del settings
    answer = _guarded(
        "decode_portrait", data, {"max_side": None, "max_pixels": JPEG2000_MAX_PIXELS}
    )
    raster = _rgb_raster(answer, PortraitAnswer, JPEG2000_MAX_PIXELS)
    if raster.width * raster.height > JPEG2000_MAX_PIXELS:
        _worker_failed("raster_size")
    rgb = np.frombuffer(_frame(answer, raster, 3), dtype=np.uint8).reshape(
        raster.height, raster.width, 3
    )
    return np.ascontiguousarray(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), dtype=np.uint8)
