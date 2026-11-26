"""C60.1, C60.4: the document analysis assembled in the parent, the page render, the portrait
conversion and the chip portrait decode.

Every PDF and JPEG 2000 goes through a real guarded child; the OCR is a fake reader (the real
models are exercised in ``test_document_ocr.py`` and the benchmark).
"""

from __future__ import annotations

import io
import time
from collections.abc import Sequence
from dataclasses import dataclass, field, replace

import numpy as np
import pytest
from PIL import Image

import document_pdfs as pdfs
import ocr_fakes
from minimal_pdf import document
from openverify_vision import document_analysis
from openverify_vision.document_analysis import (
    analyze_document,
    convert_portrait,
    decode_chip_portrait,
    render_document_page,
    sniff_document,
)
from openverify_vision.guarded import DEFAULT_LIMITS, GuardLimits
from openverify_vision.guarded.runner import GuardedAnswer, GuardedWorkerError
from openverify_vision.imaging import ImageArray
from openverify_vision.ocr.recognition import RecognitionBudget
from openverify_vision.problems import ProblemError
from openverify_vision.schemas import (
    GUARDED_WORKER_FAILED,
    BoundingBox,
    DocumentAnalysis,
    DocumentOcrLine,
)
from openverify_vision.settings import Settings

SETTINGS = Settings.model_validate({"service_token": "s" * 40})


@dataclass
class FakeReader:
    """Reads each box as the text it is told, else a fixed line, and records what it read."""

    texts: dict[int, str] = field(default_factory=dict)
    """The reading of the n-th box asked for; the box's index otherwise."""
    page_lines: tuple[str, ...] = ("UTOPIA WATER BOARD", "Amount due: 48.20")
    available: bool = True
    shapes: list[tuple[int, ...]] = field(default_factory=list)
    budgets: list[RecognitionBudget | None] = field(default_factory=list)
    """The budget each read was given."""
    read_limit: int | None = None
    """Read only this many boxes (a prefix), as a spent budget leaves the rest unread."""
    spend: float = 0.0
    """The units each read spends from its budget."""

    def _spend(self, budget: RecognitionBudget | None) -> None:
        self.budgets.append(None if budget is None else replace(budget))
        if budget is not None:
            budget.spent += self.spend

    def load(self) -> bool:
        return self.available

    @property
    def detector_version(self) -> str | None:
        return "fake-det" if self.available else None

    @property
    def recognizer_version(self) -> str | None:
        return "fake-rec" if self.available else None

    def read_document(
        self, img: ImageArray, budget: RecognitionBudget | None = None
    ) -> list[DocumentOcrLine]:
        self.shapes.append(img.shape)
        self._spend(budget)
        if not self.available:
            return []
        return [
            DocumentOcrLine(text=text, confidence=0.95, box=(40.0, 40.0 + 60 * i, 400.0, 40.0))
            for i, text in enumerate(self.page_lines)
        ]

    def read_regions(
        self,
        img: ImageArray,
        boxes: Sequence[BoundingBox],
        budget: RecognitionBudget | None = None,
    ) -> list[DocumentOcrLine | None]:
        self.shapes.append(img.shape)
        self._spend(budget)
        if not self.available:
            return []
        return [
            DocumentOcrLine(text=self.texts.get(i, f"line {i}"), confidence=0.9, box=box)
            for i, box in enumerate(boxes[: self.read_limit])
        ]


def echo_reader() -> FakeReader:
    """Reads every box of the bill as its own text-layer line."""
    return FakeReader(texts={i: item.text for i, item in enumerate(pdfs.BILL_LINES)})


def problem(caught: pytest.ExceptionInfo[ProblemError]) -> tuple[int, str | None]:
    return caught.value.status, caught.value.code


def photo(width: int = 1200, height: int = 1600, fmt: str = "JPEG") -> bytes:
    image = Image.new("RGB", (width, height), (236, 234, 228))
    image.paste((40, 40, 48), (100, 200, 900, 240))
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, quality=88)
    return buffer.getvalue()


