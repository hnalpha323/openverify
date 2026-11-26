"""tools/synthetic_poa.py, the core: the page model, our own minimal PDF writer, rasters, photos.

Every property is checked with an independent reader (PDFium through pypdfium2's raw API, pypdf
in strict mode, Pillow), never with the writer's own account of what it wrote.
"""

from __future__ import annotations

import io
import re
import unicodedata
import uuid
from datetime import UTC, datetime

import numpy as np
import pytest
from PIL import Image

from synthetic_poa import (
    LETTER,
    PAPER,
    REMAPPED_DIGITS,
    WHITE,
    Box,
    Page,
    PdfMeta,
    Text,
    Xmp,
    deterministic_uuid,
    pdf_date,
    photo_region,
    photograph,
    raster,
    text_width,
    visible_lines,
    write_pdf,
)
from synthetic_poa_checks import (
    catalog,
    filled_paths,
    has_valid_xref,
    is_linearized,
    page_count,
    page_text,
    reader,
    signature_byte_ranges,
    text_objects,
    trailer_ends,
)

WHEN = datetime(2026, 10, 11, 9, 30, tzinfo=UTC)
FILE_ID = bytes(range(16))

BILL = Page(
    items=(
        Text(72, 72, "UTOPIA WATER BOARD", size=18, font="Helvetica-Bold"),
        Text(72, 120, "Statement date: 11 Oct 2026", role="issue-date"),
        Text(540, 160, "48.20", align="right", role="amount"),
        Text(72, 200, "Peñón 7, Villaserena: 48,20 EUR"),
        Box(70, 300, 200, 40, fill=(230, 236, 244), stroke=(150, 156, 168)),
        Text(72, 400, "hidden note", invisible=True),
    )
)


def meta(**overrides: object) -> PdfMeta:
    values: dict[str, object] = {
        "file_id": FILE_ID,
        "producer": "Utopia Billing 4.2",
        "creator": "Utopia statement service",
        "title": "Water statement",
        "created": WHEN,
        "modified": WHEN,
        "xmp": Xmp(
            creator_tool="Utopia statement service",
            producer="Utopia Billing 4.2",
            create_date=WHEN,
            modify_date=WHEN,
            metadata_date=WHEN,
            document_id="uuid:00000000-0000-4000-8000-000000000001",
            instance_id="uuid:00000000-0000-4000-8000-000000000002",
            history_agents=("Utopia statement service",),
        ),
    }
    values.update(overrides)
    return PdfMeta(**values)  # type: ignore[arg-type]


# --- the page model ------------------------------------------------------------------------------


def test_text_width_follows_the_adobe_core_metrics() -> None:
    # Helvetica: A 667, m 833, o u n d e 556, t and space 278 (per 1000 em).
    assert text_width("Amount due", "Helvetica", 10) == pytest.approx(53.92)
    assert text_width("abc", "Courier", 10) == pytest.approx(18.0)
    assert text_width("148.20", "Helvetica-Remapped", 12) == text_width("148.20", "Helvetica", 12)


def test_visible_lines_leave_out_invisible_text() -> None:
    assert visible_lines(BILL) == [
        "UTOPIA WATER BOARD",
        "Statement date: 11 Oct 2026",
        "48.20",
        "Peñón 7, Villaserena: 48,20 EUR",
    ]


# --- the writer -----------------------------------------------------------------------------------


def test_a_written_pdf_parses_strictly_and_carries_every_line() -> None:
    data, truth = write_pdf([BILL], meta())

    assert data.startswith(b"%PDF-1.7\n")
    assert data.endswith(b"%%EOF\n")
    parsed = reader(data)
    assert len(parsed.pages) == 1
    assert [float(v) for v in parsed.pages[0].mediabox] == [0.0, 0.0, *LETTER]
    assert has_valid_xref(data)
    assert trailer_ends(data) == 1
    objects = text_objects(data)
    assert [obj.text for obj in objects] == [
        "UTOPIA WATER BOARD",
        "Statement date: 11 Oct 2026",
        "48.20",
        "Peñón 7, Villaserena: 48,20 EUR",
        "hidden note",
    ]
    assert [obj.render_mode for obj in objects] == [0, 0, 0, 0, 3]
    assert objects[0].font == "Helvetica-Bold"
    assert objects[0].size == pytest.approx(18)
    assert (truth.revisions, truth.eof_markers, truth.signatures) == (1, 1, 0)
    assert not truth.linearized
    assert not truth.xref_repaired


def test_the_whole_winansi_repertoire_reaches_the_text_layer() -> None:
    line = "Señal ¿Qué? ¡Sí! Straße, garçon, 48,20 \u20ac \u2013 fin"

    data, _ = write_pdf([Page(items=(Text(72, 72, line),))], meta())

    assert page_text(data) == line


