"""C41.1 ``occlusion``: the face covering and glasses heuristics (H tier, research §6).

Every face, mask, scarf, hat and pair of glasses is drawn by ``selfie_faces`` along the landmarks
of the face it returns; no real face is used. These tests pin the direction and the plumbing of
each cue (a mask lowers the lower face's skin share relative to the forehead, frames add bridge
and rim edges), never an accuracy: the heuristics are beta, and their thresholds provisional.
"""

from __future__ import annotations

import math
import time

import cv2
import numpy as np
import pytest

from openverify_vision.faces import Face
from openverify_vision.occlusion import measure_occlusion
from openverify_vision.schemas import Occlusion
from selfie_faces import (
    FaceSpec,
    add_glasses,
    add_hat,
    add_mask,
    add_scarf,
    draw_face,
)

PROVISIONAL_MAX_SCORE = 0.5
"""``max-face-covering-score`` and ``max-glasses-score`` (SELFIE_CHECK_CONFIG_DEFAULTS)."""


def _measure(image: np.ndarray, face: Face) -> Occlusion:
    result = measure_occlusion(image, face)
    assert result is not None
    return result


@pytest.fixture(scope="module")
def bare() -> Occlusion:
    image, face = draw_face()
    return _measure(image, face)


def test_no_face_is_not_measured() -> None:
    image, _ = draw_face()
    assert measure_occlusion(image, None) is None


# --- covering ----------------------------------------------------------------------------------


def test_a_bare_face_reads_uncovered_against_its_own_forehead(bare: Occlusion) -> None:
    covering = bare.covering
    assert covering.forehead_valid is True
    assert covering.skin_fraction_ratio > 0.85
    assert covering.score < 0.3
    assert covering.delta_e >= 0.0
    assert covering.texture_ratio > 0.0


@pytest.mark.parametrize("colour", [(210, 180, 150), (25, 25, 25), (235, 235, 235)])
def test_a_mask_covers_the_lower_face(bare: Occlusion, colour: tuple[int, int, int]) -> None:
    image, face = draw_face()
    covering = _measure(add_mask(image, colour=colour), face).covering
    assert covering.forehead_valid is True
    assert covering.skin_fraction_ratio < 0.2
    assert covering.score > PROVISIONAL_MAX_SCORE
    assert covering.score > bare.covering.score + 0.3


def test_a_scarf_covers_the_mouth_and_chin(bare: Occlusion) -> None:
    image, face = draw_face()
    covering = _measure(add_scarf(image), face).covering
    assert covering.skin_fraction_ratio < bare.covering.skin_fraction_ratio - 0.4
    assert covering.score > PROVISIONAL_MAX_SCORE


def test_the_mask_cue_is_relative_to_the_persons_own_skin() -> None:
    # A darker skin tone still inside the YCrCb skin box reads uncovered against itself.
    image, face = draw_face(skin=(70, 95, 140))
    assert _measure(image, face).covering.score < 0.3
    masked = _measure(add_mask(image, FaceSpec(skin=(70, 95, 140))), face).covering
    assert masked.score > PROVISIONAL_MAX_SCORE


def test_a_covered_forehead_is_no_reference() -> None:
    image, face = draw_face()
    covering = _measure(add_hat(image), face).covering
    assert covering.forehead_valid is False
    assert covering.score == 0.0  # forehead_valid decides; the score means nothing without it


def test_a_forehead_outside_the_image_is_no_reference() -> None:
    image, face = draw_face(center=(320.0, 30.0))
    covering = _measure(image, face).covering
    assert covering.forehead_valid is False


def test_grey_input_has_no_skin_reference() -> None:
    image, face = draw_face()
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    assert _measure(grey, face).covering.forehead_valid is False


# --- glasses -----------------------------------------------------------------------------------


def test_a_bare_face_reads_no_glasses(bare: Occlusion) -> None:
    assert bare.glasses.score < 0.3


@pytest.mark.parametrize("tinted", [False, True])
def test_frames_add_bridge_and_rim_edges(bare: Occlusion, tinted: bool) -> None:
    image, face = draw_face()
    glasses = _measure(add_glasses(image, tinted=tinted), face).glasses
    assert glasses.bridge_edge_density > bare.glasses.bridge_edge_density + 0.03
    assert glasses.rim_edge_energy > bare.glasses.rim_edge_energy + 0.05
    assert glasses.score > PROVISIONAL_MAX_SCORE


def test_a_lens_reflection_is_a_highlight_in_the_lens() -> None:
    image, face = draw_face()
    plain = _measure(add_glasses(image), face).glasses
    shiny = _measure(add_glasses(image, highlight=True), face).glasses
    assert plain.lens_highlight_ratio == 0.0
    assert shiny.lens_highlight_ratio > 0.02
    assert shiny.score >= plain.score


# --- geometry ----------------------------------------------------------------------------------


@pytest.mark.parametrize("roll", [-25.0, 20.0])
def test_a_rolled_face_is_measured_along_its_eye_line(roll: float) -> None:
    spec = FaceSpec(roll_deg=roll)
    image, face = draw_face(spec)
    assert _measure(image, face).covering.score < 0.3
    assert _measure(image, face).glasses.score < 0.3
    assert _measure(add_mask(image, spec), face).covering.score > PROVISIONAL_MAX_SCORE
    assert _measure(add_glasses(image, spec), face).glasses.score > PROVISIONAL_MAX_SCORE


