"""Colour statistics of the document: saturation, colourfulness, regional cast (C32.1).

- ``mean_saturation``: the mean HSV saturation, in [0, 1], over pixels bright enough for it to
  mean something (HSV value of at least :data:`MIN_VALUE`); a greyscale photocopy is about 0.
- ``colorfulness``: Hasler and Suesstrunk's (2003) metric on the 0-255 scale,
  ``sqrt(sd(rg)^2 + sd(yb)^2) + 0.3 * sqrt(mean(rg)^2 + mean(yb)^2)`` with ``rg = R - G`` and
  ``yb = (R + G) / 2 - B``; not bounded by 1.
- ``color_cast_score``: on a 4x4 grid of the document, the log-chromaticity
  ``(ln(R/G), ln(B/G))`` of each cell's most neutral quarter (its pixels nearest the document's
  median chromaticity, none clipped or near black), and how far the most deviant cell's lies
  from the median cell's, mapped to [0, 1] at :data:`CAST_FULL_SCALE`. A cast over the whole
  document (the light, the white balance) multiplies each channel everywhere alike, which in
  log-chromaticity moves every cell by the same amount, so it scores as low as no cast; a cast
  confined to a region scores high. A cast on a region smaller than a cell is diluted by the
  cell's other pixels: the score is a cue, not a verdict.

Statistics are taken on a copy of at most :data:`CHROMA_MAX_SIDE` (cast: :data:`CAST_MAX_SIDE`)
pixels a side.
"""

from __future__ import annotations

from typing import Final

import cv2
import numpy as np

from openverify_vision.forensics.geometry import fit_within
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.schemas import ChromaStats

CHROMA_MAX_SIDE: Final = 512
CAST_MAX_SIDE: Final = 256

MIN_VALUE: Final = 32
"""HSV value (0-255) below which a pixel's saturation is noise."""

CAST_GRID: Final = 4
CAST_SHARE: Final = 0.25
"""The share of each cell's usable pixels, nearest the document's chromaticity first, that sets
its cast."""
CAST_LEVELS: Final = (20, 250)
"""Usable pixels have every channel strictly inside this range: no ink black, no clipping
(a clipped channel breaks the multiplicative model)."""
MIN_CELL_SHARE: Final = 0.1
MIN_CELL_PIXELS: Final = 4
MIN_CELLS: Final = 3
MIN_USABLE_PIXELS: Final = 16
CAST_FULL_SCALE: Final = 0.3
"""Log-chromaticity offset that scores 1: about a 35% gain on one channel."""

_SCORE_DECIMALS: Final = 4
_COLORFULNESS_DECIMALS: Final = 2

__all__ = [
    "CAST_MAX_SIDE",
    "CHROMA_MAX_SIDE",
    "chroma_stats",
    "color_cast_score",
    "fit_within",
]


def chroma_stats(bgr: ImageArray) -> ChromaStats:
    """Mean saturation and Hasler-Suesstrunk colourfulness of ``bgr``."""
    work, _ = fit_within(ensure_bgr(bgr), CHROMA_MAX_SIDE)
    hsv = cv2.cvtColor(work, cv2.COLOR_BGR2HSV)
    lit = hsv[:, :, 2] >= MIN_VALUE
    saturation = float(hsv[:, :, 1][lit].mean()) / 255.0 if lit.any() else 0.0
    pixels = work.astype(np.float64)
    blue, green, red = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
    rg = red - green
    yb = (red + green) / 2.0 - blue
    colorfulness = float(np.hypot(rg.std(), yb.std()) + 0.3 * np.hypot(rg.mean(), yb.mean()))
    return ChromaStats(
        mean_saturation=round(min(1.0, saturation), _SCORE_DECIMALS),
        colorfulness=round(colorfulness, _COLORFULNESS_DECIMALS),
    )


def color_cast_score(bgr: ImageArray) -> float:
    """How far the most deviant region's neutral tone departs from the document's, in [0, 1]."""
    work, _ = fit_within(ensure_bgr(bgr), CAST_MAX_SIDE)
    pixels = work.astype(np.float64)
    blue, green, red = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
    usable = (pixels.min(axis=2) > CAST_LEVELS[0]) & (pixels.max(axis=2) < CAST_LEVELS[1])
    if int(usable.sum()) < MIN_USABLE_PIXELS:
        return 0.0
    chromaticity = np.stack([np.log((red + 1) / (green + 1)), np.log((blue + 1) / (green + 1))], -1)
    reference = np.median(chromaticity[usable], axis=0)
    distance = np.hypot(*(chromaticity - reference).transpose(2, 0, 1))
    height, width = usable.shape
    casts = []
    for row in range(CAST_GRID):
        for column in range(CAST_GRID):
            rows = slice(row * height // CAST_GRID, (row + 1) * height // CAST_GRID)
            columns = slice(column * width // CAST_GRID, (column + 1) * width // CAST_GRID)
            cell = usable[rows, columns]
            count = int(cell.sum())
            if count < max(MIN_CELL_PIXELS, MIN_CELL_SHARE * cell.size):
                continue
            keep = max(1, int(count * CAST_SHARE))
            nearest = np.argpartition(distance[rows, columns][cell], keep - 1)[:keep]
            casts.append(chromaticity[rows, columns][cell][nearest].mean(axis=0))
    if len(casts) < MIN_CELLS:
        return 0.0
    offsets = np.asarray(casts) - np.median(np.asarray(casts), axis=0)
    deviation = float(np.hypot(offsets[:, 0], offsets[:, 1]).max())
    return round(min(1.0, deviation / CAST_FULL_SCALE), _SCORE_DECIMALS)
