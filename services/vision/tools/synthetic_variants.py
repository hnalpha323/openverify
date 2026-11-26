"""C36 variants of the synthetic Utopia card, each built to trip one check, and calibration sets.

Every variant starts from the happy-path card of ``synthetic_id`` and changes one thing: a
printed value, the MRZ, the capture, or the image itself. Each records the truth about what it
shows (fields, printed text, MRZ lines, document corners), so tests can prove the property that
must trip its check, and the calibration run can compare measurements with the truth.
Everything is deterministic: every random choice comes from a fixed seed.
"""

from __future__ import annotations

import dataclasses
import io
from dataclasses import dataclass
from datetime import date
from typing import Any, Final, Literal

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw

from icao_mrz import td1_lines
from synthetic_id import (
    BANNER,
    CARD_SIZE,
    HAPPY_DOCUMENT,
    HAPPY_HOLDER,
    LABEL_SIZE,
    MRZ_BAND_MM,
    PORTRAIT_BOX,
    VALUE_SIZE,
    CardDocument,
    CardHolder,
    CropBox,
    FaceBox,
    Field,
    back_fields,
    back_text,
    font,
    front_fields,
    front_text,
    mm,
    portrait_crop_box,
    render_back,
    render_front,
    td1_data,
    value_box,
)
from synthetic_travel import (
    HAPPY_PASSPORT,
    HAPPY_VISA,
    passport_fields,
    passport_mrz,
    passport_text,
    render_passport,
    render_visa,
    visa_fields,
    visa_mrz,
    visa_text,
)

JPEG_QUALITY: Final = 92
"""Quality of every generated JPEG unless a side says otherwise."""

Point = tuple[float, float]
Quad = tuple[Point, Point, Point, Point]
"""Four corners clockwise from the top left, in pixels of the side's image."""

Group = Literal["happy", "variant", "distinct-holder", "re-encoding"]


@dataclass(frozen=True, slots=True)
class Portrait:
    """A source photo and the face box to frame from it."""

    photo: Image.Image
    face_box: FaceBox
    name: str
    """Which photo this is (its ``fixtures/manifest.json`` entry), recorded in the truth so the
    calibration can tell cards that share a portrait photo from cards that do not."""


@dataclass(frozen=True, slots=True)
class Side:
    """One uploaded side: its image and the truth about what it shows."""

    image: Image.Image
    fields: tuple[tuple[str, str], ...]
    """Visual-zone fields as printed, ``(label, value)``."""
    text: tuple[str, ...]
    """Every string printed outside the MRZ."""
    mrz: tuple[str, ...] | None
    """The MRZ lines as printed, or ``None`` when the side has no MRZ."""
    quad: Quad | None = None
    """The document's corners in the image, when it does not fill the frame."""
    quality: int = JPEG_QUALITY
    portrait: str | None = None
    """The :attr:`Portrait.name` of the portrait photo the side shows, if any."""

    def field(self, label: str) -> str:
        """The printed value of the field labelled ``label``."""
        for name, value in self.fields:
            if name == label:
                return value
        raise KeyError(f"no field labelled {label!r}")

    def encode(self) -> bytes:
        """The upload: the image as a JPEG at :attr:`quality`."""
        return encode_jpeg(self.image, self.quality)

    def truth(self) -> dict[str, Any]:
        """What the side shows, as JSON: fields, printed text, MRZ, corners and JPEG quality."""
        return {
            "fields": dict(self.fields),
            "text": list(self.text),
            "mrz": None if self.mrz is None else list(self.mrz),
            "quad": None if self.quad is None else [list(corner) for corner in self.quad],
            "jpeg_quality": self.quality,
            "portrait": self.portrait,
        }


@dataclass(frozen=True, slots=True)
class Variant:
    name: str
    group: Group
    expect: tuple[str, ...]
    """The §4.1 checks the variant is built to trip; others may trip as a consequence."""
    description: str
    front: Side
    back: Side | None


