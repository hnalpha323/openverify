"""C6 endpoints: /v1/analyze/government-id, /v1/analyze/selfie and /v1/embed/face.

The face engine is injected with fake detector and recognizer models so these tests run
without weights. The 503 tests use the real lazy loaders pointed at an empty models dir.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from httpx2 import Response
from numpy.typing import NDArray

from document_cards import card_corners, card_to_scene, make_card, place_card
from openverify_vision.analysis import FaceEngine
from openverify_vision.app import MAX_FILES_PER_REQUEST, create_app
from openverify_vision.faces import Face, FaceDetector
from openverify_vision.recognition import FaceRecognizer
from openverify_vision.schemas import (
    EMBEDDING_DIMENSIONS,
    FaceEmbeddingResult,
    GovernmentIdAnalysis,
    SelfieAnalysis,
)
from openverify_vision.settings import Settings

from synthetic import Image, encode, make_checkerboard, make_noise, make_uniform

TOKEN = "s" * 40
AUTH = {"x-service-token": TOKEN}
PROBLEM = "application/problem+json"
VERSIONS = {"detector": "yunet-2026may", "recognizer": "sface-2021dec"}
# C32.1: the government ID analysis names its text models; null while no OCR model ran.
GOVERNMENT_ID_VERSIONS = {**VERSIONS, "text_detector": None, "text_recognizer": None}
PHASE1_SIDE_KEYS = {"quality", "faces", "portrait"}
V2_SIDE_KEYS = {
    "document",
    "document_quality",
    "text",
    "mrz",
    "barcodes",
    "portrait_clarity",
    "forensics",
    "phash",
}

Upload = tuple[str, bytes, str]
Box = tuple[float, float, float, float]


class NormalisedFakeDetector:
    """Finds the given normalised ``(x, y, w, h)`` faces in every image it is shown."""

    def __init__(self, faces: Sequence[tuple[float, float, float, float]]) -> None:
        self.faces = faces

    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        height, width = img.shape[:2]
        found = []
        for nx, ny, nw, nh in self.faces:
            x, y, w, h = nx * width, ny * height, nw * width, nh * height
            landmarks = tuple((x + w * (i + 1) / 6, y + h / 2) for i in range(5))
            found.append(Face(box=(x, y, w, h), landmarks=landmarks, score=0.95))
        return found


class CountingRecognizer:
    def __init__(self) -> None:
        self.calls = 0

    def load(self) -> None:
        pass

    def embed(self, img: Image, face: Face) -> NDArray[np.float32]:
        self.calls += 1
        vector = np.ones(EMBEDDING_DIMENSIONS, dtype=np.float32)
        return vector / np.linalg.norm(vector)


ONE_FACE = [(0.3, 0.2, 0.4, 0.5)]


def make_client(
    faces: Sequence[tuple[float, float, float, float]] = ONE_FACE,
    recognizer: CountingRecognizer | None = None,
    **overrides: object,
) -> TestClient:
    settings = Settings.model_validate({"service_token": TOKEN, **overrides})
    engine = FaceEngine(NormalisedFakeDetector(faces), recognizer or CountingRecognizer())
    return TestClient(create_app(settings, face_engine=engine), raise_server_exceptions=False)


def png(image: Image | None = None, name: str = "image.png") -> Upload:
    return (name, encode(image if image is not None else make_checkerboard(), "PNG"), "image/png")


def assert_problem(response: Response, status: int) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith(PROBLEM)
    body: dict[str, Any] = response.json()
    assert body["status"] == status
    assert body["type"] == "about:blank"
    return body


# --- POST /v1/analyze/government-id ---------------------------------------------------------


def test_government_id_front_only() -> None:
    response = make_client().post("/v1/analyze/government-id", files={"front": png()}, headers=AUTH)

    assert response.status_code == 200, response.text
    body = response.json()
    GovernmentIdAnalysis.model_validate(body)
    assert body["model_versions"] == GOVERNMENT_ID_VERSIONS
    front = body["sides"]["front"]
    assert set(front) == PHASE1_SIDE_KEYS | V2_SIDE_KEYS
    assert front["faces"] == [{"bbox": [76.8, 51.2, 102.4, 128.0], "score": 0.95}]
    assert front["portrait"]["bbox"] == [76.8, 51.2, 102.4, 128.0]
    assert len(front["portrait"]["embedding"]) == EMBEDDING_DIMENSIONS
    assert front["quality"]["is_blurry"] is False
    assert body["sides"]["back"] is None


def test_government_id_back_is_analysed_without_a_portrait() -> None:
    recognizer = CountingRecognizer()
    client = make_client(recognizer=recognizer)

    response = client.post(
        "/v1/analyze/government-id",
        files={"front": png(), "back": png(make_noise(height=100, width=160))},
        headers=AUTH,
    )

    assert response.status_code == 200, response.text
    back = response.json()["sides"]["back"]
    assert len(back["faces"]) == 1  # faces are still reported on the back
    assert back["portrait"] is None  # but no biometric template is computed for it
    assert recognizer.calls == 1  # front portrait only


def test_government_id_without_a_face_has_no_portrait() -> None:
    response = make_client(faces=[]).post(
        "/v1/analyze/government-id", files={"front": png()}, headers=AUTH
    )

    front = response.json()["sides"]["front"]
    assert front["faces"] == []
    assert front["portrait"] is None


def test_government_id_sides_carry_the_v2_measurements() -> None:
    response = make_client().post(
        "/v1/analyze/government-id",
        files={"front": png(), "back": png(make_noise(height=100, width=160))},
        headers=AUTH,
    )

    assert response.status_code == 200, response.text
    sides = response.json()["sides"]
    for name in ("front", "back"):
        assert set(sides[name]) == PHASE1_SIDE_KEYS | V2_SIDE_KEYS, name
        # The Stage 1 stubs measure nothing yet and never invent a value.
        assert sides[name]["mrz"]["found"] is False
        assert sides[name]["text"] == []
        assert sides[name]["barcodes"] == []
        # C32.1 forensics: each side is measured; a PNG upload has no JPEG history.
        assert sides[name]["forensics"]["jpeg"] is None
    assert sides["back"]["portrait_clarity"] is None
    # C32.1 document detection: the square checkerboard front is no document; the back's frame
    # has the ID-1 aspect ratio (160 x 100), so it is taken as a tightly cropped card.
    assert sides["front"]["document"]["found"] is False
    assert sides["back"]["document"]["method"] == "full_frame"
    # Only a document has a pHash.
    assert sides["front"]["phash"] is None
    assert re.fullmatch(r"[0-9a-f]{16}", sides["back"]["phash"])


def test_selfie_and_embed_keep_the_phase_1_model_versions() -> None:
    client = make_client()

    selfie = client.post("/v1/analyze/selfie", files={"center": png()}, headers=AUTH)
    embed = client.post("/v1/embed/face", files={"image": png()}, headers=AUTH)

    # C41.1 adds the anti-spoofing models, null until the ensemble runs.
    assert selfie.json()["model_versions"] == {
        **VERSIONS,
        "anti_spoof_v2": None,
        "anti_spoof_v1se": None,
    }
    assert embed.json()["model_versions"] == VERSIONS


def test_government_id_requires_front() -> None:
    response = make_client().post("/v1/analyze/government-id", files={"back": png()}, headers=AUTH)

    body = assert_problem(response, 422)
    assert any("front" in error["loc"] for error in body["errors"])


# --- POST /v1/analyze/selfie ----------------------------------------------------------------


def test_selfie_center_only() -> None:
    response = make_client().post("/v1/analyze/selfie", files={"center": png()}, headers=AUTH)

    assert response.status_code == 200, response.text
    body = response.json()
    SelfieAnalysis.model_validate(body)
    poses = body["poses"]
    assert set(poses) == {"center", "left", "right"}
    # The Phase 1 keys stay; C41.1 adds the v2 measurements.
    assert {"quality", "faces", "face"} <= set(poses["center"])
    assert len(poses["center"]["face"]["embedding"]) == EMBEDDING_DIMENSIONS
    assert poses["left"] is None
    assert poses["right"] is None


def test_selfie_with_all_three_poses() -> None:
    recognizer = CountingRecognizer()

    response = make_client(recognizer=recognizer).post(
        "/v1/analyze/selfie",
        files={"center": png(), "left": png(), "right": png()},
        headers=AUTH,
    )

    poses = response.json()["poses"]
    assert all(poses[name]["face"] is not None for name in ("center", "left", "right"))
    assert recognizer.calls == 3


def test_selfie_reports_every_face() -> None:
    two_faces = [(0.05, 0.05, 0.3, 0.3), (0.6, 0.6, 0.2, 0.2)]

    response = make_client(faces=two_faces).post(
        "/v1/analyze/selfie", files={"center": png()}, headers=AUTH
    )

    center = response.json()["poses"]["center"]
    assert len(center["faces"]) == 2
    assert center["face"]["bbox"] == center["faces"][0]["bbox"]  # the larger one


def test_selfie_requires_center() -> None:
    response = make_client().post("/v1/analyze/selfie", files={"left": png()}, headers=AUTH)

    body = assert_problem(response, 422)
    assert any("center" in error["loc"] for error in body["errors"])


def test_a_one_pixel_side_pose_beside_an_edge_flush_centre_face_is_analysed() -> None:
    """H007 (Workflow 4B review): with the centre's face flush with its right and bottom edges, a
    1 x 1 side pose's crop came out empty and the analysis answered an untyped 500."""
    client = make_client(faces=[(0.7, 0.7, 0.3, 0.3)])

    response = client.post(
        "/v1/analyze/selfie",
        files={"center": png(), "left": png(make_uniform(90, height=1, width=1), "l.png")},
        headers=AUTH,
    )

    assert response.status_code == 200, response.text
    assert [entry["pose"] for entry in response.json()["consistency"]] == ["left"]


