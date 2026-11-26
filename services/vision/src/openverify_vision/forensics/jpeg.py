"""JPEG compression history: quality, standard tables, double compression (C32.1).

- ``quality_estimate``: the IJG quality (1-100) whose scaled standard tables are nearest the
  upload's, in log ratio over every entry; ``standard_tables`` says whether they match exactly
  (libjpeg and Pillow write exactly these; cameras and editors often write their own).
- ``double_compression_score``: the periodicity of the block-DCT coefficient histograms,
  measured with ``cv2.dct`` on the decoded luminance, on the encoder's 8x8 grid (research §5).
  A JPEG decoded and saved again at a finer quality maps its first quantization onto the second
  unevenly, leaving periodic gaps in each low-frequency coefficient's histogram. For every mode in
  :data:`DQ_MODES` the histogram of ``|coefficient| / step`` (bins 1-64) is divided by its local
  trend, and the strongest share of its Fourier power is measured above the share that the same
  number of noise-like frequencies would reach by chance; the score is the mean of the three
  strongest modes, in [0, 1]. A single compression scores about 0. Saving again at the same or a
  coarser quality leaves nothing that can be told from a single compression, so it is not
  detected; saving again at quality 100 (a step of 1, whose comb spreads over many harmonics) is
  detected only weakly.

Every measurement samples at most :data:`MAX_DCT_BLOCKS` blocks.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.forensics.upload import UploadSource, upright_grid_offset
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.schemas import JpegForensics

IJG_LUMINANCE: Final[tuple[int, ...]] = (
    *(16, 11, 10, 16, 24, 40, 51, 61),
    *(12, 12, 14, 19, 26, 58, 60, 55),
    *(14, 13, 16, 24, 40, 57, 69, 56),
    *(14, 17, 22, 29, 51, 87, 80, 62),
    *(18, 22, 37, 56, 68, 109, 103, 77),
    *(24, 35, 55, 64, 81, 104, 113, 92),
    *(49, 64, 78, 87, 103, 121, 120, 101),
    *(72, 92, 95, 98, 112, 100, 103, 99),
)
"""ITU-T T.81 Annex K.1 luminance table, natural (row-major) order: IJG quality 50."""

IJG_CHROMINANCE: Final[tuple[int, ...]] = (
    *(17, 18, 24, 47, 99, 99, 99, 99),
    *(18, 21, 26, 66, 99, 99, 99, 99),
    *(24, 26, 56, 99, 99, 99, 99, 99),
    *(47, 66, 99, 99, 99, 99, 99, 99),
    *(99,) * 32,
)
"""ITU-T T.81 Annex K.2 chrominance table, natural order: IJG quality 50."""

MAX_DCT_BLOCKS: Final = 16384
"""Most 8x8 blocks one measurement transforms; larger images are sampled on a strided grid."""

MIN_DCT_BLOCKS: Final = 64
"""Fewer blocks than this are not measured."""

DQ_MODES: Final = (
    (0, 1),
    (1, 0),
    (1, 1),
    (0, 2),
    (2, 0),
    (1, 2),
    (2, 1),
    (2, 2),
    (0, 3),
    (3, 0),
    (1, 3),
    (3, 1),
)
"""Low-frequency AC coefficients ``(row, column)``: well populated and finely quantized."""

HISTOGRAM_BINS: Final = 64
MIN_BIN_COUNT: Final = 5
"""A histogram reaches as far as its last bin holding this many coefficients."""
MIN_HISTOGRAM_BINS: Final = 8
TREND_WIDTH: Final = 5
TOP_MODES: Final = 3
MIN_MODES: Final = 2

BLOCK: Final = 8
_LEVEL_SHIFT: Final = 128.0
_SCORE_DECIMALS: Final = 4

_BASIS: Final = np.asarray(cv2.dct(np.eye(BLOCK), flags=cv2.DCT_ROWS), dtype=np.float64).T
"""The orthonormal 8-point DCT-II matrix ``C`` (``cv2.dct`` of the identity's rows is
``C`` transposed), so a block's 2-D DCT is ``C @ block @ C.T``."""


