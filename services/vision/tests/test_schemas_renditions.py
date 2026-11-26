"""C135.3: the rendition contract of ``POST /v1/renditions`` (Workflow 8B Stage 1a).

The golden fixtures (an image and a two-page PDF, flat synthetic pixels) validate and round-trip;
each model refuses what the contract rules out. The API validates the same files with zod.
"""

from __future__ import annotations

import base64
import copy
import io
import json
from pathlib import Path
from typing import Any

import pytest
from PIL import Image
from pydantic import ValidationError

from make_contract_fixtures import synthetic_png
from openverify_vision.schemas import (
    RENDER_MAX_SIDE_PX,
    RENDITION_IMAGE_MAX_SIDE_PX,
    RENDITION_MAX_BYTES,
    RENDITION_MAX_PAGES,
    Rendition,
    RenditionPage,
)

FIXTURES = Path(__file__).resolve().parents[3] / "contracts" / "fixtures" / "vision"


def fixture(name: str) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return loaded


def page(number: int, data: bytes, media_type: str, width: int, height: int) -> dict[str, Any]:
    return {
        "page": number,
        "media_type": media_type,
        "width": width,
        "height": height,
        "byte_size": len(data),
        "data_b64": base64.b64encode(data).decode("ascii"),
    }


def png_page(number: int, width: int = 3, height: int = 4) -> dict[str, Any]:
    return page(number, synthetic_png(width, height, (255, 255, 255)), "image/png", width, height)


def jpeg_bytes() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (8, 6), (200, 180, 160)).save(out, format="JPEG")
    return out.getvalue()


def test_the_limits_are_the_contracts() -> None:
    assert RENDITION_MAX_PAGES == 20
    assert RENDITION_IMAGE_MAX_SIDE_PX == 4_096
    assert RENDITION_MAX_BYTES == 16 * 1024 * 1024
    assert RENDER_MAX_SIDE_PX == 1_600


@pytest.mark.parametrize("name", ["rendition-image.json", "rendition-pdf.json"])
def test_the_golden_renditions_validate_and_round_trip(name: str) -> None:
    raw = fixture(name)
    assert Rendition.model_validate(raw).model_dump(mode="json") == raw


def test_a_jpeg_page_is_a_jpeg() -> None:
    data = jpeg_bytes()
    RenditionPage.model_validate(page(1, data, "image/jpeg", 8, 6))
    with pytest.raises(ValidationError, match="JPEG start of image"):
        RenditionPage.model_validate(page(1, synthetic_png(8, 6, (1, 2, 3)), "image/jpeg", 8, 6))


def test_a_png_page_states_its_own_size_and_length() -> None:
    good = png_page(1, 3, 4)
    RenditionPage.model_validate(good)
    with pytest.raises(ValidationError, match="IHDR"):
        RenditionPage.model_validate({**good, "width": 4, "height": 3})
    with pytest.raises(ValidationError, match="decoded length"):
        RenditionPage.model_validate({**good, "byte_size": good["byte_size"] + 1})
    with pytest.raises(ValidationError, match="IHDR"):
        RenditionPage.model_validate(page(1, jpeg_bytes(), "image/png", 8, 6))
    with pytest.raises(ValidationError, match="standard base64"):
        RenditionPage.model_validate({**good, "data_b64": good["data_b64"][:-1] + "-"})


def test_a_page_stays_within_its_bounds() -> None:
    good = png_page(1)
    for patch in (
        {"page": 0},
        {"page": RENDITION_MAX_PAGES + 1},
        {"width": RENDITION_IMAGE_MAX_SIDE_PX + 1},
        {"byte_size": RENDITION_MAX_BYTES + 1},
        {"media_type": "image/webp"},
    ):
        with pytest.raises(ValidationError):
            RenditionPage.model_validate({**good, **patch})


def test_pages_are_numbered_in_order_and_all_rendered_up_to_twenty() -> None:
    pdf = fixture("rendition-pdf.json")
    swapped = copy.deepcopy(pdf)
    swapped["pages"].reverse()
    with pytest.raises(ValidationError, match="numbered from 1"):
        Rendition.model_validate(swapped)
    with pytest.raises(ValidationError, match="up to 20"):
        Rendition.model_validate({**pdf, "page_count": 3})
    long = {
        "source": "pdf",
        "page_count": 23,
        "truncated": True,
        "pages": [png_page(number) for number in range(1, RENDITION_MAX_PAGES + 1)],
    }
    Rendition.model_validate(long)
    with pytest.raises(ValidationError, match="truncated"):
        Rendition.model_validate({**long, "truncated": False})
    with pytest.raises(ValidationError, match="truncated"):
        Rendition.model_validate({**pdf, "truncated": True})


def test_an_image_is_one_page_and_a_pdf_page_a_small_png() -> None:
    image = fixture("rendition-image.json")
    with pytest.raises(ValidationError, match="one page"):
        Rendition.model_validate({**image, "page_count": 2, "pages": [png_page(1), png_page(2)]})
    jpeg_pdf = {"source": "pdf", "page_count": 1, "truncated": False}
    with pytest.raises(ValidationError, match="PNG images of at most"):
        Rendition.model_validate({**jpeg_pdf, "pages": [page(1, jpeg_bytes(), "image/jpeg", 8, 6)]})
    wide = png_page(1, RENDER_MAX_SIDE_PX + 1, 1)
    with pytest.raises(ValidationError, match="PNG images of at most"):
        Rendition.model_validate({**jpeg_pdf, "pages": [wide]})
    Rendition.model_validate({**image, "pages": [png_page(1, RENDER_MAX_SIDE_PX + 1, 1)]})
