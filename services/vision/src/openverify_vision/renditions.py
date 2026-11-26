"""C135.3 (Workflow 8B): ``POST /v1/renditions``, what a reviewer may see of a file.

The API sends a case attachment or an inquiry file as one multipart file, ``source``, and stores
what this route answers sealed beside the source; the console and every export serve only that.

- **An image** (JPEG, PNG, WebP by its first bytes) is decoded with the upload guards: the format
  is sniffed, the dimensions are checked against ``max_image_pixels`` before any pixel is decoded,
  and Pillow's decompression-bomb error is a 413 too. Its EXIF orientation is applied, 16-bit grey
  is scaled to 8 bits (not clipped), and a transparent area is shown on white, as a page shows
  it. The pixels are copied into a fresh image, so no EXIF, XMP, ICC profile, text chunk, comment
  or density of the source can reach the encoder, and the copy is scaled to at most
  :data:`~openverify_vision.schemas.RENDITION_IMAGE_MAX_SIDE_PX` a side. A JPEG is re-encoded as
  a JPEG; a PNG or WebP as a PNG, or as a JPEG when the PNG would pass the byte limit. Colours are
  read as sRGB, since the profile is dropped. An animated image gives its first frame.
- **A PDF** is never parsed here: each of its first 20 pages is rendered by the guarded child's
  ``render_pdf_page`` task (C60.2), one child a page, as a PNG of at most 1,600 px a side. The
  first page's answer gives the page count; a PDF of more pages is ``truncated``. The child
  refuses more than 50 pages (``too_many_pages``), an encrypted PDF (``pdf_encrypted``) and one
  it cannot read (``pdf_unprocessable``), as the document analysis does.
- **Anything else** is 415; an image that cannot be decoded is 422.

Renditions run on a limiter lane of their own (:data:`RENDITION_LANE_SLOTS` running,
:data:`RENDITION_LANE_QUEUED` waiting, F25), so a queue of renditions never takes the slots the
verification jobs use. The work stops :data:`RENDITION_DEADLINE_SECONDS` after the request
arrived, waiting time included: no page is rendered for a caller that stopped waiting.

Every byte here is a person's data: returned to the API, never logged.
"""

from __future__ import annotations

import base64
import io
import time
import warnings
from dataclasses import dataclass, replace
from http import HTTPStatus
from typing import Annotated, Final, Literal, NoReturn, cast

from fastapi import APIRouter, Depends, File, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError
from starlette.requests import Request
from starlette.responses import Response

from openverify_vision.auth import require_service_token
from openverify_vision.document_analysis import sniff_document
from openverify_vision.guarded import DEFAULT_LIMITS, GuardLimits
from openverify_vision.guarded.results import RenderAnswer
from openverify_vision.guarded.runner import GuardedRefusal, GuardedWorkerError, run_guarded
from openverify_vision.imaging import (
    ALLOWED_FORMATS,
    CorruptImageError,
    ImageDecodeError,
    ImageTooLargeError,
    UnsupportedImageError,
)
from openverify_vision.limits import JobLimiter
from openverify_vision.problems import ProblemError
from openverify_vision.schemas import (
    GUARDED_WORKER_FAILED,
    RENDER_MAX_SIDE_PX,
    RENDITION_IMAGE_MAX_SIDE_PX,
    RENDITION_MAX_BYTES,
    RENDITION_MAX_PAGES,
    Rendition,
    RenditionPage,
)
from openverify_vision.settings import Settings, get_settings

__all__ = [
    "GUARD_LIMITS",
    "JPEG_QUALITIES",
    "RENDITIONS_PATH",
    "RENDITION_DEADLINE_SECONDS",
    "RENDITION_LANE_QUEUED",
    "RENDITION_LANE_SLOTS",
    "RENDITION_MAX_BYTES",
    "create_rendition",
    "get_rendition_limiter",
    "render_source",
    "router",
    "run_guarded",
]

RENDITIONS_PATH: Final = "/v1/renditions"

RENDITION_LANE_SLOTS: Final = 1
"""C135.3, F25 (provisional): renditions run one at a time on a lane of their own, so the
verification jobs keep their slots (``max_concurrent_jobs``, 2 by default). A rendition holds one
decoded image of at most 40 MP, or one guarded child at a time."""

RENDITION_LANE_QUEUED: Final = 4
"""C135.3, F25 (provisional): renditions waiting for the lane's slot, holding only their
compressed bytes; more answer 503 busy with ``Retry-After``, which the API's job retries."""

RENDITION_DEADLINE_SECONDS: float = 40.0
"""Provisional, as the document analysis' deadline: the work stops this long after the request
arrived and answers 503 ``guarded_worker_failed``. The API waits 45 s for a rendition
(``DEFAULT_GUARDED_VISION_TIMEOUT_MS``), so vision never renders on for an answer the API no
longer waits for; each page's child is killed at what is left of it."""

GUARD_LIMITS: GuardLimits = DEFAULT_LIMITS
"""The guarded child's limits for a page (C60.2); its kill timer is cut to the deadline."""

