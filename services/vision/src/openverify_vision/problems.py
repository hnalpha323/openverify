"""RFC 9457 ``application/problem+json`` error responses."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, Final

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from openverify_vision.schemas import NOT_IMPLEMENTED

PROBLEM_JSON: Final = "application/problem+json"

logger = logging.getLogger(__name__)


class ProblemError(Exception):
    """Raise from a route to return a problem+json response with ``status`` and ``detail``,
    and a machine-readable ``code`` member when one is given (C60.1)."""

    def __init__(
        self,
        status: int,
        detail: str,
        *,
        headers: Mapping[str, str] | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.headers = headers
        self.code = code


def problem_response(
    status: int,
    detail: str | None = None,
    *,
    headers: Mapping[str, str] | None = None,
    extra: Mapping[str, Any] | None = None,
) -> JSONResponse:
    """Build a problem document. ``type`` is ``about:blank``, so ``title`` is the status phrase."""
    title = HTTPStatus(status).phrase
    body: dict[str, Any] = {"type": "about:blank", "title": title, "status": int(status)}
    if detail and detail != title:
        body["detail"] = detail
    if extra:
        body.update(extra)
    return JSONResponse(body, status_code=status, headers=headers, media_type=PROBLEM_JSON)


async def _problem_error(_request: Request, exc: Exception) -> Response:
    if not isinstance(exc, ProblemError):  # pragma: no cover - registered for ProblemError only
        raise exc
    extra = None if exc.code is None else {"code": exc.code}
    return problem_response(exc.status, exc.detail, headers=exc.headers, extra=extra)


async def _http_exception(_request: Request, exc: Exception) -> Response:
    if not isinstance(exc, HTTPException):  # pragma: no cover - registered for HTTPException only
        raise exc
    return problem_response(exc.status_code, exc.detail, headers=exc.headers)


async def _validation_error(_request: Request, exc: Exception) -> Response:
    if not isinstance(exc, RequestValidationError):  # pragma: no cover - registered for it only
        raise exc
    # Only location, message and type: never echo submitted input back to the caller.
    errors = [
        {"loc": list(error.get("loc", ())), "msg": error.get("msg", ""), "type": error.get("type")}
        for error in exc.errors()
    ]
    return problem_response(
        HTTPStatus.UNPROCESSABLE_ENTITY,
        "request validation failed",
        extra={"errors": errors},
    )


async def _not_implemented(_request: Request, exc: Exception) -> Response:
    if not isinstance(exc, NotImplementedError):  # pragma: no cover - registered for it only
        raise exc
    return problem_response(
        HTTPStatus.NOT_IMPLEMENTED,
        "this analysis is not built yet",
        extra={"code": NOT_IMPLEMENTED},
    )


async def _unhandled(request: Request, exc: Exception) -> Response:
    logger.error(
        "unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path, exc_info=exc
    )
    return problem_response(HTTPStatus.INTERNAL_SERVER_ERROR, "internal server error")


def install_problem_handlers(app: FastAPI) -> None:
    """Make every error response from ``app`` a problem+json document."""
    app.add_exception_handler(ProblemError, _problem_error)
    app.add_exception_handler(HTTPException, _http_exception)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(NotImplementedError, _not_implemented)
    app.add_exception_handler(Exception, _unhandled)
