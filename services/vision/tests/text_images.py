"""Synthetic text images for the OCR tests: Pillow-rendered lines and machine-readable zones.

Every image is drawn here with Pillow's bundled font, so the tests need no font on the host and
render the same everywhere. The MRZ layouts follow ICAO 9303: monospaced at 2.54 mm per
character, lines 4.6 mm apart (TD1) on a document of the format's size, at 12 pixels per mm.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw, ImageFont

PX_PER_MM: Final = 12.0
MRZ_PITCH_MM: Final = 2.54
MRZ_LINE_PITCH_MM: Final = 4.6

DOCUMENT_SIZES_MM: Final = {30: (85.6, 53.98), 36: (105.0, 74.0), 44: (125.0, 88.0)}
"""Document size by MRZ line length: ID-1 (TD1), ID-2 (TD2, MRV-B) and ID-3 (TD3, MRV-A)."""

PAPER: Final = (214, 224, 220)
MRZ_PAPER: Final = (226, 229, 232)
INK: Final = (24, 38, 74)

BgrImage = NDArray[np.uint8]


def font(size: int) -> ImageFont.FreeTypeFont:
    loaded = ImageFont.load_default(size=size)
    assert isinstance(loaded, ImageFont.FreeTypeFont)
    return loaded


def to_bgr(image: Image.Image) -> BgrImage:
    return np.ascontiguousarray(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR))


@dataclass(frozen=True, slots=True)
class Placed:
    """A line of text drawn at ``(x, y)`` (top left) with a font of ``size`` pixels."""

    text: str
    x: int
    y: int
    size: int = 34


def render_lines(lines: Sequence[Placed], *, width: int = 1027, height: int = 648) -> BgrImage:
    """``lines`` drawn in dark ink on plain paper."""
    image = Image.new("RGB", (width, height), PAPER)
    draw = ImageDraw.Draw(image)
    for line in lines:
        draw.text((line.x, line.y), line.text, font=font(line.size), fill=INK)
    return to_bgr(image)


def mm(value: float) -> int:
    return round(value * PX_PER_MM)


def render_mrz_document(
    lines: Sequence[str],
    *,
    viz: Sequence[Placed] = (),
    font_size: int = 40,
    first_line_mm: float | None = None,
) -> BgrImage:
    """A document of the MRZ's format with ``lines`` as its machine-readable zone at the bottom
    and ``viz`` above it. ``first_line_mm`` (distance of the first line's top from the bottom
    edge) defaults to ICAO's place for the zone: 16.5 mm for three lines, 12 mm for two."""
    length = len(lines[0])
    width_mm, height_mm = DOCUMENT_SIZES_MM[length]
    width, height = mm(width_mm), mm(height_mm)
    image = Image.new("RGB", (width, height), PAPER)
    draw = ImageDraw.Draw(image)
    for placed in viz:
        draw.text((placed.x, placed.y), placed.text, font=font(placed.size), fill=INK)
    draw.rectangle((0, height - mm(19.0), width, height), fill=MRZ_PAPER)
    glyphs = font(font_size)
    pitch = MRZ_PITCH_MM * PX_PER_MM
    left = (width - pitch * length) / 2
    if first_line_mm is None:
        first_line_mm = 16.5 if len(lines) == 3 else 12.0  # TD1 has three lines
    first_top = height - mm(first_line_mm)
    for row, line in enumerate(lines):
        top = first_top + row * mm(MRZ_LINE_PITCH_MM)
        for column, char in enumerate(line):
            glyph_left, _, glyph_right, _ = glyphs.getbbox(char)
            offset = (pitch - (glyph_right - glyph_left)) / 2 - glyph_left
            draw.text((left + column * pitch + offset, top), char, font=glyphs, fill=INK)
    return to_bgr(image)


def positional_accuracy(expected: Sequence[str], read: Sequence[str]) -> tuple[int, int]:
    """``(correct, total)`` characters, position by position; a line of the wrong length or a
    missing line counts every expected character of it as wrong."""
    total = sum(len(line) for line in expected)
    correct = 0
    for index, line in enumerate(expected):
        got = read[index] if index < len(read) else ""
        if len(got) == len(line):
            correct += sum(1 for a, b in zip(line, got, strict=True) if a == b)
    return correct, total


def character_accuracy(expected: str, read: str) -> float:
    """``1 - edit distance / len(expected)``, floored at 0 (Levenshtein, unit costs)."""
    previous = list(range(len(read) + 1))
    for i, a in enumerate(expected, start=1):
        current = [i]
        for j, b in enumerate(read, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a != b)))
        previous = current
    return max(0.0, 1.0 - previous[-1] / max(1, len(expected)))
