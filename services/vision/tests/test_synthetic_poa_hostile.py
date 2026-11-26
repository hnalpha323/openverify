"""tools/synthetic_poa.py, the hostile set (C65.2, C60.2): each file carries its attack.

Every attack is read back from the bytes (streaming decompression, the header boxes, strict or
lenient parsers), never from the sidecar alone. Nothing here decompresses a bomb into memory.
"""

from __future__ import annotations

import hashlib
import re
import struct
import zlib
from typing import Any

import pypdfium2 as pdfium  # type: ignore[import-untyped]
import pytest

from synthetic_poa import (
    BOMB_SIDE_PX,
    FLATE_BOMB_BYTES,
    HUGE_PAGE_SIDE_PT,
    MANY_PAGES,
    NESTING_DEPTH,
    XMP_OVERSIZED_BYTES,
    Fixture,
    deflate_zeros,
    hostile_set,
)
from synthetic_poa_checks import catalog

NAMES = {
    "xmp-entity-expansion.pdf",
    "xmp-external-entity.pdf",
    "xmp-oversized.pdf",
    "flate-bomb.pdf",
    "too-many-pages.pdf",
    "huge-page-box.pdf",
    "page-tree-loop.pdf",
    "deep-nesting.pdf",
    "xref-prev-loop.pdf",
    "dangerous-actions.pdf",
    "jbig2-image.pdf",
    "truncated.pdf",
    "not-a-pdf.pdf",
    "jpeg2000-bomb.jp2",
    "png-bomb.png",
}
KEYS = {
    "schema_version",
    "file",
    "media_type",
    "sha256",
    "set",
    "group",
    "variant",
    "description",
    "attack",
    "expect",
}


@pytest.fixture(scope="module")
def hostile() -> dict[str, Fixture]:
    return {fixture.path.removeprefix("hostile/"): fixture for fixture in hostile_set()}


def inflated_size(stream: bytes, *, limit: int = 2 * FLATE_BOMB_BYTES) -> int:
    """How many bytes ``stream`` inflates to, counted 16 MiB at a time."""
    decoder = zlib.decompressobj()
    total, pending = 0, stream
    while pending or not decoder.eof:
        chunk = decoder.decompress(pending, 1 << 24)
        total += len(chunk)
        assert total <= limit
        pending = decoder.unconsumed_tail
        if not chunk and not pending:
            break
    return total


def streams(data: bytes) -> list[tuple[bytes, bytes]]:
    """Every ``(dictionary, raw data)`` stream of a PDF written with ``/Length``."""
    found = []
    pattern = rb"<<((?:(?!>>\s*stream).)*?)/Length (\d+)([^>]*)>>\s*stream\r?\n"
    for match in re.finditer(pattern, data, re.DOTALL):
        start, length = match.end(), int(match.group(2))
        found.append((match.group(0), data[start : start + length]))
    return found


# --- the set ------------------------------------------------------------------------------------


def test_the_set_holds_each_attack_once_with_a_complete_sidecar(
    hostile: dict[str, Fixture],
) -> None:
    assert set(hostile) == NAMES
    for name, fixture in hostile.items():
        sidecar: dict[str, Any] = fixture.sidecar
        assert set(sidecar) == KEYS, name
        assert sidecar["set"] == "hostile"
        assert sidecar["group"] == "hostile"
        assert sidecar["file"] == f"hostile/{name}"
        assert sidecar["sha256"] == hashlib.sha256(fixture.data).hexdigest()
        assert sidecar["expect"]["endpoint"] in ("/v1/analyze/document", "/v1/convert/portrait")
        assert sidecar["expect"]["outcome"] in ("refused", "analysed", "refused-or-analysed")
        assert sidecar["expect"]["statuses"]
        assert all(status in (200, 413, 415, 422, 503) for status in sidecar["expect"]["statuses"])


def test_the_set_is_deterministic(hostile: dict[str, Fixture]) -> None:
    again = {fixture.path.removeprefix("hostile/"): fixture.data for fixture in hostile_set()}

    assert again == {name: fixture.data for name, fixture in hostile.items()}


def test_deflate_zeros_inflates_to_exactly_the_count() -> None:
    for count in (0, 1, 1000, (1 << 20) + 17, 5 * (1 << 20)):
        stream = deflate_zeros(count)
        assert zlib.decompress(stream) == bytes(count)


# --- XMP ----------------------------------------------------------------------------------------


