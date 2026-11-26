"""Synthetic Utopia (``UTO``) travel documents: a TD3 passport data page and an MRV-A visa.

Both follow the ICAO 9303 layouts at 12 pixels per millimetre, like the TD1 card of
``synthetic_id``: a passport data page is 125 x 88 mm with a two-line, 44-character MRZ at the
bottom (Part 4), and an MRV-A visa is 120 x 80 mm with the same MRZ size (Part 7). The holder is
the card's fictional holder; the numbers are fictional and are no ICAO example's. Each prints the
banner "OpenVerify synthetic test card" and no specimen marker (C36).
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import date
from typing import Final

from PIL import Image, ImageDraw

from icao_mrz import MrvData, Td3Data, mrv_lines, td3_lines
from synthetic_id import (
    BANNER,
    BANNER_RED,
    HAPPY_HOLDER,
    CardHolder,
    FaceBox,
    Field,
    background,
    ddmmyyyy,
    draw_field,
    draw_header,
    draw_mrz_zone,
    field_text,
    font,
    frame_portrait,
    header_text,
    mm,
    paste_portrait,
    portrait_crop_box,
)

PASSPORT_SIZE: Final = (mm(125.0), mm(88.0))
VISA_SIZE: Final = (mm(120.0), mm(80.0))

PASSPORT_TITLE: Final = "PASSPORT"
VISA_TITLE: Final = "VISA"

PASSPORT_PORTRAIT_BOX: Final = (mm(5.0), mm(13.0), mm(30.0), mm(40.0))
VISA_PORTRAIT_BOX: Final = (mm(4.0), mm(12.0), mm(26.0), mm(33.0))

MRZ_BAND_MM: Final = 21.0
"""Height of the plain band carrying the two MRZ lines."""


@dataclass(frozen=True, slots=True)
class Passport:
    document_number: str = "UP7316408"
    issue_date: date = date(2023, 9, 14)
    expiry_date: date = date(2033, 9, 13)
    authority: str = "UTOPIA PASSPORT OFFICE"


@dataclass(frozen=True, slots=True)
class Visa:
    visa_number: str = "UV5128374"
    passport_number: str = "UP7316408"
    valid_from: date = date(2026, 1, 15)
    valid_until: date = date(2031, 1, 14)
    entries: str = "MULTIPLE"
    duration: str = "90 DAYS"


HAPPY_PASSPORT: Final = Passport()
HAPPY_VISA: Final = Visa()


def passport_mrz(holder: CardHolder, passport: Passport) -> tuple[str, str]:
    return td3_lines(
        Td3Data(
            document_code="P",
            issuing_state="UTO",
            document_number=passport.document_number,
            birth_date=holder.birth_date,
            sex=holder.sex,
            expiry_date=passport.expiry_date,
            nationality=holder.nationality,
            surname=holder.surname,
            given_names=holder.given_names,
        )
    )


def passport_fields(holder: CardHolder, passport: Passport) -> tuple[Field, ...]:
    """The visual inspection zone of the data page, right of the portrait (Part 4 zones I-VI)."""
    first, second, third = mm(40.0), mm(56.0), mm(80.0)
    return (
        Field("Type", "P", first, mm(13.0)),
        Field("Code", "UTO", second, mm(13.0)),
        Field("Passport no.", passport.document_number, third, mm(13.0)),
        Field("Surname", holder.surname, first, mm(20.0)),
        Field("Given names", holder.given_names, first, mm(27.0)),
        Field("Nationality", holder.nationality, first, mm(34.0)),
        Field("Date of birth", ddmmyyyy(holder.birth_date), third, mm(34.0)),
        Field("Sex", holder.sex, first, mm(41.0)),
        Field("Place of birth", holder.place_of_birth, second, mm(41.0)),
        Field("Date of issue", ddmmyyyy(passport.issue_date), first, mm(48.0)),
        Field("Date of expiry", ddmmyyyy(passport.expiry_date), third, mm(48.0)),
        Field("Authority", passport.authority, first, mm(55.0)),
    )


def passport_text(
    holder: CardHolder = HAPPY_HOLDER, passport: Passport = HAPPY_PASSPORT
) -> tuple[str, ...]:
    """Every string printed on the data page outside the MRZ."""
    return (
        *header_text(PASSPORT_TITLE),
        *field_text(passport_fields(holder, passport)),
        BANNER,
    )


def _render(  # noqa: PLR0913 - one layout's inputs
    size: tuple[int, int],
    title: str,
    *,
    portrait: tuple[Image.Image, FaceBox, FaceBox],
    fields: tuple[Field, ...],
    banner_at: tuple[int, int],
    mrz: tuple[str, str],
) -> Image.Image:
    photo, face_box, box = portrait
    page = background(size)
    draw = ImageDraw.Draw(page)
    draw_header(draw, title, width=size[0])
    paste_portrait(page, photo, face_box, box=box)
    frame_portrait(draw, box=box)
    for field in fields:
        draw_field(draw, field)
    draw.text(banner_at, BANNER, font=font(36), fill=BANNER_RED)
    draw_mrz_zone(draw, mrz, size=size, band_mm=MRZ_BAND_MM)
    return page


def render_passport(
    photo: Image.Image,
    face_box: FaceBox,
    holder: CardHolder = HAPPY_HOLDER,
    passport: Passport = HAPPY_PASSPORT,
) -> Image.Image:
    """The TD3 data page: header, portrait, visual zone, banner and the two-line MRZ."""
    return _render(
        PASSPORT_SIZE,
        PASSPORT_TITLE,
        portrait=(photo, face_box, PASSPORT_PORTRAIT_BOX),
        fields=passport_fields(holder, passport),
        banner_at=(mm(40.0), mm(61.5)),
        mrz=passport_mrz(holder, passport),
    )


def visa_mrz(holder: CardHolder, visa: Visa) -> tuple[str, str]:
    return mrv_lines(
        MrvData(
            document_code="V",
            issuing_state="UTO",
            document_number=visa.visa_number,
            birth_date=holder.birth_date,
            sex=holder.sex,
            expiry_date=visa.valid_until,
            nationality=holder.nationality,
            surname=holder.surname,
            given_names=holder.given_names,
        ),
        layout="MRVA",
    )


def visa_fields(holder: CardHolder, visa: Visa) -> tuple[Field, ...]:
    """The visual inspection zone of the visa, right of the portrait (Part 7 zones)."""
    first, second, third = mm(34.0), mm(62.0), mm(92.0)
    return (
        Field("Valid from", ddmmyyyy(visa.valid_from), first, mm(12.0)),
        Field("Valid until", ddmmyyyy(visa.valid_until), second, mm(12.0)),
        Field("Entries", visa.entries, third, mm(12.0)),
        Field("Surname", holder.surname, first, mm(19.0)),
        Field("Given names", holder.given_names, first, mm(26.0)),
        Field("Date of birth", ddmmyyyy(holder.birth_date), first, mm(33.0)),
        Field("Sex", holder.sex, second, mm(33.0)),
        Field("Nationality", holder.nationality, third, mm(33.0)),
        Field("Passport number", visa.passport_number, first, mm(40.0)),
        Field("Duration of stay", visa.duration, second, mm(40.0)),
        Field("Visa no.", visa.visa_number, first, mm(47.0)),
    )


def visa_text(holder: CardHolder = HAPPY_HOLDER, visa: Visa = HAPPY_VISA) -> tuple[str, ...]:
    """Every string printed on the visa outside the MRZ."""
    return (*header_text(VISA_TITLE), *field_text(visa_fields(holder, visa)), BANNER)


def render_visa(
    photo: Image.Image,
    face_box: FaceBox,
    holder: CardHolder = HAPPY_HOLDER,
    visa: Visa = HAPPY_VISA,
) -> Image.Image:
    """The MRV-A visa: header, portrait, visual zone, banner and the two-line MRZ."""
    return _render(
        VISA_SIZE,
        VISA_TITLE,
        portrait=(photo, face_box, VISA_PORTRAIT_BOX),
        fields=visa_fields(holder, visa),
        banner_at=(mm(34.0), mm(53.5)),
        mrz=visa_mrz(holder, visa),
    )


# --- the chip's portrait and the page's MRZ record (Phase 5, C65.3) ------------------------------

DG2_PORTRAIT_SIZE: Final = (480, 640)
"""The chip portrait: the data page's 3:4 portrait framing, 640 pixels tall (well under DG2's
1 MiB and JPEG 2000's 4 MP bounds)."""

