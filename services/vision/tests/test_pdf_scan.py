"""C60.1, C60.2: the raw-byte PDF scanner, the bounded XMP scan and the text and date helpers.

All three run in the guarded child and use the standard library only; here they run in process
on documents built by ``tools/minimal_pdf.py`` (synthetic, V19).
"""

from __future__ import annotations

import time
import zlib
from typing import Final

import pytest

from minimal_pdf import (
    MinimalPdf,
    Text,
    append_increment,
    content,
    document,
    object_stream_document,
    pdf_string,
    stream,
)
from openverify_vision.guarded import pdf_scan
from openverify_vision.guarded.pdf_scan import Ref, scan_pdf
from openverify_vision.guarded.text import clip_text, pdf_date, xmp_date
from openverify_vision.guarded.xmp_scan import MAX_XMP_SCAN_BYTES, scan_xmp

# --- text ----------------------------------------------------------------------------------------


def test_text_is_cleaned_of_controls_and_collapsed() -> None:
    assert clip_text("  Utopia\x00 Water\r\n\tBoard\x9f ", 256) == "Utopia Water Board"


def test_text_is_cut_in_utf16_code_units_never_inside_a_character() -> None:
    assert clip_text("abcdef", 4) == "abcd"
    # U+1F4A7 takes two UTF-16 code units: it does not fit in the last one.
    assert clip_text("abc\U0001f4a7", 4) == "abc"
    assert clip_text("ab\U0001f4a7", 4) == "ab\U0001f4a7"


def test_unpaired_surrogates_are_dropped() -> None:
    assert clip_text("a\ud800b\udfffc", 16) == "abc"


@pytest.mark.parametrize("value", ["", "   ", "\x00\x01"])
def test_nothing_left_is_none(value: str) -> None:
    assert clip_text(value, 16) is None


# --- dates ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("D:20260930", "2026-09-30"),
        ("D:20260930120000", "2026-09-30T12:00:00"),
        ("D:20260930120000Z", "2026-09-30T12:00:00Z"),
        ("D:20260930120000Z00'00'", "2026-09-30T12:00:00Z"),
        ("D:20260930120000+02'00'", "2026-09-30T12:00:00+02:00"),
        ("D:20260930120000-05'30", "2026-09-30T12:00:00-05:30"),
        ("D:202609301200", "2026-09-30T12:00:00"),
        ("20260930120000", "2026-09-30T12:00:00"),
        ("D:2026", None),
        ("D:202609", None),
        ("D:20261332", None),
        ("D:20260230", None),
        ("D:20260930250000", None),
        ("yesterday", None),
        ("", None),
    ],
)
def test_pdf_dates_become_iso_8601(value: str, expected: str | None) -> None:
    assert pdf_date(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2026-09-30", "2026-09-30"),
        ("2026-09-30T12:00:00Z", "2026-09-30T12:00:00Z"),
        ("2026-09-30T12:00:00.123+02:00", "2026-09-30T12:00:00+02:00"),
        ("2026-09-30T12:00+02:00", "2026-09-30T12:00:00+02:00"),
        ("2026-09-30T12:00:00", "2026-09-30T12:00:00"),
        ("2026-09", None),
        ("2026-02-30", None),
        ("2026-09-30T24:00:00", None),
        ("30/09/2026", None),
    ],
)
def test_xmp_dates_become_the_contracts_iso_8601(value: str, expected: str | None) -> None:
    assert xmp_date(value) == expected


# --- the XMP scan --------------------------------------------------------------------------------

