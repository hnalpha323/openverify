"""Response models for the C6 vision contract (``docs/plans/phase-1.plan.md``), with the C32.1
government ID analysis v2 (``docs/plans/phase-3.plan.md``).

JSON field names are snake_case. Optional parts of a response (``back``, ``left``, ``right``,
``portrait`` and ``face``) are always present and ``null`` when absent. The golden fixtures in
``contracts/fixtures/vision/`` are validated against these models, and the API worker
validates the same fixtures with zod.
"""

from __future__ import annotations

import base64
import math
import re
from typing import Annotated, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

EMBEDDING_DIMENSIONS: Final = 128
"""Length of an SFace embedding."""

UNIT_NORM_TOLERANCE: Final = 1e-3
"""Embeddings are L2-normalised; allowed deviation of their norm from 1."""

BoundingBox = tuple[float, float, float, float]
"""``(x, y, width, height)`` in pixels of the EXIF-upright uploaded image."""


class _Contract(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class ModelVersions(_Contract):
    detector: str = Field(min_length=1)
    recognizer: str = Field(min_length=1)


class ImageQuality(_Contract):
    """Whole-image quality metrics and the flags derived from the configured thresholds."""

    blur_score: float = Field(ge=0.0)
    is_blurry: bool
    glare_ratio: float = Field(ge=0.0, le=1.0)
    has_glare: bool
    brightness: float = Field(ge=0.0, le=1.0)
    is_too_dark: bool
    is_too_bright: bool


class DetectedFace(_Contract):
    bbox: BoundingBox
    score: float = Field(ge=0.0, le=1.0)
    """Detector confidence."""

    @field_validator("bbox")
    @classmethod
    def _positive_size(cls, value: BoundingBox) -> BoundingBox:
        if value[2] <= 0 or value[3] <= 0:
            raise ValueError("bbox width and height must be positive")
        return value


class EmbeddedFace(DetectedFace):
    embedding: list[float] = Field(min_length=EMBEDDING_DIMENSIONS, max_length=EMBEDDING_DIMENSIONS)
    """L2-normalised SFace feature: cosine similarity is the dot product of two embeddings."""

    @field_validator("embedding")
    @classmethod
    def _unit_norm(cls, value: list[float]) -> list[float]:
        norm = math.sqrt(math.fsum(v * v for v in value))
        if abs(norm - 1.0) > UNIT_NORM_TOLERANCE:
            raise ValueError(f"embedding must be a unit vector, norm is {norm:.6f}")
        return value


# --- C32.1: government ID analysis v2 (Phase 3) -----------------------------------------------
#
# Vision measures; it never decides (C32.2). Every score is raw and in [0, 1] where possible, and
# thresholds live in TypeScript. A part that could not be measured is ``null`` (or ``found:
# false``), never a made-up value. OCR text, MRZ lines and barcode payloads are PII: they are
# returned to the API and never logged (C32.5).

Point = tuple[float, float]
"""``(x, y)`` in pixels."""

Quad = tuple[Point, Point, Point, Point]
"""Four corners clockwise from the top left, in pixels of the EXIF-upright upload."""

MAX_TEXT_LINES: Final = 200
"""Most visual-zone OCR lines one side reports."""

MAX_TEXT_LENGTH: Final = 200
"""Most characters in one OCR line."""

MAX_MRZ_LINES: Final = 3
"""Lines in the largest MRZ layout (TD1)."""

MAX_MRZ_LINE_LENGTH: Final = 64
"""Characters allowed per raw MRZ line: 44 at most in ICAO 9303, with room for misreads."""

MAX_BARCODES: Final = 8
"""Most barcodes one side reports."""

MAX_BARCODE_BASE64_LENGTH: Final = 8192
"""A PDF417 holds at most about 1.1 kB, so its base64 is well under this."""

MAX_BARCODE_TEXT_LENGTH: Final = 4096

UnitInterval = Annotated[float, Field(ge=0.0, le=1.0)]
NonNegative = Annotated[float, Field(ge=0.0)]
PositiveInt = Annotated[int, Field(gt=0)]

DocumentMethod = Literal["contour", "lines", "full_frame", "text_layout", "none"]
"""How the document was found: a contour 4-gon, line intersections, the whole frame, the side's
text layout (Phase 12A: an outline under the area gate that holds the OCR lines, or the lines'
own extent grown to a card), or not."""

MrzFormat = Literal["TD1", "TD2", "TD3", "MRVA", "MRVB"]

_MRZ_LINE: Final = re.compile(r"^[A-Z0-9<]+$")
_BASE64: Final = re.compile(r"^[A-Za-z0-9+/]*={0,2}$")


def _positive_box(value: BoundingBox) -> BoundingBox:
    if value[2] <= 0 or value[3] <= 0:
        raise ValueError("box width and height must be positive")
    return value


class DocumentDetection(_Contract):
    """The document outline on the upload, and the size of the rectified (deskewed) copy.

    A quad counts only with ``area_ratio`` >= 0.3 and an aspect ratio within 12% of ID-1
    (about 1.586) or TD3 (about 1.42); otherwise a whole frame of such a ratio is the document
    (``full_frame``, a tightly cropped upload); otherwise, when the side's OCR lines show where
    the card is, the card they lie on (``text_layout``, Phase 12A); otherwise nothing was found
    (``none``).
    """

    found: bool
    quad: Quad | None
    method: DocumentMethod
    rectified_size: tuple[PositiveInt, PositiveInt] | None
    """``(width, height)`` of the rectified document in pixels."""
    aspect_ratio: NonNegative | None
    """Width over height of the best candidate; ``null`` when there was none."""
    area_ratio: UnitInterval | None
    """Share of the upload the best candidate covers; ``null`` when there was none."""

    @model_validator(mode="after")
    def _found_has_a_document(self) -> DocumentDetection:
        if self.found != (self.method != "none"):
            raise ValueError("found must be true exactly when method is not none")
        if self.found and (self.quad is None or self.rectified_size is None):
            raise ValueError("a found document has a quad and a rectified size")
        if not self.found and (self.quad is not None or self.rectified_size is not None):
            raise ValueError("a document not found has no quad and no rectified size")
        return self


class DocumentQuality(_Contract):
    """Sharpness and glare measured on the rectified document (``null`` when none was found)."""

    blur_score: NonNegative
    """Variance of the Laplacian."""
    tenengrad: NonNegative
    """Mean squared Sobel gradient magnitude."""
    width_px: PositiveInt
    height_px: PositiveInt
    glare_ratio_text: UnitInterval | None
    """Share of saturated pixels in the text regions; ``null`` without text."""
    glare_ratio_portrait: UnitInterval | None
    """Share of saturated pixels in the portrait region; ``null`` without a portrait."""


class TextLine(_Contract):
    """One visual-zone OCR line. Coordinates are in the rectified document's pixels when a
    document was found, otherwise in the upload's."""

    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    confidence: UnitInterval
    box: BoundingBox
    stroke_width_mean: NonNegative | None
    """Mean stroke width in pixels; ``null`` when the box is too small to measure."""
    stroke_width_cv: NonNegative | None
    """Coefficient of variation of the stroke width (handwriting cue)."""

    _box = field_validator("box")(_positive_box)


class MrzReading(_Contract):
    """The machine-readable zone, raw: lines are restricted to ``[A-Z0-9<]``; parsing and
    check digits are TypeScript's job (C32.1)."""

    found: bool
    format_guess: MrzFormat | None
    lines: list[str] = Field(max_length=MAX_MRZ_LINES)
    line_confidences: list[UnitInterval] = Field(max_length=MAX_MRZ_LINES)
    box: BoundingBox | None
    """In the same coordinates as the side's ``text``."""

    @field_validator("lines")
    @classmethod
    def _mrz_characters(cls, value: list[str]) -> list[str]:
        for line in value:
            if len(line) > MAX_MRZ_LINE_LENGTH or not _MRZ_LINE.match(line):
                raise ValueError(
                    f"MRZ lines hold 1-{MAX_MRZ_LINE_LENGTH} characters of A-Z, 0-9 and <"
                )
        return value

    @field_validator("box")
    @classmethod
    def _box_size(cls, value: BoundingBox | None) -> BoundingBox | None:
        return None if value is None else _positive_box(value)

    @model_validator(mode="after")
    def _consistent(self) -> MrzReading:
        if len(self.line_confidences) != len(self.lines):
            raise ValueError("every MRZ line has one confidence")
        if not self.found and (self.lines or self.box is not None or self.format_guess):
            raise ValueError("an MRZ not found has no lines, box or format")
        return self


class Barcode(_Contract):
    """A decoded barcode (zxing-cpp, ``text_mode=Plain``): its raw bytes and its text."""

    format: str = Field(min_length=1, max_length=32)
    """zxing-cpp's format name, for example ``PDF417``."""
    bytes_b64: str = Field(max_length=MAX_BARCODE_BASE64_LENGTH)
    text: str = Field(max_length=MAX_BARCODE_TEXT_LENGTH)
    quad: Quad

    @field_validator("bytes_b64")
    @classmethod
    def _base64(cls, value: str) -> str:
        if len(value) % 4 != 0 or not _BASE64.match(value):
            raise ValueError("must be standard base64")
        return value


class PortraitClarity(_Contract):
    """How usable the ID portrait is (front only; ``null`` without a portrait)."""

    face_width_px: NonNegative
    sharpness: NonNegative
    """Variance of the Laplacian over the face crop."""
    landmarks_score: UnitInterval


class ExifSummary(_Contract):
    """What EXIF says about the capture. GPS values are never returned, only whether present."""

    software: str | None = Field(max_length=256)
    make: str | None = Field(max_length=256)
    model: str | None = Field(max_length=256)
    has_gps: bool


class JpegForensics(_Contract):
    """JPEG compression history (``null`` for a PNG or WebP upload)."""

    quality_estimate: Annotated[int, Field(ge=1, le=100)] | None
    standard_tables: bool | None
    """Whether the quantization tables are the IJG standard tables scaled."""
    double_compression_score: UnitInterval | None


class ChromaStats(_Contract):
    mean_saturation: UnitInterval
    colorfulness: NonNegative
    """Hasler and Suesstrunk colourfulness."""


class StarGlyph(_Contract):
    """The REAL ID star in the upper part of a US card (PLAN §4.1)."""

    found: bool
    score: UnitInterval
    box: BoundingBox | None

    @model_validator(mode="after")
    def _box_only_when_found(self) -> StarGlyph:
        if not self.found and self.box is not None:
            raise ValueError("a star glyph not found has no box")
        if self.box is not None:
            _positive_box(self.box)
        return self


class Forensics(_Contract):
    """Raw forensic measurements; ``null`` as a whole when they could not be taken."""

    exif: ExifSummary
    jpeg: JpegForensics | None
    ela_score: UnitInterval
    moire_score: UnitInterval
    screen_grid_score: UnitInterval
    chroma: ChromaStats
    color_cast_score: UnitInterval
    copy_move_score: UnitInterval
    portrait_boundary_score: UnitInterval | None
    """``null`` without a portrait (the back, or no face on the front)."""
    star_glyph: StarGlyph


# --- vision-document ---
# --- end vision-document ---

# --- vision-ocr ---
# --- end vision-ocr ---

# --- vision-forensics ---
# --- end vision-forensics ---


class SideAnalysis(_Contract):
    quality: ImageQuality
    faces: list[DetectedFace]
    portrait: EmbeddedFace | None
    """Largest face on the front side with its embedding; always null for the back."""
    document: DocumentDetection
    document_quality: DocumentQuality | None
    text: list[TextLine] = Field(max_length=MAX_TEXT_LINES)
    mrz: MrzReading
    barcodes: list[Barcode] = Field(max_length=MAX_BARCODES)
    portrait_clarity: PortraitClarity | None
    """Front only; ``null`` on the back and without a portrait."""
    forensics: Forensics | None
    phash: str | None = Field(pattern=r"^[0-9a-f]{16}$")
    """64-bit DCT perceptual hash of the rectified document, 16 lowercase hex characters."""


class GovernmentIdSides(_Contract):
    front: SideAnalysis
    back: SideAnalysis | None


class GovernmentIdModelVersions(ModelVersions):
    """``detector`` and ``recognizer`` (C6), plus the OCR models; ``null`` while none ran."""

    text_detector: str | None = Field(min_length=1)
    text_recognizer: str | None = Field(min_length=1)


class GovernmentIdAnalysis(_Contract):
    model_versions: GovernmentIdModelVersions
    sides: GovernmentIdSides


# --- C41.1: selfie analysis v2 (Phase 4) ---------------------------------------------------------
#
# Vision measures; TypeScript decides (C41.3). A part that could not be measured is ``null``,
# never a made-up value. Landmarks and background layouts are biometric or personal data: they
# are returned to the API and never logged (C41.6).

LANDMARK_COUNT: Final = 5
"""YuNet's points: right eye, left eye, nose tip, right and left mouth corners."""

BACKGROUND_CELLS: Final = 48
"""The 8 x 6 grid of the background layout (research §8)."""

BACKGROUND_LAYOUT_LENGTH: Final = BACKGROUND_CELLS * 3
"""Mean Lab per cell."""

MAX_DIGITAL_SOURCE_TYPE_LENGTH: Final = 128

SelfieSource = Literal["camera", "upload"]
"""Form field ``source`` of ``POST /v1/analyze/selfie`` (C41.1); ``camera`` by default."""

SidePose = Literal["left", "right"]

Cosine = Annotated[float, Field(ge=-1.0, le=1.0)]


class ImageSize(_Contract):
    """The pose image's size in EXIF-upright pixels."""

    width: PositiveInt
    height: PositiveInt


class SelfieFace(DetectedFace):
    """A detected face with YuNet's five landmarks, in image pixels (C41.1)."""

    landmarks: tuple[Point, Point, Point, Point, Point]


class FaceQuality(_Contract):
    """Quality of the primary face region (``vision-face``)."""

    box: BoundingBox
    width_px: NonNegative
    height_ratio: UnitInterval
    """Face box height over image height."""
    center_offset: tuple[float, float]
    """``(dx, dy)`` of the face box centre from the image centre, as shares of width and height."""
    blur_score: NonNegative
    """Laplacian variance of the face region resized to 112 pixels wide."""
    brightness: UnitInterval
    glare_ratio: UnitInterval
    """Saturated share of the face region without the eye regions."""

    _box = field_validator("box")(_positive_box)


class HeadPose(_Contract):
    """Head pose from the five landmarks (``vision-face``). ``yaw_ratio`` decides (C41.1)."""

    yaw_ratio: float
    roll_deg: float
    yaw_deg: float | None
    """SQPnP against the canonical face points; coarse."""
    pitch_deg: float | None
    method: Literal["yunet-5pt"]


class EffectiveScales(_Contract):
    """The crop scale each MiniFASNet model actually saw (clipped at the image edge)."""

    v2: NonNegative
    v1se: NonNegative


class PassiveLiveness(_Contract):
    """P(real) per MiniFASNet model and their mean (``vision-face``, research §3)."""

    v2: UnitInterval
    v1se: UnitInterval
    mean: UnitInterval
    effective_scales: EffectiveScales


class CoveringScores(_Contract):
    score: UnitInterval
    skin_fraction_ratio: NonNegative
    texture_ratio: NonNegative
    delta_e: NonNegative
    forehead_valid: bool


class GlassesScores(_Contract):
    score: UnitInterval
    rim_edge_energy: NonNegative
    lens_highlight_ratio: UnitInterval
    bridge_edge_density: UnitInterval


class Occlusion(_Contract):
    """Covering and glasses heuristics from landmark regions (``vision-face``, research §6)."""

    covering: CoveringScores
    glasses: GlassesScores


class SyntheticScores(_Contract):
    """Weight-free synthetic-face cues (``vision-integrity``, §5.3); ``null`` unmeasured."""

    spectral_tail_deviation: float | None
    residual_peak_ratio: float | None
    noise_inconsistency: float | None
    jpeg_grid_misalignment: float | None
    canonical_landmark_distance: float | None
    digital_source_type: str | None = Field(max_length=MAX_DIGITAL_SOURCE_TYPE_LENGTH)
    """The XMP ``DigitalSourceType`` of an upload (``source=upload`` only), else ``null``."""


class BackgroundLayout(_Contract):
    """The centre's background colour layout (``vision-integrity``, research §8)."""

    layout: list[float] = Field(
        min_length=BACKGROUND_LAYOUT_LENGTH, max_length=BACKGROUND_LAYOUT_LENGTH
    )
    valid_cells: str = Field(pattern=r"^[01]{48}$")
    coverage: UnitInterval


class Planarity(_Contract):
    tracked_points: Annotated[int, Field(ge=0)]
    median_residual_ratio: NonNegative
    p90_residual_ratio: NonNegative


class PoseConsistency(_Contract):
    """How a side pose relates to the centre (``vision-integrity``, research §7)."""

    pose: SidePose
    face_cosine_to_center: Cosine | None
    planarity: Planarity | None
    registered_ssim: Annotated[float, Field(ge=-1.0, le=1.0)] | None
    raw_ssim: Annotated[float, Field(ge=-1.0, le=1.0)] | None
    duplicate_of_center: bool | None
    """``null`` when not measured."""


class PoseAnalysis(_Contract):
    quality: ImageQuality
    faces: list[SelfieFace]
    face: EmbeddedFace | None
    """Largest detected face with its embedding, or null when there is none."""
    image: ImageSize
    face_quality: FaceQuality | None
    head_pose: HeadPose | None
    passive_liveness: PassiveLiveness | None
    occlusion: Occlusion | None
    synthetic: SyntheticScores | None
    background: BackgroundLayout | None
    """Centre only; ``null`` for the side poses."""


class SelfiePoses(_Contract):
    center: PoseAnalysis
    left: PoseAnalysis | None
    right: PoseAnalysis | None


class SelfieModelVersions(ModelVersions):
    """``detector`` and ``recognizer`` (C6) and the anti-spoofing models (``null`` unused)."""

    anti_spoof_v2: str | None = Field(min_length=1)
    anti_spoof_v1se: str | None = Field(min_length=1)


# --- vision-face ---
# --- end vision-face ---

# --- vision-integrity ---
# --- end vision-integrity ---


class SelfieAnalysis(_Contract):
    model_versions: SelfieModelVersions
    poses: SelfiePoses
    consistency: list[PoseConsistency] = Field(max_length=2)
    """One entry per side pose present (C41.1)."""


MAX_BACKGROUND_CANDIDATES: Final = 5


class BackgroundMatch(_Contract):
    """ORB + RANSAC on background pixels of the probe and one candidate (C41.2)."""

    index: Annotated[int, Field(ge=0, lt=MAX_BACKGROUND_CANDIDATES)]
    good_matches: Annotated[int, Field(ge=0)]
    inliers: Annotated[int, Field(ge=0)]
    inlier_ratio: UnitInterval


class BackgroundComparison(_Contract):
    results: list[BackgroundMatch] = Field(max_length=MAX_BACKGROUND_CANDIDATES)


EmbedSubject = Literal["selfie", "document", "chip"]
"""What ``POST /v1/embed/face`` embeds (form field ``subject``, Workflow 3B review K101): the
largest face on the image (``selfie``, the default), the largest face on the government ID found
on it (``document``), or a chip's DG2 portrait, a JPEG or JPEG 2000 decoded through the guarded
child (``chip``, C60.4)."""


class FaceEmbeddingResult(_Contract):
    model_versions: ModelVersions
    face: EmbeddedFace | None
    face_count: int = Field(ge=0)
    """The faces ``face`` was chosen from: every face, or for a ``document`` found inside the
    image, the faces on it."""


# --- C60.1, C60.4: document analysis (Phase 5, Workflow 5B) -------------------------------------
#
# Vision measures; TypeScript classifies, extracts and decides (C60.5, C60.6). A part that could
# not be measured is ``null``, never a made-up value. Text-layer lines, OCR lines and XMP values
# are PII (names, addresses, amounts): returned to the API and never logged. Boxes are
# ``(x, y, width, height)`` in pixels of the page raster that was read: the render of a PDF page,
# or the EXIF-upright photo.

MAX_DOCUMENT_PAGES: Final = 50
"""C60.1: a PDF with more pages answers 422 ``too_many_pages``."""

MAX_ANALYSED_PAGES: Final = 4
"""C60.1: the first three pages and the last."""

MAX_DOCUMENT_LINES: Final = 600
"""C60.1, C58.7: lines per page, in the text layer and in the OCR alike."""

MAX_DOCUMENT_LINE_LENGTH: Final = 300
"""C60.1, C58.7: characters per line."""

MAX_LINE_FONTS: Final = 16
"""Font ids one text-layer line may name."""

MAX_PDF_FONTS: Final = 256
MAX_PDF_STRING_LENGTH: Final = 256
"""Producer, creator, XMP tools and ids: longer values are cut by vision, never refused."""

MAX_XMP_HISTORY: Final = 32
"""``xmpMM:History`` software agents reported."""

MAX_PAGE_SIDE_PT: Final = 14_400.0
"""C60.2: a page box above this, on either side, is refused before any render."""

RENDER_MAX_SIDE_PX: Final = 1_600
"""C60.4: ``/v1/render/document-page`` answers a PNG of at most this many pixels a side."""

PORTRAIT_MAX_SIDE_PX: Final = 640
"""C60.4: ``/v1/convert/portrait`` answers a PNG of at most this many pixels a side."""

JPEG2000_MAX_PIXELS: Final = 4_000_000
"""C60.4: a JPEG 2000 portrait above 4 MP is refused from its header, before decoding."""

DOCUMENT_PROBLEM_CODES: Final = ("pdf_encrypted", "pdf_unprocessable", "too_many_pages")
"""C60.1: the ``code`` of each 422 of ``/v1/analyze/document`` and ``/v1/render/document-page``.
415 is a file that is neither a PDF nor a JPEG, PNG or WebP image, 413 one too large."""

GUARDED_WORKER_FAILED: Final = "guarded_worker_failed"
"""C60.1: the ``code`` of the 503 answered when the guarded child was killed or timed out; the
job retries, then answers ``execution_error``."""

NOT_IMPLEMENTED: Final = "not_implemented"
"""The ``code`` of the 501 a stub answers (Workflow 5B Stage 1, until ``vision-document``)."""

DocumentSource = Literal["pdf", "image"]
"""``pdf``: a PDF (born-digital or scanned); ``image``: a JPEG, PNG or WebP photo."""

HiddenReason = Literal[
    "render_mode_invisible",
    "clipped",
    "off_page",
    "covered",
    "background_fill",
    "too_small",
]
"""C60.1: why a text-layer line is not visible: render mode 3, clipped, off the page, under an
opaque fill, filled in the background's colour, or under 2 pt high."""

_ISO_DATE: Final = r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})?)?$"
_SUBSET_TAG: Final = r"^[A-Z]{6}$"

