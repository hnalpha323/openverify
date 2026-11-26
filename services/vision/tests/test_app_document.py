"""C60.1, C60.4: the document routes and the chip subject.

Each route sits behind the service token and the body limits. A PDF or a JPEG 2000 portrait is
parsed in the guarded child; a refusal answers its problem with a ``code`` where C60.1 names one,
and a child that was killed or answered nothing usable a 503 ``guarded_worker_failed``. The OCR
is the fake engine of ``ocr_fakes`` (no weights needed).
"""

from __future__ import annotations

import io
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from PIL import Image

import document_pdfs as pdfs
import ocr_fakes
from openverify_vision import document_analysis
from openverify_vision.app import create_app
from openverify_vision.guarded.runner import GuardedWorkerError
from openverify_vision.schemas import GUARDED_WORKER_FAILED, DocumentAnalysis
from openverify_vision.settings import Settings

from synthetic import encode, make_checkerboard

TOKEN = "s" * 40
AUTH = {"x-service-token": TOKEN}
PROBLEM = "application/problem+json"


def client(**overrides: object) -> TestClient:
    settings = Settings.model_validate({"service_token": TOKEN, **overrides})
    engine, _, _ = ocr_fakes.engine()
    return TestClient(create_app(settings, ocr_engine=engine), raise_server_exceptions=False)


def problem(response: Response, status: int) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith(PROBLEM)
    body: dict[str, Any] = response.json()
    assert body["status"] == status
    return body


def pdf_upload(data: bytes | None = None) -> tuple[str, bytes, str]:
    return ("document.pdf", pdfs.bill() if data is None else data, "application/pdf")


def png_upload() -> tuple[str, bytes, str]:
    return ("bill.png", encode(make_checkerboard(), "PNG"), "image/png")


def jp2_upload(width: int = 96, height: int = 120) -> tuple[str, bytes, str]:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (150, 120, 100)).save(buffer, format="JPEG2000")
    return ("image.jp2", buffer.getvalue(), "image/jp2")


ROUTES = [
    ("/v1/analyze/document", {"document": pdf_upload()}, {}),
    ("/v1/render/document-page", {"document": pdf_upload()}, {"page": "1"}),
    ("/v1/convert/portrait", {"image": jp2_upload()}, {}),
    ("/v1/embed/face", {"image": jp2_upload()}, {"subject": "chip"}),
]


@pytest.mark.parametrize(("path", "files", "data"), ROUTES)
def test_each_route_needs_the_service_token(
    path: str, files: dict[str, Any], data: dict[str, str]
) -> None:
    problem(client().post(path, files=files, data=data), 401)


# --- /v1/analyze/document ------------------------------------------------------------------------


def test_a_pdf_is_analysed() -> None:
    response = client().post("/v1/analyze/document", files={"document": pdf_upload()}, headers=AUTH)
    assert response.status_code == 200, response.text
    analysis = DocumentAnalysis.model_validate(response.json())
    assert (analysis.source, analysis.page_count) == ("pdf", 1)
    assert analysis.pages[0].text_layer[0].text == "UTOPIA WATER BOARD"
    assert analysis.model_versions.pdf_renderer == "pdfium-156.0.8076.0"


def test_a_photo_is_analysed() -> None:
    response = client().post("/v1/analyze/document", files={"document": png_upload()}, headers=AUTH)
    assert response.status_code == 200, response.text
    analysis = DocumentAnalysis.model_validate(response.json())
    assert (analysis.source, analysis.pdf) == ("image", None)


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (pdfs.encrypted("user-secret"), "pdf_encrypted"),
        (pdfs.many_pages(51), "too_many_pages"),
        (pdfs.oversized_page(), "pdf_unprocessable"),
    ],
    ids=["encrypted", "too-many-pages", "oversized"],
)
def test_a_refused_pdf_answers_422_with_its_code(data: bytes, code: str) -> None:
    response = client().post(
        "/v1/analyze/document", files={"document": pdf_upload(data)}, headers=AUTH
    )
    assert problem(response, 422)["code"] == code