PACKET = (
    b'<?xpacket begin="\xef\xbb\xbf" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
    b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf'
    b'-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" '
    b'xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" '
    b'xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#" '
    b'xmp:CreatorTool="Utopia Billing 4.2" xmp:CreateDate="2026-09-30T10:00:00+02:00" '
    b'xmpMM:DocumentID="uuid:0f1e2d3c" xmpMM:InstanceID="uuid:9a8b7c6d">'
    b"<pdf:Producer>Utopia &amp; Sons PDF</pdf:Producer>"
    b"<xmp:ModifyDate>2026-09-30T10:05:00.250+02:00</xmp:ModifyDate>"
    b"<xmp:MetadataDate>2026-09-30T10:05:00+02:00</xmp:MetadataDate>"
    b'<xmpMM:History><rdf:Seq><rdf:li stEvt:action="created" stEvt:softwareAgent="Utopia '
    b'Billing 4.2"/><rdf:li><rdf:Description stEvt:action="saved"><stEvt:softwareAgent>Edit'
    b"or &#x31;.0</stEvt:softwareAgent></rdf:Description></rdf:li></rdf:Seq></xmpMM:History>"
    b'</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>'
)


def test_the_xmp_fields_are_read_in_both_forms() -> None:
    assert scan_xmp(PACKET) == {
        "creator_tool": "Utopia Billing 4.2",
        "producer": "Utopia & Sons PDF",
        "create_date": "2026-09-30T10:00:00+02:00",
        "modify_date": "2026-09-30T10:05:00+02:00",
        "metadata_date": "2026-09-30T10:05:00+02:00",
        "document_id": "uuid:0f1e2d3c",
        "instance_id": "uuid:9a8b7c6d",
        "history_agents": ["Utopia Billing 4.2", "Editor 1.0"],
    }


def test_a_packet_without_the_fields_reads_as_nulls() -> None:
    packet = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF></rdf:RDF></x:xmpmeta>'
    assert scan_xmp(packet) == {
        "creator_tool": None,
        "producer": None,
        "create_date": None,
        "modify_date": None,
        "metadata_date": None,
        "document_id": None,
        "instance_id": None,
        "history_agents": [],
    }


def test_bytes_that_are_no_xmp_packet_are_none() -> None:
    assert scan_xmp(b"\x89PNG\r\n\x1a\n not metadata") is None


@pytest.mark.parametrize(
    "declaration",
    [
        b'<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>',
        b'<!DOCTYPE x SYSTEM "http://198.51.100.7/evil.dtd">',
        b'<!ENTITY ext SYSTEM "file:///etc/passwd">',
        b"<!doctype x>",
    ],
    ids=["entity-expansion", "external-dtd", "external-entity", "lower-case"],
)
def test_a_packet_declaring_a_doctype_or_an_entity_is_refused(declaration: bytes) -> None:
    packet = declaration + b'<x:xmpmeta><rdf:RDF xmp:CreatorTool="&b;"/></x:xmpmeta>'
    assert scan_xmp(packet) is None


def test_only_the_first_64_kib_of_a_huge_packet_is_scanned() -> None:
    # A 10 MB packet: the field inside the first 64 KiB is read, the one beyond is not, and
    # nothing grows with the packet's size.
    head = b'<x:xmpmeta><rdf:Description xmp:CreatorTool="First Tool"/>'
    padding = b" " * (10 * 1024 * 1024)
    tail = b"<pdf:Producer>Late Producer</pdf:Producer></x:xmpmeta>"
    started = time.monotonic()
    fields = scan_xmp(head + padding + tail)
    assert time.monotonic() - started < 1.0
    assert fields is not None
    assert (fields["creator_tool"], fields["producer"]) == ("First Tool", None)
    assert MAX_XMP_SCAN_BYTES == 64 * 1024


def test_history_agents_are_capped_and_long_values_cut() -> None:
    events = b"".join(b'<rdf:li stEvt:softwareAgent="Tool %d"/>' % i for i in range(40))
    long_id = b"uuid:" + b"a" * 400
    packet = (
        b'<x:xmpmeta><rdf:Description xmpMM:DocumentID="'
        + long_id
        + b'">'
        + events
        + b"</x:xmpmeta>"
    )
    fields = scan_xmp(packet)
    assert fields is not None
    assert fields["history_agents"] == [f"Tool {i}" for i in range(32)]
    assert len(fields["document_id"]) == 256


