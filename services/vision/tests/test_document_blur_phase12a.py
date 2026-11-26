"""Phase 12A V3: document sharpness at a fixed card width, on the printed text.

The live test failed ``id_blur_detection`` on a legible card: the whole-image measure penalises
the desk and the frame size (an in-focus 1080 front scores 75, a 12-megapixel front 16.7 while its
card scores 251). ``measure_document_quality`` now measures the rectified card resized (up or
down) to :data:`DOCUMENT_MEASURE_WIDTH` pixels, lightly smoothed (a Laplacian of Gaussian at
:data:`DOCUMENT_MEASURE_SIGMA`), on the side's text boxes when they cover enough of the card: the
score then follows focus, not the frame's size, the desk or what else the side prints (a barcode
scores far higher than text at the same focus). ``docs/calibration/blur-phase12a.md`` records the
calibration this module recomputes.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final

import numpy as np
import pytest

import calibrate_blur_phase12a
from calibrate_blur_phase12a import FAIL, PASS, measure_captures, propose
from document_cards import (
    MEASURE_SIGMA,
    MEASURE_WIDTH,
    TEXT_MIN_SHARE,
    document_sharpness,
    make_card,
)
from model_paths import MODELS_DIR, missing_text_models
from openverify_vision import ocr
from openverify_vision.analysis import FaceEngine, analyze_government_id_side
from openverify_vision.document import (
    DOCUMENT_MEASURE_SIGMA,
    DOCUMENT_MEASURE_WIDTH,
    TEXT_MEASURE_MIN_SHARE,
    DocumentResult,
    measure_document_quality,
)
from openverify_vision.faces import Face
from openverify_vision.quality import QualityThresholds
from openverify_vision.schemas import BoundingBox, DocumentDetection, DocumentQuality
from openverify_vision.settings import Settings
from quebec_captures import PLAN_2160, SAME_SCENE_2160, bgr, photo, rectified_boxes, true_document

SAME_SCENE_TOLERANCE: Final = 0.25
"""Plan V3: one scene at two frame sizes scores within 25%."""

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
CALIBRATION: Final = REPO_ROOT / "docs" / "calibration" / "blur-phase12a.md"

RECOMPUTE_TOLERANCE: Final = 0.02
"""How far a recomputed calibration value may sit from the committed one (see
:func:`test_the_committed_calibration_is_the_recomputed_one`)."""

needs_text_models = pytest.mark.skipif(
    bool(missing_text_models()), reason=f"missing {missing_text_models()}"
)


class _NoFaces:
    """No face anywhere: the synthetic portrait is a drawn silhouette, and faces do not enter
    the document's sharpness."""

    def load(self) -> None:
        pass

    def detect(self, img: np.ndarray) -> list[Face]:
        return []

    def embed(self, img: np.ndarray, face: Face) -> np.ndarray:  # pragma: no cover
        raise AssertionError("no face is ever embedded")


def committed_proposal() -> tuple[float, float]:
    """``(min-document-blur-score, min-document-tenengrad)`` as the calibration document
    proposes them."""
    text = CALIBRATION.read_text(encoding="utf-8")
    values = {}
    for key in ("min-document-blur-score", "min-document-tenengrad"):
        match = re.search(rf"^\| `{key}` \| ([0-9.]+) \|", text, re.MULTILINE)
        assert match is not None, key
        values[key] = float(match.group(1))
    return values["min-document-blur-score"], values["min-document-tenengrad"]


def committed_rows() -> list[tuple[tuple[str, str], tuple[int, float, float]]]:
    """The committed table's rows: ``((capture, side), (width, blur_score, tenengrad))``."""
    rows = []
    for match in re.finditer(
        r"^\| ([a-z0-9-]+) \| (front|back) \| [a-z]+ \| (\d+) \| ([0-9.]+) \| ([0-9.]+) \|$",
        CALIBRATION.read_text(encoding="utf-8"),
        re.MULTILINE,
    ):
        capture, side, width, blur, tenengrad = match.groups()
        rows.append(((capture, side), (int(width), float(blur), float(tenengrad))))
    return rows