def scaled_table(base: Sequence[int], quality: int) -> tuple[int, ...]:
    """``base`` scaled to IJG ``quality`` (1-100) exactly as libjpeg's ``jpeg_set_quality``
    does with ``force_baseline`` (entries kept in 1-255)."""
    quality = min(max(quality, 1), 100)
    scale = 5000 // quality if quality < 50 else 200 - 2 * quality  # noqa: PLR2004 - IJG
    return tuple(min(255, max(1, (value * scale + 50) // 100)) for value in base)


_LOG_LUMINANCE: Final = np.log(
    np.array([scaled_table(IJG_LUMINANCE, q) for q in range(1, 101)], dtype=np.float64)
)
_LOG_CHROMINANCE: Final = np.log(
    np.array([scaled_table(IJG_CHROMINANCE, q) for q in range(1, 101)], dtype=np.float64)
)


def _log_table(table: Sequence[int]) -> NDArray[np.float64]:
    return np.log(np.maximum(np.asarray(table, dtype=np.float64), 1.0))


def estimate_quality(tables: Mapping[int, Sequence[int]]) -> tuple[int, bool] | None:
    """The IJG quality whose standard tables are nearest ``tables`` (table 0 is luminance,
    any other 64-entry table chrominance), and whether they are exactly those tables.

    ``None`` without a 64-entry luminance table.
    """
    luminance = tables.get(0)
    if luminance is None or len(luminance) != BLOCK * BLOCK:
        return None
    distance = np.abs(_LOG_LUMINANCE - _log_table(luminance)).sum(axis=1)
    for table_id, table in tables.items():
        if table_id != 0 and len(table) == BLOCK * BLOCK:
            distance += np.abs(_LOG_CHROMINANCE - _log_table(table)).sum(axis=1)
    best = int(np.argmin(distance))
    return best + 1, bool(distance[best] == 0.0)


def _dct_8x8(blocks: NDArray[np.float64]) -> NDArray[np.float64]:
    """The 2-D DCT (``cv2.dct``'s orthonormal DCT-II) of each block of ``(n, 8, 8)``."""
    return np.asarray(_BASIS @ blocks @ _BASIS.T, dtype=np.float64)


_BGR_TO_LUMA: Final = np.array([0.114, 0.587, 0.299])


def _luma_blocks(image: ImageArray, offset: tuple[int, int]) -> NDArray[np.float64] | None:
    """Level-shifted luminance blocks on the grid starting at ``offset``, at most
    ``MAX_DCT_BLOCKS`` of them (a strided sample of block rows and columns); ``None`` below
    ``MIN_DCT_BLOCKS``."""
    ox, oy = offset
    height, width = image.shape[:2]
    rows, columns = max(0, (height - oy) // BLOCK), max(0, (width - ox) // BLOCK)
    if rows * columns < MIN_DCT_BLOCKS:
        return None
    stride = 1
    while math.ceil(rows / stride) * math.ceil(columns / stride) > MAX_DCT_BLOCKS:
        stride += 1
    region = image[oy : oy + rows * BLOCK, ox : ox + columns * BLOCK]
    tiled = region.reshape(rows, BLOCK, columns, BLOCK, 3)
    # ITU-R BT.601 luma, as JPEG's Y, of the sampled blocks only.
    luma = tiled[::stride, :, ::stride].astype(np.float64) @ _BGR_TO_LUMA
    blocks = luma.transpose(0, 2, 1, 3).reshape(-1, BLOCK, BLOCK)
    return np.asarray(blocks - _LEVEL_SHIFT, dtype=np.float64)


def _harmonic(n: int) -> float:
    return math.fsum(1.0 / k for k in range(1, n + 1))


def _periodicity(histogram: NDArray[np.int64]) -> float | None:
    """How much of the detrended histogram's Fourier power one frequency holds, above chance;
    ``None`` when the histogram is too short to tell."""
    populated = np.flatnonzero(histogram >= MIN_BIN_COUNT)
    if populated.size == 0 or populated[-1] + 1 < MIN_HISTOGRAM_BINS:
        return None
    counts = histogram[: populated[-1] + 1].astype(np.float64)
    trend = np.convolve(counts, np.ones(TREND_WIDTH) / TREND_WIDTH, mode="same")
    residual = (counts - trend) / np.sqrt(trend + 1.0)
    residual -= residual.mean()
    power = np.abs(np.fft.rfft(residual))[1:] ** 2
    share = float(power.max()) / max(float(power.sum()), np.finfo(np.float64).tiny)
    # The expected largest share of n exponentially distributed powers is H(n) / n.
    chance = _harmonic(power.size) / power.size
    return max(0.0, (share - chance) / (1.0 - chance))


def double_compression_score(
    bgr: ImageArray, *, luma_table: Sequence[int], offset: tuple[int, int]
) -> float | None:
    """Periodicity of the block-DCT coefficient histograms of ``bgr`` (BGR or grey, decoded
    from a JPEG whose luminance table is ``luma_table``, natural order) on the grid starting at
    ``offset``; ``None`` when too few blocks or modes can be measured."""
    blocks = _luma_blocks(ensure_bgr(bgr), offset)
    if blocks is None or len(luma_table) != BLOCK * BLOCK:
        return None
    coefficients = _dct_8x8(blocks)
    steps = np.asarray(luma_table, dtype=np.float64).reshape(BLOCK, BLOCK)
    scores = []
    for row, column in DQ_MODES:
        levels = np.rint(np.abs(coefficients[:, row, column]) / steps[row, column]).astype(np.int64)
        kept = levels[(levels >= 1) & (levels <= HISTOGRAM_BINS)]
        histogram = np.bincount(kept, minlength=HISTOGRAM_BINS + 1)[1:]
        score = _periodicity(histogram)
        if score is not None:
            scores.append(score)
    if len(scores) < MIN_MODES:
        return None
    strongest = sorted(scores, reverse=True)[:TOP_MODES]
    return round(min(1.0, math.fsum(strongest) / len(strongest)), _SCORE_DECIMALS)


def jpeg_forensics(source: UploadSource, bgr: ImageArray) -> JpegForensics | None:
    """The JPEG measurements of a JPEG upload whose upright decode is ``bgr``; ``None`` for
    another format."""
    if source.quantization is None:
        return None
    estimate = estimate_quality(source.quantization)
    luminance = source.quantization.get(0)
    score = (
        None
        if luminance is None
        else double_compression_score(
            bgr, luma_table=luminance, offset=upright_grid_offset(source, bgr.shape)
        )
    )
    return JpegForensics(
        quality_estimate=None if estimate is None else estimate[0],
        standard_tables=None if estimate is None else estimate[1],
        double_compression_score=score,
    )
