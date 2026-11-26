"""C60.1: the forensic measurements of a document photo, and the error levels of its text lines
against each other.

The photos are synthetic: lines of invented text drawn with Pillow's own font on textured paper
(C65.1); the "edited" photo has one line pasted after its own, coarser JPEG compression.
"""

from __future__ import annotations

import io

import cv2
import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from openverify_vision.document_forensics import exif_dates, measure_image
from openverify_vision.forensics.text_ela import text_cell_ela_score
from openverify_vision.imaging import decode_image
from openverify_vision.schemas import BoundingBox, DocumentImageMeasurements

LINES = (
    "UTOPIA WATER BOARD",
    "Statement date: 30 September 2026",
    "Account number: 4471-2208-19",
    "QUINN VALEMONT",
    "14 LANTERN ROW",
    "MERIDALE UT 00000",
    "Amount due: 48.20",
    "Due date: 21 October 2026",
)
PASTED = 6
"""The amount line is the one pasted in the edited photo."""


def page() -> tuple[Image.Image, list[BoundingBox]]:
    rng = np.random.default_rng(7)
    paper = rng.normal(226, 6, size=(1200, 1000, 3)).clip(0, 255).astype(np.uint8)
    image = Image.fromarray(paper, mode="RGB")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=34)
    boxes: list[BoundingBox] = []
    for index, text in enumerate(LINES):
        x, y = 80, 100 + index * 120
        draw.text((x, y), text, font=font, fill=(30, 32, 40))
        left, top, right, bottom = draw.textbbox((x, y), text, font=font)
        boxes.append((float(left), float(top), float(right - left), float(bottom - top)))
    return image, boxes


def jpeg(image: Image.Image, quality: int, **options: object) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, **options)
    return buffer.getvalue()


def edited_page() -> tuple[bytes, list[BoundingBox]]:
    """The amount line replaced by a copy of itself saved at quality 30, pasted on the photo's
    8x8 grid (the JPEG ghost sees a paste on the photo's own grid; a misaligned one shows as
    double compression instead)."""
    image, boxes = page()
    x, y, w, h = (int(v) for v in boxes[PASTED])
    left, top = (x - 16) // 8 * 8, (y - 16) // 8 * 8
    region = (left, top, left + (w + 40) // 8 * 8, top + (h + 40) // 8 * 8)
    coarse = Image.open(io.BytesIO(jpeg(image.crop(region), 30)))
    image.paste(coarse, region[:2])
    return jpeg(image, 90), boxes


def measured(data: bytes, boxes: list[BoundingBox]) -> DocumentImageMeasurements:
    found = measure_image(data, decode_image(data, max_pixels=40_000_000), boxes)
    assert found is not None
    return found


def test_a_jpeg_photo_is_measured() -> None:
    image, boxes = page()
    exif = Image.Exif()
    exif[0x0131] = "Utopia Scanner 2"
    exif[0x0132] = "2026:10:02 18:45:00"
    exif.get_ifd(0x8769)[0x9003] = "2026:10:02 18:41:07"
    exif.get_ifd(0x8769)[0x9011] = "+02:00"
    found = measured(jpeg(image, 90, exif=exif.tobytes()), boxes)
    assert found.exif_software == "Utopia Scanner 2"
    assert found.exif_datetime_original == "2026-10-02T18:41:07+02:00"
    assert found.exif_datetime == "2026-10-02T18:45:00"
    assert found.jpeg_quality == 90
    assert found.double_compression_score is not None
    assert found.double_compression_score < 0.3
    assert found.ela_text_cell_score is not None
    assert found.copy_move_score is not None


def test_a_line_pasted_from_a_coarser_jpeg_stands_out_from_the_others() -> None:
    image, boxes = page()
    genuine = measured(jpeg(image, 90), boxes).ela_text_cell_score
    data, boxes = edited_page()
    edited = measured(data, boxes).ela_text_cell_score
    assert genuine is not None
    assert edited is not None
    assert edited > genuine + 0.1


def test_a_png_photo_has_no_jpeg_measurements() -> None:
    image, boxes = page()
    buffer = io.BytesIO()
    from PIL import PngImagePlugin  # noqa: PLC0415 - only this test writes a PNG text chunk

    info = PngImagePlugin.PngInfo()
    info.add_text("Software", "Utopia Snap 1.0")
    image.save(buffer, format="PNG", pnginfo=info)
    found = measured(buffer.getvalue(), boxes)
    assert found.exif_software == "Utopia Snap 1.0"
    assert (found.jpeg_quality, found.double_compression_score) == (None, None)
    assert found.ela_text_cell_score is None
    assert found.copy_move_score is not None


def test_too_few_lines_give_no_text_cell_score() -> None:
    image, boxes = page()
    data = jpeg(image, 90)
    bgr = decode_image(data, max_pixels=40_000_000)
    assert text_cell_ela_score(bgr, boxes[:3], offset=(0, 0)) is None
    assert measured(data, boxes[:3]).ela_text_cell_score is None


def test_boxes_off_the_photo_are_ignored() -> None:
    image, _ = page()
    bgr = np.asarray(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR), dtype=np.uint8)
    far = [(5000.0, 5000.0, 100.0, 40.0)] * 8
    assert text_cell_ela_score(bgr, far, offset=(0, 0)) is None


def test_bytes_that_are_no_image_measure_nothing() -> None:
    image, _ = page()
    bgr = np.asarray(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR), dtype=np.uint8)
    assert measure_image(b"%PDF-1.7 not an image", bgr, []) is None


@pytest.mark.parametrize(
    ("original", "modified"),
    [("2026:13:45 18:41:07", None), ("not a date", None), ("2026:10:02 18:41:07", None)],
)
def test_exif_dates_that_cannot_be_read_are_none(original: str, modified: str | None) -> None:
    exif = Image.Exif()
    exif.get_ifd(0x8769)[0x9003] = original
    data = jpeg(Image.new("RGB", (64, 64)), 90, exif=exif.tobytes())
    expected = "2026-10-02T18:41:07" if original == "2026:10:02 18:41:07" else None
    assert exif_dates(data) == (expected, modified)


def test_a_photo_without_exif_has_no_dates() -> None:
    assert exif_dates(jpeg(Image.new("RGB", (64, 64)), 90)) == (None, None)
    assert exif_dates(b"not an image") == (None, None)
