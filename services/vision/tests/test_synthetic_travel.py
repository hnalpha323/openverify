"""Synthetic Utopia travel documents (C36): a TD3 passport data page and an MRV-A visa.

The "photo" is a synthetic gradient; these tests check layout, the machine-readable zone and
image quality. Neither document prints a specimen marker or an ICAO example person or number.
"""

from __future__ import annotations

import io
from datetime import date

import numpy as np
import pytest
from PIL import Image

from mrz_checks import mrv_digits, td3_digits, yymmdd
from openverify_vision.quality import blur_score, glare_ratio
from specimen_markers import ICAO_EXAMPLE_NAMES, ICAO_EXAMPLE_NUMBERS, markers_in, mrz_words
from synthetic_id import BANNER, HAPPY_HOLDER
from synthetic_travel import (
    DG2_PORTRAIT_SIZE,
    HAPPY_PASSPORT,
    HAPPY_VISA,
    PASSPORT_PORTRAIT_BOX,
    PASSPORT_SIZE,
    VISA_SIZE,
    encode_jpeg2000,
    passport_fields,
    passport_mrz,
    passport_portrait,
    passport_text,
    render_passport,
    render_visa,
    td3_record,
    visa_fields,
    visa_mrz,
    visa_text,
)

FACE_BOX = (150, 120, 100, 130)


