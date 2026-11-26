"""C45.2 presentation-attack simulations, in OpenCV and NumPy only and seeded (research §10.3).

**Pipeline fixtures, not attack-detection rates.** These recipes exercise the pipeline and the
gross cues a heuristic may look at (moiré, a bezel, glare, a raised black level, halftone dots
and paper tone). MiniFASNet was trained on real recaptures, so its response to these says
nothing about real attacks; APCER and BPCER need a physical ISO/IEC 30107-3 campaign.

- :func:`screen_replay`: the LCDMoire recipe (Yuan et al., arXiv:1911.02498): each pixel becomes a
  3 x 3 subpixel block ``[K K K; R G B; R G B]``, an anti-alias blur of about 0.45 camera pixels,
  a random perspective (the screen slightly larger than the frame), a 3 x 3 Gaussian, Bayer RGGB
  sampling with sensor noise, a bilinear demosaic and OpenCV's denoise, and a gain back to the
  source's brightness (the mosaic darkens it).
- :func:`phone_composite`: the frame shown on a phone held in front of the camera: a raised black
  level (backlight bleed), a cooler white point and gamma, an elliptical specular glare; with
  ``bezel`` the screen sits in a dark rounded bezel, perspective-warped over a seeded room
  background; without it the screen fills the frame (the common attack).
- :func:`print_halftone`: a print photographed whole: a desaturated, paper-toned CMYK rendering
  with clustered-dot screens at the classic angles (C 15, M 75, Y 0, K 45 degrees) about 1.5
  camera pixels apart, paper texture, a slight cylindrical bend, then camera noise.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from functools import partial
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

Frame = NDArray[np.uint8]
Floats = NDArray[np.float64]

# --- screen replay --------------------------------------------------------------------------------

SCREEN_PITCH: Final = 1.08
"""Camera pixels per screen pixel: the screen shows the frame 8% larger than the camera sees."""

SCREEN_JITTER: Final = 0.03
"""Each corner of the screen moves up to 3% of the frame: the phone is not held square."""

ANTI_ALIAS_SIGMA: Final = 0.45
"""In camera pixels: a faint, realistic moiré (research §10.3; 0 gives a garish rainbow)."""

SENSOR_NOISE: Final = 2.0
MAX_GAIN: Final = 8.0
DENOISE_WINDOWS: Final = (5, 11)
"""OpenCV's non-local means with smaller template and search windows than its defaults (7, 21):
a phone's light denoise, at a quarter of the cost."""


def _subpixel_mosaic(image: Frame) -> Frame:
    """Each pixel as a 3 x 3 block: a black row, then two rows of its R, G and B subpixels."""
    height, width = image.shape[:2]
    mosaic = np.zeros((3 * height, 3 * width, 3), dtype=np.uint8)
    for row in (1, 2):
        mosaic[row::3, 0::3, 2] = image[:, :, 2]
        mosaic[row::3, 1::3, 1] = image[:, :, 1]
        mosaic[row::3, 2::3, 0] = image[:, :, 0]
    return mosaic


def _bayer(image: Frame) -> Floats:
    """The RGGB colour filter array a camera sensor samples ``image`` (BGR) through."""
    mosaic = np.zeros(image.shape[:2], dtype=np.float64)
    mosaic[0::2, 0::2] = image[0::2, 0::2, 2]
    mosaic[0::2, 1::2] = image[0::2, 1::2, 1]
    mosaic[1::2, 0::2] = image[1::2, 0::2, 1]
    mosaic[1::2, 1::2] = image[1::2, 1::2, 0]
    return mosaic


def _corners(width: int, height: int) -> Floats:
    return np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float64)


