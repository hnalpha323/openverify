"""``forensics/spectral.py``: screen recapture as a pixel grid and as moire.

A card shown on an RGB-stripe screen and photographed carries the screen's pixel grid (resolved,
or aliased into fine hatching) and, near the camera's own sampling rate, broad moire bands. The
8-pixel JPEG block grid, printed text and the card's own patterns must not read as either.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np
import pytest

from forensic_scenes import (
    Image,
    camera,
    card,
    grey,
    on_background,
    recompress,
    screen_recapture,
)
from openverify_vision.forensics import spectral
from openverify_vision.forensics.spectral import (
    GRID_MAX_SIDE,
    MOIRE_MAX_SIDE,
    moire_score,
    screen_grid_score,
)

CARD = camera(card())


def clean_cases() -> dict[str, Image]:
    photo, _ = on_background(card())
    return {
        "q90": recompress(CARD, 90),
        "q60": recompress(CARD, 60),
        "q40": recompress(CARD, 40),
        "q95-q60": recompress(CARD, 95, 60),
        "1600": recompress(camera(card(size=(1600, 1009))), 75),
        "on-background": recompress(photo, 85),
        "noise": np.random.default_rng(2).integers(0, 256, (600, 900, 3), dtype=np.uint8),
    }


CLEAN = clean_cases()


@pytest.mark.parametrize("name", sorted(CLEAN))
def test_a_card_photographed_directly_has_no_screen_grid(name: str) -> None:
    assert screen_grid_score(grey(CLEAN[name])) < 0.2


@pytest.mark.parametrize("name", sorted(CLEAN))
def test_a_card_photographed_directly_has_no_moire(name: str) -> None:
    assert moire_score(grey(CLEAN[name])) < 0.2


@pytest.mark.parametrize(
    ("subpixels", "scale", "angle"),
    [(3, 1.0, 0.0), (3, 0.9, 2.0), (3, 0.55, 7.0), (2, 0.6, 4.0), (3, 0.42, 3.0)],
)
def test_a_screen_recapture_shows_its_pixel_grid(
    subpixels: int, scale: float, angle: float
) -> None:
    shot = recompress(screen_recapture(CARD, subpixels=subpixels, scale=scale, angle=angle), 88)

    assert screen_grid_score(grey(shot)) > 0.5


@pytest.mark.parametrize(("scale", "angle"), [(0.33, 2.0), (0.52, 1.0)])
def test_a_recapture_near_the_cameras_sampling_rate_shows_moire(scale: float, angle: float) -> None:
    subpixels = 3 if scale < 0.5 else 2
    big = card(size=(2024, 1276))
    shot = recompress(screen_recapture(big, subpixels=subpixels, scale=scale, angle=angle), 88)

    assert moire_score(grey(shot)) > 0.5


@pytest.mark.parametrize(
    "image",
    [
        pytest.param(np.zeros((1, 1), dtype=np.uint8), id="1x1"),
        pytest.param(np.full((640, 1000), 117, dtype=np.uint8), id="uniform"),
        pytest.param(np.full((20, 3000), 200, dtype=np.uint8), id="sliver"),
    ],
)
def test_degenerate_images_score_zero(image: Image) -> None:
    assert screen_grid_score(image) == 0.0
    assert moire_score(image) == 0.0


def test_scores_are_unit_interval_values() -> None:
    shot = grey(screen_recapture(CARD, subpixels=3, scale=1.0, angle=0.0))

    assert 0.0 <= screen_grid_score(shot) <= 1.0
    assert 0.0 <= moire_score(shot) <= 1.0


def test_a_large_upload_is_measured_on_bounded_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    large = grey(np.ascontiguousarray(cv2.resize(CARD, (8000, 5000))))
    shapes: list[tuple[int, ...]] = []
    real = spectral._power_spectrum

    def spy(image: Any, segment: int) -> Any:
        shapes.append(tuple(image.shape))
        return real(image, segment)

    monkeypatch.setattr(spectral, "_power_spectrum", spy)

    screen_grid_score(large)
    grid_shapes = list(shapes)
    shapes.clear()
    moire_score(large)

    assert grid_shapes
    assert all(max(shape) <= GRID_MAX_SIDE for shape in grid_shapes)
    assert shapes
    assert all(max(shape) <= MOIRE_MAX_SIDE for shape in shapes)