# --- sniffing ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "kind"),
    [
        (b"%PDF-1.7\n", "pdf"),
        (b"\n" * 900 + b"%PDF-1.4\n", "pdf"),
        (b"\n" * 1100 + b"%PDF-1.4\n", None),
        (b"\xff\xd8\xff\xe0 %PDF-1.7", "image"),
        (b"\x89PNG\r\n\x1a\n", "image"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image"),
        (b"GIF89a", None),
    ],
    ids=["pdf", "pdf-late-header", "header-too-late", "jpeg-first", "png", "webp", "gif"],
)
def test_a_document_is_sniffed_as_the_api_sniffs_it(data: bytes, kind: str | None) -> None:
    assert sniff_document(data) == kind


# --- a born-digital PDF --------------------------------------------------------------------------


def test_a_bill_pdf_is_analysed_into_the_contract() -> None:
    reader = echo_reader()
    analysis = analyze_document(pdfs.bill(), SETTINGS, reader)
    assert isinstance(analysis, DocumentAnalysis)
    assert (analysis.source, analysis.page_count, analysis.analysed_pages) == ("pdf", 1, [1])
    page = analysis.pages[0]
    assert (page.width, page.height, page.width_pt, page.height_pt) == (1700, 2200, 612.0, 792.0)
    assert [line.text for line in page.text_layer] == [item.text for item in pdfs.BILL_LINES]
    # Each visible line's box was read on the grey raster: the OCR is one reading per line.
    assert [line.text for line in page.ocr] == [item.text for item in pdfs.BILL_LINES]
    assert reader.shapes == [(2200, 1700)]
    assert page.text_layer_ocr_agreement == 1.0
    assert analysis.pdf is not None
    assert analysis.pdf.producer == "Utopia Billing 4.2"
    assert [font.base_name for font in analysis.pdf.fonts] == ["Helvetica", "Courier"]
    assert analysis.image is None
    assert analysis.model_versions.model_dump() == {
        "text_detector": "fake-det",
        "text_recognizer": "fake-rec",
        "pdf_renderer": "pdfium-156.0.8076.0",
        "pdf_parser": "pypdf-6.21.4",
    }


def test_a_rendered_amount_that_differs_from_the_text_layer_lowers_the_agreement() -> None:
    reader = echo_reader()
    reader.texts[6] = "Amount due: 98.70"
    page = analyze_document(pdfs.bill(), SETTINGS, reader).pages[0]
    assert page.text_layer_ocr_agreement is not None
    assert 0.8 < page.text_layer_ocr_agreement < 1.0


def test_each_page_is_read_within_its_share_of_the_documents_ocr_budget() -> None:
    # Workflow 5C review P009: an equal share of what is left for each page still to read,
    # so what one page leaves goes to the next, and one shared deadline.
    reader = FakeReader(spend=100.0)
    started = time.monotonic()
    analyze_document(pdfs.many_pages(4), SETTINGS, reader)
    budgets = [budget for budget in reader.budgets if budget is not None]
    assert len(budgets) == len(reader.budgets) == 4
    total = document_analysis.OCR_UNITS_PER_DOCUMENT
    assert [budget.units for budget in budgets] == pytest.approx(
        [total / 4, (total - 100) / 3, (total - 200) / 2, total - 300]
    )
    deadlines = {budget.deadline for budget in budgets}
    assert len(deadlines) == 1
    (deadline,) = deadlines
    assert deadline is not None
    assert (
        started + 39.0 < deadline < time.monotonic() + document_analysis.ANALYSIS_DEADLINE_SECONDS
    )


def test_a_photo_is_read_within_the_documents_ocr_budget() -> None:
    reader = FakeReader()
    analyze_document(photo(), SETTINGS, reader)
    (budget,) = reader.budgets
    assert budget is not None
    assert budget.units == document_analysis.OCR_UNITS_PER_DOCUMENT