JPEG_QUALITIES: Final = (90, 75, 50)
"""Provisional: the JPEG qualities tried in turn until a rendition fits
:data:`~openverify_vision.schemas.RENDITION_MAX_BYTES`; 90 keeps a document's text sharp."""

_WHITE: Final = (255, 255, 255, 255)
_SIXTEEN_TO_EIGHT: Final = 1 / 257

_REFUSALS: Final = {
    "pdf_encrypted": (HTTPStatus.UNPROCESSABLE_ENTITY, "the PDF is encrypted with a password"),
    "pdf_unprocessable": (HTTPStatus.UNPROCESSABLE_ENTITY, "the PDF cannot be processed"),
    "too_many_pages": (HTTPStatus.UNPROCESSABLE_ENTITY, "the PDF has more than 50 pages"),
    "unsupported_format": (HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "not a supported format"),
    "too_large": (HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "the page has too many pixels"),
    "corrupt": (HTTPStatus.UNPROCESSABLE_ENTITY, "the file could not be decoded"),
    "page_out_of_range": (HTTPStatus.UNPROCESSABLE_ENTITY, "the document has no such page"),
}
_CODED: Final = frozenset({"pdf_encrypted", "pdf_unprocessable", "too_many_pages"})

router = APIRouter(prefix="/v1", dependencies=[Depends(require_service_token)])


def get_rendition_limiter(request: Request) -> JobLimiter:
    """FastAPI dependency returning the app's rendition lane."""
    return cast("JobLimiter", request.app.state.rendition_limiter)


# --- answers -------------------------------------------------------------------------------------


def _not_in_time(reason: str) -> NoReturn:
    raise ProblemError(
        HTTPStatus.SERVICE_UNAVAILABLE,
        f"the rendition could not be made in time ({reason}); retry later",
        code=GUARDED_WORKER_FAILED,
    )


def _refused(code: str) -> ProblemError:
    status, detail = _REFUSALS[code]
    return ProblemError(status, f"source: {detail}", code=code if code in _CODED else None)


def _remaining(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        _not_in_time("deadline")
    return remaining


def _page(
    number: int, media_type: Literal["image/jpeg", "image/png"], image: bytes, size: tuple[int, int]
) -> RenditionPage:
    return RenditionPage(
        page=number,
        media_type=media_type,
        width=size[0],
        height=size[1],
        byte_size=len(image),
        data_b64=base64.b64encode(image).decode("ascii"),
    )


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _jpeg(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


# --- images --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Upright:
    image: Image.Image
    """A fresh RGB image of at most 4,096 px a side: the source's pixels only."""
    source_format: str


def _shown(image: Image.Image) -> Image.Image:
    """``image`` as 8-bit RGB as a page shows it: 16-bit grey scaled, transparency on white. The
    pixels are copied into a fresh image, so nothing of the source's ``info`` comes along."""
    if image.mode.startswith("I"):
        image = image.convert("I").point(lambda value: value * _SIXTEEN_TO_EIGHT).convert("L")
    if image.has_transparency_data:
        rgba = image.convert("RGBA")
        rgb = Image.alpha_composite(Image.new("RGBA", rgba.size, _WHITE), rgba).convert("RGB")
    else:
        rgb = image.convert("RGB")
    return Image.frombytes("RGB", rgb.size, rgb.tobytes())


def _upright(data: bytes, max_pixels: int) -> _Upright:
    """Decode ``data`` with the upload guards (as :func:`~openverify_vision.imaging.decode_image`
    does), applying its EXIF orientation, and scale it to fit the rendition's side."""
    try:
        with warnings.catch_warnings():
            # Our own max_pixels check is authoritative; Pillow's hard DecompressionBombError
            # (above twice its MAX_IMAGE_PIXELS) remains as a backstop.
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data), formats=ALLOWED_FORMATS) as image:
                width, height = image.size
                if width * height > max_pixels:
                    raise ImageTooLargeError(
                        f"image is {width}x{height} = {width * height} pixels; "
                        f"the limit is {max_pixels}"
                    )
                source_format = image.format or ""
                shown = _shown(ImageOps.exif_transpose(image))
    except ImageDecodeError:
        raise
    except Image.DecompressionBombError as exc:
        raise ImageTooLargeError("image dimensions exceed the decompression-bomb limit") from exc
    except UnidentifiedImageError as exc:  # subclass of OSError, so it must come first
        allowed = ", ".join(ALLOWED_FORMATS)
        raise UnsupportedImageError(f"not a supported image; allowed formats: {allowed}") from exc
    except Exception as exc:  # any decoder failure on untrusted bytes counts as "corrupt"
        raise CorruptImageError("image data could not be decoded") from exc
    side = RENDITION_IMAGE_MAX_SIDE_PX
    if max(shown.size) > side:
        shown.thumbnail((side, side), Image.Resampling.LANCZOS)
    return _Upright(shown, source_format)


