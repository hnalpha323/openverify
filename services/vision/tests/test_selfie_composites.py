"""tools/selfie_composites.py: covering and glasses composites along the five landmarks (C45.2).

On a drawn cartoon face whose landmarks are known: a covering hides the mouth and leaves the
eyes; glasses frame the eyes and leave the mouth; dark lenses darken the eyes, clear ones do not.
"""

from __future__ import annotations

import numpy as np
import pytest

from selfie_composites import COVERINGS, TEMPLATE_112, cover, face_affine, glasses
from selfie_fakes import drawn_face

FACE, POINTS = drawn_face()


def patch(image: np.ndarray, point: np.ndarray, radius: int) -> np.ndarray:
    x, y = (round(v) for v in point)
    return image[y - radius : y + radius + 1, x - radius : x + radius + 1].astype(np.float64)


def changed(before: np.ndarray, after: np.ndarray, point: np.ndarray, radius: int) -> float:
    return float(np.abs(patch(after, point, radius) - patch(before, point, radius)).mean())


def mouth(points: np.ndarray) -> np.ndarray:
    return np.asarray((points[3] + points[4]) / 2)


def test_the_face_affine_maps_the_template_onto_the_landmarks() -> None:
    affine = face_affine(POINTS)

    mapped = np.hstack([TEMPLATE_112, np.ones((5, 1))]) @ affine.T
    assert affine.shape == (2, 3)
    assert np.allclose(mapped, POINTS, atol=3.0)


def test_the_coverings_are_the_plans() -> None:
    assert COVERINGS == ("mask", "scarf", "hand")


CHIN = (56.0, 118.0)
"""A template point on the chin: the scarf stays below the mouth corners (YuNet loses a face
whose mouth is covered too, see the module docstring)."""


def hidden(item: str, points: np.ndarray) -> np.ndarray:
    """Where each covering must change the picture: the mouth, or the chin for the scarf."""
    if item == "scarf":
        return np.asarray(face_affine(points) @ np.array([*CHIN, 1.0]))
    return mouth(points)


@pytest.mark.parametrize("item", COVERINGS)
def test_a_covering_hides_the_lower_face_and_leaves_the_eyes(item: str) -> None:
    covered = cover(FACE, POINTS, item, seed=5)  # type: ignore[arg-type]

    assert covered.shape == FACE.shape
    assert changed(FACE, covered, hidden(item, POINTS), 6) > 20
    for eye in POINTS[:2]:
        assert changed(FACE, covered, eye, 4) < 1


@pytest.mark.parametrize("item", COVERINGS)
def test_a_covering_is_deterministic(item: str) -> None:
    assert np.array_equal(cover(FACE, POINTS, item, 5), cover(FACE, POINTS, item, 5))  # type: ignore[arg-type]


def test_a_covering_follows_the_landmarks() -> None:
    shifted = POINTS + np.array([40.0, 10.0])
    moved = np.roll(np.roll(FACE, 40, axis=1), 10, axis=0)

    covered = cover(moved, shifted, "mask", 5)

    assert changed(moved, covered, mouth(shifted), 6) > 20


def test_an_unknown_covering_is_refused() -> None:
    with pytest.raises(ValueError, match="covering"):
        cover(FACE, POINTS, "helmet", 5)  # type: ignore[arg-type]


@pytest.mark.parametrize("dark", [False, True])
def test_glasses_frame_the_eyes_and_leave_the_mouth(dark: bool) -> None:
    worn = glasses(FACE, POINTS, dark=dark)

    assert changed(FACE, worn, mouth(POINTS), 6) < 1
    eye_distance = float(np.linalg.norm(POINTS[1] - POINTS[0]))
    for eye in POINTS[:2]:
        rim = eye + np.array([0.0, -0.32 * eye_distance])  # above the eye, on the frame's top bar
        assert patch(worn, rim, 1).mean() < 0.6 * patch(FACE, rim, 1).mean()


def test_dark_lenses_darken_the_eyes_and_clear_ones_barely() -> None:
    dark = glasses(FACE, POINTS, dark=True)
    clear = glasses(FACE, POINTS, dark=False)

    for eye in POINTS[:2]:
        below = eye + np.array([0.0, 8.0])  # skin inside the lens, under the eye
        assert patch(dark, below, 2).mean() < 0.5 * patch(FACE, below, 2).mean()
        assert patch(clear, below, 2).mean() == pytest.approx(patch(FACE, below, 2).mean(), rel=0.2)
