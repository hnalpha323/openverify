"""C60.4: the guarded child's ``decode_portrait`` task: chip portraits (JPEG, JP2, J2K) decoded
with Pillow, header first, refused above 4 MP before any pixel is decoded.

Portraits here are synthetic gradients; no face is needed to decode one.
"""

from __future__ import annotations

import io
import struct
import time

import pytest
from PIL import Image

from openverify_vision.guarded.images import decode_portrait
from openverify_vision.guarded.runner import GuardedRefusal, run_guarded
from openverify_vision.guarded.worker import TaskRefusal

MAX_PIXELS = 4_000_000


def gradient(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height))
    image.putdata(
        [
            ((x * 255) // width, (y * 255) // height, 128)
            for y in range(height)
            for x in range(width)
        ]
    )
    return image


def encoded(image: Image.Image, fmt: str, **options: object) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **options)
    return buffer.getvalue()


def j2k_header(width: int, height: int) -> bytes:
    """A JPEG 2000 codestream that is only its SOC and SIZ markers: a size, no pixels."""
    siz = struct.pack(">HHIIIIIIIIH3B", 41, 0, width, height, 0, 0, width, height, 0, 0, 1, 7, 1, 1)
    return b"\xff\x4f\xff\x51" + siz


def refused(data: bytes) -> str:
    with pytest.raises(TaskRefusal) as caught:
        decode_portrait(data, max_side=None, max_pixels=MAX_PIXELS)
    return caught.value.code


def test_a_jpeg_portrait_is_decoded_to_rgb() -> None:
    header, frames = decode_portrait(
        encoded(gradient(120, 150), "JPEG"), max_side=None, max_pixels=MAX_PIXELS
    )
    assert header["format"] == "JPEG"
    assert (header["raster"]["width"], header["raster"]["height"]) == (120, 150)
    assert len(frames[0]) == 120 * 150 * 3


@pytest.mark.parametrize("no_jp2", [False, True], ids=["jp2", "j2k"])
def test_a_jpeg_2000_portrait_is_decoded(no_jp2: bool) -> None:
    data = encoded(gradient(96, 120), "JPEG2000", no_jp2=no_jp2)
    header, frames = decode_portrait(data, max_side=None, max_pixels=MAX_PIXELS)
    assert header["format"] == "JPEG2000"
    assert (header["raster"]["width"], header["raster"]["height"]) == (96, 120)
    # Lossless by default: the pixels survive.
    assert frames[0][:3] == gradient(96, 120).tobytes()[:3]


def test_a_portrait_is_scaled_to_fit_the_side_asked_for() -> None:
    header, frames = decode_portrait(
        encoded(gradient(200, 400), "JPEG"), max_side=100, max_pixels=MAX_PIXELS
    )
    assert (header["raster"]["width"], header["raster"]["height"]) == (50, 100)
    assert len(frames[0]) == 50 * 100 * 3


def test_a_jpeg_2000_over_4_mp_is_refused_from_its_header() -> None:
    started = time.monotonic()
    assert refused(j2k_header(2500, 1700)) == "too_large"
    assert time.monotonic() - started < 1


def test_a_header_past_pillows_own_bomb_bound_is_too_large_too() -> None:
    # 50,000 px a side: Pillow refuses it while opening, before our 4 MP check runs.
    assert refused(j2k_header(50_000, 50_000)) == "too_large"


def test_a_jpeg_over_4_mp_is_refused_too() -> None:
    assert refused(encoded(Image.new("L", (2100, 2000)), "JPEG")) == "too_large"


def test_exactly_4_mp_is_not_too_large() -> None:
    header, _ = decode_portrait(
        encoded(Image.new("L", (2000, 2000)), "JPEG"), max_side=64, max_pixels=MAX_PIXELS
    )
    assert header["raster"]["width"] == 64


@pytest.mark.parametrize("fmt", ["PNG", "WEBP", "BMP"])
def test_other_image_formats_are_unsupported(fmt: str) -> None:
    assert refused(encoded(gradient(20, 20), fmt)) == "unsupported_format"


def test_bytes_that_are_no_image_are_unsupported() -> None:
    assert refused(b"%PDF-1.7\n") == "unsupported_format"


@pytest.mark.parametrize("fmt", ["JPEG", "JPEG2000"])
def test_a_portrait_cut_after_its_header_is_corrupt(fmt: str) -> None:
    data = encoded(gradient(120, 150), fmt)
    assert refused(data[: len(data) // 2]) == "corrupt"


def test_the_exif_orientation_of_a_jpeg_is_applied() -> None:
    exif = Image.Exif()
    exif[0x0112] = 6  # rotated 90 degrees clockwise
    data = encoded(gradient(120, 150), "JPEG", exif=exif.tobytes())
    raster = decode_portrait(data, max_side=None, max_pixels=MAX_PIXELS)[0]["raster"]
    assert (raster["width"], raster["height"]) == (150, 120)


def test_a_16_bit_grey_portrait_keeps_its_levels() -> None:
    grey = Image.new("I;16", (32, 32), 32768)
    header, frames = decode_portrait(
        encoded(grey, "JPEG2000"), max_side=None, max_pixels=MAX_PIXELS
    )
    assert header["raster"]["width"] == 32
    # 32768 of 65535 is mid-grey, not clipped to white.
    assert 120 <= frames[0][0] <= 135


def test_the_decode_runs_in_the_guarded_child() -> None:
    data = encoded(gradient(96, 120), "JPEG2000")
    answer = run_guarded("decode_portrait", data, {"max_side": 640, "max_pixels": MAX_PIXELS})
    assert answer.header["raster"]["width"] == 96
    assert len(answer.frames[0]) == 96 * 120 * 3


def test_a_refused_portrait_crosses_the_guard_with_its_code() -> None:
    with pytest.raises(GuardedRefusal) as caught:
        run_guarded(
            "decode_portrait", j2k_header(4000, 4000), {"max_side": None, "max_pixels": MAX_PIXELS}
        )
    assert caught.value.code == "too_large"
