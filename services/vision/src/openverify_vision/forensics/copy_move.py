"""Copy-move: a region of the document duplicated elsewhere on it (C32.1).

ORB keypoints (at most :data:`FEATURES_PER_TILE` per cell of a 4x4 grid, so a busy region
cannot take them all) are matched against the same image. A match counts when its descriptor is
close (Hamming distance at most :data:`MAX_HAMMING`), clearly better than the next candidate
(Lowe's ratio :data:`RATIO`), and its two keypoints lie at least :data:`MIN_SHIFT` of the
diagonal apart. A copied region gives many such matches sharing one displacement and starting
from one compact area; the card's own repeats (guilloche waves, recurring glyphs) either fail the
ratio test or spread over the card. The score is the largest such group, past
:data:`NOISE_MATCHES` (what an untouched card reaches), relative to :data:`FULL_MATCHES`, in
[0, 1].

The image is matched on a copy of at most :data:`COPY_MOVE_MAX_SIDE` pixels a side; a copy
smaller than :data:`MIN_SIDE` pixels a side is not measured (score 0).
"""

from __future__ import annotations

import math
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.forensics.geometry import fit_within
from openverify_vision.imaging import ImageArray, ensure_gray

COPY_MOVE_MAX_SIDE: Final = 1024
TILES: Final = 4
FEATURES_PER_TILE: Final = 100
MIN_SIDE: Final = 64
"""Smaller copies are not measured (ORB's pyramid needs room; each grid cell keeps 16 pixels)."""

ORB_EDGE: Final = 15
ORB_PATCH: Final = 31
ORB_FAST_THRESHOLD: Final = 10
MAX_HAMMING: Final = 40
RATIO: Final = 0.75
MIN_SHIFT: Final = 0.05
"""Matched keypoints closer than this share of the diagonal are the same feature."""
SHIFT_BIN: Final = 6.0
"""Displacements are grouped in bins of this many pixels (a match counts in neighbouring bins
too)."""
COMPACT_RADIUS: Final = 0.15
"""A group's sources lie within this share of the diagonal of their median."""
NOISE_MATCHES: Final = 8
FULL_MATCHES: Final = 40

_SCORE_DECIMALS: Final = 4


def _keypoints(grey: ImageArray) -> tuple[list[cv2.KeyPoint], NDArray[np.uint8] | None]:
    """ORB keypoints detected per grid cell, and their descriptors on the whole image."""
    height, width = grey.shape
    detector = cv2.ORB.create(
        nfeatures=FEATURES_PER_TILE,
        edgeThreshold=ORB_EDGE,
        patchSize=ORB_PATCH,
        fastThreshold=ORB_FAST_THRESHOLD,
    )
    found: list[cv2.KeyPoint] = []
    for row in range(TILES):
        for column in range(TILES):
            top, bottom = row * height // TILES, (row + 1) * height // TILES
            left, right = column * width // TILES, (column + 1) * width // TILES
            for point in detector.detect(grey[top:bottom, left:right], None):
                x, y = point.pt
                found.append(
                    cv2.KeyPoint(
                        x + left, y + top, point.size, point.angle, point.response, point.octave
                    )
                )
    describer = cv2.ORB.create(edgeThreshold=ORB_EDGE, patchSize=ORB_PATCH)
    keypoints, descriptors = describer.compute(grey, found)
    return list(keypoints), None if descriptors is None else np.asarray(descriptors, np.uint8)


def _matched_shifts(
    keypoints: list[cv2.KeyPoint], descriptors: NDArray[np.uint8], diagonal: float
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Sources and displacements of the matches that count, each displacement pointing right
    (or down), with the source at its left (or top) end."""
    points = np.array([keypoint.pt for keypoint in keypoints], dtype=np.float64)
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    sources, shifts = [], []
    for candidates in matcher.knnMatch(descriptors, descriptors, k=3):
        others = [match for match in candidates if match.trainIdx != match.queryIdx]
        best = others[0]
        if best.distance > MAX_HAMMING:
            continue
        if len(others) > 1 and best.distance > RATIO * others[1].distance:
            continue
        source, target = points[best.queryIdx], points[best.trainIdx]
        shift = target - source
        if math.hypot(shift[0], shift[1]) < MIN_SHIFT * diagonal:
            continue
        if shift[0] < 0 or (shift[0] == 0 and shift[1] < 0):
            shift, source = -shift, target
        sources.append(source)
        shifts.append(shift)
    return np.array(sources).reshape(-1, 2), np.array(shifts).reshape(-1, 2)


def _largest_group(
    sources: NDArray[np.float64], shifts: NDArray[np.float64], diagonal: float
) -> int:
    """The most matches sharing one displacement bin (with its neighbours) whose sources lie
    within ``COMPACT_RADIUS`` of the diagonal of their median."""
    bins = np.rint(shifts / SHIFT_BIN).astype(np.int64)
    keys, counts = np.unique(bins, axis=0, return_counts=True)
    best = 0
    for index in np.argsort(-counts):
        if counts[index] <= best:
            break
        members = np.all(np.abs(bins - keys[index]) <= 1, axis=1)
        group = sources[members]
        spread = np.hypot(*(group - np.median(group, axis=0)).T)
        best = max(best, int((spread <= COMPACT_RADIUS * diagonal).sum()))
    return best


def copy_move_score(grey: ImageArray) -> float:
    """ORB self-matches sharing one displacement from one compact area, in [0, 1]."""
    work, _ = fit_within(ensure_gray(grey), COPY_MOVE_MAX_SIDE)
    height, width = work.shape
    if min(height, width) < MIN_SIDE:
        return 0.0
    keypoints, descriptors = _keypoints(work)
    if descriptors is None or len(keypoints) < 2:  # noqa: PLR2004 - a match needs two
        return 0.0
    diagonal = math.hypot(height, width)
    sources, shifts = _matched_shifts(keypoints, descriptors, diagonal)
    group = _largest_group(sources, shifts, diagonal)
    score = (group - NOISE_MATCHES) / (FULL_MATCHES - NOISE_MATCHES)
    return round(min(1.0, max(0.0, score)), _SCORE_DECIMALS)
