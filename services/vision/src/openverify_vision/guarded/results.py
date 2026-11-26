"""C60.2: the parent's pydantic models of the guarded child's answers.

The child cannot load pydantic (C60.2), so it answers plain JSON; the parent validates every
answer here before it trusts a number of it, and checks each binary frame against the size the
header declares. Anything that does not validate is a worker failure (503), never a measurement.
Parent only: the child never imports this module.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from openverify_vision.schemas import (
    MAX_ANALYSED_PAGES,
    MAX_DOCUMENT_PAGES,
    MAX_PAGE_SIDE_PT,
    MAX_PDF_FONTS,
    BoundingBox,
    PdfFont,
    TextLayerLine,
)
from openverify_vision.schemas import MAX_DOCUMENT_LINES as _MAX_LINES

FrameIndex = Annotated[int, Field(ge=0, le=15)]
Side = Annotated[int, Field(gt=0, le=1_000_000)]


class _Answer(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class RasterRef(_Answer):
    """A raster the header names: its frame and size (rows are tight)."""

    frame: FrameIndex
    width: Side
    height: Side


class EmbeddedJpeg(_Answer):
    """The first page's scan: its frame, where it lies on the page's raster and its pixels."""

    frame: FrameIndex
    box: BoundingBox
    pixel_width: Side
    pixel_height: Side
    axis_aligned: bool


class PageAnswer(_Answer):
    number: Annotated[int, Field(ge=1, le=MAX_DOCUMENT_PAGES)]
    width_pt: Annotated[float, Field(gt=0.0, le=MAX_PAGE_SIDE_PT)]
    height_pt: Annotated[float, Field(gt=0.0, le=MAX_PAGE_SIDE_PT)]
    raster: RasterRef
    text_layer: list[TextLayerLine] = Field(max_length=_MAX_LINES)
    embedded_jpeg: EmbeddedJpeg | None


class Versions(_Answer):
    pdf_renderer: Annotated[str, Field(min_length=1, max_length=64)]
    pdf_parser: Annotated[str, Field(min_length=1, max_length=64)] | None


class PdfAnalysisAnswer(_Answer):
    """``analyze_pdf``: ``pdf`` holds every ``PdfMeasurements`` field but ``fonts``."""

    ok: Literal[True]
    page_count: Annotated[int, Field(ge=1, le=MAX_DOCUMENT_PAGES)]
    pages: list[PageAnswer] = Field(min_length=1, max_length=MAX_ANALYSED_PAGES)
    fonts: list[PdfFont] = Field(max_length=MAX_PDF_FONTS)
    pdf: dict[str, Any]
    versions: Versions


class RenderAnswer(_Answer):
    """``render_pdf_page``: one RGB raster."""

    ok: Literal[True]
    page_count: Annotated[int, Field(ge=1, le=MAX_DOCUMENT_PAGES)]
    raster: RasterRef


class PortraitAnswer(_Answer):
    """``decode_portrait``: one RGB raster."""

    ok: Literal[True]
    format: Literal["JPEG", "JPEG2000"]
    raster: RasterRef