IsoDate = Annotated[str, Field(pattern=_ISO_DATE)]
"""A date or date-time as ISO 8601; a PDF ``D:`` date or EXIF date is converted by vision, and an
unparseable one is ``null``. A date-time without an offset had none in the file."""

ShortText = Annotated[str, Field(max_length=MAX_PDF_STRING_LENGTH)]
LineText = Annotated[str, Field(min_length=1, max_length=MAX_DOCUMENT_LINE_LENGTH)]
Count = Annotated[int, Field(ge=0)]


class TextLayerLine(_Contract):
    """One line of a PDF page's text layer, visible or not (C60.1, H10)."""

    text: LineText
    box: BoundingBox
    font_ids: list[Count] = Field(max_length=MAX_LINE_FONTS)
    """Indexes into ``pdf.fonts`` of the fonts the line's characters use."""
    font_size_pt: NonNegative | None
    visible: bool
    hidden_reason: HiddenReason | None
    """``null`` exactly when the line is visible."""

    _box = field_validator("box")(_positive_box)

    @model_validator(mode="after")
    def _reason_iff_hidden(self) -> TextLayerLine:
        if self.visible != (self.hidden_reason is None):
            raise ValueError("hidden_reason is null exactly when the line is visible")
        return self


class DocumentOcrLine(_Contract):
    """One OCR line of a page raster."""

    text: LineText
    confidence: UnitInterval
    box: BoundingBox

    _box = field_validator("box")(_positive_box)


