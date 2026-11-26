"""C202.1 (review F10): ``contracts/fixtures/flow/document-quality-vectors.json``, the vectors the
Android SDK's document measures (``commonMain capture/document/``) reproduce.

Each case is a small synthetic frame (96 x 60, raw RGBA in base64), built by code below, never a
photo. Its measures come from the server's own functions in ``openverify_vision.quality``
(the variance of the Laplacian, Tenengrad, the glare share, the brightness) and, for framing, which
the server has no equivalent of, from ``tools/android_document_guidance.py``. The file names the
OpenCV conversions the Kotlin port reproduces, and this test checks each against OpenCV over every
8-bit colour.

Assert-only (C221.8): the test fails when the committed file differs from what the functions give,
and writes it only under ``UPDATE_CONTRACT_FIXTURES=1``, so a plain ``pytest`` never changes the
working tree. After writing, run ``pnpm exec prettier --write`` on the file; the comparison reads
values, not text.
"""

from __future__ import annotations

import base64
import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any, Final

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray

from android_document_guidance import (
    MRZ_EDGE_ENERGY,
    Guide,
    bgr_of_rgba,
    framing_edge_ratio,
    mrz_band_edge_density,
    sobel_energy,
)
from openverify_vision import quality

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
FILE: Final = REPO_ROOT / "contracts" / "fixtures" / "flow" / "document-quality-vectors.json"
WIDTH: Final = 96
HEIGHT: Final = 60
CARD: Final[Guide] = (8, 7, 88, 53)
FULL: Final[Guide] = (0, 0, WIDTH, HEIGHT)

Rgba = NDArray[np.uint8]

CONVERSIONS: Final = {
    "grey": (
        "cv2.cvtColor COLOR_BGR2GRAY on 8-bit input, OpenCV 5.0.0: "
        "Y = (9798 R + 19235 G + 3735 B + 16384) >> 15 (fixed point, 15 bits, rounded half up); "
        "the test checks it against OpenCV over all 2^24 colours."
    ),
    "hsv": (
        "cv2.cvtColor COLOR_BGR2HSV on 8-bit input: V = max(R, G, B); S = 0 when V = 0, else "
        "((V - min(R, G, B)) * round(1044480 / V) + 2048) >> 12, where 1044480 = 255 << 12; S and "
        "V 0-255 (H 0-179, unused); the test checks it against OpenCV over all 2^24 colours."
    ),
    "border": "BORDER_REFLECT_101",
}

TOLERANCES: Final = {
    "laplacian-variance": 1e-6,
    "tenengrad": 1e-6,
    "glare-share": 0.0,
    "brightness-mean": 1e-12,
    "framing-edge-ratio": 1e-9,
}
"""Absolute. The port reproduces OpenCV's integer arithmetic exactly, so only the floating-point
sums of the variance differ, by far less than these."""

DESCRIPTION: Final = (
    "C202.1 (review F10): what the Android SDK's document measures (commonMain capture/document/) "
    "must reproduce, within tolerances (absolute), on small synthetic frames (96 x 60, raw RGBA in "
    "base64, rows packed, built by code: no photo). laplacian-variance is "
    "openverify_vision.quality.blur_score (cv2.Laplacian, ksize 1, CV_64F, population variance); "
    "tenengrad is quality.tenengrad (mean of the 3 x 3 Sobel gx^2 + gy^2); glare-share is "
    "quality.glare_ratio (HSV value >= 250 and saturation <= 40); brightness-mean is "
    "quality.brightness (mean grey over 255); each of the four over the whole frame. "
    "framing-edge-ratio is ours (services/vision/tools/android_document_guidance.py "
    "framing_edge_ratio over the case's guide), since the server has no framing measure. Written "
    "by services/vision/tests/test_document_quality_vectors.py with UPDATE_CONTRACT_FIXTURES=1; "
    "never edited by hand."
)


def _rgba(rgb: NDArray[Any]) -> Rgba:
    clipped = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    alpha = np.full((HEIGHT, WIDTH, 1), 255, np.uint8)
    return np.ascontiguousarray(np.concatenate([clipped, alpha], axis=-1))


