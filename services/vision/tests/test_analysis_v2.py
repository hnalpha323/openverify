"""C32.1 composition of one government ID side: what each Stage 2 module receives and returns.

Every stage is replaced by a recording fake, so this pins the wiring Stage 2 agents fill in
behind: the document detector sees the upright upload; OCR and MRZ read the rectified document
when there is one; barcodes are read on the upload, then on the rectified document (mapped back to
upload pixels); quality, pHash and forensics get the document result; only the front has a
portrait, the largest face on the document, and measures its clarity. Images are synthetic.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray

from openverify_vision import barcode, document, forensics, mrz_locate, ocr
from openverify_vision.analysis import FaceEngine, analyze_government_id_side, analyze_image
from openverify_vision.document import DocumentResult
from openverify_vision.faces import Face
from openverify_vision.quality import QualityThresholds
from openverify_vision.schemas import (
    EMBEDDING_DIMENSIONS,
    Barcode,
    BoundingBox,
    DocumentDetection,
    DocumentQuality,
    Forensics,
    MrzReading,
    PortraitClarity,
    SideAnalysis,
    TextLine,
)
from openverify_vision.settings import Settings

from synthetic import Image, encode, make_checkerboard

SMALL = Face(box=(10.0, 10.0, 20.0, 20.0), landmarks=((15.0, 20.0),) * 5, score=0.97)
LARGE = Face(box=(60.0, 40.0, 80.0, 100.0), landmarks=((90.0, 80.0),) * 5, score=0.93)


class FixedDetector:
    def __init__(self, faces: Sequence[Face]) -> None:
        self.faces = list(faces)

    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        return list(self.faces)


class UnitRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: Image, face: Face) -> NDArray[np.float32]:
        vector = np.ones(EMBEDDING_DIMENSIONS, dtype=np.float32)
        return vector / np.linalg.norm(vector)


def engine(faces: Sequence[Face] = (SMALL, LARGE)) -> FaceEngine:
    # One scale only, so each face is detected once at its own coordinates.
    return FaceEngine(FixedDetector(faces), UnitRecognizer(), long_sides=(10_000,))


def ocr_engine(tmp_path: Any) -> ocr.OcrEngine:
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": tmp_path})
    return ocr.OcrEngine.from_settings(settings)


IMAGE = make_checkerboard(size=320)
DATA = encode(IMAGE, "PNG")
RECTIFIED = np.full((200, 317, 3), 128, dtype=np.uint8)
FOUND = DocumentDetection.model_validate(
    {
        "found": True,
        "quad": [[0.0, 0.0], [319.0, 0.0], [319.0, 319.0], [0.0, 319.0]],
        "method": "contour",
        "rectified_size": [317, 200],
        "aspect_ratio": 1.585,
        "area_ratio": 0.99,
    }
)
LINE = TextLine.model_validate(
    {
        "text": "UTOPIA",
        "confidence": 0.9,
        "box": [10.0, 10.0, 80.0, 20.0],
        "stroke_width_mean": 3.0,
        "stroke_width_cv": 0.2,
    }
)
MRZ = MrzReading.model_validate(
    {
        "found": True,
        "format_guess": "TD1",
        "lines": ["I<UTO", "9002", "VALEMONT"],
        "line_confidences": [0.9, 0.9, 0.9],
        "box": [5.0, 150.0, 300.0, 40.0],
    }
)
BARCODE = Barcode.model_validate(
    {"format": "PDF417", "bytes_b64": "QA==", "text": "@", "quad": FOUND.quad}
)
DOC_QUALITY = DocumentQuality.model_validate(
    {
        "blur_score": 500.0,
        "tenengrad": 900.0,
        "width_px": 317,
        "height_px": 200,
        "glare_ratio_text": 0.0,
        "glare_ratio_portrait": 0.0,
    }
)
CLARITY = PortraitClarity.model_validate(
    {"face_width_px": 80.0, "sharpness": 100.0, "landmarks_score": 0.9}
)
FORENSICS = Forensics.model_validate(
    {
        "exif": {"software": None, "make": None, "model": None, "has_gps": False},
        "jpeg": None,
        "ela_score": 0.1,
        "moire_score": 0.0,
        "screen_grid_score": 0.0,
        "chroma": {"mean_saturation": 0.0, "colorfulness": 0.0},
        "color_cast_score": 0.0,
        "copy_move_score": 0.0,
        "portrait_boundary_score": None,
        "star_glyph": {"found": False, "score": 0.0, "box": None},
    }
)


class Recorder:
    def __init__(self) -> None:
        self.calls: dict[str, list[Any]] = {}

    def record(self, name: str, *args: Any, **kwargs: Any) -> None:
        self.calls.setdefault(name, []).append((args, kwargs))


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    """Replace every Stage 2 stage with a fake that records its call."""
    rec = Recorder()
    found = DocumentResult(detection=FOUND, rectified=RECTIFIED)

    def detect(img: Image) -> DocumentResult:
        rec.record("detect_document", img)
        return found

    def read_text(self: ocr.OcrEngine, img: Image) -> list[TextLine]:
        rec.record("read_text", img)
        return [LINE]

    def locate(img: Image, engine: ocr.OcrEngine) -> MrzReading:
        rec.record("locate_mrz", img, engine)
        return MRZ

    def decode(img: Image) -> list[Barcode]:
        rec.record("decode_barcodes", img)
        return [BARCODE]

    def quality(
        doc: DocumentResult,
        *,
        text_boxes: tuple[BoundingBox, ...],
        portrait_box: BoundingBox | None,
    ) -> DocumentQuality:
        rec.record(
            "measure_document_quality", doc, text_boxes=text_boxes, portrait_box=portrait_box
        )
        return DOC_QUALITY

    def clarity(img: Image, portrait: Face | None) -> PortraitClarity:
        rec.record("measure_portrait_clarity", img, portrait)
        return CLARITY

    def phash(doc: DocumentResult) -> str:
        rec.record("perceptual_hash", doc)
        return "0123456789abcdef"

    def forensic(
        data: bytes, img: Image, doc: DocumentResult, *, portrait_box: BoundingBox | None
    ) -> Forensics:
        rec.record("analyze_forensics", data, img, doc, portrait_box=portrait_box)
        return FORENSICS

    monkeypatch.setattr(document, "detect_document", detect)
    monkeypatch.setattr(ocr.OcrEngine, "read_text", read_text)
    monkeypatch.setattr(mrz_locate, "locate_mrz", locate)
    monkeypatch.setattr(barcode, "decode_barcodes", decode)
    monkeypatch.setattr(document, "measure_document_quality", quality)
    monkeypatch.setattr(document, "measure_portrait_clarity", clarity)
    monkeypatch.setattr(document, "perceptual_hash", phash)
    monkeypatch.setattr(forensics, "analyze_forensics", forensic)
    return rec


def test_the_stage_1_stubs_report_nothing_found(tmp_path: Any) -> None:
    side = analyze_government_id_side(
        DATA, IMAGE, engine(), ocr_engine(tmp_path), QualityThresholds(), front=True
    )

    assert isinstance(side, SideAnalysis)
    phase1 = analyze_image(IMAGE, engine(), QualityThresholds(), embed_primary=True)
    assert (side.quality, tuple(side.faces), side.portrait) == (
        phase1.quality,
        phase1.faces,
        phase1.primary,
    )
    # vision-document (C32.1): the front's largest face is measured; the grid is no document.
    assert side.portrait_clarity is not None
    assert side.portrait_clarity.face_width_px == LARGE.box[2]
    assert side.portrait_clarity.landmarks_score == LARGE.score
    # vision-forensics (C32.1): the upload is measured; a PNG has no JPEG history.
    assert side.forensics is not None
    assert side.forensics.jpeg is None
    exclude = {"quality", "faces", "portrait", "portrait_clarity", "forensics"}
    assert side.model_dump(mode="json", exclude=exclude) == {
        "document": {
            "found": False,
            "quad": None,
            "method": "none",
            "rectified_size": None,
            "aspect_ratio": None,
            "area_ratio": None,
        },
        "document_quality": None,
        "text": [],
        "mrz": {
            "found": False,
            "format_guess": None,
            "lines": [],
            "line_confidences": [],
            "box": None,
        },
        "barcodes": [],
        "phash": None,
    }


def test_the_front_wires_every_stage(recorder: Recorder, tmp_path: Any) -> None:
    reader = ocr_engine(tmp_path)

    side = analyze_government_id_side(
        DATA, IMAGE, engine(), reader, QualityThresholds(), front=True
    )

    calls = recorder.calls
    assert calls["detect_document"][0][0][0] is IMAGE
    # OCR and MRZ read the rectified document; barcodes are read on the upload, then on the
    # rectified document.
    assert calls["read_text"][0][0][0] is RECTIFIED
    assert calls["locate_mrz"][0][0][0] is RECTIFIED
    assert calls["locate_mrz"][0][0][1] is reader
    assert [id(call[0][0]) for call in calls["decode_barcodes"]] == [id(IMAGE), id(RECTIFIED)]
    # The portrait is the largest face on the document, given in upload pixels.
    assert calls["measure_portrait_clarity"][0][0] == (IMAGE, LARGE)
    (doc,), quality_kwargs = calls["measure_document_quality"][0]
    assert doc.rectified is RECTIFIED
    assert quality_kwargs == {"text_boxes": (LINE.box,), "portrait_box": (60.0, 40.0, 80.0, 100.0)}
    assert calls["perceptual_hash"][0][0][0] is doc
    (data, img, forensic_doc), forensic_kwargs = calls["analyze_forensics"][0]
    assert (data, img, forensic_doc) == (DATA, IMAGE, doc)
    assert forensic_kwargs == {"portrait_box": (60.0, 40.0, 80.0, 100.0)}

    assert side.document == FOUND
    assert side.document_quality == DOC_QUALITY
    assert side.text == [LINE]
    assert side.mrz == MRZ
    assert side.barcodes == [BARCODE]
    assert side.portrait_clarity == CLARITY
    assert side.forensics == FORENSICS
    assert side.phash == "0123456789abcdef"


def test_the_back_has_no_portrait_and_measures_no_portrait_clarity(
    recorder: Recorder, tmp_path: Any
) -> None:
    side = analyze_government_id_side(
        DATA, IMAGE, engine(), ocr_engine(tmp_path), QualityThresholds(), front=False
    )

    assert side.portrait is None
    assert side.portrait_clarity is None
    assert "measure_portrait_clarity" not in recorder.calls
    assert recorder.calls["measure_document_quality"][0][1]["portrait_box"] is None
    assert recorder.calls["analyze_forensics"][0][1] == {"portrait_box": None}
    assert len(side.faces) == 2


def test_without_a_document_ocr_and_mrz_read_the_upload(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    lost = DocumentResult(
        detection=DocumentDetection.model_validate(
            {
                "found": False,
                "quad": None,
                "method": "none",
                "rectified_size": None,
                "aspect_ratio": None,
                "area_ratio": None,
            }
        ),
        rectified=None,
    )
    monkeypatch.setattr(document, "detect_document", lambda img: lost)

    analyze_government_id_side(
        DATA, IMAGE, engine(faces=[]), ocr_engine(tmp_path), QualityThresholds(), front=True
    )

    assert recorder.calls["read_text"][0][0][0] is IMAGE
    assert recorder.calls["locate_mrz"][0][0][0] is IMAGE
    # No face on the front: clarity is asked about no portrait at all.
    assert recorder.calls["measure_portrait_clarity"][0][0] == (IMAGE, None)


# --- K101 (Workflow 3B review): the portrait is the face on the document --------------------


def found_at(quad: list[list[float]], method: str) -> DocumentResult:
    """A document found at ``quad`` (upload pixels) by ``method``."""
    detection = DocumentDetection.model_validate(
        {**FOUND.model_dump(mode="json"), "quad": quad, "method": method}
    )
    return DocumentResult(detection=detection, rectified=RECTIFIED)


AROUND_SMALL = [[0.0, 0.0], [48.0, 0.0], [48.0, 30.0], [0.0, 30.0]]
"""A card whose quad holds SMALL's centre (20, 20) and not LARGE's (100, 90)."""

AROUND_NEITHER = [[180.0, 200.0], [300.0, 200.0], [300.0, 276.0], [180.0, 276.0]]
"""A card in an empty part of the image: no face's centre lies inside it."""