class DocumentPage(_Contract):
    number: Annotated[int, Field(ge=1, le=MAX_DOCUMENT_PAGES)]
    """1-based page number."""
    width: PositiveInt
    height: PositiveInt
    """The raster read, in pixels (a PDF page rendered at ``min(200/72, sqrt(12 MP / (w*h)))``)."""
    width_pt: Annotated[float, Field(gt=0.0, le=MAX_PAGE_SIDE_PT)] | None
    height_pt: Annotated[float, Field(gt=0.0, le=MAX_PAGE_SIDE_PT)] | None
    """The PDF page box in points; ``null`` for a photo."""
    text_layer: list[TextLayerLine] = Field(max_length=MAX_DOCUMENT_LINES)
    """Empty for a photo, and for a scanned PDF page without text."""
    ocr: list[DocumentOcrLine] = Field(max_length=MAX_DOCUMENT_LINES)
    text_layer_ocr_agreement: UnitInterval | None
    """How far the visible text layer and the OCR of the same raster agree; ``null`` unless the
    page has both."""

    @model_validator(mode="after")
    def _consistent(self) -> DocumentPage:
        if (self.width_pt is None) != (self.height_pt is None):
            raise ValueError("width_pt and height_pt are both set or both null")
        if self.text_layer_ocr_agreement is not None and not (self.text_layer and self.ocr):
            raise ValueError("text_layer_ocr_agreement needs both a text layer and OCR lines")
        return self


