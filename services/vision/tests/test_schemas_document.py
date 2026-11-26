"""C60.1, C60.4: the document analysis contract (Workflow 5B Stage 1).

The golden fixtures (a born-digital PDF bill and a photo of one) validate and round-trip; each
model refuses what the contract rules out. Values are synthetic: a fictional water board, holder
and town (C65.1).
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from openverify_vision.background import MAX_COMPARE_LONG_SIDE
from openverify_vision.schemas import (
    DOCUMENT_PROBLEM_CODES,
    GUARDED_WORKER_FAILED,
    JPEG2000_MAX_PIXELS,
    MAX_ANALYSED_PAGES,
    MAX_DOCUMENT_LINE_LENGTH,
    MAX_DOCUMENT_LINES,
    MAX_DOCUMENT_PAGES,
    MAX_PAGE_SIDE_PT,
    PORTRAIT_MAX_SIDE_PX,
    RENDER_MAX_SIDE_PX,
    DocumentAnalysis,
    VisionPngLimits,
    analysed_page_numbers,
)

FIXTURES = Path(__file__).resolve().parents[3] / "contracts" / "fixtures" / "vision"


def fixture(name: str) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return loaded


def pdf_document() -> dict[str, Any]:
    return fixture("analyze-document-pdf.json")


def image_document() -> dict[str, Any]:
    return fixture("analyze-document-image.json")


def refuses(document: dict[str, Any]) -> str:
    with pytest.raises(ValidationError) as caught:
        DocumentAnalysis.model_validate(document)
    return str(caught.value)


def test_the_limits_are_the_plans() -> None:
    assert MAX_DOCUMENT_PAGES == 50
    assert MAX_ANALYSED_PAGES == 4
    assert (MAX_DOCUMENT_LINES, MAX_DOCUMENT_LINE_LENGTH) == (600, 300)
    assert MAX_PAGE_SIDE_PT == 14_400
    assert (RENDER_MAX_SIDE_PX, PORTRAIT_MAX_SIDE_PX, JPEG2000_MAX_PIXELS) == (1600, 640, 4_000_000)
    assert DOCUMENT_PROBLEM_CODES == ("pdf_encrypted", "pdf_unprocessable", "too_many_pages")
    assert GUARDED_WORKER_FAILED == "guarded_worker_failed"


@pytest.mark.parametrize(
    ("count", "pages"),
    [
        (1, [1]),
        (2, [1, 2]),
        (3, [1, 2, 3]),
        (4, [1, 2, 3, 4]),
        (5, [1, 2, 3, 5]),
        (50, [1, 2, 3, 50]),
    ],
)
def test_the_analysed_pages_are_the_first_three_and_the_last(count: int, pages: list[int]) -> None:
    assert analysed_page_numbers(count) == pages


@pytest.mark.parametrize("name", ["analyze-document-pdf.json", "analyze-document-image.json"])
def test_the_golden_documents_round_trip(name: str) -> None:
    text = (FIXTURES / name).read_text(encoding="utf-8")

    parsed = DocumentAnalysis.model_validate_json(text, strict=True)

    assert parsed.model_dump(mode="json") == json.loads(text)


def test_the_png_limits_fixture_names_the_bounds() -> None:
    limits = VisionPngLimits.model_validate(fixture("png-limits.json"))
    assert limits.render_document_page_max_side_px == RENDER_MAX_SIDE_PX
    assert limits.convert_portrait_max_side_px == PORTRAIT_MAX_SIDE_PX
    assert limits.mask_background_max_side_px == MAX_COMPARE_LONG_SIDE
    assert limits.jpeg2000_max_pixels == JPEG2000_MAX_PIXELS


def test_an_unknown_member_is_refused() -> None:
    document = pdf_document()
    document["verdict"] = "genuine"
    assert "verdict" in refuses(document)


def test_more_than_fifty_pages_is_refused() -> None:
    document = pdf_document()
    document["page_count"] = 51
    refuses(document)


def test_the_analysed_pages_must_be_the_first_three_and_the_last() -> None:
    document = pdf_document()
    document["page_count"] = 6
    assert "first three pages and the last" in refuses(document)


def test_pages_must_follow_the_analysed_pages() -> None:
    document = pdf_document()
    document["pages"] = list(reversed(document["pages"]))
    assert "one entry per analysed page" in refuses(document)


def test_a_pdf_needs_its_pdf_measurements_and_a_photo_has_none() -> None:
    pdf = pdf_document()
    pdf["pdf"] = None
    assert "source is a PDF" in refuses(pdf)
    image = image_document()
    image["pdf"] = pdf_document()["pdf"]
    assert "source is a PDF" in refuses(image)


def test_a_photo_is_one_page_without_a_text_layer_or_page_box() -> None:
    image = image_document()
    image["pages"][0]["text_layer"] = copy.deepcopy(pdf_document()["pages"][0]["text_layer"][:1])
    assert "without a text layer" in refuses(image)
    boxed = image_document()
    boxed["pages"][0]["width_pt"] = 612.0
    boxed["pages"][0]["height_pt"] = 792.0
    assert "page box" in refuses(boxed)


def test_a_hidden_line_names_why_and_a_visible_one_does_not() -> None:
    document = pdf_document()
    line = document["pages"][0]["text_layer"][0]
    line["hidden_reason"] = "covered"
    assert "hidden_reason" in refuses(document)
    other = pdf_document()
    hidden = next(item for item in other["pages"][0]["text_layer"] if item["visible"] is False)
    hidden["hidden_reason"] = None
    assert "hidden_reason" in refuses(other)


def test_text_is_capped_per_line_and_per_page() -> None:
    long_line = pdf_document()
    long_line["pages"][0]["ocr"][0]["text"] = "X" * (MAX_DOCUMENT_LINE_LENGTH + 1)
    refuses(long_line)
    many = pdf_document()
    line = many["pages"][0]["ocr"][0]
    many["pages"][0]["ocr"] = [line] * (MAX_DOCUMENT_LINES + 1)
    refuses(many)


def test_a_page_box_over_14400_points_is_refused() -> None:
    document = pdf_document()
    document["pages"][0]["width_pt"] = MAX_PAGE_SIDE_PT + 1
    refuses(document)


def test_agreement_needs_both_a_text_layer_and_ocr() -> None:
    document = image_document()
    document["pages"][0]["text_layer_ocr_agreement"] = 0.9
    assert "needs both" in refuses(document)


def test_font_ids_are_positions_and_subset_tags_six_capitals() -> None:
    shuffled = pdf_document()
    shuffled["pdf"]["fonts"][0]["id"] = 7
    assert "position in fonts" in refuses(shuffled)
    tagged = pdf_document()
    tagged["pdf"]["fonts"][0]["subset_tag"] = "abc"
    refuses(tagged)


def test_edits_after_a_signature_need_a_signature() -> None:
    document = pdf_document()
    document["pdf"]["signatures"] = 0
    document["pdf"]["edits_after_signature"] = True
    assert "needs a signature" in refuses(document)


def test_dates_are_iso_8601_or_null() -> None:
    document = pdf_document()
    document["pdf"]["creation_date"] = "D:20260301120000+01'00'"
    refuses(document)
