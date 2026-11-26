"""Synthetic proof-of-address documents (Phase 5, C65.2) and the held-out set (C60.7).

Everything here is synthetic (C65.1): invented people, cities and issuers ("Utopia Water Board"),
unassigned postal codes, reserved ``.example`` domains, 555-01xx telephone numbers and
deterministic seeds; no real person or issuer branding. The only real documents are the blank US
federal forms of the held-out set (public domain, pinned by ``scripts/fetch_fixtures.py``), which
are filled with synthetic values.

Documents are laid out once (:class:`Page`, in points from the top left) and written two ways:
- as a born-digital PDF by our own minimal writer (:func:`write_pdf`: standard-14 fonts, classic
  or linearized cross-reference, XMP, actions, a signature placeholder), edited where a variant
  needs it with pypdf incremental writes; reportlab, fpdf2 and borb are never used (C60.3);
- as a photo of the printed page (:func:`raster`, :func:`photograph`): a JPEG with a slight
  perspective, uneven light, sensor noise and camera EXIF.

Dates are relative to an ``as_of`` date (the day the set is generated), so recency holds on the
day of the run; each sidecar records the date its expectations hold on.
"""

from __future__ import annotations

import calendar
import functools
import hashlib
import io
import math
import unicodedata
import uuid
import zlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Final, Literal

import numpy as np
import pypdfium2 as pdfium  # type: ignore[import-untyped]
from numpy.typing import NDArray
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pypdf import PageObject, PdfReader, PdfWriter
from pypdf._codecs.core_font_metrics import CORE_FONT_METRICS
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, StreamObject

RGB = tuple[int, int, int]

INK: Final[RGB] = (22, 26, 34)
MUTED: Final[RGB] = (92, 98, 110)
WHITE: Final[RGB] = (255, 255, 255)
PAPER: Final[RGB] = (250, 249, 245)
"""The page colour of a raster: a printed sheet, slightly warm."""

LETTER: Final = (612.0, 792.0)
A4: Final = (595.0, 842.0)

FontName = Literal[
    "Helvetica",
    "Helvetica-Bold",
    "Helvetica-Oblique",
    "Times-Roman",
    "Courier",
    "Helvetica-Remapped",
]
"""The standard-14 fonts the writer uses, plus ``Helvetica-Remapped``: Helvetica whose ToUnicode
map reads the digits of :data:`REMAPPED_DIGITS` as other digits, so the text layer and the printed
glyphs disagree (a text-layer forgery)."""

FONT_ORDER: Final[tuple[FontName, ...]] = (
    "Helvetica",
    "Helvetica-Bold",
    "Helvetica-Oblique",
    "Times-Roman",
    "Courier",
    "Helvetica-Remapped",
)
"""Resource order: a document's fonts are ``/F1``... in this order, the ones it uses only."""

_BASE_FONT: Final[dict[FontName, str]] = {
    "Helvetica": "Helvetica",
    "Helvetica-Bold": "Helvetica-Bold",
    "Helvetica-Oblique": "Helvetica-Oblique",
    "Times-Roman": "Times-Roman",
    "Courier": "Courier",
    "Helvetica-Remapped": "Helvetica",
}

REMAPPED_DIGITS: Final = {"4": "9"}
"""``Helvetica-Remapped`` prints the key's glyph and extracts the value."""

Align = Literal["left", "right"]


@dataclass(frozen=True, slots=True)
class Text:
    """A line of text: ``x`` and the baseline ``y`` in points from the page's top left."""

    x: float
    y: float
    text: str
    size: float = 10.0
    font: FontName = "Helvetica"
    align: Align = "left"
    """``right``: ``x`` is where the line ends (amount columns)."""
    color: RGB = INK
    invisible: bool = False
    """PDF text render mode 3: in the text layer, never painted (and never in a raster)."""
    role: str | None = None
    """What the line carries for the truth and the edits (``amount``, ``issue-date``, ...)."""


@dataclass(frozen=True, slots=True)
class Box:
    """A rectangle in points from the page's top left, filled and or stroked."""

    x: float
    y: float
    width: float
    height: float
    fill: RGB | None = None
    stroke: RGB | None = None
    line_width: float = 0.75


Item = Text | Box


@dataclass(frozen=True, slots=True)
class Page:
    width: float = LETTER[0]
    height: float = LETTER[1]
    items: tuple[Item, ...] = ()


def text_width(text: str, font: FontName, size: float) -> float:
    """The advance width of ``text`` in points, from the Adobe core-14 metrics pypdf bundles."""
    widths = CORE_FONT_METRICS[_BASE_FONT[font]].character_widths
    default = widths["default"]
    return sum(widths.get(char, default) for char in text) * size / 1000


def visible_lines(page: Page) -> list[str]:
    """The painted text lines of ``page``, in drawing order (what OCR may read)."""
    return [item.text for item in page.items if isinstance(item, Text) and not item.invisible]


def text_left(item: Text) -> float:
    """Where ``item`` starts, in points from the left edge."""
    if item.align == "right":
        return item.x - text_width(item.text, item.font, item.size)
    return item.x


# --- the PDF writer -----------------------------------------------------------------------------

HEADER: Final = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"
SIGNATURE_BYTES: Final = 4096
"""The signature placeholder's size: ``/Contents`` holds this many zero bytes, in hex."""
_BYTE_RANGE_PLACEHOLDER: Final = b"/ByteRange [0 0000000000 0000000000 0000000000]"
_HINT_BYTES: Final = 32
_JAVASCRIPT: Final = "void 0;"


@dataclass(frozen=True, slots=True)
class Xmp:
    """What the XMP packet says (C60.1's ``XmpFields``)."""

    creator_tool: str | None = None
    producer: str | None = None
    create_date: datetime | None = None
    modify_date: datetime | None = None
    metadata_date: datetime | None = None
    document_id: str | None = None
    instance_id: str | None = None
    history_agents: tuple[str, ...] = ()


OpenAction = Literal["goto", "javascript"]


@dataclass(frozen=True, slots=True)
class PdfMeta:
    """The document-level parts of a written PDF."""

    file_id: bytes
    """16 bytes: the trailer's ``/ID`` (both halves)."""
    producer: str | None = None
    creator: str | None = None
    title: str | None = None
    created: datetime | None = None
    modified: datetime | None = None
    xmp: Xmp | None = None
    open_action: OpenAction | None = None
    signed: bool = False
    """A signature field whose byte range covers the whole file (a placeholder value: OpenVerify
    counts signatures and their byte ranges, it does not validate them)."""
    linearized: bool = False
    """One page only: a linearization dictionary, a first-page cross-reference section and a
    placeholder hint stream."""
    xref_shift: int = 0
    """Added to every cross-reference offset, so a reader must repair the table."""
    compress: bool = True
    """FlateDecode the content streams."""
    raw_xmp: bytes | None = None
    """An XMP packet written verbatim instead of :attr:`xmp` (hostile inputs)."""


@dataclass(frozen=True, slots=True)
class PdfTruth:
    """What :func:`write_pdf` wrote, in C60.1's terms."""

    revisions: int
    linearized: bool
    xref_repaired: bool
    eof_markers: int
    signatures: int
    fonts: tuple[str, ...]
    """The base font names, in resource order."""
    actions: dict[str, int] = field(default_factory=dict)


def pdf_date(when: datetime) -> str:
    """A PDF date string, ``D:YYYYMMDDHHmmSSZ`` (UTC)."""
    return when.astimezone(UTC).strftime("D:%Y%m%d%H%M%SZ")


def xmp_date(when: datetime) -> str:
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def deterministic_uuid(seed: str) -> str:
    """``uuid:<v4 UUID>`` derived from ``seed``: the same seed, the same id."""
    digest = hashlib.sha256(seed.encode("utf-8")).digest()[:16]
    return f"uuid:{uuid.UUID(bytes=digest, version=4)}"


def winansi(text: str) -> bytes:
    """``text`` in WinAnsiEncoding (Windows-1252 for every character these documents use)."""
    return text.encode("cp1252")


def pdf_string(raw: bytes) -> bytes:
    """A PDF literal string of ``raw``."""
    escaped = raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")
    return b"(" + escaped + b")"


def text_string(text: str) -> bytes:
    """A PDF text string: a literal for ASCII, else UTF-16BE with its byte-order mark in hex."""
    if text.isascii():
        return pdf_string(text.encode("ascii"))
    return b"<FEFF" + text.encode("utf-16-be").hex().upper().encode("ascii") + b">"


def _number(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".")


def _colour(rgb: RGB) -> str:
    return " ".join(_number(channel / 255) for channel in rgb)


def content_stream(page: Page, resources: dict[FontName, str]) -> bytes:
    """The page's content: each item in order, boxes as paths, lines as text objects."""
    ops: list[bytes] = []
    for item in page.items:
        if isinstance(item, Box):
            top = page.height - item.y - item.height
            parts = ["q"]
            if item.fill is not None:
                parts.append(f"{_colour(item.fill)} rg")
            if item.stroke is not None:
                parts.append(f"{_colour(item.stroke)} RG {_number(item.line_width)} w")
            rect = [_number(v) for v in (item.x, top, item.width, item.height)]
            parts.append(" ".join(rect) + " re")
            if item.fill is not None and item.stroke is not None:
                parts.append("B")
            else:
                parts.append("f" if item.fill is not None else "S")
            parts.append("Q")
            ops.append(" ".join(parts).encode("ascii"))
            continue
        x, y = text_left(item), page.height - item.y
        mode = 3 if item.invisible else 0
        head = (
            f"BT /{resources[item.font]} {_number(item.size)} Tf {_colour(item.color)} rg "
            f"{mode} Tr 1 0 0 1 {_number(x)} {_number(y)} Tm "
        )
        ops.append(head.encode("ascii") + pdf_string(winansi(item.text)) + b" Tj ET")
    return b"\n".join(ops) + b"\n"


def stream_object(dictionary: str, data: bytes, *, compress: bool) -> bytes:
    """An indirect stream's body: ``dictionary`` entries, ``/Length`` and the data."""
    if compress:
        data = zlib.compress(data, 6)
        dictionary = f"{dictionary} /Filter /FlateDecode".strip()
    head = f"<< {dictionary} /Length {len(data)} >>".replace("<<  ", "<< ")
    return head.encode("ascii") + b"\nstream\n" + data + b"\nendstream"


def to_unicode_cmap(remap: dict[str, str]) -> bytes:
    """A ToUnicode CMap for printable ASCII codes, reading each key of ``remap`` as its value."""
    entries = []
    for code in range(0x20, 0x7F):
        char = remap.get(chr(code), chr(code))
        entries.append(f"<{code:02X}> <{ord(char):04X}>")
    return "\n".join(
        [
            "/CIDInit /ProcSet findresource begin",
            "12 dict begin",
            "begincmap",
            "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
            "/CMapName /OpenVerify-Remap def",
            "/CMapType 2 def",
            "1 begincodespacerange",
            "<00> <FF>",
            "endcodespacerange",
            f"{len(entries)} beginbfchar",
            *entries,
            "endbfchar",
            "endcmap",
            "CMapName currentdict /CMap defineresource pop",
            "end",
            "end",
        ]
    ).encode("ascii")


def _xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def xmp_packet(xmp: Xmp) -> bytes:
    """An XMP packet (uncompressed, as most writers leave it) saying what ``xmp`` holds."""
    fields: list[str] = []
    simple = (
        ("xmp:CreatorTool", xmp.creator_tool),
        ("pdf:Producer", xmp.producer),
        ("xmpMM:DocumentID", xmp.document_id),
        ("xmpMM:InstanceID", xmp.instance_id),
    )
    dated = (
        ("xmp:CreateDate", xmp.create_date),
        ("xmp:ModifyDate", xmp.modify_date),
        ("xmp:MetadataDate", xmp.metadata_date),
    )
    fields += [f"<{tag}>{_xml(value)}</{tag}>" for tag, value in simple if value is not None]
    fields += [f"<{tag}>{xmp_date(value)}</{tag}>" for tag, value in dated if value is not None]
    if xmp.history_agents:
        events = "".join(
            '<rdf:li rdf:parseType="Resource"><stEvt:action>'
            + ("created" if index == 0 else "saved")
            + f"</stEvt:action><stEvt:softwareAgent>{_xml(agent)}</stEvt:softwareAgent></rdf:li>"
            for index, agent in enumerate(xmp.history_agents)
        )
        fields.append(f"<xmpMM:History><rdf:Seq>{events}</rdf:Seq></xmpMM:History>")
    body = "\n".join(
        [
            '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
            '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
            '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
            '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"'
            ' xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"'
            ' xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#">',
            *fields,
            "</rdf:Description>",
            "</rdf:RDF>",
            "</x:xmpmeta>",
            " " * 512,
            '<?xpacket end="w"?>',
        ]
    )
    return body.encode("utf-8")


def _fonts_of(pages: Sequence[Page]) -> tuple[FontName, ...]:
    used = {item.font for page in pages for item in page.items if isinstance(item, Text)}
    return tuple(font for font in FONT_ORDER if font in used)


def _roles(pages: Sequence[Page], meta: PdfMeta, fonts: Sequence[FontName]) -> list[str]:
    """Every object's role, in the order its number is allotted."""
    has_info = any(
        value is not None
        for value in (meta.producer, meta.creator, meta.title, meta.created, meta.modified)
    )
    has_xmp = meta.xmp is not None or meta.raw_xmp is not None
    document = ["pages", *(["info"] if has_info else []), *(["metadata"] if has_xmp else [])]
    font_roles = [f"font:{font}" for font in fonts]
    if "Helvetica-Remapped" in fonts:
        font_roles.append("cmap")
    page_roles = [
        role for index in range(len(pages)) for role in (f"page:{index}", f"content:{index}")
    ]
    signature = ["sigfield", "sigvalue"] if meta.signed else []
    if meta.linearized:
        # The rest first (numbered below the linearization dictionary), then the first-page
        # section: the dictionary, the catalogue, the hint stream and the page with its objects.
        return [*document, "lin", "catalog", "hint", *page_roles, *font_roles, *signature]
    return ["catalog", *document, *font_roles, *page_roles, *signature]


def _info_body(meta: PdfMeta) -> bytes:
    entries: list[bytes] = []
    for key, value in (
        ("Producer", meta.producer),
        ("Creator", meta.creator),
        ("Title", meta.title),
    ):
        if value is not None:
            entries.append(b"/" + key.encode("ascii") + b" " + text_string(value))
    for key, when in (("CreationDate", meta.created), ("ModDate", meta.modified)):
        if when is not None:
            entries.append(b"/" + key.encode("ascii") + b" " + pdf_string(pdf_date(when).encode()))
    return b"<< " + b" ".join(entries) + b" >>"


def _bodies(  # noqa: PLR0912 - one branch per object role
    pages: Sequence[Page], meta: PdfMeta, fonts: Sequence[FontName], numbers: dict[str, int]
) -> dict[int, bytes]:
    resources = {font: f"F{index + 1}" for index, font in enumerate(fonts)}
    font_refs = " ".join(f"/{resources[font]} {numbers[f'font:{font}']} 0 R" for font in fonts)
    bodies: dict[int, bytes] = {}
    for role, number in numbers.items():
        if role == "catalog":
            parts = [f"/Type /Catalog /Pages {numbers['pages']} 0 R"]
            if "metadata" in numbers:
                parts.append(f"/Metadata {numbers['metadata']} 0 R")
            if meta.open_action == "goto":
                parts.append(f"/OpenAction << /S /GoTo /D [{numbers['page:0']} 0 R /Fit] >>")
            elif meta.open_action == "javascript":
                parts.append(f"/OpenAction << /S /JavaScript /JS ({_JAVASCRIPT}) >>")
            if meta.signed:
                parts.append(f"/AcroForm << /Fields [{numbers['sigfield']} 0 R] /SigFlags 3 >>")
            body = ("<< " + " ".join(parts) + " >>").encode("ascii")
        elif role == "pages":
            kids = " ".join(f"{numbers[f'page:{index}']} 0 R" for index in range(len(pages)))
            body = f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode("ascii")
        elif role == "info":
            body = _info_body(meta)
        elif role == "metadata":
            packet = meta.raw_xmp if meta.raw_xmp is not None else xmp_packet(meta.xmp or Xmp())
            body = stream_object("/Type /Metadata /Subtype /XML", packet, compress=False)
        elif role.startswith("font:"):
            font: FontName = role.removeprefix("font:")  # type: ignore[assignment]
            extra = f" /ToUnicode {numbers['cmap']} 0 R" if font == "Helvetica-Remapped" else ""
            body = (
                f"<< /Type /Font /Subtype /Type1 /BaseFont /{_BASE_FONT[font]} "
                f"/Encoding /WinAnsiEncoding{extra} >>"
            ).encode("ascii")
        elif role == "cmap":
            body = stream_object("", to_unicode_cmap(REMAPPED_DIGITS), compress=meta.compress)
        elif role.startswith("page:"):
            index = int(role.removeprefix("page:"))
            page = pages[index]
            annots = f" /Annots [{numbers['sigfield']} 0 R]" if meta.signed and index == 0 else ""
            body = (
                f"<< /Type /Page /Parent {numbers['pages']} 0 R "
                f"/MediaBox [0 0 {_number(page.width)} {_number(page.height)}] "
                f"/Resources << /Font << {font_refs} >> /ProcSet [/PDF /Text] >> "
                f"/Contents {numbers[f'content:{index}']} 0 R{annots} >>"
            ).encode("ascii")
        elif role.startswith("content:"):
            page = pages[int(role.removeprefix("content:"))]
            body = stream_object("", content_stream(page, resources), compress=meta.compress)
        elif role == "sigfield":
            body = (
                f"<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /F 132 "
                f"/Rect [0 0 0 0] /P {numbers['page:0']} 0 R /V {numbers['sigvalue']} 0 R >>"
            ).encode("ascii")
        elif role == "sigvalue":
            signed_at = pdf_date(meta.created or datetime(2000, 1, 1, tzinfo=UTC))
            body = (
                b"<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached "
                + _BYTE_RANGE_PLACEHOLDER
                + b" /Contents <"
                + b"0" * (2 * SIGNATURE_BYTES)
                + b"> /M "
                + pdf_string(signed_at.encode("ascii"))
                + b" /Reason (Statement issued electronically) >>"
            )
        elif role == "hint":
            body = stream_object("/S 16", bytes(_HINT_BYTES), compress=False)
        else:  # "lin": filled in by the linearized serializer
            body = b""
        bodies[number] = body
    return bodies


def _object(number: int, body: bytes) -> bytes:
    return f"{number} 0 obj\n".encode("ascii") + body + b"\nendobj\n"


def _trailer_id(file_id: bytes) -> str:
    hex_id = file_id.hex().upper()
    return f"/ID [<{hex_id}> <{hex_id}>]"


def _classic(
    bodies: dict[int, bytes], *, root: int, info: int | None, file_id: bytes, shift: int
) -> bytes:
    out = bytearray(HEADER)
    offsets: dict[int, int] = {}
    for number in sorted(bodies):
        offsets[number] = len(out)
        out += _object(number, bodies[number])
    xref = len(out)
    size = max(bodies) + 1
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode("ascii")
    for number in range(1, size):
        out += f"{offsets[number] + shift:010d} 00000 n \n".encode("ascii")
    info_ref = f" /Info {info} 0 R" if info is not None else ""
    trailer = f"<< /Size {size} /Root {root} 0 R{info_ref} {_trailer_id(file_id)} >>"
    out += f"trailer\n{trailer}\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
    return bytes(out)


def _linearized(
    bodies: dict[int, bytes], numbers: dict[str, int], *, info: int | None, file_id: bytes
) -> bytes:
    """Annex F's layout for one page: the linearization dictionary, the first-page
    cross-reference section and trailer, the first-page objects, the rest, the main
    cross-reference section; the last ``startxref`` names the first-page section."""
    lin = numbers["lin"]
    first = sorted(number for number in bodies if number > lin)
    rest = sorted(number for number in bodies if number < lin)
    placeholder = (
        f"<< /Linearized 1 /L {0:010d} /H [ {0:010d} {0:010d} ] /O {numbers['page:0']} "
        f"/E {0:010d} /N 1 /T {0:010d} >>"
    )
    out = bytearray(HEADER)
    offsets = {lin: len(out)}
    out += _object(lin, placeholder.encode("ascii"))
    first_xref = len(out)
    out += f"xref\n{lin} {len(first) + 1}\n".encode("ascii")
    entries_at = len(out)
    out += b" " * (20 * (len(first) + 1))
    info_ref = f" /Info {info} 0 R" if info is not None else ""
    out += (
        f"trailer\n<< /Size {max(bodies) + 1} /Root {numbers['catalog']} 0 R{info_ref} "
        f"{_trailer_id(file_id)} /Prev {0:010d} >>\nstartxref\n0\n%%EOF\n"
    ).encode("ascii")
    hint = (0, 0)
    for number in first:
        offsets[number] = len(out)
        out += _object(number, bodies[number])
        if number == numbers["hint"]:
            hint = (offsets[number], len(out) - offsets[number])
    end_of_first_page = len(out)
    for number in rest:
        offsets[number] = len(out)
        out += _object(number, bodies[number])
    main_xref = len(out)
    out += f"xref\n0 {lin}\n".encode("ascii")
    before_first_entry = len(out) - 1
    out += b"0000000000 65535 f \n"
    out += b"".join(f"{offsets[number]:010d} 00000 n \n".encode("ascii") for number in rest)
    out += f"trailer\n<< /Size {lin} >>\nstartxref\n{first_xref}\n%%EOF\n".encode("ascii")

    table = b"".join(
        f"{offsets[number]:010d} 00000 n \n".encode("ascii") for number in [lin, *first]
    )
    out[entries_at : entries_at + len(table)] = table
    filled = (
        f"<< /Linearized 1 /L {len(out):010d} /H [ {hint[0]:010d} {hint[1]:010d} ] "
        f"/O {numbers['page:0']} /E {end_of_first_page:010d} /N 1 /T {before_first_entry:010d} >>"
    ).encode("ascii")
    start = offsets[lin] + len(f"{lin} 0 obj\n")
    out[start : start + len(filled)] = filled
    prev_at = out.index(b"/Prev 0000000000", first_xref)
    out[prev_at : prev_at + 16] = f"/Prev {main_xref:010d}".encode("ascii")
    return bytes(out)


