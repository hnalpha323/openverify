"""Face covering and glasses heuristics from landmark regions (C41.1, research §6).

H tier: no permissively licensed covering or glasses model with clean training data exists, so
both are measured with OpenCV and NumPy on regions placed by YuNet's five landmarks. Vision
measures; the ``selfie_face_covering_detection`` and ``selfie_glasses_detection`` evaluators
(TypeScript, beta, with a confidence) decide against ``max-face-covering-score`` and
``max-glasses-score``. Every weight and scale below is **provisional**, set from the geometry of
a face and of a frame, never fitted to a fixture; Workflow 4B reports their distributions on the
synthetic fixtures.

**Alignment.** The face is warped so the eye line is horizontal, the eye midpoint sits at
:data:`ALIGNED_EYES_AT` and the inter-ocular distance (IOD) is :data:`ALIGNED_IOD` pixels; a large
face is first scaled down with area averaging, so every face is measured at the same scale. Each
aligned pixel is valid when it maps inside the image. Regions are given in IOD units from the eye
midpoint (x toward the image's right, y down), the lower face from the nose tip and the mouth
corners.

**Covering** (a mask, a scarf, over the lower face), relative to the person's own forehead, so no
absolute skin colour is assumed:

- ``skin_fraction_ratio``: the share of skin pixels (the YCrCb box 133 <= Cr <= 173, 77 <= Cb <=
  127, Chai and Ngan 1999) in the lower face over the share in the forehead;
- ``texture_ratio``: the Laplacian variance of the lower face over the forehead's (each plus one);
- ``delta_e``: the CIE76 colour difference between the two regions' median L*a*b*;
- ``forehead_valid``: at least :data:`MIN_FOREHEAD_COVERAGE` of the forehead is on the image and
  at least :data:`MIN_FOREHEAD_SKIN` of it is skin. Without it (a hat, a fringe, grey input, a
  lighting the skin box misses) nothing is compared and ``score`` is 0: the evaluator answers
  ``input_missing`` from ``forehead_valid`` before it reads the score;
- ``score``: ``0.6 * (1 - skin ratio) + 0.25 * (delta_e - 10) / 40 + 0.15 * |ln texture| / ln 10``,
  each term clipped to [0, 1]. The skin share is the cue research §6 found to collapse under a
  mask (above 0.9 bare, at most 0.03 masked); a colour difference of about 10 is within one
  face's skin and lips (research measured 7.4 to 16.9 bare); an order of magnitude in texture is
  a different surface.

Known failure modes (unmeasured, research §6): skin-toned or patterned masks, beards, a hand,
dark skin or poor light outside the skin box (which reads as no reference, not as covered).

**Glasses** (a multi-cue score, not a nose-bridge gradient statistic: plan decision 12):

- ``bridge_edge_density``: the share of Canny edge pixels in the window between the eyes, where a
  frame's bridge crosses;
- ``rim_edge_energy``: in a band 0.15 to 0.35 IOD below each eye, the strongest vertical
  intensity step of each column (3 x 3 Sobel, 1 for a full black-to-white step), averaged; a
  frame's lower rim is a horizontal line across the band;
- ``lens_highlight_ratio``: the share of near-saturated, colourless pixels (the glare mask) in the
  lens regions around the eyes;
- ``score``: ``0.4 * bridge / 0.1 + 0.4 * rim / 0.2 + 0.2 * lens / 0.05``, each term clipped to
  [0, 1]: at 64 pixels per IOD, a 3 mm bridge bar crossing the window gives an edge density of
  about 0.1, and a rim of 20% contrast an energy of 0.2.

No single cue reaches 0.5, the provisional ``max-glasses-score``: a dark mask's top edge runs
through the rim bands and reads as a lower rim (0.4 at most without a bridge or a reflection).
Rimless glasses with a thin bridge and no reflection are expected to be missed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.faces import Face
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.quality import glare_mask
from openverify_vision.schemas import CoveringScores, GlassesScores, Occlusion

ALIGNED_IOD: Final = 64.0
"""Pixels per inter-ocular distance in the aligned face."""
ALIGNED_SIZE: Final = (192, 192)
"""``(width, height)`` of the aligned face: 3 IOD wide, from 1 IOD above the eyes to 2 below."""
ALIGNED_EYES_AT: Final = (96.0, 64.0)

MIN_IOD_PX: Final = 16.0
"""Below this inter-ocular distance in the image, the regions are a few pixels: not measured."""

Rect = tuple[float, float, float, float]
"""``(x0, y0, x1, y1)`` in IOD units from the eye midpoint, x right along the eye line, y down."""

FOREHEAD: Final[Rect] = (-0.45, -0.75, 0.45, -0.4)
BRIDGE: Final[Rect] = (-0.15, -0.2, 0.15, 0.1)
LENS_HALF_SIZE: Final = (0.3, 0.2)
"""Half width and half height of the lens region around each eye."""
RIM_BAND: Final = (0.15, 0.35)
"""The band below each eye where a frame's lower rim runs (research §6), as a span of y."""
LOWER_FACE_TOP: Final = 0.15
"""The lower face starts this far below the nose tip..."""
LOWER_FACE_BOTTOM: Final = 0.3
"""...and ends this far below the mouth corners' midpoint..."""
LOWER_FACE_HALF_WIDTH: Final = 0.1
"""...spanning the mouth corners plus this on each side, and at least 0.35 each way."""

