"""C32.1 measurements on the rectified document and the portrait (vision-document).

``document_quality``: blur (variance of the Laplacian) and Tenengrad on the rectified document,
its size, and the glare share of its text region (the document outside the portrait) and of its
portrait. ``portrait_clarity``: the face width, the face crop's sharpness and a landmark score.
``phash``: the 64-bit DCT perceptual hash of the rectified document. Images are synthetic.
"""

from __future__ import annotations

from typing import Final

import cv2
import numpy as np
import pytest

from document_cards import (
    Box,
    Image,
    card_corners,
    card_to_scene,
    document_sharpness,
    make_card,
    make_photo,
    place_card,
    polygon_area,
)
from openverify_vision.document import (
    NOT_FOUND,
    DocumentResult,
    detect_document,
    measure_document_quality,
    measure_portrait_clarity,
    perceptual_hash,
)
from openverify_vision.faces import Face
from openverify_vision.schemas import BoundingBox, DocumentDetection, DocumentQuality

from synthetic import gaussian_blur, make_noise, make_uniform

FACE_MEASURE_MAX_WIDTH: Final = 112
"""Portrait sharpness is measured on the face crop scaled down to at most this width (SFace's)."""

GLARE: Final = (255, 255, 255)

SCENE: Final = (1600, 1200)


def full_frame(image: Image) -> DocumentResult:
    """A document that is the whole of ``image`` (a tightly cropped upload)."""
    height, width = image.shape[:2]
    detection = DocumentDetection(
        found=True,
        quad=((0.0, 0.0), (float(width), 0.0), (float(width), float(height)), (0.0, float(height))),
        method="full_frame",
        rectified_size=(width, height),
        aspect_ratio=width / height,
        area_ratio=1.0,
    )
    return DocumentResult(detection=detection, rectified=image)


def variance_of_laplacian(image: Image) -> float:
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    return float(cv2.Laplacian(grey, cv2.CV_64F).var())


def as_bbox(box: Box) -> BoundingBox:
    x, y, w, h = box
    return (float(x), float(y), float(w), float(h))


def quality_of(document: DocumentResult, portrait: BoundingBox | None) -> DocumentQuality:
    measured = measure_document_quality(document, text_boxes=(), portrait_box=portrait)
    assert measured is not None
    return measured


# --- document_quality ----------------------------------------------------------------------------


def test_without_a_document_nothing_is_measured() -> None:
    nothing = detect_document(make_photo(480, 640))

    assert nothing.rectified is None
    assert measure_document_quality(nothing, text_boxes=(), portrait_box=None) is None
    assert perceptual_hash(nothing) is None


def test_blur_and_tenengrad_are_measured_on_the_rectified_document() -> None:
    card = make_card()
    height, width = card.image.shape[:2]

    measured = quality_of(full_frame(card.image), None)

    blur, gradient = document_sharpness(card.image)
    assert measured.blur_score == pytest.approx(blur, abs=1e-3)
    assert measured.tenengrad == pytest.approx(gradient, abs=1e-2)
    assert (measured.width_px, measured.height_px) == (width, height)


def test_the_rectified_document_of_a_photo_is_what_gets_measured() -> None:
    card = make_card()
    scene = place_card(card, card_corners(800, 600, 1000, degrees=12), SCENE)
    document = detect_document(scene.image)
    assert document.rectified is not None
    height, width = document.rectified.shape[:2]

    measured = quality_of(document, None)

    assert (measured.width_px, measured.height_px) == (width, height)
    blur, gradient = document_sharpness(document.rectified)
    assert measured.blur_score == pytest.approx(blur, abs=1e-3)
    assert measured.tenengrad == pytest.approx(gradient, abs=1e-2)


def test_a_blurred_document_scores_lower_on_both_sharpness_measures() -> None:
    card = make_card()

    sharp = quality_of(full_frame(card.image), None)
    blurred = quality_of(full_frame(gaussian_blur(card.image, sigma=3.0)), None)

    assert blurred.blur_score < sharp.blur_score / 4
    assert blurred.tenengrad < sharp.tenengrad / 2


