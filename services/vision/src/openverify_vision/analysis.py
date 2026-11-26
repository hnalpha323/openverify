"""Per-image analysis behind the C6 endpoints: quality, every face, and the primary face, and the
C32.1 composition of a government ID side (:func:`analyze_government_id_side`).

YuNet reliably finds faces only up to roughly 380 pixels wide in its input, so a selfie or
a high-resolution upload can hide a large face. Detection therefore runs on copies scaled to
each long side in :data:`DETECTION_LONG_SIDES` (never upscaled), maps the boxes back to
source pixels and merges duplicates. The primary face is the largest one; its embedding is
computed on the full-resolution source image.

A document's portrait is the largest face *on the document* (:func:`document_faces`, Workflow 3B
review K101): when the card was found inside a larger photo, a face beside it (the holder's own,
held up next to the card) is never taken for the card's portrait.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Protocol

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision import barcode, document, forensics, mrz_locate, ocr
from openverify_vision.background import measure_background
from openverify_vision.faces import (
    DETECTOR_VERSION,
    Face,
    FaceDetector,
    default_yunet_path,
)
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.liveness import PassiveLivenessEngine
from openverify_vision.occlusion import measure_occlusion
from openverify_vision.pose import estimate_head_pose
from openverify_vision.quality import QualityThresholds, measure_face_quality, summarize_quality
from openverify_vision.recognition import RECOGNIZER_VERSION, FaceRecognizer, default_sface_path
from openverify_vision.replay import CenterReference, PoseFrame, measure_consistency
from openverify_vision.schemas import (
    BoundingBox,
    DetectedFace,
    DocumentDetection,
    EmbeddedFace,
    GovernmentIdModelVersions,
    ImageQuality,
    ImageSize,
    ModelVersions,
    PoseAnalysis,
    PoseConsistency,
    SelfieFace,
    SelfieModelVersions,
    SelfieSource,
    SideAnalysis,
    SidePose,
)
from openverify_vision.settings import Settings
from openverify_vision.synthetic_face import measure_synthetic

DETECTION_LONG_SIDES: Final = (640, 320)
"""Long sides, in pixels, of the scaled copies searched for faces."""

NMS_IOU_THRESHOLD: Final = 0.3
"""Detections overlapping more than this (intersection over union) are the same face."""

MODEL_VERSIONS: Final = ModelVersions(detector=DETECTOR_VERSION, recognizer=RECOGNIZER_VERSION)

QUAD_METHODS: Final = frozenset({"contour", "lines", "text_layout"})
"""Document methods that find the card inside a larger photo (``full_frame`` is the upload)."""

_BBOX_DECIMALS: Final = 2
_SCORE_DECIMALS: Final = 4


class Detector(Protocol):
    def load(self) -> None: ...

    def detect(self, img: ImageArray) -> list[Face]: ...


class Recognizer(Protocol):
    def load(self) -> None: ...

    def embed(self, img: ImageArray, face: Face) -> NDArray[np.float32]: ...


def iou(a: BoundingBox, b: BoundingBox) -> float:
    """Intersection over union of two ``(x, y, w, h)`` boxes."""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    overlap_w = min(ax + aw, bx + bw) - max(ax, bx)
    overlap_h = min(ay + ah, by + bh) - max(ay, by)
    if overlap_w <= 0 or overlap_h <= 0:
        return 0.0
    intersection = overlap_w * overlap_h
    return intersection / (aw * ah + bw * bh - intersection)


def _suppress_overlaps(faces: Sequence[Face], threshold: float) -> list[Face]:
    """Greedy non-maximum suppression: keep the best-scoring face of each overlapping group."""
    kept: list[Face] = []
    for face in sorted(faces, key=lambda f: f.score, reverse=True):
        if all(iou(face.box, other.box) <= threshold for other in kept):
            kept.append(face)
    return kept


class FaceEngine:
    """Multi-scale face detection plus embeddings, over lazily loaded models."""

    def __init__(
        self,
        detector: Detector,
        recognizer: Recognizer,
        *,
        long_sides: Sequence[int] = DETECTION_LONG_SIDES,
        nms_iou_threshold: float = NMS_IOU_THRESHOLD,
    ) -> None:
        self.detector = detector
        self.recognizer = recognizer
        self._long_sides = tuple(long_sides)
        self._nms_iou_threshold = nms_iou_threshold

    @classmethod
    def from_settings(cls, settings: Settings) -> FaceEngine:
        """Engine over YuNet and SFace in ``settings.models_dir``. Nothing is loaded yet."""
        return cls(
            FaceDetector(
                default_yunet_path(settings.models_dir),
                score_threshold=settings.face_score_threshold,
            ),
            FaceRecognizer(default_sface_path(settings.models_dir)),
        )

    def ensure_loaded(self) -> None:
        """Load both models, raising ``ModelNotAvailableError`` if either is missing."""
        self.detector.load()
        self.recognizer.load()

    def find_faces(self, img: ImageArray) -> list[Face]:
        """Every face in ``img`` (source pixel coordinates), largest first."""
        bgr = ensure_bgr(img)
        height, width = bgr.shape[:2]
        found: list[Face] = []
        searched: set[tuple[int, int]] = set()
        for long_side in self._long_sides:
            scale = min(1.0, long_side / max(height, width))
            size = (max(1, round(width * scale)), max(1, round(height * scale)))
            if size in searched:
                continue
            searched.add(size)
            work = bgr if size == (width, height) else _resize(bgr, size)
            fx, fy = width / size[0], height / size[1]
            found.extend(face.rescaled(fx, fy) for face in self.detector.detect(work))
        usable = [face for face in found if face.box[2] > 0 and face.box[3] > 0]
        kept = _suppress_overlaps(usable, self._nms_iou_threshold)
        return sorted(kept, key=lambda face: face.area, reverse=True)

    def embed(self, img: ImageArray, face: Face) -> list[float]:
        return [float(v) for v in self.recognizer.embed(img, face)]


def _resize(img: ImageArray, size: tuple[int, int]) -> ImageArray:
    return np.asarray(cv2.resize(img, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


def _bbox(face: Face) -> BoundingBox:
    x, y, w, h = (round(v, _BBOX_DECIMALS) for v in face.box)
    return (x, y, w, h)


def _score(face: Face) -> float:
    return round(min(max(face.score, 0.0), 1.0), _SCORE_DECIMALS)


def embedded_face(img: ImageArray, engine: FaceEngine, face: Face) -> EmbeddedFace:
    """``face`` as the contract reports it, with its embedding computed on ``img``."""
    return EmbeddedFace(bbox=_bbox(face), score=_score(face), embedding=engine.embed(img, face))


def document_faces(faces: Sequence[Face], detection: DocumentDetection) -> list[Face]:
    """The faces that can be the portrait of the document ``detection`` found, in the order
    given (Workflow 3B review K101).

    When the document was found inside the upload (``contour``, ``lines`` or ``text_layout``),
    only the faces whose box centre lies inside its quad: the holder's own face beside a card
    they hold up is not on the card. For ``full_frame`` or no document, every face, as on a
    selfie."""
    if detection.method not in QUAD_METHODS or detection.quad is None:
        return list(faces)
    outline = np.asarray(detection.quad, dtype=np.float32).reshape(-1, 1, 2)

    def on_document(face: Face) -> bool:
        x, y, w, h = face.box
        return cv2.pointPolygonTest(outline, (x + w / 2, y + h / 2), measureDist=False) >= 0

    return [face for face in faces if on_document(face)]


@dataclass(frozen=True, slots=True)
class ImageAnalysis:
    quality: ImageQuality
    faces: tuple[DetectedFace, ...]
    primary: EmbeddedFace | None
    """Largest face with its embedding, or ``None`` (no face, or not requested)."""
    found: tuple[Face, ...] = ()
    """Every detected face as the detector saw it (box and landmarks), largest first."""


def analyze_image(
    img: ImageArray,
    engine: FaceEngine,
    thresholds: QualityThresholds,
    *,
    embed_primary: bool,
) -> ImageAnalysis:
    """Quality metrics, all detected faces, and (if asked) the embedded primary face."""
    quality = summarize_quality(img, thresholds)
    faces = engine.find_faces(img)
    detected = tuple(DetectedFace(bbox=_bbox(face), score=_score(face)) for face in faces)
    primary = embedded_face(img, engine, faces[0]) if embed_primary and faces else None
    return ImageAnalysis(quality=quality, faces=detected, primary=primary, found=tuple(faces))


# --- C32.1: government ID analysis v2 -----------------------------------------------------------


def government_id_model_versions(reader: ocr.OcrEngine) -> GovernmentIdModelVersions:
    """The C6 model versions plus the OCR models of ``reader`` (``None`` while none ran)."""
    return GovernmentIdModelVersions(
        detector=DETECTOR_VERSION,
        recognizer=RECOGNIZER_VERSION,
        text_detector=reader.detector_version,
        text_recognizer=reader.recognizer_version,
    )


def analyze_government_id_side(  # noqa: PLR0913 - one side's inputs and engines
    data: bytes,
    img: ImageArray,
    engine: FaceEngine,
    reader: ocr.OcrEngine,
    thresholds: QualityThresholds,
    *,
    front: bool,
) -> SideAnalysis:
    """Every C32.1 measurement of one side of an ID; vision measures, TypeScript decides.

    ``data`` is the upload as received (EXIF and JPEG tables) and ``img`` its upright decode.
    The document is found on the upload; OCR and the MRZ read the rectified document when there
    is one (else the upload). When the detectors find none, the upload's OCR lines (and the MRZ
    box, and on the front its faces) are the evidence of :func:`document.detect_by_text_layout`
    (Phase 12A V2); a card found so is read again, rectified, like any other. Barcodes are read on
    the upload, then on the rectified document (their quads mapped back to upload pixels), then,
    when neither gave a PDF417, by :func:`barcode.recover_pdf417`. Only the front has a
    portrait: the largest face on the document (:func:`document_faces`), which is the face
    embedded, measured for clarity and given to the document quality and the forensics;
    ``faces`` still lists every face on the upload. Stage 2 modules fill the stages in behind
    these calls (``document``, ``ocr``, ``mrz_locate``, ``barcode``, ``forensics``); each stub
    answers "nothing found".
    """
    base = analyze_image(img, engine, thresholds, embed_primary=False)

    # --- vision-document ---
    detected = document.detect_document(img)
    # --- end vision-document ---
    target = detected.rectified if detected.rectified is not None else img

    # --- vision-ocr ---
    # The MRZ is reported on its own; ``text`` is the visual zone around it.
    mrz = mrz_locate.locate_mrz(target, reader)
    text = ocr.visual_zone(reader.read_text(target), mrz.box)
    # --- end vision-ocr ---

    if not detected.detection.found:
        evidence = tuple(line.box for line in text) + (() if mrz.box is None else (mrz.box,))
        faces = tuple(_bbox(face) for face in base.found) if front else ()
        fallback = document.detect_by_text_layout(
            img, detected, text_boxes=evidence, portrait_boxes=faces
        )
        if fallback.detection.found and fallback.rectified is not None:
            detected, target = fallback, fallback.rectified
            mrz = mrz_locate.locate_mrz(target, reader)
            text = ocr.visual_zone(reader.read_text(target), mrz.box)

    # --- vision-forensics ---
    # The upload, then the rectified document (its quads mapped back to upload pixels).
    barcodes = barcode.decode_side_barcodes(img, detected)
    # --- end vision-forensics ---

    on_document = document_faces(base.found, detected.detection) if front else []
    portrait = on_document[0] if on_document else None
    portrait_box = None if portrait is None else _bbox(portrait)

    # --- vision-document ---
    clarity = document.measure_portrait_clarity(img, portrait) if front else None
    quality = document.measure_document_quality(
        detected, text_boxes=tuple(line.box for line in text), portrait_box=portrait_box
    )
    phash = document.perceptual_hash(detected)
    # --- end vision-document ---

    # --- vision-forensics ---
    measured = forensics.analyze_forensics(data, img, detected, portrait_box=portrait_box)
    # --- end vision-forensics ---

    return SideAnalysis(
        quality=base.quality,
        faces=list(base.faces),
        portrait=None if portrait is None else embedded_face(img, engine, portrait),
        document=detected.detection,
        document_quality=quality,
        text=text,
        mrz=mrz,
        barcodes=barcodes,
        portrait_clarity=clarity,
        forensics=measured,
        phash=phash,
    )


# --- C41.1: selfie analysis v2 -------------------------------------------------------------------


def selfie_model_versions(liveness: PassiveLivenessEngine) -> SelfieModelVersions:
    """The C6 model versions plus the anti-spoofing models (``None`` while none ran)."""
    v2, v1se = liveness.versions
    return SelfieModelVersions(
        detector=DETECTOR_VERSION,
        recognizer=RECOGNIZER_VERSION,
        anti_spoof_v2=v2,
        anti_spoof_v1se=v1se,
    )


def _selfie_face(face: Face) -> SelfieFace:
    x, y, w, h = _bbox(face)
    points = tuple(
        (round(px, _BBOX_DECIMALS), round(py, _BBOX_DECIMALS)) for px, py in face.landmarks
    )
    return SelfieFace(
        bbox=(x, y, w, h),
        score=_score(face),
        landmarks=(points[0], points[1], points[2], points[3], points[4]),
    )


@dataclass(frozen=True, slots=True)
class SelfiePoseResult:
    """One pose's contract answer, and what the cross-pose consistency needs."""

    analysis: PoseAnalysis
    frame: PoseFrame


