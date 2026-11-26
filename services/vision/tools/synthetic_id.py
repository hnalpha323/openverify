"""A synthetic TD1 identity card of the fictional issuer Utopia, rendered with Pillow.

The layout follows ICAO Doc 9303 Part 5 for ID-1 cards (85.60 x 53.98 mm), drawn at
12 pixels per millimetre. The front carries the portrait in the left zone and the visual
inspection zone. The back carries further fields and the three-line TD1 machine-readable
zone at the bottom: ICAO places a TD1 MRZ on the back. The issuing state is ICAO's
fictional Utopia (``UTO``), OpenVerify's sandbox test issuer (C30.7), and every field is
synthetic. The happy-path card carries no specimen marker (C36): its holder is fictional and
neither a marker nor an ICAO example person, and its banner reads "OpenVerify synthetic test
card".

Every string printed outside the MRZ comes from :func:`front_fields` / :func:`back_fields` and
the header and banner constants, so :func:`front_text` and :func:`back_text` list exactly what
a reader of the card sees.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Final

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from icao_mrz import Td1Data, td1_lines

PX_PER_MM: Final = 12.0
CARD_SIZE: Final = (round(85.60 * PX_PER_MM), round(53.98 * PX_PER_MM))

FaceBox = tuple[int, int, int, int]
"""Face box ``(x, y, width, height)`` in source-photo pixels."""

CropBox = tuple[int, int, int, int]
"""Pillow crop box ``(left, top, right, bottom)``."""


def mm(value: float) -> int:
    """Millimetres to pixels at :data:`PX_PER_MM`."""
    return round(value * PX_PER_MM)


PORTRAIT_BOX: Final = (mm(3.0), mm(11.0), mm(25.0), mm(32.0))
"""Portrait ``(x, y, width, height)`` on the front: ICAO zone V, on the left."""

PORTRAIT_FACE_HEIGHT: Final = 0.6
"""Share of the portrait height taken by the detector's face box (ICAO-style framing)."""

PORTRAIT_FACE_TOP: Final = 0.2
"""Space above the face box, as a share of the portrait height."""

INK: Final = (24, 38, 74)
LABEL: Final = (74, 88, 118)
HEADER: Final = (32, 64, 112)
HEADER_INK: Final = (226, 233, 242)
HEADER_MARK_INK: Final = (244, 196, 120)
BANNER_RED: Final = (186, 30, 42)
BACKGROUND_TOP: Final = (198, 220, 214)
BACKGROUND_BOTTOM: Final = (219, 208, 226)
GUILLOCHE: Final = (168, 192, 196)
MRZ_PAPER: Final = (226, 229, 232)
"""Every colour stays below an HSV value of 250, so the card never reads as glare."""

ISSUER_NAME: Final = "UTOPIA"
CARD_TITLE: Final = "IDENTITY CARD"
HEADER_MARK: Final = "UTO"
"""Printed in the right of the header of both sides: the issuer's code."""

BANNER: Final = "OpenVerify synthetic test card"
"""Printed across the lower front."""

LABEL_SIZE: Final = 20
VALUE_SIZE: Final = 34
VALUE_OFFSET: Final = mm(2.0)
"""A field's value sits this far below its label."""


@dataclass(frozen=True, slots=True)
class CardHolder:
    surname: str = "CALDERWOOD"
    given_names: str = "NORA"
    sex: str = "F"
    nationality: str = "UTO"
    birth_date: date = date(1988, 3, 21)
    place_of_birth: str = "UTOPIA CITY"
    address: str = "27 HARBOUR ROAD, UTOPIA CITY"
    height_cm: int = 168


@dataclass(frozen=True, slots=True)
class CardDocument:
    issuing_state: str = "UTO"
    document_code: str = "ID"
    document_number: str = "UT4829163"
    issue_date: date = date(2024, 5, 6)
    expiry_date: date = date(2034, 5, 5)
    authority: str = "UTOPIA CIVIL REGISTRY"


