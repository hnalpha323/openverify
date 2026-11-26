"""``contracts/fixtures/flow/yunet-face-frame-vectors.json`` (C205, C219.5, C221.8): what the
server's own runtime finds on the frame that ``android/openverify-face``'s tests run YuNet on.

The frame is the public-domain portrait ``person_a_id`` of ``fixtures/manifest.json`` (fetched by
``scripts/fetch_fixtures.py``, never committed), given to the detector as the Android SDK gives a
camera frame: upright, sampled to 320 pixels wide by taking the nearest source pixel, as BGR floats
in 0-255, zero-padded right and bottom to multiples of 32 (``YunetInput.kt``; ``yunet-input.ts``).
This test runs the pinned model through this service's onnxruntime, decodes with the reference
decoder that holds the web flow's rules (``decode_yunet``; ``test_yunet_decode_fixture.py`` proves
it against OpenCV), takes the yaw ratio as the web's ``head-pose.ts`` does, and holds the committed
file to the result. The file holds numbers only: sizes, scores, boxes, landmarks and one ratio, no
pixel. It is written only under ``UPDATE_CONTRACT_FIXTURES=1``.

The Android tests compare what ONNX Runtime gives on a device, and on the host JVM, with these
numbers within the file's ``tolerance``. The tolerance is wider than the 1e-9 of the decoder's own
vectors (C204.1) for a stated reason: each platform decodes the JPEG with its own decoder and runs
its own build of ONNX Runtime. It is provisional, with its measured basis in the file.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any, Final

import numpy as np
import pytest
from PIL import Image

from make_contract_fixtures import decode_yunet

REPO: Final = Path(__file__).resolve().parents[3]
VECTORS: Final = REPO / "contracts" / "fixtures" / "flow" / "yunet-face-frame-vectors.json"
MODEL_MANIFEST: Final = REPO / "models" / "manifest.json"
FIXTURE_MANIFEST: Final = REPO / "fixtures" / "manifest.json"
UPDATE: Final = os.environ.get("UPDATE_CONTRACT_FIXTURES") == "1"

MODEL_NAME: Final = "face_detection_yunet"
FACE_NAME: Final = "person_a_id"

PREVIEW_WIDTH_PX: Final = 320
"""``SelfieGuidanceConstants.PREVIEW_WIDTH_PX``: the guidance frame's width."""

SCORE_THRESHOLD: Final = 0.6
NMS_THRESHOLD: Final = 0.3
"""The decoder's candidate threshold and NMS overlap on the web and on Android (C204.1)."""

DIGITS: Final = 6
"""Significant digits kept in the file, as ``yunet-decode.json`` keeps its outputs."""

REPRODUCED_PIXELS: Final = 0.05
REPRODUCED_SCORE: Final = 1e-3
REPRODUCED_RATIO: Final = 1e-3
"""How closely a run here must reproduce the committed numbers. Not zero: a Pillow release may
ship another libjpeg-turbo, whose decoded pixels can differ in the last bit."""

TOLERANCE: Final = {
    "pixels": 0.25,
    "score": 0.005,
    "yaw-ratio": 0.005,
    "basis": (
        "Provisional. Measured on 2026-11-11 against these numbers: the host JVM's ONNX Runtime "
        "1.31.0 (Java's JPEG decoder) and ONNX Runtime's Android library on a Pixel 9 (Android "
        "17, arm64-v8a, the platform's JPEG decoder) each differed by at most 0.0005 pixels, "
        "0.000001 in the score and 0.000001 in the yaw ratio. The bound is a quarter of a "
        "guidance pixel: it leaves room for another platform's JPEG decoder, which no run has "
        "measured (one guidance pixel is 9.4 source pixels of this frame), and it is far below "
        "what would move a guidance decision (the yaw gates are tenths of a ratio)."
    ),
}


def _entry(manifest: Path, key: str, name: str) -> dict[str, Any]:
    document = json.loads(manifest.read_text(encoding="utf-8"))
    return next(entry for entry in document[key] if entry["name"] == name)


