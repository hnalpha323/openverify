"""C32.1 government ID analysis v2: the measurements each side gains (``schemas.py``).

The API worker validates the same shapes with zod (``apps/api/src/vision/schemas.ts``); the
golden ``contracts/fixtures/vision/*.json`` exercise both. Every value here is synthetic.
"""

from __future__ import annotations

import base64
from typing import Any

import pytest
from pydantic import ValidationError

from openverify_vision.schemas import (
    MAX_BARCODES,
    MAX_MRZ_LINE_LENGTH,
    MAX_MRZ_LINES,
    MAX_TEXT_LENGTH,
    MAX_TEXT_LINES,
    DocumentDetection,
    GovernmentIdAnalysis,
    GovernmentIdModelVersions,
    SideAnalysis,
)

QUALITY: dict[str, Any] = {
    "blur_score": 412.5,
    "is_blurry": False,
    "glare_ratio": 0.001,
    "has_glare": False,
    "brightness": 0.52,
    "is_too_dark": False,
    "is_too_bright": False,
}
QUAD: list[list[float]] = [[12.0, 8.5], [1580.0, 10.0], [1578.5, 1000.0], [14.0, 998.0]]
PAYLOAD = "@\n\x1e\rANSI 636014100002DL00410046ZC00870033DLDAQY9876543\nDCSTESTWORTH\r"
MRZ = [
    "I<UTOX12K45P787<<<<<<<<<<<<<<<",
    "9002144F3402281UTO<<<<<<<<<<<2",
    "VALEMONT<<QUINN<<<<<<<<<<<<<<<",
]

EMPTY: dict[str, Any] = {
    "quality": QUALITY,
    "faces": [],
    "portrait": None,
    "document": {
        "found": False,
        "quad": None,
        "method": "none",
        "rectified_size": None,
        "aspect_ratio": None,
        "area_ratio": None,
    },
    "document_quality": None,
    "text": [],
    "mrz": {"found": False, "format_guess": None, "lines": [], "line_confidences": [], "box": None},
    "barcodes": [],
    "portrait_clarity": None,
    "forensics": None,
    "phash": None,
}

FORENSICS: dict[str, Any] = {
    "exif": {"software": None, "make": "SyntheticCam", "model": "S1", "has_gps": False},
    "jpeg": {"quality_estimate": 92, "standard_tables": True, "double_compression_score": 0.04},
    "ela_score": 0.07,
    "moire_score": 0.02,
    "screen_grid_score": 0.01,
    "chroma": {"mean_saturation": 0.31, "colorfulness": 41.2},
    "color_cast_score": 0.05,
    "copy_move_score": 0.0,
    "portrait_boundary_score": 0.12,
    "star_glyph": {"found": False, "score": 0.03, "box": None},
}

FULL: dict[str, Any] = {
    "quality": QUALITY,
    "faces": [{"bbox": [61.0, 158.0, 205.0, 275.0], "score": 0.93}],
    "portrait": None,
    "document": {
        "found": True,
        "quad": QUAD,
        "method": "contour",
        "rectified_size": [1586, 1000],
        "aspect_ratio": 1.586,
        "area_ratio": 0.91,
    },
    "document_quality": {
        "blur_score": 812.4,
        "tenengrad": 2150.7,
        "width_px": 1586,
        "height_px": 1000,
        "glare_ratio_text": 0.002,
        "glare_ratio_portrait": 0.0,
    },
    "text": [
        {
            "text": "UTOPIA",
            "confidence": 0.98,
            "box": [40.0, 30.0, 220.0, 48.0],
            "stroke_width_mean": 4.2,
            "stroke_width_cv": 0.18,
        },
        {
            "text": "VALEMONT",
            "confidence": 0.91,
            "box": [520.0, 210.0, 300.0, 40.0],
            "stroke_width_mean": None,
            "stroke_width_cv": None,
        },
    ],
    "mrz": {
        "found": True,
        "format_guess": "TD1",
        "lines": MRZ,
        "line_confidences": [0.97, 0.96, 0.95],
        "box": [30.0, 700.0, 1520.0, 260.0],
    },
    "barcodes": [
        {
            "format": "PDF417",
            "bytes_b64": base64.b64encode(PAYLOAD.encode()).decode(),
            "text": PAYLOAD,
            "quad": QUAD,
        }
    ],
    "portrait_clarity": {"face_width_px": 410.0, "sharpness": 132.5, "landmarks_score": 0.93},
    "forensics": FORENSICS,
    "phash": "0123456789abcdef",
}

