"""FastAPI application factory for the vision service.

Run with ``uvicorn openverify_vision.app:create_app --factory``.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from http import HTTPStatus
from typing import Annotated, Final, cast

import onnxruntime  # type: ignore[import-untyped]  # ships without type information
from fastapi import APIRouter, Depends, FastAPI, File, Form, UploadFile
from starlette.requests import Request
from starlette.responses import Response

from openverify_vision import background, document, document_analysis, page_count, renditions
from openverify_vision.analysis import (
    MODEL_VERSIONS,
    FaceEngine,
    ImageAnalysis,
    SelfiePoseResult,
    analyze_government_id_side,
    analyze_image,
    analyze_selfie_pose,
    document_faces,
    embedded_face,
    government_id_model_versions,
    selfie_consistency,
    selfie_model_versions,
)
from openverify_vision.auth import require_service_token
from openverify_vision.faces import ModelNotAvailableError
from openverify_vision.guarded.runner import protect_parent
from openverify_vision.imaging import (
    CorruptImageError,
    ImageArray,
    ImageTooLargeError,
    UnsupportedImageError,
    decode_image,
)
from openverify_vision.limits import BodySizeLimitMiddleware, JobLimiter
from openverify_vision.liveness import PassiveLivenessEngine
from openverify_vision.ocr import OcrEngine
from openverify_vision.problems import ProblemError, install_problem_handlers
from openverify_vision.quality import QualityReport, QualityThresholds, assess_quality
from openverify_vision.replay import CenterReference, center_reference
from openverify_vision.schemas import (
    MAX_BACKGROUND_CANDIDATES,
    BackgroundComparison,
    DocumentAnalysis,
    EmbedSubject,
    FaceEmbeddingResult,
    GovernmentIdAnalysis,
    GovernmentIdSides,
    PoseAnalysis,
    PoseConsistency,
    SelfieAnalysis,
    SelfiePoses,
    SelfieSource,
    SideAnalysis,
    SidePose,
)
from openverify_vision.settings import SECRET_VARIABLES, Settings, get_settings
from openverify_vision.startup import check_model_digests, resolve_secret_files

MULTIPART_OVERHEAD_BYTES: Final = 64 * 1024
"""Allowance on top of the file limits for multipart boundaries and part headers."""

MAX_FILES_PER_REQUEST: Final = 3
"""Most image fields one request carries (selfie ``center``, ``left`` and ``right``)."""

COMPARE_BACKGROUND_PATH: Final = "/v1/compare/background"
COMPARE_BACKGROUND_FILES: Final = 1 + MAX_BACKGROUND_CANDIDATES
MASK_BACKGROUND_PATH: Final = "/v1/mask/background"
NO_FACE_FOUND: Final = "no_face_found"
"""The ``code`` of a frame with no face to mask (C99.7)."""
"""The probe and up to five candidates (C41.2): its own body limit, six times the upload limit."""

# C60.1, C60.4: one upload each, so each route's body limit is 1 x upload + 64 KiB.
ANALYZE_DOCUMENT_PATH: Final = "/v1/analyze/document"
RENDER_DOCUMENT_PAGE_PATH: Final = "/v1/render/document-page"
CONVERT_PORTRAIT_PATH: Final = "/v1/convert/portrait"
SINGLE_UPLOAD_PATHS: Final = (
    ANALYZE_DOCUMENT_PATH,
    RENDER_DOCUMENT_PAGE_PATH,
    CONVERT_PORTRAIT_PATH,
    renditions.RENDITIONS_PATH,
)

PNG: Final = "image/png"

BACKGROUND_FIELDS: Final = frozenset(
    {"probe", *(f"candidate_{index}" for index in range(MAX_BACKGROUND_CANDIDATES))}
)

MODELS_UNAVAILABLE: Final = (
    "face models are not available; fetch them with `python3 scripts/fetch_models.py` "
    "into OPENVERIFY_VISION_MODELS_DIR"
)

logger = logging.getLogger(__name__)

health_router = APIRouter(tags=["health"])
v1_router = APIRouter(prefix="/v1", dependencies=[Depends(require_service_token)])


def get_face_engine(request: Request) -> FaceEngine:
    """FastAPI dependency returning the app's shared, lazily loaded face engine."""
    return cast("FaceEngine", request.app.state.face_engine)


def get_ocr_engine(request: Request) -> OcrEngine:
    """FastAPI dependency returning the app's shared, lazily loaded OCR engine (C32.1)."""
    return cast("OcrEngine", request.app.state.ocr_engine)