def _pinned(path: Path, sha256: str, command: str) -> Path:
    if not path.is_file():
        pytest.fail(f"{path.name} is absent: run `{command}`")
    assert hashlib.sha256(path.read_bytes()).hexdigest() == sha256, path.name
    return path


def _model() -> Path:
    entry = _entry(MODEL_MANIFEST, "models", MODEL_NAME)
    return _pinned(
        REPO / "models" / entry["filename"],
        entry["sha256"],
        f"python3 -I scripts/fetch_models.py --only {MODEL_NAME}",
    )


def _face() -> tuple[dict[str, Any], Path]:
    entry = _entry(FIXTURE_MANIFEST, "faces", FACE_NAME)
    path = _pinned(
        REPO / "fixtures" / "faces" / entry["filename"],
        entry["sha256"],
        f"python3 -I scripts/fetch_fixtures.py --only {FACE_NAME}",
    )
    return entry, path


def _padded(size: int) -> int:
    return (size + 31) // 32 * 32


def _nearest(target: int, source: int) -> np.ndarray[Any, np.dtype[np.int64]]:
    """The source index of each target pixel's centre (``YunetTensor.fill``)."""
    index = np.arange(target, dtype=np.int64)
    return ((2 * index + 1) * source) // (2 * target)


def _rounded(value: float) -> float:
    return float(f"{value:.{DIGITS}g}")


def _yaw_ratio(landmarks: list[list[float]]) -> float:
    """``head-pose.ts``: the nose's offset from the eye midpoint along the eye line, over the
    inter-ocular distance."""
    (rx, ry), (lx, ly), (nx, ny) = landmarks[0], landmarks[1], landmarks[2]
    dx, dy = lx - rx, ly - ry
    distance = math.hypot(dx, dy)
    return ((nx - (rx + lx) / 2) * dx + (ny - (ry + ly) / 2) * dy) / (distance * distance)


def compute() -> dict[str, Any]:
    """The file, from the fetched face and model."""
    import onnxruntime  # type: ignore[import-untyped]  # noqa: PLC0415 - loaded only by this test

    onnxruntime.disable_telemetry_events()
    model_entry = _entry(MODEL_MANIFEST, "models", MODEL_NAME)
    face_entry, face_path = _face()
    with Image.open(face_path) as opened:
        rgb = np.asarray(opened.convert("RGB"))
    source_height, source_width = rgb.shape[:2]
    width = min(PREVIEW_WIDTH_PX, source_width)
    height = math.floor(width * source_height / source_width + 0.5)
    sampled = rgb[_nearest(height, source_height)][:, _nearest(width, source_width)]
    padded = np.zeros((_padded(height), _padded(width), 3), dtype=np.float32)
    padded[:height, :width] = sampled[:, :, ::-1]
    blob = padded.transpose(2, 0, 1)[np.newaxis]
    session = onnxruntime.InferenceSession(str(_model()), providers=["CPUExecutionProvider"])
    names = [output.name for output in session.get_outputs()]
    raw = dict(zip(names, session.run(None, {"input": blob}), strict=True))
    outputs = {name: [float(v) for v in np.asarray(raw[name]).ravel()] for name in names}
    faces = decode_yunet(
        outputs,
        padded_size=(_padded(width), _padded(height)),
        score_threshold=SCORE_THRESHOLD,
        nms_threshold=NMS_THRESHOLD,
    )
    return {
        "format": 1,
        "description": (
            "C205, C219.5: YuNet (face_detection_yunet_2026may) through the vision service's "
            "onnxruntime on the public-domain portrait person_a_id of fixtures/manifest.json, "
            "given as the Android SDK gives a camera frame (upright, nearest-pixel sampled to 320 "
            "wide, BGR 0-255, zero-padded to multiples of 32), decoded by the web flow's rules. "
            "Numbers only, no pixel. Written by services/vision/tests/"
            "test_android_yunet_vectors.py under UPDATE_CONTRACT_FIXTURES=1 and asserted by it "
            "otherwise; android/openverify-face's host and device tests compare ONNX Runtime's "
            "result with it within tolerance."
        ),
        "model": {"name": model_entry["filename"], "sha256": model_entry["sha256"]},
        "frame": {
            "source": face_entry["name"],
            "filename": face_entry["filename"],
            "sha256": face_entry["sha256"],
            "license": face_entry["license_template"],
            "width": source_width,
            "height": source_height,
            "rotation-degrees": 0,
            "layout": "RGBA_8888",
        },
        "input": {
            "width": width,
            "height": height,
            "padded-width": _padded(width),
            "padded-height": _padded(height),
            "layout": "NCHW float32 BGR 0-255, zero-padded right and bottom to multiples of 32",
            "sampling": "nearest: source index ((2 * i + 1) * source) / (2 * target), floored",
        },
        "score-threshold": SCORE_THRESHOLD,
        "nms-threshold": NMS_THRESHOLD,
        "expected": [
            {
                "score": _rounded(face["score"]),
                "box": [_rounded(v) for v in face["box"]],
                "landmarks": [[_rounded(v) for v in point] for point in face["landmarks"]],
                "yaw-ratio": _rounded(_yaw_ratio(face["landmarks"])),
            }
            for face in faces
        ],
        "tolerance": TOLERANCE,
    }


