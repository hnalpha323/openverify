"""C60.1: the forensic measurements of a document photo (``DocumentImageMeasurements``).

For a JPEG, PNG or WebP upload, or a scanned PDF page's embedded JPEG: the EXIF software and
dates, the JPEG quality and double compression, the text lines' error levels against each other
and copy-move. Measurements only (C60.6 weighs them); a part that cannot be measured is
``None``, never 0.
"""

from __future__ import annotations

import datetime
import io
import re
import warnings
from collections.abc import Sequence
from typing import Final

import cv2
import numpy as np
from PIL import ExifTags, Image, UnidentifiedImageError

from openverify_vision.forensics.copy_move import copy_move_score
from openverify_vision.forensics.jpeg import double_compression_score, estimate_quality
from openverify_vision.forensics.text_ela import text_cell_ela_score
from openverify_vision.forensics.upload import read_upload, upright_grid_offset
from openverify_vision.imaging import ALLOWED_FORMATS, ImageArray, ensure_bgr
from openverify_vision.schemas import BoundingBox, DocumentImageMeasurements

_EXIF_DATE: Final = re.compile(r"(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})")
_EXIF_OFFSET: Final = re.compile(r"[+-](?:[01]\d|2[0-3]):[0-5]\d")
_DATE_TIME_ORIGINAL: Final = 0x9003
_OFFSET_TIME: Final = 0x9010
_OFFSET_TIME_ORIGINAL: Final = 0x9011


def _iso(value: object, offset: object) -> str | None:
    """An EXIF ``YYYY:MM:DD HH:MM:SS`` (and its ``OffsetTime``) as ISO 8601; else ``None``."""
    if isinstance(value, bytes):
        value = value.decode("ascii", errors="replace")
    if not isinstance(value, str):
        return None
    found = _EXIF_DATE.fullmatch(value.strip().rstrip("\x00"))
    if found is None:
        return None
    try:
        year, month, day, hour, minute, second = (int(part) for part in found.groups())
        moment = datetime.datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None
    zone = offset.strip().rstrip("\x00") if isinstance(offset, str) else ""
    return moment.isoformat() + (zone if _EXIF_OFFSET.fullmatch(zone) else "")


def exif_dates(data: bytes) -> tuple[str | None, str | None]:
    """The EXIF ``DateTimeOriginal`` and ``DateTime`` as ISO 8601, with their offset when EXIF
    records one; ``None`` for a date that is absent or cannot be read."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with Image.open(io.BytesIO(data), formats=ALLOWED_FORMATS) as image:
                exif = image.getexif()
                details = exif.get_ifd(ExifTags.IFD.Exif)
                original = _iso(
                    details.get(_DATE_TIME_ORIGINAL), details.get(_OFFSET_TIME_ORIGINAL)
                )
                modified = _iso(exif.get(ExifTags.Base.DateTime), details.get(_OFFSET_TIME))
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
        return None, None
    return original, modified


def measure_image(
    data: bytes, bgr: ImageArray, text_boxes: Sequence[BoundingBox]
) -> DocumentImageMeasurements | None:
    """Every image measurement of ``data`` (its upright decode is ``bgr``, its OCR lines
    ``text_boxes``, in the same pixels); ``None`` when the bytes are no readable image."""
    source = read_upload(data)
    if source is None:
        return None
    image = ensure_bgr(bgr)
    grey = np.asarray(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), dtype=np.uint8)
    quality = double = ela = None
    if source.quantization is not None:
        estimate = estimate_quality(source.quantization)
        quality = None if estimate is None else estimate[0]
        offset = upright_grid_offset(source, image.shape)
        luminance = source.quantization.get(0)
        if luminance is not None:
            double = double_compression_score(image, luma_table=luminance, offset=offset)
        ela = text_cell_ela_score(image, text_boxes, offset=offset)
    original, modified = exif_dates(data)
    return DocumentImageMeasurements(
        exif_software=source.exif.software,
        exif_datetime_original=original,
        exif_datetime=modified,
        jpeg_quality=quality,
        double_compression_score=double,
        ela_text_cell_score=ela,
        copy_move_score=copy_move_score(grey),
    )