def test_selfie_quality_uses_settings() -> None:
    client = make_client(brightness_min=0.6, brightness_max=1.0)

    response = client.post(
        "/v1/analyze/selfie", files={"center": png(make_uniform(51))}, headers=AUTH
    )

    quality = response.json()["poses"]["center"]["quality"]
    assert quality["is_too_dark"] is True
    assert quality["brightness"] == pytest.approx(0.2)


# --- POST /v1/embed/face --------------------------------------------------------------------


def test_embed_face() -> None:
    response = make_client(faces=[(0.1, 0.1, 0.2, 0.2), (0.5, 0.5, 0.4, 0.4)]).post(
        "/v1/embed/face", files={"image": png()}, headers=AUTH
    )

    assert response.status_code == 200, response.text
    body = response.json()
    FaceEmbeddingResult.model_validate(body)
    assert set(body) == {"model_versions", "face", "face_count"}
    assert body["face_count"] == 2
    assert body["face"]["bbox"] == [128.0, 128.0, 102.4, 102.4]


def test_embed_face_without_a_face() -> None:
    response = make_client(faces=[]).post("/v1/embed/face", files={"image": png()}, headers=AUTH)

    assert response.json() == {"model_versions": VERSIONS, "face": None, "face_count": 0}


# --- K101 (Workflow 3B review): the ID portrait is the face on the document -----------------

