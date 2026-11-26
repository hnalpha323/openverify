"""The C45.2 head-turn clips: re-posed public-domain portraits cycling through the C40.11 poses.

Chromium plays an ``.mjpeg`` file (a plain concatenation of JPEG images, at a fixed 30 frames per
second) as a fake camera, looping it from the first frame whenever a capture starts (research
§10.4). Each clip here follows ``contracts/fixtures/flow/selfie-capture.json`` exactly:

- ``clip``: the frame size, MJPEG at 30 fps, the cycle centre -> left -> centre -> right starting
  at the centre, each extreme held at least ``min-hold-seconds``, the side poses at
  ``target-yaw-deg``, the whole cycle (one loop of the file) within ``max-period-seconds``;
- ``client`` and ``server``: the poses must be read the way the protocol needs. YuNet reads the
  centre within the client's centre trigger (``center-trigger-factor`` x the server's
  ``max-center-yaw-ratio``) and each extreme beyond the side trigger (``side-trigger-factor`` x
  ``min-side-yaw-ratio-change``), both on the client's preview and on the frame the server gets.

The poses are 2.5-D re-posings of the portrait around MediaPipe's canonical face mesh
(:mod:`repose`, research §10.4): hair, ears and the background stay put and the old face hull
can leave a seam. **Pipeline fixtures, not real head turns**: never calibrate on them.

**Framing and the centre (plan amendment 2).** YuNet's five-point yaw ratio depends on how large
the face is in the frame and on the portrait's own slight turn, so the generator (never the
thresholds) adapts: :func:`plan_head_turn` tries the framings of :data:`FRAMINGS` in order, and
for each the centre yaws of :data:`CENTER_YAWS` in order (0 first: the unmodified portrait), and
keeps the first combination whose readings meet both triggers on every measurement path. The
extremes stay at the constants' target yaw from the portrait. If no combination works,
:class:`ClipError` reports every reading, a blocker to report with its measurements.

**Measurement paths** (:class:`ModelKit`): every frame is read as the clip delivers it (decoded
from its JPEG):

- ``client@<preview>``: YuNet on the frame scaled to the client's preview width;
- ``server@<side>``: the frame as the web flow uploads it (:func:`browser_upload`), at each scale
  the vision service searches (``analysis.DETECTION_LONG_SIDES``), so the service's pick between
  overlapping detections cannot change the verdict.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Literal, Protocol

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.analysis import DETECTION_LONG_SIDES
from openverify_vision.faces import (
    FETCH_MODELS_HINT,
    YUNET_FILENAME,
    FaceDetector,
    ModelNotAvailableError,
)
from openverify_vision.pose import yaw_ratio
from repose import CanonicalMesh, default_mesh_path, load_canonical_mesh, render_reposed
from synthetic_id import framed_crop_box

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
CONSTANTS_PATH: Final = REPO_ROOT / "contracts" / "fixtures" / "flow" / "selfie-capture.json"

CLIP_JPEG_QUALITY: Final = 85
"""Each MJPEG frame's JPEG quality (research §10.4 measured q85)."""

UPLOAD_JPEG_QUALITY: Final = 92
"""The web flow's capture quality (``canvas.toBlob(..., 0.92)``)."""

MJPEG_FRAME_RATE: Final = 30
"""Chromium plays MJPEG at a fixed 30 fps (``kMJpegFrameRate``); the file has no rate."""

EXTREME_HOLD_MARGIN_SECONDS: Final = 0.1
"""Each extreme is held this much longer than the constants' minimum."""

CENTER_HOLD_SECONDS: Final = 1.6
TURN_SECONDS: Final = 0.3
"""24 degrees in 0.3 s: a brisk but ordinary head turn."""

FACE_TOP: Final = 0.3
"""The top of the face box sits this far down the requested crop (before the photo limits it)."""

