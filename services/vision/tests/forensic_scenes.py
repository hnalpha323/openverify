"""Synthetic scenes for the barcode and forensics tests (C32.1).

Every image is drawn here, from a fixed seed: an ID-1-shaped card in the style of the fictional
Utopia test card (no real design, seal, person or face; the "portrait" is a smooth blob on a
neutral photo background), the noise and JPEG history of a camera, a screen recapture, splices.
AAMVA payloads are rendered only as barcode-only images on a plain background (C36), in
``test_barcode.py``.
"""

from __future__ import annotations

import io
import math
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont

from openverify_vision.document import DocumentResult
from openverify_vision.imaging import decode_image
from openverify_vision.schemas import BoundingBox, DocumentDetection

Image = NDArray[np.uint8]

CARD_SIZE: Final = (1012, 638)
"""``(width, height)`` of the card: ID-1 (85.60 x 53.98 mm) at about 11.8 pixels per mm."""

PORTRAIT: Final = (40, 130, 300, 380)
"""``(x, y, width, height)`` of the portrait photo on the card."""

FACE: Final[BoundingBox] = (100.0, 190.0, 180.0, 220.0)
"""The face box a detector would report: inside the portrait, ICAO-style framing."""

HEADER_HEIGHT: Final = 100
STAR_CENTRE: Final = (930, 50)
STAR_RADIUS: Final = 32

_BACKGROUND_TOP: Final = (198, 220, 214)
_BACKGROUND_BOTTOM: Final = (219, 208, 226)
_GUILLOCHE: Final = (168, 192, 196)
_HEADER: Final = (32, 64, 112)
_HEADER_INK: Final = (226, 233, 242)
_INK: Final = (24, 38, 74)
_PHOTO_BACKGROUND: Final = (210, 208, 205)
_SKIN: Final = (200, 150, 120)
_STAR_GOLD: Final = (232, 182, 60)
_FIELDS: Final = (
    ("SURNAME", "VALEMONT"),
    ("GIVEN NAMES", "QUINN"),
    ("DATE OF BIRTH", "14 02 1990"),
    ("DOCUMENT NO.", "X12K45P78"),
)


def _font(size: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.load_default(size=size)
    assert isinstance(font, ImageFont.FreeTypeFont)
    return font


def star_points(
    centre: tuple[float, float], radius: float, *, inner: float = 0.382, rotation: float = -90.0
) -> list[tuple[float, float]]:
    """The ten corners of a five-pointed star (outer points first, from ``rotation`` degrees)."""
    cx, cy = centre
    points = []
    for i in range(10):
        angle = math.radians(rotation + i * 36)
        r = radius if i % 2 == 0 else radius * inner
        points.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    return points


def _portrait(seed: int) -> PILImage.Image:
    """A neutral photo background with a smooth, face-sized blob and fine texture."""
    _, _, width, height = PORTRAIT
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:height, 0:width]
    blob = np.exp(-(((xx - width / 2) / 72) ** 2 + ((yy - height * 0.45) / 100) ** 2))
    shade = cv2.GaussianBlur(rng.normal(0.0, 1.0, (height, width)), (0, 0), 9)
    shade /= max(float(np.abs(shade).max()), 1e-9)
    background = np.array(_PHOTO_BACKGROUND, dtype=np.float64)
    skin = np.array(_SKIN, dtype=np.float64) * (1.0 + 0.12 * shade[..., None])
    pixels = background * (1.0 - blob[..., None]) + skin * blob[..., None]
    return PILImage.fromarray(np.clip(np.rint(pixels), 0, 255).astype(np.uint8), "RGB")


