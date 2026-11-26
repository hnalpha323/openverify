"""Synthetic card-like images for the C32.1 document tests (vision-document).

Every image is drawn here with NumPy and OpenCV: a plain card with a header band, a portrait box,
word-like bars and an MRZ-like band, optionally with rounded ID-1 corners, placed on a textured
background through a known perspective transform. Nothing is a real document, issuer or person,
and nothing depends on the fixture generator in ``tools/``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

Image = NDArray[np.uint8]
Point = tuple[float, float]
Corners = tuple[Point, Point, Point, Point]
"""Top left, top right, bottom right, bottom left."""
Box = tuple[int, int, int, int]
"""``(x, y, width, height)`` in pixels."""

ID1_ASPECT: Final = 85.60 / 53.98
"""ISO/IEC 7810 ID-1 card, width over height."""

TD3_ASPECT: Final = 125.0 / 88.0
"""ICAO 9303 TD3 passport data page, width over height."""

CARD_CORNER_RADIUS_MM: Final = 3.18
CARD_WIDTH_MM: Final = 85.60

HEADER_COLOUR: Final = (112, 64, 32)
"""Dark blue (BGR): about as dark as the background in grey, different in colour."""


@dataclass(frozen=True, slots=True)
class Card:
    image: Image
    mask: Image
    """255 on the card, 0 outside its rounded corners."""
    portrait: Box
    """The portrait box, in card pixels."""


@dataclass(frozen=True, slots=True)
class Scene:
    image: Image
    corners: Corners
    """Where the card's corners landed, in scene pixels."""

    @property
    def area_ratio(self) -> float:
        height, width = self.image.shape[:2]
        return polygon_area(self.corners) / (width * height)


def make_card(  # noqa: PLR0913 - one switch per layout feature the tests vary
    width: int = 856,
    *,
    aspect: float = ID1_ASPECT,
    rounded: bool = False,
    frames: bool = True,
    header: float = 0.13,
    seed: int = 0,
) -> Card:
    """A light card with a guilloche texture. With ``frames``: a header band of ``header`` of the
    height, an outlined portrait box on the left, rows of word-like bars and an MRZ-like band."""
    height = round(width / aspect)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    top = np.array([214.0, 206.0, 190.0], dtype=np.float32)
    bottom = np.array([200.0, 214.0, 226.0], dtype=np.float32)
    pixels = top + (bottom - top) * (yy / height)[..., None]
    pixels += (8.0 * np.sin(xx / 7.0 + 3.0 * np.sin(yy / 23.0)))[..., None]
    image = np.ascontiguousarray(np.clip(pixels, 0, 245).astype(np.uint8))
    portrait = (round(width * 0.04), round(height * 0.2), round(width * 0.27), round(height * 0.52))
    if frames:
        _draw_frames(image, portrait, header=header, seed=seed)
    mask = np.full((height, width), 255, dtype=np.uint8)
    if rounded:
        mask[:] = 0
        radius = round(width * CARD_CORNER_RADIUS_MM / CARD_WIDTH_MM)
        cv2.rectangle(mask, (radius, 0), (width - 1 - radius, height - 1), 255, -1)
        cv2.rectangle(mask, (0, radius), (width - 1, height - 1 - radius), 255, -1)
        for cx, cy in (
            (radius, radius),
            (width - 1 - radius, radius),
            (width - 1 - radius, height - 1 - radius),
            (radius, height - 1 - radius),
        ):
            cv2.circle(mask, (cx, cy), radius, 255, -1)
    return Card(image=image, mask=mask, portrait=portrait)