def test_lines_sit_where_the_layout_puts_them() -> None:
    data, _ = write_pdf([BILL], meta())
    by_text = {obj.text: obj for obj in text_objects(data)}

    left, bottom, _, _ = by_text["Statement date: 11 Oct 2026"].bounds
    assert left == pytest.approx(72, abs=1.0)
    assert bottom == pytest.approx(LETTER[1] - 120, abs=3.0)  # the baseline, less a descent
    _, _, right, _ = by_text["48.20"].bounds
    assert right == pytest.approx(540, abs=1.0)  # right-aligned amounts end at x


def test_boxes_are_filled_paths_in_their_colour() -> None:
    data, _ = write_pdf([BILL], meta())

    (path,) = filled_paths(data)
    assert path.rgba == (230, 236, 244, 255)
    left, bottom, right, top = path.bounds
    assert [left, bottom, right, top] == pytest.approx(
        [70, LETTER[1] - 340, 270, LETTER[1] - 300], abs=1
    )


def test_the_remapped_font_extracts_other_digits_than_it_paints() -> None:
    page = Page(items=(Text(72, 100, "Amount due: 148.20", font="Helvetica-Remapped"),))

    data, truth = write_pdf([page], meta())

    ((key, value),) = REMAPPED_DIGITS.items()
    assert page_text(data) == "Amount due: 148.20".replace(key, value)
    assert "Helvetica" in truth.fonts


def test_info_and_xmp_say_what_the_metadata_holds() -> None:
    data, _ = write_pdf([BILL], meta())

    info = reader(data).metadata
    assert info is not None
    assert info.producer == "Utopia Billing 4.2"
    assert info.creator == "Utopia statement service"
    assert info.title == "Water statement"
    assert str(info["/CreationDate"]) == "D:20261011093000Z"
    xmp = re.search(rb"<x:xmpmeta.*?</x:xmpmeta>", data, re.DOTALL)
    assert xmp is not None
    packet = xmp.group(0).decode("utf-8")
    assert "<xmp:CreatorTool>Utopia statement service</xmp:CreatorTool>" in packet
    assert "<pdf:Producer>Utopia Billing 4.2</pdf:Producer>" in packet
    assert "<xmp:CreateDate>2026-10-11T09:30:00Z</xmp:CreateDate>" in packet
    assert "uuid:00000000-0000-4000-8000-000000000002" in packet
    assert "<stEvt:softwareAgent>Utopia statement service</stEvt:softwareAgent>" in packet
    assert FILE_ID.hex().upper().encode() in data


def test_without_metadata_there_is_no_info_entry_or_xmp() -> None:
    data, _ = write_pdf(
        [BILL], meta(producer=None, creator=None, title=None, created=None, modified=None, xmp=None)
    )

    assert reader(data).metadata in (None, {})
    assert b"x:xmpmeta" not in data


def test_content_streams_are_compressed_unless_asked_not_to() -> None:
    compressed, _ = write_pdf([BILL], meta())
    plain, _ = write_pdf([BILL], meta(compress=False))

    assert b"/FlateDecode" in compressed
    assert b"(UTOPIA WATER BOARD) Tj" in plain
    assert b"(UTOPIA WATER BOARD)" not in compressed
    assert page_text(plain) == page_text(compressed)


def test_the_writer_is_deterministic() -> None:
    assert write_pdf([BILL, BILL], meta())[0] == write_pdf([BILL, BILL], meta())[0]
    assert page_count(write_pdf([BILL, BILL], meta())[0]) == 2


def test_a_goto_open_action_is_not_active_content() -> None:
    data, truth = write_pdf([BILL], meta(open_action="goto"))

    action = catalog(data)["/OpenAction"]
    assert action["/S"] == "/GoTo"
    assert truth.actions == {}


def test_a_javascript_open_action_is_counted() -> None:
    data, truth = write_pdf([BILL], meta(open_action="javascript"))

    action = catalog(data)["/OpenAction"]
    assert action["/S"] == "/JavaScript"
    assert truth.actions == {"javascript": 1}


def test_a_shifted_xref_makes_pdfium_repair_the_table() -> None:
    data, truth = write_pdf([BILL], meta(xref_shift=7))

    assert not has_valid_xref(data)
    assert "UTOPIA WATER BOARD" in page_text(data)  # repaired, still readable
    assert truth.xref_repaired


def test_raw_xmp_is_written_verbatim() -> None:
    packet = b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta/><?xpacket end="w"?>'

    data, _ = write_pdf([BILL], meta(raw_xmp=packet))

    assert packet in data


# --- linearized and signed files ------------------------------------------------------------------