SKIN_CR: Final = (133, 173)
SKIN_CB: Final = (77, 127)
MIN_FOREHEAD_SKIN: Final = 0.5
MIN_FOREHEAD_COVERAGE: Final = 0.8
MIN_REGION_COVERAGE: Final = 0.5
"""A lower face, lens, bridge or rim region with less of it on the image is not measured."""

COVERING_WEIGHTS: Final = (0.6, 0.25, 0.15)
"""Skin, colour and texture terms of the covering score."""
DELTA_E_FLOOR: Final = 10.0
DELTA_E_SPAN: Final = 40.0
TEXTURE_SPAN: Final = math.log(10.0)

GLASSES_WEIGHTS: Final = (0.4, 0.4, 0.2)
"""Bridge, rim and lens terms of the glasses score."""
BRIDGE_FULL: Final = 0.1
RIM_FULL: Final = 0.2
LENS_FULL: Final = 0.05

CANNY_THRESHOLDS: Final = (50, 150)
_SOBEL_FULL_STEP: Final = 4.0 * 255.0
"""A 3 x 3 Sobel's response to a full black-to-white step."""
_SCORE_DECIMALS: Final = 4
_DELTA_E_DECIMALS: Final = 2
_MIN_NOSE_BELOW_EYES: Final = 0.2
_MIN_LOWER_FACE_HEIGHT: Final = 0.2


@dataclass(frozen=True, slots=True)
class _Aligned:
    bgr: ImageArray
    valid: NDArray[np.bool_]
    nose: tuple[float, float]
    mouth: tuple[float, float]
    mouth_half_width: float


def _align(image: ImageArray, face: Face) -> _Aligned | None:
    """The face warped to the aligned frame, or ``None`` when its landmarks place no face."""
    points = np.asarray(face.landmarks, dtype=np.float64)
    if points.shape != (5, 2) or not np.all(np.isfinite(points)):
        return None
    right_eye, left_eye = points[0], points[1]
    iod = float(np.hypot(*(left_eye - right_eye)))
    if not math.isfinite(iod) or iod < MIN_IOD_PX:
        return None
    u = (left_eye - right_eye) / iod
    v = np.array([-u[1], u[0]])
    middle = (left_eye + right_eye) / 2
    scale = ALIGNED_IOD / iod
    linear = scale * np.stack([u, v])  # rows project onto the eye line and its normal

    def to_iod(point: NDArray[np.float64]) -> tuple[float, float]:
        offset = np.stack([u, v]) @ (point - middle) / iod
        return (float(offset[0]), float(offset[1]))

    nose = to_iod(points[2])
    mouth_r, mouth_l = to_iod(points[3]), to_iod(points[4])
    mouth = ((mouth_r[0] + mouth_l[0]) / 2, (mouth_r[1] + mouth_l[1]) / 2)
    if nose[1] < _MIN_NOSE_BELOW_EYES or mouth[1] <= nose[1]:
        return None

    bgr = ensure_bgr(image)
    height, width = bgr.shape[:2]
    out_w, out_h = ALIGNED_SIZE
    cx, cy = ALIGNED_EYES_AT
    # Where each aligned pixel comes from in the image, for the validity mask and the window.
    grid_x, grid_y = np.meshgrid(np.arange(out_w, dtype=np.float64), np.arange(out_h))
    source_x = middle[0] + ((grid_x - cx) * u[0] + (grid_y - cy) * v[0]) / scale
    source_y = middle[1] + ((grid_x - cx) * u[1] + (grid_y - cy) * v[1]) / scale
    valid = (source_x >= 0) & (source_x <= width - 1) & (source_y >= 0) & (source_y <= height - 1)
    if not valid.any():
        return None

    source, origin, factors = bgr, np.zeros(2), np.ones(2)
    if scale < 1.0:  # area-average a large face down first, so the warp does not alias
        left = max(0, math.floor(float(source_x.min())) - 2)
        top = max(0, math.floor(float(source_y.min())) - 2)
        right = min(width, math.ceil(float(source_x.max())) + 3)
        bottom = min(height, math.ceil(float(source_y.max())) + 3)
        window = bgr[top:bottom, left:right]
        size = (
            max(1, round((right - left) * scale)),
            max(1, round((bottom - top) * scale)),
        )
        source = np.asarray(cv2.resize(window, size, interpolation=cv2.INTER_AREA), np.uint8)
        origin = np.array([left, top], dtype=np.float64)
        factors = np.array([size[0] / (right - left), size[1] / (bottom - top)])
    # aligned = linear @ (window_point / factors + origin - middle) + (cx, cy)
    matrix = np.hstack(
        [linear / factors, (linear @ (origin - middle) + np.array([cx, cy]))[:, np.newaxis]]
    )
    warped = cv2.warpAffine(
        source, matrix, ALIGNED_SIZE, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )
    return _Aligned(
        bgr=np.asarray(warped, dtype=np.uint8),
        valid=np.asarray(valid, dtype=np.bool_),
        nose=nose,
        mouth=mouth,
        mouth_half_width=abs(mouth_l[0] - mouth_r[0]) / 2,
    )