def _draw_frames(image: Image, portrait: Box, *, header: float, seed: int) -> None:
    height, width = image.shape[:2]
    rng = np.random.default_rng(seed)
    if header > 0:
        cv2.rectangle(image, (0, 0), (width - 1, round(height * header)), HEADER_COLOUR, -1)
    x, y, w, h = portrait
    cv2.rectangle(image, (x, y), (x + w, y + h), (150, 150, 140), -1)
    centre = (x + w // 2, y + h // 2)
    cv2.ellipse(image, centre, (w // 3, h // 3), 0, 0, 360, (120, 140, 170), -1)
    cv2.rectangle(image, (x, y), (x + w, y + h), (60, 50, 40), 3)
    band = round(height * 0.76)
    cv2.rectangle(image, (0, band), (width - 1, height - 1), (232, 229, 226), -1)
    for row in range(3):
        top = band + 12 + row * round((height - band - 16) / 3)
        for column in range(30):
            left = 20 + column * (width - 40) // 30
            cv2.rectangle(image, (left, top), (left + 14, top + 16), (40, 30, 30), -1)
    for row in range(6):
        top = round(height * 0.22) + row * round(height * 0.08)
        left = round(width * 0.36)
        while left < width * 0.95:
            word = int(rng.integers(20, 90))
            right = min(left + word, round(width * 0.95))
            cv2.rectangle(image, (left, top), (right, top + 12), (60, 40, 30), -1)
            left += word + int(rng.integers(10, 25))


def make_background(width: int, height: int, *, seed: int = 1) -> Image:
    """A dark, brownish, wood-like surface with grain and noise."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    level = 55.0 + 25.0 * np.sin(xx / 140.0) + 15.0 * np.cos(yy / 90.0)
    level += 10.0 * np.sin(yy / 3.0 + 2.0 * np.sin(xx / 50.0))
    level += rng.normal(0.0, 6.0, (height, width))
    surface = np.stack([level * 0.8, level * 0.95, level * 1.15], axis=-1)
    return np.ascontiguousarray(np.clip(surface, 0, 255).astype(np.uint8))


def card_corners(  # noqa: PLR0913 - a placement is a centre, a size, a rotation and a tilt
    cx: float,
    cy: float,
    width: float,
    *,
    aspect: float = ID1_ASPECT,
    degrees: float = 0.0,
    perspective: float = 0.0,
) -> Corners:
    """Corners of a card ``width`` wide centred on ``(cx, cy)``, turned clockwise by ``degrees``;
    ``perspective`` shortens the top side by that share, as if tilted away from the camera."""
    half_w, half_h = width / 2, width / aspect / 2
    shrink = 1.0 - perspective
    local = [
        (-half_w * shrink, -half_h),
        (half_w * shrink, -half_h),
        (half_w, half_h),
        (-half_w, half_h),
    ]
    turn = math.radians(degrees)
    cos, sin = math.cos(turn), math.sin(turn)
    placed = [(cx + x * cos - y * sin, cy + x * sin + y * cos) for x, y in local]
    return (placed[0], placed[1], placed[2], placed[3])


def place_card(
    card: Card, corners: Corners, size: tuple[int, int], *, background: Image | None = None
) -> Scene:
    """Warp ``card`` onto ``corners`` of a ``size`` (width, height) scene, blending its mask."""
    width, height = size
    canvas = make_background(width, height) if background is None else background.copy()
    card_h, card_w = card.image.shape[:2]
    source = np.float32([[0, 0], [card_w - 1, 0], [card_w - 1, card_h - 1], [0, card_h - 1]])
    transform = cv2.getPerspectiveTransform(source, np.float32(corners))
    warped = cv2.warpPerspective(card.image, transform, (width, height), flags=cv2.INTER_LINEAR)
    alpha = cv2.warpPerspective(card.mask, transform, (width, height), flags=cv2.INTER_LINEAR)
    weight = alpha.astype(np.float32)[..., None] / 255.0
    blended = canvas.astype(np.float32) * (1.0 - weight) + warped.astype(np.float32) * weight
    image = np.ascontiguousarray(np.clip(np.rint(blended), 0, 255).astype(np.uint8))
    return Scene(image=image, corners=corners)


def card_to_scene(card: Card, corners: Corners) -> NDArray[np.float64]:
    """The perspective transform ``place_card`` used, as a 3 x 3 matrix."""
    card_h, card_w = card.image.shape[:2]
    source = np.float32([[0, 0], [card_w - 1, 0], [card_w - 1, card_h - 1], [0, card_h - 1]])
    return np.asarray(cv2.getPerspectiveTransform(source, np.float32(corners)), dtype=np.float64)


def make_photo(width: int, height: int, *, seed: int = 5) -> Image:
    """A non-document photo: the background with coloured discs and a few straight strokes."""
    rng = np.random.default_rng(seed)
    scene = make_background(width, height, seed=seed)
    for _ in range(12):
        centre = (int(rng.integers(0, width)), int(rng.integers(0, height)))
        colour = tuple(int(v) for v in rng.integers(0, 255, 3))
        cv2.circle(scene, centre, int(rng.integers(20, 120)), colour, -1)
    for _ in range(8):
        start = (int(rng.integers(0, width)), int(rng.integers(0, height)))
        end = (int(rng.integers(0, width)), int(rng.integers(0, height)))
        colour = tuple(int(v) for v in rng.integers(0, 255, 3))
        cv2.line(scene, start, end, colour, 3)
    return scene


def polygon_area(points: Corners | NDArray[np.float64]) -> float:
    xy = np.asarray(points, dtype=np.float64)
    x, y = xy[:, 0], xy[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2.0)


def corner_error(found: object, truth: Corners) -> float:
    """Largest distance between matching corners (both clockwise from the top left)."""
    return float(
        np.max(np.linalg.norm(np.asarray(found, dtype=np.float64) - np.asarray(truth), axis=1))
    )


def on_screen(image: Image, *, seed: int = 0) -> Image:
    """``image`` shown at half size on an RGB-stripe display and photographed.

    Each display pixel is a red, a green and a blue column (each letting half its light through
    the other channels) over a darker row; the camera samples the display at 0.72 of its pitch
    through a 1.5 degree turn, which aliases the grid into moire stripes.
    """
    rng = np.random.default_rng(seed)
    height, width = image.shape[:2]
    half = (round(width * 0.5), round(height * 0.5))
    shown = cv2.resize(image, half, interpolation=cv2.INTER_AREA).astype(np.float32)
    lit = np.repeat(np.repeat(shown, 3, axis=0), 3, axis=1)
    grid = np.full(lit.shape, 0.5, dtype=np.float32)
    for column in range(3):
        grid[:, column::3, 2 - column] = 1.0  # BGR: the red column first
    grid[2::3] *= 0.6
    lit = lit * grid / float(grid.mean())
    rows, columns = lit.shape[:2]
    size = (round(columns * 0.72), round(rows * 0.72))
    turn = cv2.getRotationMatrix2D((columns / 2, rows / 2), 1.5, 0.72)
    turn[0, 2] += size[0] / 2 - columns / 2
    turn[1, 2] += size[1] / 2 - rows / 2
    shot = cv2.warpAffine(lit, turn, size, flags=cv2.INTER_LINEAR, borderValue=(18.0, 15.0, 14.0))
    shot = cv2.GaussianBlur(shot, (0, 0), 0.6) + rng.normal(0.0, 2.0, shot.shape)
    return np.ascontiguousarray(np.clip(shot, 0, 230).astype(np.uint8))


MEASURE_WIDTH: Final = 1000
MEASURE_SIGMA: Final = 0.8
TEXT_MIN_SHARE: Final = 0.02


def document_sharpness(
    image: Image, boxes: list[tuple[float, float, float, float]] | None = None
) -> tuple[float, float]:
    """``(blur_score, tenengrad)`` of a rectified document as ``document_quality`` defines them
    (Phase 12A V3), written out: the document resized to 1,000 pixels wide (area averaging down,
    cubic up), grey, smoothed by a Gaussian of sigma 0.8 in floating point, then the variance of
    its Laplacian and the mean squared Sobel magnitude over the text boxes (rectified pixels),
    or over everything when they cover less than 2% of it."""
    height, width = image.shape[:2]
    target = (MEASURE_WIDTH, round(height * MEASURE_WIDTH / width))
    interpolation = cv2.INTER_AREA if width > MEASURE_WIDTH else cv2.INTER_CUBIC
    resized = cv2.resize(image, target, interpolation=interpolation)
    grey = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY) if resized.ndim == 3 else resized
    smooth = cv2.GaussianBlur(grey.astype(np.float32), (0, 0), MEASURE_SIGMA)
    scale = MEASURE_WIDTH / width
    mask = np.zeros(smooth.shape, dtype=bool)
    for x, y, w, h in boxes or []:
        left, top = max(0, math.floor(x * scale)), max(0, math.floor(y * scale))
        right, bottom = math.ceil((x + w) * scale), math.ceil((y + h) * scale)
        mask[top:bottom, left:right] = True
    if mask.mean() < TEXT_MIN_SHARE:
        mask[:] = True
    laplacian = cv2.Laplacian(smooth, cv2.CV_32F).astype(np.float64)
    gx = cv2.Sobel(smooth, cv2.CV_32F, 1, 0, ksize=3).astype(np.float64)
    gy = cv2.Sobel(smooth, cv2.CV_32F, 0, 1, ksize=3).astype(np.float64)
    return float(laplacian[mask].var()), float((gx * gx + gy * gy)[mask].mean())
