"""Barcode-only PDF417 images of the synthetic AAMVA vectors (C36).

Every payload in ``contracts/fixtures/aamva/`` (valid and invalid) is rendered with
``pdf417gen`` (MIT, development only) as the barcode alone on a plain background. AAMVA payloads
are never drawn onto a card: the people in them are fictional, and each payload carries the
``ZC`` subfile marking it as OpenVerify synthetic test data. The symbol uses error-correction
level 5 and 13 data columns, the shape of a licence's barcode, and decodes with zxing-cpp, the
vision service's decoder, to exactly the payload's bytes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import pdf417gen  # type: ignore[import-untyped]
from PIL import Image

AAMVA_VECTOR_DIR: Final = Path(__file__).resolve().parents[3] / "contracts" / "fixtures" / "aamva"
VECTOR_FILES: Final = ("valid.json", "invalid.json")

PLAIN_BACKGROUND: Final = (232, 232, 232)
"""Light grey, below glare level (HSV value 250)."""

BARCODE_INK: Final = (20, 24, 31)

COLUMNS: Final = 13
SECURITY_LEVEL: Final = 5
MODULE_PX: Final = 3
"""Width of one module in pixels; rows are three modules high."""

QUIET_ZONE_PX: Final = 40


@dataclass(frozen=True, slots=True)
class AamvaVector:
    id: str
    valid: bool
    payload: str


def load_vectors(directory: Path = AAMVA_VECTOR_DIR) -> tuple[AamvaVector, ...]:
    """Every vector of ``valid.json`` then ``invalid.json``; an id used twice is refused."""
    vectors: list[AamvaVector] = []
    for name in VECTOR_FILES:
        document = json.loads((directory / name).read_text(encoding="utf-8"))
        vectors.extend(
            AamvaVector(id=v["id"], valid=bool(v["valid"]), payload=v["payload"])
            for v in document["vectors"]
        )
    seen: set[str] = set()
    for vector in vectors:
        if vector.id in seen:
            raise ValueError(f"AAMVA vector id {vector.id!r} is used twice")
        seen.add(vector.id)
    return tuple(vectors)


def _hex(colour: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*colour)


def render_barcode(payload: str) -> Image.Image:
    """``payload`` (ASCII, AAMVA control characters included) as a PDF417 on a plain ground."""
    codes = pdf417gen.encode(
        payload.encode("ascii"), columns=COLUMNS, security_level=SECURITY_LEVEL
    )
    image: Image.Image = pdf417gen.render_image(
        codes,
        scale=MODULE_PX,
        ratio=3,
        padding=QUIET_ZONE_PX,
        fg_color=_hex(BARCODE_INK),
        bg_color=_hex(PLAIN_BACKGROUND),
    )
    return image.convert("RGB")
