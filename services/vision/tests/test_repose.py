"""The re-pose helper (C40.11, C45.2) and the yaw ratio it is measured with (C41.1).

The direction convention (C41.1): in the raw, unmirrored camera image, a user turning their head
to their own left moves the nose toward the image's right, so ``yaw_ratio`` increases. Positive
``yaw_deg`` in the helper is that turn.
"""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray

from openverify_vision.faces import YUNET_FILENAME, FaceDetector
from openverify_vision.pose import CANONICAL_LANDMARKS_CM, CANONICAL_LANDMARKS_SOURCE, yaw_ratio
from repose import (
    CanonicalMesh,
    default_mesh_path,
    load_canonical_mesh,
    project_canonical,
    render_reposed,
    rotate_yaw,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = REPO_ROOT / "models"
FACES_DIR = REPO_ROOT / "fixtures" / "faces"
MESH = default_mesh_path(MODELS_DIR)
YUNET = MODELS_DIR / YUNET_FILENAME

needs_mesh = pytest.mark.skipif(
    not MESH.is_file(), reason="fetch the mesh: python3 scripts/fetch_models.py"
)

TINY_OBJ = """# a two-triangle mesh
v 0 0 1
v 1 0 1
v 0 1 1
v 1 1 0.5
vt 0 0
vt 1 0
vt 0 1
vt 1 1
f 1/1 2/2 3/3
f 2/2/1 4/4/1 3/3/1
"""

CANONICAL = np.asarray(CANONICAL_LANDMARKS_CM, dtype=np.float64)


# --- yaw_ratio (C41.1) -------------------------------------------------------------------------


def test_yaw_ratio_is_the_nose_offset_from_the_eye_midpoint_over_the_eye_distance() -> None:
    eyes_and_nose = [(100.0, 100.0), (140.0, 100.0), (130.0, 120.0), (105.0, 140.0), (135.0, 140.0)]
    assert yaw_ratio(eyes_and_nose) == pytest.approx(0.25)


def test_yaw_ratio_is_measured_after_de_rolling_by_the_eye_line() -> None:
    upright = [(100.0, 100.0), (140.0, 100.0), (130.0, 120.0), (105.0, 140.0), (135.0, 140.0)]
    angle = math.radians(25)
    centre = np.array([120.0, 100.0])
    rotation = np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])
    rolled = [tuple((rotation @ (np.array(p) - centre)) + centre) for p in upright]
    assert yaw_ratio(rolled) == pytest.approx(0.25)


def test_yaw_ratio_is_none_without_an_eye_distance() -> None:
    assert yaw_ratio([(5.0, 5.0), (5.0, 5.0), (6.0, 7.0), (4.0, 9.0), (6.0, 9.0)]) is None
    assert yaw_ratio([(5.0, 5.0)]) is None


# --- the canonical points (C41.1, research §2) ----------------------------------------------------


def test_the_canonical_points_are_mediapipes_in_yunet_order() -> None:
    assert CANONICAL.shape == (5, 3)
    assert CANONICAL[0] == pytest.approx((-3.1511, 2.6246, 3.4657), abs=1e-3)  # right eye
    assert CANONICAL[2] == pytest.approx((0.0, -1.1269, 7.4756), abs=1e-3)  # nose tip
    assert "canonical_face_model.obj" in CANONICAL_LANDMARKS_SOURCE
    assert "Apache-2.0" in CANONICAL_LANDMARKS_SOURCE


@needs_mesh
def test_the_canonical_points_come_from_the_mesh_vertices() -> None:
    vertices = load_canonical_mesh(MESH).vertices
    expected = np.stack(
        [
            (vertices[33] + vertices[133]) / 2,
            (vertices[362] + vertices[263]) / 2,
            vertices[1],
            vertices[61],
            vertices[291],
        ]
    )
    assert np.allclose(CANONICAL, expected, atol=1e-3)


# --- the mesh -----------------------------------------------------------------------------------


def test_load_canonical_mesh_reads_vertices_and_triangles(tmp_path: Path) -> None:
    path = tmp_path / "mesh.obj"
    path.write_text(TINY_OBJ, encoding="utf-8")
    mesh = load_canonical_mesh(path)
    assert mesh.vertices.shape == (4, 3)
    assert mesh.triangles.tolist() == [[0, 1, 2], [1, 3, 2]]


def test_load_canonical_mesh_refuses_a_face_outside_the_vertices(tmp_path: Path) -> None:
    path = tmp_path / "mesh.obj"
    path.write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n", encoding="utf-8")
    with pytest.raises(ValueError, match="vertex"):
        load_canonical_mesh(path)


def test_load_canonical_mesh_refuses_a_mesh_without_triangles(tmp_path: Path) -> None:
    path = tmp_path / "mesh.obj"
    path.write_text("v 0 0 0\n", encoding="utf-8")
    with pytest.raises(ValueError, match="triangle"):
        load_canonical_mesh(path)


