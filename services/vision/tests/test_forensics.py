"""``forensics/``: the C32.1 forensic measurements of one side, composed.

``analyze_forensics`` reads the original bytes for what the decode drops (EXIF, JPEG tables, the
block grid), measures compression history on the upload, the pixel grid on the document's region
of the upload, and everything about the document itself (moire, colour, copy-move, the portrait
frame, the REAL ID star) on the rectified document when one was found, else on the upload.
Images are synthetic (``forensic_scenes.py``).
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest
from PIL import ExifTags, Image

from forensic_scenes import (
    FACE,
    PORTRAIT,
    STAR_CENTRE,
    camera,
    card,
    decode,
    encode,
    full_frame,
    jpeg,
    not_found,
    on_background,
    paste,
    recompress,
    screen_recapture,
)
from openverify_vision.forensics import analyze_forensics
from openverify_vision.schemas import BoundingBox, ExifSummary, Forensics

PHOTO = camera(card(star=True))


def camera_exif() -> Image.Exif:
    exif = Image.Exif()
    exif[ExifTags.Base.Software] = "Utopia Camera Firmware 4.2"
    exif[ExifTags.Base.Make] = "Utopia Optics"
    exif[ExifTags.Base.Model] = "UO-7"
    exif[ExifTags.IFD.GPSInfo] = {
        ExifTags.GPS.GPSLatitudeRef: "N",
        ExifTags.GPS.GPSLatitude: (45.0, 30.0, 17.0),
    }
    return exif


def measured(data: bytes, portrait_box: BoundingBox | None = FACE) -> Forensics:
    image = decode(data)
    result = analyze_forensics(data, image, full_frame(image), portrait_box=portrait_box)
    assert result is not None
    assert Forensics.model_validate(result.model_dump()) == result
    return result


def test_a_photographed_card_is_measured_and_reads_as_clean() -> None:
    result = measured(jpeg(PHOTO, 85, exif=camera_exif()))

    assert result.exif == ExifSummary(
        software="Utopia Camera Firmware 4.2", make="Utopia Optics", model="UO-7", has_gps=True
    )
    assert result.jpeg is not None
    assert (result.jpeg.quality_estimate, result.jpeg.standard_tables) == (85, True)
    assert result.jpeg.double_compression_score is not None
    assert result.jpeg.double_compression_score < 0.1
    assert result.ela_score < 0.3
    assert result.moire_score < 0.2
    assert result.screen_grid_score < 0.2
    assert result.chroma.mean_saturation > 0.08
    assert result.color_cast_score < 0.35
    assert result.copy_move_score < 0.2
    assert result.portrait_boundary_score is not None
    assert result.portrait_boundary_score < 0.3
    assert result.star_glyph.found is True


def test_a_png_upload_has_no_jpeg_measurements() -> None:
    assert measured(encode(PHOTO, "PNG")).jpeg is None


def test_without_a_portrait_the_portrait_measurements_are_not_taken() -> None:
    result = measured(jpeg(PHOTO, 85), portrait_box=None)

    assert result.portrait_boundary_score is None
    assert result.ela_score == 0.0


def test_bytes_that_cannot_be_read_are_not_measured() -> None:
    assert analyze_forensics(b"not an image", PHOTO, full_frame(PHOTO), portrait_box=FACE) is None


def test_a_re_saved_upload_shows_double_compression() -> None:
    result = measured(jpeg(recompress(PHOTO, 60), 90))

    assert result.jpeg is not None
    assert result.jpeg.double_compression_score is not None
    assert result.jpeg.double_compression_score > 0.15


def test_a_spliced_portrait_shows_in_the_error_levels_and_at_its_frame() -> None:
    other = camera(card(seed=7), seed=9, noise=7.0)
    spliced = paste(recompress(PHOTO, 60), other, PORTRAIT)

    result = measured(jpeg(spliced, 90))

    assert result.ela_score > 0.5
    assert result.portrait_boundary_score is not None
    assert result.portrait_boundary_score > 0.4


def test_a_screen_recapture_shows_its_pixel_grid() -> None:
    shot = screen_recapture(PHOTO, subpixels=3, scale=1.0, angle=0.0)

    assert measured(jpeg(shot, 88), portrait_box=None).screen_grid_score > 0.5


def test_a_greyscale_photocopy_has_no_colour() -> None:
    copy = cv2.cvtColor(cv2.cvtColor(PHOTO, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)

    result = measured(jpeg(np.ascontiguousarray(copy), 88))

    assert result.chroma.mean_saturation < 0.02
    assert result.chroma.colorfulness < 2.0


def test_document_measurements_use_the_rectified_document() -> None:
    photo, document = on_background(card(star=True))
    data = jpeg(photo, 90)
    assert document.rectified is not None
    corners = np.array(document.detection.quad, dtype=np.float32)
    height, width = document.rectified.shape[:2]
    rectangle = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    to_upload = cv2.getPerspectiveTransform(rectangle, corners)
    x, y, w, h = FACE
    face_corners = np.array([[[x, y]], [[x + w, y]], [[x + w, y + h]], [[x, y + h]]], np.float32)
    on_upload = cv2.perspectiveTransform(face_corners, to_upload).reshape(-1, 2)
    left, top = on_upload.min(axis=0)
    right, bottom = on_upload.max(axis=0)

    result = analyze_forensics(
        data,
        decode(data),
        document,
        portrait_box=(float(left), float(top), float(right - left), float(bottom - top)),
    )

    assert result is not None
    # The star's box is in the rectified document's pixels, where the card's design put it.
    assert result.star_glyph.found is True
    assert result.star_glyph.box is not None
    sx, sy, sw, sh = result.star_glyph.box
    assert abs(sx + sw / 2 - STAR_CENTRE[0]) < 10
    assert abs(sy + sh / 2 - STAR_CENTRE[1]) < 10
    assert result.portrait_boundary_score is not None
    assert result.copy_move_score < 0.2


def test_without_a_document_the_upload_is_measured() -> None:
    data = jpeg(PHOTO, 90)
    image = decode(data)

    result = analyze_forensics(data, image, not_found(), portrait_box=FACE)

    assert result is not None
    assert result.star_glyph.box is not None
    sx, sy, sw, sh = result.star_glyph.box
    assert abs(sx + sw / 2 - STAR_CENTRE[0]) < 10
    assert abs(sy + sh / 2 - STAR_CENTRE[1]) < 10
    assert result.portrait_boundary_score is not None


def test_a_portrait_box_that_cannot_be_mapped_into_the_document_is_not_measured() -> None:
    photo, document = on_background(card())
    data = jpeg(photo, 90)

    result = analyze_forensics(data, decode(data), document, portrait_box=(5.0, 5.0, 40.0, 40.0))

    assert result is not None
    assert result.portrait_boundary_score is None


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(encode(np.zeros((1, 1, 3), dtype=np.uint8), "PNG"), id="1x1"),
        pytest.param(jpeg(np.full((64, 64, 3), 128, dtype=np.uint8), 90), id="uniform-64"),
        pytest.param(
            jpeg(np.full((1009, 1600, 3), (40, 90, 200), np.uint8), 90), id="uniform-1600"
        ),
        pytest.param(encode(np.full((3, 900, 3), 200, dtype=np.uint8), "PNG"), id="sliver"),
    ],
)
def test_degenerate_uploads_are_measured_without_inventing_a_signal(data: bytes) -> None:
    result = measured(data)

    assert result.ela_score == 0.0
    assert result.moire_score == 0.0
    assert result.screen_grid_score == 0.0
    assert result.color_cast_score == 0.0
    assert result.copy_move_score == 0.0
    assert result.portrait_boundary_score is None
    assert result.star_glyph.found is False


def test_a_large_upload_is_measured() -> None:
    large = np.ascontiguousarray(cv2.resize(PHOTO, (6000, 3784), interpolation=cv2.INTER_LINEAR))
    scale = 6000 / PHOTO.shape[1]
    x, y, w, h = FACE

    result = measured(jpeg(large, 85), portrait_box=(x * scale, y * scale, w * scale, h * scale))

    assert result.jpeg is not None
    assert result.jpeg.quality_estimate == 85
    assert result.star_glyph.found is True