def screen_replay(image: Frame, seed: int) -> Frame:
    """``image`` shown on an LCD and photographed (the module docstring's recipe)."""
    rng = np.random.default_rng(seed)
    height, width = image.shape[:2]
    mosaic = _subpixel_mosaic(image)
    mosaic_per_camera = 3 / SCREEN_PITCH
    blurred = cv2.GaussianBlur(mosaic, (0, 0), ANTI_ALIAS_SIGMA * mosaic_per_camera)
    centre = np.array([width / 2, height / 2])
    screen = (
        centre
        + (_corners(width, height) - centre) * SCREEN_PITCH
        + rng.uniform(-SCREEN_JITTER, SCREEN_JITTER, (4, 2)) * [width, height]
    )
    homography = cv2.getPerspectiveTransform(
        _corners(3 * width, 3 * height).astype(np.float32), screen.astype(np.float32)
    )
    seen = cv2.warpPerspective(blurred, homography, (width, height), flags=cv2.INTER_LINEAR)
    seen = cv2.GaussianBlur(seen, (3, 3), 0)
    raw = _bayer(np.asarray(seen, dtype=np.uint8)) + rng.normal(0, SENSOR_NOISE, (height, width))
    sensor = np.clip(np.round(raw), 0, 255).astype(np.uint8)
    demosaiced = cv2.cvtColor(sensor, cv2.COLOR_BayerRGGB2BGR)
    denoised = cv2.fastNlMeansDenoisingColored(demosaiced, None, 3, 3, *DENOISE_WINDOWS)
    source_mean = image.reshape(-1, 3).mean(axis=0)
    seen_mean = np.maximum(denoised.reshape(-1, 3).mean(axis=0), 1.0)
    gain = np.clip(source_mean / seen_mean, 1.0, MAX_GAIN)
    return np.clip(denoised * gain, 0, 255).astype(np.uint8)


# --- phone composite ------------------------------------------------------------------------------

BLACK_LEVEL: Final = 15.0
"""Backlight bleed, out of 255: a screen never shows true black."""

COOL_WHITE: Final = (1.06, 1.0, 0.94)
"""BGR gains of a cooler white point."""

SCREEN_GAMMA: Final = 0.92
GLARE_PEAK: Final = 70.0
BEZEL_SHARE: Final = 0.045
"""The bezel's thickness as a share of the screen width (research: 3-6%)."""

BEZEL_COLOR: Final = (18, 18, 20)
PHONE_HEIGHT_SHARE: Final = 0.9
PHONE_JITTER: Final = 0.03
PHONE_ASPECT: Final = 9 / 16


def _screen(image: Frame, rng: np.random.Generator) -> Frame:
    """``image`` as a phone screen shows it: black level, white point, gamma and glare."""
    height, width = image.shape[:2]
    shown = BLACK_LEVEL + image.astype(np.float64) * (255 - BLACK_LEVEL) / 255
    shown *= np.asarray(COOL_WHITE)
    shown = 255 * (np.clip(shown, 0, 255) / 255) ** SCREEN_GAMMA
    cx, cy = rng.uniform(0.25, 0.75) * width, rng.uniform(0.1, 0.35) * height
    angle = rng.uniform(-0.6, 0.6)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float64)
    dx, dy = xx - cx, yy - cy
    u = (dx * math.cos(angle) + dy * math.sin(angle)) / (0.18 * width)
    v = (-dx * math.sin(angle) + dy * math.cos(angle)) / (0.07 * height)
    shown += GLARE_PEAK * np.exp(-(u * u + v * v))[..., None]
    return np.clip(shown, 0, 255).astype(np.uint8)


def _room(height: int, width: int, rng: np.random.Generator) -> Frame:
    """A seeded, muted wall: a warm grey with soft, low-frequency variation."""
    wall = rng.uniform(120, 175, 3) * np.array([0.88, 0.95, 1.0])
    variation = rng.normal(0, 14, (4, 5)).astype(np.float32)
    shading = np.asarray(
        cv2.resize(variation, (width, height), interpolation=cv2.INTER_CUBIC), dtype=np.float64
    )
    room = wall[None, None, :] + shading[..., None] + rng.normal(0, 2, (height, width, 3))
    return np.asarray(np.clip(room, 0, 255), dtype=np.uint8)


