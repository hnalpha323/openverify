"""Weight-free synthetic-face cues and the XMP digital source type (C41.1, research §5.3).

No pretrained detector is used (research §5.2: none has clean training data). Five cues compare
the face with its own frame, so the camera and the encoder are shared by both sides of each
comparison; vision measures, and TypeScript fuses and decides (C41.3, C43). Each cue is ``None``
when it cannot be measured, never a made-up value.

Regions, all on the grey frame:

- the *face window*: a square of :data:`INNER_FACE_SHARE` of the face box's shorter side
  (at most :data:`MAX_FACE_WINDOW` pixels, never resampled), centred on the box;
- *background windows*: squares outside the person (``background.person_mask`` of the face box,
  inflated by :data:`MASK_MARGIN_SHARE` of the face width), within :data:`SEARCH_FACES` face
  sizes of the box, the nearest to the face first and none overlapping another;
- the *neck*: up to :data:`NECK_DEPTH` face heights below the box, :data:`NECK_WIDTH` face widths
  wide (each at most :data:`MAX_NECK_SIDE` pixels).

The cues (Welch spectra average Hann-windowed :data:`SEGMENT`-pixel segments at half overlap; the
quantization floor is the power of 8-bit rounding noise in one bin, ``sum(hann^2) / 12``):

- ``spectral_tail_deviation`` (Durall et al. 2019, 2020): each spectrum's azimuthal average, as
  ``log10`` power over the radius normalised to Nyquist; the least-squares slope over the last
  quarter of radii (the tail); the absolute difference between the face's slope and that of the
  mean spectrum of up to :data:`BACKGROUND_WINDOWS` background windows, in decades per unit of
  normalised radius. Up-convolution leaves a tail that bends (a bump or a drop) where a camera's
  noise and an encoder's rounding leave it flat. ``None`` without a background window, for a face
  window under :data:`SEGMENT` pixels, or when the background's tail is within
  :data:`TAIL_SIGNAL` times the quantization floor (a flat or heavily compressed backdrop has
  no tail to compare with).
- ``residual_peak_ratio`` (Zhang et al. 2019; Frank et al. 2020; Corvi et al. 2023): the noise
  residual (the window minus its 3 x 3 median) of the face and of each background window; in
  each one's Welch spectrum, the largest natural-log power above its 5 x 5 median neighbourhood,
  outside the lowest frequencies and outside every JPEG frequency ``k / 8`` cycles per pixel
  (k = 1-4, on either axis, which includes the demosaicing frequency 1/4 and Nyquist): the ratio
  ``exp(face peak - strongest background peak)``. About 1 when the face is as peaky as its
  background; periodic resampling or generator artefacts confined to the face raise it. The same
  ``None`` cases as the tail, except the floor rule.
- ``noise_inconsistency`` (Mahdian and Saic 2009): the noise level of the face window, the
  background windows (:data:`NOISE_WINDOW` pixels, up to :data:`NOISE_WINDOWS`) and the neck, as
  Immerkaer's estimate over each region's flattest :data:`FLAT_SHARE` of pixels (the Phase 3
  estimator); the score is ``ln((reference + 0.5) / (face + 0.5)) / ln 3`` in [0, 1], with the
  median of the other regions as the reference. Only a face *smoother* than its surroundings
  counts, the failure the research names for blended swaps: skin texture makes a real face read
  noisier than a smooth wall or a suit, which is no evidence. ``None`` without a reference region.
- ``jpeg_grid_misalignment`` (Li, Yuan and Yu 2009; Bianchi and Piva 2012), for a JPEG upload
  only: per column (and per row), the median absolute step across it; their mean per phase of the
  8-pixel grid; the largest relative excess at a phase *other* than the encoder's own grid, in the
  face box (its central :data:`GRID_FACE_SIDE` pixels) minus the same in the frame around it (at
  most :data:`GRID_FRAME_SIDE` pixels), clipped to [0, 1]. A face pasted from an earlier JPEG keeps
  that JPEG's blocking at a shifted phase; our own client's re-encode and an MJPEG webcam are
  aligned, so only misalignment confined to the face counts. Weak evidence on resized uploads.
- ``canonical_landmark_distance`` (Yang, Li, Qi and Lyu 2019): raw StyleGAN-style outputs keep
  the FFHQ alignment, an oriented square around the face whose centre is the eye midpoint moved a
  tenth of the way to the mouth midpoint, whose half side is the larger of twice the eye distance
  and 1.8 times the eye-to-mouth distance, and whose sides follow the eye line turned against the
  eye-to-mouth direction. For such an image that square *is* the frame. The cue is the mean
  distance of the square's corners from the frame's corners, per axis as shares of the width and
  height: 0 for an FFHQ-aligned still; a crop or another framing moves it away.

``digital_source_type`` is read only for an upload (``source=upload``), by a bounded byte search
of its XMP packet, never by an XML parser (:func:`read_digital_source_type`):

- the packet starts at the first ``<?xpacket begin``, ``<x:xmpmeta`` or ``<rdf:RDF`` in the
  upload (a JPEG APP1 segment, a PNG iTXt chunk, a WebP XMP chunk: the container does not
  matter) and ends at its ``<?xpacket end`` or ``</x:xmpmeta>``; at most
  :data:`MAX_XMP_SEARCH_BYTES` (64 KiB, a standard JPEG XMP packet's size) of it are searched;
- in it, at most :data:`MAX_PROPERTY_HITS` occurrences of ``:DigitalSourceType`` (any namespace
  prefix) are read, each as an attribute (``prefix:DigitalSourceType="..."``), an element's text
  (``<prefix:DigitalSourceType>...</``) or an ``rdf:resource`` attribute, by one bounded regular
  expression over at most :data:`MAX_PROPERTY_BYTES` bytes;
- a value counts only as an IPTC NewsCodes digital source type: the vocabulary's URI (``http``
  or ``https``, ``cv.iptc.org/newscodes/digitalsourcetype/``) followed by a code, or the bare
  code, of ASCII letters and digits only (at most :data:`MAX_CODE_LENGTH`). The code is
  returned (``trainedAlgorithmicMedia``); anything else reads as ``None``.

Nothing is decoded, expanded or fetched: an entity reference (``&...;``) is never a value, so a
billion-laughs declaration or an external entity is inert text. Metadata is trivially stripped
or forged by whoever made the upload, so a value is a claim, and its absence means nothing.

Limits (C45.4): spectral cues lose most of their power under resizing and recompression, modern
generators and diffusion models leave weaker traces, and a crop defeats the landmark cue; the
detection rate is unmeasured. ``None`` overall only when nothing at all was measured.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.background import person_mask
from openverify_vision.faces import Face
from openverify_vision.forensics.upload import read_upload, upright_grid_offset
from openverify_vision.imaging import ImageArray, ensure_gray
from openverify_vision.schemas import BoundingBox, SelfieSource, SyntheticScores

MAX_XMP_SEARCH_BYTES: Final = 64 * 1024
"""Most bytes of the XMP packet searched (a standard JPEG XMP packet fits in 64 KiB)."""

MAX_PROPERTY_HITS: Final = 8
"""Most ``:DigitalSourceType`` occurrences read in one packet."""

MAX_PROPERTY_BYTES: Final = 512
"""Bytes after an occurrence that its value must lie within."""

MAX_CODE_LENGTH: Final = 64

PACKET_STARTS: Final = (b"<?xpacket begin", b"<x:xmpmeta", b"<rdf:RDF")
PACKET_ENDS: Final = (b"<?xpacket end", b"</x:xmpmeta>")
PROPERTY: Final = b":DigitalSourceType"

INNER_FACE_SHARE: Final = 0.8
MAX_FACE_WINDOW: Final = 256
MIN_WINDOW: Final = 16
"""Regions smaller than this on a side are not measured."""

SEGMENT: Final = 64
"""Welch segment side; the face window must hold one for the spectral cues."""

BACKGROUND_WINDOWS: Final = 3
NOISE_WINDOW: Final = 64
NOISE_WINDOWS: Final = 4
SEARCH_FACES: Final = 3
"""Background windows lie within this many face sizes of the face box."""
MASK_MARGIN_SHARE: Final = 0.1
MIN_MASK_MARGIN: Final = 4.0
"""The face box is inflated by this share of its width (at least 4 pixels) before the person is
masked, so a window never touches the person's edge."""
MAX_SEARCH_SIDE: Final = 512
"""The window search runs on a grid of at most this many cells a side."""
MAX_SEARCH_STEPS: Final = 24
"""Most candidate positions per axis."""

