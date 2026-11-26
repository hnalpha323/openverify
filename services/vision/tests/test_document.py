"""C32.1 document detection and rectification (vision-document).

The detector is OpenCV only (``docs/research/phase3-libraries.md`` section 4). A quad counts only
with an area ratio of at least 0.3 and an aspect ratio within 12% of ID-1 or TD3; otherwise a
frame of such an aspect ratio is a tightly cropped document (``full_frame``); otherwise nothing is
found. Images are synthetic (``document_cards.py``).
"""

from __future__ import annotations

from typing import Final

import cv2
import numpy as np
import pytest

from document_cards import (
    HEADER_COLOUR,
    ID1_ASPECT,
    TD3_ASPECT,
    Card,
    card_corners,
    corner_error,
    make_card,
    make_photo,
    on_screen,
    place_card,
)
from openverify_vision import document
from openverify_vision.document import NOT_FOUND, DocumentResult, detect_document
from openverify_vision.schemas import DocumentDetection

from synthetic import make_checkerboard, make_noise

MIN_AREA_RATIO: Final = 0.3
ASPECT_TOLERANCE: Final = 0.12
SCENE: Final = (1600, 1200)
"""A 4:3 camera frame: its own aspect ratio is within 12% of TD3, so it could be ``full_frame``."""

CORNER_TOLERANCE_PX: Final = 2.0
"""At most this far from the true corners on a 1600 x 1200 photo of a 1000-pixel-wide card."""


def found(result: DocumentResult) -> DocumentDetection:
    detection = result.detection
    assert detection.found is True, detection
    assert detection.quad is not None
    assert detection.rectified_size is not None
    assert result.rectified is not None
    return detection


def near_canonical(aspect: float) -> bool:
    return any(abs(aspect / c - 1.0) <= ASPECT_TOLERANCE for c in (ID1_ASPECT, TD3_ASPECT))


def assert_rectified_shows(result: DocumentResult, card: Card) -> None:
    """The rectified image is the card itself, upright: compare it with the card resized."""
    assert result.rectified is not None
    height, width = result.rectified.shape[:2]
    expected = cv2.resize(card.image, (width, height), interpolation=cv2.INTER_AREA)
    inside = cv2.resize(card.mask, (width, height), interpolation=cv2.INTER_NEAREST) == 255
    difference = np.abs(result.rectified.astype(np.int16) - expected.astype(np.int16))
    assert float(difference[inside].mean()) < 12.0


# --- a card photographed on a background --------------------------------------------------------


@pytest.mark.parametrize("rounded", [False, True], ids=["square-corners", "rounded-corners"])
@pytest.mark.parametrize(
    ("degrees", "perspective"),
    [(0.0, 0.0), (12.0, 0.0), (-20.0, 0.08), (35.0, 0.1)],
    ids=["upright", "rotated", "rotated-tilted", "rotated-more-tilted"],
)
def test_a_card_on_a_background_is_found_by_its_outline(
    rounded: bool, degrees: float, perspective: float
) -> None:
    card = make_card(rounded=rounded)
    corners = card_corners(800, 600, 1000, degrees=degrees, perspective=perspective)
    scene = place_card(card, corners, SCENE)

    result = detect_document(scene.image)

    detection = found(result)
    assert detection.method == "contour"
    assert corner_error(detection.quad, scene.corners) <= CORNER_TOLERANCE_PX
    assert detection.area_ratio == pytest.approx(scene.area_ratio, rel=0.01)
    assert detection.aspect_ratio is not None
    assert near_canonical(detection.aspect_ratio)
    assert_rectified_shows(result, card)


def test_the_rectified_card_has_the_id_1_proportions_at_the_photo_resolution() -> None:
    card = make_card()
    corners = card_corners(800, 600, 1000, degrees=-20, perspective=0.08)
    scene = place_card(card, corners, SCENE)

    result = detect_document(scene.image)

    detection = found(result)
    assert detection.rectified_size is not None
    width, height = detection.rectified_size
    # As wide as the longer of the card's top and bottom sides on the photo, never resampled up
    # to a fixed size, so the resolution of the capture stays measurable.
    assert width == pytest.approx(1000, abs=3)
    assert width / height == pytest.approx(ID1_ASPECT, rel=0.01)
    assert result.rectified is not None
    assert result.rectified.shape == (height, width, 3)
    assert result.rectified.dtype == np.uint8


