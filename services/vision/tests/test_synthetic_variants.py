"""C36 variants of the synthetic Utopia card: each has the property that must trip its check.

Tests assert properties, not hashes (C36). The portraits are synthetic gradients; the real
public-domain faces are exercised by ``test_real_faces.py`` and the calibration run.
"""

from __future__ import annotations

import io
import re
from datetime import date, datetime
from functools import cache
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from fixture_inputs import A, B
from icao_mrz import td1_lines
from mrz_checks import mrv_digits, td1_digits, td3_digits, yymmdd
from openverify_vision.quality import (
    DEFAULT_BLUR_MIN,
    DEFAULT_GLARE_MAX,
    blur_score,
    glare_ratio,
)
from specimen_markers import ICAO_EXAMPLE_NAMES, ICAO_EXAMPLE_NUMBERS, markers_in
from synthetic_id import (
    BANNER,
    CARD_SIZE,
    HAPPY_DOCUMENT,
    HAPPY_HOLDER,
    PORTRAIT_BOX,
    back_fields,
    background,
    front_fields,
    render_back,
    render_front,
    td1_data,
    value_box,
)
from synthetic_travel import (
    HAPPY_PASSPORT,
    HAPPY_VISA,
    PASSPORT_SIZE,
    VISA_SIZE,
    passport_mrz,
    visa_mrz,
)
from synthetic_variants import (
    JPEG_QUALITY,
    SPECIMEN_BANNER,
    Quad,
    Side,
    Variant,
    bad_mrz_check_digit,
    blurred,
    c36_variants,
    copy_move,
    decode,
    distinct_holders,
    encode_jpeg,
    expired,
    front_as_back,
    glare,
    handwritten_field,
    happy,
    issued_after_expiry,
    low_resolution,
    mrva_visa,
    mrz_viz_mismatch,
    no_portrait,
    not_an_id,
    on_background,
    photocopy,
    po_box,
    portrait_swap,
    re_encodings,
    screen_recapture,
    specimen_overprint,
    specimen_stamped,
    td3_passport,
    under_age,
)

PLAN = Path(__file__).resolve().parents[3] / "docs" / "PLAN.md"
PO_BOX = re.compile(r"\bP\.?\s*O\.?\s+BOX\b", re.IGNORECASE)


def catalog_ids() -> set[str]:
    """The §4.1 government ID check ids of ``docs/PLAN.md``."""
    text = PLAN.read_text(encoding="utf-8")
    section = text[text.index("### 4.1") : text.index("### 4.2")]
    return set(re.findall(r"^\| (id_[a-z_]+) \|", section, flags=re.MULTILINE))


def pixels(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("RGB"), dtype=np.int16)


def ddmmyyyy(value: str) -> date:
    return datetime.strptime(value, "%d %m %Y").date()


def age_on(birth: date, day: date) -> int:
    return day.year - birth.year - ((day.month, day.day) < (birth.month, birth.day))


def mrz_of(variant: Variant) -> tuple[str, ...]:
    assert variant.back is not None
    assert variant.back.mrz is not None
    return variant.back.mrz


HAPPY_MRZ = td1_lines(td1_data(HAPPY_HOLDER, HAPPY_DOCUMENT))


@cache
def happy_card() -> Variant:
    return happy(A)


# --- the happy card and the shared shape --------------------------------------------------------


def test_the_happy_variant_is_the_happy_card() -> None:
    card = happy_card()
    assert card.back is not None

    assert (card.name, card.group, card.expect) == ("happy", "happy", ())
    assert card.front.image.tobytes() == render_front(A.photo, A.face_box).tobytes()
    assert card.back.image.tobytes() == render_back().tobytes()
    assert card.front.mrz is None
    assert card.back.mrz == HAPPY_MRZ
    assert [label for label, _ in card.front.fields] == [
        f.label for f in front_fields(HAPPY_HOLDER, HAPPY_DOCUMENT)
    ]
    assert [label for label, _ in card.back.fields] == [
        f.label for f in back_fields(HAPPY_HOLDER, HAPPY_DOCUMENT)
    ]
    assert markers_in(card.front.text + card.back.text) == set()


def test_a_side_reads_its_fields_by_label() -> None:
    front = happy_card().front

    assert front.field("Surname") == HAPPY_HOLDER.surname
    with pytest.raises(KeyError, match="Signature"):
        front.field("Signature")