def whole(image: np.ndarray) -> DocumentResult:
    height, width = image.shape[:2]
    detection = DocumentDetection(
        found=True,
        quad=((0.0, 0.0), (float(width), 0.0), (float(width), float(height)), (0.0, float(height))),
        method="full_frame",
        rectified_size=(width, height),
        aspect_ratio=width / height,
        area_ratio=1.0,
    )
    return DocumentResult(detection=detection, rectified=image)


def reference(image: np.ndarray, boxes: list[BoundingBox]) -> tuple[float, float]:
    """The measure as the module docstring defines it, written out (``document_cards``)."""
    assert (MEASURE_WIDTH, MEASURE_SIGMA, TEXT_MIN_SHARE) == (
        DOCUMENT_MEASURE_WIDTH,
        DOCUMENT_MEASURE_SIGMA,
        TEXT_MEASURE_MIN_SHARE,
    )
    return document_sharpness(image, boxes)


def quality(document: DocumentResult, boxes: list[BoundingBox]) -> DocumentQuality:
    measured = measure_document_quality(document, text_boxes=tuple(boxes), portrait_box=None)
    assert measured is not None
    return measured


@pytest.mark.parametrize("width", [640, 1000, 2600])
def test_the_card_is_measured_at_a_fixed_width_on_its_text(width: int) -> None:
    card = make_card(width).image
    boxes = [(0.1 * width, 0.3 * width / 1.586, 0.5 * width, 0.08 * width)] * 2

    measured = quality(whole(card), boxes)

    blur, tenengrad = reference(card, boxes)
    assert measured.blur_score == pytest.approx(blur, abs=1e-3)
    assert measured.tenengrad == pytest.approx(tenengrad, abs=1e-2)
    assert (measured.width_px, measured.height_px) == card.shape[1::-1]


def test_without_enough_text_the_whole_card_is_measured() -> None:
    card = make_card().image
    tiny = [(10.0, 10.0, 4.0, 4.0)]

    assert quality(whole(card), tiny) == quality(whole(card), [])
    assert quality(whole(card), []).blur_score == pytest.approx(reference(card, [])[0], abs=1e-3)


@pytest.mark.parametrize("side", ["front", "back"])
def test_one_scene_at_two_frame_sizes_scores_within_a_quarter(side: str) -> None:
    small = photo(side, "phone-1080")  # type: ignore[arg-type]
    large = photo(side, SAME_SCENE_2160)  # type: ignore[arg-type]
    a = true_document(small)
    b = true_document(large)
    assert a.detection.rectified_size is not None
    assert b.detection.rectified_size is not None

    qa = quality(a, rectified_boxes(small, a.detection.rectified_size[0]))
    qb = quality(b, rectified_boxes(large, b.detection.rectified_size[0]))

    assert qb.blur_score == pytest.approx(qa.blur_score, rel=SAME_SCENE_TOLERANCE)
    assert qb.tenengrad == pytest.approx(qa.tenengrad, rel=SAME_SCENE_TOLERANCE)


def test_the_plans_literal_pair_is_a_sharper_scene_not_the_same_one() -> None:
    """``blur_sigma=1.2`` at 2160 doubles only the generator's second blur, not its lens blur,
    so that capture is sharper than ``phone-1080``; the measure says so (recorded, not hidden)."""
    small, literal = photo("front", "phone-1080"), photo("front", PLAN_2160)
    a, b = true_document(small), true_document(literal)
    assert a.detection.rectified_size is not None
    assert b.detection.rectified_size is not None

    qa = quality(a, rectified_boxes(small, a.detection.rectified_size[0]))
    qb = quality(b, rectified_boxes(literal, b.detection.rectified_size[0]))

    assert qb.blur_score > qa.blur_score * (1 + SAME_SCENE_TOLERANCE)


@needs_text_models
def test_the_proposed_thresholds_pass_the_legible_captures_and_fail_blur_and_motion() -> None:
    rows = measure_captures()
    proposal = propose(rows)

    for row in rows:
        if row.capture in PASS:
            assert row.blur_score >= proposal.min_document_blur_score, row
            assert row.tenengrad >= proposal.min_document_tenengrad, row
        if row.capture in FAIL:
            assert row.blur_score < proposal.min_document_blur_score, row
            assert row.tenengrad < proposal.min_document_tenengrad, row
    assert proposal.blur_margin > 1.2
    assert proposal.tenengrad_margin > 1.2