class XmpFields(_Contract):
    """C60.1: what a bounded byte scan (64 KiB, no XML parser) read from the XMP packet."""

    creator_tool: ShortText | None
    producer: ShortText | None
    create_date: IsoDate | None
    modify_date: IsoDate | None
    metadata_date: IsoDate | None
    document_id: ShortText | None
    instance_id: ShortText | None
    history_agents: list[ShortText] = Field(max_length=MAX_XMP_HISTORY)
    """The ``stEvt:softwareAgent`` of each ``xmpMM:History`` event, in order."""


class PdfFont(_Contract):
    id: Count
    """Its position in ``pdf.fonts``."""
    base_name: Annotated[str, Field(min_length=1, max_length=128)]
    """The base font name without its subset tag."""
    subset_tag: Annotated[str, Field(pattern=_SUBSET_TAG)] | None
    """The six capitals of a subset font (``ABCDEF+``), else ``null``."""
    embedded: bool


class PdfActions(_Contract):
    """C60.1: the dangerous actions only (a GoTo ``/OpenAction`` is not counted)."""

    javascript: Count
    launch: Count
    submit_form: Count
    goto_remote: Count
    rich_media: Count
    embedded_files: Count


class PdfMeasurements(_Contract):
    """C60.1: what the PDF's structure and metadata say; ``null`` as a whole for a photo."""

    producer: ShortText | None
    creator: ShortText | None
    creation_date: IsoDate | None
    modification_date: IsoDate | None
    xmp: XmpFields | None
    """``null`` without an XMP packet."""
    linearized: bool
    revisions: Annotated[int, Field(ge=1)]
    """Incremental-update sections, not counting the first-page section a ``/Linearized``
    dictionary declares."""
    xref_repaired: bool
    """PDFium had to repair the cross-reference table."""
    eof_markers: Count
    bytes_after_last_eof: Count
    object_streams: Count
    fonts: list[PdfFont] = Field(max_length=MAX_PDF_FONTS)
    annotations: Count
    form_fields: Count
    actions: PdfActions
    signatures: Count
    edits_after_signature: bool
    """An increment after a signature's byte range, DSS-only and DocTimeStamp-only increments
    excluded."""

    @model_validator(mode="after")
    def _consistent(self) -> PdfMeasurements:
        if [font.id for font in self.fonts] != list(range(len(self.fonts))):
            raise ValueError("each font's id is its position in fonts")
        if self.edits_after_signature and self.signatures == 0:
            raise ValueError("edits_after_signature needs a signature")
        return self


