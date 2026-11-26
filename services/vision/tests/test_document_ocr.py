"""C60.1: the OCR of a document page (a whole page, or each text-layer line's own box) and how
far the visible text layer agrees with it.

The fake models of ``ocr_fakes`` read a drawn page; one test runs the real PP-OCRv6 models on a
synthetic bill rendered by the guarded child's own code.
"""

from __future__ import annotations

import time

import numpy as np
import pytest

import document_pdfs as pdfs
import ocr_fakes
from model_paths import MODELS_DIR, missing_text_models
from openverify_vision.document_text import text_layer_ocr_agreement
from openverify_vision.guarded.pdf_measure import analyze
from openverify_vision.ocr import OcrEngine
from openverify_vision.ocr.recognition import (
    RecognitionBudget,
    RecognitionDeadlineError,
    line_units,
)
from openverify_vision.schemas import DocumentOcrLine
from openverify_vision.settings import Settings


def test_a_page_is_read_as_document_lines() -> None:
    engine, _, _ = ocr_fakes.engine()
    lines = engine.read_document(ocr_fakes.page())
    assert all(isinstance(line, DocumentOcrLine) for line in lines)
    assert [line.text for line in lines] == ["UTOPIA", "SURNAME", "VALEMONT", "12 08 1984"]
    first = lines[0]
    assert first.confidence == pytest.approx(0.98, abs=0.01)
    # The detector's box: the region grown by DB's unclip margin (about 28 px for 300 x 40).
    x, y, width, height = first.box
    assert x == pytest.approx(100 - 28, abs=4)
    assert y == pytest.approx(60 - 28, abs=4)
    assert width == pytest.approx(300 + 56, abs=8)
    assert height == pytest.approx(40 + 56, abs=8)


def test_a_document_line_may_hold_300_characters() -> None:
    long = "A" * 400
    region = (100, 300, 800, 60)
    engine, _, _ = ocr_fakes.engine({200: (region, long, 0.99)})
    lines = engine.read_document(ocr_fakes.page({200: (region, long, 0.99)}))
    assert [len(line.text) for line in lines] == [300]


def test_nothing_is_read_without_the_text_models() -> None:
    engine, detector, _ = ocr_fakes.engine()
    detector.missing = True
    assert engine.read_document(ocr_fakes.page()) == []
    assert engine.read_regions(ocr_fakes.page(), [(100, 60, 300, 40)]) == []


def test_each_box_is_read_on_its_own() -> None:
    engine, detector, _ = ocr_fakes.engine()
    boxes = [region for region, _, _ in ocr_fakes.LINES.values()]
    readings = engine.read_regions(ocr_fakes.page(), boxes)
    assert [reading.text if reading else None for reading in readings] == [
        "UTOPIA",
        "SURNAME",
        "VALEMONT",
        "12 08 1984",
    ]
    assert detector.loads <= 1  # no detection is run for the boxes


def test_a_box_read_with_low_confidence_is_kept_with_its_confidence() -> None:
    region = (100, 300, 300, 40)
    lines = {200: (region, "AMOUNT", 0.3)}
    engine, _, _ = ocr_fakes.engine(lines)
    (reading,) = engine.read_regions(ocr_fakes.page(lines), [region])
    assert reading is not None
    assert reading.text == "AMOUNT"
    assert reading.confidence == pytest.approx(0.3, abs=0.01)


def test_a_box_off_the_raster_reads_nothing() -> None:
    engine, _, _ = ocr_fakes.engine()
    assert engine.read_regions(ocr_fakes.page(), [(-900, 60, 300, 40), (5000, 60, 30, 40)]) == [
        None,
        None,
    ]


def test_a_box_reading_carries_the_box_it_read() -> None:
    engine, _, _ = ocr_fakes.engine()
    (reading,) = engine.read_regions(ocr_fakes.page(), [(100, 60, 300, 40)])
    assert reading is not None
    x, y, width, height = reading.box
    assert [x, y, width, height] == pytest.approx([88, 48, 324, 64], abs=1)


# --- the budget (Workflow 5C review P009) -------------------------------------------------------

FAKE_LINE_UNITS = 320 / 48
"""Each fake line's crop (324 x 64 for a box, about 356 x 96 detected) is narrower than the
recognizer's 320-pixel minimum, so it costs that minimum: 320 / 48 line heights."""


def test_a_line_costs_its_width_in_line_heights_within_the_recognizers_bounds() -> None:
    assert line_units(np.zeros((48, 100, 3), dtype=np.uint8)) == pytest.approx(320 / 48)
    assert line_units(np.zeros((48, 960, 3), dtype=np.uint8)) == pytest.approx(20.0)
    assert line_units(np.zeros((10, 5000, 3), dtype=np.uint8)) == pytest.approx(64.0)


def test_a_budget_reads_the_boxes_in_order_until_it_is_spent() -> None:
    engine, _, recognizer = ocr_fakes.engine()
    boxes = [region for region, _, _ in ocr_fakes.LINES.values()]
    budget = RecognitionBudget(units=2.5 * FAKE_LINE_UNITS)
    readings = engine.read_regions(ocr_fakes.page(), boxes, budget)
    # A prefix: the boxes after the first one the budget refused are not read at all.
    assert [reading.text if reading else None for reading in readings] == ["UTOPIA", "SURNAME"]
    assert recognizer.rows == 2
    assert budget.spent == pytest.approx(2 * FAKE_LINE_UNITS)
    assert budget.exhausted is True