def get_liveness_engine(request: Request) -> PassiveLivenessEngine:
    """FastAPI dependency returning the app's passive liveness ensemble (C41.1)."""
    return cast("PassiveLivenessEngine", request.app.state.liveness_engine)


def get_job_limiter(request: Request) -> JobLimiter:
    """FastAPI dependency returning the app's limiter for decoding and analysis jobs."""
    return cast("JobLimiter", request.app.state.job_limiter)


@health_router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def _decode(data: bytes, settings: Settings, field: str | None = None) -> ImageArray:
    """Decode an upload, mapping failures to problem responses (prefixed with ``field``)."""
    prefix = f"{field}: " if field else ""
    try:
        return decode_image(data, max_pixels=settings.max_image_pixels)
    except UnsupportedImageError as exc:
        raise ProblemError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, f"{prefix}{exc}") from exc
    except ImageTooLargeError as exc:
        raise ProblemError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, f"{prefix}{exc}") from exc
    except CorruptImageError as exc:
        raise ProblemError(HTTPStatus.UNPROCESSABLE_ENTITY, f"{prefix}{exc}") from exc


async def _read(upload: UploadFile, settings: Settings, field: str | None = None) -> bytes:
    data = await upload.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        prefix = f"{field}: " if field else ""
        raise ProblemError(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            f"{prefix}image exceeds the {settings.max_upload_bytes}-byte upload limit",
        )
    return data


async def _read_optional(upload: UploadFile | None, settings: Settings, field: str) -> bytes | None:
    return None if upload is None else await _read(upload, settings, field)


@contextmanager
def _models_available() -> Iterator[None]:
    """Turn a missing or broken model file into a 503 problem without leaking server paths."""
    try:
        yield
    except ModelNotAvailableError as exc:
        logger.warning("face models unavailable: %s", exc)
        raise ProblemError(HTTPStatus.SERVICE_UNAVAILABLE, MODELS_UNAVAILABLE) from exc


def _assess(data: bytes, settings: Settings) -> QualityReport:
    image = _decode(data, settings)
    thresholds = QualityThresholds(
        blur_min=settings.blur_threshold, glare_max=settings.glare_threshold
    )
    return assess_quality(image, thresholds)


@v1_router.post("/quality", response_model=QualityReport)
async def quality(
    image: Annotated[UploadFile, File(description="JPEG, PNG or WebP image")],
    settings: Annotated[Settings, Depends(get_settings)],
    limiter: Annotated[JobLimiter, Depends(get_job_limiter)],
) -> QualityReport:
    """Run the blur and glare quality checks on one uploaded image."""
    data = await _read(image, settings)
    return await limiter.run(_assess, data, settings)


def _optional[T, R](value: T | None, convert: Callable[[T], R]) -> R | None:
    return None if value is None else convert(value)


class _Analyzer:
    """Runs :func:`analyze_image` with the app's thresholds, once both models are loaded."""

    def __init__(self, settings: Settings, engine: FaceEngine) -> None:
        self._engine = engine
        self._thresholds = settings.quality_thresholds
        with _models_available():
            engine.ensure_loaded()

    def __call__(self, image: ImageArray, *, embed: bool = True) -> ImageAnalysis:
        return analyze_image(image, self._engine, self._thresholds, embed_primary=embed)

    @property
    def engine(self) -> FaceEngine:
        return self._engine

    @property
    def thresholds(self) -> QualityThresholds:
        return self._thresholds


def _government_id(
    front: bytes, back: bytes | None, settings: Settings, engine: FaceEngine, reader: OcrEngine
) -> GovernmentIdAnalysis:
    # Every upload is decoded before the models load, so client errors win over a 503.
    front_image = _decode(front, settings, "front")
    back_image = _optional(back, lambda data: _decode(data, settings, "back"))
    analyze = _Analyzer(settings, engine)
    # --- vision-ocr ---
    # The text models load before either side is read, so model_versions (computed before the
    # front) names them from the first request. Without them text and the MRZ go unmeasured and
    # no text model is named (C32.1).
    reader.load()
    # --- end vision-ocr ---

    def side(data: bytes, image: ImageArray, *, is_front: bool) -> SideAnalysis:
        # No embedding for the back: it carries no portrait we compare, so none is computed.
        return analyze_government_id_side(
            data, image, analyze.engine, reader, analyze.thresholds, front=is_front
        )

    back_side = None
    if back is not None and back_image is not None:
        back_side = side(back, back_image, is_front=False)
    return GovernmentIdAnalysis(
        model_versions=government_id_model_versions(reader),
        sides=GovernmentIdSides(front=side(front, front_image, is_front=True), back=back_side),
    )