HAPPY_HOLDER: Final = CardHolder()
HAPPY_DOCUMENT: Final = CardDocument()


@dataclass(frozen=True, slots=True)
class Field:
    """A printed field: its label at ``(x, y)`` and its value :data:`VALUE_OFFSET` below."""

    label: str
    value: str
    x: int
    y: int


def td1_data(holder: CardHolder, document: CardDocument) -> Td1Data:
    return Td1Data(
        document_code=document.document_code,
        issuing_state=document.issuing_state,
        document_number=document.document_number,
        birth_date=holder.birth_date,
        sex=holder.sex,
        expiry_date=document.expiry_date,
        nationality=holder.nationality,
        surname=holder.surname,
        given_names=holder.given_names,
    )


def fit_box(
    x: float, y: float, width: float, height: float, *, image_size: tuple[int, int]
) -> CropBox:
    """Shrink (keeping the aspect ratio and centre) and shift a box until it fits the image."""
    image_w, image_h = image_size
    scale = min(1.0, image_w / width, image_h / height)
    centre_x, centre_y = x + width / 2, y + height / 2
    width, height = width * scale, height * scale
    left = min(max(centre_x - width / 2, 0.0), image_w - width)
    top = min(max(centre_y - height / 2, 0.0), image_h - height)
    return (round(left), round(top), round(left + width), round(top + height))


def framed_crop_box(
    face_box: FaceBox,
    image_size: tuple[int, int],
    *,
    aspect: float,
    face_height: float,
    face_top: float,
) -> CropBox:
    """Crop box of ``aspect`` (width/height) where the face takes ``face_height`` of it."""
    fx, fy, fw, fh = face_box
    height = fh / face_height
    width = height * aspect
    return fit_box(
        fx + fw / 2 - width / 2, fy - face_top * height, width, height, image_size=image_size
    )


def portrait_crop_box(
    face_box: FaceBox, image_size: tuple[int, int], *, box: FaceBox = PORTRAIT_BOX
) -> CropBox:
    """Crop of a source photo that frames the face like an ID portrait of ``box``'s shape."""
    _, _, width, height = box
    return framed_crop_box(
        face_box,
        image_size,
        aspect=width / height,
        face_height=PORTRAIT_FACE_HEIGHT,
        face_top=PORTRAIT_FACE_TOP,
    )


def paste_portrait(
    card: Image.Image, photo: Image.Image, face_box: FaceBox, *, box: FaceBox = PORTRAIT_BOX
) -> None:
    """Crop ``photo`` around ``face_box`` like an ID portrait and paste it into ``box``."""
    x, y, width, height = box
    crop = photo.convert("RGB").crop(portrait_crop_box(face_box, photo.size, box=box))
    card.paste(crop.resize((width, height), Image.Resampling.LANCZOS), (x, y))


def frame_portrait(draw: ImageDraw.ImageDraw, *, box: FaceBox = PORTRAIT_BOX) -> None:
    x, y, width, height = box
    draw.rectangle((x - 2, y - 2, x + width + 1, y + height + 1), outline=LABEL, width=2)


def font(size: int) -> ImageFont.FreeTypeFont:
    """Pillow's bundled FreeType font at ``size`` pixels."""
    loaded = ImageFont.load_default(size=size)
    assert isinstance(loaded, ImageFont.FreeTypeFont)  # noqa: S101 - Pillow wheels ship FreeType
    return loaded


