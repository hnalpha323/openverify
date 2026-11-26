"""The service token, checked before anything reads a request's body (1B F022, C32.3).

FastAPI reads and parses a route's form body before it resolves the route's dependencies, so the
``require_service_token`` router dependency alone let an unauthenticated caller make the service
receive and spool its uploads. :class:`ServiceTokenMiddleware` checks the ``x-service-token``
header of every request routed under ``/v1`` first, with the same constant-time comparison, and
answers the same 401 problem without receiving the body. The dependency stays on the router.
"""

from __future__ import annotations

from typing import Final

from fastapi import FastAPI
from starlette.types import ASGIApp, Receive, Scope, Send

from openverify_vision.auth import SERVICE_TOKEN_HEADER, require_service_token
from openverify_vision.problems import ProblemError, problem_response
from openverify_vision.settings import Settings

PROTECTED_PREFIX: Final = "/v1"
"""Every route under this path needs the service token."""

_HEADER: Final = SERVICE_TOKEN_HEADER.encode("latin-1")


def route_path(scope: Scope) -> str:
    """The path the router matches: the request path without the mount's ``root_path``, exactly
    as Starlette's router derives it, so a guarded route cannot be reached around the guard."""
    path: str = scope["path"]
    root: str = scope.get("root_path", "")
    if not root or not path.startswith(root):
        return path
    if path == root:
        return ""
    return path[len(root) :] if path[len(root)] == "/" else path


def is_protected(path: str) -> bool:
    return path == PROTECTED_PREFIX or path.startswith(f"{PROTECTED_PREFIX}/")


def _token(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name.lower() == _HEADER:
            return str(value.decode("latin-1"))
    return None


class ServiceTokenMiddleware:
    """Refuse a ``/v1`` request without the service token before its body is received."""

    def __init__(self, app: ASGIApp, *, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not is_protected(route_path(scope)):
            await self.app(scope, receive, send)
            return
        try:
            await require_service_token(self.settings, _token(scope))
        except ProblemError as refused:
            response = problem_response(refused.status, refused.detail, headers=refused.headers)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def install_service_token_guard(app: FastAPI, settings: Settings) -> None:
    """Check the token of every ``/v1`` request before the app reads its body."""
    app.add_middleware(ServiceTokenMiddleware, settings=settings)
