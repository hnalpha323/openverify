"""Cross-pose consistency: identity, planarity, SSIM and duplicates (C41.1, research §7).

A live head turning between the centre and a side pose changes the face in three dimensions; a
print or a screen moved, tilted or turned in front of the camera changes it only by a plane's
motion, and a replayed still changes it not at all. Each side pose is measured against the centre:

- ``face_cosine_to_center``: the dot product of the two primary faces' SFace embeddings (both are
  unit vectors), so the same person throughout; ``None`` without both.
- The *region*: the centre's primary face box grown by :data:`FACE_MARGIN` of its size on every
  side and clipped to the frame. The side pose is read at the same place (scaled when the two
  frames differ in size) and both crops are scaled so the face is at most
  :data:`FACE_WORK_WIDTH` pixels wide, never upscaled. Without a centre face the whole frames are
  compared, at most :data:`FRAME_WORK_SIDE` pixels on the long side, and only the raw SSIM and
  the duplicate flag are measured.
- ``raw_ssim``: :func:`structural_similarity` of the two crops over the face box, unregistered.
- ``duplicate_of_center``: the uploads have the same SHA-256, or ``raw_ssim`` reaches
  :data:`DUPLICATE_SSIM` (a re-encoded or resized copy of the same frame); ``None`` when neither
  could be established.
- ``planarity``: up to :data:`MAX_TRACKED_POINTS` corners (``goodFeaturesToTrack``) inside the
  centre's face box are tracked into the side crop with pyramidal Lucas-Kanade and back again;
  a point is kept when both passes find it and it returns within :data:`FB_MAX_ERROR` pixels of
  where it started. A homography is fitted to the kept pairs by least median of squares
  (``LMEDS``, robust to up to half of them moving off the plane). ``tracked_points`` is the kept
  count, and the residuals are each kept point's reprojection error as a share of the face width:
  their median and 90th percentile. A plane fits one homography almost exactly; a turning head
  does not (research §7 measured 0.05-0.33 % of the face width for a photo turned up to 30
  degrees, 0.62-2.2 % for 3-D re-poses of 10-30 degrees). ``None`` below
  :data:`MIN_TRACKED_POINTS` kept points or when no homography fits.
- ``registered_ssim``: the side crop warped onto the centre by that homography, then compared
  over the face box: near 1 for a plane, lower for a head. Resampling blur lowers it under strong
  foreshortening, so it is a secondary cue (research §7).

Thresholds and decisions are TypeScript's (C41.3). Nothing here is logged (C41.6).
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.faces import Face
from openverify_vision.imaging import ImageArray, ensure_gray
from openverify_vision.schemas import Planarity, PoseConsistency, SidePose

DUPLICATE_SSIM: Final = 0.99
"""A side pose whose raw SSIM to the centre reaches this is a duplicate frame (research §7)."""

MIN_TRACKED_POINTS: Final = 8
"""Fewer tracked points than this leave the planarity unmeasured (``null``): a homography has
eight degrees of freedom, so the median residual of fewer points says little."""

MAX_TRACKED_POINTS: Final = 200
"""Most face points tracked between two poses."""

FACE_WORK_WIDTH: Final = 200
"""The centre face is tracked and compared at most this many pixels wide (never upscaled)."""

FACE_MARGIN: Final = 0.5
"""Share of the face box's size kept around it, so a turned or moved face stays in the crop."""

FRAME_WORK_SIDE: Final = 256
"""Long side of the whole frames compared when the centre has no face."""

FB_MAX_ERROR: Final = 1.0
"""Most pixels (at the working scale) a point may miss its start after tracking there and back."""

CORNER_QUALITY: Final = 0.01
CORNER_MIN_DISTANCE: Final = 5
CORNER_BLOCK_SIZE: Final = 7
FLOW_WINDOW: Final = (21, 21)
FLOW_LEVELS: Final = 3
FLOW_CRITERIA: Final = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01)

SSIM_WINDOW: Final = 11
SSIM_SIGMA: Final = 1.5
SSIM_K1: Final = 0.01
SSIM_K2: Final = 0.03
SSIM_DATA_RANGE: Final = 255.0
"""Wang et al. 2004: an 11 x 11 Gaussian window of sigma 1.5, K1 0.01, K2 0.03, 8-bit range."""

MIN_SSIM_SIDE: Final = 16
"""Regions smaller than this on either side are not compared (the window's border is cropped)."""