def background(size: tuple[int, int] = CARD_SIZE) -> Image.Image:
    """Vertical two-tone gradient with deterministic guilloche waves (sharp fine detail)."""
    width, height = size
    ramp = np.linspace(0.0, 1.0, height)[:, None, None]
    top, bottom = np.array(BACKGROUND_TOP), np.array(BACKGROUND_BOTTOM)
    pixels = np.broadcast_to(top + (bottom - top) * ramp, (height, width, 3))
    card = Image.fromarray(np.round(pixels).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(card)
    for wave in range((height - 18) // 24):
        base = 18 + wave * 24
        phase = wave * 0.7
        points = [
            (x, base + 9 * math.sin(2 * math.pi * x / 140 + phase)) for x in range(0, width + 4, 4)
        ]
        draw.line(points, fill=GUILLOCHE, width=1)
    return card


def draw_header(draw: ImageDraw.ImageDraw, title: str, *, width: int = CARD_SIZE[0]) -> None:
    """The issuer band: the issuer's name, the document title and the header mark."""
    draw.rectangle((0, 0, width, mm(9.0)), fill=HEADER)
    draw.text((mm(3.0), mm(1.6)), ISSUER_NAME, font=font(46), fill=HEADER_INK)
    draw.text((mm(31.0), mm(2.8)), title, font=font(30), fill=HEADER_INK)
    draw.text((width - mm(19.6), mm(2.8)), HEADER_MARK, font=font(30), fill=HEADER_MARK_INK)


def header_text(title: str) -> tuple[str, ...]:
    return (ISSUER_NAME, title, HEADER_MARK)


def draw_field(draw: ImageDraw.ImageDraw, field: Field, *, value: bool = True) -> None:
    draw.text((field.x, field.y), field.label, font=font(LABEL_SIZE), fill=LABEL)
    if value:
        draw.text((field.x, field.y + VALUE_OFFSET), field.value, font=font(VALUE_SIZE), fill=INK)


def value_box(field: Field) -> CropBox:
    """Where ``field``'s value is drawn, as a Pillow box."""
    measure = ImageDraw.Draw(Image.new("L", (1, 1)))
    left, top, right, bottom = measure.textbbox(
        (field.x, field.y + VALUE_OFFSET), field.value, font=font(VALUE_SIZE)
    )
    return (math.floor(left), math.floor(top), math.ceil(right) + 1, math.ceil(bottom) + 1)


def field_text(fields: tuple[Field, ...]) -> tuple[str, ...]:
    return tuple(text for field in fields for text in (field.label, field.value))


def ddmmyyyy(value: date) -> str:
    return value.strftime("%d %m %Y")


def front_fields(holder: CardHolder, document: CardDocument) -> tuple[Field, ...]:
    """The visual inspection zone of the front, right of the portrait."""
    column, second, third = mm(31.0), mm(46.0), mm(62.0)
    return (
        Field("Surname", holder.surname, column, mm(11.0)),
        Field("Given names", holder.given_names, column, mm(18.5)),
        Field("Sex", holder.sex, column, mm(26.0)),
        Field("Nationality", holder.nationality, second, mm(26.0)),
        Field("Date of birth", ddmmyyyy(holder.birth_date), third, mm(26.0)),
        Field("Document no.", document.document_number, column, mm(33.5)),
        Field("Date of expiry", ddmmyyyy(document.expiry_date), third, mm(33.5)),
    )


def back_fields(holder: CardHolder, document: CardDocument) -> tuple[Field, ...]:
    """The further fields of the back, above the MRZ."""
    column = mm(4.0)
    return (
        Field("Place of birth", holder.place_of_birth, column, mm(11.0)),
        Field("Height", f"{holder.height_cm} cm", mm(46.0), mm(11.0)),
        Field("Address", holder.address, column, mm(17.5)),
        Field("Date of issue", ddmmyyyy(document.issue_date), column, mm(24.0)),
        Field("Authority", document.authority, mm(30.0), mm(24.0)),
    )


def front_text(
    holder: CardHolder = HAPPY_HOLDER,
    document: CardDocument = HAPPY_DOCUMENT,
    *,
    banner: str = BANNER,
) -> tuple[str, ...]:
    """Every string printed on the front: header, labels, values and banner."""
    return (*header_text(CARD_TITLE), *field_text(front_fields(holder, document)), banner)


def back_text(
    holder: CardHolder = HAPPY_HOLDER, document: CardDocument = HAPPY_DOCUMENT
) -> tuple[str, ...]:
    """Every string printed on the back outside the MRZ: header, labels and values."""
    return (*header_text(CARD_TITLE), *field_text(back_fields(holder, document)))


def render_front(  # noqa: PLR0913 - the photo, the card data and what to print
    photo: Image.Image | None,
    face_box: FaceBox | None,
    holder: CardHolder = HAPPY_HOLDER,
    document: CardDocument = HAPPY_DOCUMENT,
    *,
    skip_values: frozenset[str] = frozenset(),
    banner: str = BANNER,
) -> Image.Image:
    """The front: header, portrait cropped from ``photo`` around ``face_box``, and fields.

    Without a ``photo`` the framed portrait zone stays blank. The values of the fields labelled
    in ``skip_values`` are not drawn (their labels are), so a variant can write them itself.
    ``banner`` replaces the line under the fields (a specimen card prints its markers there).
    """
    if (photo is None) != (face_box is None):
        raise ValueError("a portrait photo needs its face box, and a face box its photo")
    card = background()
    draw = ImageDraw.Draw(card)
    draw_header(draw, CARD_TITLE)

    if photo is not None and face_box is not None:
        paste_portrait(card, photo, face_box)
    frame_portrait(draw)

    for field in front_fields(holder, document):
        draw_field(draw, field, value=field.label not in skip_values)
    draw.text((mm(31.0), mm(42.5)), banner, font=font(36), fill=BANNER_RED)
    return card


def draw_mrz(
    draw: ImageDraw.ImageDraw, lines: tuple[str, ...], *, size: tuple[int, int] = CARD_SIZE
) -> None:
    """Monospaced MRZ: each character centred in a 2.54 mm cell (10 characters per inch).

    Lines are 4.6 mm apart, and the last line's top is 7.3 mm above the bottom edge.
    """
    width, height = size
    pitch = 2.54 * PX_PER_MM
    mrz_font = font(40)
    left = (width - pitch * len(lines[0])) / 2
    first_line_top = height - mm(16.5 - 4.6 * (3 - len(lines)))
    for row, line in enumerate(lines):
        top = first_line_top + row * mm(4.6)
        for column, char in enumerate(line):
            glyph_left, _, glyph_right, _ = mrz_font.getbbox(char)
            offset = (pitch - (glyph_right - glyph_left)) / 2 - glyph_left
            draw.text((left + column * pitch + offset, top), char, font=mrz_font, fill=INK)


def render_back(
    holder: CardHolder = HAPPY_HOLDER,
    document: CardDocument = HAPPY_DOCUMENT,
    *,
    mrz: tuple[str, ...] | None = None,
) -> Image.Image:
    """The back: more synthetic fields and the TD1 machine-readable zone at the bottom.

    ``mrz`` replaces the lines built from ``holder`` and ``document``, for a variant whose MRZ
    must differ from its visual zone.
    """
    card = background()
    draw = ImageDraw.Draw(card)
    draw_header(draw, CARD_TITLE)

    for field in back_fields(holder, document):
        draw_field(draw, field)

    draw_mrz_zone(draw, mrz if mrz is not None else td1_lines(td1_data(holder, document)))
    return card


MRZ_BAND_MM: Final = 19.0
"""Height of the plain band that carries the card's MRZ."""


def draw_mrz_zone(
    draw: ImageDraw.ImageDraw,
    lines: tuple[str, ...],
    *,
    size: tuple[int, int] = CARD_SIZE,
    band_mm: float = MRZ_BAND_MM,
) -> None:
    """The MRZ's plain band along the bottom edge, ``band_mm`` high, and its lines."""
    width, height = size
    draw.rectangle((0, height - mm(band_mm), width, height), fill=MRZ_PAPER)
    draw_mrz(draw, lines, size=size)