def test_a_side_encodes_as_jpeg_at_its_quality() -> None:
    front = happy_card().front
    data = front.encode()

    assert data[:2] == b"\xff\xd8"
    assert data == encode_jpeg(front.image, JPEG_QUALITY)
    assert len(encode_jpeg(front.image, 50)) < len(data)
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "JPEG"
    assert decode(data).size == front.image.size
    assert decode(data).mode == "RGB"


# --- document data variants -----------------------------------------------------------------------


def test_the_specimen_stamped_variant_prints_specimen_across_both_sides() -> None:
    variant = specimen_stamped(A)
    card = happy_card()
    assert variant.back is not None
    assert card.back is not None

    assert variant.expect == ("id_compromised_detection",)
    for stamped, plain in ((variant.front, card.front), (variant.back, card.back)):
        assert "SPECIMEN" in markers_in(stamped.text)
        difference = np.abs(pixels(stamped.image) - pixels(plain.image)).sum(axis=2)
        changed = pixels(stamped.image)[difference > 30]
        assert len(changed) > 0.02 * difference.size
        assert (changed[:, 0] - changed[:, 1]).mean() > 40  # red ink


def test_the_specimen_stamped_front_also_prints_the_specimen_banner() -> None:
    # A stamp across the portrait is not read by the OCR (calibration, Workflow 3A Stage 4):
    # the card also prints its markers as a published specimen does, in the banner.
    variant = specimen_stamped(A)

    assert SPECIMEN_BANNER == "SPECIMEN - NOT A REAL DOCUMENT"
    assert SPECIMEN_BANNER in variant.front.text
    assert BANNER not in variant.front.text
    assert {"SPECIMEN", "NOT A REAL DOCUMENT"} <= markers_in([SPECIMEN_BANNER])
    assert variant.front.fields == happy_card().front.fields


def test_the_specimen_overprint_variant_is_the_stamp_alone() -> None:
    variant = specimen_overprint(A)
    card = happy_card()
    assert variant.back is not None
    assert card.back is not None

    assert variant.name == "specimen-overprint"
    assert variant.expect == ("id_compromised_detection",)
    assert variant.front.text == (*card.front.text, "SPECIMEN")
    assert variant.back.text == (*card.back.text, "SPECIMEN")
    assert BANNER in variant.front.text
    stamped = specimen_stamped(A)
    assert stamped.back is not None
    assert np.array_equal(pixels(variant.back.image), pixels(stamped.back.image))
    for side, plain in ((variant.front, card.front), (variant.back, card.back)):
        difference = np.abs(pixels(side.image) - pixels(plain.image)).sum(axis=2)
        changed = pixels(side.image)[difference > 30]
        assert len(changed) > 0.02 * difference.size
        assert (changed[:, 0] - changed[:, 1]).mean() > 40  # red ink


def test_the_expired_variant_has_a_past_expiry_with_valid_check_digits() -> None:
    variant = expired(A)
    lines = mrz_of(variant)
    expiry = yymmdd(lines[1][8:14], future=True)

    assert variant.expect == ("id_expired_detection",)
    assert expiry < date.today()
    assert all(td1_digits(lines).values())
    assert ddmmyyyy(variant.front.field("Date of expiry")) == expiry
    assert variant.back is not None
    assert ddmmyyyy(variant.back.field("Date of issue")) < expiry


def test_the_bad_check_digit_variant_differs_from_the_happy_mrz_in_one_check_digit() -> None:
    variant = bad_mrz_check_digit(A)
    lines = mrz_of(variant)
    differing = [
        (row, column)
        for row, (bad, good) in enumerate(zip(lines, HAPPY_MRZ, strict=True))
        for column, (a, b) in enumerate(zip(bad, good, strict=True))
        if a != b
    ]

    assert variant.expect == ("id_mrz_inconsistency_detection",)
    assert differing == [(0, 14)]  # the document number's check digit
    assert lines[0][14].isdigit()
    assert td1_digits(lines) == {
        "document_number": False,
        "birth_date": True,
        "expiration_date": True,
        "composite": False,  # it covers the document number's digit
    }
    assert variant.front.field("Document no.") == lines[0][5:14]


