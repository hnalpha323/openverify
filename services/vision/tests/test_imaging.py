"""Decoding of uploaded bytes into BGR arrays, with format and size guards."""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image as PILImage

from openverify_vision.imaging import (
    ALLOWED_FORMATS,
    CorruptImageError,
    ImageTooLargeError,
    UnsupportedImageError,
    decode_image,
)

from synthetic import encode, make_uniform

BIG_LIMIT = 10_000_000


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
def test_decodes_supported_formats_to_bgr(fmt: str) -> None:
    red_bgr = make_uniform((0, 0, 255), height=24, width=32)

    decoded = decode_image(encode(red_bgr, fmt, quality=95), max_pixels=BIG_LIMIT)

    assert decoded.dtype == np.uint8
    assert decoded.shape == (24, 32, 3)
    blue, green, red = (int(c) for c in decoded[12, 16])
    assert red > 240
    assert blue < 15
    assert green < 15


def test_allowed_formats_are_jpeg_png_webp() -> None:
    assert set(ALLOWED_FORMATS) == {"JPEG", "PNG", "WEBP"}


def test_grayscale_png_is_returned_as_three_channel_bgr() -> None:
    buffer = io.BytesIO()
    PILImage.new("L", (8, 6), color=77).save(buffer, format="PNG")

    decoded = decode_image(buffer.getvalue(), max_pixels=BIG_LIMIT)

    assert decoded.shape == (6, 8, 3)
    assert np.all(decoded == 77)


def test_sixteen_bit_grayscale_png_is_scaled_to_eight_bits() -> None:
    # Scanners and pro exports write 16-bit grey PNGs (Pillow mode I;16). Their 0..65535 levels
    # must map onto 0..255; clipping them would turn almost every pixel white.
    levels = np.array([[0, 257 * 64, 257 * 128, 65535]], dtype=np.uint16)
    buffer = io.BytesIO()
    PILImage.fromarray(levels).save(buffer, format="PNG")
    with PILImage.open(io.BytesIO(buffer.getvalue())) as reopened:
        assert reopened.mode == "I;16"

    decoded = decode_image(buffer.getvalue(), max_pixels=BIG_LIMIT)

    assert decoded.dtype == np.uint8
    assert decoded.shape == (1, 4, 3)
    assert decoded[0].tolist() == [[0, 0, 0], [64, 64, 64], [128, 128, 128], [255, 255, 255]]


def test_rgba_png_drops_alpha() -> None:
    buffer = io.BytesIO()
    PILImage.new("RGBA", (4, 4), color=(10, 20, 30, 0)).save(buffer, format="PNG")

    decoded = decode_image(buffer.getvalue(), max_pixels=BIG_LIMIT)

    assert decoded.shape == (4, 4, 3)


def test_exif_orientation_is_applied() -> None:
    # 40 wide x 20 tall, tagged "rotate 90 CW to display" (orientation 6): displayed 20x40.
    buffer = io.BytesIO()
    exif = PILImage.Exif()
    exif[0x0112] = 6
    PILImage.new("RGB", (40, 20), color=(128, 128, 128)).save(buffer, format="JPEG", exif=exif)

    decoded = decode_image(buffer.getvalue(), max_pixels=BIG_LIMIT)

    assert decoded.shape[:2] == (40, 20)


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        b"definitely not an image",
        b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n",
        b"<svg xmlns='http://www.w3.org/2000/svg'/>",
    ],
)
def test_non_images_are_unsupported(payload: bytes) -> None:
    with pytest.raises(UnsupportedImageError):
        decode_image(payload, max_pixels=BIG_LIMIT)


@pytest.mark.parametrize("fmt", ["GIF", "BMP", "TIFF"])
def test_real_images_in_other_formats_are_unsupported(fmt: str) -> None:
    payload = encode(make_uniform(128, height=8, width=8), fmt)

    with pytest.raises(UnsupportedImageError):
        decode_image(payload, max_pixels=BIG_LIMIT)


def test_truncated_image_is_corrupt() -> None:
    payload = encode(make_uniform(128, height=64, width=64), "PNG")

    with pytest.raises(CorruptImageError):
        decode_image(payload[: len(payload) // 2], max_pixels=BIG_LIMIT)


def test_pixel_count_above_limit_is_too_large() -> None:
    payload = encode(make_uniform(128, height=100, width=100), "PNG")

    with pytest.raises(ImageTooLargeError, match="10000"):
        decode_image(payload, max_pixels=9_999)


def test_pixel_count_at_limit_is_accepted() -> None:
    payload = encode(make_uniform(128, height=100, width=100), "PNG")

    assert decode_image(payload, max_pixels=10_000).shape == (100, 100, 3)


def test_decompression_bomb_is_too_large_even_with_generous_limit() -> None:
    # A tiny PNG that claims huge dimensions trips Pillow's own bomb guard before decoding.
    buffer = io.BytesIO()
    PILImage.new("1", (14_000, 14_000)).save(buffer, format="PNG")

    with pytest.raises(ImageTooLargeError):
        decode_image(buffer.getvalue(), max_pixels=10**12)


def test_errors_share_a_common_base() -> None:
    for error in (UnsupportedImageError, CorruptImageError, ImageTooLargeError):
        assert issubclass(error, ValueError)
