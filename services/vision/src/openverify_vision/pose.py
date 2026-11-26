# CANONICAL_LANDMARKS_CM are derived from MediaPipe's canonical face mesh
# (https://github.com/google-ai-edge/mediapipe, commit a908d668c730da128dfa8d9f6bd25d519d006692,
# mediapipe/modules/face_geometry/data/canonical_face_model.obj).
# Copyright 2020 The MediaPipe Authors.
# Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0);
# see services/vision/NOTICE.
#
# Changed by the OpenVerify authors: five points taken from the mesh (the eye centres are the
# midpoints of vertices 33/133 and 362/263, the nose tip vertex 1, the mouth corners vertices 61
# and 291), rounded to four decimals. The rest of this module is new.
"""Head pose from the five YuNet landmarks (C41.1).

Workflow 4A Stage 1 fixed the yaw ratio and the canonical points every Stage 2 module and test
shares; ``vision-face`` adds :func:`estimate_head_pose` around them:

- ``yaw_ratio`` (:func:`yaw_ratio`), the measure decisions use, relative to the centre pose;
- ``roll_deg``, the eye line's angle in the image;
- ``yaw_deg`` and ``pitch_deg``, coarse angles from SQPnP (``cv2.SOLVEPNP_SQPNP``) of the five
  landmarks against :data:`CANONICAL_LANDMARKS_CM`, with a pinhole camera whose focal length is
  the image width and whose principal point is the image centre, without distortion. Research
  §2 found them good for the sign of a turn and poor for its size: YuNet's landmarks lag real
  head turns and lean toward an upright face, and frontal portraits read a pitch of +9 to +14
  degrees. ``SOLVEPNP_ITERATIVE`` is not used: its initialisation needs six points.

Sign conventions, in the raw, unmirrored camera image (C41.1):

- a user turning their head to their own left moves the nose toward the image's right, so
  ``yaw_ratio`` and ``yaw_deg`` increase;
- ``pitch_deg`` is positive with the chin up (the face turned upward);
- ``roll_deg`` is ``atan2(y_left_eye - y_right_eye, x_left_eye - x_right_eye)``: positive when
  the eye on the image's right is lower, the head tilted clockwise as the image shows it.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import TYPE_CHECKING, Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.schemas import HeadPose

if TYPE_CHECKING:
    from openverify_vision.faces import Face

Landmarks = Sequence[tuple[float, float]]
"""Five ``(x, y)`` points in YuNet order: right eye, left eye, nose tip, right and left mouth
corners (the subject's right and left), in image pixels."""

YAW_RATIO_METHOD: Final = "yunet-5pt"

CANONICAL_LANDMARKS_CM: Final[tuple[tuple[float, float, float], ...]] = (
    (-3.1511, 2.6246, 3.4657),  # right eye
    (3.1511, 2.6246, 3.4657),  # left eye
    (0.0, -1.1269, 7.4756),  # nose tip
    (-2.4562, -4.3426, 4.2839),  # right mouth corner
    (2.4562, -4.3426, 4.2839),  # left mouth corner
)
"""The YuNet points on MediaPipe's canonical face, in centimetres (Y up, Z toward the viewer)."""

CANONICAL_LANDMARKS_SOURCE: Final = (
    "MediaPipe canonical_face_model.obj at a908d66 (Apache-2.0): the eye centres are the "
    "midpoints of vertices 33/133 and 362/263, the nose tip vertex 1, the mouth corners vertices "
    "61 and 291 (docs/research/phase4-models.md §2)"
)
"""Where :data:`CANONICAL_LANDMARKS_CM` come from; the pose results record it (C39.1)."""

_EYE_DISTANCE_EPSILON: Final = 1e-9
_RATIO_DECIMALS: Final = 4
_ANGLE_DECIMALS: Final = 2

_CAMERA_AXES: Final = np.array([1.0, -1.0, -1.0])
"""MediaPipe's axes (Y up, Z toward the viewer) to OpenCV's camera axes (Y down, Z forward)."""
_OBJECT_POINTS: Final = np.asarray(CANONICAL_LANDMARKS_CM, dtype=np.float64) * _CAMERA_AXES


def yaw_ratio(landmarks: Landmarks) -> float | None:
    """``(x_nose - x_eye_mid) / inter-ocular distance``, after de-rolling by the eye line.

    ``None`` without five points or when the eyes coincide. Positive is a turn to the user's own
    left in an unmirrored image."""
    if len(landmarks) != len(CANONICAL_LANDMARKS_CM):
        return None
    (rx, ry), (lx, ly), (nx, ny) = landmarks[0], landmarks[1], landmarks[2]
    dx, dy = lx - rx, ly - ry
    distance = math.hypot(dx, dy)
    if distance < _EYE_DISTANCE_EPSILON:
        return None
    # The nose's offset from the eye midpoint, projected on the eye line (the de-rolled x axis).
    mx, my = (rx + lx) / 2, (ry + ly) / 2
    return ((nx - mx) * dx + (ny - my) * dy) / (distance * distance)


def _camera_matrix(image_size: tuple[int, int]) -> NDArray[np.float64]:
    width, height = image_size
    return np.array([[width, 0.0, width / 2], [0.0, width, height / 2], [0.0, 0.0, 1.0]])


def solve_yaw_pitch(
    landmarks: Landmarks, image_size: tuple[int, int]
) -> tuple[float, float] | None:
    """``(yaw_deg, pitch_deg)`` of the canonical face posed onto ``landmarks`` by SQPnP, or
    ``None`` when there is no usable solution (no camera, OpenCV fails, a solution behind the
    camera or not finite).

    The rotation ``R`` maps the canonical face (camera axes) into the camera. Its forward
    direction, toward the camera, is ``-R[:, 2]``: the yaw is its turn toward the image's right
    and the pitch its turn upward."""
    width, height = image_size
    if width <= 0 or height <= 0:
        return None
    points = np.asarray(landmarks, dtype=np.float64).reshape(-1, 1, 2)
    try:
        found, rvec, tvec = cv2.solvePnP(
            _OBJECT_POINTS, points, _camera_matrix(image_size), None, flags=cv2.SOLVEPNP_SQPNP
        )
    except cv2.error:
        return None
    if not found or rvec is None or tvec is None:
        return None
    translation = np.asarray(tvec, dtype=np.float64).reshape(3)
    if not np.all(np.isfinite(translation)) or translation[2] <= 0:
        return None
    rotation, _ = cv2.Rodrigues(np.asarray(rvec, dtype=np.float64))
    r = np.asarray(rotation, dtype=np.float64)
    yaw = math.degrees(math.atan2(-r[0, 2], r[2, 2]))
    pitch = math.degrees(math.atan2(r[1, 2], math.hypot(r[0, 2], r[2, 2])))
    if not (math.isfinite(yaw) and math.isfinite(pitch)):  # pragma: no cover - atan2 is finite
        return None
    return (yaw, pitch)


def estimate_head_pose(face: Face | None, image_size: tuple[int, int]) -> HeadPose | None:
    """The head pose of ``face`` in an image of ``image_size`` ``(width, height)`` pixels;
    ``None`` without a face, without five finite landmarks, or when the eyes coincide.
    ``yaw_deg`` and ``pitch_deg`` are ``None`` when SQPnP has no usable solution
    (:func:`solve_yaw_pitch`); the yaw ratio and the roll are reported all the same."""
    if face is None or len(face.landmarks) != len(CANONICAL_LANDMARKS_CM):
        return None
    if not all(math.isfinite(value) for point in face.landmarks for value in point):
        return None
    ratio = yaw_ratio(face.landmarks)
    (rx, ry), (lx, ly) = face.landmarks[0], face.landmarks[1]
    roll = math.degrees(math.atan2(ly - ry, lx - rx))
    if ratio is None or not math.isfinite(ratio) or not math.isfinite(roll):
        return None
    angles = solve_yaw_pitch(face.landmarks, image_size)
    return HeadPose(
        yaw_ratio=round(ratio, _RATIO_DECIMALS),
        roll_deg=round(roll, _ANGLE_DECIMALS),
        yaw_deg=None if angles is None else round(angles[0], _ANGLE_DECIMALS),
        pitch_deg=None if angles is None else round(angles[1], _ANGLE_DECIMALS),
        method=YAW_RATIO_METHOD,
    )