def test_lines_the_budget_left_unread_do_not_count_in_the_agreement() -> None:
    reader = echo_reader()
    reader.read_limit = 3
    page = analyze_document(pdfs.bill(), SETTINGS, reader).pages[0]
    assert [line.text for line in page.ocr] == [item.text for item in pdfs.BILL_LINES[:3]]
    # Not read is not read as nothing: the three lines read agree, the rest are not measured.
    assert page.text_layer_ocr_agreement == 1.0


def test_an_analysis_past_its_deadline_answers_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(document_analysis, "ANALYSIS_DEADLINE_SECONDS", 0.0)
    engine, _, recognizer = ocr_fakes.engine()
    with pytest.raises(ProblemError) as caught:
        analyze_document(pdfs.bill(), SETTINGS, engine)
    assert problem(caught) == (503, GUARDED_WORKER_FAILED)
    assert recognizer.rows == 0


def test_without_the_text_models_the_ocr_is_not_measured() -> None:
    analysis = analyze_document(pdfs.bill(), SETTINGS, FakeReader(available=False))
    page = analysis.pages[0]
    assert (page.ocr, page.text_layer_ocr_agreement) == ([], None)
    assert analysis.model_versions.text_detector is None
    assert analysis.model_versions.text_recognizer is None


def test_hidden_lines_are_reported_but_never_read_by_the_ocr() -> None:
    reader = FakeReader()
    page = analyze_document(pdfs.hidden_variants(), SETTINGS, reader).pages[0]
    visible = [line.text for line in page.text_layer if line.visible]
    assert visible == ["Visible heading line", "White on dark band", "Black after the band"]
    assert len(page.ocr) == len(visible)


def test_a_scanned_pdf_is_read_by_the_ocr_and_its_jpeg_measured() -> None:
    reader = FakeReader()
    analysis = analyze_document(pdfs.scanned(pdfs.jpeg_bytes(quality=85)), SETTINGS, reader)
    page = analysis.pages[0]
    assert page.text_layer == []
    assert [line.text for line in page.ocr] == list(reader.page_lines)
    assert page.text_layer_ocr_agreement is None
    assert analysis.image is not None
    assert analysis.image.jpeg_quality == 85
    assert analysis.image.copy_move_score is not None


def test_fifty_pages_analyse_four() -> None:
    analysis = analyze_document(pdfs.many_pages(50), SETTINGS, FakeReader())
    assert analysis.analysed_pages == [1, 2, 3, 50]
    assert [page.number for page in analysis.pages] == [1, 2, 3, 50]


# --- a photo -------------------------------------------------------------------------------------


def test_a_photo_of_a_bill_is_one_page_without_a_text_layer() -> None:
    reader = FakeReader()
    analysis = analyze_document(photo(), SETTINGS, reader)
    assert (analysis.source, analysis.page_count, analysis.pdf) == ("image", 1, None)
    page = analysis.pages[0]
    assert (page.width, page.height, page.width_pt, page.height_pt) == (1200, 1600, None, None)
    assert page.text_layer == []
    assert [line.text for line in page.ocr] == list(reader.page_lines)
    assert analysis.image is not None
    assert analysis.image.jpeg_quality == 88
    assert analysis.model_versions.pdf_renderer is None
    assert analysis.model_versions.pdf_parser is None


def test_a_png_photo_has_no_jpeg_measurements() -> None:
    analysis = analyze_document(photo(fmt="PNG"), SETTINGS, FakeReader())
    assert analysis.image is not None
    assert analysis.image.jpeg_quality is None


