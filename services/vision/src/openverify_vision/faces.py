"""Face detection with OpenCV Zoo's YuNet model through ``cv2.FaceDetectorYN``.

The ONNX model is fetched by ``scripts/fetch_models.py`` (see ``models/manifest.json``) and
loaded lazily on the first :meth:`FaceDetector.detect` call, so the service starts and serves
``/health`` even before the weights are present.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Protocol

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.inference import InferenceError

YUNET_FILENAME: Final = "face_detection_yunet_2026may.onnx"
"""Must match the ``face_detection_yunet`` entry in ``models/manifest.json``."""

DETECTOR_VERSION: Final = "yunet-2026may"
"""Reported as ``model_versions.detector``."""

FETCH_MODELS_HINT: Final = "run python3 scripts/fetch_models.py"

_DEFAULT_INPUT_SIZE: Final = (320, 320)

LANDMARK_NAMES: Final = (
    "right_eye",
    "left_eye",
    "nose_tip",
    "right_mouth_corner",
    "left_mouth_corner",
)
"""Order of :attr:`Face.landmarks`, as emitted by YuNet."""

_ROW_LENGTH: Final = 15  # x, y, w, h, 5 landmark (x, y) pairs, score


class ModelNotAvailableError(RuntimeError):
    """The model file is missing or cannot be loaded."""


@dataclass(frozen=True, slots=True)
class Face:
    box: tuple[float, float, float, float]
    """``(x, y, width, height)`` in pixels."""

    landmarks: tuple[tuple[float, float], ...]
    """Five ``(x, y)`` points in :data:`LANDMARK_NAMES` order."""

    score: float
    """Detector confidence in ``[0, 1]``."""

    @property
    def area(self) -> float:
        return self.box[2] * self.box[3]

    def as_row(self) -> NDArray[np.float32]:
        """The face as a 15-float YuNet row, the input ``FaceRecognizerSF.alignCrop`` expects."""
        values = [*self.box, *(v for point in self.landmarks for v in point), self.score]
        return np.asarray(values, dtype=np.float32)

    def rescaled(self, fx: float, fy: float) -> Face:
        """The same face with x coordinates multiplied by ``fx`` and y coordinates by ``fy``."""
        x, y, w, h = self.box
        return Face(
            box=(x * fx, y * fy, w * fx, h * fy),
            landmarks=tuple((px * fx, py * fy) for px, py in self.landmarks),
            score=self.score,
        )


class _YuNet(Protocol):
    def setInputSize(self, input_size: tuple[int, int], /) -> None: ...  # noqa: N802

    # OpenCV returns None instead of an array when nothing is detected.
    def detect(self, image: ImageArray, /) -> tuple[int, Any]: ...


def _create_yunet(
    *,
    model: str,
    input_size: tuple[int, int],
    score_threshold: float,
    nms_threshold: float,
    top_k: int,
) -> _YuNet:
    return cv2.FaceDetectorYN.create(model, "", input_size, score_threshold, nms_threshold, top_k)


def default_yunet_path(models_dir: Path) -> Path:
    return models_dir / YUNET_FILENAME


def _to_face(row: NDArray[np.float64]) -> Face:
    v = [float(x) for x in row]
    return Face(
        box=(v[0], v[1], v[2], v[3]),
        landmarks=tuple((v[4 + 2 * i], v[5 + 2 * i]) for i in range(len(LANDMARK_NAMES))),
        score=v[14],
    )


class FaceDetector:
    """Thread-safe, lazily loaded YuNet face detector."""

    def __init__(
        self,
        model_path: Path,
        *,
        score_threshold: float = 0.9,
        nms_threshold: float = 0.3,
        top_k: int = 5000,
    ) -> None:
        self._model_path = model_path
        self._score_threshold = score_threshold
        self._nms_threshold = nms_threshold
        self._top_k = top_k
        self._detector: _YuNet | None = None
        self._lock = threading.Lock()

    @property
    def is_loaded(self) -> bool:
        return self._detector is not None

    @property
    def score_threshold(self) -> float:
        return self._score_threshold

    def load(self) -> None:
        """Load the model now (it is otherwise loaded on first use). Safe to call repeatedly."""
        with self._lock:
            self._load(_DEFAULT_INPUT_SIZE)

    def detect(self, img: ImageArray) -> list[Face]:
        """Return every face found in a grayscale or BGR uint8 image (empty list if none).

        Raises ``InferenceError`` when YuNet cannot run on the image (1B F021).
        """
        bgr = ensure_bgr(img)
        height, width = bgr.shape[:2]
        size = (int(width), int(height))
        with self._lock:  # setInputSize + detect mutate the shared OpenCV object
            detector = self._load(size)
            try:
                detector.setInputSize(size)
                _, rows = detector.detect(bgr)
            except cv2.error as exc:
                raise InferenceError(
                    "the face detector (YuNet) could not run on the image"
                ) from exc
        if rows is None:
            return []
        table = np.asarray(rows, dtype=np.float64).reshape(-1, _ROW_LENGTH)
        return [_to_face(row) for row in table]

    def _load(self, input_size: tuple[int, int]) -> _YuNet:
        if self._detector is None:
            if not self._model_path.is_file():
                raise ModelNotAvailableError(
                    f"YuNet model not found at {self._model_path}; {FETCH_MODELS_HINT}"
                )
            try:
                self._detector = _create_yunet(
                    model=str(self._model_path),
                    input_size=input_size,
                    score_threshold=self._score_threshold,
                    nms_threshold=self._nms_threshold,
                    top_k=self._top_k,
                )
            except cv2.error as exc:
                raise ModelNotAvailableError(
                    f"cannot load YuNet model {self._model_path}: {exc}"
                ) from exc
        return self._detector
