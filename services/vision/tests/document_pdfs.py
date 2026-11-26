"""Synthetic PDFs for the document tests: a bill, its hidden-text variants, the hostile set
(C60.2) and the signed, encrypted and scanned cases, all built here (V19, C65.1).

Every name, address and amount is invented (the Utopia Water Board and its customer).
"""

from __future__ import annotations

import io
from typing import Final

from PIL import Image
from pypdf import PdfWriter

from minimal_pdf import (
    Clip,
    Item,
    MinimalPdf,
    Rect,
    Saved,
    Text,
    append_increment,
    content,
    document,
    first_extra_object,
    image_xobject,
    pdf_string,
    stream,
)

INFO: Final = {
    "Producer": pdf_string("Utopia Billing 4.2"),
    "Creator": pdf_string("Utopia Statements"),
    "CreationDate": pdf_string("D:20260930100000+02'00'"),
    "ModDate": pdf_string("D:20260930100500+02'00'"),
}

BILL_LINES: Final = (
    Text(72, 740, "UTOPIA WATER BOARD", size=18),
    Text(72, 700, "Statement date: 30 September 2026"),
    Text(72, 684, "Account number: 4471-2208-19"),
    Text(72, 640, "QUINN VALEMONT"),
    Text(72, 626, "14 LANTERN ROW"),
    Text(72, 612, "MERIDALE UT 00000"),
    Text(72, 560, "Amount due: 48.20", font="F2"),
)


def bill(*items: Item, info: bool = True) -> bytes:
    """A one-page water bill, with ``items`` drawn after its lines."""
    page = content([*BILL_LINES, *items])
    return document([page], info=INFO if info else None).data


def hidden_variants() -> bytes:
    """One page with a line hidden in each way C60.1 names, and visible controls."""
    return document(
        [
            content(
                [
                    Text(72, 740, "Visible heading line"),
                    Text(72, 700, "Invisible render mode", render_mode=3),
                    Saved((Text(72, 680, "Clip only render mode", render_mode=7),)),
                    Text(-900, 660, "Far off the page"),
                    Clip(400, 600, 50, 20, (Text(72, 640, "Outside its clip"),)),
                    Text(72, 620, "Tiny text", size=1),
                    Text(72, 600, "Covered amount 98.20"),
                    Rect(68, 595, 200, 18, gray=1.0),
                    Text(72, 580, "White on white", gray=1.0),
                    Rect(60, 548, 300, 24, gray=0.1),
                    Text(72, 556, "White on dark band", gray=1.0),
                    Text(72, 520, "Black after the band", gray=0.0),
                ]
            )
        ],
        info=INFO,
    ).data


def encrypted(user_password: str) -> bytes:
    """The bill encrypted with RC4-128 (pypdf's built-in cipher) and an owner password."""
    writer = PdfWriter(clone_from=io.BytesIO(bill()))
    writer.encrypt(user_password=user_password, owner_password="owner-secret", algorithm="RC4-128")
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def many_pages(count: int) -> bytes:
    return document([content([Text(72, 700, f"Page {n + 1}")]) for n in range(count)]).data


def oversized_page() -> bytes:
    """A page box of 20,000 pt a side, over the 14,400 pt bound."""
    return document([content([Text(72, 700, "Huge")])], media_box=(20_000.0, 20_000.0)).data


def content_bomb(megabytes: int = 40) -> bytes:
    """A page whose content stream inflates to ``megabytes`` MB of spaces (about 40 KB on
    disk): over pypdf's 20 MB output cap."""
    payload = b" " * (megabytes * 1024 * 1024) + b"BT /F1 12 Tf 72 700 Td (Boom) Tj ET"
    return document([payload]).data