class DocumentImageMeasurements(_Contract):
    """C60.1: the photo's own forensics (a JPEG, PNG or WebP upload, or a scanned PDF page's
    embedded JPEG); ``null`` when there is no image to measure."""

    exif_software: ShortText | None
    exif_datetime_original: IsoDate | None
    exif_datetime: IsoDate | None
    jpeg_quality: Annotated[int, Field(ge=1, le=100)] | None
    double_compression_score: UnitInterval | None
    ela_text_cell_score: UnitInterval | None
    """ELA of the text cells (amounts, name, address) against the other text cells, on
    JPEG-origin images only."""
    copy_move_score: UnitInterval | None


class DocumentModelVersions(_Contract):
    """The OCR models and the PDF libraries that measured the document; ``null`` when unused."""

    text_detector: Annotated[str, Field(min_length=1)] | None
    text_recognizer: Annotated[str, Field(min_length=1)] | None
    pdf_renderer: Annotated[str, Field(min_length=1)] | None
    """``pdfium-<build>`` for a PDF."""
    pdf_parser: Annotated[str, Field(min_length=1)] | None
    """``pypdf-<version>`` for a PDF."""


def analysed_page_numbers(page_count: int) -> list[int]:
    """C60.1: the pages analysed, 1-based: the first three and the last."""
    return sorted({*range(1, min(page_count, 3) + 1), page_count})


