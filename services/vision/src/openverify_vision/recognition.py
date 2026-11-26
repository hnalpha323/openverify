"""Face embeddings with OpenCV Zoo's SFace model through ``cv2.FaceRecognizerSF``.

The ONNX model is fetched by ``scripts/fetch_models.py`` (see ``models/manifest.json``) and
loaded lazily, once. Embeddings are L2-normalised, so the cosine similarity the API computes
is a plain dot product. OpenCV Zoo's SFace cosine threshold for "same person" is 0.363.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Final, Protocol

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.faces import FETCH_MODELS_HINT, Face, ModelNotAvailableError
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.inference import InferenceError

SFACE_FILENAME: Final = "face_recognition_sface_2021dec.onnx"
"""Must match the ``face_recognition_sface`` entry in ``models/manifest.json``."""

RECOGNIZER_VERSION: Final = "sface-2021dec"
"""Reported as ``model_versions.recognizer``."""

EMBEDDING_SIZE: Final = 128


class _SFace(Protocol):
    def alignCrop(self, src_img: ImageArray, face_box: NDArray[np.float32], /) -> Any: ...  # noqa: N802

    def feature(self, aligned_img: Any, /) -> Any: ...


def _create_sface(*, model: str) -> _SFace:
    return cv2.FaceRecognizerSF.create(model, "")


def default_sface_path(models_dir: Path) -> Path:
    return models_dir / SFACE_FILENAME


class FaceRecognizer:
    """Thread-safe, lazily loaded SFace embedder."""

    def __init__(self, model_path: Path) -> None:
        self._model_path = model_path
        self._recognizer: _SFace | None = None
        self._lock = threading.Lock()

    @property
    def is_loaded(self) -> bool:
        return self._recognizer is not None

    def load(self) -> None:
        """Load the model now (it is otherwise loaded on first use). Safe to call repeatedly."""
        with self._lock:
            self._load()

    def embed(self, img: ImageArray, face: Face) -> NDArray[np.float32]:
        """Align ``face`` (from YuNet, in ``img`` pixels) and return its unit-length embedding.

        Raises ``InferenceError`` when SFace cannot run on the face or returns an unusable
        embedding (1B F021).
        """
        bgr = ensure_bgr(img)
        with self._lock:  # the DNN forward pass is not safe to share between threads
            recognizer = self._load()
            try:
                aligned = recognizer.alignCrop(bgr, face.as_row())
                feature = recognizer.feature(aligned)
            except cv2.error as exc:
                raise InferenceError(
                    "the face recognizer (SFace) could not run on the face"
                ) from exc
        vector = np.asarray(feature, dtype=np.float32).reshape(-1)
        if vector.shape != (EMBEDDING_SIZE,):
            raise InferenceError(f"SFace returned an embedding of shape {vector.shape}")
        norm = float(np.linalg.norm(vector))
        if not np.isfinite(norm) or norm == 0.0:
            raise InferenceError("SFace returned a degenerate embedding")
        return np.asarray(vector / norm, dtype=np.float32)

    def _load(self) -> _SFace:
        if self._recognizer is None:
            if not self._model_path.is_file():
                raise ModelNotAvailableError(
                    f"SFace model not found at {self._model_path}; {FETCH_MODELS_HINT}"
                )
            try:
                self._recognizer = _create_sface(model=str(self._model_path))
            except cv2.error as exc:
                raise ModelNotAvailableError(
                    f"cannot load SFace model {self._model_path}: {exc}"
                ) from exc
        return self._recognizer
