"""Discontinuities across the portrait's frame (C32.1).

The portrait photo is a rectangle around the face. On each side of the face box, the frame is
the gradient line (mean absolute Sobel response along the face's extent) nearest the face among
those at least :data:`EDGE_SHARE` of the strongest, searched from :data:`SEARCH_NEAR` to
:data:`SEARCH_FAR` face sizes beyond the box; a side whose strongest line does not stand out
(:data:`EDGE_PROMINENCE` times the median) has no frame. Across each frame line, a band just
inside and a band just outside are compared: their noise, the mean absolute response of a
Laplacian-like 3x3 kernel (Immerkaer, 1996) over their flattest pixels. A card photographed as
printed has the camera's noise on both sides; a portrait pasted in digitally carries its own
(none, more, or a JPEG's). Noise is read only where a pixel's whole 5x5 neighbourhood is flat,
so the edges of fine print next to the frame do not count as noise. The score is the mean of
``|ln(noise inside / noise outside)|`` over the sides with a frame, relative to ``ln 3``, in
[0, 1]; ``None`` (not measured) when no side has a frame with a band on each side of it inside
the image, or the face box lies outside the image.

The document is measured on a copy of at most :data:`PORTRAIT_MAX_SIDE` pixels a side.
"""

from __future__ import annotations

import math
from typing import Final, Literal

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.forensics.geometry import fit_within
from openverify_vision.imaging import ImageArray, ensure_gray
from openverify_vision.schemas import BoundingBox

PORTRAIT_MAX_SIDE: Final = 2048

SEARCH_NEAR: Final = 0.03
SEARCH_FAR: Final = 0.8
"""The frame is searched this many face widths (or heights) beyond the face box."""
EDGE_PROMINENCE: Final = 3.0
EDGE_SHARE: Final = 0.4
BAND_GAP: Final = 4
"""Pixels skipped on each side of the frame line (the line itself, a printed border)."""
BAND_SHARE: Final = 0.12
MIN_BAND_WIDTH: Final = 8
FLAT_SHARE: Final = 0.3
"""The flattest share of a band's pixels (lowest neighbourhood gradient) carries its noise."""
FLAT_NEIGHBOURHOOD: Final = 5
"""A pixel's flatness is the largest gradient within this many pixels a side around it."""
MIN_BAND_PIXELS: Final = 20
NOISE_FLOOR: Final = 0.5
"""Grey levels added to both noise estimates: quantization makes clean bands about 0."""
FULL_RATIO: Final = math.log(3.0)

_NOISE_KERNEL: Final = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float64)
_MEAN_TO_SIGMA: Final = math.sqrt(math.pi / 2.0) / 6.0
"""The kernel's response to white noise of sigma 1 has a standard deviation of 6, and a mean
absolute value of 6 * sqrt(2 / pi) (Immerkaer's estimator)."""
_SCORE_DECIMALS: Final = 4

Side = Literal["left", "right", "top", "bottom"]

__all__ = ["PORTRAIT_MAX_SIDE", "fit_within", "portrait_boundary_score"]


def _frame_line(
    profile: NDArray[np.float64], low: float, high: float, *, outward: int
) -> int | None:
    """The frame line's index in ``profile[low:high]``: the prominent line nearest the face
    (the face lies past ``high`` when ``outward`` is -1, before ``low`` when it is +1)."""
    first, last = max(1, math.floor(low)), min(len(profile) - 2, math.ceil(high))
    if last <= first:
        return None
    segment = profile[first : last + 1]
    peak = float(segment.max())
    if peak < EDGE_PROMINENCE * float(np.median(segment)) + 1.0:
        return None
    strong = np.flatnonzero(segment >= EDGE_SHARE * peak)
    return first + int(strong[-1] if outward < 0 else strong[0])


