"""``ocr/geometry.py``: the box geometry of the DB post-processing, with OpenCV and NumPy only.

RapidOCR grows each box with pyclipper (round joins on the closed polygon) by
``area * ratio / perimeter`` and then takes the minimum-area rectangle again. For the convex
boxes the detector produces, that rectangle is the box grown by the distance on every side,
which is what these tests pin.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
import pytest

from openverify_vision.ocr.geometry import (
    mini_box,
    order_points_clockwise,
    quad_bounds,
    rotate_crop,
    unclip,
)


def rectangle(cx: float, cy: float, w: float, h: float, degrees: float) -> np.ndarray:
    return np.asarray(cv2.boxPoints(((cx, cy), (w, h), degrees)), dtype=np.float32)


def test_mini_box_orders_an_upright_rectangle_from_the_top_left() -> None:
    contour = np.array([[[10, 20]], [[110, 20]], [[110, 40]], [[10, 40]]], dtype=np.int32)

    box, short_side = mini_box(contour)

    assert box.tolist() == [[10.0, 20.0], [110.0, 20.0], [110.0, 40.0], [10.0, 40.0]]
    assert short_side == pytest.approx(20.0)


def test_unclip_grows_an_upright_box_by_the_db_distance_on_every_side() -> None:
    box = np.array([[10, 20], [110, 20], [110, 40], [10, 40]], dtype=np.float32)
    distance = 100 * 20 * 1.6 / 240  # area * ratio / perimeter

    grown, short_side = mini_box(unclip(box, 1.6))

    assert short_side == pytest.approx(20 + 2 * distance, abs=0.05)
    assert grown[0] == pytest.approx([10 - distance, 20 - distance], abs=0.05)
    assert grown[2] == pytest.approx([110 + distance, 40 + distance], abs=0.05)


def test_unclip_keeps_the_centre_and_angle_of_a_rotated_box() -> None:
    box = rectangle(200, 150, 120, 30, 25)
    distance = 120 * 30 * 2.0 / (2 * (120 + 30))

    (cx, cy), (w, h), angle = cv2.minAreaRect(unclip(box, 2.0))

    assert (cx, cy) == pytest.approx((200, 150), abs=0.05)
    assert sorted((w, h)) == pytest.approx([30 + 2 * distance, 120 + 2 * distance], abs=0.1)
    original_angle = cv2.minAreaRect(box)[2]
    assert math.isclose(angle % 90, original_angle % 90, abs_tol=0.1)


def test_unclip_of_a_degenerate_box_returns_its_points() -> None:
    point = np.array([[5, 5]] * 4, dtype=np.float32)

    assert unclip(point, 1.6).reshape(-1, 2).tolist() == [[5.0, 5.0]] * 4


def test_order_points_clockwise_from_any_order() -> None:
    shuffled = np.array([[110, 40], [10, 20], [10, 40], [110, 20]], dtype=np.float32)

    assert order_points_clockwise(shuffled).tolist() == [
        [10.0, 20.0],
        [110.0, 20.0],
        [110.0, 40.0],
        [10.0, 40.0],
    ]


def test_rotate_crop_of_an_upright_quad_is_that_region() -> None:
    img = np.zeros((100, 200, 3), dtype=np.uint8)
    img[30:50, 40:140] = 255
    quad = np.array([[40, 30], [140, 30], [140, 50], [40, 50]], dtype=np.float32)

    crop = rotate_crop(img, quad)

    assert crop.shape == (20, 100, 3)
    assert crop.dtype == np.uint8
    assert crop.min() == 255


def test_rotate_crop_turns_a_tall_line_on_its_side() -> None:
    img = np.zeros((300, 300, 3), dtype=np.uint8)
    quad = np.array([[100, 50], [130, 50], [130, 250], [100, 250]], dtype=np.float32)

    crop = rotate_crop(img, quad)

    assert crop.shape == (30, 200, 3)  # height / width >= 1.5, so rotated by 90 degrees


def test_quad_bounds_is_the_axis_aligned_box() -> None:
    quad = rectangle(100, 50, 80, 20, 0)

    assert quad_bounds(quad) == pytest.approx((60.0, 40.0, 80.0, 20.0))
