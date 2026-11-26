"""C60.1, C60.2, C60.4: the guarded child's PDF tasks, ``analyze_pdf`` and ``render_pdf_page``.

The task functions run in process here, on the synthetic documents of ``document_pdfs`` (V19);
a few run through a real guarded child to show the wiring.
"""

from __future__ import annotations

import time
from typing import Any, Final

import pytest

import document_pdfs as pdfs
from minimal_pdf import (
    MinimalPdf,
    Rect,
    Text,
    append_increment,
    content,
    document,
    first_extra_object,
    stream,
)
from openverify_vision.guarded import pdf_scan, text_layer
from openverify_vision.guarded.pdf_measure import analyze, render_page
from openverify_vision.guarded.runner import GuardedRefusal, run_guarded
from openverify_vision.guarded.worker import TaskRefusal

PDFIUM: str = "pdfium-156.0.8076.0"
PYPDF: str = "pypdf-6.21.4"


def lines_of(header: dict[str, Any], page: int = 0) -> dict[str, dict[str, Any]]:
    return {line["text"]: line for line in header["pages"][page]["text_layer"]}


def refusal(data: bytes) -> str:
    with pytest.raises(TaskRefusal) as caught:
        analyze(data)
    return caught.value.code


# --- a born-digital bill -----------------------------------------------------------------------


def test_a_bill_is_one_page_rendered_in_grey_for_the_ocr() -> None:
    header, frames = analyze(pdfs.bill())
    assert header["ok"] is True
    assert header["page_count"] == 1
    page = header["pages"][0]
    assert (page["number"], page["width_pt"], page["height_pt"]) == (1, 612.0, 792.0)
    raster = page["raster"]
    assert (raster["frame"], raster["width"], raster["height"]) == (0, 1700, 2200)
    assert len(frames) == 1
    assert len(frames[0]) == 1700 * 2200
    # Mostly white paper with black text.
    assert sum(frames[0][::997]) / len(frames[0][::997]) > 240
    assert page["embedded_jpeg"] is None


def test_the_text_layer_is_read_as_visible_lines_in_raster_pixels() -> None:
    header, _ = analyze(pdfs.bill())
    lines = header["pages"][0]["text_layer"]
    assert [line["text"] for line in lines] == [item.text for item in pdfs.BILL_LINES]
    assert all(line["visible"] and line["hidden_reason"] is None for line in lines)
    heading = lines[0]
    x, y, width, height = heading["box"]
    # 72 pt from the left at 200/72 px per pt; the baseline 52 pt below the top.
    assert x == pytest.approx(200, abs=3)
    assert y + height == pytest.approx((792 - 740) * 200 / 72 + 18 * 0.21 * 200 / 72, abs=12)
    assert height == pytest.approx(18 * 200 / 72, rel=0.35)
    assert width > 500
    assert heading["font_size_pt"] == 18.0
    assert lines[1]["font_size_pt"] == 10.0


def test_the_fonts_are_listed_once_and_named_by_each_line() -> None:
    header, _ = analyze(pdfs.bill())
    assert header["fonts"] == [
        {"id": 0, "base_name": "Helvetica", "subset_tag": None, "embedded": False},
        {"id": 1, "base_name": "Courier", "subset_tag": None, "embedded": False},
    ]
    lines = lines_of(header)
    assert lines["Statement date: 30 September 2026"]["font_ids"] == [0]
    assert lines["Amount due: 48.20"]["font_ids"] == [1]


def test_the_documents_measurements() -> None:
    header, _ = analyze(pdfs.bill())
    assert header["pdf"] == {
        "producer": "Utopia Billing 4.2",
        "creator": "Utopia Statements",
        "creation_date": "2026-09-30T10:00:00+02:00",
        "modification_date": "2026-09-30T10:05:00+02:00",
        "xmp": None,
        "linearized": False,
        "revisions": 1,
        "xref_repaired": False,
        "eof_markers": 1,
        "bytes_after_last_eof": 0,
        "object_streams": 0,
        "annotations": 0,
        "form_fields": 0,
        "actions": {
            "javascript": 0,
            "launch": 0,
            "submit_form": 0,
            "goto_remote": 0,
            "rich_media": 0,
            "embedded_files": 0,
        },
        "signatures": 0,
        "edits_after_signature": False,
    }
    assert header["versions"] == {"pdf_renderer": PDFIUM, "pdf_parser": PYPDF}