NECK_DEPTH: Final = 0.35
NECK_WIDTH: Final = 0.6
MAX_NECK_SIDE: Final = 128

TAIL_START: Final = 0.75
"""The tail is the last quarter of radii (research §5.3)."""
TAIL_SIGNAL: Final = 2.0
"""The background's mean tail power must reach this many times the quantization floor."""
LOW_FREQUENCY_BINS: Final = 3
"""Residual peaks closer than this many bins to DC are not searched."""
JPEG_HARMONICS: Final = 4
EXCLUDED_BINS: Final = 1.5
"""Half-width, in frequency bins, of each excluded ``k / 8`` frequency."""
PEAK_NEIGHBOURHOOD: Final = 5
MAX_LOG_RATIO: Final = 50.0

FLAT_SHARE: Final = 0.3
FLAT_NEIGHBOURHOOD: Final = 5
NOISE_FLOOR: Final = 0.5
"""Grey levels added to both noise levels (8-bit quantization alone is about 0.3)."""
FULL_NOISE_RATIO: Final = math.log(3.0)

GRID_PERIOD: Final = 8
GRID_FACE_SIDE: Final = 512
GRID_FRAME_SIDE: Final = 1024
GRID_FLOOR: Final = 0.5
"""Grey levels added to each phase's mean step, so a flat region's ratios stay finite."""

