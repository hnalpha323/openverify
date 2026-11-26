"""ICAO 9303 check digits and TD1 machine-readable zones, written in-house (no GPL ``mrz`` package).

Test vectors are the specimen documents printed in ICAO Doc 9303 (Utopia, "UTO").
"""

from __future__ import annotations

import dataclasses
import re
from datetime import date

import pytest

from icao_mrz import (
    MRZ_CHARSET,
    Td1Data,
    char_value,
    check_digit,
    mrz_date,
    mrz_field,
    mrz_name,
    td1_lines,
)

ICAO_TD1_SPECIMEN = Td1Data(
    document_code="I",
    issuing_state="UTO",
    document_number="D23145890",
    birth_date=date(1974, 8, 12),
    sex="F",
    expiry_date=date(2012, 4, 15),
    nationality="UTO",
    surname="Eriksson",
    given_names="Anna Maria",
)
ICAO_TD1_SPECIMEN_LINES = (
    "I<UTOD231458907<<<<<<<<<<<<<<<",
    "7408122F1204159UTO<<<<<<<<<<<6",
    "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
)

# --- character values and check digits ------------------------------------------------------


@pytest.mark.parametrize(
    ("char", "value"),
    [("0", 0), ("7", 7), ("9", 9), ("A", 10), ("L", 21), ("Z", 35), ("<", 0)],
)
def test_char_values_follow_icao_9303_part_3(char: str, value: int) -> None:
    assert char_value(char) == value


@pytest.mark.parametrize("char", ["a", " ", "-", "É", "", "AB"])
def test_char_value_rejects_anything_outside_the_mrz_charset(char: str) -> None:
    with pytest.raises(ValueError, match="MRZ character"):
        char_value(char)


@pytest.mark.parametrize(
    ("field", "digit"),
    [
        ("D23145890", 7),  # TD1 specimen document number
        ("740812", 2),  # specimen date of birth
        ("120415", 9),  # specimen date of expiry
        ("L898902C3", 6),  # TD3 specimen passport number
        ("ZE184226B<<<<<", 1),  # TD3 specimen personal number
        ("<<<<<<<<<", 0),
        ("", 0),
    ],
)
def test_check_digit_matches_icao_specimens(field: str, digit: int) -> None:
    assert check_digit(field) == digit


# --- field formatting -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "length", "expected"),
    [
        ("I", 2, "I<"),
        ("uto", 3, "UTO"),
        ("ab 12", 7, "AB<12<<"),
        ("", 3, "<<<"),
    ],
)
def test_mrz_field_uppercases_and_pads_with_fillers(text: str, length: int, expected: str) -> None:
    assert mrz_field(text, length) == expected


def test_mrz_field_refuses_to_truncate() -> None:
    with pytest.raises(ValueError, match="longer than 3"):
        mrz_field("ABCD", 3)


def test_mrz_field_refuses_non_ascii_letters() -> None:
    with pytest.raises(ValueError, match="MRZ character"):
        mrz_field("ÅSA", 5)


@pytest.mark.parametrize(
    ("surname", "given", "expected"),
    [
        ("Eriksson", "Anna Maria", "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"),
        ("Sample", "Jane", "SAMPLE<<JANE<<<<<<<<<<<<<<<<<<"),
        ("O'Neil-Smith", "Jo", "ONEIL<SMITH<<JO<<<<<<<<<<<<<<<"),  # apostrophe dropped, hyphen <
        ("Sample", "", "SAMPLE<<<<<<<<<<<<<<<<<<<<<<<<"),
    ],
)
def test_mrz_name_follows_primary_secondary_identifier_rules(
    surname: str, given: str, expected: str
) -> None:
    assert mrz_name(surname, given, 30) == expected


def test_mrz_name_truncates_long_names_to_the_line_length() -> None:
    name = mrz_name("Abcdefghijklmnopqrstuvwxyz", "Bcdefghijklmnop", 30)

    assert name == "ABCDEFGHIJKLMNOPQRSTUVWXYZ<<BC"
    assert len(name) == 30


@pytest.mark.parametrize(
    ("value", "expected"),
    [(date(1974, 8, 12), "740812"), (date(2034, 4, 15), "340415"), (date(2001, 1, 2), "010102")],
)
def test_mrz_date_is_yymmdd(value: date, expected: str) -> None:
    assert mrz_date(value) == expected


# --- TD1 ------------------------------------------------------------------------------------


def test_td1_reproduces_the_icao_specimen_exactly() -> None:
    assert td1_lines(ICAO_TD1_SPECIMEN) == ICAO_TD1_SPECIMEN_LINES


def test_td1_lines_are_three_lines_of_thirty_mrz_characters() -> None:
    data = Td1Data(
        document_code="ID",
        issuing_state="UTO",
        document_number="SPEC12345",
        birth_date=date(1984, 8, 12),
        sex="F",
        expiry_date=date(2034, 4, 15),
        nationality="UTO",
        surname="Sample",
        given_names="Jane",
        optional_data_1="SYNTHETIC",
        optional_data_2="TEST",
    )

    lines = td1_lines(data)

    assert len(lines) == 3
    pattern = re.compile(f"^[{re.escape(MRZ_CHARSET)}]{{30}}$")
    assert all(pattern.fullmatch(line) for line in lines)
    line1, line2, line3 = lines
    assert line1.startswith("IDUTOSPEC12345")
    assert line1[14] == str(check_digit("SPEC12345"))
    assert line1[15:30] == "SYNTHETIC<<<<<<"
    assert line2[0:7] == "840812" + str(check_digit("840812"))
    assert line2[7] == "F"
    assert line2[8:15] == "340415" + str(check_digit("340415"))
    assert line2[15:18] == "UTO"
    assert line2[18:29] == "TEST<<<<<<<"
    composite = line1[5:30] + line2[0:7] + line2[8:15] + line2[18:29]
    assert line2[29] == str(check_digit(composite))
    assert line3 == "SAMPLE<<JANE<<<<<<<<<<<<<<<<<<"


def test_td1_unspecified_sex_is_a_filler() -> None:
    data = dataclasses.replace(ICAO_TD1_SPECIMEN, sex="X")

    assert td1_lines(data)[1][7] == "<"


@pytest.mark.parametrize(
    ("override", "message"),
    [
        # 9 characters, then the rest and its digit in the 15 of optional data (Part 5, note j)
        ({"document_number": "A" * 24}, "document_number"),
        ({"document_number": "ABCDEFGHIJ", "optional_data_1": "X" * 13}, "optional_data_1"),
        ({"issuing_state": "UT"}, "issuing_state"),
        ({"nationality": "U1O"}, "nationality"),
        ({"document_code": "IDX"}, "document_code"),
        ({"optional_data_1": "X" * 16}, "optional_data_1"),
        ({"optional_data_2": "X" * 12}, "optional_data_2"),
        ({"sex": "Q"}, "sex"),
    ],
)
def test_td1_rejects_fields_that_do_not_fit(override: dict[str, object], message: str) -> None:
    data = dataclasses.replace(ICAO_TD1_SPECIMEN, **override)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match=message):
        td1_lines(data)


def test_td1_long_document_number_moves_its_rest_and_digit_into_the_optional_data() -> None:
    data = dataclasses.replace(
        ICAO_TD1_SPECIMEN, document_number="ABCDEFGHIJ", optional_data_1="XY"
    )

    line1 = td1_lines(data)[0]

    digit = str(check_digit("ABCDEFGHIJ"))
    assert line1 == f"I<UTOABCDEFGHI<J{digit}<XY" + "<" * 10
