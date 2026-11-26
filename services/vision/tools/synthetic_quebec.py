"""A Quebec-format synthetic driver licence, its AAMVA payload and phone-like captures (Phase 12A).

Workflow 12A makes a real Quebec licence photographed by a phone yield its five required fields.
This generator gives the three Stage 2 agents one shared, synthetic stand-in:

- :func:`render_front` prints the field *layout and text shapes* of a Quebec licence: an
  unlabeled licence number ``A9999-999999-99``, the surname and the given names as two unlabeled
  lines under it, tiny field numbers beside the values, the French birth-date label with its
  ``(A-M-J)`` format hint, year-month-day dates and an ``A9A 9A9`` postal code. It copies no
  design, emblem, seal or colour of the real card: the background is the plain synthetic one of
  ``synthetic_id`` and the portrait a drawn silhouette unless a public-domain photo is passed.
- :func:`render_back` prints a PDF417 holding :func:`aamva_payload`: AAMVA 2020 (Annex D) under
  Quebec's IIN, with invented values and the ``ZQ`` subfile marking it as OpenVerify synthetic
  test data (the ``contracts/fixtures/aamva/README.md`` convention).
- :func:`photograph` lays a side on a desk in a phone frame (1080x1920 like the hosted web flow,
  or a 12-megapixel still), with perspective, optical and motion blur, glare, sensor noise and
  JPEG compression, deterministically from the capture's seed.
- :func:`ocr_cases` and :func:`aamva_cases` are the committed fixtures of
  ``contracts/fixtures/quebec-dl/`` that the TypeScript parsers are tested against.

Phase 12A amends C36 for this generator only (``docs/plans/phase-12a.plan.md``): a card may name
the jurisdiction in plain text because the parser's Quebec rule needs it, so every side prints
the SPECIMEN marker and the banner "SPECIMEN - OPENVERIFY SYNTHETIC TEST CARD", and every
payload carries the synthetic subfile. The holder is fictional; nothing here is real data.

Run ``uv run python tools/synthetic_quebec.py images --out <dir>`` for the JPEGs and their
truth (default ``fixtures/generated/quebec-dl``, git-ignored), and
``uv run python tools/synthetic_quebec.py fixtures [--check]`` for the committed JSON fixtures.
"""

from __future__ import annotations

import argparse
import dataclasses
import io
import json
import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Final, Literal

import cv2
import numpy as np
import pdf417gen  # type: ignore[import-untyped]
from numpy.typing import NDArray
from PIL import Image, ImageDraw

from synthetic_id import FaceBox, background, font, paste_portrait

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
FIXTURE_DIR: Final = REPO_ROOT / "contracts" / "fixtures" / "quebec-dl"
IMAGE_DIR: Final = REPO_ROOT / "fixtures" / "generated" / "quebec-dl"

CARD_MM: Final = (85.6, 53.98)
"""ID-1 card size in millimetres."""

PX_PER_MM: Final = 12.0
"""The canonical scale: about the 1015x640 rectified card the vision service produced live."""

QUEBEC_IIN: Final = "604428"
AAMVA_MARKER: Final = "OPENVERIFY SYNTHETIC TEST DATA"
MARKER_SUBFILE: Final = "ZQ"

SPECIMEN: Final = "SPECIMEN"
BANNER: Final = "SPECIMEN - OPENVERIFY SYNTHETIC TEST CARD"
TITLE: Final = "PERMIS DE CONDUIRE"
QUEBEC: Final = "QUEBEC"
"""Unaccented: Pillow's bundled font has no glyph for the accented capital."""

INK: Final = (24, 30, 44)
HEADER: Final = (40, 62, 104)
HEADER_INK: Final = (226, 233, 242)
NUMBER_INK: Final = (96, 104, 120)
BANNER_RED: Final = (176, 32, 44)
BARCODE_INK: Final = (20, 24, 31)
BARCODE_PLATE: Final = (238, 238, 236)
"""Below glare level (250), like every colour of the card."""

NOW: Final = "2026-11-22T00:00:00.000Z"
"""The date the OCR cases are read on: the expiry is ahead of it, the issue date behind."""

Side = Literal["front", "back"]


