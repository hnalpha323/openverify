"""C41.1 ``face_quality``: the primary face region's size, placement, sharpness, brightness and
glare.

Every image is drawn by ``selfie_faces`` (no real face), with the face YuNet would report for it.
"""

from __future__ import annotations

import math
import time

import cv2
import numpy as np
import pytest

from openverify_vision.faces import Face
from openverify_vision.quality import (
    FACE_BLUR_WIDTH,
    blur_score,
    brightness,
    measure_face_quality,
)
from openverify_vision.schemas import FaceQuality
from selfie_faces import FaceSpec, add_highlight, draw_face

from synthetic import gaussian_blur, make_uniform


def _measure(image: np.ndarray, face: Face) -> FaceQuality:
    quality = measure_face_quality(image, face)
    assert quality is not None
    return quality


def test_no_face_is_not_measured() -> None:
    image, _ = draw_face()
    assert measure_face_quality(image, None) is None


def test_the_box_size_and_placement_of_a_face_inside_the_image() -> None:
    image, face = draw_face()
    quality = _measure(image, face)
    x, y, w, h = face.box
    assert quality.box == pytest.approx(face.box, abs=0.01)
    assert quality.width_px == pytest.approx(w, abs=0.01)
    assert quality.height_ratio == pytest.approx(h / 480, abs=1e-4)
    # The box centre's offset from the image centre, as shares of the width and height.
    assert quality.center_offset[0] == pytest.approx((x + w / 2 - 320) / 640, abs=1e-4)
    assert quality.center_offset[1] == pytest.approx((y + h / 2 - 240) / 480, abs=1e-4)