def _table(seed: int) -> NDArray[np.float64]:
    rng = np.random.default_rng(seed)
    base = np.array([96.0, 70.0, 52.0])
    grain = rng.normal(0.0, 10.0, (HEIGHT, 1)) * np.ones((1, WIDTH))
    return base + grain[..., None] + rng.normal(0.0, 3.0, (HEIGHT, WIDTH, 3))


def _card(rgb: NDArray[np.float64], box: Guide) -> NDArray[np.float64]:
    left, top, right, bottom = box
    out = rgb.copy()
    out[top:bottom, left:right] = (214.0, 226.0, 220.0)
    out[top : top + 7, left:right] = (32.0, 64.0, 112.0)
    for row in range(top + 12, bottom - 4, 6):
        for column in range(left + 4, right - 6, 7):
            out[row : row + 3, column : column + 4] = (24.0, 38.0, 74.0)
    return out


def flat_grey() -> Rgba:
    return _rgba(np.full((HEIGHT, WIDTH, 3), 128.0))


def checkerboard() -> Rgba:
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH]
    level = np.where(((yy // 8) + (xx // 8)) % 2 == 0, 40.0, 200.0)
    return _rgba(np.repeat(level[..., None], 3, axis=-1))


def card_on_table() -> Rgba:
    return _rgba(_card(_table(1), CARD))


def card_blurred() -> Rgba:
    sharp = _card(_table(2), CARD).astype(np.float32)
    return _rgba(cv2.GaussianBlur(sharp, (0, 0), 1.5))


def card_small() -> Rgba:
    return _rgba(_card(_table(3), (24, 16, 72, 44)))


def card_shifted() -> Rgba:
    return _rgba(_card(_table(4), (26, 7, 96, 53)))


def card_with_glare() -> Rgba:
    rgb = _card(_table(5), CARD)
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH]
    distance = ((xx - 55.0) / 16.0) ** 2 + ((yy - 28.0) / 11.0) ** 2
    weight = np.clip(1.6 * (1.0 - distance), 0.0, 1.0)[..., None]
    return _rgba(rgb * (1.0 - weight) + 255.0 * weight)


def card_in_the_dark() -> Rgba:
    return _rgba(_card(_table(6), CARD) * 0.15)


def hsv_boundary() -> Rgba:
    """Colours around the glare boundary: V from 245 to 255, S from about 30 to 50."""
    colours = []
    for value in range(245, 256):
        for low in range(value - 50, value - 25):
            colours.append((value, low, (value + low) // 2))
            colours.append((low, (value + low) // 2, value))
    tiled = np.array(colours, dtype=np.float64)
    reps = (WIDTH * HEIGHT) // len(tiled) + 1
    return _rgba(np.tile(tiled, (reps, 1))[: WIDTH * HEIGHT].reshape(HEIGHT, WIDTH, 3))


def noise() -> Rgba:
    rng = np.random.default_rng(7)
    return _rgba(rng.integers(0, 256, (HEIGHT, WIDTH, 3)).astype(np.float64))


def gradient() -> Rgba:
    xx = np.linspace(0.0, 255.0, WIDTH)[None, :]
    yy = np.linspace(255.0, 0.0, HEIGHT)[:, None]
    return _rgba(np.stack([xx + 0 * yy, yy + 0 * xx, (xx + yy) / 2], axis=-1))


def card_at_the_frame_edges() -> Rgba:
    return _rgba(_card(_table(8), (0, 0, WIDTH, HEIGHT)))


CASES: Final[tuple[tuple[str, Callable[[], Rgba], Guide], ...]] = (
    ("flat-grey", flat_grey, CARD),
    ("checkerboard", checkerboard, CARD),
    ("card-on-table", card_on_table, CARD),
    ("card-blurred", card_blurred, CARD),
    ("card-small", card_small, CARD),
    ("card-shifted", card_shifted, CARD),
    ("card-with-glare", card_with_glare, CARD),
    ("card-in-the-dark", card_in_the_dark, CARD),
    ("hsv-boundary", hsv_boundary, CARD),
    ("noise", noise, CARD),
    ("gradient", gradient, CARD),
    ("card-at-the-frame-edges", card_at_the_frame_edges, FULL),
)
"""This test's own case table (C221.8): the frame of each case and its guide."""


def measures(rgba: Rgba, guide: Guide) -> dict[str, float]:
    """The server's functions over the whole frame, and framing over ``guide``."""
    bgr = bgr_of_rgba(rgba)
    gray = np.asarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), dtype=np.uint8)
    return {
        "laplacian-variance": quality.blur_score(bgr),
        "tenengrad": quality.tenengrad(bgr),
        "glare-share": quality.glare_ratio(bgr),
        "brightness-mean": quality.brightness(bgr),
        "framing-edge-ratio": framing_edge_ratio(gray, guide),
    }


def vectors() -> dict[str, Any]:
    cases = []
    for name, build, guide in CASES:
        rgba = build()
        left, top, right, bottom = guide
        cases.append(
            {
                "name": name,
                "width": WIDTH,
                "height": HEIGHT,
                "layout": "RGBA_8888",
                "rgba-base64": base64.b64encode(rgba.tobytes()).decode("ascii"),
                "guide": {"left": left, "top": top, "right": right, "bottom": bottom},
                "measures": measures(rgba, guide),
            }
        )
    return {
        "$schema": "./document-quality-vectors.schema.json",
        "format": 1,
        "description": DESCRIPTION,
        "conversions": CONVERSIONS,
        "tolerances": TOLERANCES,
        "cases": cases,
    }


def test_the_committed_vectors_are_what_the_servers_functions_give() -> None:
    expected = vectors()
    if os.environ.get("UPDATE_CONTRACT_FIXTURES") == "1":
        FILE.write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
    assert FILE.exists(), f"{FILE.name} is missing: run with UPDATE_CONTRACT_FIXTURES=1"
    assert json.loads(FILE.read_text(encoding="utf-8")) == expected


def test_every_frame_is_its_cases_size_and_the_cases_cover_every_measure() -> None:
    document = json.loads(FILE.read_text(encoding="utf-8"))
    assert set(document["tolerances"]) == set(TOLERANCES)
    for case in document["cases"]:
        raw = base64.b64decode(case["rgba-base64"])
        assert len(raw) == WIDTH * HEIGHT * 4, case["name"]
        assert set(case["measures"]) == set(TOLERANCES), case["name"]
    names = [case["name"] for case in document["cases"]]
    assert len(names) == len(set(names))


def test_the_frames_span_each_measure() -> None:
    """The cases are not all alike: each measure takes clearly different values across them, and
    the glare and framing cases sit on both sides of their meaning."""
    found = {name: measures(build(), guide) for name, build, guide in CASES}
    assert found["flat-grey"]["laplacian-variance"] == 0.0
    assert (
        found["card-blurred"]["laplacian-variance"] < found["card-on-table"]["laplacian-variance"]
    )
    assert found["card-with-glare"]["glare-share"] > 0.03
    assert found["card-on-table"]["glare-share"] == 0.0
    assert 0.0 < found["hsv-boundary"]["glare-share"] < 1.0
    assert found["card-in-the-dark"]["brightness-mean"] < 0.2
    framed = found["card-on-table"]["framing-edge-ratio"]
    assert framed > 5 * found["card-small"]["framing-edge-ratio"]
    assert framed > 5 * found["card-shifted"]["framing-edge-ratio"]


@pytest.fixture(scope="module")
def every_colour() -> NDArray[np.uint8]:
    """All 2^24 colours as one 4096 x 4096 BGR image."""
    values = np.arange(1 << 24, dtype=np.uint32)
    channels = [(values >> 16) & 255, (values >> 8) & 255, values & 255]
    return np.stack(channels, axis=-1).astype(np.uint8).reshape(4096, 4096, 3)


def test_the_grey_conversion_named_is_opencvs_for_every_colour(
    every_colour: NDArray[np.uint8],
) -> None:
    blue, green, red = (every_colour[..., i].astype(np.int64) for i in range(3))
    named = (9798 * red + 19235 * green + 3735 * blue + 16384) >> 15
    opencv = cv2.cvtColor(every_colour, cv2.COLOR_BGR2GRAY).astype(np.int64)
    assert int(np.count_nonzero(named != opencv)) == 0


def test_the_hsv_conversion_named_is_opencvs_for_every_colour(
    every_colour: NDArray[np.uint8],
) -> None:
    channels = every_colour.astype(np.int64)
    value = channels.max(axis=-1)
    low = channels.min(axis=-1)
    divisor = np.array([0] + [round((255 << 12) / v) for v in range(1, 256)], dtype=np.int64)
    saturation = ((value - low) * divisor[value] + 2048) >> 12
    opencv = cv2.cvtColor(every_colour, cv2.COLOR_BGR2HSV).astype(np.int64)
    assert int(np.count_nonzero(opencv[..., 2] != value)) == 0
    assert int(np.count_nonzero(opencv[..., 1] != saturation)) == 0


def _reflect_101(gray: NDArray[np.uint8]) -> NDArray[np.int64]:
    return np.pad(gray.astype(np.int64), 1, mode="reflect")


def test_the_laplacian_and_sobel_reflect_101_at_the_border() -> None:
    """numpy's ``reflect`` pad is OpenCV's BORDER_REFLECT_101 (``gfedcb|abcdefgh|gfedcba``)."""
    gray = np.asarray(cv2.cvtColor(bgr_of_rgba(noise()), cv2.COLOR_BGR2GRAY), dtype=np.uint8)
    p = _reflect_101(gray)
    centre = p[1:-1, 1:-1]
    laplacian = p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] - 4 * centre
    gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
    gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
    assert np.array_equal(laplacian, cv2.Laplacian(gray, cv2.CV_64F).astype(np.int64))
    assert np.array_equal(gx * gx + gy * gy, sobel_energy(gray))


def _stripes() -> NDArray[np.uint8]:
    """White, with rows 30 to 59 striped in columns of two: black, black, white, white."""
    gray = np.full((HEIGHT, WIDTH), 255, np.uint8)
    columns = np.arange(WIDTH) % 4 < 2
    gray[30:, columns] = 0
    return gray


def test_the_band_density_of_constructed_stripes() -> None:
    """The SDK's ``DocumentMeasuresTest`` asserts the same numbers. In the lower third (rows 40 to
    59, all striped) every column is an edge (energy 1020^2) but the two at the frame's sides,
    where the reflection mirrors a column onto its neighbour: 94 of 96 a line, 188 of 192 in each
    two-line window."""
    assert MRZ_EDGE_ENERGY == 14_400
    stripes = _stripes()
    assert mrz_band_edge_density(stripes, FULL) == 188 / 192
    assert mrz_band_edge_density(stripes, FULL, rotation=180) == 0.0
    assert mrz_band_edge_density(np.full((HEIGHT, WIDTH), 255, np.uint8), FULL) == 0.0


def test_the_band_follows_the_rotation_to_the_upright_bottom() -> None:
    """The sensor frame turned a quarter counter-clockwise, read with ``rotation`` 90 (a quarter
    clockwise makes it upright), gives the upright frame's density; and turned three quarters,
    read with 270."""
    upright = _stripes()
    expected = mrz_band_edge_density(upright, FULL)
    quarter = np.ascontiguousarray(np.rot90(upright, 1))
    three_quarters = np.ascontiguousarray(np.rot90(upright, 3))
    assert mrz_band_edge_density(quarter, (0, 0, HEIGHT, WIDTH), rotation=90) == expected
    assert mrz_band_edge_density(three_quarters, (0, 0, HEIGHT, WIDTH), rotation=270) == expected


def test_framing_reads_an_aligned_card_high_and_a_missing_one_low() -> None:
    aligned = np.asarray(
        cv2.cvtColor(bgr_of_rgba(card_on_table()), cv2.COLOR_BGR2GRAY), dtype=np.uint8
    )
    plain = np.full((HEIGHT, WIDTH), 90, np.uint8)
    assert framing_edge_ratio(aligned, CARD) > 10
    assert framing_edge_ratio(plain, CARD) == 0.0
    with pytest.raises(ValueError, match="inside"):
        framing_edge_ratio(plain, (0, 0, WIDTH + 1, HEIGHT))
