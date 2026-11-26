"""The upload as received: its format, EXIF, JPEG tables and block grid (C32.1).

``analysis.py`` hands the forensics the original bytes and their EXIF-upright decode. The bytes
are opened once more, headers only (no pixel data is decoded), for what the decode drops: the
EXIF tags, the JPEG quantization tables and the stored size and orientation. From the last two,
:func:`grid_offset` tells where JPEG's 8x8 blocks start on the upright decode, so block-based
measurements stay on the encoder's grid after a rotation.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass
from typing import Final

from PIL import ExifTags, Image, UnidentifiedImageError

from openverify_vision.forensics.exif import summarize_exif
from openverify_vision.imaging import ALLOWED_FORMATS
from openverify_vision.schemas import ExifSummary

JPEG_FORMATS: Final = ("JPEG", "MPO")
"""Pillow's names for a JPEG (an MPO is a JPEG with further images appended)."""

BLOCK: Final = 8
"""JPEG's DCT block size."""

_TRANSPOSED: Final = frozenset({5, 6, 7, 8})
"""EXIF orientations that swap width and height."""

_OPEN_ERRORS: Final = (
    UnidentifiedImageError,
    OSError,
    ValueError,
    SyntaxError,
    Image.DecompressionBombError,
)


@dataclass(frozen=True, slots=True)
class UploadSource:
    """What the original bytes say, before EXIF-upright decoding."""

    format: str
    """Pillow's format name: ``JPEG``, ``MPO``, ``PNG`` or ``WEBP``."""
    exif: ExifSummary
    quantization: dict[int, tuple[int, ...]] | None
    """JPEG quantization tables by id, each 64 entries in natural (row-major) order; ``None``
    for any other format."""
    orientation: int
    """EXIF orientation (1-8; 1 when absent)."""
    raw_size: tuple[int, int]
    """``(width, height)`` as stored."""

    @property
    def upright_size(self) -> tuple[int, int]:
        """``(width, height)`` after the EXIF orientation is applied."""
        width, height = self.raw_size
        return (height, width) if self.orientation in _TRANSPOSED else (width, height)


def grid_offset(orientation: int, raw_size: tuple[int, int]) -> tuple[int, int]:
    """``(x, y)`` in ``[0, 8)`` where a JPEG block starts on the upright image.

    The encoder's blocks start at the stored image's origin. Pillow's EXIF transposes move that
    origin to another corner; a block then starts at the stored width or height modulo 8 from
    the upright image's edge. An orientation outside 1-8 is not applied by the decoder.
    """
    width, height = raw_size
    wx, hy = width % BLOCK, height % BLOCK
    offsets = {
        2: (wx, 0),  # mirrored left-right
        3: (wx, hy),  # rotated 180
        4: (0, hy),  # mirrored top-bottom
        6: (hy, 0),  # rotated 90 clockwise
        7: (hy, wx),  # transverse
        8: (0, wx),  # rotated 90 counter-clockwise
    }
    return offsets.get(orientation, (0, 0))


def upright_grid_offset(source: UploadSource, shape: tuple[int, ...]) -> tuple[int, int]:
    """The grid offset on an upright decode of ``shape``; the origin when the decode is not
    the stored image (then no offset is known)."""
    height, width = shape[:2]
    if source.upright_size != (width, height):
        return (0, 0)
    return grid_offset(source.orientation, source.raw_size)


def _orientation(image: Image.Image) -> int:
    value = image.getexif().get(ExifTags.Base.Orientation, 1)
    return value if isinstance(value, int) else 1


def read_upload(data: bytes) -> UploadSource | None:
    """The upload's format, EXIF, JPEG tables, orientation and stored size; ``None`` when the
    bytes are not an image in an allowed format."""
    try:
        with warnings.catch_warnings():
            # Corrupt EXIF only warns: it then reads as absent. The decoder already enforced
            # the pixel limit, so the decompression-bomb warning adds nothing here.
            warnings.simplefilter("ignore", UserWarning)
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data), formats=ALLOWED_FORMATS) as image:
                fmt = image.format or ""
                exif = summarize_exif(image)
                orientation = _orientation(image)
                tables = getattr(image, "quantization", None) if fmt in JPEG_FORMATS else None
                size = image.size
    except _OPEN_ERRORS:
        return None
    quantization = (
        None if tables is None else {int(k): tuple(int(v) for v in t) for k, t in tables.items()}
    )
    return UploadSource(
        format=fmt,
        exif=exif,
        quantization=quantization,
        orientation=orientation,
        raw_size=size,
    )