FRAMINGS: Final = (0.30, 0.28, 0.32, 0.26, 0.34, 0.36)
"""The face box's share of the frame height, in the order tried. A selfie at arm's length."""

CENTER_YAWS: Final = (0.0, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0, 4.0, -4.0, 5.0, -5.0)
"""Centre renders tried, in order; 0 is the unmodified portrait (C45.2)."""

STATIC_REPLAY_SECONDS: Final = 4.0
STATIC_REPLAY_ZOOM: Final = 1.02
STATIC_REPLAY_SWAY: Final = 0.01
"""The static replay drifts the centre still by up to 1% of the frame, like ``fake_camera``."""

Frame = NDArray[np.uint8]
Landmarks = NDArray[np.float64]
Readings = Mapping[str, float | None]
Pose = Literal["center", "left", "right"]
POSES: Final[tuple[Pose, ...]] = ("center", "left", "right")
POSE_SIGN: Final[Mapping[Pose, float]] = {"center": 0.0, "left": 1.0, "right": -1.0}
"""C41.1: the user's left turn moves the nose to the image's right, a positive yaw."""


@dataclass(frozen=True, slots=True)
class CaptureConstants:
    """The C40.11 constants the clip follows."""

    width: int
    height: int
    frame_rate: int
    cycle: tuple[Pose, ...]
    starts_at: Pose
    min_hold_seconds: float
    target_yaw_deg: float
    max_period_seconds: float
    max_center_yaw_ratio: float
    min_side_yaw_ratio_change: float
    center_trigger_factor: float
    side_trigger_factor: float
    preview_width_px: int
    sha256: str
    """The SHA-256 of the constants file, so a change of it regenerates the clips."""

    @property
    def size(self) -> tuple[int, int]:
        return (self.width, self.height)

    @property
    def center_trigger(self) -> float:
        """The largest centre ``|yaw_ratio|`` the client captures at (C40.11)."""
        return self.center_trigger_factor * self.max_center_yaw_ratio

    @property
    def side_trigger(self) -> float:
        """The smallest yaw-ratio change from the centre the client captures a side at."""
        return self.side_trigger_factor * self.min_side_yaw_ratio_change


def _pose(value: object) -> Pose:
    if value not in POSES:
        raise ValueError(f"unknown pose {value!r}; the clip knows {', '.join(POSES)}")
    return value


def load_capture_constants(path: Path = CONSTANTS_PATH) -> CaptureConstants:
    """The constants of ``path``; refuses any the generator cannot follow."""
    data = path.read_bytes()
    document: dict[str, Any] = json.loads(data)
    clip, client, server = document["clip"], document["client"], document["server"]
    if clip["format"] != "mjpeg":
        raise ValueError(f"the clip format must be mjpeg, got {clip['format']!r}")
    if clip["frame-rate"] != MJPEG_FRAME_RATE:
        raise ValueError(
            f"Chromium plays MJPEG at {MJPEG_FRAME_RATE} fps, not {clip['frame-rate']}"
        )
    if clip["width"] % 2 or clip["height"] % 2:
        raise ValueError("the frame size must be even (Chromium delivers I420 frames)")
    cycle = tuple(_pose(pose) for pose in clip["cycle"])
    starts_at = _pose(clip["starts-at"])
    if not cycle or cycle[0] != starts_at:
        raise ValueError(f"the cycle {list(cycle)} starts elsewhere than starts-at {starts_at!r}")
    return CaptureConstants(
        width=int(clip["width"]),
        height=int(clip["height"]),
        frame_rate=int(clip["frame-rate"]),
        cycle=cycle,
        starts_at=starts_at,
        min_hold_seconds=float(clip["min-hold-seconds"]),
        target_yaw_deg=float(clip["target-yaw-deg"]),
        max_period_seconds=float(clip["max-period-seconds"]),
        max_center_yaw_ratio=float(server["max-center-yaw-ratio"]),
        min_side_yaw_ratio_change=float(server["min-side-yaw-ratio-change"]),
        center_trigger_factor=float(client["center-trigger-factor"]),
        side_trigger_factor=float(client["side-trigger-factor"]),
        preview_width_px=int(client["preview-width-px"]),
        sha256=hashlib.sha256(data).hexdigest(),
    )


