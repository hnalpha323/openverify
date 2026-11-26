"""C60.2: the hostile set, end to end through ``analyze_document`` and a real guarded child.

The plan names each case: entity expansion, an external entity, a 10 MB XMP packet, a
decompression bomb, runaway pages, a page box over 14,400 pt, a JPEG 2000 above 4 MP, a child
that exceeds its memory or CPU, and the child's imports (``test_guarded.py``). Every input is
built here (V19); each must end in a bounded answer, never a hang or a crash of this process.
"""

from __future__ import annotations

import re
import time
from collections.abc import Sequence
from typing import Any

import pytest

import document_pdfs as pdfs
import ocr_fakes
from minimal_pdf import MinimalPdf, Text, content, document, stream
from openverify_vision import document_analysis
from openverify_vision.document_analysis import analyze_document, convert_portrait
from openverify_vision.guarded import GuardLimits
from openverify_vision.imaging import ImageArray
from openverify_vision.ocr.recognition import RecognitionBudget
from openverify_vision.problems import ProblemError
from openverify_vision.schemas import GUARDED_WORKER_FAILED, BoundingBox, DocumentOcrLine
from openverify_vision.settings import Settings
from test_guarded_images import j2k_header

SETTINGS = Settings.model_validate({"service_token": "s" * 40})
BUDGET_SECONDS = 20.0
"""Every hostile input is answered well within the 30 s kill timer."""


class NoOcr:
    """A reader without models: the hostile cases are about parsing, not reading."""

    def load(self) -> bool:
        return False

    @property
    def detector_version(self) -> str | None:
        return None

    @property
    def recognizer_version(self) -> str | None:
        return None

    def read_document(
        self, img: ImageArray, budget: RecognitionBudget | None = None
    ) -> list[DocumentOcrLine]:
        del img, budget
        return []

    def read_regions(
        self,
        img: ImageArray,
        boxes: Sequence[BoundingBox],
        budget: RecognitionBudget | None = None,
    ) -> list[DocumentOcrLine | None]:
        del img, boxes, budget
        return []


def with_metadata(packet: bytes) -> bytes:
    meta = stream(packet, b"/Type /Metadata /Subtype /XML", compress=False)
    return document(
        [content([Text(72, 700, "Statement date: 30 September 2026")])],
        extra_objects=[meta],
        catalog_extra=b" /Metadata 7 0 R",
    ).data


def timed_problem(data: bytes) -> tuple[int, str | None]:
    started = time.monotonic()
    with pytest.raises(ProblemError) as caught:
        analyze_document(data, SETTINGS, NoOcr())
    assert time.monotonic() - started < BUDGET_SECONDS
    return caught.value.status, caught.value.code


@pytest.mark.parametrize(
    "declaration",
    [
        b'<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">'
        b'<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]>',
        b'<!DOCTYPE x [<!ENTITY ext SYSTEM "http://198.51.100.7/collect">]>',
    ],
    ids=["entity-expansion", "external-entity"],
)
def test_an_xmp_packet_declaring_entities_is_refused_and_the_rest_measured(
    declaration: bytes,
) -> None:
    packet = declaration + b'<x:xmpmeta><rdf:Description xmp:CreatorTool="&c;&ext;"/></x:xmpmeta>'
    analysis = analyze_document(with_metadata(packet), SETTINGS, NoOcr())
    assert analysis.pdf is not None
    assert analysis.pdf.xmp is None
    assert analysis.pages[0].text_layer[0].text == "Statement date: 30 September 2026"


def test_a_10_mb_xmp_packet_is_read_only_up_to_its_bound() -> None:
    packet = (
        b'<x:xmpmeta><rdf:Description xmp:CreatorTool="Utopia Billing 4.2"/>'
        + b" " * (10 * 1000 * 1000)
        + b"<pdf:Producer>Beyond the bound</pdf:Producer></x:xmpmeta>"
    )
    started = time.monotonic()
    analysis = analyze_document(with_metadata(packet), SETTINGS, NoOcr())
    assert time.monotonic() - started < BUDGET_SECONDS
    assert analysis.pdf is not None
    assert analysis.pdf.xmp is not None
    assert (analysis.pdf.xmp.creator_tool, analysis.pdf.xmp.producer) == (
        "Utopia Billing 4.2",
        None,
    )


def test_a_decompression_bomb_is_refused() -> None:
    assert timed_problem(pdfs.content_bomb()) == (422, "pdf_unprocessable")


def test_a_page_tree_of_more_than_fifty_pages_is_refused() -> None:
    assert timed_problem(pdfs.many_pages(51)) == (422, "too_many_pages")


def test_a_page_tree_that_claims_a_million_pages_is_refused() -> None:
    pdf = MinimalPdf()
    pages = pdf.add(b"<< /Type /Pages /Kids [2 0 R] /Count 1000000 >>")
    pdf.add(b"<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] >>")
    catalog = pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>".encode())
    assert timed_problem(pdf.build(root=catalog)) == (422, "too_many_pages")


def test_a_page_tree_that_loops_is_refused_as_unprocessable() -> None:
    # The tree claims two pages; the second is the tree itself, which no reader can load.
    pdf = MinimalPdf()
    pages = pdf.add(b"<< /Type /Pages /Kids [1 0 R 2 0 R] /Count 2 >>")
    pdf.add(b"<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] >>")
    catalog = pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>".encode())
    assert timed_problem(pdf.build(root=catalog)) == (422, "pdf_unprocessable")


def test_a_page_box_over_14400_pt_is_refused() -> None:
    assert timed_problem(pdfs.oversized_page()) == (422, "pdf_unprocessable")