def _encoded(upright: _Upright) -> tuple[Literal["image/jpeg", "image/png"], bytes]:
    """The first encoding that fits the byte limit: a PNG first unless the source was a JPEG,
    then JPEG at each of :data:`JPEG_QUALITIES`."""
    if upright.source_format != "JPEG":
        png = _png(upright.image)
        if len(png) <= RENDITION_MAX_BYTES:
            return "image/png", png
    for quality in JPEG_QUALITIES:
        jpeg = _jpeg(upright.image, quality)
        if len(jpeg) <= RENDITION_MAX_BYTES:
            return "image/jpeg", jpeg
    raise ProblemError(
        HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
        f"source: the rendition would exceed the {RENDITION_MAX_BYTES}-byte limit",
    )


def _image_rendition(data: bytes, settings: Settings) -> Rendition:
    try:
        upright = _upright(data, settings.max_image_pixels)
    except UnsupportedImageError as exc:
        raise ProblemError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, f"source: {exc}") from exc
    except ImageTooLargeError as exc:
        raise ProblemError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, f"source: {exc}") from exc
    except CorruptImageError as exc:
        raise ProblemError(HTTPStatus.UNPROCESSABLE_ENTITY, f"source: {exc}") from exc
    media_type, encoded = _encoded(upright)
    return Rendition(
        source="image",
        page_count=1,
        truncated=False,
        pages=[_page(1, media_type, encoded, upright.image.size)],
    )


# --- PDFs ----------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _RenderedPage:
    page_count: int
    page: RenditionPage


def _rendered(data: bytes, number: int, deadline: float) -> _RenderedPage:
    """Page ``number`` rendered by a guarded child killed at the deadline at the latest."""
    limits = replace(
        GUARD_LIMITS, wall_seconds=min(GUARD_LIMITS.wall_seconds, _remaining(deadline))
    )
    params: dict[str, object] = {"page": number, "max_side": RENDER_MAX_SIDE_PX}
    try:
        answer = run_guarded("render_pdf_page", data, params, limits=limits)
    except GuardedRefusal as refusal:
        raise _refused(refusal.code) from refusal
    except GuardedWorkerError as failure:
        # The child stopped on its own limits (CPU, address space, output): the same PDF would
        # stop it again, so it is refused, as the document analysis refuses it (5C review P003).
        if failure.over_limits:
            raise _refused("pdf_unprocessable") from failure
        _not_in_time(failure.reason)
    try:
        header = RenderAnswer.model_validate(answer.header)
    except ValidationError:
        _not_in_time("malformed_output")
    raster = header.raster
    if raster.width > RENDER_MAX_SIDE_PX or raster.height > RENDER_MAX_SIDE_PX:
        _not_in_time("raster_size")
    if raster.frame >= len(answer.frames):
        _not_in_time("missing_frame")
    rgb = answer.frames[raster.frame]
    size = (raster.width, raster.height)
    if len(rgb) != raster.width * raster.height * 3:
        _not_in_time("frame_size")
    png = _png(Image.frombytes("RGB", size, rgb))
    return _RenderedPage(header.page_count, _page(number, "image/png", png, size))


def _pdf_rendition(data: bytes, deadline: float) -> Rendition:
    first = _rendered(data, 1, deadline)
    count = first.page_count
    pages = [first.page]
    for number in range(2, min(count, RENDITION_MAX_PAGES) + 1):
        rendered = _rendered(data, number, deadline)
        if rendered.page_count != count:
            _not_in_time("page_count")
        pages.append(rendered.page)
    return Rendition(
        source="pdf", page_count=count, truncated=count > RENDITION_MAX_PAGES, pages=pages
    )


# --- the route -----------------------------------------------------------------------------------


def render_source(data: bytes, settings: Settings, deadline: float) -> Rendition:
    """The rendition of ``data``: an image's one page or a PDF's first 20, until ``deadline``
    (a :func:`time.monotonic` instant)."""
    _remaining(deadline)
    kind = sniff_document(data)
    if kind is None:
        raise ProblemError(
            HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "source: not a PDF or a JPEG, PNG or WebP image"
        )
    if kind == "image":
        return _image_rendition(data, settings)
    return _pdf_rendition(data, deadline)


async def _read(upload: UploadFile, settings: Settings) -> bytes:
    data = await upload.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise ProblemError(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            f"source: the file exceeds the {settings.max_upload_bytes}-byte upload limit",
        )
    return data


@router.post(RENDITIONS_PATH.removeprefix("/v1"), response_model=Rendition)
async def create_rendition(
    source: Annotated[UploadFile, File(description="A JPEG, PNG, WebP or PDF file")],
    settings: Annotated[Settings, Depends(get_settings)],
    limiter: Annotated[JobLimiter, Depends(get_rendition_limiter)],
) -> Response:
    """What a reviewer may see of ``source``: an image upright and without metadata, re-encoded
    as a JPEG or PNG of at most 4,096 px a side, or a PDF's first 20 pages as PNG images of at
    most 1,600 px a side rendered by the guarded child. Runs on the rendition lane."""
    deadline = time.monotonic() + RENDITION_DEADLINE_SECONDS
    data = await _read(source, settings)
    answer = await limiter.run(render_source, data, settings, deadline)
    # The answer was validated when it was built; it is sent as it is, not validated again.
    return Response(content=answer.model_dump_json(), media_type="application/json")
