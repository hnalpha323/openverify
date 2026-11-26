"""Independent readers for the synthetic proof-of-address tests: what PDFium and pypdf see.

The generator's own truth is never trusted by these helpers: each answer comes from PDFium (the
renderer vision uses) through pypdfium2's raw API, or from pypdf.
"""

from __future__ import annotations

import ctypes
import io
from dataclasses import dataclass
from typing import Any

import pypdfium2 as pdfium  # type: ignore[import-untyped]
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    NumberObject,
    TextStringObject,
)
from pypdfium2 import raw

from synthetic_poa import FEDERAL_FILLS

Bounds = tuple[float, float, float, float]
"""``(left, bottom, right, top)`` in PDF points."""


@dataclass(frozen=True, slots=True)
class TextObject:
    text: str
    render_mode: int
    font: str
    size: float
    bounds: Bounds


@dataclass(frozen=True, slots=True)
class FilledPath:
    bounds: Bounds
    rgba: tuple[int, int, int, int]


def _bounds(obj: raw.FPDF_PAGEOBJECT) -> Bounds:
    left, bottom, right, top = (ctypes.c_float() for _ in range(4))
    assert raw.FPDFPageObj_GetBounds(
        obj, ctypes.byref(left), ctypes.byref(bottom), ctypes.byref(right), ctypes.byref(top)
    )
    return (left.value, bottom.value, right.value, top.value)


def _text_of(obj: raw.FPDF_PAGEOBJECT, textpage: raw.FPDF_TEXTPAGE) -> str:
    size = raw.FPDFTextObj_GetText(obj, textpage, None, 0)
    buffer = (ctypes.c_ushort * size)()
    raw.FPDFTextObj_GetText(obj, textpage, buffer, size)
    # PDFium ends some objects' text with a space where the next object starts; drop it.
    return bytes(buffer).decode("utf-16-le").rstrip("\x00").rstrip()


def _font_of(obj: raw.FPDF_PAGEOBJECT) -> str:
    font = raw.FPDFTextObj_GetFont(obj)
    size = raw.FPDFFont_GetBaseFontName(font, None, 0)
    buffer = ctypes.create_string_buffer(size)
    raw.FPDFFont_GetBaseFontName(font, buffer, size)
    return buffer.value.decode("utf-8")


def text_objects(data: bytes, page_index: int = 0) -> list[TextObject]:
    """Every text object of the page, in content order, as PDFium parsed it."""
    document = pdfium.PdfDocument(data)
    page = document[page_index]
    textpage = page.get_textpage()
    found: list[TextObject] = []
    for index in range(raw.FPDFPage_CountObjects(page.raw)):
        obj = raw.FPDFPage_GetObject(page.raw, index)
        if raw.FPDFPageObj_GetType(obj) != raw.FPDF_PAGEOBJ_TEXT:
            continue
        size = ctypes.c_float()
        raw.FPDFTextObj_GetFontSize(obj, ctypes.byref(size))
        found.append(
            TextObject(
                text=_text_of(obj, textpage.raw),
                render_mode=raw.FPDFTextObj_GetTextRenderMode(obj),
                font=_font_of(obj),
                size=size.value,
                bounds=_bounds(obj),
            )
        )
    return found


def filled_paths(data: bytes, page_index: int = 0) -> list[FilledPath]:
    """Every filled path object of the page with its fill colour, in content order."""
    document = pdfium.PdfDocument(data)
    page = document[page_index]
    paths: list[FilledPath] = []
    for index in range(raw.FPDFPage_CountObjects(page.raw)):
        obj = raw.FPDFPage_GetObject(page.raw, index)
        if raw.FPDFPageObj_GetType(obj) != raw.FPDF_PAGEOBJ_PATH:
            continue
        fill_mode, stroke = ctypes.c_int(), ctypes.c_int()
        raw.FPDFPath_GetDrawMode(obj, ctypes.byref(fill_mode), ctypes.byref(stroke))
        if fill_mode.value == 0:
            continue
        r, g, b, a = (ctypes.c_uint() for _ in range(4))
        raw.FPDFPageObj_GetFillColor(
            obj, ctypes.byref(r), ctypes.byref(g), ctypes.byref(b), ctypes.byref(a)
        )
        paths.append(FilledPath(_bounds(obj), (r.value, g.value, b.value, a.value)))
    return paths


def page_text(data: bytes, page_index: int = 0) -> str:
    """PDFium's text layer of the page (every text object, painted or not)."""
    document = pdfium.PdfDocument(data)
    text: str = document[page_index].get_textpage().get_text_range()
    return text


def page_count(data: bytes) -> int:
    return len(pdfium.PdfDocument(data))


def trailer_ends(data: bytes) -> int:
    """PDFium's count of cross-reference sections (``FPDF_GetTrailerEnds``)."""
    document = pdfium.PdfDocument(data)
    count: int = raw.FPDF_GetTrailerEnds(document.raw, None, 0)
    return count


def has_valid_xref(data: bytes) -> bool:
    """False when PDFium had to repair the cross-reference table."""
    document = pdfium.PdfDocument(data)
    return bool(raw.FPDF_DocumentHasValidCrossReferenceTable(document.raw))


