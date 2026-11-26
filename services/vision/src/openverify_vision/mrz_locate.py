"""Machine-readable zone localisation and line OCR (C32.1 ``mrz``).

Localisation is classical (``docs/research/phase3-libraries.md`` §3), on the lower half of the
document (the rectified one when it was found), where ICAO 9303 places the zone:

1. a morphological **blackhat** with a kernel about one character wide brings out dark
   characters on a light ground;
2. the horizontal gradient (Scharr) of that keeps the character strokes and drops long
   horizontal rules;
3. a **closing** with the same kernel, Otsu's threshold, and a second, wider closing join each
   line's characters into one component, without joining lines (the kernel is shallow);
4. the **contours** of those components that span most of the document width (an MRZ line
   covers about 88% of it in every layout) and are long and thin are line candidates, and the
   lowest run of two or three of them, close together and of similar width, is the zone.

The kernels scale with the document width: an MRZ character is 2.54 mm wide on documents 85.6
(TD1) to 125 mm (TD3) wide, about 2.5% of the width. Each line is cropped along its own slope and
read by :class:`~openverify_vision.ocr.OcrEngine` restricted to ``[A-Z0-9<]``: at each step the
recognizer's most probable allowed class, so no character is ever invented (see
``ocr/recognition.py``). Parsing, check digits and the C31.3 corrections stay in TypeScript.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy as np

from openverify_vision.imaging import ImageArray, ensure_bgr, ensure_gray
from openverify_vision.ocr import OcrEngine
from openverify_vision.ocr.geometry import Quad, order_points_clockwise, rotate_crop
from openverify_vision.schemas import (
    MAX_MRZ_LINE_LENGTH,
    MAX_MRZ_LINES,
    BoundingBox,
    MrzFormat,
    MrzReading,
)

MRZ_ALPHABET: Final = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
"""The characters of an ICAO 9303 machine-readable zone."""

SEARCH_FROM: Final = 0.5
"""The zone is searched below this share of the document height."""

PITCH_RATIO: Final = 0.025
"""Expected character pitch over document width (2.54 mm on 85.6 to 125 mm)."""

MIN_LINE_WIDTH: Final = 0.6
"""A line candidate spans at least this share of the document width."""

MIN_LINE_ASPECT: Final = 8.0
"""A line candidate is at least this many times wider than tall."""

MAX_LINE_GAP: Final = 1.5
"""Consecutive zone lines are at most this many line heights apart (top to bottom edge)."""

WIDTH_TOLERANCE: Final = 0.15
"""Zone lines differ in width by at most this share of the widest."""

MIN_ZONE_LINES: Final = 2

PAD_ALONG: Final = 0.6
PAD_ACROSS: Final = 0.35
"""Each line is cropped with this many line heights of margin along and across it."""

LAYOUTS: Final[tuple[tuple[int, int, MrzFormat], ...]] = (
    (3, 30, "TD1"),
    (2, 36, "TD2"),
    (2, 44, "TD3"),
)
"""Line count and length of each layout (ICAO 9303 Parts 4 to 7)."""

VISAS: Final[dict[MrzFormat, MrzFormat]] = {"TD2": "MRVB", "TD3": "MRVA"}
"""Visas share the TD2 and TD3 lengths; their document code starts with V."""

LENGTH_TOLERANCE: Final = 2
"""A line read within this many characters of a layout's length still suggests the layout."""

_CONFIDENCE_DECIMALS: Final = 4
_ERODE: Final = np.ones((3, 3), dtype=np.uint8)
_BOX_DECIMALS: Final = 2

NOT_FOUND: Final = MrzReading(
    found=False, format_guess=None, lines=[], line_confidences=[], box=None
)


@dataclass(frozen=True, slots=True)
class MrzLineRegion:
    """One MRZ line on the image: the quad to crop (with a margin, along the line's slope,
    clockwise from the top left) and the tight axis-aligned box of its characters."""

    quad: Quad
    box: BoundingBox


def _odd(value: float) -> int:
    return max(3, round(value) | 1)


def _line_mask(lower: ImageArray, pitch: float) -> ImageArray:
    """Steps 1 to 3: a binary mask with one component per text line."""
    character = cv2.getStructuringElement(cv2.MORPH_RECT, (_odd(1.1 * pitch), _odd(0.4 * pitch)))
    blurred = cv2.GaussianBlur(lower, (3, 3), 0)
    blackhat = cv2.morphologyEx(blurred, cv2.MORPH_BLACKHAT, character)
    gradient = np.abs(cv2.Sobel(blackhat, cv2.CV_32F, 1, 0, ksize=-1))
    low, high = float(gradient.min()), float(gradient.max())
    if high - low <= 0:
        return np.zeros(lower.shape, dtype=np.uint8)
    scaled = ((gradient - low) / (high - low) * 255).astype(np.uint8)
    closed = cv2.morphologyEx(scaled, cv2.MORPH_CLOSE, character)
    _, mask = cv2.threshold(closed, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    joining = cv2.getStructuringElement(cv2.MORPH_RECT, (_odd(1.5 * pitch), 1))
    joined = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, joining)
    return np.asarray(cv2.erode(joined, _ERODE), dtype=np.uint8)


