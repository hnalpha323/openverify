"""Write the golden C6 and C32.1 vision fixtures to ``contracts/fixtures/vision/``.

The embeddings are seeded pseudo-random unit vectors, never features of a real face. They
are built so that the selfie's center face matches the ID portrait at a cosine similarity of
exactly :data:`ID_SELFIE_COSINE` (above SFace's 0.363 threshold) and the ``embed-face`` face
does not, at :data:`NON_MATCH_COSINE`. Quality numbers and boxes are plausible made-up values.

The C32.1 measurements describe a card of the fictional issuer Utopia (``UTO``) for a fictional
holder, :data:`HOLDER`; its MRZ is built with valid check digits by ``icao_mrz``. The barcode
fixture is a barcode-only image (C36) whose AAMVA-shaped payload names a fictional person and
carries the synthetic-data marker subfile. No real person, document or jurisdiction design is
described.

Usage (then format with Prettier, which owns JSON layout in this repo)::

    uv run python tools/make_contract_fixtures.py
    pnpm exec prettier --write contracts/fixtures/vision/*.json
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import struct
import zlib
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Any, Final

import cv2
import numpy as np

from icao_mrz import Td1Data, td1_lines
from openverify_vision.background import MAX_COMPARE_LONG_SIDE
from openverify_vision.page_count import page_count_limits
from openverify_vision.schemas import (
    EMBEDDING_DIMENSIONS,
    JPEG2000_MAX_PIXELS,
    PORTRAIT_MAX_SIDE_PX,
    RENDER_MAX_SIDE_PX,
    DocumentAnalysis,
    FaceEmbeddingResult,
    GovernmentIdAnalysis,
    Rendition,
    SelfieAnalysis,
    VisionPngLimits,
)

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
FIXTURE_DIR: Final = REPO_ROOT / "contracts" / "fixtures" / "vision"

ID_SELFIE_COSINE: Final = 0.72
"""Cosine similarity between the ID portrait and the selfie center face (a match)."""

NON_MATCH_COSINE: Final = 0.05
"""Cosine similarity between the ID portrait and the ``embed-face`` face (not a match)."""

_DECIMALS: Final = 8
_VERSIONS: Final = {"detector": "yunet-2026may", "recognizer": "sface-2021dec"}
_GOVERNMENT_ID_VERSIONS: Final = {
    **_VERSIONS,
    "text_detector": "pp-ocrv6-small-det",
    "text_recognizer": "pp-ocrv6-small-rec",
}

HOLDER: Final = Td1Data(
    document_code="I",
    issuing_state="UTO",
    document_number="X12K45P78",
    birth_date=date(1990, 2, 14),
    sex="F",
    expiry_date=date(2034, 2, 28),
    nationality="UTO",
    surname="VALEMONT",
    given_names="QUINN",
)
"""The fictional holder of the fixture card (not an ICAO example person)."""

SYNTHETIC_MARKER: Final = "OPENVERIFY SYNTHETIC TEST DATA"
"""Value of the marker element of every synthetic AAMVA payload (C36)."""


def _unit(vector: np.ndarray[Any, np.dtype[np.float64]]) -> np.ndarray[Any, np.dtype[np.float64]]:
    return vector / float(np.linalg.norm(vector))


def _rounded(vector: np.ndarray[Any, np.dtype[np.float64]]) -> list[float]:
    return [round(float(v), _DECIMALS) for v in vector]


def _gaussian(seed: int) -> np.ndarray[Any, np.dtype[np.float64]]:
    return np.random.default_rng(seed).standard_normal(EMBEDDING_DIMENSIONS)


def synthetic_unit_vector(seed: int) -> list[float]:
    """A deterministic pseudo-random 128-float unit vector."""
    return _rounded(_unit(_gaussian(seed)))


def _at_cosine(anchor_seed: int, seed: int, cosine: float) -> list[float]:
    """A unit vector at exactly ``cosine`` to ``synthetic_unit_vector(anchor_seed)``."""
    anchor = _unit(_gaussian(anchor_seed))
    noise = _gaussian(seed)
    orthogonal = _unit(noise - float(noise @ anchor) * anchor)
    return _rounded(cosine * anchor + math.sqrt(1.0 - cosine * cosine) * orthogonal)


def _quality(blur: float, glare: float, brightness: float) -> dict[str, Any]:
    return {
        "blur_score": blur,
        "is_blurry": False,
        "glare_ratio": glare,
        "has_glare": False,
        "brightness": brightness,
        "is_too_dark": False,
        "is_too_bright": False,
    }


def _face(bbox: list[float], score: float, embedding: list[float] | None = None) -> dict[str, Any]:
    face: dict[str, Any] = {"bbox": bbox, "score": score}
    if embedding is not None:
        face["embedding"] = embedding
    return face


def _quad(width: float, height: float) -> list[list[float]]:
    """A slightly skewed card outline inside a ``width`` x ``height`` upload."""
    return [[8.0, 6.5], [width - 8.5, 9.0], [width - 11.0, height - 7.5], [6.5, height - 11.0]]


def _document(width: int, height: int) -> dict[str, Any]:
    return {
        "found": True,
        "quad": _quad(1024.0, 648.0),
        "method": "contour",
        "rectified_size": [width, height],
        "aspect_ratio": 1.5862,
        "area_ratio": 0.9488,
    }


def _not_found() -> dict[str, Any]:
    return {
        "found": False,
        "quad": None,
        "method": "none",
        "rectified_size": None,
        "aspect_ratio": None,
        "area_ratio": None,
    }


def _document_quality(blur: float, tenengrad: float, portrait: float | None) -> dict[str, Any]:
    return {
        "blur_score": blur,
        "tenengrad": tenengrad,
        "width_px": 1012,
        "height_px": 638,
        "glare_ratio_text": 0.0021,
        "glare_ratio_portrait": portrait,
    }


def _line(text: str, box: list[float], confidence: float, stroke: float | None) -> dict[str, Any]:
    return {
        "text": text,
        "confidence": confidence,
        "box": box,
        "stroke_width_mean": stroke,
        "stroke_width_cv": None if stroke is None else 0.14,
    }


def _no_mrz() -> dict[str, Any]:
    return {"found": False, "format_guess": None, "lines": [], "line_confidences": [], "box": None}


def _forensics(portrait_boundary: float | None, *, jpeg: bool = True) -> dict[str, Any]:
    return {
        "exif": {"software": None, "make": None, "model": None, "has_gps": False},
        "jpeg": (
            {"quality_estimate": 92, "standard_tables": True, "double_compression_score": 0.031}
            if jpeg
            else None
        ),
        "ela_score": 0.042,
        "moire_score": 0.013,
        "screen_grid_score": 0.008,
        "chroma": {"mean_saturation": 0.284, "colorfulness": 38.72},
        "color_cast_score": 0.021,
        "copy_move_score": 0.0,
        "portrait_boundary_score": portrait_boundary,
        "star_glyph": {"found": False, "score": 0.012, "box": None},
    }


def aamva_payload(iin: str, subfiles: Sequence[tuple[str, Sequence[str]]]) -> str:
    """An AAMVA DL/ID payload in the Annex D layout (version 10, jurisdiction version 00).

    Header: ``@``, LF, RS, CR, ``ANSI ``, the IIN, the AAMVA and jurisdiction versions and
    the number of entries; then one designator per subfile (type, 4-digit offset from the
    start of the file, 4-digit length counting its type and its CR terminator); then each
    subfile: its type, its elements separated by LF, a CR.
    """
    bodies = [kind + "\n".join(elements) + "\r" for kind, elements in subfiles]
    header = f"@\n\x1e\rANSI {iin}1000{len(subfiles):02d}"
    offset = len(header) + 10 * len(subfiles)
    designators = ""
    for (kind, _elements), body in zip(subfiles, bodies, strict=True):
        designators += f"{kind}{offset:04d}{len(body):04d}"
        offset += len(body)
    return header + designators + "".join(bodies)


BARCODE_PAYLOAD: Final = aamva_payload(
    "636014",
    [
        (
            "DL",
            [
                "DAQY9876543",
                "DCSTESTWORTH",
                "DACJORDAN",
                "DADNONE",
                "DBB02141990",
                "DBA02142031",
                "DBD02142023",
                "DBC2",
                "DCGUSA",
            ],
        ),
        ("ZC", [f"ZCA{SYNTHETIC_MARKER}"]),
    ],
)
"""A fictional person's licence-shaped payload, marked synthetic (C36). It decodes, but no
jurisdiction issued it."""


_ID_PORTRAIT_SEED: Final = 1001
_SELFIE_SEED: Final = 1002
_LEFT_SEED: Final = 1003
_OTHER_SEED: Final = 1004
_CHIP_SEED: Final = 1005


# C41.1 selfie v2: seeded synthetic measurements (no real face's landmarks or background).
_IMAGE = {"width": 640, "height": 480}


def _landmarks(box: list[float], yaw_ratio: float) -> list[list[float]]:
    """Five synthetic YuNet points inside ``box`` whose de-rolled yaw ratio is ``yaw_ratio``."""
    x, y, w, h = box
    eye_y, mouth_y = y + 0.38 * h, y + 0.78 * h
    right_eye, left_eye = x + 0.3 * w, x + 0.7 * w
    nose_x = (right_eye + left_eye) / 2 + yaw_ratio * (left_eye - right_eye)
    points = [
        (right_eye, eye_y),
        (left_eye, eye_y),
        (nose_x, y + 0.58 * h),
        (x + 0.35 * w, mouth_y),
        (x + 0.65 * w, mouth_y),
    ]
    return [[round(px, 2), round(py, 2)] for px, py in points]


def _background_layout(seed: int) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    lab = rng.uniform(0.0, 100.0, size=144)
    # The person's head and shoulders mask the lower middle cells (8 columns x 6 rows).
    masked = {(row, column) for row in range(2, 6) for column in range(2, 6)}
    valid = "".join(
        "0" if (row, column) in masked else "1" for row in range(6) for column in range(8)
    )
    return {
        "layout": [round(float(v), 3) for v in lab],
        "valid_cells": valid,
        "coverage": round(valid.count("1") / 48, 4),
    }


def _selfie_pose(  # noqa: PLR0913 - one pose's synthetic measurements
    *,
    quality: dict[str, Any],
    box: list[float],
    score: float,
    embedding: list[float],
    yaw_ratio: float,
    center: bool,
) -> dict[str, Any]:
    x, y, w, h = box
    return {
        "quality": quality,
        "faces": [{**_face(box, score), "landmarks": _landmarks(box, yaw_ratio)}],
        "face": _face(box, score, embedding),
        "image": _IMAGE,
        "face_quality": {
            "box": box,
            "width_px": w,
            "height_ratio": round(h / _IMAGE["height"], 4),
            "center_offset": [
                round((x + w / 2) / _IMAGE["width"] - 0.5, 4),
                round((y + h / 2) / _IMAGE["height"] - 0.5, 4),
            ],
            "blur_score": 186.42 if center else 171.9,
            "brightness": quality["brightness"],
            "glare_ratio": 0.0012,
        },
        "head_pose": {
            "yaw_ratio": yaw_ratio,
            "roll_deg": 1.4,
            "yaw_deg": round(yaw_ratio * 160, 1),
            "pitch_deg": 9.8,
            "method": "yunet-5pt",
        },
        "passive_liveness": {
            "v2": 0.962,
            "v1se": 0.98,
            "mean": 0.971,
            "effective_scales": {"v2": 2.44, "v1se": 2.44},
        },
        "occlusion": {
            "covering": {
                "score": 0.08,
                "skin_fraction_ratio": 0.97,
                "texture_ratio": 1.04,
                "delta_e": 3.1,
                "forehead_valid": True,
            },
            "glasses": {
                "score": 0.11,
                "rim_edge_energy": 0.042,
                "lens_highlight_ratio": 0.0,
                "bridge_edge_density": 0.031,
            },
        },
        "synthetic": {
            "spectral_tail_deviation": 0.12,
            "residual_peak_ratio": 1.8,
            "noise_inconsistency": 0.09,
            "jpeg_grid_misalignment": 0.0,
            "canonical_landmark_distance": 0.07,
            "digital_source_type": None,
        },
        "background": _background_layout(_SELFIE_SEED) if center else None,
    }


# --- C46.1: the YuNet decode fixture -------------------------------------------------------------
#
# The web flow runs YuNet in the browser and decodes its outputs (anchors, scores, NMS) in
# TypeScript. This fixture holds the model's raw outputs on one small image and the faces
# OpenCV's FaceDetectorYN finds on it. The image is a drawn synthetic face, never a photograph:
# no real person's landmarks enter git through this fixture or any other this tool writes.
# The one file that does hold a detector's numbers on a photograph is
# contracts/fixtures/flow/yunet-face-frame-vectors.json (tests/test_android_yunet_vectors.py,
# Phase 10 Workflow 10E): one box, five landmarks and a yaw ratio on the public-domain portrait
# person_a_id of fixtures/manifest.json, which the plan's 10E acceptance asks for. Whether such
# numbers of a public-domain portrait may stay in git is the owner's decision (review E002,
# carried in docs/PROGRESS.md); no other photograph's numbers are added meanwhile.

YUNET_DECODE_STRIDES: Final = (8, 16, 32)
DEFAULT_YUNET: Final = (
    Path(__file__).resolve().parents[3] / "models" / "face_detection_yunet_2026may.onnx"
)
YUNET_DECODE_SIZE: Final = (160, 120)
YUNET_DECODE_SCORE_THRESHOLD: Final = 0.6
YUNET_DECODE_NMS_THRESHOLD: Final = 0.3
_YUNET_OUTPUT_DIGITS: Final = 6


def synthetic_face_image() -> Any:
    """A drawn face (skin ellipse, hair, eyes, nose, mouth) at 160 x 120, BGR uint8."""
    width, height = 320, 240
    image = np.full((height, width, 3), (200, 190, 180), dtype=np.uint8)
    cv2.rectangle(image, (0, 170), (width, height), (90, 80, 70), -1)
    cv2.ellipse(image, (160, 70), (62, 48), 0, 180, 360, (40, 50, 70), -1)
    cv2.ellipse(image, (160, 115), (52, 66), 0, 0, 360, (140, 170, 215), -1)
    for x in (138, 182):
        cv2.ellipse(image, (x, 100), (11, 6), 0, 0, 360, (255, 255, 255), -1)
        cv2.circle(image, (x, 100), 5, (50, 40, 30), -1)
        cv2.ellipse(image, (x, 90), (13, 3), 0, 180, 360, (40, 40, 50), 2)
    nose = np.array([[160, 105], [152, 130], [168, 130]], dtype=np.int32)
    cv2.polylines(image, [nose], isClosed=False, color=(110, 130, 170), thickness=2)
    cv2.ellipse(image, (160, 150), (18, 6), 0, 0, 180, (80, 80, 170), 3)
    blurred = cv2.GaussianBlur(image, (0, 0), 1.2)
    return cv2.resize(blurred, YUNET_DECODE_SIZE, interpolation=cv2.INTER_AREA)


def _padded(size: int) -> int:
    return (size + 31) // 32 * 32


def _nms(faces: list[dict[str, Any]], threshold: float) -> list[dict[str, Any]]:
    def iou(a: list[float], b: list[float]) -> float:
        x1, y1 = max(a[0], b[0]), max(a[1], b[1])
        x2, y2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
        inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        union = a[2] * a[3] + b[2] * b[3] - inter
        return inter / union if union > 0 else 0.0

    kept: list[dict[str, Any]] = []
    for face in sorted(faces, key=lambda f: f["score"], reverse=True):
        if all(iou(face["box"], other["box"]) <= threshold for other in kept):
            kept.append(face)
    return kept


def decode_yunet(
    outputs: dict[str, list[float]],
    *,
    padded_size: tuple[int, int],
    score_threshold: float,
    nms_threshold: float,
) -> list[dict[str, Any]]:
    """The reference decoder: per stride, anchor ``(row, col)`` scores ``sqrt(cls * obj)``
    (each clamped to [0, 1]); the box centre is ``(col + dx, row + dy) * stride`` and its size
    ``exp(dw, dh) * stride``; landmarks are ``(col + kx, row + ky) * stride``. Then greedy NMS."""
    width, height = padded_size
    faces: list[dict[str, Any]] = []
    for stride in YUNET_DECODE_STRIDES:
        cols, rows = width // stride, height // stride
        cls, obj = outputs[f"cls_{stride}"], outputs[f"obj_{stride}"]
        bbox, kps = outputs[f"bbox_{stride}"], outputs[f"kps_{stride}"]
        for index in range(rows * cols):
            score = math.sqrt(min(max(cls[index], 0.0), 1.0) * min(max(obj[index], 0.0), 1.0))
            if score < score_threshold:
                continue
            row, col = divmod(index, cols)
            dx, dy, dw, dh = bbox[index * 4 : index * 4 + 4]
            w, h = math.exp(dw) * stride, math.exp(dh) * stride
            cx, cy = (col + dx) * stride, (row + dy) * stride
            points = kps[index * 10 : index * 10 + 10]
            faces.append(
                {
                    "box": [cx - w / 2, cy - h / 2, w, h],
                    "landmarks": [
                        [(col + points[2 * k]) * stride, (row + points[2 * k + 1]) * stride]
                        for k in range(5)
                    ],
                    "score": score,
                }
            )
    return _nms(faces, nms_threshold)


def yunet_decode_fixture(model: Path) -> dict[str, Any]:
    """Run YuNet (onnxruntime) and OpenCV's FaceDetectorYN on the synthetic face."""
    import onnxruntime  # type: ignore[import-untyped]  # noqa: PLC0415 - a fixture-time dependency

    onnxruntime.disable_telemetry_events()
    image = synthetic_face_image()
    width, height = YUNET_DECODE_SIZE
    padded = np.zeros((_padded(height), _padded(width), 3), dtype=np.float32)
    padded[:height, :width] = image
    blob = padded.transpose(2, 0, 1)[np.newaxis]
    session = onnxruntime.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    names = [output.name for output in session.get_outputs()]
    raw = dict(zip(names, session.run(None, {"input": blob}), strict=True))
    outputs = {
        name: [float(f"{v:.{_YUNET_OUTPUT_DIGITS}g}") for v in np.asarray(raw[name]).ravel()]
        for name in sorted(raw)
    }
    detector = cv2.FaceDetectorYN.create(
        str(model), "", (width, height), YUNET_DECODE_SCORE_THRESHOLD, YUNET_DECODE_NMS_THRESHOLD
    )
    _, found = detector.detect(image)
    rows: list[Any] = (
        [] if found is None else list(np.asarray(found, dtype=np.float64).reshape(-1, 15))
    )
    ok, png = cv2.imencode(".png", image)
    if not ok:  # pragma: no cover - encoding a small uint8 image cannot fail
        raise RuntimeError("could not encode the synthetic face")
    return {
        "description": (
            "C46.1: YuNet (face_detection_yunet_2026may) on a drawn synthetic face, never a "
            "photograph. outputs are the model's raw tensors (6 significant digits), flattened "
            "row-major; expected are the faces OpenCV's FaceDetectorYN found, which a decoder "
            "must reproduce from outputs. Written by tools/make_contract_fixtures.py."
        ),
        "input": {
            "width": width,
            "height": height,
            "padded_width": _padded(width),
            "padded_height": _padded(height),
            "layout": "NCHW float32 BGR 0-255, zero-padded right and bottom to multiples of 32",
        },
        "image_png_base64": base64.b64encode(png.tobytes()).decode("ascii"),
        "score_threshold": YUNET_DECODE_SCORE_THRESHOLD,
        "nms_threshold": YUNET_DECODE_NMS_THRESHOLD,
        "outputs": outputs,
        "expected": [
            {
                "box": [round(float(v), 3) for v in row[0:4]],
                "landmarks": [
                    [round(float(row[4 + 2 * k]), 3), round(float(row[5 + 2 * k]), 3)]
                    for k in range(5)
                ],
                "score": round(float(row[14]), 4),
            }
            for row in rows
        ],
    }


