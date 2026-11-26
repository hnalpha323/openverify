"""Synthetic faces drawn with NumPy and OpenCV for the ``vision-face`` tests (C41.1).

No real face is used: :func:`draw_face` paints a skin-toned oval with eyes, brows, a nose and lips
at known positions, and returns the :class:`~openverify_vision.faces.Face` YuNet would report for
it (its box and five landmarks), so the tests need no detector. Coverings (a mask, a scarf) and
glasses are composited along the same landmarks.

Geometry is in units of the inter-ocular distance (IOD), measured from the eye midpoint, x toward
the image's right and y down, the way YuNet's box sits around a frontal face (the golden selfie
fixture's box is about 2.5 IOD wide, from 1.28 IOD above the eyes to 2.08 IOD below them).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.faces import Face

Image = NDArray[np.uint8]
Colour = tuple[int, int, int]

SKIN: Final[Colour] = (120, 150, 200)
"""BGR skin tone inside the YCrCb skin box (Cr 156, Cb 105)."""
BACKGROUND: Final[Colour] = (70, 90, 60)
HAIR: Final[Colour] = (40, 40, 50)
LIPS: Final[Colour] = (95, 85, 165)
MASK_BLUE: Final[Colour] = (210, 180, 150)
"""A light blue surgical mask, outside the skin box (Cr 110)."""
FRAME: Final[Colour] = (25, 25, 30)

LANDMARKS_IOD: Final = (
    (-0.5, 0.0),  # right eye (the subject's right, on the image's left)
    (0.5, 0.0),  # left eye
    (0.0, 0.6),  # nose tip
    (-0.38, 1.1),  # right mouth corner
    (0.38, 1.1),  # left mouth corner
)
BOX_IOD: Final = (-1.25, -1.28, 2.5, 3.36)
"""YuNet's box around the face: ``(x, y, w, h)`` in IOD units from the eye midpoint."""


@dataclass(frozen=True, slots=True)
class FaceSpec:
    width: int = 640
    height: int = 480
    iod: float = 64.0
    center: tuple[float, float] = (320.0, 200.0)
    """The eye midpoint, in image pixels."""
    roll_deg: float = 0.0
    """In-plane rotation of the whole face about the eye midpoint (positive is clockwise in the
    image, so the image-right eye moves down)."""
    skin: Colour = SKIN
    noise: float = 4.0
    """Standard deviation of the seeded skin texture noise, in grey levels."""
    seed: int = 0


class _Painter:
    """Draws in IOD units onto an upright canvas; the caller rolls the result."""

    def __init__(self, canvas: Image, spec: FaceSpec) -> None:
        self.canvas = canvas
        self.spec = spec

    def point(self, x: float, y: float) -> tuple[int, int]:
        cx, cy = self.spec.center
        return (round(cx + x * self.spec.iod), round(cy + y * self.spec.iod))

    def length(self, value: float) -> int:
        return max(1, round(value * self.spec.iod))

    def ellipse(
        self,
        centre: tuple[float, float],
        axes: tuple[float, float],
        colour: Colour,
        thickness: int = -1,
    ) -> None:
        size = (self.length(axes[0]), self.length(axes[1]))
        cv2.ellipse(self.canvas, self.point(*centre), size, 0, 0, 360, colour, thickness)

    def line(
        self, a: tuple[float, float], b: tuple[float, float], colour: Colour, width: float
    ) -> None:
        cv2.line(self.canvas, self.point(*a), self.point(*b), colour, self.length(width))

    def rectangle(
        self,
        top_left: tuple[float, float],
        bottom_right: tuple[float, float],
        colour: Colour,
        width: float | None,
    ) -> None:
        thickness = -1 if width is None else self.length(width)
        cv2.rectangle(
            self.canvas, self.point(*top_left), self.point(*bottom_right), colour, thickness
        )


def _rotation(spec: FaceSpec) -> NDArray[np.float64]:
    """The 2 x 3 affine rotation by ``roll_deg`` about the eye midpoint (clockwise positive)."""
    # cv2's positive angle is counter-clockwise in the image (y down), so negate.
    return np.asarray(cv2.getRotationMatrix2D(spec.center, -spec.roll_deg, 1.0), dtype=np.float64)


