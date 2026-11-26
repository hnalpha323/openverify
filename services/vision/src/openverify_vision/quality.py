"""Image-quality metrics behind the ``id_blur_detection`` and ``id_glare_detection`` checks.

All functions take an 8-bit image as a numpy array, either grayscale ``(H, W)`` or BGR
``(H, W, 3)`` as produced by OpenCV. They are pure and deterministic.

The default thresholds are provisional. Phase 3 calibrates them on rectified ID crops.
:func:`tenengrad` and :func:`glare_mask` also serve the C32.1 measurements of the rectified
document (``document.py``); the Phase 1 metrics are unchanged.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Final, Literal

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator

from openverify_vision.imaging import ImageArray, ensure_bgr, ensure_gray, validate_image
from openverify_vision.schemas import FaceQuality, ImageQuality

if TYPE_CHECKING:
    from openverify_vision.faces import Face

Roi = tuple[int, int, int, int]
"""Region of interest as ``(x, y, width, height)`` in pixels."""

CheckStatus = Literal["passed", "failed"]
QualityCheckId = Literal["id_blur_detection", "id_glare_detection"]

DEFAULT_BLUR_MIN: Final = 100.0
"""Minimum variance of the Laplacian for an image to count as sharp."""

DEFAULT_GLARE_MAX: Final = 0.05
"""Maximum fraction of specular-highlight pixels tolerated."""

DEFAULT_BRIGHTNESS_MIN: Final = 0.15
"""Mean brightness below which an image is reported as too dark."""

DEFAULT_BRIGHTNESS_MAX: Final = 0.9
"""Mean brightness above which an image is reported as too bright."""

GLARE_VALUE_MIN: Final = 250
"""HSV value (0-255) at or above which a pixel is treated as near-saturated."""

GLARE_SATURATION_MAX: Final = 40
"""HSV saturation (0-255) at or below which a pixel is treated as colourless."""


class CheckResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: CheckStatus
    score: float
    threshold: float


class QualityMetrics(BaseModel):
    model_config = ConfigDict(frozen=True)

    brightness: float = Field(ge=0.0, le=1.0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class QualityReport(BaseModel):
    model_config = ConfigDict(frozen=True)

    checks: dict[QualityCheckId, CheckResult]
    metrics: QualityMetrics


class QualityThresholds(BaseModel):
    model_config = ConfigDict(frozen=True)

    blur_min: float = Field(default=DEFAULT_BLUR_MIN, ge=0.0)
    glare_max: float = Field(default=DEFAULT_GLARE_MAX, ge=0.0, le=1.0)
    brightness_min: float = Field(default=DEFAULT_BRIGHTNESS_MIN, ge=0.0, le=1.0)
    brightness_max: float = Field(default=DEFAULT_BRIGHTNESS_MAX, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _brightness_range(self) -> QualityThresholds:
        if self.brightness_min > self.brightness_max:
            raise ValueError("brightness_min must not exceed brightness_max")
        return self


def _crop(img: ImageArray, roi: Roi | None) -> ImageArray:
    if roi is None:
        return img
    x, y, w, h = roi
    height, width = img.shape[:2]
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > width or y + h > height:
        raise ValueError(f"roi {roi} must be non-empty and inside the {width}x{height} image")
    return img[y : y + h, x : x + w]


def blur_score(img: ImageArray) -> float:
    """Variance of the Laplacian of the grayscale image. Higher means sharper."""
    gray = ensure_gray(img)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def glare_ratio(img: ImageArray, roi: Roi | None = None) -> float:
    """Fraction of pixels (inside ``roi`` if given) that look like specular highlights.

    A glare pixel is near-saturated in brightness (HSV value >= ``GLARE_VALUE_MIN``) and close
    to colourless (HSV saturation <= ``GLARE_SATURATION_MAX``), which separates reflections
    from bright printed colours.
    """
    glare = glare_mask(_crop(ensure_bgr(img), roi))
    return float(np.count_nonzero(glare)) / float(glare.size)


def glare_mask(img: ImageArray) -> NDArray[np.bool_]:
    """The pixels :func:`glare_ratio` counts as glare: near-saturated and close to colourless."""
    hsv = cv2.cvtColor(ensure_bgr(img), cv2.COLOR_BGR2HSV)
    glare = (hsv[..., 2] >= GLARE_VALUE_MIN) & (hsv[..., 1] <= GLARE_SATURATION_MAX)
    return np.asarray(glare, dtype=np.bool_)


def tenengrad(img: ImageArray) -> float:
    """Mean squared Sobel gradient magnitude (3 x 3 kernels) of the grayscale image. Higher
    means sharper; less sensitive to noise than the Laplacian.

    The uint8 image goes straight to ``CV_64F``: OpenCV 5 rejects some float32 to ``CV_64F``
    derivative combinations (``docs/research/phase3-libraries.md`` section 5).
    """
    gray = ensure_gray(img)
    gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    return float(np.mean(gx * gx + gy * gy))


def brightness(img: ImageArray) -> float:
    """Mean grayscale intensity normalised to ``[0.0, 1.0]``."""
    gray = ensure_gray(img)
    return float(gray.mean()) / 255.0


def _min_check(score: float, threshold: float) -> CheckResult:
    status: CheckStatus = "passed" if score >= threshold else "failed"
    return CheckResult(status=status, score=score, threshold=threshold)


def _max_check(score: float, threshold: float) -> CheckResult:
    status: CheckStatus = "passed" if score <= threshold else "failed"
    return CheckResult(status=status, score=score, threshold=threshold)


def assess_quality(img: ImageArray, thresholds: QualityThresholds) -> QualityReport:
    """Run the blur and glare checks and report brightness and dimensions.

    ``id_blur_detection`` passes when the blur score is at least ``thresholds.blur_min``.
    ``id_glare_detection`` passes when the glare ratio is at most ``thresholds.glare_max``.
    """
    img = validate_image(img)
    height, width = img.shape[:2]
    return QualityReport(
        checks={
            "id_blur_detection": _min_check(blur_score(img), thresholds.blur_min),
            "id_glare_detection": _max_check(glare_ratio(img), thresholds.glare_max),
        },
        metrics=QualityMetrics(brightness=brightness(img), width=width, height=height),
    )


def summarize_quality(img: ImageArray, thresholds: QualityThresholds) -> ImageQuality:
    """Compute the C6 ``quality`` object: blur, glare and brightness with their flags.

    Values exactly at a threshold count as acceptable, matching :func:`assess_quality`.
    """
    img = validate_image(img)
    blur = blur_score(img)
    glare = glare_ratio(img)
    level = brightness(img)
    return ImageQuality(
        blur_score=blur,
        is_blurry=blur < thresholds.blur_min,
        glare_ratio=glare,
        has_glare=glare > thresholds.glare_max,
        brightness=level,
        is_too_dark=level < thresholds.brightness_min,
        is_too_bright=level > thresholds.brightness_max,
    )


# --- vision-face ---
# C41.1 ``face_quality``: the primary face region of a selfie pose. Vision measures; the
# selfie_image_quality_detection and selfie_glare_detection evaluators (TypeScript) decide.

FACE_BLUR_WIDTH: Final = 112
"""The face region's blur is measured scaled down to at most this width (SFace's input width)."""

FACE_MEASURE_MAX_WIDTH: Final = 1024
"""Brightness and glare are measured on the face region scaled down to at most this width, so
a face of a few thousand pixels costs no more than a selfie's."""