def _sign(data: bytes) -> bytes:
    """Fill the byte range: every byte of the file but the ``/Contents`` hex string."""
    at = data.index(_BYTE_RANGE_PLACEHOLDER)
    contents = data.index(b"/Contents <", at) + len(b"/Contents ")
    after = data.index(b">", contents) + 1
    filled = f"/ByteRange [0 {contents:010d} {after:010d} {len(data) - after:010d}]".encode("ascii")
    return data[:at] + filled + data[at + len(filled) :]


def write_pdf(pages: Sequence[Page], meta: PdfMeta) -> tuple[bytes, PdfTruth]:
    """Write ``pages`` as a PDF with our own writer and say what was written."""
    if meta.linearized and len(pages) != 1:
        raise ValueError("only a document of one page can be linearized")
    fonts = _fonts_of(pages)
    numbers = {role: index + 1 for index, role in enumerate(_roles(pages, meta, fonts))}
    bodies = _bodies(pages, meta, fonts, numbers)
    info = numbers.get("info")
    if meta.linearized:
        data = _linearized(bodies, numbers, info=info, file_id=meta.file_id)
    else:
        data = _classic(
            bodies, root=numbers["catalog"], info=info, file_id=meta.file_id, shift=meta.xref_shift
        )
    if meta.signed:
        data = _sign(data)
    truth = PdfTruth(
        revisions=1,
        linearized=meta.linearized,
        xref_repaired=meta.xref_shift != 0,
        eof_markers=data.count(b"%%EOF"),
        signatures=1 if meta.signed else 0,
        fonts=tuple(_BASE_FONT[font] for font in fonts),
        actions={"javascript": 1} if meta.open_action == "javascript" else {},
    )
    return data, truth


# --- rasters and photos -------------------------------------------------------------------------

PHOTO_SIZE: Final = (1500, 1950)
"""Every photo's size: a phone photo of a Letter or A4 page, cut down to about 3 MP."""

_DESK_TOP: Final[RGB] = (84, 70, 58)
_DESK_BOTTOM: Final[RGB] = (116, 96, 78)


@functools.lru_cache(maxsize=64)
def _pil_font(pixels: int) -> ImageFont.FreeTypeFont:
    loaded = ImageFont.load_default(size=pixels)
    assert isinstance(loaded, ImageFont.FreeTypeFont)  # noqa: S101 - Pillow wheels ship FreeType
    return loaded


# Pillow's bundled font (Aileron) has no accented letters, so a raster composes them: the base
# letter and its mark drawn from the font's own spacing marks, the inverted marks upside down.
# Anything else is refused rather than drawn as a missing-glyph box.

_MARK_GLYPHS: Final = {"\u0301": "\u00b4", "\u0300": "`", "\u0303": "~"}
"""Combining acute, grave and tilde, drawn with the font's spacing marks."""
_CIRCUMFLEX: Final = "\u0302"
"""Drawn as a small chevron: the font's caret is a full-size character."""
_DIAERESIS: Final = "\u0308"
_CEDILLA: Final = "\u0327"
_INVERTED: Final = {"\u00bf": "?", "\u00a1": "!"}
_MISSING: Final = "\uffff"

Piece = tuple[Literal["run", "composed", "inverted"], str, str]
"""``(kind, text, mark)``: a run of characters the font has, a base letter with its combining
mark, or a mark the font has, to draw upside down."""


def _glyph_ink(pixels: int, char: str) -> bytes:
    font = _pil_font(pixels)
    canvas = Image.new("L", (pixels * 3, pixels * 3))
    ImageDraw.Draw(canvas).text((pixels, 2 * pixels), char, font=font, fill=255, anchor="ls")
    return canvas.tobytes()


@functools.lru_cache(maxsize=8192)
def _has_glyph(pixels: int, char: str) -> bool:
    return _glyph_ink(pixels, char) != _glyph_ink(pixels, _MISSING)


@functools.lru_cache(maxsize=1024)
def _ink_box(pixels: int, char: str) -> tuple[int, int, int, int]:
    """The ink of ``char`` drawn at the origin's baseline: ``(left, top, right, bottom)``, in
    pixels from the origin (Pillow's ``getbbox`` gives the advance box, not the ink, for marks)."""
    canvas = np.frombuffer(_glyph_ink(pixels, char), dtype=np.uint8).reshape(3 * pixels, -1)
    rows = np.flatnonzero((canvas > 0).any(axis=1))
    cols = np.flatnonzero((canvas > 0).any(axis=0))
    return (
        int(cols.min()) - pixels,
        int(rows.min()) - 2 * pixels,
        int(cols.max()) + 1 - pixels,
        int(rows.max()) + 1 - 2 * pixels,
    )


def _pieces(text: str, pixels: int) -> list[Piece]:
    pieces: list[Piece] = []
    run = ""
    for char in text:
        if char != _MISSING and _has_glyph(pixels, char):
            run += char
            continue
        if run:
            pieces.append(("run", run, ""))
            run = ""
        if char in _INVERTED:
            pieces.append(("inverted", _INVERTED[char], ""))
            continue
        decomposed = unicodedata.normalize("NFD", char)
        base, marks = decomposed[0], decomposed[1:]
        drawable = marks in _MARK_GLYPHS or marks in (_CIRCUMFLEX, _DIAERESIS, _CEDILLA)
        if len(decomposed) != 2 or not drawable or not _has_glyph(pixels, base):  # noqa: PLR2004
            raise ValueError(f"the raster cannot draw {char!r}: no glyph and no known mark")
        pieces.append(("composed", base, marks))
    if run:
        pieces.append(("run", run, ""))
    return pieces


def _piece_width(font: ImageFont.FreeTypeFont, piece: Piece) -> float:
    return float(font.getlength(piece[1]))


def _draw_mark(
    draw: ImageDraw.ImageDraw,
    font: ImageFont.FreeTypeFont,
    at: tuple[float, float],
    piece: Piece,
    fill: RGB,
) -> None:
    """Draw a composed piece's mark on its base letter drawn at baseline ``at``: above the
    letter's ink, a cedilla below the baseline."""
    _, base, mark = piece
    x, y = at
    pixels = round(font.size)
    left, top, right, _ = _ink_box(pixels, base)
    if base == "i":  # drawn dotless (_draw_text): the mark sits on the stem
        top = _ink_box(pixels, "x")[1]
    centre, ink_top = x + (left + right) / 2, y + top
    gap = max(1.0, font.size * 0.08)
    if mark == _CIRCUMFLEX:
        half, height = max((right - left) * 0.32, font.size * 0.12), font.size * 0.16
        bottom = ink_top - gap
        points = [(centre - half, bottom), (centre, bottom - height), (centre + half, bottom)]
        draw.line(points, fill=fill, width=max(1, round(font.size * 0.07)), joint="curve")
        return
    if mark == _DIAERESIS:
        radius = max(1.0, font.size * 0.05)
        middle = ink_top - gap - radius
        for offset in (-0.22, 0.22):
            dot = centre + offset * (right - left)
            draw.ellipse((dot - radius, middle - radius, dot + radius, middle + radius), fill=fill)
        return
    glyph = "," if mark == _CEDILLA else _MARK_GLYPHS[mark]
    g_left, g_top, g_right, g_bottom = _ink_box(pixels, glyph)
    # A cedilla's ink starts just under the baseline; any other mark ends just above the letter.
    glyph_y = y + gap / 2 - g_top if mark == _CEDILLA else ink_top - gap - g_bottom
    draw.text((centre - (g_left + g_right) / 2, glyph_y), glyph, font=font, fill=fill, anchor="ls")


def _draw_dotless_i(
    image: Image.Image, pixels: int, at: tuple[float, float], fill: RGB, *, bold: bool
) -> None:
    """An ``i`` without its dot (the font has no dotless i): the glyph below the x-height."""
    canvas = np.frombuffer(_glyph_ink(pixels, "i"), dtype=np.uint8).reshape(3 * pixels, -1).copy()
    cut = 2 * pixels + _ink_box(pixels, "x")[1] - 1
    canvas[:cut] = 0
    mask = Image.fromarray(canvas, "L")
    if bold:  # as text drawn with a one-pixel stroke
        mask = mask.filter(ImageFilter.MaxFilter(3))
    x, y = at
    image.paste(Image.new("RGB", mask.size, fill), (round(x) - pixels, round(y) - 2 * pixels), mask)


def _draw_inverted(
    image: Image.Image, font: ImageFont.FreeTypeFont, at: tuple[float, float], mark: str, fill: RGB
) -> None:
    """Draw ``mark`` upside down from the x-height down below the baseline, as ¿ and ¡ sit."""
    x, y = at
    pixels = round(font.size)
    left, top, right, bottom = _ink_box(pixels, mark)
    glyph = Image.new("L", (right - left + 2, bottom - top + 2))
    ImageDraw.Draw(glyph).text((1 - left, 1 - top), mark, font=font, fill=255, anchor="ls")
    upside_down = glyph.rotate(180)
    x_height_top = _ink_box(pixels, "x")[1]
    position = (round(x + left - 1), round(y + x_height_top - 1))
    image.paste(Image.new("RGB", upside_down.size, fill), position, upside_down)


def _draw_text(image: Image.Image, item: Text, scale: float) -> None:
    pixels = max(6, round(item.size * scale))
    font = _pil_font(pixels)
    pieces = _pieces(item.text, pixels)
    width = sum(_piece_width(font, piece) for piece in pieces)
    x = item.x * scale - (width if item.align == "right" else 0.0)
    y = item.y * scale
    draw = ImageDraw.Draw(image)
    stroke = 1 if item.font == "Helvetica-Bold" else 0
    for piece in pieces:
        kind, text, _ = piece
        if kind == "inverted":
            _draw_inverted(image, font, (x, y), text, item.color)
        elif kind == "composed" and text == "i":
            _draw_dotless_i(image, pixels, (x, y), item.color, bold=stroke > 0)
            _draw_mark(draw, font, (x, y), piece, item.color)
        else:
            draw.text(
                (x, y),
                text,
                font=font,
                fill=item.color,
                anchor="ls",
                stroke_width=stroke,
                stroke_fill=item.color,
            )
            if kind == "composed":
                _draw_mark(draw, font, (x, y), piece, item.color)
        x += _piece_width(font, piece)


def raster(page: Page, dpi: int = 150) -> Image.Image:
    """The printed page at ``dpi``: every painted item, never an invisible line."""
    scale = dpi / 72
    image = Image.new("RGB", (round(page.width * scale), round(page.height * scale)), PAPER)
    draw = ImageDraw.Draw(image)
    for item in page.items:
        if isinstance(item, Box):
            box = (
                round(item.x * scale),
                round(item.y * scale),
                round((item.x + item.width) * scale) - 1,
                round((item.y + item.height) * scale) - 1,
            )
            width = max(1, round(item.line_width * scale)) if item.stroke is not None else 0
            draw.rectangle(box, fill=item.fill, outline=item.stroke, width=width)
        elif not item.invisible:
            _draw_text(image, item, scale)
    return image


@dataclass(frozen=True, slots=True)
class PhotoTruth:
    """What a photo shows and carries."""

    size: tuple[int, int]
    quad: tuple[tuple[float, float], ...]
    """The page's corners in the photo, clockwise from the top left."""
    jpeg_quality: int
    exif_datetime_original: datetime
    exif_software: str | None


Quad = tuple[tuple[float, float], ...]


def _page_quad(page_size: tuple[int, int], seed: int) -> Quad:
    """Where the page's corners land in the photo for ``seed``: centred with a margin, turned by
    up to 1.5 degrees, each corner nudged a little (the camera is not quite square to it)."""
    rng = np.random.default_rng(seed)
    width, height = PHOTO_SIZE
    page_w, page_h = page_size
    scale = min(width * 0.86 / page_w, height * 0.86 / page_h)
    centre = (
        width / 2 + rng.uniform(-0.015, 0.015) * width,
        height / 2 + rng.uniform(-0.015, 0.015) * height,
    )
    angle = math.radians(rng.uniform(-1.5, 1.5))
    cos, sin = math.cos(angle), math.sin(angle)
    corners = []
    for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x, y = dx * page_w * scale / 2, dy * page_h * scale / 2
        jitter = rng.uniform(-0.01, 0.01, size=2) * width
        corners.append(
            (
                float(centre[0] + x * cos - y * sin + jitter[0]),
                float(centre[1] + x * sin + y * cos + jitter[1]),
            )
        )
    return tuple(corners)


def _homography(source: Quad, target: Quad) -> tuple[float, ...]:
    """The 8 coefficients mapping each ``source`` point to its ``target`` (Pillow's PERSPECTIVE
    takes them from output to input)."""
    rows = []
    values = []
    for (x, y), (u, v) in zip(source, target, strict=True):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        values += [u, v]
    solved: NDArray[np.float64] = np.linalg.solve(np.array(rows), np.array(values))
    return tuple(float(value) for value in solved)


def _page_corners(size: tuple[int, int]) -> Quad:
    width, height = size
    return ((0.0, 0.0), (float(width), 0.0), (float(width), float(height)), (0.0, float(height)))


