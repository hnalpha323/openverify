"""Workflow 11B (ingestion-11b; the owner decisions after Workflow 7B, "Later phases"):
``POST /v1/count/document-pages``, a PDF's page count for the API's transaction file fields that
limit pages (``page-count-limit-enabled``).

The API counted a transaction PDF's pages in its own process from its ``/Type /Page`` objects
(provisional: no parser, and a page tree in a compressed object stream gave 0). The count is now
made where untrusted PDFs are already parsed: the guarded child (C60.2), whose
``count_pdf_pages`` task opens the document with PDFium and reads its page count, rendering
nothing and loading no page, under the child's rlimits and kill timer. No new dependency.

- One multipart file, ``document``: a PDF (``%PDF-`` within its first 1,024 bytes, as C52.4
  sniffs one) of at most :data:`PAGE_COUNT_MAX_BYTES`, the transactions' file ceiling, whatever
  the image routes' upload limit; anything else is 415, a larger file 413.
- ``{"page_count": n}``, 1 to :data:`PAGE_COUNT_MAX_PAGES`.
- 422 with C60.1's codes: ``pdf_encrypted`` (a user password), ``pdf_unprocessable`` (PDFium
  cannot read it, it has no page, or it stopped the child on the child's own limits, which a
  retry would meet again), ``too_many_pages`` (past :data:`PAGE_COUNT_MAX_PAGES`).
- 503 ``guarded_worker_failed`` for a child that was killed, timed out or answered something that
  does not validate: the API answers its caller a retryable 503, never a pass.

The bounds are exported to ``contracts/fixtures/vision/pdf-page-count.json``
(:func:`page_count_limits`), which the API's client reads. The bytes are a person's data: the
answer is a number, and nothing of the document is logged.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Annotated, Final, Literal, NoReturn, cast

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.requests import Request

from openverify_vision.auth import require_service_token
from openverify_vision.document_analysis import sniff_document
from openverify_vision.guarded import DEFAULT_LIMITS, GuardLimits
from openverify_vision.guarded.runner import GuardedRefusal, GuardedWorkerError, run_guarded
from openverify_vision.limits import JobLimiter
from openverify_vision.problems import ProblemError
from openverify_vision.schemas import GUARDED_WORKER_FAILED

__all__ = [
    "GUARD_LIMITS",
    "PAGE_COUNT_MAX_BYTES",
    "PAGE_COUNT_MAX_PAGES",
    "PAGE_COUNT_PATH",
    "PAGE_COUNT_REFUSALS",
    "PageCount",
    "PageCountLimits",
    "count_document_pages",
    "count_pdf_pages",
    "page_count_limits",
    "router",
    "run_guarded",
]

PAGE_COUNT_PATH: Final = "/v1/count/document-pages"

PAGE_COUNT_MAX_BYTES: Final = 20_000_000
"""The largest PDF counted: the transactions' file ceiling (``TRANSACTION_LIMITS.fileMaxBytes``,
K7B-7), so a field's largest file is never refused for its size here."""

PAGE_COUNT_MAX_PAGES: Final = 10_000
"""Ours, provisional: the largest count answered. A page count is read from the page tree, never
by loading pages, so the bound is on the answer, not the work; a field that limits pages names
far fewer."""

PAGE_COUNT_REFUSALS: Final = ("pdf_encrypted", "pdf_unprocessable", "too_many_pages")
"""C60.1's codes, as the API reads them from the problem's ``code``."""

GUARD_LIMITS: GuardLimits = DEFAULT_LIMITS
"""The guarded child's limits (C60.2); tests lower them."""

_DETAILS: Final = {
    "pdf_encrypted": "the PDF is encrypted with a password",
    "pdf_unprocessable": "the PDF cannot be processed",
    "too_many_pages": "the PDF has more pages than are counted",
}

router = APIRouter(prefix="/v1", dependencies=[Depends(require_service_token)])


class _Contract(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class PageCount(_Contract):
    """The route's answer: the PDF's page count."""

    page_count: Annotated[int, Field(strict=True, ge=1, le=PAGE_COUNT_MAX_PAGES)]


class _ChildAnswer(_Contract):
    ok: Literal[True]
    page_count: Annotated[int, Field(strict=True, ge=1)]


class PageCountLimits(_Contract):
    """The route's bounds, which the API reads from ``contracts/fixtures/vision``."""

    path: Literal["/v1/count/document-pages"]
    media_type: Literal["application/pdf"]
    max_bytes: Literal[20_000_000]
    max_pages: Literal[10_000]
    refusals: list[Literal["pdf_encrypted", "pdf_unprocessable", "too_many_pages"]]


def page_count_limits() -> dict[str, object]:
    """The bounds fixture's content, from this module's constants."""
    return {
        "path": PAGE_COUNT_PATH,
        "media_type": "application/pdf",
        "max_bytes": PAGE_COUNT_MAX_BYTES,
        "max_pages": PAGE_COUNT_MAX_PAGES,
        "refusals": list(PAGE_COUNT_REFUSALS),
    }


def _refused(code: str) -> NoReturn:
    raise ProblemError(HTTPStatus.UNPROCESSABLE_ENTITY, f"document: {_DETAILS[code]}", code=code)


def _not_counted(reason: str) -> NoReturn:
    raise ProblemError(
        HTTPStatus.SERVICE_UNAVAILABLE,
        f"the pages could not be counted in time ({reason}); retry later",
        code=GUARDED_WORKER_FAILED,
    )


def count_pdf_pages(data: bytes) -> PageCount:
    """The page count of the PDF ``data``, read in a guarded child (see the module)."""
    if sniff_document(data) != "pdf":
        raise ProblemError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "document: not a PDF")
    try:
        answer = run_guarded(
            "count_pdf_pages", data, {"max_pages": PAGE_COUNT_MAX_PAGES}, limits=GUARD_LIMITS
        )
    except GuardedRefusal as refusal:
        _refused(refusal.code if refusal.code in _DETAILS else "pdf_unprocessable")
    except GuardedWorkerError as failure:
        if failure.over_limits:
            _refused("pdf_unprocessable")
        _not_counted(failure.reason)
    try:
        counted = _ChildAnswer.model_validate(answer.header)
    except ValidationError:
        _not_counted("malformed_output")
    if counted.page_count > PAGE_COUNT_MAX_PAGES:
        _refused("too_many_pages")
    return PageCount(page_count=counted.page_count)


def _job_limiter(request: Request) -> JobLimiter:
    """The app's limiter for decoding and analysis jobs (``app.get_job_limiter``)."""
    return cast("JobLimiter", request.app.state.job_limiter)


async def _read(upload: UploadFile) -> bytes:
    data = await upload.read(PAGE_COUNT_MAX_BYTES + 1)
    if len(data) > PAGE_COUNT_MAX_BYTES:
        raise ProblemError(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            f"document: the file exceeds the {PAGE_COUNT_MAX_BYTES}-byte limit of a count",
        )
    return data


@router.post(PAGE_COUNT_PATH.removeprefix("/v1"), response_model=PageCount)
async def count_document_pages(
    document: Annotated[UploadFile, File(description="A PDF of at most 20 MB")],
    limiter: Annotated[JobLimiter, Depends(_job_limiter)],
) -> PageCount:
    """A PDF's page count from the guarded child, rendering nothing (see the module)."""
    data = await _read(document)
    return await limiter.run(count_pdf_pages, data)
