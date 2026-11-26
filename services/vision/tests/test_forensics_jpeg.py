"""``forensics/jpeg.py``: quality from the quantization tables, and double compression.

The double-compression score is the periodicity of the block-DCT coefficient histograms
(research §5): a JPEG re-saved at a finer quality than its first compression leaves periodic
gaps in them. Re-saving at a coarser quality, or at the same one, leaves none that can be told
from a single compression, so those cases stay low.
"""

from __future__ import annotations

import io
from typing import Any

import cv2
import numpy as np
import pytest
from PIL import ExifTags, Image

from forensic_scenes import Image as Pixels
from forensic_scenes import camera, card, decode, encode, jpeg, recompress
from openverify_vision.forensics import jpeg as jpeg_module
from openverify_vision.forensics.jpeg import (
    IJG_CHROMINANCE,
    IJG_LUMINANCE,
    MAX_DCT_BLOCKS,
    double_compression_score,
    estimate_quality,
    jpeg_forensics,
    scaled_table,
)
from openverify_vision.forensics.upload import read_upload

CAMERA = camera(card())


def tables_of(data: bytes) -> dict[int, list[int]]:
    with Image.open(io.BytesIO(data)) as image:
        return {k: list(v) for k, v in image.quantization.items()}  # type: ignore[attr-defined]


def score_of(data: bytes) -> float | None:
    return double_compression_score(decode(data), luma_table=tables_of(data)[0], offset=(0, 0))


@pytest.mark.parametrize("quality", [1, 10, 35, 50, 75, 90, 95, 100])
def test_the_scaled_tables_are_the_ones_libjpeg_writes(quality: int) -> None:
    tables = tables_of(jpeg(CAMERA, quality))

    assert tuple(tables[0]) == scaled_table(IJG_LUMINANCE, quality)
    assert tuple(tables[1]) == scaled_table(IJG_CHROMINANCE, quality)


@pytest.mark.parametrize("quality", [5, 30, 60, 75, 85, 92, 100])
def test_the_quality_of_standard_tables_is_exact(quality: int) -> None:
    assert estimate_quality(tables_of(jpeg(CAMERA, quality))) == (quality, True)


def test_a_greyscale_jpeg_has_one_table_and_an_exact_quality() -> None:
    grey = np.asarray(cv2.cvtColor(CAMERA, cv2.COLOR_BGR2GRAY), dtype=np.uint8)

    tables = tables_of(encode(grey, "JPEG", quality=70))

    assert sorted(tables) == [0]
    assert estimate_quality(tables) == (70, True)


def test_custom_tables_are_not_standard_and_estimate_the_nearest_quality() -> None:
    luma = list(scaled_table(IJG_LUMINANCE, 80))
    luma[10] += 3
    luma[40] -= 2
    chroma = list(scaled_table(IJG_CHROMINANCE, 80))
    chroma[5] += 1

    quality, standard = estimate_quality({0: luma, 1: chroma}) or (0, True)

    assert standard is False
    assert abs(quality - 80) <= 3


@pytest.mark.parametrize(
    "tables", [{}, {1: list(IJG_CHROMINANCE)}, {0: [1, 2, 3]}], ids=["none", "no-luma", "short"]
)
def test_without_a_64_entry_luminance_table_there_is_no_estimate(
    tables: dict[int, list[int]],
) -> None:
    assert estimate_quality(tables) is None


@pytest.mark.parametrize("quality", [50, 60, 75, 90, 95])
def test_a_single_compression_has_a_low_double_compression_score(quality: int) -> None:
    score = score_of(jpeg(CAMERA, quality))

    assert score is not None
    assert score < 0.1


@pytest.mark.parametrize("first", [60, 85, 92])
def test_re_saving_at_the_same_quality_stays_low(first: int) -> None:
    score = score_of(jpeg(recompress(CAMERA, first), first))

    assert score is not None
    assert score < 0.1


@pytest.mark.parametrize(("first", "second"), [(60, 90), (75, 90), (50, 75), (70, 95), (80, 95)])
def test_a_re_save_at_a_finer_quality_is_detected(first: int, second: int) -> None:
    score = score_of(jpeg(recompress(CAMERA, first), second))

    assert score is not None
    assert score > 0.15


def test_a_re_save_at_quality_100_is_only_weakly_detected() -> None:
    # A quantization step of 1 spreads the comb over many harmonics: above every single
    # compression, below the finer-quality cases (a documented limit).
    score = score_of(jpeg(recompress(CAMERA, 60), 100))

    assert score is not None
    assert score > 0.05


def test_the_score_is_measured_on_the_jpeg_block_grid_of_a_rotated_upload() -> None:
    # Stored 1009 x 637 (neither a multiple of 8) and shown rotated: the upright decode's
    # blocks start at the grid offset, not at the origin.
    stored = recompress(camera(card(size=(1009, 637))), 60)
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = 6
    data = jpeg(stored, 90, exif=exif)
    source = read_upload(data)
    assert source is not None

    measured = jpeg_forensics(source, decode(data))

    assert measured is not None
    assert measured.double_compression_score is not None
    assert measured.double_compression_score > 0.15
    assert (measured.quality_estimate, measured.standard_tables) == (90, True)


def test_too_few_blocks_are_not_measured() -> None:
    tiny = jpeg(CAMERA[:20, :20], 90)

    assert score_of(tiny) is None


def test_a_uniform_image_has_no_periodicity() -> None:
    flat = jpeg(np.full((640, 960, 3), 128, dtype=np.uint8), 90)

    assert score_of(flat) in (None, 0.0)


def test_the_block_dct_is_opencvs() -> None:
    rng = np.random.default_rng(4)
    blocks = rng.uniform(-128.0, 127.0, size=(5, 8, 8))

    transformed = jpeg_module._dct_8x8(blocks)

    for block, expected in zip(blocks, transformed, strict=True):
        assert np.allclose(cv2.dct(block), expected, atol=1e-9)


def test_a_large_upload_samples_at_most_the_block_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    rng = np.random.default_rng(5)
    large: Pixels = np.ascontiguousarray(
        cv2.resize(CAMERA, (6000, 3800), interpolation=cv2.INTER_LINEAR)
        + rng.integers(0, 3, (3800, 6000, 3), dtype=np.uint8)
    )
    counts: list[int] = []
    real = jpeg_module._dct_8x8

    def spy(blocks: Any) -> Any:
        counts.append(len(blocks))
        return real(blocks)

    monkeypatch.setattr(jpeg_module, "_dct_8x8", spy)

    double_compression_score(large, luma_table=scaled_table(IJG_LUMINANCE, 90), offset=(0, 0))

    assert counts
    assert sum(counts) <= MAX_DCT_BLOCKS


def test_jpeg_forensics_of_a_jpeg_and_of_a_png() -> None:
    data = jpeg(CAMERA, 85)
    source = read_upload(data)
    png_source = read_upload(encode(CAMERA, "PNG"))
    assert source is not None
    assert png_source is not None

    measured = jpeg_forensics(source, decode(data))

    assert measured is not None
    assert (measured.quality_estimate, measured.standard_tables) == (85, True)
    assert measured.double_compression_score is not None
    assert measured.double_compression_score < 0.1
    assert jpeg_forensics(png_source, CAMERA) is None