def test_a_document_without_metadata_reads_as_nulls() -> None:
    header, _ = analyze(pdfs.bill(info=False))
    pdf = header["pdf"]
    assert (pdf["producer"], pdf["creator"], pdf["creation_date"]) == (None, None, None)


# --- visibility (H10) --------------------------------------------------------------------------


def test_each_kind_of_hidden_text_is_told_apart_from_visible_text() -> None:
    lines = lines_of(analyze(pdfs.hidden_variants())[0])
    reasons = {text: line["hidden_reason"] for text, line in lines.items()}
    assert reasons == {
        "Visible heading line": None,
        "Invisible render mode": "render_mode_invisible",
        "Clip only render mode": "render_mode_invisible",
        "Far off the page": "off_page",
        "Outside its clip": "clipped",
        "Tiny text": "too_small",
        "Covered amount 98.20": "covered",
        "White on white": "background_fill",
        "White on dark band": None,
        "Black after the band": None,
    }
    assert all(line["visible"] == (line["hidden_reason"] is None) for line in lines.values())


def dense_scene(lines: int, rects: int, per_line: int = 110) -> bytes:
    """Workflow 5C review P014 (the reviewer's page): lines of 6 pt text, then small grey
    rectangles drawn after them, to their right, covering nothing."""
    items: list[Text | Rect] = [
        Text(20, 780 - (i % 70) * 10.5, f"Row {i:04d} " + "x" * (per_line - 9), size=6)
        for i in range(lines)
    ]
    items += [Rect(580, 20 + (j % 700), 2, 1, gray=0.9) for j in range(rects)]
    return document([content(items)]).data