def _analyzer_after_uploads(
    uploads: Mapping[str, bytes | None], settings: Settings, engine: FaceEngine
) -> _Analyzer:
    """The analyzer, loaded before any pose is decoded. When the models cannot load, every upload
    is decoded first (one at a time, each dropped), so client errors still win over a 503."""
    try:
        return _Analyzer(settings, engine)
    except Exception:
        for name, data in uploads.items():
            if data is not None:
                _decode(data, settings, name)
        raise


def _selfie(
    uploads: dict[str, bytes | None],
    source: SelfieSource,
    settings: Settings,
    engine: FaceEngine,
    liveness: PassiveLivenessEngine,
) -> SelfieAnalysis:
    # H008 (Workflow 4B review): one full-size decode at a time. Each pose is decoded, analysed
    # and reduced to its answer (the centre also to its consistency reference, a small crop)
    # before the next one is decoded.
    analyze = _analyzer_after_uploads(uploads, settings, engine)

    def pose(name: str) -> SelfiePoseResult | None:
        data = uploads[name]
        if data is None:
            return None
        return analyze_selfie_pose(
            data,
            _decode(data, settings, name),
            analyze.engine,
            liveness,
            analyze.thresholds,
            center=name == "center",
            source=source,
        )

    def center() -> tuple[PoseAnalysis, CenterReference]:
        result = pose("center")
        if result is None:  # pragma: no cover - the route requires center
            raise ProblemError(
                HTTPStatus.UNPROCESSABLE_ENTITY, "center: the frontal pose is required"
            )
        return result.analysis, center_reference(result.frame)

    center_analysis, reference = center()

    def side(name: SidePose) -> tuple[PoseAnalysis, PoseConsistency] | None:
        result = pose(name)
        if result is None:
            return None
        return result.analysis, selfie_consistency(reference, name, result)

    left, right = side("left"), side("right")
    return SelfieAnalysis(
        model_versions=selfie_model_versions(liveness),
        poses=SelfiePoses(
            center=center_analysis,
            left=None if left is None else left[0],
            right=None if right is None else right[0],
        ),
        consistency=[measured[1] for measured in (left, right) if measured is not None],
    )


def _embed(
    data: bytes, settings: Settings, engine: FaceEngine, subject: EmbedSubject
) -> FaceEmbeddingResult:
    # C60.4: a chip portrait (JPEG or JPEG 2000) is decoded through the guarded child, never here.
    image = (
        document_analysis.decode_chip_portrait(data, settings)
        if subject == "chip"
        else _decode(data, settings, "image")
    )
    analyze = _Analyzer(settings, engine)
    # A chip's DG2 portrait is a face image, like a selfie: its largest face (C60.4, C62.6).
    if subject in {"selfie", "chip"}:
        result = analyze(image)
        return FaceEmbeddingResult(
            model_versions=MODEL_VERSIONS, face=result.primary, face_count=len(result.faces)
        )
    # K101: a government ID front's portrait is the largest face on the card, as in the analysis.
    found = analyze.engine.find_faces(image)
    faces = document_faces(found, document.detect_document(image).detection)
    face = embedded_face(image, analyze.engine, faces[0]) if faces else None
    return FaceEmbeddingResult(model_versions=MODEL_VERSIONS, face=face, face_count=len(faces))


@v1_router.post("/analyze/government-id", response_model=GovernmentIdAnalysis)
async def analyze_government_id(  # noqa: PLR0913, PLR0917 - two form fields, four dependencies
    front: Annotated[UploadFile, File(description="Front of the ID: JPEG, PNG or WebP")],
    settings: Annotated[Settings, Depends(get_settings)],
    engine: Annotated[FaceEngine, Depends(get_face_engine)],
    reader: Annotated[OcrEngine, Depends(get_ocr_engine)],
    limiter: Annotated[JobLimiter, Depends(get_job_limiter)],
    back: Annotated[UploadFile | None, File(description="Back of the ID (optional)")] = None,
) -> GovernmentIdAnalysis:
    """Quality and faces for each side, the front portrait's embedding, and the C32.1
    document, OCR, MRZ, barcode, portrait-clarity, forensic and pHash measurements."""
    front_data = await _read(front, settings, "front")
    back_data = await _read_optional(back, settings, "back")
    return await limiter.run(_government_id, front_data, back_data, settings, engine, reader)