class DocumentAnalysis(_Contract):
    """``POST /v1/analyze/document`` (C60.1): measurements only."""

    model_versions: DocumentModelVersions
    source: DocumentSource
    page_count: Annotated[int, Field(ge=1, le=MAX_DOCUMENT_PAGES)]
    analysed_pages: list[int] = Field(min_length=1, max_length=MAX_ANALYSED_PAGES)
    pages: list[DocumentPage] = Field(min_length=1, max_length=MAX_ANALYSED_PAGES)
    """One per analysed page, in the same order."""
    pdf: PdfMeasurements | None
    """Set exactly for a PDF."""
    image: DocumentImageMeasurements | None

    @model_validator(mode="after")
    def _consistent(self) -> DocumentAnalysis:
        if self.analysed_pages != analysed_page_numbers(self.page_count):
            raise ValueError("analysed_pages are the first three pages and the last")
        if [page.number for page in self.pages] != self.analysed_pages:
            raise ValueError("pages holds one entry per analysed page, in order")
        if (self.source == "pdf") != (self.pdf is not None):
            raise ValueError("pdf is set exactly when the source is a PDF")
        if self.source == "image" and (
            self.page_count != 1 or any(page.text_layer for page in self.pages)
        ):
            raise ValueError("a photo is one page without a text layer")
        if any((page.width_pt is None) != (self.source == "image") for page in self.pages):
            raise ValueError("a PDF page has a page box in points and a photo has none")
        return self


