"""``forensics/portrait.py``: discontinuities across the portrait's frame.

The frame is found as the strongest straight edges nearest the face on each side. On a card
photographed as printed, the camera's noise is the same on both sides of the frame; a portrait
pasted in digitally brings its own noise (none, more, or a JPEG's), so the two sides differ.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np
import pytest

from forensic_scenes import FACE, PORTRAIT, Image, camera, card, grey, paste, recompress
from openverify_vision.forensics import portrait
from openverify_vision.forensics.portrait import PORTRAIT_MAX_SIDE, portrait_boundary_score

CLEAN_CARD = card()


def photographed(noise: float, quality: int) -> Image:
    return recompress(camera(CLEAN_CARD, noise=noise), quality)


def swapped(source: Image, *, noise: float = 2.5, quality: int = 88) -> Image:
    """The card photographed, then ``source``'s portrait pasted in, then saved."""
    return recompress(paste(camera(CLEAN_CARD, noise=noise), source, PORTRAIT), quality)


@pytest.mark.parametrize(
    ("noise", "quality"), [(2.5, 88), (1.0, 95), (5.0, 75), (2.5, 60), (3.0, 92)]
)
def test_a_card_photographed_as_printed_scores_low(noise: float, quality: int) -> None:
    measured = portrait_boundary_score(grey(photographed(noise, quality)), FACE)

    assert measured is not None
    assert measured < 0.3


@pytest.mark.parametrize(
    "source",
    [
        pytest.param(card(seed=5), id="noise-free"),
        pytest.param(camera(card(seed=5), seed=8, noise=7.0), id="noisier"),
        pytest.param(cv2.GaussianBlur(card(seed=5), (0, 0), 1.5), id="smoothed"),
    ],
)
def test_a_pasted_portrait_with_its_own_noise_scores_high(source: Image) -> None:
    measured = portrait_boundary_score(grey(swapped(np.asarray(source, dtype=np.uint8))), FACE)

    assert measured is not None
    assert measured > 0.4


def test_a_quiet_photo_with_a_noisy_pasted_portrait_scores_high() -> None:
    noisy = camera(card(seed=5), seed=8, noise=5.0)

    measured = portrait_boundary_score(grey(swapped(noisy, noise=1.0, quality=92)), FACE)

    assert measured is not None
    assert measured > 0.4


@pytest.mark.parametrize(
    ("image", "face"),
    [
        pytest.param(np.full((638, 1012), 128, dtype=np.uint8), FACE, id="no-frame"),
        pytest.param(grey(photographed(2.5, 88)), (2000.0, 2000.0, 50.0, 50.0), id="face-outside"),
        pytest.param(np.zeros((1, 1), dtype=np.uint8), (0.0, 0.0, 1.0, 1.0), id="1x1"),
        pytest.param(grey(photographed(2.5, 88)), (100.0, 190.0, 0.4, 0.4), id="sub-pixel-face"),
    ],
)
def test_without_a_frame_to_measure_there_is_no_score(
    image: Image, face: tuple[float, float, float, float]
) -> None:
    assert portrait_boundary_score(image, face) is None


def test_a_frame_at_the_image_edge_is_measured_on_its_other_sides() -> None:
    # Cropped so the frame's left line is 2 pixels from the edge: no band fits outside it.
    cropped = grey(photographed(2.5, 88))[:, 36:]
    x, y, w, h = FACE

    measured = portrait_boundary_score(np.ascontiguousarray(cropped), (x - 36, y, w, h))

    assert measured is not None
    assert measured < 0.3


def test_the_score_is_a_unit_interval_value() -> None:
    measured = portrait_boundary_score(grey(swapped(card(seed=5))), FACE)

    assert measured is not None
    assert 0.0 <= measured <= 1.0


def test_a_large_document_is_measured_on_a_bounded_copy(monkeypatch: pytest.MonkeyPatch) -> None:
    image = grey(photographed(2.5, 88))
    large = np.ascontiguousarray(cv2.resize(image, (6072, 3828)))
    scale = 6072 / image.shape[1]
    x, y, w, h = FACE
    sizes: list[int] = []
    real = portrait.fit_within

    def spy(img: Any, max_side: int) -> Any:
        resized, factor = real(img, max_side)
        sizes.append(max(resized.shape[:2]))
        return resized, factor

    monkeypatch.setattr(portrait, "fit_within", spy)

    measured = portrait_boundary_score(large, (x * scale, y * scale, w * scale, h * scale))

    assert sizes == [PORTRAIT_MAX_SIDE]
    assert measured is not None
