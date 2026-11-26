"""Request-body size limit enforced at the ASGI layer."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from openverify_vision.limits import BodySizeLimitMiddleware, JobLimiter
from openverify_vision.problems import ProblemError, install_problem_handlers

LIMIT = 1_000


def make_app() -> FastAPI:
    app = FastAPI()
    install_problem_handlers(app)
    app.add_middleware(BodySizeLimitMiddleware, max_body_bytes=LIMIT)

    @app.post("/echo-size")
    async def echo_size(request: Request) -> dict[str, int]:
        return {"size": len(await request.body())}

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"pong": "yes"}

    return app


def chunks(total: int, size: int = 100) -> Iterator[bytes]:
    sent = 0
    while sent < total:
        n = min(size, total - sent)
        sent += n
        yield b"\x01" * n


def test_body_within_limit_passes() -> None:
    client = TestClient(make_app())

    response = client.post("/echo-size", content=b"x" * LIMIT)

    assert response.status_code == 200
    assert response.json() == {"size": LIMIT}


def test_declared_content_length_over_limit_is_rejected_up_front() -> None:
    client = TestClient(make_app())

    response = client.post("/echo-size", content=b"x" * (LIMIT + 1))

    assert response.status_code == 413
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["status"] == 413


def test_streamed_body_without_content_length_is_cut_off() -> None:
    client = TestClient(make_app())

    response = client.post("/echo-size", content=chunks(LIMIT * 5))

    assert response.status_code == 413
    assert response.json()["status"] == 413


def test_streamed_body_within_limit_passes() -> None:
    client = TestClient(make_app())

    response = client.post("/echo-size", content=chunks(LIMIT - 1))

    assert response.status_code == 200
    assert response.json() == {"size": LIMIT - 1}


def test_requests_without_body_are_untouched() -> None:
    client = TestClient(make_app())

    assert client.get("/ping").json() == {"pong": "yes"}


def test_invalid_content_length_is_400() -> None:
    client = TestClient(make_app())

    response = client.post("/echo-size", content=b"x", headers={"content-length": "abc"})

    assert response.status_code == 400
    assert response.json()["status"] == 400


def test_lifespan_scope_passes_through() -> None:
    with TestClient(make_app()) as client:  # runs lifespan startup/shutdown through the middleware
        assert client.get("/ping").status_code == 200


# --- raw ASGI edge cases (added after GREEN to pin down the defensive branches) -------------


def test_limit_must_be_positive() -> None:
    with pytest.raises(ValueError, match="positive"):
        BodySizeLimitMiddleware(make_app(), max_body_bytes=0)


def _scope(headers: list[tuple[bytes, bytes]]) -> Scope:
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/echo-size",
        "raw_path": b"/echo-size",
        "query_string": b"",
        "root_path": "",
        "headers": headers,
        "client": ("127.0.0.1", 1),
        "server": ("testserver", 80),
    }


async def _run(app: ASGIApp, scope: Scope, messages: list[Message]) -> list[Message]:
    sent: list[Message] = []
    queue = list(messages)

    async def receive() -> Message:
        return queue.pop(0) if queue else {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        sent.append(message)

    await app(scope, receive, send)
    return sent


@pytest.mark.anyio
@pytest.mark.parametrize(
    "lengths",
    [[b"10", b"20"], [b"-5"]],
    ids=["conflicting", "negative"],
)
async def test_conflicting_or_negative_content_length_is_400(lengths: list[bytes]) -> None:
    middleware = BodySizeLimitMiddleware(make_app(), max_body_bytes=LIMIT)
    headers = [(b"content-length", value) for value in lengths]

    sent = await _run(middleware, _scope(headers), [{"type": "http.request", "body": b""}])

    assert sent[0]["type"] == "http.response.start"
    assert sent[0]["status"] == 400


@pytest.mark.anyio
async def test_non_body_messages_are_passed_through_uncounted() -> None:
    seen: list[str] = []

    async def inner(scope: Scope, receive: Receive, send: Send) -> None:
        seen.append((await receive())["type"])
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    middleware = BodySizeLimitMiddleware(inner, max_body_bytes=LIMIT)

    sent = await _run(middleware, _scope([]), [{"type": "http.disconnect"}])

    assert seen == ["http.disconnect"]
    assert sent[0]["status"] == 204


# --- JobLimiter ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("max_running", "max_queued", "message"),
    [(0, 0, "max_running"), (1, -1, "max_queued")],
)
def test_job_limiter_rejects_impossible_limits(
    max_running: int, max_queued: int, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        JobLimiter(max_running, max_queued)


def _fail() -> None:
    raise ProblemError(415, "front: not a supported image")


@pytest.mark.anyio
async def test_a_failed_job_frees_its_slot() -> None:
    limiter = JobLimiter(max_running=1, max_queued=0)

    with pytest.raises(ProblemError):
        await limiter.run(_fail)

    assert await limiter.run(sum, [1, 2]) == 3