# --- the timeline ---------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Segment:
    """A stretch of the clip: a hold of one pose, or a turn from one pose to the next."""

    kind: Literal["hold", "turn"]
    pose: Pose
    to: Pose
    first_frame: int
    yaws: tuple[float, ...]
    """The rendered yaw of each frame."""

    @property
    def frames(self) -> int:
        return len(self.yaws)


def _frames(seconds: float, frame_rate: int) -> int:
    return math.ceil(seconds * frame_rate - 1e-9)


YAW_DECIMALS: Final = 6
"""Turn yaws are rounded, so a turn and its way back share their renders."""


def _turn(start: float, end: float, frames: int) -> tuple[float, ...]:
    """``frames`` yaws strictly between ``start`` and ``end``, eased in and out."""
    return tuple(
        round(
            start + (end - start) * (1 - math.cos(math.pi * step / (frames + 1))) / 2, YAW_DECIMALS
        )
        for step in range(1, frames + 1)
    )


def clip_timeline(constants: CaptureConstants, yaws: Mapping[Pose, float]) -> list[Segment]:
    """One loop of the clip: each pose of the cycle held, then a turn to the next one (the last
    turn leads back to the first frame). Raises ``ValueError`` if it cannot fit the period."""
    rate = constants.frame_rate
    extreme = _frames(constants.min_hold_seconds + EXTREME_HOLD_MARGIN_SECONDS, rate)
    center = _frames(CENTER_HOLD_SECONDS, rate)
    turn = max(2, round(TURN_SECONDS * rate))
    segments: list[Segment] = []
    first = 0
    for index, pose in enumerate(constants.cycle):
        following = constants.cycle[(index + 1) % len(constants.cycle)]
        hold = (yaws[pose],) * (center if pose == "center" else extreme)
        segments.append(Segment("hold", pose, pose, first, hold))
        first += len(hold)
        moving = _turn(yaws[pose], yaws[following], turn)
        segments.append(Segment("turn", pose, following, first, moving))
        first += len(moving)
    if first > constants.max_period_seconds * rate:
        raise ValueError(
            f"the cycle needs {first / rate:.2f} s, more than the {constants.max_period_seconds} s "
            "period the constants allow"
        )
    return segments


# --- MJPEG ----------------------------------------------------------------------------------------


def encode_jpeg(frame: Frame, quality: int) -> bytes:
    """``frame`` (BGR) as a baseline JPEG."""
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:  # pragma: no cover - OpenCV encodes any 8-bit BGR image
        raise ValueError("the frame cannot be encoded as a JPEG")
    return buffer.tobytes()


def decode_jpeg(data: bytes) -> Frame:
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("the bytes are not a JPEG image")
    return np.asarray(image, dtype=np.uint8)


_SOI: Final = b"\xff\xd8"
_MARKER: Final = 0xFF
_STUFFED: Final = 0x00
_EOI: Final = 0xD9
_SOS: Final = 0xDA
_IN_SCAN: Final = frozenset({_STUFFED, *range(0xD0, 0xD8)})
"""After 0xFF inside entropy-coded data: a stuffed zero or a restart marker, not a segment."""


def _scan_end(data: bytes, position: int) -> int:
    """The offset of the first real marker after the entropy-coded data starting at ``position``."""
    while position + 1 < len(data):
        if data[position] == _MARKER and data[position + 1] not in _IN_SCAN:
            return position
        position += 1
    raise ValueError("MJPEG: a scan runs to the end of the file")