def _face(spec: FaceSpec) -> Face:
    cx, cy = spec.center
    matrix = _rotation(spec)

    def place(x: float, y: float) -> tuple[float, float]:
        px, py = cx + x * spec.iod, cy + y * spec.iod
        mapped = matrix @ np.array([px, py, 1.0])
        return (float(mapped[0]), float(mapped[1]))

    landmarks = tuple(place(x, y) for x, y in LANDMARKS_IOD)
    bx, by, bw, bh = BOX_IOD
    corners = np.array(
        [place(bx, by), place(bx + bw, by), place(bx, by + bh), place(bx + bw, by + bh)]
    )
    left, top = corners.min(axis=0)
    right, bottom = corners.max(axis=0)
    return Face(
        box=(float(left), float(top), float(right - left), float(bottom - top)),
        landmarks=landmarks,
        score=0.95,
    )


def draw_face(spec: FaceSpec | None = None, **overrides: object) -> tuple[Image, Face]:
    """A synthetic frontal face and the YuNet face for it. ``overrides`` replace ``spec`` fields."""
    spec = replace(spec or FaceSpec(), **overrides)  # type: ignore[arg-type]
    canvas = np.zeros((spec.height, spec.width, 3), dtype=np.uint8)
    canvas[:] = BACKGROUND
    paint = _Painter(canvas, spec)
    paint.ellipse((0.0, 0.4), (1.15, 1.6), spec.skin)  # the face, forehead to chin
    paint.ellipse((0.0, -1.25), (1.2, 0.45), HAIR)  # hair above the forehead
    for side in (-1.0, 1.0):
        paint.ellipse((0.5 * side, 0.0), (0.22, 0.1), (215, 215, 220))  # sclera
        paint.ellipse((0.5 * side, 0.0), (0.09, 0.09), (45, 35, 30))  # iris
        paint.line((0.25 * side, -0.3), (0.72 * side, -0.27), HAIR, 0.06)  # brow
    paint.line((0.0, 0.1), (0.0, 0.55), (100, 125, 175), 0.05)  # nose ridge shadow
    paint.ellipse((0.0, 0.62), (0.17, 0.06), (90, 110, 160))  # nostrils
    paint.ellipse((0.0, 1.1), (0.36, 0.09), LIPS)  # lips
    image = canvas
    if spec.noise > 0:
        rng = np.random.default_rng(spec.seed)
        noisy = canvas.astype(np.float32) + rng.normal(0.0, spec.noise, canvas.shape)
        image = np.clip(np.rint(noisy), 0, 255).astype(np.uint8)
    if spec.roll_deg:
        image = np.asarray(
            cv2.warpAffine(
                image,
                _rotation(spec),
                (spec.width, spec.height),
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_REPLICATE,
            ),
            dtype=np.uint8,
        )
    return np.ascontiguousarray(image), _face(spec)


def _upright_layer(spec: FaceSpec) -> tuple[Image, Image]:
    """A blank layer and its mask, painted upright and rolled by :func:`_composite`."""
    layer = np.zeros((spec.height, spec.width, 3), dtype=np.uint8)
    mask = np.zeros((spec.height, spec.width), dtype=np.uint8)
    return layer, mask


def _composite(image: Image, spec: FaceSpec, layer: Image, mask: Image) -> Image:
    if spec.roll_deg:
        size = (spec.width, spec.height)
        layer = np.asarray(
            cv2.warpAffine(layer, _rotation(spec), size, flags=cv2.INTER_NEAREST), dtype=np.uint8
        )
        mask = np.asarray(
            cv2.warpAffine(mask, _rotation(spec), size, flags=cv2.INTER_NEAREST), dtype=np.uint8
        )
    out = image.copy()
    out[mask > 0] = layer[mask > 0]
    return out


def _face_clip(spec: FaceSpec) -> Image:
    clip = np.zeros((spec.height, spec.width), dtype=np.uint8)
    _Painter(clip, spec).ellipse((0.0, 0.4), (1.17, 1.62), (255, 255, 255))
    return clip