def test_blur_is_the_laplacian_variance_of_the_face_scaled_down_to_the_sface_width() -> None:
    image, face = draw_face()
    x, y, w, h = (round(v) for v in face.box)
    crop = image[y : y + h, x : x + w]
    size = (FACE_BLUR_WIDTH, round(h * FACE_BLUR_WIDTH / w))
    scaled = np.asarray(cv2.resize(crop, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)
    assert FACE_BLUR_WIDTH == 112
    assert _measure(image, face).blur_score == pytest.approx(blur_score(scaled), rel=0.05)


def test_blur_does_not_fall_merely_because_the_face_has_more_pixels() -> None:
    small_image, small = draw_face(iod=48.0, noise=0.0)
    large_image, large = draw_face(
        width=2560, height=1920, iod=192.0, center=(1280.0, 800.0), noise=0.0
    )
    small_score = _measure(small_image, small).blur_score
    large_score = _measure(large_image, large).blur_score
    assert large_score == pytest.approx(small_score, rel=0.15)  # unscaled, 30% apart


def test_a_blurred_face_scores_lower_than_a_sharp_one() -> None:
    image, face = draw_face()
    sharp = _measure(image, face).blur_score
    blurred = _measure(gaussian_blur(image, sigma=3.0), face).blur_score
    assert blurred < sharp / 4


def test_brightness_is_the_mean_grey_of_the_face_region() -> None:
    image = make_uniform(64, height=480, width=640)
    image[100:300, 200:400] = 191
    face = Face(box=(200.0, 100.0, 200.0, 200.0), landmarks=_landmarks(200, 100, 200), score=0.9)
    quality = _measure(image, face)
    assert quality.brightness == pytest.approx(191 / 255, abs=1e-3)
    assert quality.brightness != pytest.approx(brightness(image), abs=0.05)


def test_glare_counts_colourless_highlights_on_the_skin() -> None:
    image, face = draw_face()
    spec = FaceSpec()
    clean = _measure(image, face).glare_ratio
    shiny = _measure(add_highlight(image, spec, at=(0.55, 0.55), radius=0.2), face).glare_ratio
    assert clean == 0.0
    region = face.box[2] * face.box[3]
    assert shiny == pytest.approx(math.pi * (0.2 * 64) ** 2 / region, rel=0.25)


def test_glare_leaves_out_the_eye_regions() -> None:
    image, face = draw_face()
    on_eye = add_highlight(image, FaceSpec(), at=(0.5, 0.0), radius=0.08)
    assert _measure(on_eye, face).glare_ratio == 0.0


def test_glare_leaves_out_the_eyes_of_a_rolled_face() -> None:
    spec = FaceSpec(roll_deg=25.0)
    image, face = draw_face(spec)
    on_eye = add_highlight(image, spec, at=(-0.5, 0.0), radius=0.08)
    assert _measure(on_eye, face).glare_ratio == 0.0


def test_a_face_cut_by_the_image_edge_is_measured_on_its_visible_part() -> None:
    image, face = draw_face(center=(30.0, 120.0))
    x, y, w, _ = face.box
    assert x < 0
    quality = _measure(image, face)
    assert quality.box[0] == 0.0
    assert quality.box[2] == pytest.approx(x + w, abs=0.01)
    assert quality.width_px == pytest.approx(x + w, abs=0.01)
    assert quality.box[1] == pytest.approx(y, abs=0.01)


def test_a_face_box_outside_the_image_is_not_measured() -> None:
    image, _ = draw_face()
    outside = Face(box=(700.0, 10.0, 50.0, 60.0), landmarks=_landmarks(700, 10, 50), score=0.9)
    assert measure_face_quality(image, outside) is None


@pytest.mark.parametrize(
    "box",
    [
        (10.0, 10.0, 1.0, 1.0),  # under two pixels
        (10.0, 10.0, 0.0, 30.0),
        (10.0, 10.0, -5.0, 30.0),
        (float("nan"), 10.0, 30.0, 30.0),
        (10.0, 10.0, float("inf"), 30.0),
    ],
)
def test_a_degenerate_box_is_not_measured(box: tuple[float, float, float, float]) -> None:
    image, _ = draw_face()
    face = Face(box=box, landmarks=_landmarks(10, 10, 30), score=0.9)
    assert measure_face_quality(image, face) is None


def test_a_one_pixel_image_is_not_measured() -> None:
    image = make_uniform(128, height=1, width=1)
    face = Face(box=(0.0, 0.0, 1.0, 1.0), landmarks=((0.0, 0.0),) * 5, score=0.9)
    assert measure_face_quality(image, face) is None


def test_a_tiny_face_is_measured_at_its_own_size() -> None:
    image, face = draw_face(iod=6.0)
    quality = _measure(image, face)
    assert quality.width_px == pytest.approx(15.0, abs=0.01)
    assert 0.0 <= quality.glare_ratio <= 1.0


def test_grey_input_matches_bgr() -> None:
    image, face = draw_face()
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    from_grey, from_bgr = _measure(grey, face), _measure(image, face)
    assert from_grey.blur_score == pytest.approx(from_bgr.blur_score)
    assert from_grey.brightness == pytest.approx(from_bgr.brightness)


def test_a_huge_face_stays_bounded() -> None:
    image, face = draw_face(width=7000, height=5000, iod=1500.0, center=(3500.0, 1900.0), noise=0.0)
    started = time.perf_counter()
    quality = _measure(image, face)
    assert time.perf_counter() - started < 2.0
    assert quality.width_px > 3000
    assert 0.0 <= quality.glare_ratio <= 1.0


def test_the_result_is_rounded_for_the_contract() -> None:
    image, face = draw_face(center=(320.3, 200.7))
    quality = _measure(image, face)
    assert quality.box == tuple(round(v, 2) for v in quality.box)
    assert quality.height_ratio == round(quality.height_ratio, 4)
    assert quality.blur_score == round(quality.blur_score, 2)
    assert quality.glare_ratio == round(quality.glare_ratio, 4)


def _landmarks(x: float, y: float, size: float) -> tuple[tuple[float, float], ...]:
    return (
        (x + 0.3 * size, y + 0.4 * size),
        (x + 0.7 * size, y + 0.4 * size),
        (x + 0.5 * size, y + 0.6 * size),
        (x + 0.35 * size, y + 0.8 * size),
        (x + 0.65 * size, y + 0.8 * size),
    )


@pytest.mark.parametrize("eyes", [((300.0, 200.0), (300.0, 200.0)), ((-1e7, 200.0), (1e7, 200.0))])
def test_eyes_that_cannot_be_placed_leave_the_whole_region_to_the_glare(
    eyes: tuple[tuple[float, float], tuple[float, float]],
) -> None:
    image, face = draw_face()
    on_eye = add_highlight(image, FaceSpec(), at=(0.5, 0.0), radius=0.08)
    blind = Face(box=face.box, landmarks=(*eyes, *face.landmarks[2:]), score=face.score)
    assert _measure(on_eye, blind).glare_ratio > 0.0
