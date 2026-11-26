"""Model-free stand-ins for the C45.2 selfie generators' tests.

:class:`MarkerKit` replaces YuNet and the canonical-mesh re-pose: its render shifts the frame and
writes the yaw into the top-left pixel, and its readings decode that pixel into a yaw ratio of
``bias + slope * yaw`` on two measurement paths. :func:`drawn_face` is a synthetic cartoon face
whose five landmarks are known; no real face is involved anywhere here.
"""

from __future__ import annotations

from collections.abc import Sequence

import cv2
import numpy as np
from numpy.typing import NDArray

Frame = NDArray[np.uint8]

_MARKED = 255
"""Red channel of the top-left pixel of a rendered frame; an unrendered frame reads yaw 0."""

RELATIVE_LANDMARKS = (
    (0.44, 0.40),  # right eye (image left)
    (0.56, 0.40),  # left eye
    (0.50, 0.50),  # nose tip
    (0.455, 0.60),  # right mouth corner
    (0.545, 0.60),  # left mouth corner
)


def landmarks_for(frame: Frame) -> NDArray[np.float64]:
    height, width = frame.shape[:2]
    return np.asarray([(x * width, y * height) for x, y in RELATIVE_LANDMARKS], dtype=np.float64)


class MarkerKit:
    """A :class:`head_turn.SelfieKit` without models (see the module docstring).

    ``faceless_calls`` makes the first that many :meth:`landmarks` calls find no face."""

    def __init__(self, *, slope: float = 0.006, bias: float = 0.0, faceless_calls: int = 0) -> None:
        self.slope = slope
        self.bias = bias
        self.faceless_calls = faceless_calls
        self.rendered: list[float] = []

    def landmarks(self, frame: Frame) -> NDArray[np.float64] | None:
        if self.faceless_calls > 0:
            self.faceless_calls -= 1
            return None
        return landmarks_for(frame)

    def render(self, frame: Frame, landmarks: NDArray[np.float64], yaw_deg: float) -> Frame:
        assert landmarks.shape == (5, 2)
        self.rendered.append(yaw_deg)
        out = np.roll(frame, round(yaw_deg), axis=1).copy()
        code = round(yaw_deg * 100) + 5000
        out[0, 0] = (code % 256, code // 256, _MARKED)
        return out

    @staticmethod
    def yaw_of(frame: Frame) -> float:
        blue, green, red = (int(v) for v in frame[0, 0])
        if red != _MARKED:
            return 0.0
        return (green * 256 + blue - 5000) / 100

    def readings(self, frame: Frame) -> dict[str, float | None]:
        ratio = self.bias + self.slope * self.yaw_of(frame)
        return {"client@320": ratio, "server@640": ratio}


def drawn_face(
    size: tuple[int, int] = (640, 480), skin: Sequence[int] = (120, 160, 205)
) -> tuple[Frame, NDArray[np.float64]]:
    """A flat-shaded cartoon face on a textured background, and its five landmarks."""
    width, height = size
    yy, xx = np.mgrid[0:height, 0:width]
    image = np.stack(
        [60 + xx * 60 // width, 90 + yy * 50 // height, 110 + (xx + yy) % 23], axis=-1
    ).astype(np.uint8)
    points = landmarks_for(image)
    centre = (round(width * 0.5), round(height * 0.5))
    axes = (round(width * 0.13), round(height * 0.24))
    cv2.ellipse(image, centre, axes, 0, 0, 360, tuple(int(c) for c in skin), -1, cv2.LINE_AA)
    for x, y in points[:2]:
        cv2.circle(image, (round(x), round(y)), round(width * 0.012), (40, 30, 30), -1)
    cv2.line(
        image,
        (round(points[3][0]), round(points[3][1])),
        (round(points[4][0]), round(points[4][1])),
        (60, 50, 150),
        3,
        cv2.LINE_AA,
    )
    return np.ascontiguousarray(image), points


def textured(size: tuple[int, int] = (640, 480), seed: int = 3) -> Frame:
    """A smooth, colourful, seeded test picture with a few hard edges."""
    width, height = size
    rng = np.random.default_rng(seed)
    low = rng.uniform(40, 220, (6, 8, 3)).astype(np.float32)
    image = cv2.resize(low, (width, height), interpolation=cv2.INTER_CUBIC)
    cv2.rectangle(image, (width // 4, height // 4), (width // 2, height // 2), (30, 200, 60), -1)
    return np.ascontiguousarray(np.clip(image, 0, 255).astype(np.uint8))