_SSIM_PAD: Final = (SSIM_WINDOW - 1) // 2
_SCORE_DECIMALS: Final = 4
_RESIDUAL_DECIMALS: Final = 5
_P90: Final = 90


@dataclass(frozen=True, slots=True)
class PoseFrame:
    """What the consistency of a pose needs: the upload, its decode, its face and embedding."""

    data: bytes
    image: ImageArray
    face: Face | None
    embedding: tuple[float, ...] | None


def _gaussian(image: NDArray[np.float64]) -> NDArray[np.float64]:
    blurred = cv2.GaussianBlur(
        image,
        (SSIM_WINDOW, SSIM_WINDOW),
        SSIM_SIGMA,
        sigmaY=SSIM_SIGMA,
        borderType=cv2.BORDER_REFLECT,
    )
    return np.asarray(blurred, dtype=np.float64)


def structural_similarity(first: ImageArray, second: ImageArray) -> float | None:
    """The mean SSIM of two equally sized 8-bit images (grey, or BGR read as grey).

    Wang et al. 2004 with Gaussian weights, population covariances, reflected borders and the
    window's radius cropped from every edge, as scikit-image's ``structural_similarity`` with
    ``gaussian_weights=True, sigma=1.5, use_sample_covariance=False`` computes it. ``None`` when
    either side is shorter than :data:`MIN_SSIM_SIDE`.
    """
    a, b = ensure_gray(first), ensure_gray(second)
    if a.shape != b.shape:
        raise ValueError(f"SSIM needs two images of the same size, not {a.shape} and {b.shape}")
    if min(a.shape) < MIN_SSIM_SIDE:
        return None
    x, y = a.astype(np.float64), b.astype(np.float64)
    mean_x, mean_y = _gaussian(x), _gaussian(y)
    var_x = _gaussian(x * x) - mean_x * mean_x
    var_y = _gaussian(y * y) - mean_y * mean_y
    covariance = _gaussian(x * y) - mean_x * mean_y
    c1, c2 = (SSIM_K1 * SSIM_DATA_RANGE) ** 2, (SSIM_K2 * SSIM_DATA_RANGE) ** 2
    ssim_map = ((2 * mean_x * mean_y + c1) * (2 * covariance + c2)) / (
        (mean_x * mean_x + mean_y * mean_y + c1) * (var_x + var_y + c2)
    )
    cropped = ssim_map[_SSIM_PAD:-_SSIM_PAD, _SSIM_PAD:-_SSIM_PAD]
    return float(cropped.mean(dtype=np.float64))


def _cosine(first: tuple[float, ...] | None, second: tuple[float, ...] | None) -> float | None:
    if first is None or second is None or len(first) != len(second):
        return None
    value = float(np.dot(np.asarray(first, np.float64), np.asarray(second, np.float64)))
    return round(min(1.0, max(-1.0, value)), _SCORE_DECIMALS)


@dataclass(frozen=True, slots=True)
class _Region:
    """The two poses' grey crops at the working scale, and the centre face box in them."""

    center: ImageArray
    side: ImageArray
    face: tuple[int, int, int, int] | None
    """``(x0, y0, x1, y1)`` in the crops; ``None`` when the whole frames are compared."""
    face_width: float
    """The centre face box's width at the working scale."""

    def face_crops(self, side: ImageArray | None = None) -> tuple[ImageArray, ImageArray]:
        other = self.side if side is None else side
        if self.face is None:
            return self.center, other
        x0, y0, x1, y1 = self.face
        return self.center[y0:y1, x0:x1], other[y0:y1, x0:x1]


def _resize(image: ImageArray, size: tuple[int, int]) -> ImageArray:
    """``image`` at ``size`` (``(width, height)``): area-averaged when shrinking."""
    height, width = image.shape[:2]
    if (width, height) == size:
        return image
    shrinking = size[0] * size[1] < width * height
    interpolation = cv2.INTER_AREA if shrinking else cv2.INTER_LINEAR
    return np.asarray(cv2.resize(image, size, interpolation=interpolation), dtype=np.uint8)


