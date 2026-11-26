"""Error level analysis of the portrait against the rest of the document (C32.1).

The luminance is re-saved at each fixed quality of :data:`ELA_QUALITIES` and compared with
``ImageChops.difference``. A re-save changes most what was never compressed near that quality,
so a region's error across the ladder traces its JPEG history, but it also grows with the
region's texture. Normalising each 16x16 cell's errors across the ladder (the "JPEG ghost" of
Farid, 2009) removes the texture's scale and keeps the history's shape. The score is the largest
gap, over the ladder, between the mean normalised curves of the portrait (the face box) and of
the rest of the document (outside twice the face box), in [0, 1].

The window is aligned to the upload's JPEG block grid (so a re-save re-quantizes the encoder's
own blocks) and capped at :data:`ELA_MAX_SIDE` pixels a side, centred on the portrait. Without a
portrait (the back of a card, or no face) there is nothing to compare, and the score is 0; it is
0 too when either region has fewer than :data:`MIN_CELLS` cells whose error varies.
"""

from __future__ import annotations

import io
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageChops

from openverify_vision.forensics.geometry import mask_bounds
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.schemas import BoundingBox

ELA_QUALITIES: Final = (30, 45, 60, 75, 90)
"""The fixed re-save qualities."""

ELA_MAX_SIDE: Final = 2048
"""Longest side of the window that is re-saved."""

CELL: Final = 16
"""Errors are averaged over 16x16 pixel cells (two JPEG blocks a side)."""

SURROUND: Final = 2.0
"""The rest of the document starts outside the face box scaled by this, about its centre."""

MIN_SPREAD: Final = 0.5
"""A cell whose mean squared error varies less than this across the ladder has no history to
read (flat, or saturated)."""

MIN_CELLS: Final = 4

BLOCK: Final = 8
_SCORE_DECIMALS: Final = 4

Window = tuple[int, int, int, int]
"""``(left, top, right, bottom)``, right and bottom exclusive."""


def _resave(luma: ImageArray, quality: int) -> NDArray[np.float64]:
    """``|luma - JPEG(luma, quality)|`` per pixel, through ``ImageChops.difference``."""
    original = Image.fromarray(luma, mode="L")
    buffer = io.BytesIO()
    original.save(buffer, format="JPEG", quality=quality)
    with Image.open(buffer) as resaved:
        difference = ImageChops.difference(original, resaved.convert("L"))
    return np.asarray(difference, dtype=np.float64)


def _span(start: int, end: int, centre: float, grid: int, limit: int) -> tuple[int, int]:
    """A grid-aligned run of whole cells inside ``[start, end)`` (and ``[0, limit)``), at most
    ``ELA_MAX_SIDE`` long, centred on ``centre`` when it must be cut."""
    first = start - (start - grid) % BLOCK if start >= grid else grid
    length = min(end, limit) - first
    if length > ELA_MAX_SIDE:
        wanted = round(centre - ELA_MAX_SIDE / 2)
        wanted = min(max(wanted, first), min(end, limit) - ELA_MAX_SIDE)
        first = wanted - (wanted - grid) % BLOCK
        length = ELA_MAX_SIDE
    return first, first + max(0, length) // CELL * CELL


def _window(
    region: NDArray[np.bool_], portrait: BoundingBox, offset: tuple[int, int]
) -> Window | None:
    height, width = region.shape
    if not region.any():
        return None
    left, top, right, bottom = mask_bounds(region)
    x, y, w, h = portrait
    x0, x1 = _span(left, right, x + w / 2, offset[0], width)
    y0, y1 = _span(top, bottom, y + h / 2, offset[1], height)
    if x1 - x0 < CELL * MIN_CELLS or y1 - y0 < CELL * MIN_CELLS:
        return None
    return x0, y0, x1, y1


def _cells(values: NDArray[np.float64]) -> NDArray[np.float64]:
    height, width = values.shape
    return values.reshape(height // CELL, CELL, width // CELL, CELL).mean(axis=(1, 3))


def _box_cells(box: BoundingBox, window: Window, shape: tuple[int, int]) -> NDArray[np.bool_]:
    """Cells of ``window`` whose centre lies inside ``box`` (upload pixels)."""
    x0, y0, _, _ = window
    rows, columns = shape
    centres_x = x0 + (np.arange(columns) + 0.5) * CELL
    centres_y = y0 + (np.arange(rows) + 0.5) * CELL
    x, y, w, h = box
    inside_x = (centres_x >= x) & (centres_x < x + w)
    inside_y = (centres_y >= y) & (centres_y < y + h)
    return np.asarray(inside_y[:, None] & inside_x[None, :], dtype=bool)


def _scaled(box: BoundingBox, factor: float) -> BoundingBox:
    x, y, w, h = box
    return (x + w / 2 - w * factor / 2, y + h / 2 - h * factor / 2, w * factor, h * factor)


def ela_score(
    bgr: ImageArray,
    *,
    region: NDArray[np.bool_],
    portrait_box: BoundingBox | None,
    offset: tuple[int, int],
) -> float:
    """How differently the portrait re-compresses from the rest of the document.

    ``region`` marks the document's pixels on the upload, ``portrait_box`` is the face in upload
    pixels and ``offset`` where a JPEG block starts on the upload (``(0, 0)`` for a PNG).
    """
    if portrait_box is None:
        return 0.0
    window = _window(region, portrait_box, offset)
    if window is None:
        return 0.0
    x0, y0, x1, y1 = window
    luma = np.ascontiguousarray(
        cv2.cvtColor(ensure_bgr(bgr)[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY), dtype=np.uint8
    )
    errors = np.stack([_cells(np.square(_resave(luma, q))) for q in ELA_QUALITIES])
    low, high = errors.min(axis=0), errors.max(axis=0)
    varies = (high - low) >= MIN_SPREAD
    curves = (errors - low) / np.maximum(high - low, MIN_SPREAD)
    in_document = _cells(region[y0:y1, x0:x1].astype(np.float64)) >= 0.5  # noqa: PLR2004
    shape = (curves.shape[1], curves.shape[2])
    portrait = _box_cells(portrait_box, window, shape) & in_document & varies
    rest = ~_box_cells(_scaled(portrait_box, SURROUND), window, shape) & in_document & varies
    if portrait.sum() < MIN_CELLS or rest.sum() < MIN_CELLS:
        return 0.0
    gap = np.abs(curves[:, portrait].mean(axis=1) - curves[:, rest].mean(axis=1)).max()
    return round(min(1.0, float(gap)), _SCORE_DECIMALS)