@dataclass(frozen=True, slots=True)
class QuebecHolder:
    surname: str = "TREMBLAY"
    given_names: str = "MARIE"
    sex: Literal["F", "M"] = "F"
    birth_date: date = date(1990, 2, 14)
    height_cm: int = 165
    street: str = "100 RUE FICTIVE"
    city: str = "MONTREAL"
    postal_code: str = "H0H 0H0"
    """Canada Post's well-known fictional code; ``A9A 9A9`` like any Canadian code."""


@dataclass(frozen=True, slots=True)
class QuebecLicence:
    number: str = "T1234-567890-12"
    licence_class: str = "5"
    issue_date: date = date(2021, 3, 15)
    expiry_date: date = date(2029, 2, 14)
    audit: str = "SYNTH2021031500001"


HAPPY_HOLDER: Final = QuebecHolder()
HAPPY_LICENCE: Final = QuebecLicence()


def compact_number(number: str) -> str:
    """The licence number without its dashes and spaces, as a parser normalizes it."""
    return number.replace("-", "").replace(" ", "")


# --- the AAMVA payload -----------------------------------------------------------------------


def _ccyymmdd(value: date) -> str:
    return value.strftime("%Y%m%d")


def _dl_elements(
    holder: QuebecHolder, licence: QuebecLicence, *, printed_number: bool
) -> list[tuple[str, str]]:
    postal = holder.postal_code.replace(" ", "")
    return [
        ("DCA", licence.licence_class),
        ("DCB", "NONE"),
        ("DCD", "NONE"),
        ("DBA", _ccyymmdd(licence.expiry_date)),
        ("DCS", holder.surname),
        ("DAC", holder.given_names),
        ("DAD", "NONE"),
        ("DBD", _ccyymmdd(licence.issue_date)),
        ("DBB", _ccyymmdd(holder.birth_date)),
        ("DBC", "2" if holder.sex == "F" else "1"),
        ("DAY", "BRO"),
        ("DAU", f"{holder.height_cm:03d} CM"),
        ("DAG", holder.street),
        ("DAI", holder.city),
        ("DAJ", "QC"),
        ("DAK", f"{postal:<11}"),
        ("DAQ", licence.number if printed_number else compact_number(licence.number)),
        ("DCF", licence.audit),
        ("DCG", "CAN"),
        ("DDE", "N"),
        ("DDF", "N"),
        ("DDG", "N"),
    ]


def aamva_payload(  # noqa: PLR0913 - the holder, the licence and one knob per tolerance case
    holder: QuebecHolder = HAPPY_HOLDER,
    licence: QuebecLicence = HAPPY_LICENCE,
    *,
    version: int = 10,
    file_type: str = "ANSI ",
    printed_number: bool = False,
    offset_shift: int = 0,
) -> str:
    """The licence's AAMVA payload (Annex D): a ``DL`` subfile and the ``ZQ`` marker subfile.

    ``file_type``, ``printed_number`` (the number with its dashes in ``DAQ``), ``offset_shift``
    (the ``DL`` designator's offset off by that many bytes) and ``version`` make the tolerance
    cases a parser may meet on a real card; the default is the standard payload.
    """
    if len(file_type) != 5:  # noqa: PLR2004 - the header's fixed field width
        raise ValueError("file_type must be five characters")
    elements = _dl_elements(holder, licence, printed_number=printed_number)
    dl = "DL" + "\n".join(f"{key}{value}" for key, value in elements)
    subfiles = [dl + "\r", f"{MARKER_SUBFILE}{MARKER_SUBFILE}A{AAMVA_MARKER}\r"]
    header = f"@\n\x1e\r{file_type}{QUEBEC_IIN}{version:02d}00{len(subfiles):02d}"
    offset = len(header) + 10 * len(subfiles)
    designators = []
    for index, body in enumerate(subfiles):
        shift = offset_shift if index == 0 else 0
        designators.append(f"{body[:2]}{offset + shift:04d}{len(body):04d}")
        offset += len(body)
    return header + "".join(designators) + "".join(subfiles)


def _expected_payload_fields(holder: QuebecHolder, licence: QuebecLicence) -> dict[str, str]:
    return {
        "name-first": holder.given_names,
        "name-last": holder.surname,
        "birthdate": holder.birth_date.isoformat(),
        "sex": holder.sex,
        "identification-number": compact_number(licence.number),
        "issue-date": licence.issue_date.isoformat(),
        "expiration-date": licence.expiry_date.isoformat(),
        "address-subdivision": "QC",
        "address-postal-code": holder.postal_code,
        "issuing-authority-code": QUEBEC_IIN,
    }


