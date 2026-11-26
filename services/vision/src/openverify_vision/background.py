"""Background layout and comparison (C41.1, C41.2, research §8).

The fraud-farm pattern is many different people photographed in the same room. Two measurements
serve it; both see the background only, with the person masked out by :func:`person_mask` (a
head-and-shoulders region grown from YuNet's face box: no segmentation model is used):

- :func:`measure_background`, on the centre pose: an 8 x 6 grid of the mean CIE Lab colour of
  the background after a sigma 6 Gaussian blur (OpenCV's float Lab: L 0-100, a and b about
  -128 to 127, so a Euclidean distance between two cells is their CIE76 colour difference). The
  frame is first downscaled to at most :data:`MAX_COMPARE_LONG_SIDE` pixels, and the mask is
  grown by twice the blur's sigma, so the person's colour does not bleed into the background. A
  cell counts (``1`` in ``valid_cells``) when at least :data:`MIN_CELL_BACKGROUND` of its pixels
  are background; any other cell takes the mean of the whole background (or of the whole frame
  when nothing is background). ``layout`` lists the cells row by row, top left first, three
  numbers (L, a, b) each; ``coverage`` is the share of valid cells. It is coarse on purpose (48
  cells): a retrieval key for the background index, low-resolution personal data, never proof.
- :func:`compare_backgrounds` (``POST /v1/compare/background``) verifies the candidates the
  index retrieved. Each image is downscaled to at most :data:`MAX_COMPARE_LONG_SIDE` pixels
  (:func:`compare_copy`), every face the finder sees there is masked out with its head and
  shoulders, and up to :data:`MAX_ORB_FEATURES` ORB keypoints are taken from what is left. Each
  probe keypoint's two nearest candidate descriptors (Hamming distance) give a *good match* when
  the nearest is clearly the closer (Lowe's ratio test, :data:`RATIO_TEST`); a homography fitted
  to the good matches by RANSAC (reprojection error at most :data:`RANSAC_REPROJECTION_PX`
  pixels at the 640-pixel scale) counts the *inliers*, and ``inlier_ratio`` is inliers over good
  matches (0 without any). A room seen again from a moved camera keeps hundreds of inliers;
  another room keeps a few dozen at most (research §8: 701 against 13-31).
- :func:`mask_person` (``POST /v1/mask/background``, C99.7) makes the copy a selfie-background
  list item keeps instead of the selfie: the comparison copy with every face the finder sees
  and its head and shoulders, grown by :data:`MASK_GROWTH`, painted out from the pixels around
  them, so no hard edge spends the ORB budget of the comparison that later reads the copy. The
  mask is the face-box region above, not a segmentation: an arm or a hand outside it stays.

Vision measures; the thresholds that decide are TypeScript's (C41.3). Nothing here is logged.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Protocol

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.faces import Face
from openverify_vision.forensics.geometry import fit_within
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.schemas import (
    BACKGROUND_CELLS,
    MAX_BACKGROUND_CANDIDATES,
    BackgroundLayout,
    BackgroundMatch,
    BoundingBox,
)

MAX_COMPARE_LONG_SIDE: Final = 640
"""Each compared image is downscaled to at most this long side after reading (C41.2), and the
layout is measured on such a copy."""

MAX_ORB_FEATURES: Final = 1000
"""Most ORB keypoints taken from one image's background."""

RATIO_TEST: Final = 0.75
"""A match is good when its nearest descriptor is closer than this share of the second's."""

RANSAC_REPROJECTION_PX: Final = 5.0
"""Most pixels (at the 640-pixel scale) a good match may miss the homography by and count."""

MIN_HOMOGRAPHY_MATCHES: Final = 4
"""A homography needs four good matches; with fewer, nothing is an inlier."""

_NEIGHBOURS: Final = 2
"""The ratio test compares each descriptor's two nearest neighbours."""

GRID_COLUMNS: Final = 8
GRID_ROWS: Final = 6

BLUR_SIGMA: Final = 6.0
"""The Gaussian blur applied before the cells are averaged (research §8)."""

MASK_GROWTH: Final = 2 * BLUR_SIGMA
"""Pixels the person mask is grown by, so the blur carries none of the person into a cell."""

MIN_CELL_BACKGROUND: Final = 0.5
"""A cell is valid when at least this share of its pixels is background."""

HEAD_CENTRE: Final = 0.45
HEAD_HALF_WIDTH: Final = 0.8
HEAD_HALF_HEIGHT: Final = 0.95
"""The head ellipse: centred this many face heights below the box top, its half-axes in face
widths and heights (hair, ears and chin)."""