def add_mask(image: Image, spec: FaceSpec | None = None, colour: Colour = MASK_BLUE) -> Image:
    """A flat surgical mask from the nose bridge to below the chin, clipped to the face oval."""
    spec = spec or FaceSpec()
    layer, mask = _upright_layer(spec)
    _Painter(layer, spec).rectangle((-1.3, 0.35), (1.3, 2.1), colour, None)
    _Painter(mask, spec).rectangle((-1.3, 0.35), (1.3, 2.1), (255, 255, 255), None)
    mask = np.asarray(cv2.bitwise_and(mask, _face_clip(spec)), dtype=np.uint8)
    for row in range(4):  # pleats
        y = 0.75 + 0.25 * row
        _Painter(layer, spec).line((-1.2, y), (1.2, y), (180, 150, 125), 0.03)
    return _composite(image, spec, layer, mask)


def add_scarf(image: Image, spec: FaceSpec | None = None) -> Image:
    """A striped scarf over the mouth and chin, clipped to the face oval."""
    spec = spec or FaceSpec()
    layer, mask = _upright_layer(spec)
    paint = _Painter(layer, spec)
    for stripe in range(12):
        y0 = 0.8 + 0.1 * stripe
        colour = (40, 40, 140) if stripe % 2 else (30, 110, 60)
        paint.rectangle((-1.3, y0), (1.3, y0 + 0.1), colour, None)
    _Painter(mask, spec).rectangle((-1.3, 0.8), (1.3, 2.1), (255, 255, 255), None)
    mask = np.asarray(cv2.bitwise_and(mask, _face_clip(spec)), dtype=np.uint8)
    return _composite(image, spec, layer, mask)


def add_glasses(
    image: Image,
    spec: FaceSpec | None = None,
    *,
    tinted: bool = False,
    highlight: bool = False,
) -> Image:
    """Rectangular frames around both eyes with a bridge; ``tinted`` fills the lenses dark
    (sunglasses); ``highlight`` adds a specular reflection on the left lens."""
    spec = spec or FaceSpec()
    layer, mask = _upright_layer(spec)
    for target, colour in ((layer, FRAME), (mask, (255, 255, 255))):
        paint = _Painter(target, spec)
        for side in (-1.0, 1.0):
            x0, x1 = sorted((0.17 * side, 0.85 * side))
            if tinted:
                paint.rectangle(
                    (x0, -0.22), (x1, 0.22), (30, 35, 35) if target is layer else colour, None
                )
            paint.rectangle((x0, -0.22), (x1, 0.22), colour, 0.06)
        paint.line((-0.17, -0.06), (0.17, -0.06), colour, 0.06)
        if highlight:
            paint.ellipse(
                (0.62, -0.08), (0.1, 0.06), (255, 255, 255) if target is layer else colour
            )
    return _composite(image, spec, layer, mask)


def add_highlight(
    image: Image, spec: FaceSpec | None, at: tuple[float, float], radius: float = 0.12
) -> Image:
    """A white, colourless specular blob at ``at`` (IOD units)."""
    spec = spec or FaceSpec()
    layer, mask = _upright_layer(spec)
    _Painter(layer, spec).ellipse((at[0], at[1]), (radius, radius), (255, 255, 255))
    _Painter(mask, spec).ellipse((at[0], at[1]), (radius, radius), (255, 255, 255))
    return _composite(image, spec, layer, mask)


def add_hat(image: Image, spec: FaceSpec | None = None, colour: Colour = (90, 40, 30)) -> Image:
    """A hat brim down to just above the brows: the forehead is not visible."""
    spec = spec or FaceSpec()
    layer, mask = _upright_layer(spec)
    _Painter(layer, spec).rectangle((-1.4, -1.8), (1.4, -0.36), colour, None)
    _Painter(mask, spec).rectangle((-1.4, -1.8), (1.4, -0.36), (255, 255, 255), None)
    return _composite(image, spec, layer, mask)


def mirrored(image: Image, face: Face) -> tuple[Image, Face]:
    """The image flipped horizontally, and the face as YuNet labels it there: the eye on the
    image's left is still landmark 0."""
    width = image.shape[1]
    flipped = np.ascontiguousarray(image[:, ::-1])
    x, y, w, h = face.box
    points = [(width - 1 - px, py) for px, py in face.landmarks]
    order = (1, 0, 2, 4, 3)
    return flipped, Face(
        box=(width - x - w, y, w, h),
        landmarks=tuple(points[i] for i in order),
        score=face.score,
    )


def inter_ocular(face: Face) -> float:
    (rx, ry), (lx, ly) = face.landmarks[0], face.landmarks[1]
    return math.hypot(lx - rx, ly - ry)
