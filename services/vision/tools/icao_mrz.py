"""ICAO Doc 9303 machine-readable zone helpers for synthetic test documents.

Written in-house (the ``mrz`` package on PyPI is GPL and must not be used). Only what the
synthetic document generator needs: check digits (Part 3), the three-line TD1 layout (Part 5),
the TD3 passport layout (Part 4) and the MRV-A and MRV-B visa layouts (Part 7).
Input is restricted to ASCII letters, digits and simple punctuation; transliteration of
national characters is out of scope for fixtures.
"""

from __future__ import annotations

import string
from dataclasses import dataclass
from datetime import date
from typing import Final, Literal

MRZ_CHARSET: Final = string.ascii_uppercase + string.digits + "<"
"""Characters allowed in a machine-readable zone."""

FILLER: Final = "<"
TD1_LINE_LENGTH: Final = 30
TD3_LINE_LENGTH: Final = 44
MRV_LINE_LENGTHS: Final = {"MRVA": 44, "MRVB": 36}
_WEIGHTS: Final = (7, 3, 1)


def char_value(char: str) -> int:
    """Numeric value of one MRZ character: digits as-is, A-Z as 10-35, filler as 0."""
    if len(char) != 1 or char not in MRZ_CHARSET:
        raise ValueError(f"{char!r} is not an MRZ character (A-Z, 0-9 or <)")
    if char == FILLER:
        return 0
    if char.isdigit():
        return int(char)
    return ord(char) - ord("A") + 10


def check_digit(field: str) -> int:
    """ICAO 9303 Part 3 check digit: weights 7, 3, 1 repeating, sum modulo 10."""
    return sum(char_value(c) * _WEIGHTS[i % 3] for i, c in enumerate(field)) % 10


def _to_mrz_text(text: str) -> str:
    """Uppercase ``text``, drop apostrophes and turn any other separator into a filler."""
    out: list[str] = []
    for char in text.upper().replace("'", ""):
        if char.isascii() and (char.isalpha() or char.isdigit()):
            out.append(char)
        elif char.isascii() and not char.isalnum():
            out.append(FILLER)
        else:
            raise ValueError(f"{char!r} is not an MRZ character; transliterate it first")
    return "".join(out)


def mrz_field(text: str, length: int) -> str:
    """Format ``text`` as a fixed-length MRZ field, padded with fillers. Never truncates."""
    value = _to_mrz_text(text)
    if len(value) > length:
        raise ValueError(f"{text!r} is longer than {length} MRZ characters")
    return value.ljust(length, FILLER)


def mrz_name(surname: str, given_names: str, length: int) -> str:
    """``SURNAME<<GIVEN<NAMES`` padded or truncated to ``length`` (ICAO name-field rules)."""
    primary = _to_mrz_text(surname)
    secondary = _to_mrz_text(given_names)
    name = f"{primary}{FILLER * 2}{secondary}" if secondary else primary
    return name[:length].ljust(length, FILLER)


def mrz_date(value: date) -> str:
    """``YYMMDD`` as used for dates of birth and expiry."""
    return value.strftime("%y%m%d")


@dataclass(frozen=True, slots=True)
class Td1Data:
    """Visual-zone data needed to build a TD1 (ID-card size) machine-readable zone."""

    document_code: str
    issuing_state: str
    document_number: str
    birth_date: date
    sex: str
    expiry_date: date
    nationality: str
    surname: str
    given_names: str
    optional_data_1: str = ""
    optional_data_2: str = ""


def _fixed(name: str, value: str, length: int, *, letters_only: bool = False) -> str:
    try:
        field = mrz_field(value, length)
    except ValueError as exc:
        raise ValueError(f"{name}: {exc}") from exc
    if letters_only and not field.isalpha():
        raise ValueError(f"{name} must be {length} letters, got {value!r}")
    return field


def _sex(value: str) -> str:
    if value not in ("F", "M", "X"):
        raise ValueError(f"sex must be F, M or X, got {value!r}")
    return FILLER if value == "X" else value


TD1_NUMBER_LENGTH: Final = 9
TD1_LONG_NUMBER_LENGTH: Final = 23
"""Nine characters in the number field, the rest and the digit in the 15 of optional data."""


