"""``forensics/star.py``: the REAL ID star, a five-pointed star in the upper part of a card."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import cv2
import numpy as np
import pytest
from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont

from forensic_scenes import (
    STAR_CENTRE,
    STAR_RADIUS,
    Image,
    camera,
    card,
    on_background,
    recompress,
    star_points,
)
from openverify_vision.forensics import star
from openverify_vision.forensics.star import STAR_MAX_SIDE, find_star_glyph
from openverify_vision.schemas import StarGlyph

Draw = Callable[[ImageDraw.ImageDraw], None]


def drawn(draw: Draw, base: Image | None = None) -> Image:
    """The card (or ``base``) with ``draw`` applied, photographed and saved."""
    rgb = PILImage.fromarray(np.ascontiguousarray((card() if base is None else base)[:, :, ::-1]))
    draw(ImageDraw.Draw(rgb))
    bgr = np.ascontiguousarray(np.asarray(rgb)[:, :, ::-1])
    return recompress(camera(bgr), 88)


def black_star_in_gold_disc(d: ImageDraw.ImageDraw) -> None:
    d.ellipse((880, 10, 980, 110), fill=(232, 182, 60))
    d.polygon(star_points((930, 62), 40), fill=(20, 20, 20))


def white_star_cut_from_a_dark_disc(d: ImageDraw.ImageDraw) -> None:
    d.ellipse((820, 120, 920, 220), fill=(30, 30, 30))
    d.polygon(star_points((870, 172), 44), fill=(240, 240, 240))


def small_tilted_star(d: ImageDraw.ImageDraw) -> None:
    d.polygon(star_points((800, 170), 24, rotation=-70), fill=(20, 20, 20))


def text_and_asterisks(d: ImageDraw.ImageDraw) -> None:
    font = ImageFont.load_default(size=60)
    d.text((560, 120), "* * * A W M X K 4 8", font=font, fill=(20, 20, 20))


def star_low_on_the_card(d: ImageDraw.ImageDraw) -> None:
    d.polygon(star_points((900, 560), 36), fill=(20, 20, 20))


def six_pointed_star(d: ImageDraw.ImageDraw) -> None:
    for start in (-90, -30):
        d.polygon(
            [
                (900 + 40 * math.cos(math.radians(a)), 170 + 40 * math.sin(math.radians(a)))
                for a in range(start, start + 360, 120)
            ],
            fill=(20, 20, 20),
        )


def disc(d: ImageDraw.ImageDraw) -> None:
    d.ellipse((860, 130, 940, 210), fill=(20, 20, 20))


def test_a_gold_star_in_the_header_is_found_where_it_is() -> None:
    found = find_star_glyph(recompress(camera(card(star=True)), 88))

    assert found.found is True
    assert found.score > 0.8
    assert found.box is not None
    x, y, w, h = found.box
    cx, cy = STAR_CENTRE
    assert abs(x + w / 2 - cx) < 6
    assert abs(y + h / 2 - cy) < 8
    assert abs(w - 2 * STAR_RADIUS * math.cos(math.radians(18))) < 8


@pytest.mark.parametrize(
    "draw",
    [black_star_in_gold_disc, white_star_cut_from_a_dark_disc, small_tilted_star],
    ids=["black-in-gold-disc", "white-cut-out", "small-tilted"],
)
def test_other_star_designs_are_found(draw: Draw) -> None:
    found = find_star_glyph(drawn(draw))

    assert found.found is True
    assert found.score > 0.8


def test_a_star_on_a_rectified_photograph_is_found() -> None:
    _, document = on_background(card(star=True))
    assert document.rectified is not None

    assert find_star_glyph(recompress(document.rectified, 85)).found is True


@pytest.mark.parametrize(
    "image",
    [
        pytest.param(recompress(camera(card()), 88), id="plain-card"),
        pytest.param(recompress(camera(card()), 95, 60), id="re-encoded"),
        pytest.param(drawn(text_and_asterisks), id="asterisks-and-letters"),
        pytest.param(drawn(star_low_on_the_card), id="star-at-the-bottom"),
        pytest.param(drawn(six_pointed_star), id="six-points"),
        pytest.param(drawn(disc), id="disc"),
    ],
)
def test_no_five_pointed_star_in_the_upper_part_is_not_found(image: Image) -> None:
    found = find_star_glyph(image)

    assert found.found is False
    assert found.score < 0.5
    assert found.box is None


@pytest.mark.parametrize(
    "image",
    [
        pytest.param(np.zeros((1, 1, 3), dtype=np.uint8), id="1x1"),
        pytest.param(np.full((638, 1012, 3), 200, dtype=np.uint8), id="uniform"),
    ],
)
def test_degenerate_images_have_no_star(image: Image) -> None:
    found = find_star_glyph(image)

    assert (found.found, found.score, found.box) == (False, 0.0, None)


def test_straight_rules_in_the_upper_part_are_not_stars() -> None:
    # One-pixel rules give contours with no area at all.
    image = np.full((638, 1012), 230, dtype=np.uint8)
    image[120, 300:420] = 20
    image[150:250, 600] = 20

    assert find_star_glyph(image) == StarGlyph(found=False, score=0.0, box=None)


def test_a_large_document_is_searched_on_a_bounded_copy(monkeypatch: pytest.MonkeyPatch) -> None:
    large = np.ascontiguousarray(cv2.resize(recompress(camera(card(star=True)), 88), (6072, 3828)))
    sizes: list[int] = []
    real = star.fit_within

    def spy(img: Any, max_side: int) -> Any:
        resized, factor = real(img, max_side)
        sizes.append(max(resized.shape[:2]))
        return resized, factor

    monkeypatch.setattr(star, "fit_within", spy)

    found = find_star_glyph(large)

    assert sizes == [STAR_MAX_SIDE]
    assert found.found is True
    assert found.box is not None
    # The box is in the document's own pixels, not the working copy's.
    assert found.box[0] > 5000
