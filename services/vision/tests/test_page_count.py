"""Workflow 11B (ingestion-11b; the owner decisions after Workflow 7B, "Later phases"): a PDF's page
count, for the API's transaction file fields that limit pages.

``POST /v1/count/document-pages`` takes one multipart file, ``document`` (a PDF of at most 20 MB,
the transactions' file ceiling), and answers ``{"page_count": n}``: PDFium's count in the guarded
child (C60.2), which renders nothing and loads no page. An encrypted PDF is 422
``pdf_encrypted``, one PDFium cannot read (or that stops the child on its own limits) 422
``pdf_unprocessable``, more than 10,000 pages 422 ``too_many_pages``, anything but a PDF 415, and
a child that failed otherwise 503 ``guarded_worker_failed``: the API refuses the file on a 422 and
answers a retryable 503 on a 503, never a pass. The route's bounds are the exported fixture
``contracts/fixtures/vision/pdf-page-count.json`` (rule 28: this test only compares it, and
writes it only under ``UPDATE_CONTRACT_FIXTURES=1``).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

import document_pdfs as pdfs
import ocr_fakes
from openverify_vision import page_count
from openverify_vision.app import create_app
from openverify_vision.guarded.runner import GuardedAnswer, GuardedWorkerError
from openverify_vision.guarded.worker import run_task
from openverify_vision.schemas import GUARDED_WORKER_FAILED
from openverify_vision.settings import Settings

from synthetic import encode, make_checkerboard

TOKEN = "s" * 40
AUTH = {"x-service-token": TOKEN}
PROBLEM = "application/problem+json"
FIXTURE = Path(__file__).resolve().parents[3] / "contracts/fixtures/vision/pdf-page-count.json"

EXPECTED_LIMITS: dict[str, Any] = {
    "path": "/v1/count/document-pages",
    "media_type": "application/pdf",
    "max_bytes": 20_000_000,
    "max_pages": 10_000,
    "refusals": ["pdf_encrypted", "pdf_unprocessable", "too_many_pages"],
}
"""This test's own case table of the bounds (rule 28)."""


def client(**overrides: object) -> TestClient:
    settings = Settings.model_validate({"service_token": TOKEN, **overrides})
    engine, _, _ = ocr_fakes.engine()
    return TestClient(create_app(settings, ocr_engine=engine), raise_server_exceptions=False)


def count(data: bytes, test_client: TestClient | None = None) -> Response:
    return (test_client or client()).post(
        page_count.PAGE_COUNT_PATH,
        files={"document": ("document.pdf", data, "application/pdf")},
        headers=AUTH,
    )


def problem(response: Response, status: int) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith(PROBLEM)
    body: dict[str, Any] = response.json()
    assert body["status"] == status
    return body


# --- the route -----------------------------------------------------------------------------------


@pytest.mark.parametrize("pages", [1, 3, 60])
def test_a_pdf_answers_its_page_count(pages: int) -> None:
    # 60 is past the analysis' 50 pages: a count reads the page tree, never a page.
    response = count(pdfs.many_pages(pages))
    assert response.status_code == 200, response.text
    assert response.json() == {"page_count": pages}


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (pdfs.encrypted("user-secret"), "pdf_encrypted"),
        (b"%PDF-1.7\n%%EOF\n", "pdf_unprocessable"),
        (b"%PDF-1.4\n" + b"\x00" * 512, "pdf_unprocessable"),
    ],
    ids=["encrypted", "no-page-tree", "garbage"],
)
def test_a_pdf_it_cannot_count_answers_422_with_its_code(data: bytes, code: str) -> None:
    body = problem(count(data), 422)
    assert body["code"] == code


def test_more_pages_than_the_bound_answer_too_many_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(page_count, "PAGE_COUNT_MAX_PAGES", 2)
    body = problem(count(pdfs.many_pages(3)), 422)
    assert body["code"] == "too_many_pages"


def test_anything_but_a_pdf_is_415() -> None:
    response = client().post(
        page_count.PAGE_COUNT_PATH,
        files={"document": ("photo.png", encode(make_checkerboard(), "PNG"), "image/png")},
        headers=AUTH,
    )
    problem(response, 415)


def test_the_route_needs_the_service_token() -> None:
    response = client().post(
        page_count.PAGE_COUNT_PATH,
        files={"document": ("document.pdf", pdfs.many_pages(1), "application/pdf")},
    )
    problem(response, 401)


