"""``ocr/strokes.py``: stroke width from the distance transform of the binarised line crop.

On the medial axis of a stroke, the distance to the nearest background pixel is half the
stroke width, so the width is ``2 * d - 1`` in whole pixels. Printed text keeps one width;
handwriting varies it, which the coefficient of variation measures (C32.1).
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray

from openverify_vision.ocr.strokes import stroke_width_stats
from text_images import PAPER, Placed, render_lines

PAPER_BGR = PAPER[::-1]


def bars(thicknesses: list[int], *, ink: int = 30, paper: int = 220) -> NDArray[np.uint8]:
    """Horizontal bars of the given thicknesses, 200 px long, on a 300 px wide crop."""
    height = sum(t + 10 for t in thicknesses) + 10
    crop = np.full((height, 300, 3), paper, dtype=np.uint8)
    top = 10
    for thickness in thicknesses:
        crop[top : top + thickness, 50:250] = ink
        top += thickness + 10
    return crop


@pytest.mark.parametrize("thickness", [3, 5, 7])
def test_uniform_strokes_measure_their_width_with_little_variation(thickness: int) -> None:
    stats = stroke_width_stats(bars([thickness, thickness]))

    assert stats is not None
    mean, cv = stats
    assert mean == pytest.approx(thickness, abs=0.5)
    assert cv < 0.1


def test_light_text_on_a_dark_ground_measures_the_same() -> None:
    dark = stroke_width_stats(bars([5, 5]))
    light = stroke_width_stats(bars([5, 5], ink=230, paper=20))

    assert dark is not None
    assert light == pytest.approx(dark, abs=0.01)


def test_strokes_of_varying_width_vary() -> None:
    uniform = stroke_width_stats(bars([5, 5, 5]))
    varied = stroke_width_stats(bars([3, 5, 11]))

    assert uniform is not None
    assert varied is not None
    assert varied[1] > 0.3 > uniform[1]


def test_rendered_text_has_a_plausible_stroke_width() -> None:
    line = render_lines([Placed("SPECIMEN 1234", 10, 10, size=40)], width=400, height=70)

    stats = stroke_width_stats(np.asarray(cv2.cvtColor(line, cv2.COLOR_BGR2GRAY), dtype=np.uint8))

    assert stats is not None
    assert 2.0 <= stats[0] <= 8.0


def test_a_crop_too_small_to_measure_has_no_statistics() -> None:
    assert stroke_width_stats(bars([3])[:7]) is None


def test_a_crop_without_strokes_has_no_statistics() -> None:
    assert stroke_width_stats(np.full((40, 200, 3), 200, dtype=np.uint8)) is None


def test_a_dot_has_too_little_medial_axis_to_measure() -> None:
    crop = np.full((40, 200, 3), 220, dtype=np.uint8)
    crop[18:21, 98:101] = 20

    assert stroke_width_stats(crop) is None


def card_value(text: str, *, size: int = 34, quality: int = 92) -> NDArray[np.uint8]:
    """A value line as the synthetic card prints it: dark blue ink on its pale ground, through
    a JPEG round trip."""
    line = render_lines([Placed(text, 6, 6, size=size)], width=size * len(text), height=size + 14)
    line[(line == PAPER_BGR).all(axis=2)] = (214, 220, 198)
    ok, encoded = cv2.imencode(".jpg", line, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return np.asarray(cv2.imdecode(encoded, cv2.IMREAD_COLOR), dtype=np.uint8)


@pytest.mark.parametrize("text", ["CALDERWOOD", "UT4829163", "21 03 1988", "NORA"])
def test_printed_values_vary_little(text: str) -> None:
    # Strokes two to three pixels wide read as 1, 3 or 5 on the whole-pixel distance transform,
    # which alone would make print look as uneven as handwriting; on a copy 96 pixels high the
    # widths resolve and print stays even.
    stats = stroke_width_stats(card_value(text))

    assert stats is not None
    assert stats[1] < 0.3
    assert 1.5 <= stats[0] <= 4.0  # still in the crop's own pixels
