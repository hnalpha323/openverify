# Derived from RapidOCR v3.10.0 (https://github.com/RapidAI/RapidOCR, tag v3.10.0, commit
# bd941dae09da793e76c6ba15c7aaf40f8424232a): python/rapidocr/ch_ppocr_det/utils.py
# (DBPostProcess.get_mini_boxes, unclip, order_points_clockwise) and
# python/rapidocr/utils/process_img.py (get_rotate_crop_image).
# Copyright (c) 2021 RapidOCR Authors. Copyright (c) 2020 PaddlePaddle Authors.
# Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0);
# see services/vision/NOTICE.
#
# Changed by the OpenVerify authors: rewritten with type hints; ``unclip`` expands the box with
# OpenCV and NumPy instead of pyclipper and shapely (C33), and ``quad_bounds`` is new.
"""Box geometry of the text detector: minimum-area boxes, unclip, ordering and crops."""

from __future__ import annotations

import math
from typing import Any, Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.imaging import ImageArray
from openverify_vision.schemas import BoundingBox

Quad = NDArray[np.float32]
"""Four ``(x, y)`` corners, shape ``(4, 2)``."""

ARC_POINTS: Final = 32
"""Points per full turn approximating the round joins of the unclipped outline."""

TALL_LINE_RATIO: Final = 1.5
"""A crop at least this much taller than wide is a vertical line, turned on its side."""


def mini_box(points: NDArray[Any]) -> tuple[Quad, float]:
    """The minimum-area rectangle around ``points``, from its top-left corner clockwise, and
    the length of its shorter side."""
    rect = cv2.minAreaRect(np.asarray(points, dtype=np.float32).reshape(-1, 1, 2))
    corners = sorted(np.asarray(cv2.boxPoints(rect)).tolist(), key=lambda point: point[0])
    first, fourth = (0, 1) if corners[1][1] > corners[0][1] else (1, 0)
    second, third = (2, 3) if corners[3][1] > corners[2][1] else (3, 2)
    box = np.array(
        [corners[first], corners[second], corners[third], corners[fourth]], dtype=np.float32
    )
    return box, float(min(rect[1]))


def unclip(box: Quad, ratio: float) -> NDArray[np.float32]:
    """``box`` grown outwards by DB's unclip distance, ``area * ratio / perimeter``.

    RapidOCR offsets the polygon with pyclipper (round joins, closed polygon). For a convex
    polygon that offset is the Minkowski sum with a disc of that radius: each side moved out
    along its normal, joined by arcs around the corners. This builds the same outline from the
    moved sides and arc points and returns its convex hull, shape ``(N, 1, 2)``.
    """
    points = np.asarray(box, dtype=np.float32).reshape(-1, 2)
    perimeter = cv2.arcLength(points.reshape(-1, 1, 2), closed=True)
    if perimeter <= 0:
        return points.reshape(-1, 1, 2).copy()
    distance = cv2.contourArea(points.reshape(-1, 1, 2)) * ratio / perimeter

    angles = np.linspace(0.0, 2.0 * math.pi, ARC_POINTS, endpoint=False)
    disc = np.stack([np.cos(angles), np.sin(angles)], axis=1) * distance
    outline = [(points[:, None, :] + disc[None, :, :]).reshape(-1, 2)]
    following = np.roll(points, -1, axis=0)
    edges = following - points
    lengths = np.hypot(edges[:, 0], edges[:, 1])
    usable = lengths > 0
    normals = np.stack([edges[usable, 1], -edges[usable, 0]], axis=1) / lengths[usable, None]
    for sign in (1.0, -1.0):  # either orientation; the hull keeps the outer side
        shift = sign * distance * normals
        outline.extend((points[usable] + shift, following[usable] + shift))
    hull = cv2.convexHull(np.concatenate(outline).astype(np.float32))
    return np.asarray(hull, dtype=np.float32)


def order_points_clockwise(points: Quad) -> Quad:
    """The corners of ``points`` as top-left, top-right, bottom-right, bottom-left."""
    by_x = points[np.argsort(points[:, 0], kind="stable"), :]
    left, right = by_x[:2], by_x[2:]
    top_left, bottom_left = left[np.argsort(left[:, 1], kind="stable"), :]
    top_right, bottom_right = right[np.argsort(right[:, 1], kind="stable"), :]
    return np.array([top_left, top_right, bottom_right, bottom_left], dtype=np.float32)


def rotate_crop(img: ImageArray, quad: Quad) -> ImageArray:
    """The quadrilateral ``quad`` of ``img`` warped to an upright rectangle; a crop at least
    1.5 times taller than wide is a vertical line, turned by 90 degrees."""
    points = np.asarray(quad, dtype=np.float32)
    width = int(max(np.linalg.norm(points[0] - points[1]), np.linalg.norm(points[2] - points[3])))
    height = int(max(np.linalg.norm(points[0] - points[3]), np.linalg.norm(points[1] - points[2])))
    target = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    transform = cv2.getPerspectiveTransform(points, target)
    crop = cv2.warpPerspective(
        img,
        transform,
        (width, height),
        borderMode=cv2.BORDER_REPLICATE,
        flags=cv2.INTER_CUBIC,
    )
    if crop.shape[0] >= TALL_LINE_RATIO * crop.shape[1]:
        crop = np.rot90(crop)
    return np.ascontiguousarray(crop, dtype=np.uint8)


def quad_bounds(quad: Quad) -> BoundingBox:
    """The axis-aligned ``(x, y, width, height)`` around ``quad``."""
    xs, ys = quad[:, 0], quad[:, 1]
    x, y = float(xs.min()), float(ys.min())
    return (x, y, float(xs.max()) - x, float(ys.max()) - y)