# --- refusals ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (pdfs.encrypted("user-secret"), (422, "pdf_encrypted")),
        (pdfs.many_pages(51), (422, "too_many_pages")),
        (pdfs.oversized_page(), (422, "pdf_unprocessable")),
        (b"%PDF-1.7\nnot a document", (422, "pdf_unprocessable")),
        (b"GIF89a not accepted", (415, None)),
        (photo(400, 300, "PNG")[:542], (422, None)),
    ],
    ids=["encrypted", "too-many-pages", "oversized", "unreadable", "gif", "corrupt-png"],
)
def test_a_refused_document_answers_its_problem(
    data: bytes, expected: tuple[int, str | None]
) -> None:
    with pytest.raises(ProblemError) as caught:
        analyze_document(data, SETTINGS, FakeReader())
    assert problem(caught) == expected


def test_a_photo_over_the_pixel_limit_is_too_large() -> None:
    settings = Settings.model_validate({"service_token": "s" * 40, "max_image_pixels": 1000})
    with pytest.raises(ProblemError) as caught:
        analyze_document(photo(), settings, FakeReader())
    assert problem(caught) == (413, None)


def test_a_document_bomb_is_refused_as_unprocessable() -> None:
    with pytest.raises(ProblemError) as caught:
        analyze_document(pdfs.content_bomb(), SETTINGS, FakeReader())
    assert problem(caught) == (422, "pdf_unprocessable")


def heavy() -> bytes:
    """A page of a million line segments: within pypdf's caps, but seconds of PDFium work."""
    return document([b"0 0 m 600 780 l S\n" * 1_000_000]).data


@pytest.mark.parametrize(
    ("limits", "data"),
    [
        (GuardLimits(cpu_seconds=1), heavy()),
        (DEFAULT_LIMITS, pdfs.text_operator_bomb()),  # PDFium aborts out of address space
        (GuardLimits(output_bytes=1024 * 1024), pdfs.bill()),  # a 3.7 MB grey raster
    ],
    ids=["cpu", "memory", "output"],
)
def test_a_document_that_takes_the_child_past_its_limits_is_unprocessable(
    monkeypatch: pytest.MonkeyPatch, limits: GuardLimits, data: bytes
) -> None:
    # Workflow 5C review P003: the same document stops the child the same way every time, so a
    # retry cannot cure it; it is the user's to replace (422), not an outage (503).
    monkeypatch.setattr(document_analysis, "GUARD_LIMITS", limits)
    with pytest.raises(ProblemError) as caught:
        analyze_document(data, SETTINGS, FakeReader())
    assert problem(caught) == (422, "pdf_unprocessable")


@pytest.mark.parametrize(
    "failure",
    [
        GuardedWorkerError("timeout"),
        GuardedWorkerError("spawn_failed"),
        GuardedWorkerError("exit_status"),
        GuardedWorkerError("malformed_output"),
    ],
    ids=["kill-timer", "spawn", "own-error", "malformed"],
)
def test_a_child_that_failed_for_another_reason_answers_503(
    monkeypatch: pytest.MonkeyPatch, failure: GuardedWorkerError
) -> None:
    def failing(*_args: object, **_kwargs: object) -> GuardedAnswer:
        raise failure

    monkeypatch.setattr(document_analysis, "run_guarded", failing)
    with pytest.raises(ProblemError) as caught:
        analyze_document(pdfs.bill(), SETTINGS, FakeReader())
    assert problem(caught) == (503, GUARDED_WORKER_FAILED)


def test_a_page_render_past_the_childs_limits_still_answers_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The render and the portraits keep 503: only the analysis refuses a document that defeats
    # the guard (P003).
    monkeypatch.setattr(document_analysis, "GUARD_LIMITS", GuardLimits(output_bytes=1024))
    with pytest.raises(ProblemError) as caught:
        render_document_page(pdfs.bill(), 1, SETTINGS)
    assert problem(caught) == (503, GUARDED_WORKER_FAILED)