NECK_TOP: Final = 0.9
NECK_HALF_WIDTH: Final = 0.45
SHOULDER_LINE: Final = 1.6
SHOULDER_HALF_WIDTH: Final = 1.6
CHEST_HALF_WIDTH: Final = 1.8
"""The neck and shoulders polygon, in face heights below the box top and face widths from its
centre line, down to the bottom of the frame."""

FILL_RADIUS_PX: Final = 3.0
"""The neighbourhood :func:`mask_person`'s inpainting reads, in pixels of the comparison copy."""

_LAYOUT_DECIMALS: Final = 3
_SCORE_DECIMALS: Final = 4


class FaceFinder(Protocol):
    """Finds every face in an image, largest first (``FaceEngine.find_faces``)."""

    def find_faces(self, img: ImageArray) -> list[Face]: ...


def person_mask(shape: tuple[int, ...], box: BoundingBox) -> NDArray[np.uint8]:
    """255 where the person of the face ``box`` (``(x, y, w, h)``) is, 0 elsewhere: a head
    ellipse around the box and a neck-and-shoulders polygon below it to the frame's bottom."""
    height, width = shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    limit = 4 * max(height, width, 1)
    x, y, w, h = (min(max(value, -limit), limit) for value in box)
    centre_x = x + w / 2
    cv2.ellipse(
        mask,
        (round(centre_x), round(y + HEAD_CENTRE * h)),
        (max(1, round(HEAD_HALF_WIDTH * w)), max(1, round(HEAD_HALF_HEIGHT * h))),
        0,
        0,
        360,
        255,
        -1,
    )
    neck, shoulders = y + NECK_TOP * h, y + SHOULDER_LINE * h
    bottom = max(float(height), shoulders)
    outline = np.array(
        [
            (centre_x - NECK_HALF_WIDTH * w, neck),
            (centre_x + NECK_HALF_WIDTH * w, neck),
            (centre_x + SHOULDER_HALF_WIDTH * w, shoulders),
            (centre_x + CHEST_HALF_WIDTH * w, bottom),
            (centre_x - CHEST_HALF_WIDTH * w, bottom),
            (centre_x - SHOULDER_HALF_WIDTH * w, shoulders),
        ]
    )
    cv2.fillPoly(mask, [np.round(outline).astype(np.int32)], 255)
    return mask


def _scaled_box(box: BoundingBox, scale: float) -> BoundingBox:
    x, y, w, h = box
    return (x * scale, y * scale, w * scale, h * scale)


def _background_pixels(shape: tuple[int, ...], boxes: Sequence[BoundingBox]) -> NDArray[np.bool_]:
    """True where no person of ``boxes`` is, with the masks grown by :data:`MASK_GROWTH`."""
    person = np.zeros(shape[:2], dtype=np.uint8)
    for box in boxes:
        person |= person_mask(shape, box)
    side = 2 * math.ceil(MASK_GROWTH) + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (side, side))
    grown = np.asarray(cv2.dilate(person, kernel), dtype=np.uint8)
    return np.asarray(grown == 0, dtype=np.bool_)


def _edges(length: int, parts: int) -> list[int]:
    return [round(length * index / parts) for index in range(parts + 1)]


def measure_background(image: ImageArray, face: Face | None) -> BackgroundLayout | None:
    """The centre's background layout with the person of ``face`` masked out; ``None`` without
    a face (see the module docstring)."""
    if face is None:
        return None
    work, scale = fit_within(ensure_bgr(image), MAX_COMPARE_LONG_SIDE)
    background = _background_pixels(work.shape, [_scaled_box(face.box, scale)])
    colour = np.asarray(work, dtype=np.float32) / np.float32(255.0)
    blurred = cv2.GaussianBlur(colour, (0, 0), BLUR_SIGMA)
    lab = np.asarray(cv2.cvtColor(blurred, cv2.COLOR_BGR2Lab), dtype=np.float64)
    selected = background if background.any() else np.ones_like(background)
    fill = lab[selected].mean(axis=0)
    height, width = work.shape[:2]
    rows, columns = _edges(height, GRID_ROWS), _edges(width, GRID_COLUMNS)
    layout: list[float] = []
    valid: list[str] = []
    for row in range(GRID_ROWS):
        for column in range(GRID_COLUMNS):
            window = (slice(rows[row], rows[row + 1]), slice(columns[column], columns[column + 1]))
            inside = background[window]
            counted = inside.size > 0 and int(inside.sum()) >= MIN_CELL_BACKGROUND * inside.size
            mean = lab[window][inside].mean(axis=0) if counted else fill
            layout.extend(round(float(value), _LAYOUT_DECIMALS) for value in mean)
            valid.append("1" if counted else "0")
    cells = "".join(valid)
    return BackgroundLayout(
        layout=layout,
        valid_cells=cells,
        coverage=round(cells.count("1") / BACKGROUND_CELLS, _SCORE_DECIMALS),
    )


