"""1B F022 (C32.3): the service token is checked before the multipart body is parsed.

FastAPI reads and parses a route's form body before it resolves the route's dependencies, so a
token dependency alone let an unauthenticated caller make the service receive and spool up to
three uploads. The token is now checked from the request headers before anything reads the body.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from starlette import formparsers
from starlette._utils import get_route_path
from starlette.types import Message

from openverify_vision.analysis import FaceEngine
from openverify_vision.app import create_app
from openverify_vision.faces import Face
from openverify_vision.schemas import EMBEDDING_DIMENSIONS
from openverify_vision.service_token import is_protected, route_path
from openverify_vision.settings import Settings

from synthetic import Image, encode, make_checkerboard

TOKEN = "s" * 40
BOUNDARY = "openverify-test-boundary"


class NoFaces:
    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        return []


class UnitRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: Image, face: Face) -> NDArray[np.float32]:
        vector = np.ones(EMBEDDING_DIMENSIONS, dtype=np.float32)
        return vector / np.linalg.norm(vector)


def make_app() -> FastAPI:
    settings = Settings.model_validate({"service_token": TOKEN})
    engine = FaceEngine(NoFaces(), UnitRecognizer())  # type: ignore[arg-type]
    return create_app(settings, face_engine=engine)


def multipart(field: str, data: bytes) -> bytes:
    return (
        (
            f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="{field}"; filename="a.png"\r\n'
            f"Content-Type: image/png\r\n\r\n"
        ).encode()
        + data
        + f"\r\n--{BOUNDARY}--\r\n".encode()
    )


async def call(
    app: FastAPI,
    path: str,
    body: bytes,
    headers: Sequence[tuple[bytes, bytes]],
    *,
    root_path: str = "",
) -> tuple[list[Message], int]:
    """Run one HTTP request through the ASGI app; return what it sent and how often it read."""
    reads = 0
    sent: list[Message] = []

    async def receive() -> Message:
        nonlocal reads
        reads += 1
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: Message) -> None:
        sent.append(message)

    scope: dict[str, Any] = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": root_path,
        "query_string": b"",
        "headers": [
            (b"host", b"vision"),
            (b"content-type", f"multipart/form-data; boundary={BOUNDARY}".encode()),
            (b"content-length", str(len(body)).encode()),
            *headers,
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("vision", 80),
    }
    await app(scope, receive, send)
    return sent, reads


def status_of(sent: list[Message]) -> int:
    start = next(m for m in sent if m["type"] == "http.response.start")
    return int(start["status"])


def body_of(sent: list[Message]) -> dict[str, Any]:
    raw = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    parsed: dict[str, Any] = json.loads(raw)
    return parsed


PNG = encode(make_checkerboard(), "PNG")


@pytest.mark.anyio
@pytest.mark.parametrize(
    "token",
    [None, b"", b"wrong-token", (TOKEN + "x").encode()],
    ids=["none", "empty", "wrong", "long"],
)
@pytest.mark.parametrize(
    ("path", "field"),
    [
        ("/v1/analyze/government-id", "front"),
        ("/v1/analyze/selfie", "center"),
        ("/v1/quality", "image"),
    ],
)
async def test_without_the_token_the_body_is_never_read(
    token: bytes | None, path: str, field: str
) -> None:
    headers = [] if token is None else [(b"x-service-token", token)]

    sent, reads = await call(make_app(), path, multipart(field, PNG), headers)

    assert reads == 0
    assert status_of(sent) == 401
    problem = body_of(sent)
    assert problem["status"] == 401
    assert problem["title"] == "Unauthorized"
    assert TOKEN not in json.dumps(problem)


@pytest.mark.anyio
async def test_with_the_token_the_request_goes_through() -> None:
    sent, reads = await call(
        make_app(),
        "/v1/quality",
        multipart("image", PNG),
        [(b"x-service-token", TOKEN.encode())],
    )

    assert reads >= 1
    assert status_of(sent) == 200


@pytest.mark.anyio
async def test_a_mounted_service_is_guarded_under_its_root_path() -> None:
    sent, reads = await call(
        make_app(), "/vision/v1/quality", multipart("image", PNG), [], root_path="/vision"
    )

    assert reads == 0
    assert status_of(sent) == 401


def test_the_multipart_parser_never_runs_for_an_unauthenticated_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parsed: list[object] = []
    real = formparsers.MultiPartParser.parse

    async def spy(self: formparsers.MultiPartParser) -> Any:
        parsed.append(self)
        return await real(self)

    monkeypatch.setattr(formparsers.MultiPartParser, "parse", spy)
    client = TestClient(make_app(), raise_server_exceptions=False)
    files = {"front": ("a.png", PNG, "image/png")}

    refused = client.post(
        "/v1/analyze/government-id", files=files, headers={"x-service-token": "x"}
    )
    assert refused.status_code == 401
    assert parsed == []

    accepted = client.post(
        "/v1/analyze/government-id", files=files, headers={"x-service-token": TOKEN}
    )
    assert accepted.status_code == 200, accepted.text
    assert len(parsed) == 1  # the spy does see parsing once the token is right


def test_a_malformed_body_without_the_token_is_401_not_a_parse_error() -> None:
    client = TestClient(make_app(), raise_server_exceptions=False)

    response = client.post(
        "/v1/analyze/government-id",
        content=b"--not-the-boundary\r\ngarbage",
        headers={"content-type": f"multipart/form-data; boundary={BOUNDARY}"},
    )

    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")


def test_health_and_unknown_routes_outside_v1_need_no_token() -> None:
    client = TestClient(make_app(), raise_server_exceptions=False)

    assert client.get("/health").status_code == 200
    assert client.get("/nope").status_code == 404
    assert client.get("/v1-like").status_code == 404


def test_every_route_under_v1_needs_the_token() -> None:
    client = TestClient(make_app(), raise_server_exceptions=False)

    assert client.get("/v1/unknown").status_code == 401
    assert client.get("/v1").status_code == 401
    assert client.get("/v1/unknown", headers={"x-service-token": TOKEN}).status_code == 404


@pytest.mark.parametrize(
    ("path", "root_path", "routed"),
    [
        ("/v1/quality", "", "/v1/quality"),
        ("/vision/v1/quality", "/vision", "/v1/quality"),
        ("/v1/quality", "/vision", "/v1/quality"),  # the router also matches it without the root
        ("/vision", "/vision", ""),
        ("/visionary/v1/quality", "/vision", "/visionary/v1/quality"),  # not under the root
    ],
)
def test_the_guard_sees_the_path_the_router_matches(path: str, root_path: str, routed: str) -> None:
    scope = {"type": "http", "path": path, "root_path": root_path}

    assert route_path(scope) == routed == get_route_path(scope)


@pytest.mark.parametrize(
    ("path", "protected"),
    [("/v1", True), ("/v1/quality", True), ("/v1-like", False), ("/health", False), ("", False)],
)
def test_only_paths_under_v1_are_guarded(path: str, protected: bool) -> None:
    assert is_protected(path) is protected


def test_lifespan_events_pass_through_the_guard() -> None:
    with TestClient(make_app()) as client:  # runs the lifespan startup and shutdown
        assert client.get("/health").status_code == 200