def _region(rect: Rect) -> tuple[NDArray[np.bool_], int]:
    """The aligned pixels of ``rect`` and its nominal area in pixels (inside the frame or not)."""
    out_w, out_h = ALIGNED_SIZE
    cx, cy = ALIGNED_EYES_AT
    x0, y0 = round(cx + rect[0] * ALIGNED_IOD), round(cy + rect[1] * ALIGNED_IOD)
    x1, y1 = round(cx + rect[2] * ALIGNED_IOD), round(cy + rect[3] * ALIGNED_IOD)
    mask = np.zeros((out_h, out_w), dtype=np.bool_)
    mask[max(y0, 0) : max(min(y1, out_h), 0), max(x0, 0) : max(min(x1, out_w), 0)] = True
    return mask, max(x1 - x0, 0) * max(y1 - y0, 0)


def _coverage(mask: NDArray[np.bool_], area: int, valid: NDArray[np.bool_]) -> float:
    return float(np.count_nonzero(mask & valid)) / area if area else 0.0


def _share(flags: NDArray[np.bool_]) -> float:
    return float(np.count_nonzero(flags)) / flags.size if flags.size else 0.0


def _clip(value: float) -> float:
    return min(max(value, 0.0), 1.0)


@dataclass(frozen=True, slots=True)
class _Regions:
    forehead: NDArray[np.bool_]
    forehead_coverage: float
    lower: NDArray[np.bool_]
    lenses: NDArray[np.bool_]
    bridge: NDArray[np.bool_]
    rims: tuple[NDArray[np.bool_], NDArray[np.bool_]]


def _regions(aligned: _Aligned) -> _Regions | None:
    """The measured regions, valid pixels only; ``None`` if one besides the forehead is mostly
    off the image or the lower face is too short."""
    valid = aligned.valid
    forehead, forehead_area = _region(FOREHEAD)
    (_, nose_y), (mouth_x, mouth_y) = aligned.nose, aligned.mouth
    half = max(aligned.mouth_half_width + LOWER_FACE_HALF_WIDTH, 0.35)
    top, bottom = nose_y + LOWER_FACE_TOP, mouth_y + LOWER_FACE_BOTTOM
    if bottom - top < _MIN_LOWER_FACE_HEIGHT:
        return None
    measured = [_region((mouth_x - half, top, mouth_x + half, bottom))]
    lx, ly = LENS_HALF_SIZE
    measured += [_region((side * 0.5 - lx, -ly, side * 0.5 + lx, ly)) for side in (-1, 1)]
    measured.append(_region(BRIDGE))
    measured += [
        _region((side * 0.5 - lx, RIM_BAND[0], side * 0.5 + lx, RIM_BAND[1])) for side in (-1, 1)
    ]
    if any(_coverage(mask, area, valid) < MIN_REGION_COVERAGE for mask, area in measured):
        return None
    lower, lens_r, lens_l, bridge, rim_r, rim_l = (mask & valid for mask, _ in measured)
    return _Regions(
        forehead=forehead & valid,
        forehead_coverage=_coverage(forehead, forehead_area, valid),
        lower=lower,
        lenses=lens_r | lens_l,
        bridge=bridge,
        rims=(rim_r, rim_l),
    )


