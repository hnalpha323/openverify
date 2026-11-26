"""C135.3 (Workflow 8B): ``POST /v1/renditions``, what a reviewer may see of a file.

An image is decoded with the upload guards, turned upright by its EXIF orientation, stripped of
every metadata segment and re-encoded; a PDF's pages are rendered by the guarded child as PNG
images; what cannot be decoded is refused. Renditions run on a limiter lane of their own (one
slot, four queued, F25), so the verification jobs keep their slots while renditions queue.

Every image here is synthetic and every PDF comes from ``document_pdfs`` (invented names only).
"""

from __future__ import annotations

import base64
import io
import threading
import zlib
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Final, ParamSpec, TypeVar

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from PIL import ExifTags, Image, ImageCms, PngImagePlugin

import document_pdfs as pdfs
from openverify_vision import renditions
from openverify_vision.app import MULTIPART_OVERHEAD_BYTES, create_app
from openverify_vision.guarded import GuardLimits
from openverify_vision.guarded.runner import GuardedAnswer, GuardedRefusal, GuardedWorkerError
from openverify_vision.limits import JobLimiter
from openverify_vision.schemas import (
    GUARDED_WORKER_FAILED,
    RENDER_MAX_SIDE_PX,
    RENDITION_IMAGE_MAX_SIDE_PX,
    RENDITION_MAX_PAGES,
    Rendition,
)
from openverify_vision.settings import Settings

from synthetic import encode, gaussian_blur, make_checkerboard, make_noise

TOKEN: Final = "r" * 40
AUTH: Final = {"x-service-token": TOKEN}
PROBLEM: Final = "application/problem+json"
PATH: Final = "/v1/renditions"

WAIT_SECONDS: Final = 20.0
"""Upper bound on every wait in the lane tests, so a regression fails instead of hanging."""

JPEG_MARKERS_KEPT: Final = frozenset({0xE0, 0xDB, 0xC0, 0xC4, 0xDD, 0xDA})
"""What a re-encoded JPEG may hold: the JFIF APP0, quantisation and Huffman tables, the baseline
frame header, a restart interval and the scan. No APP1 to APP15 (EXIF, XMP, ICC, IPTC, Adobe)
and no COM."""

PNG_CHUNKS_KEPT: Final = frozenset({b"IHDR", b"IDAT", b"IEND"})
"""What a re-encoded PNG may hold: no text, EXIF, ICC, time, physical size or gamma chunk."""

NAME: Final = "Quinn Valemont"
"""An invented name written into the metadata of the inputs, which no rendition may carry."""


def make_client(**overrides: object) -> TestClient:
    settings = Settings.model_validate({"service_token": TOKEN, **overrides})
    return TestClient(create_app(settings), raise_server_exceptions=False)


def post(client: TestClient, data: bytes, name: str = "source.bin") -> Response:
    return client.post(
        PATH, files={"source": (name, data, "application/octet-stream")}, headers=AUTH
    )


def rendition(response: Response) -> Rendition:
    assert response.status_code == 200, response.text
    return Rendition.model_validate(response.json())


def problem(response: Response, status: int) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith(PROBLEM)
    body: dict[str, Any] = response.json()
    assert body["status"] == status
    return body


def page_bytes(answer: Rendition, index: int = 0) -> bytes:
    return base64.b64decode(answer.pages[index].data_b64)


def jpeg_markers(data: bytes) -> list[int]:
    """The marker of every segment of a JPEG up to its first scan."""
    assert data[:2] == b"\xff\xd8"
    markers: list[int] = []
    position = 2
    while position < len(data):
        assert data[position] == 0xFF
        marker = data[position + 1]
        markers.append(marker)
        if marker == 0xDA:
            break
        position += 2 + int.from_bytes(data[position + 2 : position + 4], "big")
    return markers