def _committed() -> dict[str, Any]:
    if not VECTORS.is_file():
        pytest.fail(f"{VECTORS.name} is absent: run this test with UPDATE_CONTRACT_FIXTURES=1")
    return json.loads(VECTORS.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def test_the_committed_vectors_are_what_the_servers_runtime_finds_on_the_frame() -> None:
    computed = compute()
    if UPDATE:
        VECTORS.write_text(json.dumps(computed, indent=2) + "\n", encoding="utf-8")
    committed = _committed()
    assert {k: v for k, v in committed.items() if k != "expected"} == {
        k: v for k, v in computed.items() if k != "expected"
    }
    assert len(committed["expected"]) == len(computed["expected"])
    for have, want in zip(committed["expected"], computed["expected"], strict=True):
        assert have["score"] == pytest.approx(want["score"], abs=REPRODUCED_SCORE)
        assert have["box"] == pytest.approx(want["box"], abs=REPRODUCED_PIXELS)
        flat = [value for point in have["landmarks"] for value in point]
        assert flat == pytest.approx(
            [value for point in want["landmarks"] for value in point], abs=REPRODUCED_PIXELS
        )
        assert have["yaw-ratio"] == pytest.approx(want["yaw-ratio"], abs=REPRODUCED_RATIO)


def test_the_frame_shows_one_face_looking_at_the_camera() -> None:
    committed = _committed()
    assert len(committed["expected"]) == 1
    face = committed["expected"][0]
    assert face["score"] > 0.9
    # A studio portrait, facing the camera: the nose sits near the eye midpoint.
    assert abs(face["yaw-ratio"]) < 0.1
    x, y, width, height = face["box"]
    assert x >= 0
    assert y >= 0
    assert x + width <= committed["input"]["width"]
    assert y + height <= committed["input"]["height"]


def test_the_file_holds_numbers_and_names_only_never_a_pixel() -> None:
    committed = _committed()
    assert set(committed) == {
        "format",
        "description",
        "model",
        "frame",
        "input",
        "score-threshold",
        "nms-threshold",
        "expected",
        "tolerance",
    }
    assert set(committed["expected"][0]) == {"score", "box", "landmarks", "yaw-ratio"}
    assert len(committed["expected"][0]["landmarks"]) == 5
    # Nothing image-like: no base64, no long array.
    assert VECTORS.stat().st_size < 4096


def test_the_frame_is_a_public_domain_face_of_the_fixture_manifest() -> None:
    committed = _committed()
    entry = _entry(FIXTURE_MANIFEST, "faces", FACE_NAME)
    assert entry["license"] == "public-domain"
    assert committed["frame"]["sha256"] == entry["sha256"]
    assert committed["frame"]["license"].startswith("PD-USGov")
    assert committed["model"]["sha256"] == _entry(MODEL_MANIFEST, "models", MODEL_NAME)["sha256"]
