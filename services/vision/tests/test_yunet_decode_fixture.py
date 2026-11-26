"""``contracts/fixtures/vision/yunet-decode.json`` (C46.1): YuNet's raw outputs on a drawn
synthetic face, and the faces OpenCV's ``FaceDetectorYN`` found on it, for the web flow's
TypeScript decoder. A reference decoder here proves the outputs reproduce OpenCV's faces."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from make_contract_fixtures import (
    YUNET_DECODE_STRIDES,
    decode_yunet,
    synthetic_face_image,
    yunet_decode_fixture,
)
from openverify_vision.faces import YUNET_FILENAME

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE = REPO_ROOT / "contracts" / "fixtures" / "vision" / "yunet-decode.json"
YUNET = REPO_ROOT / "models" / YUNET_FILENAME


def _committed() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def test_the_fixture_names_its_input_outputs_thresholds_and_faces() -> None:
    fixture = _committed()
    assert fixture["input"] == {
        "width": 160,
        "height": 120,
        "padded_width": 160,
        "padded_height": 128,
        "layout": "NCHW float32 BGR 0-255, zero-padded right and bottom to multiples of 32",
    }
    outputs = fixture["outputs"]
    assert isinstance(outputs, dict)
    for stride in YUNET_DECODE_STRIDES:
        anchors = (160 // stride) * (128 // stride)
        assert len(outputs[f"cls_{stride}"]) == anchors
        assert len(outputs[f"obj_{stride}"]) == anchors
        assert len(outputs[f"bbox_{stride}"]) == anchors * 4
        assert len(outputs[f"kps_{stride}"]) == anchors * 10
    expected = fixture["expected"]
    assert isinstance(expected, list)
    assert len(expected) == 1
    assert "synthetic" in str(fixture["description"])


def test_the_reference_decoder_reproduces_opencvs_faces_from_the_committed_outputs() -> None:
    fixture = _committed()
    decoded = decode_yunet(
        fixture["outputs"],  # type: ignore[arg-type]
        padded_size=(160, 128),
        score_threshold=float(fixture["score_threshold"]),  # type: ignore[arg-type]
        nms_threshold=float(fixture["nms_threshold"]),  # type: ignore[arg-type]
    )
    expected = fixture["expected"]
    assert isinstance(expected, list)
    assert len(decoded) == len(expected)
    for face, want in zip(decoded, expected, strict=True):
        assert face["box"] == pytest.approx(want["box"], abs=0.05)
        flat = [value for point in face["landmarks"] for value in point]
        assert flat == pytest.approx([v for point in want["landmarks"] for v in point], abs=0.05)
        assert face["score"] == pytest.approx(want["score"], abs=1e-3)


def test_the_synthetic_face_is_drawn_not_photographed() -> None:
    image = synthetic_face_image()
    assert image.shape == (120, 160, 3)


@pytest.mark.skipif(not YUNET.is_file(), reason="fetch the model: python3 scripts/fetch_models.py")
def test_recording_again_gives_the_committed_fixture() -> None:
    assert yunet_decode_fixture(YUNET) == _committed()