def test_the_mrz_viz_variant_prints_another_birth_date_than_its_valid_mrz() -> None:
    variant = mrz_viz_mismatch(A)
    lines = mrz_of(variant)

    assert set(variant.expect) == {
        "id_mrz_inconsistency_detection",
        "id_extraction_inconsistency_detection",
    }
    assert all(td1_digits(lines).values())
    assert ddmmyyyy(variant.front.field("Date of birth")) != yymmdd(lines[1][0:6], future=False)
    assert variant.front.field("Document no.") == lines[0][5:14]
    assert ddmmyyyy(variant.front.field("Date of expiry")) == yymmdd(lines[1][8:14], future=True)
    assert variant.front.field("Surname") == lines[2].split("<<")[0]


def test_the_issued_after_expiry_variant_prints_an_issue_date_after_its_expiry() -> None:
    variant = issued_after_expiry(A)
    lines = mrz_of(variant)
    assert variant.back is not None

    assert variant.expect == ("id_valid_dates_detection",)
    expiry = ddmmyyyy(variant.front.field("Date of expiry"))
    assert ddmmyyyy(variant.back.field("Date of issue")) > expiry
    assert expiry == yymmdd(lines[1][8:14], future=True)
    assert expiry > date.today()  # not expired: only the date order is wrong
    assert all(td1_digits(lines).values())


def test_the_under_age_variant_holder_is_a_minor_while_the_card_is_valid() -> None:
    variant = under_age(A)
    lines = mrz_of(variant)
    assert variant.back is not None
    birth = yymmdd(lines[1][0:6], future=False)
    expiry = yymmdd(lines[1][8:14], future=True)

    assert variant.expect == ("id_age_comparison",)
    assert age_on(birth, expiry) < 18
    assert birth < ddmmyyyy(variant.back.field("Date of issue")) < expiry
    assert ddmmyyyy(variant.front.field("Date of birth")) == birth
    assert all(td1_digits(lines).values())


def test_the_po_box_variant_prints_a_po_box_address() -> None:
    variant = po_box(A)
    card = happy_card()
    assert variant.back is not None
    assert card.back is not None

    assert variant.expect == ("id_po_box_detection",)
    assert PO_BOX.search(variant.back.field("Address"))
    assert not PO_BOX.search(card.back.field("Address"))
    assert all(td1_digits(mrz_of(variant)).values())


@pytest.mark.parametrize(
    "build",
    [
        specimen_stamped,
        specimen_overprint,
        expired,
        bad_mrz_check_digit,
        mrz_viz_mismatch,
        issued_after_expiry,
        under_age,
        po_box,
    ],
)
def test_a_data_variant_is_a_kebab_case_variant_expecting_catalog_checks(
    build: object,
) -> None:
    assert callable(build)
    variant = build(A)

    assert isinstance(variant, Variant)
    assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", variant.name)
    assert variant.group == "variant"
    assert variant.expect
    assert set(variant.expect) <= catalog_ids()
    assert variant.description
    assert variant.front.image.size == happy_card().front.image.size


# --- capture variants -----------------------------------------------------------------------------


def bgr(image: Image.Image) -> np.ndarray:
    return np.ascontiguousarray(np.asarray(image.convert("RGB"))[..., ::-1])


def uploaded(side: Side) -> np.ndarray:
    """The side as the vision service decodes the upload (BGR)."""
    return bgr(decode(side.encode()))


def mean_saturation(image: np.ndarray) -> float:
    return float(cv2.cvtColor(image, cv2.COLOR_BGR2HSV)[..., 1].mean())