JPEG2000_RATE: Final = 20
"""The portrait's JPEG 2000 compression ratio (about 46 KB), as chip portraits are small."""


def passport_portrait(
    photo: Image.Image, face_box: FaceBox, size: tuple[int, int] = DG2_PORTRAIT_SIZE
) -> Image.Image:
    """The holder's portrait framed as the data page frames it, at ``size``: what DG2 holds."""
    crop = photo.convert("RGB").crop(
        portrait_crop_box(face_box, photo.size, box=PASSPORT_PORTRAIT_BOX)
    )
    return crop.resize(size, Image.Resampling.LANCZOS)


def encode_jpeg2000(image: Image.Image, *, codestream: bool = False) -> bytes:
    """``image`` as JPEG 2000: a JP2 file, or with ``codestream`` the bare J2K codestream."""
    buffer = io.BytesIO()
    image.convert("RGB").save(
        buffer,
        format="JPEG2000",
        quality_mode="rates",
        quality_layers=[JPEG2000_RATE],
        irreversible=True,
        no_jp2=codestream,
    )
    return buffer.getvalue()


def td3_record(
    holder: CardHolder = HAPPY_HOLDER, passport: Passport = HAPPY_PASSPORT
) -> dict[str, object]:
    """The data page's truth for a chip built to match it: the document, the holder, the two MRZ
    lines and DG1's MRZ (the two lines joined, 88 characters), and the printed fields."""
    lines = passport_mrz(holder, passport)
    return {
        "document": {
            "id_class": "passport",
            "document_code": "P",
            "issuing_state": "UTO",
            "document_number": passport.document_number,
            "issue_date": passport.issue_date.isoformat(),
            "expiry_date": passport.expiry_date.isoformat(),
            "authority": passport.authority,
        },
        "holder": {
            "surname": holder.surname,
            "given_names": holder.given_names,
            "sex": holder.sex,
            "nationality": holder.nationality,
            "birth_date": holder.birth_date.isoformat(),
            "place_of_birth": holder.place_of_birth,
        },
        "mrz": list(lines),
        "dg1_mrz": "".join(lines),
        "printed_fields": {field.label: field.value for field in passport_fields(holder, passport)},
    }