FFHQ_EYE_SPAN: Final = 2.0
FFHQ_MOUTH_SPAN: Final = 1.8
FFHQ_CENTRE_SHIFT: Final = 0.1
"""The FFHQ alignment square's half side (in eye distances or eye-to-mouth distances) and its
centre's shift from the eye midpoint toward the mouth midpoint."""

_SCORE_DECIMALS: Final = 4
_LANDMARKS: Final = 5

_VALUE: Final = re.compile(
    rb":DigitalSourceType(?:"
    rb"\s{0,16}=\s{0,16}(?P<q1>[\"'])(?P<attribute>[^\"'<>&]{1,256})(?P=q1)"
    rb"|\s{0,16}>\s{0,16}(?P<element>[^\"'<>&\s]{1,256})\s{0,16}</"
    rb"|\s[^<>&]{0,256}?resource\s{0,16}=\s{0,16}(?P<q2>[\"'])(?P<resource>[^\"'<>&]{1,256})(?P=q2)"
    rb")"
)
"""One property's value: every quantifier is bounded and no entity reference is accepted."""

_CODE: Final = re.compile(
    rb"(?:https?://cv\.iptc\.org/newscodes/digitalsourcetype/)?"
    rb"(?P<code>[A-Za-z][A-Za-z0-9]{0," + str(MAX_CODE_LENGTH - 1).encode() + rb"})"
)

_HANN: Final = np.outer(np.hanning(SEGMENT), np.hanning(SEGMENT))
QUANTIZATION_FLOOR: Final = float(np.square(_HANN).sum()) / 12.0
"""Power of 8-bit rounding noise (variance 1/12) in one bin of a Hann-windowed segment."""

_FREQUENCIES: Final = np.fft.fftshift(np.fft.fftfreq(SEGMENT))
_FX, _FY = np.meshgrid(_FREQUENCIES, _FREQUENCIES)
_RADIUS_BINS: Final = np.rint(np.hypot(_FX, _FY) * SEGMENT).astype(np.int64)
_RADII: Final = np.arange(SEGMENT // 2 + 1, dtype=np.float64) / (SEGMENT // 2)
_TAIL: Final = _RADII >= TAIL_START


def _peak_band() -> NDArray[np.bool_]:
    band = np.hypot(_FX, _FY) >= LOW_FREQUENCY_BINS / SEGMENT
    tolerance = EXCLUDED_BINS / SEGMENT
    for k in range(1, JPEG_HARMONICS + 1):
        band &= np.abs(np.abs(_FX) - k / GRID_PERIOD) > tolerance
        band &= np.abs(np.abs(_FY) - k / GRID_PERIOD) > tolerance
    return np.asarray(band, dtype=np.bool_)


_PEAK_BAND: Final = _peak_band()

_NOISE_KERNEL: Final = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float64)
_MEAN_TO_SIGMA: Final = math.sqrt(math.pi / 2.0) / 6.0
"""Immerkaer (1996): the kernel's mean absolute response to white noise of sigma 1."""


# --- the XMP digital source type -------------------------------------------------------------