class VisionPngLimits(_Contract):
    """C60.4, C99.7: the bounds of the PNG answers, which both sides read from one fixture."""

    media_type: Literal["image/png"]
    render_document_page_max_side_px: Literal[1600]
    convert_portrait_max_side_px: Literal[640]
    mask_background_max_side_px: Literal[640]
    jpeg2000_max_pixels: Literal[4000000]


# C135.3 (Workflow 8B): renditions -------------------------------------------------------------
# ``POST /v1/renditions`` takes one multipart file ``source`` (JPEG, PNG, WebP or PDF) and answers
# what a reviewer may see of it: an image decoded, EXIF orientation applied, every metadata segment
# stripped and re-encoded as JPEG or PNG; a PDF's first pages rendered to PNG by the guarded child.

RENDITION_MAX_PAGES: Final = 20
"""C135.3: a PDF's first 20 pages are rendered; ``truncated`` says the source holds more."""

RENDITION_IMAGE_MAX_SIDE_PX: Final = 4_096
"""C135.3 (provisional): an image rendition's longest side; a 12 MP phone photo keeps its size."""

RENDITION_MAX_BYTES: Final = 16 * 1024 * 1024
"""C135.3 (provisional): one rendition's bytes, before base64."""

_PNG_SIGNATURE: Final = b"\x89PNG\r\n\x1a\n"
_PNG_HEADER_BYTES: Final = 24
"""The signature, the IHDR chunk's length and type, then its width and height."""
_JPEG_START: Final = b"\xff\xd8\xff"