def test_a_linearized_file_is_linearized_for_pdfium() -> None:
    data, truth = write_pdf([BILL], meta(linearized=True))

    assert is_linearized(data)
    assert reader(data).pages[0].extract_text().startswith("UTOPIA WATER BOARD")
    head = data[:1024]
    match = re.search(rb"/Linearized 1 /L (\d+) .*?/O (\d+) .*?/N 1 ", head)
    assert match is not None
    assert int(match.group(1)) == len(data)
    assert trailer_ends(data) == 2  # the first-page section and the main one
    assert data.count(b"%%EOF") == 2
    # C60.1: the first-page section a /Linearized dictionary declares is not a revision.
    assert (truth.revisions, truth.eof_markers, truth.linearized) == (1, 2, True)


def test_only_a_one_page_document_is_linearized() -> None:
    with pytest.raises(ValueError, match="one page"):
        write_pdf([BILL, BILL], meta(linearized=True))


def test_a_signed_file_signs_every_byte_but_the_signature() -> None:
    data, truth = write_pdf([BILL], meta(signed=True))

    (byte_range,) = signature_byte_ranges(data)
    start, first, second_start, second = byte_range
    assert start == 0
    assert second_start + second == len(data)
    assert data[first : first + 1] == b"<"
    assert data[second_start - 1 : second_start] == b">"
    assert re.fullmatch(rb"<0+>", data[first:second_start])
    assert truth.signatures == 1
    assert catalog(data)["/AcroForm"]["/SigFlags"] == 3


# --- small helpers ------------------------------------------------------------------------------


def test_pdf_dates_are_utc_d_strings() -> None:
    assert pdf_date(WHEN) == "D:20261011093000Z"


def test_deterministic_uuids_are_stable_v4_ids() -> None:
    first = deterministic_uuid("seed-a")

    assert first == deterministic_uuid("seed-a")
    assert first != deterministic_uuid("seed-b")
    assert first.startswith("uuid:")
    assert uuid.UUID(first.removeprefix("uuid:")).version == 4


# --- rasters and photos -------------------------------------------------------------------------


def test_a_raster_paints_text_and_boxes_but_never_invisible_text() -> None:
    image = raster(BILL, dpi=150)

    assert image.size == (1275, 1650)
    pixels = np.asarray(image.convert("RGB")).astype(int)
    scale = 150 / 72
    header = pixels[round(55 * scale) : round(75 * scale), round(72 * scale) : round(260 * scale)]
    assert header.min() < 80  # dark ink
    box = pixels[round(305 * scale) : round(335 * scale), round(80 * scale) : round(260 * scale)]
    assert np.abs(box.mean(axis=(0, 1)) - (230, 236, 244)).max() < 3
    hidden = pixels[round(385 * scale) : round(405 * scale), round(72 * scale) : round(200 * scale)]
    assert (hidden == PAPER).all()


def test_a_photo_is_a_camera_jpeg_of_the_page() -> None:
    page = raster(BILL, dpi=150)

    data, truth = photograph(page, seed=4, taken=WHEN)

    with Image.open(io.BytesIO(data)) as photo:
        assert photo.format == "JPEG"
        assert photo.size == truth.size
        exif = photo.getexif()
        assert exif[271] == "OpenVerify"  # Make
        assert exif[272] == "Synthetic Camera"  # Model
        assert 305 not in exif  # no Software: a camera saved it
        assert exif.get_ifd(0x8769)[36867] == "2026:10:11 09:30:00"  # DateTimeOriginal
    assert truth.jpeg_quality == 88
    assert truth.exif_software is None
    width, height = truth.size
    assert all(0 <= x < width and 0 <= y < height for x, y in truth.quad)


def test_an_editor_saved_photo_names_its_software() -> None:
    data, truth = photograph(raster(BILL), seed=4, taken=WHEN, software="Synthetic Editor 1.0")

    with Image.open(io.BytesIO(data)) as photo:
        assert photo.getexif()[305] == "Synthetic Editor 1.0"
    assert truth.exif_software == "Synthetic Editor 1.0"


def test_photos_are_deterministic_per_seed() -> None:
    page = raster(BILL)

    assert photograph(page, seed=4, taken=WHEN)[0] == photograph(page, seed=4, taken=WHEN)[0]
    assert photograph(page, seed=4, taken=WHEN)[0] != photograph(page, seed=5, taken=WHEN)[0]


def test_photo_region_finds_a_page_box_in_the_photo() -> None:
    marked = Page(items=(Box(200, 300, 150, 60, fill=(0, 0, 0)),))
    page = raster(marked)

    data, _ = photograph(page, seed=9, taken=WHEN)
    scale = 150 / 72
    left, top, right, bottom = photo_region(
        page, (200 * scale, 300 * scale, 150 * scale, 60 * scale), seed=9
    )

    with Image.open(io.BytesIO(data)) as photo:
        gray = np.asarray(photo.convert("L")).astype(int)
    inside = gray[top + 6 : bottom - 6, left + 6 : right - 6]
    around = gray[max(0, top - 60) : top - 20, left:right]
    assert inside.mean() < 70
    assert around.mean() > 150
    assert (right - left) > 150 * scale * 0.8


