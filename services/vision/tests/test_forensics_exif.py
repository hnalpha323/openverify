"""``forensics/exif.py``: capture metadata from the original bytes, never GPS values."""

from __future__ import annotations

import io
import struct

import numpy as np
import pytest
from PIL import ExifTags, Image, PngImagePlugin

from forensic_scenes import encode, jpeg
from openverify_vision.forensics.exif import MAX_EXIF_TEXT, clean_text, summarize_exif
from openverify_vision.forensics.upload import read_upload
from openverify_vision.schemas import ExifSummary

PIXELS = np.zeros((32, 48, 3), dtype=np.uint8)
NOTHING = ExifSummary(software=None, make=None, model=None, has_gps=False)


def opened(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


def camera_exif(*, gps: bool) -> Image.Exif:
    exif = Image.Exif()
    exif[ExifTags.Base.Software] = "Utopia Editor 2.1"
    exif[ExifTags.Base.Make] = "Utopia Optics"
    exif[ExifTags.Base.Model] = "UO-7"
    if gps:
        exif[ExifTags.IFD.GPSInfo] = {
            ExifTags.GPS.GPSLatitudeRef: "N",
            ExifTags.GPS.GPSLatitude: (45.0, 30.0, 17.0),
            ExifTags.GPS.GPSLongitudeRef: "W",
            ExifTags.GPS.GPSLongitude: (73.0, 34.0, 11.0),
        }
    return exif


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_software_make_model_and_gps_presence_are_read(fmt: str) -> None:
    summary = summarize_exif(opened(encode(PIXELS, fmt, exif=camera_exif(gps=True))))

    assert summary == ExifSummary(
        software="Utopia Editor 2.1", make="Utopia Optics", model="UO-7", has_gps=True
    )


def test_gps_values_never_leave_the_summary() -> None:
    summary = summarize_exif(opened(jpeg(PIXELS, 90, exif=camera_exif(gps=True))))

    dumped = summary.model_dump_json()
    assert set(summary.model_dump()) == {"software", "make", "model", "has_gps"}
    for value in ("45", "73", "17", "30", "34", "11"):
        assert value not in dumped


def test_a_gps_block_without_a_position_is_no_gps() -> None:
    exif = camera_exif(gps=False)
    exif[ExifTags.IFD.GPSInfo] = {ExifTags.GPS.GPSVersionID: b"\x02\x02\x00\x00"}

    assert summarize_exif(opened(jpeg(PIXELS, 90, exif=exif))).has_gps is False


def test_an_upload_without_exif_has_nothing() -> None:
    assert summarize_exif(opened(jpeg(PIXELS, 90))) == NOTHING


def test_a_png_software_text_chunk_counts_as_the_software() -> None:
    info = PngImagePlugin.PngInfo()
    info.add_text("Software", "Utopia Screenshot Tool")

    summary = summarize_exif(opened(encode(PIXELS, "PNG", pnginfo=info)))

    assert summary.software == "Utopia Screenshot Tool"


def test_text_is_cleaned_and_cut_to_the_contract_length() -> None:
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = "Utopia Optics\x00\x00"
    exif[ExifTags.Base.Model] = "  UO-7\n\t "
    exif[ExifTags.Base.Software] = "E" * 1000

    summary = summarize_exif(opened(jpeg(PIXELS, 90, exif=exif)))

    assert summary.make == "Utopia Optics"
    assert summary.model == "UO-7"
    assert summary.software == "E" * MAX_EXIF_TEXT


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (b"Utopia Optics\x00", "Utopia Optics"),
        ("\U0001f4f7" * 200, "\U0001f4f7" * (MAX_EXIF_TEXT // 2)),
        (42, None),
        (None, None),
    ],
    ids=["bytes", "astral", "number", "absent"],
)
def test_clean_text_decodes_bytes_and_counts_utf16_code_units(
    value: object, expected: str | None
) -> None:
    assert clean_text(value) == expected


def test_blank_values_are_absent() -> None:
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = " \x00 "

    assert summarize_exif(opened(jpeg(PIXELS, 90, exif=exif))).make is None


def with_app1(data: bytes, payload: bytes) -> bytes:
    """``data`` (a JPEG) with an extra APP1 segment right after SOI."""
    return data[:2] + b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload + data[2:]


@pytest.mark.parametrize(
    "payload",
    [
        b"Exif\x00\x00MM\x00\x2a\x00\x00\x00\x08\xff\xff" + b"\x01" * 40,
        b"Exif\x00\x00garbage-garbage",
    ],
    ids=["entry-count-overflow", "not-tiff"],
)
def test_exif_that_cannot_be_parsed_reads_as_absent(payload: bytes) -> None:
    source = read_upload(with_app1(jpeg(PIXELS, 90), payload))

    assert source is not None
    assert source.exif == NOTHING