@dataclass(frozen=True, slots=True)
class CenterReference:
    """What every side pose's consistency needs from the centre (Workflow 4B review H008).

    :func:`center_reference` takes it from the centre's :class:`PoseFrame` once, so the full-size
    centre decode can be released before a side pose is decoded: the upload's SHA-256, the primary
    face's embedding, the frame's size and the centre's grey crop at the working scale.
    """

    digest: bytes
    embedding: tuple[float, ...] | None
    size: tuple[int, int]
    """The centre frame's ``(width, height)``."""
    crop: ImageArray | None
    """The centre's grey working crop; ``None`` when its face box lies outside the frame."""
    bounds: tuple[int, int, int, int] | None
    """``(x0, y0, x1, y1)``: where :attr:`crop` lies in the centre frame (the face box grown by
    :data:`FACE_MARGIN` and clipped); ``None`` when the whole frames are compared."""
    face: tuple[int, int, int, int] | None
    """The centre face box in :attr:`crop` (see :attr:`_Region.face`)."""
    face_width: float
    """The centre face box's width at the working scale."""


def center_reference(center: PoseFrame) -> CenterReference:
    """The centre's part of every consistency measurement (see :class:`CenterReference`)."""
    digest = hashlib.sha256(center.data).digest()
    height, width = center.image.shape[:2]
    if center.face is None:
        scale = min(1.0, FRAME_WORK_SIDE / max(height, width))
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        crop = _resize(ensure_gray(center.image), size)
        return CenterReference(digest, center.embedding, (width, height), crop, None, None, 0.0)
    x, y, w, h = center.face.box
    fx0, fy0 = max(0.0, x), max(0.0, y)
    fx1, fy1 = min(float(width), x + w), min(float(height), y + h)
    if fx1 - fx0 < 1.0 or fy1 - fy0 < 1.0:
        return CenterReference(digest, center.embedding, (width, height), None, None, None, 0.0)
    gx0, gy0 = max(0, math.floor(x - FACE_MARGIN * w)), max(0, math.floor(y - FACE_MARGIN * h))
    gx1 = min(width, math.ceil(x + w + FACE_MARGIN * w))
    gy1 = min(height, math.ceil(y + h + FACE_MARGIN * h))
    scale = min(1.0, FACE_WORK_WIDTH / w)
    size = (max(1, round((gx1 - gx0) * scale)), max(1, round((gy1 - gy0) * scale)))
    # H007: the face box starts inside the crop, so a face under a pixel tall at the working scale
    # still covers one row of it.
    left = min(round((fx0 - gx0) * scale), size[0] - 1)
    top = min(round((fy0 - gy0) * scale), size[1] - 1)
    face = (
        left,
        top,
        max(left + 1, round((fx1 - gx0) * scale)),
        max(top + 1, round((fy1 - gy0) * scale)),
    )
    crop = _resize(ensure_gray(center.image[gy0:gy1, gx0:gx1]), size)
    return CenterReference(
        digest, center.embedding, (width, height), crop, (gx0, gy0, gx1, gy1), face, w * scale
    )


def _region(center: CenterReference, side: PoseFrame) -> _Region | None:
    """The working crops; ``None`` when the centre face box lies outside its frame."""
    if center.crop is None:
        return None
    crop_height, crop_width = center.crop.shape[:2]
    size = (crop_width, crop_height)
    if center.bounds is None:
        side_whole = _resize(ensure_gray(side.image), size)
        return _Region(center=center.crop, side=side_whole, face=None, face_width=0.0)
    gx0, gy0, gx1, gy1 = center.bounds
    width, height = center.size
    side_height, side_width = side.image.shape[:2]
    sx, sy = side_width / width, side_height / height
    # H007 (Workflow 4B review): the start stays inside the side frame, so a tiny side pose beside
    # a face flush with the centre's right or bottom edge still gives a crop of one pixel or more.
    x0, y0 = min(round(gx0 * sx), side_width - 1), min(round(gy0 * sy), side_height - 1)
    side_crop = side.image[y0 : max(y0 + 1, round(gy1 * sy)), x0 : max(x0 + 1, round(gx1 * sx))]
    return _Region(
        center=center.crop,
        side=_resize(ensure_gray(side_crop), size),
        face=center.face,
        face_width=center.face_width,
    )