def test_the_scores_do_not_depend_on_the_face_size() -> None:
    small_image, small = draw_face(iod=40.0)
    large_image, large = draw_face(
        width=2560, height=1920, iod=400.0, center=(1280.0, 800.0), noise=4.0
    )
    spec_large = FaceSpec(width=2560, height=1920, iod=400.0, center=(1280.0, 800.0))
    for draw_small, draw_large in (
        (small_image, large_image),
        (add_glasses(small_image, FaceSpec(iod=40.0)), add_glasses(large_image, spec_large)),
        (add_mask(small_image, FaceSpec(iod=40.0)), add_mask(large_image, spec_large)),
    ):
        a, b = _measure(draw_small, small), _measure(draw_large, large)
        assert a.covering.score == pytest.approx(b.covering.score, abs=0.15)
        assert a.glasses.score == pytest.approx(b.glasses.score, abs=0.2)


def test_a_face_too_small_for_its_regions_is_not_measured() -> None:
    image, face = draw_face(iod=10.0)
    assert measure_occlusion(image, face) is None


def test_a_lower_face_outside_the_image_is_not_measured() -> None:
    image, face = draw_face(center=(320.0, 440.0))
    assert measure_occlusion(image, face) is None


def test_a_face_beside_the_image_is_not_measured() -> None:
    image, face = draw_face()
    x, y, w, h = face.box
    outside = Face(
        box=(x + 2000, y, w, h),
        landmarks=tuple((px + 2000, py) for px, py in face.landmarks),
        score=0.9,
    )
    assert measure_occlusion(image, outside) is None


@pytest.mark.parametrize(
    "landmarks",
    [
        ((10.0, 10.0),) * 5,
        ((100.0, 100.0), (164.0, 100.0), (float("nan"), 140.0), (110.0, 170.0), (154.0, 170.0)),
        # Upside down: the mouth above the eyes.
        ((100.0, 200.0), (164.0, 200.0), (132.0, 160.0), (110.0, 120.0), (154.0, 120.0)),
    ],
)
def test_landmarks_that_are_no_face_are_not_measured(
    landmarks: tuple[tuple[float, float], ...],
) -> None:
    image, _ = draw_face()
    face = Face(box=(80.0, 60.0, 120.0, 180.0), landmarks=landmarks, score=0.9)
    assert measure_occlusion(image, face) is None


def test_a_one_pixel_image_is_not_measured() -> None:
    image = np.full((1, 1, 3), 128, dtype=np.uint8)
    face = Face(box=(0.0, 0.0, 1.0, 1.0), landmarks=((0.0, 0.0),) * 5, score=0.9)
    assert measure_occlusion(image, face) is None


def test_a_huge_face_stays_bounded() -> None:
    image, face = draw_face(width=7000, height=5000, iod=1500.0, center=(3500.0, 2000.0), noise=0.0)
    started = time.perf_counter()
    result = _measure(image, face)
    assert time.perf_counter() - started < 2.0  # 0.22 s on the development CPU
    assert result.covering.forehead_valid is True


def test_every_value_is_in_range_and_rounded() -> None:
    image, face = draw_face()
    result = _measure(add_glasses(add_mask(image), highlight=True), face)
    covering, glasses = result.covering, result.glasses
    for score in (covering.score, glasses.score):
        assert 0.0 <= score <= 1.0
        assert score == round(score, 4)
    assert 0.0 <= glasses.bridge_edge_density <= 1.0
    assert 0.0 <= glasses.lens_highlight_ratio <= 1.0
    assert 0.0 <= glasses.rim_edge_energy <= 1.0
    for value in (covering.skin_fraction_ratio, covering.texture_ratio, glasses.rim_edge_energy):
        assert math.isfinite(value)
        assert value == round(value, 4)
    assert covering.delta_e == round(covering.delta_e, 2)


def test_no_single_glasses_cue_reaches_the_provisional_threshold() -> None:
    # A dark mask's top edge runs through the rim bands and reads as a lower rim; without a
    # bridge or a lens highlight it stays below the threshold.
    image, face = draw_face()
    glasses = _measure(add_mask(image, colour=(25, 25, 25)), face).glasses
    assert glasses.rim_edge_energy > 0.2
    assert glasses.bridge_edge_density == 0.0
    assert glasses.score <= 0.4 < PROVISIONAL_MAX_SCORE


def test_a_mouth_on_the_nose_leaves_no_lower_face() -> None:
    image, _ = draw_face()
    # The mouth corners 0.02 IOD under the nose tip: the lower face would be under 0.2 IOD tall.
    landmarks = ((288.0, 200.0), (352.0, 200.0), (320.0, 240.0), (300.0, 241.3), (340.0, 241.3))
    face = Face(box=(240.0, 118.0, 160.0, 215.0), landmarks=landmarks, score=0.9)
    assert measure_occlusion(image, face) is None