def grid_energy(image: np.ndarray) -> float:
    """The strongest spectral peak at a display pixel pitch (0.3 to 0.5 cycles per pixel, a
    period of 2 to 3.3 pixels) over that band's median: a photographed pixel grid or its moiré."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    detail = gray - cv2.GaussianBlur(gray, (0, 0), 3)
    spectrum = np.abs(np.fft.fftshift(np.fft.fft2(detail)))
    height, width = spectrum.shape
    yy, xx = np.mgrid[0:height, 0:width]
    radius = np.hypot((yy - height / 2) / height, (xx - width / 2) / width)
    band = spectrum[(radius > 0.3) & (radius < 0.5)]
    return float(np.percentile(band, 99.99) / np.median(band))


def near(ratio: float, target: float, tolerance: float) -> bool:
    return abs(ratio - target) <= tolerance * target


def test_the_blurred_variant_front_is_well_below_the_blur_threshold() -> None:
    variant = blurred(A)
    card = happy_card()

    assert variant.expect == ("id_blur_detection",)
    assert blur_score(uploaded(variant.front)) < DEFAULT_BLUR_MIN / 2
    assert blur_score(uploaded(card.front)) > DEFAULT_BLUR_MIN * 2
    assert variant.back is not None
    assert card.back is not None
    assert variant.back.image.tobytes() == card.back.image.tobytes()


def test_the_glare_variant_front_has_a_specular_highlight_over_the_glare_threshold() -> None:
    variant = glare(A)

    assert variant.expect == ("id_glare_detection",)
    assert glare_ratio(uploaded(variant.front)) > DEFAULT_GLARE_MAX * 1.5
    assert glare_ratio(uploaded(happy_card().front)) < DEFAULT_GLARE_MAX / 5


def test_the_low_resolution_variant_front_keeps_the_card_shape_at_a_third_of_its_width() -> None:
    variant = low_resolution(A)
    width, height = variant.front.image.size

    assert variant.expect == ("id_blur_detection",)
    assert width <= CARD_SIZE[0] * 0.35
    assert near(width / height, CARD_SIZE[0] / CARD_SIZE[1], 0.02)


def test_the_photocopy_variant_is_grayscale_and_neither_blurred_nor_glaring() -> None:
    variant = photocopy(A)
    assert variant.back is not None

    assert variant.expect == ("id_color_inconsistency_detection",)
    assert mean_saturation(uploaded(happy_card().front)) > 30
    for side in (variant.front, variant.back):
        rgb = pixels(side.image)
        assert np.array_equal(rgb[..., 0], rgb[..., 1])
        assert np.array_equal(rgb[..., 1], rgb[..., 2])
        upload = uploaded(side)
        assert mean_saturation(upload) < 3
        assert glare_ratio(upload) < 0.01
        assert blur_score(upload) > DEFAULT_BLUR_MIN


def test_the_screen_recapture_variant_shows_a_pixel_grid_and_moire() -> None:
    variant = screen_recapture(A)
    card = happy_card()
    assert variant.back is not None
    assert card.back is not None

    assert variant.expect == ("id_electronic_replica_detection",)
    for recaptured, plain in ((variant.front, card.front), (variant.back, card.back)):
        assert grid_energy(uploaded(recaptured)) > 3 * grid_energy(uploaded(plain))
        assert glare_ratio(uploaded(recaptured)) < 0.01


def test_the_screen_recapture_keeps_the_card_about_as_bright_as_the_original() -> None:
    variant = screen_recapture(A)
    card = happy_card()
    assert variant.back is not None
    assert card.back is not None

    for recaptured, plain in ((variant.front, card.front), (variant.back, card.back)):
        brightness = uploaded(recaptured).mean()
        assert near(float(brightness), float(uploaded(plain).mean()), 0.15)


def _area(quad: Quad) -> float:
    xs, ys = np.array([p[0] for p in quad]), np.array([p[1] for p in quad])
    return float(abs(np.dot(xs, np.roll(ys, 1)) - np.dot(ys, np.roll(xs, 1))) / 2)


def _aspect(quad: Quad) -> float:
    corners = np.array(quad)
    top, right = np.linalg.norm(corners[1] - corners[0]), np.linalg.norm(corners[2] - corners[1])
    bottom, left = np.linalg.norm(corners[2] - corners[3]), np.linalg.norm(corners[3] - corners[0])
    return float((top + bottom) / (left + right))


def test_the_on_background_variant_shows_the_card_inside_its_known_quad() -> None:
    variant = on_background(A)
    card = happy_card()
    assert variant.back is not None
    assert card.back is not None

    assert (variant.group, variant.expect) == ("happy", ())
    for photographed, plain in ((variant.front, card.front), (variant.back, card.back)):
        quad = photographed.quad
        assert quad is not None
        width, height = photographed.image.size
        frame = width / height
        assert not near(frame, 1.586, 0.12)  # a whole frame is no document: the quad must be found
        assert not near(frame, 1.42, 0.12)
        assert 0.3 < _area(quad) / (width * height) < 0.7
        assert near(_aspect(quad), CARD_SIZE[0] / CARD_SIZE[1], 0.05)
        width_px, height_px = CARD_SIZE
        target = np.array(
            [[0, 0], [width_px, 0], [width_px, height_px], [0, height_px]], dtype=np.float32
        )
        warp = cv2.getPerspectiveTransform(np.array(quad, dtype=np.float32), target)
        flat = cv2.warpPerspective(uploaded(photographed), warp, CARD_SIZE)
        inner = (slice(24, CARD_SIZE[1] - 24), slice(24, CARD_SIZE[0] - 24))
        assert np.abs(flat[inner].astype(np.int16) - bgr(plain.image)[inner]).mean() < 12


@pytest.mark.parametrize(
    "build", [blurred, glare, low_resolution, photocopy, screen_recapture, on_background]
)
def test_a_capture_variant_is_deterministic(build: object) -> None:
    assert callable(build)
    first, second = build(A), build(A)

    assert first.front.encode() == second.front.encode()
    assert (first.back is None) == (second.back is None)
    if first.back is not None and second.back is not None:
        assert first.back.encode() == second.back.encode()


# --- tampering and content variants ---------------------------------------------------------------


def reencode_error(image: Image.Image, quality: int) -> float:
    """How much one more JPEG pass at ``quality`` changes ``image``: low when it already went
    through that quality on the same 8 x 8 grid (JPEG is close to idempotent)."""
    again = decode(encode_jpeg(image, quality))
    return float(np.abs(pixels(again) - pixels(image)).mean())


def stroke_width_spread(gray: np.ndarray, ink_below: int = 110) -> float:
    """Coefficient of variation of stroke widths along the ink's medial ridges."""
    ink = (gray < ink_below).astype(np.uint8)
    distance = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
    ridge = (distance > 0) & (distance >= cv2.dilate(distance, np.ones((3, 3), np.uint8)))
    widths = 2 * distance[ridge]
    return float(widths.std() / widths.mean())


