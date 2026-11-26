"""Synthetic TD1 identity card (front and back) rendered with Pillow.

The "photo" here is a synthetic gradient, not a face: these tests check layout, determinism
and image quality. Real portraits are exercised in ``test_real_faces.py``.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from icao_mrz import check_digit, td1_lines
from openverify_vision.quality import blur_score, glare_ratio
from specimen_markers import ICAO_EXAMPLE_NAMES, ICAO_EXAMPLE_NUMBERS, markers_in, mrz_words
from synthetic_id import (
    BANNER,
    CARD_SIZE,
    HAPPY_DOCUMENT,
    HAPPY_HOLDER,
    PORTRAIT_BOX,
    back_text,
    background,
    fit_box,
    front_fields,
    front_text,
    mm,
    portrait_crop_box,
    render_back,
    render_front,
    td1_data,
    value_box,
)

FACE_BOX = (150, 120, 100, 130)


def fake_photo(width: int = 400, height: int = 500) -> Image.Image:
    """A smooth synthetic gradient with a darker rectangle where a face would be."""
    yy, xx = np.mgrid[0:height, 0:width]
    rgb = np.stack([60 + xx * 120 // width, 80 + yy * 100 // height, 140 + 0 * xx], axis=-1)
    rgb[120:250, 150:250] = (120, 90, 70)
    return Image.fromarray(rgb.astype(np.uint8), "RGB")


def bgr(image: Image.Image) -> np.ndarray:
    return np.ascontiguousarray(np.asarray(image.convert("RGB"))[..., ::-1])


# --- geometry -------------------------------------------------------------------------------


def test_card_is_id1_size_at_twelve_pixels_per_millimetre() -> None:
    assert CARD_SIZE == (1027, 648)  # 85.60 x 53.98 mm


def test_portrait_sits_in_the_left_zone() -> None:
    x, y, w, h = PORTRAIT_BOX

    assert (x, y, w, h) == (36, 132, 300, 384)  # 3 mm, 11 mm, 25 x 32 mm
    assert x + w < CARD_SIZE[0] // 2
    assert y + h < CARD_SIZE[1]


@pytest.mark.parametrize(
    ("box", "size", "expected"),
    [
        ((10.0, 20.0, 50.0, 60.0), (200, 200), (10, 20, 60, 80)),  # already inside
        ((-10.0, -5.0, 50.0, 60.0), (200, 200), (0, 0, 50, 60)),  # shifted inside
        ((180.0, 170.0, 50.0, 60.0), (200, 200), (150, 140, 200, 200)),
        ((0.0, 0.0, 400.0, 300.0), (200, 200), (0, 50, 200, 200)),  # shrunk, then shifted in
    ],
)
def test_fit_box_keeps_aspect_and_stays_inside(
    box: tuple[float, float, float, float],
    size: tuple[int, int],
    expected: tuple[int, int, int, int],
) -> None:
    assert fit_box(*box, image_size=size) == expected


def test_portrait_crop_frames_the_face_like_an_id_photo() -> None:
    left, top, right, bottom = portrait_crop_box(FACE_BOX, (400, 500))

    width, height = right - left, bottom - top
    assert width / height == pytest.approx(300 / 384, abs=0.01)
    assert FACE_BOX[3] / height == pytest.approx(0.6, abs=0.01)  # face fills 60% of the height
    assert (left + right) / 2 == pytest.approx(200, abs=1)  # centred on the face
    assert top == pytest.approx(120 - 0.2 * height, abs=1)


# --- MRZ data -------------------------------------------------------------------------------


def test_happy_document_mrz() -> None:
    data = td1_data(HAPPY_HOLDER, HAPPY_DOCUMENT)

    assert (data.issuing_state, data.nationality, data.document_code) == ("UTO", "UTO", "ID")
    assert (data.surname, data.given_names) == ("CALDERWOOD", "NORA")
    assert data.document_number == "UT4829163"
    line1, line2, _ = td1_lines(data)
    assert line1[14] == str(check_digit(data.document_number))
    assert line2[29] == str(check_digit(line1[5:30] + line2[0:7] + line2[8:15] + line2[18:29]))


# --- C36: the happy-path card carries no specimen marker ---------------------------------------


def test_the_happy_card_prints_no_specimen_marker() -> None:
    printed = (*front_text(), *back_text())
    mrz = mrz_words(td1_lines(td1_data(HAPPY_HOLDER, HAPPY_DOCUMENT)))

    assert markers_in(printed) == set()
    assert markers_in(mrz) == set()


def test_the_marker_helper_finds_whole_words_only() -> None:
    assert markers_in(["Spécimen card", "1 sample street", "NOT A REAL DOCUMENT"]) == {
        "SPECIMEN",
        "SAMPLE",
        "NOT A REAL DOCUMENT",
    }
    assert markers_in(["SAMPLES", "AVOIDED", "PROVEN", "TEST", "SYNTHETIC"]) == set()


def test_the_banner_names_the_card_a_synthetic_test_card() -> None:
    banner: str = BANNER

    assert banner == "OpenVerify synthetic test card"
    assert banner in front_text()


def test_a_front_can_print_another_banner_in_the_banner_line_only() -> None:
    other = "SPECIMEN - NOT A REAL DOCUMENT"

    printed = front_text(banner=other)
    assert printed[-1] == other
    assert BANNER not in printed
    assert printed[:-1] == front_text()[:-1]

    default = np.asarray(render_front(None, None), dtype=np.int16)
    changed = np.asarray(render_front(None, None, banner=other), dtype=np.int16)
    rows = np.nonzero(np.abs(changed - default).sum(axis=(1, 2)))[0]
    assert rows.size > 0
    assert rows.min() >= mm(42.5) - 2  # the banner line; nothing above it changes


def test_the_happy_holder_is_no_icao_example_person_or_number() -> None:
    names = f"{HAPPY_HOLDER.surname} {HAPPY_HOLDER.given_names}".split()
    lines = td1_lines(td1_data(HAPPY_HOLDER, HAPPY_DOCUMENT))

    assert set(names).isdisjoint(ICAO_EXAMPLE_NAMES)
    assert HAPPY_DOCUMENT.document_number not in ICAO_EXAMPLE_NUMBERS
    assert not any(number in "".join(lines) for number in ICAO_EXAMPLE_NUMBERS)


def test_every_printed_value_is_on_the_card_text() -> None:
    printed = (*front_text(), *back_text())

    for value in (
        HAPPY_HOLDER.surname,
        HAPPY_HOLDER.given_names,
        HAPPY_HOLDER.address,
        HAPPY_DOCUMENT.document_number,
        HAPPY_DOCUMENT.authority,
    ):
        assert value in printed


# --- rendering ------------------------------------------------------------------------------


def test_front_is_deterministic_and_carries_the_portrait() -> None:
    first = render_front(fake_photo(), FACE_BOX)
    second = render_front(fake_photo(), FACE_BOX)

    assert first.size == CARD_SIZE
    assert first.mode == "RGB"
    assert first.tobytes() == second.tobytes()
    x, y, w, h = PORTRAIT_BOX
    region = np.asarray(first)[y + 10 : y + h - 10, x + 10 : x + w - 10]
    crop = fake_photo().crop(portrait_crop_box(FACE_BOX, (400, 500))).resize((w, h))
    expected = np.asarray(crop)[10:-10, 10:-10]
    assert np.abs(region.astype(int) - expected.astype(int)).mean() < 3


def test_back_is_deterministic() -> None:
    assert render_back().tobytes() == render_back().tobytes()
    assert render_back().size == CARD_SIZE


@pytest.mark.parametrize("side", ["front", "back"])
def test_cards_are_sharp_and_free_of_glare(side: str) -> None:
    card = render_front(fake_photo(), FACE_BOX) if side == "front" else render_back()

    assert blur_score(bgr(card)) > 300
    assert glare_ratio(bgr(card)) < 0.01


def test_back_carries_an_mrz_band_at_the_bottom() -> None:
    gray = np.asarray(render_back().convert("L"))
    height = CARD_SIZE[1]

    dark_rows = np.flatnonzero((gray < 100).sum(axis=1) > 20)

    assert dark_rows.max() > height * 0.85  # third MRZ line near the bottom edge
    mrz_band = gray[int(height * 0.65) :, :]
    assert (mrz_band < 100).mean() > 0.03


def test_front_round_trips_through_jpeg() -> None:
    buffer = io.BytesIO()
    render_front(fake_photo(), FACE_BOX).save(buffer, format="JPEG", quality=92)

    assert Image.open(buffer).size == CARD_SIZE


# --- rendering options the C36 variants use -----------------------------------------------------


def _region(image: Image.Image, box: tuple[int, int, int, int]) -> np.ndarray:
    return np.asarray(image.convert("RGB"), dtype=np.int16)[box[1] : box[3], box[0] : box[2]]


def test_a_front_without_a_portrait_leaves_the_portrait_zone_blank() -> None:
    x, y, w, h = PORTRAIT_BOX
    inner = (x + 4, y + 4, x + w - 4, y + h - 4)

    blank = render_front(None, None)

    assert np.array_equal(_region(blank, inner), _region(background(), inner))
    assert not np.array_equal(
        _region(render_front(fake_photo(), FACE_BOX), inner), _region(blank, inner)
    )


def test_a_photo_needs_its_face_box() -> None:
    with pytest.raises(ValueError, match="face box"):
        render_front(fake_photo(), None)


def test_a_front_can_leave_a_field_value_blank_inside_its_value_box() -> None:
    field = next(f for f in front_fields(HAPPY_HOLDER, HAPPY_DOCUMENT) if f.label == "Given names")
    left, top, right, bottom = value_box(field)

    printed = np.asarray(render_front(fake_photo(), FACE_BOX), dtype=np.int16)
    blank = np.asarray(
        render_front(fake_photo(), FACE_BOX, skip_values=frozenset({"Given names"})), dtype=np.int16
    )

    changed_rows, changed_columns = np.nonzero(np.abs(printed - blank).sum(axis=2))
    assert changed_rows.size > 0
    assert top <= changed_rows.min()
    assert changed_rows.max() < bottom
    assert left <= changed_columns.min()
    assert changed_columns.max() < right
    assert np.array_equal(
        blank[top:bottom, left:right], _region(background(), (left, top, right, bottom))
    )


def test_a_back_draws_the_mrz_lines_it_is_given_inside_the_mrz_band() -> None:
    lines = td1_lines(td1_data(HAPPY_HOLDER, HAPPY_DOCUMENT))
    composite = "1" if lines[1][-1] == "0" else "0"
    other = (lines[0], lines[1][:-1] + composite, lines[2])

    default = np.asarray(render_back(), dtype=np.int16)
    same = np.asarray(render_back(mrz=lines), dtype=np.int16)
    changed = np.asarray(render_back(mrz=other), dtype=np.int16)

    assert np.array_equal(default, same)
    changed_rows = np.nonzero(np.abs(default - changed).sum(axis=(1, 2)))[0]
    assert changed_rows.size > 0
    assert changed_rows.min() >= CARD_SIZE[1] - 19 * 12