SCENE_SIZE = (1600, 1200)
"""``(width, height)`` of a 4:3 camera frame."""

LIVE_FACE: Box = (1170.0, 330.0, 340.0, 460.0)
"""A person's own face beside the card they hold up: larger than the card's portrait."""


def card_beside_a_face() -> tuple[Image, Box]:
    """A synthetic card on a table, left in the frame, next to a larger face-coloured oval at
    :data:`LIVE_FACE`; and the card's portrait box in scene pixels."""
    card = make_card()
    corners = card_corners(530, 600, 1000)
    scene = place_card(card, corners, SCENE_SIZE).image
    x, y, w, h = LIVE_FACE
    centre, axes = (round(x + w / 2), round(y + h / 2)), (round(w / 2), round(h / 2))
    cv2.ellipse(scene, centre, axes, 0, 0, 360, (120, 150, 200), -1)
    px, py, pw, ph = card.portrait
    ends = np.array([[px, py, 1.0], [px + pw, py + ph, 1.0]]) @ card_to_scene(card, corners).T
    (left, top), (right, bottom) = ends[:, :2] / ends[:, 2:]
    return scene, (float(left), float(top), float(right - left), float(bottom - top))


def normalised(box: Box, size: tuple[int, int] = SCENE_SIZE) -> Box:
    x, y, w, h = box
    width, height = size
    return (x / width, y / height, w / width, h / height)


def embed_as(client: TestClient, image: Image, subject: str | None) -> Response:
    data = {} if subject is None else {"subject": subject}
    return client.post("/v1/embed/face", files={"image": png(image)}, data=data, headers=AUTH)


def test_embed_face_for_a_document_is_the_face_on_the_card() -> None:
    scene, portrait = card_beside_a_face()
    client = make_client(faces=[normalised(LIVE_FACE), normalised(portrait)])

    response = embed_as(client, scene, "document")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["face"]["bbox"] == pytest.approx(list(portrait), abs=0.01)
    assert body["face_count"] == 1  # the faces on the document


@pytest.mark.parametrize("subject", [None, "selfie"])
def test_embed_face_for_a_selfie_is_the_largest_face_in_the_image(subject: str | None) -> None:
    scene, portrait = card_beside_a_face()
    client = make_client(faces=[normalised(LIVE_FACE), normalised(portrait)])

    response = embed_as(client, scene, subject)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["face"]["bbox"] == pytest.approx(list(LIVE_FACE), abs=0.01)
    assert body["face_count"] == 2