def _desk(rng: np.random.Generator) -> Image.Image:
    width, height = PHOTO_SIZE
    ramp = np.linspace(0.0, 1.0, height)[:, None, None]
    top, bottom = np.array(_DESK_TOP), np.array(_DESK_BOTTOM)
    pixels = np.broadcast_to(top + (bottom - top) * ramp, (height, width, 3)).copy()
    grain = rng.normal(0.0, 6.0, size=(height, -(-width // 8), 1)).repeat(8, axis=1)[:, :width]
    return Image.fromarray(np.clip(pixels + grain, 0, 255).astype(np.uint8), "RGB")


def _light(rng: np.random.Generator) -> NDArray[np.float64]:
    """A smooth light field from 0.86 to 1.0: brighter towards one side, darker at the corners."""
    width, height = PHOTO_SIZE
    yy, xx = np.mgrid[0:height, 0:width]
    nx, ny = xx / width - 0.5, yy / height - 0.5
    direction = rng.uniform(0, 2 * math.pi)
    side = nx * math.cos(direction) + ny * math.sin(direction)
    field = 1.0 - 0.05 * (side + 0.5) - 0.16 * (nx**2 + ny**2)
    clipped: NDArray[np.float64] = np.clip(field, 0.86, 1.0)[:, :, None]
    return clipped


def _exif(taken: datetime, software: str | None) -> Image.Exif:
    exif = Image.Exif()
    exif[271] = "OpenVerify"  # Make
    exif[272] = "Synthetic Camera"  # Model
    stamp = taken.strftime("%Y:%m:%d %H:%M:%S")
    exif[306] = stamp  # DateTime
    if software is not None:
        exif[305] = software  # Software
    sub = exif.get_ifd(0x8769)
    sub[36867] = stamp  # DateTimeOriginal
    sub[36868] = stamp  # DateTimeDigitized
    return exif


def photograph(
    page_image: Image.Image,
    *,
    seed: int,
    taken: datetime,
    software: str | None = None,
    quality: int = 88,
) -> tuple[bytes, PhotoTruth]:
    """A phone photo of the printed page: on a desk, slightly in perspective, unevenly lit, with
    sensor noise, saved once as a JPEG with camera EXIF (and ``software`` when an editor saved it).
    """
    rng = np.random.default_rng(seed)
    quad = _page_quad(page_image.size, seed)
    coefficients = _homography(quad, _page_corners(page_image.size))
    warped = page_image.convert("RGB").transform(
        PHOTO_SIZE, Image.Transform.PERSPECTIVE, coefficients, Image.Resampling.BICUBIC
    )
    mask = Image.new("L", page_image.size, 255).transform(
        PHOTO_SIZE, Image.Transform.PERSPECTIVE, coefficients, Image.Resampling.BILINEAR
    )
    desk_rng = np.random.default_rng(seed + 1)
    composed = Image.composite(warped, _desk(desk_rng), mask)
    pixels = np.asarray(composed).astype(np.float64) * _light(rng)
    pixels += rng.normal(0.0, 2.0, size=pixels.shape)
    photo = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGB")
    photo = photo.filter(ImageFilter.GaussianBlur(0.5))
    buffer = io.BytesIO()
    photo.save(buffer, format="JPEG", quality=quality, exif=_exif(taken, software))
    truth = PhotoTruth(
        size=PHOTO_SIZE,
        quad=quad,
        jpeg_quality=quality,
        exif_datetime_original=taken,
        exif_software=software,
    )
    return buffer.getvalue(), truth


def photo_region(
    page_image: Image.Image, box: tuple[float, float, float, float], *, seed: int
) -> tuple[int, int, int, int]:
    """Where ``box`` (``x, y, width, height`` in page pixels) lands in :func:`photograph`'s photo
    of ``page_image`` with ``seed``: a ``(left, top, right, bottom)`` pixel box."""
    quad = _page_quad(page_image.size, seed)
    a, b, c, d, e, f, g, h = _homography(_page_corners(page_image.size), quad)
    x, y, width, height = box
    points = []
    for px, py in ((x, y), (x + width, y), (x + width, y + height), (x, y + height)):
        scale = g * px + h * py + 1
        points.append(((a * px + b * py + c) / scale, (d * px + e * py + f) / scale))
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return (math.floor(min(xs)), math.floor(min(ys)), math.ceil(max(xs)), math.ceil(max(ys)))


# --- the main set (C65.2) -----------------------------------------------------------------------

DOCUMENT_CLASSES: Final = ("utility_bill", "bank_statement", "lease", "pay_stub", "tax_document")
"""The five proof-of-address classes (core ``DOCUMENT_TYPES``)."""

MAIN_LANGUAGES: Final = ("en", "es")

DOCUMENT_CHECKS: Final = (
    "document_type_detection",
    "document_extracted_properties_detection",
    "document_expired_detection",
    "document_recency_detection",
    "document_fabrication_detection",
    "document_name_comparison",
    "document_address_comparison",
)
"""The checks a sidecar's ``expect`` speaks for (C51.1)."""

SYNTHETIC_BANNER: Final = "OpenVerify synthetic test document"
"""Printed at the foot of every page OpenVerify generates, as the ID card prints its banner."""

EDITOR_PRODUCER: Final = "PDF-XChange Editor 10.4.2"
"""The producer an edited PDF's increment writes: a common desktop PDF editor."""

EDITOR_SOFTWARE: Final = "GIMP 2.10.38"
"""The EXIF Software of a photo an image editor saved."""

SIDECAR_SCHEMA_VERSION: Final = 1


@dataclass(frozen=True, slots=True)
class Fixture:
    """One generated file: where it goes (relative to its set's directory), its bytes and its
    JSON sidecar (what it is, what it shows, what C60.6 expects of it)."""

    path: str
    data: bytes
    sidecar: dict[str, Any]


# Formatting by language: English documents are US documents on Letter paper, Spanish ones are
# Spanish documents on A4. Issue dates print the month's name, so no reading is ambiguous.

_SPANISH_MONTHS: Final = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)


def long_date(when: date, language: str) -> str:
    """``October 11, 2026`` or ``11 de octubre de 2026``."""
    if language == "es":
        return f"{when.day} de {_SPANISH_MONTHS[when.month - 1]} de {when.year}"
    return f"{calendar.month_name[when.month]} {when.day}, {when.year}"


def short_date(when: date, language: str) -> str:
    """A table date: ``Oct 03`` or ``03/10/2026`` (day first, as Spain writes it)."""
    if language == "es":
        return when.strftime("%d/%m/%Y")
    return f"{calendar.month_abbr[when.month]} {when.day:02d}"


def money(cents: int, language: str, *, unit: bool = True) -> str:
    """``$1,250.00`` or ``1.250,00 EUR`` (the euro sign is not drawn: rasters use EUR)."""
    sign = "-" if cents < 0 else ""
    whole, part = divmod(abs(cents), 100)
    if language == "es":
        grouped = f"{whole:,}".replace(",", ".")
        return f"{sign}{grouped},{part:02d}" + (" EUR" if unit else "")
    return f"{sign}{'$' if unit else ''}{whole:,}.{part:02d}"


def _years_later(when: date, years: int) -> date:
    try:
        return when.replace(year=when.year + years)
    except ValueError:  # 29 February
        return when.replace(year=when.year + years, day=28)


# --- people, places and issuers (all invented) --------------------------------------------------


@dataclass(frozen=True, slots=True)
class Address:
    street_1: str
    city: str
    postal_code: str
    country_code: str
    street_2: str | None = None
    subdivision: str | None = None

    def lines(self) -> tuple[str, ...]:
        """The address as a letter prints it: US ``City, ST 00000``, elsewhere ``00000 City``."""
        if self.country_code == "US":
            tail = f"{self.city}, {self.subdivision} {self.postal_code}"
        else:
            tail = f"{self.postal_code} {self.city}"
        return (self.street_1, *([self.street_2] if self.street_2 else []), tail)

    def one_line(self) -> str:
        return ", ".join(self.lines())


@dataclass(frozen=True, slots=True)
class Person:
    given: str
    family: str
    address: Address

    @property
    def name(self) -> str:
        return f"{self.given} {self.family}"

    def inquiry_fields(self) -> dict[str, str]:
        """The inquiry fields an operator would prefill for this person (snake_case keys)."""
        fields = {
            "name_first": self.given,
            "name_last": self.family,
            "address_street_1": self.address.street_1,
            "address_city": self.address.city,
            "address_postal_code": self.address.postal_code,
            "address_country_code": self.address.country_code,
        }
        if self.address.street_2:
            fields["address_street_2"] = self.address.street_2
        if self.address.subdivision:
            fields["address_subdivision"] = self.address.subdivision
        return fields


@dataclass(frozen=True, slots=True)
class Issuer:
    name: str
    address: Address
    contact: str
    """A fictional telephone number: (555) 01x-xxxx in the US, 555 0xx xxx in Spain."""
    website: str
    """Always under the reserved ``.example`` top-level domain."""
    software: str
    """What the issuer's statement system writes as Creator and Producer."""


MERIDALE: Final = "Meridale"
VILLASERENA: Final = "Villaserena"

HOLDERS: Final = {
    "en": Person(
        "Nora", "Calderwood", Address("27 Harbour Road", MERIDALE, "00041", "US", None, "UT")
    ),
    "es": Person(
        "Inés", "Marlasca Ribó", Address("Calle del Puerto 27, 2B", VILLASERENA, "53027", "ES")
    ),
}
"""The main set's holders: English documents name the synthetic ID card's holder; postal codes
are unassigned (US ZIP codes 00001-00500, Spanish codes above 52xxx)."""

ISSUERS: Final = {
    ("en", "utility_bill"): Issuer(
        "Utopia Water Board",
        Address("400 Reservoir Way", MERIDALE, "00041", "US", None, "UT"),
        "(555) 010-0144",
        "utopiawater.example",
        "Utopia Billing 4.2",
    ),
    ("en", "bank_statement"): Issuer(
        "Utopia Savings Bank",
        Address("12 Lantern Square", MERIDALE, "00042", "US", None, "UT"),
        "(555) 010-0177",
        "utopiasavings.example",
        "Utopia Savings Statements 7.1",
    ),
    ("en", "pay_stub"): Issuer(
        "Utopia Lantern Works LLC",
        Address("200 Foundry Lane", MERIDALE, "00041", "US", None, "UT"),
        "(555) 010-0190",
        "utopialantern.example",
        "Utopia Payroll 3.0",
    ),
    ("en", "lease"): Issuer(
        "Meridale Harbour Homes LLC",
        Address("9 Quay Street", MERIDALE, "00041", "US", None, "UT"),
        "(555) 010-0123",
        "harbourhomes.example",
        "Harbour Homes Leasing 2.3",
    ),
    ("es", "utility_bill"): Issuer(
        "Aguas de Utopía, S.A.",
        Address("Avenida del Embalse 4", VILLASERENA, "53001", "ES"),
        "555 010 144",
        "aguasdeutopia.example",
        "Facturación Utopía 4.2",
    ),
    ("es", "bank_statement"): Issuer(
        "Banco de Utopía",
        Address("Plaza de los Faroles 12", VILLASERENA, "53001", "ES"),
        "555 010 177",
        "bancodeutopia.example",
        "Extractos Utopía 7.1",
    ),
    ("es", "pay_stub"): Issuer(
        "Faroles de Utopía, S.L.",
        Address("Calle de la Fundición 200", VILLASERENA, "53003", "ES"),
        "555 010 190",
        "farolesdeutopia.example",
        "Nóminas Utopía 3.0",
    ),
    ("es", "lease"): Issuer(
        "Inmobiliaria Villaserena, S.L.",
        Address("Calle del Muelle 9", VILLASERENA, "53001", "ES"),
        "555 010 123",
        "inmovillaserena.example",
        "Contratos Villaserena 2.3",
    ),
}
"""The issuers, all invented. A tax document comes from the holder's employer."""


def issuer_of(kind: str, language: str) -> Issuer:
    return ISSUERS[(language, "pay_stub" if kind == "tax_document" else kind)]


# --- page scaffolding ---------------------------------------------------------------------------

TABLE_HEAD: Final[RGB] = (228, 233, 241)
RULE: Final[RGB] = (150, 156, 168)

_LABELS: Final = {
    "en": {"page": "Page {n} of {m}", "contact": "Customer service"},
    "es": {"page": "Página {n} de {m}", "contact": "Atención al cliente"},
}


@dataclass(frozen=True, slots=True)
class Sheet:
    """Page geometry: Letter for English documents, A4 for Spanish ones."""

    width: float
    height: float
    left: float = 54.0

    @property
    def right(self) -> float:
        return self.width - self.left


SHEETS: Final = {"en": Sheet(*LETTER), "es": Sheet(*A4)}


def letterhead(issuer: Issuer, language: str) -> list[Item]:
    contact = _LABELS[language]["contact"]
    return [
        Text(54, 64, issuer.name.upper(), size=16, font="Helvetica-Bold", role="issuer"),
        Text(54, 79, issuer.address.one_line(), size=8, color=MUTED),
        Text(54, 90, f"{contact} {issuer.contact} · {issuer.website}", size=8, color=MUTED),
    ]


def addressee(person: Person, y: float = 150.0) -> list[Item]:
    """The window-envelope block: the holder's name and address, upper case."""
    lines = [person.name.upper(), *(line.upper() for line in person.address.lines())]
    roles = ["holder-name", *(["holder-address"] * (len(lines) - 1))]
    return [
        Text(54, y + 13 * index, line, size=10, role=role)
        for index, (line, role) in enumerate(zip(lines, roles, strict=True))
    ]


def footer(sheet: Sheet, language: str, number: int, count: int) -> list[Item]:
    page = _LABELS[language]["page"].format(n=number, m=count)
    return [
        Text(sheet.right, sheet.height - 40, page, size=8, align="right", color=MUTED),
        Text(54, sheet.height - 40, SYNTHETIC_BANNER, size=7, color=MUTED),
    ]


def table_head(sheet: Sheet, y: float, title: str) -> list[Item]:
    return [
        Box(sheet.left, y - 12, sheet.right - sheet.left, 17, fill=TABLE_HEAD),
        Text(sheet.left + 6, y, title, size=9.5, font="Helvetica-Bold"),
    ]


def amount_row(  # noqa: PLR0913 - one row: where, what, and how it prints
    sheet: Sheet,
    y: float,
    label: str,
    value: str,
    *,
    bold: bool = False,
    role: str | None = None,
) -> list[Item]:
    font: FontName = "Helvetica-Bold" if bold else "Helvetica"
    return [
        Text(sheet.left + 6, y, label, font=font),
        Text(sheet.right - 6, y, value, font=font, align="right", role=role),
    ]


def wrap(text: str, width: float, size: float = 10.0) -> list[str]:
    """Greedy line breaking of ``text`` to ``width`` points of Helvetica at ``size``."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if line and text_width(candidate, "Helvetica", size) > width:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines


@dataclass(frozen=True, slots=True)
class Built:
    """A laid-out document and the truth about what it prints."""

    kind: str
    language: str
    pages: tuple[Page, ...]
    holder: Person
    issuer: Issuer
    title: str
    printed_dates: dict[str, dict[str, str]]
    """Each printed date by role (``issue-date``, ``period-end``, ``lease-end``...): its ISO date
    and the text it is printed in."""
    expiration: date | None = None
    """The printed expiry (a lease's end); ``None`` when the class prints none."""


def _dated(dates: dict[str, dict[str, str]], role: str, when: date, text: str) -> None:
    dates[role] = {"date": when.isoformat(), "text": text}


def document_fields(built: Built) -> dict[str, str | None]:
    """C52.8's ``fields`` as the document prints them (the addressee block, upper case)."""
    holder = built.holder.address
    return {
        "name": built.holder.name.upper(),
        "address-street-1": holder.street_1.upper(),
        "address-street-2": holder.street_2.upper() if holder.street_2 else None,
        "address-city": holder.city.upper(),
        "address-subdivision": holder.subdivision,
        "address-postal-code": holder.postal_code,
        "address-country-code": holder.country_code,
        "issue-date": built.printed_dates["issue-date"]["date"],
        "issuer": built.issuer.name,
        "expiration-date": built.expiration.isoformat() if built.expiration else None,
    }


# --- the five classes (layout A, the main set) --------------------------------------------------
#
# Each builder takes the document's dates by name and returns the laid-out pages with the truth.
# Amounts are integer cents; every figure is invented and adds up.

Dates = dict[str, date]

_UTILITY_CHARGES: Final = {
    "en": (("Water supply charge", 3140), ("Wastewater charge", 1330), ("Service fee", 350)),
    "es": (
        ("Cuota de servicio", 980),
        ("Consumo de agua", 2135),
        ("Saneamiento", 814),
        ("IVA (10 %)", 393),
    ),
}


def utility_bill(language: str, dates: Dates) -> Built:
    sheet, holder, issuer = SHEETS[language], HOLDERS[language], issuer_of("utility_bill", language)
    issue, start, end, due = (
        dates[k] for k in ("issue-date", "period-start", "period-end", "due-date")
    )
    charges = _UTILITY_CHARGES[language]
    total = money(sum(cents for _, cents in charges), language)
    printed: dict[str, dict[str, str]] = {}
    if language == "es":
        labels = ("Factura de agua", "Fecha de emisión", "Número de factura", "Referencia")
        period = f"Periodo de facturación: del {short_date(start, 'es')} al {short_date(end, 'es')}"
        service = f"Dirección de suministro: {holder.address.one_line()}"
        meter = "Lectura anterior 10.412 · Lectura actual 10.430 · Consumo 18 m3"
        head, total_label = "Detalle de la factura", "Total a pagar"
        due_line = f"Fecha de cargo: {long_date(due, 'es')}"
        pay = f"Consulte su factura en {issuer.website}"
    else:
        labels = ("Water and sewer statement", "Statement date", "Bill number", "Account number")
        period = f"Billing period: {long_date(start, 'en')} to {long_date(end, 'en')}"
        service = f"Service address: {holder.address.one_line()}"
        meter = "Meter UWB-8841207 · Previous reading 10,412 · Current reading 10,430 · 18 kgal"
        head, total_label = "Charges", "Amount due"
        due_line = f"Due date: {long_date(due, 'en')}"
        pay = f"Pay online at {issuer.website}/pay or call {issuer.contact}."
    title, issue_label, number_label, account_label = labels
    issue_line = f"{issue_label}: {long_date(issue, language)}"
    _dated(printed, "issue-date", issue, issue_line)
    _dated(printed, "period-start", start, period)
    _dated(printed, "period-end", end, period)
    _dated(printed, "due-date", due, due_line)
    right = sheet.width / 2 + 40
    items: list[Item] = [
        *letterhead(issuer, language),
        Text(right, 64, title, size=11, font="Helvetica-Bold"),
        Text(right, 82, issue_line, role="issue-date"),
        Text(
            right, 95, f"{number_label}: {'AU' if language == 'es' else 'UWB'}-{issue.year}-0044710"
        ),
        Text(right, 108, f"{account_label}: 4471-2208-19"),
        *addressee(holder),
        Text(54, 214, service),
        Text(54, 228, period, role="period"),
        Text(54, 248, meter, size=9),
        *table_head(sheet, 278, head),
    ]
    y = 298.0
    for index, (label, cents) in enumerate(charges):
        role = "charge" if index == 0 else None
        items += amount_row(sheet, y, label, money(cents, language, unit=False), role=role)
        y += 16
    items += [Box(sheet.left, y - 8, sheet.right - sheet.left, 0.8, fill=RULE)]
    items += amount_row(sheet, y + 10, total_label, total, bold=True, role="amount")
    items += [
        Text(54, y + 36, due_line, role="due-date"),
        Text(54, y + 56, pay, size=9, color=MUTED),
        *footer(sheet, language, 1, 1),
    ]
    page = Page(sheet.width, sheet.height, tuple(items))
    name = "Factura de agua" if language == "es" else "Water statement"
    return Built("utility_bill", language, (page,), holder, issuer, name, printed)


_BANK_ROWS: Final = {
    "en": (
        (2, "Utopia Lantern Works payroll", 171000),
        (4, "Meridale Grocery", -8642),
        (6, "Utopia Water Board", -4820),
        (9, "Rent: Meridale Harbour Homes", -125000),
        (13, "Harbour Cafe", -1475),
        (16, "Utopia Lantern Works payroll", 171000),
        (20, "Meridale Transit card", -4000),
        (24, "Cash withdrawal, Lantern Square", -6000),
        (29, "Interest paid", 12),
    ),
    "es": (
        (1, "Nómina Faroles de Utopía", 162019),
        (3, "Alquiler Inmobiliaria Villaserena", -85000),
        (6, "Aguas de Utopía, recibo", -4322),
        (10, "Mercado del Puerto", -6315),
        (14, "Farmacia de la Plaza", -1240),
        (19, "Transferencia recibida", 30000),
        (23, "Cajero, Plaza de los Faroles", -5000),
        (27, "Comisión de mantenimiento", -300),
    ),
}


def _iban_es(bban: str) -> str:
    """A Spanish IBAN over ``bban`` with its ISO 13616 check digits (a synthetic bank code)."""
    digits = "".join(str(int(char, 36)) for char in f"{bban}ES00")
    check = 98 - int(digits) % 97
    raw = f"ES{check:02d}{bban}"
    return " ".join(raw[i : i + 4] for i in range(0, len(raw), 4))


def bank_statement(language: str, dates: Dates) -> Built:
    sheet, holder, issuer = (
        SHEETS[language],
        HOLDERS[language],
        issuer_of("bank_statement", language),
    )
    issue, start, end = (dates[k] for k in ("issue-date", "period-start", "period-end"))
    rows = _BANK_ROWS[language]
    opening = 214018 if language == "en" else 98544
    printed: dict[str, dict[str, str]] = {}
    if language == "es":
        title, issue_label = "Extracto de cuenta", "Fecha del extracto"
        account = f"IBAN: {_iban_es('99990001000000447302')}"
        period = f"Periodo: del {short_date(start, 'es')} al {short_date(end, 'es')}"
        columns = ("Fecha", "Concepto", "Importe", "Saldo")
        first, last = "Saldo anterior", "Saldo final"
    else:
        title, issue_label = "Statement of account", "Statement date"
        account = "Everyday Checking · Account number ****7302"
        period = f"Statement period: {long_date(start, 'en')} to {long_date(end, 'en')}"
        columns = ("Date", "Description", "Amount", "Balance")
        first, last = "Opening balance", "Closing balance"
    issue_line = f"{issue_label}: {long_date(issue, language)}"
    _dated(printed, "issue-date", issue, issue_line)
    _dated(printed, "period-start", start, period)
    _dated(printed, "period-end", end, period)
    right = sheet.width / 2 + 40
    items: list[Item] = [
        *letterhead(issuer, language),
        Text(right, 64, title, size=11, font="Helvetica-Bold"),
        Text(right, 82, issue_line, role="issue-date"),
        *addressee(holder),
        Text(54, 214, account, font="Helvetica-Bold"),
        Text(54, 228, period, role="period"),
        *table_head(sheet, 258, ""),
    ]
    x_date, x_text, x_amount, x_balance = 60.0, 130.0, sheet.right - 96, sheet.right - 6
    for x, label, align in zip(
        (x_date, x_text, x_amount, x_balance),
        columns,
        ("left", "left", "right", "right"),
        strict=True,
    ):
        items.append(Text(x, 258, label, size=9.5, font="Helvetica-Bold", align=align))  # type: ignore[arg-type]
    y, balance = 278.0, opening
    items += [
        Text(x_text, y, first),
        Text(x_balance, y, money(balance, language, unit=False), align="right"),
    ]
    for offset, description, cents in rows:
        y += 15
        balance += cents
        when = start + timedelta(days=offset)
        items += [
            Text(x_date, y, short_date(when, language), size=9),
            Text(x_text, y, description, size=9),
            Text(x_amount, y, money(cents, language, unit=False), size=9, align="right"),
            Text(x_balance, y, money(balance, language, unit=False), size=9, align="right"),
        ]
    y += 22
    items += [Box(sheet.left, y - 12, sheet.right - sheet.left, 0.8, fill=RULE)]
    items += amount_row(sheet, y + 4, last, money(balance, language), bold=True, role="amount")
    items += footer(sheet, language, 1, 1)
    page = Page(sheet.width, sheet.height, tuple(items))
    name = "Extracto de cuenta" if language == "es" else "Account statement"
    return Built("bank_statement", language, (page,), holder, issuer, name, printed)


_PAY_LINES: Final = {
    "en": (
        (("Regular", 171200), ("Overtime", 12840)),
        (
            ("Federal income tax", 18404),
            ("Social Security", 11410),
            ("Medicare", 2669),
            ("State income tax", 6441),
        ),
    ),
    "es": (
        (("Salario base", 185000), ("Complemento de puesto", 21000)),
        (
            ("Contingencias comunes (4,70 %)", 9682),
            ("Desempleo (1,55 %)", 3193),
            ("Formación profesional (0,10 %)", 206),
            ("IRPF (15,00 %)", 30900),
        ),
    ),
}


def pay_stub(language: str, dates: Dates) -> Built:
    sheet, holder, issuer = SHEETS[language], HOLDERS[language], issuer_of("pay_stub", language)
    issue, start, end = (dates[k] for k in ("issue-date", "period-start", "period-end"))
    earnings, deductions = _PAY_LINES[language]
    gross = sum(cents for _, cents in earnings)
    withheld = sum(cents for _, cents in deductions)
    printed: dict[str, dict[str, str]] = {}
    if language == "es":
        title, issue_label = "Nómina", "Fecha de pago"
        period = f"Periodo de liquidación: del {short_date(start, 'es')} al {short_date(end, 'es')}"
        heads = ("Devengos", "Deducciones")
        totals = ("Total devengado", "Total a deducir", "Líquido a percibir")
        reference = "Categoría: Técnica de mantenimiento · NIF del trabajador 00000000T"
    else:
        title, issue_label = "Earnings statement", "Pay date"
        period = f"Pay period: {long_date(start, 'en')} to {long_date(end, 'en')}"
        heads = ("Earnings", "Deductions")
        totals = ("Gross pay", "Total deductions", "Net pay")
        reference = "Employee ID E-10442 · Department: Lamp assembly"
    issue_line = f"{issue_label}: {long_date(issue, language)}"
    _dated(printed, "issue-date", issue, issue_line)
    _dated(printed, "period-start", start, period)
    _dated(printed, "period-end", end, period)
    right = sheet.width / 2 + 40
    items: list[Item] = [
        *letterhead(issuer, language),
        Text(right, 64, title, size=11, font="Helvetica-Bold"),
        Text(right, 82, issue_line, role="issue-date"),
        Text(right, 95, period, size=8.5, role="period"),
        *addressee(holder),
        Text(54, 214, reference, size=9),
        *table_head(sheet, 244, heads[0]),
    ]
    y = 264.0
    for label, cents in earnings:
        items += amount_row(sheet, y, label, money(cents, language, unit=False))
        y += 16
    items += amount_row(sheet, y, totals[0], money(gross, language, unit=False), bold=True)
    y += 30
    items += table_head(sheet, y, heads[1])
    y += 20
    for label, cents in deductions:
        items += amount_row(sheet, y, label, money(cents, language, unit=False))
        y += 16
    items += amount_row(sheet, y, totals[1], money(withheld, language, unit=False), bold=True)
    y += 26
    items += [Box(sheet.left, y - 12, sheet.right - sheet.left, 0.8, fill=RULE)]
    items += amount_row(
        sheet, y + 4, totals[2], money(gross - withheld, language), bold=True, role="amount"
    )
    items += footer(sheet, language, 1, 1)
    page = Page(sheet.width, sheet.height, tuple(items))
    name = "Nómina" if language == "es" else "Earnings statement"
    return Built("pay_stub", language, (page,), holder, issuer, name, printed)


_LEASE_CLAUSES: Final = {
    "en": (
        "2. Rent. The tenant pays {rent} each month, on or before the first day of the month.",
        "3. Security deposit. The tenant has paid a security deposit of {rent}, returned within "
        "30 days after the lease ends, less any lawful deductions.",
        "4. Use. The premises are a private home for the tenant and the tenant's household only.",
        "5. Utilities. The tenant pays for electricity, water and internet service.",
        "6. Repairs. The landlord keeps the roof, the plumbing and the heating in good repair; the "
        "tenant reports any damage promptly.",
        "7. Notice. Either party gives at least 60 days of written notice before the end of the "
        "term.",
        "8. Entire agreement. This agreement is the whole agreement between the landlord and the "
        "tenant, and changes to it are made in writing.",
    ),
    "es": (
        "SEGUNDA. Renta. La arrendataria paga {rent} al mes, dentro de los cinco primeros días de "
        "cada mes.",
        "TERCERA. Fianza. La arrendataria entrega una fianza de {rent}, que se devuelve al "
        "terminar el contrato, descontados los daños que hubiera.",
        "CUARTA. Uso. La vivienda se destina solo a residencia habitual de la arrendataria.",
        "QUINTA. Suministros. La arrendataria paga la luz, el agua y el acceso a internet.",
        "SEXTA. Conservación. La arrendadora conserva la vivienda en buen estado; la arrendataria "
        "avisa de cualquier daño sin demora.",
        "SÉPTIMA. Preaviso. Cualquiera de las partes avisa por escrito con al menos 60 días de "
        "antelación al final del plazo.",
        "OCTAVA. Acuerdo completo. Este contrato recoge todo lo acordado por las partes.",
    ),
}


def lease(language: str, dates: Dates) -> Built:
    sheet, holder, issuer = SHEETS[language], HOLDERS[language], issuer_of("lease", language)
    signed, start, end = (dates[k] for k in ("issue-date", "lease-start", "lease-end"))
    rent = money(125000 if language == "en" else 85000, language)
    printed: dict[str, dict[str, str]] = {}
    premises = ", ".join(line.upper() for line in holder.address.lines())
    if language == "es":
        title = "CONTRATO DE ARRENDAMIENTO DE VIVIENDA"
        issue_line = f"Fecha del contrato: {long_date(signed, 'es')}"
        parties = [
            f"En {VILLASERENA}, a {long_date(signed, 'es')}.",
            f"De una parte, como arrendadora, {issuer.name}, con domicilio en "
            f"{issuer.address.one_line()}.",
            f"De otra parte, como arrendataria, {holder.name.upper()}.",
            f"Vivienda: {premises}",
        ]
        term = (
            f"PRIMERA. Duración. El contrato comienza el {long_date(start, 'es')} y termina el "
            f"{long_date(end, 'es')}."
        )
        signatures = ("La arrendadora", "La arrendataria", "Fecha")
        signer = "Firma por la arrendadora: Ainhoa Berrocal, gestora."
    else:
        title = "RESIDENTIAL LEASE AGREEMENT"
        issue_line = f"Date of agreement: {long_date(signed, 'en')}"
        parties = [
            f"Landlord: {issuer.name}, {issuer.address.one_line()}",
            f"Tenant: {holder.name.upper()}",
            f"Premises: {premises}",
        ]
        term = (
            f"1. Term. The lease begins on {long_date(start, 'en')} and ends on "
            f"{long_date(end, 'en')}."
        )
        signatures = ("Landlord", "Tenant", "Date")
        signer = "Signed for the landlord by Arlo Penhallow, property manager."
    _dated(printed, "issue-date", signed, issue_line)
    _dated(printed, "lease-start", start, term)
    _dated(printed, "lease-end", end, term)
    width = sheet.right - sheet.left
    first: list[Item] = [
        Text(54, 72, title, size=14, font="Helvetica-Bold"),
        Text(54, 96, issue_line, role="issue-date"),
    ]
    y = 124.0
    for index, line in enumerate(parties):
        role = "holder-address" if index == len(parties) - 1 else None
        for part in wrap(line, width):
            first.append(Text(54, y, part, role=role))
            y += 14
        y += 4
    y += 10
    clauses = [term, *(clause.format(rent=rent) for clause in _LEASE_CLAUSES[language])]
    pages_items: list[list[Item]] = [first, []]
    page_index = 0
    for clause in clauses:
        lines = wrap(clause, width)
        if page_index == 0 and y + 14 * len(lines) > sheet.height - 120:
            page_index, y = 1, 72.0
        for line in lines:
            pages_items[page_index].append(
                Text(54, y, line, role="lease-term" if clause is term else None)
            )
            y += 14
        y += 8
    y = max(y + 30, sheet.height - 200)
    for label in signatures[:2]:
        pages_items[1] += [
            Text(54, y, f"{label}: ______________________________"),
            Text(sheet.right, y, f"{signatures[2]}: ______________", align="right"),
        ]
        y += 34
    pages_items[1].append(Text(54, y, signer, size=9, color=MUTED))
    pages = tuple(
        Page(sheet.width, sheet.height, (*items, *footer(sheet, language, number, 2)))
        for number, items in enumerate(pages_items, start=1)
    )
    name = "Contrato de arrendamiento" if language == "es" else "Lease agreement"
    return Built("lease", language, pages, holder, issuer, name, printed, expiration=end)


_W2_BOXES: Final = (
    (("1 Wages, tips, other compensation", 4821055), ("2 Federal income tax withheld", 512000)),
    (("3 Social security wages", 4821055), ("4 Social security tax withheld", 298905)),
    (("5 Medicare wages and tips", 4821055), ("6 Medicare tax withheld", 69905)),
    (("16 State wages, tips, etc.", 4821055), ("17 State income tax", 212126)),
)

_ES_CERTIFICATE: Final = (
    ("Retribuciones dinerarias", 2840000),
    ("Retenciones practicadas", 397600),
    ("Gastos deducibles (Seguridad Social)", 180340),
)


def tax_document(language: str, dates: Dates) -> Built:
    sheet, holder, issuer = SHEETS[language], HOLDERS[language], issuer_of("tax_document", language)
    issue = dates["issue-date"]
    tax_year = issue.year - 1
    printed: dict[str, dict[str, str]] = {}
    width = sheet.right - sheet.left
    if language == "es":
        issue_line = f"Fecha de expedición: {long_date(issue, 'es')}"
        items: list[Item] = [
            *letterhead(issuer, "es"),
            Text(
                54,
                120,
                "CERTIFICADO DE RETENCIONES E INGRESOS A CUENTA",
                size=12,
                font="Helvetica-Bold",
            ),
            Text(54, 135, "del Impuesto sobre la Renta de las Personas Físicas", size=10),
            Text(54, 152, f"Ejercicio {tax_year}", font="Helvetica-Bold", role="tax-year"),
            Text(54, 168, issue_line, role="issue-date"),
            Text(54, 184, f"Pagador: {issuer.name} (NIF B00000000)", size=9.5),
            *addressee(holder, y=210),
            Text(54, 262, "Perceptor: NIF 00000000T", size=9.5),
            *table_head(sheet, 292, "Rendimientos del trabajo"),
        ]
        y = 312.0
        for label, cents in _ES_CERTIFICATE:
            role = "amount" if cents == _ES_CERTIFICATE[0][1] else None
            items += amount_row(sheet, y, label, money(cents, "es"), role=role)
            y += 16
        y += 18
        for line in wrap(
            "El pagador certifica los datos anteriores a efectos de la declaración del impuesto.",
            width,
        ):
            items.append(Text(54, y, line, size=9))
            y += 13
        name = "Certificado de retenciones"
    else:
        issue_line = f"Date issued: {long_date(issue, 'en')}"
        items = [
            *letterhead(issuer, "en"),
            Text(54, 120, "Form W-2 Wage and Tax Statement", size=13, font="Helvetica-Bold"),
            Text(
                54,
                136,
                f"Tax year {tax_year} · Copy C, for the employee's records",
                role="tax-year",
            ),
            Text(54, 152, issue_line, role="issue-date"),
            Text(54, 168, "Employer identification number: 00-4417220", size=9.5),
            *addressee(holder, y=194),
        ]
        y, half = 252.0, width / 2
        for row in _W2_BOXES:
            for column, (label, cents) in enumerate(row):
                x = sheet.left + column * half
                role = "amount" if label.startswith("1 ") else None
                items += [
                    Box(x, y, half, 34, stroke=RULE),
                    Text(x + 5, y + 11, label, size=7.5, color=MUTED),
                    Text(
                        x + half - 6,
                        y + 27,
                        money(cents, "en", unit=False),
                        align="right",
                        role=role,
                    ),
                ]
            y += 34
        items += [
            Box(sheet.left, y, half, 34, stroke=RULE),
            Text(
                sheet.left + 5,
                y + 11,
                "15 State · Employer's state ID number",
                size=7.5,
                color=MUTED,
            ),
            Text(sheet.left + 6, y + 27, "UT 00-0004417"),
        ]
        name = "Form W-2"
    _dated(printed, "issue-date", issue, issue_line)
    items += footer(sheet, language, 1, 1)
    page = Page(sheet.width, sheet.height, tuple(items))
    return Built("tax_document", language, (page,), holder, issuer, name, printed)


BUILDERS: Final = {
    "utility_bill": utility_bill,
    "bank_statement": bank_statement,
    "pay_stub": pay_stub,
    "lease": lease,
    "tax_document": tax_document,
}


def default_dates(kind: str, language: str, as_of: date) -> Dates:
    """The dates a document of ``kind`` prints when it is current on ``as_of``."""
    day = timedelta(days=1)
    if kind == "utility_bill":
        issue = as_of - 12 * day
        return {
            "issue-date": issue,
            "period-start": issue - 90 * day,
            "period-end": issue - day,
            "due-date": issue + 21 * day,
        }
    if kind == "bank_statement":
        issue = as_of - 8 * day
        return {"issue-date": issue, "period-start": issue - 29 * day, "period-end": issue}
    if kind == "pay_stub":
        if language == "es":  # paid on the last day of the month before
            end = as_of.replace(day=1) - day
            return {"issue-date": end, "period-start": end.replace(day=1), "period-end": end}
        issue = as_of - 14 * day
        return {
            "issue-date": issue,
            "period-start": issue - 16 * day,
            "period-end": issue - 3 * day,
        }
    if kind == "lease":
        signed = as_of - 200 * day
        start = signed + 13 * day
        return {
            "issue-date": signed,
            "lease-start": start,
            "lease-end": _years_later(start, 1) - day,
        }
    # A tax document: issued at the end of January for the year before, the last one issued.
    year = as_of.year if as_of >= date(as_of.year, 1, 30) else as_of.year - 1
    return {"issue-date": date(year, 1, 30)}


# --- what a sidecar records ---------------------------------------------------------------------

CUES: Final[dict[str, tuple[str, str | None]]] = {  # the checks' FABRICATION_SIGNALS ids
    "incremental-revisions": ("weak", "pdf_incremental_update"),
    "xref-repaired": ("weak", "pdf_incremental_update"),
    "editor-producer": ("weak", "pdf_editor_producer"),
    "created-before-issue-date": ("weak", "pdf_created_before_issue_date"),
    "metadata-inconsistent": ("weak", "pdf_metadata_inconsistent"),
    "image-editor-software": ("weak", "image_editor_software"),
    "amount-line-font": ("medium", "pdf_font_inconsistent"),
    "text-layer-mismatch": ("medium", "pdf_text_layer_mismatch"),
    "double-compression-ela": ("medium", "image_tampered"),
    "hidden-text-over-field": ("strong", "pdf_hidden_text"),
    "edits-after-signature": ("strong", "pdf_signature_invalidated"),
    "active-content": ("strong", "pdf_active_content"),
    "copy-move": ("strong", "image_tampered"),
}
"""C60.6's fabrication cues a file can carry, named as the document checks name them
(``FABRICATION_SIGNALS`` in ``packages/checks``): their strength (weak at most 0.2 each and
capped at 0.45 together, medium 0.4-0.5, strong 0.6 or more) and the C51.2 reason each answers."""

LEASE_GRACE_DAYS: Final = 0
MAX_AGE_DAYS: Final = 90
TAX_DOCUMENT_MAX_AGE_DAYS: Final = 548
"""C51.3 and C60.6 defaults: no grace, 90 days, a tax document within 18 months."""


def _outcome(status: str | None, *reasons: str) -> dict[str, Any]:
    return {"status": status, "reasons": list(reasons)}


def fabrication_expectation(cues: Sequence[str]) -> dict[str, Any]:
    """What C60.6 decides from the cues alone: a strong cue fails (its weight alone is above the
    0.5 default), weak cues never do (capped at 0.45); a medium one depends on its strength."""
    strengths = {CUES[cue][0] for cue in cues}
    if "strong" in strengths:
        strong = sorted({CUES[cue][1] or "" for cue in cues if CUES[cue][0] == "strong"})
        return _outcome("failed", *strong)
    if "medium" in strengths:
        return _outcome(None)
    return _outcome("passed")


def expectations(
    built: Built, *, read_on: date, cues: Sequence[str], password_protected: bool = False
) -> dict[str, dict[str, Any]]:
    """C60.6 on ``read_on`` for a step that accepts the five classes, the default config (C51.3)
    and an inquiry prefilled with the holder's fields."""
    if password_protected:  # the cascade: one failed check, the rest wait on the type
        missing = {check: _outcome("not_applicable", "input_missing") for check in DOCUMENT_CHECKS}
        return {**missing, DOCUMENT_CHECKS[0]: _outcome("failed", "document_password_protected")}
    issue = date.fromisoformat(built.printed_dates["issue-date"]["date"])
    if built.kind == "lease":
        end = built.expiration
        assert end is not None  # noqa: S101 - a lease always prints its end
        expired = (
            _outcome("passed")
            if end >= read_on - timedelta(days=LEASE_GRACE_DAYS)
            else _outcome("failed", "document_expired")
        )
    else:
        expired = _outcome("not_applicable", "feature_absent")
    age = (read_on - issue).days
    if issue > read_on + timedelta(days=1):
        recency = _outcome("not_applicable", "input_missing")
    elif built.kind == "lease":
        start = date.fromisoformat(built.printed_dates["lease-start"]["date"])
        end = date.fromisoformat(built.printed_dates["lease-end"]["date"])
        recency = (
            _outcome("passed")
            if start <= read_on <= end
            else _outcome("not_applicable", "input_missing")
        )
    elif built.kind == "tax_document":
        recency = (
            _outcome("passed")
            if age <= TAX_DOCUMENT_MAX_AGE_DAYS
            else _outcome("failed", "document_too_old")
        )
    else:
        recency = (
            _outcome("passed") if age <= MAX_AGE_DAYS else _outcome("failed", "document_too_old")
        )
    return {
        "document_type_detection": _outcome("passed"),
        "document_extracted_properties_detection": _outcome("passed"),
        "document_expired_detection": expired,
        "document_recency_detection": recency,
        "document_fabrication_detection": fabrication_expectation(cues),
        "document_name_comparison": _outcome("passed"),
        "document_address_comparison": _outcome("passed"),
    }


def _iso(when: datetime | None) -> str | None:
    return None if when is None else xmp_date(when)


def pdf_record(meta: PdfMeta, truth: PdfTruth) -> dict[str, Any]:
    """The sidecar's ``pdf``: what the writer wrote, in C60.1's terms (C60.1 counts revisions
    without a linearized file's first-page section)."""
    xmp = meta.xmp
    return {
        "producer": meta.producer,
        "creator": meta.creator,
        "creation_date": _iso(meta.created),
        "modification_date": _iso(meta.modified),
        "xmp": None
        if xmp is None
        else {
            "creator_tool": xmp.creator_tool,
            "producer": xmp.producer,
            "create_date": _iso(xmp.create_date),
            "modify_date": _iso(xmp.modify_date),
            "metadata_date": _iso(xmp.metadata_date),
            "document_id": xmp.document_id,
            "instance_id": xmp.instance_id,
            "history_agents": list(xmp.history_agents),
        },
        "linearized": truth.linearized,
        "revisions": truth.revisions,
        "xref_repaired": truth.xref_repaired,
        "eof_markers": truth.eof_markers,
        "signatures": truth.signatures,
        "edits_after_signature": False,
        "fonts": list(truth.fonts),
        "actions": dict(truth.actions),
        "encryption": "none",
    }


def image_record(photo: PhotoTruth, **extra: Any) -> dict[str, Any]:
    """The sidecar's ``image``: what the photo carries."""
    record: dict[str, Any] = {
        "jpeg_quality": photo.jpeg_quality,
        "exif_software": photo.exif_software,
        "exif_datetime_original": _iso(photo.exif_datetime_original),
        "double_compressed": False,
        "quad": [[round(x, 2), round(y, 2)] for x, y in photo.quad],
        "edited_region": None,
        "copy_move": None,
    }
    record.update(extra)
    return record


@dataclass(frozen=True, slots=True)
class Made:
    """A file before its sidecar: its bytes and the facts only its maker knows."""

    data: bytes
    form: str
    pdf: dict[str, Any] | None = None
    image: dict[str, Any] | None = None
    cues: tuple[str, ...] = ()
    hidden: tuple[dict[str, Any], ...] = ()
    differs: tuple[dict[str, Any], ...] = ()
    pages: int = 1


def sidecar(  # noqa: PLR0913 - every part of the record
    path: str,
    made: Made,
    built: Built,
    *,
    group: str,
    variant: str,
    description: str,
    as_of: date,
    read_on: date,
    password_protected: bool = False,
) -> dict[str, Any]:
    media_type = "image/jpeg" if path.endswith(".jpg") else "application/pdf"
    return {
        "schema_version": SIDECAR_SCHEMA_VERSION,
        "file": path,
        "media_type": media_type,
        "sha256": hashlib.sha256(made.data).hexdigest(),
        "set": "main",
        "group": group,
        "variant": variant,
        "class": built.kind,
        "language": built.language,
        "form": made.form,
        "description": description,
        "as_of": as_of.isoformat(),
        "read_on": read_on.isoformat(),
        "pages": made.pages,
        "issuer": built.issuer.name,
        "holder": {
            "name": built.holder.name.upper(),
            "address": [line.upper() for line in built.holder.address.lines()],
        },
        "inquiry_fields": built.holder.inquiry_fields(),
        "fields": document_fields(built),
        "printed_dates": built.printed_dates,
        "hidden_text": list(made.hidden),
        "text_layer_differs": list(made.differs),
        "cues": [
            {"cue": cue, "strength": CUES[cue][0], "reason": CUES[cue][1]} for cue in made.cues
        ],
        "pdf": made.pdf,
        "image": made.image,
        "expect": expectations(
            built, read_on=read_on, cues=made.cues, password_protected=password_protected
        ),
    }


# --- making the files ---------------------------------------------------------------------------


def _seed(path: str) -> int:
    return int.from_bytes(hashlib.sha256(path.encode("utf-8")).digest()[:4], "big")


def _morning(day: date) -> datetime:
    return datetime.combine(day, time(6, 0), UTC)


def document_meta(
    built: Built, path: str, *, created: datetime | None = None, **overrides: Any
) -> PdfMeta:
    """The metadata a genuine issuer's system writes: Info and XMP agree, the document and
    instance ids are equal (a file never saved again), created on the morning of its date."""
    when = created or _morning(date.fromisoformat(built.printed_dates["issue-date"]["date"]))
    software = built.issuer.software
    document_id = deterministic_uuid(path)
    xmp = Xmp(
        creator_tool=software,
        producer=software,
        create_date=when,
        modify_date=when,
        metadata_date=when,
        document_id=document_id,
        instance_id=document_id,
        history_agents=(software,),
    )
    values: dict[str, Any] = {
        "file_id": hashlib.sha256(f"file-id:{path}".encode()).digest()[:16],
        "producer": software,
        "creator": software,
        "title": built.title,
        "created": when,
        "modified": when,
        "xmp": xmp,
    }
    values.update(overrides)
    return PdfMeta(**values)


def make_pdf(built: Built, meta: PdfMeta) -> tuple[bytes, Made]:
    data, truth = write_pdf(built.pages, meta)
    return data, Made(data, "pdf", pdf=pdf_record(meta, truth), pages=len(built.pages))


def make_photo(built: Built, path: str, as_of: date, *, software: str | None = None) -> Made:
    taken = datetime.combine(as_of - timedelta(days=1), time(10, 15), UTC)
    data, truth = photograph(
        raster(built.pages[0]), seed=_seed(path), taken=taken, software=software
    )
    return Made(data, "photo", image=image_record(truth), pages=1)


def resources_of(built: Built) -> dict[FontName, str]:
    """The font resource names :func:`write_pdf` gave ``built``."""
    return {font: f"F{index + 1}" for index, font in enumerate(_fonts_of(built.pages))}


def with_amount(
    built: Built, value: str, *, font: FontName | None = None, role: str = "amount"
) -> Built:
    """``built`` with the first line of ``role`` on page 1 printing ``value`` (in ``font``)."""
    first, *rest = built.pages
    items = list(first.items)
    index = next(i for i, item in enumerate(items) if isinstance(item, Text) and item.role == role)
    old = items[index]
    assert isinstance(old, Text)  # noqa: S101 - found by its role
    items[index] = replace(old, text=value, font=font or old.font)
    return replace(built, pages=(replace(first, items=tuple(items)), *rest))


def amount_of(built: Built, role: str = "amount") -> Text:
    """The first line of ``role`` on page 1 (the amount due, a charge...)."""
    return next(
        item for item in built.pages[0].items if isinstance(item, Text) and item.role == role
    )


def increment(original: bytes, edit: Callable[[PdfWriter], None]) -> bytes:
    """An incremental update of ``original``: the edit's objects appended after its bytes."""
    writer = PdfWriter(io.BytesIO(original), incremental=True)
    edit(writer)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _stream(data: bytes) -> StreamObject:
    stream = StreamObject()
    stream.set_data(data)
    return stream


def _editor_metadata(writer: PdfWriter, when: datetime) -> None:
    writer.add_metadata({"/Producer": EDITOR_PRODUCER, "/ModDate": pdf_date(when)})


def edit_content(
    page_content: bytes, *, modified: datetime, extra_font: FontName | None = None
) -> Callable[[PdfWriter], None]:
    """An editor's save: page 1's content replaced, its producer and date stamped; a font the
    editor brought is added to the page's resources."""

    def edit(writer: PdfWriter) -> None:
        page = writer.pages[0]
        if extra_font is not None:
            font = DictionaryObject(
                {
                    NameObject("/Type"): NameObject("/Font"),
                    NameObject("/Subtype"): NameObject("/Type1"),
                    NameObject("/BaseFont"): NameObject(f"/{_BASE_FONT[extra_font]}"),
                    NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
                }
            )
            fonts = page["/Resources"]["/Font"]  # type: ignore[index]
            fonts[NameObject(f"/{EXTRA_FONT_RESOURCE}")] = writer._add_object(font)
        page.replace_contents(_stream(page_content).flate_encode())
        _editor_metadata(writer, modified)

    return edit


EXTRA_FONT_RESOURCE: Final = "F9"


def add_dss(writer: PdfWriter) -> None:
    """A PAdES long-term-validation extension: a Document Security Store on the catalogue (its
    certificate, CRL and OCSP entries are placeholders: an empty DER sequence each)."""
    placeholder = bytes.fromhex("3000")
    certs = ArrayObject([writer._add_object(_stream(placeholder))])
    crls = ArrayObject([writer._add_object(_stream(placeholder))])
    dss = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/DSS"),
            NameObject("/Certs"): certs,
            NameObject("/CRLs"): crls,
            NameObject("/OCSPs"): ArrayObject(),
        }
    )
    writer.root_object[NameObject("/DSS")] = writer._add_object(dss)


FIXTURE_USER_PASSWORD: Final = "utopia-bill"  # noqa: S105 - a synthetic fixture's password
FIXTURE_OWNER_PASSWORD: Final = "utopia-owner"  # noqa: S105 - likewise
"""The passwords of the protected bills: test data, recorded in their sidecars' descriptions."""


def encrypt(original: bytes, *, user_password: str, owner_password: str) -> bytes:
    """``original`` encrypted with RC4-128 (pypdf needs no crypto library for it)."""
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(original)))
    writer.encrypt(user_password=user_password, owner_password=owner_password, algorithm="RC4-128")
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def scanned_pdf(page: Page, scanned: datetime) -> bytes:
    """A scan: the printed page as one JPEG in a PDF, written by Pillow's PDF driver, which dates
    it (``scanned``, else the clock) and names no producer."""
    stamp = scanned.astimezone(UTC).timetuple()
    buffer = io.BytesIO()
    raster(page, dpi=150).save(
        buffer, format="PDF", resolution=150.0, creationDate=stamp, modDate=stamp
    )
    return buffer.getvalue()


