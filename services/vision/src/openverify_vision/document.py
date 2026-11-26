"""Document detection, rectification and the measurements made on the rectified document (C32.1).

The detector uses OpenCV only (``docs/research/phase3-libraries.md`` section 4):

1. **Candidates.** On a copy at most :data:`WORK_LONG_SIDE` pixels long, contours of an Otsu
   threshold and of per-channel Canny edges (colour, so a dark header on a dark table still has an
   edge) are simplified with ``approxPolyDP``; every convex 4-gon is kept, its sides refitted to
   the contour points (rounded ID-1 corners pull a 4-gon's vertices onto the arc), then snapped
   to the strongest colour step along each side.
2. **Gates.** A candidate is the document only if it is outlined (:func:`_Candidate.outlined`: its
   sides lie on edges, the colour step across them keeps its direction, and it does not run along
   two edges of the frame), covers at least :data:`MIN_AREA_RATIO` of the upload, and has an
   aspect ratio within :data:`ASPECT_TOLERANCE` of ID-1 or TD3. The aspect ratio keeps the image's
   orientation (width is the pair of sides closer to horizontal), so a card turned by more than
   45 degrees, or a vertical-format card, is not found; a portrait box is never taken for a page.
3. **Line fallback.** If no contour passes, line segments (``createLineSegmentDetector`` on each
   channel) are merged into lines; pairs of near-parallel horizontal and vertical lines form
   quads, the largest passing the same gates, with stronger edge evidence
   (:data:`LINE_MIN_EDGE_SUPPORT`, :data:`LINE_MIN_EDGE_COHERENCE`), wins. This recovers an outline
   broken by a finger or a cable, and is not fooled by a display's moire stripes.
4. **Frame.** Otherwise a frame whose own aspect ratio passes the window is a tightly cropped
   upload (``full_frame``), unless a closed card-shaped outline lies inside it (then the photo is
   not a tight crop: the card is just too small). Otherwise nothing is found.
5. **Text layout (Phase 12A).** When nothing is found, the outlined, document-shaped 4-gons under
   the area gate are kept (``near_misses``): a card 86% as wide as a 9:16 phone frame covers 26%
   of it. :func:`detect_by_text_layout`, given the side's OCR lines, takes the one that holds them,
   or else the lines' own extent grown to a card, and reports it as ``text_layout``.
6. **Rectification.** The winning quad's sides are snapped once more at full resolution and the
   quad is warped (``getPerspectiveTransform`` + ``warpPerspective``) to the canonical aspect
   ratio nearest its own, as wide as its longer horizontal side, so the capture's resolution
   stays measurable. The rectified copy's corners ``(0, 0)``, ``(w, 0)``, ``(w, h)`` and
   ``(0, h)`` are the quad's corners, and a ``full_frame`` quad is ``(0, 0)`` to ``(W, H)``: its
   rectified copy is the upload itself.

``cornerSubPix`` (research section 4) is not used. On the synthetic cards the side snapping puts
the corners within 0.5 to 0.65 pixels of the truth, square or rounded; ``cornerSubPix`` applied
after it moved them to 0.6 to 5.6 pixels, as it settles on a rounded corner's arc or on print near
a corner (``docs/tdd/phase3-vision-document.tdd.md``).

The rectified document is then measured: :func:`measure_document_quality` (sharpness at a fixed
width on the text, size, the text and portrait glare) and :func:`perceptual_hash`;
:func:`measure_portrait_clarity` measures the front portrait on the upload. Vision only measures:
every threshold and decision is TypeScript's (C32.2).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Literal

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.faces import LANDMARK_NAMES, Face
from openverify_vision.imaging import ImageArray, ensure_bgr, ensure_gray
from openverify_vision.quality import blur_score, glare_mask
from openverify_vision.schemas import (
    BoundingBox,
    DocumentDetection,
    DocumentQuality,
    PortraitClarity,
    Quad,
)

ID1_ASPECT: Final = 85.60 / 53.98
"""ISO/IEC 7810 ID-1 card (85.60 x 53.98 mm), width over height."""

TD3_ASPECT: Final = 125.0 / 88.0
"""ICAO 9303 TD3 passport data page (125 x 88 mm), width over height."""

CANONICAL_ASPECTS: Final = (ID1_ASPECT, TD3_ASPECT)

ASPECT_TOLERANCE: Final = 0.12
"""A quad or frame is document-shaped within this relative distance of a canonical aspect."""

MIN_AREA_RATIO: Final = 0.3
"""A quad counts as the document only when it covers at least this share of the upload."""

MIN_CANDIDATE_AREA_RATIO: Final = 0.02
"""Smaller 4-gons (words, logos, boxes) are not considered at all."""

INNER_CARD_MIN_AREA_RATIO: Final = 0.1
INNER_CARD_ASPECT_TOLERANCE: Final = 0.06
INNER_CARD_MIN_SUPPORT: Final = 0.8
"""A closed outline at least this large, this close to ID-1 or TD3 and this well supported shows
that the frame is a photo with a card in it, not a tight crop: ``full_frame`` is ruled out."""

MIN_EDGE_SUPPORT: Final = 0.6
"""Each side of an outline lies on detected edges for at least this share of its length."""

MIN_EDGE_COHERENCE: Final = 0.35
"""Each side's colour step keeps its direction this consistently (1 for a card on a table, about 0
for a grid line, whose colours alternate, or for noise)."""

LINE_MIN_EDGE_SUPPORT: Final = 0.8
LINE_MIN_EDGE_COHERENCE: Final = 0.88
"""A quad assembled from separate lines (the fallback) needs stronger evidence than a closed
contour: a display's moire stripes are long straight lines too. On the synthetic scenes, outlines
broken by a cable or fingers score 0.88-0.92 support and 0.92-0.96 coherence; quads of moire
stripes at most 0.73 and 0.83."""

WORK_LONG_SIDE: Final = 640
"""Candidates are searched on a copy scaled down to this long side."""

MIN_DETECTION_SIDE: Final = 32
"""Uploads with a shorter side are too small to search; only the frame test applies."""

BORDER_TOLERANCE: Final = 0.015
"""A side within this share of the frame's size from a frame edge runs along that edge."""

FACE_MEASURE_MAX_WIDTH: Final = 112
"""Portrait sharpness is taken on the face crop scaled down to at most SFace's input width."""

PHASH_SAMPLE_SIZE: Final = 32
PHASH_BLOCK: Final = 8
"""The pHash resamples the document to 32 x 32 and keeps an 8 x 8 block of its DCT: 64 bits."""

PHASH_MIN_CONTRAST: Final = 1.0
"""Below this standard deviation (grey levels) of the 32 x 32 sample there is nothing to hash."""