def test_photos_keep_white_pages_bright() -> None:
    blank = raster(Page(items=(Box(0, 0, *LETTER, fill=WHITE),)))

    data, truth = photograph(blank, seed=2, taken=WHEN)

    with Image.open(io.BytesIO(data)) as photo:
        gray = np.asarray(photo.convert("L")).astype(int)
    xs = [x for x, _ in truth.quad]
    ys = [y for _, y in truth.quad]
    centre = gray[round(np.mean(ys)) - 50 : round(np.mean(ys)) + 50, round(np.mean(xs)) - 50 :]
    assert centre[:, :100].mean() > 200


# --- accented letters in rasters (Pillow's bundled font has none) ---------------------------------


def ink(text: str) -> np.ndarray:
    """Dark pixels of ``text`` drawn alone at 40 pt, baseline at 100 pt from the top."""
    image = raster(Page(width=200, height=140, items=(Text(40, 100, text, size=40),)), dpi=72)
    gray: np.ndarray = np.asarray(image.convert("L")) < 128
    return gray


@pytest.mark.parametrize("letter", list("áéíóúñüÁÉÍÓÚÑÜàèêâôûëïäöãõ"))
def test_an_accented_letter_is_its_base_letter_with_a_mark_above(letter: str) -> None:
    base = unicodedata_base(letter)
    accented, plain = ink(letter), ink(base)
    top_of_base = np.flatnonzero(plain.any(axis=1)).min()
    if base == "i":  # an accented i loses its dot: compare with the stem, up to the x-height
        top_of_base = np.flatnonzero(ink("x").any(axis=1)).min()
        plain[: top_of_base - 1] = False

    extra = accented & ~plain
    assert extra.sum() > 8  # the mark
    rows = np.flatnonzero(extra.any(axis=1))
    assert rows.max() < top_of_base + 3  # above the letter, not a missing-glyph box


@pytest.mark.parametrize("letter", ["ç", "Ç"])
def test_a_cedilla_hangs_below_the_baseline(letter: str) -> None:
    accented, plain = ink(letter), ink(unicodedata_base(letter))

    extra = accented & ~plain
    assert extra.sum() > 4
    assert np.flatnonzero(extra.any(axis=1)).min() >= np.flatnonzero(plain.any(axis=1)).max() - 3


@pytest.mark.parametrize(("inverted", "mark"), [("¿", "?"), ("¡", "!")])
def test_inverted_marks_are_their_marks_upside_down(inverted: str, mark: str) -> None:
    upside_down, upright = ink(inverted), ink(mark)

    rows = np.flatnonzero(upside_down.any(axis=1))
    upright_rows = np.flatnonzero(upright.any(axis=1))
    assert upside_down.sum() == pytest.approx(upright.sum(), rel=0.25)
    assert rows.max() > upright_rows.max() + 3  # it descends below the baseline


@pytest.mark.parametrize("char", ["\u20ac", "\u00df", "\uffff"])
def test_a_raster_refuses_a_character_it_cannot_draw(char: str) -> None:
    with pytest.raises(ValueError, match="cannot draw"):
        raster(Page(items=(Text(72, 72, f"x{char}y"),)))


def test_an_accented_i_has_no_dot_under_its_mark() -> None:
    accented, dotted = ink("í"), ink("i")

    dot_rows = np.flatnonzero(dotted.any(axis=1))
    stem_top = np.flatnonzero(ink("x").any(axis=1)).min()
    dot = dotted[dot_rows.min() : stem_top - 1]
    assert dot.any()
    assert not (accented[dot_rows.min() : stem_top - 1] & dot).all(axis=None)


def test_lines_with_accents_keep_their_width_and_right_alignment() -> None:
    left = raster(Page(width=300, height=60, items=(Text(250, 40, "Ibáñez", align="right"),)))
    plain = raster(Page(width=300, height=60, items=(Text(250, 40, "Ibanez", align="right"),)))

    cols = np.flatnonzero((np.asarray(left.convert("L")) < 128).any(axis=0))
    plain_cols = np.flatnonzero((np.asarray(plain.convert("L")) < 128).any(axis=0))
    assert cols.max() == pytest.approx(plain_cols.max(), abs=2)
    assert cols.min() == pytest.approx(plain_cols.min(), abs=2)


def unicodedata_base(letter: str) -> str:
    """The base letter of ``letter`` (``n`` for ``ñ``)."""
    return unicodedata.normalize("NFD", letter)[0]