def test_embed_face_for_a_full_frame_card_is_unchanged() -> None:
    card = make_card()  # the whole upload is the card: document method full_frame
    size = (card.image.shape[1], card.image.shape[0])
    ghost = (700.0, 300.0, 90.0, 110.0)  # a smaller second portrait, also on the card
    client = make_client(faces=[normalised(ghost, size), normalised(card.portrait, size)])

    document = embed_as(client, card.image, "document")
    selfie = embed_as(client, card.image, None)

    assert document.status_code == 200, document.text
    assert document.json() == selfie.json()
    assert document.json()["face"]["bbox"] == pytest.approx(list(card.portrait), abs=0.01)
    assert document.json()["face_count"] == 2


def test_embed_face_for_a_document_with_no_face_on_it_is_no_face() -> None:
    scene, _ = card_beside_a_face()
    recognizer = CountingRecognizer()
    client = make_client(faces=[normalised(LIVE_FACE)], recognizer=recognizer)

    response = embed_as(client, scene, "document")

    assert response.status_code == 200, response.text
    assert response.json() == {"model_versions": VERSIONS, "face": None, "face_count": 0}
    assert recognizer.calls == 0  # no template of a face that is not on the document


def test_embed_face_refuses_an_unknown_subject() -> None:
    response = embed_as(make_client(), make_checkerboard(), "passport")

    body = assert_problem(response, 422)
    assert any("subject" in error["loc"] for error in body["errors"])
    assert "passport" not in response.text  # the submitted value is never echoed back


def test_government_id_portrait_is_the_face_on_the_card() -> None:
    scene, portrait = card_beside_a_face()
    client = make_client(faces=[normalised(LIVE_FACE), normalised(portrait)])

    response = client.post("/v1/analyze/government-id", files={"front": png(scene)}, headers=AUTH)

    assert response.status_code == 200, response.text
    front = response.json()["sides"]["front"]
    assert front["document"]["method"] == "contour"
    faces = [face["bbox"] for face in front["faces"]]  # every face is still reported
    assert faces == [
        pytest.approx(list(LIVE_FACE), abs=0.01),
        pytest.approx(list(portrait), abs=0.01),
    ]
    assert front["portrait"]["bbox"] == pytest.approx(list(portrait), abs=0.01)
    assert front["portrait_clarity"]["face_width_px"] == pytest.approx(portrait[2], abs=0.01)
    # The portrait box lies on the rectified card, so its glare and boundary are measured.
    assert front["document_quality"]["glare_ratio_portrait"] is not None
    assert front["forensics"]["portrait_boundary_score"] is not None


def test_government_id_with_no_face_on_the_card_has_no_portrait() -> None:
    scene, _ = card_beside_a_face()
    recognizer = CountingRecognizer()
    client = make_client(faces=[normalised(LIVE_FACE)], recognizer=recognizer)

    response = client.post("/v1/analyze/government-id", files={"front": png(scene)}, headers=AUTH)

    assert response.status_code == 200, response.text
    front = response.json()["sides"]["front"]
    assert front["document"]["method"] == "contour"
    assert len(front["faces"]) == 1
    assert front["portrait"] is None
    assert front["portrait_clarity"] is None
    assert front["document_quality"]["glare_ratio_portrait"] is None
    assert front["forensics"]["portrait_boundary_score"] is None
    assert recognizer.calls == 0


# --- shared rules ---------------------------------------------------------------------------

ENDPOINTS = [
    ("/v1/analyze/government-id", "front"),
    ("/v1/analyze/selfie", "center"),
    ("/v1/embed/face", "image"),
]


@pytest.mark.parametrize(("path", "field"), ENDPOINTS)
@pytest.mark.parametrize("headers", [{}, {"x-service-token": "wrong"}])
def test_endpoints_require_the_service_token(
    path: str, field: str, headers: dict[str, str]
) -> None:
    response = make_client().post(path, files={field: png()}, headers=headers)

    assert_problem(response, 401)
    assert TOKEN not in response.text


@pytest.mark.parametrize(("path", "field"), ENDPOINTS)
def test_non_image_is_415_naming_the_field(path: str, field: str) -> None:
    response = make_client().post(
        path, files={field: ("x.png", b"plain text", "image/png")}, headers=AUTH
    )

    body = assert_problem(response, 415)
    assert body["detail"].startswith(f"{field}: ")
    assert "JPEG" in body["detail"]


def test_optional_field_errors_name_the_field() -> None:
    corrupt = encode(make_checkerboard(), "PNG")[:200]

    response = make_client().post(
        "/v1/analyze/government-id",
        files={"front": png(), "back": ("b.png", corrupt, "image/png")},
        headers=AUTH,
    )

    body = assert_problem(response, 422)
    assert body["detail"].startswith("back: ")


