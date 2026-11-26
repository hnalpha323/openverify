"""HTTP API: /health, POST /v1/quality, service-token auth and problem+json errors."""

from __future__ import annotations

import hmac
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

from openverify_vision import auth
from openverify_vision.app import create_app
from openverify_vision.settings import Settings

from synthetic import encode, gaussian_blur, make_checkerboard, make_noise, make_uniform

TOKEN = "s" * 40
AUTH = {"x-service-token": TOKEN}
PROBLEM = "application/problem+json"


def make_client(**overrides: object) -> TestClient:
    settings = Settings.model_validate({"service_token": TOKEN, **overrides})
    return TestClient(create_app(settings), raise_server_exceptions=False)


@pytest.fixture
def client() -> TestClient:
    return make_client()


def png_upload(
    data: bytes, filename: str = "front.png", content_type: str = "image/png"
) -> dict[str, tuple[str, bytes, str]]:
    return {"image": (filename, data, content_type)}


def assert_problem(response: Response, status: int) -> dict[str, object]:
    assert response.status_code == status
    assert response.headers["content-type"].startswith(PROBLEM)
    body = response.json()
    assert body["status"] == status
    assert isinstance(body["title"], str)
    assert body["title"]
    assert body["type"] == "about:blank"
    return dict(body)


# --- /health --------------------------------------------------------------------------------


def test_health_needs_no_token(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# --- POST /v1/quality: happy path -----------------------------------------------------------


def test_quality_returns_report_for_sharp_image(client: TestClient) -> None:
    image = encode(make_checkerboard(low=40, high=200), "PNG")

    response = client.post("/v1/quality", files=png_upload(image), headers=AUTH)

    assert response.status_code == 200
    body = response.json()
    assert body["checks"]["id_blur_detection"]["status"] == "passed"
    assert body["checks"]["id_glare_detection"]["status"] == "passed"
    assert body["checks"]["id_blur_detection"]["threshold"] == 100.0
    assert body["checks"]["id_glare_detection"]["threshold"] == 0.05
    assert body["metrics"]["width"] == 256
    assert body["metrics"]["height"] == 256


def test_quality_flags_blurred_image(client: TestClient) -> None:
    image = encode(gaussian_blur(make_checkerboard(low=40, high=200)), "PNG")

    response = client.post("/v1/quality", files=png_upload(image), headers=AUTH)

    assert response.status_code == 200
    assert response.json()["checks"]["id_blur_detection"]["status"] == "failed"


def test_quality_uses_thresholds_from_settings() -> None:
    client = make_client(blur_threshold=1e9, glare_threshold=0.5)
    image = encode(make_checkerboard(low=40, high=200), "PNG")

    body = client.post("/v1/quality", files=png_upload(image), headers=AUTH).json()

    assert body["checks"]["id_blur_detection"] == {
        "status": "failed",
        "score": body["checks"]["id_blur_detection"]["score"],
        "threshold": 1e9,
    }
    assert body["checks"]["id_glare_detection"]["threshold"] == 0.5


def test_declared_content_type_is_ignored_in_favour_of_sniffing(client: TestClient) -> None:
    image = encode(make_uniform(128), "JPEG")

    response = client.post(
        "/v1/quality",
        files=png_upload(image, filename="x.bin", content_type="application/octet-stream"),
        headers=AUTH,
    )

    assert response.status_code == 200


# --- auth -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"x-service-token": ""},
        {"x-service-token": "wrong-token"},
        {"x-service-token": TOKEN + "x"},
    ],
)
def test_quality_requires_valid_service_token(client: TestClient, headers: dict[str, str]) -> None:
    image = encode(make_uniform(128), "PNG")

    response = client.post("/v1/quality", files=png_upload(image), headers=headers)

    body = assert_problem(response, 401)
    assert TOKEN not in response.text
    assert body["title"] == "Unauthorized"