def test_the_portrait_swap_variant_pastes_another_face_with_its_own_jpeg_history() -> None:
    variant = portrait_swap(A, B)
    card = happy_card()
    x, y, w, h = PORTRAIT_BOX
    box = (x, y, x + w, y + h)
    genuine = decode(encode_jpeg(card.front.image))

    assert variant.expect == ("id_tamper_detection",)
    swapped = variant.front.image.crop(box)
    assert np.abs(pixels(swapped) - pixels(genuine.crop(box))).mean() > 10
    assert reencode_error(swapped, 60) < reencode_error(genuine.crop(box), 60) / 4
    outside = np.ones((CARD_SIZE[1], CARD_SIZE[0]), dtype=bool)
    outside[y : y + h, x : x + w] = False
    assert np.array_equal(pixels(variant.front.image)[outside], pixels(genuine)[outside])
    assert variant.back is not None
    assert card.back is not None
    assert variant.back.image.tobytes() == card.back.image.tobytes()


def test_the_copy_move_variant_repeats_a_textured_patch_of_the_front_elsewhere() -> None:
    variant = copy_move(A)
    card = happy_card()
    moved = pixels(variant.front.image)
    changed = np.abs(moved - pixels(card.front.image)).sum(axis=2) > 0
    rows, columns = np.nonzero(changed)
    top, bottom, left, right = rows.min(), rows.max() + 1, columns.min(), columns.max() + 1
    patch = np.asarray(variant.front.image)[top:bottom, left:right]

    assert variant.expect == ("id_tamper_detection",)
    assert patch.std() > 20  # text on guilloche: something for a copy-move detector to match
    scores = cv2.matchTemplate(np.asarray(card.front.image), patch, cv2.TM_SQDIFF)
    _, _, (source_x, source_y), _ = cv2.minMaxLoc(scores)
    # The best match only locates the source: OpenCV sums the squared differences in floating
    # point, so a perfect match need not score exactly 0 on every CPU. The pixels are compared
    # exactly instead.
    height, width = patch.shape[:2]
    source = np.asarray(card.front.image)[source_y : source_y + height, source_x : source_x + width]
    assert np.array_equal(source, patch)
    assert source_x + patch.shape[1] <= left or source_y + patch.shape[0] <= top
    assert variant.front.fields == card.front.fields


