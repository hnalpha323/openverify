"""YuNet face-detector wrapper.

Phase 0 has no face fixtures (public-domain faces arrive in Phase 1), so the real model is only
run on synthetic images that contain no face. Output parsing is checked with a fake detector
that returns a hand-written YuNet result row.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest

from openverify_vision import faces
from openverify_vision.faces import (
    DETECTOR_VERSION,
    LANDMARK_NAMES,
    YUNET_FILENAME,
    Face,
    FaceDetector,
    ModelNotAvailableError,
    default_yunet_path,
)
from openverify_vision.inference import InferenceError

from synthetic import gaussian_blur, make_checkerboard, make_noise, make_uniform

REPO_MODELS = Path(__file__).resolve().parents[3] / "models"
REAL_YUNET = REPO_MODELS / YUNET_FILENAME
needs_yunet = pytest.mark.skipif(
    not REAL_YUNET.is_file(),
    reason=f"{REAL_YUNET} missing; run scripts/fetch_models.py first",
)


# --- configuration --------------------------------------------------------------------------


def test_default_path_points_into_models_dir() -> None:
    assert default_yunet_path(Path("/models")) == Path("/models") / YUNET_FILENAME


def test_filename_matches_the_manifest_entry() -> None:
    manifest = json.loads((REPO_MODELS / "manifest.json").read_text())
    by_name = {entry["name"]: entry for entry in manifest["models"]}

    assert by_name["face_detection_yunet"]["filename"] == YUNET_FILENAME


def test_detector_version_is_derived_from_the_model_filename() -> None:
    assert DETECTOR_VERSION == "yunet-2026may"
    assert f"face_detection_{DETECTOR_VERSION.replace('-', '_')}.onnx" == YUNET_FILENAME


def test_landmark_order_follows_yunet() -> None:
    assert LANDMARK_NAMES == (
        "right_eye",
        "left_eye",
        "nose_tip",
        "right_mouth_corner",
        "left_mouth_corner",
    )


# --- lazy loading and failure modes ---------------------------------------------------------


def test_construction_does_not_load_the_model(tmp_path: Path) -> None:
    detector = FaceDetector(tmp_path / "absent.onnx")

    assert detector.is_loaded is False


def test_missing_model_fails_on_first_use_with_fetch_hint(tmp_path: Path) -> None:
    detector = FaceDetector(tmp_path / "absent.onnx")

    with pytest.raises(ModelNotAvailableError, match=r"fetch_models\.py"):
        detector.detect(make_uniform(128))
    assert detector.is_loaded is False


def test_corrupt_model_is_reported_as_unavailable(tmp_path: Path) -> None:
    broken = tmp_path / "broken.onnx"
    broken.write_bytes(b"this is not an onnx graph")

    with pytest.raises(ModelNotAvailableError, match=r"broken\.onnx"):
        FaceDetector(broken).detect(make_uniform(128))


def test_rejects_non_images(tmp_path: Path) -> None:
    detector = FaceDetector(tmp_path / "absent.onnx")

    with pytest.raises(ValueError, match="image"):
        detector.detect(np.zeros((8, 8), dtype=np.float32))


# --- output parsing (fake detector) ---------------------------------------------------------


class FakeYuNet:
    def __init__(self, rows: np.ndarray | None) -> None:
        self.rows = rows
        self.input_sizes: list[tuple[int, int]] = []
        self.inputs: list[np.ndarray] = []

    def setInputSize(self, size: tuple[int, int]) -> None:  # noqa: N802 - OpenCV's API name
        self.input_sizes.append(size)

    def detect(self, image: np.ndarray) -> tuple[int, np.ndarray | None]:
        self.inputs.append(image)
        return 1, self.rows


class FakeFactory:
    """Replaces ``faces._create_yunet`` and records how it was called."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, model: Path) -> None:
        self.monkeypatch = monkeypatch
        self.model = model
        self.calls: list[dict[str, Any]] = []

    def install(self, rows: np.ndarray | None) -> FakeYuNet:
        fake = FakeYuNet(rows)

        def factory(**kwargs: Any) -> FakeYuNet:
            self.calls.append(kwargs)
            return fake

        self.monkeypatch.setattr(faces, "_create_yunet", factory)
        return fake


@pytest.fixture
def fakes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> FakeFactory:
    model = tmp_path / "fake.onnx"
    model.write_bytes(b"placeholder")  # only its existence matters to the fake
    return FakeFactory(monkeypatch, model)


