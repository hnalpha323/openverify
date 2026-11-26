"""Internal service-to-service authentication via a shared ``x-service-token`` header."""

from __future__ import annotations

import hashlib
import hmac
from http import HTTPStatus
from typing import Annotated, Final

from fastapi import Depends, Header

from openverify_vision.problems import ProblemError
from openverify_vision.settings import Settings, get_settings

SERVICE_TOKEN_HEADER: Final = "x-service-token"  # noqa: S105 - header name, not a secret


def _digest(value: str) -> bytes:
    # Comparing fixed-length digests keeps compare_digest constant-time and hides token length.
    return hashlib.sha256(value.encode("utf-8")).digest()


async def require_service_token(
    settings: Annotated[Settings, Depends(get_settings)],
    token: Annotated[str | None, Header(alias=SERVICE_TOKEN_HEADER)] = None,
) -> None:
    """Reject the request with 401 unless it carries the configured service token."""
    supplied = _digest(token or "")
    expected = _digest(settings.service_token.get_secret_value())
    if not hmac.compare_digest(supplied, expected):
        raise ProblemError(HTTPStatus.UNAUTHORIZED, "missing or invalid service token")
