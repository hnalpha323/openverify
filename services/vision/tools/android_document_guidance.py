"""Android document guidance (C202, Workflow 10B document-guidance): the reference measures the SDK
ports and the calibration of ``contracts/fixtures/flow/document-capture.json``.

The SDK (``android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/capture/document/``)
measures each analysis frame with four measures the server already has, ported from
``openverify_vision.quality`` (the variance of the Laplacian, Tenengrad, the glare share and the
mean brightness), and two of its own, which the server has no equivalent of and which are defined
here,
so that the vectors and the calibration measure exactly what the SDK measures:

- :func:`framing_edge_ratio`: edge energy along the card guide's four borders against the area
  outside it (C202.1);
- :func:`mrz_band_edge_density`: how edge-dense the guide's lower third is, as a hint that a
  passport's machine-readable zone is in view (C202.3).

Both read the 3 x 3 Sobel energy ``gx**2 + gy**2`` of the grey frame, which OpenCV computes with
``BORDER_REFLECT_101``; every quantity is an integer sum divided once, so the Kotlin port reproduces
each value to the last bit.

The guidance only decides when to take the photo and what hint to show. Nothing it measures is
sent, and the server re-measures every upload (C202.5, ADR 0009).

Calibration (:func:`calibrate`, ``main``) follows the Phase 4 harness pattern: the threshold rule is
fixed before any frame is measured (:data:`RULE`), the frames are synthetic renders of the Utopia
card and passport page (``synthetic_id``, ``synthetic_travel``) composed into analysis frames by
code, and the report says it covers those renders only. Usage::

    cd services/vision && uv run python tools/android_document_guidance.py
    cd services/vision && uv run python tools/android_document_guidance.py --write

The first measures and prints; ``--write`` also writes the fixture and
``docs/calibration/android-document-guidance.md``.
"""

from __future__ import annotations

import argparse
import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image

from openverify_vision import quality
from synthetic_id import render_back, render_front
from synthetic_travel import render_passport

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
DOCUMENT_CAPTURE: Final = REPO_ROOT / "contracts" / "fixtures" / "flow" / "document-capture.json"
REPORT: Final = REPO_ROOT / "docs" / "calibration" / "android-document-guidance.md"

Guide = tuple[int, int, int, int]
"""A guide in frame pixels: ``(left, top, right, bottom)``, right and bottom exclusive."""

Gray = NDArray[np.uint8]
Energy = NDArray[np.int64]

FRAMING_BAND_PERCENT: Final = 6
"""Half the width of the band searched for an edge along each border, in percent of the guide's
shorter side (rounded, at least one pixel). Basis (ours): a card held within about 6% of the guide
on each side still fills it; at the 640 px analysis width that is 16 px of a 272 px guide."""

FRAMING_ENERGY_FLOOR: Final = 100.0
"""Added to the energy beyond a border before dividing, so a plain table does not divide by zero.
Basis: the 3 x 3 Sobel energy of sensor noise of 2 grey levels is about 96 (12 x 4, twice)."""

FRAMING_SHRINK_PERCENTS: Final = (50, 55, 60, 65, 70, 75, 80, 85, 90)
"""Smaller guides, in percent of the guide, centred on it: a card that frames one of them but not
the guide itself is in view and too small, so the hint is "move closer". Basis (ours): steps of 5%
keep any card from half the guide's size to 90% of it within one of their bands; a card under
half the guide (a quarter of its area) gets "fit the card in the frame"."""

MRZ_EDGE_ENERGY: Final = 14_400
"""A pixel counts as an edge when its Sobel energy is at least this: a sharp step of 30 grey
levels, ``(4 x 30)**2``. Basis (ours): the machine-readable zone is dark print on a light band."""

MRZ_WINDOW_DIVISOR: Final = 24
"""The rows averaged together: the guide's height over this (at least one row), about one
machine-readable line's height on a TD3 page (4.6 mm of 88 mm is about 1/19, its glyphs about
1/24)."""


def sobel_energy(gray: Gray) -> Energy:
    """``gx**2 + gy**2`` of the 3 x 3 Sobel derivatives of ``gray`` (``BORDER_REFLECT_101``),
    exact."""
    gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    return np.asarray(np.rint(gx * gx + gy * gy), dtype=np.int64)


def _check_guide(shape: tuple[int, ...], guide: Guide) -> None:
    height, width = shape[:2]
    left, top, right, bottom = guide
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise ValueError(f"guide {guide} must be non-empty and inside the {width}x{height} frame")