@dataclass(frozen=True, slots=True)
class _Candidate:
    contour: np.ndarray
    x: int
    y: int
    w: int
    h: int


def _zone(candidates: list[_Candidate]) -> list[_Candidate]:
    """Step 4: the lowest run of up to three close lines of similar width."""
    ordered = sorted(candidates, key=lambda c: c.y)
    if not ordered:
        return []
    zone = [ordered[-1]]
    for candidate in reversed(ordered[:-1]):
        below = zone[0]
        height = (candidate.h + below.h) / 2
        gap = below.y - (candidate.y + candidate.h)
        widest = max(candidate.w, below.w)
        if gap > MAX_LINE_GAP * height or abs(candidate.w - below.w) > WIDTH_TOLERANCE * widest:
            break
        zone.insert(0, candidate)
        if len(zone) == MAX_MRZ_LINES:
            break
    return zone if len(zone) >= MIN_ZONE_LINES else []


def _crop_quad(contour: np.ndarray, top: int) -> Quad:
    """The line's minimum-area rectangle, in image pixels, grown by the crop margins."""
    (cx, cy), (w, h), angle = cv2.minAreaRect(contour)
    if w < h:  # OpenCV may report the long side as the height
        w, h, angle = h, w, angle - 90.0
    grown = ((cx, cy + top), (w + 2 * PAD_ALONG * h, h + 2 * PAD_ACROSS * h), angle)
    return order_points_clockwise(np.asarray(cv2.boxPoints(grown), dtype=np.float32))


def find_mrz_lines(img: ImageArray) -> list[MrzLineRegion]:
    """The MRZ lines of ``img`` (the rectified document when one was found), top to bottom;
    empty unless two or three of them were found."""
    gray = ensure_gray(img)
    height, width = gray.shape
    top = int(height * SEARCH_FROM)
    pitch = max(3.0, PITCH_RATIO * width)
    mask = _line_mask(gray[top:], pitch)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w >= MIN_LINE_WIDTH * width and w >= MIN_LINE_ASPECT * h:
            candidates.append(_Candidate(contour, x, y, w, h))
    return [
        MrzLineRegion(
            quad=_crop_quad(line.contour, top),
            box=(float(line.x), float(line.y + top), float(line.w), float(line.h)),
        )
        for line in _zone(candidates)
    ]


def guess_format(lines: Sequence[str]) -> MrzFormat | None:
    """The layout the line count and lengths suggest (TD1 3 x 30, TD2 and MRV-B 2 x 36, TD3
    and MRV-A 2 x 44, each line within two characters), visas told apart by the document code
    ``V``; ``None`` when nothing fits."""
    for count, length, layout in LAYOUTS:
        if len(lines) == count and all(
            abs(len(line) - length) <= LENGTH_TOLERANCE for line in lines
        ):
            if layout in VISAS and lines[0].startswith("V"):
                return VISAS[layout]
            return layout
    return None


def _union(boxes: Sequence[BoundingBox]) -> BoundingBox:
    left = min(box[0] for box in boxes)
    top = min(box[1] for box in boxes)
    right = max(box[0] + box[2] for box in boxes)
    bottom = max(box[1] + box[3] for box in boxes)
    return (
        round(left, _BOX_DECIMALS),
        round(top, _BOX_DECIMALS),
        round(right - left, _BOX_DECIMALS),
        round(bottom - top, _BOX_DECIMALS),
    )


def locate_mrz(img: ImageArray, ocr: OcrEngine) -> MrzReading:
    """The MRZ of ``img`` (the rectified document when one was found): its lines read with the
    MRZ alphabet, a confidence per line, the zone's box in ``img`` pixels and the layout the
    lines suggest. Not found without the text models, without a zone, or when fewer than two
    lines read as anything."""
    if not ocr.load():
        return NOT_FOUND
    regions = find_mrz_lines(img)
    if not regions:
        return NOT_FOUND
    bgr = ensure_bgr(img)
    readings = ocr.recognize(
        [rotate_crop(bgr, region.quad) for region in regions], alphabet=MRZ_ALPHABET
    )
    read = [
        (region, reading) for region, reading in zip(regions, readings, strict=True) if reading.text
    ]
    if len(read) < MIN_ZONE_LINES:
        return NOT_FOUND
    lines = [reading.text[:MAX_MRZ_LINE_LENGTH] for _, reading in read]
    return MrzReading(
        found=True,
        format_guess=guess_format(lines),
        lines=lines,
        line_confidences=[
            round(min(max(reading.confidence, 0.0), 1.0), _CONFIDENCE_DECIMALS)
            for _, reading in read
        ],
        box=_union([region.box for region, _ in read]),
    )