def _jpeg_end(data: bytes, start: int) -> int:
    """The offset just past the JPEG starting at ``start`` (its EOI), walking its segments."""
    position = start + len(_SOI)
    while position + 1 < len(data):
        if data[position] != _MARKER:
            raise ValueError(f"MJPEG: no JPEG marker at byte {position}")
        marker = data[position + 1]
        if marker == _EOI:
            return position + 2
        if position + 4 > len(data):
            break
        length = int.from_bytes(data[position + 2 : position + 4], "big")
        position += 2 + length
        if marker == _SOS:
            position = _scan_end(data, position)
    raise ValueError(f"MJPEG: the JPEG starting at byte {start} has no end")


def split_mjpeg(data: bytes) -> list[bytes]:
    """The JPEG images of an MJPEG file, in order. Raises ``ValueError`` on anything else."""
    frames: list[bytes] = []
    position = 0
    while position < len(data):
        if data[position : position + len(_SOI)] != _SOI:
            raise ValueError(f"MJPEG: no JPEG starts at byte {position}")
        end = _jpeg_end(data, position)
        frames.append(data[position:end])
        position = end
    if not frames:
        raise ValueError("MJPEG: the file holds no frame")
    return frames


def write_mjpeg(path: Path, jpegs: Sequence[bytes]) -> None:
    """Write ``jpegs`` back to back: Chromium's MJPEG fake camera reads no container."""
    path.write_bytes(b"".join(jpegs))


def read_mjpeg(path: Path) -> list[Frame]:
    return [decode_jpeg(jpeg) for jpeg in split_mjpeg(path.read_bytes())]


def browser_upload(frame: Frame) -> Frame:
    """``frame`` as the server receives it from the web flow: Chromium's I420 video frame, drawn
    on a canvas and encoded as a JPEG at the flow's quality."""
    i420 = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420)
    drawn = np.asarray(cv2.cvtColor(i420, cv2.COLOR_YUV2BGR_I420), dtype=np.uint8)
    return decode_jpeg(encode_jpeg(drawn, UPLOAD_JPEG_QUALITY))


# --- the models -----------------------------------------------------------------------------------


class SelfieKit(Protocol):
    """What the generator needs from the models: landmarks, the re-pose and YuNet's readings."""

    def landmarks(self, frame: Frame) -> Landmarks | None: ...

    def render(self, frame: Frame, landmarks: Landmarks, yaw_deg: float) -> Frame: ...

    def readings(self, frame: Frame) -> dict[str, float | None]: ...