@pytest.mark.parametrize("method", ["contour", "lines"])
def test_the_portrait_is_the_largest_face_inside_a_found_quad(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch, tmp_path: Any, method: str
) -> None:
    # A person holds the card up beside their face: their own face is larger than the card's
    # portrait, and only the portrait lies on the card.
    monkeypatch.setattr(document, "detect_document", lambda img: found_at(AROUND_SMALL, method))

    side = analyze_government_id_side(
        DATA, IMAGE, engine(), ocr_engine(tmp_path), QualityThresholds(), front=True
    )

    assert side.portrait is not None
    assert side.portrait.bbox == SMALL.box
    assert [face.bbox for face in side.faces] == [LARGE.box, SMALL.box]  # every face, still
    assert recorder.calls["measure_portrait_clarity"][0][0] == (IMAGE, SMALL)
    assert recorder.calls["measure_document_quality"][0][1]["portrait_box"] == SMALL.box
    assert recorder.calls["analyze_forensics"][0][1] == {"portrait_box": SMALL.box}


@pytest.mark.parametrize("method", ["contour", "lines"])
def test_no_face_inside_a_found_quad_is_no_portrait(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch, tmp_path: Any, method: str
) -> None:
    monkeypatch.setattr(document, "detect_document", lambda img: found_at(AROUND_NEITHER, method))

    side = analyze_government_id_side(
        DATA, IMAGE, engine(), ocr_engine(tmp_path), QualityThresholds(), front=True
    )

    assert side.portrait is None
    assert len(side.faces) == 2
    assert recorder.calls["measure_portrait_clarity"][0][0] == (IMAGE, None)
    assert recorder.calls["measure_document_quality"][0][1]["portrait_box"] is None
    assert recorder.calls["analyze_forensics"][0][1] == {"portrait_box": None}


def test_a_full_frame_document_keeps_the_largest_face(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    frame = [[0.0, 0.0], [320.0, 0.0], [320.0, 320.0], [0.0, 320.0]]
    monkeypatch.setattr(document, "detect_document", lambda img: found_at(frame, "full_frame"))

    side = analyze_government_id_side(
        DATA, IMAGE, engine(), ocr_engine(tmp_path), QualityThresholds(), front=True
    )

    assert side.portrait is not None
    assert side.portrait.bbox == LARGE.box
    assert recorder.calls["measure_portrait_clarity"][0][0] == (IMAGE, LARGE)
