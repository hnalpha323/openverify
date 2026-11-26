"""SFace face-embedding wrapper (``cv2.FaceRecognizerSF``): lazy loading and output handling.

Fakes cover the alignment/feature plumbing. The real model only runs on a synthetic image
with a hand-placed landmark row: it proves the ONNX graph loads and yields a 128-float unit
vector, not that it recognises anyone (the real-face tests live in ``test_real_faces.py``).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest

from openverify_vision import recognition
from openverify_vision.faces import Face, ModelNotAvailableError
from openverify_vision.inference import InferenceError
from openverify_vision.recognition import (
    EMBEDDING_SIZE,
    RECOGNIZER_VERSION,
    SFACE_FILENAME,
    FaceRecognizer,
    default_sface_path,
)

from synthetic import make_checkerboard, make_noise, make_uniform

REPO_MODELS = Path(__file__).resolve().parents[3] / "models"
REAL_SFACE = REPO_MODELS / SFACE_FILENAME
needs_sface = pytest.mark.skipif(
    not REAL_SFACE.is_file(),
    reason=f"{REAL_SFACE} missing; run python3 scripts/fetch_models.py first",
)

FACE = Face(
    box=(40.0, 40.0, 60.0, 70.0),
    landmarks=((55.0, 65.0), (85.0, 65.0), (70.0, 80.0), (58.0, 95.0), (82.0, 95.0)),
    score=0.97,
)


def test_filename_and_version_match_the_manifest() -> None:
    manifest = json.loads((REPO_MODELS / "manifest.json").read_text())
    by_name = {entry["name"]: entry for entry in manifest["models"]}

    assert by_name["face_recognition_sface"]["filename"] == SFACE_FILENAME
    assert RECOGNIZER_VERSION == "sface-2021dec"
    assert EMBEDDING_SIZE == 128


def test_default_path_points_into_models_dir() -> None:
    assert default_sface_path(Path("/models")) == Path("/models") / SFACE_FILENAME


def test_construction_does_not_load_the_model(tmp_path: Path) -> None:
    assert FaceRecognizer(tmp_path / "absent.onnx").is_loaded is False


def test_missing_model_fails_with_fetch_hint(tmp_path: Path) -> None:
    recognizer = FaceRecognizer(tmp_path / "absent.onnx")

    with pytest.raises(ModelNotAvailableError, match=r"fetch_models\.py"):
        recognizer.load()
    with pytest.raises(ModelNotAvailableError, match=r"fetch_models\.py"):
        recognizer.embed(make_uniform(128), FACE)
    assert recognizer.is_loaded is False


def test_corrupt_model_is_reported_as_unavailable(tmp_path: Path) -> None:
    broken = tmp_path / "broken.onnx"
    broken.write_bytes(b"this is not an onnx graph")

    with pytest.raises(ModelNotAvailableError, match=r"broken\.onnx"):
        FaceRecognizer(broken).load()


# --- fake SFace -----------------------------------------------------------------------------


class FakeSFace:
    def __init__(self, feature: np.ndarray) -> None:
        self.feature_value = feature
        self.align_calls: list[tuple[np.ndarray, np.ndarray]] = []
        self.feature_inputs: list[np.ndarray] = []

    def alignCrop(self, image: np.ndarray, row: np.ndarray) -> np.ndarray:  # noqa: N802
        self.align_calls.append((image, row))
        return np.zeros((112, 112, 3), dtype=np.uint8)

    def feature(self, aligned: np.ndarray) -> np.ndarray:
        self.feature_inputs.append(aligned)
        return self.feature_value


@pytest.fixture
def fake_model(tmp_path: Path) -> Path:
    model = tmp_path / "fake.onnx"
    model.write_bytes(b"placeholder")
    return model


def install(monkeypatch: pytest.MonkeyPatch, fake: FakeSFace) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def factory(**kwargs: Any) -> FakeSFace:
        calls.append(kwargs)
        return fake

    monkeypatch.setattr(recognition, "_create_sface", factory)
    return calls


def test_embedding_is_l2_normalised(monkeypatch: pytest.MonkeyPatch, fake_model: Path) -> None:
    raw = np.arange(1, EMBEDDING_SIZE + 1, dtype=np.float32).reshape(1, EMBEDDING_SIZE)
    fake = FakeSFace(raw)
    calls = install(monkeypatch, fake)

    embedding = FaceRecognizer(fake_model).embed(make_uniform(128, height=200, width=160), FACE)

    assert embedding.dtype == np.float32
    assert embedding.shape == (EMBEDDING_SIZE,)
    assert float(np.linalg.norm(embedding)) == pytest.approx(1.0, abs=1e-6)
    assert embedding.tolist() == pytest.approx((raw[0] / np.linalg.norm(raw[0])).tolist())
    assert calls == [{"model": str(fake_model)}]


def test_alignment_uses_the_bgr_image_and_the_yunet_row(
    monkeypatch: pytest.MonkeyPatch, fake_model: Path
) -> None:
    fake = FakeSFace(np.ones((1, EMBEDDING_SIZE), dtype=np.float32))
    install(monkeypatch, fake)

    FaceRecognizer(fake_model).embed(np.full((90, 120), 50, dtype=np.uint8), FACE)

    image, row = fake.align_calls[0]
    assert image.shape == (90, 120, 3)  # grayscale converted to BGR first
    assert row.tolist() == pytest.approx(FACE.as_row().tolist())
    assert len(fake.feature_inputs) == 1


def test_loads_once(monkeypatch: pytest.MonkeyPatch, fake_model: Path) -> None:
    calls = install(monkeypatch, FakeSFace(np.ones((1, EMBEDDING_SIZE), dtype=np.float32)))
    recognizer = FaceRecognizer(fake_model)

    recognizer.load()
    recognizer.embed(make_uniform(128), FACE)
    recognizer.embed(make_uniform(128), FACE)

    assert recognizer.is_loaded is True
    assert len(calls) == 1


@pytest.mark.parametrize(
    "feature",
    [
        np.ones((1, 64), dtype=np.float32),
        np.zeros((1, EMBEDDING_SIZE), dtype=np.float32),
        np.full((1, EMBEDDING_SIZE), np.nan, dtype=np.float32),
    ],
    ids=["wrong-size", "zero", "nan"],
)
def test_degenerate_features_are_errors(
    monkeypatch: pytest.MonkeyPatch, fake_model: Path, feature: np.ndarray
) -> None:
    install(monkeypatch, FakeSFace(feature))

    with pytest.raises(RuntimeError, match="embedding"):
        FaceRecognizer(fake_model).embed(make_uniform(128), FACE)


# --- inference failures (1B F021) -------------------------------------------------------------


class FailingSFace(FakeSFace):
    def __init__(self, *, fail_in: str) -> None:
        super().__init__(np.ones((1, EMBEDDING_SIZE), dtype=np.float32))
        self.fail_in = fail_in

    def alignCrop(self, image: np.ndarray, row: np.ndarray) -> np.ndarray:  # noqa: N802
        if self.fail_in == "align":
            raise cv2.error("OpenCV(5.0.0) (-215:Assertion failed) in function 'alignCrop'")
        return super().alignCrop(image, row)

    def feature(self, aligned: np.ndarray) -> np.ndarray:
        if self.fail_in == "feature":
            raise cv2.error("OpenCV(5.0.0) dnn: (-2:Unspecified error) in function 'forward'")
        return super().feature(aligned)


@pytest.mark.parametrize("fail_in", ["align", "feature"])
def test_an_opencv_failure_while_embedding_is_an_inference_error(
    monkeypatch: pytest.MonkeyPatch, fake_model: Path, fail_in: str
) -> None:
    install(monkeypatch, FailingSFace(fail_in=fail_in))

    with pytest.raises(InferenceError, match="face recognizer") as raised:
        FaceRecognizer(fake_model).embed(make_uniform(128), FACE)

    assert isinstance(raised.value.__cause__, cv2.error)


@pytest.mark.parametrize(
    "feature",
    [np.ones((1, 64), dtype=np.float32), np.zeros((1, EMBEDDING_SIZE), dtype=np.float32)],
    ids=["wrong-size", "zero"],
)
def test_a_degenerate_embedding_is_an_inference_error(
    monkeypatch: pytest.MonkeyPatch, fake_model: Path, feature: np.ndarray
) -> None:
    install(monkeypatch, FakeSFace(feature))

    with pytest.raises(InferenceError, match="embedding"):
        FaceRecognizer(fake_model).embed(make_uniform(128), FACE)


# --- real SFace on a synthetic image --------------------------------------------------------


@needs_sface
def test_real_sface_returns_a_deterministic_unit_vector() -> None:
    recognizer = FaceRecognizer(REAL_SFACE)
    image = make_noise(height=160, width=160, seed=7)

    first = recognizer.embed(image, FACE)
    second = recognizer.embed(image, FACE)

    assert first.shape == (EMBEDDING_SIZE,)
    assert float(np.linalg.norm(first)) == pytest.approx(1.0, abs=1e-5)
    assert np.array_equal(first, second)
    assert not np.array_equal(first, recognizer.embed(make_checkerboard(size=160), FACE))
