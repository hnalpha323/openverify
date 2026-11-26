"""Pydantic response models for the C6 vision contract (snake_case JSON)."""

from __future__ import annotations

import math
from typing import Any

import pytest
from pydantic import ValidationError

from openverify_vision.schemas import (
    EMBEDDING_DIMENSIONS,
    DetectedFace,
    EmbeddedFace,
    FaceEmbeddingResult,
    GovernmentIdAnalysis,
    ImageQuality,
    SelfieAnalysis,
)


def unit_vector(dimensions: int = EMBEDDING_DIMENSIONS) -> list[float]:
    value = 1.0 / math.sqrt(dimensions)
    return [value] * dimensions


QUALITY: dict[str, Any] = {
    "blur_score": 412.5,
    "is_blurry": False,
    "glare_ratio": 0.001,
    "has_glare": False,
    "brightness": 0.52,
    "is_too_dark": False,
    "is_too_bright": False,
}
FACE: dict[str, Any] = {"bbox": [10.5, 20.0, 100.0, 120.0], "score": 0.93}
EMBEDDED: dict[str, Any] = {**FACE, "embedding": unit_vector()}
VERSIONS = {"detector": "yunet-2026may", "recognizer": "sface-2021dec"}
# C32.1: the government ID analysis also names its text models (null while none ran).
GOVERNMENT_ID_VERSIONS = {**VERSIONS, "text_detector": None, "text_recognizer": None}
# C32.1: every v2 measurement of a side, as a side where nothing was found reports them.
NOTHING_FOUND: dict[str, Any] = {
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
    "mrz": {"found": False, "format_guess": None, "lines": [], "line_confidences": [], "box": None},
    "barcodes": [],
    "portrait_clarity": None,
    "forensics": None,
    "phash": None,
}


def side(portrait: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "quality": QUALITY,
        "faces": [FACE] if portrait else [],
        "portrait": portrait,
        **NOTHING_FOUND,
    }


def pose(face: dict[str, Any] | None) -> dict[str, Any]:
    # C41.1: every face has its five landmarks, and the v2 measurements are null when unmeasured.
    landmarks = [[1.0, 2.0], [3.0, 2.0], [2.0, 3.0], [1.5, 4.0], [2.5, 4.0]]
    return {
        "quality": QUALITY,
        "faces": [{**FACE, "landmarks": landmarks}] if face else [],
        "face": face,
        "image": {"width": 640, "height": 480},
        "face_quality": None,
        "head_pose": None,
        "passive_liveness": None,
        "occlusion": None,
        "synthetic": None,
        "background": None,
    }


def test_embedding_has_128_dimensions() -> None:
    assert EMBEDDING_DIMENSIONS == 128


def test_government_id_round_trips_exactly() -> None:
    document = {
        "model_versions": GOVERNMENT_ID_VERSIONS,
        "sides": {"front": side(EMBEDDED), "back": side(None)},
    }

    parsed = GovernmentIdAnalysis.model_validate(document)

    assert parsed.model_dump(mode="json") == document


def test_government_id_back_is_required_but_nullable() -> None:
    with_null = {
        "model_versions": GOVERNMENT_ID_VERSIONS,
        "sides": {"front": side(EMBEDDED), "back": None},
    }
    missing = {"model_versions": GOVERNMENT_ID_VERSIONS, "sides": {"front": side(EMBEDDED)}}

    assert GovernmentIdAnalysis.model_validate(with_null).sides.back is None
    with pytest.raises(ValidationError, match="back"):
        GovernmentIdAnalysis.model_validate(missing)


def test_selfie_round_trips_with_optional_poses() -> None:
    document = {
        "model_versions": {**VERSIONS, "anti_spoof_v2": None, "anti_spoof_v1se": None},
        "poses": {"center": pose(EMBEDDED), "left": pose(None), "right": None},
        "consistency": [],
    }

    assert SelfieAnalysis.model_validate(document).model_dump(mode="json") == document


def test_embed_face_round_trips() -> None:
    document = {"model_versions": VERSIONS, "face": EMBEDDED, "face_count": 2}

    assert FaceEmbeddingResult.model_validate(document).model_dump(mode="json") == document


def test_embed_face_allows_no_face() -> None:
    document = {"model_versions": VERSIONS, "face": None, "face_count": 0}

    assert FaceEmbeddingResult.model_validate(document).face is None


def test_quality_has_exactly_the_contract_fields() -> None:
    assert set(ImageQuality.model_fields) == set(QUALITY)


@pytest.mark.parametrize(
    ("model", "document"),
    [
        (ImageQuality, {**QUALITY, "extra": 1}),
        (DetectedFace, {**FACE, "landmarks": []}),
        (FaceEmbeddingResult, {"model_versions": VERSIONS, "face": None, "face_count": 0, "x": 1}),
    ],
)
def test_unknown_fields_are_rejected(model: Any, document: dict[str, Any]) -> None:
    with pytest.raises(ValidationError, match="Extra inputs"):
        model.model_validate(document)


@pytest.mark.parametrize(
    "bbox",
    [[1.0, 2.0, 3.0], [1.0, 2.0, 3.0, 4.0, 5.0], [0.0, 0.0, 0.0, 10.0], [0.0, 0.0, 10.0, -1.0]],
)
def test_bbox_is_four_numbers_with_positive_size(bbox: list[float]) -> None:
    with pytest.raises(ValidationError, match="bbox"):
        DetectedFace.model_validate({"bbox": bbox, "score": 0.9})


@pytest.mark.parametrize("score", [-0.1, 1.1, math.nan, math.inf])
def test_score_is_a_finite_probability(score: float) -> None:
    with pytest.raises(ValidationError, match="score"):
        DetectedFace.model_validate({**FACE, "score": score})


@pytest.mark.parametrize(
    "embedding",
    [
        unit_vector(127),
        unit_vector(129),
        [0.0] * EMBEDDING_DIMENSIONS,
        [1.0] * EMBEDDING_DIMENSIONS,  # length 128 but norm sqrt(128), not unit
        [math.nan, *unit_vector()[1:]],
    ],
    ids=["127", "129", "zero", "not-unit", "nan"],
)
def test_embedding_is_a_128_float_unit_vector(embedding: list[float]) -> None:
    with pytest.raises(ValidationError, match="embedding"):
        EmbeddedFace.model_validate({**FACE, "embedding": embedding})


def test_face_count_is_non_negative() -> None:
    with pytest.raises(ValidationError, match="face_count"):
        FaceEmbeddingResult.model_validate(
            {"model_versions": VERSIONS, "face": None, "face_count": -1}
        )


def test_models_are_immutable() -> None:
    quality = ImageQuality.model_validate(QUALITY)

    with pytest.raises(ValidationError, match="frozen"):
        quality.is_blurry = True  # type: ignore[misc]