# --- photo edits --------------------------------------------------------------------------------

RASTER_DPI: Final = 150


def _char_boxes(item: Text) -> list[tuple[float, float, float, float]]:
    """Each character's box ``(x, y, width, height)`` in raster pixels at :data:`RASTER_DPI`."""
    scale = RASTER_DPI / 72
    pixels = max(6, round(item.size * scale))
    font = _pil_font(pixels)
    total = float(font.getlength(item.text))
    left = item.x * scale - (total if item.align == "right" else 0.0)
    top = item.y * scale + _ink_box(pixels, "8")[1] - 2
    height = -_ink_box(pixels, "8")[1] + 4
    boxes = []
    for index, char in enumerate(item.text):
        start = left + float(font.getlength(item.text[:index]))
        boxes.append((start, top, float(font.getlength(char)), float(height)))
    return boxes


def _text_box(item: Text) -> tuple[float, float, float, float]:
    boxes = _char_boxes(item)
    x, y, _, height = boxes[0]
    last_x, _, last_width, _ = boxes[-1]
    return (x, y, last_x + last_width - x, height)


def _camera_jpeg(image: Image.Image, taken: datetime, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, exif=_exif(taken, None))
    return buffer.getvalue()


def _taken(as_of: date) -> datetime:
    return datetime.combine(as_of - timedelta(days=1), time(10, 15), UTC)