def _rounded_mask(height: int, width: int, radius: int) -> Frame:
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.rectangle(mask, (radius, 0), (width - 1 - radius, height - 1), 255, -1)
    cv2.rectangle(mask, (0, radius), (width - 1, height - 1 - radius), 255, -1)
    for x, y in (
        (radius, radius),
        (width - 1 - radius, radius),
        (radius, height - 1 - radius),
        (width - 1 - radius, height - 1 - radius),
    ):
        cv2.circle(mask, (x, y), radius, 255, -1, cv2.LINE_AA)
    return mask


def phone_composite(image: Frame, seed: int, *, bezel: bool) -> Frame:
    """``image`` on a phone screen held up to the camera (the module docstring's recipe)."""
    rng = np.random.default_rng(seed)
    height, width = image.shape[:2]
    if not bezel:
        return _screen(image, rng)
    screen_width = round(height * PHONE_ASPECT)
    left = (width - screen_width) // 2
    screen = _screen(np.ascontiguousarray(image[:, left : left + screen_width]), rng)
    thickness = max(2, round(BEZEL_SHARE * screen_width))
    body = np.empty((height + 2 * thickness, screen_width + 2 * thickness, 3), dtype=np.uint8)
    body[:] = BEZEL_COLOR
    body[thickness : thickness + height, thickness : thickness + screen_width] = screen
    body_height, body_width = body.shape[:2]
    outline = _rounded_mask(body_height, body_width, 3 * thickness)
    scale = PHONE_HEIGHT_SHARE * height / body_height
    centre = np.array([width / 2, height / 2])
    half = np.array([body_width, body_height]) / 2
    corners = (
        centre
        + (_corners(body_width, body_height) - half) * scale
        + rng.uniform(-PHONE_JITTER, PHONE_JITTER, (4, 2)) * [width, height]
    )
    homography = cv2.getPerspectiveTransform(
        _corners(body_width, body_height).astype(np.float32), corners.astype(np.float32)
    )
    phone = cv2.warpPerspective(body, homography, (width, height), flags=cv2.INTER_AREA)
    alpha = cv2.warpPerspective(outline, homography, (width, height), flags=cv2.INTER_LINEAR)
    weight = alpha.astype(np.float64)[..., None] / 255
    scene = _room(height, width, rng) * (1 - weight) + phone * weight
    scene += rng.normal(0, 1.5, scene.shape)
    return np.clip(scene, 0, 255).astype(np.uint8)


# --- print halftone -------------------------------------------------------------------------------

PRINT_SCALE: Final = 3
"""The print is rendered at 3 x the frame, so its dots can be finer than a camera pixel."""

HALFTONE_CELL: Final = 4.5
"""Dot pitch at :data:`PRINT_SCALE`: 1.5 camera pixels, as when a photo fills the frame."""

SCREEN_ANGLES: Final = {"c": 15.0, "m": 75.0, "y": 0.0, "k": 45.0}
DESATURATION: Final = 0.8
PAPER_WHITE: Final = (225.0, 235.0, 240.0)
"""BGR: paper is never pure white (research: about (240, 235, 225) in RGB)."""

INK_BLACK: Final = 30.0
PAPER_TEXTURE: Final = 0.04
BEND: Final = 0.03
CAMERA_NOISE: Final = 2.0


Singles = NDArray[np.float32]


def _halftone(coverage: Singles, angle_deg: float, grid: tuple[Singles, Singles]) -> Singles:
    """1 where a clustered-dot screen at ``angle_deg`` puts ink for ``coverage`` (0-1)."""
    yy, xx = grid
    angle = math.radians(angle_deg)
    cos, sin = np.float32(math.cos(angle)), np.float32(math.sin(angle))
    step = np.float32(2 * math.pi / HALFTONE_CELL)
    spot = (np.cos((xx * cos + yy * sin) * step) * np.cos((yy * cos - xx * sin) * step) + 1) / 2
    return np.asarray(coverage > spot, dtype=np.float32)


