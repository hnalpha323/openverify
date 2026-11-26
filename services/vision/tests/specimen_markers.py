"""What a synthetic happy-path document must not print (C36), for the fixture generator tests.

``MARKERS`` and ``MARKER_PHRASES`` are the frozen specimen-marker list of
``docs/plans/phase-3.plan.md`` C33 (whole words, case-insensitive, accents folded). The check
itself lives in ``packages/checks``; this copy only lets the generator's tests prove that the
happy card carries none and that the specimen-stamped variant does. The ICAO 9303 example
persons and document numbers are read from the shared vectors in ``contracts/fixtures/mrz/``.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Iterable
from pathlib import Path
from typing import Final

MARKERS: Final = (
    "SPECIMEN",
    "ESPECIMEN",
    "SAMPLE",
    "MUSTER",
    "ECHANTILLON",
    "CAMPIONE",
    "FACSIMILE",
    "MODELO",
    "VZOR",
    "WZOR",
    "NAYTE",
    "PROVE",
    "VOID",
)
MARKER_PHRASES: Final = ("NOT A REAL DOCUMENT",)

MRZ_VECTOR_DIR: Final = Path(__file__).resolve().parents[3] / "contracts" / "fixtures" / "mrz"


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).upper()


def markers_in(texts: Iterable[str]) -> set[str]:
    """The specimen markers and phrases found as whole words in any of ``texts``."""
    found: set[str] = set()
    for text in texts:
        words = re.sub(r"[^A-Z0-9]+", " ", _fold(text)).split()
        found |= set(MARKERS) & set(words)
        joined = f" {' '.join(words)} "
        found |= {phrase for phrase in MARKER_PHRASES if f" {phrase} " in joined}
    return found


def mrz_words(lines: Iterable[str]) -> tuple[str, ...]:
    """MRZ lines as words, fillers read as spaces."""
    return tuple(line.replace("<", " ") for line in lines)


def _icao_fields() -> list[dict[str, str]]:
    fields: list[dict[str, str]] = []
    for path in sorted(MRZ_VECTOR_DIR.glob("*.json")):
        for vector in json.loads(path.read_text(encoding="utf-8"))["vectors"]:
            if "fields" in vector:
                fields.append(vector["fields"])
    return fields


ICAO_EXAMPLE_NUMBERS: Final = frozenset(f["document_number"] for f in _icao_fields())
"""Document numbers of the published ICAO 9303 examples (also C33 markers)."""

ICAO_EXAMPLE_NAMES: Final = frozenset(
    word for f in _icao_fields() for word in f"{f['surname']} {f['given_names']}".split()
)
"""Every name word of the published ICAO 9303 example persons."""