def band_half_width(guide: Guide) -> int:
    """:data:`FRAMING_BAND_PERCENT` of the guide's shorter side, rounded half up, at least 1."""
    left, top, right, bottom = guide
    return max(1, (min(right - left, bottom - top) * FRAMING_BAND_PERCENT + 50) // 100)


def _mean(values: NDArray[np.int64]) -> float:
    """The mean of integer values as one division of their exact sum."""
    return float(int(values.sum())) / float(values.size)


def framing_edge_ratio(gray: Gray, guide: Guide) -> float:
    """How strongly an edge runs along the borders of ``guide``, against the area just outside it.

    For each border, the band of :func:`band_half_width` lines on both sides of it is searched for
    the line (a row for the top and bottom, a column for the sides, over the guide's extent) with
    the highest mean Sobel energy. That border's score is this mean over the mean energy of the
    strip of ``2 x band`` lines just beyond the band, outside the guide over the same extent (0
    when the strip leaves the frame), plus :data:`FRAMING_ENERGY_FLOOR`. The ratio is the
    second-weakest border's score: three of the four borders must show an edge, because a card
    border of the same tone as the table (a dark header on a dark table) shows none. A card filling
    the guide gives a high ratio; a card moved, turned, too small or too large leaves at least two
    borders without an edge that stands out from what lies beyond it: about 1 to 3.
    """
    _check_guide(gray.shape, guide)
    energy = sobel_energy(gray)
    return framing_edge_ratio_of(energy, guide)


def _strip_mean(energy: Energy, rows: tuple[int, int], columns: tuple[int, int]) -> float:
    """The mean energy of ``rows`` x ``columns`` clipped to the frame, or 0 when nothing is left."""
    height, width = energy.shape
    top, bottom = max(0, rows[0]), min(height, rows[1])
    left, right = max(0, columns[0]), min(width, columns[1])
    if bottom <= top or right <= left:
        return 0.0
    return _mean(energy[top:bottom, left:right])


def framing_edge_ratio_of(energy: Energy, guide: Guide) -> float:
    """:func:`framing_edge_ratio` over an energy image already computed."""
    _check_guide(energy.shape, guide)
    height, width = energy.shape
    left, top, right, bottom = guide
    band = band_half_width(guide)

    def lines(edge: int, limit: int) -> range:
        return range(max(0, edge - band), min(limit, edge + band))

    def score(best: float, beyond: float) -> float:
        return best / (beyond + FRAMING_ENERGY_FLOOR)

    scores = sorted(
        (
            score(
                max(_mean(energy[y, left:right]) for y in lines(top, height)),
                _strip_mean(energy, (top - 3 * band, top - band), (left, right)),
            ),
            score(
                max(_mean(energy[y, left:right]) for y in lines(bottom, height)),
                _strip_mean(energy, (bottom + band, bottom + 3 * band), (left, right)),
            ),
            score(
                max(_mean(energy[top:bottom, x]) for x in lines(left, width)),
                _strip_mean(energy, (top, bottom), (left - 3 * band, left - band)),
            ),
            score(
                max(_mean(energy[top:bottom, x]) for x in lines(right, width)),
                _strip_mean(energy, (top, bottom), (right + band, right + 3 * band)),
            ),
        )
    )
    return scores[1]


def shrunk_guide(guide: Guide, percent: int) -> Guide:
    """``guide`` scaled to ``percent`` of its width and height about its centre (integer pixels)."""
    left, top, right, bottom = guide
    width, height = right - left, bottom - top
    new_width = max(1, (width * percent + 50) // 100)
    new_height = max(1, (height * percent + 50) // 100)
    new_left = left + (width - new_width) // 2
    new_top = top + (height - new_height) // 2
    return (new_left, new_top, new_left + new_width, new_top + new_height)


def mrz_band_edge_density(gray: Gray, guide: Guide, rotation: int = 0) -> float:
    """The edge density of the guide's lower third as the person sees it, upright (C202.3).

    ``rotation`` (0, 90, 180 or 270) is the clockwise turn that makes the frame upright, so the
    upright bottom is the frame's bottom, right, top or left. Along that band, lines run parallel to
    the guide's bottom edge; each line's share of edge pixels (Sobel energy at least
    :data:`MRZ_EDGE_ENERGY`, over the guide's extent) is averaged over windows of
    ``max(1, guide height / MRZ_WINDOW_DIVISOR)`` consecutive lines, and the densest window is the
    answer: dark machine-readable lines across the page give a high share.
    """
    _check_guide(gray.shape, guide)
    if rotation not in (0, 90, 180, 270):
        raise ValueError(f"rotation {rotation} must be 0, 90, 180 or 270")
    return mrz_band_edge_density_of(sobel_energy(gray), guide, rotation)


def mrz_band_edge_density_of(energy: Energy, guide: Guide, rotation: int = 0) -> float:
    """:func:`mrz_band_edge_density` over an energy image already computed."""
    _check_guide(energy.shape, guide)
    left, top, right, bottom = guide
    if rotation in (90, 270):
        energy = energy.T
        left, top, right, bottom = top, left, bottom, right
    span = right - left
    third = max(1, (bottom - top) // 3)
    first = top if rotation in (180, 270) else bottom - third
    edges = (energy[first : first + third, left:right] >= MRZ_EDGE_ENERGY).sum(axis=1)
    window = min(third, max(1, (bottom - top) // MRZ_WINDOW_DIVISOR))
    best = max(int(edges[i : i + window].sum()) for i in range(third - window + 1))
    return float(best) / float(window * span)


# --- the guide in an analysis frame ------------------------------------------------------------

CARD_ASPECT: Final = 85.60 / 53.98
"""ID-1 (85.60 x 53.98 mm), the card guide the capture screen draws."""

PASSPORT_ASPECT: Final = 125.0 / 88.0
"""A TD3 data page (125 x 88 mm)."""

GUIDE_SHARE: Final = 0.9
"""The guide fills 90% of the frame's limiting side, as the capture screen draws it."""


def guide_in_frame(width: int, height: int, aspect: float) -> Guide:
    """The guide of ``aspect`` in an upright ``width`` x ``height`` frame, centred, as the SDK's
    ``DocumentGuide`` places it: 90% of the limiting side, truncated to whole pixels."""
    guide_width = int(min(width * GUIDE_SHARE, height * GUIDE_SHARE * aspect))
    guide_height = int(guide_width / aspect)
    left = (width - guide_width) // 2
    top = (height - guide_height) // 2
    return (left, top, left + guide_width, top + guide_height)


def bgr_of_rgba(rgba: NDArray[np.uint8]) -> NDArray[np.uint8]:
    """An RGBA frame (the SDK's ``RGBA_8888``) as the BGR image OpenCV and ``quality`` read."""
    return np.ascontiguousarray(rgba[..., 2::-1])


def read_client_constants(path: Path = DOCUMENT_CAPTURE) -> dict[str, float]:
    """The ``client`` block of ``document-capture.json``: what the SDK applies to a frame."""
    document = json.loads(path.read_text(encoding="utf-8"))
    client = document["client"]
    if not isinstance(client, dict):
        raise TypeError("document-capture.json's client block is an object")
    return {str(key): float(value) for key, value in client.items()}


# --- calibration on synthetic renders (Phase 4 harness pattern) ---------------------------------

FRAME_SIZE: Final = (480, 640)
"""The upright analysis frame: 640 px wide in the sensor's orientation (C201.2), in portrait."""

BACKGROUNDS: Final = ("plain grey", "dark wood", "white paper", "blue cloth")
PLAIN, WOOD, PAPER = 0, 1, 2
HALF: Final = 0.5

GROUPS: Final = ("good", "blur", "glare", "dark", "bright", "small", "off", "mrz-hidden")
"""Every calibration group. ``good`` is held well; each other group breaks one thing."""

RULE: Final = (
    "Fixed before any frame was measured. Each threshold separates the good frames from the one "
    "group that breaks its gate: sharpness (both measures) from blur, the glare share from glare, "
    "the brightness minimum from dark, its maximum from bright, framing from off and small "
    "together, the machine-readable band from mrz-hidden (passport pages only). Where the two "
    "groups do not overlap, the threshold is their midpoint: geometric for the sharpness and "
    "framing measures, which span decades, arithmetic for the shares and brightness. Where they "
    "overlap, the threshold is the good group's extreme, so no good frame is held, and the report "
    "says how many broken frames pass. Each value is then rounded to three significant figures."
)

DOCUMENTS: Final = ("front", "back", "passport")


@dataclass(frozen=True, slots=True)
class Scene:
    """One synthetic analysis frame: ``rgba`` is upright, ``FRAME_SIZE``, the SDK's layout."""

    name: str
    group: str
    document: str
    guide: Guide
    rgba: NDArray[np.uint8]


def _documents() -> dict[str, NDArray[np.float32]]:
    """The Utopia card's front and back and the passport data page, RGB, without a portrait (a
    plain block stands in for the passport's photo: no face is rendered, rule 3)."""
    plain = Image.new("RGB", (300, 400), (150, 156, 162))
    rendered = {
        "front": render_front(None, None),
        "back": render_back(),
        "passport": render_passport(plain, (75, 100, 150, 200)),
    }
    return {
        name: np.asarray(image.convert("RGB"), dtype=np.float32) for name, image in rendered.items()
    }


def _background(rng: np.random.Generator, kind: int) -> NDArray[np.float32]:
    """One of four tabletops: plain grey, dark wood grain, white paper, blue cloth."""
    width, height = FRAME_SIZE
    if kind == PLAIN:
        base = np.full((height, width, 3), (112.0, 106.0, 100.0), np.float32)
        noise = cv2.GaussianBlur(
            rng.normal(0.0, 6.0, (height, width)).astype(np.float32), (0, 0), 6
        )
    elif kind == WOOD:
        base = np.full((height, width, 3), (74.0, 50.0, 32.0), np.float32)
        streaks = rng.normal(0.0, 18.0, (height, 1)).astype(np.float32) * np.ones((1, width))
        noise = cv2.GaussianBlur(streaks.astype(np.float32), (0, 0), 1.2)
    elif kind == PAPER:
        base = np.full((height, width, 3), (214.0, 212.0, 206.0), np.float32)
        noise = cv2.GaussianBlur(
            rng.normal(0.0, 3.0, (height, width)).astype(np.float32), (0, 0), 2
        )
    else:
        base = np.full((height, width, 3), (70.0, 92.0, 132.0), np.float32)
        noise = cv2.GaussianBlur(
            rng.normal(0.0, 24.0, (height, width)).astype(np.float32), (0, 0), 1
        )
    return np.asarray(base + noise[..., None], dtype=np.float32)


def _place(  # noqa: PLR0913 - a document and where it lies
    document: NDArray[np.float32],
    background: NDArray[np.float32],
    guide: Guide,
    *,
    scale: float,
    shift: tuple[float, float],
    angle: float,
) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    """``document`` scaled to ``scale`` of the guide's width, turned ``angle`` degrees and moved by
    ``shift`` (shares of the guide's width and height) from the guide's centre, over
    ``background``. Returns the frame and the document's coverage mask."""
    width, height = FRAME_SIZE
    left, top, right, bottom = guide
    doc_height, doc_width = document.shape[:2]
    target_width = max(2, round((right - left) * scale))
    target_height = max(2, round(target_width * doc_height / doc_width))
    small = cv2.resize(document, (target_width, target_height), interpolation=cv2.INTER_AREA)
    centre_x = (left + right) / 2 + shift[0] * (right - left)
    centre_y = (top + bottom) / 2 + shift[1] * (bottom - top)
    matrix = cv2.getRotationMatrix2D((target_width / 2, target_height / 2), angle, 1.0)
    matrix[0, 2] += centre_x - target_width / 2
    matrix[1, 2] += centre_y - target_height / 2
    warped = cv2.warpAffine(small, matrix, (width, height), flags=cv2.INTER_LINEAR)
    ones = np.ones((target_height, target_width), np.float32)
    mask = cv2.warpAffine(ones, matrix, (width, height), flags=cv2.INTER_LINEAR)[..., None]
    framed = np.asarray(background * (1.0 - mask) + warped * mask, dtype=np.float32)
    return framed, np.asarray(mask, dtype=np.float32)


def _finish(
    pixels: NDArray[np.float32],
    rng: np.random.Generator,
    gain: float,
    highlight: NDArray[np.float32] | None = None,
) -> NDArray[np.uint8]:
    """Lens softness, exposure, a specular ``highlight`` (which saturates whatever the exposure),
    sensor noise and quantisation, then RGBA."""
    soft = cv2.GaussianBlur(pixels, (0, 0), float(rng.uniform(0.5, 0.8)))
    lit = soft * gain
    if highlight is not None:
        lit = lit * (1.0 - highlight) + 255.0 * highlight
    lit = lit + rng.normal(0.0, 1.5, soft.shape)
    rgb = np.clip(np.rint(lit), 0, 255).astype(np.uint8)
    alpha = np.full((*rgb.shape[:2], 1), 255, np.uint8)
    return np.concatenate([rgb, alpha], axis=-1)


def _motion_or_defocus(
    pixels: NDArray[np.float32], rng: np.random.Generator
) -> NDArray[np.float32]:
    if rng.uniform() < HALF:
        return np.asarray(cv2.GaussianBlur(pixels, (0, 0), float(rng.uniform(1.6, 3.0))))
    length = int(rng.integers(7, 14))
    kernel = np.zeros((length, length), np.float32)
    kernel[length // 2, :] = 1.0 / length
    turn = cv2.getRotationMatrix2D(
        (length / 2 - 0.5, length / 2 - 0.5), float(rng.uniform(0, 180)), 1
    )
    kernel = np.asarray(cv2.warpAffine(kernel, turn, (length, length)), dtype=np.float32)
    kernel /= float(kernel.sum())
    return np.asarray(cv2.filter2D(pixels, -1, kernel))


def _highlight(rng: np.random.Generator, guide: Guide) -> NDArray[np.float32]:
    """A colourless specular highlight's weight over the document, like ``synthetic_variants``'
    glare: 1 where it saturates the sensor."""
    width, height = FRAME_SIZE
    left, top, right, bottom = guide
    yy, xx = np.mgrid[0:height, 0:width]
    centre_x = rng.uniform(left + 0.25 * (right - left), right - 0.25 * (right - left))
    centre_y = rng.uniform(top + 0.3 * (bottom - top), bottom - 0.3 * (bottom - top))
    radius_x = rng.uniform(0.14, 0.26) * (right - left)
    radius_y = rng.uniform(0.18, 0.32) * (bottom - top)
    distance = ((xx - centre_x) / radius_x) ** 2 + ((yy - centre_y) / radius_y) ** 2
    return np.asarray(np.clip(1.6 * (1.0 - distance), 0.0, 1.0)[..., None], dtype=np.float32)


def _scene(
    index: int, group: str, document_name: str, documents: dict[str, NDArray[np.float32]]
) -> Scene:
    rng = np.random.default_rng(10_000 + index)
    aspect = PASSPORT_ASPECT if document_name == "passport" else CARD_ASPECT
    guide = guide_in_frame(*FRAME_SIZE, aspect)
    background = _background(rng, index % len(BACKGROUNDS))
    scale = float(rng.uniform(0.96, 1.03))
    shift = (float(rng.uniform(-0.012, 0.012)), float(rng.uniform(-0.012, 0.012)))
    angle = float(rng.uniform(-1.2, 1.2))
    gain = float(rng.uniform(0.8, 1.05))
    if group == "small":
        scale = float(rng.uniform(0.5, 0.8))
    elif group == "off":
        variant = index % 3
        if variant == 0:
            shift = (float(rng.choice([-1, 1]) * rng.uniform(0.18, 0.3)), shift[1])
        elif variant == 1:
            angle = float(rng.choice([-1, 1]) * rng.uniform(12.0, 25.0))
        else:
            scale = float(rng.uniform(1.25, 1.5))
    elif group == "dark":
        gain = float(rng.uniform(0.1, 0.18))
    elif group == "bright":
        gain = float(rng.uniform(1.45, 1.8))
    pixels, mask = _place(
        documents[document_name], background, guide, scale=scale, shift=shift, angle=angle
    )
    if group == "mrz-hidden":
        left, top, right, bottom = guide
        cover_top = bottom - (bottom - top) // 3 - 6
        pixels[cover_top : bottom + 8, left - 6 : right + 6] = (186.0, 148.0, 128.0)
    if group == "blur":
        pixels = _motion_or_defocus(pixels, rng)
    highlight = _highlight(rng, guide) if group == "glare" else None
    _ = mask
    return Scene(
        name=f"{group}-{document_name}-{index:03d}",
        group=group,
        document=document_name,
        guide=guide,
        rgba=_finish(pixels, rng, gain, highlight),
    )


SCENES_PER_GROUP: Final = {
    "good": 48,
    "blur": 36,
    "glare": 36,
    "dark": 24,
    "bright": 24,
    "small": 24,
    "off": 36,
    "mrz-hidden": 18,
}


def calibration_scenes(per_group: dict[str, int] | None = None) -> list[Scene]:
    """Every calibration frame, deterministic (seeded per frame). Passport pages appear in every
    group but are the only document of ``mrz-hidden``."""
    counts = SCENES_PER_GROUP if per_group is None else per_group
    documents = _documents()
    scenes = []
    index = 0
    for group in GROUPS:
        for number in range(counts.get(group, 0)):
            name = "passport" if group == "mrz-hidden" else DOCUMENTS[number % len(DOCUMENTS)]
            scenes.append(_scene(index, group, name, documents))
            index += 1
    return scenes


def measure_scene(scene: Scene) -> dict[str, float]:
    """The SDK's measures of one frame: the four quality measures over the guide's crop (each as
    ``quality`` measures an image), framing over the frame, and the band density."""
    bgr = bgr_of_rgba(scene.rgba)
    gray = np.asarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), dtype=np.uint8)
    left, top, right, bottom = scene.guide
    crop = np.ascontiguousarray(bgr[top:bottom, left:right])
    energy = sobel_energy(gray)
    return {
        "laplacian-variance": quality.blur_score(crop),
        "tenengrad": quality.tenengrad(crop),
        "glare-share": quality.glare_ratio(crop),
        "brightness-mean": quality.brightness(crop),
        "framing-edge-ratio": framing_edge_ratio_of(energy, scene.guide),
        "framing-shrunk-best": max(
            framing_edge_ratio_of(energy, shrunk_guide(scene.guide, percent))
            for percent in FRAMING_SHRINK_PERCENTS
        ),
        "mrz-band-edge-density": mrz_band_edge_density_of(energy, scene.guide),
    }


def three_figures(value: float) -> float:
    """``value`` rounded to three significant figures."""
    if value == 0:
        return 0.0
    digits = 2 - math.floor(math.log10(abs(value)))
    return round(value, digits)


@dataclass(frozen=True, slots=True)
class Gate:
    """One threshold: its key, the measure, the side a good frame is on, the broken groups."""

    key: str
    measure: str
    minimum: bool
    broken: tuple[str, ...]
    geometric: bool
    documents: tuple[str, ...] = DOCUMENTS


GATES: Final = (
    Gate("sharpness-laplacian-variance-min", "laplacian-variance", True, ("blur",), True),
    Gate("sharpness-tenengrad-min", "tenengrad", True, ("blur",), True),
    Gate("glare-share-max", "glare-share", False, ("glare",), False),
    Gate("brightness-mean-min", "brightness-mean", True, ("dark",), False),
    Gate("brightness-mean-max", "brightness-mean", False, ("bright",), False),
    Gate("framing-edge-ratio-min", "framing-edge-ratio", True, ("off", "small"), True),
    Gate(
        "mrz-band-edge-density-min",
        "mrz-band-edge-density",
        True,
        ("mrz-hidden",),
        False,
        ("passport",),
    ),
)


def threshold(gate: Gate, good: Sequence[float], broken: Sequence[float]) -> tuple[float, bool]:
    """:data:`RULE` for one gate: the threshold and whether the groups were separable."""
    if gate.minimum:
        inner, outer = min(good), max(broken)
        separable = inner > outer
    else:
        inner, outer = max(good), min(broken)
        separable = inner < outer
    if not separable:
        return three_figures(inner), False
    middle = math.sqrt(inner * outer) if gate.geometric and outer > 0 else (inner + outer) / 2
    return three_figures(middle), True


def calibrate(measured: Sequence[tuple[Scene, dict[str, float]]]) -> dict[str, Any]:
    """The thresholds of :data:`GATES` by :data:`RULE`, with each group's spread."""
    results: dict[str, Any] = {}
    for gate in GATES:

        def values(groups: tuple[str, ...], gate: Gate = gate) -> list[float]:
            return [
                m[gate.measure]
                for scene, m in measured
                if scene.group in groups and scene.document in gate.documents
            ]

        good, broken = values(("good",)), values(gate.broken)
        value, separable = threshold(gate, good, broken)
        results[gate.key] = {
            "value": value,
            "separable": separable,
            "good": _spread(good),
            "broken": _spread(broken),
        }
    return results


def _spread(values: Sequence[float]) -> dict[str, float | int]:
    ordered = sorted(values)
    return {
        "count": len(ordered),
        "min": ordered[0],
        "median": ordered[len(ordered) // 2],
        "max": ordered[-1],
    }


HINTS: Final = ("move-closer", "hold-still", "tilt-away", "more-light", "fit-card", "show-mrz")
"""The SDK's hints in their fixed order (C202.3), the machine-readable band's last."""


def hint_of(m: dict[str, float], client: dict[str, float], *, passport: bool) -> str | None:
    """The hint the SDK shows for measures ``m`` (``DocumentHints.hintOf``, mirrored for the
    report): the first in :data:`HINTS` whose condition holds, or ``None`` when every gate holds."""
    framed = m["framing-edge-ratio"] >= client["framing-edge-ratio-min"]
    sharp = (
        m["laplacian-variance"] >= client["sharpness-laplacian-variance-min"]
        and m["tenengrad"] >= client["sharpness-tenengrad-min"]
    )
    lit = m["brightness-mean"] >= client["brightness-mean-min"]
    clear = (
        m["glare-share"] <= client["glare-share-max"]
        and m["brightness-mean"] <= client["brightness-mean-max"]
    )
    if not framed and m["framing-shrunk-best"] >= client["framing-edge-ratio-min"]:
        return "move-closer"
    checks = (
        (not sharp and lit and clear and framed, "hold-still"),
        (not clear, "tilt-away"),
        (not lit, "more-light"),
        (not framed, "fit-card"),
        (passport and m["mrz-band-edge-density"] < client["mrz-band-edge-density-min"], "show-mrz"),
    )
    return next((hint for holds, hint in checks if holds), None)


FIXED: Final[dict[str, tuple[int, str]]] = {
    "hold-ms": (
        500,
        "Every gate holds for this long before the photo is taken: four sampled frames at 8 Hz, "
        "the same hold as selfie-capture.json's hold-ms (provisional, ours).",
    ),
    "guidance-hz": (8, "C201.2: frames are sampled at 8 Hz, as selfie-capture.json's guidance-hz."),
    "analysis-width-px": (
        640,
        "C201.2: about 640 px wide in the sensor's orientation for a document (engineering 3.1, "
        "inference); the calibration frames are 480 x 640, upright in portrait.",
    ),
    "barcode-analysis-width-px": (
        1280,
        "C201.2, review F11: at least 1,280 px on a barcode-bearing side, since a 290-module AAMVA "
        "row falls near 1.5 px a module at 640; pdf417-guidance's device test may replace it with "
        "a crop of the guide. Not calibrated here.",
    ),
    "manual-shutter-after-ms": (
        10000,
        "Decision 19, C202.4: the shutter becomes the primary action after 10 s, as "
        "selfie-capture.json's manual-shutter-after-ms.",
    ),
}

GATE_BASIS: Final = {
    "sharpness-laplacian-variance-min": "variance of the Laplacian of the guide's crop "
    "(quality.blur_score), good against blur",
    "sharpness-tenengrad-min": "Tenengrad of the guide's crop (quality.tenengrad), "
    "good against blur",
    "glare-share-max": "share of the crop at HSV value >= 250 and saturation <= 40 "
    "(quality.glare_ratio), good against glare",
    "brightness-mean-min": "mean grey of the crop, 0 to 1 (quality.brightness), good against dark",
    "brightness-mean-max": "mean grey of the crop, 0 to 1 (quality.brightness), "
    "good against bright",
    "framing-edge-ratio-min": "the second-weakest border's edge energy over the strip beyond it "
    "(framing_edge_ratio), good against off and small",
    "mrz-band-edge-density-min": "edge share of the densest line window in the guide's lower third "
    "(mrz_band_edge_density), passport pages, good against mrz-hidden",
}


def fixture_document(calibration: dict[str, Any]) -> dict[str, Any]:
    """``document-capture.json`` as the calibration writes it (shape: its ``.schema.json``)."""
    client: dict[str, float | int] = {key: value for key, (value, _) in FIXED.items()}
    basis = {key: text for key, (_, text) in FIXED.items()}
    for gate in GATES:
        result = calibration[gate.key]
        client[gate.key] = result["value"]
        how = "the midpoint" if result["separable"] else "the good group's extreme (overlap)"
        basis[gate.key] = (
            f"Provisional, synthetic renders only: {GATE_BASIS[gate.key]}; {how} by the rule in "
            "docs/calibration/android-document-guidance.md."
        )
    return {
        "$schema": "./document-capture.schema.json",
        "format": 1,
        "description": (
            "C202.2: the Android SDK's document capture constants for an analysis frame, read by "
            "the SDK (commonMain capture/document/DocumentCaptureConstants.kt, checked by "
            "DocumentCaptureConstantsTest) and by Python (services/vision/tools/"
            "android_document_guidance.py, checked by test_android_document_calibration.py). "
            "Guidance only: they decide when the photo is taken and which hint is shown, never a "
            "result; the server re-measures every upload (C202.5). Written by "
            "android_document_guidance.py --write; never tuned on a test's expected answer."
        ),
        "client": {key: client[key] for key in sorted(client)},
        "basis": {key: basis[key] for key in sorted(basis)},
        "calibration": {
            "report": "docs/calibration/android-document-guidance.md",
            "covers": "synthetic renders only",
        },
    }


def _row(values: dict[str, float | int]) -> str:
    return f"{values['min']:.4g} / {values['median']:.4g} / {values['max']:.4g}"


def report_markdown(
    calibration: dict[str, Any], hints: dict[str, dict[str, int]], counts: dict[str, int]
) -> str:
    """The calibration report (docs/calibration/android-document-guidance.md)."""
    lines = [
        "# Android document guidance: calibration on synthetic renders (C202.2)",
        "",
        "**This covers synthetic renders only.** Every frame below is the fictional Utopia card "
        "(front and back) or passport data page, drawn by `services/vision/tools/synthetic_id.py` "
        "and `synthetic_travel.py` and composed into an analysis frame by "
        "`services/vision/tools/android_document_guidance.py`. Nothing here was measured on a real "
        "camera frame, lens, sensor or light, and nothing here says how the constants behave on "
        "one (review H21). The constants are provisional.",
        "",
        "The guidance decides only when the photo is taken and which hint is shown. It never "
        "passes or fails anything: the server re-measures every upload with its own checks "
        "(`id_blur_detection`, `id_glare_detection`), and a photo the device would have taken can "
        "still fail there, and the reverse (C202.5, C202.6, ADR 0009).",
        "",
        "## How the frames were made",
        "",
        "- Upright analysis frames of 480 x 640 px (640 px wide in the sensor's orientation, "
        "C201.2), the document placed in the capture screen's guide (90% of the frame's width, "
        "ID-1 for the card, TD3 for the passport page) over one of four tabletops (plain grey, "
        "dark wood, white paper, blue cloth), then lens softness (Gaussian 0.5 to 0.8 px), "
        "exposure, sensor noise (1.5 grey levels) and 8-bit quantisation. The passport's "
        "portrait is a plain block: no face is rendered.",
        "- `good`: within 4% of the guide's size, 1.2% of its position and 1.2 degrees, gain "
        "0.8 to 1.05, so no channel of the document clips. `blur`: Gaussian 1.6 to 3 px or a 7 "
        "to 13 px motion streak. `glare`: a "
        "colourless highlight over 14 to 26% of the guide's width. `dark`: gain 0.1 to 0.18. "
        "`bright`: gain 1.45 to 1.8. `small`: 50 to 80% of the guide. `off`: moved 18 to 30% of "
        "the guide, turned 12 to 25 degrees, or 125 to 150% of it. `mrz-hidden`: a passport page "
        "whose lower third is covered.",
        "- Each frame is seeded by its index, so a run reproduces every number below.",
        "",
        "Frames per group: "
        + ", ".join(f"{group} {counts[group]}" for group in GROUPS if group in counts)
        + ".",
        "",
        "## The rule",
        "",
        RULE,
        "",
        "## Thresholds",
        "",
        "| Constant | Value | Separable | Good (min / median / max) "
        "| Broken (min / median / max) |",
        "|---|---|---|---|---|",
    ]
    for gate in GATES:
        result = calibration[gate.key]
        lines.append(
            f"| `{gate.key}` | {result['value']} | {'yes' if result['separable'] else 'no'} | "
            f"{_row(result['good'])} | {_row(result['broken'])} |"
        )
    lines += [
        "",
        "## The hint each group gets (the SDK's order, mirrored)",
        "",
        "With the thresholds above, the first hint whose condition holds, in the SDK's fixed order "
        "(move closer, hold still, tilt away from the light, more light, fit the card in the "
        "frame, then the machine-readable band on a passport); `none` means every gate held and "
        "the photo would be taken after `hold-ms`.",
        "",
        "| Group | " + " | ".join([*HINTS, "none"]) + " |",
        "|---|" + "---|" * (len(HINTS) + 1),
    ]
    for group in GROUPS:
        if group not in hints:
            continue
        row = hints[group]
        lines.append(
            f"| {group} | " + " | ".join(str(row.get(h, 0)) for h in [*HINTS, "none"]) + " |"
        )
    lines += [
        "",
        "## What this does not cover",
        "",
        "- Real camera frames, lenses, autofocus, exposure control, rolling shutter, compression "
        "or lighting; real documents, holograms, laminates or worn cards; how people hold a phone.",
        "- How CameraX scales a frame to the analysis resolution on a given device, and how the "
        "preview's crop lines up with the analysis frame's guide.",
        "- PDF417 decoding at the analysis width (pdf417-guidance's calibration, C203.3).",
        "",
        "Regenerate with `cd services/vision && uv run python tools/android_document_guidance.py "
        "--write`; `tests/test_android_document_calibration.py` checks that the committed "
        "constants still separate the groups as this report says.",
        "",
    ]
    return "\n".join(lines)


def run(per_group: dict[str, int] | None = None) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Measure every frame, apply the rule, and build the fixture and the report."""
    scenes = calibration_scenes(per_group)
    measured = [(scene, measure_scene(scene)) for scene in scenes]
    calibration = calibrate(measured)
    document = fixture_document(calibration)
    client = {key: float(value) for key, value in document["client"].items()}
    hints: dict[str, dict[str, int]] = {}
    for scene, m in measured:
        hint = hint_of(m, client, passport=scene.document == "passport") or "none"
        hints.setdefault(scene.group, {})
        hints[scene.group][hint] = hints[scene.group].get(hint, 0) + 1
    counts: dict[str, int] = {}
    for scene, _ in measured:
        counts[scene.group] = counts.get(scene.group, 0) + 1
    return document, calibration, report_markdown(calibration, hints, counts)


SUMMARY_HEADING: Final = "\n## Summary block\n"
SUMMARY_END: Final = "<!-- openverify:calibration-summary:end -->"


def with_committed_summary(report: str, previous: str | None) -> str:
    """``report`` followed by the summary block section of ``previous``, unchanged.

    KP11-75 (Workflow 11F): the section runs from its ``## Summary block`` heading through the
    block's end marker (C279.1; docs-catalog added it in Workflow 11E); the check catalog reads it,
    and ``catalog-calibration`` holds its figures to the report's text.
    """
    if previous is None:
        return report
    start = previous.find(SUMMARY_HEADING)
    end = previous.find(SUMMARY_END, start) if start != -1 else -1
    if end == -1:
        return report
    return report + previous[start : end + len(SUMMARY_END)] + "\n"


def write_report(path: Path, report: str) -> None:
    """Write ``report`` to ``path``, keeping the summary block of the report already there."""
    path.parent.mkdir(parents=True, exist_ok=True)
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    path.write_text(with_committed_summary(report, previous), encoding="utf-8")


def printed_json(value: dict[str, Any]) -> str:
    """JSON as the repository's Prettier prints it for these files: two spaces, one key a line."""
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Calibrate the Android document guidance.")
    parser.add_argument("--write", action="store_true", help="write the fixture and the report")
    args = parser.parse_args(argv)
    document, calibration, report = run()
    print(json.dumps(calibration, indent=2))
    if args.write:
        DOCUMENT_CAPTURE.write_text(printed_json(document), encoding="utf-8")
        write_report(REPORT, report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
