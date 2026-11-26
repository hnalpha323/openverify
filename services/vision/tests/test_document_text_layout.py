"""Phase 12A V2: the ``text_layout`` document fallback.

A licence photographed in the web flow's 1080x1920 frame covers about 26% of it, under the
contour gate's 30%, so the detector found no document in any phone frame (plan section 2.1; the
live test's "document found: false" with 22-23 text lines and a portrait). When the detectors find
no card, :func:`document.detect_by_text_layout` uses the side's OCR line boxes (and, on the front,
the portrait) as evidence: an outlined, ID-1-shaped card under the area gate that holds the text
is the document; otherwise the text's own extent, grown by a card's margins and snapped to the
card's edges, is. Either is reported with ``method: "text_layout"``. Captures come from
``tools/synthetic_quebec.py``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Final

import numpy as np
import pytest

from model_paths import MODELS_DIR, missing_text_models
from openverify_vision import mrz_locate, ocr
from openverify_vision.analysis import FaceEngine, analyze_government_id_side, document_faces
from openverify_vision.document import (
    NOT_FOUND,
    DocumentResult,
    detect_by_text_layout,
    detect_document,
)
from openverify_vision.faces import Face
from openverify_vision.imaging import ImageArray
from openverify_vision.quality import QualityThresholds
from openverify_vision.schemas import (
    BoundingBox,
    DocumentDetection,
    GovernmentIdAnalysis,
    MrzReading,
    TextLine,
)
from openverify_vision.settings import Settings
from quebec_captures import PHONE_1080, bgr, frame_boxes, photo, worst_corner_share
from synthetic_quebec import Capture, photograph

CORNER_SHARE: Final = 0.03
"""Plan V2: each corner within 3% of the card's width of the true corner."""

NOTHING: Final = DocumentResult(detection=NOT_FOUND, rectified=None)


def desk() -> ImageArray:
    """A 1080x1920 frame of the generator's desk with no card on it."""
    shot = photograph("front", Capture("desk", card_width_share=1e-3))
    return bgr(shot)


@pytest.mark.parametrize("side", ["front", "back"])
@pytest.mark.parametrize("name", PHONE_1080)
def test_every_phone_frame_finds_the_card_within_three_percent(side: str, name: str) -> None:
    shot = photo(side, name)  # type: ignore[arg-type]
    image = bgr(shot)
    missed = detect_document(image)
    assert not missed.detection.found  # the live miss: the card is under the area gate

    found = detect_by_text_layout(image, missed, text_boxes=frame_boxes(shot), portrait_boxes=())

    assert found.detection.found
    assert found.detection.method == "text_layout"
    assert found.detection.quad is not None
    assert worst_corner_share(found.detection.quad, shot) <= CORNER_SHARE
    assert found.rectified is not None
    assert found.rectified.shape[1::-1] == found.detection.rectified_size


def test_the_near_miss_outline_is_kept_for_the_fallback() -> None:
    shot = photo("front", "phone-1080")

    missed = detect_document(bgr(shot))

    assert missed.near_misses
    assert worst_corner_share(missed.near_misses[0], shot) <= CORNER_SHARE


def test_the_live_shape_without_an_outline_is_found_from_the_text_and_the_portrait() -> None:
    """22 text lines and a portrait, and the contour detector found nothing at all."""
    shot = photo("front", "phone-1080")
    boxes = frame_boxes(shot)[:22]
    portrait = (95.0, 712.0, 268.0, 343.0)  # the photo box of the card, in frame pixels

    found = detect_by_text_layout(bgr(shot), NOTHING, text_boxes=boxes, portrait_boxes=(portrait,))

    assert found.detection.method == "text_layout"
    assert found.detection.quad is not None
    assert worst_corner_share(found.detection.quad, shot) <= CORNER_SHARE


def test_a_desk_without_a_card_finds_nothing() -> None:
    image = desk()
    missed = detect_document(image)

    assert detect_by_text_layout(image, missed, text_boxes=(), portrait_boxes=()) is missed
    assert not missed.detection.found


def test_too_few_lines_are_no_evidence() -> None:
    shot = photo("front", "phone-1080")
    missed = detect_document(bgr(shot))

    found = detect_by_text_layout(
        bgr(shot), missed, text_boxes=frame_boxes(shot)[:2], portrait_boxes=()
    )

    assert found is missed


def test_text_that_is_not_card_shaped_finds_nothing() -> None:
    image = desk()
    column = tuple((500.0, 100.0 + 60.0 * i, 80.0, 30.0) for i in range(25))

    assert not detect_by_text_layout(
        image, NOTHING, text_boxes=column, portrait_boxes=()
    ).detection.found


def test_a_found_document_is_kept_as_it_is() -> None:
    shot = photo("front", "phone-full")
    found = detect_document(bgr(shot))
    assert found.detection.found

    assert (
        detect_by_text_layout(bgr(shot), found, text_boxes=frame_boxes(shot), portrait_boxes=())
        is found
    )


def test_an_outline_that_does_not_hold_the_text_is_not_the_card() -> None:
    shot = photo("front", "phone-1080")
    missed = detect_document(bgr(shot))
    elsewhere = tuple((x, y + 900.0, w, h) for x, y, w, h in frame_boxes(shot))

    found = detect_by_text_layout(bgr(shot), missed, text_boxes=elsewhere, portrait_boxes=())

    assert found.detection.quad is None or worst_corner_share(found.detection.quad, shot) > (
        CORNER_SHARE
    )


