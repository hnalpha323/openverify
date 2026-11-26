"""``forensics/chroma.py``: saturation, colourfulness and a regional colour cast.

A greyscale photocopy has neither saturation nor colourfulness. A colour cast that covers the
whole card is the light or the white balance; one confined to a region of its neutral (grey and
white) areas is not.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np
import pytest

from forensic_scenes import Image, camera, card, recompress, tint
from openverify_vision.forensics import chroma
from openverify_vision.forensics.chroma import (
    CAST_MAX_SIDE,
    CHROMA_MAX_SIDE,
    chroma_stats,
    color_cast_score,
)

CARD = recompress(camera(card()), 88)
PHOTOCOPY = recompress(
    np.ascontiguousarray(
        cv2.cvtColor(cv2.cvtColor(camera(card()), cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    ),
    88,
)
TEXT_AREA = (360, 120, 420, 340)
"""The card's field labels and values: dark ink on a light, nearly neutral background."""


def test_a_greyscale_photocopy_has_no_colour() -> None:
    stats = chroma_stats(PHOTOCOPY)

    assert stats.mean_saturation < 0.02
    assert stats.colorfulness < 2.0


def test_the_colour_card_has_colour() -> None:
    stats = chroma_stats(CARD)

    assert stats.mean_saturation > 0.08
    assert stats.colorfulness > 15.0


def test_re_encoding_barely_moves_the_chroma_statistics() -> None:
    before, after = chroma_stats(CARD), chroma_stats(recompress(CARD, 60))

    assert abs(before.mean_saturation - after.mean_saturation) < 0.03
    assert abs(before.colorfulness - after.colorfulness) < 3.0


@pytest.mark.parametrize(
    ("image", "saturation", "colorfulness"),
    [
        pytest.param(np.full((50, 80, 3), 128, dtype=np.uint8), 0.0, 0.0, id="grey"),
        pytest.param(np.zeros((1, 1, 3), dtype=np.uint8), 0.0, 0.0, id="1x1-black"),
        pytest.param(
            np.full((50, 80, 3), (0, 0, 255), dtype=np.uint8),
            1.0,
            0.3 * 255 * np.hypot(1, 0.5),
            id="red",
        ),
    ],
)
def test_uniform_images_have_exact_statistics(
    image: Image, saturation: float, colorfulness: float
) -> None:
    stats = chroma_stats(image)

    assert stats.mean_saturation == pytest.approx(saturation, abs=1e-3)
    assert stats.colorfulness == pytest.approx(colorfulness, abs=0.5)


@pytest.mark.parametrize(
    "image",
    [
        pytest.param(CARD, id="card"),
        pytest.param(recompress(CARD, 60), id="re-encoded"),
        pytest.param(
            recompress(tint(camera(card()), (0, 0, 1012, 638), (0.8, 0.95, 1.1)), 88),
            id="warm-light",
        ),
        pytest.param(
            recompress(tint(camera(card()), (0, 0, 1012, 638), (1.12, 1.0, 0.9)), 88),
            id="cool-light",
        ),
        pytest.param(PHOTOCOPY, id="photocopy"),
    ],
)
def test_a_cast_over_the_whole_card_is_not_regional(image: Image) -> None:
    assert color_cast_score(image) < 0.35


@pytest.mark.parametrize("gains", [(0.75, 1.0, 1.1), (1.2, 1.0, 0.8)], ids=["yellow", "blue"])
def test_a_cast_on_one_region_of_the_neutral_areas_is_regional(
    gains: tuple[float, float, float],
) -> None:
    image = recompress(tint(camera(card()), TEXT_AREA, gains), 88)

    assert color_cast_score(image) > 0.6


@pytest.mark.parametrize(
    "image",
    [
        pytest.param(np.zeros((1, 1, 3), dtype=np.uint8), id="1x1"),
        pytest.param(np.full((300, 500, 3), (40, 90, 200), dtype=np.uint8), id="uniform"),
    ],
)
def test_degenerate_images_have_no_regional_cast(image: Image) -> None:
    assert color_cast_score(image) == 0.0


def test_a_document_with_fewer_than_three_measurable_cells_has_no_regional_cast() -> None:
    # Ink black and clipped white everywhere, but two cells of usable, differently tinted grey.
    image = np.zeros((400, 400, 3), dtype=np.uint8)
    image[200:, :] = 255
    image[:100, :100] = (120, 120, 160)
    image[:100, 100:200] = (160, 120, 120)

    assert color_cast_score(image) == 0.0


def test_a_large_upload_is_measured_on_a_bounded_copy(monkeypatch: pytest.MonkeyPatch) -> None:
    large = np.ascontiguousarray(cv2.resize(CARD, (8000, 5040)))
    sizes: list[int] = []
    real = chroma.fit_within

    def spy(image: Any, max_side: int) -> Any:
        resized, scale = real(image, max_side)
        sizes.append(max(resized.shape[:2]))
        return resized, scale

    monkeypatch.setattr(chroma, "fit_within", spy)

    chroma_stats(large)
    color_cast_score(large)

    assert sizes == [CHROMA_MAX_SIDE, CAST_MAX_SIDE]
