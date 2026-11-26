"""Request limits: body size at the ASGI layer, and how many image jobs run at once."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from http import HTTPStatus
from typing import Final

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from openverify_vision.problems import ProblemError, problem_response

BUSY_RETRY_AFTER_SECONDS: Final = 5
"""``Retry-After`` sent with a busy 503; the API worker's first retry backs off about as long."""

BUSY_DETAIL: Final = "the service is busy: too many image jobs are running or queued; retry later"


class BodySizeLimitMiddleware:
    """Reject HTTP requests whose body exceeds ``max_body_bytes`` with 413.

    A declared ``Content-Length`` over the limit is refused without reading the body. A body
    streamed without a length (chunked) is counted as it arrives and cut off once it exceeds the
    limit, which surfaces as a 413 problem through the app's exception handlers.
    """

    def __init__(
        self,
        app: ASGIApp,
        max_body_bytes: int,
        route_limits: Mapping[str, int] | None = None,
    ) -> None:
        limits = dict(route_limits or {})
        if max_body_bytes <= 0 or any(limit <= 0 for limit in limits.values()):
            raise ValueError("max_body_bytes must be positive")
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.route_limits = limits
        """A path with its own limit, such as ``/v1/compare/background`` (C41.2)."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.route_limits.get(str(scope.get("path", "")), self.max_body_bytes)
        too_large = f"request body exceeds the {limit}-byte limit"
        try:
            declared = _declared_length(scope)
        except ValueError:
            await problem_response(HTTPStatus.BAD_REQUEST, "invalid Content-Length header")(
                scope, receive, send
            )
            return
        if declared is not None and declared > limit:
            await problem_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, too_large)(
                scope, receive, send
            )
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise HTTPException(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, too_large)
            return message

        await self.app(scope, limited_receive, send)


def _declared_length(scope: Scope) -> int | None:
    """Return the request's Content-Length, or ``None`` if absent. Raise ``ValueError`` if bad."""
    values = [v for k, v in scope.get("headers", []) if k.lower() == b"content-length"]
    if not values:
        return None
    lengths = {int(v.decode("latin-1").strip()) for v in values}
    if len(lengths) != 1 or min(lengths) < 0:
        raise ValueError("conflicting or negative Content-Length")
    return lengths.pop()


class JobLimiter:
    """Runs blocking image work in the thread pool, at most ``max_running`` jobs at a time.

    A job decodes every upload of its request, and a decoded image can take hundreds of
    megabytes. Without a cap, each of the thread pool's 40 threads could hold one while the model
    locks serialise inference. Up to ``max_queued`` more requests wait for a slot, holding only
    their compressed bytes. Requests beyond that get a 503 problem with ``Retry-After``.
    """

    def __init__(self, max_running: int, max_queued: int) -> None:
        if max_running <= 0:
            raise ValueError("max_running must be positive")
        if max_queued < 0:
            raise ValueError("max_queued must not be negative")
        self._slots = asyncio.Semaphore(max_running)
        self._capacity = max_running + max_queued
        self._admitted = 0

    async def run[**P, R](self, func: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R:
        """Run ``func`` in a worker thread once a slot is free. A full queue raises a 503."""
        if self._admitted >= self._capacity:
            raise ProblemError(
                HTTPStatus.SERVICE_UNAVAILABLE,
                BUSY_DETAIL,
                headers={"Retry-After": str(BUSY_RETRY_AFTER_SECONDS)},
            )
        self._admitted += 1
        try:
            async with self._slots:
                return await run_in_threadpool(func, *args, **kwargs)
        finally:
            self._admitted -= 1
