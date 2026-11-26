"""``forensics/upload.py``: what the original upload bytes say before EXIF-upright decoding."""

from __future__ import annotations

import numpy as np
import pytest
from PIL import ExifTags, Image

from forensic_scenes import card, decode, encode, jpeg
from openverify_vision.forensics.upload import grid_offset, read_upload, upright_grid_offset

IJG_LUMINANCE_AT_50 = (
    *(16, 11, 10, 16, 24, 40, 51, 61),
    *(12, 12, 14, 19, 26, 58, 60, 55),
    *(14, 13, 16, 24, 40, 57, 69, 56),
    *(14, 17, 22, 29, 51, 87, 80, 62),
    *(18, 22, 37, 56, 68, 109, 103, 77),
    *(24, 35, 55, 64, 81, 104, 113, 92),
    *(49, 64, 78, 87, 103, 121, 120, 101),
    *(72, 92, 95, 98, 112, 100, 103, 99),
)
"""ITU-T T.81 Annex K.1 in natural (row-major) order: libjpeg's luminance table at quality 50."""


def test_a_jpeg_upload_has_its_tables_in_natural_order_and_its_stored_size() -> None:
    source = read_upload(jpeg(card(), 50))

    assert source is not None
    assert source.format == "JPEG"
    assert source.quantization is not None
    assert source.quantization[0] == IJG_LUMINANCE_AT_50
    assert sorted(source.quantization) == [0, 1]
    assert source.raw_size == (1012, 638)
    assert source.orientation == 1


@pytest.mark.parametrize("fmt", ["PNG", "WEBP"])
def test_a_lossless_or_webp_upload_has_no_jpeg_tables(fmt: str) -> None:
    source = read_upload(encode(card(), fmt))

    assert source is not None
    assert source.format == fmt
    assert source.quantization is None


@pytest.mark.parametrize(
    "data",
    [b"", b"not an image", encode(np.zeros((8, 8, 3), dtype=np.uint8), "GIF")],
    ids=["empty", "text", "gif"],
)
def test_bytes_that_are_not_an_allowed_image_are_not_read(data: bytes) -> None:
    assert read_upload(data) is None


def test_the_orientation_comes_from_exif() -> None:
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = 6

    source = read_upload(jpeg(card(), 90, exif=exif))

    assert source is not None
    assert source.orientation == 6


RAW_WIDTH, RAW_HEIGHT = 61, 43
"""Neither side a multiple of 8, so every orientation moves the block grid differently."""


def coordinates_png(orientation: int) -> bytes:
    """A PNG whose red and green channels hold each stored pixel's x and y."""
    ys, xs = np.mgrid[0:RAW_HEIGHT, 0:RAW_WIDTH]
    bgr = np.stack([np.zeros_like(xs), ys, xs], axis=-1).astype(np.uint8)
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = orientation
    return encode(bgr, "PNG", exif=exif)


@pytest.mark.parametrize("orientation", range(1, 9))
def test_the_grid_offset_starts_an_upright_block_on_a_stored_block(orientation: int) -> None:
    data = coordinates_png(orientation)
    upright = decode(data)
    source = read_upload(data)
    assert source is not None
    assert source.orientation == orientation

    ox, oy = grid_offset(source.orientation, source.raw_size)

    assert 0 <= ox < 8
    assert 0 <= oy < 8
    for top in range(oy, upright.shape[0] - 7, 8):
        for left in range(ox, upright.shape[1] - 7, 8):
            block = upright[top : top + 8, left : left + 8]
            stored_x, stored_y = block[:, :, 2], block[:, :, 1]
            assert int(stored_x.min()) % 8 == 0
            assert int(stored_y.min()) % 8 == 0
            assert int(stored_x.max()) - int(stored_x.min()) == 7
            assert int(stored_y.max()) - int(stored_y.min()) == 7


def test_an_unknown_orientation_keeps_the_grid_at_the_origin() -> None:
    assert grid_offset(0, (61, 43)) == (0, 0)
    assert grid_offset(9, (61, 43)) == (0, 0)


def test_a_decode_that_is_not_the_stored_image_keeps_the_grid_at_the_origin() -> None:
    source = read_upload(coordinates_png(6))
    assert source is not None
    assert source.upright_size == (RAW_HEIGHT, RAW_WIDTH)

    assert upright_grid_offset(source, (RAW_WIDTH, RAW_HEIGHT, 3)) == grid_offset(6, (61, 43))
    assert upright_grid_offset(source, (RAW_HEIGHT, RAW_WIDTH, 3)) == (0, 0)