# --- C60.1, C60.4: document analysis (Phase 5, Workflow 5B) ---------------------------------
#
# A water bill of the fictional Utopia Water Board to the fixture card's holder, at an invented
# street and town with an unassigned postal code (C65.1). The values are plausible made-up
# measurements, not the output of a run.

_DOCUMENT_VERSIONS: Final = {
    "text_detector": "pp-ocrv6-small-det",
    "text_recognizer": "pp-ocrv6-small-rec",
}

_BILL_LINES: Final = (
    # (text, box in the page raster, font id, size in points)
    ("UTOPIA WATER BOARD", [150.0, 160.0, 760.0, 70.0], 1, 18.0),
    ("Statement date: 30 September 2026", [150.0, 300.0, 820.0, 40.0], 0, 10.0),
    ("Account number: 4471-2208-19", [150.0, 350.0, 700.0, 40.0], 0, 10.0),
    ("QUINN VALEMONT", [150.0, 520.0, 420.0, 40.0], 0, 10.0),
    ("14 LANTERN ROW", [150.0, 570.0, 400.0, 40.0], 0, 10.0),
    ("MERIDALE UT 00000", [150.0, 620.0, 470.0, 40.0], 0, 10.0),
    ("Billing period: 01 Jul 2026 - 30 Sep 2026", [150.0, 800.0, 980.0, 40.0], 0, 10.0),
    ("Water used: 18.4 m3", [150.0, 850.0, 470.0, 40.0], 0, 10.0),
    ("Amount due: 48.20", [150.0, 900.0, 430.0, 40.0], 1, 10.0),
    ("Due date: 21 October 2026", [150.0, 950.0, 620.0, 40.0], 0, 10.0),
)