def test_a_jpeg_2000_portrait_above_4_mp_is_refused() -> None:
    with pytest.raises(ProblemError) as caught:
        convert_portrait(j2k_header(4000, 4000), SETTINGS)
    assert caught.value.status == 413


def test_a_child_over_its_cpu_time_is_refused_as_unprocessable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Workflow 5C review P003: a retry would only stop the child the same way again.
    heavy = document([b"0 0 m 600 780 l S\n" * 1_000_000]).data
    monkeypatch.setattr(document_analysis, "GUARD_LIMITS", GuardLimits(cpu_seconds=1))
    assert timed_problem(heavy) == (422, "pdf_unprocessable")


def test_a_document_that_exhausts_the_childs_address_space_is_refused_as_unprocessable() -> None:
    # 28 KB that PDFium cannot hold in the production 1.5 GiB: it aborts, every time.
    assert timed_problem(pdfs.text_operator_bomb()) == (422, "pdf_unprocessable")


def test_a_child_past_the_kill_timer_answers_503(monkeypatch: pytest.MonkeyPatch) -> None:
    heavy = document([b"0 0 m 600 780 l S\n" * 1_000_000]).data
    monkeypatch.setattr(document_analysis, "GUARD_LIMITS", GuardLimits(wall_seconds=0.3))
    assert timed_problem(heavy) == (503, GUARDED_WORKER_FAILED)


def test_escaped_javascript_names_are_still_counted() -> None:
    data = pdfs.with_open_action(b"<< /S /J#61v#61Script /J#53 (app.alert(1)) >>")
    analysis = analyze_document(data, SETTINGS, NoOcr())
    assert analysis.pdf is not None
    assert analysis.pdf.actions.javascript == 1


def test_an_invisible_recent_date_on_an_old_bill_is_reported_hidden() -> None:
    # H10: the old bill's visible date and a recent one in render mode 3 over it.
    data = document(
        [
            content(
                [
                    Text(72, 700, "Statement date: 30 January 2024"),
                    Text(72, 700, "Statement date: 30 September 2026", render_mode=3),
                ]
            )
        ]
    ).data
    lines = analyze_document(data, SETTINGS, NoOcr()).pages[0].text_layer
    reasons = {line.text: line.hidden_reason for line in lines}
    assert reasons == {
        "Statement date: 30 January 2024": None,
        "Statement date: 30 September 2026": "render_mode_invisible",
    }


# --- the OCR's cost (Workflow 5C review P009) ---------------------------------------------------

DENSE_LINES_PER_PAGE = 600
"""The most visible lines the text layer reports on a page (C60.1)."""

RECOGNIZER_SECONDS_PER_UNIT = 0.002
"""The real recognizer's wall time for one unit (a line height of its input width), measured on
the development machine's 12 threads (Workflow 5C review P009); the fake one sleeps as long."""


def dense_page() -> bytes:
    """Three columns of 3.2 pt lines: each is visible (at least 2 pt high) and asks the OCR for
    one recognition."""
    columns, rows = 3, DENSE_LINES_PER_PAGE // 3
    return content(
        [
            Text(
                20 + 195 * column,
                780 - 3.7 * row,
                f"Row {column}-{row:03d} usage 1234.56 kWh",
                size=3.2,
            )
            for column in range(columns)
            for row in range(rows)
        ]
    )


def test_a_dense_pdf_is_read_within_the_ocr_budget_and_in_bounded_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A few KB of PDF: four analysed pages of 600 visible lines. Before the budget, the OCR read
    # all 2,400 boxes, one recognition each, about 50 s with the real models.
    data = document([dense_page()] * 4).data
    engine, _, recognizer = ocr_fakes.engine()
    recognizer.seconds_per_unit = RECOGNIZER_SECONDS_PER_UNIT
    reading = 0.0
    read_regions = engine.read_regions

    def timed(*args: Any, **kwargs: Any) -> list[DocumentOcrLine | None]:
        nonlocal reading
        started = time.monotonic()
        try:
            return read_regions(*args, **kwargs)
        finally:
            reading += time.monotonic() - started

    monkeypatch.setattr(engine, "read_regions", timed)
    analysis = analyze_document(data, SETTINGS, engine)
    assert len(data) < 32 * 1024
    assert [sum(line.visible for line in page.text_layer) for page in analysis.pages] == [
        DENSE_LINES_PER_PAGE
    ] * 4
    assert recognizer.units <= document_analysis.OCR_UNITS_PER_DOCUMENT
    assert all(page.ocr for page in analysis.pages)  # every page has its share
    # The wall time of the reading itself, the child's share left out (it varies with the
    # host's load): the budget's 2,400 units at 2 ms are about 5 s, where the 18,438 units of
    # all 2,400 boxes slept 37 s.
    assert reading < BUDGET_SECONDS


# --- numbers no PDF needs (Workflow 5C review P017) ---------------------------------------------


@pytest.mark.parametrize(
    "data",
    [
        re.sub(rb"/Length (\d+)", b"/Length 9223372036854775808", pdfs.bill(), count=1),
        pdfs.bill().replace(b"/Producer", b"/Pad " + b"9" * 4_400 + b" /Producer", 1),
    ],
    ids=["length-past-2-63", "4400-digit-integer"],
)
def test_a_number_past_what_python_converts_is_answered_not_a_crash(data: bytes) -> None:
    # Before, the scanner raised (OverflowError, ValueError) and the child exited 1: a 503 the
    # job retried. PDFium reads both files; so does the analysis now.
    analysis = analyze_document(data, SETTINGS, NoOcr())
    assert analysis.pages[0].text_layer