@needs_mesh
def test_the_real_mesh_has_468_vertices_and_898_triangles() -> None:
    mesh = load_canonical_mesh(MESH)
    assert mesh.vertices.shape == (468, 3)
    assert mesh.triangles.shape == (898, 3)


# --- projection and direction (C41.1) -----------------------------------------------------------


def test_rotate_yaw_turns_the_nose_toward_the_image_right_for_a_left_turn() -> None:
    nose = CANONICAL[2:3]
    assert rotate_yaw(nose, 20.0)[0, 0] > 0
    assert rotate_yaw(nose, -20.0)[0, 0] < 0
    assert rotate_yaw(nose, 0.0) == pytest.approx(nose)


def test_a_projected_turn_to_the_users_left_gives_a_positive_yaw_ratio() -> None:
    def ratio(yaw: float) -> float:
        value = yaw_ratio([tuple(p) for p in project_canonical(CANONICAL, yaw)])
        assert value is not None
        return value

    assert ratio(0.0) == pytest.approx(0.0, abs=1e-9)
    assert ratio(20.0) > 0
    assert ratio(-20.0) < 0
    assert ratio(-20.0) == pytest.approx(-ratio(20.0), rel=1e-6)
    ratios = [ratio(float(yaw)) for yaw in range(0, 31, 5)]
    assert ratios == sorted(ratios)


def test_projection_keeps_the_face_in_the_frame() -> None:
    points = project_canonical(CANONICAL, 25.0, image_size=(640, 480))
    assert points.shape == (5, 2)
    assert (points[:, 0] > 0).all()
    assert (points[:, 0] < 640).all()
    assert (points[:, 1] > 0).all()
    assert (points[:, 1] < 480).all()


# --- rendering (C45.2) ---------------------------------------------------------------------------


def _synthetic_portrait() -> tuple[NDArray[np.uint8], NDArray[np.float64]]:
    rng = np.random.default_rng(20261021)
    noise = rng.integers(0, 256, (480, 640, 3), dtype=np.uint8)
    image = np.asarray(cv2.GaussianBlur(noise, (0, 0), 2.0), dtype=np.uint8)
    landmarks = project_canonical(CANONICAL, 0.0, image_size=(640, 480))
    return image, landmarks


@needs_mesh
def test_render_at_zero_yaw_keeps_the_portrait() -> None:
    image, landmarks = _synthetic_portrait()
    rendered = render_reposed(image, landmarks, 0.0, load_canonical_mesh(MESH))
    assert rendered.shape == image.shape
    assert rendered.dtype == np.uint8
    difference = np.abs(rendered.astype(np.int16) - image.astype(np.int16))
    assert float(difference.mean()) < 2.0


@needs_mesh
def test_render_changes_the_face_and_keeps_the_background() -> None:
    image, landmarks = _synthetic_portrait()
    rendered = render_reposed(image, landmarks, 20.0, load_canonical_mesh(MESH))
    difference = np.abs(rendered.astype(np.int16) - image.astype(np.int16)).sum(axis=2)
    x_min, y_min = landmarks.min(axis=0)
    x_max, y_max = landmarks.max(axis=0)
    face = difference[int(y_min) : int(y_max), int(x_min) : int(x_max)]
    assert float(face.mean()) > 5.0
    assert difference[:40, :40].max() == 0


def test_render_refuses_a_landmark_set_that_is_not_five_points() -> None:
    image, _ = _synthetic_portrait()
    mesh = CanonicalMesh(
        vertices=np.zeros((3, 3), dtype=np.float64), triangles=np.zeros((1, 3), dtype=np.int64)
    )
    with pytest.raises(ValueError, match="five"):
        render_reposed(image, np.zeros((4, 2)), 10.0, mesh)


@needs_mesh
@pytest.mark.skipif(
    not YUNET.is_file() or not FACES_DIR.is_dir(),
    reason="fetch the models and faces: python3 scripts/fetch_models.py; scripts/fetch_fixtures.py",
)
@pytest.mark.parametrize("face", ["person-a-selfie.jpg", "person-b-selfie.jpg"])
def test_yunet_reads_a_rendered_left_turn_as_a_larger_yaw_ratio(face: str) -> None:
    # As a 640-pixel capture frame: YuNet finds faces only up to about 380 pixels wide.
    portrait = np.asarray(cv2.imread(str(FACES_DIR / face)), dtype=np.uint8)
    scale = 640 / max(portrait.shape[:2])
    image = np.asarray(
        cv2.resize(portrait, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
        dtype=np.uint8,
    )
    detector = FaceDetector(YUNET)
    source = max(detector.detect(image), key=lambda f: f.area)
    mesh = load_canonical_mesh(MESH)

    def ratio(yaw: float) -> float:
        rendered = render_reposed(image, np.asarray(source.landmarks), yaw, mesh)
        found = max(detector.detect(rendered), key=lambda f: f.area)
        value = yaw_ratio(found.landmarks)
        assert value is not None
        return value

    centre = ratio(0.0)
    assert ratio(20.0) > centre
    assert ratio(-20.0) < centre