def test_a_box_off_the_raster_costs_nothing_and_is_still_answered() -> None:
    engine, _, recognizer = ocr_fakes.engine()
    budget = RecognitionBudget(units=1.5 * FAKE_LINE_UNITS)
    readings = engine.read_regions(
        ocr_fakes.page(), [(-900, 60, 300, 40), (100, 60, 300, 40)], budget
    )
    assert [reading.text if reading else None for reading in readings] == [None, "UTOPIA"]
    assert recognizer.rows == 1
    assert budget.exhausted is False


def test_a_budget_limits_a_whole_page_read() -> None:
    engine, _, recognizer = ocr_fakes.engine()
    budget = RecognitionBudget(units=2.5 * FAKE_LINE_UNITS)
    lines = engine.read_document(ocr_fakes.page(), budget)
    assert [line.text for line in lines] == ["UTOPIA", "SURNAME"]
    assert recognizer.rows == 2
    assert budget.exhausted is True


def test_a_reading_past_its_deadline_stops() -> None:
    engine, _, recognizer = ocr_fakes.engine()
    budget = RecognitionBudget(units=1000.0, deadline=time.monotonic() - 1.0)
    with pytest.raises(RecognitionDeadlineError):
        engine.read_regions(ocr_fakes.page(), [(100, 60, 300, 40)], budget)
    with pytest.raises(RecognitionDeadlineError):
        engine.read_document(ocr_fakes.page(), budget)
    assert recognizer.rows == 0


# --- the agreement ------------------------------------------------------------------------------


def test_identical_readings_agree_fully() -> None:
    assert (
        text_layer_ocr_agreement(
            ["Amount due: 48.20", "QUINN VALEMONT"],
            [
                "Amount due: 48.20",
                "QUINN VALEMONT",
            ],
        )
        == 1.0
    )


def test_case_and_spacing_do_not_count() -> None:
    assert text_layer_ocr_agreement(["Amount due: 48.20"], ["AMOUNT DUE:48.20"]) == 1.0


def test_a_different_amount_lowers_the_agreement_by_its_share() -> None:
    agreement = text_layer_ocr_agreement(
        ["Amount due: 48.20", "QUINN VALEMONT"], ["Amount due: 98.70", "QUINN VALEMONT"]
    )
    assert agreement is not None
    assert 0.8 < agreement < 1.0


def test_a_box_where_nothing_was_read_scores_nothing() -> None:
    assert text_layer_ocr_agreement(["QUINN", "VALEMONT"], ["QUINN", None]) == pytest.approx(
        5 / 13, abs=1e-4
    )


def test_without_visible_text_there_is_no_agreement() -> None:
    assert text_layer_ocr_agreement([], []) is None
    assert text_layer_ocr_agreement(["   "], ["x"]) is None


# --- the real text models -----------------------------------------------------------------------


@pytest.mark.skipif(
    bool(missing_text_models()),
    reason=f"fetch the text models: python3 scripts/fetch_models.py ({missing_text_models()})",
)
def test_the_real_models_read_a_rendered_bill_and_agree_with_its_text_layer() -> None:
    header, frames = analyze(pdfs.bill())
    page = header["pages"][0]
    raster = np.frombuffer(frames[0], dtype=np.uint8).reshape(
        page["raster"]["height"], page["raster"]["width"]
    )
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": MODELS_DIR})
    engine = OcrEngine.from_settings(settings)
    visible = [line for line in page["text_layer"] if line["visible"]]
    readings = engine.read_regions(raster, [tuple(line["box"]) for line in visible])
    agreement = text_layer_ocr_agreement(
        [line["text"] for line in visible], [r.text if r else None for r in readings]
    )
    assert agreement is not None
    assert agreement > 0.9
    found = " ".join(line.text for line in engine.read_document(raster))
    assert "VALEMONT" in found
    assert "48.20" in found


@pytest.mark.skipif(
    bool(missing_text_models()),
    reason=f"fetch the text models: python3 scripts/fetch_models.py ({missing_text_models()})",
)
def test_a_line_a_text_clip_hides_reads_as_nothing_so_the_agreement_falls() -> None:
    # PDFium does not expose a clip made of text (render modes 4 to 7): the text layer calls
    # the amount visible, and the OCR of its box, which reads the raster, finds nothing there.
    header, frames = analyze(pdfs.text_clip_hides_what_follows())
    page = header["pages"][0]
    raster = np.frombuffer(frames[0], dtype=np.uint8).reshape(
        page["raster"]["height"], page["raster"]["width"]
    )
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": MODELS_DIR})
    engine = OcrEngine.from_settings(settings)
    visible = [line for line in page["text_layer"] if line["visible"]]
    assert [line["text"] for line in visible] == [
        "Statement date: 30 September 2026",
        "Amount due: 48.20",
    ]
    readings = engine.read_regions(raster, [tuple(line["box"]) for line in visible])
    assert readings[1] is None or "48.20" not in readings[1].text
    agreement = text_layer_ocr_agreement(
        [line["text"] for line in visible], [r.text if r else None for r in readings]
    )
    assert agreement is not None
    assert agreement < 0.75