ELA_QUALITY: Final = 93
"""An editor's export quality: the edited photo is compressed twice, at 88 and then 93."""


def ela_edit(built: Built, genuine: Made, genuine_path: str, value: str, as_of: date) -> Made:
    """The amount repainted in the genuine photo and the photo saved again: the new text has no
    first compression, the rest has two (double JPEG with an ELA difference, C60.6)."""
    page = raster(built.pages[0])
    left, top, right, bottom = photo_region(
        page, _text_box(amount_of(built)), seed=_seed(genuine_path)
    )
    left, top, right, bottom = left - 6, top - 4, right + 6, bottom + 4
    with Image.open(io.BytesIO(genuine.data)) as opened:
        photo = opened.convert("RGB")
    pixels = np.asarray(photo).copy()
    border = np.concatenate(
        [
            pixels[top, left:right],
            pixels[bottom, left:right],
            pixels[top:bottom, left],
            pixels[top:bottom, right],
        ]
    )
    pixels[top:bottom, left:right] = np.median(border, axis=0).astype(np.uint8)
    edited = Image.fromarray(pixels, "RGB")
    item = amount_of(built)
    scale = (right - left) / (_text_box(item)[2] + 12)
    size = max(6, round(item.size * RASTER_DPI / 72 * scale))
    ImageDraw.Draw(edited).text(
        (right - 6, bottom - 4 - round(size * 0.18)),
        value,
        font=_pil_font(size),
        fill=(38, 40, 46),
        anchor="rs",
        stroke_width=1,
        stroke_fill=(38, 40, 46),
    )
    data = _camera_jpeg(edited, _taken(as_of), ELA_QUALITY)
    image = dict(genuine.image or {})
    image.update(
        {
            "jpeg_quality": ELA_QUALITY,
            "double_compressed": True,
            "edited_region": [left, top, right, bottom],
        }
    )
    return Made(data, "photo", image=image, cues=("double-compression-ela",))


def copy_move_edit(built: Built, genuine: Made, genuine_path: str, as_of: date) -> Made:
    """A digit of the amount copied over another digit of it, then the photo saved again."""
    page = raster(built.pages[0])
    item = amount_of(built)
    boxes = _char_boxes(item)
    source_index, target_index = item.text.index("8"), item.text.index("4")
    seed = _seed(genuine_path)
    source = photo_region(page, boxes[source_index], seed=seed)
    target = photo_region(page, boxes[target_index], seed=seed)
    width = min(source[2] - source[0], target[2] - target[0])
    height = min(source[3] - source[1], target[3] - target[1])
    with Image.open(io.BytesIO(genuine.data)) as opened:
        pixels = np.asarray(opened.convert("RGB")).copy()
    patch = pixels[source[1] : source[1] + height, source[0] : source[0] + width].copy()
    pixels[target[1] : target[1] + height, target[0] : target[0] + width] = patch
    data = _camera_jpeg(
        Image.fromarray(pixels, "RGB"),
        _taken(as_of),
        genuine.image["jpeg_quality"] if genuine.image else 88,
    )
    copied = [
        [source[0], source[1], source[0] + width, source[1] + height],
        [target[0], target[1], target[0] + width, target[1] + height],
    ]
    image = dict(genuine.image or {})
    image.update({"double_compressed": True, "copy_move": copied})
    return Made(data, "photo", image=image, cues=("copy-move", "double-compression-ela"))


# --- the main set -------------------------------------------------------------------------------


def kebab(name: str) -> str:
    return name.replace("_", "-")


def main_set(as_of: date) -> list[Fixture]:  # noqa: PLR0915 - one statement per variant
    """C65.2: every class in English and Spanish as a born-digital PDF and a photo; the date
    cases; the password cases; every edited and genuine variant."""
    day = timedelta(days=1)
    fixtures: list[Fixture] = []

    def add(  # noqa: PLR0913 - the record's parts
        path: str,
        made: Made,
        built: Built,
        group: str,
        description: str,
        *,
        read_on: date = as_of,
        password_protected: bool = False,
    ) -> None:
        variant = path.rsplit("/", 1)[1].rsplit(".", 1)[0]
        record = sidecar(
            path,
            made,
            built,
            group=group,
            variant=variant,
            description=description,
            as_of=as_of,
            read_on=read_on,
            password_protected=password_protected,
        )
        fixtures.append(Fixture(path, made.data, record))

    built_by: dict[tuple[str, str], Built] = {}
    made_by: dict[str, Made] = {}
    for kind in DOCUMENT_CLASSES:
        for language in MAIN_LANGUAGES:
            built = BUILDERS[kind](language, default_dates(kind, language, as_of))
            built_by[(kind, language)] = built
            base = f"{language}/{kebab(kind)}"
            _, made = make_pdf(built, document_meta(built, f"{base}/happy.pdf"))
            photo = make_photo(built, f"{base}/happy-photo.jpg", as_of)
            made_by[f"{base}/happy.pdf"], made_by[f"{base}/happy-photo.jpg"] = made, photo
            add(f"{base}/happy.pdf", made, built, "happy", "A current document, born digital.")
            add(f"{base}/happy-photo.jpg", photo, built, "happy", "A phone photo of the same page.")

    # --- the date cases (C60.6, V13) -----------------------------------------------------------
    old = utility_bill("en", default_dates("utility_bill", "en", as_of - 188 * day))
    path = "en/utility-bill/too-old.pdf"
    add(
        path,
        make_pdf(old, document_meta(old, path))[1],
        old,
        "date-case",
        "A bill printed 200 days ago.",
    )
    path = "en/utility-bill/too-old-photo.jpg"
    add(path, make_photo(old, path, as_of), old, "date-case", "A photo of the 200-day-old bill.")

    future = utility_bill("en", default_dates("utility_bill", "en", as_of + 42 * day))
    path = "en/utility-bill/future-dated.pdf"
    _, made = make_pdf(future, document_meta(future, path, created=_morning(as_of - day)))
    made = replace(made, cues=("created-before-issue-date",))
    add(
        path,
        made,
        future,
        "date-case",
        "A bill whose printed date is 30 days ahead (made yesterday).",
    )

    signed = _years_later(as_of, -3)
    start = signed + 13 * day
    in_term = lease(
        "en",
        {"issue-date": signed, "lease-start": start, "lease-end": _years_later(start, 5) - day},
    )
    path = "en/lease/lease-in-term-signed-long-ago.pdf"
    add(
        path,
        make_pdf(in_term, document_meta(in_term, path))[1],
        in_term,
        "date-case",
        "A five-year lease signed three years ago.",
    )
    ended = lease(
        "en",
        {"issue-date": signed, "lease-start": start, "lease-end": _years_later(start, 2) - day},
    )
    path = "en/lease/lease-ended.pdf"
    add(
        path,
        make_pdf(ended, document_meta(ended, path))[1],
        ended,
        "date-case",
        "A two-year lease that ended about a year ago.",
    )

    w2 = tax_document("en", {"issue-date": date(as_of.year, 1, 30)})
    path = "en/tax-document/w2-january-read-october.pdf"
    add(
        path,
        make_pdf(w2, document_meta(w2, path))[1],
        w2,
        "date-case",
        "A W-2 issued at the end of January, read in October: older than 90 days, inside 18 "
        "months.",
        read_on=date(as_of.year, 10, 15),
    )

    # --- the password cases (decision 17) -----------------------------------------------------
    bill = built_by[("utility_bill", "en")]
    bill_made = made_by["en/utility-bill/happy.pdf"]
    bill_record = bill_made.pdf or {}
    protected = encrypt(
        bill_made.data, user_password=FIXTURE_USER_PASSWORD, owner_password=FIXTURE_OWNER_PASSWORD
    )
    add(
        "en/utility-bill/password-protected.pdf",
        Made(protected, "pdf", pdf={**bill_record, "encryption": "user-password"}),
        bill,
        "protected",
        "The bill encrypted with a user password (RC4, 128 bits): it cannot be opened.",
        password_protected=True,
    )
    owner_only = encrypt(bill_made.data, user_password="", owner_password=FIXTURE_OWNER_PASSWORD)
    add(
        "en/utility-bill/owner-password-only.pdf",
        Made(owner_only, "pdf", pdf={**bill_record, "encryption": "owner-password"}),
        bill,
        "protected",
        "The bill encrypted with an owner password only: it opens without one.",
    )

    # --- edited variants -----------------------------------------------------------------------
    edited_at = _morning(as_of - 2 * day)
    editor = {
        "producer": EDITOR_PRODUCER,
        "modification_date": xmp_date(edited_at),
        "revisions": 2,
        "eof_markers": 2,
    }
    editor_cues = ("incremental-revisions", "editor-producer", "metadata-inconsistent")
    resources = resources_of(bill)

    raised = with_amount(bill, "$148.20")
    data = increment(
        bill_made.data, edit_content(content_stream(raised.pages[0], resources), modified=edited_at)
    )
    add(
        "en/utility-bill/edited-amount-increment.pdf",
        Made(data, "pdf", pdf={**bill_record, **editor}, cues=editor_cues),
        raised,
        "edited",
        "The amount due raised by a PDF editor's incremental update; the XMP still names the "
        "issuer.",
    )

    swapped = with_amount(bill, "$18.20", font="Times-Roman")
    content = content_stream(swapped.pages[0], {**resources, "Times-Roman": EXTRA_FONT_RESOURCE})
    data = increment(
        bill_made.data, edit_content(content, modified=edited_at, extra_font="Times-Roman")
    )
    fonts = [*bill_record.get("fonts", []), "Times-Roman"]
    add(
        "en/utility-bill/edited-font-swap.pdf",
        Made(
            data,
            "pdf",
            pdf={**bill_record, **editor, "fonts": fonts},
            cues=(*editor_cues, "amount-line-font"),
        ),
        swapped,
        "edited",
        "The amount rewritten in Times-Roman inside the Helvetica amount line.",
    )

    item = amount_of(bill)
    cover = Box(
        text_left(item) - 6,
        item.y - item.size * 1.05,
        text_width(item.text, item.font, item.size) + 12,
        item.size * 1.45,
        fill=WHITE,
    )
    overlay = Page(bill.pages[0].width, bill.pages[0].height, (cover, replace(item, text="$18.20")))
    content = content_stream(bill.pages[0], resources) + content_stream(overlay, resources)
    data = increment(bill_made.data, edit_content(content, modified=edited_at))
    add(
        "en/utility-bill/edited-covered-amount.pdf",
        Made(
            data,
            "pdf",
            pdf={**bill_record, **editor},
            cues=(*editor_cues, "hidden-text-over-field"),
            hidden=({"page": 1, "text": item.text, "reason": "covered"},),
        ),
        with_amount(bill, "$18.20"),
        "edited",
        "A white box drawn over the amount due and a new amount written on it: the old amount "
        "stays in the text layer.",
    )

    issue_line = next(
        i for i in old.pages[0].items if isinstance(i, Text) and i.role == "issue-date"
    )
    recent = f"Statement date: {long_date(as_of - 10 * day, 'en')}"
    hidden_line = replace(issue_line, text=recent, invisible=True, role=None)
    items = list(old.pages[0].items)
    items.insert(items.index(issue_line) + 1, hidden_line)
    stale = replace(old, pages=(replace(old.pages[0], items=tuple(items)),))
    path = "en/utility-bill/edited-invisible-recent-date.pdf"
    _, made = make_pdf(stale, document_meta(stale, path))
    add(
        path,
        replace(
            made,
            cues=("hidden-text-over-field",),
            hidden=({"page": 1, "text": recent, "reason": "render_mode_invisible"},),
        ),
        stale,
        "edited",
        "The 200-day-old bill with a recent statement date in invisible text over the printed one: "
        "recency must read the visible date only.",
    )

    charge = amount_of(bill, "charge")
    remapped = with_amount(bill, charge.text, font="Helvetica-Remapped", role="charge")
    path = "en/utility-bill/edited-text-layer-mismatch.pdf"
    _, made = make_pdf(remapped, document_meta(remapped, path))
    extracted = "".join(REMAPPED_DIGITS.get(char, char) for char in charge.text)
    add(
        path,
        replace(
            made,
            cues=("text-layer-mismatch",),
            differs=({"page": 1, "painted": charge.text, "extracted": extracted},),
        ),
        remapped,
        "edited",
        "A charge whose font maps its glyphs to other digits: the text layer reads "
        f"{extracted} where the page shows {charge.text} (a second Helvetica resource).",
    )

    issue = date.fromisoformat(bill.printed_dates["issue-date"]["date"])
    single: tuple[tuple[str, dict[str, Any], tuple[str, ...], str], ...] = (
        (
            "edited-created-before-issue",
            {"created": _morning(issue - 60 * day)},
            ("created-before-issue-date",),
            "Info and XMP say the file was made 60 days before the date it prints.",
        ),
        (
            "edited-metadata-inconsistent",
            {"producer": "Statement Composer 2.1", "creator": "Statement Composer 2.1"},
            ("metadata-inconsistent",),
            "The Info dictionary names another producer than the XMP packet.",
        ),
        (
            "edited-active-content",
            {"open_action": "javascript"},
            ("active-content",),
            "JavaScript runs when the file opens (an /OpenAction).",
        ),
        (
            "edited-repaired-xref",
            {"xref_shift": 7},
            ("xref-repaired",),
            "Every cross-reference offset is off by 7 bytes, so a reader must repair the table.",
        ),
    )
    for name, overrides, cues, description in single:
        path = f"en/utility-bill/{name}.pdf"
        meta = document_meta(bill, path)
        if "created" in overrides:
            meta = document_meta(bill, path, created=overrides["created"])
        else:
            meta = replace(meta, **overrides)
        _, made = make_pdf(bill, meta)
        add(path, replace(made, cues=cues), bill, "edited", description)

    bank = built_by[("bank_statement", "en")]
    path = "en/bank-statement/edited-after-signature.pdf"
    signed_data, signed_made = make_pdf(bank, document_meta(bank, path, signed=True))
    richer = with_amount(bank, "$3,593.71")
    data = increment(
        signed_data,
        edit_content(content_stream(richer.pages[0], resources_of(bank)), modified=edited_at),
    )
    record = {**(signed_made.pdf or {}), **editor, "edits_after_signature": True}
    add(
        path,
        Made(data, "pdf", pdf=record, cues=("edits-after-signature", *editor_cues)),
        richer,
        "edited",
        "A signed statement whose closing balance an editor changed after the signature.",
    )

    genuine_path = "en/utility-bill/happy-photo.jpg"
    genuine = made_by[genuine_path]
    add(
        "en/utility-bill/edited-photo-ela.jpg",
        ela_edit(bill, genuine, genuine_path, "$98.20", as_of),
        with_amount(bill, "$98.20"),
        "edited",
        "The amount repainted in the photo and the photo saved again at another quality.",
    )
    path = "en/utility-bill/edited-photo-exif-editor.jpg"
    made = make_photo(bill, path, as_of, software=EDITOR_SOFTWARE)
    add(
        path,
        replace(made, cues=("image-editor-software",)),
        bill,
        "edited",
        "The photo as an image editor saved it: its EXIF names the editor.",
    )
    add(
        "en/utility-bill/edited-photo-copy-move.jpg",
        copy_move_edit(bill, genuine, genuine_path, as_of),
        with_amount(bill, "$88.20"),
        "edited",
        "A digit of the amount copied over another one inside the photo (48.20 shows 88.20).",
    )

    # --- genuine variants that must stay under the threshold -----------------------------------
    plain: tuple[tuple[str, dict[str, Any], str], ...] = (
        ("genuine-linearized", {"linearized": True}, "The bill linearized for fast web view."),
        ("genuine-goto-open-action", {"open_action": "goto"}, "The bill opens on page 1, fitted."),
    )
    for name, overrides, description in plain:
        path = f"en/utility-bill/{name}.pdf"
        _, made = make_pdf(bill, replace(document_meta(bill, path), **overrides))
        add(path, made, bill, "genuine", description)

    path = "en/utility-bill/genuine-distinct-xmp-ids.pdf"
    meta = document_meta(bill, path)
    assert meta.xmp is not None  # noqa: S101 - document_meta always writes one
    meta = replace(meta, xmp=replace(meta.xmp, instance_id=deterministic_uuid(f"{path}#saved")))
    _, made = make_pdf(bill, meta)
    add(
        path,
        made,
        bill,
        "genuine",
        "The XMP instance id differs from the document id (saved again).",
    )

    path = "en/utility-bill/genuine-generated-after-date.pdf"
    _, made = make_pdf(bill, document_meta(bill, path, created=_morning(as_of - day)))
    add(path, made, bill, "genuine", "The bill generated eleven days after the date it prints.")

    scanned_at = _morning(as_of - day)
    scan = scanned_pdf(bill.pages[0], scanned_at)
    scanned_record = {
        **bill_record,
        "producer": None,
        "creator": None,
        "creation_date": xmp_date(scanned_at),
        "modification_date": xmp_date(scanned_at),
        "xmp": None,
        "fonts": [],
    }
    add(
        "en/utility-bill/genuine-scanned.pdf",
        Made(scan, "scanned-pdf", pdf=scanned_record),
        bill,
        "genuine",
        "A scan: the printed bill as one JPEG in a PDF (Pillow's PDF driver), no text layer.",
    )

    path = "en/bank-statement/genuine-signed-ltv.pdf"
    signed_data, signed_made = make_pdf(bank, document_meta(bank, path, signed=True))
    data = increment(signed_data, add_dss)
    record = {**(signed_made.pdf or {}), "revisions": 2, "eof_markers": 2}
    add(
        path,
        Made(data, "pdf", pdf=record, cues=("incremental-revisions",)),
        bank,
        "genuine",
        "A signed statement extended for long-term validation: a later increment adds only a "
        "Document Security Store, which is no edit after the signature.",
    )
    return fixtures


