"""Face analysis pipeline: multi-scale detection, overlap suppression, primary-face embedding.

YuNet misses faces wider than roughly 380 pixels of its input, so detection runs on copies
scaled to a 640- and a 320-pixel long side and the results are mapped back to source
pixels. Fake detectors and recognizers keep these tests independent of the model weights.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray

from openverify_vision.analysis import (
    DETECTION_LONG_SIDES,
    MODEL_VERSIONS,
    FaceEngine,
    analyze_image,
    iou,
)
from openverify_vision.faces import Face, ModelNotAvailableError
from openverify_vision.quality import QualityThresholds
from openverify_vision.schemas import EMBEDDING_DIMENSIONS, ModelVersions
from openverify_vision.settings import Settings

from synthetic import Image, make_checkerboard, make_uniform


def face_at(x: float, y: float, w: float, h: float, score: float = 0.95) -> Face:
    landmarks = tuple((x + w * (i + 1) / 6, y + h / 2) for i in range(5))
    return Face(box=(x, y, w, h), landmarks=landmarks, score=score)


class ScaledFakeDetector:
    """Returns faces given in normalised ``(x, y, w, h, score)``, scaled to each input."""

    def __init__(self, faces: Sequence[tuple[float, float, float, float, float]]) -> None:
        self.faces = faces
        self.sizes: list[tuple[int, int]] = []
        self.loads = 0

    def load(self) -> None:
        self.loads += 1

    def detect(self, img: Image) -> list[Face]:
        height, width = img.shape[:2]
        self.sizes.append((width, height))
        return [
            face_at(nx * width, ny * height, nw * width, nh * height, score)
            for nx, ny, nw, nh, score in self.faces
        ]


class ScriptedDetector:
    """Returns one scripted list of faces per call, in the coordinates of that call's input."""

    def __init__(self, *responses: list[Face]) -> None:
        self.responses = list(responses)
        self.sizes: list[tuple[int, int]] = []

    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        self.sizes.append((int(img.shape[1]), int(img.shape[0])))
        return self.responses.pop(0) if self.responses else []


class FakeRecognizer:
    def __init__(self) -> None:
        self.calls: list[tuple[tuple[int, ...], Face]] = []
        self.loads = 0

    def load(self) -> None:
        self.loads += 1

    def embed(self, img: Image, face: Face) -> NDArray[np.float32]:
        self.calls.append((img.shape, face))
        vector = np.arange(1, EMBEDDING_DIMENSIONS + 1, dtype=np.float32)
        return vector / np.linalg.norm(vector)


def blank(width: int, height: int) -> Image:
    return np.zeros((height, width, 3), dtype=np.uint8)


# --- multi-scale detection ------------------------------------------------------------------


def test_detection_long_sides() -> None:
    assert DETECTION_LONG_SIDES == (640, 320)


def test_large_images_are_searched_at_640_and_320_and_mapped_back() -> None:
    detector = ScaledFakeDetector([(0.25, 0.25, 0.25, 0.3, 0.95)])
    engine = FaceEngine(detector, FakeRecognizer())

    faces = engine.find_faces(blank(1280, 960))

    assert detector.sizes == [(640, 480), (320, 240)]
    assert len(faces) == 1  # the same face at both scales is reported once
    assert faces[0].box == pytest.approx((320.0, 240.0, 320.0, 288.0))
    assert faces[0].landmarks[0] == pytest.approx((320.0 + 320.0 / 6, 240.0 + 144.0))


def test_medium_images_are_searched_at_native_size_and_320() -> None:
    detector = ScaledFakeDetector([])

    FaceEngine(detector, FakeRecognizer()).find_faces(blank(500, 400))

    assert detector.sizes == [(500, 400), (320, 256)]


def test_small_images_are_never_upscaled() -> None:
    detector = ScaledFakeDetector([])

    FaceEngine(detector, FakeRecognizer()).find_faces(blank(300, 200))

    assert detector.sizes == [(300, 200)]


def test_overlapping_detections_keep_the_highest_score() -> None:
    at_640 = [face_at(100, 100, 50, 50, score=0.91)]
    at_320 = [face_at(50, 50, 25, 25, score=0.97)]  # same face, half the scale
    engine = FaceEngine(ScriptedDetector(at_640, at_320), FakeRecognizer())

    faces = engine.find_faces(blank(1280, 960))

    assert len(faces) == 1
    assert faces[0].score == 0.97
    assert faces[0].box == pytest.approx((200.0, 200.0, 100.0, 100.0))