def test_sharpness_is_measured_at_a_fixed_width() -> None:
    """A photo with more pixels is not blurrier, nor one with fewer sharper: the score is taken
    at a common width, 1,000 pixels (Phase 12A V3; it was "at most 1,280" before)."""
    big = make_card(2560).image

    measured = quality_of(full_frame(big), None)

    assert (measured.width_px, measured.height_px) == big.shape[1::-1]
    blur, gradient = document_sharpness(big)
    assert measured.blur_score == pytest.approx(blur, abs=1e-3)
    assert measured.tenengrad == pytest.approx(gradient, abs=1e-2)


def test_glare_on_the_text_and_on_the_portrait_is_measured_apart() -> None:
    card = make_card()
    image = card.image.copy()
    height, width = image.shape[:2]
    image[300:340, 500:700] = GLARE  # 40 x 200 in the text area
    px, py, pw, ph = card.portrait

    measured = quality_of(full_frame(image), as_bbox(card.portrait))

    text_area = width * height - pw * ph
    assert measured.glare_ratio_text == pytest.approx(40 * 200 / text_area, rel=0.02)
    assert measured.glare_ratio_portrait == 0.0

    image[py : py + ph // 2, px : px + pw] = GLARE  # the upper half of the portrait
    measured = quality_of(full_frame(image), as_bbox(card.portrait))

    assert measured.glare_ratio_portrait == pytest.approx(0.5, abs=0.02)
    assert measured.glare_ratio_text == pytest.approx(40 * 200 / text_area, rel=0.02)


def test_without_a_portrait_the_text_region_is_the_whole_document() -> None:
    card = make_card()
    image = card.image.copy()
    height, width = image.shape[:2]
    image[300:340, 500:700] = GLARE

    measured = quality_of(full_frame(image), None)

    assert measured.glare_ratio_portrait is None  # not measured, never "no glare"
    assert measured.glare_ratio_text == pytest.approx(40 * 200 / (width * height), rel=0.02)


def test_the_portrait_box_is_mapped_from_the_photo_onto_the_rectified_document() -> None:
    card = make_card()
    px, py, pw, ph = card.portrait
    card.image[py : py + ph, px : px + pw] = GLARE  # glare all over the portrait
    corners = card_corners(800, 600, 1000, degrees=12, perspective=0.05)
    scene = place_card(card, corners, SCENE)
    document = detect_document(scene.image)
    # The portrait as the face detector would report it: an upright box in photo pixels. Around
    # a portrait turned 12 degrees it also covers some card: the portrait fills this share of it.
    outline = np.float32([[px, py], [px + pw, py], [px + pw, py + ph], [px, py + ph]])
    mapped = cv2.perspectiveTransform(outline.reshape(-1, 1, 2), card_to_scene(card, corners))
    x, y, w, h = cv2.boundingRect(mapped.reshape(-1, 2))
    portrait_share = polygon_area(mapped.reshape(-1, 2)) / (w * h)

    measured = quality_of(document, (float(x), float(y), float(w), float(h)))

    assert measured.glare_ratio_portrait == pytest.approx(portrait_share, abs=0.03)
    # All the glare is inside the box, none on the text.
    assert measured.glare_ratio_text == 0.0


def test_a_portrait_outside_the_document_is_not_its_portrait() -> None:
    card = make_card()
    scene = place_card(card, card_corners(800, 600, 1000, degrees=0), SCENE)
    document = detect_document(scene.image)

    measured = quality_of(document, (20.0, 20.0, 120.0, 150.0))  # on the surface, off the card

    assert measured.glare_ratio_portrait is None
    assert measured.glare_ratio_text == quality_of(document, None).glare_ratio_text


def test_a_document_without_a_quad_cannot_place_a_portrait() -> None:
    """A hand-built result whose detection has no quad: the portrait cannot be mapped onto it."""
    image = make_card().image
    unplaced = DocumentResult(detection=NOT_FOUND, rectified=image)

    measured = quality_of(unplaced, (10.0, 10.0, 50.0, 50.0))

    assert measured.glare_ratio_portrait is None
    assert measured.glare_ratio_text == quality_of(full_frame(image), None).glare_ratio_text


def test_a_portrait_across_the_vanishing_line_is_not_on_the_document() -> None:
    """The sides of this trapezoid meet at y = 62.5: the lower corners of a box crossing that
    line map behind the camera. Divided through anyway, they would paint most of the document."""
    image = np.full((63, 100, 3), 128, dtype=np.uint8)
    detection = DocumentDetection(
        found=True,
        quad=((0.0, 0.0), (100.0, 0.0), (60.0, 50.0), (40.0, 50.0)),
        method="contour",
        rectified_size=(100, 63),
        aspect_ratio=1.5,
        area_ratio=0.5,
    )
    document = DocumentResult(detection=detection, rectified=image)

    measured = quality_of(document, (40.0, 55.0, 20.0, 20.0))

    assert measured.glare_ratio_portrait is None


def test_document_quality_satisfies_the_contract() -> None:
    card = make_card()

    measured = quality_of(full_frame(card.image), as_bbox(card.portrait))

    assert DocumentQuality.model_validate(measured.model_dump(mode="json")) == measured


# --- portrait_clarity ----------------------------------------------------------------------------


def portrait_photo() -> Image:
    """A face-sized patch with fine detail on a plain background."""
    image = make_uniform((120, 130, 140), height=400, width=300)
    image[100:300, 80:240] = make_noise(height=200, width=160, seed=11)
    return image


FACE: Final = Face(
    box=(80.0, 100.0, 160.0, 200.0),
    landmarks=((130.0, 170.0), (190.0, 170.0), (160.0, 210.0), (135.0, 250.0), (185.0, 250.0)),
    score=0.93,
)


def test_without_a_portrait_clarity_is_not_measured() -> None:
    assert measure_portrait_clarity(portrait_photo(), None) is None


def test_portrait_clarity_measures_the_face_crop() -> None:
    image = portrait_photo()

    clarity = measure_portrait_clarity(image, FACE)

    assert clarity is not None
    assert clarity.face_width_px == 160.0
    # The grey crop, scaled down: colour carries nothing for sharpness, and greyscale uploads
    # then measure exactly the same (see the greyscale test below).
    crop = cv2.cvtColor(image[100:300, 80:240], cv2.COLOR_BGR2GRAY)
    scaled = cv2.resize(crop, (FACE_MEASURE_MAX_WIDTH, 140), interpolation=cv2.INTER_AREA)
    assert clarity.sharpness == pytest.approx(variance_of_laplacian(scaled), abs=1e-3)
    assert clarity.landmarks_score == pytest.approx(0.93)


def test_a_small_face_is_measured_at_its_own_size() -> None:
    image = portrait_photo()
    small = Face(box=(100.0, 120.0, 80.0, 100.0), landmarks=((140.0, 170.0),) * 5, score=0.9)

    clarity = measure_portrait_clarity(image, small)

    assert clarity is not None
    assert clarity.face_width_px == 80.0
    assert clarity.sharpness == pytest.approx(
        variance_of_laplacian(image[120:220, 100:180]), abs=1e-3
    )


def test_a_blurred_portrait_is_less_sharp() -> None:
    sharp = measure_portrait_clarity(portrait_photo(), FACE)
    blurred = measure_portrait_clarity(gaussian_blur(portrait_photo(), sigma=4.0), FACE)

    assert sharp is not None
    assert blurred is not None
    assert blurred.sharpness < sharp.sharpness / 4


def test_landmarks_off_the_face_lower_the_landmark_score() -> None:
    off = Face(
        box=FACE.box,
        landmarks=((130.0, 170.0), (190.0, 170.0), (160.0, 210.0), (10.0, 250.0), (290.0, 380.0)),
        score=0.93,
    )
    outside = Face(box=(250.0, 100.0, 160.0, 200.0), landmarks=((350.0, 170.0),) * 5, score=0.9)

    clarity = measure_portrait_clarity(portrait_photo(), off)
    clipped = measure_portrait_clarity(portrait_photo(), outside)

    assert clarity is not None
    assert clarity.landmarks_score == pytest.approx(0.93 * 3 / 5)
    # A face box running off the image is measured on the part inside it; landmarks outside the
    # image count as missing.
    assert clipped is not None
    assert clipped.face_width_px == 160.0
    assert clipped.landmarks_score == 0.0


def test_a_face_box_wholly_outside_the_image_has_no_clarity() -> None:
    gone = Face(box=(400.0, 500.0, 50.0, 60.0), landmarks=((420.0, 530.0),) * 5, score=0.95)

    assert measure_portrait_clarity(portrait_photo(), gone) is None


def test_portrait_clarity_accepts_greyscale() -> None:
    grey = cv2.cvtColor(portrait_photo(), cv2.COLOR_BGR2GRAY)

    clarity = measure_portrait_clarity(grey, FACE)

    colour = measure_portrait_clarity(portrait_photo(), FACE)
    assert clarity is not None
    assert colour is not None
    assert clarity.sharpness == pytest.approx(colour.sharpness, rel=1e-6)


# --- phash ---------------------------------------------------------------------------------------


def reference_phash(image: Image) -> str:
    """The pHash written out by hand: 32 x 32 grey (area resampling), the orthonormal 2-D DCT-II
    as matrix products, the 8 x 8 block of the lowest frequencies after the DC row and column,
    bits above the block's median, read row by row with the first bit most significant."""
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    small = cv2.resize(grey, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float64)
    k = np.arange(32)
    basis = np.cos(np.pi * (2 * k[None, :] + 1) * k[:, None] / 64)
    basis *= np.where(k == 0, np.sqrt(1 / 32), np.sqrt(2 / 32))[:, None]
    block = (basis @ small @ basis.T)[1:9, 1:9]
    value = 0
    for bit in (block > np.median(block)).flatten():
        value = (value << 1) | int(bit)
    return f"{value:016x}"


def golden_image() -> Image:
    yy, xx = np.mgrid[0:320, 0:512]
    level = xx * 0.35 + yy * 0.2 + 40 * np.sin(xx / 37.0) * np.cos(yy / 23.0)
    level += 60 * ((xx // 64 + yy // 40) % 3)
    grey = np.clip(level, 0, 255).astype(np.uint8)
    return np.stack([grey, (grey * 0.8).astype(np.uint8), 255 - grey], axis=-1)


def hamming(a: str, b: str) -> int:
    return (int(a, 16) ^ int(b, 16)).bit_count()


def reencoded(image: Image, *, quality: int, scale: float) -> Image:
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    decoded = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    size = (round(image.shape[1] * scale), round(image.shape[0] * scale))
    return np.asarray(cv2.resize(decoded, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


def test_the_hash_is_16_lowercase_hex_characters() -> None:
    value = perceptual_hash(full_frame(make_card().image))

    assert value is not None
    assert len(value) == 16
    assert value == value.lower()
    int(value, 16)


@pytest.mark.parametrize(
    "image",
    [make_card().image, make_card(seed=3, header=0.2).image, golden_image(), make_noise(40, 64)],
    ids=["card", "other-card", "pattern", "noise"],
)
def test_the_hash_is_the_dct_phash_of_the_rectified_document(image: Image) -> None:
    assert perceptual_hash(full_frame(image)) == reference_phash(image)


def test_the_hash_of_a_known_image_is_pinned() -> None:
    """Stored hashes are compared across versions (C34): the bit order must never change."""
    assert perceptual_hash(full_frame(golden_image())) == "07420ff226bdf20f"


@pytest.mark.parametrize("quality", [90, 60, 40])
@pytest.mark.parametrize("scale", [1.0, 0.6, 0.4])
def test_the_hash_survives_reencoding_and_resizing(quality: int, scale: float) -> None:
    card = make_card().image
    original = perceptual_hash(full_frame(card))
    copy = perceptual_hash(full_frame(reencoded(card, quality=quality, scale=scale)))

    assert original is not None
    assert copy is not None
    assert hamming(original, copy) <= 4


def test_the_same_card_photographed_hashes_like_its_tight_crop() -> None:
    card = make_card()
    scene = place_card(card, card_corners(800, 600, 1000, degrees=-20, perspective=0.08), SCENE)

    photographed = perceptual_hash(detect_document(scene.image))
    cropped = perceptual_hash(full_frame(card.image))

    assert photographed is not None
    assert cropped is not None
    assert hamming(photographed, cropped) <= 4


@pytest.mark.parametrize(
    "other",
    [
        make_card(header=0.25).image,
        make_card(frames=False).image,
        cv2.flip(make_card().image, 1),
        golden_image(),
    ],
    ids=["other-layout", "blank-card", "mirrored", "pattern"],
)
def test_different_documents_hash_far_apart(other: Image) -> None:
    card = perceptual_hash(full_frame(make_card().image))
    different = perceptual_hash(full_frame(other))

    assert card is not None
    assert different is not None
    assert hamming(card, different) >= 16


def test_a_featureless_document_has_no_hash() -> None:
    """A flat image's DCT block is all zero: any bits would be rounding noise."""
    assert perceptual_hash(full_frame(make_uniform(128, height=540, width=856))) is None