_BILL_BACK_LINES: Final = (
    ("UTOPIA WATER BOARD", [150.0, 140.0, 520.0, 48.0], 1, 12.0),
    ("How to pay your bill", [150.0, 260.0, 520.0, 40.0], 1, 10.0),
    (
        "Pay at any Utopia Water Board office before the due date.",
        [150.0, 320.0, 1380.0, 40.0],
        0,
        10.0,
    ),
    ("Page 2 of 2", [1350.0, 2080.0, 230.0, 36.0], 0, 8.0),
)


def _text_layer(
    lines: Sequence[tuple[str, list[float], int, float]],
) -> list[dict[str, Any]]:
    return [
        {
            "text": text,
            "box": box,
            "font_ids": [font],
            "font_size_pt": size,
            "visible": True,
            "hidden_reason": None,
        }
        for text, box, font, size in lines
    ]


def _ocr(
    lines: Sequence[tuple[str, list[float], int, float]], confidence: float
) -> list[dict[str, Any]]:
    return [
        {
            "text": text,
            "confidence": round(confidence - index * 0.003, 4),
            "box": [box[0] - 2.0, box[1] - 3.0, box[2] + 4.0, box[3] + 5.0],
        }
        for index, (text, box, _font, _size) in enumerate(lines)
    ]