def signature_byte_ranges(data: bytes) -> list[list[int]]:
    """The ``/ByteRange`` of each signature PDFium finds."""
    document = pdfium.PdfDocument(data)
    ranges: list[list[int]] = []
    for index in range(raw.FPDF_GetSignatureCount(document.raw)):
        signature = raw.FPDF_GetSignatureObject(document.raw, index)
        count = raw.FPDFSignatureObj_GetByteRange(signature, None, 0)
        buffer = (ctypes.c_int * count)()
        raw.FPDFSignatureObj_GetByteRange(signature, buffer, count)
        ranges.append(list(buffer))
    return ranges


def is_linearized(data: bytes) -> bool:
    """PDFium's own verdict (``FPDFAvail_IsLinearized``), read through its data-availability API
    with every byte available."""
    buffer = ctypes.create_string_buffer(data, len(data))

    @ctypes.CFUNCTYPE(  # type: ignore[untyped-decorator]
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_ulong,
    )
    def get_block(_param: object, position: int, target: Any, size: int) -> int:
        ctypes.memmove(target, ctypes.byref(buffer, position), size)
        return 1

    @ctypes.CFUNCTYPE(  # type: ignore[untyped-decorator]
        ctypes.c_int, ctypes.POINTER(raw.FX_FILEAVAIL), ctypes.c_size_t, ctypes.c_size_t
    )
    def is_available(_this: object, _offset: int, _size: int) -> int:
        return 1

    access = raw.FPDF_FILEACCESS()
    access.m_FileLen = len(data)
    access.m_GetBlock = ctypes.cast(get_block, type(access.m_GetBlock))
    access.m_Param = None
    avail = raw.FX_FILEAVAIL()
    avail.version = 1
    avail.IsDataAvail = ctypes.cast(is_available, type(avail.IsDataAvail))
    handle = raw.FPDFAvail_Create(ctypes.byref(avail), ctypes.byref(access))
    try:
        return bool(raw.FPDFAvail_IsLinearized(handle) == raw.PDF_LINEARIZED)
    finally:
        raw.FPDFAvail_Destroy(handle)


def catalog(data: bytes) -> Any:
    """The document catalogue as pypdf reads it in strict mode."""
    return reader(data).trailer["/Root"].get_object()


def reader(data: bytes) -> PdfReader:
    """pypdf in strict mode: a malformed structure raises instead of being repaired."""
    return PdfReader(io.BytesIO(data), strict=True)


# --- stand-in federal forms ---------------------------------------------------------------------

PAGES: dict[str, tuple[int, ...]] = {"w2": (4,), "1099-nec": (4, 5), "1040": (1, 2)}
"""The pages of each pinned form the held-out set keeps (as ``fixtures/manifest.json`` says)."""


def stand_in_form(form: str) -> bytes:
    """A blank form with the pinned file's field names on the pages the set keeps, and the parts
    the fill must never copy: XFA, document JavaScript, a usage-rights entry, field actions."""
    writer = PdfWriter()
    pages = PAGES[form]
    for _ in range(max(pages)):
        writer.add_blank_page(612, 792)
    parents: dict[str, Any] = {}
    roots = ArrayObject()
    for index, name in enumerate(sorted(FEDERAL_FILLS[form])):
        *ancestors, leaf = name.split(".")
        parent = None
        for depth in range(len(ancestors)):
            key = ".".join(ancestors[: depth + 1])
            if key not in parents:
                node = DictionaryObject({NameObject("/T"): TextStringObject(ancestors[depth])})
                if parent is not None:
                    node[NameObject("/Parent")] = parent
                reference = writer._add_object(node)
                if parent is None:
                    roots.append(reference)
                parents[key] = reference
            parent = parents[key]
        page_index = pages[-1] - 1 if "Page2" in name else pages[0] - 1
        y = 740 - (index % 40) * 16
        widget = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Widget"),
                NameObject("/FT"): NameObject("/Tx"),
                NameObject("/T"): TextStringObject(leaf),
                NameObject("/Rect"): ArrayObject(
                    [FloatObject(40), FloatObject(y), FloatObject(300), FloatObject(y + 12)]
                ),
                NameObject("/AA"): DictionaryObject(
                    {
                        NameObject("/K"): DictionaryObject(
                            {
                                NameObject("/S"): NameObject("/JavaScript"),
                                NameObject("/JS"): TextStringObject("AFNumber_Keystroke(2);"),
                            }
                        )
                    }
                ),
            }
        )
        if parent is not None:
            widget[NameObject("/Parent")] = parent
        page = writer.pages[page_index]
        annots = page.get("/Annots") or ArrayObject()
        annots.append(writer._add_object(widget))
        page[NameObject("/Annots")] = annots
    root = writer.root_object
    root[NameObject("/AcroForm")] = DictionaryObject(
        {
            NameObject("/Fields"): roots,
            NameObject("/XFA"): ArrayObject([TextStringObject("template"), NumberObject(0)]),
        }
    )
    root[NameObject("/Names")] = DictionaryObject(
        {NameObject("/JavaScript"): DictionaryObject({NameObject("/Names"): ArrayObject()})}
    )
    root[NameObject("/Perms")] = DictionaryObject({NameObject("/UR3"): DictionaryObject()})
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()