def aamva_cases() -> list[dict[str, Any]]:
    """The payload cases of ``aamva.json``: the standard one and four tolerance cases, each with
    the fields a parser must read (``identification-number`` normalized without dashes)."""
    expected = _expected_payload_fields(HAPPY_HOLDER, HAPPY_LICENCE)
    cases: list[tuple[str, str, dict[str, Any]]] = [
        ("qc-v10", "The standard payload: AAMVA version 10, Quebec IIN, CCYYMMDD dates.", {}),
        (
            "qc-file-type-aamva",
            "The header's file type reads AAMVA instead of 'ANSI ' (older standards).",
            {"file_type": "AAMVA"},
        ),
        (
            "qc-printed-number",
            "DAQ holds the number as printed, with its dashes.",
            {"printed_number": True},
        ),
        (
            "qc-offset-shift",
            "The DL designator's offset is two bytes off; the subfile still starts with DL.",
            {"offset_shift": 2},
        ),
        ("qc-v08", "AAMVA version 08 in the header, the same elements.", {"version": 8}),
    ]
    return [
        {
            "id": case_id,
            "description": description,
            "payload": aamva_payload(HAPPY_HOLDER, HAPPY_LICENCE, **options),
            "expected": expected,
        }
        for case_id, description, options in cases
    ]


# --- the card --------------------------------------------------------------------------------

Box = tuple[int, int, int, int]
"""``(x, y, width, height)`` in pixels of the card image."""


@dataclass(frozen=True, slots=True)
class PrintedLine:
    text: str
    role: str
    """``number``, ``name-last``, ``name-first``, ``birthdate``, ``issue-date``,
    ``expiration-date``, ``sex``, ``class``, ``height``, ``address-street-1``, ``address-city``,
    ``conditions``, ``header``, ``banner`` or ``field-number``."""
    box: Box


@dataclass(frozen=True, slots=True)
class CardSide:
    image: Image.Image
    lines: tuple[PrintedLine, ...]
    px_per_mm: float
    barcode_box: Box | None = None
    payload: str | None = None


@dataclass(frozen=True, slots=True)
class BackLayout:
    module_mm: float
    columns: int
    security_level: int = 5


BACKS: Final = {
    "standard": BackLayout(module_mm=0.254, columns=13),
    "dense": BackLayout(module_mm=0.19, columns=17),
}
"""PDF417 layouts: a 10-mil symbol of 13 data columns, and a denser, wider one."""


class _Canvas:
    """Draws text at millimetre positions and records each line with its box."""

    def __init__(self, px_per_mm: float) -> None:
        self.ppm = px_per_mm
        size = (round(CARD_MM[0] * px_per_mm), round(CARD_MM[1] * px_per_mm))
        self.image = background(size)
        self.draw = ImageDraw.Draw(self.image)
        self.lines: list[PrintedLine] = []

    def px(self, value_mm: float) -> int:
        return round(value_mm * self.ppm)

    def text(  # noqa: PLR0913, PLR0917 - where, what, its role and how it looks
        self, x_mm: float, y_mm: float, text: str, role: str, size: int, fill: tuple[int, ...]
    ) -> None:
        """``size`` is in pixels at :data:`PX_PER_MM`."""
        face = font(max(6, round(size * self.ppm / PX_PER_MM)))
        origin = (self.px(x_mm), self.px(y_mm))
        self.draw.text(origin, text, font=face, fill=fill)
        left, top, right, bottom = self.draw.textbbox(origin, text, font=face)
        box = (
            math.floor(left),
            math.floor(top),
            math.ceil(right) - math.floor(left),
            math.ceil(bottom) - math.floor(top),
        )
        self.lines.append(PrintedLine(text=text, role=role, box=box))

    def header(self, issuer: str) -> None:
        self.draw.rectangle((0, 0, self.image.width, self.px(9.0)), fill=HEADER)
        self.text(3.0, 1.6, issuer, "header", 40, HEADER_INK)
        self.text(31.0, 2.8, TITLE, "header", 28, HEADER_INK)
        self.text(66.0, 2.8, SPECIMEN, "header", 28, HEADER_INK)

    def banner(self) -> None:
        self.text(3.0, 49.0, BANNER, "banner", 22, BANNER_RED)