def _noise(
    residual: NDArray[np.float64], gradient: NDArray[np.float64], band: tuple[slice, slice]
) -> float | None:
    values, slopes = residual[band].ravel(), gradient[band].ravel()
    if values.size < MIN_BAND_PIXELS:
        return None
    flat = slopes <= np.quantile(slopes, FLAT_SHARE)
    return float(values[flat].mean()) * _MEAN_TO_SIGMA


def _bands(
    side: Side, line: int, span: tuple[int, int], width: int
) -> tuple[tuple[slice, slice], tuple[slice, slice]]:
    """The bands inside (toward the face) and outside the frame ``line`` of ``side``."""
    start, end = span
    along = slice(start, end)
    toward = 1 if side in ("left", "top") else -1
    inside = (line + toward * BAND_GAP, line + toward * (BAND_GAP + width))
    outside = (line - toward * (BAND_GAP + width), line - toward * BAND_GAP)
    across_in = slice(*(max(0, end) for end in sorted(inside)))
    across_out = slice(*(max(0, end) for end in sorted(outside)))
    if side in ("left", "right"):
        return (along, across_in), (along, across_out)
    return (across_in, along), (across_out, along)


def portrait_boundary_score(grey: ImageArray, face_box: BoundingBox) -> float | None:
    """Noise discontinuity across the portrait frame around ``face_box`` (in ``grey``'s
    pixels), in [0, 1]; ``None`` when no frame is found."""
    work, scale = fit_within(ensure_gray(grey), PORTRAIT_MAX_SIDE)
    height, width = work.shape
    x, y, w, h = (value * scale for value in face_box)
    left, top = max(0.0, x), max(0.0, y)
    right, bottom = min(float(width), x + w), min(float(height), y + h)
    if right - left < 1.0 or bottom - top < 1.0:
        return None
    image = work.astype(np.float64)
    gx = np.abs(cv2.Sobel(image, cv2.CV_64F, 1, 0))
    gy = np.abs(cv2.Sobel(image, cv2.CV_64F, 0, 1))
    neighbourhood = np.ones((FLAT_NEIGHBOURHOOD, FLAT_NEIGHBOURHOOD), dtype=np.uint8)
    gradient = np.asarray(cv2.dilate(np.hypot(gx, gy), neighbourhood), dtype=np.float64)
    residual = np.abs(cv2.filter2D(image, cv2.CV_64F, _NOISE_KERNEL))
    rows = (round(top), max(round(top) + 1, round(bottom)))
    columns = (round(left), max(round(left) + 1, round(right)))
    columns_profile = gx[rows[0] : rows[1]].mean(axis=0)
    rows_profile = gy[:, columns[0] : columns[1]].mean(axis=1)
    lines: dict[Side, tuple[int | None, tuple[int, int]]] = {
        "left": (
            _frame_line(columns_profile, x - SEARCH_FAR * w, x - SEARCH_NEAR * w, outward=-1),
            rows,
        ),
        "right": (
            _frame_line(
                columns_profile, x + w + SEARCH_NEAR * w, x + w + SEARCH_FAR * w, outward=1
            ),
            rows,
        ),
        "top": (
            _frame_line(rows_profile, y - SEARCH_FAR * h, y - SEARCH_NEAR * h, outward=-1),
            columns,
        ),
        "bottom": (
            _frame_line(rows_profile, y + h + SEARCH_NEAR * h, y + h + SEARCH_FAR * h, outward=1),
            columns,
        ),
    }
    band_width = max(MIN_BAND_WIDTH, round(BAND_SHARE * w))
    ratios = []
    for side, (line, span) in lines.items():
        if line is None:
            continue
        inside, outside = _bands(side, line, span, band_width)
        noise_in, noise_out = (
            _noise(residual, gradient, inside),
            _noise(residual, gradient, outside),
        )
        if noise_in is not None and noise_out is not None:
            ratios.append(abs(math.log((noise_in + NOISE_FLOOR) / (noise_out + NOISE_FLOOR))))
    if not ratios:
        return None
    return round(min(1.0, math.fsum(ratios) / len(ratios) / FULL_RATIO), _SCORE_DECIMALS)