def _tracked_pairs(
    region: _Region,
) -> tuple[NDArray[np.float32], NDArray[np.float32]] | None:
    """Face corners of the centre crop and where they are in the side crop, after the
    forward-backward check; ``None`` below :data:`MIN_TRACKED_POINTS`."""
    if region.face is None:
        return None
    x0, y0, x1, y1 = region.face
    mask = np.zeros(region.center.shape, dtype=np.uint8)
    mask[y0:y1, x0:x1] = 255
    corners = cv2.goodFeaturesToTrack(
        region.center,
        MAX_TRACKED_POINTS,
        CORNER_QUALITY,
        CORNER_MIN_DISTANCE,
        mask=mask,
        blockSize=CORNER_BLOCK_SIZE,
    )
    if corners is None or len(corners) < MIN_TRACKED_POINTS:
        return None
    start = np.asarray(corners, dtype=np.float32).reshape(-1, 1, 2)
    forward, found, _ = cv2.calcOpticalFlowPyrLK(
        region.center,
        region.side,
        start,
        np.empty(0),
        winSize=FLOW_WINDOW,
        maxLevel=FLOW_LEVELS,
        criteria=FLOW_CRITERIA,
    )
    back, returned, _ = cv2.calcOpticalFlowPyrLK(
        region.side,
        region.center,
        forward,
        np.empty(0),
        winSize=FLOW_WINDOW,
        maxLevel=FLOW_LEVELS,
        criteria=FLOW_CRITERIA,
    )
    there = np.asarray(forward, dtype=np.float32).reshape(-1, 2)
    error = np.linalg.norm(
        start.reshape(-1, 2) - np.asarray(back, np.float32).reshape(-1, 2), axis=1
    )
    keep = (
        (np.asarray(found).reshape(-1) == 1)
        & (np.asarray(returned).reshape(-1) == 1)
        & np.isfinite(error)
        & (error <= FB_MAX_ERROR)
    )
    if int(keep.sum()) < MIN_TRACKED_POINTS:
        return None
    return start.reshape(-1, 2)[keep], there[keep]


def _planarity(region: _Region) -> tuple[Planarity | None, float | None]:
    """The planarity of the face's motion and the registered SSIM (both ``None`` unmeasured)."""
    pairs = _tracked_pairs(region)
    if pairs is None:
        return None, None
    source, target = pairs
    homography, _ = cv2.findHomography(source, target, cv2.LMEDS)
    if homography is None or not np.all(np.isfinite(homography)):
        return None, None
    matrix = np.asarray(homography, dtype=np.float64)
    projected = cv2.perspectiveTransform(source.reshape(-1, 1, 2).astype(np.float64), matrix)
    residuals = np.linalg.norm(np.asarray(projected).reshape(-1, 2) - target, axis=1)
    ratios = residuals / region.face_width
    planarity = Planarity(
        tracked_points=len(source),
        median_residual_ratio=round(float(np.median(ratios)), _RESIDUAL_DECIMALS),
        p90_residual_ratio=round(float(np.percentile(ratios, _P90)), _RESIDUAL_DECIMALS),
    )
    height, width = region.center.shape
    registered = np.asarray(
        cv2.warpPerspective(
            region.side,
            matrix,
            (width, height),
            flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
            borderMode=cv2.BORDER_REPLICATE,
        ),
        dtype=np.uint8,
    )
    similarity = structural_similarity(*region.face_crops(registered))
    return planarity, None if similarity is None else _rounded_ssim(similarity)


def _rounded_ssim(value: float) -> float:
    return round(min(1.0, max(-1.0, value)), _SCORE_DECIMALS)


def measure_consistency(
    pose: SidePose, center: PoseFrame | CenterReference, side: PoseFrame
) -> PoseConsistency:
    """How ``side`` relates to ``center`` (see the module docstring for each measurement).

    ``center`` is the centre's frame, or its :func:`center_reference` taken once for every side.
    """
    reference = center if isinstance(center, CenterReference) else center_reference(center)
    cosine = _cosine(reference.embedding, side.embedding)
    same_bytes = reference.digest == hashlib.sha256(side.data).digest()
    region = _region(reference, side)
    if region is None:
        return PoseConsistency(
            pose=pose,
            face_cosine_to_center=cosine,
            planarity=None,
            registered_ssim=None,
            raw_ssim=None,
            duplicate_of_center=True if same_bytes else None,
        )
    similarity = structural_similarity(*region.face_crops())
    raw = None if similarity is None else _rounded_ssim(similarity)
    duplicate = True if same_bytes else (None if raw is None else raw >= DUPLICATE_SSIM)
    planarity, registered = _planarity(region)
    return PoseConsistency(
        pose=pose,
        face_cosine_to_center=cosine,
        planarity=planarity,
        registered_ssim=registered,
        raw_ssim=raw,
        duplicate_of_center=duplicate,
    )
