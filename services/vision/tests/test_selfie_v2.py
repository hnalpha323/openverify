"""C41: selfie analysis v2, the background comparison route and ONNX Runtime telemetry.

Workflow 4A Stage 1 wires every C41.1 field; the Stage 2 modules answer ``null`` (not measured)
until their owners fill them. Fake models, so no weights are needed.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import onnxruntime  # type: ignore[import-untyped]  # ships without type information
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray

import openverify_vision.liveness as liveness_module
from openverify_vision import analysis
from openverify_vision.analysis import FaceEngine
from openverify_vision.app import MAX_FILES_PER_REQUEST, MULTIPART_OVERHEAD_BYTES, create_app
from openverify_vision.faces import Face
from openverify_vision.schemas import (
    BACKGROUND_LAYOUT_LENGTH,
    BackgroundLayout,
    PassiveLiveness,
    SelfieAnalysis,
)
from openverify_vision.settings import Settings

from synthetic import Image, encode, make_noise

REPO_ROOT = Path(__file__).resolve().parents[3]
GOLDEN = REPO_ROOT / "contracts" / "fixtures" / "vision" / "analyze-selfie.json"
TOKEN = "t" * 40
AUTH = {"x-service-token": TOKEN}
POSE_KEYS = {
    "quality",
    "faces",
    "face",
    "image",
    "face_quality",
    "head_pose",
    "passive_liveness",
    "occlusion",
    "synthetic",
    "background",
}


class OneFaceDetector:
    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        height, width = img.shape[:2]
        x, y, w, h = width * 0.3, height * 0.2, width * 0.4, height * 0.5
        landmarks = (
            (x + 0.3 * w, y + 0.4 * h),
            (x + 0.7 * w, y + 0.4 * h),
            (x + 0.5 * w, y + 0.6 * h),
            (x + 0.35 * w, y + 0.8 * h),
            (x + 0.65 * w, y + 0.8 * h),
        )
        return [Face(box=(x, y, w, h), landmarks=landmarks, score=0.95)]


class UnitRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: Image, face: Face) -> NDArray[np.float32]:
        vector = np.zeros(128, dtype=np.float32)
        vector[0] = 1.0
        return vector


def _settings(**overrides: object) -> Settings:
    return Settings(service_token=TOKEN, models_dir=Path("missing"), **overrides)  # type: ignore[arg-type]


@pytest.fixture
def client() -> Iterator[TestClient]:
    engine = FaceEngine(OneFaceDetector(), UnitRecognizer())
    with TestClient(create_app(_settings(), face_engine=engine)) as test_client:
        yield test_client


def _jpeg(seed: int = 1) -> tuple[str, bytes, str]:
    return ("pose.jpg", encode(make_noise(240, 320, seed=seed), "JPEG"), "image/jpeg")


# --- the golden fixture (C41.1) ------------------------------------------------------------------


def test_the_golden_selfie_fixture_carries_every_v2_field() -> None:
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    SelfieAnalysis.model_validate(golden)
    assert golden["model_versions"]["anti_spoof_v2"]
    assert golden["model_versions"]["anti_spoof_v1se"]
    center = golden["poses"]["center"]
    assert set(center) == POSE_KEYS
    assert len(center["faces"][0]["landmarks"]) == 5
    assert len(center["background"]["layout"]) == BACKGROUND_LAYOUT_LENGTH
    assert golden["poses"]["left"]["background"] is None
    assert [entry["pose"] for entry in golden["consistency"]] == ["left"]


# --- the route (C41.1) ------------------------------------------------------------------------


def test_the_selfie_route_returns_the_image_size_and_every_faces_landmarks(
    client: TestClient,
) -> None:
    response = client.post(
        "/v1/analyze/selfie", headers=AUTH, files={"center": _jpeg(), "left": _jpeg(2)}
    )
    assert response.status_code == 200
    body = response.json()
    center = body["poses"]["center"]
    assert set(center) == POSE_KEYS
    assert center["image"] == {"width": 320, "height": 240}
    assert len(center["faces"][0]["landmarks"]) == 5
    assert body["model_versions"]["anti_spoof_v2"] is None
    assert [entry["pose"] for entry in body["consistency"]] == ["left"]
    assert body["poses"]["right"] is None


def test_the_stage_2_measurements_are_null_until_their_owners_fill_them(
    client: TestClient,
) -> None:
    body = client.post("/v1/analyze/selfie", headers=AUTH, files={"center": _jpeg()}).json()
    center = body["poses"]["center"]
    # vision-face fills face_quality, head_pose and occlusion (tests/test_selfie_face_route.py);
    # passive_liveness needs the anti-spoofing models, absent here.
    for key in ("passive_liveness",):
        assert center[key] is None, key
    # vision-integrity measures the centre's background and the synthetic cues
    # (tests/test_background.py, tests/test_synthetic_face.py); a camera capture's metadata is
    # never read.
    assert len(center["background"]["layout"]) == BACKGROUND_LAYOUT_LENGTH
    assert center["synthetic"]["canonical_landmark_distance"] is not None
    assert center["synthetic"]["digital_source_type"] is None
    assert body["consistency"] == []


def test_the_composition_calls_each_module_with_the_primary_face(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[str] = []
    live = PassiveLiveness.model_validate(
        {"v2": 0.9, "v1se": 0.8, "mean": 0.85, "effective_scales": {"v2": 2.4, "v1se": 2.4}}
    )
    layout = BackgroundLayout(
        layout=[0.0] * BACKGROUND_LAYOUT_LENGTH, valid_cells="1" * 48, coverage=1.0
    )

    def liveness(self: object, image: Image, face: Face | None) -> PassiveLiveness | None:
        seen.append("liveness")
        assert face is not None
        return live

    def background(image: Image, face: Face | None) -> BackgroundLayout | None:
        seen.append("background")
        return layout

    monkeypatch.setattr(liveness_module.PassiveLivenessEngine, "measure", liveness)
    monkeypatch.setattr(analysis, "measure_background", background)
    body = client.post(
        "/v1/analyze/selfie", headers=AUTH, files={"center": _jpeg(), "right": _jpeg(3)}
    ).json()
    assert body["poses"]["center"]["passive_liveness"]["mean"] == 0.85
    assert body["poses"]["right"]["passive_liveness"]["mean"] == 0.85
    assert body["poses"]["center"]["background"]["coverage"] == 1.0
    assert body["poses"]["right"]["background"] is None
    assert seen.count("background") == 1


def test_the_selfie_route_takes_the_capture_source(client: TestClient) -> None:
    for source in ("camera", "upload"):
        response = client.post(
            "/v1/analyze/selfie", headers=AUTH, files={"center": _jpeg()}, data={"source": source}
        )
        assert response.status_code == 200, source
    refused = client.post(
        "/v1/analyze/selfie", headers=AUTH, files={"center": _jpeg()}, data={"source": "video"}
    )
    assert refused.status_code == 422


# --- the background comparison route (C41.2) ----------------------------------------------------


def test_the_background_route_needs_the_service_token(client: TestClient) -> None:
    response = client.post("/v1/compare/background", files={"probe": _jpeg()})
    assert response.status_code == 401


def test_the_background_route_answers_one_result_per_candidate(client: TestClient) -> None:
    # vision-integrity built the comparison (tests/test_background.py); it answered 501 before.
    response = client.post(
        "/v1/compare/background",
        headers=AUTH,
        files={"probe": _jpeg(), "candidate_0": _jpeg(2), "candidate_4": _jpeg(3)},
    )
    assert response.status_code == 200
    assert [result["index"] for result in response.json()["results"]] == [0, 4]


def test_the_background_route_refuses_a_sixth_candidate(client: TestClient) -> None:
    response = client.post(
        "/v1/compare/background",
        headers=AUTH,
        files={"probe": _jpeg(), "candidate_5": _jpeg(2)},
    )
    assert response.status_code == 422


def test_the_background_route_has_its_own_larger_body_limit() -> None:
    settings = _settings(max_upload_bytes=1000)
    app = create_app(settings, face_engine=FaceEngine(OneFaceDetector(), UnitRecognizer()))
    with TestClient(app) as test_client:
        default_limit = MAX_FILES_PER_REQUEST * 1000 + MULTIPART_OVERHEAD_BYTES
        compare_limit = 6 * 1000 + MULTIPART_OVERHEAD_BYTES
        over_default = {"content-length": str(default_limit + 1), **AUTH}
        assert test_client.post("/v1/analyze/selfie", headers=over_default).status_code == 413
        between = test_client.post("/v1/compare/background", headers=over_default)
        assert between.status_code != 413
        over_compare = {"content-length": str(compare_limit + 1), **AUTH}
        assert test_client.post("/v1/compare/background", headers=over_compare).status_code == 413


# --- telemetry off (C41.4) ---------------------------------------------------------------------


def test_the_app_turns_onnx_runtime_telemetry_off_at_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(onnxruntime, "disable_telemetry_events", lambda: calls.append("off"))
    create_app(_settings(), face_engine=FaceEngine(OneFaceDetector(), UnitRecognizer()))
    assert calls == ["off"]


def test_the_vision_image_sets_ort_disable_telemetry() -> None:
    dockerfile = (REPO_ROOT / "services" / "vision" / "Dockerfile").read_text(encoding="utf-8")
    assert re.search(r"^ENV .*ORT_DISABLE_TELEMETRY=1", dockerfile, re.MULTILINE)


# --- the marked blocks (Stage 2 ownership) -------------------------------------------------------


@pytest.mark.parametrize("module", ["analysis.py", "schemas.py", "app.py"])
@pytest.mark.parametrize("owner", ["vision-face", "vision-integrity"])
def test_each_stage_2_owner_has_a_marked_block(module: str, owner: str) -> None:
    source = (REPO_ROOT / "services/vision/src/openverify_vision" / module).read_text("utf-8")
    assert f"# --- {owner} ---" in source
    assert f"# --- end {owner} ---" in source