EYE_REGION_HALF_WIDTH: Final = 0.3
EYE_REGION_HALF_HEIGHT: Final = 0.2
"""The eye regions left out of the face glare: an ellipse around each eye landmark, these shares
of the inter-ocular distance (IOD) along and across the eye line. An eye is about 0.45 IOD wide,
so the ellipse covers it and its lids; the sclera and the corneal reflection are bright and
colourless, and are not skin glare."""

_MIN_FACE_REGION_PX: Final = 2
"""A face region narrower or shorter than this, once clipped to the image, is not measured."""
_BOX_DECIMALS: Final = 2
_RATIO_DECIMALS: Final = 4


def _clipped_box(
    box: tuple[float, float, float, float], width: int, height: int
) -> tuple[float, float, float, float] | None:
    """``box`` clipped to a ``width`` x ``height`` image; ``None`` if degenerate or outside."""
    x, y, w, h = box
    if not all(math.isfinite(v) for v in box) or w <= 0 or h <= 0:
        return None
    left, top = max(x, 0.0), max(y, 0.0)
    right, bottom = min(x + w, float(width)), min(y + h, float(height))
    if right <= left or bottom <= top:
        return None
    return (left, top, right - left, bottom - top)


def _scaled_down(img: ImageArray, max_width: int) -> tuple[ImageArray, float]:
    """``img`` scaled down (never up) to at most ``max_width`` pixels wide, and the factor."""
    height, width = img.shape[:2]
    if width <= max_width:
        return img, 1.0
    factor = max_width / width
    size = (max_width, max(1, round(height * factor)))
    return np.asarray(cv2.resize(img, size, interpolation=cv2.INTER_AREA), dtype=np.uint8), factor