def test_a_malformed_child_answer_answers_503(monkeypatch: pytest.MonkeyPatch) -> None:
    def malformed(*_args: object, **_kwargs: object) -> GuardedAnswer:
        return GuardedAnswer(header={"ok": True, "page_count": 1, "pages": []}, frames=())

    monkeypatch.setattr(document_analysis, "run_guarded", malformed)
    with pytest.raises(ProblemError) as caught:
        analyze_document(pdfs.bill(), SETTINGS, FakeReader())
    assert problem(caught) == (503, GUARDED_WORKER_FAILED)


def test_a_raster_shorter_than_declared_answers_503(monkeypatch: pytest.MonkeyPatch) -> None:
    real = document_analysis.run_guarded

    def cut(*args: object, **kwargs: object) -> GuardedAnswer:
        answer = real(*args, **kwargs)  # type: ignore[arg-type]
        return GuardedAnswer(header=answer.header, frames=(answer.frames[0][:-1],))

    monkeypatch.setattr(document_analysis, "run_guarded", cut)
    with pytest.raises(ProblemError) as caught:
        analyze_document(pdfs.bill(), SETTINGS, FakeReader())
    assert problem(caught) == (503, GUARDED_WORKER_FAILED)


# --- the preview ---------------------------------------------------------------------------------


def png_size(data: bytes) -> tuple[int, int]:
    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    with Image.open(io.BytesIO(data)) as image:
        assert image.mode == "RGB"
        return image.size


def test_a_pdf_page_preview_is_a_png_of_at_most_1600_px() -> None:
    assert png_size(render_document_page(pdfs.bill(), 1, SETTINGS)) == (1236, 1600)


def test_a_photo_preview_is_scaled_down_to_1600_px() -> None:
    assert png_size(render_document_page(photo(3000, 2000), 1, SETTINGS)) == (1600, 1067)
    assert png_size(render_document_page(photo(800, 600), 1, SETTINGS)) == (800, 600)


@pytest.mark.parametrize(("data", "page"), [(pdfs.bill(), 2), (photo(), 2)], ids=["pdf", "photo"])
def test_a_page_beyond_the_document_is_422(data: bytes, page: int) -> None:
    with pytest.raises(ProblemError) as caught:
        render_document_page(data, page, SETTINGS)
    assert problem(caught) == (422, None)


def test_the_preview_refuses_an_encrypted_pdf() -> None:
    with pytest.raises(ProblemError) as caught:
        render_document_page(pdfs.encrypted("user-secret"), 1, SETTINGS)
    assert problem(caught) == (422, "pdf_encrypted")


# --- chip portraits ------------------------------------------------------------------------------


def portrait(fmt: str, width: int = 480, height: int = 600) -> bytes:
    image = Image.new("RGB", (width, height), (150, 120, 100))
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


@pytest.mark.parametrize("fmt", ["JPEG", "JPEG2000"])
def test_a_chip_portrait_converts_to_a_png_of_at_most_640_px(fmt: str) -> None:
    assert png_size(convert_portrait(portrait(fmt), SETTINGS)) == (480, 600)
    assert png_size(convert_portrait(portrait(fmt, 900, 1200), SETTINGS)) == (480, 640)


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (portrait("PNG"), (415, None)),
        (portrait("JPEG2000", 2100, 2000), (413, None)),
        (portrait("JPEG")[:2500], (422, None)),
    ],
    ids=["png", "over-4-mp", "cut"],
)
def test_a_refused_portrait_answers_its_problem(
    data: bytes, expected: tuple[int, str | None]
) -> None:
    with pytest.raises(ProblemError) as caught:
        convert_portrait(data, SETTINGS)
    assert problem(caught) == expected


def test_a_chip_portrait_decodes_to_bgr_for_the_face_engine() -> None:
    image = decode_chip_portrait(portrait("JPEG2000", 96, 120), SETTINGS)
    assert image.shape == (120, 96, 3)
    assert image.dtype == np.uint8
    # BGR: the portrait's red 150 is the last channel.
    assert tuple(int(v) for v in image[0, 0]) == (100, 120, 150)
