"""Barcode-only PDF417 images of every payload in ``contracts/fixtures/aamva/`` (C36).

Each image holds the payload alone on a plain background, never on a card, and decodes with
zxing-cpp (the vision service's decoder) to exactly the payload's bytes.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pytest
import zxingcpp
from PIL import Image

from synthetic_aamva import (
    AAMVA_VECTOR_DIR,
    BARCODE_INK,
    PLAIN_BACKGROUND,
    load_vectors,
    render_barcode,
)

SYNTHETIC_MARKER = re.compile(r"\r(Z[A-Z])\1AOPENVERIFY SYNTHETIC TEST DATA\r")
"""The jurisdiction-specific marker subfile (``Z`` and the jurisdiction's letter) and its one
element, as ``contracts/fixtures/aamva/README.md`` defines it."""


def payloads_on_disk() -> dict[str, str]:
    payloads: dict[str, str] = {}
    for name in ("valid.json", "invalid.json"):
        document = json.loads((AAMVA_VECTOR_DIR / name).read_text(encoding="utf-8"))
        payloads.update({vector["id"]: vector["payload"] for vector in document["vectors"]})
    return payloads


def decoded(image: Image.Image) -> list[bytes]:
    results = zxingcpp.read_barcodes(
        np.asarray(image.convert("RGB")),
        formats=zxingcpp.BarcodeFormats(zxingcpp.BarcodeFormat.PDF417),
        text_mode=zxingcpp.TextMode.Plain,
    )
    return [bytes(result.bytes) for result in results]


def test_every_payload_of_the_vector_files_is_loaded_once() -> None:
    vectors = load_vectors()

    assert {vector.id: vector.payload for vector in vectors} == payloads_on_disk()
    assert len({vector.id for vector in vectors}) == len(vectors)
    assert any(vector.valid for vector in vectors)
    assert any(not vector.valid for vector in vectors)
    assert all(SYNTHETIC_MARKER.search(vector.payload) for vector in vectors)


def test_a_vector_id_used_twice_is_refused(tmp_path: Path) -> None:
    vector = {"id": "twice", "note": "", "payload": "@", "valid": True}
    for name in ("valid.json", "invalid.json"):
        (tmp_path / name).write_text(json.dumps({"schema_version": 1, "vectors": [vector]}))

    with pytest.raises(ValueError, match="twice"):
        load_vectors(tmp_path)


@pytest.mark.parametrize(
    "payload",
    [pytest.param(payload, id=vector_id) for vector_id, payload in payloads_on_disk().items()],
)
def test_each_payload_renders_as_a_pdf417_that_decodes_to_its_exact_bytes(payload: str) -> None:
    image = render_barcode(payload)

    assert image.mode == "RGB"
    assert decoded(image) == [payload.encode("ascii")]


def test_a_render_is_the_barcode_alone_on_a_plain_background() -> None:
    image = render_barcode(load_vectors()[0].payload)
    rgb = np.asarray(image)
    colours = {tuple(int(v) for v in colour) for colour in rgb.reshape(-1, 3)}

    assert colours == {PLAIN_BACKGROUND, BARCODE_INK}
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    assert (border == PLAIN_BACKGROUND).all()
    assert int(rgb.max()) < 250  # the plain background never reads as glare
    width, height = image.size
    assert width / height > 2  # a barcode strip, not a card


def test_a_render_is_deterministic() -> None:
    payload = load_vectors()[0].payload

    assert render_barcode(payload).tobytes() == render_barcode(payload).tobytes()