def eye_regions_mask(
    face: Face, shape: tuple[int, ...], origin: tuple[int, int] = (0, 0), scale: float = 1.0
) -> NDArray[np.bool_]:
    """The eye regions of ``face`` (see :data:`EYE_REGION_HALF_WIDTH`) on an array of ``shape``
    whose pixel ``(0, 0)`` is the image pixel ``origin``, scaled by ``scale``. Empty when the
    eyes cannot be placed (they coincide, or a landmark is not finite)."""
    mask = np.zeros(shape[:2], dtype=np.uint8)
    (rx, ry), (lx, ly) = face.landmarks[0], face.landmarks[1]
    iod = math.hypot(lx - rx, ly - ry) * scale
    if not math.isfinite(iod) or iod < 1.0 or iod > max(shape[:2]) * 4:
        return mask > 0
    angle = math.degrees(math.atan2(ly - ry, lx - rx))
    axes = (max(1, round(EYE_REGION_HALF_WIDTH * iod)), max(1, round(EYE_REGION_HALF_HEIGHT * iod)))
    for px, py in ((rx, ry), (lx, ly)):
        centre = (round((px - origin[0]) * scale), round((py - origin[1]) * scale))
        cv2.ellipse(mask, centre, axes, angle, 0, 360, 255, thickness=-1)
    return mask > 0


def _share(flags: NDArray[np.bool_]) -> float:
    return float(np.count_nonzero(flags)) / float(flags.size) if flags.size else 0.0


def measure_face_quality(image: ImageArray, face: Face | None) -> FaceQuality | None:
    """The primary face region's quality (C41.1); ``None`` without a face, or when its box,
    clipped to the image, is degenerate or under two pixels on a side.

    - ``box``: the face box clipped to the image, in pixels (the region measured); ``width_px``
      is its width, ``height_ratio`` its height over the image height, and ``center_offset`` its
      centre's offset from the image centre as shares of the image width and height.
    - ``blur_score``: the Laplacian variance of the grey face region scaled down (never up) to at
      most :data:`FACE_BLUR_WIDTH` pixels wide, as ``id_portrait_clarity_detection``'s
      sharpness: a large face is not penalised for its extra pixels, and a small one is measured
      as it is (``width_px`` judges its size).
    - ``brightness``: the region's mean grey level, 0 to 1.
    - ``glare_ratio``: the share of the region outside the eye regions
      (:func:`eye_regions_mask`) that is near-saturated and colourless (:func:`glare_mask`).

    Brightness and glare are taken on the region scaled down to at most
    :data:`FACE_MEASURE_MAX_WIDTH` pixels wide.
    """
    if face is None:
        return None
    bgr = ensure_bgr(image)
    height, width = bgr.shape[:2]
    clipped = _clipped_box(face.box, width, height)
    if clipped is None:
        return None
    x, y, w, h = clipped
    left, top = math.floor(x), math.floor(y)
    right, bottom = min(width, math.ceil(x + w)), min(height, math.ceil(y + h))
    if right - left < _MIN_FACE_REGION_PX or bottom - top < _MIN_FACE_REGION_PX:
        return None
    region = np.ascontiguousarray(bgr[top:bottom, left:right])
    sharpness = blur_score(_scaled_down(ensure_gray(region), FACE_BLUR_WIDTH)[0])
    measured, factor = _scaled_down(region, FACE_MEASURE_MAX_WIDTH)
    glare = glare_mask(measured)
    outside_eyes = ~eye_regions_mask(face, measured.shape, (left, top), factor)
    glare_share = _share(glare[outside_eyes]) if outside_eyes.any() else _share(glare)
    return FaceQuality(
        box=(
            round(x, _BOX_DECIMALS),
            round(y, _BOX_DECIMALS),
            round(w, _BOX_DECIMALS),
            round(h, _BOX_DECIMALS),
        ),
        width_px=round(w, _BOX_DECIMALS),
        height_ratio=round(h / height, _RATIO_DECIMALS),
        center_offset=(
            round((x + w / 2 - width / 2) / width, _RATIO_DECIMALS),
            round((y + h / 2 - height / 2) / height, _RATIO_DECIMALS),
        ),
        blur_score=round(sharpness, _BOX_DECIMALS),
        brightness=round(brightness(measured), _RATIO_DECIMALS),
        glare_ratio=round(glare_share, _RATIO_DECIMALS),
    )


# --- end vision-face ---
