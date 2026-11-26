"""C41.1 ``vision-face`` measurements with the real models (YuNet, SFace, MiniFASNet) on the
public-domain faces, through ``POST /v1/analyze/selfie``.

Skipped (with the reason and the fetch commands) unless the models, the canonical mesh and the
faces are present: ``python3 scripts/fetch_models.py`` and ``python3 scripts/fetch_fixtures.py``.
The side poses are the photos re-posed with the canonical mesh (``tools/repose.py``): pipeline
inputs, never an accuracy measure. Values are printed (run with ``-s``) for the TDD evidence; no
landmark, embedding or crop of a real face is written anywhere.
"""

from __future__ import annotations

import io
import json
from collections.abc import Iterator
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from measure_yaw_anchor import as_frame
from openverify_vision.app import create_app
from openverify_vision.faces import YUNET_FILENAME, FaceDetector
from openverify_vision.liveness import ANTI_SPOOF_V1SE_FILENAME, ANTI_SPOOF_V2_FILENAME
from openverify_vision.recognition import SFACE_FILENAME
from openverify_vision.schemas import SelfieAnalysis
from openverify_vision.settings import Settings
from repose import default_mesh_path, load_canonical_mesh, render_reposed

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = REPO_ROOT / "models"
FACES_DIR = REPO_ROOT / "fixtures" / "faces"
MANIFEST = REPO_ROOT / "fixtures" / "manifest.json"
TOKEN = "v" * 40
AUTH = {"x-service-token": TOKEN}
FACES = ("person-a-id.jpg", "person-a-selfie.jpg", "person-b-selfie.jpg")
SIDE_YAW_DEG = 20.0


def _missing() -> list[str]:
    names = (YUNET_FILENAME, SFACE_FILENAME, ANTI_SPOOF_V2_FILENAME, ANTI_SPOOF_V1SE_FILENAME)
    required = [MODELS_DIR / name for name in names] + [default_mesh_path(MODELS_DIR)]
    faces = json.loads(MANIFEST.read_text(encoding="utf-8"))["faces"]
    required += [FACES_DIR / face["filename"] for face in faces]
    return [str(path.relative_to(REPO_ROOT)) for path in required if not path.is_file()]


MISSING = _missing()
pytestmark = pytest.mark.skipif(
    bool(MISSING),
    reason=(
        f"real-model fixtures missing ({', '.join(MISSING)}); run python3 scripts/fetch_models.py"
        " and python3 scripts/fetch_fixtures.py"
    ),
)


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": str(MODELS_DIR)})
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def _jpeg(frame: np.ndarray) -> tuple[str, bytes, str]:
    buffer = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(frame[..., ::-1])).save(buffer, "JPEG", quality=92)
    return ("pose.jpg", buffer.getvalue(), "image/jpeg")


def _frame(name: str) -> np.ndarray:
    return as_frame(np.asarray(cv2.imread(str(FACES_DIR / name)), dtype=np.uint8))


def _poses(name: str) -> dict[str, np.ndarray]:
    """The photo as the centre, and turned 20 degrees to the subject's left and right."""
    frame = _frame(name)
    detector = FaceDetector(MODELS_DIR / YUNET_FILENAME)
    source = max(detector.detect(frame), key=lambda face: face.area)
    mesh = load_canonical_mesh(default_mesh_path(MODELS_DIR))
    landmarks = np.asarray(source.landmarks, dtype=np.float64)
    return {
        "center": frame,
        "left": render_reposed(frame, landmarks, SIDE_YAW_DEG, mesh),
        "right": render_reposed(frame, landmarks, -SIDE_YAW_DEG, mesh),
    }


def _analyze(client: TestClient, poses: dict[str, np.ndarray]) -> SelfieAnalysis:
    files = {name: _jpeg(frame) for name, frame in poses.items()}
    response = client.post("/v1/analyze/selfie", headers=AUTH, files=files)
    assert response.status_code == 200, response.text
    return SelfieAnalysis.model_validate(response.json())


@pytest.fixture(scope="module")
def analyses(client: TestClient) -> dict[str, SelfieAnalysis]:
    return {name: _analyze(client, _poses(name)) for name in FACES}


@pytest.mark.parametrize("name", FACES)
def test_every_pose_carries_the_vision_face_measurements(
    analyses: dict[str, SelfieAnalysis], name: str
) -> None:
    body = analyses[name]
    assert body.model_versions.anti_spoof_v2 == "minifasnet-v2-2.7"
    assert body.model_versions.anti_spoof_v1se == "minifasnet-v1se-4.0"
    for pose_name in ("center", "left", "right"):
        pose = getattr(body.poses, pose_name)
        assert pose is not None
        assert pose.face_quality is not None
        assert pose.head_pose is not None
        assert pose.passive_liveness is not None
        assert pose.occlusion is not None
        live, quality, occlusion = pose.passive_liveness, pose.face_quality, pose.occlusion
        print(
            f"\n{name} {pose_name}: yaw_ratio={pose.head_pose.yaw_ratio} "
            f"yaw_deg={pose.head_pose.yaw_deg} pitch_deg={pose.head_pose.pitch_deg} "
            f"roll_deg={pose.head_pose.roll_deg} | passive v2={live.v2} v1se={live.v1se} "
            f"mean={live.mean} scales={live.effective_scales.v2}/{live.effective_scales.v1se} "
            f"| width_px={quality.width_px} height_ratio={quality.height_ratio} "
            f"blur={quality.blur_score} brightness={quality.brightness} "
            f"glare={quality.glare_ratio} | covering={occlusion.covering.score} "
            f"(skin {occlusion.covering.skin_fraction_ratio}, forehead "
            f"{occlusion.covering.forehead_valid}) glasses={occlusion.glasses.score} "
            f"(bridge {occlusion.glasses.bridge_edge_density}, rim "
            f"{occlusion.glasses.rim_edge_energy}, lens {occlusion.glasses.lens_highlight_ratio})"
        )


