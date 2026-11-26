"""onnxruntime sessions for the text models, loaded lazily and shared between threads.

A session is created on first use, so the service starts and serves ``/health`` before the
weights are fetched, and weights fetched later are picked up without a restart. A missing or
unreadable file raises :class:`~openverify_vision.faces.ModelNotAvailableError`; an error while
a loaded model runs propagates unchanged (an inference failure, not a missing model).
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Protocol

import numpy as np
import onnxruntime as ort  # type: ignore[import-untyped]  # ships without type information
from numpy.typing import NDArray

from openverify_vision.faces import FETCH_MODELS_HINT, ModelNotAvailableError


def _create_session(path: str) -> Any:
    """An onnxruntime CPU session over the file at ``path``.

    Logging stays at errors only, every graph optimisation is on, and the CPU memory arena is
    off (as RapidOCR configures it): text lines vary in width, and an arena sized for the widest
    batch would keep that memory for the life of the process.
    """
    options = ort.SessionOptions()
    options.log_severity_level = 3
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.enable_cpu_mem_arena = False
    return ort.InferenceSession(path, sess_options=options, providers=["CPUExecutionProvider"])


class InferenceModel(Protocol):
    """A model that maps one input batch to its first output."""

    def load(self) -> None: ...

    def run(self, batch: NDArray[np.float32]) -> NDArray[np.float32]: ...


class OnnxModel:
    """One ONNX file run on the CPU; thread-safe (onnxruntime sessions run concurrently)."""

    def __init__(self, path: Path, *, name: str) -> None:
        self._path = path
        self._name = name
        self._session: Any = None
        self._input_name = ""
        self._lock = threading.Lock()

    @property
    def is_loaded(self) -> bool:
        return self._session is not None

    def load(self) -> None:
        """Create the session now (it is otherwise created on first use). Safe to repeat."""
        with self._lock:
            self._load()

    def run(self, batch: NDArray[np.float32]) -> NDArray[np.float32]:
        """The model's first output for ``batch``, as float32."""
        session = self._session
        if session is None:
            with self._lock:
                session = self._load()
        outputs = session.run(None, {self._input_name: batch})
        return np.asarray(outputs[0], dtype=np.float32)

    def _load(self) -> Any:
        if self._session is None:
            if not self._path.is_file():
                raise ModelNotAvailableError(
                    f"{self._name} model not found at {self._path}; {FETCH_MODELS_HINT}"
                )
            try:
                session = _create_session(str(self._path))
            except Exception as exc:  # onnxruntime's load errors derive from Exception directly
                raise ModelNotAvailableError(
                    f"cannot load {self._name} model {self._path}: {exc}"
                ) from exc
            self._input_name = session.get_inputs()[0].name
            self._session = session
        return self._session
