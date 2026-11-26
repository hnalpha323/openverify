"""C45.2 covering and glasses composites, drawn along the five YuNet landmarks.

Pipeline fixtures for ``selfie_face_covering_detection`` and ``selfie_glasses_detection`` (H-tier
heuristics): a cloth mask, a striped scarf, a hand over the mouth, and clear or dark glasses. Each
item is drawn once in the 112 x 112 aligned-face template SFace uses (:data:`TEMPLATE_112`), on a
4x canvas around it, then warped onto the photo with the affine map that takes the template's
five points to the face's landmarks, so it follows the face's position, size, roll and turn.

Measured on the public-domain faces (2026-10-21): YuNet at the service's 0.9 score threshold no
longer finds a face whose mask covers the nose, nor (on a turned pose) one whose scarf reaches
the mouth corners; such a fixture would only test ``face_not_present``. So the mask covers the
mouth from below the nose (YuNet scores 0.916-0.921 on person A's three poses; with its top at
the nose tip's height plus 6, only 0.904-0.911) and the scarf covers the chin; the generator's
real-model test checks every composite still has a face. Cartoonish by design: these test the
pipeline, not the heuristics' accuracy.
"""

from __future__ import annotations

import math
from typing import Final, Literal

import cv2
import numpy as np
from numpy.typing import NDArray

Frame = NDArray[np.uint8]
Points = NDArray[np.float64]
Covering = Literal["mask", "scarf", "hand"]
COVERINGS: Final[tuple[Covering, ...]] = ("mask", "scarf", "hand")

TEMPLATE_112: Final = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float64,
)
"""Where the five YuNet landmarks sit in the 112 x 112 aligned face that SFace embeds."""

CANVAS_SCALE: Final = 4
CANVAS_ORIGIN: Final = np.array([-48.0, -40.0])
CANVAS_SIZE: Final = (208, 232)
"""The canvas spans template x from -48 to 160 and y from -40 to 192: room for the scarf."""

MASK_TOP: Final = 84.0
"""Template y of the mask's top edge: below the nose tip (71.7), above the mouth corners (92.3)."""

MASK_COLOR: Final = (225.0, 228.0, 230.0)
SCARF_TOP: Final = 102.0
"""Template y of the scarf's top edge, below the mouth corners (92.3)."""

LENS_HALF_SIZE: Final = (15.0, 10.5)
RIM_WIDTH: Final = 2.5
RIM_COLOR: Final = (25.0, 25.0, 30.0)
CLEAR_LENS: Final = ((215.0, 205.0, 195.0), 0.12)
DARK_LENS: Final = ((35.0, 38.0, 42.0), 0.85)


def face_affine(landmarks: Points) -> NDArray[np.float64]:
    """The 2 x 3 affine map (least squares) taking :data:`TEMPLATE_112` to ``landmarks``."""
    points = np.asarray(landmarks, dtype=np.float64).reshape(5, 2)
    design = np.hstack([TEMPLATE_112, np.ones((5, 1))])
    solution, *_ = np.linalg.lstsq(design, points, rcond=None)
    return np.asarray(solution.T, dtype=np.float64)


def _canvas() -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    width, height = (side * CANVAS_SCALE for side in CANVAS_SIZE)
    return np.zeros((height, width, 3), np.float32), np.zeros((height, width), np.float32)


def _px(*points: tuple[float, float]) -> NDArray[np.int32]:
    """Template points as canvas pixels."""
    scaled = (np.asarray(points, np.float64) - CANVAS_ORIGIN) * CANVAS_SCALE
    return np.asarray(np.round(scaled), dtype=np.int32)


def _pt(x: float, y: float) -> tuple[int, int]:
    px = _px((x, y))[0]
    return (int(px[0]), int(px[1]))


def _paint(
    image: Frame, landmarks: Points, color: NDArray[np.float32], alpha: NDArray[np.float32]
) -> Frame:
    """Blend the canvas onto ``image``, warped along the face."""
    affine = np.vstack([face_affine(landmarks), [0.0, 0.0, 1.0]])
    canvas_to_template = np.array(
        [
            [1 / CANVAS_SCALE, 0.0, CANVAS_ORIGIN[0]],
            [0.0, 1 / CANVAS_SCALE, CANVAS_ORIGIN[1]],
            [0.0, 0.0, 1.0],
        ]
    )
    matrix = (affine @ canvas_to_template)[:2]
    height, width = image.shape[:2]
    warped = cv2.warpAffine(color, matrix, (width, height), flags=cv2.INTER_LINEAR)
    weight = cv2.warpAffine(alpha, matrix, (width, height), flags=cv2.INTER_LINEAR)[..., None]
    blended = image.astype(np.float64) * (1 - weight) + warped * weight
    return np.asarray(np.clip(np.round(blended), 0, 255), dtype=np.uint8)


def _line(
    target: NDArray[np.float32],
    start: tuple[float, float],
    end: tuple[float, float],
    value: tuple[float, ...] | float,
    width: float,
) -> None:
    cv2.line(target, _pt(*start), _pt(*end), value, round(width * CANVAS_SCALE), cv2.LINE_AA)


def _mask() -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    color, alpha = _canvas()
    top = MASK_TOP
    outline = _px(
        (6, top + 8), (22, top + 3), (40, top + 1), (56, top), (72, top + 1), (90, top + 3),
        (106, top + 8), (108, 100), (98, 118), (78, 130), (56, 134), (34, 130), (14, 118),
        (4, 100),
    )  # fmt: skip
    cv2.fillPoly(alpha, [outline], 1.0, cv2.LINE_AA)
    shade = np.linspace(1.0, 0.85, color.shape[0], dtype=np.float32)[:, None, None]
    color[:] = np.asarray(MASK_COLOR, np.float32) * shade
    pleat = tuple(0.85 * c for c in MASK_COLOR)
    for y in (top + 12, top + 24, top + 36):
        _line(color, (10, y), (102, y + 2), pleat, 1.5)
    for start, end in (((6, top + 12), (-14, top + 4)), ((106, top + 12), (126, top + 4))):
        _line(color, start, end, (235.0, 235.0, 235.0), 1.2)
        _line(alpha, start, end, 1.0, 1.2)
    return color, alpha


