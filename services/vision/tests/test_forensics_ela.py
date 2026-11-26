"""``forensics/ela.py``: error level analysis, the portrait against the rest of the document.

A portrait pasted from another JPEG history re-compresses differently from the card around it.
The difference is normalised per pixel across a fixed ladder of re-save qualities (a "JPEG ghost"),
so the portrait's texture alone does not read as a different history.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np
import pytest

from forensic_scenes import (
    FACE,
    PORTRAIT,
    Image,
    camera,
    card,
    paste,
    recompress,
)
from openverify_vision.forensics import ela as ela_module
from openverify_vision.forensics.ela import ELA_MAX_SIDE, ela_score

CARD = camera(card())
OTHER = camera(card(seed=7), seed=9)
"""Another card: its portrait is the one pasted in."""


def score(image: Image, face: tuple[float, float, float, float] | None = FACE) -> float:
    region = np.ones(image.shape[:2], dtype=bool)
    return ela_score(image, region=region, portrait_box=face, offset=(0, 0))


@pytest.mark.parametrize(
    "qualities",
    [(85,), (60,), (95,), (60, 90), (75, 85), (95, 75), (90, 90)],
    ids=["85", "60", "95", "60-90", "75-85", "95-75", "90-90"],
)
def test_an_untouched_card_scores_low_however_often_it_was_saved(
    qualities: tuple[int, ...],
) -> None:
    assert score(recompress(CARD, *qualities)) < 0.3


def test_a_portrait_pasted_from_an_uncompressed_source_scores_high() -> None:
    spliced = paste(recompress(CARD, 60), OTHER, PORTRAIT)

    assert score(recompress(spliced, 90)) > 0.5


@pytest.mark.parametrize("quality", [85, 90])
def test_a_portrait_pasted_from_a_low_quality_jpeg_scores_high(quality: int) -> None:
    spliced = paste(recompress(CARD, quality), recompress(OTHER, 30), PORTRAIT)

    assert score(recompress(spliced, quality)) > 0.5


def test_without_a_portrait_there_is_nothing_to_compare() -> None:
    spliced = paste(recompress(CARD, 60), OTHER, PORTRAIT)

    assert score(recompress(spliced, 90), face=None) == 0.0


def test_a_uniform_image_has_no_error_level_to_compare() -> None:
    assert score(np.full((638, 1012, 3), 140, dtype=np.uint8)) == 0.0


@pytest.mark.parametrize(
    ("image", "region"),
    [
        pytest.param(np.zeros((1, 1, 3), dtype=np.uint8), np.ones((1, 1), dtype=bool), id="1x1"),
        pytest.param(CARD[:60, :500], np.ones((60, 500), dtype=bool), id="sliver"),
        pytest.param(CARD, np.zeros(CARD.shape[:2], dtype=bool), id="empty-region"),
    ],
)
def test_a_window_smaller_than_four_cells_a_side_is_not_measured(
    image: Image, region: np.ndarray
) -> None:
    assert ela_score(image, region=region, portrait_box=FACE, offset=(0, 0)) == 0.0


def test_only_the_document_region_counts_as_the_rest() -> None:
    # The upload around the card carries a very different history; inside the card nothing
    # was touched, so the score stays low when only the card is the region.
    canvas = recompress(np.full((900, 1400, 3), 90, dtype=np.uint8), 30)
    canvas = camera(canvas, seed=4, noise=6.0)
    canvas[100:738, 150:1162] = recompress(CARD, 85)
    region = np.zeros(canvas.shape[:2], dtype=bool)
    region[100:738, 150:1162] = True
    x, y, w, h = FACE
    face = (x + 150, y + 100, w, h)

    measured = ela_score(recompress(canvas, 85), region=region, portrait_box=face, offset=(0, 0))

    assert measured < 0.3


def test_the_score_is_a_unit_interval_value() -> None:
    spliced = recompress(paste(recompress(CARD, 60), OTHER, PORTRAIT), 90)

    assert 0.0 <= score(spliced) <= 1.0


def test_a_large_upload_re_saves_a_bounded_window(monkeypatch: pytest.MonkeyPatch) -> None:
    large = np.ascontiguousarray(cv2.resize(CARD, (6000, 3784), interpolation=cv2.INTER_LINEAR))
    shapes: list[tuple[int, ...]] = []
    real = ela_module._resave

    def spy(luma: Any, quality: int) -> Any:
        shapes.append(tuple(luma.shape))
        return real(luma, quality)

    monkeypatch.setattr(ela_module, "_resave", spy)
    scale = 6000 / CARD.shape[1]
    x, y, w, h = FACE

    ela_score(
        large,
        region=np.ones(large.shape[:2], dtype=bool),
        portrait_box=(x * scale, y * scale, w * scale, h * scale),
        offset=(0, 0),
    )

    assert shapes
    assert all(max(shape) <= ELA_MAX_SIDE for shape in shapes)