@v1_router.post("/analyze/selfie", response_model=SelfieAnalysis)
async def analyze_selfie(  # noqa: PLR0913, PLR0917 - four form fields plus four dependencies
    center: Annotated[UploadFile, File(description="Frontal selfie: JPEG, PNG or WebP")],
    settings: Annotated[Settings, Depends(get_settings)],
    engine: Annotated[FaceEngine, Depends(get_face_engine)],
    liveness: Annotated[PassiveLivenessEngine, Depends(get_liveness_engine)],
    limiter: Annotated[JobLimiter, Depends(get_job_limiter)],
    left: Annotated[UploadFile | None, File(description="Left-turned pose (optional)")] = None,
    right: Annotated[UploadFile | None, File(description="Right-turned pose (optional)")] = None,
    source: Annotated[
        SelfieSource, Form(description="camera (default) or upload: how the poses were taken")
    ] = "camera",
) -> SelfieAnalysis:
    """Every C41.1 measurement of each submitted pose, and the side poses' consistency with the
    centre."""
    uploads = {
        "center": await _read(center, settings, "center"),
        "left": await _read_optional(left, settings, "left"),
        "right": await _read_optional(right, settings, "right"),
    }
    return await limiter.run(_selfie, uploads, source, settings, engine, liveness)


# --- vision-integrity ---
def _compare_background(
    probe: bytes, candidates: dict[int, bytes], settings: Settings, engine: FaceEngine
) -> BackgroundComparison:
    # Each upload is downscaled to the 640-pixel comparison copy as soon as it is decoded, so at
    # most one full-size decode is held at a time; every decode precedes the model load, so
    # client errors win over a 503.
    probe_image = background.compare_copy(_decode(probe, settings, "probe"))
    fields = sorted(candidates)
    candidate_images = [
        background.compare_copy(_decode(candidates[field], settings, f"candidate_{field}"))
        for field in fields
    ]
    analyze = _Analyzer(settings, engine)
    results = background.compare_backgrounds(probe_image, candidate_images, analyze.engine)
    # Each result names its candidate by field number (candidate_3 is index 3).
    return BackgroundComparison(
        results=[result.model_copy(update={"index": fields[result.index]}) for result in results]
    )


@v1_router.post("/compare/background", response_model=BackgroundComparison)
async def compare_background(  # noqa: PLR0913, PLR0917 - six form fields plus four dependencies
    request: Request,
    probe: Annotated[UploadFile, File(description="The selfie whose background is compared")],
    settings: Annotated[Settings, Depends(get_settings)],
    engine: Annotated[FaceEngine, Depends(get_face_engine)],
    limiter: Annotated[JobLimiter, Depends(get_job_limiter)],
    candidate_0: Annotated[UploadFile | None, File()] = None,
    candidate_1: Annotated[UploadFile | None, File()] = None,
    candidate_2: Annotated[UploadFile | None, File()] = None,
    candidate_3: Annotated[UploadFile | None, File()] = None,
    candidate_4: Annotated[UploadFile | None, File()] = None,
) -> BackgroundComparison:
    """ORB + RANSAC on background pixels of the probe and each candidate (C41.2); each image is
    downscaled to at most 640 pixels on its long side after reading, and each result's ``index``
    is its candidate's field number."""
    unknown = sorted(set((await request.form()).keys()) - BACKGROUND_FIELDS)
    if unknown:
        raise ProblemError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"only probe and candidate_0 to candidate_4 are accepted, not {', '.join(unknown)}",
        )
    probe_data = await _read(probe, settings, "probe")
    candidates = {
        index: await _read(upload, settings, f"candidate_{index}")
        for index, upload in enumerate(
            (candidate_0, candidate_1, candidate_2, candidate_3, candidate_4)
        )
        if upload is not None
    }
    return await limiter.run(_compare_background, probe_data, candidates, settings, engine)


def _mask_background(data: bytes, settings: Settings, engine: FaceEngine) -> bytes:
    # The upload is downscaled as soon as it is decoded; the decode precedes the model load, so
    # client errors win over a 503.
    image = background.compare_copy(_decode(data, settings, "image"))
    analyze = _Analyzer(settings, engine)
    masked = background.mask_person(image, analyze.engine)
    if masked is None:
        raise ProblemError(
            HTTPStatus.UNPROCESSABLE_ENTITY, "no face was found to mask", code=NO_FACE_FOUND
        )
    return background.png_of(masked)