def test_a_utf16_packet_is_read() -> None:
    packet = '<x:xmpmeta><rdf:Description xmp:CreatorTool="Ünïcode Tool"/></x:xmpmeta>'
    fields = scan_xmp("﻿".encode("utf-16-le") + packet.encode("utf-16-le"))
    assert fields is not None
    assert fields["creator_tool"] == "Ünïcode Tool"


# --- the raw-byte scanner ------------------------------------------------------------------------


def simple() -> bytes:
    return document([content([Text(72, 700, "Statement date: 30 September 2026")])]).data


def test_a_single_revision_has_one_eof_and_nothing_after_it() -> None:
    scan = scan_pdf(simple())
    assert (scan.eof_markers, scan.bytes_after_last_eof, scan.revisions) == (1, 0, 1)
    assert scan.startxref_count == 1
    assert (scan.linearized, scan.encrypted, scan.truncated) == (False, False, False)


def test_bytes_appended_after_the_last_eof_are_counted_but_whitespace_is_not() -> None:
    assert scan_pdf(simple() + b"\r\n\n  \n").bytes_after_last_eof == 0
    assert scan_pdf(simple() + b"<script>x</script>\n").bytes_after_last_eof == 18


def test_an_incremental_update_is_a_second_revision() -> None:
    built = document([content([Text(72, 700, "Amount due: 48.20")])])
    edited = append_increment(
        built.data,
        {built.size: stream(content([Text(72, 700, "Amount due: 98.20")]))},
        root=built.catalog,
        size=built.size,
    )
    scan = scan_pdf(edited)
    assert (scan.eof_markers, scan.revisions, scan.startxref_count) == (2, 2, 2)
    assert scan.names["Prev"] == 1


def test_a_repeated_eof_marker_is_no_revision() -> None:
    scan = scan_pdf(simple() + b"%%EOF\n")
    assert (scan.eof_markers, scan.revisions) == (2, 1)


