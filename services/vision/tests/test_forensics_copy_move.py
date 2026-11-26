"""``forensics/copy_move.py``: a region of the document duplicated elsewhere on it.

ORB keypoints matched against the same image: a copied region gives many matches that share one
displacement and start from one compact area. The card's own repeated patterns (guilloche waves,
recurring glyphs) are spread over the card or fail the ratio test.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np
import pytest

from forensic_scenes import Image, camera, card, grey, recompress
from openverify_vision.forensics import copy_move
from openverify_vision.forensics.copy_move import (
    COPY_MOVE_MAX_SIDE,
    FEATURES_PER_TILE,
    TILES,
    copy_move_score,
)

CARD = camera(card())


def moved(source: tuple[int, int, int, int], target: tuple[int, int]) -> Image:
    """``CARD`` with the ``source`` block (x, y, w, h) copied with its top left at ``target``."""
    x, y, w, h = source
    tx, ty = target
    out = CARD.copy()
    out[ty : ty + h, tx : tx + w] = CARD[y : y + h, x : x + w]
    return out


@pytest.mark.parametrize(
    "image",
    [
        pytest.param(recompress(CARD, 90), id="q90"),
        pytest.param(recompress(CARD, 60), id="q60"),
        pytest.param(recompress(CARD, 95, 70), id="q95-q70"),
        pytest.param(recompress(camera(card(size=(1600, 1009))), 85), id="1600"),
    ],
)
def test_an_untouched_card_scores_low(image: Image) -> None:
    assert copy_move_score(grey(image)) < 0.2


@pytest.mark.parametrize(
    ("source", "target"),
    [((380, 130, 220, 120), (640, 300)), ((380, 210, 300, 60), (600, 540))],
    ids=["field-block", "date-line"],
)
def test_a_copied_region_scores_high(
    source: tuple[int, int, int, int], target: tuple[int, int]
) -> None:
    assert copy_move_score(grey(recompress(moved(source, target), 90))) > 0.5


@pytest.mark.parametrize(
    "image",
    [
        pytest.param(np.zeros((1, 1), dtype=np.uint8), id="1x1"),
        pytest.param(np.full((40, 30), 9, dtype=np.uint8), id="tiny"),
        pytest.param(np.full((600, 900), 150, dtype=np.uint8), id="uniform"),
        pytest.param(
            np.random.default_rng(3).integers(0, 256, (600, 900), dtype=np.uint8), id="noise"
        ),
    ],
)
def test_degenerate_images_score_zero(image: Image) -> None:
    assert copy_move_score(image) == 0.0


def test_a_large_upload_is_matched_on_a_bounded_copy_with_capped_features(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    large = grey(np.ascontiguousarray(cv2.resize(CARD, (7000, 4412))))
    seen: list[tuple[tuple[int, ...], int]] = []
    real = copy_move._keypoints

    def spy(image: Any) -> Any:
        keypoints, descriptors = real(image)
        seen.append((tuple(image.shape), len(keypoints)))
        return keypoints, descriptors

    monkeypatch.setattr(copy_move, "_keypoints", spy)

    copy_move_score(large)

    ((shape, count),) = seen
    assert max(shape) <= COPY_MOVE_MAX_SIDE
    assert count <= TILES * TILES * FEATURES_PER_TILE