def build_document_fixtures() -> dict[str, dict[str, Any]]:
    """The C60.1 document analyses (a born-digital PDF and a photo), the C60.4 PNG limits and
    the chip portrait's embedding (``subject=chip``)."""
    hidden = {
        # Covered by an opaque white box (C60.1 ``visible``, H10): measured, never read as text.
        "text": "Previous balance: 0.00",
        "box": [150.0, 1000.0, 520.0, 40.0],
        "font_ids": [0],
        "font_size_pt": 10.0,
        "visible": False,
        "hidden_reason": "covered",
    }
    pdf_document = {
        "model_versions": {
            **_DOCUMENT_VERSIONS,
            "pdf_renderer": "pdfium-156.0.8076.0",
            "pdf_parser": "pypdf-6.21.4",
        },
        "source": "pdf",
        "page_count": 2,
        "analysed_pages": [1, 2],
        "pages": [
            {
                "number": 1,
                "width": 1700,
                "height": 2200,
                "width_pt": 612.0,
                "height_pt": 792.0,
                "text_layer": [*_text_layer(_BILL_LINES), hidden],
                "ocr": _ocr(_BILL_LINES, 0.982),
                "text_layer_ocr_agreement": 0.9731,
            },
            {
                "number": 2,
                "width": 1700,
                "height": 2200,
                "width_pt": 612.0,
                "height_pt": 792.0,
                "text_layer": _text_layer(_BILL_BACK_LINES),
                "ocr": _ocr(_BILL_BACK_LINES, 0.976),
                "text_layer_ocr_agreement": 0.9814,
            },
        ],
        "pdf": {
            "producer": "OpenVerify synthetic PDF writer",
            "creator": "OpenVerify fixtures",
            "creation_date": "2026-09-30T09:00:00Z",
            "modification_date": "2026-09-30T09:00:00Z",
            "xmp": {
                "creator_tool": "OpenVerify fixtures",
                "producer": "OpenVerify synthetic PDF writer",
                "create_date": "2026-09-30T09:00:00Z",
                "modify_date": "2026-09-30T09:00:00Z",
                "metadata_date": "2026-09-30T09:00:00Z",
                "document_id": "uuid:00000000-0000-4000-8000-000000000001",
                "instance_id": "uuid:00000000-0000-4000-8000-000000000001",
                "history_agents": [],
            },
            "linearized": False,
            "revisions": 1,
            "xref_repaired": False,
            "eof_markers": 1,
            "bytes_after_last_eof": 0,
            "object_streams": 0,
            "fonts": [
                {"id": 0, "base_name": "Helvetica", "subset_tag": None, "embedded": False},
                {
                    "id": 1,
                    "base_name": "SyntheticSans-Bold",
                    "subset_tag": "AAAAAB",
                    "embedded": True,
                },
            ],
            "annotations": 0,
            "form_fields": 0,
            "actions": {
                "javascript": 0,
                "launch": 0,
                "submit_form": 0,
                "goto_remote": 0,
                "rich_media": 0,
                "embedded_files": 0,
            },
            "signatures": 0,
            "edits_after_signature": False,
        },
        "image": None,
    }
    photo_lines = _BILL_LINES[:6] + _BILL_LINES[8:9]
    image_document = {
        "model_versions": {**_DOCUMENT_VERSIONS, "pdf_renderer": None, "pdf_parser": None},
        "source": "image",
        "page_count": 1,
        "analysed_pages": [1],
        "pages": [
            {
                "number": 1,
                "width": 1512,
                "height": 2016,
                "width_pt": None,
                "height_pt": None,
                "text_layer": [],
                "ocr": _ocr(photo_lines, 0.941),
                "text_layer_ocr_agreement": None,
            }
        ],
        "pdf": None,
        "image": {
            "exif_software": None,
            "exif_datetime_original": "2026-10-02T18:41:07",
            "exif_datetime": "2026-10-02T18:41:07",
            "jpeg_quality": 87,
            "double_compression_score": 0.0412,
            "ela_text_cell_score": 0.0718,
            "copy_move_score": 0.0106,
        },
    }
    png_limits = {
        "media_type": "image/png",
        "render_document_page_max_side_px": RENDER_MAX_SIDE_PX,
        "convert_portrait_max_side_px": PORTRAIT_MAX_SIDE_PX,
        "mask_background_max_side_px": MAX_COMPARE_LONG_SIDE,
        "jpeg2000_max_pixels": JPEG2000_MAX_PIXELS,
    }
    embed_chip = {
        "model_versions": _VERSIONS,
        # The fixture card holder's chip portrait (240 x 320): a match of the ID portrait.
        "face": _face(
            [52.0, 61.0, 136.0, 171.0],
            0.9312,
            _at_cosine(_ID_PORTRAIT_SEED, _CHIP_SEED, ID_SELFIE_COSINE),
        ),
        "face_count": 1,
    }
    DocumentAnalysis.model_validate(pdf_document)
    DocumentAnalysis.model_validate(image_document)
    VisionPngLimits.model_validate(png_limits)
    FaceEmbeddingResult.model_validate(embed_chip)
    return {
        "analyze-document-pdf.json": pdf_document,
        "analyze-document-image.json": image_document,
        "png-limits.json": png_limits,
        "embed-face-chip.json": embed_chip,
    }


