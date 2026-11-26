"""EXIF capture metadata, without GPS values (C32.1).

Read from the original upload, before EXIF-upright decoding: the software that last wrote the
file, the camera make and model, and whether a GPS position is present. GPS values never leave
this module. A PNG ``Software`` text chunk counts as the software when EXIF names none. EXIF that
cannot be parsed reads as absent, as stripped metadata does: neither says anything about the
capture, so neither is evidence.
"""

from __future__ import annotations

import re
from typing import Final

from PIL import ExifTags, Image

from openverify_vision.schemas import ExifSummary

MAX_EXIF_TEXT: Final = 256
"""Longest EXIF text returned, in UTF-16 code units (the contract's limit, as zod counts)."""

GPS_POSITION_TAGS: Final = (ExifTags.GPS.GPSLatitude, ExifTags.GPS.GPSLongitude)
"""A GPS block counts only with a position in it (cameras write an empty one with GPS off)."""

_CONTROL: Final = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def _utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def clean_text(value: object) -> str | None:
    """A printable, trimmed, whitespace-collapsed string of at most ``MAX_EXIF_TEXT`` UTF-16
    code units; ``None`` for anything else or nothing left."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    if not isinstance(value, str):
        return None
    text = " ".join(_CONTROL.sub(" ", value).split())[:MAX_EXIF_TEXT]
    while _utf16_length(text) > MAX_EXIF_TEXT:
        text = text[:-1]
    return text.rstrip() or None


def summarize_exif(image: Image.Image) -> ExifSummary:
    """Software, make, model and whether a GPS position is present, from ``image``'s own
    metadata (call it on the opened upload, before any transpose).

    Pillow only warns about EXIF it cannot parse and reads what it can (usually nothing);
    :func:`~openverify_vision.forensics.upload.read_upload` silences those warnings.
    """
    exif = image.getexif()
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    software = clean_text(exif.get(ExifTags.Base.Software))
    if software is None:
        software = clean_text(image.info.get("Software"))
    return ExifSummary(
        software=software,
        make=clean_text(exif.get(ExifTags.Base.Make)),
        model=clean_text(exif.get(ExifTags.Base.Model)),
        has_gps=any(tag in gps for tag in GPS_POSITION_TAGS),
    )