@needs_text_models
def test_the_committed_calibration_is_the_recomputed_one() -> None:
    """Within :data:`RECOMPUTE_TOLERANCE`: the OCR's boxes come from ONNX Runtime, whose CPU
    kernels may round differently on another machine and move a box edge by a pixel."""
    rows = measure_captures(informative=True)
    core = [row for row in rows if row.capture in (*PASS, *FAIL)]
    committed = committed_rows()

    assert [(row.capture, row.side) for row in rows] == [key for key, _ in committed]
    for row, (key, (width, blur, tenengrad)) in zip(rows, committed, strict=True):
        assert row.width_px == pytest.approx(width, abs=2), key
        assert row.blur_score == pytest.approx(blur, rel=RECOMPUTE_TOLERANCE), key
        assert row.tenengrad == pytest.approx(tenengrad, rel=RECOMPUTE_TOLERANCE), key
    proposal = propose(core)
    blur, tenengrad = committed_proposal()
    assert proposal.min_document_blur_score == pytest.approx(blur, rel=RECOMPUTE_TOLERANCE)
    assert proposal.min_document_tenengrad == pytest.approx(tenengrad, rel=RECOMPUTE_TOLERANCE)


@needs_text_models
def test_the_calibration_command_checks_and_writes_the_document(tmp_path: Path) -> None:
    copy = tmp_path / "blur.md"
    copy.write_text(CALIBRATION.read_text(encoding="utf-8"), encoding="utf-8")
    assert calibrate_blur_phase12a.main(["--doc", str(copy)]) == 0

    assert calibrate_blur_phase12a.main(["--doc", str(copy), "--check"]) == 0
    copy.write_text(
        copy.read_text(encoding="utf-8").replace("| phone-1080 |", "| stale |", 1), "utf-8"
    )
    assert calibrate_blur_phase12a.main(["--doc", str(copy), "--check"]) == 1
    assert calibrate_blur_phase12a.main(["--doc", str(copy)]) == 0
    assert calibrate_blur_phase12a.main(["--doc", str(copy), "--check"]) == 0


def test_a_document_without_the_markers_is_refused(tmp_path: Path) -> None:
    bare = tmp_path / "bare.md"
    bare.write_text("# no markers\n", encoding="utf-8")

    with pytest.raises(ValueError, match="markers"):
        calibrate_blur_phase12a.main(["--doc", str(bare)])


def analysed_quality(side: str, capture: str) -> DocumentQuality:
    """The side's ``document_quality`` as ``/v1/analyze/government-id`` reports it: the
    upload's own document detection (or the ``text_layout`` fallback) and the real OCR's
    text boxes on the rectified card."""
    shot = photo(side, capture)  # type: ignore[arg-type]
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": MODELS_DIR})
    analysed = analyze_government_id_side(
        shot.jpeg,
        bgr(shot),
        FaceEngine(_NoFaces(), _NoFaces()),
        ocr.OcrEngine.from_settings(settings),
        QualityThresholds(),
        front=side == "front",
    )
    assert analysed.document_quality is not None, (capture, side)
    return analysed.document_quality


@needs_text_models
@pytest.mark.parametrize("capture", [*PASS, *FAIL])
@pytest.mark.parametrize("side", ["front", "back"])
def test_the_proposed_thresholds_judge_the_analysis_as_calibrated(side: str, capture: str) -> None:
    """Stage 3 applies the proposed values to ``id_blur_detection``, which judges the analysis's
    ``document_quality``: the OCR's boxes, not the printed lines' tight boxes. A legible capture
    must pass both measures there, and a blurred or moved one fail both."""
    blur, tenengrad = committed_proposal()

    measured = analysed_quality(side, capture)

    legible = capture in PASS
    assert (measured.blur_score >= blur) is legible, (measured.blur_score, blur)
    assert (measured.tenengrad >= tenengrad) is legible, (measured.tenengrad, tenengrad)