# --- the hostile set (C65.2, C60.2) -------------------------------------------------------------

FLATE_BOMB_BYTES: Final = 1 << 30
"""What the flate bomb's content stream inflates to: 1 GiB of zero bytes, from about 1 MB."""

XMP_OVERSIZED_BYTES: Final = 10_000_000
"""The oversized XMP packet: 10 MB (C60.2's bounded scan reads 64 KiB of it)."""

MANY_PAGES: Final = 51
"""One page more than C60.1 analyses."""

HUGE_PAGE_SIDE_PT: Final = 20_000
"""Over C60.2's 14,400 pt."""

NESTING_DEPTH: Final = 100_000
"""Arrays nested this deep in a page dictionary (PDFium stops at 64)."""

BOMB_SIDE_PX: Final = (50_000, 20_000)
"""The JPEG 2000 header's declared side (2.5 GP, over C60.4's 4 MP) and the PNG's (400 MP)."""


_ZERO_BLOCK: Final = 1 << 20
HOSTILE_DATE: Final = date(2026, 1, 15)
"""The hostile set does not depend on the run's date."""


def deflate_zeros(count: int) -> bytes:
    """A zlib stream of ``count`` zero bytes, built without compressing them all: after a full
    flush every block of zeros compresses to the same bytes, so the stream repeats one block."""
    compressor = zlib.compressobj(9)
    blocks, rest = divmod(count, _ZERO_BLOCK)
    out = bytearray()
    if blocks:
        out += compressor.compress(bytes(_ZERO_BLOCK)) + compressor.flush(zlib.Z_FULL_FLUSH)
    if blocks > 1:
        steady = compressor.compress(bytes(_ZERO_BLOCK)) + compressor.flush(zlib.Z_FULL_FLUSH)
        out += steady * (blocks - 1)
    tail = compressor.compress(bytes(rest)) + compressor.flush(zlib.Z_FINISH)
    # The compressor saw at most two blocks: its Adler-32 is replaced by that of every zero
    # (A stays 1, B counts one per byte).
    adler = ((count % 65521) << 16) | 1
    return bytes(out) + tail[:-4] + adler.to_bytes(4, "big")


def _raw_pdf(bodies: dict[int, bytes], root: int, name: str) -> bytes:
    return _classic(
        bodies, root=root, info=None, file_id=hashlib.sha256(name.encode()).digest()[:16], shift=0
    )


_PAGE_FONT: Final = (
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
)


def _billion_laughs() -> bytes:
    entities = ['<!ENTITY a0 "openverify">'] + [
        f'<!ENTITY a{level} "{f"&a{level - 1};" * 10}">' for level in range(1, 10)
    ]
    return (
        '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
        f"<!DOCTYPE x:xmpmeta [{''.join(entities)}]>\n"
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-'
        'syntax-ns#"><rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">'
        "<pdf:Producer>&a9;</pdf:Producer></rdf:Description></rdf:RDF></x:xmpmeta>\n"
        '<?xpacket end="w"?>'
    ).encode()


def _external_entity() -> bytes:
    return (
        b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
        b'<!DOCTYPE x:xmpmeta [<!ENTITY host SYSTEM "file:///etc/hostname">]>\n'
        b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-'
        b'syntax-ns#"><rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">'
        b"<pdf:Producer>&host;</pdf:Producer></rdf:Description></rdf:RDF></x:xmpmeta>\n"
        b'<?xpacket end="w"?>'
    )


def _oversized_xmp() -> bytes:
    head = (
        b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description '
        b'rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">'
        b"<xmp:CreatorTool>Utopia Billing 4.2</xmp:CreatorTool><pdf:Keywords>"
    )
    tail = (
        b"</pdf:Keywords><pdf:Producer>Beyond the bound</pdf:Producer></rdf:Description>"
        b'</rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>'
    )
    return head + b"synthetic " * (XMP_OVERSIZED_BYTES // 10) + tail


def _hostile_bill(name: str, **overrides: Any) -> bytes:
    built = utility_bill("en", default_dates("utility_bill", "en", HOSTILE_DATE))
    data, _ = write_pdf(built.pages, document_meta(built, f"hostile/{name}", **overrides))
    return data


def _flate_bomb() -> bytes:
    content = deflate_zeros(FLATE_BOMB_BYTES)
    bodies = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
        4: f"<< /Filter /FlateDecode /Length {len(content)} >>".encode()
        + b"\nstream\n"
        + content
        + b"\nendstream",
    }
    return _raw_pdf(bodies, 1, "flate-bomb")


def _page_tree_loop() -> bytes:
    bodies = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [2 0 R] /Count 1 >>",
    }
    return _raw_pdf(bodies, 1, "page-tree-loop")


def _deep_nesting() -> bytes:
    content = b"BT /F1 10 Tf 72 700 Td (A page holding arrays nested 100,000 deep) Tj ET"
    deep = b"[" * NESTING_DEPTH + b"]" * NESTING_DEPTH
    bodies = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R"
        b" >> >> /Contents 4 0 R /Deep " + deep + b" >>",
        4: f"<< /Length {len(content)} >>".encode() + b"\nstream\n" + content + b"\nendstream",
        5: _PAGE_FONT,
    }
    return _raw_pdf(bodies, 1, "deep-nesting")


def _xref_prev_loop() -> bytes:
    data = _hostile_bill("xref-prev-loop.pdf")
    startxref = int(data.rsplit(b"startxref\n", 1)[1].split(b"\n", 1)[0])
    return data.replace(b"trailer\n<< ", f"trailer\n<< /Prev {startxref} ".encode(), 1)


def _dangerous_actions() -> bytes:
    content = b"BT /F1 10 Tf 72 700 Td (A page with every dangerous action) Tj ET"
    attachment = b"A synthetic attachment."
    link = "<< /Type /Annot /Subtype /Link /Rect [{x} 600 {r} 620] /Border [0 0 0] /A {action} >>"
    bodies = {
        1: b"<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /J#61vaScript /JS (void 0;) >> "
        b"/Names << /EmbeddedFiles << /Names [(note.txt) 7 0 R] >> >> >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R"
        b" >> >> /Contents 10 0 R /Annots [4 0 R 5 0 R 6 0 R 8 0 R] >>",
        4: link.format(x=72, r=150, action="<< /S /Launch /F (readme.txt) >>").encode(),
        5: link.format(
            x=160,
            r=240,
            action="<< /S /SubmitForm /F << /FS /URL /F (https://submit.example/form) >> >>",
        ).encode(),
        6: link.format(x=250, r=330, action="<< /S /GoToR /F (other.pdf) /D [0 /Fit] >>").encode(),
        7: b"<< /Type /Filespec /F (note.txt) /EF << /F 11 0 R >> >>",
        8: b"<< /Type /Annot /Subtype /RichMedia /Rect [340 600 420 620] >>",
        9: _PAGE_FONT,
        10: f"<< /Length {len(content)} >>".encode() + b"\nstream\n" + content + b"\nendstream",
        11: f"<< /Type /EmbeddedFile /Length {len(attachment)} >>".encode()
        + b"\nstream\n"
        + attachment
        + b"\nendstream",
    }
    return _raw_pdf(bodies, 1, "dangerous-actions")


def _jbig2_image() -> bytes:
    rng = np.random.default_rng(2)
    stream = rng.integers(0, 256, size=256, dtype=np.uint8).tobytes()
    content = b"q 64 0 0 64 72 600 cm /Im1 Do Q"
    bodies = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 "
        b"5 0 R >> >> /Contents 4 0 R >>",
        4: f"<< /Length {len(content)} >>".encode() + b"\nstream\n" + content + b"\nendstream",
        5: (
            "<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /BitsPerComponent 1 "
            f"/ColorSpace /DeviceGray /Filter /JBIG2Decode /Length {len(stream)} >>"
        ).encode()
        + b"\nstream\n"
        + stream
        + b"\nendstream",
    }
    return _raw_pdf(bodies, 1, "jbig2-image")


def _not_a_pdf() -> bytes:
    rng = np.random.default_rng(3)
    noise = bytearray(rng.integers(0, 256, size=2048, dtype=np.uint8).tobytes())
    noise[1500:1509] = b"%PDF-1.7\n"
    return bytes(noise)


def _jpeg2000_bomb() -> bytes:
    """A small JPEG 2000 file whose header (the ``ihdr`` box and the codestream's SIZ marker)
    declares :data:`BOMB_SIDE_PX` pixels a side: refused from the header, never decoded."""
    buffer = io.BytesIO()
    Image.new("RGB", (32, 32), (120, 120, 120)).save(buffer, format="JPEG2000")
    data = bytearray(buffer.getvalue())
    side = BOMB_SIDE_PX[0].to_bytes(4, "big")
    ihdr = data.index(b"ihdr") + 4
    data[ihdr : ihdr + 8] = side + side
    siz = data.index(b"\xff\x51") + 6  # the marker, Lsiz and Rsiz: then Xsiz and Ysiz
    data[siz : siz + 8] = side + side
    return bytes(data)


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        len(payload).to_bytes(4, "big")
        + kind
        + payload
        + zlib.crc32(kind + payload).to_bytes(4, "big")
    )


def _png_bomb() -> bytes:
    """A grayscale PNG declaring :data:`BOMB_SIDE_PX` pixels a side, every row a zero filter
    byte and zero pixels: 400 MB inflated from a few hundred kilobytes."""
    side = BOMB_SIDE_PX[1]
    header = side.to_bytes(4, "big") * 2 + bytes([8, 0, 0, 0, 0])
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", deflate_zeros(side * (side + 1)))
        + _png_chunk(b"IEND", b"")
    )


def _expect(
    outcome: str,
    statuses: Sequence[int],
    codes: Sequence[str] = (),
    *,
    endpoint: str = "/v1/analyze/document",
    measures: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "endpoint": endpoint,
        "outcome": outcome,
        "statuses": list(statuses),
        "codes": list(codes),
        "measures": measures or {},
    }