def test_xmp_entity_expansion(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["xmp-entity-expansion.pdf"]

    assert b"<!DOCTYPE" in fixture.data
    assert len(re.findall(rb"<!ENTITY", fixture.data)) >= 10
    assert len(pdfium.PdfDocument(fixture.data)) == 1  # otherwise a readable bill
    assert fixture.sidecar["expect"]["statuses"] == [200]


def test_xmp_external_entity(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["xmp-external-entity.pdf"]

    assert re.search(rb'<!ENTITY \w+ SYSTEM "file:///', fixture.data)
    assert len(pdfium.PdfDocument(fixture.data)) == 1


def test_xmp_oversized(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["xmp-oversized.pdf"]
    (metadata,) = [raw for head, raw in streams(fixture.data) if b"/Metadata" in head]

    assert len(metadata) >= XMP_OVERSIZED_BYTES
    assert len(pdfium.PdfDocument(fixture.data)) == 1


# --- structure ----------------------------------------------------------------------------------


def test_the_flate_bomb_inflates_to_a_gibibyte(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["flate-bomb.pdf"]
    (content,) = [raw for head, raw in streams(fixture.data) if b"/FlateDecode" in head]

    assert len(fixture.data) < 2_000_000
    assert inflated_size(content) == FLATE_BOMB_BYTES


def test_too_many_pages(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["too-many-pages.pdf"]

    assert len(pdfium.PdfDocument(fixture.data)) == MANY_PAGES
    assert fixture.sidecar["expect"]["codes"] == ["too_many_pages"]


def test_a_page_box_over_the_bound(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["huge-page-box.pdf"]

    page = pdfium.PdfDocument(fixture.data)[0]
    assert page.get_size() == (HUGE_PAGE_SIDE_PT, HUGE_PAGE_SIDE_PT)


def test_a_page_tree_that_contains_itself(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["page-tree-loop.pdf"]
    match = re.search(rb"(\d+) 0 obj\n<< /Type /Pages /Kids \[(\d+) 0 R\]", fixture.data)

    assert match is not None
    assert match.group(1) == match.group(2)


def test_arrays_nested_far_beyond_any_parser_limit(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["deep-nesting.pdf"]

    assert b"[" * NESTING_DEPTH in fixture.data


def test_an_xref_whose_previous_section_is_itself(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["xref-prev-loop.pdf"]
    startxref = int(re.findall(rb"startxref\n(\d+)", fixture.data)[-1])
    prev = re.search(rb"/Prev (\d+)", fixture.data)

    assert prev is not None
    assert int(prev.group(1)) == startxref


def test_dangerous_actions_including_an_escaped_name(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["dangerous-actions.pdf"]
    root = catalog(fixture.data)

    assert b"/J#61vaScript" in fixture.data  # #xx-escaped: a raw scan must decode names
    assert root["/OpenAction"]["/S"] == "/JavaScript"
    assert "/EmbeddedFiles" in root["/Names"]
    subtypes = {annot.get_object()["/Subtype"] for annot in root["/Pages"]["/Kids"][0]["/Annots"]}
    actions = {
        annot.get_object()["/A"]["/S"]
        for annot in root["/Pages"]["/Kids"][0]["/Annots"]
        if "/A" in annot.get_object()
    }
    assert "/RichMedia" in subtypes
    assert actions == {"/Launch", "/SubmitForm", "/GoToR"}
    assert fixture.sidecar["expect"]["measures"]["actions"] == {
        "javascript": 1,
        "launch": 1,
        "submit_form": 1,
        "goto_remote": 1,
        "rich_media": 1,
        "embedded_files": 1,
    }


def test_a_jbig2_image_with_no_decoder_shipped(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["jbig2-image.pdf"]

    assert b"/JBIG2Decode" in fixture.data
    assert len(pdfium.PdfDocument(fixture.data)) == 1


def test_a_truncated_file(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["truncated.pdf"]

    assert fixture.data.startswith(b"%PDF-")
    assert b"%%EOF" not in fixture.data
    assert b"startxref" not in fixture.data


def test_a_file_whose_pdf_header_comes_too_late(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["not-a-pdf.pdf"]

    assert b"%PDF-" not in fixture.data[:1024]  # C52.4: the header must be in the first 1,024
    assert b"%PDF-" in fixture.data
    assert fixture.sidecar["expect"]["statuses"] == [415]


# --- images -------------------------------------------------------------------------------------


def test_a_jpeg2000_header_declaring_billions_of_pixels(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["jpeg2000-bomb.jp2"]
    data = fixture.data
    ihdr = data.index(b"ihdr") + 4
    height, width = struct.unpack(">II", data[ihdr : ihdr + 8])
    siz = data.index(b"\xff\x51") + 4  # SIZ: the marker, Lsiz, Rsiz
    x_size, y_size = struct.unpack(">II", data[siz + 2 : siz + 10])

    assert data[4:8] == b"jP  "
    side = BOMB_SIDE_PX[0]
    assert (width, height) == (x_size, y_size) == (side, side)
    assert len(data) < 100_000
    assert fixture.sidecar["expect"]["endpoint"] == "/v1/convert/portrait"


def test_a_png_declaring_four_hundred_megapixels(hostile: dict[str, Fixture]) -> None:
    fixture = hostile["png-bomb.png"]
    data = fixture.data
    width, height = struct.unpack(">II", data[16:24])
    idat = data.index(b"IDAT")
    (length,) = struct.unpack(">I", data[idat - 4 : idat])

    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    side = BOMB_SIDE_PX[1]
    assert (width, height) == (side, side)
    assert inflated_size(data[idat + 4 : idat + 4 + length]) == side * (side + 1)
    for chunk in (b"IHDR", b"IDAT", b"IEND"):
        at = data.index(chunk)
        (size,) = struct.unpack(">I", data[at - 4 : at])
        (crc,) = struct.unpack(">I", data[at + 4 + size : at + 8 + size])
        assert crc == zlib.crc32(data[at : at + 4 + size])
