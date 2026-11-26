"""The REAL ID star: a five-pointed star in the upper part of the document (C32.1).

US cards that meet the REAL ID Act mark it with a star in their upper part (PLAN §4.1): gold or
black, filled, set in a disc, or cut out of one. The upper :data:`UPPER_SHARE` of the document is
binarized four ways (Otsu and a local mean threshold, each polarity), and every contour from
:data:`MIN_SIZE` to :data:`MAX_SIZE` of the document's width is compared with a regular
five-pointed star (inner radius 0.382 of the outer): Hu-moment distance (``cv2.matchShapes``,
invariant to scale and rotation) and solidity (a regular star fills about 0.47 of its convex
hull). The best contour's likeness is the score, in [0, 1]; at :data:`STAR_FOUND_SCORE` or more
it is found and its box (in the document's pixels) is returned. Whether the card is REAL ID
compliant is TypeScript's decision, with the barcode's ``DDA`` field.

The document is searched on a copy of at most :data:`STAR_MAX_SIDE` pixels a side.
"""

from __future__ import annotations

import math
from collections.abc import Iterator
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.forensics.geometry import fit_within
from openverify_vision.imaging import ImageArray, ensure_gray
from openverify_vision.schemas import BoundingBox, StarGlyph

STAR_MAX_SIDE: Final = 800
UPPER_SHARE: Final = 0.45
"""The share of the document's height, from the top, that is searched."""
MIN_SIZE: Final = 0.025
MAX_SIZE: Final = 0.25
"""A candidate's larger side, as a share of the document's width."""
STAR_FOUND_SCORE: Final = 0.6

INNER_RATIO: Final = 0.382
"""Inner over outer radius of a regular five-pointed star."""
SHAPE_WEIGHT: Final = 8.0
"""``exp(-SHAPE_WEIGHT * distance)``: a Hu-moment distance of 0.05 keeps two thirds."""
STAR_SOLIDITY: Final = 0.47
SOLIDITY_SPREAD: Final = 0.12
LOCAL_BLOCK: Final = 31
LOCAL_OFFSET: Final = 5
MIN_SEARCH_SIDE: Final = 8

_SCORE_DECIMALS: Final = 4
_BOX_DECIMALS: Final = 2
NOT_FOUND: Final = StarGlyph(found=False, score=0.0, box=None)

__all__ = ["NOT_FOUND", "STAR_FOUND_SCORE", "STAR_MAX_SIDE", "find_star_glyph", "fit_within"]


def _template() -> NDArray[np.float32]:
    points = []
    for i in range(10):
        angle = math.radians(-90 + i * 36)
        radius = 1.0 if i % 2 == 0 else INNER_RATIO
        points.append((100 + 100 * radius * math.cos(angle), 100 + 100 * radius * math.sin(angle)))
    return np.array(points, dtype=np.float32).reshape(-1, 1, 2)


_TEMPLATE: Final = _template()


def _binarizations(grey: ImageArray) -> Iterator[ImageArray]:
    _, otsu = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binary = np.asarray(otsu, dtype=np.uint8)
    yield binary
    yield np.asarray(255 - binary, dtype=np.uint8)
    for polarity in (cv2.THRESH_BINARY, cv2.THRESH_BINARY_INV):
        local = cv2.adaptiveThreshold(
            grey, 255, cv2.ADAPTIVE_THRESH_MEAN_C, polarity, LOCAL_BLOCK, LOCAL_OFFSET
        )
        yield np.asarray(local, dtype=np.uint8)


def _likeness(contour: NDArray[np.int32]) -> float:
    """How much ``contour`` looks like a regular five-pointed star, in [0, 1]."""
    hull_area = cv2.contourArea(cv2.convexHull(contour))
    if hull_area <= 0:
        return 0.0
    solidity = cv2.contourArea(contour) / hull_area
    distance = cv2.matchShapes(contour, _TEMPLATE, cv2.CONTOURS_MATCH_I1, 0.0)
    shape = math.exp(-SHAPE_WEIGHT * distance)
    fill = math.exp(-(((solidity - STAR_SOLIDITY) / SOLIDITY_SPREAD) ** 2))
    return shape * fill


def find_star_glyph(bgr: ImageArray) -> StarGlyph:
    """The best five-pointed star in the upper part of ``bgr`` (grey or BGR)."""
    work, scale = fit_within(ensure_gray(bgr), STAR_MAX_SIDE)
    height, width = work.shape
    upper = np.ascontiguousarray(work[: math.ceil(height * UPPER_SHARE)])
    if min(upper.shape) < MIN_SEARCH_SIDE:
        return NOT_FOUND
    best, best_box = 0.0, None
    for binary in _binarizations(upper):
        contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if not MIN_SIZE * width <= max(w, h) <= MAX_SIZE * width:
                continue
            likeness = _likeness(np.asarray(contour, dtype=np.int32))
            if likeness > best:
                best, best_box = likeness, (x, y, w, h)
    score = round(min(1.0, best), _SCORE_DECIMALS)
    if score < STAR_FOUND_SCORE or best_box is None:
        return StarGlyph(found=False, score=score, box=None)
    left, top, box_width, box_height = (round(v / scale, _BOX_DECIMALS) for v in best_box)
    box: BoundingBox = (left, top, box_width, box_height)
    return StarGlyph(found=True, score=score, box=box)