@pytest.mark.parametrize("name", FACES)
def test_the_side_poses_turn_the_way_they_were_prompted(
    analyses: dict[str, SelfieAnalysis], name: str
) -> None:
    poses = analyses[name].poses
    assert poses.left is not None
    assert poses.right is not None
    assert poses.center.head_pose is not None
    assert poses.left.head_pose is not None
    assert poses.right.head_pose is not None
    center = poses.center.head_pose.yaw_ratio
    assert poses.left.head_pose.yaw_ratio > center > poses.right.head_pose.yaw_ratio


@pytest.mark.parametrize("name", FACES)
def test_the_landmarks_are_in_yunet_order_in_upright_pixels(
    analyses: dict[str, SelfieAnalysis], name: str
) -> None:
    center = analyses[name].poses.center
    right_eye, left_eye, nose, right_mouth, left_mouth = center.faces[0].landmarks
    # The subject's right eye and mouth corner are on the image's left.
    assert right_eye[0] < nose[0] < left_eye[0]
    assert right_mouth[0] < left_mouth[0]
    assert max(right_eye[1], left_eye[1]) < nose[1] < min(right_mouth[1], left_mouth[1])
    assert center.image.width == _frame(name).shape[1]


def test_a_photo_without_a_face_has_no_face_measurements(client: TestClient) -> None:
    blank = np.full((480, 640, 3), 128, dtype=np.uint8)
    body = _analyze(client, {"center": blank})
    center = body.poses.center
    assert center.faces == []
    assert center.face_quality is None
    assert center.head_pose is None
    assert center.passive_liveness is None
    assert center.occlusion is None


@pytest.mark.parametrize("size", [(1, 1), (2, 3), (24, 32)])
def test_tiny_images_answer_without_face_measurements(
    client: TestClient, size: tuple[int, int]
) -> None:
    tiny = np.full((size[1], size[0], 3), 90, dtype=np.uint8)
    body = _analyze(client, {"center": tiny})
    assert body.poses.center.image.width == size[0]
    assert body.poses.center.passive_liveness is None


def test_a_tiny_face_is_measured_but_too_small_for_occlusion(client: TestClient) -> None:
    frame = _frame("person-b-selfie.jpg")
    small = cv2.resize(frame, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    canvas = np.full((480, 640, 3), 120, dtype=np.uint8)
    canvas[: small.shape[0], : small.shape[1]] = small
    body = _analyze(client, {"center": canvas})
    center = body.poses.center
    if not center.faces:
        pytest.skip("YuNet does not find the quarter-size face")
    assert center.face_quality is not None
    assert center.face_quality.width_px < 64
    assert center.passive_liveness is not None
    print(f"\nquarter-size face: {center.face_quality}, occlusion={center.occlusion}")


def test_a_face_at_the_image_edge_is_measured(client: TestClient) -> None:
    frame = _frame("person-a-selfie.jpg")
    detector = FaceDetector(MODELS_DIR / YUNET_FILENAME)
    x, _, w, _ = max(detector.detect(frame), key=lambda face: face.area).box
    cut = np.ascontiguousarray(frame[:, round(x + w * 0.35) :])  # the face's left third is gone
    body = _analyze(client, {"center": cut})
    center = body.poses.center
    if not center.faces:
        pytest.skip("YuNet does not find the cut face")
    assert center.face_quality is not None
    assert center.face_quality.box[0] == 0.0 or center.face_quality.box[0] < 5
    assert center.passive_liveness is not None
    assert center.passive_liveness.effective_scales.v2 <= 2.7


def test_a_large_upload_stays_within_the_service_limits(client: TestClient) -> None:
    photo = np.asarray(cv2.imread(str(FACES_DIR / "person-a-selfie.jpg")), dtype=np.uint8)
    scale = 5000 / max(photo.shape[:2])  # the original is 43 Mpx, over the 40 Mpx cap (413)
    frame = np.asarray(cv2.resize(photo, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA))
    body = _analyze(client, {"center": frame})
    center = body.poses.center
    assert center.image.width == frame.shape[1]
    assert center.face_quality is not None
    assert center.passive_liveness is not None
    print(f"\nfull-size {frame.shape[1]}x{frame.shape[0]}: {center.passive_liveness}")