def test_the_quad_runs_clockwise_from_the_top_left_of_the_card() -> None:
    card = make_card()
    corners = card_corners(800, 600, 1000, degrees=30)
    scene = place_card(card, corners, SCENE)

    detection = found(detect_document(scene.image))

    assert detection.quad is not None
    (tl, tr, br, bl) = detection.quad
    # Turned 30 degrees clockwise: the top-left corner is the leftmost-top one of the card.
    assert corner_error((tl, tr, br, bl), scene.corners) <= CORNER_TOLERANCE_PX
    assert tr[0] > tl[0]
    assert br[1] > tr[1]
    assert bl[0] < br[0]


def test_a_passport_page_is_rectified_to_the_td3_proportions() -> None:
    page = make_card(880, aspect=TD3_ASPECT)
    corners = card_corners(800, 600, 1100, aspect=TD3_ASPECT, degrees=-8, perspective=0.04)
    scene = place_card(page, corners, SCENE)

    result = detect_document(scene.image)

    detection = found(result)
    assert detection.method == "contour"
    assert corner_error(detection.quad, scene.corners) <= CORNER_TOLERANCE_PX
    assert detection.rectified_size is not None
    width, height = detection.rectified_size
    assert width / height == pytest.approx(TD3_ASPECT, rel=0.01)
    assert_rectified_shows(result, page)


def test_a_dark_header_on_a_dark_surface_still_bounds_the_card() -> None:
    """In grey the header is as dark as the surface; only its colour separates them. Without
    colour edges the card minus its header (too elongated) would be the only candidate."""
    card = make_card(header=0.17)
    corners = card_corners(800, 600, 1000, degrees=10)
    scene = place_card(card, corners, SCENE)
    header = np.full((10, 10, 3), HEADER_COLOUR, dtype=np.uint8)
    surface_grey = float(cv2.cvtColor(scene.image[:60, :60], cv2.COLOR_BGR2GRAY).mean())
    assert abs(float(cv2.cvtColor(header, cv2.COLOR_BGR2GRAY).mean()) - surface_grey) < 20

    detection = found(detect_document(scene.image))

    assert corner_error(detection.quad, scene.corners) <= CORNER_TOLERANCE_PX


# --- the line-segment fallback -------------------------------------------------------------------


def with_cable(image: np.ndarray, *, colour: tuple[int, int, int] = (60, 66, 75)) -> np.ndarray:
    """A dark cable across the whole photo and the card, so no contour closes around it."""
    crossed = image.copy()
    cv2.line(crossed, (0, 640), (1600, 520), colour, 40)
    return crossed


@pytest.mark.parametrize("degrees", [5.0, -12.0])
def test_an_outline_broken_by_a_cable_is_found_from_its_line_segments(degrees: float) -> None:
    card = make_card(rounded=True)
    corners = card_corners(800, 600, 1000, degrees=degrees, perspective=0.03)
    scene = place_card(card, corners, SCENE)

    detection = found(detect_document(with_cable(scene.image)))

    assert detection.method == "lines"
    assert corner_error(detection.quad, scene.corners) <= CORNER_TOLERANCE_PX
    assert detection.area_ratio == pytest.approx(scene.area_ratio, rel=0.01)


@pytest.mark.parametrize("degrees", [0.0, 10.0, -15.0, 25.0])
def test_corners_hidden_under_fingers_are_recovered(degrees: float) -> None:
    card = make_card(rounded=True)
    corners = card_corners(800, 600, 1000, degrees=degrees, perspective=0.05)
    scene = place_card(card, corners, SCENE)
    image = scene.image.copy()
    for x, y in (corners[0], corners[2]):
        cv2.ellipse(image, (round(x), round(y)), (90, 60), 30, 0, 360, (120, 150, 200), -1)

    detection = found(detect_document(image))

    assert detection.method in {"contour", "lines"}
    assert corner_error(detection.quad, scene.corners) <= CORNER_TOLERANCE_PX


# --- tightly cropped uploads ---------------------------------------------------------------------