def encode_jpeg(image: Image.Image, quality: int = JPEG_QUALITY) -> bytes:
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def decode(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as image:
        return image.convert("RGB")


def _pairs(fields: tuple[Field, ...]) -> tuple[tuple[str, str], ...]:
    return tuple((field.label, field.value) for field in fields)


def _front(
    portrait: Portrait | None,
    holder: CardHolder = HAPPY_HOLDER,
    document: CardDocument = HAPPY_DOCUMENT,
    *,
    banner: str = BANNER,
) -> Side:
    photo, face_box = (None, None) if portrait is None else (portrait.photo, portrait.face_box)
    return Side(
        image=render_front(photo, face_box, holder, document, banner=banner),
        fields=_pairs(front_fields(holder, document)),
        text=front_text(holder, document, banner=banner),
        mrz=None,
        portrait=None if portrait is None else portrait.name,
    )


def _back(
    holder: CardHolder = HAPPY_HOLDER,
    document: CardDocument = HAPPY_DOCUMENT,
    *,
    mrz: tuple[str, ...] | None = None,
) -> Side:
    lines = mrz if mrz is not None else td1_lines(td1_data(holder, document))
    return Side(
        image=render_back(holder, document, mrz=lines),
        fields=_pairs(back_fields(holder, document)),
        text=back_text(holder, document),
        mrz=lines,
    )


def _card(  # noqa: PLR0913 - a variant's identity and the card it shows
    name: str,
    expect: tuple[str, ...],
    description: str,
    portrait: Portrait,
    *,
    holder: CardHolder = HAPPY_HOLDER,
    document: CardDocument = HAPPY_DOCUMENT,
) -> Variant:
    """A card whose front and back show ``holder`` and ``document`` consistently."""
    return Variant(
        name=name,
        group="variant" if expect else "happy",
        expect=expect,
        description=description,
        front=_front(portrait, holder, document),
        back=_back(holder, document),
    )


def _happy_sides(portrait: Portrait) -> tuple[Side, Side]:
    """The happy card's front and back."""
    return _front(portrait), _back()


def _variant(
    name: str, expect: tuple[str, ...], description: str, front: Side, back: Side | None
) -> Variant:
    return Variant(
        name=name,
        group="variant" if expect else "happy",
        expect=expect,
        description=description,
        front=front,
        back=back,
    )


def happy(portrait: Portrait) -> Variant:
    """The happy-path card (C36): every Phase 1 and Phase 3 check should pass."""
    return _card(
        "happy",
        (),
        "The happy-path Utopia card: a fictional holder and no specimen marker.",
        portrait,
    )


SPECIMEN_STAMP: Final = "SPECIMEN"
STAMP_RED: Final = (200, 24, 36)


def _stamped(side: Side, *, above: int | None = None) -> Side:
    """``side`` with a large, semi-transparent red SPECIMEN stamp across it.

    The stamp is centred in the rows above ``above`` (the MRZ band) when given, so the MRZ
    stays readable and the variant trips only its own check.
    """
    width, height = side.image.size
    centre_y = (above if above is not None else height) // 2
    layer = Image.new("RGBA", side.image.size, (0, 0, 0, 0))
    stamp_font = font(round(height * 0.24))
    left, top, right, bottom = stamp_font.getbbox(SPECIMEN_STAMP)
    word = Image.new("RGBA", (round(right - left) + 40, round(bottom - top) + 40), (0, 0, 0, 0))
    ImageDraw.Draw(word).text(
        (20 - left, 20 - top), SPECIMEN_STAMP, font=stamp_font, fill=(*STAMP_RED, 170)
    )
    word = word.rotate(18, resample=Image.Resampling.BICUBIC, expand=True)
    layer.paste(word, ((width - word.width) // 2, centre_y - word.height // 2), word)
    image = Image.alpha_composite(side.image.convert("RGBA"), layer).convert("RGB")
    return dataclasses.replace(side, image=image, text=(*side.text, SPECIMEN_STAMP))


SPECIMEN_BANNER: Final = "SPECIMEN - NOT A REAL DOCUMENT"
"""The banner of a specimen card: the Phase 1 card's wording, two C33 markers."""


def specimen_stamped(portrait: Portrait) -> Variant:
    """A published specimen: SPECIMEN stamped across both sides, and the banner printing it.

    The overprint alone is :func:`specimen_overprint`: the calibration found that the OCR does not
    read a translucent stamp where it crosses the portrait or dense text, so this card also
    prints its markers as plain text, the way specimens print them in a field or a banner.
    """
    back = _back()
    return _variant(
        "specimen-stamped",
        ("id_compromised_detection",),
        "The happy card stamped SPECIMEN across both sides, with the banner "
        "SPECIMEN - NOT A REAL DOCUMENT (C33 markers).",
        _stamped(_front(portrait, banner=SPECIMEN_BANNER)),
        _stamped(back, above=CARD_SIZE[1] - mm(MRZ_BAND_MM)),
    )


def specimen_overprint(portrait: Portrait) -> Variant:
    """The SPECIMEN stamp alone, across both sides: it measures how far the OCR reads an
    overprint (it crosses the portrait on the front and the fields on the back)."""
    front, back = _happy_sides(portrait)
    return _variant(
        "specimen-overprint",
        ("id_compromised_detection",),
        "The happy card stamped SPECIMEN across both sides, with no other marker (C33).",
        _stamped(front),
        _stamped(back, above=CARD_SIZE[1] - mm(MRZ_BAND_MM)),
    )


def expired(portrait: Portrait) -> Variant:
    document = dataclasses.replace(
        HAPPY_DOCUMENT, issue_date=date(2015, 5, 1), expiry_date=date(2025, 4, 30)
    )
    return _card(
        "expired",
        ("id_expired_detection",),
        "Expired on 30 April 2025; the MRZ check digits are valid.",
        portrait,
        document=document,
    )


def bad_mrz_check_digit(portrait: Portrait) -> Variant:
    line1, line2, line3 = td1_lines(td1_data(HAPPY_HOLDER, HAPPY_DOCUMENT))
    wrong = str((int(line1[14]) + 1) % 10)
    card = happy(portrait)
    return dataclasses.replace(
        card,
        name="bad-mrz-check-digit",
        group="variant",
        expect=("id_mrz_inconsistency_detection",),
        description="The document number's MRZ check digit is wrong (so is the composite).",
        back=_back(mrz=(f"{line1[:14]}{wrong}{line1[15:]}", line2, line3)),
    )


def mrz_viz_mismatch(portrait: Portrait) -> Variant:
    printed = dataclasses.replace(HAPPY_HOLDER, birth_date=date(1986, 3, 21))
    card = happy(portrait)
    return dataclasses.replace(
        card,
        name="mrz-viz-mismatch",
        group="variant",
        expect=("id_mrz_inconsistency_detection", "id_extraction_inconsistency_detection"),
        description="The front prints a birth date two years before the valid MRZ's.",
        front=_front(portrait, printed),
    )


def issued_after_expiry(portrait: Portrait) -> Variant:
    document = dataclasses.replace(
        HAPPY_DOCUMENT, issue_date=date(2033, 6, 1), expiry_date=date(2032, 6, 1)
    )
    return _card(
        "issued-after-expiry",
        ("id_valid_dates_detection",),
        "Issued on 1 June 2033, a year after it expires (and in the future).",
        portrait,
        document=document,
    )


def under_age(portrait: Portrait) -> Variant:
    holder = dataclasses.replace(HAPPY_HOLDER, birth_date=date(2016, 11, 19), height_cm=128)
    return _card(
        "under-age",
        ("id_age_comparison",),
        "The holder was born in November 2016 and is a minor while the card is valid.",
        portrait,
        holder=holder,
    )


def po_box(portrait: Portrait) -> Variant:
    holder = dataclasses.replace(HAPPY_HOLDER, address="PO BOX 4471, UTOPIA CITY")
    return _card(
        "po-box",
        ("id_po_box_detection",),
        "The address on the back is a post office box.",
        portrait,
        holder=holder,
    )


# --- capture variants ----------------------------------------------------------------------------

Pixels = NDArray[np.float32]
"""An RGB image as floats, for blending."""


def _pixels(image: Image.Image) -> Pixels:
    return np.asarray(image.convert("RGB"), dtype=np.float32)


def _image(pixels: NDArray[Any]) -> Image.Image:
    return Image.fromarray(np.clip(np.rint(pixels), 0, 255).astype(np.uint8), "RGB")


def _derive(  # noqa: PLR0913 - a variant's identity and the sides it replaces
    card: Variant,
    name: str,
    expect: tuple[str, ...],
    description: str,
    *,
    front: Side | None = None,
    back: Side | None = None,
) -> Variant:
    """``card`` renamed, with ``front`` and ``back`` replaced when given."""
    return _variant(
        name,
        expect,
        description,
        front if front is not None else card.front,
        back if back is not None else card.back,
    )


def _with_image(side: Side, image: Image.Image) -> Side:
    return dataclasses.replace(side, image=image)


BLUR_SIGMA: Final = 1.8
"""Gaussian blur of the out-of-focus front, in pixels."""


def blurred(portrait: Portrait) -> Variant:
    card = happy(portrait)
    soft = _image(cv2.GaussianBlur(_pixels(card.front.image), (0, 0), BLUR_SIGMA))
    return _derive(
        card,
        "blurred",
        ("id_blur_detection",),
        f"The front is out of focus (Gaussian blur, sigma {BLUR_SIGMA} px); the back is sharp.",
        front=_with_image(card.front, soft),
    )


def _specular(image: Image.Image) -> Image.Image:
    """A colourless highlight saturating an ellipse over the front's text."""
    pixels = _pixels(image)
    height, width = pixels.shape[:2]
    yy, xx = np.mgrid[0:height, 0:width]
    distance = ((xx - 0.6 * width) / (0.26 * width)) ** 2 + (
        (yy - 0.45 * height) / (0.24 * height)
    ) ** 2
    alpha = np.clip(1.6 * (1.0 - distance), 0.0, 1.0)[..., None]
    return _image(pixels * (1.0 - alpha) + 255.0 * alpha)


def glare(portrait: Portrait) -> Variant:
    card = happy(portrait)
    return _derive(
        card,
        "glare",
        ("id_glare_detection",),
        "A specular highlight saturates the front's text area; the back is clean.",
        front=_with_image(card.front, _specular(card.front.image)),
    )


LOW_RESOLUTION_SCALE: Final = 0.3


def low_resolution(portrait: Portrait) -> Variant:
    card = happy(portrait)
    width, height = card.front.image.size
    small = card.front.image.resize(
        (round(width * LOW_RESOLUTION_SCALE), round(height * LOW_RESOLUTION_SCALE)),
        Image.Resampling.LANCZOS,
    )
    return _derive(
        card,
        "low-resolution",
        ("id_blur_detection",),
        f"The front was captured at {LOW_RESOLUTION_SCALE:.0%} of the card's resolution.",
        front=_with_image(card.front, small),
    )


TONER_SPECKS: Final = 0.002
"""Share of a photocopy's pixels that carry a stray toner speck."""


def _photocopy(image: Image.Image, seed: int) -> Image.Image:
    """A grey toner copy: more contrast, toner noise and specks, paper below glare level."""
    rng = np.random.default_rng(seed)
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    toner = cv2.GaussianBlur((gray - 128.0) * 1.35 + 150.0, (0, 0), 0.7)
    toner = toner + rng.normal(0.0, 4.0, toner.shape)
    specks = rng.uniform(0.0, 1.0, toner.shape) < TONER_SPECKS
    toner[specks] = rng.uniform(20.0, 90.0, int(specks.sum()))
    copy = np.clip(np.rint(toner), 12, 236).astype(np.uint8)
    return Image.fromarray(np.stack([copy] * 3, axis=-1), "RGB")


def photocopy(portrait: Portrait) -> Variant:
    front, back = _happy_sides(portrait)
    return _variant(
        "photocopy",
        ("id_color_inconsistency_detection",),
        "Both sides are a grayscale photocopy of the card (no chroma).",
        _with_image(front, _photocopy(front.image, seed=31)),
        _with_image(back, _photocopy(back.image, seed=32)),
    )


SCREEN_BLACK: Final = (14.0, 15.0, 18.0)
SUBPIXEL_LEAK: Final = 0.5
"""Light a subpixel column passes in the other two channels."""
PIXEL_ROW_GAP: Final = 0.6
"""Light of the darker row between display pixel rows."""
SCREEN_WHITE: Final = 230.0
"""The brightest the photographed display gets: JPEG ringing stays below glare level (250)."""


def _recaptured(image: Image.Image, seed: int) -> Image.Image:
    """The card shown on an RGB-stripe display and photographed, slightly rotated.

    The display shows the card at half size; each display pixel is three coloured columns (each
    leaking half its light into the other channels) above a darker row. The display's brightness
    is kept, so the face and the text stay readable. The camera samples that grid at 0.72 of its
    pitch through a 1.5 degree rotation, which aliases it into moiré.
    """
    rng = np.random.default_rng(seed)
    source = _pixels(image)
    height, width = source.shape[:2]
    shown = cv2.resize(
        source, (round(width * 0.5), round(height * 0.5)), interpolation=cv2.INTER_AREA
    )
    lit = np.repeat(np.repeat(np.asarray(shown, dtype=np.float32), 3, axis=0), 3, axis=1)
    grid = np.full(lit.shape, SUBPIXEL_LEAK, dtype=np.float32)
    for channel in range(3):
        grid[:, channel::3, channel] = 1.0
    grid[2::3] *= PIXEL_ROW_GAP
    lit = lit * grid / float(grid.mean())
    rows, columns = lit.shape[:2]
    out_w, out_h = round(columns * 0.72), round(rows * 0.72)
    matrix = cv2.getRotationMatrix2D((columns / 2, rows / 2), 1.5, 0.72)
    matrix[0, 2] += out_w / 2 - columns / 2
    matrix[1, 2] += out_h / 2 - rows / 2
    shot = cv2.warpAffine(
        lit,
        matrix,
        (out_w, out_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=SCREEN_BLACK,
    )
    shot = cv2.GaussianBlur(shot, (0, 0), 0.6) + rng.normal(0.0, 2.0, shot.shape)
    return _image(np.clip(shot, 0.0, SCREEN_WHITE))


def screen_recapture(portrait: Portrait) -> Variant:
    front, back = _happy_sides(portrait)
    return _variant(
        "screen-recapture",
        ("id_electronic_replica_detection",),
        "Both sides photographed off an RGB-stripe display: a pixel grid and moiré.",
        _with_image(front, _recaptured(front.image, seed=41)),
        _with_image(back, _recaptured(back.image, seed=42)),
    )


# --- tampering and content variants ---------------------------------------------------------------

SWAP_QUALITY: Final = 60
"""JPEG quality the swapped-in portrait went through before it was pasted."""


def portrait_swap(portrait: Portrait, other: Portrait) -> Variant:
    """A genuine capture of the card (one JPEG pass) whose portrait is replaced by ``other``'s,
    which comes from its own JPEG at :data:`SWAP_QUALITY`, off the card's 8 x 8 grid."""
    card = happy(portrait)
    genuine = decode(encode_jpeg(card.front.image))
    x, y, width, height = PORTRAIT_BOX
    face = other.photo.convert("RGB").crop(portrait_crop_box(other.face_box, other.photo.size))
    patch = decode(
        encode_jpeg(face.resize((width, height), Image.Resampling.LANCZOS), SWAP_QUALITY)
    )
    genuine.paste(patch, (x, y))
    return _derive(
        card,
        "portrait-swap",
        ("id_tamper_detection",),
        "Another person's portrait, from its own JPEG at quality 60, pasted over the genuine one.",
        front=dataclasses.replace(card.front, image=genuine, portrait=other.name),
    )


_MEASURE: Final = ImageDraw.Draw(Image.new("L", (1, 1)))


def _field_block(field: Field, *, margin: int = 6) -> CropBox:
    """The box around ``field``'s label and value."""
    label = _MEASURE.textbbox((field.x, field.y), field.label, font=font(LABEL_SIZE))
    left, _, right, bottom = value_box(field)
    return (
        round(min(label[0], left)) - margin,
        round(label[1]) - margin,
        round(max(label[2], right)) + margin,
        bottom + margin,
    )


def copy_move(portrait: Portrait) -> Variant:
    """The Nationality field (label, value and guilloche) copied into the empty slot right of
    the document number: two identical textured patches in one image."""
    card = happy(portrait)
    fields = {field.label: field for field in front_fields(HAPPY_HOLDER, HAPPY_DOCUMENT)}
    source, number = fields["Nationality"], fields["Document no."]
    left, top, right, bottom = _field_block(source)
    target = (value_box(number)[2] + mm(3.0), top + number.y - source.y)
    image = card.front.image.copy()
    image.paste(image.crop((left, top, right, bottom)), target)
    front = dataclasses.replace(
        card.front, image=image, text=(*card.front.text, source.label, source.value)
    )
    return _derive(
        card,
        "copy-move",
        ("id_tamper_detection",),
        "The Nationality field is copied, with its background, next to the document number.",
        front=front,
    )


PEN_BLUE: Final = (28, 46, 140)
"""Ballpoint ink, unlike the card's printed ink."""

HANDWRITTEN_FIELD: Final = "Given names"


def _u8(array: Any) -> NDArray[np.uint8]:
    return np.asarray(array, dtype=np.uint8)


def _skeleton(mask: NDArray[np.uint8]) -> NDArray[np.uint8]:
    """Morphological skeleton of a 0/1 mask: the centre lines a pen would follow."""
    cross = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    skeleton = np.zeros_like(mask)
    remaining = mask.copy()
    while remaining.any():
        eroded = _u8(cv2.erode(remaining, cross))
        skeleton |= remaining & (1 - _u8(cv2.dilate(eroded, cross)))
        remaining = eroded
    return skeleton


GLYPH_INK: Final = 127
"""Grey level above which a rendered glyph pixel is ink."""


def _pen_glyph(char: str, size: int, rng: np.random.Generator) -> NDArray[np.uint8]:
    """One letter retraced by a felt-tip pen whose radius follows a smooth, random pressure:
    1 px where it is light and 3 px where it is heavy, so stroke widths vary within a word."""
    pad = 16
    glyph_font = font(size)
    left, top, right, bottom = glyph_font.getbbox(char)
    canvas = Image.new("L", (round(right - left) + 2 * pad, round(bottom - top) + 2 * pad), 0)
    ImageDraw.Draw(canvas).text((pad - left, pad - top), char, font=glyph_font, fill=255)
    tilted = canvas.rotate(float(rng.uniform(-8, 8)), resample=Image.Resampling.BILINEAR)
    centre = _skeleton((np.asarray(tilted) > GLYPH_INK).astype(np.uint8))
    noise = rng.uniform(0.0, 1.0, centre.shape).astype(np.float32)
    pressure = cv2.GaussianBlur(noise, (0, 0), 3)
    pressure = (pressure - pressure.min()) / (float(np.ptp(pressure)) + 1e-6)
    heavy = (pressure >= 0.5).astype(np.uint8)  # noqa: PLR2004 - light below half, heavy above
    ink = np.zeros_like(centre)
    for radius, stroke in ((1, centre & (1 - heavy)), (3, centre & heavy)):
        pen = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
        ink |= _u8(cv2.dilate(stroke, pen))
    return ink


def _handwritten(text: str, size: int, rng: np.random.Generator) -> Image.Image:
    """``text`` written letter by letter, slanted, with a wandering baseline; an ``L`` mask
    cropped to its ink."""
    glyphs = [_pen_glyph(char, size, rng) for char in text]
    height = max(glyph.shape[0] for glyph in glyphs) + 16
    width = sum(glyph.shape[1] for glyph in glyphs) + 32
    line = np.zeros((height, width), dtype=np.uint8)
    x = 8
    for glyph in glyphs:
        rows, columns = glyph.shape
        y = int(rng.integers(4, 13))
        line[y : y + rows, x : x + columns] |= glyph * 255
        x += columns - 26 + int(rng.integers(0, 5))
    slant = np.array([[1.0, -0.22, 0.22 * height], [0.0, 1.0, 0.0]], dtype=np.float32)
    slanted = cv2.GaussianBlur(cv2.warpAffine(line, slant, (width, height)), (0, 0), 0.6)
    rows_with_ink = np.flatnonzero(slanted.max(axis=1) > 0)
    columns_with_ink = np.flatnonzero(slanted.max(axis=0) > 0)
    cropped = slanted[
        rows_with_ink[0] : rows_with_ink[-1] + 1, columns_with_ink[0] : columns_with_ink[-1] + 1
    ]
    return Image.fromarray(np.ascontiguousarray(cropped), "L")


def handwritten_field(portrait: Portrait) -> Variant:
    """The Given names value written by hand in blue ballpoint over the blank field."""
    card = happy(portrait)
    field = next(
        f for f in front_fields(HAPPY_HOLDER, HAPPY_DOCUMENT) if f.label == HANDWRITTEN_FIELD
    )
    image = render_front(
        portrait.photo, portrait.face_box, skip_values=frozenset({HANDWRITTEN_FIELD})
    )
    ink = _handwritten(field.value, VALUE_SIZE, np.random.default_rng(61))
    left, top, _, _ = value_box(field)
    image.paste(Image.new("RGB", ink.size, PEN_BLUE), (left - 2, top - 6), ink)
    return _derive(
        card,
        "handwritten-field",
        ("id_handwriting_detection",),
        "The Given names value is written by hand in blue ballpoint (same text).",
        front=_with_image(card.front, image),
    )


FRONT_AS_BACK_QUALITY: Final = 80


def front_as_back(portrait: Portrait) -> Variant:
    """The front uploaded again as the back, re-encoded so its bytes differ."""
    card = happy(portrait)
    return _derive(
        card,
        "front-as-back",
        ("id_double_side_detection",),
        "The back is the front again, re-encoded at JPEG quality 80 (other bytes, same card).",
        back=dataclasses.replace(card.front, quality=FRONT_AS_BACK_QUALITY),
    )


def no_portrait() -> Variant:
    return Variant(
        name="no-portrait",
        group="variant",
        expect=("id_portrait_detection",),
        description="The framed portrait zone of the front is empty.",
        front=_front(None),
        back=_back(),
    )


PAGE_SIZE: Final = (900, 1200)
PAPER: Final = (238, 235, 228)
PAGE_INK: Final = (44, 46, 54)
PAGE_WORDS: Final = (
    "agenda", "budget", "garden", "schedule", "project", "meeting", "summary", "kitchen",
    "weekend", "delivery", "travel", "library", "update", "window", "planning", "review",
    "harbour", "morning", "printer", "coffee", "team", "office", "notes", "friday",
)  # fmt: skip


def not_an_id() -> Variant:
    """A page of meeting notes: no document shape, no portrait, no MRZ."""
    rng = np.random.default_rng(71)
    page = Image.new("RGB", PAGE_SIZE, PAPER)
    draw = ImageDraw.Draw(page)
    lines = ["Meeting notes"]
    for _ in range(18):
        words = [
            PAGE_WORDS[i] for i in rng.integers(0, len(PAGE_WORDS), size=int(rng.integers(5, 9)))
        ]
        lines.append(" ".join(words).capitalize())
    draw.text((80, 80), lines[0], font=font(40), fill=PAGE_INK)
    for row, line in enumerate(lines[1:]):
        draw.text((80, 170 + row * 52), line, font=font(26), fill=PAGE_INK)
    return Variant(
        name="not-an-id",
        group="variant",
        expect=("id_unprocessable_submission_detection",),
        description="A page of typed meeting notes instead of an identity document.",
        front=Side(image=page, fields=(), text=tuple(lines), mrz=None),
        back=None,
    )


FRAME_SIZE: Final = (1200, 1500)
"""A portrait-orientation phone photo: no ID aspect, so the card's quad must be found."""

FRONT_QUAD: Final[Quad] = ((70.0, 380.0), (1128.0, 336.0), (1152.0, 1018.0), (44.0, 1060.0))
BACK_QUAD: Final[Quad] = ((96.0, 352.0), (1140.0, 400.0), (1118.0, 1080.0), (60.0, 1036.0))


def _desk(seed: int) -> Pixels:
    """A wood-grain desk top: low-frequency tone, grain lines and sensor noise."""
    rng = np.random.default_rng(seed)
    width, height = FRAME_SIZE
    coarse = rng.normal(0.0, 1.0, (height // 60 + 2, width // 60 + 2)).astype(np.float32)
    tone = cv2.resize(coarse, (width, height), interpolation=cv2.INTER_CUBIC)
    rows = np.mgrid[0:height, 0:width][0].astype(np.float32)
    grain = np.sin(2 * np.pi * (rows / 23.0 + 0.8 * tone)) * 10.0 + tone * 14.0
    wood = np.array((118.0, 86.0, 58.0), dtype=np.float32)
    shades = np.array((1.0, 0.8, 0.6), dtype=np.float32)
    desk = wood + grain[..., None] * shades + rng.normal(0.0, 3.0, (height, width, 3))
    return np.asarray(desk, dtype=np.float32)


def _photographed(image: Image.Image, quad: Quad, seed: int) -> Image.Image:
    """``image`` lying on a desk inside ``quad``, with a soft shadow, as a phone photographs it."""
    width, height = image.size
    corners = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(corners, np.array(quad, dtype=np.float32))
    card = cv2.warpPerspective(_pixels(image), matrix, FRAME_SIZE, flags=cv2.INTER_LINEAR)
    cover = cv2.warpPerspective(
        np.ones((height, width), dtype=np.float32), matrix, FRAME_SIZE, flags=cv2.INTER_LINEAR
    )
    shadow = cv2.GaussianBlur(np.roll(cover, (16, 12), axis=(0, 1)), (0, 0), 14)
    desk = _desk(seed) * (1.0 - 0.45 * shadow)[..., None]
    photo = desk * (1.0 - cover[..., None]) + card * cover[..., None]
    noise = np.random.default_rng(seed + 1).normal(0.0, 1.5, photo.shape)
    return _image(cv2.GaussianBlur(photo, (0, 0), 0.5) + noise)


def on_background(portrait: Portrait) -> Variant:
    front, back = _happy_sides(portrait)
    return _variant(
        "on-background",
        (),
        "Both sides photographed lying on a desk, in perspective (for the quad detector).",
        dataclasses.replace(
            front, image=_photographed(front.image, FRONT_QUAD, 51), quad=FRONT_QUAD
        ),
        dataclasses.replace(back, image=_photographed(back.image, BACK_QUAD, 52), quad=BACK_QUAD),
    )


# --- other document classes ------------------------------------------------------------------


def td3_passport(portrait: Portrait) -> Variant:
    front = Side(
        image=render_passport(portrait.photo, portrait.face_box),
        fields=_pairs(passport_fields(HAPPY_HOLDER, HAPPY_PASSPORT)),
        text=passport_text(),
        mrz=passport_mrz(HAPPY_HOLDER, HAPPY_PASSPORT),
        portrait=portrait.name,
    )
    return Variant(
        name="td3-passport",
        group="happy",
        expect=(),
        description="A Utopia TD3 passport data page: one side, the MRZ on the page.",
        front=front,
        back=None,
    )


def mrva_visa(portrait: Portrait) -> Variant:
    front = Side(
        image=render_visa(portrait.photo, portrait.face_box),
        fields=_pairs(visa_fields(HAPPY_HOLDER, HAPPY_VISA)),
        text=visa_text(),
        mrz=visa_mrz(HAPPY_HOLDER, HAPPY_VISA),
        portrait=portrait.name,
    )
    return Variant(
        name="mrv-a-visa",
        group="happy",
        expect=(),
        description="A Utopia MRV-A visa: one side, the MRZ on the visa.",
        front=front,
        back=None,
    )


# --- sets ----------------------------------------------------------------------------------------


def c36_variants(portrait: Portrait, other: Portrait) -> tuple[Variant, ...]:
    """The happy card, then every C36 variant in the plan's order. ``other`` is a different
    person's photo, for the portrait swap."""
    return (
        happy(portrait),
        specimen_stamped(portrait),
        specimen_overprint(portrait),
        expired(portrait),
        bad_mrz_check_digit(portrait),
        mrz_viz_mismatch(portrait),
        issued_after_expiry(portrait),
        under_age(portrait),
        po_box(portrait),
        blurred(portrait),
        glare(portrait),
        low_resolution(portrait),
        photocopy(portrait),
        screen_recapture(portrait),
        portrait_swap(portrait, other),
        copy_move(portrait),
        handwritten_field(portrait),
        front_as_back(portrait),
        no_portrait(),
        not_an_id(),
        on_background(portrait),
        td3_passport(portrait),
        mrva_visa(portrait),
    )


DISTINCT_HOLDERS: Final = (
    (
        CardHolder(
            surname="ASHGROVE",
            given_names="THEA",
            birth_date=date(1979, 11, 2),
            address="4 ORCHARD LANE, UTOPIA CITY",
            height_cm=172,
        ),
        CardDocument(
            document_number="UT7051382", issue_date=date(2022, 2, 10), expiry_date=date(2032, 2, 9)
        ),
    ),
    (
        CardHolder(
            surname="MERIDEN",
            given_names="SOLVEIG",
            birth_date=date(1993, 6, 27),
            place_of_birth="NORTH HAVEN",
            address="88 QUARRY HILL, NORTH HAVEN",
            height_cm=164,
        ),
        CardDocument(
            document_number="UT1938457", issue_date=date(2025, 1, 20), expiry_date=date(2035, 1, 19)
        ),
    ),
    (
        CardHolder(
            surname="QUILLAN",
            given_names="ISLA",
            birth_date=date(1965, 1, 15),
            address="3 LANTERN WALK, UTOPIA CITY",
            height_cm=176,
        ),
        CardDocument(
            document_number="UT6620194", issue_date=date(2021, 8, 3), expiry_date=date(2031, 8, 2)
        ),
    ),
    (
        CardHolder(
            surname="FARROW",
            given_names="LUCIA",
            birth_date=date(2001, 9, 30),
            place_of_birth="EAST BAY",
            address="19 CEDAR ROW, EAST BAY",
            height_cm=171,
        ),
        CardDocument(
            document_number="UT3507716",
            issue_date=date(2023, 11, 14),
            expiry_date=date(2033, 11, 13),
        ),
    ),
)
"""Other fictional holders of the Utopia design: neither markers nor ICAO example persons."""


def distinct_holders(portrait: Portrait, other: Portrait) -> tuple[Variant, ...]:
    """Happy cards of :data:`DISTINCT_HOLDERS`, the two photos taking turns: the pHash distance
    between distinct cards of one design (C34)."""
    cards = []
    for index, (holder, document) in enumerate(DISTINCT_HOLDERS):
        card = _card(
            f"holder-{index + 2}",
            (),
            f"A happy card of another fictional holder, {holder.given_names} {holder.surname}.",
            other if index % 2 == 0 else portrait,
            holder=holder,
            document=document,
        )
        cards.append(dataclasses.replace(card, group="distinct-holder"))
    return tuple(cards)


RE_ENCODINGS: Final = (
    ("happy-jpeg-q85", 85, 1.0),
    ("happy-jpeg-q75", 75, 1.0),
    ("happy-jpeg-q60", 60, 1.0),
    ("happy-resized-90", 85, 0.9),
)
"""Name, JPEG quality and scale of each re-encoding of the happy card."""


def _reencoded(side: Side, quality: int, scale: float) -> Side:
    width, height = side.image.size
    image = side.image.resize(
        (round(width * scale), round(height * scale)), Image.Resampling.LANCZOS
    )
    return dataclasses.replace(side, image=image, quality=quality)


def re_encodings(portrait: Portrait) -> tuple[Variant, ...]:
    """The happy card saved at other JPEG qualities, and resized: the pHash distance between
    re-encodings of one card (C34)."""
    front, back = _happy_sides(portrait)
    return tuple(
        Variant(
            name=name,
            group="re-encoding",
            expect=(),
            description=f"The happy card at JPEG quality {quality}, scaled by {scale:g}.",
            front=_reencoded(front, quality, scale),
            back=_reencoded(back, quality, scale),
        )
        for name, quality, scale in RE_ENCODINGS
    )