def test_file_over_upload_limit_is_413_naming_the_field() -> None:
    client = make_client(max_upload_bytes=5_000)
    big = encode(make_noise(height=64, width=64), "PNG")
    assert len(big) > 5_000

    response = client.post(
        "/v1/analyze/selfie",
        files={"center": png(make_uniform(128, height=8, width=8)), "left": ("l.png", big, "x")},
        headers=AUTH,
    )

    body = assert_problem(response, 413)
    assert body["detail"].startswith("left: ")
    assert "5000" in body["detail"]


def test_image_over_pixel_limit_is_413() -> None:
    response = make_client(max_image_pixels=100).post(
        "/v1/embed/face", files={"image": png(make_uniform(128, height=20, width=20))}, headers=AUTH
    )

    assert_problem(response, 413)


def test_three_files_each_just_under_the_limit_fit_in_one_request() -> None:
    assert MAX_FILES_PER_REQUEST == 3
    noise = encode(make_noise(height=80, width=80, seed=3), "PNG")  # ~19 KB, incompressible
    client = make_client(max_upload_bytes=len(noise))

    response = client.post(
        "/v1/analyze/selfie",
        files={"center": ("c.png", noise, "x"), "left": ("l.png", noise, "x"), "right": png()},
        headers=AUTH,
    )

    assert response.status_code == 200, response.text


def test_request_far_over_the_combined_limit_is_413() -> None:
    client = make_client(max_upload_bytes=1_000)

    response = client.post(
        "/v1/analyze/selfie", files={"center": ("c.png", b"\x00" * 500_000, "x")}, headers=AUTH
    )

    assert_problem(response, 413)


# --- missing weights ------------------------------------------------------------------------


def real_loader_client(models_dir: Path, engine: FaceEngine | None = None) -> TestClient:
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": str(models_dir)})
    return TestClient(create_app(settings, face_engine=engine), raise_server_exceptions=False)


@pytest.mark.parametrize(("path", "field"), ENDPOINTS)
def test_missing_weights_are_503_naming_the_fetch_command(
    tmp_path: Path, path: str, field: str
) -> None:
    client = real_loader_client(tmp_path)  # default engine: real lazy loaders, empty dir

    response = client.post(path, files={field: png()}, headers=AUTH)

    body = assert_problem(response, 503)
    assert "python3 scripts/fetch_models.py" in body["detail"]
    assert str(tmp_path) not in body["detail"]  # no server paths in the response


def test_missing_recognizer_alone_is_503_even_without_faces(tmp_path: Path) -> None:
    engine = FaceEngine(NormalisedFakeDetector([]), FaceRecognizer(tmp_path / "absent.onnx"))

    response = real_loader_client(tmp_path, engine).post(
        "/v1/analyze/government-id", files={"front": png()}, headers=AUTH
    )

    assert_problem(response, 503)


def test_weights_fetched_later_are_picked_up_without_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    detector = FaceDetector(tmp_path / "yunet.onnx")
    engine = FaceEngine(detector, CountingRecognizer())
    client = real_loader_client(tmp_path, engine)

    first = client.post("/v1/embed/face", files={"image": png()}, headers=AUTH)
    (tmp_path / "yunet.onnx").write_bytes(b"placeholder")
    monkeypatch.setattr(
        "openverify_vision.faces._create_yunet", lambda **_: NormalisedFakeDetectorYuNet()
    )
    second = client.post("/v1/embed/face", files={"image": png()}, headers=AUTH)

    assert first.status_code == 503
    assert second.status_code == 200, second.text


class NormalisedFakeDetectorYuNet:
    def setInputSize(self, size: tuple[int, int]) -> None:  # noqa: N802 - OpenCV's API name
        pass

    def detect(self, image: Image) -> tuple[int, None]:
        return 1, None


def test_engine_failures_are_a_generic_500(monkeypatch: pytest.MonkeyPatch) -> None:
    client = make_client()

    def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("internal detail that must not leak")

    # C41.1: the selfie route composes through analysis.analyze_selfie_pose.
    monkeypatch.setattr("openverify_vision.analysis.analyze_image", boom)

    response = client.post("/v1/analyze/selfie", files={"center": png()}, headers=AUTH)

    assert_problem(response, 500)
    assert "must not leak" not in response.text


def test_default_engine_is_created_lazily_from_settings(tmp_path: Path) -> None:
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": str(tmp_path)})

    app = create_app(settings)

    engine = app.state.face_engine
    assert isinstance(engine, FaceEngine)
    assert engine.detector.is_loaded is False