def synthetic_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """A flat PNG with no ancillary chunk, stored without compression so its bytes never drift."""

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
        )

    row = b"\x00" + bytes(rgb) * width
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row * height, 0))
        + chunk(b"IEND", b"")
    )


def _rendition_page(
    page: int, width: int, height: int, rgb: tuple[int, int, int]
) -> dict[str, Any]:
    data = synthetic_png(width, height, rgb)
    return {
        "page": page,
        "media_type": "image/png",
        "width": width,
        "height": height,
        "byte_size": len(data),
        "data_b64": base64.b64encode(data).decode("ascii"),
    }


def build_rendition_fixtures() -> dict[str, dict[str, Any]]:
    """C135.3: ``/v1/renditions`` of an image and of a two-page PDF: flat synthetic pixels only."""
    image = {
        "source": "image",
        "page_count": 1,
        "truncated": False,
        "pages": [_rendition_page(1, 4, 3, (212, 222, 236))],
    }
    pdf = {
        "source": "pdf",
        "page_count": 2,
        "truncated": False,
        "pages": [
            _rendition_page(1, 3, 4, (255, 255, 255)),
            _rendition_page(2, 3, 4, (245, 245, 245)),
        ],
    }
    Rendition.model_validate(image)
    Rendition.model_validate(pdf)
    return {"rendition-image.json": image, "rendition-pdf.json": pdf}


