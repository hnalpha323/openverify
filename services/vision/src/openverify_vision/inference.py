"""Inference failures (1B F021, C32.3): a model or an image-analysis step that fails on a decoded
upload answers a typed 500 problem with ``code: inference_failed``, never the generic one.

The API worker retries it and, after its last attempt, records the checks that need vision as
``not_applicable`` with ``execution_error`` (C30.3). An inference failure is:

- an :class:`InferenceError`, which ``faces`` and ``recognition`` raise when a model cannot run on
  the input or returns an unusable output (other analysis modules may raise it too);
- a ``cv2.error`` (uploads are decoded with Pillow before any analysis, so a decoding failure is a
  4xx before this point);
- an error an onnxruntime session raises while running, for example in the OCR models. Its load
  errors are not among them: a model that cannot load is a 503 (``ModelNotAvailableError``).

Nothing of the failure reaches the response. The log names its type and route, never the upload or
any text read from it (C32.5).
"""

from __future__ import annotations

import logging
from http import HTTPStatus
from typing import Final

import cv2
from fastapi import FastAPI
from onnxruntime.capi.onnxruntime_pybind11_state import (  # type: ignore[import-untyped]
    DeviceReset,
    EngineError,
    EPFail,
    Fail,
    InvalidArgument,
    NotFound,
    RuntimeException,
)
from onnxruntime.capi.onnxruntime_pybind11_state import (
    NotImplemented as OrtNotImplemented,
)
from starlette.requests import Request
from starlette.responses import Response

from openverify_vision.problems import problem_response

INFERENCE_FAILED: Final = "inference_failed"
"""The problem ``code`` of an inference failure."""

INFERENCE_FAILED_DETAIL: Final = "the image analysis could not run on this upload"

logger = logging.getLogger(__name__)


class InferenceError(RuntimeError):
    """A model or an image-analysis step failed on a decoded upload."""


INFERENCE_ERRORS: Final[tuple[type[Exception], ...]] = (
    InferenceError,
    cv2.error,
    Fail,
    InvalidArgument,
    RuntimeException,
    EPFail,
    EngineError,
    DeviceReset,
    NotFound,
    OrtNotImplemented,
)
"""The exception types answered as an inference failure."""


async def _inference_failed(request: Request, exc: Exception) -> Response:
    kind = f"{type(exc).__module__}.{type(exc).__qualname__}"
    logger.error(
        "inference failed (%s) on %s %s", kind, request.method, request.url.path, exc_info=exc
    )
    return problem_response(
        HTTPStatus.INTERNAL_SERVER_ERROR,
        INFERENCE_FAILED_DETAIL,
        extra={"code": INFERENCE_FAILED},
    )


def install_inference_handlers(app: FastAPI) -> None:
    """Answer every :data:`INFERENCE_ERRORS` type raised by a route as ``inference_failed``."""
    for error in INFERENCE_ERRORS:
        app.add_exception_handler(error, _inference_failed)