def _silhouette(canvas: _Canvas, box: FaceBox) -> None:
    """A drawn head and shoulders, clipped to the portrait's box."""
    x, y, w, h = box
    tile = Image.new("RGB", (w, h), (206, 210, 216))
    draw = ImageDraw.Draw(tile)
    draw.ellipse((w * 0.28, h * 0.14, w * 0.72, h * 0.56), fill=(150, 156, 166))
    draw.ellipse((w * 0.08, h * 0.62, w * 0.92, h * 1.25), fill=(150, 156, 166))
    canvas.image.paste(tile, (x, y))


def render_front(  # noqa: PLR0913 - the card data and what to print
    holder: QuebecHolder = HAPPY_HOLDER,
    licence: QuebecLicence = HAPPY_LICENCE,
    *,
    px_per_mm: float = PX_PER_MM,
    field_numbers: bool = True,
    issuer: str = QUEBEC,
    portrait: tuple[Image.Image, FaceBox] | None = None,
) -> CardSide:
    """The front: header, portrait, the unlabeled number and names, then the labelled lines.

    ``issuer`` replaces the jurisdiction's name in the header (``UTOPIA`` makes the negative case
    of the Quebec layout rule); ``portrait`` is a public-domain photo and its face box.
    """
    canvas = _Canvas(px_per_mm)
    canvas.header(issuer)
    photo_box = (canvas.px(3.0), canvas.px(11.0), canvas.px(25.0), canvas.px(32.0))
    if portrait is None:
        _silhouette(canvas, photo_box)
    else:
        paste_portrait(canvas.image, portrait[0], portrait[1], box=photo_box)
    value_x, small = 34.0, 11
    rows: list[tuple[str, float, float, str, str, int]] = [
        # field number, x, y, text, role, size
        ("4d", value_x, 11.0, licence.number, "number", 34),
        ("1", value_x, 16.0, holder.surname, "name-last", 34),
        ("2", value_x, 20.6, holder.given_names, "name-first", 34),
        ("8", value_x, 25.6, holder.street, "address-street-1", 24),
        ("", value_x, 28.6, f"{holder.city} QC {holder.postal_code}", "address-city", 24),
        (
            "3",
            value_x,
            32.6,
            f"DATE DE NAISSANCE (A-M-J): {holder.birth_date.isoformat()}",
            "birthdate",
            22,
        ),
        ("4a", value_x, 36.2, f"DELIVRE LE {licence.issue_date.isoformat()}", "issue-date", 22),
        (
            "4b",
            value_x,
            39.8,
            f"EXPIRE LE {licence.expiry_date.isoformat()}",
            "expiration-date",
            22,
        ),
        ("9", value_x, 43.6, f"CLASSE(S): {licence.licence_class}", "class", 22),
        ("15", 55.0, 43.6, f"SEXE: {holder.sex}", "sex", 22),
        ("16", 68.0, 43.6, f"TAILLE (CM): {holder.height_cm}", "height", 20),
    ]
    for number, x, y, text, role, size in rows:
        if field_numbers and number:
            canvas.text(x - 3.0, y + 0.4, number, "field-number", small, NUMBER_INK)
        canvas.text(x, y, text, role, size, INK)
    canvas.banner()
    return CardSide(image=canvas.image, lines=tuple(canvas.lines), px_per_mm=px_per_mm)


def _pdf417(payload: str, layout: BackLayout, ppm: float) -> tuple[Image.Image, int]:
    """The symbol at ``layout.module_mm`` per module (rows three modules high), drawn on a grid
    eight times finer then area-averaged, so a module may span a fractional number of pixels.
    Returns the image and the symbol's width in modules."""
    codes = pdf417gen.encode(
        payload.encode("ascii"), columns=layout.columns, security_level=layout.security_level
    )
    grid: Image.Image = pdf417gen.render_image(codes, scale=1, ratio=1, padding=0)
    modules_w, rows = grid.size
    fine = 8
    upscaled = np.asarray(grid.convert("L").resize((modules_w * fine, rows * 3 * fine), 0))
    width = round(modules_w * layout.module_mm * ppm)
    height = round(rows * 3 * layout.module_mm * ppm)
    level = cv2.resize(upscaled, (width, height), interpolation=cv2.INTER_AREA) / 255.0
    ink, plate = np.array(BARCODE_INK, np.float64), np.array(BARCODE_PLATE, np.float64)
    pixels = ink + (plate - ink) * level[..., None]
    return Image.fromarray(np.round(pixels).astype(np.uint8), "RGB"), modules_w