def test_parses_boxes_landmarks_and_scores(fakes: FakeFactory) -> None:
    row = [10, 20, 30, 40, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0.97]
    fake = fakes.install(np.array([row], dtype=np.float32))
    detector = FaceDetector(fakes.model, score_threshold=0.8, nms_threshold=0.25, top_k=50)

    found = detector.detect(make_uniform(128, height=48, width=64))

    assert len(found) == 1
    (face,) = found
    assert isinstance(face, Face)
    assert face.box == (10.0, 20.0, 30.0, 40.0)
    assert face.landmarks == ((1.0, 2.0), (3.0, 4.0), (5.0, 6.0), (7.0, 8.0), (9.0, 10.0))
    assert face.score == pytest.approx(0.97)
    assert all(isinstance(v, float) for v in (*face.box, face.score))
    assert detector.is_loaded is True
    assert fake.input_sizes == [(64, 48)]
    assert fakes.calls == [
        {
            "model": str(fakes.model),
            "input_size": (64, 48),
            "score_threshold": 0.8,
            "nms_threshold": 0.25,
            "top_k": 50,
        }
    ]


def test_parses_several_faces_in_order(fakes: FakeFactory) -> None:
    rows = np.array(
        [[0, 0, 5, 5, *range(10), 0.9], [50, 60, 7, 8, *range(10, 20), 0.95]], dtype=np.float32
    )
    fakes.install(rows)

    found = FaceDetector(fakes.model).detect(make_uniform(128))

    assert [face.box for face in found] == [(0.0, 0.0, 5.0, 5.0), (50.0, 60.0, 7.0, 8.0)]
    assert found[1].landmarks[0] == (10.0, 11.0)


def test_no_detections_is_an_empty_list(fakes: FakeFactory) -> None:
    fakes.install(None)

    assert FaceDetector(fakes.model).detect(make_uniform(128)) == []


def test_loads_once_and_resizes_per_image(fakes: FakeFactory) -> None:
    fake = fakes.install(None)
    detector = FaceDetector(fakes.model)

    detector.detect(make_uniform(128, height=10, width=20))
    detector.detect(make_uniform(128, height=30, width=40))

    assert len(fakes.calls) == 1
    assert fake.input_sizes == [(20, 10), (40, 30)]


def test_grayscale_input_is_converted_to_bgr(fakes: FakeFactory) -> None:
    fake = fakes.install(None)

    FaceDetector(fakes.model).detect(np.full((12, 16), 99, dtype=np.uint8))

    assert fake.inputs[0].shape == (12, 16, 3)


# --- inference failures (1B F021) -------------------------------------------------------------


class FailingYuNet(FakeYuNet):
    def detect(self, image: np.ndarray) -> tuple[int, np.ndarray | None]:
        raise cv2.error("OpenCV(5.0.0) dnn: (-215:Assertion failed) in function 'forward'")


def test_an_opencv_failure_while_detecting_is_an_inference_error(
    fakes: FakeFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing = FailingYuNet(None)
    monkeypatch.setattr(faces, "_create_yunet", lambda **_: failing)

    with pytest.raises(InferenceError, match="face detector") as raised:
        FaceDetector(fakes.model).detect(make_uniform(128))

    assert isinstance(raised.value.__cause__, cv2.error)
    assert isinstance(raised.value, RuntimeError)


# --- real YuNet on synthetic images without faces -------------------------------------------


@needs_yunet
@pytest.mark.parametrize(
    "image",
    [
        make_uniform(128, height=480, width=640),
        make_checkerboard(size=320),
        gaussian_blur(make_noise(height=240, width=320)),
        np.full((200, 300), 200, dtype=np.uint8),
    ],
    ids=["flat-gray", "checkerboard", "blurred-noise", "grayscale"],
)
def test_real_yunet_finds_no_face_in_synthetic_images(image: np.ndarray) -> None:
    detector = FaceDetector(REAL_YUNET)

    assert detector.detect(image) == []
    assert detector.is_loaded is True


# --- Face helpers and explicit loading ------------------------------------------------------

SAMPLE_FACE = Face(
    box=(10.0, 20.0, 30.0, 40.0),
    landmarks=((1.0, 2.0), (3.0, 4.0), (5.0, 6.0), (7.0, 8.0), (9.0, 10.0)),
    score=0.95,
)


def test_face_area() -> None:
    assert SAMPLE_FACE.area == 1200.0


def test_face_round_trips_to_a_yunet_row() -> None:
    row = SAMPLE_FACE.as_row()

    assert row.dtype == np.float32
    assert row.shape == (15,)
    assert row.tolist() == pytest.approx([10, 20, 30, 40, *range(1, 11), 0.95])


def test_face_rescaled_maps_box_and_landmarks() -> None:
    scaled = SAMPLE_FACE.rescaled(2.0, 0.5)

    assert scaled.box == (20.0, 10.0, 60.0, 20.0)
    assert scaled.landmarks[0] == (2.0, 1.0)
    assert scaled.landmarks[4] == (18.0, 5.0)
    assert scaled.score == 0.95


def test_load_creates_the_detector_once(fakes: FakeFactory) -> None:
    fakes.install(None)
    detector = FaceDetector(fakes.model)

    detector.load()
    detector.load()

    assert detector.is_loaded is True
    assert len(fakes.calls) == 1


def test_load_reports_missing_model(tmp_path: Path) -> None:
    with pytest.raises(ModelNotAvailableError, match=r"fetch_models\.py"):
        FaceDetector(tmp_path / "absent.onnx").load()