def test_a_pdf_over_the_count_limit_is_413(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(page_count, "PAGE_COUNT_MAX_BYTES", 64)
    problem(count(pdfs.many_pages(1)), 413)


def test_the_route_takes_a_body_of_one_twenty_megabyte_file() -> None:
    # Past 20 MB + 64 KiB the declared length is refused before the body is read.
    response = client().post(
        page_count.PAGE_COUNT_PATH,
        content=b"x" * 16,
        headers={**AUTH, "content-length": str(21_000_000), "content-type": "multipart/form-data"},
    )
    problem(response, 413)


def test_a_child_that_stopped_on_its_own_limits_is_pdf_unprocessable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def stopped(*_args: object, **_kwargs: object) -> None:
        raise GuardedWorkerError("exit_status", over_limits=True)

    monkeypatch.setattr(page_count, "run_guarded", stopped)
    assert problem(count(pdfs.many_pages(1)), 422)["code"] == "pdf_unprocessable"


def test_a_failed_child_answers_503_guarded_worker_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    def killed(*_args: object, **_kwargs: object) -> None:
        raise GuardedWorkerError("timeout")

    monkeypatch.setattr(page_count, "run_guarded", killed)
    assert problem(count(pdfs.many_pages(1)), 503)["code"] == GUARDED_WORKER_FAILED


@pytest.mark.parametrize(
    "header",
    [{"ok": True}, {"ok": True, "page_count": 0}, {"ok": True, "page_count": "3"}],
    ids=["missing", "zero", "text"],
)
def test_an_answer_that_does_not_validate_is_a_worker_failure(
    monkeypatch: pytest.MonkeyPatch, header: dict[str, object]
) -> None:
    def answered(*_args: object, **_kwargs: object) -> GuardedAnswer:
        return GuardedAnswer(header=header, frames=())

    monkeypatch.setattr(page_count, "run_guarded", answered)
    assert problem(count(pdfs.many_pages(1)), 503)["code"] == GUARDED_WORKER_FAILED


# --- the guarded task ----------------------------------------------------------------------------


def test_the_child_task_counts_without_rendering() -> None:
    header, frames = run_task("count_pdf_pages", {"max_pages": 10}, pdfs.many_pages(4))
    assert header == {"ok": True, "page_count": 4}
    assert frames == []


@pytest.mark.parametrize(
    ("data", "max_pages", "code"),
    [
        (pdfs.encrypted("user-secret"), 10, "pdf_encrypted"),
        (b"%PDF-1.7\n%%EOF\n", 10, "pdf_unprocessable"),
        (pdfs.many_pages(3), 2, "too_many_pages"),
    ],
    ids=["encrypted", "unreadable", "over-the-bound"],
)
def test_the_child_task_refuses_with_its_code(data: bytes, max_pages: int, code: str) -> None:
    header, frames = run_task("count_pdf_pages", {"max_pages": max_pages}, data)
    assert header == {"ok": False, "error": code}
    assert frames == []


# --- the exported bounds (rule 28) ---------------------------------------------------------------


def test_the_bounds_are_the_implementations() -> None:
    assert page_count_limits_or_none() == EXPECTED_LIMITS
    assert EXPECTED_LIMITS["max_bytes"] == page_count.PAGE_COUNT_MAX_BYTES
    assert EXPECTED_LIMITS["max_pages"] == page_count.PAGE_COUNT_MAX_PAGES
    assert list(page_count.PAGE_COUNT_REFUSALS) == EXPECTED_LIMITS["refusals"]


def page_count_limits_or_none() -> dict[str, object] | None:
    try:
        return page_count.page_count_limits()
    except NotImplementedError:
        return None


def test_the_committed_bounds_fixture_is_what_the_implementation_exports() -> None:
    produced = page_count.page_count_limits()
    if os.environ.get("UPDATE_CONTRACT_FIXTURES") == "1":
        FIXTURE.write_text(json.dumps(produced, indent=2) + "\n", encoding="utf-8")
    assert FIXTURE.is_file(), f"{FIXTURE} is missing; write it with UPDATE_CONTRACT_FIXTURES=1"
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == produced
    page_count.PageCountLimits.model_validate(produced, strict=True)
