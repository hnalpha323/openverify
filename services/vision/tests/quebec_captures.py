"""Phase 12A test helpers over the shared synthetic Quebec-format licence (contracts-12a).

Every capture comes from ``tools/synthetic_quebec.py`` (frozen for Stage 2): an invented holder on
a SPECIMEN card, photographed deterministically. Captures are cached per process, since each one
renders and encodes a full phone frame. Nothing here reads a real card or logs OCR text.
"""

from __future__ import annotations

import functools
import math
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.document import DocumentResult
from openverify_vision.schemas import BoundingBox, DocumentDetection, Quad
from synthetic_quebec import CAPTURES, CARD_MM, PX_PER_MM, Capture, Photo, Side, photograph

Image = NDArray[np.uint8]

CANONICAL_SIZE: Final = (round(CARD_MM[0] * PX_PER_MM), round(CARD_MM[1] * PX_PER_MM))
"""The card the printed-line boxes are given on: 12 px/mm."""

PHONE_1080: Final = tuple(name for name in CAPTURES if name.startswith("phone-1080"))
"""Every 1080x1920 capture of the live test's frame."""

SAME_SCENE_2160: Final = Capture(
    "scene-2160", frame=(2160, 3840), blur_sigma=math.sqrt(4 * (0.6**2 + 0.5**2) - 0.5**2)
)
"""``phone-1080`` at twice the frame size with the optical blur scaled with the frame.

The generator blurs every capture twice: 0.5 frame pixels of lens blur while warping the card
into the frame, then ``blur_sigma``. Only the second follows ``blur_sigma``, so the same scene at
twice the size needs ``blur_sigma`` = sqrt((2 * sqrt(0.6^2 + 0.5^2))^2 - 0.5^2) = 1.48, not the
1.2 that would double only the second blur (``docs/calibration/blur-phase12a.md``)."""

PLAN_2160: Final = Capture("plan-2160", frame=(2160, 3840), blur_sigma=1.2, noise=1.5)
"""The plan's literal pair for ``phone-1080`` (V3), which is sharper than it: see above."""


@functools.cache
def photo(side: Side, capture: str | Capture, back: str = "standard") -> Photo:
    """``side`` photographed as the named (or given) capture, cached."""
    chosen = CAPTURES[capture] if isinstance(capture, str) else capture
    return photograph(side, chosen, back=back)


def bgr(shot: Photo) -> Image:
    """The decoded JPEG as the BGR array the vision service works on."""
    return np.ascontiguousarray(np.asarray(shot.image)[:, :, ::-1], dtype=np.uint8)


def card_to_frame(shot: Photo) -> NDArray[np.float64]:
    """The homography from canonical card pixels (12 px/mm) to frame pixels."""
    width, height = CANONICAL_SIZE
    corners = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(corners, np.array(shot.quad, dtype=np.float32))
    return np.asarray(matrix, dtype=np.float64)


def frame_boxes(shot: Photo, *, field_numbers: bool = True) -> tuple[BoundingBox, ...]:
    """The printed lines' boxes in frame pixels (the axis-aligned box of each mapped box), as
    an OCR of the upload reports them."""
    transform = card_to_frame(shot)
    boxes = []
    for line in shot.lines:
        if line.role == "field-number" and not field_numbers:
            continue
        x, y, w, h = line.box
        outline = np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float64)
        mapped = cv2.perspectiveTransform(outline.reshape(-1, 1, 2), transform).reshape(-1, 2)
        left, top = mapped.min(axis=0)
        right, bottom = mapped.max(axis=0)
        boxes.append((float(left), float(top), float(right - left), float(bottom - top)))
    return tuple(boxes)


def rectified_boxes(shot: Photo, width: int, *, field_numbers: bool = True) -> list[BoundingBox]:
    """The printed lines' boxes on a rectified card ``width`` pixels wide."""
    scale = width / CANONICAL_SIZE[0]
    return [
        (line.box[0] * scale, line.box[1] * scale, line.box[2] * scale, line.box[3] * scale)
        for line in shot.lines
        if field_numbers or line.role != "field-number"
    ]


def true_document(shot: Photo, *, width: int | None = None) -> DocumentResult:
    """The card rectified through its true quad, as a ``contour`` detection would give it."""
    quad = np.array(shot.quad, dtype=np.float32)
    native = round(
        max(math.dist(shot.quad[0], shot.quad[1]), math.dist(shot.quad[3], shot.quad[2]))
    )
    size_w = native if width is None else width
    size_h = round(size_w * CARD_MM[1] / CARD_MM[0])
    target = np.array([[0, 0], [size_w, 0], [size_w, size_h], [0, size_h]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(quad, target)
    rectified = cv2.warpPerspective(
        bgr(shot), matrix, (size_w, size_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )
    as_quad: Quad = (shot.quad[0], shot.quad[1], shot.quad[2], shot.quad[3])
    detection = DocumentDetection(
        found=True,
        quad=as_quad,
        method="contour",
        rectified_size=(size_w, size_h),
        aspect_ratio=size_w / size_h,
        area_ratio=0.3,
    )
    return DocumentResult(detection=detection, rectified=np.ascontiguousarray(rectified))


def worst_corner_share(quad: Quad, shot: Photo) -> float:
    """The largest corner distance from the true quad, as a share of the card's width."""
    return max(math.dist(found, truth) for found, truth in zip(quad, shot.quad, strict=True)) / (
        shot.card_width_px
    )