def _png_size(data: bytes) -> tuple[int, int] | None:
    """The width and height of a PNG's IHDR, or ``None`` when the bytes are not one."""
    if (
        len(data) < _PNG_HEADER_BYTES
        or not data.startswith(_PNG_SIGNATURE)
        or data[12:16] != b"IHDR"
    ):
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


class RenditionPage(_Contract):
    """C135.3: one re-encoded image, upright and without metadata, its bytes in standard base64."""

    page: int = Field(ge=1, le=RENDITION_MAX_PAGES)
    """1-based; an image is page 1."""
    media_type: Literal["image/jpeg", "image/png"]
    width: int = Field(ge=1, le=RENDITION_IMAGE_MAX_SIDE_PX)
    height: int = Field(ge=1, le=RENDITION_IMAGE_MAX_SIDE_PX)
    byte_size: int = Field(ge=1, le=RENDITION_MAX_BYTES)
    data_b64: str = Field(min_length=4, max_length=4 * math.ceil(RENDITION_MAX_BYTES / 3))

    @model_validator(mode="after")
    def _bytes(self) -> RenditionPage:
        if len(self.data_b64) % 4 != 0 or not _BASE64.match(self.data_b64):
            raise ValueError("data_b64 must be standard base64")
        data = base64.b64decode(self.data_b64, validate=True)
        if len(data) != self.byte_size:
            raise ValueError("byte_size is the decoded length of data_b64")
        if self.media_type == "image/png":
            if _png_size(data) != (self.width, self.height):
                raise ValueError("a PNG rendition's IHDR holds its width and height")
        elif not data.startswith(_JPEG_START):
            raise ValueError("a JPEG rendition starts with a JPEG start of image")
        return self


class Rendition(_Contract):
    """C135.3: what ``/v1/renditions`` answers; the API seals each page beside its source."""

    source: Literal["image", "pdf"]
    page_count: int = Field(ge=1)
    """Pages of the source: 1 for an image; a PDF's whole count, rendered or not."""
    truncated: bool
    """A PDF holds more pages than were rendered."""
    pages: list[RenditionPage] = Field(min_length=1, max_length=RENDITION_MAX_PAGES)

    @model_validator(mode="after")
    def _pages(self) -> Rendition:
        if [page.page for page in self.pages] != list(range(1, len(self.pages) + 1)):
            raise ValueError("pages are numbered from 1, in order")
        if len(self.pages) != min(self.page_count, RENDITION_MAX_PAGES):
            raise ValueError("every page is rendered, up to 20")
        if self.truncated != (self.page_count > RENDITION_MAX_PAGES):
            raise ValueError("truncated says the source holds more pages than were rendered")
        if self.source == "image" and self.page_count != 1:
            raise ValueError("an image is one page")
        if self.source == "pdf" and any(
            page.media_type != "image/png" or max(page.width, page.height) > RENDER_MAX_SIDE_PX
            for page in self.pages
        ):
            raise ValueError("a PDF's pages are PNG images of at most 1,600 px a side")
        return self