@v1_router.post(
    MASK_BACKGROUND_PATH.removeprefix("/v1"),
    response_class=Response,
    responses={
        200: {"content": {PNG: {}}, "description": "The background as a PNG of at most 640 px"}
    },
)
async def mask_background(
    image: Annotated[UploadFile, File(description="The selfie whose background is kept")],
    settings: Annotated[Settings, Depends(get_settings)],
    engine: Annotated[FaceEngine, Depends(get_face_engine)],
    limiter: Annotated[JobLimiter, Depends(get_job_limiter)],
) -> Response:
    """The selfie as a PNG of at most 640 pixels a side with every person painted out, what a
    selfie-background list item keeps (C99.7). The PNG carries none of the upload's metadata. A
    frame without a face answers 422 ``no_face_found``."""
    data = await _read(image, settings, "image")
    png = await limiter.run(_mask_background, data, settings, engine)
    return Response(content=png, media_type=PNG)


# --- end vision-integrity ---


@v1_router.post("/embed/face", response_model=FaceEmbeddingResult)
async def embed_face(
    image: Annotated[UploadFile, File(description="JPEG, PNG or WebP image")],
    settings: Annotated[Settings, Depends(get_settings)],
    engine: Annotated[FaceEngine, Depends(get_face_engine)],
    limiter: Annotated[JobLimiter, Depends(get_job_limiter)],
    subject: Annotated[
        EmbedSubject,
        Form(
            description=(
                "selfie (default): the largest face; document: the ID's portrait; chip: a chip's "
                "DG2 portrait (JPEG or JPEG 2000)"
            )
        ),
    ] = "selfie",
) -> FaceEmbeddingResult:
    """The largest face's embedding and the number of faces it was chosen from. With
    ``subject=document`` the image is a government ID front: when the card is found inside the
    photo, only the faces on it count, as for the analysis's portrait (K101). With
    ``subject=chip`` it is a chip portrait, decoded through the guarded child (C60.4)."""
    data = await _read(image, settings, "image")
    return await limiter.run(_embed, data, settings, engine, subject)


# --- vision-document ---
# C60.1, C60.4 (Workflow 5B Stage 1): the routes are final; vision-document builds the analysis,
# the render and the conversion behind them in document_analysis and the guarded child. Until it
# does, each answers 501 (NotImplementedError, problems.py), never a made-up measurement.


@v1_router.post(ANALYZE_DOCUMENT_PATH.removeprefix("/v1"), response_model=DocumentAnalysis)
async def analyze_document(
    document: Annotated[UploadFile, File(description="A PDF, or a JPEG, PNG or WebP photo")],
    settings: Annotated[Settings, Depends(get_settings)],
    reader: Annotated[OcrEngine, Depends(get_ocr_engine)],
    limiter: Annotated[JobLimiter, Depends(get_job_limiter)],
) -> DocumentAnalysis:
    """Every C60.1 measurement of a document: its pages' visible and hidden text layer, OCR and
    their agreement, the PDF's structure and metadata, and the photo's forensics."""
    data = await _read(document, settings, "document")
    return await limiter.run(document_analysis.analyze_document, data, settings, reader)


@v1_router.post(
    RENDER_DOCUMENT_PAGE_PATH.removeprefix("/v1"),
    response_class=Response,
    responses={200: {"content": {PNG: {}}, "description": "The page as a PNG of at most 1,600 px"}},
)
async def render_document_page(
    document: Annotated[UploadFile, File(description="A PDF, or a JPEG, PNG or WebP photo")],
    settings: Annotated[Settings, Depends(get_settings)],
    limiter: Annotated[JobLimiter, Depends(get_job_limiter)],
    page: Annotated[int, Form(ge=1, description="1-based page number")] = 1,
) -> Response:
    """One page as a PNG preview of at most 1,600 pixels a side (C60.4)."""
    data = await _read(document, settings, "document")
    png = await limiter.run(document_analysis.render_document_page, data, page, settings)
    return Response(content=png, media_type=PNG)


