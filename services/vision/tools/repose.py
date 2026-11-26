"""2.5-D re-posing of a public-domain portrait around MediaPipe's canonical face (C40.11, C45.2).

Shared test and fixture tooling (Workflow 4A Stage 1; the ``fixtures`` agent owns ``tools/``
from Stage 2). Two uses:

- :func:`project_canonical` projects canonical face points through a pinhole camera at a given
  yaw, for unit tests of the pose code (no image needed);
- :func:`render_reposed` turns the face of a portrait by a given yaw: it fits the canonical mesh
  to the face's five YuNet landmarks (SQPnP), texture-maps the mesh from the portrait, and
  renders the turned mesh back over the portrait, triangle by triangle, far to near. Hair, ears
  and the background stay where they were, and the old face hull can leave a seam: these are
  pipeline fixtures, never a measure of any detector's accuracy (research §10.4).

Positive ``yaw_deg`` turns the head to the subject's own left: in the raw, unmirrored image the
nose moves toward the image's right (the C41.1 convention). Mesh coordinates are MediaPipe's:
centimetres, X toward the image's right, Y up, Z toward the viewer.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.imaging import ImageArray
from openverify_vision.pose import CANONICAL_LANDMARKS_CM

MESH_FILENAME: Final = "canonical_face_model.obj"
"""Must match the ``canonical_face_mesh`` entry in ``models/manifest.json``."""

DEFAULT_DISTANCE_CM: Final = 60.0
"""Camera-to-face distance of :func:`project_canonical`: an arm's length selfie."""

_MIN_SOURCE_AREA: Final = 1e-6
_FIVE: Final = len(CANONICAL_LANDMARKS_CM)


@dataclass(frozen=True, slots=True)
class CanonicalMesh:
    vertices: NDArray[np.float64]
    """``(N, 3)`` in centimetres."""
    triangles: NDArray[np.int64]
    """``(M, 3)`` zero-based vertex indices."""


def default_mesh_path(models_dir: Path) -> Path:
    return models_dir / MESH_FILENAME


