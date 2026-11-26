"""C60.1: error level analysis of a document photo's text lines against each other.

A document has no portrait to hold the rest against (as :mod:`.ela` does for an ID), so each
text line (an OCR box) is held against the others: its 16x16 cells' JPEG-ghost curves (the error
across the re-save ladder of :data:`~openverify_vision.forensics.ela.ELA_QUALITIES`, normalised
per cell) are averaged, and the score is the largest gap, over the ladder, between one line's
curve and the median curve of the other lines, in [0, 1]. A pasted amount, name or address
re-compresses differently from the text around it. JPEG uploads only; ``None`` when fewer than
:data:`MIN_LINES` lines have cells whose error varies.
"""

from __future__ import annotations

import io
import math
from collections.abc import Sequence
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageChops

from openverify_vision.forensics.ela import CELL, ELA_MAX_SIDE, ELA_QUALITIES, MIN_SPREAD
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.schemas import BoundingBox

MIN_LINES: Final = 4
MIN_LINE_CELLS: Final = 2

BLOCK: Final = 8
_SCORE_DECIMALS: Final = 4


def _error_cells(luma: ImageArray, quality: int) -> NDArray[np.float64]:
    """The mean squared re-save error of each cell of ``luma`` at ``quality``."""
    original = Image.fromarray(luma, mode="L")
    buffer = io.BytesIO()
    original.save(buffer, format="JPEG", quality=quality)
    with Image.open(buffer) as resaved:
        difference = ImageChops.difference(original, resaved.convert("L"))
    squared = np.square(np.asarray(difference, dtype=np.float64))
    height, width = squared.shape
    return squared.reshape(height // CELL, CELL, width // CELL, CELL).mean(axis=(1, 3))


def _span(low: float, high: float, grid: int, limit: int) -> tuple[int, int]:
    """A run of whole cells covering ``[low, high)``, starting on the JPEG grid, at most
    :data:`ELA_MAX_SIDE` long (centred when cut) and inside ``[0, limit)``."""
    start = max(0, math.floor(low))
    start -= (start - grid) % BLOCK if start >= grid else start
    end = min(limit, math.ceil(high))
    if end - start > ELA_MAX_SIDE:
        centre = (start + end) // 2
        start = max(0, centre - ELA_MAX_SIDE // 2)
        start -= (start - grid) % BLOCK if start >= grid else start
        end = min(limit, start + ELA_MAX_SIDE)
    length = max(0, end - start) // CELL * CELL
    return start, start + length


def text_cell_ela_score(
    bgr: ImageArray, boxes: Sequence[BoundingBox], *, offset: tuple[int, int]
) -> float | None:
    """The largest gap, over the re-save ladder, between one line's normalised ghost curve and
    the median curve of the other lines; ``None`` with fewer than :data:`MIN_LINES` measurable
    lines. ``boxes`` are the lines in ``bgr``'s pixels; ``offset`` is where a JPEG block starts."""
    image = ensure_bgr(bgr)
    height, width = image.shape[:2]
    inside = [
        (x, y, w, h) for x, y, w, h in boxes if x < width and y < height and x + w > 0 and y + h > 0
    ]
    if len(inside) < MIN_LINES:
        return None
    x0, x1 = _span(min(b[0] for b in inside), max(b[0] + b[2] for b in inside), offset[0], width)
    y0, y1 = _span(min(b[1] for b in inside), max(b[1] + b[3] for b in inside), offset[1], height)
    if x1 - x0 < CELL or y1 - y0 < CELL:
        return None
    luma = np.ascontiguousarray(cv2.cvtColor(image[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY), np.uint8)
    errors = np.stack([_error_cells(luma, quality) for quality in ELA_QUALITIES])
    low, high = errors.min(axis=0), errors.max(axis=0)
    varies = (high - low) >= MIN_SPREAD
    curves = (errors - low) / np.maximum(high - low, MIN_SPREAD)
    rows, columns = varies.shape
    centres_x = x0 + (np.arange(columns) + 0.5) * CELL
    centres_y = y0 + (np.arange(rows) + 0.5) * CELL
    lines: list[NDArray[np.float64]] = []
    for x, y, w, h in inside:
        cells = (
            ((centres_y >= y) & (centres_y < y + h))[:, None]
            & ((centres_x >= x) & (centres_x < x + w))[None, :]
            & varies
        )
        if int(cells.sum()) >= MIN_LINE_CELLS:
            lines.append(curves[:, cells].mean(axis=1))
    if len(lines) < MIN_LINES:
        return None
    stacked = np.stack(lines)
    gaps = []
    for index in range(len(lines)):
        others = np.median(np.delete(stacked, index, axis=0), axis=0)
        gaps.append(float(np.abs(stacked[index] - others).max()))
    return round(min(1.0, max(gaps)), _SCORE_DECIMALS)
