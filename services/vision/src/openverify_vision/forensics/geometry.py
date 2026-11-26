"""Coordinates between the upload and the rectified document (C32.1).

A found document has a quad on the upload (clockwise from the top left) and a rectified copy of
``rectified_size``; the rectified copy's corners ``(0, 0)``, ``(w, 0)``, ``(w, h)`` and
``(0, h)`` are the quad's corners. A homography that would not be finite, or that is singular
(a degenerate quad), is ``None``: nothing is mapped through it.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.imaging import ImageArray
from openverify_vision.schemas import BoundingBox, DocumentDetection, Point

Homography = NDArray[np.float64]
"""A 3x3 perspective transform."""

MAX_CONDITION: Final = 1e10
"""A homography worse conditioned than this comes from a degenerate quad."""

_MIN_W: Final = 1e-9
"""Points mapped to (or behind) the horizon have no image."""


def _corners(width: float, height: float) -> NDArray[np.float32]:
    return np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)


def _perspective(src: NDArray[np.float32], dst: NDArray[np.float32]) -> Homography | None:
    matrix = np.asarray(cv2.getPerspectiveTransform(src, dst), dtype=np.float64)
    if not np.all(np.isfinite(matrix)) or np.linalg.cond(matrix) > MAX_CONDITION:
        return None
    return matrix


def _quad_and_size(
    detection: DocumentDetection,
) -> tuple[NDArray[np.float32], NDArray[np.float32]] | None:
    if detection.quad is None or detection.rectified_size is None:
        return None
    width, height = detection.rectified_size
    return np.array(detection.quad, dtype=np.float32), _corners(width, height)


def rectified_to_upload(detection: DocumentDetection) -> Homography | None:
    """From rectified-document pixels to upload pixels; ``None`` without a usable document."""
    pair = _quad_and_size(detection)
    return None if pair is None else _perspective(pair[1], pair[0])


def upload_to_rectified(detection: DocumentDetection) -> Homography | None:
    """From upload pixels to rectified-document pixels; ``None`` without a usable document."""
    pair = _quad_and_size(detection)
    return None if pair is None else _perspective(pair[0], pair[1])


def map_points(homography: Homography, points: Sequence[Point]) -> list[Point] | None:
    """``points`` through ``homography``; ``None`` if any lands at infinity."""
    if not points:
        return []
    source = np.array(points, dtype=np.float64)
    homogeneous = np.hstack([source, np.ones((len(points), 1))]) @ homography.T
    w = homogeneous[:, 2]
    if np.any(np.abs(w) < _MIN_W):
        return None
    mapped = homogeneous[:, :2] / w[:, None]
    return [(float(x), float(y)) for x, y in mapped]


def map_box(
    homography: Homography, box: BoundingBox, *, bounds: tuple[int, int]
) -> BoundingBox | None:
    """The bounding box of ``box``'s corners mapped through ``homography``, clipped to
    ``bounds`` (width, height); ``None`` when less than a pixel of it is left."""
    x, y, w, h = box
    mapped = map_points(homography, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
    if mapped is None:
        return None
    width, height = bounds
    xs = [min(max(p[0], 0.0), float(width)) for p in mapped]
    ys = [min(max(p[1], 0.0), float(height)) for p in mapped]
    left, top, right, bottom = min(xs), min(ys), max(xs), max(ys)
    if right - left < 1.0 or bottom - top < 1.0:
        return None
    return (left, top, right - left, bottom - top)


def document_mask(detection: DocumentDetection, shape: tuple[int, int]) -> NDArray[np.bool_]:
    """The document's pixels on an upload of ``shape`` (height, width): the quad's polygon, or
    every pixel when no document was found or its quad covers no pixel."""
    height, width = shape
    if detection.quad is None:
        return np.ones((height, width), dtype=bool)
    mask = np.zeros((height, width), dtype=np.uint8)
    polygon = np.rint(np.array(detection.quad, dtype=np.float64)).astype(np.int32)
    cv2.fillPoly(mask, [polygon], 255)
    covered = mask > 0
    return covered if covered.any() else np.ones((height, width), dtype=bool)


def mask_bounds(mask: NDArray[np.bool_]) -> tuple[int, int, int, int]:
    """``(left, top, right, bottom)`` (exclusive) of the true pixels of a non-empty mask."""
    rows = np.flatnonzero(mask.any(axis=1))
    columns = np.flatnonzero(mask.any(axis=0))
    return int(columns[0]), int(rows[0]), int(columns[-1]) + 1, int(rows[-1]) + 1


def fit_within(img: ImageArray, max_side: int) -> tuple[ImageArray, float]:
    """``img`` downscaled (area interpolation) so its longest side is at most ``max_side``, and
    the scale applied (1.0 when it already fits)."""
    height, width = img.shape[:2]
    longest = max(height, width)
    if longest <= max_side:
        return img, 1.0
    scale = max_side / longest
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    resized = np.asarray(cv2.resize(img, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)
    return resized, scale