def fake_photo(width: int = 400, height: int = 500) -> Image.Image:
    yy, xx = np.mgrid[0:height, 0:width]
    rgb = np.stack([60 + xx * 120 // width, 80 + yy * 100 // height, 140 + 0 * xx], axis=-1)
    rgb[120:250, 150:250] = (120, 90, 70)
    return Image.fromarray(rgb.astype(np.uint8), "RGB")


def bgr(image: Image.Image) -> np.ndarray:
    return np.ascontiguousarray(np.asarray(image.convert("RGB"))[..., ::-1])


def field_value(fields: tuple[object, ...], label: str) -> str:
    for field in fields:
        if getattr(field, "label", None) == label:
            return str(getattr(field, "value", ""))
    raise AssertionError(f"no field {label!r}")


# --- TD3 passport data page ---------------------------------------------------------------------


def test_the_passport_page_is_td3_size_at_twelve_pixels_per_millimetre() -> None:
    assert PASSPORT_SIZE == (1500, 1056)  # 125 x 88 mm
    assert PASSPORT_SIZE[0] / PASSPORT_SIZE[1] == pytest.approx(125 / 88, rel=0.01)


def test_the_passport_mrz_is_a_valid_td3_for_the_holder() -> None:
    lines = passport_mrz(HAPPY_HOLDER, HAPPY_PASSPORT)

    assert [len(line) for line in lines] == [44, 44]
    assert lines[0].startswith("P<UTOCALDERWOOD<<NORA<")
    assert lines[1].startswith(HAPPY_PASSPORT.document_number)
    assert lines[1][10:13] == "UTO"
    assert all(td3_digits(lines).values())
    assert yymmdd(lines[1][21:27], future=True) == HAPPY_PASSPORT.expiry_date
    assert yymmdd(lines[1][13:19], future=False) == HAPPY_HOLDER.birth_date


def test_the_passport_prints_its_number_and_dates_in_the_visual_zone() -> None:
    fields = passport_fields(HAPPY_HOLDER, HAPPY_PASSPORT)

    assert field_value(fields, "Passport no.") == HAPPY_PASSPORT.document_number
    assert field_value(fields, "Surname") == HAPPY_HOLDER.surname
    assert field_value(fields, "Date of expiry") == HAPPY_PASSPORT.expiry_date.strftime("%d %m %Y")
    assert BANNER in passport_text()


def test_the_passport_renders_deterministically_with_the_mrz_at_the_bottom() -> None:
    page = render_passport(fake_photo(), FACE_BOX)

    assert page.size == PASSPORT_SIZE
    assert page.mode == "RGB"
    assert page.tobytes() == render_passport(fake_photo(), FACE_BOX).tobytes()
    gray = np.asarray(page.convert("L"))
    dark_rows = np.flatnonzero((gray < 100).sum(axis=1) > 20)
    assert dark_rows.max() > PASSPORT_SIZE[1] * 0.85
    assert blur_score(bgr(page)) > 300
    assert glare_ratio(bgr(page)) < 0.01


# --- MRV-A visa ---------------------------------------------------------------------------------


def test_the_visa_is_mrv_a_size_at_twelve_pixels_per_millimetre() -> None:
    assert VISA_SIZE == (1440, 960)  # 120 x 80 mm


def test_the_visa_mrz_is_a_valid_mrv_a_for_the_holder() -> None:
    lines = visa_mrz(HAPPY_HOLDER, HAPPY_VISA)

    assert [len(line) for line in lines] == [44, 44]
    assert lines[0].startswith("V<UTOCALDERWOOD<<NORA<")
    assert lines[1].startswith(HAPPY_VISA.visa_number)
    assert all(mrv_digits(lines).values())
    assert yymmdd(lines[1][21:27], future=True) == HAPPY_VISA.valid_until


def test_the_visa_is_valid_today_and_names_the_passport_it_is_for() -> None:
    fields = visa_fields(HAPPY_HOLDER, HAPPY_VISA)

    assert HAPPY_VISA.valid_from < HAPPY_VISA.valid_until
    assert date.today() < HAPPY_VISA.valid_until
    assert field_value(fields, "Passport number") == HAPPY_VISA.passport_number
    assert field_value(fields, "Visa no.") == HAPPY_VISA.visa_number
    assert BANNER in visa_text()


def test_the_visa_renders_deterministically_with_the_mrz_at_the_bottom() -> None:
    visa = render_visa(fake_photo(), FACE_BOX)

    assert visa.size == VISA_SIZE
    assert visa.tobytes() == render_visa(fake_photo(), FACE_BOX).tobytes()
    gray = np.asarray(visa.convert("L"))
    dark_rows = np.flatnonzero((gray < 100).sum(axis=1) > 20)
    assert dark_rows.max() > VISA_SIZE[1] * 0.85
    assert blur_score(bgr(visa)) > 300
    assert glare_ratio(bgr(visa)) < 0.01


# --- both: no specimen marker, no ICAO example ----------------------------------------------------


def test_neither_document_prints_a_specimen_marker() -> None:
    printed = (*passport_text(), *visa_text())
    mrz = mrz_words(
        (*passport_mrz(HAPPY_HOLDER, HAPPY_PASSPORT), *visa_mrz(HAPPY_HOLDER, HAPPY_VISA))
    )

    assert markers_in(printed) == set()
    assert markers_in(mrz) == set()


def test_neither_document_uses_an_icao_example_number_or_person() -> None:
    numbers = {HAPPY_PASSPORT.document_number, HAPPY_VISA.visa_number, HAPPY_VISA.passport_number}

    assert numbers.isdisjoint(ICAO_EXAMPLE_NUMBERS)
    assert set(f"{HAPPY_HOLDER.surname} {HAPPY_HOLDER.given_names}".split()).isdisjoint(
        ICAO_EXAMPLE_NAMES
    )


# --- the chip's portrait and the page's MRZ record (C65.3) --------------------------------------


def test_the_chip_portrait_is_the_data_pages_portrait_at_dg2_size() -> None:
    portrait = passport_portrait(fake_photo(), FACE_BOX)
    page = render_passport(fake_photo(), FACE_BOX)
    x, y, width, height = PASSPORT_PORTRAIT_BOX
    printed = page.crop((x, y, x + width, y + height)).convert("L")
    shrunk = portrait.resize((width, height)).convert("L")

    assert portrait.size == DG2_PORTRAIT_SIZE
    assert portrait.mode == "RGB"
    correlation = np.corrcoef(
        np.asarray(printed, dtype=float).ravel(), np.asarray(shrunk, dtype=float).ravel()
    )[0, 1]
    assert correlation > 0.98  # the same framing of the same photo


def test_the_portrait_encodes_as_a_small_deterministic_jp2() -> None:
    portrait = passport_portrait(fake_photo(), FACE_BOX)

    data = encode_jpeg2000(portrait)

    assert data[:12] == b"\x00\x00\x00\x0cjP  \r\n\x87\n"  # the JP2 signature box
    assert data == encode_jpeg2000(portrait)
    assert len(data) < 1 << 20  # DG2's upload cap (C52.4)
    with Image.open(io.BytesIO(data)) as decoded:
        assert decoded.format == "JPEG2000"
        assert decoded.size == DG2_PORTRAIT_SIZE
        assert decoded.size[0] * decoded.size[1] <= 4_000_000  # C60.4's bound
        restored = np.asarray(decoded.convert("RGB"), dtype=float)
    assert np.abs(restored - np.asarray(portrait, dtype=float)).mean() < 6  # lossy, not lost


def test_the_portrait_also_encodes_as_a_bare_codestream() -> None:
    data = encode_jpeg2000(passport_portrait(fake_photo(), FACE_BOX), codestream=True)

    assert data[:4] == b"\xff\x4f\xff\x51"  # SOC then SIZ
    with Image.open(io.BytesIO(data)) as decoded:
        assert decoded.size == DG2_PORTRAIT_SIZE


def test_the_mrz_record_is_dg1s_mrz_and_the_pages_truth() -> None:
    record = td3_record()
    lines = passport_mrz(HAPPY_HOLDER, HAPPY_PASSPORT)

    assert record["mrz"] == list(lines)
    assert record["dg1_mrz"] == "".join(lines)
    assert len(str(record["dg1_mrz"])) == 88
    assert all(td3_digits(lines).values())
    assert record["document"] == {
        "id_class": "passport",
        "document_code": "P",
        "issuing_state": "UTO",
        "document_number": HAPPY_PASSPORT.document_number,
        "issue_date": HAPPY_PASSPORT.issue_date.isoformat(),
        "expiry_date": HAPPY_PASSPORT.expiry_date.isoformat(),
        "authority": HAPPY_PASSPORT.authority,
    }
    assert record["holder"] == {
        "surname": HAPPY_HOLDER.surname,
        "given_names": HAPPY_HOLDER.given_names,
        "sex": HAPPY_HOLDER.sex,
        "nationality": HAPPY_HOLDER.nationality,
        "birth_date": HAPPY_HOLDER.birth_date.isoformat(),
        "place_of_birth": HAPPY_HOLDER.place_of_birth,
    }
    printed = record["printed_fields"]
    assert isinstance(printed, dict)
    assert printed["Passport no."] == HAPPY_PASSPORT.document_number
    assert set(printed) == {field.label for field in passport_fields(HAPPY_HOLDER, HAPPY_PASSPORT)}
