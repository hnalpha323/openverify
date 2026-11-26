"""C60.1: text and dates as the document contract carries them, for the guarded child.

Strings from a PDF or its XMP are cleaned (controls and unpaired surrogates dropped, whitespace
collapsed) and cut to a number of UTF-16 code units, as the API's zod schemas count them. Dates
from a PDF ``D:`` string or an XMP value become ISO 8601 (``YYYY-MM-DD``, optionally with a time
and an offset); a date that cannot be read is ``None``, never a guess. Standard library only.
"""

from __future__ import annotations

import datetime
import re
import unicodedata
from typing import Final

_BMP_LAST: Final = 0xFFFF
SURROGATES: Final = range(0xD800, 0xE000)
_HIGH: Final = range(0xD800, 0xDC00)
_LOW: Final = range(0xDC00, 0xE000)

_PDF_DATE: Final = re.compile(
    r"(?:D:)?(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})?(\d{2})?)?"
    r"(?:([Zz])(?:00'?(?:00'?)?)?|([+-])(\d{2})'?(?:(\d{2})'?)?)?"
)
_XMP_DATE: Final = re.compile(
    r"(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?"
)
_MAX_OFFSET_HOURS: Final = 23
_MAX_OFFSET_MINUTES: Final = 59


def _join_surrogates(text: str) -> str:
    """``text`` with UTF-16 surrogate pairs joined into their characters and every unpaired
    surrogate dropped (PDF text can arrive as separate UTF-16 code units)."""
    if not any(ord(char) in SURROGATES for char in text):
        return text
    joined: list[str] = []
    index = 0
    while index < len(text):
        code = ord(text[index])
        if code in _HIGH and index + 1 < len(text) and ord(text[index + 1]) in _LOW:
            low = ord(text[index + 1])
            joined.append(chr(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)))
            index += 2
            continue
        if code not in _HIGH and code not in _LOW:
            joined.append(text[index])
        index += 1
    return "".join(joined)


def _printable(char: str) -> str:
    """Controls and line or paragraph separators become spaces; format characters (bidi
    controls, zero-width marks, the BOM) and surrogates go."""
    category = unicodedata.category(char)
    if category in {"Cc", "Zl", "Zp"}:
        return " "
    if category in {"Cs", "Cf"}:
        return ""
    return char


def clip_text(value: str, limit: int) -> str | None:
    """``value`` cleaned and cut to ``limit`` UTF-16 code units; ``None`` when nothing is
    left."""
    cleaned = "".join(_printable(char) for char in _join_surrogates(value))
    text = " ".join(cleaned.split())
    units = 0
    for index, char in enumerate(text):
        units += 2 if ord(char) > _BMP_LAST else 1
        if units > limit:
            text = text[:index]
            break
    text = text.rstrip()
    return text or None


def _iso(
    date_parts: tuple[str, str, str], time_parts: tuple[str | None, ...], offset: str | None
) -> str | None:
    """The ISO form of a year, month and day, with a time (hour, minute, second; ``None`` for
    no time) and an offset."""
    year, month, day = date_parts
    hour, minute, second = time_parts
    try:
        date = datetime.date(int(year), int(month), int(day))
        if hour is None:
            return date.isoformat()
        time = datetime.time(int(hour), int(minute or 0), int(second or 0))
    except ValueError:
        return None
    return f"{date.isoformat()}T{time.isoformat()}{offset or ''}"


def _offset(sign: str, hours: str, minutes: str | None) -> str | None:
    if int(hours) > _MAX_OFFSET_HOURS or int(minutes or 0) > _MAX_OFFSET_MINUTES:
        return None
    return f"{sign}{hours}:{minutes or '00'}"


def pdf_date(value: str) -> str | None:
    """A PDF date string (``D:YYYYMMDDHHmmSSOHH'mm'``) as ISO 8601. A year or a year and
    month alone, an impossible date or anything else is ``None``."""
    found = _PDF_DATE.fullmatch(value.strip())
    if found is None:
        return None
    year, month, day, hour, minute, second, zulu, sign, off_h, off_m = found.groups()
    offset = None
    if zulu:
        offset = "Z"
    elif sign:
        offset = _offset(sign, off_h, off_m)
        if offset is None:
            return None
    return _iso((year, month, day), (hour, minute, second), offset if hour is not None else None)


def xmp_date(value: str) -> str | None:
    """An XMP date (ISO 8601, possibly with fractions or without seconds) as the contract's
    ISO 8601; a date without a day, or impossible, is ``None``."""
    found = _XMP_DATE.fullmatch(value.strip())
    if found is None:
        return None
    year, month, day, hour, minute, second, offset = found.groups()
    if offset not in {None, "Z"}:
        offset = _offset(offset[0], offset[1:3], offset[4:6])
        if offset is None:
            return None
    return _iso((year, month, day), (hour, minute, second), offset)