@pytest.mark.parametrize("rounded", [False, True], ids=["square-corners", "rounded-corners"])
def test_a_tightly_cropped_card_is_the_whole_frame(rounded: bool) -> None:
    card = make_card(rounded=rounded)
    height, width = card.image.shape[:2]

    result = detect_document(card.image)

    detection = found(result)
    assert detection.method == "full_frame"
    # The frame's own outline, (0, 0) to (w, h): the rectified copy's corners are the quad's
    # corners, so mapping between the two is exactly the identity here.
    assert detection.quad == ((0.0, 0.0), (width, 0.0), (width, height), (0.0, height))
    assert detection.rectified_size == (width, height)
    assert detection.aspect_ratio == pytest.approx(width / height)
    assert detection.area_ratio == 1.0
    # Nothing to rectify: the document is the upload itself.
    assert result.rectified is not None
    assert np.array_equal(result.rectified, card.image)


@pytest.mark.parametrize("header", [0.06, 0.10, 0.17])
def test_inner_frames_of_a_tightly_cropped_card_never_win(header: float) -> None:
    """The header bar, the portrait box, the MRZ band and the region left between them are all
    rectangles on the card; none of them is the document."""
    card = make_card(header=header)

    detection = found(detect_document(card.image))

    assert detection.method == "full_frame"


def test_the_part_of_a_tight_crop_below_its_header_is_not_the_card() -> None:
    """Below a 10% header the rest of an ID-1 crop has an aspect ratio of 1.76, inside the ID-1
    window, and covers 90% of the frame: it runs along three edges of the frame, so it is part of
    the frame, not a card lying in it."""
    card = make_card(frames=False)
    image = card.image.copy()
    image[: round(image.shape[0] * 0.10)] = HEADER_COLOUR

    detection = found(detect_document(image))

    assert detection.method == "full_frame"


def test_inner_frames_of_a_card_on_a_background_do_not_beat_its_outline() -> None:
    card = make_card(header=0.17)
    corners = card_corners(800, 600, 1100, degrees=-6)
    scene = place_card(card, corners, SCENE)

    detection = found(detect_document(scene.image))

    assert detection.method == "contour"
    assert corner_error(detection.quad, scene.corners) <= CORNER_TOLERANCE_PX


# --- not a document ------------------------------------------------------------------------------


def test_a_photo_without_a_document_finds_nothing() -> None:
    photo = make_photo(480, 640)  # portrait orientation, like most phone photos

    result = detect_document(photo)

    assert result == DocumentResult(detection=NOT_FOUND, rectified=None)


def test_a_wide_photo_without_a_document_finds_nothing() -> None:
    photo = cv2.resize(make_photo(480, 640), (853, 480))  # 16:9, outside both windows

    assert detect_document(photo).detection == NOT_FOUND


def test_a_frame_shaped_like_a_document_is_taken_as_a_tight_crop_whatever_it_shows() -> None:
    """C32.1: without an outline, a frame within 12% of ID-1 or TD3 (here 4:3, near TD3) is the
    document. The checks judge what it shows; vision does not guess."""
    photo = cv2.resize(make_photo(480, 640), (640, 480))

    detection = found(detect_document(photo))

    assert detection.method == "full_frame"


def test_a_card_too_small_in_the_frame_is_not_found_and_its_size_is_reported() -> None:
    """A card covering 12% of a 4:3 photo fails the 0.3 area gate. Its closed card-shaped outline
    shows the photo is not a tight crop, so the frame is not taken as the document either; its
    aspect and area ratios are reported, so the caller can ask the user to move closer."""
    card = make_card(rounded=True)
    corners = card_corners(800, 600, 600, degrees=5)
    scene = place_card(card, corners, SCENE)
    assert scene.area_ratio < MIN_AREA_RATIO

    detection = detect_document(scene.image).detection

    assert detection.found is False
    assert detection.method == "none"
    assert detection.quad is None
    assert detection.rectified_size is None
    assert detection.area_ratio == pytest.approx(scene.area_ratio, rel=0.02)
    assert detection.aspect_ratio == pytest.approx(ID1_ASPECT, rel=0.02)


def test_a_card_too_small_in_a_wide_photo_is_reported_the_same_way() -> None:
    card = make_card()
    corners = card_corners(800, 450, 500, degrees=5)
    scene = place_card(card, corners, (1600, 900))

    detection = detect_document(scene.image).detection

    assert detection.found is False
    assert detection.area_ratio == pytest.approx(scene.area_ratio, rel=0.02)


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_a_card_photographed_off_a_screen_is_a_tight_crop_not_a_quad_of_moire_stripes(
    seed: int,
) -> None:
    """A display's pixel grid aliases into long straight moire stripes. Quads assembled from them
    have edges along only part of their sides and an inconsistent colour step across them, so the
    line fallback must not take one for the card's outline."""
    image = on_screen(make_card(1027, seed=seed).image, seed=seed)

    detection = found(detect_document(image))

    assert detection.method == "full_frame"