def compare_copy(image: ImageArray) -> ImageArray:
    """The copy of ``image`` that is compared: at most :data:`MAX_COMPARE_LONG_SIDE` pixels on
    its long side (area-averaged, never upscaled), in BGR."""
    work, _ = fit_within(ensure_bgr(image), MAX_COMPARE_LONG_SIDE)
    return work


@dataclass(frozen=True, slots=True)
class _Features:
    points: NDArray[np.float32]
    """``(n, 2)`` keypoint positions at the 640-pixel scale."""
    descriptors: NDArray[np.uint8] | None


def _features(image: ImageArray, finder: FaceFinder, orb: cv2.ORB) -> _Features:
    """The ORB keypoints of the background of ``image``'s comparison copy."""
    work = compare_copy(image)
    background = _background_pixels(work.shape, [face.box for face in finder.find_faces(work)])
    grey = np.asarray(cv2.cvtColor(work, cv2.COLOR_BGR2GRAY), dtype=np.uint8)
    mask = np.where(background, np.uint8(255), np.uint8(0)).astype(np.uint8)
    keypoints, descriptors = orb.detectAndCompute(grey, mask)
    points = np.asarray([point.pt for point in keypoints], dtype=np.float32).reshape(-1, 2)
    return _Features(
        points=points,
        descriptors=None if descriptors is None else np.asarray(descriptors, dtype=np.uint8),
    )


def _match(index: int, probe: _Features, candidate: _Features) -> BackgroundMatch:
    pairs: list[tuple[int, int]] = []
    if (
        probe.descriptors is not None
        and candidate.descriptors is not None
        and len(candidate.descriptors) >= _NEIGHBOURS
    ):
        matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
        for neighbours in matcher.knnMatch(probe.descriptors, candidate.descriptors, k=_NEIGHBOURS):
            if (
                len(neighbours) == _NEIGHBOURS
                and neighbours[0].distance < RATIO_TEST * neighbours[1].distance
            ):
                pairs.append((neighbours[0].queryIdx, neighbours[0].trainIdx))
    inliers = 0
    if len(pairs) >= MIN_HOMOGRAPHY_MATCHES:
        source = probe.points[[query for query, _ in pairs]].reshape(-1, 1, 2)
        target = candidate.points[[train for _, train in pairs]].reshape(-1, 1, 2)
        _, kept = cv2.findHomography(source, target, cv2.RANSAC, RANSAC_REPROJECTION_PX)
        inliers = 0 if kept is None else int(np.count_nonzero(kept))
    return BackgroundMatch(
        index=index,
        good_matches=len(pairs),
        inliers=inliers,
        inlier_ratio=round(inliers / len(pairs), _SCORE_DECIMALS) if pairs else 0.0,
    )


def mask_person(image: ImageArray, finder: FaceFinder) -> ImageArray | None:
    """The comparison copy of ``image`` with every person the finder sees painted out, ``None``
    without a face; black when the person fills the frame (see the module docstring)."""
    work = compare_copy(image)
    faces = finder.find_faces(work)
    if not faces:
        return None
    background = _background_pixels(work.shape, [face.box for face in faces])
    if not background.any():
        return np.zeros_like(work)
    person = np.where(background, np.uint8(0), np.uint8(255)).astype(np.uint8)
    return np.asarray(cv2.inpaint(work, person, FILL_RADIUS_PX, cv2.INPAINT_TELEA), dtype=np.uint8)


def png_of(image: ImageArray) -> bytes:
    """``image`` as a PNG, which carries nothing but its pixels."""
    encoded, png = cv2.imencode(".png", image)
    if not encoded:  # pragma: no cover - a BGR array always encodes
        raise ValueError("the image did not encode")
    return png.tobytes()


def compare_backgrounds(
    probe: ImageArray, candidates: Sequence[ImageArray], finder: FaceFinder
) -> list[BackgroundMatch]:
    """ORB + RANSAC of the probe's background against each candidate's, one result per
    candidate in order (``index`` is its position); at most five candidates (C41.2)."""
    if len(candidates) > MAX_BACKGROUND_CANDIDATES:
        raise ValueError(f"at most {MAX_BACKGROUND_CANDIDATES} candidates are compared at once")
    if not candidates:
        return []
    orb = cv2.ORB.create(nfeatures=MAX_ORB_FEATURES)
    reference = _features(probe, finder, orb)
    return [
        _match(index, reference, _features(candidate, finder, orb))
        for index, candidate in enumerate(candidates)
    ]