def build_fixtures() -> dict[str, dict[str, Any]]:
    """The fixture documents by file name, each validated against its model."""
    portrait = synthetic_unit_vector(_ID_PORTRAIT_SEED)
    front_box = [61.37, 158.04, 205.42, 275.18]
    selfie_box = [244.6, 104.25, 151.83, 203.9]
    left_box = [262.11, 110.4, 139.57, 196.32]

    mrz_lines = list(td1_lines(HOLDER))
    government_id = {
        "model_versions": _GOVERNMENT_ID_VERSIONS,
        "sides": {
            "front": {
                "quality": _quality(2214.73, 0.0013, 0.6418),
                "faces": [_face(front_box, 0.9312)],
                "portrait": _face(front_box, 0.9312, portrait),
                "document": _document(1012, 638),
                "document_quality": _document_quality(1543.21, 2876.45, 0.0),
                "text": [
                    _line("UTOPIA", [402.0, 22.0, 208.0, 38.0], 0.9921, 5.12),
                    _line("IDENTITY CARD", [376.0, 66.0, 262.0, 26.0], 0.9874, 3.41),
                    _line("SURNAME", [318.0, 148.0, 104.0, 16.0], 0.9512, 2.05),
                    _line("VALEMONT", [318.0, 170.0, 168.0, 26.0], 0.9733, 3.37),
                    _line("GIVEN NAMES", [318.0, 214.0, 140.0, 16.0], 0.9488, 2.01),
                    _line("QUINN", [318.0, 236.0, 104.0, 26.0], 0.9806, 3.29),
                    _line("DATE OF BIRTH", [318.0, 280.0, 166.0, 16.0], 0.9415, 2.08),
                    _line("14 02 1990", [318.0, 302.0, 150.0, 26.0], 0.9658, 3.31),
                    _line("DOCUMENT NO.", [318.0, 346.0, 158.0, 16.0], 0.9377, 2.04),
                    _line("X12K45P78", [318.0, 368.0, 166.0, 26.0], 0.9712, 3.35),
                    _line("EXPIRY", [636.0, 346.0, 82.0, 16.0], 0.9539, 2.02),
                    _line("28 02 2034", [636.0, 368.0, 150.0, 26.0], 0.9601, 3.33),
                    _line(
                        "OPENVERIFY SYNTHETIC TEST CARD", [262.0, 598.0, 488.0, 20.0], 0.9055, None
                    ),
                ],
                "mrz": _no_mrz(),
                "barcodes": [],
                "portrait_clarity": {
                    "face_width_px": 205.42,
                    "sharpness": 187.36,
                    "landmarks_score": 0.9312,
                },
                "forensics": _forensics(0.057),
                "phash": "c3a59e1f0b6d7248",
            },
            "back": {
                "quality": _quality(1876.05, 0.0, 0.6902),
                "faces": [],
                "portrait": None,
                "document": _document(1012, 638),
                "document_quality": _document_quality(1398.64, 2512.09, None),
                "text": [
                    _line("ADDRESS", [36.0, 40.0, 104.0, 16.0], 0.9466, 2.03),
                    _line("12 LANTERN ROW", [36.0, 62.0, 236.0, 26.0], 0.9702, 3.28),
                    _line("NORTH HAVEN", [36.0, 96.0, 190.0, 26.0], 0.9688, 3.30),
                ],
                "mrz": {
                    "found": True,
                    "format_guess": "TD1",
                    "lines": mrz_lines,
                    "line_confidences": [0.9821, 0.9753, 0.9688],
                    "box": [24.0, 452.0, 964.0, 170.0],
                },
                "barcodes": [],
                "portrait_clarity": None,
                "forensics": _forensics(None),
                "phash": "5e1f0b6d7248c3a9",
            },
        },
    }
    payload = BARCODE_PAYLOAD.encode("latin-1")
    barcode_only = {
        "model_versions": _GOVERNMENT_ID_VERSIONS,
        "sides": {
            "front": {
                "quality": _quality(1022.48, 0.0, 0.9411),
                "faces": [],
                "portrait": None,
                "document": _not_found(),
                "document_quality": None,
                "text": [],
                "mrz": _no_mrz(),
                "barcodes": [
                    {
                        "format": "PDF417",
                        "bytes_b64": base64.b64encode(payload).decode("ascii"),
                        "text": BARCODE_PAYLOAD,
                        "quad": [[96.0, 160.0], [928.0, 160.0], [928.0, 480.0], [96.0, 480.0]],
                    }
                ],
                "portrait_clarity": None,
                "forensics": _forensics(None, jpeg=False),
                "phash": None,
            },
            "back": None,
        },
    }
    selfie = {
        "model_versions": {
            **_VERSIONS,
            "anti_spoof_v2": "minifasnet-v2-2.7",
            "anti_spoof_v1se": "minifasnet-v1se-4.0",
        },
        "poses": {
            "center": _selfie_pose(
                quality=_quality(412.88, 0.0021, 0.3876),
                box=selfie_box,
                score=0.9478,
                embedding=_at_cosine(_ID_PORTRAIT_SEED, _SELFIE_SEED, ID_SELFIE_COSINE),
                yaw_ratio=-0.012,
                center=True,
            ),
            "left": _selfie_pose(
                quality=_quality(398.12, 0.0018, 0.3791),
                box=left_box,
                score=0.9104,
                embedding=synthetic_unit_vector(_LEFT_SEED),
                yaw_ratio=0.118,
                center=False,
            ),
            "right": None,
        },
        "consistency": [
            {
                "pose": "left",
                "face_cosine_to_center": 0.8813,
                "planarity": {
                    "tracked_points": 52,
                    "median_residual_ratio": 0.0094,
                    "p90_residual_ratio": 0.0261,
                },
                "registered_ssim": 0.7412,
                "raw_ssim": 0.4307,
                "duplicate_of_center": False,
            }
        ],
    }
    embed_face = {
        "model_versions": _VERSIONS,
        "face": _face(
            selfie_box, 0.9478, _at_cosine(_ID_PORTRAIT_SEED, _OTHER_SEED, NON_MATCH_COSINE)
        ),
        "face_count": 1,
    }
    GovernmentIdAnalysis.model_validate(government_id)
    GovernmentIdAnalysis.model_validate(barcode_only)
    SelfieAnalysis.model_validate(selfie)
    FaceEmbeddingResult.model_validate(embed_face)
    return {
        "analyze-government-id.json": government_id,
        "analyze-government-id-barcode.json": barcode_only,
        "analyze-selfie.json": selfie,
        "embed-face.json": embed_face,
        **build_document_fixtures(),
        **build_rendition_fixtures(),
        # Workflow 11B: the bounds of /v1/count/document-pages, from the route's own constants.
        "pdf-page-count.json": page_count_limits(),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the golden C6 vision fixtures.")
    parser.add_argument("--out", type=Path, default=FIXTURE_DIR)
    parser.add_argument("--yunet", type=Path, default=DEFAULT_YUNET, help="YuNet model (C46.1)")
    args = parser.parse_args(argv)
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    documents = build_fixtures()
    if args.yunet.is_file():
        documents["yunet-decode.json"] = yunet_decode_fixture(args.yunet)
    else:
        print(f"skipped yunet-decode.json: no model at {args.yunet}")
    for name, document in documents.items():
        (out / name).write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {out / name}")
    print("now run: pnpm exec prettier --write contracts/fixtures/vision/*.json")
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through main()
    raise SystemExit(main())