def test_a_grid_pattern_is_no_document() -> None:
    """Grid lines are edges all round any sub-rectangle, but the colour flips along them; a card
    outline separates the card from what is behind it the same way all along."""
    assert detect_document(make_checkerboard()).detection == NOT_FOUND


def test_noise_has_edges_everywhere_but_no_outline() -> None:
    noise = make_noise(height=100, width=160, seed=4)  # an ID-1-shaped frame

    detection = found(detect_document(noise))

    assert detection.method == "full_frame"


# --- input handling ------------------------------------------------------------------------------


def test_a_greyscale_upload_is_accepted() -> None:
    # Without colour a dark header is the dark surface (see the test above), so this card has
    # none: its whole outline must be visible in grey.
    card = make_card(header=0.0)
    corners = card_corners(800, 600, 1000, degrees=12)
    scene = place_card(card, corners, SCENE)
    grey = cv2.cvtColor(scene.image, cv2.COLOR_BGR2GRAY)

    result = detect_document(grey)

    detection = found(result)
    assert corner_error(detection.quad, scene.corners) <= CORNER_TOLERANCE_PX
    assert result.rectified is not None
    assert result.rectified.ndim == 3


@pytest.mark.parametrize(
    ("width", "height", "method"), [(20, 12, "full_frame"), (12, 12, "none"), (1, 1, "none")]
)
def test_tiny_images_only_get_the_frame_test(width: int, height: int, method: str) -> None:
    image = np.full((height, width, 3), 128, dtype=np.uint8)

    assert detect_document(image).detection.method == method


def test_detection_rejects_non_images() -> None:
    with pytest.raises(ValueError, match="image"):
        detect_document(np.zeros((8, 8), dtype=np.float32))


def test_every_detection_satisfies_the_contract() -> None:
    card = make_card()
    images = [
        place_card(card, card_corners(800, 600, 1000, degrees=12), SCENE).image,
        card.image,
        make_photo(480, 640),
    ]
    for image in images:
        detection = detect_document(image).detection
        DocumentDetection.model_validate(detection.model_dump(mode="json"))
        if detection.quad is not None:
            assert all(len(point) == 2 for point in detection.quad)
        if detection.area_ratio is not None:
            assert 0.0 <= detection.area_ratio <= 1.0


# --- guards --------------------------------------------------------------------------------------


def test_a_flat_frame_has_no_line_segments_and_is_a_tight_crop() -> None:
    flat = np.full((100, 160, 3), 128, dtype=np.uint8)

    assert detect_document(flat).detection.method == "full_frame"


def test_parallel_sides_meet_at_no_corner() -> None:
    horizontal = (1.0, 0.0, 0.0, 0.0)
    lower = (1.0, 0.0, 0.0, 5.0)

    assert document._intersect(horizontal, lower) is None
    assert document._corners([horizontal, lower, horizontal, lower]) is None


def test_a_degenerate_quad_is_left_as_it_is() -> None:
    quad = np.array([[10.0, 10.0], [10.0, 10.0], [50.0, 40.0], [10.0, 40.0]])
    image = np.full((60, 80, 3), 128, dtype=np.uint8)
    contour = np.array([[[10, 10]], [[50, 40]], [[10, 40]]], dtype=np.int32)

    assert np.array_equal(document._fit_sides(contour, quad), quad)
    assert np.array_equal(document._snap_sides(image, quad, 3.0), quad)
    assert document._coherence(image, quad) == 0.0


def test_a_full_resolution_snap_the_gates_reject_keeps_the_found_quad(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    card = make_card()
    corners = card_corners(800, 600, 1000, degrees=12)
    scene = place_card(card, corners, SCENE)
    snap = document._snap_sides

    def wild_at_full_resolution(image: np.ndarray, quad: np.ndarray, reach: float) -> np.ndarray:
        if reach > 3.0:  # the full-resolution pass: land on a tiny, wrong square
            return np.array([[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]])
        return snap(image, quad, reach)

    monkeypatch.setattr(document, "_snap_sides", wild_at_full_resolution)

    detection = found(detect_document(scene.image))

    assert detection.method == "contour"
    assert corner_error(detection.quad, scene.corners) <= 4.0  # the work-scale quad, scaled up