def hostile_set() -> list[Fixture]:
    """Inputs built to break a PDF or image parser, each with a sidecar saying what C60.1 and
    C60.2 expect of vision: refused with its problem, or analysed within bounds."""
    many = [
        Page(items=(Text(72, 72, f"Page {number} of {MANY_PAGES}"),))
        for number in range(1, MANY_PAGES + 1)
    ]
    huge = Page(
        width=HUGE_PAGE_SIDE_PT,
        height=HUGE_PAGE_SIDE_PT,
        items=(Text(72, 72, "A page 20,000 points a side"),),
    )
    full = _hostile_bill("truncated.pdf")
    analysed_xmp_null = _expect("analysed", [200], measures={"xmp": None})
    rows: tuple[tuple[str, bytes, str, str, dict[str, Any]], ...] = (
        (
            "xmp-entity-expansion.pdf",
            _hostile_bill("xmp-entity-expansion.pdf", raw_xmp=_billion_laughs()),
            "A bill whose XMP packet declares ten nested entities (a billion laughs).",
            "xml-entity-expansion",
            analysed_xmp_null,
        ),
        (
            "xmp-external-entity.pdf",
            _hostile_bill("xmp-external-entity.pdf", raw_xmp=_external_entity()),
            "A bill whose XMP packet declares an external entity naming a local file.",
            "xml-external-entity",
            analysed_xmp_null,
        ),
        (
            "xmp-oversized.pdf",
            _hostile_bill("xmp-oversized.pdf", raw_xmp=_oversized_xmp()),
            "A bill whose XMP packet is 10 MB: a creator tool first, a producer past the bound.",
            "oversized-metadata",
            _expect(
                "analysed",
                [200],
                measures={"xmp": {"creator_tool": "Utopia Billing 4.2", "producer": None}},
            ),
        ),
        (
            "flate-bomb.pdf",
            _flate_bomb(),
            "A page whose content stream inflates to 1 GiB of zero bytes from about 1 MB.",
            "decompression-bomb",
            _expect("refused", [422, 503], ["pdf_unprocessable", "guarded_worker_failed"]),
        ),
        (
            "too-many-pages.pdf",
            write_pdf(many, PdfMeta(file_id=bytes(16)))[0],
            "51 pages, one over the limit.",
            "page-count",
            _expect("refused", [422], ["too_many_pages"]),
        ),
        (
            "huge-page-box.pdf",
            write_pdf([huge], PdfMeta(file_id=bytes(16)))[0],
            "One page 20,000 points a side, over the 14,400-point bound.",
            "page-box",
            _expect("refused", [422], ["pdf_unprocessable"]),
        ),
        (
            "page-tree-loop.pdf",
            _page_tree_loop(),
            "A page tree whose only kid is itself.",
            "page-tree-loop",
            _expect("refused", [422], ["pdf_unprocessable", "too_many_pages"]),
        ),
        (
            "deep-nesting.pdf",
            _deep_nesting(),
            "A page dictionary holding arrays nested 100,000 deep.",
            "parser-recursion",
            _expect("refused-or-analysed", [200, 422], ["pdf_unprocessable"]),
        ),
        (
            "xref-prev-loop.pdf",
            _xref_prev_loop(),
            "A trailer whose /Prev names its own cross-reference section.",
            "xref-loop",
            _expect("refused-or-analysed", [200, 422], ["pdf_unprocessable"]),
        ),
        (
            "dangerous-actions.pdf",
            _dangerous_actions(),
            "JavaScript under a #-escaped name, Launch, SubmitForm, GoToR, RichMedia and an "
            "embedded file: none may run, each is counted.",
            "active-content",
            _expect(
                "analysed",
                [200],
                measures={
                    "actions": {
                        "javascript": 1,
                        "launch": 1,
                        "submit_form": 1,
                        "goto_remote": 1,
                        "rich_media": 1,
                        "embedded_files": 1,
                    }
                },
            ),
        ),
        (
            "jbig2-image.pdf",
            _jbig2_image(),
            "A JBIG2 image of random bytes: no external decoder (jbig2dec) may be run.",
            "jbig2",
            _expect("refused-or-analysed", [200, 422], ["pdf_unprocessable"]),
        ),
        (
            "truncated.pdf",
            full[: len(full) * 3 // 5],
            "A bill cut off at three fifths: no cross-reference table, no trailer.",
            "truncation",
            _expect("refused-or-analysed", [200, 422], ["pdf_unprocessable"]),
        ),
        (
            "not-a-pdf.pdf",
            _not_a_pdf(),
            "Random bytes with a PDF header 1,500 bytes in: no image and no PDF by sniffing.",
            "late-header",
            _expect("refused", [415]),
        ),
        (
            "jpeg2000-bomb.jp2",
            _jpeg2000_bomb(),
            "A JPEG 2000 portrait whose header declares 50,000 pixels a side.",
            "image-header-bomb",
            _expect("refused", [413, 422], endpoint="/v1/convert/portrait"),
        ),
        (
            "png-bomb.png",
            _png_bomb(),
            "A PNG declaring 20,000 pixels a side that inflates to 400 MB.",
            "image-decompression-bomb",
            _expect("refused", [413, 422]),
        ),
    )
    media_types = {"pdf": "application/pdf", "jp2": "image/jp2", "png": "image/png"}
    fixtures = []
    for name, data, description, attack, expect in rows:
        path = f"hostile/{name}"
        fixtures.append(
            Fixture(
                path,
                data,
                {
                    "schema_version": SIDECAR_SCHEMA_VERSION,
                    "file": path,
                    "media_type": media_types[name.rsplit(".", 1)[1]],
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "set": "hostile",
                    "group": "hostile",
                    "variant": name.rsplit(".", 1)[0],
                    "description": description,
                    "attack": attack,
                    "expect": expect,
                },
            )
        )
    return fixtures


# --- the held-out set (C60.7) -------------------------------------------------------------------
#
# Written apart from the classifier and never used to tune it (H23): other issuers, other people,
# other layouts (B: a banded statement with a summary box; C: a letter), other words for the same
# things, French and German, two languages the classifier does not cover, documents of no accepted
# class, identity pages, and blank US federal forms filled with synthetic values. Each file's
# sidecar gives the truth (its class or "other") and the answer C60.5 and C60.6 call correct.

HELD_OUT_SCHEMA_VERSION: Final = 1
COVERED_LANGUAGES: Final = ("en", "es", "fr", "de")
"""C60.5: the languages the lexicons cover; a document in another one should be ``unknown``."""

_MONTHS: Final = {
    "fr": (
        "janvier",
        "février",
        "mars",
        "avril",
        "mai",
        "juin",
        "juillet",
        "août",
        "septembre",
        "octobre",
        "novembre",
        "décembre",
    ),
    "de": (
        "Januar",
        "Februar",
        "März",
        "April",
        "Mai",
        "Juni",
        "Juli",
        "August",
        "September",
        "Oktober",
        "November",
        "Dezember",
    ),
    "it": (
        "gennaio",
        "febbraio",
        "marzo",
        "aprile",
        "maggio",
        "giugno",
        "luglio",
        "agosto",
        "settembre",
        "ottobre",
        "novembre",
        "dicembre",
    ),
    "pt": (
        "janeiro",
        "fevereiro",
        "março",
        "abril",
        "maio",
        "junho",
        "julho",
        "agosto",
        "setembro",
        "outubro",
        "novembro",
        "dezembro",
    ),
}


def any_long_date(when: date, language: str) -> str:
    """A date with its month's name in any language of the sets."""
    if language in ("en", "es"):
        return long_date(when, language)
    month = _MONTHS[language][when.month - 1]
    if language == "de":
        return f"{when.day}. {month} {when.year}"
    if language == "pt":
        return f"{when.day} de {month} de {when.year}"
    return f"{when.day} {month} {when.year}"


def any_money(cents: int, language: str) -> str:
    """Amounts as each language writes them (``EUR`` after, never the euro sign)."""
    if language in ("en", "es"):
        return money(cents, language)
    sign = "-" if cents < 0 else ""
    whole, part = divmod(abs(cents), 100)
    separator = "." if language in ("de", "it") else " "
    return f"{sign}{f'{whole:,}'.replace(',', separator)},{part:02d} EUR"


def _place(
    street: str, city: str, postal_code: str, country: str, subdivision: str | None = None
) -> Address:
    return Address(street, city, postal_code, country, None, subdivision)


HELD_OUT_PEOPLE: Final = {
    "en": (
        Person("Arlo", "Penhallow", _place("18 Kestrel Close", "Ashcombe", "00087", "US", "UT")),
        Person(
            "Maeve", "Thistlewood", _place("402 Larkspur Avenue", "Ashcombe", "00087", "US", "UT")
        ),
    ),
    "es": (
        Person(
            "Tomás",
            "Arriaga Belmonte",
            _place("Calle de las Moreras 14", "Valdelira", "53041", "ES"),
        ),
        Person(
            "Carmela", "Ibarrondo Sáez", _place("Avenida del Río 3, 1A", "Valdelira", "53041", "ES")
        ),
    ),
    "fr": (
        Person("Solène", "Marchetière", _place("12 rue des Tilleuls", "Bellerive", "00450", "FR")),
    ),
    "de": (Person("Jannik", "Wehrstedt", _place("Lindenallee 7", "Lindenau", "00123", "DE")),),
    "it": (
        Person("Livia", "Castelvetro", _place("Via dei Mandorli 9", "Valfiorita", "99990", "IT")),
    ),
    "pt": (
        Person(
            "Duarte", "Figueiral", _place("Rua das Amendoeiras 21", "Vilaserra", "0000-021", "PT")
        ),
    ),
}
"""The held-out set's people: none of them is in the main set; postal codes are unassigned."""

HELD_OUT_PEOPLE_NAMES: Final = tuple(
    person.name for people in HELD_OUT_PEOPLE.values() for person in people
)


def _issuer(name: str, person: Person, street: str, website: str) -> Issuer:
    address = person.address
    contact = "(555) 010-0166" if address.country_code == "US" else "555 010 166"
    return Issuer(
        name,
        Address(
            street,
            address.city,
            address.postal_code,
            address.country_code,
            None,
            address.subdivision,
        ),
        contact,
        website,
        f"{name} documents 1.0",
    )


@dataclass(frozen=True, slots=True)
class Wording:
    """What a held-out document says: its issuer, title and date label, its lines of figures,
    its total and any notes, in one language."""

    issuer: str
    website: str
    title: str
    date_label: str
    rows: tuple[tuple[str, int], ...]
    total: str
    notes: tuple[str, ...] = ()


_TERM_NOTE: Final = "{term}"
"""A note holding a lease's term, filled with the dates."""

WORDING_B: Final[dict[tuple[str, str], Wording]] = {
    ("utility_bill", "en"): Wording(
        "Ashcombe Power and Light",
        "ashcombepower.example",
        "Electricity bill",
        "Invoice date",
        (
            ("Energy used, 412 kWh", 6180),
            ("Delivery and metering", 2215),
            ("State energy fee", 180),
        ),
        "Total to pay",
        ("Please pay by the due date printed on your account page.",),
    ),
    ("utility_bill", "es"): Wording(
        "Luz de Valdelira",
        "luzdevaldelira.example",
        "Factura de electricidad",
        "Fecha de factura",
        (
            ("Término de energía, 412 kWh", 6180),
            ("Término de potencia", 2215),
            ("Alquiler del contador", 180),
        ),
        "Importe total",
        ("Se cargará en su cuenta en los próximos días.",),
    ),
    ("utility_bill", "fr"): Wording(
        "Énergie de Bellerive",
        "energiedebellerive.example",
        "Facture d'électricité",
        "Date de facture",
        (("Consommation, 412 kWh", 6180), ("Abonnement", 2215), ("Taxes locales", 180)),
        "Total à payer",
        ("Montant prélevé sur votre compte à la date prévue.",),
    ),
    ("utility_bill", "de"): Wording(
        "Stadtwerke Lindenau",
        "stadtwerke-lindenau.example",
        "Stromrechnung",
        "Rechnungsdatum",
        (("Verbrauch, 412 kWh", 6180), ("Grundpreis", 2215), ("Messstellenbetrieb", 180)),
        "Rechnungsbetrag",
        ("Der Betrag wird von Ihrem Konto abgebucht.",),
    ),
    ("utility_bill", "it"): Wording(
        "Energia di Valfiorita",
        "energiavalfiorita.example",
        "Bolletta della luce",
        "Data di emissione",
        (("Consumo, 412 kWh", 6180), ("Quota fissa", 2215), ("Oneri di sistema", 180)),
        "Totale da pagare",
        ("Importo addebitato sul conto alla scadenza.",),
    ),
    ("utility_bill", "pt"): Wording(
        "Luz de Vilaserra",
        "luzdevilaserra.example",
        "Fatura de eletricidade",
        "Data de emissão",
        (("Consumo, 412 kWh", 6180), ("Potência contratada", 2215), ("Taxa de exploração", 180)),
        "Total a pagar",
        ("O valor será debitado na sua conta.",),
    ),
    ("bank_statement", "en"): Wording(
        "Lantern Valley Credit Union",
        "lanternvalley.example",
        "Account summary",
        "Statement closing date",
        (
            ("Beginning balance", 380210),
            ("Deposits and other credits", 412050),
            ("Withdrawals and other debits", -298733),
        ),
        "Ending balance",
        ("Share draft account ending in 0451.",),
    ),
    ("bank_statement", "es"): Wording(
        "Caja Rural de Valdelira",
        "cajavaldelira.example",
        "Resumen de cuenta",
        "Fecha de cierre",
        (("Saldo inicial", 380210), ("Ingresos", 412050), ("Gastos y adeudos", -298733)),
        "Saldo a fecha de cierre",
        ("Cuenta corriente terminada en 0451.",),
    ),
    ("bank_statement", "fr"): Wording(
        "Banque de Bellerive",
        "banquedebellerive.example",
        "Relevé de compte",
        "Date d'arrêté",
        (("Ancien solde", 380210), ("Total des crédits", 412050), ("Total des débits", -298733)),
        "Nouveau solde",
        ("Compte courant se terminant par 0451.",),
    ),
    ("bank_statement", "de"): Wording(
        "Lindenauer Bürgerbank",
        "buergerbank-lindenau.example",
        "Kontoauszug",
        "Auszugsdatum",
        (("Alter Kontostand", 380210), ("Gutschriften", 412050), ("Belastungen", -298733)),
        "Neuer Kontostand",
        ("Girokonto mit der Endung 0451.",),
    ),
    ("bank_statement", "it"): Wording(
        "Banca di Valfiorita",
        "bancavalfiorita.example",
        "Estratto conto",
        "Data dell'estratto",
        (("Saldo iniziale", 380210), ("Accrediti", 412050), ("Addebiti", -298733)),
        "Saldo finale",
        ("Conto corrente che termina con 0451.",),
    ),
    ("bank_statement", "pt"): Wording(
        "Banco de Vilaserra",
        "bancovilaserra.example",
        "Extrato bancário",
        "Data do extrato",
        (("Saldo inicial", 380210), ("Créditos", 412050), ("Débitos", -298733)),
        "Saldo final",
        ("Conta à ordem terminada em 0451.",),
    ),
    ("pay_stub", "en"): Wording(
        "Bellwether Joinery Ltd",
        "bellwetherjoinery.example",
        "Payslip",
        "Payment date",
        (
            ("Basic pay", 265000),
            ("Holiday pay", 21200),
            ("Income tax", -41960),
            ("Health plan", -6300),
        ),
        "Take-home pay",
        ("Paid by bank transfer to the account ending in 0451.",),
    ),
    ("pay_stub", "es"): Wording(
        "Carpintería Valdelira, S.L.",
        "carpinteriavaldelira.example",
        "Hoja de salario",
        "Fecha de abono",
        (
            ("Sueldo base", 198000),
            ("Plus de transporte", 9500),
            ("Retención IRPF", -29880),
            ("Cotización a la Seguridad Social", -13180),
        ),
        "Neto a cobrar",
        ("Abonado por transferencia a la cuenta terminada en 0451.",),
    ),
    ("pay_stub", "fr"): Wording(
        "Menuiserie de Bellerive",
        "menuiseriebellerive.example",
        "Bulletin de paie",
        "Date de paiement",
        (
            ("Salaire de base", 245000),
            ("Prime d'ancienneté", 9800),
            ("Cotisations salariales", -54320),
        ),
        "Net à payer",
        ("Virement sur le compte se terminant par 0451.",),
    ),
    ("pay_stub", "de"): Wording(
        "Tischlerei Lindenau GmbH",
        "tischlerei-lindenau.example",
        "Gehaltsabrechnung",
        "Auszahlungsdatum",
        (
            ("Grundgehalt", 310000),
            ("Zuschlag", 12000),
            ("Lohnsteuer", -42610),
            ("Sozialversicherung", -64110),
        ),
        "Auszahlungsbetrag",
        ("Überweisung auf das Konto mit der Endung 0451.",),
    ),
    ("lease", "en"): Wording(
        "Ashcombe Lettings LLC",
        "ashcombelettings.example",
        "Tenancy agreement",
        "Date signed",
        (("Monthly rent, payable in advance", 98000), ("Deposit held", 98000)),
        "First payment due",
        (_TERM_NOTE, "The tenant may not sublet the property without written consent."),
    ),
    ("lease", "es"): Wording(
        "Alquileres Valdelira, S.L.",
        "alquileresvaldelira.example",
        "Contrato de alquiler",
        "Fecha de firma",
        (("Renta mensual", 72000), ("Fianza depositada", 72000)),
        "Primer pago",
        (_TERM_NOTE, "El inquilino no puede subarrendar el inmueble sin permiso por escrito."),
    ),
    ("lease", "fr"): Wording(
        "Agence Immobilière de Bellerive",
        "immobellerive.example",
        "Contrat de location",
        "Date de signature",
        (("Loyer mensuel", 76000), ("Dépôt de garantie", 76000)),
        "Premier versement",
        (_TERM_NOTE, "Le locataire ne peut sous-louer le logement sans accord écrit du bailleur."),
    ),
    ("lease", "de"): Wording(
        "Hausverwaltung Lindenau",
        "hausverwaltung-lindenau.example",
        "Mietvertrag",
        "Datum der Unterzeichnung",
        (("Monatliche Miete", 81000), ("Kaution", 162000)),
        "Erste Zahlung",
        (_TERM_NOTE, "Eine Untervermietung bedarf der schriftlichen Zustimmung des Vermieters."),
    ),
    ("tax_document", "en"): Wording(
        "Ashcombe Clockworks LLC",
        "ashcombeclockworks.example",
        "Annual earnings summary for tax purposes",
        "Date of issue",
        (
            ("Total pay in this employment", 5230000),
            ("Federal tax deducted", -450000),
            ("State tax deducted", -214400),
        ),
        "Pay after tax",
        ("Keep this summary with your tax records for the year.",),
    ),
    ("tax_document", "es"): Wording(
        "Relojería Valdelira, S.A.",
        "relojeriavaldelira.example",
        "Resumen fiscal anual",
        "Fecha de emisión",
        (
            ("Rendimientos íntegros del trabajo", 2960000),
            ("Retenciones", -414400),
            ("Cotizaciones", -188000),
        ),
        "Rendimiento neto",
        ("Conserve este resumen para su declaración de la renta.",),
    ),
    ("tax_document", "fr"): Wording(
        "Direction des finances de Bellerive",
        "finances-bellerive.example",
        "Avis d'impôt sur le revenu",
        "Date d'établissement",
        (("Impôt sur le revenu brut", 251000), ("Réductions et crédits d'impôt", -23000)),
        "Impôt net à payer",
        ("Cet avis concerne les revenus de l'année précédente.",),
    ),
    ("tax_document", "de"): Wording(
        "Finanzamt Lindenau",
        "finanzamt-lindenau.example",
        "Lohnsteuerbescheinigung",
        "Ausstellungsdatum",
        (
            ("Bruttoarbeitslohn", 3720000),
            ("Einbehaltene Lohnsteuer", -511300),
            ("Sozialversicherungsbeiträge", -760000),
        ),
        "Nettoarbeitslohn",
        ("Diese Bescheinigung gilt für das vorangegangene Kalenderjahr.",),
    ),
}
"""Layout B's wording: other issuers and other words than the main set's."""

_LETTERS: Final[dict[tuple[str, str], tuple[str, str, str, tuple[str, ...]]]] = {
    ("utility_bill", "en"): (
        "Ashcombe Broadband",
        "ashcombebroadband.example",
        "Bill date",
        (
            "Your monthly bill for the Fiber 300 plan at {address} is ready.",
            "This month you owe {amount}. Autopay will take the payment from your bank account.",
            "Thank you for being a customer.",
        ),
    ),
    ("utility_bill", "es"): (
        "Fibra Valdelira",
        "fibravaldelira.example",
        "Fecha de la factura",
        (
            "Ya está disponible su factura mensual de la tarifa Fibra 300 en {address}.",
            "Este mes el importe es de {amount}, que se cargará en su cuenta bancaria.",
            "Gracias por confiar en nosotros.",
        ),
    ),
    ("bank_statement", "en"): (
        "Kestrel Savings",
        "kestrelsavings.example",
        "Statement date",
        (
            "Here is your savings account statement for the month that ended on the date above.",
            "Your balance at the end of the month was {amount}, including interest of $3.12.",
            "Transactions are listed in your online banking.",
        ),
    ),
    ("bank_statement", "es"): (
        "Ahorros del Río",
        "ahorrosdelrio.example",
        "Fecha del extracto",
        (
            "Le enviamos el extracto mensual de su cuenta de ahorro.",
            "El saldo al cierre del mes era de {amount}, con unos intereses de 3,12 EUR.",
            "Puede consultar los movimientos en su banca en línea.",
        ),
    ),
    ("pay_stub", "en"): (
        "Ashcombe Clockworks LLC",
        "ashcombeclockworks.example",
        "Pay date",
        (
            "This advice confirms your salary payment for the last pay period.",
            "Gross earnings were $4,360.00; after tax and benefit deductions, {amount} was "
            "deposited to your account.",
            "Questions about this remittance go to the payroll office.",
        ),
    ),
    ("pay_stub", "es"): (
        "Relojería Valdelira, S.A.",
        "relojeriavaldelira.example",
        "Fecha de pago",
        (
            "Le confirmamos el pago de su salario del último periodo.",
            "El salario bruto fue de 2.466,67 EUR y, tras las retenciones, se le han abonado "
            "{amount}.",
            "Para cualquier duda, contacte con el departamento de personal.",
        ),
    ),
    ("lease", "en"): (
        "Larkspur House Rentals",
        "larkspurrentals.example",
        "Date signed",
        (
            "Room rental agreement for a furnished room at {address}.",
            "{term}",
            "The rent is {amount} a month, utilities included.",
        ),
    ),
    ("lease", "es"): (
        "Habitaciones del Río",
        "habitacionesdelrio.example",
        "Fecha de firma",
        (
            "Contrato de arrendamiento de una habitación amueblada en {address}.",
            "{term}",
            "La renta es de {amount} al mes, con los suministros incluidos.",
        ),
    ),
    ("tax_document", "en"): (
        "Kestrel Savings",
        "kestrelsavings.example",
        "Date of issue",
        (
            "Statement of interest paid to you for tax year {year}.",
            "Interest paid on your savings account: {amount}. No tax was withheld.",
            "Report this amount on your income tax return.",
        ),
    ),
    ("tax_document", "es"): (
        "Ahorros del Río",
        "ahorrosdelrio.example",
        "Fecha de emisión",
        (
            "Certificado de intereses abonados en el ejercicio {year}.",
            "Intereses de su cuenta de ahorro: {amount}. Retención practicada: 0,00 EUR.",
            "Incluya este importe en su declaración de la renta.",
        ),
    ),
}
"""Layout C, a letter: the issuer, its website, the date label and the paragraphs."""

_TERMS: Final = {
    "en": "The tenancy runs from {start} to {end}.",
    "es": "El contrato va del {start} al {end}.",
    "fr": "Le bail court du {start} au {end}.",
    "de": "Das Mietverhältnis läuft vom {start} bis zum {end}.",
}

_LETTER_AMOUNTS: Final = {
    "utility_bill": 6740,
    "bank_statement": 512288,
    "pay_stub": 312450,
    "lease": 64000,
    "tax_document": 18710,
}


_ACCENTS: Final[dict[str, RGB]] = {
    "utility_bill": (34, 92, 128),
    "bank_statement": (28, 70, 54),
    "pay_stub": (92, 54, 30),
    "lease": (70, 44, 96),
    "tax_document": (60, 60, 64),
}

_PAGE_LABELS: Final = {
    "en": "Page {n} of {m}",
    "es": "Página {n} de {m}",
    "fr": "Page {n} sur {m}",
    "de": "Seite {n} von {m}",
    "it": "Pagina {n} di {m}",
    "pt": "Página {n} de {m}",
}

_SHEET_OF: Final = {"en": SHEETS["en"]}


def _sheet(language: str) -> Sheet:
    return _SHEET_OF.get(language, SHEETS["es"])


def _held_out_footer(sheet: Sheet, language: str, number: int = 1, count: int = 1) -> list[Item]:
    return [
        Text(
            sheet.right,
            sheet.height - 36,
            _PAGE_LABELS[language].format(n=number, m=count),
            size=7.5,
            align="right",
            color=MUTED,
        ),
        Text(54, sheet.height - 36, SYNTHETIC_BANNER, size=7, color=MUTED),
    ]


def held_out_dates(kind: str, as_of: date, shift: int) -> Dates:
    """Current dates for a held-out document, ``shift`` days apart from its sibling's."""
    day = timedelta(days=1)
    if kind == "lease":
        signed = as_of - (150 + shift) * day
        start = signed + 9 * day
        return {
            "issue-date": signed,
            "lease-start": start,
            "lease-end": _years_later(start, 1) - day,
        }
    if kind == "tax_document":
        year = as_of.year if as_of >= date(as_of.year, 2, 20) else as_of.year - 1
        return {"issue-date": date(year, 2, 14) - shift * day}
    return {"issue-date": as_of - (6 + shift) * day}


_MARKET_STREETS: Final = {
    "en": "1 Market Row",
    "es": "Plaza Mayor 1",
    "fr": "1 place du Marché",
    "de": "Marktplatz 1",
    "it": "Piazza del Mercato 1",
    "pt": "Praça do Mercado 1",
}
"""Where layout B's issuers sit, in each language's way."""


def layout_b(kind: str, language: str, as_of: date) -> Built:
    """Layout B: a coloured band, the holder at the left, a summary box at the right, a table of
    figures, a highlighted total, then notes."""
    wording = WORDING_B[(kind, language)]
    person = HELD_OUT_PEOPLE[language][0]
    issuer = _issuer(wording.issuer, person, _MARKET_STREETS[language], wording.website)
    sheet = _sheet(language)
    dates = held_out_dates(kind, as_of, 0)
    issue = dates["issue-date"]
    issue_line = f"{wording.date_label}: {any_long_date(issue, language)}"
    printed: dict[str, dict[str, str]] = {}
    _dated(printed, "issue-date", issue, issue_line)
    accent = _ACCENTS[kind]
    width = sheet.right - sheet.left
    items: list[Item] = [
        Box(0, 0, sheet.width, 70, fill=accent),
        Text(
            54,
            38,
            wording.issuer.upper(),
            size=15,
            font="Helvetica-Bold",
            color=WHITE,
            role="issuer",
        ),
        Text(
            54,
            56,
            f"{issuer.address.one_line()} · {wording.website}",
            size=8,
            color=(232, 236, 242),
        ),
        *addressee(person, y=110),
        Box(sheet.width / 2 + 10, 92, sheet.right - sheet.width / 2 - 10, 72, stroke=RULE),
        Text(sheet.width / 2 + 20, 110, wording.title, size=10.5, font="Helvetica-Bold"),
        Text(sheet.width / 2 + 20, 127, issue_line, size=9.5, role="issue-date"),
        Text(
            sheet.width / 2 + 20,
            143,
            f"Ref. {issue.year}-{kind[:2].upper()}-0451",
            size=8.5,
            color=MUTED,
        ),
    ]
    y = 200.0
    for label, cents in wording.rows:
        items += [
            Text(54, y, label),
            Text(sheet.right, y, any_money(cents, language), align="right"),
            Box(54, y + 5, width, 0.5, fill=RULE),
        ]
        y += 20
    total = sum(cents for _, cents in wording.rows)
    items += [
        Box(54, y - 2, width, 22, fill=(238, 241, 246)),
        Text(60, y + 13, wording.total, font="Helvetica-Bold"),
        Text(
            sheet.right - 6,
            y + 13,
            any_money(total, language),
            font="Helvetica-Bold",
            align="right",
            role="amount",
        ),
    ]
    y += 48
    expiration = None
    for written in wording.notes:
        note = written
        if written == _TERM_NOTE:
            start, end = dates["lease-start"], dates["lease-end"]
            note = _TERMS[language].format(
                start=any_long_date(start, language), end=any_long_date(end, language)
            )
            _dated(printed, "lease-start", start, note)
            _dated(printed, "lease-end", end, note)
            expiration = end
        for line in wrap(note, width, 9.5):
            items.append(Text(54, y, line, size=9.5))
            y += 13
        y += 6
    items += _held_out_footer(sheet, language)
    page = Page(sheet.width, sheet.height, tuple(items))
    return Built(kind, language, (page,), person, issuer, wording.title, printed, expiration)


def layout_c(kind: str, language: str, as_of: date) -> Built:
    """Layout C: a letter, the figures in its paragraphs."""
    name, website, date_label, paragraphs = _LETTERS[(kind, language)]
    person = HELD_OUT_PEOPLE[language][1]
    issuer = _issuer(
        name, person, "220 Mill Street" if language == "en" else "Calle Real 22", website
    )
    sheet = _sheet(language)
    dates = held_out_dates(kind, as_of, 3)
    issue = dates["issue-date"]
    issue_line = f"{date_label}: {any_long_date(issue, language)}"
    printed: dict[str, dict[str, str]] = {}
    _dated(printed, "issue-date", issue, issue_line)
    values = {
        "address": person.address.one_line(),
        "amount": any_money(_LETTER_AMOUNTS[kind], language),
        "year": str(issue.year - 1),
        "term": "",
    }
    expiration = None
    if kind == "lease":
        start, end = dates["lease-start"], dates["lease-end"]
        values["term"] = _TERMS[language].format(
            start=any_long_date(start, language), end=any_long_date(end, language)
        )
        _dated(printed, "lease-start", start, values["term"])
        _dated(printed, "lease-end", end, values["term"])
        expiration = end
    width = sheet.right - sheet.left
    items: list[Item] = [
        Text(54, 62, name, size=13, font="Helvetica-Oblique", role="issuer"),
        Text(54, 76, f"{issuer.address.one_line()} · {website}", size=8, color=MUTED),
        Text(sheet.right, 118, issue_line, align="right", role="issue-date"),
        *addressee(person, y=150),
    ]
    y = 228.0
    greeting = {"en": "Dear {name},", "es": "Estimado/a {name}:"}[language]
    items.append(Text(54, y, greeting.format(name=person.name)))
    y += 22
    for paragraph in paragraphs:
        for line in wrap(paragraph.format(**values), width):
            items.append(Text(54, y, line))
            y += 14
        y += 8
    closing = {"en": "Kind regards,", "es": "Atentamente,"}[language]
    items += [Text(54, y + 10, closing), Text(54, y + 26, name, size=9.5, color=MUTED)]
    items += _held_out_footer(sheet, language)
    page = Page(sheet.width, sheet.height, tuple(items))
    title = {"en": "Letter", "es": "Carta"}[language]
    return Built(kind, language, (page,), person, issuer, title, printed, expiration)


# Documents of no accepted class: what a user may upload by mistake.

_OTHERS: Final[dict[tuple[str, str], tuple[str, tuple[str, ...]]]] = {
    ("receipt", "en"): (
        "HARBOUR STREET GROCER",
        (
            "Receipt 0451 · till 2",
            "Apples, 1.2 lb  2.39",
            "Whole milk  3.15",
            "Sourdough loaf  4.80",
            "Total  10.34",
            "Paid by card. Thank you for shopping with us!",
        ),
    ),
    ("receipt", "es"): (
        "FRUTERÍA DEL RÍO",
        (
            "Ticket 0451 · caja 2",
            "Manzanas, 1,2 kg  2,39",
            "Leche entera  1,15",
            "Pan de masa madre  3,80",
            "Total  7,34",
            "Pagado con tarjeta. ¡Gracias por su compra!",
        ),
    ),
    ("invitation", "en"): (
        "You are invited!",
        (
            "Join us for the Ashcombe spring fair on the village green.",
            "Games, music and homemade cakes from noon until six.",
            "Bring a friend and a picnic blanket.",
        ),
    ),
    ("invitation", "es"): (
        "¡Estás invitado!",
        (
            "Ven a la fiesta de primavera de Valdelira en la plaza.",
            "Juegos, música y dulces caseros desde el mediodía.",
            "Trae a un amigo y una manta para el picnic.",
        ),
    ),
    ("newsletter", "en"): (
        "Larkspur Avenue Neighbourhood News",
        (
            "The community garden opens again this Saturday.",
            "Volunteers are needed to paint the playground fence.",
            "The book swap moves to the library entrance next month.",
        ),
    ),
    ("newsletter", "es"): (
        "Boletín vecinal de la calle de las Moreras",
        (
            "El huerto comunitario vuelve a abrir este sábado.",
            "Se buscan voluntarios para pintar la valla del parque.",
            "El intercambio de libros se traslada a la biblioteca.",
        ),
    ),
    ("menu", "en"): (
        "The Kestrel Cafe · Lunch menu",
        (
            "Tomato soup with toasted bread  6.50",
            "Grilled vegetable sandwich  8.75",
            "Lemon cake  4.25",
            "Coffee or tea  2.80",
        ),
    ),
    ("menu", "es"): (
        "Café del Río · Menú del día",
        (
            "Sopa de tomate con pan tostado  6,50",
            "Bocadillo de verduras a la plancha  8,75",
            "Tarta de limón  4,25",
            "Café o té  1,80",
        ),
    ),
}


def other_document(name: str, language: str) -> Page:
    title, lines = _OTHERS[(name, language)]
    sheet = _sheet(language)
    items: list[Item] = [Text(54, 80, title, size=16, font="Helvetica-Bold")]
    y = 120.0
    for line in lines:
        label, _, figure = line.partition("  ")
        items.append(Text(54, y, label))
        if figure:
            items.append(Text(sheet.right, y, figure, align="right"))
        y += 20
    items += _held_out_footer(sheet, language)
    return Page(sheet.width, sheet.height, tuple(items))


# Blank US federal forms (decision 18), filled with synthetic values.


@dataclass(frozen=True, slots=True)
class FederalForm:
    """A pinned blank form (``fixtures/manifest.json``) and the pages the held-out set keeps."""

    form: str
    data: bytes
    pages: tuple[int, ...]


FEDERAL_HOLDER: Final = HELD_OUT_PEOPLE["en"][0]

_EMPLOYER_LINES: Final = "ASHCOMBE CLOCKWORKS LLC\n220 MILL STREET\nASHCOMBE, UT 00087"

FEDERAL_FILLS: Final[dict[str, dict[str, str]]] = {
    "w2": {
        "topmostSubform[0].CopyB[0].BoxA_ReadOrder[0].f2_01[0]": "XXX-XX-0451",
        "topmostSubform[0].CopyB[0].Col_Left[0].f2_02[0]": "00-4410087",
        "topmostSubform[0].CopyB[0].Col_Left[0].f2_03[0]": _EMPLOYER_LINES,
        "topmostSubform[0].CopyB[0].Col_Left[0].f2_04[0]": "A-0451",
        "topmostSubform[0].CopyB[0].Col_Left[0].FirstName_ReadOrder[0].f2_05[0]": "ARLO",
        "topmostSubform[0].CopyB[0].Col_Left[0].LastName_ReadOrder[0].f2_06[0]": "PENHALLOW",
        "topmostSubform[0].CopyB[0].Col_Left[0].f2_08[0]": "18 KESTREL CLOSE\nASHCOMBE, UT 00087",
        "topmostSubform[0].CopyB[0].Col_Right[0].Box1_ReadOrder[0].f2_09[0]": "52300.00",
        "topmostSubform[0].CopyB[0].Col_Right[0].f2_10[0]": "4500.00",
        "topmostSubform[0].CopyB[0].Col_Right[0].Box3_ReadOrder[0].f2_11[0]": "52300.00",
        "topmostSubform[0].CopyB[0].Col_Right[0].f2_12[0]": "3242.60",
        "topmostSubform[0].CopyB[0].Col_Right[0].Box5_ReadOrder[0].f2_13[0]": "52300.00",
        "topmostSubform[0].CopyB[0].Col_Right[0].f2_14[0]": "758.35",
        "topmostSubform[0].CopyB[0].Boxes15_ReadOrder[0].Box15_ReadOrder[0].f2_29[0]": "UT",
        "topmostSubform[0].CopyB[0].Boxes15_ReadOrder[0].f2_30[0]": "00-0010087",
        "topmostSubform[0].CopyB[0].Box16_ReadOrder[0].f2_33[0]": "52300.00",
        "topmostSubform[0].CopyB[0].Box17_ReadOrder[0].f2_35[0]": "2301.20",
    },
    "1099-nec": {
        "topmostSubform[0].CopyB[0].PgHeader[0].CalendarYear[0].f2_1[0]": "2025",
        "topmostSubform[0].CopyB[0].LeftCol[0].f2_2[0]": (
            "KESTREL DESIGN STUDIO\n9 ORCHARD LANE\nASHCOMBE, UT 00087\n(555) 010-0188"
        ),
        "topmostSubform[0].CopyB[0].LeftCol[0].f2_3[0]": "00-4420087",
        "topmostSubform[0].CopyB[0].LeftCol[0].f2_4[0]": "XXX-XX-0451",
        "topmostSubform[0].CopyB[0].LeftCol[0].f2_5[0]": "ARLO PENHALLOW",
        "topmostSubform[0].CopyB[0].LeftCol[0].f2_6[0]": "18 KESTREL CLOSE",
        "topmostSubform[0].CopyB[0].LeftCol[0].f2_7[0]": "ASHCOMBE, UT 00087",
        "topmostSubform[0].CopyB[0].LeftCol[0].f2_8[0]": "KDS-0451",
        "topmostSubform[0].CopyB[0].RightCol[0].f2_9[0]": "6450.00",
        "topmostSubform[0].CopyB[0].RightCol[0].f2_11[0]": "0.00",
    },
    "1040": {
        "topmostSubform[0].Page1[0].f1_14[0]": "ARLO",
        "topmostSubform[0].Page1[0].f1_15[0]": "PENHALLOW",
        "topmostSubform[0].Page1[0].f1_16[0]": "000000451",
        "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_20[0]": "18 KESTREL CLOSE",
        "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_22[0]": "ASHCOMBE",
        "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_23[0]": "UT",
        "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_24[0]": "00087",
        "topmostSubform[0].Page1[0].f1_47[0]": "52,300",
        "topmostSubform[0].Page1[0].f1_57[0]": "52,300",
        "topmostSubform[0].Page1[0].f1_59[0]": "140",
        "topmostSubform[0].Page1[0].f1_73[0]": "52,440",
        "topmostSubform[0].Page1[0].f1_75[0]": "52,440",
        "topmostSubform[0].Page2[0].f2_01[0]": "52,440",
        "topmostSubform[0].Page2[0].f2_02[0]": "15,750",
        "topmostSubform[0].Page2[0].f2_05[0]": "15,750",
        "topmostSubform[0].Page2[0].f2_06[0]": "36,690",
        "topmostSubform[0].Page2[0].f2_08[0]": "4,159",
        "topmostSubform[0].Page2[0].f2_10[0]": "4,159",
        "topmostSubform[0].Page2[0].f2_14[0]": "4,159",
        "topmostSubform[0].Page2[0].f2_16[0]": "4,159",
        "topmostSubform[0].Page2[0].f2_17[0]": "4,500",
        "topmostSubform[0].Page2[0].f2_20[0]": "4,500",
    },
}
"""Synthetic values by the forms' own field names (pinned bytes, so the names do not move): a
masked or unassigned taxpayer number (area 000), EINs with the unassigned prefix 00, the held-out
set's invented holder and payers."""

FEDERAL_ISSUERS: Final = {
    "w2": "Ashcombe Clockworks LLC",
    "1099-nec": "Kestrel Design Studio",
    "1040": None,
}


TALL_FIELD_PT: Final = 11
"""A field at least this tall takes 9 pt text; a smaller one 7 pt."""


class FormFillError(Exception):
    """A pinned form lacks a field the fill names: the pin and the fill disagree."""


def qualified_field_name(annotation: Any) -> str:
    """A widget's fully qualified field name: its ``/T`` and its parents', dotted."""
    parts: list[str] = []
    node = annotation
    while node is not None:
        if "/T" in node:
            parts.append(str(node["/T"]))
        parent = node.get("/Parent")
        node = parent.get_object() if parent is not None else None
    return ".".join(reversed(parts))


def _overlay(width: float, height: float, items: Sequence[Item]) -> PageObject:
    data, _ = write_pdf([Page(width, height, tuple(items))], PdfMeta(file_id=bytes(16)))
    return PdfReader(io.BytesIO(data)).pages[0]


def fill_federal_form(form: FederalForm) -> bytes:
    """The form's pages with the synthetic values drawn at their widgets and the synthetic
    banner, written as a fresh file: no widget, form, XFA, JavaScript or usage-rights signature
    of the original survives (the values are page content, as a printed and scanned form)."""
    fills = FEDERAL_FILLS[form.form]
    reader = PdfReader(io.BytesIO(form.data))
    writer = PdfWriter()
    used: set[str] = set()
    for number in form.pages:
        page = reader.pages[number - 1]
        width, height = float(page.mediabox.width), float(page.mediabox.height)
        items: list[Item] = [Text(36, height - 6, SYNTHETIC_BANNER, size=6, color=MUTED)]
        for annotation in page.get("/Annots", []) or []:
            widget = annotation.get_object()
            name = qualified_field_name(widget)
            if name not in fills:
                continue
            used.add(name)
            x0, y0, _, y1 = (float(v) for v in widget["/Rect"])
            lines = fills[name].split("\n")
            size = 9.0 if y1 - y0 >= TALL_FIELD_PT else 7.0
            # Baselines in PDF points from the bottom: centred in a one-line field, else from
            # the top of the field down.
            first = y1 - 1.5 - size * 0.8 if len(lines) > 1 else (y0 + y1) / 2 - size * 0.35
            for index, line in enumerate(lines):
                baseline = first - index * size * 1.15
                items.append(Text(x0 + 2, height - baseline, line, size=size))
        for key in ("/Annots", "/AA"):
            if key in page:
                del page[NameObject(key)]
        writer.add_page(page).merge_page(_overlay(width, height, items))
    missing = sorted(set(fills) - used)
    if missing:
        raise FormFillError(f"the pinned {form.form} form has no field {missing[0]}")
    writer.add_metadata(
        {"/Producer": "OpenVerify synthetic form filler", "/Title": f"Form {form.form} (synthetic)"}
    )
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _pdf_page_image(data: bytes, index: int = 0) -> Image.Image:
    """Page ``index`` of a trusted PDF (one this module wrote or a pinned federal form) at
    :data:`RASTER_DPI`, through PDFium."""
    document = pdfium.PdfDocument(data)
    try:
        image: Image.Image = document[index].render(scale=RASTER_DPI / 72).to_pil().convert("RGB")
    finally:
        document.close()
    return image


def _photo_of_image(image: Image.Image, path: str, as_of: date) -> tuple[bytes, PhotoTruth]:
    return photograph(image, seed=_seed(path), taken=_taken(as_of))


def _type_outcome(
    label: str, language: str, *, identity: bool
) -> tuple[str, list[str], dict[str, Any]]:
    """The class C60.5 should answer, the answers that are correct, and C60.6's type check."""
    if label in DOCUMENT_CLASSES and language in COVERED_LANGUAGES:
        return label, [label], _outcome("passed")
    if label in DOCUMENT_CLASSES:  # a language the lexicons do not cover
        return "unknown", ["unknown"], _outcome("not_applicable", "document_type_unknown")
    if identity:  # positively an identity document (an MRZ): the one rejection C60.6 makes
        return "other", ["other"], _outcome("failed", "document_type_not_accepted")
    return "other", ["other", "unknown"], _outcome("not_applicable", "document_type_unknown")


def held_out_sidecar(  # noqa: PLR0913 - every part of the record
    path: str,
    data: bytes,
    *,
    label: str,
    language: str,
    layout: str,
    form: str,
    source: str,
    description: str,
    as_of: date,
    pages: int,
    fields: dict[str, str | None] | None,
    identity: bool = False,
) -> dict[str, Any]:
    expected, acceptable, outcome = _type_outcome(label, language, identity=identity)
    media_type = "application/pdf" if path.endswith(".pdf") else "image/jpeg"
    return {
        "schema_version": HELD_OUT_SCHEMA_VERSION,
        "file": path,
        "media_type": media_type,
        "sha256": hashlib.sha256(data).hexdigest(),
        "set": "held-out",
        "id": path.rsplit(".", 1)[0],
        "label": label,
        "identity_document": identity,
        "language": language,
        "covered_language": language in COVERED_LANGUAGES,
        "layout": layout,
        "form": form,
        "source": source,
        "pages": pages,
        "description": description,
        "as_of": as_of.isoformat(),
        "expected_answer": expected,
        "acceptable_answers": acceptable,
        "expect": {"document_type_detection": outcome},
        "fields": fields,
    }


def held_out_set(
    as_of: date, forms: Sequence[FederalForm], identity: Mapping[str, bytes]
) -> list[Fixture]:
    """C60.7: the held-out documents, each with its truth and its correct answer.

    ``forms`` are the pinned blank federal forms (a W-2, a 1099-NEC and a 1040); ``identity``
    holds the JPEG of a synthetic TD3 passport page (``td3-passport``) and of a TD1 card's front
    (``td1-card``)."""
    fixtures: list[Fixture] = []

    def add(path: str, data: bytes, **record: Any) -> None:
        fixtures.append(Fixture(path, data, held_out_sidecar(path, data, as_of=as_of, **record)))

    def add_built(built: Built, path: str, layout: str, description: str) -> None:
        data, _ = write_pdf(built.pages, document_meta(built, path))
        add(
            path,
            data,
            label=built.kind,
            language=built.language,
            layout=layout,
            form="pdf",
            source="synthetic",
            description=description,
            pages=len(built.pages),
            fields=document_fields(built),
        )

    for kind in DOCUMENT_CLASSES:
        for language in ("en", "es"):
            built = layout_b(kind, language, as_of)
            base = f"b-{language}-{kebab(kind)}"
            add_built(built, f"{base}.pdf", "B", "Layout B: a banded statement with a summary box.")
            photo = make_photo(built, f"{base}-photo.jpg", as_of)
            add(
                f"{base}-photo.jpg",
                photo.data,
                label=kind,
                language=language,
                layout="B",
                form="photo",
                source="synthetic",
                description="A phone photo of the layout B document.",
                pages=1,
                fields=document_fields(built),
            )
            letter = layout_c(kind, language, as_of)
            add_built(letter, f"c-{language}-{kebab(kind)}.pdf", "C", "Layout C: a letter.")
        for language in ("fr", "de"):
            built = layout_b(kind, language, as_of)
            add_built(
                built, f"b-{language}-{kebab(kind)}.pdf", "B", "Layout B in a covered language."
            )
    for kind in ("utility_bill", "bank_statement"):
        for language in ("it", "pt"):
            built = layout_b(kind, language, as_of)
            add_built(
                built,
                f"b-{language}-{kebab(kind)}.pdf",
                "B",
                "Layout B in a language the lexicons do not cover: unknown is correct.",
            )
    for name in ("receipt", "invitation", "newsletter", "menu"):
        for language in ("en", "es"):
            path = f"other-{language}-{name}.pdf"
            data, _ = write_pdf([other_document(name, language)], PdfMeta(file_id=bytes(16)))
            add(
                path,
                data,
                label="other",
                language=language,
                layout=f"other-{name}",
                form="pdf",
                source="synthetic",
                description=f"A {name}: no proof-of-address class.",
                pages=1,
                fields=None,
            )
    for key, description in (
        ("td3-passport", "The synthetic Utopia TD3 passport data page, its MRZ printed."),
        ("td1-card", "The synthetic Utopia TD1 identity card's front."),
    ):
        add(
            f"identity-{key}.jpg",
            identity[key],
            label="other",
            language="en",
            layout="identity",
            form="photo",
            source="synthetic",
            description=description,
            pages=1,
            fields=None,
            identity=True,
        )
    for federal in forms:
        data = fill_federal_form(federal)
        base = f"federal-{federal.form}"
        fields = federal_fields(federal.form)
        add(
            f"{base}.pdf",
            data,
            label="tax_document",
            language="en",
            layout="federal",
            form="pdf",
            source=f"irs-{federal.form}",
            description=f"The blank IRS {federal.form} form filled with synthetic values.",
            pages=len(federal.pages),
            fields=fields,
        )
        if federal.form in ("w2", "1040"):
            jpeg, _ = _photo_of_image(_pdf_page_image(data), f"{base}-photo.jpg", as_of)
            add(
                f"{base}-photo.jpg",
                jpeg,
                label="tax_document",
                language="en",
                layout="federal",
                form="photo",
                source=f"irs-{federal.form}",
                description=f"A phone photo of the filled {federal.form}'s first page.",
                pages=1,
                fields=fields,
            )
    return fixtures


def federal_fields(form: str) -> dict[str, str | None]:
    """What a filled federal form prints of C52.8's fields (no form prints an issue date)."""
    address = FEDERAL_HOLDER.address
    return {
        "name": FEDERAL_HOLDER.name.upper(),
        "address-street-1": address.street_1.upper(),
        "address-street-2": None,
        "address-city": address.city.upper(),
        "address-subdivision": address.subdivision,
        "address-postal-code": address.postal_code,
        "address-country-code": address.country_code,
        "issue-date": None,
        "issuer": FEDERAL_ISSUERS[form],
        "expiration-date": None,
    }