@v1_router.post(
    CONVERT_PORTRAIT_PATH.removeprefix("/v1"),
    response_class=Response,
    responses={
        200: {"content": {PNG: {}}, "description": "The portrait as a PNG of at most 640 px"}
    },
)
async def convert_portrait(
    image: Annotated[UploadFile, File(description="A chip portrait: JPEG, JP2 or J2K")],
    settings: Annotated[Settings, Depends(get_settings)],
    limiter: Annotated[JobLimiter, Depends(get_job_limiter)],
) -> Response:
    """A chip portrait as a PNG of at most 640 pixels a side (C60.4)."""
    data = await _read(image, settings, "image")
    png = await limiter.run(document_analysis.convert_portrait, data, settings)
    return Response(content=png, media_type=PNG)


# --- end vision-document ---


def create_app(
    settings: Settings | None = None,
    *,
    face_engine: FaceEngine | None = None,
    ocr_engine: OcrEngine | None = None,
) -> FastAPI:
    """Build the app. Settings come from the environment unless passed explicitly.

    The face engine defaults to YuNet and SFace in ``settings.models_dir``, and the OCR engine
    to the C33 text models there; models load on first use, so ``/health`` works before the
    weights are fetched.
    """
    if settings is None:
        # C249.2 (Phase 11, Workflow 11C): the secrets' file forms, before Settings reads them.
        resolve_secret_files(os.environ, SECRET_VARIABLES)
    resolved = settings if settings is not None else Settings()
    if resolved.models_manifest is not None:
        # C257.1 (Workflow 11C): a model whose bytes differ from its pin stops the start.
        check_model_digests(resolved.models_dir, resolved.models_manifest)
    # C60.2, Workflow 5C review P018: no guarded child, though it runs as our user, may read our
    # /proc entries (the service token in environ, the spooled uploads in fd).
    protect_parent()
    # C41.4: ONNX Runtime's Linux builds send Microsoft telemetry unless told not to; this runs
    # before any inference session exists (every model loads lazily). The image and compose
    # also set ORT_DISABLE_TELEMETRY=1.
    onnxruntime.disable_telemetry_events()
    app = FastAPI(title="OpenVerify Vision", version="0.1.0", docs_url=None, redoc_url=None)
    app.state.settings = resolved
    app.state.face_engine = (
        face_engine if face_engine is not None else FaceEngine.from_settings(resolved)
    )
    # --- vision-ocr ---
    app.state.ocr_engine = (
        ocr_engine if ocr_engine is not None else OcrEngine.from_settings(resolved)
    )
    # --- end vision-ocr ---
    # --- vision-face ---
    # C41.1: the MiniFASNet ensemble in settings.models_dir, loaded on the first face; without
    # the files, passive liveness is not measured (a warning, model_versions null), as for OCR.
    app.state.liveness_engine = PassiveLivenessEngine.from_settings(resolved)
    # --- end vision-face ---
    app.state.job_limiter = JobLimiter(resolved.max_concurrent_jobs, resolved.max_queued_jobs)
    # C135.3, F25: renditions run on their own lane, so verification keeps its slots.
    app.state.rendition_limiter = JobLimiter(
        renditions.RENDITION_LANE_SLOTS, renditions.RENDITION_LANE_QUEUED
    )
    install_problem_handlers(app)
    # --- vision-document ---
    # 1B F021: a model failing on an upload is a typed 500 (code inference_failed). 1B F022: the
    # service token is checked before a /v1 body is received (inside the body-size limit, which
    # refuses an oversized declared length without reading either). Imported here because this
    # block is the part of app.py vision-document owns (plan amendment 13).
    from openverify_vision.inference import install_inference_handlers  # noqa: PLC0415
    from openverify_vision.service_token import install_service_token_guard  # noqa: PLC0415

    install_inference_handlers(app)
    install_service_token_guard(app, resolved)
    # --- end vision-document ---
    app.add_middleware(
        BodySizeLimitMiddleware,
        max_body_bytes=MAX_FILES_PER_REQUEST * resolved.max_upload_bytes + MULTIPART_OVERHEAD_BYTES,
        route_limits={
            COMPARE_BACKGROUND_PATH: COMPARE_BACKGROUND_FILES * resolved.max_upload_bytes
            + MULTIPART_OVERHEAD_BYTES,
            **dict.fromkeys(
                SINGLE_UPLOAD_PATHS, resolved.max_upload_bytes + MULTIPART_OVERHEAD_BYTES
            ),
            # Workflow 11B: a transaction file of up to 20 MB is counted, whatever the upload
            # limit of the image routes.
            page_count.PAGE_COUNT_PATH: page_count.PAGE_COUNT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES,
        },
    )
    app.include_router(health_router)
    app.include_router(v1_router)
    app.include_router(renditions.router)
    app.include_router(page_count.router)
    return app