def render_back(  # noqa: PLR0913 - the card data and the symbol's layout
    holder: QuebecHolder = HAPPY_HOLDER,
    licence: QuebecLicence = HAPPY_LICENCE,
    *,
    px_per_mm: float = PX_PER_MM,
    back: str = "standard",
    payload: str | None = None,
    issuer: str = QUEBEC,
) -> CardSide:
    """The back: header, one conditions line, the PDF417 across the card and the banner."""
    canvas = _Canvas(px_per_mm)
    canvas.header(issuer)
    canvas.text(5.0, 10.6, "CONDITIONS: AUCUNE", "conditions", 22, INK)
    data = payload if payload is not None else aamva_payload(holder, licence)
    symbol, _ = _pdf417(data, BACKS[back], px_per_mm)
    quiet = canvas.px(1.5)
    left = (canvas.image.width - symbol.width) // 2
    top = canvas.px(16.0)
    canvas.draw.rectangle(
        (left - quiet, top - quiet, left + symbol.width + quiet, top + symbol.height + quiet),
        fill=BARCODE_PLATE,
    )
    canvas.image.paste(symbol, (left, top))
    canvas.banner()
    return CardSide(
        image=canvas.image,
        lines=tuple(canvas.lines),
        px_per_mm=px_per_mm,
        barcode_box=(left, top, symbol.width, symbol.height),
        payload=data,
    )


# --- phone captures --------------------------------------------------------------------------

Point = tuple[float, float]


@dataclass(frozen=True, slots=True)
class Capture:
    """How a phone photographs the card: the frame, where the card lies and what degrades it."""

    name: str
    frame: tuple[int, int] = (1080, 1920)
    card_width_share: float = 0.86
    """The card's width over the frame's width (the web flow's guide is 85%)."""
    tilt_deg: float = 0.0
    keystone: float = 0.0
    """How much shorter the card's top edge is than its bottom edge (0 = seen square on)."""
    blur_sigma: float = 0.6
    """Gaussian optical blur in frame pixels."""
    motion_px: int = 0
    """Length of a linear motion blur in frame pixels (0 = none)."""
    glare: bool = False
    jpeg_quality: int = 92
    noise: float = 1.5
    seed: int = 12


CAPTURES: Final = {
    capture.name: capture
    for capture in (
        Capture("flat", frame=(1100, 700), card_width_share=0.93, blur_sigma=0.0, noise=0.0),
        Capture("phone-1080"),
        Capture("phone-1080-soft", blur_sigma=1.2, seed=13),
        Capture("phone-1080-blur", blur_sigma=2.0, seed=14),
        Capture("phone-1080-motion", motion_px=7, seed=15),
        Capture("phone-1080-tilt", tilt_deg=7.0, keystone=0.08, seed=16),
        Capture("phone-1080-glare", glare=True, seed=17),
        Capture("phone-1080-q75", jpeg_quality=75, seed=18),
        Capture("phone-full", frame=(3024, 4032), blur_sigma=1.0, seed=19),
    )
}
"""Named captures: the live test's 1080x1920 frame at several degradations, a flat scan-like
photo and a 12-megapixel still. Stage 2 calibrations may define more with :class:`Capture`."""


@dataclass(frozen=True, slots=True)
class Photo:
    side: Side
    capture: Capture
    image: Image.Image
    """The decoded JPEG: what the vision service receives."""
    jpeg: bytes
    quad: tuple[Point, Point, Point, Point]
    """The card's corners in the frame, clockwise from its top left."""
    card_width_px: float
    module_px: float | None
    payload: str | None
    lines: tuple[PrintedLine, ...] = field(default=())
    """The side's printed lines, boxes at :data:`PX_PER_MM` (the canonical rectified card)."""

    def truth(self) -> dict[str, Any]:
        return {
            "side": self.side,
            "capture": dataclasses.asdict(self.capture),
            "quad": [list(corner) for corner in self.quad],
            "card_width_px": round(self.card_width_px, 2),
            "module_px": None if self.module_px is None else round(self.module_px, 3),
            "payload": self.payload,
            "jpeg_bytes": len(self.jpeg),
            "lines": [
                {"text": line.text, "role": line.role, "box": list(line.box)} for line in self.lines
            ],
        }