def _scarf(seed: int) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    rng = np.random.default_rng(seed)
    color, alpha = _canvas()
    xs = np.linspace(-48, 160, 27)
    edge = [(float(x), SCARF_TOP + 3 * math.sin(x / 9)) for x in xs]
    cv2.fillPoly(alpha, [_px(*edge, (160, 192), (-48, 192))], 1.0, cv2.LINE_AA)
    first, second = rng.uniform(40, 130, 3), rng.uniform(150, 215, 3)
    yy, xx = np.mgrid[0 : alpha.shape[0], 0 : alpha.shape[1]]
    stripes = (((xx + yy) // (10 * CANVAS_SCALE)) % 2).astype(np.float32)[..., None]
    color[:] = first * stripes + second * (1 - stripes)
    color += rng.normal(0, 6, color.shape).astype(np.float32)
    for x in (8, 38, 68, 98):
        _line(color, (x, SCARF_TOP + 10), (x + 8, 185), (30.0, 30.0, 30.0), 0.8)
    return color, alpha


def _skin(image: Frame, landmarks: Points) -> NDArray[np.float32]:
    """The median colour of a cheek patch, which the hand takes."""
    x, y = face_affine(landmarks) @ np.array([30.0, 78.0, 1.0])
    height, width = image.shape[:2]
    cx = int(np.clip(round(x), 4, width - 5))
    cy = int(np.clip(round(y), 4, height - 5))
    patch = image[cy - 4 : cy + 5, cx - 4 : cx + 5].reshape(-1, 3)
    return np.asarray(np.median(patch, axis=0), dtype=np.float32)


def _hand(skin: NDArray[np.float32]) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    color, alpha = _canvas()
    cv2.ellipse(
        alpha, _pt(60, 108), (30 * CANVAS_SCALE, 21 * CANVAS_SCALE), -12, 0, 360, 1.0, -1,
        cv2.LINE_AA,
    )  # fmt: skip
    for finger in range(4):
        _line(alpha, (36 + 9 * finger, 100), (18 + 13 * finger, 74 + 2 * finger), 1.0, 9)
    color[:] = skin * 0.9
    inside = (alpha > 0.5).astype(np.uint8)  # noqa: PLR2004 - half coverage
    depth = cv2.distanceTransform(inside, cv2.DIST_L2, 5)
    color *= np.clip(0.75 + depth / (12 * CANVAS_SCALE), 0.75, 1.0)[..., None].astype(np.float32)
    for finger in range(1, 4):
        crease = tuple(float(channel) * 0.6 for channel in skin)
        _line(color, (31 + 9 * finger, 96), (12 + 13 * finger, 74), crease, 0.6)
    return color, alpha


def cover(image: Frame, landmarks: Points, item: Covering, seed: int) -> Frame:
    """``image`` with a mask, a scarf or a hand over the lower face of ``landmarks``."""
    if item == "mask":
        color, alpha = _mask()
    elif item == "scarf":
        color, alpha = _scarf(seed)
    elif item == "hand":
        color, alpha = _hand(_skin(image, landmarks))
    else:
        raise ValueError(f"unknown covering {item!r}; known: {', '.join(COVERINGS)}")
    return _paint(image, landmarks, color, alpha)


def glasses(image: Frame, landmarks: Points, *, dark: bool) -> Frame:
    """``image`` with clear or dark glasses on the eyes of ``landmarks``."""
    color, alpha = _canvas()
    lenses, rim = np.zeros_like(alpha), np.zeros_like(alpha)
    half_w, half_h = LENS_HALF_SIZE
    for x, y in TEMPLATE_112[:2]:
        corner, opposite = _pt(x - half_w, y - half_h), _pt(x + half_w, y + half_h)
        cv2.rectangle(lenses, corner, opposite, 1.0, -1, cv2.LINE_AA)
        cv2.rectangle(rim, corner, opposite, 1.0, round(RIM_WIDTH * CANVAS_SCALE), cv2.LINE_AA)
    _line(rim, (53, 48), (59, 48), 1.0, RIM_WIDTH)
    _line(rim, (23, 47), (4, 46), 1.0, 2.0)
    _line(rim, (89, 47), (108, 46), 1.0, 2.0)
    tint, opacity = DARK_LENS if dark else CLEAR_LENS
    color[:] = np.asarray(tint, np.float32)
    alpha[:] = lenses * opacity
    highlight = np.zeros_like(alpha)
    for x, y in TEMPLATE_112[:2]:
        cv2.ellipse(
            highlight, _pt(x - 6, y - 5), (6 * CANVAS_SCALE, 2 * CANVAS_SCALE), -20, 0, 360, 1.0,
            -1, cv2.LINE_AA,
        )  # fmt: skip
    highlight = cv2.GaussianBlur(highlight, (0, 0), CANVAS_SCALE) * lenses * 0.5
    color = color * (1 - highlight[..., None]) + 255 * highlight[..., None]
    alpha = np.maximum(alpha, highlight)
    color = color * (1 - rim[..., None]) + np.asarray(RIM_COLOR, np.float32) * rim[..., None]
    alpha = np.maximum(alpha, rim)
    return _paint(image, landmarks, color.astype(np.float32), alpha.astype(np.float32))