def test_a_file_that_is_neither_a_pdf_nor_an_image_is_415() -> None:
    response = client().post(
        "/v1/analyze/document",
        files={"document": ("x.gif", b"GIF89a not accepted", "image/gif")},
        headers=AUTH,
    )
    body = problem(response, 415)
    assert "code" not in body


def test_a_document_over_the_upload_limit_is_413() -> None:
    response = client(max_upload_bytes=64).post(
        "/v1/analyze/document", files={"document": pdf_upload()}, headers=AUTH
    )
    problem(response, 413)


def test_the_document_route_takes_a_route_limit_of_one_upload() -> None:
    # 1 x upload + 64 KiB (C60.1): two files' worth is refused before the body is read.
    size = 2 * 10 * 1024 * 1024
    response = client().post(
        "/v1/analyze/document",
        content=b"x" * 16,
        headers={**AUTH, "content-length": str(size), "content-type": "multipart/form-data"},
    )
    problem(response, 413)


def test_a_failed_child_answers_503_guarded_worker_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    def killed(*_args: object, **_kwargs: object) -> None:
        raise GuardedWorkerError("timeout")

    monkeypatch.setattr(document_analysis, "run_guarded", killed)
    response = client().post("/v1/analyze/document", files={"document": pdf_upload()}, headers=AUTH)
    body = problem(response, 503)
    assert body["code"] == GUARDED_WORKER_FAILED
    assert "Retry-After" not in response.headers


# --- /v1/render/document-page --------------------------------------------------------------------


def test_a_page_renders_as_a_png() -> None:
    response = client().post(
        "/v1/render/document-page",
        files={"document": pdf_upload()},
        data={"page": "1"},
        headers=AUTH,
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (1236, 1600)


@pytest.mark.parametrize("page", ["0", "-1", "x"])
def test_the_page_to_render_is_a_positive_number(page: str) -> None:
    response = client().post(
        "/v1/render/document-page",
        files={"document": pdf_upload()},
        data={"page": page},
        headers=AUTH,
    )
    body = problem(response, 422)
    assert any("page" in error["loc"] for error in body["errors"])


def test_a_page_beyond_the_document_is_422() -> None:
    response = client().post(
        "/v1/render/document-page",
        files={"document": pdf_upload()},
        data={"page": "3"},
        headers=AUTH,
    )
    assert "code" not in problem(response, 422)


def test_the_render_refuses_an_encrypted_pdf_with_its_code() -> None:
    response = client().post(
        "/v1/render/document-page",
        files={"document": pdf_upload(pdfs.encrypted("user-secret"))},
        headers=AUTH,
    )
    assert problem(response, 422)["code"] == "pdf_encrypted"


# --- /v1/convert/portrait and the chip subject ---------------------------------------------------


def test_a_chip_portrait_converts_to_a_png() -> None:
    response = client().post("/v1/convert/portrait", files={"image": jp2_upload()}, headers=AUTH)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (96, 120)


def test_a_png_is_no_chip_portrait() -> None:
    problem(client().post("/v1/convert/portrait", files={"image": png_upload()}, headers=AUTH), 415)


def test_a_chip_portrait_over_4_mp_is_413() -> None:
    response = client().post(
        "/v1/convert/portrait", files={"image": jp2_upload(2100, 2000)}, headers=AUTH
    )
    problem(response, 413)


def test_the_chip_subject_refuses_what_the_guard_refuses() -> None:
    response = client().post(
        "/v1/embed/face", files={"image": png_upload()}, data={"subject": "chip"}, headers=AUTH
    )
    problem(response, 415)


def test_the_chip_subject_decodes_through_the_guard_before_the_face_models() -> None:
    # Without the face weights, a decoded portrait reaches the models and answers their 503.
    response = client(models_dir="/nonexistent-models").post(
        "/v1/embed/face", files={"image": jp2_upload()}, data={"subject": "chip"}, headers=AUTH
    )
    body = problem(response, 503)
    assert "face models are not available" in body["detail"]
