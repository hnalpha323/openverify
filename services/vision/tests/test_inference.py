"""1B F021 (C32.3): an inference failure answers a typed 500 problem, ``code: inference_failed``.

A model that fails on a decoded upload (YuNet, SFace, an ONNX Runtime model such as the OCR
models, or an OpenCV analysis step)
is not the generic "internal server error": the API worker retries it and, after its last
attempt, records the vision checks as ``execution_error`` (C30.3). Other failures stay generic.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from onnxruntime.capi.onnxruntime_pybind11_state import Fail, InvalidArgument, RuntimeException

from openverify_vision.analysis import FaceEngine
from openverify_vision.app import create_app
from openverify_vision.faces import Face
from openverify_vision.inference import INFERENCE_FAILED, InferenceError
from openverify_vision.schemas import EMBEDDING_DIMENSIONS
from openverify_vision.settings import Settings

from synthetic import Image, encode, make_checkerboard

TOKEN = "s" * 40
AUTH = {"x-service-token": TOKEN}
SECRET_DETAIL = "internal detail /srv/models/yunet.onnx that must not leak"

ENDPOINTS = [
    ("/v1/analyze/government-id", "front"),
    ("/v1/analyze/selfie", "center"),
    ("/v1/embed/face", "image"),
]


class RaisingDetector:
    def __init__(self, error: Callable[[], Exception]) -> None:
        self.error = error

    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        raise self.error()


class UnitRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: Image, face: Face) -> NDArray[np.float32]:
        vector = np.ones(EMBEDDING_DIMENSIONS, dtype=np.float32)
        return vector / np.linalg.norm(vector)


class NoFaces:
    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        return []


def client_with(detector: object) -> TestClient:
    settings = Settings.model_validate({"service_token": TOKEN})
    engine = FaceEngine(detector, UnitRecognizer(), long_sides=(10_000,))  # type: ignore[arg-type]
    return TestClient(create_app(settings, face_engine=engine), raise_server_exceptions=False)


def upload(field: str) -> dict[str, tuple[str, bytes, str]]:
    return {field: ("image.png", encode(make_checkerboard(), "PNG"), "image/png")}


def assert_inference_failed(response: object) -> dict[str, object]:
    assert response.status_code == 500, response.text  # type: ignore[attr-defined]
    assert response.headers["content-type"].startswith("application/problem+json")  # type: ignore[attr-defined]
    body: dict[str, object] = response.json()  # type: ignore[attr-defined]
    assert body["type"] == "about:blank"
    assert body["title"] == "Internal Server Error"
    assert body["status"] == 500
    assert body["code"] == INFERENCE_FAILED == "inference_failed"
    assert isinstance(body["detail"], str)
    assert SECRET_DETAIL not in response.text  # type: ignore[attr-defined]
    return body


@pytest.mark.parametrize(("path", "field"), ENDPOINTS)
@pytest.mark.parametrize(
    "error",
    [
        lambda: InferenceError(SECRET_DETAIL),
        lambda: cv2.error(SECRET_DETAIL),
        lambda: RuntimeException(SECRET_DETAIL),
        lambda: Fail(SECRET_DETAIL),
        lambda: InvalidArgument(SECRET_DETAIL),
    ],
    ids=["inference-error", "opencv", "onnxruntime-runtime", "onnxruntime-fail", "onnxruntime-arg"],
)
def test_a_model_failing_on_the_upload_is_a_typed_500(
    path: str, field: str, error: Callable[[], Exception]
) -> None:
    response = client_with(RaisingDetector(error)).post(path, files=upload(field), headers=AUTH)

    assert_inference_failed(response)


def test_the_failure_is_logged_with_its_kind_and_route(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.ERROR, logger="openverify_vision.inference")

    client_with(RaisingDetector(lambda: cv2.error(SECRET_DETAIL))).post(
        "/v1/embed/face", files=upload("image"), headers=AUTH
    )

    records = [r for r in caplog.records if r.name == "openverify_vision.inference"]
    assert len(records) == 1
    assert "cv2.error" in records[0].getMessage()
    assert "POST /v1/embed/face" in records[0].getMessage()


def test_other_failures_stay_the_generic_500() -> None:
    def other() -> Exception:
        return ValueError(SECRET_DETAIL)

    response = client_with(RaisingDetector(other)).post(
        "/v1/embed/face", files=upload("image"), headers=AUTH
    )

    assert response.status_code == 500
    body = response.json()
    assert "code" not in body
    assert body["detail"] == "internal server error"
    assert SECRET_DETAIL not in response.text


def test_client_errors_are_unchanged_by_the_handler() -> None:
    response = client_with(RaisingDetector(lambda: InferenceError("never reached"))).post(
        "/v1/embed/face", files={"image": ("x.png", b"not an image", "image/png")}, headers=AUTH
    )

    assert response.status_code == 415
    assert "code" not in response.json()