DOCUMENT_MEASURE_WIDTH: Final = 1000
"""Blur and Tenengrad are taken on the rectified document resized, up or down, to this width (ID-1
at about 300 dpi), so the score follows focus rather than how many pixels the card covers (Phase
12A V3; before, it was only scaled down, to at most 1,280 pixels)."""

DOCUMENT_MEASURE_SIGMA: Final = 0.8
"""The resized document is smoothed by a Gaussian of this sigma before the derivatives (a Laplacian
of Gaussian): sensor noise and JPEG blocking at the pixel scale otherwise outweigh the print's own
edges, and they differ between a small frame scaled up and a large one scaled down."""

TEXT_MEASURE_MIN_SHARE: Final = 0.02
"""Sharpness is measured on the side's text boxes when they cover at least this share of the
resized document, else on the whole document: a barcode, a guilloche or a portrait scores
differently from print at the same focus, so only the text makes front and back comparable."""

TEXT_LAYOUT_MIN_LINES: Final = 3
"""The ``text_layout`` fallback needs at least this many OCR lines as evidence."""

TEXT_LAYOUT_MIN_AREA_RATIO: Final = 0.1
"""An outline under the area gate is a candidate for the fallback from this share of the upload
(the inner-card size of ``INNER_CARD_MIN_AREA_RATIO``)."""

TEXT_LAYOUT_MIN_INSIDE: Final = 0.8
"""An outline is the card only if at least this share of the text lines' centres lies inside it."""

TEXT_LAYOUT_ASPECT_TOLERANCE: Final = 0.25
"""The text's own extent must be within this relative distance of ID-1 or TD3 to be a card."""

TEXT_LAYOUT_MARGIN: Final = 0.035
"""From the text's extent, the card is grown by this share of the extent's width on each side (a
card prints to about 2-3 mm of its 85.6 mm edge), then slid onto the card's edges."""

TEXT_LAYOUT_SNAP_REACH: Final = 0.07
"""The grown sides slide onto the card's edges within this share of the width (a card's print
can stop 2-8 mm short of its edge, and the text's extent is centred between both)."""

TEXT_LAYOUT_PORTRAIT_REACH: Final = 0.3
"""A face counts as the card's portrait (evidence) only if its centre lies within the text's
extent grown by this share of its size on each side: the holder's own face beside the card
does not."""

_APPROX_EPSILON: Final = 0.02
_SIDE_TRIM: Final = 0.15
_SNAP_SAMPLES: Final = 64
_SUPPORT_SAMPLES: Final = 48
_WORK_SNAP_REACH: Final = 3.0
_FULL_SNAP_REACH: Final = 2.5
"""Full-resolution snapping searches this many work pixels (scaled up) either side of a side."""
_COHERENCE_REACH: Final = 3.0
_MAX_FAMILY_LINES: Final = 10
_MAX_LINE_EVALUATIONS: Final = 25
_LINE_MERGE_ANGLE: Final = math.radians(4.0)
_LINE_MERGE_OFFSET: Final = 0.01
_MIN_SEGMENT_SHARE: Final = 0.05
_MIN_LINE_SHARE: Final = 0.15
_PARALLEL_SINE: Final = math.sin(math.radians(20.0))
_LINE_MARGIN: Final = 0.02
_MIN_SIDE_POINTS: Final = 5
_SAME_QUAD_PX: Final = 2.0
"""Two 4-gons whose corners are all this close (work pixels) are the same candidate."""
_EPSILON: Final = 1e-9
_QUAD_DECIMALS: Final = 2
_RATIO_DECIMALS: Final = 6
_SCORE_DECIMALS: Final = 4
_MIN_FACE_CROP_PX: Final = 2
"""A face crop narrower or shorter than this has no measurable sharpness."""
_FILL_SHIFT: Final = 8
_FILL_SCALE: Final = 1 << _FILL_SHIFT
"""``fillConvexPoly`` takes fixed-point vertices with this many fractional bits."""
_KERNEL: Final = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))

Points = NDArray[np.float64]
"""Points as an ``(n, 2)`` array; a quad is ``(4, 2)``, clockwise from the top left."""

_Line = tuple[float, float, float, float]
"""A line as ``(vx, vy, x0, y0)``: unit direction and a point on it, as ``cv2.fitLine``."""

Method = Literal["contour", "lines", "full_frame", "text_layout"]

NOT_FOUND = DocumentDetection(
    found=False,
    quad=None,
    method="none",
    rectified_size=None,
    aspect_ratio=None,
    area_ratio=None,
)


@dataclass(frozen=True, slots=True)
class DocumentResult:
    """The detection, and the rectified document image when one was found."""

    detection: DocumentDetection
    rectified: ImageArray | None
    """BGR image of ``detection.rectified_size``; ``None`` when nothing was found. For
    ``full_frame`` it is the upload itself (not a copy): treat it as read-only."""
    near_misses: tuple[Quad, ...] = ()
    """When nothing was found: the outlined, document-shaped 4-gons under the area gate (at least
    :data:`TEXT_LAYOUT_MIN_AREA_RATIO` of the upload), largest first, in upload pixels. Not part
    of the contract; :func:`detect_by_text_layout` takes the one that holds the side's text."""


# --- quad geometry -----------------------------------------------------------------------------


def _order_quad(points: Points) -> Points:
    """Corners clockwise from the top left. The top side is the upper one of the two opposite
    sides closer to horizontal, so the image's own orientation is kept."""
    p = np.asarray(points, dtype=np.float64).reshape(4, 2)
    centre = p.mean(axis=0)
    p = p[np.argsort(np.arctan2(p[:, 1] - centre[1], p[:, 0] - centre[0]), kind="stable")]
    step = np.roll(p, -1, axis=0) - p
    flat = np.abs(step[:, 0]) - np.abs(step[:, 1])
    pair = (0, 2) if flat[0] + flat[2] >= flat[1] + flat[3] else (1, 3)
    middle = (p + np.roll(p, -1, axis=0)) / 2.0
    top = min(pair, key=lambda i: (float(middle[i, 1]), i))
    return np.roll(p, -top, axis=0)


def _side_lengths(quad: Points) -> Points:
    return np.asarray(np.linalg.norm(np.roll(quad, -1, axis=0) - quad, axis=1), dtype=np.float64)


def _aspect(quad: Points) -> float:
    sides = _side_lengths(quad)
    return float((sides[0] + sides[2]) / max(float(sides[1] + sides[3]), _EPSILON))


def _area(quad: Points) -> float:
    x, y = quad[:, 0], quad[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2.0)


def _nearest_canonical(aspect: float) -> float:
    return min(CANONICAL_ASPECTS, key=lambda c: abs(aspect / c - 1.0))