def test_a_linearized_first_section_is_not_a_revision() -> None:
    pdf = MinimalPdf()
    pdf.add(b"<< /Linearized 1 /L 1000 /O 3 /E 500 /N 1 /T 900 /H [100 50] >>")
    pages = pdf.add(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    pdf.add(f"<< /Type /Page /Parent {pages} 0 R /MediaBox [0 0 612 792] >>".encode())
    catalog = pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>".encode())
    data = pdf.build(root=catalog)
    # A first-page cross-reference section and trailer of its own, as Annex F lays it out.
    head, _, rest = data.partition(b"2 0 obj")
    linearized = head + b"xref\n0 0\ntrailer\n<< /Size 5 >>\nstartxref\n0\n%%EOF\n2 0 obj" + rest
    scan = scan_pdf(linearized)
    assert scan.linearized is True
    assert (scan.startxref_count, scan.revisions) == (2, 1)


def test_markers_inside_stream_data_strings_and_comments_are_not_counted() -> None:
    attachment = b"%PDF-1.4\n%%EOF\n/JS /Launch startxref\n%%EOF\n"
    page = content([Text(72, 700, "Pay /JS by %%EOF or (Launch)")])
    built = document(
        [page],
        extra_objects=[
            stream(attachment, b"/Type /EmbeddedFile", compress=False),
            b"<< /Note (/JavaScript %%EOF startxref) >>",
        ],
        compress=False,
    )
    data = built.data.replace(b"%\xe2\xe3\xcf\xd3\n", b"%\xe2\xe3\xcf\xd3\n% /JS /Launch %%\n")
    scan = scan_pdf(data)
    assert scan.eof_markers == 1
    assert scan.startxref_count == 1
    assert scan.names["JS"] == 0
    assert scan.names["Launch"] == 0
    assert scan.names["JavaScript"] == 0
    assert scan.names["EmbeddedFile"] == 1


def test_escaped_names_are_decoded_and_whole_names_only_are_counted() -> None:
    built = document(
        [content([Text(72, 700, "x")])],
        catalog_extra=b" /OpenAction << /S /J#61vaScript /J#53 (app.alert(1)) >> /AA << >>",
        extra_objects=[b"<< /JSX 1 /S /#4C#61unch /F (calc) >>", b"<< /S /GoToR /F (x.pdf) >>"],
    )
    scan = scan_pdf(built.data)
    assert scan.names["JavaScript"] == 1
    assert scan.names["JS"] == 1
    assert scan.names["Launch"] == 1
    assert scan.names["GoToR"] == 1
    assert scan.names["OpenAction"] == 1
    assert scan.names["AA"] == 1


def test_names_inside_an_object_stream_are_read() -> None:
    catalog = b"<< /Type /Catalog /Pages 1 0 R /OpenAction 4 0 R >>"
    action = b"<< /S /JavaScript /JS (app.alert(1)) >>"
    page = b"<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] >>"
    data = object_stream_document(
        {2: catalog, 3: page, 4: action},
        catalog=2,
        pages=b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    )
    scan = scan_pdf(data)
    assert scan.object_streams == 1
    assert (scan.names["JS"], scan.names["JavaScript"], scan.names["OpenAction"]) == (1, 1, 1)
    inner = {obj.number: obj for obj in scan.objects if obj.in_object_stream is not None}
    assert set(inner) == {2, 3, 4}
    assert inner[2].value["/OpenAction"] == Ref(4, 0)


def test_an_encrypt_entry_in_the_trailer_marks_the_document_encrypted() -> None:
    pdf = MinimalPdf()
    pages = pdf.add(b"<< /Type /Pages /Kids [] /Count 0 >>")
    catalog = pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>".encode())
    encrypt = pdf.add(b"<< /Filter /Standard /V 4 /R 4 /Length 128 >>")
    data = pdf.build(root=catalog, trailer_extra=f" /Encrypt {encrypt} 0 R".encode())
    assert scan_pdf(data).encrypted is True


def metadata_document(packet: bytes, *, compress: bool) -> bytes:
    meta = stream(packet, b"/Type /Metadata /Subtype /XML", compress=compress)
    page_meta = stream(b"<x:xmpmeta>page</x:xmpmeta>", b"/Type /Metadata /Subtype /XML")
    built = document(
        [content([Text(72, 700, "x")])],
        extra_objects=[page_meta, meta],
        catalog_extra=b" /Metadata 8 0 R",
    )
    return built.data


@pytest.mark.parametrize("compress", [False, True], ids=["plain", "flate"])
def test_the_catalogs_metadata_stream_is_returned(compress: bool) -> None:
    assert scan_pdf(metadata_document(PACKET, compress=compress)).metadata_packet() == PACKET


def test_a_metadata_stream_is_cut_to_64_kib() -> None:
    packet = PACKET + b" " * (200 * 1024)
    found = scan_pdf(metadata_document(packet, compress=True)).metadata_packet()
    assert found == packet[: 64 * 1024]


def test_without_a_catalog_metadata_entry_there_is_no_packet() -> None:
    meta = stream(PACKET, b"/Type /Metadata /Subtype /XML")
    built = document([content([Text(72, 700, "x")])], extra_objects=[meta])
    assert scan_pdf(built.data).metadata_packet() is None


# --- increments after a signature --------------------------------------------------------------


def signed() -> tuple[bytes, int, int]:
    """A document with a signature dictionary; the offset its byte range would end at."""
    sig = (
        b"<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 0 0 0]"
    )
    built = document(
        [content([Text(72, 700, "Lease of 14 Lantern Row")])], extra_objects=[sig + b" >>"]
    )
    return built.data, built.catalog, built.size


def test_no_increment_after_the_signature_is_no_edit() -> None:
    data, _, _ = signed()
    assert scan_pdf(data).edits_after(len(data)) is False


def test_a_content_change_after_the_signature_is_an_edit() -> None:
    data, catalog, size = signed()
    page_content = stream(content([Text(72, 700, "Lease of 41 Lantern Row")]))
    edited = append_increment(data, {size: page_content}, root=catalog, size=size)
    assert scan_pdf(edited).edits_after(len(data)) is True


def test_a_dss_only_increment_is_no_edit() -> None:
    data, catalog, size = signed()
    certs = stream(b"\x30\x82\x01\x00 synthetic certificate bytes")
    dss = f"<< /Type /DSS /Certs [{size} 0 R] /VRI << /ABCD {size + 2} 0 R >> >>".encode()
    vri = f"<< /Cert [{size} 0 R] /TU (D:20261001000000Z) >>".encode()
    catalog_body = f"<< /Type /Catalog /Pages 1 0 R /DSS {size + 1} 0 R >>".encode()
    extended = append_increment(
        data,
        {size: certs, size + 1: dss, size + 2: vri, catalog: catalog_body},
        root=catalog,
        size=size,
    )
    assert scan_pdf(extended).edits_after(len(data)) is False


def test_a_document_timestamp_only_increment_is_no_edit() -> None:
    data, catalog, size = signed()
    timestamp = b"<< /Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161 >>"
    widget = (
        f"<< /Type /Annot /Subtype /Widget /FT /Sig /T (Timestamp) /V {size} 0 R "
        "/Rect [0 0 0 0] /P 5 0 R >>"
    ).encode()
    form = f"<< /Fields [{size + 1} 0 R] /SigFlags 3 >>".encode()
    stamped = append_increment(
        data, {size: timestamp, size + 1: widget, size + 2: form}, root=catalog, size=size
    )
    assert scan_pdf(stamped).edits_after(len(data)) is False


def test_a_dss_increment_that_also_adds_page_content_is_an_edit() -> None:
    data, catalog, size = signed()
    dss = b"<< /Type /DSS /Certs [] >>"
    page_content = stream(content([Text(72, 700, "Lease of 41 Lantern Row")]))
    page = f"<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] /Contents {size + 1} 0 R >>"
    extended = append_increment(
        data, {size: dss, size + 1: page_content, 5: page.encode()}, root=catalog, size=size
    )
    assert scan_pdf(extended).edits_after(len(data)) is True


def test_an_increment_that_adds_an_annotation_after_the_signature_is_an_edit() -> None:
    data, catalog, size = signed()
    note = b"<< /Type /Annot /Subtype /FreeText /Rect [70 690 200 710] /Contents (41) >>"
    edited = append_increment(data, {size: note}, root=catalog, size=size)
    assert scan_pdf(edited).edits_after(len(data)) is True


# --- a later signature (K11, Workflow 5C review; amends C60.4) -----------------------------------

FIRST_VALUE: Final = b"<< /Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 0 0 0] /Contents <00> >>"
SECOND_VALUE: Final = b"<< /Filter /Adobe.PPKLite /ByteRange [0 0 0 0] /Contents <11> >>"
"""A signature dictionary without its optional ``/Type``."""
APPEARANCE: Final = stream(
    b"0 0 1 rg 0 0 200 40 re f", b"/Type /XObject /Subtype /Form /BBox [0 0 200 40]"
)


def indirectly_signed(*, empty_field: bool) -> bytes:
    """One signed revision whose AcroForm, field list and page annotations are all indirect
    objects; with ``empty_field``, a second signature field waits unsigned (object 10)."""
    fields = "[9 0 R 10 0 R]" if empty_field else "[9 0 R]"
    pdf = MinimalPdf()
    for body in (
        b"<< /Type /Catalog /Pages 2 0 R /AcroForm 6 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Annots 7 0 R >>",
        stream(content([Text(72, 700, "Lease of 14 Lantern Row")])),
        FIRST_VALUE,
        b"<< /Fields 8 0 R /SigFlags 3 >>",
        fields.encode(),
        fields.encode(),
        b"<< /FT /Sig /T (Tenant) /V 5 0 R /Type /Annot /Subtype /Widget /Rect [0 0 0 0] "
        b"/P 3 0 R >>",
    ):
        pdf.add(body)
    if empty_field:
        pdf.add(
            b"<< /FT /Sig /T (Landlord) /Type /Annot /Subtype /Widget /Rect [300 80 500 120] "
            b"/P 3 0 R >>"
        )
    return pdf.build(root=1)


def test_signing_an_empty_signature_field_is_no_edit() -> None:
    data = indirectly_signed(empty_field=True)
    field = (
        b"<< /FT /Sig /T (Landlord) /V 11 0 R /Type /Annot /Subtype /Widget "
        b"/Rect [300 80 500 120] /P 3 0 R /AP << /N 12 0 R >> >>"
    )
    signed_again = append_increment(
        data, {10: field, 11: SECOND_VALUE, 12: APPEARANCE}, root=1, size=11
    )
    assert scan_pdf(signed_again).edits_after(len(data)) is False


def second_field(parent_type: bytes = b"/Sig") -> dict[int, bytes]:
    """A new signature field (10) with a separate widget (13) in the indirect arrays."""
    return {
        6: b"<< /Fields 8 0 R /SigFlags 3 >>",
        7: b"[9 0 R 13 0 R]",
        8: b"[9 0 R 10 0 R]",
        10: b"<< /FT " + parent_type + b" /T (Landlord) /V 11 0 R /Kids [13 0 R] >>",
        11: SECOND_VALUE,
        12: APPEARANCE,
        13: b"<< /Type /Annot /Subtype /Widget /Parent 10 0 R /Rect [300 80 500 120] /P 3 0 R "
        b"/AP << /N 12 0 R >> >>",
    }


def test_a_new_signature_field_in_indirect_arrays_is_no_edit() -> None:
    data = indirectly_signed(empty_field=False)
    signed_again = append_increment(data, second_field(), root=1, size=10)
    assert scan_pdf(signed_again).edits_after(len(data)) is False


@pytest.mark.parametrize(
    "objects",
    [
        second_field(b"/Tx"),
        {
            **second_field(),
            7: b"[9 0 R 13 0 R 14 0 R]",
            14: b"<< /Type /Annot /Subtype /Square /Rect [0 0 9 9] >>",
        },
        {**second_field(), 6: b"<< /Fields 8 0 R /SigFlags 3 /NeedAppearances true >>"},
        {**second_field(), 7: b"[13 0 R]"},
        {**second_field(), 11: FIRST_VALUE, 5: SECOND_VALUE},
    ],
    ids=[
        "widget-of-a-text-field",
        "another-annotation",
        "acroform-changed",
        "annotation-dropped",
        "first-signature-replaced",
    ],
)
def test_a_later_signature_increment_that_changes_anything_else_is_an_edit(
    objects: dict[int, bytes],
) -> None:
    data = indirectly_signed(empty_field=False)
    signed_again = append_increment(data, objects, root=1, size=10)
    assert scan_pdf(signed_again).edits_after(len(data)) is True


def test_an_increment_without_a_new_signature_is_judged_as_before() -> None:
    data = indirectly_signed(empty_field=False)
    objects = {key: value for key, value in second_field().items() if key != 11}
    assert scan_pdf(append_increment(data, objects, root=1, size=10)).edits_after(len(data)) is True


# --- robustness ----------------------------------------------------------------------------------


# P017 (Workflow 5C review): numbers no PDF needs are never converted.

HUGE: Final = b"9" * 4_400
"""Past CPython's 4,300-digit limit for ``int()``."""


def object_stream_with_header(header: bytes) -> bytes:
    body = header + b" << /A 1 >>"
    data = zlib.compress(body)
    return (
        b"%PDF-1.7\n9 0 obj\n<< /Type /ObjStm /N 1 /First "
        + str(len(header) + 1).encode()
        + b" /Filter /FlateDecode /Length "
        + str(len(data)).encode()
        + b" >>\nstream\n"
        + data
        + b"\nendstream\nendobj\n%%EOF\n"
    )


@pytest.mark.parametrize(
    "data",
    [
        b"%PDF-1.7\n1 0 obj\n<< /Pad " + HUGE + b" >>\nendobj\n%%EOF\n",
        b"%PDF-1.7\n1 0 obj\n<< /Length 9223372036854775808 >>\nstream\nabc\nendstream\n"
        b"endobj\n%%EOF\n",
        b"%PDF-1.7\n1 0 obj\n<< /Length "
        + b"9" * 30
        + b" >>\nstream\nabc\nendstream\nendobj\n%%EOF\n",
        object_stream_with_header(b"1 " + HUGE),
    ],
    ids=["huge-integer", "length-past-2-63", "length-of-30-digits", "object-stream-header"],
)
def test_numbers_no_pdf_needs_are_scanned_without_failing(data: bytes) -> None:
    scan = scan_pdf(data)
    assert scan.eof_markers == 1


def test_a_huge_number_is_kept_as_no_value() -> None:
    scan = scan_pdf(b"%PDF-1.7\n1 0 obj\n<< /Pad " + HUGE + b" /Next 7 >>\nendobj\n%%EOF\n")
    assert scan.objects[0].value == {"/Pad": None, "/Next": 7}


@pytest.mark.parametrize("filler", [b") ", b"%c\n", b"} "], ids=["stray-close", "comment", "brace"])
def test_stray_bytes_and_comments_count_against_the_token_budget(
    monkeypatch: pytest.MonkeyPatch, filler: bytes
) -> None:
    # Workflow 5C review P012: nothing the lexer steps over one by one is free.
    monkeypatch.setattr(pdf_scan, "MAX_TOKENS", 100)
    scan = scan_pdf(b"%PDF-1.7\n" + filler * 1_000 + b"%%EOF\n")
    assert scan.truncated is True


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"%PDF-1.7\n",
        b"%PDF-1.7\n1 0 obj\n<< /A (unterminated",
        b"%PDF-1.7\n1 0 obj\n<< /Length 999999 >>\nstream\nabc",
        b"%PDF-1.7\n" + b"[" * 100_000,
        b"%PDF-1.7\n" + b"<<" * 50_000,
        b"%PDF-1.7\n1 0 obj\n(" + b"(" * 100_000,
        bytes(range(256)) * 64,
    ],
    ids=["empty", "header", "open-string", "open-stream", "arrays", "dicts", "parens", "binary"],
)
def test_hostile_bytes_are_scanned_without_failing(data: bytes) -> None:
    started = time.monotonic()
    scan = scan_pdf(data)
    assert time.monotonic() - started < 5
    assert scan.file_length == len(data)


def test_a_flate_object_stream_bomb_is_bounded() -> None:
    # 64 MB of spaces, about 64 KB compressed: the scan decodes at most its bound.
    bomb = zlib.compress(b" " * (64 * 1024 * 1024), 9)
    body = b"<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length %d >>\nstream\n" % len(
        bomb
    )
    data = b"%PDF-1.7\n9 0 obj\n" + body + bomb + b"\nendstream\nendobj\n%%EOF\n"
    started = time.monotonic()
    scan = scan_pdf(data)
    assert time.monotonic() - started < 5
    assert scan.object_streams == 1


def test_pdf_string_escapes_its_delimiters() -> None:
    assert pdf_string("a(b)c\\") == b"(a\\(b\\)c\\\\)"