def kept_indexes(monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    """Every page index ``analyze`` builds from now on, kept so a test can read its checks."""
    indexes: list[Any] = []
    build = text_layer._Index.__init__

    def kept(index: Any, *args: Any, **kwargs: Any) -> None:
        build(index, *args, **kwargs)
        indexes.append(index)

    monkeypatch.setattr(text_layer._Index, "__init__", kept)
    return indexes


def test_judging_a_dense_page_does_not_set_every_character_against_every_object(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 6,600 characters and 5,000 rectangles: 33 million comparisons a pass before (SIGXCPU in
    # the child); each character now meets only the objects over its own part of the page, and
    # no rectangle lies over any character's part. K8-34 (Workflow 8D): the checks are counted,
    # not timed; the CPU this took measured 0.46 s alone, 2.77 s under the suite's coverage at a
    # load of 17, 5.26 s in the gate at a load of 18, and 25.9 s under coverage's Python tracer.
    indexes = kept_indexes(monkeypatch)
    header, _ = analyze(dense_scene(60, 5_000))
    lines = header["pages"][0]["text_layer"]
    assert len(lines) == 60
    assert all(line["visible"] for line in lines)
    assert [index.checks for index in indexes] == [0]


def test_a_page_too_dense_to_judge_is_unprocessable(monkeypatch: pytest.MonkeyPatch) -> None:
    # One 12,000 pt line of 6,000 characters, then 5,000 bars across all their centres, each
    # covering about a quarter of a character: every character meets every bar, however the
    # objects are indexed, so the page is refused rather than judged for minutes.
    # K8-34 (Workflow 8D): the bound is the work, counted, not the CPU seconds it costs. The
    # same refusal measured 1.5 s of CPU alone, 8.3 s under the suite's coverage tracer at a load
    # of 17, 12.1 s beside another suite, and 60.7 s under coverage's Python tracer, all of it
    # on this thread: the tracer and the host, not the page, set the seconds.
    line = Text(10, 100, "x" * 6_000, size=4)
    bars = [Rect(0, 100.5, 14_000, 1, gray=0.5) for _ in range(5_000)]
    data = document([content([line, *bars])], media_box=(14_000, 200)).data
    indexes = kept_indexes(monkeypatch)
    assert refusal(data) == "pdf_unprocessable"
    # Refused at the first check past the budget: 6,000 x 5,000 would be 30 million.
    assert [index.checks for index in indexes] == [text_layer.MAX_SCENE_CHECKS + 1]


# P015 (Workflow 5C review): an image covers only where it paints.


def gray_image(pixels: bytes, width: int, height: int, extra: str = "") -> bytes:
    return (
        f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace "
        f"/DeviceGray /BitsPerComponent 8{extra} /Length {len(pixels)} >>\nstream\n".encode()
        + pixels
        + b"\nendstream"
    )


def bill_under_image(images: list[bytes], image: int, placement: str) -> dict[str, Any]:
    """The bill, then image object ``image`` (an extra object's index) drawn at ``placement``."""
    first = first_extra_object(1)
    page = content(list(pdfs.BILL_LINES)) + f"q {placement} cm /Im1 Do Q\n".encode()
    data = document(
        [page],
        extra_objects=images,
        resources_extra=f" /XObject << /Im1 {first + image} 0 R >>".encode(),
    ).data
    return lines_of(analyze(data)[0])


FULL_PAGE: Final = "612 0 0 792 0 0"


@pytest.mark.parametrize(
    "images",
    [
        # a watermark with its own soft mask, about 12% opaque
        [
            gray_image(b"\x20", 1, 1),
            gray_image(b"\xc0", 1, 1, f" /SMask {first_extra_object(1)} 0 R"),
        ],
        # a stencil mask whose one bit leaves everything unpainted
        [
            b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ImageMask true "
            b"/BitsPerComponent 1 /Length 1 >>\nstream\n\xff\nendstream",
            b"null",
        ],
        # a colour-key mask that masks its only colour
        [gray_image(b"\xc0", 1, 1, " /Mask [190 200]"), b"null"],
    ],
    ids=["soft-mask", "stencil", "colour-key"],
)
def test_text_under_an_image_that_paints_little_or_nothing_is_visible(images: list[bytes]) -> None:
    image = 1 if images[1] != b"null" else 0
    lines = bill_under_image(images, image, FULL_PAGE)
    assert all(line["visible"] for line in lines.values()), lines


def test_an_opaque_image_still_covers_the_text_under_it() -> None:
    lines = bill_under_image([gray_image(b"\xc0", 1, 1)], 0, FULL_PAGE)
    assert {line["hidden_reason"] for line in lines.values()} == {"covered"}


def test_an_image_covers_only_the_text_under_its_opaque_part() -> None:
    # Two rows: the top one opaque, over "QUINN VALEMONT"; the bottom one transparent, over
    # "14 LANTERN ROW".
    first = first_extra_object(1)
    images = [gray_image(b"\xff\x00", 1, 2), gray_image(b"\x80\x80", 1, 2, f" /SMask {first} 0 R")]
    lines = bill_under_image(images, 1, "340 0 0 30 60 620")
    assert lines["QUINN VALEMONT"]["hidden_reason"] == "covered"
    assert lines["14 LANTERN ROW"]["visible"] is True
    assert lines["Amount due: 48.20"]["visible"] is True


# P016 (Workflow 5C review): a clip on a form's invocation clips what the form draws.


def text_in_forms(invocation: bytes, nesting: int = 1) -> dict[str, Any]:
    """A heading, then ``nesting`` forms, one inside the next, the innermost drawing a line of
    text; the outermost is drawn with ``invocation`` (``/Fm Do`` and its clip, if any)."""
    first = first_extra_object(1)
    forms = []
    for level in range(nesting):
        last = level == nesting - 1
        inner = (
            b"BT /F1 12 Tf 72 700 Td (Statement date: 30 September 2026) Tj ET"
            if last
            else b"/Fm Do"
        )
        resources = (
            f"/Resources << /XObject << /Fm {first + level + 1} 0 R >> /Font << /F1 1 0 R >> >>"
        )
        forms.append(
            stream(inner, f"/Type /XObject /Subtype /Form /BBox [0 0 612 792] {resources}".encode())
        )
    data = document(
        [content([Text(72, 740, "UTOPIA WATER BOARD")]) + invocation],
        extra_objects=forms,
        resources_extra=f" /XObject << /Fm {first} 0 R >>".encode(),
    ).data
    return lines_of(analyze(data)[0])


DATE: Final = "Statement date: 30 September 2026"


def test_text_drawn_by_a_form_is_visible_without_a_clip() -> None:
    lines = text_in_forms(b"/Fm Do\n")
    assert (lines[DATE]["visible"], lines[DATE]["hidden_reason"]) == (True, None)


@pytest.mark.parametrize("nesting", [1, 3], ids=["form", "nested-forms"])
def test_text_drawn_by_a_form_under_a_clip_is_clipped(nesting: int) -> None:
    lines = text_in_forms(b"q 0 0 1 1 re W n /Fm Do Q\n", nesting)
    assert (lines[DATE]["visible"], lines[DATE]["hidden_reason"]) == (False, "clipped")
    assert lines["UTOPIA WATER BOARD"]["visible"] is True


def test_a_clip_inside_a_form_that_holds_the_text_leaves_it_visible() -> None:
    lines = text_in_forms(b"q 0 600 612 192 re W n /Fm Do Q\n")
    assert lines[DATE]["visible"] is True


# P013 (Workflow 5C review): past the scene walk's bounds a page is not judged by guesswork.

SPECKS: Final = [Rect(500 + (i % 50), 50 + (i // 50), 0.5, 0.5, gray=0.5) for i in range(60)]
WHITE_BOX: Final = Rect(60, 552, 200, 18, gray=1.0)
"""Over the bill's ``Amount due: 48.20``."""


def test_a_page_judged_within_the_walks_bound_is_judged_as_before(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(text_layer, "MAX_PAGE_OBJECTS", 200)
    lines = lines_of(analyze(document([content([*pdfs.BILL_LINES, *SPECKS, WHITE_BOX])]).data)[0])
    assert lines["Amount due: 48.20"]["hidden_reason"] == "covered"
    assert lines["UTOPIA WATER BOARD"]["visible"] is True


@pytest.mark.parametrize(
    "items",
    [
        [*pdfs.BILL_LINES, *SPECKS, WHITE_BOX],  # the cover past the bound: covered read visible
        [Rect(0, 0, 612, 792, gray=1.0), *SPECKS, *pdfs.BILL_LINES],  # text past it: all covered
    ],
    ids=["cover-past-the-bound", "text-past-the-bound"],
)
def test_a_page_with_more_objects_than_the_walk_records_is_unprocessable(
    monkeypatch: pytest.MonkeyPatch, items: list[Text | Rect]
) -> None:
    monkeypatch.setattr(text_layer, "MAX_PAGE_OBJECTS", 50)
    assert refusal(document([content(items)]).data) == "pdf_unprocessable"


def nested_forms(depth: int) -> bytes:
    """A line of text inside ``depth`` form XObjects, each drawing the next."""
    first = first_extra_object(1)
    forms = []
    for level in range(depth):
        last = level == depth - 1
        inner = b"BT /F1 12 Tf 72 700 Td (Deep inside forms) Tj ET" if last else b"/Fm Do"
        resources = (
            f"/Resources << /XObject << /Fm {first + level + 1} 0 R >> /Font << /F1 1 0 R >> >>"
        )
        forms.append(
            stream(inner, f"/Type /XObject /Subtype /Form /BBox [0 0 612 792] {resources}".encode())
        )
    return document(
        [content([Text(72, 740, "Heading")]) + b"/Fm Do\n"],
        extra_objects=forms,
        resources_extra=f" /XObject << /Fm {first} 0 R >>".encode(),
    ).data


def test_text_in_forms_nested_past_the_walks_depth_is_unprocessable() -> None:
    lines = lines_of(analyze(nested_forms(text_layer.MAX_FORM_DEPTH))[0])
    assert lines["Deep inside forms"]["visible"] is True  # within the depth: judged
    assert refusal(nested_forms(text_layer.MAX_FORM_DEPTH + 2)) == "pdf_unprocessable"


def test_a_label_and_a_far_value_are_two_lines_but_pieces_of_one_line_are_one() -> None:
    texts = [line["text"] for line in analyze(pdfs.two_column_line())[0]["pages"][0]["text_layer"]]
    assert texts == ["Amount due:", "48.20", "Billing period: 01 Jul 2026"]


# --- refusals and the hostile set (C60.2) -------------------------------------------------------


def test_a_document_that_needs_a_password_is_refused_as_encrypted() -> None:
    assert refusal(pdfs.encrypted("user-secret")) == "pdf_encrypted"


def test_an_owner_password_alone_does_not_stop_the_analysis() -> None:
    header, frames = analyze(pdfs.encrypted(""))
    assert header["page_count"] == 1
    assert "Amount due: 48.20" in lines_of(header)
    assert len(frames) == 1


@pytest.mark.parametrize(
    "data",
    [b"%PDF-1.7\nnot a document at all", b"%PDF-1.7\n%%EOF\n", b"%PDF-"],
    ids=["garbage", "empty-revision", "header-only"],
)
def test_an_unreadable_document_is_refused_as_unprocessable(data: bytes) -> None:
    assert refusal(data) == "pdf_unprocessable"


def test_more_than_fifty_pages_are_refused() -> None:
    assert refusal(pdfs.many_pages(51)) == "too_many_pages"


def test_fifty_pages_analyse_the_first_three_and_the_last() -> None:
    header, frames = analyze(pdfs.many_pages(50))
    assert header["page_count"] == 50
    assert [page["number"] for page in header["pages"]] == [1, 2, 3, 50]
    assert [line["text"] for line in header["pages"][3]["text_layer"]] == ["Page 50"]
    assert len(frames) == 4


def looping_page_tree() -> bytes:
    pdf = MinimalPdf()
    pages = pdf.add(b"<< /Type /Pages /Kids [1 0 R 2 0 R] /Count 2 >>")
    pdf.add(b"<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] >>")
    catalog = pdf.add(f"<< /Type /Catalog /Pages {pages} 0 R >>".encode())
    return pdf.build(root=catalog)


def test_a_page_that_cannot_be_loaded_makes_the_document_unprocessable() -> None:
    assert refusal(looping_page_tree()) == "pdf_unprocessable"
    with pytest.raises(TaskRefusal) as caught:
        render_page(looping_page_tree(), 2, 1600)
    assert caught.value.code == "pdf_unprocessable"


def test_a_page_box_over_14400_pt_is_refused_before_any_render() -> None:
    assert refusal(pdfs.oversized_page()) == "pdf_unprocessable"


def test_a_content_stream_bomb_is_refused_quickly() -> None:
    data = pdfs.content_bomb()
    assert len(data) < 200_000
    started = time.monotonic()
    assert refusal(data) == "pdf_unprocessable"
    assert time.monotonic() - started < 5


# --- what the structure says ---------------------------------------------------------------------


def test_an_incremental_update_is_a_second_revision_with_its_new_producer() -> None:
    pdf = analyze(pdfs.edited())[0]["pdf"]
    assert pdf["revisions"] == 2
    assert pdf["eof_markers"] == 2
    assert pdf["producer"] == "PDF Editor Pro 9"
    assert pdf["modification_date"] == "2026-10-15T09:00:00Z"


def test_a_javascript_open_action_is_counted() -> None:
    action = b"<< /S /JavaScript /JS (app.alert(1)) >>"
    assert analyze(pdfs.with_open_action(action))[0]["pdf"]["actions"]["javascript"] == 1


def test_a_launch_open_action_is_counted() -> None:
    action = b"<< /S /Launch /F (calc.exe) >>"
    assert analyze(pdfs.with_open_action(action))[0]["pdf"]["actions"]["launch"] == 1


def test_a_goto_open_action_is_not_active_content() -> None:
    actions = analyze(pdfs.with_open_action(b"[6 0 R /Fit]"))[0]["pdf"]["actions"]
    assert all(count == 0 for count in actions.values())


def test_annotations_and_terminal_form_fields_are_counted() -> None:
    assert analyze(pdfs.with_annotations())[0]["pdf"]["annotations"] == 2
    pdf = analyze(pdfs.with_form_fields())[0]["pdf"]
    assert pdf["form_fields"] == 3
    assert pdf["annotations"] == 3


def test_a_signature_without_a_later_increment_has_no_edits_after_it() -> None:
    pdf = analyze(pdfs.signed()[0])[0]["pdf"]
    assert (pdf["signatures"], pdf["edits_after_signature"]) == (1, False)


def test_an_edit_after_the_signature_is_reported() -> None:
    pdf = analyze(pdfs.edited_after_signing())[0]["pdf"]
    assert (pdf["signatures"], pdf["edits_after_signature"]) == (1, True)
    assert pdf["revisions"] == 2


def test_a_long_term_validation_increment_is_no_edit() -> None:
    pdf = analyze(pdfs.extended_for_validation())[0]["pdf"]
    assert (pdf["signatures"], pdf["edits_after_signature"], pdf["revisions"]) == (1, False, 2)


# P011 (Workflow 5C review): a long-term-validation increment holds only the DSS, its VRI and the
# streams they name; a stream it replaces, or one nothing in it names, is an edit.

DSS_CATALOG: Final = (
    "<< /Type /Catalog /Pages 4 0 R /AcroForm << /Fields [8 0 R] /SigFlags 3 >> /DSS {dss} 0 R >>"
)


def validation_increment(objects: dict[int, bytes]) -> bytes:
    data, catalog, _ = pdfs.signed()
    return append_increment(data, objects, root=catalog, size=pdfs.SECOND_SIGNATURE)


def certificate() -> bytes:
    return stream(b"\x30\x82\x01\x0a synthetic certificate")


def test_a_dss_increment_that_replaces_the_page_content_is_an_edit() -> None:
    # The reviewer's forgery: the page's content stream (5) replaced with a new amount, an empty
    # DSS and a catalog naming it. Each looked like DSS data; the amount is what renders.
    edited = stream(content([*pdfs.BILL_LINES[:-1], Text(72, 560, "Amount due: 9.20", font="F2")]))
    data = validation_increment(
        {5: edited, 10: b"<< /Type /DSS >>", 9: DSS_CATALOG.format(dss=10).encode()}
    )
    header, _ = analyze(data)
    assert "Amount due: 9.20" in lines_of(header)
    assert (header["pdf"]["signatures"], header["pdf"]["edits_after_signature"]) == (1, True)


def test_a_dss_increment_with_a_stream_it_does_not_name_is_an_edit() -> None:
    data = validation_increment(
        {
            10: certificate(),
            11: b"<< /Type /DSS /Certs [] >>",
            12: certificate(),
            9: DSS_CATALOG.format(dss=11).encode(),
        }
    )
    assert analyze(data)[0]["pdf"]["edits_after_signature"] is True


def test_an_object_the_document_used_rewritten_as_a_vri_is_an_edit() -> None:
    # Font 2 (the amounts' Courier) rewritten as a VRI-shaped dictionary.
    data = validation_increment(
        {
            2: b"<< /Cert [] >>",
            10: b"<< /Type /DSS /VRI << /ABCD 2 0 R >> >>",
            9: DSS_CATALOG.format(dss=10).encode(),
        }
    )
    assert analyze(data)[0]["pdf"]["edits_after_signature"] is True


def test_a_dss_updated_in_place_with_new_streams_is_no_edit() -> None:
    first = validation_increment(
        {
            10: certificate(),
            11: b"<< /Type /DSS /Certs [10 0 R] >>",
            9: DSS_CATALOG.format(dss=11).encode(),
        }
    )
    _, catalog, _ = pdfs.signed()
    again = append_increment(
        first,
        {12: certificate(), 11: b"<< /Type /DSS /Certs [10 0 R 12 0 R] >>"},
        root=catalog,
        size=12,
    )
    pdf = analyze(again)[0]["pdf"]
    assert (pdf["signatures"], pdf["edits_after_signature"], pdf["revisions"]) == (1, False, 3)


def padded_page_after_signing(pad_tokens: int) -> bytes:
    """The signed bill with an increment whose rewritten page carries ``pad_tokens`` numbers
    before it names an edited content stream (Workflow 5C review P012)."""
    data, catalog, size = pdfs.signed()
    pad = "0 " * pad_tokens
    page = (
        "<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R "
        f"/F2 2 0 R /F3 3 0 R >> >> /Pad [{pad}] /Contents {size} 0 R /Annots [8 0 R] >>"
    ).encode()
    edited = stream(content([*pdfs.BILL_LINES[:-1], Text(72, 560, "Amount due: 9.20", font="F2")]))
    return append_increment(data, {6: page, size: edited}, root=catalog, size=size)


def test_a_pdf_the_scanner_cannot_read_to_its_end_is_unprocessable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # P012: what the scan never read must not be measured as clean (no revision, no edit).
    data = padded_page_after_signing(2_000)
    pdf = analyze(data)[0]["pdf"]
    assert (pdf["revisions"], pdf["edits_after_signature"]) == (2, True)  # read to its end
    monkeypatch.setattr(pdf_scan, "MAX_TOKENS", 1_000)
    assert refusal(data) == "pdf_unprocessable"


def test_a_scanner_failure_is_a_refusal_not_a_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    # Workflow 5C review P017: should a bound still be missing, the child answers, not exits 1.
    from openverify_vision.guarded import pdf_measure  # noqa: PLC0415

    def failing(_data: bytes) -> pdf_scan.PdfScan:
        raise OverflowError("Python int too large to convert to C ssize_t")

    monkeypatch.setattr(pdf_measure, "scan_pdf", failing)
    assert refusal(pdfs.bill()) == "pdf_unprocessable"


def test_a_pdf_with_more_objects_than_the_scanner_keeps_is_unprocessable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pdf_scan, "MAX_OBJECTS", 5)
    assert refusal(pdfs.signed()[0]) == "pdf_unprocessable"


# K11 (Workflow 5C review; owner decision 5 after Workflow 5B, amends C60.4): an increment that adds
# only a later signature, and what that signature needs, is no edit after the first signature.

AMOUNT_EDITED: Final = Text(72, 560, "Amount due: 98.20", font="F2")
SECOND = pdfs.SECOND_SIGNATURE + 4
"""The first object number the second signature's increment leaves free."""


def test_a_second_signature_in_a_later_increment_is_no_edit() -> None:
    # A lease signed by tenant, then landlord: the normal multi-signature workflow.
    pdf = analyze(pdfs.signed_twice())[0]["pdf"]
    assert (pdf["signatures"], pdf["edits_after_signature"], pdf["revisions"]) == (2, False, 2)


@pytest.mark.parametrize(
    "data",
    [
        pdfs.signed_twice(extra={SECOND: stream(content([AMOUNT_EDITED]))}, contents=SECOND),
        pdfs.signed_twice(extra={5: stream(content([*pdfs.BILL_LINES[:-1], AMOUNT_EDITED]))}),
        pdfs.signed_twice(
            extra={SECOND: b"<< /Type /Annot /Subtype /FreeText /Rect [70 550 200 575] >>"},
            annots=f"8 0 R 11 0 R {SECOND} 0 R",
        ),
        pdfs.signed_twice(
            extra={
                SECOND: b"<< /FT /Tx /T (Amount) /V (98.20) /Type /Annot /Subtype /Widget "
                b"/Rect [70 550 200 575] /P 6 0 R >>"
            },
            annots=f"8 0 R 11 0 R {SECOND} 0 R",
            fields=f"8 0 R 11 0 R {SECOND} 0 R",
        ),
        pdfs.signed_twice(extra={1: b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"}),
        pdfs.signed_twice(extra={SECOND: b"<< /Producer (PDF Editor Pro 9) >>"}),
    ],
    ids=[
        "new-page-text",
        "replaced-page-text",
        "added-annotation",
        "added-text-field",
        "replaced-font",
        "unneeded-object",
    ],
)
def test_a_second_signature_increment_that_changes_anything_else_is_an_edit(data: bytes) -> None:
    pdf = analyze(data)[0]["pdf"]
    assert (pdf["signatures"], pdf["edits_after_signature"]) == (2, True)


def test_a_scanned_page_hands_its_jpeg_to_the_parent() -> None:
    jpeg = pdfs.jpeg_bytes()
    header, frames = analyze(pdfs.scanned(jpeg))
    page = header["pages"][0]
    assert page["text_layer"] == []
    embedded = page["embedded_jpeg"]
    assert embedded["frame"] == 1
    assert (embedded["pixel_width"], embedded["pixel_height"]) == (1224, 1584)
    assert embedded["axis_aligned"] is True
    assert embedded["box"] == pytest.approx([0, 0, 1700, 2200], abs=2)
    assert frames[1] == jpeg


# --- the preview render (C60.4) ------------------------------------------------------------------


def test_a_page_renders_in_rgb_at_most_1600_px_a_side() -> None:
    header, frames = render_page(pdfs.bill(), 1, 1600)
    raster = header["raster"]
    assert header["page_count"] == 1
    assert (raster["width"], raster["height"]) == (1236, 1600)
    assert len(frames[0]) == 1236 * 1600 * 3


def test_a_small_page_renders_at_no_more_than_200_dpi() -> None:
    small = document([content([Text(10, 50, "x")])], media_box=(100.0, 100.0)).data
    raster = render_page(small, 1, 1600)[0]["raster"]
    assert (raster["width"], raster["height"]) == (278, 278)


def test_a_page_beyond_the_document_is_refused() -> None:
    with pytest.raises(TaskRefusal) as caught:
        render_page(pdfs.bill(), 2, 1600)
    assert caught.value.code == "page_out_of_range"


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (pdfs.encrypted("user-secret"), "pdf_encrypted"),
        (pdfs.many_pages(51), "too_many_pages"),
        (pdfs.oversized_page(), "pdf_unprocessable"),
    ],
    ids=["encrypted", "too-many-pages", "oversized"],
)
def test_the_render_refuses_what_the_analysis_refuses(data: bytes, code: str) -> None:
    with pytest.raises(TaskRefusal) as caught:
        render_page(data, 1, 1600)
    assert caught.value.code == code


# --- through a real guarded child ----------------------------------------------------------------


def test_the_analysis_runs_in_the_guarded_child() -> None:
    answer = run_guarded("analyze_pdf", pdfs.bill())
    assert answer.header["page_count"] == 1
    assert [len(frame) for frame in answer.frames] == [1700 * 2200]


def test_the_render_runs_in_the_guarded_child() -> None:
    answer = run_guarded("render_pdf_page", pdfs.bill(), {"page": 1, "max_side": 1600})
    assert len(answer.frames[0]) == 1236 * 1600 * 3


def test_a_refusal_crosses_the_guard_with_its_code() -> None:
    with pytest.raises(GuardedRefusal) as caught:
        run_guarded("analyze_pdf", pdfs.encrypted("user-secret"))
    assert caught.value.code == "pdf_encrypted"