def _document_shaped(aspect: float, tolerance: float = ASPECT_TOLERANCE) -> bool:
    return aspect > 0 and abs(aspect / _nearest_canonical(aspect) - 1.0) <= tolerance


def _convex(quad: Points) -> bool:
    return bool(cv2.isContourConvex(quad.astype(np.float32).reshape(-1, 1, 2)))


def _border_sides(quad: Points, width: int, height: int) -> int:
    """How many sides run along an edge of the frame."""
    tx, ty = BORDER_TOLERANCE * width, BORDER_TOLERANCE * height
    count = 0
    for i in range(4):
        xs = (quad[i, 0], quad[(i + 1) % 4, 0])
        ys = (quad[i, 1], quad[(i + 1) % 4, 1])
        if (
            max(xs) <= tx
            or min(xs) >= width - 1 - tx
            or max(ys) <= ty
            or min(ys) >= height - 1 - ty
        ):
            count += 1
    return count


def _fit_line(points: Points) -> _Line:
    fitted = cv2.fitLine(np.asarray(points, dtype=np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01)
    vx, vy, x0, y0 = (float(v) for v in np.asarray(fitted).reshape(4))
    return (vx, vy, x0, y0)


def _intersect(a: _Line, b: _Line) -> tuple[float, float] | None:
    avx, avy, ax, ay = a
    bvx, bvy, bx, by = b
    det = avy * bvx - avx * bvy
    if abs(det) < _EPSILON:
        return None
    t = ((by - ay) * bvx - (bx - ax) * bvy) / det
    return (ax + t * avx, ay + t * avy)


def _corners(sides: Sequence[_Line]) -> Points | None:
    """Corner ``i`` of the quad whose side ``i`` runs along ``sides[i]``."""
    corners = []
    for i in range(4):
        point = _intersect(sides[i - 1], sides[i])
        if point is None:
            return None
        corners.append(point)
    return np.asarray(corners, dtype=np.float64)


def _fit_sides(contour: NDArray[np.int32], quad: Points) -> Points:
    """Refit each side of ``quad`` to the contour points along its middle, then intersect."""
    points = contour.reshape(-1, 2).astype(np.float64)
    sides = []
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        length = float(np.hypot(*(b - a)))
        if length < 1.0:
            return quad
        direction = (b - a) / length
        offset = points - a
        along = offset @ direction / length
        across = np.abs(offset[:, 0] * direction[1] - offset[:, 1] * direction[0])
        near = points[
            (along > _SIDE_TRIM) & (along < 1 - _SIDE_TRIM) & (across <= max(3.0, 0.03 * length))
        ]
        if len(near) < _MIN_SIDE_POINTS:
            return quad
        sides.append(_fit_line(near))
    corners = _corners(sides)
    return quad if corners is None else corners


def _snap_sides(image: ImageArray, quad: Points, reach: float) -> Points:
    """Move each side onto the strongest colour step within ``reach`` pixels across it."""
    pixels = image.astype(np.float32)
    offsets = np.linspace(-reach, reach, 4 * math.ceil(reach) + 1)
    spacing = float(offsets[1] - offsets[0])
    rows = np.arange(_SNAP_SAMPLES)
    sides = []
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        delta = b - a
        length = float(np.hypot(*delta))
        if length < 1.0:
            return quad
        normal = np.array([-delta[1], delta[0]]) / length
        base = a + delta * np.linspace(_SIDE_TRIM, 1 - _SIDE_TRIM, _SNAP_SAMPLES)[:, None]
        grid = base[:, None, :] + offsets[None, :, None] * normal
        profile = cv2.remap(
            pixels,
            grid[..., 0].astype(np.float32),
            grid[..., 1].astype(np.float32),
            cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )
        profile = profile.reshape(*grid.shape[:2], -1)
        energy = np.square(np.diff(profile, axis=1)).sum(axis=2)
        k = np.clip(energy.argmax(axis=1), 1, energy.shape[1] - 2)
        before, peak, after = energy[rows, k - 1], energy[rows, k], energy[rows, k + 1]
        curve = before - 2.0 * peak + after
        shift = np.divide(
            0.5 * (before - after),
            curve,
            out=np.zeros_like(curve),
            where=np.abs(curve) > _EPSILON,
        )
        found = offsets[k] + spacing * (0.5 + np.clip(shift, -0.5, 0.5))
        typical = float(np.median(peak))
        strong = peak > 0.25 * typical if typical > 0 else peak > 0
        if int(np.count_nonzero(strong)) < _SNAP_SAMPLES // 4:
            return quad
        sides.append(_fit_line((base + found[:, None] * normal)[strong]))
    corners = _corners(sides)
    return quad if corners is None else corners


def _edge_support(quad: Points, edges: ImageArray) -> float:
    """The worst side's share of samples that lie on an edge pixel."""
    height, width = edges.shape[:2]
    t = np.linspace(0.0, 1.0, _SUPPORT_SAMPLES)[:, None]
    worst = 1.0
    for i in range(4):
        points = quad[i] + (quad[(i + 1) % 4] - quad[i]) * t
        x, y = points[:, 0], points[:, 1]
        inside = (x >= 0) & (x <= width - 1) & (y >= 0) & (y <= height - 1)
        xs = np.clip(np.rint(x).astype(np.intp), 0, width - 1)
        ys = np.clip(np.rint(y).astype(np.intp), 0, height - 1)
        worst = min(worst, float(np.mean((edges[ys, xs] > 0) & inside)))
    return worst


def _coherence(image: ImageArray, quad: Points) -> float:
    """The worst side's consistency of the colour step across it: the length of the summed
    inside-minus-outside colour differences over the sum of their lengths."""
    pixels = image.astype(np.float32)
    t = np.linspace(0.1, 0.9, _SUPPORT_SAMPLES)[:, None]
    worst = 1.0
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        delta = b - a
        length = float(np.hypot(*delta))
        if length < 1.0:
            return 0.0
        # Either normal will do: flipping it flips every step, not their consistency.
        normal = np.array([-delta[1], delta[0]]) / length
        base = a + delta * t
        probes = np.concatenate(
            [base + _COHERENCE_REACH * normal, base - _COHERENCE_REACH * normal]
        ).astype(np.float32)
        values = cv2.remap(
            pixels,
            np.ascontiguousarray(probes[:, :1]),
            np.ascontiguousarray(probes[:, 1:]),
            cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        ).reshape(2 * _SUPPORT_SAMPLES, -1)
        steps = values[:_SUPPORT_SAMPLES] - values[_SUPPORT_SAMPLES:]
        total = float(np.sum(np.linalg.norm(steps, axis=1)))
        if total <= _EPSILON:
            return 0.0
        worst = min(worst, float(np.linalg.norm(steps.sum(axis=0))) / total)
    return worst


# --- candidates ----------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Candidate:
    quad: Points
    """In work pixels."""
    area_ratio: float
    aspect_ratio: float
    border_sides: int
    support: float
    coherence: float

    @property
    def outlined(self) -> bool:
        """Its own edges run all round it, it is not part of the frame, and it separates two
        regions consistently (not a grid line or noise)."""
        return (
            self.border_sides < 2  # noqa: PLR2004 - two sides on the frame make it part of it
            and self.support >= MIN_EDGE_SUPPORT
            and self.coherence >= MIN_EDGE_COHERENCE
        )

    @property
    def counts(self) -> bool:
        """The C32.1 gates: the document is this quad."""
        return (
            self.outlined
            and self.area_ratio >= MIN_AREA_RATIO
            and _document_shaped(self.aspect_ratio)
        )

    @property
    def inner_card(self) -> bool:
        """A card lying in the frame, too small to count: the frame is not a tight crop."""
        return (
            self.outlined
            and self.support >= INNER_CARD_MIN_SUPPORT
            and self.area_ratio >= INNER_CARD_MIN_AREA_RATIO
            and _document_shaped(self.aspect_ratio, INNER_CARD_ASPECT_TOLERANCE)
        )


@dataclass(frozen=True, slots=True)
class _Work:
    """The scaled-down, blurred upload and its edge maps."""

    scale: float
    blurred: ImageArray
    mask: ImageArray
    edges: ImageArray
    fixed_edges: ImageArray
    support_map: ImageArray

    @property
    def size(self) -> tuple[int, int]:
        height, width = self.mask.shape[:2]
        return width, height


def _prepare(bgr: ImageArray) -> _Work:
    height, width = bgr.shape[:2]
    scale = min(1.0, WORK_LONG_SIDE / max(height, width))
    small = bgr
    if scale < 1.0:
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        small = np.asarray(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)
    blurred = np.asarray(cv2.GaussianBlur(small, (5, 5), 0), dtype=np.uint8)
    grey = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    edges = np.zeros(grey.shape, dtype=np.uint8)
    fixed = np.zeros(grey.shape, dtype=np.uint8)
    for channel in cv2.split(blurred):
        level, _ = cv2.threshold(channel, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        edges |= np.asarray(cv2.Canny(channel, 0.5 * level, level), dtype=np.uint8)
        fixed |= np.asarray(cv2.Canny(channel, 30, 90), dtype=np.uint8)
    support = np.asarray(cv2.dilate(edges | fixed, _KERNEL, iterations=2), dtype=np.uint8)
    return _Work(scale, blurred, np.asarray(mask, dtype=np.uint8), edges, fixed, support)


def _measure(work: _Work, quad: Points) -> _Candidate | None:
    width, height = work.size
    snapped = _order_quad(_snap_sides(work.blurred, _order_quad(quad), _WORK_SNAP_REACH))
    if not _convex(snapped):
        return None
    return _Candidate(
        quad=snapped,
        area_ratio=min(1.0, _area(snapped) / (width * height)),
        aspect_ratio=_aspect(snapped),
        border_sides=_border_sides(snapped, width, height),
        support=_edge_support(snapped, work.support_map),
        coherence=_coherence(work.blurred, snapped),
    )


def _contour_candidates(work: _Work) -> list[_Candidate]:
    width, height = work.size
    min_area = MIN_CANDIDATE_AREA_RATIO * width * height
    quads: list[Points] = []
    binaries = (
        work.mask,
        cv2.dilate(work.edges, _KERNEL),
        cv2.dilate(work.fixed_edges, _KERNEL),
    )
    for binary in binaries:
        contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        for contour in contours:
            hull = cv2.convexHull(contour)
            if cv2.contourArea(hull) < min_area:
                continue
            for shape in (contour, hull):
                approx = cv2.approxPolyDP(shape, _APPROX_EPSILON * cv2.arcLength(shape, True), True)
                if len(approx) != 4 or not cv2.isContourConvex(approx):  # noqa: PLR2004 - a 4-gon
                    continue
                start = _order_quad(approx.reshape(4, 2).astype(np.float64))
                quad = _order_quad(_fit_sides(np.asarray(contour, dtype=np.int32), start))
                if _area(quad) >= min_area and not any(
                    float(np.max(np.abs(quad - other))) < _SAME_QUAD_PX for other in quads
                ):
                    quads.append(quad)
    measured = (_measure(work, quad) for quad in quads)
    return [candidate for candidate in measured if candidate is not None]


def _segment_lines(work: _Work) -> tuple[list[_Line], list[_Line]]:
    """Line segments of every channel merged into lines: the near-horizontal and the
    near-vertical ones, each family's longest first."""
    width, height = work.size
    detector = cv2.createLineSegmentDetector()
    chunks = []
    for channel in cv2.split(work.blurred):
        found = detector.detect(channel)[0]
        if found is not None:
            chunks.append(np.asarray(found, dtype=np.float64).reshape(-1, 4))
    if not chunks:
        return [], []
    segments = np.concatenate(chunks)
    lengths = np.hypot(segments[:, 2] - segments[:, 0], segments[:, 3] - segments[:, 1])
    keep = lengths >= _MIN_SEGMENT_SHARE * min(width, height)
    segments, lengths = segments[keep], lengths[keep]
    tolerance = _LINE_MERGE_OFFSET * math.hypot(width, height)
    groups: list[tuple[float, float, list[float], list[tuple[float, float]]]] = []
    for index in np.argsort(-lengths, kind="stable"):
        x1, y1, x2, y2 = (float(v) for v in segments[index])
        theta = math.atan2(y2 - y1, x2 - x1) % math.pi
        mx, my = (x1 + x2) / 2.0, (y1 + y2) / 2.0
        for g_theta, g_offset, total, points in groups:
            gap = abs(theta - g_theta)
            if (
                min(gap, math.pi - gap) <= _LINE_MERGE_ANGLE
                and abs(my * math.cos(g_theta) - mx * math.sin(g_theta) - g_offset) <= tolerance
            ):
                total[0] += float(lengths[index])
                points.extend(((x1, y1), (x2, y2)))
                break
        else:
            offset = my * math.cos(theta) - mx * math.sin(theta)
            groups.append((theta, offset, [float(lengths[index])], [(x1, y1), (x2, y2)]))
    horizontal: list[tuple[float, _Line]] = []
    vertical: list[tuple[float, _Line]] = []
    for theta, _, total, points in groups:
        if total[0] < _MIN_LINE_SHARE * min(width, height):
            continue
        family = horizontal if abs(math.sin(theta)) < math.sqrt(0.5) else vertical
        family.append((total[0], _fit_line(np.asarray(points, dtype=np.float64))))

    def strongest(family: list[tuple[float, _Line]]) -> list[_Line]:
        ranked = sorted(family, key=lambda item: -item[0])
        return [line for _, line in ranked[:_MAX_FAMILY_LINES]]

    return strongest(horizontal), strongest(vertical)


def _parallel_pairs(lines: Sequence[_Line], spacing: float) -> list[tuple[int, int]]:
    pairs = []
    for i, a in enumerate(lines):
        for j in range(i + 1, len(lines)):
            b = lines[j]
            if abs(a[0] * b[1] - a[1] * b[0]) > _PARALLEL_SINE:
                continue
            if abs((b[2] - a[2]) * a[1] - (b[3] - a[3]) * a[0]) < spacing:
                continue
            pairs.append((i, j))
    return pairs


def _line_candidate(work: _Work) -> _Candidate | None:
    """The largest quad of two horizontal and two vertical lines that passes the gates."""
    width, height = work.size
    horizontal, vertical = _segment_lines(work)
    spacing = _MIN_LINE_SHARE * min(width, height)
    rows, columns = _parallel_pairs(horizontal, spacing), _parallel_pairs(vertical, spacing)
    if not rows or not columns:
        return None
    h = np.asarray(horizontal, dtype=np.float64)
    v = np.asarray(vertical, dtype=np.float64)
    hvx, hvy, hx, hy = (h[:, k][:, None] for k in range(4))
    vvx, vvy, vx, vy = (v[:, k][None, :] for k in range(4))
    det = hvy * vvx - hvx * vvy
    t = ((vy - hy) * vvx - (vx - hx) * vvy) / np.where(np.abs(det) < _EPSILON, np.nan, det)
    crossings = np.stack([hx + t * hvx, hy + t * hvy], axis=-1)
    row_pairs, column_pairs = np.asarray(rows), np.asarray(columns)
    i, j = row_pairs[:, 0][:, None], row_pairs[:, 1][:, None]
    k, m = column_pairs[:, 0][None, :], column_pairs[:, 1][None, :]
    quads = np.stack(
        [crossings[i, k], crossings[i, m], crossings[j, m], crossings[j, k]], axis=2
    ).reshape(-1, 4, 2)
    xs, ys = quads[..., 0], quads[..., 1]
    area = np.abs(np.sum(xs * np.roll(ys, -1, axis=1) - ys * np.roll(xs, -1, axis=1), axis=1)) / 2
    sides = np.linalg.norm(np.roll(quads, -1, axis=1) - quads, axis=2)
    aspect = (sides[:, 0] + sides[:, 2]) / np.maximum(sides[:, 1] + sides[:, 3], _EPSILON)
    margin = _LINE_MARGIN * max(width, height)
    inside = np.all(
        (xs >= -margin)
        & (xs <= width - 1 + margin)
        & (ys >= -margin)
        & (ys <= height - 1 + margin),
        axis=1,
    )
    distance = np.min(
        np.abs(aspect[:, None] / np.asarray(CANONICAL_ASPECTS)[None, :] - 1.0), axis=1
    )
    usable = (
        np.isfinite(area)
        & inside
        & (area >= MIN_AREA_RATIO * width * height)
        & (distance <= ASPECT_TOLERANCE)
    )
    ranked = np.argsort(-np.where(usable, area, -1.0), kind="stable")
    for index in ranked[:_MAX_LINE_EVALUATIONS]:
        if not usable[index]:
            break
        candidate = _measure(work, quads[index])
        if (
            candidate is not None
            and candidate.counts
            and candidate.support >= LINE_MIN_EDGE_SUPPORT
            and candidate.coherence >= LINE_MIN_EDGE_COHERENCE
        ):
            return candidate
    return None


# --- detection -----------------------------------------------------------------------------------


def _refine(
    bgr: ImageArray, quad: Points, scale: float, min_area_ratio: float = MIN_AREA_RATIO
) -> Points:
    """Snap the sides once more at full resolution, keeping the gates' verdict."""
    height, width = bgr.shape[:2]
    reach = max(_WORK_SNAP_REACH, _FULL_SNAP_REACH / scale)
    refined = _order_quad(_snap_sides(bgr, quad, reach))
    moved = float(np.max(np.linalg.norm(refined - quad, axis=1)))
    if (
        _convex(refined)
        and _document_shaped(_aspect(refined))
        and _area(refined) >= min_area_ratio * width * height
        and moved <= 2 * reach
    ):
        return refined
    return quad


def _rectify(bgr: ImageArray, quad: Points) -> tuple[ImageArray, tuple[int, int]]:
    sides = _side_lengths(quad)
    width = max(1, round(float(max(sides[0], sides[2]))))
    height = max(1, round(width / _nearest_canonical(_aspect(quad))))
    target = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    transform = cv2.getPerspectiveTransform(quad.astype(np.float32), target)
    warped = cv2.warpPerspective(
        bgr, transform, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )
    return np.ascontiguousarray(warped, dtype=np.uint8), (width, height)


def _as_quad(points: Points) -> Quad:
    p = [(round(float(x), _QUAD_DECIMALS), round(float(y), _QUAD_DECIMALS)) for x, y in points]
    return (p[0], p[1], p[2], p[3])


def _found(
    method: Method, quad: Points, rectified: ImageArray, size: tuple[int, int], area: float
) -> DocumentResult:
    detection = DocumentDetection(
        found=True,
        quad=_as_quad(quad),
        method=method,
        rectified_size=size,
        aspect_ratio=round(_aspect(quad), _RATIO_DECIMALS),
        area_ratio=round(min(1.0, area), _RATIO_DECIMALS),
    )
    return DocumentResult(detection=detection, rectified=rectified)


def detect_document(img: ImageArray) -> DocumentResult:
    """Find the document on the upright upload and rectify it (C32.1; module docstring)."""
    bgr = ensure_bgr(img)
    height, width = bgr.shape[:2]
    candidates: list[_Candidate] = []
    work_scale = 1.0
    if min(height, width) >= MIN_DETECTION_SIDE:
        work = _prepare(bgr)
        work_scale = work.scale
        candidates = _contour_candidates(work)
        counted = [candidate for candidate in candidates if candidate.counts]
        method: Method = "contour"
        best = max(counted, key=lambda c: c.area_ratio) if counted else None
        if best is None:
            method = "lines"
            best = _line_candidate(work)
        if best is not None:
            quad = _refine(bgr, best.quad / work.scale, work.scale)
            rectified, size = _rectify(bgr, quad)
            return _found(method, quad, rectified, size, _area(quad) / (width * height))
    if _document_shaped(width / height) and not any(c.inner_card for c in candidates):
        frame = np.array([[0.0, 0.0], [width, 0.0], [width, height], [0.0, height]])
        return _found("full_frame", frame, bgr, (width, height), 1.0)
    shaped = sorted(
        (c for c in candidates if c.outlined and _document_shaped(c.aspect_ratio)),
        key=lambda c: -c.area_ratio,
    )
    if not shaped:
        return DocumentResult(detection=NOT_FOUND, rectified=None)
    nearest = shaped[0]
    detection = DocumentDetection(
        found=False,
        quad=None,
        method="none",
        rectified_size=None,
        aspect_ratio=round(nearest.aspect_ratio, _RATIO_DECIMALS),
        area_ratio=round(nearest.area_ratio, _RATIO_DECIMALS),
    )
    near = tuple(
        _as_quad(c.quad / work_scale) for c in shaped if c.area_ratio >= TEXT_LAYOUT_MIN_AREA_RATIO
    )
    return DocumentResult(detection=detection, rectified=None, near_misses=near)


# --- the text_layout fallback (Phase 12A V2) -----------------------------------------------------


def _box_corners(boxes: Sequence[BoundingBox]) -> Points:
    return np.array(
        [
            corner
            for x, y, w, h in boxes
            for corner in ((x, y), (x + w, y), (x + w, y + h), (x, y + h))
        ],
        dtype=np.float64,
    ).reshape(-1, 2)


def _centres(boxes: Sequence[BoundingBox]) -> Points:
    return np.array([(x + w / 2, y + h / 2) for x, y, w, h in boxes], dtype=np.float64).reshape(
        -1, 2
    )


def _share_inside(quad: Points, points: Points) -> float:
    outline = quad.astype(np.float32).reshape(-1, 1, 2)
    inside = [
        cv2.pointPolygonTest(outline, (float(x), float(y)), measureDist=False) >= 0
        for x, y in points
    ]
    return float(np.mean(inside)) if inside else 0.0


def _rect_quad(centre: Points, axis: Points, width: float, height: float) -> Points:
    """The rectangle ``width`` x ``height`` around ``centre``, its width along unit ``axis``."""
    across = np.array([-axis[1], axis[0]])
    half_w, half_h = axis * width / 2, across * height / 2
    return _order_quad(
        np.array(
            [
                centre - half_w - half_h,
                centre + half_w - half_h,
                centre + half_w + half_h,
                centre - half_w + half_h,
            ]
        )
    )


def _extent(points: Points) -> tuple[Points, Points, float, float]:
    """The minimum-area rectangle of ``points`` as its centre, the unit axis of its longer side
    (pointing right), and its width and height along and across that axis."""
    (cx, cy), (w, h), angle = cv2.minAreaRect(points.astype(np.float32))
    theta = math.radians(angle)
    axis = np.array([math.cos(theta), math.sin(theta)])
    if h > w:
        axis, w, h = np.array([-axis[1], axis[0]]), h, w
    if axis[0] < 0:
        axis = -axis
    return np.array([cx, cy]), axis, float(w), float(h)


def _portraits_near(text: Points, portraits: Sequence[BoundingBox]) -> list[BoundingBox]:
    """The faces whose centre lies within the text's extent grown by
    :data:`TEXT_LAYOUT_PORTRAIT_REACH` of its size on each side."""
    centre, axis, width, height = _extent(text)
    grown = 1.0 + 2 * TEXT_LAYOUT_PORTRAIT_REACH
    area = _rect_quad(centre, axis, width * grown, height * grown)
    return [box for box in portraits if _share_inside(area, _centres([box])) == 1.0]


def _slide_sides(image: ImageArray, quad: Points, reach: float) -> Points:
    """Move each side of ``quad``, parallel to itself, onto the colour step that most of its
    samples find strongest within ``reach`` pixels (the median of the samples' strongest
    offsets). Unlike :func:`_snap_sides` it does not refit the side's angle, which the text's
    extent already gives: a side that crosses print, a barcode or a shadow on part of its
    length is not tilted by them."""
    pixels = image.astype(np.float32)
    offsets = np.linspace(-reach, reach, 4 * math.ceil(reach) + 1)
    lines: list[_Line] = []
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        delta = b - a
        length = float(np.hypot(*delta))
        normal = np.array([-delta[1], delta[0]]) / length
        base = a + delta * np.linspace(_SIDE_TRIM, 1 - _SIDE_TRIM, _SNAP_SAMPLES)[:, None]
        grid = base[:, None, :] + offsets[None, :, None] * normal
        profile = cv2.remap(
            pixels,
            grid[..., 0].astype(np.float32),
            grid[..., 1].astype(np.float32),
            cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        ).reshape(*grid.shape[:2], -1)
        energy = np.square(np.diff(profile, axis=1)).sum(axis=2)
        strongest = energy.argmax(axis=1)
        peak = energy[np.arange(_SNAP_SAMPLES), strongest]
        strong = peak > 0.25 * float(np.median(peak))
        middle = (offsets[strongest] + offsets[strongest + 1]) / 2
        shift = float(np.median(middle[strong])) if bool(strong.any()) else 0.0
        moved = a + shift * normal
        lines.append(
            (float(delta[0] / length), float(delta[1] / length), float(moved[0]), float(moved[1]))
        )
    corners = _corners(lines)
    return quad if corners is None else corners


def _layout_quad(bgr: ImageArray, evidence: Points) -> Points | None:
    """The card around the text (and portrait) corners ``evidence``: their extent, grown by the
    card's margins to the nearest canonical aspect, then slid onto the card's edges."""
    centre, axis, width, height = _extent(evidence)
    if height <= 0 or not _document_shaped(width / height, TEXT_LAYOUT_ASPECT_TOLERANCE):
        return None
    grow = 1.0 + 2 * TEXT_LAYOUT_MARGIN
    canonical = _nearest_canonical(width / height)
    card_w = max(width * grow, height * grow * canonical)
    quad = _rect_quad(centre, axis, card_w, card_w / canonical)
    slid = _order_quad(_slide_sides(bgr, quad, TEXT_LAYOUT_SNAP_REACH * card_w))
    if (
        _convex(slid)
        and _document_shaped(_aspect(slid))
        and _share_inside(slid, evidence) >= TEXT_LAYOUT_MIN_INSIDE
    ):
        return slid
    return quad


def detect_by_text_layout(
    img: ImageArray,
    previous: DocumentResult,
    *,
    text_boxes: Sequence[BoundingBox],
    portrait_boxes: Sequence[BoundingBox],
) -> DocumentResult:
    """The card found from the side's text when the detectors found none (Phase 12A V2).

    ``previous`` is :func:`detect_document`'s result, returned as it is when it found a document
    or when there is too little evidence (fewer than :data:`TEXT_LAYOUT_MIN_LINES` OCR boxes).
    ``text_boxes`` are the side's OCR line boxes on the upload; ``portrait_boxes`` the faces on
    it (the front's), of which only those beside the text count (the holder's own face held up
    next to the card does not).

    1. **An outline under the area gate.** The largest of ``previous.near_misses`` that holds at
       least :data:`TEXT_LAYOUT_MIN_INSIDE` of the lines' centres is the card: a card that fills
       less of a tall phone frame than the 30% gate asks (an ID-1 card 86% as wide as a 9:16
       frame covers 26% of it), with the text to show it is not an inner box. Its sides are
       snapped at full resolution, as the contour detector's are.
    2. **The text's extent.** Otherwise the minimum-area rectangle of the lines' corners (and
       the portrait's) must be within :data:`TEXT_LAYOUT_ASPECT_TOLERANCE` of ID-1 or TD3; grown
       by :data:`TEXT_LAYOUT_MARGIN` to the nearest canonical aspect and slid onto the card's
       edges within :data:`TEXT_LAYOUT_SNAP_REACH` (:func:`_slide_sides`), it is the card. This
       is an estimate: on the synthetic captures its corners fall within about 3-9% of the card's
       width of the truth, where an outline (1.) is within 0.3%.

    Either is reported as found with ``method: "text_layout"``, so no consumer takes it for a
    contour or line fit; its rectified copy is made as the detector's is.
    """
    boxes = [box for box in text_boxes if box[2] > 0 and box[3] > 0]
    if previous.detection.found or len(boxes) < TEXT_LAYOUT_MIN_LINES:
        return previous
    bgr = ensure_bgr(img)
    height, width = bgr.shape[:2]
    centres = _centres(boxes)
    quad: Points | None = None
    for near in previous.near_misses:
        outline = np.asarray(near, dtype=np.float64)
        if _share_inside(outline, centres) >= TEXT_LAYOUT_MIN_INSIDE:
            scale = min(1.0, WORK_LONG_SIDE / max(height, width))
            quad = _refine(bgr, outline, scale, TEXT_LAYOUT_MIN_AREA_RATIO)
            break
    if quad is None:
        text = _box_corners(boxes)
        portraits = _portraits_near(text, portrait_boxes)
        evidence = np.concatenate([text, _box_corners(portraits)]) if portraits else text
        quad = _layout_quad(bgr, evidence)
    if quad is None:
        return previous
    rectified, size = _rectify(bgr, quad)
    return _found("text_layout", quad, rectified, size, _area(quad) / (width * height))


# --- document_quality ----------------------------------------------------------------------------


def _scaled_to_width(img: ImageArray, max_width: int) -> ImageArray:
    """``img`` scaled down (never up) to at most ``max_width`` pixels wide."""
    height, width = img.shape[:2]
    if width <= max_width:
        return img
    size = (max_width, max(1, round(height * max_width / width)))
    return np.asarray(cv2.resize(img, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


def _measured_grey(rectified: ImageArray) -> NDArray[np.float32]:
    """The grey document resized to :data:`DOCUMENT_MEASURE_WIDTH` (area averaging down, cubic
    up) and smoothed by :data:`DOCUMENT_MEASURE_SIGMA`."""
    height, width = rectified.shape[:2]
    size = (DOCUMENT_MEASURE_WIDTH, max(1, round(height * DOCUMENT_MEASURE_WIDTH / width)))
    interpolation = cv2.INTER_AREA if width > DOCUMENT_MEASURE_WIDTH else cv2.INTER_CUBIC
    resized = np.asarray(cv2.resize(rectified, size, interpolation=interpolation), dtype=np.uint8)
    grey = np.asarray(ensure_gray(resized), dtype=np.float32)
    return np.asarray(cv2.GaussianBlur(grey, (0, 0), DOCUMENT_MEASURE_SIGMA), dtype=np.float32)


def _text_mask(
    boxes: Sequence[BoundingBox], scale: float, shape: tuple[int, ...]
) -> NDArray[np.bool_]:
    """The text boxes (rectified pixels) on the resized document; everything when they cover
    less than :data:`TEXT_MEASURE_MIN_SHARE` of it."""
    mask = np.zeros(shape[:2], dtype=np.bool_)
    for x, y, w, h in boxes:
        left, top = max(0, math.floor(x * scale)), max(0, math.floor(y * scale))
        right, bottom = math.ceil((x + w) * scale), math.ceil((y + h) * scale)
        mask[top:bottom, left:right] = True
    if float(mask.mean()) < TEXT_MEASURE_MIN_SHARE:
        mask[:] = True
    return mask


def _sharpness(rectified: ImageArray, text_boxes: Sequence[BoundingBox]) -> tuple[float, float]:
    """``(variance of the Laplacian, mean squared Sobel magnitude)`` of the measured document
    (:func:`_measured_grey`) over its text (:func:`_text_mask`)."""
    grey = _measured_grey(rectified)
    mask = _text_mask(text_boxes, DOCUMENT_MEASURE_WIDTH / rectified.shape[1], grey.shape)
    # The smoothed image is float32; OpenCV 5 rejects some float32 to CV_64F derivatives, so
    # the derivatives are taken in float32 and widened (docs/research/phase3-libraries.md s. 5).
    laplacian = np.asarray(cv2.Laplacian(grey, cv2.CV_32F), dtype=np.float64)
    gx = np.asarray(cv2.Sobel(grey, cv2.CV_32F, 1, 0, ksize=3), dtype=np.float64)
    gy = np.asarray(cv2.Sobel(grey, cv2.CV_32F, 0, 1, ksize=3), dtype=np.float64)
    return float(laplacian[mask].var()), float((gx * gx + gy * gy)[mask].mean())


def _upload_to_rectified(detection: DocumentDetection) -> NDArray[np.float64] | None:
    """The homography from upload pixels to rectified pixels, or ``None`` if unusable."""
    if detection.quad is None or detection.rectified_size is None:
        return None
    width, height = detection.rectified_size
    corners = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(np.array(detection.quad, dtype=np.float32), corners)
    transform = np.asarray(matrix, dtype=np.float64)
    return transform if bool(np.all(np.isfinite(transform))) else None


def _portrait_mask(
    detection: DocumentDetection, box: BoundingBox | None, shape: tuple[int, ...]
) -> NDArray[np.bool_] | None:
    """The pixels of the rectified document that the portrait ``box`` (upload pixels) covers:
    the box mapped through the quad's homography and filled. ``None`` if there is no box or it
    covers none of the document."""
    transform = None if box is None else _upload_to_rectified(detection)
    if box is None or transform is None:
        return None
    x, y, w, h = box
    outline = np.array([[x, y, 1], [x + w, y, 1], [x + w, y + h, 1], [x, y + h, 1]], dtype=float)
    mapped = outline @ transform.T
    if bool(np.any(mapped[:, 2] <= _EPSILON)):
        return None  # behind the camera: not on this document
    corners = mapped[:, :2] / mapped[:, 2:]
    # Rectified pixel (i, j) spans (i, j) to (i + 1, j + 1) of these coordinates, and filling
    # covers the pixels whose centres lie inside: shift by half a pixel.
    polygon = np.rint((corners - 0.5) * _FILL_SCALE).astype(np.int32)
    canvas = np.zeros(shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(canvas, polygon, 1, lineType=cv2.LINE_8, shift=_FILL_SHIFT)
    mask = canvas.astype(np.bool_)
    return mask if bool(mask.any()) else None


def _share(mask: NDArray[np.bool_]) -> float | None:
    return None if mask.size == 0 else round(float(np.mean(mask)), _RATIO_DECIMALS)


def measure_document_quality(
    document: DocumentResult,
    *,
    text_boxes: tuple[BoundingBox, ...],
    portrait_box: BoundingBox | None,
) -> DocumentQuality | None:
    """Sharpness, size and glare of the rectified document; ``None`` when none was found.

    - ``blur_score`` (variance of the Laplacian) and ``tenengrad`` are taken on the document
      resized to :data:`DOCUMENT_MEASURE_WIDTH` pixels wide and smoothed by
      :data:`DOCUMENT_MEASURE_SIGMA` (Phase 12A V3), over its ``text_boxes`` (rectified pixels)
      when they cover at least :data:`TEXT_MEASURE_MIN_SHARE` of it, else over all of it: the
      score follows focus, not the frame's size or what else the side prints. ``width_px`` and
      ``height_px`` are its full size.
    - ``glare_ratio_portrait`` is the glare share of the portrait: ``portrait_box`` (upload
      pixels, ``None`` on the back or without a face) mapped onto the rectified document; it is
      ``None`` (not measured, never "no glare") without a portrait on the document.
    - ``glare_ratio_text`` is the glare share of the rest of the document, where its text is
      printed: the whole document when there is no portrait. It does not depend on the OCR boxes
      (``text_boxes``), so glare that hides text, and with it the OCR boxes, still counts.

    The Phase 1 ``quality`` fields (the whole upload) are measured elsewhere and do not change.
    """
    rectified = document.rectified
    if rectified is None:
        return None
    height, width = rectified.shape[:2]
    sharpness, gradient = _sharpness(rectified, text_boxes)
    glare = glare_mask(rectified)
    portrait = _portrait_mask(document.detection, portrait_box, glare.shape)
    text = np.ones(glare.shape, dtype=np.bool_) if portrait is None else ~portrait
    return DocumentQuality(
        blur_score=round(sharpness, _SCORE_DECIMALS),
        tenengrad=round(gradient, _SCORE_DECIMALS),
        width_px=width,
        height_px=height,
        glare_ratio_text=_share(glare[text]),
        glare_ratio_portrait=None if portrait is None else _share(glare[portrait]),
    )


# --- portrait_clarity ----------------------------------------------------------------------------


def measure_portrait_clarity(img: ImageArray, portrait: Face | None) -> PortraitClarity | None:
    """How usable the front portrait is; ``None`` without a portrait or with no part of its
    box on the upload.

    - ``face_width_px``: the detector's face box width, in upload pixels.
    - ``sharpness``: the variance of the Laplacian of the grey face crop (the box clipped to the
      upload), scaled down (never up) to at most :data:`FACE_MEASURE_MAX_WIDTH` pixels wide, the
      width SFace compares faces at: a large face is not penalised for its extra pixels, and a
      small one is measured as it is (``face_width_px`` judges its size).
    - ``landmarks_score``: YuNet's confidence for the face times the share of its five landmarks
      that lie on the face box and the upload. YuNet gives one confidence per face, covering the
      box and the landmarks it regresses together; it has no confidence per landmark.
    """
    if portrait is None:
        return None
    grey = ensure_gray(img)
    height, width = grey.shape[:2]
    x, y, w, h = portrait.box
    left, top = max(0, math.floor(x)), max(0, math.floor(y))
    right, bottom = min(width, math.ceil(x + w)), min(height, math.ceil(y + h))
    if right - left < _MIN_FACE_CROP_PX or bottom - top < _MIN_FACE_CROP_PX:
        return None
    crop = np.ascontiguousarray(grey[top:bottom, left:right])
    sharpness = blur_score(_scaled_to_width(crop, FACE_MEASURE_MAX_WIDTH))
    placed = sum(
        1
        for px, py in portrait.landmarks
        if x <= px <= x + w and y <= py <= y + h and 0 <= px < width and 0 <= py < height
    )
    confidence = min(max(portrait.score, 0.0), 1.0)
    return PortraitClarity(
        face_width_px=round(w, _QUAD_DECIMALS),
        sharpness=round(sharpness, _SCORE_DECIMALS),
        landmarks_score=round(confidence * placed / len(LANDMARK_NAMES), _SCORE_DECIMALS),
    )


# --- phash ---------------------------------------------------------------------------------------


def perceptual_hash(document: DocumentResult) -> str | None:
    """The 64-bit DCT perceptual hash of the rectified document, 16 lowercase hex characters;
    ``None`` without a document or for a featureless one (its bits would be rounding noise).

    The document is converted to grey and resampled to 32 x 32 (area interpolation), then
    transformed with the orthonormal 2-D DCT-II. The 8 x 8 block of the lowest frequencies
    after the DC row and column (rows and columns 1 to 8) is compared with its own median: each
    coefficient above it is a 1. The bits are read row by row, the first one most significant.
    Stored hashes are compared across versions (C34), so this order must not change; byte ``i``
    of the hash is the ``front_phash_band_i`` column.
    """
    rectified = document.rectified
    if rectified is None:
        return None
    grey = ensure_gray(rectified)
    size = (PHASH_SAMPLE_SIZE, PHASH_SAMPLE_SIZE)
    small = np.asarray(cv2.resize(grey, size, interpolation=cv2.INTER_AREA), dtype=np.float64)
    if float(small.std()) < PHASH_MIN_CONTRAST:
        return None
    block = np.asarray(cv2.dct(small), dtype=np.float64)[1 : PHASH_BLOCK + 1, 1 : PHASH_BLOCK + 1]
    value = 0
    for bit in (block > np.median(block)).flatten():
        value = (value << 1) | int(bit)
    return f"{value:0{PHASH_BLOCK * PHASH_BLOCK // 4}x}"
