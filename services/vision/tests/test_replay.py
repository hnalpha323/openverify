"""C41.1 cross-pose consistency (research §7): identity, planarity, SSIM and duplicates.

Every frame is synthetic (a seeded colour texture); the face is the canonical face projected by
the Stage 1 re-pose helper, so no real face, landmark set or embedding is used. The 3-D re-pose
needs the canonical mesh (``python3 scripts/fetch_models.py``).
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray
from skimage.metrics import structural_similarity as skimage_ssim

from openverify_vision.faces import Face
from openverify_vision.pose import CANONICAL_LANDMARKS_CM
from openverify_vision.replay import (
    DUPLICATE_SSIM,
    FACE_WORK_WIDTH,
    FRAME_WORK_SIDE,
    MAX_TRACKED_POINTS,
    MIN_TRACKED_POINTS,
    CenterReference,
    PoseFrame,
    center_reference,
    measure_consistency,
    structural_similarity,
)
from repose import default_mesh_path, load_canonical_mesh, project_canonical, render_reposed

from synthetic import Image, encode

REPO_ROOT = Path(__file__).resolve().parents[3]
MESH = default_mesh_path(REPO_ROOT / "models")
needs_mesh = pytest.mark.skipif(
    not MESH.is_file(), reason="fetch the mesh: python3 scripts/fetch_models.py"
)

PLANAR_RESIDUAL_MAX = 0.0033
"""Research §7: a photo turned as a rigid plane by up to 30 degrees left at most 0.32 % of the
face width."""
REPOSE_RESIDUAL_MIN = 0.0062
"""Research §7: the smallest 3-D re-pose residual it measured (10 degrees) was 0.62 %."""


def textured(seed: int, height: int = 480, width: int = 640) -> Image:
    """A seeded colour texture: smooth blobs plus fine grain, so corners can be tracked."""
    rng = np.random.default_rng(seed)
    coarse = rng.normal(128.0, 40.0, (height // 4, width // 4, 3))
    image = cv2.resize(coarse, (width, height), interpolation=cv2.INTER_CUBIC)
    grain = rng.normal(0.0, 12.0, (height, width, 3))
    smoothed = cv2.GaussianBlur(image + grain, (0, 0), 1.0)
    return np.clip(smoothed, 0, 255).astype(np.uint8)


def landmarks_at(size: tuple[int, int] = (640, 480)) -> NDArray[np.float64]:
    """The canonical face's five points, frontal, seen by the helper's camera."""
    return project_canonical(
        np.asarray(CANONICAL_LANDMARKS_CM, dtype=np.float64), 0.0, image_size=size
    )


def face_of(points: NDArray[np.float64]) -> Face:
    """A YuNet-like box around the five points."""
    eyes = float(np.linalg.norm(points[1] - points[0]))
    centre_x = float(points[0, 0] + points[1, 0]) / 2
    top = float(points[0, 1]) - 0.9 * eyes
    height = float(points[3, 1]) - top + 0.6 * eyes
    width = 2.2 * eyes
    box = (centre_x - width / 2, top, width, height)
    return Face(box=box, landmarks=tuple((float(x), float(y)) for x, y in points), score=0.95)


def jpeg(image: Image, quality: int = 85) -> Image:
    ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return np.asarray(cv2.imdecode(buffer, cv2.IMREAD_COLOR), dtype=np.uint8)


def frame(
    image: Image, face: Face | None, embedding: tuple[float, ...] | None = None, **png: object
) -> PoseFrame:
    return PoseFrame(data=encode(image, "PNG", **png), image=image, face=face, embedding=embedding)


def planar_turn(image: Image, face: Face, degrees: float) -> Image:
    """``image`` as a flat print turned by ``degrees`` about a vertical axis through the face."""
    height, width = image.shape[:2]
    x, y, w, h = face.box
    camera = np.array([[width, 0.0, width / 2], [0.0, width, height / 2], [0.0, 0.0, 1.0]])
    angle = math.radians(degrees)
    rotation = np.array(
        [
            [math.cos(angle), 0.0, math.sin(angle)],
            [0.0, 1.0, 0.0],
            [-math.sin(angle), 0.0, math.cos(angle)],
        ]
    )
    anchor = np.linalg.inv(camera) @ np.array([x + w / 2, y + h / 2, 1.0]) * 60.0
    normal = np.array([0.0, 0.0, 1.0])
    translation = anchor - rotation @ anchor
    homography = (
        camera
        @ (rotation + np.outer(translation, normal) / (normal @ anchor))
        @ np.linalg.inv(camera)
    )
    warped = cv2.warpPerspective(
        image, homography, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT
    )
    return np.asarray(warped, dtype=np.uint8)


def unit(*values: float) -> tuple[float, ...]:
    vector = np.zeros(128)
    vector[: len(values)] = values
    return tuple(float(v) for v in vector / np.linalg.norm(vector))


FACE = face_of(landmarks_at())


# --- SSIM, our own, against scikit-image's (a dev-only oracle) ----------------------------------


def _grey(image: Image) -> Image:
    return np.asarray(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), dtype=np.uint8)


def _pairs() -> list[tuple[str, Image, Image]]:
    base = _grey(textured(1, 256, 256))
    shifted = np.roll(base, 2, axis=1)
    rng = np.random.default_rng(3)
    noisy = np.clip(shifted + rng.normal(0, 4, shifted.shape), 0, 255).astype(np.uint8)
    compressed = _grey(jpeg(cv2.cvtColor(noisy, cv2.COLOR_GRAY2BGR), 70))
    return [
        ("identical", base, base.copy()),
        ("2 px shift, noise and JPEG q70", base, compressed),
        ("20 px shift", base, np.roll(base, 20, axis=1)),
        ("another texture", base, _grey(textured(2, 256, 256))),
        ("non-square", base[:40, :90], np.roll(base, 5, axis=0)[:40, :90]),
        ("uniform", np.full((32, 32), 90, np.uint8), np.full((32, 32), 90, np.uint8)),
    ]


@pytest.mark.parametrize(("name", "first", "second"), _pairs(), ids=[p[0] for p in _pairs()])
def test_our_ssim_matches_scikit_images_gaussian_ssim(
    name: str, first: Image, second: Image
) -> None:
    expected = skimage_ssim(
        first, second, gaussian_weights=True, sigma=1.5, use_sample_covariance=False, data_range=255
    )
    assert structural_similarity(first, second) == pytest.approx(expected, abs=1e-9), name


def test_ssim_is_not_measured_on_a_region_too_small_for_its_window() -> None:
    tiny = np.zeros((12, 40), np.uint8)
    assert structural_similarity(tiny, tiny) is None


def test_ssim_refuses_images_of_different_sizes() -> None:
    with pytest.raises(ValueError, match="same size"):
        structural_similarity(np.zeros((32, 32), np.uint8), np.zeros((32, 33), np.uint8))


# --- identity -----------------------------------------------------------------------------------


def test_the_face_cosine_is_the_dot_product_of_the_two_unit_embeddings() -> None:
    image = textured(4)
    centre = frame(image, FACE, unit(1.0, 0.0))
    side = frame(jpeg(image), FACE, unit(0.6, 0.8))
    assert measure_consistency("left", centre, side).face_cosine_to_center == pytest.approx(0.6)


def test_the_face_cosine_is_not_measured_without_both_embeddings() -> None:
    image = textured(4)
    result = measure_consistency("right", frame(image, FACE, unit(1.0)), frame(image, FACE, None))
    assert result.pose == "right"
    assert result.face_cosine_to_center is None


# --- duplicates ----------------------------------------------------------------------------------


def test_byte_identical_poses_are_duplicates() -> None:
    centre = frame(textured(5), FACE)
    result = measure_consistency("left", centre, centre)
    assert result.duplicate_of_center is True


def test_the_same_pixels_in_other_bytes_are_duplicates_by_raw_ssim() -> None:
    image = textured(5)
    centre, side = frame(image, FACE, compress_level=1), frame(image, FACE, compress_level=9)
    assert hashlib.sha256(centre.data).digest() != hashlib.sha256(side.data).digest()
    result = measure_consistency("left", centre, side)
    assert result.raw_ssim == pytest.approx(1.0)
    assert result.duplicate_of_center is True


def test_a_resized_copy_of_the_centre_is_a_duplicate() -> None:
    image = textured(6)
    larger = np.asarray(cv2.resize(image, (1280, 960), interpolation=cv2.INTER_LINEAR), np.uint8)
    result = measure_consistency(
        "right", frame(image, FACE), frame(larger, face_of(landmarks_at() * 2))
    )
    assert result.raw_ssim is not None
    assert result.raw_ssim >= DUPLICATE_SSIM
    assert result.duplicate_of_center is True


def test_a_turned_print_is_not_a_duplicate() -> None:
    image = jpeg(textured(7))
    result = measure_consistency(
        "left", frame(image, FACE), frame(jpeg(planar_turn(image, FACE, 12)), FACE)
    )
    assert result.raw_ssim is not None
    assert result.raw_ssim < DUPLICATE_SSIM
    assert result.duplicate_of_center is False


# --- planarity (tracked points, forward-backward check, LMEDS homography) ------------------------


@pytest.mark.parametrize("degrees", [6, 12, 24, -12])
def test_a_planar_turn_of_a_still_leaves_a_tiny_residual(degrees: float) -> None:
    still = textured(8)
    centre = frame(jpeg(still), FACE)
    side = frame(jpeg(planar_turn(still, FACE, degrees)), FACE)
    planarity = measure_consistency("left", centre, side).planarity
    assert planarity is not None
    assert MIN_TRACKED_POINTS <= planarity.tracked_points <= MAX_TRACKED_POINTS
    assert planarity.median_residual_ratio < PLANAR_RESIDUAL_MAX
    assert planarity.p90_residual_ratio >= planarity.median_residual_ratio


@needs_mesh
@pytest.mark.parametrize("degrees", [12, -12, 24])
def test_a_3d_re_pose_leaves_a_larger_residual_than_a_planar_turn(degrees: float) -> None:
    mesh = load_canonical_mesh(MESH)
    still = textured(9)
    centre = frame(jpeg(still), FACE)
    turned = jpeg(render_reposed(still, landmarks_at(), degrees, mesh))
    flat = jpeg(planar_turn(still, FACE, degrees))
    repose = measure_consistency("left", centre, frame(turned, FACE)).planarity
    planar = measure_consistency("left", centre, frame(flat, FACE)).planarity
    assert repose is not None
    assert planar is not None
    assert repose.tracked_points >= MIN_TRACKED_POINTS
    assert repose.median_residual_ratio > REPOSE_RESIDUAL_MIN
    assert repose.median_residual_ratio > 5 * planar.median_residual_ratio


def test_identical_frames_fit_one_homography_exactly() -> None:
    image = textured(10)
    result = measure_consistency(
        "left", frame(image, FACE), frame(image.copy(), FACE, compress_level=9)
    )
    assert result.planarity is not None
    assert result.planarity.median_residual_ratio == pytest.approx(0.0, abs=1e-4)
    assert result.registered_ssim == pytest.approx(1.0, abs=1e-6)


def test_registration_restores_the_similarity_a_planar_turn_took_away() -> None:
    still = textured(11)
    result = measure_consistency(
        "right", frame(jpeg(still), FACE), frame(jpeg(planar_turn(still, FACE, 20)), FACE)
    )
    assert result.registered_ssim is not None
    assert result.raw_ssim is not None
    assert result.registered_ssim > result.raw_ssim
    assert result.registered_ssim > 0.9


def test_a_featureless_face_leaves_the_planarity_unmeasured() -> None:
    flat = np.full((480, 640, 3), 128, np.uint8)
    result = measure_consistency(
        "left", frame(flat, FACE), frame(flat.copy(), FACE, compress_level=9)
    )
    assert result.planarity is None
    assert result.registered_ssim is None
    assert result.raw_ssim == pytest.approx(1.0)


def test_points_that_cannot_be_tracked_leave_the_planarity_unmeasured() -> None:
    blank = np.full((480, 640, 3), 128, np.uint8)
    result = measure_consistency("left", frame(textured(15), FACE), frame(blank, FACE))
    assert result.planarity is None
    assert result.registered_ssim is None
    assert result.duplicate_of_center is False


def test_unrelated_frames_track_some_points_but_fit_no_plane() -> None:
    result = measure_consistency("left", frame(textured(15), FACE), frame(textured(16), FACE))
    assert result.planarity is not None
    assert result.planarity.median_residual_ratio > REPOSE_RESIDUAL_MIN


def test_no_homography_leaves_the_planarity_unmeasured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cv2, "findHomography", lambda *args, **kwargs: (None, None))
    image = textured(17)
    result = measure_consistency("left", frame(image, FACE), frame(jpeg(image), FACE))
    assert result.planarity is None
    assert result.registered_ssim is None
    assert result.raw_ssim is not None


def test_without_a_centre_face_only_the_whole_frames_are_compared() -> None:
    image = textured(12)
    result = measure_consistency(
        "left", frame(image, None), frame(jpeg(planar_turn(image, FACE, 12)), FACE)
    )
    assert result.planarity is None
    assert result.registered_ssim is None
    assert result.raw_ssim is not None
    assert result.duplicate_of_center is False


def test_a_face_box_outside_the_frame_measures_nothing_but_the_hash() -> None:
    image = textured(13)
    outside = Face(box=(900.0, 700.0, 100.0, 120.0), landmarks=FACE.landmarks, score=0.9)
    result = measure_consistency("left", frame(image, outside), frame(jpeg(image), outside))
    assert result.planarity is None
    assert result.raw_ssim is None
    assert result.registered_ssim is None
    assert result.duplicate_of_center is None


# --- hostile inputs stay bounded -----------------------------------------------------------------


def test_a_huge_face_is_tracked_on_a_bounded_copy(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[int, ...]] = []
    original = cv2.goodFeaturesToTrack

    def spy(image: Image, *args: object, **kwargs: object) -> object:
        seen.append(image.shape)
        return original(image, *args, **kwargs)

    monkeypatch.setattr(cv2, "goodFeaturesToTrack", spy)
    big = textured(14, 2400, 3200)
    face = face_of(landmarks_at() * 5)
    result = measure_consistency("left", frame(big, face), frame(jpeg(big), face))
    assert result.planarity is not None
    assert result.planarity.tracked_points <= MAX_TRACKED_POINTS
    assert seen
    assert all(max(shape[:2]) <= 3 * FACE_WORK_WIDTH for shape in seen)


# --- the centre reference: one full-size decode at a time (Workflow 4B review H008) -------------


OUTSIDE = Face(box=(900.0, 700.0, 100.0, 120.0), landmarks=FACE.landmarks, score=0.9)


@pytest.mark.parametrize("centre_face", [FACE, None, OUTSIDE], ids=["face", "no-face", "outside"])
def test_the_centre_reference_measures_exactly_what_the_centre_frame_does(
    centre_face: Face | None,
) -> None:
    image = textured(18)
    centre = frame(image, centre_face, (1.0, 0.0))
    reference = center_reference(centre)

    for side in (frame(jpeg(planar_turn(image, FACE, 12)), FACE, (0.6, 0.8)), centre):
        assert measure_consistency("left", reference, side) == measure_consistency(
            "left", centre, side
        )


def test_the_centre_reference_keeps_a_working_copy_not_the_frame() -> None:
    big = textured(14, 2400, 3200)
    face = face_of(landmarks_at() * 5)

    with_face = center_reference(frame(big, face))
    without = center_reference(frame(big, None))

    assert isinstance(with_face, CenterReference)
    assert with_face.crop is not None
    assert max(with_face.crop.shape[:2]) <= 3 * FACE_WORK_WIDTH
    assert with_face.crop.ndim == 2
    assert without.crop is not None
    assert max(without.crop.shape[:2]) <= FRAME_WORK_SIDE
    assert with_face.crop.base is None or with_face.crop.base is not big


# --- a tiny side pose beside an edge-flush centre face (Workflow 4B review H007) ----------------


EDGE_FACES = {
    "right-edge": Face(box=(540.0, 180.0, 100.0, 120.0), landmarks=FACE.landmarks, score=0.9),
    "bottom-edge": Face(box=(270.0, 360.0, 100.0, 120.0), landmarks=FACE.landmarks, score=0.9),
    "corner": Face(box=(540.0, 360.0, 100.0, 120.0), landmarks=FACE.landmarks, score=0.9),
}


@pytest.mark.parametrize("side_size", [(1, 1), (2, 3), (3, 1)], ids=["1x1", "2x3", "3x1"])
@pytest.mark.parametrize("edge", sorted(EDGE_FACES))
def test_a_tiny_side_pose_beside_an_edge_flush_centre_face_is_measured(
    edge: str, side_size: tuple[int, int]
) -> None:
    """H007: the side is read where the centre's face region lies, scaled to the side's size. With
    the face flush with the centre's right or bottom edge, that place started past a tiny side
    frame's last pixel, the crop came out empty and the analysis failed with an untyped 500."""
    width, height = side_size
    side = np.full((height, width, 3), 90, np.uint8)

    result = measure_consistency("left", frame(textured(19), EDGE_FACES[edge]), frame(side, None))

    assert result.raw_ssim is not None
    assert result.raw_ssim < DUPLICATE_SSIM
    assert result.duplicate_of_center is False


@pytest.mark.parametrize(
    ("centre_size", "box"),
    [
        ((368, 4), (28.72, 2.89, 339.28, 1.11)),
        ((391, 21), (-29.74, 11.46, 420.74, 1.01)),
    ],
    ids=["bottom-edge", "below-margin"],
)
def test_a_face_under_a_pixel_at_the_working_scale_is_not_an_error(
    centre_size: tuple[int, int], box: tuple[float, float, float, float]
) -> None:
    """H007: a random-geometry fuzz found a second empty crop. A face over 200 pixels wide is
    scaled down to 200, so one about a pixel tall shrinks under a pixel; at the centre's bottom
    edge its box in the working crop started on the crop's last row and came out empty, failing
    the SSIM. Too small to compare, it is not measured."""
    width, height = centre_size
    x, y, w, h = box
    landmarks = tuple((x + w * share, y + h / 2) for share in (0.3, 0.7, 0.5, 0.35, 0.65))
    face = Face(box=box, landmarks=landmarks, score=0.9)

    result = measure_consistency(
        "left", frame(textured(20, height, width), face), frame(textured(21, 57, 317), None)
    )

    assert result.raw_ssim is None
    assert result.planarity is None
    assert result.duplicate_of_center is None