VERSIONS: dict[str, Any] = {
    "detector": "yunet-2026may",
    "recognizer": "sface-2021dec",
    "text_detector": None,
    "text_recognizer": None,
}


def patched(document: dict[str, Any], path: str, value: Any) -> dict[str, Any]:
    """A deep copy of ``document`` with ``value`` at the dotted ``path``."""
    import copy  # noqa: PLC0415 - local to the helper

    copied = copy.deepcopy(document)
    node: Any = copied
    keys = path.split(".")
    for key in keys[:-1]:
        node = node[int(key)] if isinstance(node, list) else node[key]
    last = keys[-1]
    if isinstance(node, list):
        node[int(last)] = value
    else:
        node[last] = value
    return copied


def test_limits_are_the_c32_ones() -> None:
    assert (MAX_TEXT_LINES, MAX_TEXT_LENGTH) == (200, 200)
    assert (MAX_MRZ_LINES, MAX_MRZ_LINE_LENGTH, MAX_BARCODES) == (3, 64, 8)


@pytest.mark.parametrize("side", [EMPTY, FULL], ids=["nothing-found", "everything-found"])
def test_a_v2_side_round_trips_exactly(side: dict[str, Any]) -> None:
    assert SideAnalysis.model_validate(side).model_dump(mode="json") == side


def test_the_phase_1_fields_come_first_and_every_v2_field_is_required() -> None:
    assert list(SideAnalysis.model_fields)[:3] == ["quality", "faces", "portrait"]
    for field in [
        "document",
        "document_quality",
        "text",
        "mrz",
        "barcodes",
        "portrait_clarity",
        "forensics",
        "phash",
    ]:
        missing = {key: value for key, value in EMPTY.items() if key != field}
        with pytest.raises(ValidationError, match=field):
            SideAnalysis.model_validate(missing)


def test_government_id_model_versions_name_the_text_models_or_null() -> None:
    assert GovernmentIdModelVersions.model_validate(VERSIONS).text_detector is None
    named = {**VERSIONS, "text_detector": "ppocrv6-small-det", "text_recognizer": "ppocrv6-rec"}
    assert GovernmentIdModelVersions.model_validate(named).model_dump() == named
    analysis = {"model_versions": VERSIONS, "sides": {"front": FULL, "back": EMPTY}}
    assert GovernmentIdAnalysis.model_validate(analysis).model_dump(mode="json") == analysis
    with pytest.raises(ValidationError, match="text_recognizer"):
        GovernmentIdModelVersions.model_validate(
            {key: value for key, value in VERSIONS.items() if key != "text_recognizer"}
        )