def card(seed: int = 0, *, star: bool = False, size: tuple[int, int] = CARD_SIZE) -> Image:
    """The synthetic card as a BGR array (``size`` rescales the whole card)."""
    width, height = CARD_SIZE
    ramp = np.linspace(0.0, 1.0, height)[:, None, None]
    top, bottom = np.array(_BACKGROUND_TOP), np.array(_BACKGROUND_BOTTOM)
    pixels = np.broadcast_to(top + (bottom - top) * ramp, (height, width, 3))
    image = PILImage.fromarray(np.rint(pixels).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(image)
    for wave in range(26):
        base = 18 + wave * 24
        phase = wave * 0.7 + seed
        points = [
            (x, base + 9 * math.sin(2 * math.pi * x / 140 + phase)) for x in range(0, width + 4, 4)
        ]
        draw.line(points, fill=_GUILLOCHE, width=1)
    draw.rectangle((0, 0, width, HEADER_HEIGHT), fill=_HEADER)
    draw.text((30, 25), "UTOPIA", font=_font(44), fill=_HEADER_INK)
    draw.text((380, 36), "IDENTITY CARD", font=_font(30), fill=_HEADER_INK)
    for row, (label, value) in enumerate(_FIELDS):
        top_y = 130 + row * 80
        draw.text((380, top_y), label, font=_font(20), fill=_INK)
        draw.text((380, top_y + 24), value, font=_font(34), fill=_INK)
    draw.text((380, 470), "OPENVERIFY SYNTHETIC TEST CARD", font=_font(26), fill=(150, 40, 50))
    x, y, w, h = PORTRAIT
    image.paste(_portrait(seed), (x, y))
    draw.rectangle((x - 2, y - 2, x + w + 1, y + h + 1), outline=(74, 88, 118), width=2)
    if star:
        draw.polygon(star_points(STAR_CENTRE, STAR_RADIUS), fill=_STAR_GOLD)
    bgr = np.ascontiguousarray(np.asarray(image)[:, :, ::-1])
    if size != CARD_SIZE:
        bgr = np.asarray(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)
    return bgr


def camera(image: Image, seed: int = 1, noise: float = 2.5) -> Image:
    """Seeded Gaussian sensor noise."""
    rng = np.random.default_rng(seed)
    noisy = image.astype(np.float64) + rng.normal(0.0, noise, image.shape)
    return np.clip(np.rint(noisy), 0, 255).astype(np.uint8)


def encode(image: Image, fmt: str, **save_kwargs: object) -> bytes:
    """Encode a BGR (or grey) array with Pillow."""
    rgb = image if image.ndim == 2 else np.ascontiguousarray(image[:, :, ::-1])
    buffer = io.BytesIO()
    PILImage.fromarray(rgb).save(buffer, format=fmt, **save_kwargs)  # type: ignore[arg-type]
    return buffer.getvalue()


def jpeg(image: Image, quality: int, **save_kwargs: object) -> bytes:
    return encode(image, "JPEG", quality=quality, **save_kwargs)


def decode(data: bytes) -> Image:
    """The service's own upright BGR decode."""
    return decode_image(data, max_pixels=200_000_000)


def recompress(image: Image, *qualities: int) -> Image:
    """``image`` through one JPEG save and decode per quality, in order."""
    for quality in qualities:
        image = decode(jpeg(image, quality))
    return image


def full_frame(image: Image) -> DocumentResult:
    """The document as a tightly cropped upload: the whole frame, rectified as is."""
    height, width = image.shape[:2]
    detection = DocumentDetection(
        found=True,
        quad=((0.0, 0.0), (float(width), 0.0), (float(width), float(height)), (0.0, float(height))),
        method="full_frame",
        rectified_size=(width, height),
        aspect_ratio=width / height,
        area_ratio=1.0,
    )
    return DocumentResult(detection=detection, rectified=image)


def not_found() -> DocumentResult:
    detection = DocumentDetection(
        found=False,
        quad=None,
        method="none",
        rectified_size=None,
        aspect_ratio=None,
        area_ratio=None,
    )
    return DocumentResult(detection=detection, rectified=None)


def on_background(
    image: Image, *, canvas: tuple[int, int] = (1600, 1200), seed: int = 3
) -> tuple[Image, DocumentResult]:
    """``image`` photographed on a textured table at an angle, and its document result.

    The quad is where the card's corners land; the rectified copy is warped back from the photo,
    as a document detector would produce it.
    """
    height, width = image.shape[:2]
    canvas_w, canvas_h = canvas
    rng = np.random.default_rng(seed)
    table = cv2.GaussianBlur(rng.normal(90.0, 25.0, (canvas_h, canvas_w, 3)), (0, 0), 3)
    quad = np.array([[260, 230], [1340, 300], [1300, 980], [220, 900]], dtype=np.float32)
    corners = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    forward = cv2.getPerspectiveTransform(corners, quad)
    warped = cv2.warpPerspective(image, forward, canvas, flags=cv2.INTER_LINEAR)
    mask = cv2.warpPerspective(np.full((height, width), 255, np.uint8), forward, canvas)
    photo = np.where(mask[..., None] > 0, warped, np.clip(table, 0, 255).astype(np.uint8))
    photo = camera(np.ascontiguousarray(photo), seed=seed)
    back = cv2.getPerspectiveTransform(quad, corners)
    rectified = np.asarray(cv2.warpPerspective(photo, back, (width, height)), dtype=np.uint8)
    detection = DocumentDetection(
        found=True,
        quad=tuple((float(x), float(y)) for x, y in quad),  # type: ignore[arg-type]
        method="contour",
        rectified_size=(width, height),
        aspect_ratio=width / height,
        area_ratio=0.45,
    )
    return photo, DocumentResult(detection=detection, rectified=rectified)


def screen_recapture(
    image: Image, *, subpixels: int = 3, scale: float = 0.33, angle: float = 2.0, seed: int = 0
) -> Image:
    """``image`` shown on an RGB-stripe screen and photographed: pixel grid, aliasing, moire.

    Each image pixel becomes ``subpixels`` columns (R, G, B) with a dark gap row, and the
    camera samples the screen slightly rotated and without anti-aliasing.
    """
    big = np.repeat(np.repeat(image.astype(np.float64), subpixels, 0), subpixels, 1)
    screen = np.zeros_like(big)
    for column in range(subpixels):
        channel = 2 - column % 3  # BGR: red, green, blue stripes
        screen[:, column::subpixels, channel] = big[:, column::subpixels, channel]
    screen[subpixels - 1 :: subpixels] *= 0.3
    screen = np.clip(screen * 1.2, 0, 255).astype(np.uint8)
    height, width = screen.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, scale)
    matrix[0, 2] += (width * scale - width) / 2
    matrix[1, 2] += (height * scale - height) / 2
    size = (round(width * scale), round(height * scale))
    shot = cv2.warpAffine(screen, matrix, size, flags=cv2.INTER_LINEAR, borderValue=(40, 40, 40))
    shot = cv2.GaussianBlur(shot, (0, 0), 0.5)
    return camera(np.asarray(shot, dtype=np.uint8), seed=seed)


def tint(image: Image, box: tuple[int, int, int, int], gains: tuple[float, float, float]) -> Image:
    """``image`` with the BGR channel ``gains`` applied inside ``box`` (x, y, w, h)."""
    out = image.astype(np.float64)
    x, y, w, h = box
    out[y : y + h, x : x + w] *= np.array(gains)
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def paste(target: Image, source: Image, box: tuple[int, int, int, int]) -> Image:
    """``target`` with ``source``'s pixels inside ``box`` (x, y, w, h)."""
    out = target.copy()
    x, y, w, h = box
    out[y : y + h, x : x + w] = source[y : y + h, x : x + w]
    return out


def grey(image: Image) -> Image:
    return np.asarray(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), dtype=np.uint8)