def _td1_number_block(number: str, optional: str) -> str:
    """Characters 6-30 of the first TD1 line: the document number, its check digit and the
    first optional data.

    A number over nine characters keeps nine in its field and a filler where its digit goes;
    the rest of it, its check digit and a filler open the optional data (Part 5, note j).
    """
    value = _fixed("document_number", number, TD1_LONG_NUMBER_LENGTH).rstrip(FILLER)
    if len(value) <= TD1_NUMBER_LENGTH:
        field = value.ljust(TD1_NUMBER_LENGTH, FILLER)
        return f"{field}{check_digit(field)}{_fixed('optional_data_1', optional, 15)}"
    overflow = f"{value[TD1_NUMBER_LENGTH:]}{check_digit(value)}"
    rest = f"{overflow}{FILLER}{optional}" if optional else overflow
    return f"{value[:TD1_NUMBER_LENGTH]}{FILLER}{_fixed('optional_data_1', rest, 15)}"


def td1_lines(data: Td1Data) -> tuple[str, str, str]:
    """Build the three 30-character TD1 lines (ICAO 9303 Part 5, section 4.2.2), with the long
    document number rule for numbers of 10 to 23 characters."""
    code = _fixed("document_code", data.document_code, 2)
    state = _fixed("issuing_state", data.issuing_state, 3, letters_only=True)
    number_block = _td1_number_block(data.document_number, data.optional_data_1)
    nationality = _fixed("nationality", data.nationality, 3, letters_only=True)
    optional_2 = _fixed("optional_data_2", data.optional_data_2, 11)
    sex = _sex(data.sex)

    birth = mrz_date(data.birth_date)
    expiry = mrz_date(data.expiry_date)
    line1 = f"{code}{state}{number_block}"
    upper = f"{birth}{check_digit(birth)}{sex}{expiry}{check_digit(expiry)}{nationality}"
    composite = line1[5:30] + upper[0:7] + upper[8:15] + optional_2
    line2 = f"{upper}{optional_2}{check_digit(composite)}"
    line3 = mrz_name(data.surname, data.given_names, TD1_LINE_LENGTH)
    return line1, line2, line3


@dataclass(frozen=True, slots=True)
class Td3Data:
    """Visual-zone data needed to build a TD3 (passport data page) machine-readable zone."""

    document_code: str
    issuing_state: str
    document_number: str
    birth_date: date
    sex: str
    expiry_date: date
    nationality: str
    surname: str
    given_names: str
    personal_number: str = ""


def _holder_block(data: Td3Data | MrvData) -> str:
    """Document number, nationality, birth date, sex and expiry with their check digits."""
    number = _fixed("document_number", data.document_number, 9)
    nationality = _fixed("nationality", data.nationality, 3, letters_only=True)
    birth = mrz_date(data.birth_date)
    expiry = mrz_date(data.expiry_date)
    return (
        f"{number}{check_digit(number)}{nationality}{birth}{check_digit(birth)}"
        f"{_sex(data.sex)}{expiry}{check_digit(expiry)}"
    )


def td3_lines(data: Td3Data) -> tuple[str, str]:
    """Build the two 44-character TD3 lines (ICAO 9303 Part 4, section 4.2.2).

    The personal number (14 characters) has its own check digit; the composite covers the
    document number, birth date, expiry and personal number with their digits.
    """
    code = _fixed("document_code", data.document_code, 2)
    state = _fixed("issuing_state", data.issuing_state, 3, letters_only=True)
    line1 = f"{code}{state}{mrz_name(data.surname, data.given_names, TD3_LINE_LENGTH - 5)}"
    personal = _fixed("personal_number", data.personal_number, 14)
    upper = f"{_holder_block(data)}{personal}{check_digit(personal)}"
    composite = upper[0:10] + upper[13:20] + upper[21:43]
    return line1, f"{upper}{check_digit(composite)}"


@dataclass(frozen=True, slots=True)
class MrvData:
    """Visual-zone data needed to build an MRV-A or MRV-B (visa) machine-readable zone."""

    document_code: str
    issuing_state: str
    document_number: str
    birth_date: date
    sex: str
    expiry_date: date
    nationality: str
    surname: str
    given_names: str
    optional_data: str = ""


MrvLayout = Literal["MRVA", "MRVB"]
"""MRV-A (2 x 44, ID-3 size visa) or MRV-B (2 x 36, smaller visa)."""


def mrv_lines(data: MrvData, *, layout: MrvLayout) -> tuple[str, str]:
    """Build the two lines of a machine-readable visa (ICAO 9303 Part 7, section 4.2.2).

    ``MRVA`` lines hold 44 characters and ``MRVB`` lines 36. Visas have no composite check
    digit; the optional data fills the rest of the second line.
    """
    length = MRV_LINE_LENGTHS[layout]
    code = _fixed("document_code", data.document_code, 2)
    state = _fixed("issuing_state", data.issuing_state, 3, letters_only=True)
    line1 = f"{code}{state}{mrz_name(data.surname, data.given_names, length - 5)}"
    upper = _holder_block(data)
    return line1, upper + _fixed("optional_data", data.optional_data, length - len(upper))