def test_a_face_beside_the_text_is_not_taken_into_the_card() -> None:
    shot = photo("front", "phone-1080")
    holder = (300.0, 1500.0, 300.0, 380.0)  # the holder's own face, below the card

    found = detect_by_text_layout(
        bgr(shot), NOTHING, text_boxes=frame_boxes(shot), portrait_boxes=(holder,)
    )

    assert found.detection.quad is not None
    assert worst_corner_share(found.detection.quad, shot) <= CORNER_SHARE


def test_a_text_layout_detection_validates_against_the_contract() -> None:
    shot = photo("back", "phone-1080")
    image = bgr(shot)
    found = detect_by_text_layout(
        image, detect_document(image), text_boxes=frame_boxes(shot), portrait_boxes=()
    )

    data = json.loads(found.detection.model_dump_json())

    assert DocumentDetection.model_validate(data).method == "text_layout"
    schema = GovernmentIdAnalysis.model_json_schema()
    assert "text_layout" in json.dumps(schema)


def test_the_portrait_of_a_text_layout_card_is_a_face_on_it() -> None:
    shot = photo("front", "phone-1080")
    found = detect_by_text_layout(
        bgr(shot), NOTHING, text_boxes=frame_boxes(shot), portrait_boxes=()
    )
    on_card = Face(box=(120.0, 720.0, 200.0, 260.0), landmarks=((200.0, 800.0),) * 5, score=0.9)
    beside = Face(box=(300.0, 1500.0, 300.0, 380.0), landmarks=((400.0, 1600.0),) * 5, score=0.9)

    assert document_faces([beside, on_card], found.detection) == [on_card]


# --- the side analysis -----------------------------------------------------------------------


class OneFace:
    """The face detector seeing one face on the card's photo box (frame pixels)."""

    def load(self) -> None:
        pass

    def detect(self, img: ImageArray) -> list[Face]:
        height, width = img.shape[:2]
        if (width, height) != (1080, 1920):
            return []
        return [Face(box=(130.0, 740.0, 190.0, 240.0), landmarks=((220.0, 850.0),) * 5, score=0.9)]


class UnitEmbedding:
    def load(self) -> None:
        pass

    def embed(self, img: ImageArray, face: Face) -> Any:
        vector = np.ones(128, dtype=np.float32)
        return vector / np.linalg.norm(vector)


def test_the_side_analysis_falls_back_to_the_text_layout_and_reads_the_rectified_card(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    shot = photo("front", "phone-1080")
    upload = bgr(shot)
    read: list[tuple[int, int]] = []

    def read_text(self: ocr.OcrEngine, img: ImageArray) -> list[TextLine]:
        read.append((img.shape[1], img.shape[0]))
        boxes: tuple[BoundingBox, ...] = (
            frame_boxes(shot) if img is upload else ((10.0, 10.0, 90.0, 20.0),)
        )
        return [
            TextLine(
                text="SPECIMEN",
                confidence=0.95,
                box=box,
                stroke_width_mean=2.5,
                stroke_width_cv=0.15,
            )
            for box in boxes
        ]

    no_mrz = MrzReading(found=False, format_guess=None, lines=[], line_confidences=[], box=None)
    monkeypatch.setattr(ocr.OcrEngine, "read_text", read_text)
    monkeypatch.setattr(mrz_locate, "locate_mrz", lambda img, reader: no_mrz)
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": tmp_path})

    side = analyze_government_id_side(
        shot.jpeg,
        upload,
        FaceEngine(OneFace(), UnitEmbedding(), long_sides=(10_000,)),
        ocr.OcrEngine.from_settings(settings),
        QualityThresholds(),
        front=True,
    )

    assert side.document.method == "text_layout"
    assert side.document.quad is not None
    assert worst_corner_share(side.document.quad, shot) <= CORNER_SHARE
    # The upload was read first (the evidence), then the rectified card (the side's text).
    assert read[0] == (1080, 1920)
    assert read[1] == side.document.rectified_size
    assert [line.box for line in side.text] == [(10.0, 10.0, 90.0, 20.0)]
    assert side.document_quality is not None
    assert side.portrait is not None


def test_the_side_analysis_without_text_reports_no_document(tmp_path: Path) -> None:
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": tmp_path})
    shot = photo("back", "phone-1080")

    side = analyze_government_id_side(
        shot.jpeg,
        bgr(shot),
        FaceEngine(OneFace(), UnitEmbedding(), long_sides=(10_000,)),
        ocr.OcrEngine.from_settings(settings),  # no models: no text, so no evidence
        QualityThresholds(),
        front=False,
    )

    assert not side.document.found


@pytest.mark.skipif(bool(missing_text_models()), reason=f"missing {missing_text_models()}")
@pytest.mark.parametrize("side", ["front", "back"])
def test_the_real_ocr_lines_find_the_card_in_the_phone_frame(side: str) -> None:
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": MODELS_DIR})
    reader = ocr.OcrEngine.from_settings(settings)
    shot = photo(side, "phone-1080")  # type: ignore[arg-type]
    image = bgr(shot)

    lines = reader.read_text(image)
    found = detect_by_text_layout(
        image,
        detect_document(image),
        text_boxes=tuple(line.box for line in lines),
        portrait_boxes=(),
    )

    assert found.detection.method == "text_layout"
    assert found.detection.quad is not None
    assert worst_corner_share(found.detection.quad, shot) <= CORNER_SHARE


@pytest.mark.skipif(bool(missing_text_models()), reason=f"missing {missing_text_models()}")
def test_the_real_ocr_finds_no_text_on_a_bare_desk() -> None:
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": MODELS_DIR})
    image = desk()

    lines = ocr.OcrEngine.from_settings(settings).read_text(image)
    found = detect_by_text_layout(
        image,
        detect_document(image),
        text_boxes=tuple(line.box for line in lines),
        portrait_boxes=(),
    )

    assert not found.detection.found
