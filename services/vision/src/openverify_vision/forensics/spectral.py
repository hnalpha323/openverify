"""Screen recapture: moire on the document and the screen's pixel grid (C32.1).

Both scores look for isolated peaks in an averaged power spectrum (Welch: Hann-windowed,
half-overlapping square segments). A peak's prominence is its log power above the median of its
5x5 spectral neighbourhood; natural content, text and noise have a smooth spectrum, so their
largest prominence stays near what chance gives.

- ``screen_grid_score`` searches a centred window of at most :data:`GRID_MAX_SIDE` pixels of the
  upload at full resolution, at high frequencies (periods of 2 to 10 pixels), where a screen's
  pixel grid lands whether the camera resolves it or aliases it into fine hatching. The 8-pixel
  JPEG block grid's frequencies are excluded, so blocking does not read as a screen.
- ``moire_score`` searches the document downscaled to at most :data:`MOIRE_MAX_SIDE` pixels, at
  periods of 5 to 64 pixels and off both axes: moire bands beat at the camera's sampling angle,
  while the card's own patterns (text lines, monospaced characters, guilloche rows) are aligned
  with the rectified document and sit on the axes. A design printed with a fine oblique periodic
  pattern (diagonal guilloche, a checkerboard) has such peaks too, and reads as moire: the score
  is a cue for the H-tier checks, not a verdict.

Each prominence maps linearly to [0, 1] above its floor (what clean cards reach); the
thresholds that decide are TypeScript's.
"""

from __future__ import annotations

from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.forensics.geometry import fit_within
from openverify_vision.imaging import ImageArray, ensure_gray

GRID_MAX_SIDE: Final = 1024
"""Longest side of the full-resolution window searched for a pixel grid."""

MOIRE_MAX_SIDE: Final = 512
"""Longest side of the downscaled document searched for moire."""

GRID_SEGMENT: Final = 128
MOIRE_SEGMENT: Final = 256
MIN_SEGMENT: Final = 32
"""Windows that cannot hold a segment this large are not measured (score 0)."""

GRID_BAND: Final = (0.1, 0.5)
"""Radial frequencies, in cycles per pixel, searched for a pixel grid."""

MOIRE_BAND: Final = (1 / 64, 1 / 5)
"""Radial frequencies, in cycles per pixel of the downscaled document, searched for moire."""

JPEG_HARMONICS: Final = 4
"""The JPEG block grid's frequencies ``k / 8`` (k = 1-4) on either axis are excluded."""

EXCLUDED_BINS: Final = 1.5
"""Half-width, in frequency bins, of each excluded JPEG frequency."""

AXIS_BINS: Final = 2.5
"""Half-width, in frequency bins, of the axes excluded from the moire search."""

GRID_FLOOR: Final = 2.0
GRID_SPAN: Final = 4.0
MOIRE_FLOOR: Final = 2.5
MOIRE_SPAN: Final = 3.5
"""A prominence (natural log of the power ratio) at the floor scores 0, at floor + span 1."""

BACKGROUND_KERNEL: Final = 5
_SCORE_DECIMALS: Final = 4


def _segment(shape: tuple[int, ...], preferred: int) -> int | None:
    segment = preferred
    while segment > min(shape[:2]):
        segment //= 2
    return segment if segment >= MIN_SEGMENT else None


def _power_spectrum(image: NDArray[np.float64], segment: int) -> NDArray[np.float64]:
    """Welch's averaged power spectrum of ``image`` over ``segment``-pixel square segments,
    DC at the centre."""
    step = segment // 2
    windows = np.lib.stride_tricks.sliding_window_view(image, (segment, segment))[::step, ::step]
    tiles = windows.reshape(-1, segment, segment)
    hann = np.outer(np.hanning(segment), np.hanning(segment))
    centred = (tiles - tiles.mean(axis=(1, 2), keepdims=True)) * hann
    power = np.square(np.abs(np.fft.fft2(centred))).mean(axis=0)
    return np.asarray(np.fft.fftshift(power), dtype=np.float64)


def _frequencies(segment: int) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    f = np.fft.fftshift(np.fft.fftfreq(segment))
    fx, fy = np.meshgrid(f, f)
    return fx, fy


def _prominence(power: NDArray[np.float64], band: NDArray[np.bool_]) -> float:
    """The largest log power above its 5x5 median neighbourhood, inside ``band``."""
    floor = float(power.max()) * 1e-12 + np.finfo(np.float64).tiny
    log_power = np.log(power + floor).astype(np.float32)
    background = cv2.medianBlur(log_power, BACKGROUND_KERNEL)
    above = (log_power - background)[band]
    return float(above.max()) if above.size else 0.0


def _score(prominence: float, floor: float, span: float) -> float:
    return round(min(1.0, max(0.0, (prominence - floor) / span)), _SCORE_DECIMALS)


def _centre_crop(grey: ImageArray, side: int) -> ImageArray:
    height, width = grey.shape
    top, left = max(0, (height - side) // 2), max(0, (width - side) // 2)
    return grey[top : top + side, left : left + side]


def screen_grid_score(grey: ImageArray) -> float:
    """Periodic pixel-grid energy of the upload (grey or BGR), in [0, 1]."""
    window = _centre_crop(ensure_gray(grey), GRID_MAX_SIDE)
    segment = _segment(window.shape, GRID_SEGMENT)
    if segment is None:
        return 0.0
    power = _power_spectrum(window.astype(np.float64), segment)
    fx, fy = _frequencies(segment)
    radius = np.hypot(fx, fy)
    band = (radius >= GRID_BAND[0]) & (radius <= GRID_BAND[1])
    tolerance = EXCLUDED_BINS / segment
    for k in range(1, JPEG_HARMONICS + 1):
        band &= np.abs(np.abs(fx) - k / 8) > tolerance
        band &= np.abs(np.abs(fy) - k / 8) > tolerance
    return _score(_prominence(power, band), GRID_FLOOR, GRID_SPAN)


def moire_score(grey: ImageArray) -> float:
    """Isolated spectral peaks off the axes of the document (grey or BGR), in [0, 1]."""
    work, _ = fit_within(ensure_gray(grey), MOIRE_MAX_SIDE)
    segment = _segment(work.shape, MOIRE_SEGMENT)
    if segment is None:
        return 0.0
    power = _power_spectrum(work.astype(np.float64), segment)
    fx, fy = _frequencies(segment)
    radius = np.hypot(fx, fy)
    axis = AXIS_BINS / segment
    band = (radius >= MOIRE_BAND[0]) & (radius <= MOIRE_BAND[1])
    band &= (np.abs(fx) > axis) & (np.abs(fy) > axis)
    return _score(_prominence(power, band), MOIRE_FLOOR, MOIRE_SPAN)
