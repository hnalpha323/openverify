"""C41.1 through ``POST /v1/analyze/selfie``: what ``vision-face`` measures on each pose.

The detector is a fake that finds the face ``selfie_faces`` drew (scaled to each copy the engine
searches), so no weights are needed. The real-model tests are in ``test_selfie_face_real.py``.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from PIL import Image as PILImage

from openverify_vision.analysis import FaceEngine
from openverify_vision.app import create_app
from openverify_vision.faces import Face
from openverify_vision.schemas import SelfieAnalysis
from openverify_vision.settings import Settings
from selfie_faces import FaceSpec, draw_face

from synthetic import Image, encode

TOKEN = "f" * 40
AUTH = {"x-service-token": TOKEN}
SPEC = FaceSpec()


class DrawnFaceDetector:
    """Finds the face :func:`draw_face` drew with ``SPEC``, in whatever copy it is shown."""

    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        height, width = img.shape[:2]
        _, face = draw_face(SPEC)
        fx, fy = width / SPEC.width, height / SPEC.height
        return [face.rescaled(fx, fy)]


class UnitRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: Image, face: Face) -> NDArray[np.float32]:
        vector = np.zeros(128, dtype=np.float32)
        vector[0] = 1.0
        return vector


@pytest.fixture
def client() -> Iterator[TestClient]:
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": str(Path("absent"))})
    engine = FaceEngine(DrawnFaceDetector(), UnitRecognizer())
    with TestClient(create_app(settings, face_engine=engine)) as test_client:
        yield test_client


def _png(image: Image) -> tuple[str, bytes, str]:
    return ("pose.png", encode(image, "PNG"), "image/png")


def test_each_pose_reports_the_face_quality_head_pose_and_occlusion(client: TestClient) -> None:
    image, face = draw_face(SPEC)
    response = client.post(
        "/v1/analyze/selfie", headers=AUTH, files={"center": _png(image), "left": _png(image)}
    )
    assert response.status_code == 200, response.text
    body = SelfieAnalysis.model_validate(response.json())
    for pose in (body.poses.center, body.poses.left):
        assert pose is not None
        assert pose.image.width == 640
        assert pose.image.height == 480
        assert pose.face_quality is not None
        assert pose.face_quality.box == pytest.approx(face.box, abs=0.01)
        assert pose.head_pose is not None
        assert pose.head_pose.yaw_ratio == pytest.approx(0.0, abs=1e-4)
        assert pose.head_pose.method == "yunet-5pt"
        assert pose.occlusion is not None
        assert pose.occlusion.covering.forehead_valid is True
        assert pose.occlusion.covering.score < 0.3
        assert pose.occlusion.glasses.score < 0.3
    assert body.poses.center.faces[0].landmarks[0] == pytest.approx(face.landmarks[0], abs=0.01)


def test_the_size_and_landmarks_are_in_exif_upright_pixels(client: TestClient) -> None:
    image, face = draw_face(SPEC)
    # Stored a quarter turn clockwise with EXIF orientation 8 (display it turned a quarter turn
    # counter-clockwise), so the upright image is the drawn one.
    stored = np.ascontiguousarray(np.rot90(image, k=-1))
    exif = PILImage.Exif()
    exif[0x0112] = 8
    buffer = io.BytesIO()
    PILImage.fromarray(stored[..., ::-1]).save(buffer, format="JPEG", quality=95, exif=exif)
    response = client.post(
        "/v1/analyze/selfie", headers=AUTH, files={"center": ("p.jpg", buffer.getvalue(), "x")}
    )
    assert response.status_code == 200, response.text
    center = response.json()["poses"]["center"]
    assert center["image"] == {"width": 640, "height": 480}
    assert center["faces"][0]["landmarks"][1] == pytest.approx(face.landmarks[1], abs=0.01)
    assert center["head_pose"]["roll_deg"] == pytest.approx(0.0, abs=0.01)


# --- passive liveness through the route (needs the pinned anti-spoofing ONNX files) -------------

MODELS_DIR = Path(__file__).resolve().parents[3] / "models"
MISSING_LIVENESS = [
    f"models/{name}"
    for name in ("MiniFASNetV2.onnx", "MiniFASNetV1SE.onnx")
    if not (MODELS_DIR / name).is_file()
]


@pytest.mark.skipif(
    bool(MISSING_LIVENESS),
    reason=f"anti-spoofing models missing ({', '.join(MISSING_LIVENESS)}); run "
    "python3 scripts/fetch_models.py",
)
def test_every_pose_with_a_face_gets_passive_liveness_from_the_settings_models() -> None:
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": str(MODELS_DIR)})
    engine = FaceEngine(DrawnFaceDetector(), UnitRecognizer())
    image, _ = draw_face(SPEC)
    with TestClient(create_app(settings, face_engine=engine)) as client:
        response = client.post(
            "/v1/analyze/selfie",
            headers=AUTH,
            files={"center": _png(image), "left": _png(image), "right": _png(image)},
        )
    assert response.status_code == 200, response.text
    body = SelfieAnalysis.model_validate(response.json())
    assert body.model_versions.anti_spoof_v2 == "minifasnet-v2-2.7"
    assert body.model_versions.anti_spoof_v1se == "minifasnet-v1se-4.0"
    for pose in (body.poses.center, body.poses.left, body.poses.right):
        assert pose is not None
        assert pose.passive_liveness is not None
        live = pose.passive_liveness
        assert live.mean == pytest.approx((live.v2 + live.v1se) / 2, abs=1e-4)
        assert 0 < live.effective_scales.v2 <= 2.7