def test_distinct_faces_are_kept_largest_first() -> None:
    small = face_at(10, 10, 20, 20)
    large = face_at(200, 100, 80, 90)
    engine = FaceEngine(ScriptedDetector([small, large]), FakeRecognizer())

    faces = engine.find_faces(blank(320, 240))

    assert [face.box for face in faces] == [large.box, small.box]


def test_degenerate_detections_are_dropped() -> None:
    engine = FaceEngine(
        ScriptedDetector([face_at(10, 10, 0, 20), face_at(50, 50, 20, 20)]), FakeRecognizer()
    )

    faces = engine.find_faces(blank(320, 240))

    assert [face.box for face in faces] == [(50, 50, 20, 20)]


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ((0, 0, 10, 10), (0, 0, 10, 10), 1.0),
        ((0, 0, 10, 10), (20, 20, 10, 10), 0.0),
        ((0, 0, 10, 10), (5, 0, 10, 10), 1 / 3),
        ((0, 0, 10, 10), (10, 0, 10, 10), 0.0),  # touching edges do not overlap
    ],
)
def test_iou(
    a: tuple[float, float, float, float], b: tuple[float, float, float, float], expected: float
) -> None:
    assert iou(a, b) == pytest.approx(expected)


# --- loading --------------------------------------------------------------------------------


def test_ensure_loaded_loads_both_models() -> None:
    detector = ScaledFakeDetector([])
    recognizer = FakeRecognizer()

    FaceEngine(detector, recognizer).ensure_loaded()

    assert (detector.loads, recognizer.loads) == (1, 1)


def test_from_settings_is_lazy_and_uses_the_models_dir(tmp_path: Path) -> None:
    settings = Settings.model_validate(
        {"service_token": "s" * 40, "models_dir": str(tmp_path), "face_score_threshold": 0.8}
    )

    engine = FaceEngine.from_settings(settings)

    assert engine.detector.score_threshold == 0.8
    with pytest.raises(ModelNotAvailableError, match=str(tmp_path)):
        engine.ensure_loaded()


def test_model_versions() -> None:
    assert ModelVersions(detector="yunet-2026may", recognizer="sface-2021dec") == MODEL_VERSIONS


# --- analyze_image --------------------------------------------------------------------------


def test_primary_face_is_the_largest_and_gets_an_embedding() -> None:
    small = face_at(10, 10, 20, 20, score=0.99)
    large = face_at(150, 60, 81.234, 90.5, score=0.9123456)
    recognizer = FakeRecognizer()
    engine = FaceEngine(ScriptedDetector([small, large]), recognizer)
    image = make_checkerboard(size=320)

    result = analyze_image(image, engine, QualityThresholds(), embed_primary=True)

    assert [face.bbox for face in result.faces] == [(150.0, 60.0, 81.23, 90.5), (10, 10, 20, 20)]
    assert result.faces[0].score == 0.9123
    assert result.primary is not None
    assert result.primary.bbox == (150.0, 60.0, 81.23, 90.5)
    assert len(result.primary.embedding) == EMBEDDING_DIMENSIONS
    assert recognizer.calls == [(image.shape, large)]


def test_primary_is_not_embedded_when_not_requested() -> None:
    recognizer = FakeRecognizer()
    engine = FaceEngine(ScriptedDetector([face_at(10, 10, 40, 40)]), recognizer)

    result = analyze_image(make_uniform(128), engine, QualityThresholds(), embed_primary=False)

    assert result.primary is None
    assert len(result.faces) == 1
    assert recognizer.calls == []


def test_no_face_means_no_primary() -> None:
    engine = FaceEngine(ScriptedDetector([]), FakeRecognizer())

    result = analyze_image(make_uniform(128), engine, QualityThresholds(), embed_primary=True)

    assert result.faces == ()
    assert result.primary is None


def test_scores_are_clamped_to_a_probability() -> None:
    engine = FaceEngine(ScriptedDetector([face_at(10, 10, 40, 40, score=1.02)]), FakeRecognizer())

    result = analyze_image(make_uniform(128), engine, QualityThresholds(), embed_primary=True)

    assert result.faces[0].score == 1.0


def test_quality_uses_the_given_thresholds() -> None:
    engine = FaceEngine(ScriptedDetector([]), FakeRecognizer())

    result = analyze_image(
        make_uniform(128),
        engine,
        QualityThresholds(brightness_min=0.99, brightness_max=1.0),
        embed_primary=True,
    )

    assert result.quality.is_too_dark is True
    assert result.quality.is_blurry is True  # a flat image has no edges at all