def test_the_handwritten_variant_writes_one_field_by_hand_in_blue_ink() -> None:
    variant = handwritten_field(A)
    card = happy_card()
    field = next(f for f in front_fields(HAPPY_HOLDER, HAPPY_DOCUMENT) if f.label == "Given names")
    left, top, right, bottom = value_box(field)
    region = (slice(top - 12, bottom + 12), slice(left - 16, right + 48))
    written = np.asarray(variant.front.image.convert("L"))[region]
    printed = np.asarray(card.front.image.convert("L"))[region]

    assert variant.expect == ("id_handwriting_detection",)
    assert variant.front.field("Given names") == field.value
    assert stroke_width_spread(written) > 1.4 * stroke_width_spread(printed)
    new_ink = pixels(variant.front.image)[region][written.astype(np.int16) < printed - 40]
    assert len(new_ink) > 100
    assert (new_ink[:, 2] - new_ink[:, 0]).mean() > 30  # blue ballpoint, not the card's ink
    rest = pixels(variant.front.image).copy()
    rest[region] = 0
    plain = pixels(card.front.image).copy()
    plain[region] = 0
    assert np.array_equal(rest, plain)  # nothing else changed


def test_the_front_as_back_variant_uploads_the_front_again_re_encoded() -> None:
    variant = front_as_back(A)
    back = variant.back
    assert back is not None

    assert variant.expect == ("id_double_side_detection",)
    assert back.image.tobytes() == variant.front.image.tobytes()
    assert back.quality != variant.front.quality
    assert back.encode() != variant.front.encode()
    difference = np.abs(pixels(decode(back.encode())) - pixels(decode(variant.front.encode())))
    assert difference.mean() < 3
    assert back.mrz is None


def test_the_no_portrait_variant_leaves_the_portrait_zone_empty() -> None:
    variant = no_portrait()
    x, y, w, h = PORTRAIT_BOX
    inner = (slice(y + 4, y + h - 4), slice(x + 4, x + w - 4))

    assert variant.expect == ("id_portrait_detection",)
    assert np.array_equal(pixels(variant.front.image)[inner], pixels(background())[inner])
    assert variant.front.fields == happy_card().front.fields
    assert variant.back is not None


def test_the_not_an_id_variant_is_a_page_of_text_without_a_document_shape() -> None:
    variant = not_an_id()
    width, height = variant.front.image.size

    assert variant.expect == ("id_unprocessable_submission_detection",)
    assert variant.back is None
    assert not near(width / height, 1.586, 0.12)
    assert not near(width / height, 1.42, 0.12)
    assert variant.front.mrz is None
    assert variant.front.fields == ()
    assert len(variant.front.text) >= 10
    assert markers_in(variant.front.text) == set()
    assert glare_ratio(uploaded(variant.front)) < 0.01
    assert not_an_id().front.encode() == variant.front.encode()


@pytest.mark.parametrize("build", [copy_move, handwritten_field, front_as_back])
def test_a_tampering_variant_is_deterministic(build: object) -> None:
    assert callable(build)
    first, second = build(A), build(A)

    assert first.front.encode() == second.front.encode()
    assert first.back is not None
    assert second.back is not None
    assert first.back.encode() == second.back.encode()


def test_the_portrait_swap_is_deterministic() -> None:
    assert portrait_swap(A, B).front.encode() == portrait_swap(A, B).front.encode()


def test_every_side_names_the_portrait_photo_it_shows() -> None:
    portraits = {
        variant.name: (
            variant.front.portrait,
            None if variant.back is None else variant.back.portrait,
        )
        for variant in c36_set()
    }

    assert portraits["happy"] == (A.name, None)
    assert portraits["portrait-swap"] == (B.name, None)
    assert portraits["no-portrait"] == (None, None)
    assert portraits["not-an-id"] == (None, None)
    assert portraits["front-as-back"] == (A.name, A.name)  # the back is the front again
    assert portraits["td3-passport"] == (A.name, None)
    assert happy_card().front.truth()["portrait"] == A.name
    names = [v.front.portrait for v in distinct_holders(A, B)]
    assert names == [B.name, A.name, B.name, A.name]


# --- other document classes and the sets ----------------------------------------------------------

C36_NAMES = (
    "happy",
    "specimen-stamped",
    "specimen-overprint",
    "expired",
    "bad-mrz-check-digit",
    "mrz-viz-mismatch",
    "issued-after-expiry",
    "under-age",
    "po-box",
    "blurred",
    "glare",
    "low-resolution",
    "photocopy",
    "screen-recapture",
    "portrait-swap",
    "copy-move",
    "handwritten-field",
    "front-as-back",
    "no-portrait",
    "not-an-id",
    "on-background",
    "td3-passport",
    "mrv-a-visa",
)
"""The happy card, then every C36 variant in the plan's order."""