def _scaled(frame: Frame, long_side: int) -> Frame:
    height, width = frame.shape[:2]
    scale = min(1.0, long_side / max(height, width))
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    if size == (width, height):
        return frame
    return np.asarray(cv2.resize(frame, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


class ModelKit:
    """The real kit: YuNet's landmarks and readings, and the canonical-mesh re-pose."""

    def __init__(self, detector: FaceDetector, mesh: CanonicalMesh, *, preview_width: int) -> None:
        self._detector = detector
        self._mesh = mesh
        self._preview_width = preview_width

    @classmethod
    def from_models(cls, models_dir: Path, *, preview_width: int) -> ModelKit:
        """The kit over YuNet and the canonical mesh in ``models_dir``, loaded now."""
        mesh_path = default_mesh_path(models_dir)
        if not mesh_path.is_file():
            raise ModelNotAvailableError(
                f"the canonical face mesh is not at {mesh_path}; {FETCH_MODELS_HINT}"
            )
        detector = FaceDetector(models_dir / YUNET_FILENAME)
        detector.load()
        return cls(detector, load_canonical_mesh(mesh_path), preview_width=preview_width)

    def _ratio(self, frame: Frame) -> float | None:
        faces = self._detector.detect(frame)
        return None if not faces else yaw_ratio(max(faces, key=lambda f: f.area).landmarks)

    def landmarks(self, frame: Frame) -> Landmarks | None:
        faces = self._detector.detect(frame)
        if not faces:
            return None
        return np.asarray(max(faces, key=lambda f: f.area).landmarks, dtype=np.float64)

    def render(self, frame: Frame, landmarks: Landmarks, yaw_deg: float) -> Frame:
        return render_reposed(frame, landmarks, yaw_deg, self._mesh)

    def readings(self, frame: Frame) -> dict[str, float | None]:
        """The yaw ratio on each measurement path (see the module docstring)."""
        delivered = decode_jpeg(encode_jpeg(frame, CLIP_JPEG_QUALITY))
        height, width = delivered.shape[:2]
        preview_height = round(height * self._preview_width / width)
        preview = cv2.resize(
            delivered, (self._preview_width, preview_height), interpolation=cv2.INTER_AREA
        )
        found: dict[str, float | None] = {
            f"client@{self._preview_width}": self._ratio(np.asarray(preview, dtype=np.uint8))
        }
        upload = browser_upload(delivered)
        for side in DETECTION_LONG_SIDES:
            found[f"server@{side}"] = self._ratio(_scaled(upload, side))
        return found


# --- choosing the framing and the centre ----------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Framing:
    face_height: float
    """The face box's share of the frame height (before the photo's own size limits the crop)."""
    face_top: float


def base_frame(
    photo: Frame, face_box: tuple[int, int, int, int], framing: Framing, size: tuple[int, int]
) -> Frame:
    """The portrait cropped around ``face_box`` to ``size``'s aspect and scaled to ``size``.

    A crop larger than the photo is shrunk to fit (``synthetic_id.fit_box``): never padded."""
    width, height = size
    left, top, right, bottom = framed_crop_box(
        face_box,
        (photo.shape[1], photo.shape[0]),
        aspect=width / height,
        face_height=framing.face_height,
        face_top=framing.face_top,
    )
    crop = photo[top:bottom, left:right]
    return np.asarray(cv2.resize(crop, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


class ClipError(Exception):
    """No framing and centre yaw make YuNet read the poses the C40.11 triggers need."""


@dataclass(frozen=True, slots=True)
class HeadTurnPlan:
    """What the clip is rendered from: the chosen framing, the centre yaw, and the poses."""

    framing: Framing
    center_yaw: float
    target_yaw: float
    base: Frame
    """The unmodified portrait, framed."""
    landmarks: Landmarks
    """YuNet's five points on :attr:`base`, which the re-pose fits. Never written anywhere."""
    poses: Mapping[Pose, Frame]
    readings: Mapping[Pose, Readings]

    def pose_yaw(self, pose: Pose) -> float:
        """The yaw rendered for ``pose``, in degrees from the portrait."""
        return self.center_yaw if pose == "center" else POSE_SIGN[pose] * self.target_yaw


def _misses(readings: Mapping[Pose, Readings], constants: CaptureConstants) -> list[str]:
    """Why ``readings`` miss a trigger, one entry per miss; empty when they meet both."""
    misses: list[str] = []
    for path, center in readings["center"].items():
        if center is None or abs(center) > constants.center_trigger:
            shown = "no face" if center is None else f"{center:+.3f}"
            misses.append(
                f"{path} centre {shown} beyond the centre trigger {constants.center_trigger:.3f}"
            )
            continue
        for pose in ("left", "right"):
            side = readings[pose].get(path)
            change = None if side is None else POSE_SIGN[pose] * (side - center)
            if change is None or change < constants.side_trigger:
                shown = "no face" if change is None else f"{change:.3f}"
                misses.append(
                    f"{path} {pose} change {shown} below the side trigger "
                    f"{constants.side_trigger:.3f}"
                )
    return misses


def plan_head_turn(
    photo: Frame,
    face_box: tuple[int, int, int, int],
    kit: SelfieKit,
    constants: CaptureConstants,
) -> HeadTurnPlan:
    """The first framing and centre yaw whose readings meet both triggers (module docstring)."""
    target = constants.target_yaw_deg
    attempts: list[str] = []
    for face_height in FRAMINGS:
        framing = Framing(face_height=face_height, face_top=FACE_TOP)
        base = base_frame(photo, face_box, framing, constants.size)
        landmarks = kit.landmarks(base)
        if landmarks is None:
            attempts.append(f"face height {face_height}: no face")
            continue
        sides: dict[Pose, Frame] = {
            "left": kit.render(base, landmarks, target),
            "right": kit.render(base, landmarks, -target),
        }
        left, right = kit.readings(sides["left"]), kit.readings(sides["right"])
        closest: list[str] = []
        for center_yaw in CENTER_YAWS:
            center = base if center_yaw == 0 else kit.render(base, landmarks, center_yaw)
            readings: dict[Pose, Readings] = {
                "center": kit.readings(center),
                "left": left,
                "right": right,
            }
            missed = _misses(readings, constants)
            if not missed:
                return HeadTurnPlan(
                    framing=framing,
                    center_yaw=center_yaw,
                    target_yaw=target,
                    base=base,
                    landmarks=landmarks,
                    poses={"center": center, **sides},
                    readings=readings,
                )
            if not closest or len(missed) < len(closest):
                closest = [f"centre yaw {center_yaw:+.0f}: {miss}" for miss in missed]
        attempts.append(f"face height {face_height}: " + "; ".join(closest))
    raise ClipError(
        f"no framing and centre yaw within {CENTER_YAWS[-1]:.0f} degrees make YuNet read the "
        f"poses at +-{target} degrees beyond the side trigger and the centre within the centre "
        "trigger (a blocker to report with these readings; the thresholds never move): "
        + " | ".join(attempts)
    )


# --- the clip -------------------------------------------------------------------------------------


def clip_jpegs(
    plan: HeadTurnPlan, kit: SelfieKit, constants: CaptureConstants
) -> tuple[list[bytes], list[Segment]]:
    """Every frame of one loop as a JPEG, and the timeline. Each yaw is rendered once; a hold
    repeats one JPEG."""
    segments = clip_timeline(constants, {pose: plan.pose_yaw(pose) for pose in POSES})
    encoded: dict[float, bytes] = {
        plan.pose_yaw(pose): encode_jpeg(np.asarray(plan.poses[pose]), CLIP_JPEG_QUALITY)
        for pose in POSES
    }
    jpegs: list[bytes] = []
    for segment in segments:
        for yaw in segment.yaws:
            if yaw not in encoded:
                rendered = kit.render(plan.base, plan.landmarks, yaw)
                encoded[yaw] = encode_jpeg(rendered, CLIP_JPEG_QUALITY)
            jpegs.append(encoded[yaw])
    return jpegs, segments


def static_replay_jpegs(frame: Frame, constants: CaptureConstants) -> list[bytes]:
    """A still that only drifts (a slight zoom, then up to 1% of sway), the static replay that
    never turns: :data:`STATIC_REPLAY_SECONDS` of frames, looping smoothly."""
    count = round(STATIC_REPLAY_SECONDS * constants.frame_rate)
    height, width = frame.shape[:2]
    amplitude = STATIC_REPLAY_SWAY * width
    zoom = STATIC_REPLAY_ZOOM
    jpegs: list[bytes] = []
    for index in range(count):
        angle = 2 * math.pi * index / count
        matrix = np.array(
            [
                [zoom, 0.0, (1 - zoom) * width / 2 + amplitude * math.sin(angle)],
                [0.0, zoom, (1 - zoom) * height / 2 + amplitude / 2 * math.sin(2 * angle)],
            ]
        )
        moved = cv2.warpAffine(
            frame,
            matrix,
            (width, height),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )
        jpegs.append(encode_jpeg(np.asarray(moved, dtype=np.uint8), CLIP_JPEG_QUALITY))
    return jpegs