def png_chunks(data: bytes) -> list[bytes]:
    """The type of every chunk of a PNG."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    chunks: list[bytes] = []
    position = 8
    while position < len(data):
        length = int.from_bytes(data[position : position + 4], "big")
        chunks.append(data[position + 4 : position + 8])
        position += 12 + length
    return chunks


def gps_exif(orientation: int = 1) -> Image.Exif:
    exif = Image.Exif()
    exif[ExifTags.Base.Make] = "Utopia Optics"
    exif[ExifTags.Base.Artist] = NAME
    exif[ExifTags.Base.Orientation] = orientation
    exif[ExifTags.IFD.GPSInfo] = {
        ExifTags.GPS.GPSLatitudeRef: "N",
        ExifTags.GPS.GPSLatitude: (45.0, 30.0, 17.0),
        ExifTags.GPS.GPSLongitudeRef: "W",
        ExifTags.GPS.GPSLongitude: (73.0, 34.0, 11.0),
    }
    return exif


def srgb_profile() -> bytes:
    profile: bytes = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    return profile


def save(image: Image.Image, fmt: str, **options: Any) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **options)
    return buffer.getvalue()


def halves(width: int = 40, height: int = 20) -> Image.Image:
    """Red on the left half, blue on the right."""
    image = Image.new("RGB", (width, height), (0, 0, 255))
    image.paste((255, 0, 0), (0, 0, width // 2, height))
    return image


def with_ihdr_size(png: bytes, width: int, height: int) -> bytes:
    """``png`` with its IHDR claiming ``width`` x ``height`` (and a CRC that matches)."""
    header = bytearray(png)
    header[16:20] = width.to_bytes(4, "big")
    header[20:24] = height.to_bytes(4, "big")
    header[29:33] = zlib.crc32(bytes(header[12:29])).to_bytes(4, "big")
    return bytes(header)


# --- the route ---------------------------------------------------------------------------------


def test_the_route_needs_the_service_token() -> None:
    response = make_client().post(PATH, files={"source": ("a.png", save(halves(), "PNG"))})
    problem(response, 401)


def test_the_route_has_the_body_limit_of_one_upload() -> None:
    # 1,000-byte uploads: one upload's limit is 1,000 + 64 KiB, three uploads' 3,000 + 64 KiB.
    client = make_client(max_upload_bytes=1_000)
    single = 1_000 + MULTIPART_OVERHEAD_BYTES
    body = b"x" * (single + 1_000)
    response = client.post(
        PATH,
        content=body,
        headers={**AUTH, "content-type": "multipart/form-data; boundary=b"},
    )
    assert f"{single}-byte limit" in problem(response, 413)["detail"]


def test_an_upload_over_the_upload_limit_is_413() -> None:
    response = post(make_client(max_upload_bytes=1_000), save(halves(400, 400), "PNG"))
    assert "upload limit" in problem(response, 413)["detail"]


# --- images ------------------------------------------------------------------------------------


def test_a_jpeg_with_gps_exif_comes_back_without_it() -> None:
    source = save(halves(), "JPEG", quality=95, exif=gps_exif())
    assert b"Utopia Optics" in source

    answer = rendition(post(make_client(), source, "photo.jpg"))

    assert (answer.source, answer.page_count, answer.truncated) == ("image", 1, False)
    page = answer.pages[0]
    assert (page.page, page.media_type, page.width, page.height) == (1, "image/jpeg", 40, 20)
    data = page_bytes(answer)
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "JPEG"
        assert len(image.getexif()) == 0
        assert image.getexif().get_ifd(ExifTags.IFD.GPSInfo) == {}
    assert b"Exif" not in data
    assert b"Utopia Optics" not in data
    assert NAME.encode() not in data


def test_every_metadata_segment_of_a_jpeg_is_stripped() -> None:
    source = save(
        halves(),
        "JPEG",
        exif=gps_exif(),
        icc_profile=srgb_profile(),
        comment=NAME.encode(),
        dpi=(300, 300),
    )
    assert {0xE1, 0xE2, 0xFE} <= set(jpeg_markers(source))

    data = page_bytes(rendition(post(make_client(), source)))

    markers = jpeg_markers(data)
    assert set(markers) <= JPEG_MARKERS_KEPT, [hex(marker) for marker in markers]
    assert NAME.encode() not in data


def test_the_exif_orientation_is_applied() -> None:
    # Orientation 6: the stored image is shown turned 90 degrees clockwise, so its left half
    # (red) is on top once it is upright.
    source = save(halves(40, 20), "JPEG", quality=95, exif=gps_exif(orientation=6))

    answer = rendition(post(make_client(), source))

    assert (answer.pages[0].width, answer.pages[0].height) == (20, 40)
    with Image.open(io.BytesIO(page_bytes(answer))) as image:
        rgb = image.convert("RGB")
        top, bottom = rgb.getpixel((10, 5)), rgb.getpixel((10, 34))
    assert isinstance(top, tuple)
    assert isinstance(bottom, tuple)
    assert top[0] > 200 > top[2]
    assert bottom[2] > 200 > bottom[0]


def test_a_png_text_chunk_is_stripped() -> None:
    info = PngImagePlugin.PngInfo()
    info.add_text("Author", NAME)
    info.add_text("Comment", NAME, zip=True)
    info.add_itxt("Description", NAME)
    source = save(
        halves(), "PNG", pnginfo=info, exif=gps_exif(), icc_profile=srgb_profile(), dpi=(72, 72)
    )
    assert {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"iCCP", b"pHYs"} <= set(png_chunks(source))

    answer = rendition(post(make_client(), source, "scan.png"))

    page = answer.pages[0]
    assert (page.media_type, page.width, page.height) == ("image/png", 40, 20)
    data = page_bytes(answer)
    assert set(png_chunks(data)) <= PNG_CHUNKS_KEPT
    assert NAME.encode() not in data
    with Image.open(io.BytesIO(data)) as image:
        assert image.info == {}


def test_a_webp_is_a_png_without_its_metadata() -> None:
    source = save(halves(), "WEBP", lossless=True, exif=gps_exif(), icc_profile=srgb_profile())

    answer = rendition(post(make_client(), source))

    data = page_bytes(answer)
    assert answer.pages[0].media_type == "image/png"
    assert set(png_chunks(data)) <= PNG_CHUNKS_KEPT
    assert b"Utopia Optics" not in data


def test_a_transparent_area_is_shown_on_white() -> None:
    image = Image.new("RGBA", (16, 16), (255, 0, 0, 0))
    image.paste((0, 0, 255, 255), (8, 0, 16, 16))

    answer = rendition(post(make_client(), save(image, "PNG")))

    with Image.open(io.BytesIO(page_bytes(answer))) as shown:
        assert shown.mode == "RGB"
        assert shown.getpixel((2, 2)) == (255, 255, 255)
        assert shown.getpixel((12, 2)) == (0, 0, 255)


def test_sixteen_bit_grey_is_scaled_not_clipped() -> None:
    grey = Image.new("I;16", (8, 8), 0x8080)

    answer = rendition(post(make_client(), save(grey, "PNG")))

    with Image.open(io.BytesIO(page_bytes(answer))) as shown:
        assert shown.convert("RGB").getpixel((4, 4)) == (128, 128, 128)


def test_an_image_over_the_side_limit_is_scaled_down() -> None:
    wide = Image.new("RGB", (RENDITION_IMAGE_MAX_SIDE_PX + 904, 100), (10, 120, 30))

    answer = rendition(post(make_client(), save(wide, "PNG")))

    assert (answer.pages[0].width, answer.pages[0].height) == (RENDITION_IMAGE_MAX_SIDE_PX, 82)


def test_a_png_too_large_for_the_byte_limit_falls_back_to_jpeg(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Blurred noise: about 330 KB as a PNG and about 52 KB as a JPEG at quality 90.
    noisy = encode(gaussian_blur(make_noise(512, 512), 2.0), "PNG")
    assert len(noisy) > 60_000
    monkeypatch.setattr(renditions, "RENDITION_MAX_BYTES", 60_000)

    answer = rendition(post(make_client(), noisy))

    assert answer.pages[0].media_type == "image/jpeg"
    assert answer.pages[0].byte_size <= 60_000


def test_an_image_no_encoding_fits_is_413(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(renditions, "RENDITION_MAX_BYTES", 10)

    response = post(make_client(), save(halves(), "PNG"))

    assert "rendition" in problem(response, 413)["detail"]


@pytest.mark.parametrize(
    ("width", "height"),
    [
        (8_000, 6_000),  # 48 MP: over the service's 40 MP, under Pillow's own bound
        (20_000, 20_000),  # 400 MP: past Pillow's decompression-bomb bound, refused at open
    ],
)
def test_a_decompression_bomb_is_refused(width: int, height: int) -> None:
    bomb = with_ihdr_size(save(Image.new("RGB", (8, 8), (1, 2, 3)), "PNG"), width, height)

    response = post(make_client(), bomb)

    assert "pixels" in problem(response, 413)["detail"] or "bomb" in response.text


def test_an_image_over_the_configured_pixels_is_413() -> None:
    response = post(make_client(max_image_pixels=100), save(halves(), "PNG"))
    problem(response, 413)


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"GIF89a" + b"\x00" * 64,
        b"plain text, neither an image nor a PDF",
        # A PNG's signature that no decoder can identify as a PNG.
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 64,
    ],
)
def test_what_is_neither_an_image_nor_a_pdf_is_415(data: bytes) -> None:
    problem(post(make_client(), data), 415)


@pytest.mark.parametrize(
    "data",
    [
        save(halves(400, 300), "JPEG")[:600],
        b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 64,
    ],
    ids=["truncated-jpeg", "broken-webp"],
)
def test_a_corrupt_image_is_422(data: bytes) -> None:
    problem(post(make_client(), data), 422)


# --- PDFs --------------------------------------------------------------------------------------


def test_a_pdf_gives_page_images() -> None:
    answer = rendition(post(make_client(), pdfs.many_pages(3), "statement.pdf"))

    assert (answer.source, answer.page_count, answer.truncated) == ("pdf", 3, False)
    assert [page.page for page in answer.pages] == [1, 2, 3]
    for index, page in enumerate(answer.pages):
        data = page_bytes(answer, index)
        assert page.media_type == "image/png"
        assert max(page.width, page.height) == RENDER_MAX_SIDE_PX
        assert set(png_chunks(data)) <= PNG_CHUNKS_KEPT
        with Image.open(io.BytesIO(data)) as image:
            assert image.size == (page.width, page.height)


def test_a_bill_page_renders_its_metadata_nowhere() -> None:
    answer = rendition(post(make_client(), pdfs.bill()))

    data = page_bytes(answer)
    assert answer.page_count == 1
    assert b"Utopia" not in data


def test_a_pdf_over_20_pages_is_rendered_to_20_and_truncated() -> None:
    answer = rendition(post(make_client(), pdfs.many_pages(RENDITION_MAX_PAGES + 3)))

    assert (answer.page_count, answer.truncated) == (RENDITION_MAX_PAGES + 3, True)
    assert [page.page for page in answer.pages] == list(range(1, RENDITION_MAX_PAGES + 1))


def test_a_pdf_over_the_guards_50_pages_is_refused_with_its_code() -> None:
    response = post(make_client(), pdfs.many_pages(51))
    assert problem(response, 422)["code"] == "too_many_pages"


def test_an_encrypted_pdf_is_refused_with_its_code() -> None:
    response = post(make_client(), pdfs.encrypted("user-secret"))
    assert problem(response, 422)["code"] == "pdf_encrypted"


def test_a_pdf_the_guard_cannot_read_is_refused_with_its_code() -> None:
    response = post(make_client(), b"%PDF-1.7\n" + b"\x00" * 64)
    assert problem(response, 422)["code"] == "pdf_unprocessable"


P = ParamSpec("P")
R = TypeVar("R")


def failing(error: Exception) -> Callable[..., GuardedAnswer]:
    def run(*_args: object, **_kwargs: object) -> GuardedAnswer:
        raise error

    return run


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (GuardedWorkerError("timeout"), 503, GUARDED_WORKER_FAILED),
        (GuardedWorkerError("exit_status", over_limits=True), 422, "pdf_unprocessable"),
        (GuardedRefusal("corrupt"), 422, None),
    ],
)
def test_a_child_that_fails_answers_what_the_guard_says(
    monkeypatch: pytest.MonkeyPatch, error: Exception, status: int, code: str | None
) -> None:
    monkeypatch.setattr(renditions, "run_guarded", failing(error))

    body = problem(post(make_client(), pdfs.bill()), status)

    assert body.get("code") == code


def render_answer(page_count: int, width: int = 3, height: int = 4) -> GuardedAnswer:
    header = {
        "ok": True,
        "page_count": page_count,
        "raster": {"frame": 0, "width": width, "height": height},
    }
    return GuardedAnswer(header=header, frames=(b"\xff" * (width * height * 3),))


@pytest.mark.parametrize(
    "answers",
    [
        [GuardedAnswer(header={"ok": True, "page_count": 1}, frames=())],
        [GuardedAnswer(header=render_answer(1).header, frames=(b"\xff",))],
        [render_answer(1, RENDER_MAX_SIDE_PX + 1, 1)],
        [GuardedAnswer(header=render_answer(1).header, frames=())],
        [render_answer(2), render_answer(3)],
    ],
    ids=["no-raster", "frame-size", "raster-size", "missing-frame", "page-count-changed"],
)
def test_a_child_answer_that_does_not_hold_is_503(
    monkeypatch: pytest.MonkeyPatch, answers: list[GuardedAnswer]
) -> None:
    queue = iter(answers)
    monkeypatch.setattr(renditions, "run_guarded", lambda *_args, **_kwargs: next(queue))

    body = problem(post(make_client(), pdfs.many_pages(2)), 503)

    assert body["code"] == GUARDED_WORKER_FAILED


def test_each_child_is_given_at_most_what_is_left_of_the_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    given: list[GuardLimits] = []

    def spy(task: str, data: bytes, params: dict[str, object], *, limits: GuardLimits) -> Any:
        given.append(limits)
        assert (task, params["max_side"]) == ("render_pdf_page", RENDER_MAX_SIDE_PX)
        return render_answer(2)

    monkeypatch.setattr(renditions, "RENDITION_DEADLINE_SECONDS", 7.0)
    monkeypatch.setattr(renditions, "run_guarded", spy)

    answer = rendition(post(make_client(), pdfs.many_pages(2)))

    assert answer.page_count == 2
    assert len(given) == 2
    assert all(0 < limits.wall_seconds <= 7.0 for limits in given)
    assert all(limits.cpu_seconds == renditions.GUARD_LIMITS.cpu_seconds for limits in given)


@pytest.mark.parametrize("make_source", [pdfs.bill, lambda: save(halves(), "PNG")])
def test_work_past_the_deadline_is_503(
    monkeypatch: pytest.MonkeyPatch, make_source: Callable[[], bytes]
) -> None:
    monkeypatch.setattr(renditions, "RENDITION_DEADLINE_SECONDS", 0.0)

    body = problem(post(make_client(), make_source()), 503)

    assert body["code"] == GUARDED_WORKER_FAILED


# --- the lane ----------------------------------------------------------------------------------


class CountingLane(JobLimiter):
    """The rendition lane, telling the test once ``expected`` renditions reached it."""

    def __init__(self, expected: int) -> None:
        super().__init__(renditions.RENDITION_LANE_SLOTS, renditions.RENDITION_LANE_QUEUED)
        self.expected = expected
        self.reached = threading.Event()
        self._count = 0

    async def run(self, func: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R:
        # Admission happens in JobLimiter.run before its first await, so by the time the event
        # loop serves another request this one is admitted (running or queued).
        self._count += 1
        if self._count == self.expected:
            self.reached.set()
        return await super().run(func, *args, **kwargs)


def test_the_lane_is_one_slot_and_four_queued() -> None:
    assert (renditions.RENDITION_LANE_SLOTS, renditions.RENDITION_LANE_QUEUED) == (1, 4)
    app = create_app(Settings.model_validate({"service_token": TOKEN}))
    lane = app.state.rendition_limiter
    assert isinstance(lane, JobLimiter)
    assert lane is not app.state.job_limiter


def test_verification_keeps_its_slots_while_renditions_queue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    held = threading.Event()
    release = threading.Event()
    render = renditions.render_source

    def holding(*args: Any) -> Rendition:
        held.set()
        release.wait(WAIT_SECONDS)
        return render(*args)

    monkeypatch.setattr(renditions, "render_source", holding)
    lane_size = renditions.RENDITION_LANE_SLOTS + renditions.RENDITION_LANE_QUEUED
    settings = Settings.model_validate(
        {"service_token": TOKEN, "max_concurrent_jobs": 1, "max_queued_jobs": 0}
    )
    app = create_app(settings)
    lane = CountingLane(lane_size)
    app.state.rendition_limiter = lane
    source = save(halves(), "PNG")
    with (
        TestClient(app, raise_server_exceptions=False) as client,
        ThreadPoolExecutor(max_workers=lane_size) as pool,
    ):
        queued = [pool.submit(post, client, source) for _ in range(lane_size)]
        assert lane.reached.wait(WAIT_SECONDS)
        assert held.wait(WAIT_SECONDS)

        busy = post(client, source)
        quality = client.post(
            "/v1/quality",
            files={"image": ("image.png", encode(make_checkerboard(), "PNG"), "image/png")},
            headers=AUTH,
        )
        release.set()
        answers = [future.result(timeout=WAIT_SECONDS) for future in queued]

    assert "busy" in problem(busy, 503)["detail"]
    assert int(busy.headers["retry-after"]) > 0
    assert quality.status_code == 200, quality.text
    assert [answer.status_code for answer in answers] == [200] * lane_size
