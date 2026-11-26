"""``ocr/runtime.py``: lazily loaded, thread-safe onnxruntime sessions for the text models.

The session factory is replaced by a fake, so these tests need no weights; the real files are
exercised in ``test_ocr_models.py``.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray

from openverify_vision.faces import ModelNotAvailableError
from openverify_vision.ocr import runtime
from openverify_vision.ocr.runtime import OnnxModel


class FakeInput:
    name = "x"


class FakeSession:
    def __init__(self) -> None:
        self.feeds: list[dict[str, Any]] = []

    def get_inputs(self) -> list[FakeInput]:
        return [FakeInput()]

    def run(self, outputs: Any, feeds: dict[str, Any]) -> list[NDArray[np.float32]]:
        assert outputs is None
        self.feeds.append(feeds)
        return [np.asarray(feeds["x"], dtype=np.float32) * 2, np.zeros(1, dtype=np.float32)]


@pytest.fixture
def created(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    paths: list[str] = []

    def factory(path: str) -> FakeSession:
        paths.append(path)
        return FakeSession()

    monkeypatch.setattr(runtime, "_create_session", factory)
    return paths


def test_a_missing_file_is_a_missing_model_naming_the_fetch_command(tmp_path: Path) -> None:
    model = OnnxModel(tmp_path / "absent.onnx", name="text detector")

    with pytest.raises(ModelNotAvailableError, match=r"text detector.*scripts/fetch_models\.py"):
        model.load()
    assert model.is_loaded is False


def test_a_file_onnxruntime_cannot_read_is_a_missing_model(tmp_path: Path) -> None:
    path = tmp_path / "broken.onnx"
    path.write_bytes(b"not an onnx model")

    with pytest.raises(ModelNotAvailableError, match="cannot load"):
        OnnxModel(path, name="text recognizer").load()


def test_run_loads_once_and_returns_the_first_output(tmp_path: Path, created: list[str]) -> None:
    path = tmp_path / "model.onnx"
    path.write_bytes(b"weights")
    model = OnnxModel(path, name="text detector")
    batch = np.ones((1, 3, 4, 4), dtype=np.float32)

    first = model.run(batch)
    second = model.run(batch)

    assert created == [str(path)]
    assert model.is_loaded is True
    assert first.dtype == np.float32
    assert np.all(first == 2.0)
    assert np.all(second == 2.0)


def test_concurrent_loads_create_one_session(tmp_path: Path, created: list[str]) -> None:
    path = tmp_path / "model.onnx"
    path.write_bytes(b"weights")
    model = OnnxModel(path, name="text detector")
    start = threading.Barrier(8)

    def load() -> None:
        start.wait()
        model.load()

    threads = [threading.Thread(target=load) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert created == [str(path)]


def test_weights_fetched_later_are_picked_up(tmp_path: Path, created: list[str]) -> None:
    path = tmp_path / "model.onnx"
    model = OnnxModel(path, name="text detector")
    with pytest.raises(ModelNotAvailableError):
        model.load()

    path.write_bytes(b"weights")
    model.load()

    assert model.is_loaded is True
