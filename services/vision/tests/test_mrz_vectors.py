"""``tools/icao_mrz.py`` against the cross-language MRZ vectors of ``contracts/fixtures/mrz/``.

The vectors (C33) hold the published ICAO 9303 examples and invalid MRZs derived from them. Every
check digit they state is recomputed here, and every valid TD1, TD3, MRV-A and MRV-B vector is
rebuilt from its fields: the Python generator, the TypeScript parser and Kotlin ``Mrz.kt``
(Workflow 3B) must agree on the same files.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from icao_mrz import MrvData, Td1Data, Td3Data, check_digit, mrv_lines, td1_lines, td3_lines
from mrz_checks import DIGITS_BY_FORMAT

VECTOR_DIR = Path(__file__).resolve().parents[3] / "contracts" / "fixtures" / "mrz"
DIGIT_FIELDS = ("document_number", "birth_date", "expiration_date", "optional_data", "composite")


def _load() -> list[dict[str, Any]]:
    vectors: list[dict[str, Any]] = []
    for path in sorted(VECTOR_DIR.glob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        assert document["schema_version"] == 1, path
        vectors.extend(document["vectors"])
    return vectors


VECTORS = _load()
PARSED = [vector for vector in VECTORS if "fields" in vector]
"""Vectors stating their fields (the ICAO examples and the invalid MRZs that still parse)."""
CORRECTED = [vector for vector in VECTORS if "corrected_lines" in vector]
"""The C31.3 OCR-correction vectors: lines as read, and the lines after the allowed corrections."""
DIGITS = [
    (f"{vector['id']}:{name}", vector["check_digits"][name])
    for vector in VECTORS
    if "check_digits" in vector
    for name in DIGIT_FIELDS
    if vector["check_digits"][name] is not None
]


def _date(yymmdd: str) -> date:
    """Any century will do: the MRZ prints ``YYMMDD`` only."""
    return date(2000 + int(yymmdd[0:2]), int(yymmdd[2:4]), int(yymmdd[4:6]))


def _built(vector: dict[str, Any]) -> tuple[str, ...]:
    fields = vector["fields"]
    common = {
        "document_code": fields["document_code"],
        "issuing_state": fields["issuing_state"],
        "document_number": fields["document_number"],
        "birth_date": _date(fields["birth_date"]),
        "sex": fields["sex"],
        "expiry_date": _date(fields["expiration_date"]),
        "nationality": fields["nationality"],
        "surname": fields["surname"],
        "given_names": fields["given_names"],
    }
    layout = vector["format"]
    if layout == "TD1":
        return td1_lines(
            Td1Data(
                **common,
                optional_data_1=fields["optional_data_1"],
                optional_data_2=fields["optional_data_2"],
            )
        )
    if layout == "TD3":
        return td3_lines(Td3Data(**common, personal_number=fields["optional_data_1"]))
    return mrv_lines(MrvData(**common, optional_data=fields["optional_data_1"]), layout=layout)


def test_the_vector_directory_has_every_layout_and_invalid_vectors() -> None:
    formats = {vector["format"] for vector in VECTORS}

    assert {"TD1", "TD2", "TD3", "MRVA", "MRVB", None} <= formats
    assert formats - {None} <= set(DIGITS_BY_FORMAT)
    assert any(not vector["valid"] for vector in VECTORS)
    assert len(DIGITS) >= 20
    assert CORRECTED


@pytest.mark.parametrize(("name", "digit"), DIGITS, ids=[name for name, _ in DIGITS])
def test_check_digits_match_every_vector(name: str, digit: dict[str, Any]) -> None:
    computed = check_digit(digit["input"])

    assert computed == digit["computed"], name
    assert (digit["printed"] == str(computed)) is digit["valid"], name


@pytest.mark.parametrize(
    "vector",
    [v for v in PARSED if v["valid"] and v["format"] in ("TD1", "TD3", "MRVA", "MRVB")],
    ids=lambda vector: str(vector["id"]),
)
def test_the_builders_reproduce_every_valid_vector(vector: dict[str, Any]) -> None:
    assert _built(vector) == tuple(vector["lines"])


@pytest.mark.parametrize(
    "vector",
    # The generator builds no TD2 lines; the TD2 vectors' check digits are checked above.
    [v for v in PARSED if not v["valid"] and v["format"] in ("TD1", "TD3", "MRVA", "MRVB")],
    ids=lambda vector: str(vector["id"]),
)
def test_an_invalid_vector_differs_from_its_rebuilt_lines_in_one_check_digit(
    vector: dict[str, Any],
) -> None:
    printed = "".join(vector["lines"])
    rebuilt = "".join(_built(vector))

    differing = [i for i, (a, b) in enumerate(zip(printed, rebuilt, strict=True)) if a != b]

    assert len(differing) == 1
    assert printed[differing[0]].isdigit()


@pytest.mark.parametrize("vector", CORRECTED, ids=lambda vector: str(vector["id"]))
def test_the_check_digits_of_corrected_lines_hold_exactly_when_the_vector_says(
    vector: dict[str, Any],
) -> None:
    digits = DIGITS_BY_FORMAT[vector["format"]](tuple(vector["corrected_lines"]))

    assert all(digits.values()) is vector["valid"]


@pytest.mark.parametrize("vector", PARSED, ids=lambda vector: str(vector["id"]))
def test_the_digit_positions_of_the_fixture_tests_agree_with_every_parsed_vector(
    vector: dict[str, Any],
) -> None:
    digits = DIGITS_BY_FORMAT[vector["format"]](tuple(vector["lines"]))
    stated = {name: d["valid"] for name, d in vector["check_digits"].items() if d is not None}

    assert digits == stated