def text_operator_bomb(operators: int = 2_700_000) -> bytes:
    """About 28 KB: one content stream of ``operators`` ``(A) Tj`` (18.9 MB inflated, under
    pypdf's 20 MB cap). PDFium runs out of the child's whole 1.5 GiB of address space on it and
    aborts, every time (Workflow 5C review P003)."""
    pdf = MinimalPdf()
    pdf.add(b"<< /Type /Catalog /Pages 2 0 R >>")
    pdf.add(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    pdf.add(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>"
    )
    pdf.add(stream(b"BT /F1 12 Tf " + b"(A) Tj " * operators + b"ET"))
    pdf.add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    return pdf.build(root=1)


def with_open_action(action: bytes) -> bytes:
    built = document([content(BILL_LINES)], catalog_extra=b" /OpenAction " + action, info=INFO)
    return built.data


def with_annotations() -> bytes:
    link = b"<< /Type /Annot /Subtype /Link /Rect [72 556 200 572] /A << /S /URI /URI (x) >> >>"
    text_note = b"<< /Type /Annot /Subtype /Text /Rect [300 700 320 720] /Contents (note) >>"
    first = first_extra_object(1)
    return document(
        [content(BILL_LINES)],
        extra_objects=[link, text_note],
        page_extra=f" /Annots [{first} 0 R {first + 1} 0 R]".encode(),
    ).data


def with_form_fields() -> bytes:
    first = first_extra_object(1)
    fields = [
        "<< /FT /Tx /T (name) /Type /Annot /Subtype /Widget /Rect [72 500 200 520] /P 6 0 R >>",
        f"<< /T (address) /Kids [{first + 2} 0 R {first + 3} 0 R] >>",
        f"<< /FT /Tx /T (line1) /Parent {first + 1} 0 R /Type /Annot /Subtype /Widget "
        "/Rect [72 470 200 490] /P 6 0 R >>",
        f"<< /FT /Tx /T (line2) /Parent {first + 1} 0 R /Type /Annot /Subtype /Widget "
        "/Rect [72 440 200 460] /P 6 0 R >>",
    ]
    return document(
        [content(BILL_LINES)],
        extra_objects=[field.encode() for field in fields],
        catalog_extra=f" /AcroForm << /Fields [{first} 0 R {first + 1} 0 R] >>".encode(),
        page_extra=f" /Annots [{first} 0 R {first + 2} 0 R {first + 3} 0 R]".encode(),
    ).data


def jpeg_bytes(width: int = 1224, height: int = 1584, quality: int = 85) -> bytes:
    """A grey page photo with dark bands where text would be."""
    image = Image.new("RGB", (width, height), (238, 236, 230))
    for row in range(10):
        top = 120 + row * 90
        image.paste((40, 40, 48), (100, top, 100 + 600 + 20 * row, top + 30))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def scanned(jpeg: bytes | None = None) -> bytes:
    """A scanned bill: one page that is a full-page DCTDecode image and no text."""
    data = jpeg if jpeg is not None else jpeg_bytes()
    first = first_extra_object(1)
    return document(
        [b"q 612 0 0 792 0 0 cm /Im1 Do Q\n"],
        extra_objects=[image_xobject(data, 1224, 1584)],
        resources_extra=f" /XObject << /Im1 {first} 0 R >>".encode(),
    ).data


PLACEHOLDER: Final = b"0000000000"


def signed() -> tuple[bytes, int, int]:
    """A bill with a signature whose byte range covers the whole first revision; its catalog
    and next free object number."""
    first = first_extra_object(1)
    contents = b"<" + b"0" * 512 + b">"
    signature = (
        b"<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 "
        + b" ".join([PLACEHOLDER] * 3)
        + b"] /Contents "
        + contents
        + b" /M (D:20261001120000Z) >>"
    )
    widget = (
        f"<< /FT /Sig /T (Signature1) /V {first} 0 R /Type /Annot /Subtype /Widget "
        "/Rect [0 0 0 0] /P 6 0 R /F 132 >>"
    ).encode()
    built = document(
        [content(BILL_LINES)],
        extra_objects=[signature, widget],
        catalog_extra=f" /AcroForm << /Fields [{first + 1} 0 R] /SigFlags 3 >>".encode(),
        page_extra=f" /Annots [{first + 1} 0 R]".encode(),
    )
    data = built.data
    start = data.index(contents)
    gap_end = start + len(contents)
    ranges = b" ".join(f"{value:010d}".encode() for value in (start, gap_end, len(data) - gap_end))
    patched = data.replace(b" ".join([PLACEHOLDER] * 3), ranges, 1)
    assert len(patched) == len(data)
    return patched, built.catalog, built.size


def edited_after_signing() -> bytes:
    data, catalog, size = signed()
    page = content([Text(72, 560, "Amount due: 98.20", font="F2")])
    page_dict = (
        "<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R "
        f"/F2 2 0 R /F3 3 0 R >> >> /Contents {size} 0 R /Annots [8 0 R] >>"
    ).encode()
    return append_increment(data, {size: stream(page), 6: page_dict}, root=catalog, size=size)


SIGNED_PAGE: Final = (
    "<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R "
    "/F2 2 0 R /F3 3 0 R >> >> /Contents {contents} 0 R /Annots [{annots}] >>"
)
"""The signed bill's page (object 6), as an increment rewrites it."""

SECOND_SIGNATURE: Final = 10
"""The second signature's objects: its value, its field and widget, the widget's appearance and
the appearance's font, numbered from here."""


def signed_twice(
    *,
    extra: dict[int, bytes] | None = None,
    contents: int = 5,
    annots: str = "8 0 R 11 0 R",
    fields: str = "8 0 R 11 0 R",
) -> bytes:
    """The signed bill signed again by a second party in one incremental update (K11): the new
    signature's value, its visible field and widget with an appearance and that appearance's
    font, the AcroForm gaining the field and the page gaining the widget, as a signing tool
    writes them. ``extra`` adds or replaces objects in that same increment; ``contents``,
    ``annots`` and ``fields`` change what the page and the AcroForm name."""
    data, catalog, size = signed()
    assert size == SECOND_SIGNATURE
    value, field, appearance, font = size, size + 1, size + 2, size + 3
    hex_contents = b"<" + b"1" * 512 + b">"
    signature = (
        b"<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 "
        + b" ".join([PLACEHOLDER] * 3)
        + b"] /Contents "
        + hex_contents
        + b" /M (D:20261008120000Z) >>"
    )
    widget = (
        f"<< /FT /Sig /T (Signature2) /V {value} 0 R /Type /Annot /Subtype /Widget "
        f"/Rect [320 80 540 120] /P 6 0 R /F 4 /AP << /N {appearance} 0 R >> >>"
    ).encode()
    shown = stream(
        b"BT /F1 9 Tf 4 14 Td (Signed by the landlord) Tj ET",
        f"/Type /XObject /Subtype /Form /BBox [0 0 220 40] /Resources << /Font << /F1 {font} 0 R "
        ">> >>".encode(),
    )
    catalog_body = (
        f"<< /Type /Catalog /Pages 4 0 R /AcroForm << /Fields [{fields}] /SigFlags 3 >> >>"
    ).encode()
    objects = {
        value: signature,
        field: widget,
        appearance: shown,
        font: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        catalog: catalog_body,
        6: SIGNED_PAGE.format(contents=contents, annots=annots).encode(),
        **(extra or {}),
    }
    out = append_increment(data, objects, root=catalog, size=size)
    start = out.index(hex_contents)
    gap_end = start + len(hex_contents)
    ranges = b" ".join(f"{n:010d}".encode() for n in (start, gap_end, len(out) - gap_end))
    patched = out.replace(b" ".join([PLACEHOLDER] * 3), ranges, 1)
    assert len(patched) == len(out)
    return patched


def extended_for_validation() -> bytes:
    """The signed bill with a DSS-only increment (long-term validation), which is no edit."""
    data, catalog, size = signed()
    certificate = stream(b"\x30\x82\x01\x0a synthetic certificate")
    dss = f"<< /Type /DSS /Certs [{size} 0 R] >>".encode()
    first = first_extra_object(1)
    catalog_body = (
        f"<< /Type /Catalog /Pages 4 0 R /AcroForm << /Fields [{first + 1} 0 R] /SigFlags 3 >> "
        f"/DSS {size + 1} 0 R >>"
    ).encode()
    return append_increment(
        data, {size: certificate, size + 1: dss, catalog: catalog_body}, root=catalog, size=size
    )


def edited() -> bytes:
    """The bill with an incremental update that changes its producer."""
    built = document([content(BILL_LINES)], info=INFO)
    assert built.info is not None
    info = b"<< /Producer (PDF Editor Pro 9) /ModDate (D:20261015090000Z) >>"
    return append_increment(
        built.data, {built.info: info}, root=built.catalog, size=built.size, info=built.info
    )


def two_column_line() -> bytes:
    """A label and its value far apart on one baseline, and a line written in two pieces."""
    return document(
        [
            content(
                [
                    Text(72, 700, "Amount due:"),
                    Text(450, 700, "48.20"),
                    Text(72, 680, "Billing period: "),
                    Text(144.7, 680, "01 Jul 2026"),
                ]
            )
        ]
    ).data


def text_clip_hides_what_follows() -> bytes:
    """A clip-only (mode 7) line left open: its glyphs become the clip for the rest of the page,
    so the line after it is in the text layer but never painted."""
    return document(
        [
            content(
                [
                    Text(72, 700, "Statement date: 30 September 2026"),
                    Text(72, 400, "x", render_mode=7, size=1),
                    Text(72, 560, "Amount due: 48.20"),
                ]
            )
        ]
    ).data
