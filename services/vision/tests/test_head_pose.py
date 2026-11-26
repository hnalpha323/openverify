"""C41.1 ``head_pose``: the yaw ratio, the roll from the eye line, and coarse yaw and pitch by
SQPnP against MediaPipe's canonical face points.

Direction convention (C41.1): in the raw, unmirrored camera image a user turning their head to
their own left moves the nose toward the image's right, so ``yaw_ratio`` and ``yaw_deg``
increase. ``pitch_deg`` is positive with the chin up, ``roll_deg`` positive when the eye on the
image's right is lower (the head tilted clockwise as the image shows it).

Two tests pin the yaw direction independently of the clip generator: the pinhole projection of
the canonical points turned toward the user's left, and a horizontally mirrored real
public-domain photo (that one needs YuNet and the faces, and skips with the fetch commands).
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from pathlib import Path

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray

from measure_yaw_anchor import as_frame
from openverify_vision.faces import YUNET_FILENAME, Face, FaceDetector
from openverify_vision.pose import CANONICAL_LANDMARKS_CM, estimate_head_pose, yaw_ratio
from openverify_vision.schemas import HeadPose
from repose import default_mesh_path, load_canonical_mesh, project_canonical, render_reposed
from selfie_faces import mirrored

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = REPO_ROOT / "models"
FACES_DIR = REPO_ROOT / "fixtures" / "faces"
MANIFEST = REPO_ROOT / "fixtures" / "manifest.json"
CANONICAL = np.asarray(CANONICAL_LANDMARKS_CM, dtype=np.float64)
SIZE = (640, 480)
DISTANCE_CM = 60.0


def _face(points: NDArray[np.float64] | Sequence[tuple[float, float]]) -> Face:
    landmarks = tuple((float(x), float(y)) for x, y in points)
    xs, ys = [p[0] for p in landmarks], [p[1] for p in landmarks]
    width, height = max(xs) - min(xs), max(ys) - min(ys)
    box = (min(xs) - width * 0.5, min(ys) - height, width * 2.0, height * 2.5)
    return Face(box=box, landmarks=landmarks, score=0.95)


def _pose(points: NDArray[np.float64], size: tuple[int, int] = SIZE) -> HeadPose:
    result = estimate_head_pose(_face(points), size)
    assert result is not None
    return result


def _pitched(points: NDArray[np.float64], chin_up_deg: float) -> NDArray[np.float64]:
    """Canonical points (Y up, Z toward the viewer) tilted so the face looks up by the angle."""
    angle = math.radians(chin_up_deg)
    c, s = math.cos(angle), math.sin(angle)
    rotation = np.array([[1.0, 0.0, 0.0], [0.0, c, s], [0.0, -s, c]])
    return np.asarray(points @ rotation.T, dtype=np.float64)


def _project(points: NDArray[np.float64], size: tuple[int, int] = SIZE) -> NDArray[np.float64]:
    """A pinhole camera (f = image width) facing the canonical face from 60 cm."""
    width, height = size
    camera = points * np.array([1.0, -1.0, -1.0]) + np.array([0.0, 0.0, DISTANCE_CM])
    matrix = np.array([[width, 0.0, width / 2], [0.0, width, height / 2], [0.0, 0.0, 1.0]])
    projected = camera @ matrix.T
    return np.asarray(projected[:, :2] / projected[:, 2:3], dtype=np.float64)


def _rolled(points: NDArray[np.float64], clockwise_deg: float) -> NDArray[np.float64]:
    """Image points turned clockwise (as the image shows them) about the eye midpoint."""
    centre = (points[0] + points[1]) / 2
    angle = math.radians(clockwise_deg)
    c, s = math.cos(angle), math.sin(angle)
    rotation = np.array([[c, -s], [s, c]])  # y down: this turns the image's right side down
    return np.asarray((points - centre) @ rotation.T + centre, dtype=np.float64)


# --- the direction convention (C41.1) -----------------------------------------------------------


@pytest.mark.parametrize("yaw", [5.0, 10.0, 20.0, 30.0, 40.0])
def test_a_turn_to_the_users_left_gives_a_positive_yaw_ratio_and_yaw(yaw: float) -> None:
    left = _pose(project_canonical(CANONICAL, yaw))
    right = _pose(project_canonical(CANONICAL, -yaw))
    assert left.yaw_ratio > 0
    assert left.yaw_deg is not None
    assert left.yaw_deg > 0
    assert right.yaw_ratio < 0
    assert right.yaw_deg is not None
    assert right.yaw_deg < 0


def test_the_yaw_ratio_is_the_one_stage_1_fixed() -> None:
    points = project_canonical(CANONICAL, 17.0)
    result = _pose(points)
    expected = yaw_ratio([(float(x), float(y)) for x, y in points])
    assert expected is not None
    assert result.yaw_ratio == pytest.approx(expected, abs=5e-5)
    assert result.method == "yunet-5pt"


# --- SQPnP against the canonical points (research §2) -------------------------------------------


@pytest.mark.parametrize("yaw", [-40.0, -25.0, -10.0, 0.0, 10.0, 25.0, 40.0])
def test_sqpnp_recovers_the_yaw_of_the_exact_canonical_points(yaw: float) -> None:
    result = _pose(project_canonical(CANONICAL, yaw))
    assert result.yaw_deg == pytest.approx(yaw, abs=0.5)
    assert result.pitch_deg == pytest.approx(0.0, abs=0.5)
    # The eyes sit above the turn's axis, so perspective tilts a turned face's eye line a little
    # (2.3 degrees at 40): roll is the eye line's angle, not a 3-D roll.
    assert abs(result.roll_deg) < 2.5


@pytest.mark.parametrize("pitch", [-20.0, -10.0, 10.0, 20.0])
def test_sqpnp_recovers_the_pitch_with_the_chin_up_positive(pitch: float) -> None:
    result = _pose(_project(_pitched(CANONICAL, pitch)))
    assert result.pitch_deg == pytest.approx(pitch, abs=0.5)
    assert result.yaw_deg == pytest.approx(0.0, abs=0.5)


@pytest.mark.parametrize("roll", [-30.0, -12.0, 12.0, 30.0])
def test_roll_is_the_eye_line_angle_and_the_yaw_ratio_ignores_it(roll: float) -> None:
    turned = project_canonical(CANONICAL, 15.0)
    upright, rolled = _pose(turned), _pose(_rolled(turned, roll))
    assert rolled.roll_deg - upright.roll_deg == pytest.approx(roll, abs=0.05)
    assert rolled.yaw_ratio == pytest.approx(upright.yaw_ratio, abs=1e-4)


def test_the_angles_are_measured_against_the_images_own_size() -> None:
    big = (1280, 960)
    result = _pose(project_canonical(CANONICAL, 20.0, image_size=big), big)
    assert result.yaw_deg == pytest.approx(20.0, abs=0.5)


def test_the_result_is_rounded_for_the_contract() -> None:
    result = _pose(project_canonical(CANONICAL, 13.3))
    assert result.yaw_ratio == round(result.yaw_ratio, 4)
    for angle in (result.roll_deg, result.yaw_deg, result.pitch_deg):
        assert angle is not None
        assert angle == round(angle, 2)


# --- what is not measured -----------------------------------------------------------------------


def test_no_face_has_no_pose() -> None:
    assert estimate_head_pose(None, SIZE) is None


def test_coinciding_eyes_have_no_pose() -> None:
    face = _face([(10.0, 10.0), (10.0, 10.0), (12.0, 15.0), (8.0, 20.0), (12.0, 20.0)])
    assert estimate_head_pose(face, SIZE) is None


@pytest.mark.parametrize("bad", [float("nan"), float("inf")])
def test_a_landmark_that_is_not_finite_has_no_pose(bad: float) -> None:
    points = [(float(x), float(y)) for x, y in project_canonical(CANONICAL, 10.0)]
    points[2] = (bad, points[2][1])
    face = Face(box=(0.0, 0.0, 100.0, 100.0), landmarks=tuple(points), score=0.9)
    assert estimate_head_pose(face, SIZE) is None


def test_without_a_pnp_solution_only_the_yaw_ratio_and_roll_are_reported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cv2, "solvePnP", lambda *args, **kwargs: (False, None, None))
    result = _pose(project_canonical(CANONICAL, 10.0))
    assert result.yaw_ratio > 0
    assert result.yaw_deg is None
    assert result.pitch_deg is None


def test_a_solution_behind_the_camera_is_no_solution(monkeypatch: pytest.MonkeyPatch) -> None:
    behind = np.array([[0.0], [0.0], [-60.0]])
    monkeypatch.setattr(cv2, "solvePnP", lambda *args, **kwargs: (True, np.zeros((3, 1)), behind))
    result = _pose(project_canonical(CANONICAL, 10.0))
    assert result.yaw_deg is None
    assert result.pitch_deg is None


def test_an_opencv_failure_in_pnp_is_no_solution(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*args: object, **kwargs: object) -> None:
        raise cv2.error("degenerate")

    monkeypatch.setattr(cv2, "solvePnP", fail)
    result = _pose(project_canonical(CANONICAL, 10.0))
    assert result.yaw_deg is None


@pytest.mark.parametrize("size", [(1, 1), (0, 0), (100_000, 100_000)])
def test_hostile_image_sizes_stay_bounded(size: tuple[int, int]) -> None:
    result = estimate_head_pose(_face(project_canonical(CANONICAL, 10.0)), size)
    assert result is not None
    assert result.yaw_ratio > 0
    for angle in (result.yaw_deg, result.pitch_deg):
        assert angle is None or math.isfinite(angle)


def test_tiny_landmarks_still_give_the_direction() -> None:
    points = project_canonical(CANONICAL, 20.0)
    centre = points.mean(axis=0)
    tiny = (points - centre) / 40.0 + centre  # an IOD of about 2 pixels
    result = _pose(tiny)
    assert result.yaw_ratio > 0


# --- a mirrored real public-domain photo flips the sign (C41.1) ----------------------------------


def _missing() -> list[str]:
    required = [MODELS_DIR / YUNET_FILENAME, default_mesh_path(MODELS_DIR)]
    faces = json.loads(MANIFEST.read_text(encoding="utf-8"))["faces"]
    required += [FACES_DIR / face["filename"] for face in faces]
    return [str(path.relative_to(REPO_ROOT)) for path in required if not path.is_file()]


MISSING = _missing()
needs_real = pytest.mark.skipif(
    bool(MISSING),
    reason=(
        f"real-model fixtures missing ({', '.join(MISSING)}); run python3 scripts/fetch_models.py"
        " and python3 scripts/fetch_fixtures.py"
    ),
)


def _largest(detector: FaceDetector, image: np.ndarray) -> Face:
    faces = detector.detect(image)
    assert faces, "YuNet found no face"
    return max(faces, key=lambda face: face.area)


@needs_real
@pytest.mark.parametrize("name", ["person-a-id.jpg", "person-a-selfie.jpg", "person-b-selfie.jpg"])
def test_a_mirrored_public_domain_photo_flips_the_yaw_sign(name: str) -> None:
    """The photo turned 20 degrees toward the subject's left (the re-pose helper) reads a positive
    yaw, and the same image mirrored a negative one.

    An unmodified frontal photo cannot pin the sign: YuNet's landmarks are not mirror-symmetric,
    and its reading of a frontal face is mostly its own bias (person-a-id reads -0.0093 and its
    mirror +0.0657; person-a-selfie -0.0436 and -0.0078; person-b +0.0082 and +0.0676), and so
    is a 12 degree turn on one face (person-a-id +0.0399, mirrored +0.0091)."""
    detector = FaceDetector(MODELS_DIR / YUNET_FILENAME)
    mesh = load_canonical_mesh(default_mesh_path(MODELS_DIR))
    frame = as_frame(np.asarray(cv2.imread(str(FACES_DIR / name)), dtype=np.uint8))
    source = _largest(detector, frame)
    turned = render_reposed(frame, np.asarray(source.landmarks), 20.0, mesh)
    flipped = np.ascontiguousarray(turned[:, ::-1])
    size = (frame.shape[1], frame.shape[0])
    left = estimate_head_pose(_largest(detector, turned), size)
    right = estimate_head_pose(_largest(detector, flipped), size)
    assert left is not None
    assert right is not None
    print(f"\n{name} +20 deg: {left}; mirrored: {right}")
    assert left.yaw_ratio > 0 > right.yaw_ratio
    assert left.yaw_deg is not None
    assert right.yaw_deg is not None
    assert left.yaw_deg > 0 > right.yaw_deg


def test_the_synthetic_mirror_helper_swaps_the_labels_as_yunet_does() -> None:
    points = project_canonical(CANONICAL, 15.0)
    image = np.zeros((480, 640, 3), dtype=np.uint8)
    _, flipped = mirrored(image, _face(points))
    assert flipped.landmarks[0][0] < flipped.landmarks[1][0]
    original, mirror = _pose(points), estimate_head_pose(flipped, SIZE)
    assert mirror is not None
    assert mirror.yaw_ratio == pytest.approx(-original.yaw_ratio, abs=1e-3)
