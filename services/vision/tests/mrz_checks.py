"""Check-digit positions of the MRZ layouts, read independently of the generator's builders.

The fixture tests use these to prove what a variant's MRZ holds: valid digits on a happy or
expired card, exactly one bad digit on the bad-check-digit variant. ``check_digit`` itself is
proven against the shared vectors in ``test_mrz_vectors.py``.
"""

from __future__ import annotations

from datetime import date
from typing import Final

from icao_mrz import check_digit


def _valid(printed: str, field: str) -> bool:
    return printed == str(check_digit(field))


def _td1_number(line1: str) -> tuple[str, str]:
    """The document number and its printed check digit. A filler in the digit's position means
    a long number: the rest of it and its digit open the optional data (Part 5, note j)."""
    if line1[14] != "<":
        return line1[5:14], line1[14]
    overflow = line1[15:30].split("<", 1)[0]
    return line1[5:14] + overflow[:-1], overflow[-1:]


def td1_digits(lines: tuple[str, ...]) -> dict[str, bool]:
    """ICAO 9303 Part 5: document number, birth date, expiry and composite digits."""
    line1, line2, _ = lines
    composite = line1[5:30] + line2[0:7] + line2[8:15] + line2[18:29]
    number, printed = _td1_number(line1)
    return {
        "document_number": _valid(printed, number),
        "birth_date": _valid(line2[6], line2[0:6]),
        "expiration_date": _valid(line2[14], line2[8:14]),
        "composite": _valid(line2[29], composite),
    }


def td2_digits(lines: tuple[str, ...]) -> dict[str, bool]:
    """ICAO 9303 Part 6: document number, birth date, expiry and composite digits."""
    line2 = lines[1]
    return {
        "document_number": _valid(line2[9], line2[0:9]),
        "birth_date": _valid(line2[19], line2[13:19]),
        "expiration_date": _valid(line2[27], line2[21:27]),
        "composite": _valid(line2[35], line2[0:10] + line2[13:20] + line2[21:35]),
    }


def td3_digits(lines: tuple[str, ...]) -> dict[str, bool]:
    """ICAO 9303 Part 4: document number, birth date, expiry, personal number and composite."""
    line2 = lines[1]
    return {
        "document_number": _valid(line2[9], line2[0:9]),
        "birth_date": _valid(line2[19], line2[13:19]),
        "expiration_date": _valid(line2[27], line2[21:27]),
        "optional_data": _valid(line2[42], line2[28:42]),
        "composite": _valid(line2[43], line2[0:10] + line2[13:20] + line2[21:43]),
    }


def mrv_digits(lines: tuple[str, ...]) -> dict[str, bool]:
    """ICAO 9303 Part 7, MRV-A and MRV-B: document number, birth date and expiry (visas have no
    composite)."""
    line2 = lines[1]
    return {
        "document_number": _valid(line2[9], line2[0:9]),
        "birth_date": _valid(line2[19], line2[13:19]),
        "expiration_date": _valid(line2[27], line2[21:27]),
    }


def yymmdd(value: str, *, future: bool) -> date:
    """An MRZ date, read with the century that makes it a past (birth) or later (expiry) date.

    Two-digit years are ambiguous; within the fixtures a birth date is 19xx or 20xx before 2030
    and an expiry is always 20xx.
    """
    year = int(value[0:2])
    century = 2000 if future or year < 30 else 1900  # the fixtures pivot at 2030
    return date(century + year, int(value[2:4]), int(value[4:6]))


DIGITS_BY_FORMAT: Final = {
    "TD1": td1_digits,
    "TD2": td2_digits,
    "TD3": td3_digits,
    "MRVA": mrv_digits,
    "MRVB": mrv_digits,
}
