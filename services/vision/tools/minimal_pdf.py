"""A minimal PDF writer for the document tests and the document benchmark (V19).

``vision-document`` builds its own inputs here rather than with the fixture generator: plain
objects, streams (FlateDecode or not), an object stream with an xref stream, classic cross-
reference tables, incremental updates, and page content with standard-14 fonts, text render
modes, colours, clipping and filled rectangles. Everything it writes is synthetic (C65.1).
Standard library only; nothing here parses a PDF.
"""

from __future__ import annotations

import re
import zlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Final

LETTER: Final = (612.0, 792.0)

_STARTXREF: Final = re.compile(rb"startxref\s+(\d+)\s+%%EOF\s*$")


def pdf_string(text: str) -> bytes:
    """A literal string with ``\\``, ``(`` and ``)`` escaped (Latin-1 text)."""
    raw = text.encode("latin-1")
    return b"(" + raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)") + b")"


def number(value: float) -> bytes:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return (text if text not in {"", "-0"} else "0").encode("ascii")


def stream(data: bytes, entries: bytes = b"", *, compress: bool = True) -> bytes:
    """A stream object's body: its dictionary (``entries`` plus ``/Length`` and the filter)."""
    payload = zlib.compress(data) if compress else data
    flate = b" /Filter /FlateDecode" if compress else b""
    head = b"<< " + entries + flate + b" /Length " + str(len(payload)).encode() + b" >>"
    return head + b"\nstream\n" + payload + b"\nendstream"


@dataclass(frozen=True, slots=True)
class Text:
    """A text line drawn at ``(x, y)`` (its baseline, in points)."""

    x: float
    y: float
    text: str
    size: float = 10.0
    font: str = "F1"
    render_mode: int = 0
    gray: float | None = None
    """A grey fill (0 black, 1 white); ``None`` keeps the current fill."""


@dataclass(frozen=True, slots=True)
class Rect:
    """A filled rectangle (``re f``) in a grey."""

    x: float
    y: float
    width: float
    height: float
    gray: float = 1.0


@dataclass(frozen=True, slots=True)
class Clip:
    """Content drawn inside a rectangular clip (``q x y w h re W n ... Q``)."""

    x: float
    y: float
    width: float
    height: float
    inner: tuple[Text | Rect, ...]


@dataclass(frozen=True, slots=True)
class Saved:
    """Content drawn inside ``q ... Q``, so its graphics state (a text clip, say) ends with it."""

    inner: tuple[Text | Rect, ...]


Item = Text | Rect | Clip | Saved


def _text(item: Text) -> bytes:
    parts = [b"BT"]
    if item.gray is not None:
        parts.append(number(item.gray) + b" g")
    parts.append(b"/" + item.font.encode() + b" " + number(item.size) + b" Tf")
    parts.append(str(item.render_mode).encode() + b" Tr")
    parts.append(number(item.x) + b" " + number(item.y) + b" Td")
    parts.append(pdf_string(item.text) + b" Tj")
    parts.append(b"ET")
    return b" ".join(parts)


def _rect(item: Rect) -> bytes:
    box = b" ".join(number(v) for v in (item.x, item.y, item.width, item.height))
    return b"q " + number(item.gray) + b" g " + box + b" re f Q"


def content(items: Sequence[Item]) -> bytes:
    """A page content stream drawing ``items`` in order."""
    lines: list[bytes] = []
    for item in items:
        if isinstance(item, Text):
            lines.append(_text(item))
        elif isinstance(item, Rect):
            lines.append(_rect(item))
        elif isinstance(item, Saved):
            lines.append(b"q")
            lines.append(content(item.inner))
            lines.append(b"Q")
        else:
            box = b" ".join(number(v) for v in (item.x, item.y, item.width, item.height))
            lines.append(b"q " + box + b" re W n")
            lines.append(content(item.inner))
            lines.append(b"Q")
    return b"\n".join(lines) + b"\n"