def test_token_header_name_is_case_insensitive(client: TestClient) -> None:
    image = encode(make_uniform(128), "PNG")

    response = client.post(
        "/v1/quality", files=png_upload(image), headers={"X-Service-Token": TOKEN}
    )

    assert response.status_code == 200


def test_token_is_compared_in_constant_time(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[bytes, bytes]] = []
    real: Callable[[bytes, bytes], bool] = hmac.compare_digest

    def spy(a: bytes, b: bytes) -> bool:
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(auth.hmac, "compare_digest", spy)
    image = encode(make_uniform(128), "PNG")

    client.post("/v1/quality", files=png_upload(image), headers={"x-service-token": "nope"})

    assert len(calls) == 1
    supplied, expected = calls[0]
    assert len(supplied) == len(expected)  # digests, so the token length does not leak


# --- rejections -----------------------------------------------------------------------------


def test_non_image_is_415(client: TestClient) -> None:
    response = client.post(
        "/v1/quality",
        files=png_upload(b"hello, I am text", filename="a.png", content_type="image/png"),
        headers=AUTH,
    )

    body = assert_problem(response, 415)
    assert "JPEG" in str(body["detail"])


def test_unsupported_image_format_is_415(client: TestClient) -> None:
    gif = encode(make_uniform(128, height=8, width=8), "GIF")

    response = client.post("/v1/quality", files=png_upload(gif, "a.gif", "image/gif"), headers=AUTH)

    assert_problem(response, 415)


def test_file_over_upload_limit_is_413() -> None:
    client = make_client(max_upload_bytes=1_000)
    image = encode(make_noise(), "PNG")  # ~12 KB: over the file limit, under the body allowance
    assert len(image) > 1_000

    response = client.post("/v1/quality", files=png_upload(image), headers=AUTH)

    body = assert_problem(response, 413)
    assert "1000" in str(body["detail"])


def test_request_far_over_limit_is_rejected_before_parsing() -> None:
    client = make_client(max_upload_bytes=1_000)

    response = client.post("/v1/quality", files=png_upload(b"\x00" * 500_000), headers=AUTH)

    assert_problem(response, 413)


def test_image_over_pixel_limit_is_413() -> None:
    client = make_client(max_image_pixels=100)
    image = encode(make_uniform(128, height=20, width=20), "PNG")

    response = client.post("/v1/quality", files=png_upload(image), headers=AUTH)

    assert_problem(response, 413)


def test_corrupt_image_is_422(client: TestClient) -> None:
    image = encode(make_checkerboard(), "PNG")

    response = client.post("/v1/quality", files=png_upload(image[: len(image) // 2]), headers=AUTH)

    assert_problem(response, 422)


def test_missing_image_field_is_422_without_echoing_input(client: TestClient) -> None:
    response = client.post(
        "/v1/quality", data={"other": "SECRET-VALUE-123"}, files={"x": ("a", b"1")}, headers=AUTH
    )

    body = assert_problem(response, 422)
    assert "SECRET-VALUE-123" not in response.text
    errors = body["errors"]
    assert isinstance(errors, list)
    assert errors
    assert set(errors[0]) == {"loc", "msg", "type"}


def test_unknown_route_is_problem_json(client: TestClient) -> None:
    assert_problem(client.get("/nope"), 404)


def test_wrong_method_is_problem_json(client: TestClient) -> None:
    assert_problem(client.get("/v1/quality", headers=AUTH), 405)


def test_unhandled_error_is_generic_500(monkeypatch: pytest.MonkeyPatch) -> None:
    client = make_client()

    def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("internal detail that must not leak")

    monkeypatch.setattr("openverify_vision.app.assess_quality", boom)
    image = encode(make_uniform(128), "PNG")

    response = client.post("/v1/quality", files=png_upload(image), headers=AUTH)

    assert_problem(response, 500)
    assert "must not leak" not in response.text


def test_interactive_docs_are_disabled(client: TestClient) -> None:
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