def _covering(aligned: _Aligned, regions: _Regions) -> CoveringScores:
    ycrcb = cv2.cvtColor(aligned.bgr, cv2.COLOR_BGR2YCrCb)
    cr, cb = ycrcb[..., 1], ycrcb[..., 2]
    skin = (cr >= SKIN_CR[0]) & (cr <= SKIN_CR[1]) & (cb >= SKIN_CB[0]) & (cb <= SKIN_CB[1])
    forehead_skin = _share(skin[regions.forehead])
    lower_skin = _share(skin[regions.lower])
    forehead_valid = (
        regions.forehead_coverage >= MIN_FOREHEAD_COVERAGE and forehead_skin >= MIN_FOREHEAD_SKIN
    )
    skin_ratio = lower_skin / forehead_skin if forehead_skin > 0 else 0.0

    grey = cv2.cvtColor(aligned.bgr, cv2.COLOR_BGR2GRAY)
    laplacian = cv2.Laplacian(grey, cv2.CV_64F)
    inner = cv2.erode(aligned.valid.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0

    def texture(mask: NDArray[np.bool_]) -> float:
        values = laplacian[mask & inner]
        return float(values.var()) if values.size else 0.0

    texture_ratio = (texture(regions.lower) + 1.0) / (texture(regions.forehead) + 1.0)
    lab = cv2.cvtColor(aligned.bgr.astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)
    lower_colour = np.median(lab[regions.lower], axis=0) if regions.lower.any() else np.zeros(3)
    forehead_colour = (
        np.median(lab[regions.forehead], axis=0) if regions.forehead.any() else lower_colour
    )
    delta_e = float(np.linalg.norm(lower_colour - forehead_colour))

    score = 0.0
    if forehead_valid:
        skin_weight, colour_weight, texture_weight = COVERING_WEIGHTS
        score = (
            skin_weight * _clip(1.0 - skin_ratio)
            + colour_weight * _clip((delta_e - DELTA_E_FLOOR) / DELTA_E_SPAN)
            + texture_weight * _clip(abs(math.log(texture_ratio)) / TEXTURE_SPAN)
        )
    return CoveringScores(
        score=round(_clip(score), _SCORE_DECIMALS),
        skin_fraction_ratio=round(skin_ratio, _SCORE_DECIMALS),
        texture_ratio=round(texture_ratio, _SCORE_DECIMALS),
        delta_e=round(delta_e, _DELTA_E_DECIMALS),
        forehead_valid=forehead_valid,
    )


def _rim_energy(steps: NDArray[np.float64], band: NDArray[np.bool_]) -> list[float]:
    """The strongest step of each column of ``band`` that has a pixel in it."""
    columns = np.flatnonzero(band.any(axis=0))
    masked = np.where(band, steps, 0.0)
    return [float(masked[:, column].max()) for column in columns]


def _glasses(aligned: _Aligned, regions: _Regions) -> GlassesScores:
    grey = cv2.cvtColor(aligned.bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(grey, (3, 3), 0), *CANNY_THRESHOLDS) > 0
    bridge = _share(edges[regions.bridge])
    steps = np.abs(cv2.Sobel(grey, cv2.CV_64F, 0, 1, ksize=3)) / _SOBEL_FULL_STEP
    columns = _rim_energy(steps, regions.rims[0]) + _rim_energy(steps, regions.rims[1])
    rim = float(np.mean(columns)) if columns else 0.0
    lens = _share(glare_mask(aligned.bgr)[regions.lenses])
    bridge_weight, rim_weight, lens_weight = GLASSES_WEIGHTS
    score = (
        bridge_weight * _clip(bridge / BRIDGE_FULL)
        + rim_weight * _clip(rim / RIM_FULL)
        + lens_weight * _clip(lens / LENS_FULL)
    )
    return GlassesScores(
        score=round(_clip(score), _SCORE_DECIMALS),
        rim_edge_energy=round(_clip(rim), _SCORE_DECIMALS),
        lens_highlight_ratio=round(lens, _SCORE_DECIMALS),
        bridge_edge_density=round(bridge, _SCORE_DECIMALS),
    )


def measure_occlusion(image: ImageArray, face: Face | None) -> Occlusion | None:
    """Covering and glasses scores of ``face`` (see the module docstring); ``None`` without a
    face, when its landmarks place no upright face (not finite, eyes under
    :data:`MIN_IOD_PX` apart, the nose not below the eyes or the mouth not below the nose), or
    when the lower face, the lenses, the bridge or the rim bands are mostly off the image."""
    if face is None:
        return None
    aligned = _align(image, face)
    if aligned is None:
        return None
    regions = _regions(aligned)
    if regions is None:
        return None
    return Occlusion(covering=_covering(aligned, regions), glasses=_glasses(aligned, regions))