@dataclass
class MinimalPdf:
    """Numbered objects written as one revision with a classic cross-reference table."""

    version: str = "1.7"
    objects: dict[int, bytes] = field(default_factory=dict)

    def add(self, body: bytes) -> int:
        number_ = max(self.objects, default=0) + 1
        self.objects[number_] = body
        return number_

    def reserve(self) -> int:
        return self.add(b"null")

    def build(self, *, root: int, info: int | None = None, trailer_extra: bytes = b"") -> bytes:
        out = bytearray(b"%PDF-" + self.version.encode() + b"\n%\xe2\xe3\xcf\xd3\n")
        offsets: dict[int, int] = {}
        for number_ in sorted(self.objects):
            offsets[number_] = len(out)
            out += f"{number_} 0 obj\n".encode() + self.objects[number_] + b"\nendobj\n"
        size = max(self.objects) + 1
        xref = len(out)
        out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
        for number_ in range(1, size):
            if number_ in offsets:
                out += f"{offsets[number_]:010d} 00000 n \n".encode()
            else:
                out += b"0000000000 65535 f \n"
        info_entry = b"" if info is None else f" /Info {info} 0 R".encode()
        out += f"trailer\n<< /Size {size} /Root {root} 0 R".encode() + info_entry
        out += trailer_extra + f" >>\nstartxref\n{xref}\n%%EOF\n".encode()
        return bytes(out)


def startxref_of(data: bytes) -> int:
    """The last ``startxref`` offset of ``data``."""
    found = _STARTXREF.search(data)
    if found is None:
        raise ValueError("no startxref at the end")
    return int(found.group(1))


def append_increment(
    data: bytes, objects: Mapping[int, bytes], *, root: int, size: int, info: int | None = None
) -> bytes:
    """``data`` with an incremental update: ``objects`` (new or replaced numbers), a
    cross-reference section for them and a trailer whose ``/Prev`` is the last section."""
    out = bytearray(data if data.endswith(b"\n") else data + b"\n")
    offsets: dict[int, int] = {}
    for number_ in sorted(objects):
        offsets[number_] = len(out)
        out += f"{number_} 0 obj\n".encode() + objects[number_] + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 1\n0000000000 65535 f \n"
    for number_ in sorted(offsets):
        out += f"{number_} 1\n{offsets[number_]:010d} 00000 n \n".encode()
    new_size = max(size, max(objects) + 1)
    info_entry = b"" if info is None else f" /Info {info} 0 R".encode()
    out += f"trailer\n<< /Size {new_size} /Root {root} 0 R".encode() + info_entry
    out += f" /Prev {startxref_of(data)} >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


@dataclass(frozen=True, slots=True)
class Built:
    """A document and the object numbers a test may need."""

    data: bytes
    catalog: int
    pages: tuple[int, ...]
    info: int | None
    size: int


FONTS: Final = {"F1": b"Helvetica", "F2": b"Courier", "F3": b"Times-Roman"}