@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("document.quad", QUAD[:3]),
        ("document.quad", [[1.0, 2.0, 3.0], *QUAD[1:]]),
        ("document.method", "hough"),
        ("document.method", "none"),
        ("document.rectified_size", None),
        ("document.rectified_size", [0, 1000]),
        ("document.area_ratio", 1.2),
        ("document.aspect_ratio", -1.0),
        ("document_quality.width_px", 0),
        ("document_quality.glare_ratio_text", 1.5),
        ("text.0.text", ""),
        ("text.0.text", "A" * (MAX_TEXT_LENGTH + 1)),
        ("text.0.confidence", 1.1),
        ("text.0.box", [1.0, 2.0, 0.0, 4.0]),
        ("text.0.stroke_width_cv", -0.1),
        ("text", [FULL["text"][0]] * (MAX_TEXT_LINES + 1)),
        ("mrz.lines", [*MRZ, MRZ[0]]),
        ("mrz.lines.0", "i<utox12k45p78"),
        ("mrz.lines.1", "9002144F3402281UTO?<<<<<<<<<<2"),
        ("mrz.lines.2", "<" * (MAX_MRZ_LINE_LENGTH + 1)),
        ("mrz.line_confidences", [0.97, 0.96]),
        ("mrz.line_confidences.0", 1.2),
        ("mrz.format_guess", "TD4"),
        ("barcodes.0.bytes_b64", "not base64!"),
        ("barcodes.0.format", ""),
        ("barcodes", [FULL["barcodes"][0]] * (MAX_BARCODES + 1)),
        ("portrait_clarity.landmarks_score", 1.5),
        ("forensics.exif.has_gps", None),
        ("forensics.exif.gps_latitude", 45.5),
        ("forensics.jpeg.quality_estimate", 0),
        ("forensics.ela_score", 1.5),
        ("forensics.chroma.colorfulness", -1.0),
        ("forensics.star_glyph.box", [1.0, 2.0, 3.0, 4.0]),
        ("phash", "0123456789ABCDEF"),
        ("phash", "0123456789abcde"),
        ("extra", True),
    ],
)
def test_a_side_outside_c32_is_rejected(path: str, value: Any) -> None:
    with pytest.raises(ValidationError):
        SideAnalysis.model_validate(patched(FULL, path, value))


@pytest.mark.parametrize(
    "document",
    [
        {**EMPTY["document"], "found": True},
        {**EMPTY["document"], "quad": QUAD},
        {**EMPTY["document"], "method": "contour"},
        {**FULL["document"], "found": False},
    ],
    ids=["found-without-method", "quad-without-document", "method-without-document", "lost"],
)
def test_found_matches_the_method_quad_and_size(document: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        DocumentDetection.model_validate(document)


@pytest.mark.parametrize(
    ("path", "value"),
    [
        ("mrz", {**FULL["mrz"], "found": False}),
        ("mrz", {**EMPTY["mrz"], "box": [1.0, 2.0, 3.0, 4.0]}),
        ("mrz", {**EMPTY["mrz"], "format_guess": "TD1"}),
    ],
    ids=["lines-without-mrz", "box-without-mrz", "format-without-mrz"],
)
def test_an_mrz_not_found_has_no_lines_box_or_format(path: str, value: Any) -> None:
    with pytest.raises(ValidationError):
        SideAnalysis.model_validate(patched(EMPTY, path, value))


def test_a_full_frame_document_is_the_whole_upload() -> None:
    document = {**FULL["document"], "method": "full_frame", "area_ratio": 1.0}
    assert DocumentDetection.model_validate(document).method == "full_frame"


def test_forensics_without_a_jpeg_or_portrait_have_nulls() -> None:
    side = patched(patched(FULL, "forensics.jpeg", None), "forensics.portrait_boundary_score", None)
    parsed = SideAnalysis.model_validate(side)
    assert parsed.forensics is not None
    assert parsed.forensics.jpeg is None


def test_a_star_glyph_found_has_a_positive_box() -> None:
    found = {"found": True, "score": 0.91, "box": [880.0, 24.0, 64.0, 60.0]}
    side = patched(FULL, "forensics.star_glyph", found)
    parsed = SideAnalysis.model_validate(side)
    assert parsed.forensics is not None
    assert parsed.forensics.star_glyph.found is True
    with pytest.raises(ValidationError, match="positive"):
        SideAnalysis.model_validate(
            patched(side, "forensics.star_glyph.box", [880.0, 24.0, 0.0, 60.0])
        )