def _packet(data: bytes) -> bytes | None:
    """The first XMP packet in ``data``, cut at its end and at :data:`MAX_XMP_SEARCH_BYTES`."""
    starts = [position for marker in PACKET_STARTS if (position := data.find(marker)) >= 0]
    if not starts:
        return None
    start = min(starts)
    window = data[start : start + MAX_XMP_SEARCH_BYTES]
    ends = [position for marker in PACKET_ENDS if (position := window.find(marker)) >= 0]
    return window[: min(ends)] if ends else window


def read_digital_source_type(data: bytes) -> str | None:
    """The IPTC digital source type code in the upload's XMP packet, or ``None`` (see the module
    docstring for what is searched and what counts)."""
    window = _packet(data)
    if window is None:
        return None
    position = window.find(PROPERTY)
    for _ in range(MAX_PROPERTY_HITS):
        if position < 0:
            break
        found = _VALUE.match(window, position, position + MAX_PROPERTY_BYTES)
        if found is not None:
            value = found.group("attribute") or found.group("element") or found.group("resource")
            code = _CODE.fullmatch(value.strip())
            if code is not None:
                return code.group("code").decode("ascii")
        position = window.find(PROPERTY, position + len(PROPERTY))
    return None


# --- the FFHQ-aligned landmark positions --------------------------------------------------------


def canonical_landmark_distance(
    landmarks: Sequence[tuple[float, float]], image_size: tuple[int, int]
) -> float | None:
    """The mean distance of the FFHQ alignment square's corners (from YuNet's five points: right
    eye, left eye, nose tip, right and left mouth corners) from the frame's corners, as shares of
    the frame's width and height; ``None`` for degenerate points or an empty frame."""
    width, height = image_size
    if len(landmarks) != _LANDMARKS or width <= 0 or height <= 0:
        return None
    points = np.asarray(landmarks, dtype=np.float64)
    if not np.all(np.isfinite(points)):
        return None
    # YuNet's "right eye" is the subject's right, on the image's left (unmirrored).
    eye_left, eye_right, mouth_left, mouth_right = points[0], points[1], points[3], points[4]
    eye_middle = (eye_left + eye_right) / 2
    across = eye_right - eye_left
    down = (mouth_left + mouth_right) / 2 - eye_middle
    direction = across - np.array([-down[1], down[0]])
    length = float(np.hypot(*direction))
    half = max(FFHQ_EYE_SPAN * float(np.hypot(*across)), FFHQ_MOUTH_SPAN * float(np.hypot(*down)))
    if length == 0.0 or half == 0.0:
        return None
    x_axis = direction / length * half
    y_axis = np.array([-x_axis[1], x_axis[0]])
    centre = eye_middle + FFHQ_CENTRE_SHIFT * down
    corners = np.stack(
        [
            centre - x_axis - y_axis,
            centre - x_axis + y_axis,
            centre + x_axis + y_axis,
            centre + x_axis - y_axis,
        ]
    )
    frame = np.array([(0.0, 0.0), (0.0, height), (width, height), (width, 0.0)])
    offsets = (corners - frame) / np.array([width, height], dtype=np.float64)
    return round(float(np.hypot(offsets[:, 0], offsets[:, 1]).mean()), _SCORE_DECIMALS)


# --- regions ----------------------------------------------------------------------------------


def _face_window(box: BoundingBox, shape: tuple[int, ...]) -> tuple[int, int, int] | None:
    """``(x0, y0, side)`` of the face window; ``None`` when the box misses the frame or the
    window would be under :data:`MIN_WINDOW` pixels."""
    height, width = shape[:2]
    x, y, w, h = box
    if x + w <= 0 or y + h <= 0 or x >= width or y >= height:
        return None
    side = int(min(INNER_FACE_SHARE * min(w, h), MAX_FACE_WINDOW, height, width))
    if side < MIN_WINDOW:
        return None
    x0 = min(max(round(x + w / 2 - side / 2), 0), width - side)
    y0 = min(max(round(y + h / 2 - side / 2), 0), height - side)
    return x0, y0, side