def load_canonical_mesh(path: Path) -> CanonicalMesh:
    """The vertices and triangles of a Wavefront OBJ (``v`` and ``f`` lines; the rest ignored)."""
    vertices: list[tuple[float, float, float]] = []
    triangles: list[tuple[int, int, int]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "v":
            vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
        elif parts[0] == "f":
            a, b, c = (int(token.split("/")[0]) - 1 for token in parts[1:4])
            triangles.append((a, b, c))
    if not triangles:
        raise ValueError(f"{path} has no triangle")
    table = np.asarray(triangles, dtype=np.int64)
    if table.min() < 0 or table.max() >= len(vertices):
        raise ValueError(f"{path} has a face with a vertex outside its {len(vertices)} vertices")
    return CanonicalMesh(vertices=np.asarray(vertices, dtype=np.float64), triangles=table)


def rotate_yaw(points: NDArray[np.float64], yaw_deg: float) -> NDArray[np.float64]:
    """``points`` turned about the vertical axis through the canonical origin."""
    angle = math.radians(yaw_deg)
    cos, sin = math.cos(angle), math.sin(angle)
    rotation = np.array([[cos, 0.0, sin], [0.0, 1.0, 0.0], [-sin, 0.0, cos]])
    return np.asarray(np.asarray(points, dtype=np.float64) @ rotation.T, dtype=np.float64)


def _camera_matrix(image_size: tuple[int, int]) -> NDArray[np.float64]:
    width, height = image_size
    return np.array([[width, 0.0, width / 2], [0.0, width, height / 2], [0.0, 0.0, 1.0]])


def _to_camera_axes(points: NDArray[np.float64]) -> NDArray[np.float64]:
    """MediaPipe axes (Y up, Z toward the viewer) to OpenCV's (Y down, Z away from the camera)."""
    return np.asarray(
        np.asarray(points, dtype=np.float64) * np.array([1.0, -1.0, -1.0]), dtype=np.float64
    )


def project_canonical(
    points: NDArray[np.float64],
    yaw_deg: float,
    *,
    image_size: tuple[int, int] = (640, 480),
    distance_cm: float = DEFAULT_DISTANCE_CM,
) -> NDArray[np.float64]:
    """Canonical points turned by ``yaw_deg``, seen by a pinhole camera (f = image width) facing
    the face from ``distance_cm``, with the canonical origin on the optical axis."""
    camera = _to_camera_axes(rotate_yaw(points, yaw_deg)) + np.array([0.0, 0.0, distance_cm])
    projected = camera @ _camera_matrix(image_size).T
    return np.asarray(projected[:, :2] / projected[:, 2:3], dtype=np.float64)


@dataclass(frozen=True, slots=True)
class _Pose:
    rotation: NDArray[np.float64]
    translation: NDArray[np.float64]
    camera: NDArray[np.float64]

    def to_camera(self, points: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(
            _to_camera_axes(points) @ self.rotation.T + self.translation, dtype=np.float64
        )

    def project(self, camera_points: NDArray[np.float64]) -> NDArray[np.float64]:
        projected = camera_points @ self.camera.T
        return np.asarray(projected[:, :2] / projected[:, 2:3], dtype=np.float64)


def _fit_pose(landmarks: NDArray[np.float64], image_size: tuple[int, int]) -> _Pose:
    camera = _camera_matrix(image_size)
    found, rvec, tvec = cv2.solvePnP(
        _to_camera_axes(np.asarray(CANONICAL_LANDMARKS_CM, dtype=np.float64)),
        np.asarray(landmarks, dtype=np.float64).reshape(-1, 1, 2),
        camera,
        None,
        flags=cv2.SOLVEPNP_SQPNP,
    )
    if not found:
        raise ValueError("the canonical face cannot be fitted to these landmarks")
    rotation, _ = cv2.Rodrigues(rvec)
    return _Pose(
        rotation=np.asarray(rotation, dtype=np.float64),
        translation=np.asarray(tvec, dtype=np.float64).reshape(3),
        camera=camera,
    )


def _signed_areas(points: NDArray[np.float64], triangles: NDArray[np.int64]) -> NDArray[np.float64]:
    a, b, c = points[triangles[:, 0]], points[triangles[:, 1]], points[triangles[:, 2]]
    return np.asarray(
        (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0]),
        dtype=np.float64,
    )


def _paint_triangle(
    out: ImageArray, source: ImageArray, src: NDArray[np.float32], dst: NDArray[np.float32]
) -> None:
    height, width = out.shape[:2]
    x, y, w, h = cv2.boundingRect(dst)
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + w, width), min(y + h, height)
    if x1 <= x0 or y1 <= y0:
        return
    local = dst - np.array([x0, y0], dtype=np.float32)
    transform = cv2.getAffineTransform(src, local)
    patch = cv2.warpAffine(
        source,
        transform,
        (x1 - x0, y1 - y0),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101,
    )
    mask = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)
    cv2.fillConvexPoly(mask, np.round(local).astype(np.int32), 255)
    region = out[y0:y1, x0:x1]
    region[mask > 0] = patch[mask > 0]


def render_reposed(
    image: ImageArray,
    landmarks: NDArray[np.float64],
    yaw_deg: float,
    mesh: CanonicalMesh,
) -> ImageArray:
    """The portrait with its face turned by ``yaw_deg`` about the head's vertical axis.

    ``landmarks`` are the face's five YuNet points in ``image`` (BGR, uint8). Triangles that face
    away from the camera after the turn are not drawn; the rest are painted far to near."""
    points = np.asarray(landmarks, dtype=np.float64)
    if points.shape != (_FIVE, 2):
        raise ValueError("render_reposed needs the five YuNet landmarks as (x, y) points")
    height, width = image.shape[:2]
    pose = _fit_pose(points, (width, height))
    source = pose.project(pose.to_camera(mesh.vertices))
    turned_camera = pose.to_camera(rotate_yaw(mesh.vertices, yaw_deg))
    target = pose.project(turned_camera)

    source_areas = _signed_areas(source, mesh.triangles)
    target_areas = _signed_areas(target, mesh.triangles)
    visible = (np.abs(source_areas) > _MIN_SOURCE_AREA) & (
        np.sign(source_areas) == np.sign(target_areas)
    )
    depth = turned_camera[mesh.triangles, 2].mean(axis=1)
    order = [int(i) for i in np.argsort(-depth) if visible[i]]

    out = image.copy()
    for index in order:
        triangle = mesh.triangles[index]
        _paint_triangle(
            out,
            image,
            source[triangle].astype(np.float32),
            target[triangle].astype(np.float32),
        )
    return out