def _quad(capture: Capture) -> tuple[Point, Point, Point, Point]:
    frame_w, frame_h = capture.frame
    width = capture.card_width_share * frame_w
    height = width * CARD_MM[1] / CARD_MM[0]
    cx, cy = frame_w / 2, frame_h * 0.46
    top_half = width / 2 * (1.0 - capture.keystone)
    corners = [
        (-top_half, -height / 2),
        (top_half, -height / 2),
        (width / 2, height / 2),
        (-width / 2, height / 2),
    ]
    angle = math.radians(capture.tilt_deg)
    cos, sin = math.cos(angle), math.sin(angle)
    rotated = [
        (round(cx + x * cos - y * sin, 2), round(cy + x * sin + y * cos, 2)) for x, y in corners
    ]
    return (rotated[0], rotated[1], rotated[2], rotated[3])


def _desk(frame: tuple[int, int], seed: int) -> NDArray[np.float32]:
    """A mid-grey desk with a low-frequency tone, darker than the card."""
    rng = np.random.default_rng(seed)
    width, height = frame
    coarse = rng.normal(0.0, 1.0, (height // 90 + 2, width // 90 + 2)).astype(np.float32)
    tone = cv2.resize(coarse, (width, height), interpolation=cv2.INTER_CUBIC)
    base = np.array((92.0, 84.0, 78.0), dtype=np.float32)
    return np.asarray(base + tone[..., None] * 9.0, dtype=np.float32)


def _glare(card: NDArray[np.float32], centre: Point, radius: float) -> NDArray[np.float32]:
    """A colourless specular highlight saturating an ellipse around ``centre``."""
    height, width = card.shape[:2]
    yy, xx = np.mgrid[0:height, 0:width]
    distance = ((xx - centre[0]) / radius) ** 2 + ((yy - centre[1]) / (0.7 * radius)) ** 2
    alpha = np.clip(1.5 * (1.0 - distance), 0.0, 1.0)[..., None]
    return np.asarray(card * (1.0 - alpha) + 255.0 * alpha, dtype=np.float32)


def _motion_kernel(length: int) -> NDArray[np.float32]:
    line = np.zeros((length, length), dtype=np.float32)
    line[length // 2, :] = 1.0
    rotation = cv2.getRotationMatrix2D(((length - 1) / 2, (length - 1) / 2), 30.0, 1.0)
    kernel = cv2.warpAffine(line, rotation, (length, length))
    return np.asarray(kernel / kernel.sum(), dtype=np.float32)


def encode_jpeg(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def photograph(  # noqa: PLR0913 - the side, the capture and the card's data
    side: Side,
    capture: Capture,
    *,
    holder: QuebecHolder = HAPPY_HOLDER,
    licence: QuebecLicence = HAPPY_LICENCE,
    back: str = "standard",
    portrait: tuple[Image.Image, FaceBox] | None = None,
) -> Photo:
    """``side`` of the card photographed as ``capture`` says, encoded as a JPEG."""
    if side not in ("front", "back"):
        raise ValueError(f"side must be 'front' or 'back', not {side!r}")
    quad = _quad(capture)
    card_width = math.dist(quad[3], quad[2])
    frame_ppm = card_width / CARD_MM[0]
    # Rendered finer than the frame, then warped down, as a lens images a printed card.
    render_ppm = max(PX_PER_MM, round(frame_ppm * 1.5 * 2) / 2)
    card = (
        render_front(holder, licence, px_per_mm=render_ppm, portrait=portrait)
        if side == "front"
        else render_back(holder, licence, px_per_mm=render_ppm, back=back)
    )
    pixels = np.asarray(card.image, dtype=np.float32)
    if capture.glare:
        if card.barcode_box is not None:
            x, y, w, h = card.barcode_box
            centre = (x + 0.68 * w, y + 0.45 * h)
        else:
            centre = (0.6 * pixels.shape[1], 0.45 * pixels.shape[0])
        pixels = _glare(pixels, centre, 0.16 * pixels.shape[1])
    optics = cv2.GaussianBlur(pixels, (0, 0), 0.5 * render_ppm / frame_ppm)
    height, width = optics.shape[:2]
    corners = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(corners, np.array(quad, dtype=np.float32))
    warped = cv2.warpPerspective(optics, matrix, capture.frame, flags=cv2.INTER_LINEAR)
    cover = cv2.warpPerspective(
        np.ones((height, width), dtype=np.float32), matrix, capture.frame, flags=cv2.INTER_LINEAR
    )
    shadow = cv2.GaussianBlur(np.roll(cover, (14, 10), axis=(0, 1)), (0, 0), 12)
    desk = _desk(capture.frame, capture.seed) * (1.0 - 0.4 * shadow)[..., None]
    photo = desk * (1.0 - cover[..., None]) + warped * cover[..., None]
    if capture.blur_sigma > 0:
        photo = cv2.GaussianBlur(photo, (0, 0), capture.blur_sigma)
    if capture.motion_px > 1:
        photo = cv2.filter2D(photo, -1, _motion_kernel(capture.motion_px))
    if capture.noise > 0:
        photo = photo + np.random.default_rng(capture.seed).normal(0.0, capture.noise, photo.shape)
    shot = Image.fromarray(np.clip(np.round(photo), 0, 255).astype(np.uint8), "RGB")
    jpeg = encode_jpeg(shot, capture.jpeg_quality)
    with Image.open(io.BytesIO(jpeg)) as decoded:
        image = decoded.convert("RGB")
    scale = PX_PER_MM / render_ppm
    lines = tuple(
        dataclasses.replace(line, box=(*_scaled(line.box, scale),)) for line in card.lines
    )
    module = BACKS[back].module_mm * frame_ppm if side == "back" else None
    return Photo(
        side=side,
        capture=capture,
        image=image,
        jpeg=jpeg,
        quad=quad,
        card_width_px=card_width,
        module_px=module,
        payload=card.payload,
        lines=lines,
    )


def _scaled(box: Box, scale: float) -> Box:
    x, y, w, h = box
    return (round(x * scale), round(y * scale), max(1, round(w * scale)), max(1, round(h * scale)))


# --- OCR-line cases --------------------------------------------------------------------------


def _ocr_lines(
    side: CardSide, replace: dict[str, str], *, keep_numbers: bool, seed: int
) -> list[dict[str, Any]]:
    """The side's lines as an OCR reads them: field numbers dropped unless kept, the texts of
    ``replace`` (by role) substituted, and a deterministic confidence in [0.88, 1.0]."""
    rng = np.random.default_rng(seed)
    lines = []
    for line in side.lines:
        confidence = round(float(rng.uniform(0.88, 1.0)), 4)
        if line.role == "field-number" and not keep_numbers:
            continue
        lines.append(
            {
                "text": replace.get(line.role, line.text),
                "confidence": confidence,
                "box": list(line.box),
            }
        )
    return lines


def _field(value: str, via: str) -> dict[str, str]:
    return {"value": value, "via": via}


def ocr_cases() -> list[dict[str, Any]]:
    """The OCR-line cases of ``ocr-lines.json``: the front's lines (boxes at
    :data:`PX_PER_MM`), the fields ``parseViz`` must read with how it read them (``label``,
    ``pattern`` or ``layout``), and the fields it must not read (``absent``)."""
    front = render_front()
    plain = render_front(field_numbers=False)
    expected = {
        "identification-number": _field("T123456789012", "pattern"),
        "name-last": _field("TREMBLAY", "layout"),
        "name-first": _field("MARIE", "layout"),
        "birthdate": _field("1990-02-14", "label"),
        "issue-date": _field("2021-03-15", "label"),
        "expiration-date": _field("2029-02-14", "label"),
        "sex": _field("F", "label"),
    }
    phone = {
        # A format hint, a colon glued to the value and the month's 2 read as Z.
        "birthdate": "DATE DE NAISSANCE (A-M-J):1990-0Z-14",
        # A label glued to its date.
        "issue-date": "DELIVRE LE2021-03-15",
        "sex": "SEXE:F",
        "class": "CLASSE(S):5",
        "height": "TAILLE (CM):165",
    }
    unread = {
        **phone,
        "issue-date": "DELIVRF LF2021-03-15",
        "expiration-date": "FXPIRF L 2029-02-14",
    }
    pattern_dates = {
        **expected,
        "issue-date": _field("2021-03-15", "pattern"),
        "expiration-date": _field("2029-02-14", "pattern"),
    }
    other = render_front(
        licence=dataclasses.replace(HAPPY_LICENCE, number="UT4829163"),
        issuer="UTOPIA",
        field_numbers=False,
    )
    not_quebec = {
        key: value for key, value in expected.items() if key not in ("name-first", "name-last")
    }
    not_quebec["identification-number"] = _field("UT4829163", "pattern")

    cases = [
        (
            "printed",
            "Every line as printed, the tiny field numbers included as their own lines.",
            _ocr_lines(front, {}, keep_numbers=True, seed=1),
            expected,
            [],
        ),
        (
            "phone-ocr",
            "As the live OCR read a phone capture: no field numbers, the birth date's colon "
            "glued to a value with a misread month digit, the issue label glued to its date.",
            _ocr_lines(plain, phone, keep_numbers=False, seed=2),
            expected,
            [],
        ),
        (
            "labels-unread",
            "The issue and expiry labels misread: their dates are found by pattern inside the "
            "lines (a past date of the last 15 years is the issue date, a future one the expiry).",
            _ocr_lines(plain, unread, keep_numbers=False, seed=3),
            pattern_dates,
            [],
        ),
        (
            "number-confusion",
            "The licence number with a 0 read as O inside its digits.",
            _ocr_lines(plain, {**phone, "number": "T1234-56789O-12"}, keep_numbers=False, seed=4),
            expected,
            [],
        ),
        (
            "not-quebec",
            "The same layout under another issuer and number: the Quebec rule must not read the "
            "two unlabeled name lines.",
            _ocr_lines(other, phone, keep_numbers=False, seed=5),
            not_quebec,
            ["name-first", "name-last"],
        ),
    ]
    return [
        {
            "id": case_id,
            "description": description,
            "now": NOW,
            "lines": lines,
            "expected": fields,
            "absent": absent,
        }
        for case_id, description, lines, fields, absent in cases
    ]


# --- the command line ------------------------------------------------------------------------


def _fixture_documents() -> dict[str, dict[str, Any]]:
    common = {
        "schema_version": 1,
        "generator": "services/vision/tools/synthetic_quebec.py",
        "synthetic": (
            "Invented values only: a fictional holder on a SPECIMEN card printed in a Quebec "
            "licence's layout; no jurisdiction issued it and no real person or card is in it."
        ),
    }
    return {
        "ocr-lines.json": {
            **common,
            "description": (
                "OCR lines of the synthetic Quebec-format front (text, confidence, box "
                "[x, y, width, height] in rectified pixels at 12 px/mm) and the fields parseViz "
                "must read from them."
            ),
            "cases": ocr_cases(),
        },
        "aamva.json": {
            **common,
            "description": (
                "AAMVA payloads of the synthetic Quebec-format licence (IIN 604428, ZQ marker "
                "subfile): the standard one and tolerance cases, with the fields to read."
            ),
            "cases": aamva_cases(),
        },
    }


def _write_fixtures(out: Path, *, check: bool) -> int:
    stale = []
    for name, document in _fixture_documents().items():
        path = out / name
        if check:
            current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
            if current != document:
                stale.append(name)
            continue
        out.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", "utf-8")
    if stale:
        print(f"stale fixture(s): {', '.join(stale)}")
        return 1
    return 0


def _write_images(out: Path, captures: Sequence[str]) -> int:
    out.mkdir(parents=True, exist_ok=True)
    truth: dict[str, Any] = {}
    for name in captures:
        for side in ("front", "back"):
            photo = photograph(side, CAPTURES[name])
            (out / f"{side}-{name}.jpg").write_bytes(photo.jpeg)
            truth[f"{side}-{name}"] = photo.truth()
    (out / "truth.json").write_text(json.dumps(truth, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {2 * len(captures)} image(s) and truth.json to {out}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    commands = parser.add_subparsers(dest="command", required=True)
    images = commands.add_parser("images", help="phone-like JPEGs of both sides and truth.json")
    images.add_argument("--out", type=Path, default=IMAGE_DIR)
    images.add_argument("--capture", nargs="+", choices=sorted(CAPTURES), default=sorted(CAPTURES))
    fixtures = commands.add_parser("fixtures", help="the committed JSON fixtures")
    fixtures.add_argument("--out", type=Path, default=FIXTURE_DIR)
    fixtures.add_argument("--check", action="store_true", help="exit 1 when a file is stale")
    args = parser.parse_args(argv)
    if args.command == "images":
        return _write_images(args.out, args.capture)
    return _write_fixtures(args.out, check=args.check)


if __name__ == "__main__":
    raise SystemExit(main())