def print_halftone(image: Frame, seed: int) -> Frame:
    """``image`` printed and photographed (the module docstring's recipe)."""
    rng = np.random.default_rng(seed)
    height, width = image.shape[:2]
    big_h, big_w = PRINT_SCALE * height, PRINT_SCALE * width
    big = cv2.resize(image, (big_w, big_h), interpolation=cv2.INTER_CUBIC)
    up: Singles = big.astype(np.float32) / np.float32(255)
    gray = up.mean(axis=2, keepdims=True)
    up = np.clip(gray + np.float32(DESATURATION) * (up - gray), 0, 1)
    blue, green, red = up[..., 0], up[..., 1], up[..., 2]
    key = 1 - np.maximum(np.maximum(red, green), blue)
    rest = np.maximum(1 - key, np.float32(1e-6))
    rows, columns = np.mgrid[0:big_h, 0:big_w]
    grid = (rows.astype(np.float32), columns.astype(np.float32))
    ink = {
        "c": _halftone((1 - red - key) / rest, SCREEN_ANGLES["c"], grid),
        "m": _halftone((1 - green - key) / rest, SCREEN_ANGLES["m"], grid),
        "y": _halftone((1 - blue - key) / rest, SCREEN_ANGLES["y"], grid),
        "k": _halftone(key, SCREEN_ANGLES["k"], grid),
    }
    paper = 1 - ink["k"]
    printed = np.stack([(1 - ink["y"]) * paper, (1 - ink["m"]) * paper, (1 - ink["c"]) * paper], -1)
    printed = INK_BLACK + (np.asarray(PAPER_WHITE, np.float32) - INK_BLACK) * printed
    noise = rng.normal(0, 1, (big_h, big_w)).astype(np.float32)
    texture = cv2.GaussianBlur(noise, (0, 0), 1.5) * np.float32(PAPER_TEXTURE * 255)
    printed = np.clip(printed + texture[..., None], 0, 255).astype(np.uint8)
    yy, xx = grid
    cx, cy = big_w / 2, big_h / 2
    across = (xx - cx) / np.float32(cx)
    map_x = np.asarray(cx + (xx - cx) * (1 + BEND * across**2), dtype=np.float32)
    map_y = np.asarray(yy + BEND * 0.5 * big_h * across**2 * (yy - cy) / cy, dtype=np.float32)
    bent = cv2.remap(printed, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    seen = cv2.resize(bent, (width, height), interpolation=cv2.INTER_AREA).astype(np.float64)
    seen += rng.normal(0, CAMERA_NOISE, seen.shape)
    return np.clip(seen, 0, 255).astype(np.uint8)


SPOOFS: Final[dict[str, Callable[[Frame, int], Frame]]] = {
    "screen_replay": screen_replay,
    "phone_bezel": partial(phone_composite, bezel=True),
    "phone_full_frame": partial(phone_composite, bezel=False),
    "print_halftone": print_halftone,
}
"""Every C45.2 spoof by kind; each takes the frame and a seed."""

RECIPES: Final[dict[str, str]] = {
    "screen_replay": (
        "LCDMoire (arXiv:1911.02498): 3x3 subpixel mosaic, 0.45 camera-pixel anti-alias blur, "
        "perspective with 3% corner jitter, Bayer RGGB sampling with sensor noise, demosaic, "
        "denoise, gain back to the source brightness"
    ),
    "phone_bezel": (
        "phone screen (black level +15, cooler white, gamma 0.92, elliptical glare) in a 4.5% "
        "dark rounded bezel, perspective-warped over a seeded wall"
    ),
    "phone_full_frame": (
        "phone screen filling the frame: black level +15, cooler white, gamma 0.92, glare"
    ),
    "print_halftone": (
        "desaturated CMYK print on paper white (225, 235, 240 BGR) with ink black 30, "
        "clustered-dot screens at C 15, M 75, Y 0, K 45 degrees 1.5 camera pixels apart, paper "
        "texture, a slight cylindrical bend, camera noise"
    ),
}
"""What each recipe does, for the fixture index."""