def analyze_selfie_pose(  # noqa: PLR0913 - one pose's inputs and engines
    data: bytes,
    img: ImageArray,
    engine: FaceEngine,
    liveness: PassiveLivenessEngine,
    thresholds: QualityThresholds,
    *,
    center: bool,
    source: SelfieSource,
) -> SelfiePoseResult:
    """Every C41.1 measurement of one selfie pose; vision measures, TypeScript decides.

    ``data`` is the upload as received and ``img`` its upright decode. The Stage 2 modules fill
    their measurements in behind these calls (``quality``, ``pose``, ``liveness``,
    ``occlusion``: ``vision-face``; ``synthetic_face``, ``background``: ``vision-integrity``);
    each stub answers ``None`` (not measured). The background is measured on the centre only.
    """
    base = analyze_image(img, engine, thresholds, embed_primary=True)
    primary = base.found[0] if base.found else None
    height, width = img.shape[:2]

    # --- vision-face ---
    face_quality = measure_face_quality(img, primary)
    head_pose = estimate_head_pose(primary, (width, height))
    passive = liveness.measure(img, primary)
    occlusion = measure_occlusion(img, primary)
    # --- end vision-face ---

    # --- vision-integrity ---
    synthetic = measure_synthetic(data, img, primary, source)
    background = measure_background(img, primary) if center else None
    # --- end vision-integrity ---

    analysis = PoseAnalysis(
        quality=base.quality,
        faces=[_selfie_face(face) for face in base.found],
        face=base.primary,
        image=ImageSize(width=width, height=height),
        face_quality=face_quality,
        head_pose=head_pose,
        passive_liveness=passive,
        occlusion=occlusion,
        synthetic=synthetic,
        background=background,
    )
    embedding = None if base.primary is None else tuple(base.primary.embedding)
    return SelfiePoseResult(
        analysis=analysis, frame=PoseFrame(data=data, image=img, face=primary, embedding=embedding)
    )


def selfie_consistency(
    center: CenterReference, pose: SidePose, side: SelfiePoseResult
) -> PoseConsistency:
    """The C41.1 consistency entry of the side pose ``side`` with the centre, given as the
    :func:`~openverify_vision.replay.center_reference` of its frame (Workflow 4B review H008)."""
    # --- vision-integrity ---
    return measure_consistency(pose, center, side.frame)
    # --- end vision-integrity ---