def document(  # noqa: PLR0913 - keyword options of one small writer
    pages: Sequence[bytes],
    *,
    info: Mapping[str, bytes] | None = None,
    catalog_extra: bytes = b"",
    page_extra: bytes = b"",
    resources_extra: bytes = b"",
    media_box: tuple[float, float] = LETTER,
    compress: bool = True,
    extra_objects: Sequence[bytes] = (),
) -> Built:
    """A document whose pages draw ``pages`` (content streams) with the :data:`FONTS`.

    ``info`` maps Info keys (``Producer``, ``CreationDate``) to their already-written values,
    for example ``pdf_string("…")``; ``extra_objects`` are added before the catalog, numbered in
    order after the pages' objects (the first is ``2 * len(pages) + 5``); ``resources_extra`` is
    written into every page's resource dictionary (an ``/XObject`` entry, say)."""
    pdf = MinimalPdf()
    fonts = {
        name: pdf.add(b"<< /Type /Font /Subtype /Type1 /BaseFont /" + base + b" >>")
        for name, base in FONTS.items()
    }
    font_entries = b" ".join(f"/{n} {o} 0 R".encode() for n, o in fonts.items())
    resources = b"<< /Font << " + font_entries + b" >>" + resources_extra + b" >>"
    pages_id = pdf.reserve()
    width, height = media_box
    box = b"[0 0 " + number(width) + b" " + number(height) + b"]"
    kids = []
    for page in pages:
        stream_id = pdf.add(stream(page, compress=compress))
        kids.append(
            pdf.add(
                f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox ".encode()
                + box
                + b" /Resources "
                + resources
                + f" /Contents {stream_id} 0 R".encode()
                + page_extra
                + b" >>"
            )
        )
    pdf.objects[pages_id] = (
        b"<< /Type /Pages /Kids ["
        + b" ".join(f"{k} 0 R".encode() for k in kids)
        + f"] /Count {len(kids)} >>".encode()
    )
    for extra in extra_objects:
        pdf.add(extra)
    catalog = pdf.add(f"<< /Type /Catalog /Pages {pages_id} 0 R".encode() + catalog_extra + b" >>")
    info_id = None
    if info is not None:
        info_id = pdf.add(
            b"<< " + b" ".join(b"/" + k.encode() + b" " + v for k, v in info.items()) + b" >>"
        )
    data = pdf.build(root=catalog, info=info_id)
    return Built(data, catalog, tuple(kids), info_id, max(pdf.objects) + 1)


def object_stream_document(objects: Mapping[int, bytes], *, catalog: int, pages: bytes) -> bytes:
    """A document whose ``objects`` (dictionaries, no streams) live in one FlateDecode object
    stream, with an xref stream; object 1 is the page tree ``pages`` written plainly."""
    numbers = sorted(objects)
    bodies, offsets, position = [], [], 0
    for n in numbers:
        offsets.append(position)
        bodies.append(objects[n] + b"\n")
        position += len(objects[n]) + 1
    header = b" ".join(b"%d %d" % (n, offset) for n, offset in zip(numbers, offsets, strict=True))
    first = len(header) + 1
    packed = header + b"\n" + b"".join(bodies)
    stream_number = max(numbers) + 1
    xref_number = stream_number + 1
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    plain_offsets = {1: len(out)}
    out += b"1 0 obj\n" + pages + b"\nendobj\n"
    plain_offsets[stream_number] = len(out)
    entries = f"/Type /ObjStm /N {len(numbers)} /First {first}".encode()
    out += f"{stream_number} 0 obj\n".encode() + stream(packed, entries) + b"\nendobj\n"
    xref_offset = len(out)
    rows = bytearray(b"\x00\x00\x00\xff\xff")
    for n in range(1, xref_number + 1):
        if n in plain_offsets:
            rows += b"\x01" + plain_offsets[n].to_bytes(3, "big") + b"\x00"
        elif n in objects:
            rows += b"\x02" + stream_number.to_bytes(3, "big") + bytes([numbers.index(n)])
        elif n == xref_number:
            rows += b"\x01" + xref_offset.to_bytes(3, "big") + b"\x00"
        else:
            rows += b"\x00\x00\x00\x00\xff"
    xref_entries = f"/Type /XRef /Size {xref_number + 1} /W [1 3 1] /Root {catalog} 0 R".encode()
    out += f"{xref_number} 0 obj\n".encode() + stream(bytes(rows), xref_entries) + b"\nendobj\n"
    out += f"startxref\n{xref_offset}\n%%EOF\n".encode()
    return bytes(out)


def first_extra_object(page_count: int) -> int:
    """The number :func:`document` gives its first extra object."""
    return 2 * page_count + 5


def image_xobject(jpeg: bytes, width: int, height: int) -> bytes:
    """A DCTDecode RGB image XObject's body around ``jpeg``."""
    head = (
        f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} "
        f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpeg)} >>"
    ).encode()
    return head + b"\nstream\n" + jpeg + b"\nendstream"