class _FreeArea:
    """Where squares lie wholly outside the person, near the face, on a coarse grid."""

    def __init__(self, shape: tuple[int, ...], box: BoundingBox) -> None:
        height, width = shape[:2]
        x, y, w, h = box
        self._x0 = max(0, math.floor(x - SEARCH_FACES * w))
        self._y0 = max(0, math.floor(y - SEARCH_FACES * h))
        self._x1 = min(width, math.ceil(x + w + SEARCH_FACES * w))
        self._y1 = min(height, math.ceil(y + h + SEARCH_FACES * h))
        self._centre = (x + w / 2, y + h / 2)
        span_x, span_y = max(0, self._x1 - self._x0), max(0, self._y1 - self._y0)
        self._scale = min(1.0, MAX_SEARCH_SIDE / max(span_x, span_y, 1))
        margin = max(MIN_MASK_MARGIN, MASK_MARGIN_SHARE * w)
        scale = self._scale
        grown = (
            (x - margin - self._x0) * scale,
            (y - margin - self._y0) * scale,
            (w + 2 * margin) * scale,
            (h + 2 * margin) * scale,
        )
        cells = (max(1, math.ceil(span_y * scale)), max(1, math.ceil(span_x * scale)))
        mask = person_mask(cells, grown)
        self._integral = np.asarray(cv2.integral((mask > 0).astype(np.uint8)), dtype=np.int64)
        self._cells = cells

    def windows(self, side: int, count: int) -> list[tuple[int, int]]:
        """Up to ``count`` non-overlapping ``side``-pixel squares outside the person, nearest the
        face first, as their top-left ``(x, y)`` in the frame."""
        span_x, span_y = self._x1 - self._x0, self._y1 - self._y0
        if span_x < side or span_y < side:
            return []
        cell_side = math.ceil(side * self._scale) + 1
        rows, columns = self._cells
        if rows < cell_side or columns < cell_side:
            return []
        step = max(1, cell_side // 2, math.ceil(max(rows, columns) / MAX_SEARCH_STEPS))
        gy, gx = np.meshgrid(
            np.arange(0, rows - cell_side + 1, step),
            np.arange(0, columns - cell_side + 1, step),
            indexing="ij",
        )
        table = self._integral
        covered = (
            table[gy + cell_side, gx + cell_side]
            - table[gy, gx + cell_side]
            - table[gy + cell_side, gx]
            + table[gy, gx]
        )
        tops = np.minimum(self._y0 + np.floor(gy / self._scale).astype(np.int64), self._y1 - side)
        lefts = np.minimum(self._x0 + np.floor(gx / self._scale).astype(np.int64), self._x1 - side)
        centre_x, centre_y = self._centre
        distance = (lefts + side / 2 - centre_x) ** 2 + (tops + side / 2 - centre_y) ** 2
        free = np.flatnonzero(covered == 0)
        picked: list[tuple[int, int]] = []
        for index in free[np.argsort(distance.flat[free], kind="stable")]:
            if len(picked) == count:
                break
            left, top = int(lefts.flat[index]), int(tops.flat[index])
            if all(abs(left - px) >= side or abs(top - py) >= side for px, py in picked):
                picked.append((left, top))
        return picked


def _neck(grey: ImageArray, box: BoundingBox) -> ImageArray | None:
    height, width = grey.shape[:2]
    x, y, w, h = box
    span_x, span_y = min(NECK_WIDTH * w, MAX_NECK_SIDE), min(NECK_DEPTH * h, MAX_NECK_SIDE)
    x0, x1 = max(0, round(x + w / 2 - span_x / 2)), min(width, round(x + w / 2 + span_x / 2))
    y0, y1 = max(0, round(y + h)), min(height, round(y + h + span_y))
    if x1 - x0 < MIN_WINDOW or y1 - y0 < MIN_WINDOW:
        return None
    return grey[y0:y1, x0:x1]


# --- spectra ----------------------------------------------------------------------------------


def _welch(window: NDArray[np.float64]) -> NDArray[np.float64]:
    """Welch's averaged power spectrum of a square ``window`` (DC at the centre)."""
    tiles = np.lib.stride_tricks.sliding_window_view(window, (SEGMENT, SEGMENT))
    segments = tiles[:: SEGMENT // 2, :: SEGMENT // 2].reshape(-1, SEGMENT, SEGMENT)
    centred = (segments - segments.mean(axis=(1, 2), keepdims=True)) * _HANN
    power = np.square(np.abs(np.fft.fft2(centred))).mean(axis=0)
    return np.asarray(np.fft.fftshift(power), dtype=np.float64)


def _radial(power: NDArray[np.float64]) -> NDArray[np.float64]:
    """The azimuthal average of ``power`` per integer radius, DC to Nyquist."""
    sums = np.bincount(_RADIUS_BINS.ravel(), weights=power.ravel())
    counts = np.bincount(_RADIUS_BINS.ravel())
    return np.asarray(sums[: SEGMENT // 2 + 1] / counts[: SEGMENT // 2 + 1], dtype=np.float64)


def _tail_slope(radial: NDArray[np.float64]) -> float:
    levels = np.log10(np.maximum(radial[_TAIL], QUANTIZATION_FLOOR))
    return float(np.polyfit(_RADII[_TAIL], levels, 1)[0])


def _residual(window: ImageArray) -> NDArray[np.float64]:
    smoothed = np.asarray(cv2.medianBlur(window, 3), dtype=np.float64)
    return np.asarray(window.astype(np.float64) - smoothed, dtype=np.float64)


def _peak(window: ImageArray) -> float:
    """The largest log power of the window's residual spectrum above its neighbourhood's
    median, inside :data:`_PEAK_BAND`."""
    power = _welch(_residual(window))
    levels = np.log(np.maximum(power, QUANTIZATION_FLOOR)).astype(np.float32)
    local = np.asarray(cv2.medianBlur(levels, PEAK_NEIGHBOURHOOD), dtype=np.float32)
    return float((levels - local)[_PEAK_BAND].max())


def _spectral_cues(
    face: ImageArray, backgrounds: Sequence[ImageArray]
) -> tuple[float | None, float | None]:
    """``(spectral_tail_deviation, residual_peak_ratio)``."""
    if face.shape[0] < SEGMENT or not backgrounds:
        return None, None
    face_radial = _radial(_welch(face.astype(np.float64)))
    background_radial = _radial(
        np.mean([_welch(window.astype(np.float64)) for window in backgrounds], axis=0)
    )
    tail = None
    if float(background_radial[_TAIL].mean()) >= TAIL_SIGNAL * QUANTIZATION_FLOOR:
        deviation = abs(_tail_slope(face_radial) - _tail_slope(background_radial))
        tail = round(deviation, _SCORE_DECIMALS)
    excess = _peak(face) - max(_peak(window) for window in backgrounds)
    return tail, round(math.exp(min(MAX_LOG_RATIO, excess)), _SCORE_DECIMALS)


# --- noise --------------------------------------------------------------------------------------


def _noise_level(region: ImageArray) -> float:
    """Immerkaer's noise estimate over the flattest :data:`FLAT_SHARE` of ``region``."""
    image = region.astype(np.float64)
    residual = np.abs(cv2.filter2D(image, cv2.CV_64F, _NOISE_KERNEL))[1:-1, 1:-1]
    gx = cv2.Sobel(image, cv2.CV_64F, 1, 0)
    gy = cv2.Sobel(image, cv2.CV_64F, 0, 1)
    neighbourhood = np.ones((FLAT_NEIGHBOURHOOD, FLAT_NEIGHBOURHOOD), dtype=np.uint8)
    gradient = np.asarray(cv2.dilate(np.hypot(gx, gy), neighbourhood), dtype=np.float64)[1:-1, 1:-1]
    flat = gradient <= np.quantile(gradient, FLAT_SHARE)
    return float(residual[flat].mean()) * _MEAN_TO_SIGMA


def _noise_inconsistency(face: ImageArray, references: Sequence[ImageArray]) -> float | None:
    if not references:
        return None
    reference = float(np.median([_noise_level(region) for region in references]))
    ratio = math.log((reference + NOISE_FLOOR) / (_noise_level(face) + NOISE_FLOOR))
    return round(min(1.0, max(0.0, ratio / FULL_NOISE_RATIO)), _SCORE_DECIMALS)


# --- the JPEG grid -------------------------------------------------------------------------------


def _phase_excess(grey: ImageArray, aligned: tuple[int, int]) -> float | None:
    """The strongest blockiness at a grid phase other than ``aligned`` (the ``(x, y)`` phase of
    the encoder's grid in ``grey``), relative to the median phase, on either axis; ``None`` when
    ``grey`` is under :data:`MIN_WINDOW` pixels on a side."""
    height, width = grey.shape[:2]
    if height < MIN_WINDOW or width < MIN_WINDOW:
        return None
    image = grey.astype(np.float64)
    strongest = 0.0
    for axis, phase in ((1, aligned[0]), (0, aligned[1])):
        steps = np.abs(np.diff(image, axis=axis))
        lines = np.median(steps, axis=1 - axis)
        # The step at index i lies between lines i and i + 1, on a block boundary when a block
        # starts at line i + 1.
        phases = (np.arange(lines.shape[0]) + 1) % GRID_PERIOD
        profile = np.array([lines[phases == p].mean() for p in range(GRID_PERIOD)]) + GRID_FLOOR
        relative = profile / float(np.median(profile)) - 1.0
        strongest = max(strongest, float(np.delete(relative, phase % GRID_PERIOD).max()))
    return strongest


def _centred_window(
    centre: tuple[float, float], side: float, shape: tuple[int, ...]
) -> tuple[int, int, int, int]:
    height, width = shape[:2]
    x0, y0 = max(0, round(centre[0] - side / 2)), max(0, round(centre[1] - side / 2))
    return x0, y0, min(width, round(centre[0] + side / 2)), min(height, round(centre[1] + side / 2))


def _jpeg_grid_misalignment(data: bytes, grey: ImageArray, box: BoundingBox) -> float | None:
    source = read_upload(data)
    if source is None or source.quantization is None:
        return None
    ox, oy = upright_grid_offset(source, grey.shape)
    x, y, w, h = box
    height, width = grey.shape[:2]
    fx0, fy0 = max(0, math.ceil(x)), max(0, math.ceil(y))
    fx1, fy1 = min(width, math.floor(x + w)), min(height, math.floor(y + h))
    centre = ((fx0 + fx1) / 2, (fy0 + fy1) / 2)
    if fx1 - fx0 > GRID_FACE_SIDE or fy1 - fy0 > GRID_FACE_SIDE:
        cx0, cy0, cx1, cy1 = _centred_window(centre, GRID_FACE_SIDE, grey.shape)
        fx0, fy0, fx1, fy1 = max(fx0, cx0), max(fy0, cy0), min(fx1, cx1), min(fy1, cy1)
    if fx1 <= fx0 or fy1 <= fy0:
        return None
    wx0, wy0, wx1, wy1 = _centred_window(centre, GRID_FRAME_SIDE, grey.shape)
    face = _phase_excess(grey[fy0:fy1, fx0:fx1], (ox - fx0, oy - fy0))
    frame = _phase_excess(grey[wy0:wy1, wx0:wx1], (ox - wx0, oy - wy0))
    if face is None or frame is None:
        return None
    return round(min(1.0, max(0.0, face - frame)), _SCORE_DECIMALS)


# --- the composition ------------------------------------------------------------------------------


def _face_cues(
    data: bytes, grey: ImageArray, face: Face
) -> tuple[float | None, float | None, float | None, float | None, float | None]:
    tail = peak = noise = None
    window = _face_window(face.box, grey.shape)
    if window is not None:
        x0, y0, side = window
        pixels = grey[y0 : y0 + side, x0 : x0 + side]
        area = _FreeArea(grey.shape, face.box)
        if side >= SEGMENT:
            backgrounds = [
                grey[top : top + side, left : left + side]
                for left, top in area.windows(side, BACKGROUND_WINDOWS)
            ]
            tail, peak = _spectral_cues(pixels, backgrounds)
        references = [
            grey[top : top + NOISE_WINDOW, left : left + NOISE_WINDOW]
            for left, top in area.windows(NOISE_WINDOW, NOISE_WINDOWS)
        ]
        neck = _neck(grey, face.box)
        noise = _noise_inconsistency(pixels, references if neck is None else [*references, neck])
    height, width = grey.shape[:2]
    grid = _jpeg_grid_misalignment(data, grey, face.box)
    landmarks = canonical_landmark_distance(face.landmarks, (width, height))
    return tail, peak, noise, grid, landmarks


def measure_synthetic(
    data: bytes, image: ImageArray, face: Face | None, source: SelfieSource
) -> SyntheticScores | None:
    """The synthetic cues of ``face`` in ``image`` (the upright decode of ``data``), and the XMP
    ``digital_source_type`` for an upload only; ``None`` when nothing was measured."""
    cues: tuple[float | None, ...] = (None,) * 5
    if face is not None:
        cues = _face_cues(data, ensure_gray(image), face)
    digital_source_type = read_digital_source_type(data) if source == "upload" else None
    if digital_source_type is None and all(cue is None for cue in cues):
        return None
    tail, peak, noise, grid, landmarks = cues
    return SyntheticScores(
        spectral_tail_deviation=tail,
        residual_peak_ratio=peak,
        noise_inconsistency=noise,
        jpeg_grid_misalignment=grid,
        canonical_landmark_distance=landmarks,
        digital_source_type=digital_source_type,
    )