def test_the_td3_passport_variant_is_a_single_sided_utopia_passport_page() -> None:
    variant = td3_passport(A)
    lines = variant.front.mrz
    assert lines is not None

    assert (variant.name, variant.group, variant.expect, variant.back) == (
        "td3-passport",
        "happy",
        (),
        None,
    )
    assert variant.front.image.size == PASSPORT_SIZE
    assert lines == passport_mrz(HAPPY_HOLDER, HAPPY_PASSPORT)
    assert all(td3_digits(lines).values())
    assert variant.front.field("Passport no.") == HAPPY_PASSPORT.document_number
    assert markers_in(variant.front.text) == set()


def test_the_mrv_a_visa_variant_is_a_single_sided_utopia_visa() -> None:
    variant = mrva_visa(A)
    lines = variant.front.mrz
    assert lines is not None

    assert (variant.name, variant.group, variant.expect, variant.back) == (
        "mrv-a-visa",
        "happy",
        (),
        None,
    )
    assert variant.front.image.size == VISA_SIZE
    assert lines == visa_mrz(HAPPY_HOLDER, HAPPY_VISA)
    assert lines[0].startswith("V<UTO")
    assert all(mrv_digits(lines).values())
    assert variant.front.field("Visa no.") == HAPPY_VISA.visa_number
    assert markers_in(variant.front.text) == set()


@cache
def c36_set() -> tuple[Variant, ...]:
    return c36_variants(A, B)


def test_the_c36_set_is_the_happy_card_then_every_planned_variant_in_order() -> None:
    variants = c36_set()

    assert tuple(variant.name for variant in variants) == C36_NAMES
    for variant in variants:
        assert set(variant.expect) <= catalog_ids(), variant.name
        assert variant.group == ("variant" if variant.expect else "happy"), variant.name
        assert variant.description, variant.name


def test_every_variant_of_the_set_trips_a_check_unless_it_is_a_happy_document() -> None:
    happy_documents = {v.name for v in c36_set() if not v.expect}

    assert happy_documents == {"happy", "on-background", "td3-passport", "mrv-a-visa"}


def test_distinct_holders_are_happy_cards_of_other_fictional_people() -> None:
    holders = distinct_holders(A, B)
    card = happy_card()
    numbers = {mrz_of(v)[0][5:14] for v in holders} | {mrz_of(card)[0][5:14]}
    surnames = {v.front.field("Surname") for v in holders} | {card.front.field("Surname")}

    assert len(holders) >= 4
    assert [v.name for v in holders] == [f"holder-{i}" for i in range(2, len(holders) + 2)]
    assert len(numbers) == len(surnames) == len(holders) + 1
    assert numbers.isdisjoint(ICAO_EXAMPLE_NUMBERS)
    for variant in holders:
        assert (variant.group, variant.expect) == ("distinct-holder", ())
        assert all(td1_digits(mrz_of(variant)).values())
        assert variant.back is not None
        assert markers_in(variant.front.text + variant.back.text) == set()
        names = set(
            variant.front.field("Surname").split() + variant.front.field("Given names").split()
        )
        assert names.isdisjoint(ICAO_EXAMPLE_NAMES)
    x, y, w, h = PORTRAIT_BOX
    portraits = {variant.front.image.crop((x, y, x + w, y + h)).tobytes() for variant in holders}
    assert len(portraits) == 2  # both public-domain faces take turns


def test_re_encodings_are_the_happy_card_at_other_jpeg_qualities_and_sizes() -> None:
    encodings = re_encodings(A)
    card = happy_card()
    original = pixels(decode(card.front.encode()))

    assert [v.name for v in encodings] == [
        "happy-jpeg-q85",
        "happy-jpeg-q75",
        "happy-jpeg-q60",
        "happy-resized-90",
    ]
    for variant in encodings:
        assert (variant.group, variant.expect) == ("re-encoding", ())
        upload = decode(variant.front.encode())
        assert variant.front.encode() != card.front.encode()
        restored = pixels(upload.resize(CARD_SIZE, Image.Resampling.LANCZOS))
        assert np.abs(restored - original).mean() < 6, variant.name
        assert variant.front.fields == card.front.fields
        assert variant.back is not None
        assert card.back is not None
        assert variant.back.mrz == card.back.mrz
