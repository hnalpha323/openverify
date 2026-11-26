"""Chromium fake-camera clips: YUV4MPEG2 (``.y4m``) files with 4:2:0 frames.

Chromium plays such a file in a loop when started with
``--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<file>.y4m``. The
frames frame a face like a VGA selfie and drift by about 1% to look like a hand-held camera.
Pixels are converted with OpenCV's BT.601 limited-range I420 conversion, which is what
Chromium assumes for I420 video.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from pathlib import Path
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from synthetic_id import CropBox, FaceBox, fit_box, framed_crop_box

Frame = NDArray[np.uint8]
"""A BGR frame ``(height, width, 3)``."""

FRAME_SIZE: Final = (640, 480)
SELFIE_FACE_HEIGHT: Final = 0.45
"""Share of the frame height taken by the face box, as in an arm's-length selfie."""

SELFIE_FACE_TOP: Final = 0.25
SWAY: Final = 0.01
"""Peak drift of the crop window, as a share of its width."""

_MAGIC: Final = b"YUV4MPEG2"
_FRAME_MARKER: Final = b"FRAME\n"


def selfie_crop_box(face_box: FaceBox, image_size: tuple[int, int]) -> CropBox:
    """Landscape 4:3 crop of a source photo framing the face like a selfie."""
    width, height = FRAME_SIZE
    return framed_crop_box(
        face_box,
        image_size,
        aspect=width / height,
        face_height=SELFIE_FACE_HEIGHT,
        face_top=SELFIE_FACE_TOP,
    )


def selfie_frames(photo: Frame, face_box: FaceBox, *, count: int) -> list[Frame]:
    """``count`` VGA frames cut from ``photo`` (BGR) with a slow, deterministic drift."""
    if count <= 0:
        raise ValueError("frame count must be positive")
    image_h, image_w = photo.shape[:2]
    left, top, right, bottom = selfie_crop_box(face_box, (image_w, image_h))
    width, height = right - left, bottom - top
    amplitude = SWAY * width
    frames: list[Frame] = []
    for index in range(count):
        angle = 2 * math.pi * index / count
        x, y, x2, y2 = fit_box(
            left + amplitude * math.sin(angle),
            top + amplitude / 2 * math.sin(2 * angle),
            width,
            height,
            image_size=(image_w, image_h),
        )
        crop = photo[y:y2, x:x2]
        frame = cv2.resize(crop, FRAME_SIZE, interpolation=cv2.INTER_AREA)
        frames.append(np.ascontiguousarray(frame, dtype=np.uint8))
    return frames


def _check_frames(frames: Sequence[Frame]) -> tuple[int, int]:
    if not frames:
        raise ValueError("at least one frame is required")
    shapes = {frame.shape for frame in frames}
    if len(shapes) != 1:
        raise ValueError(f"every frame must have the same size, got {sorted(shapes)}")
    shape = shapes.pop()
    if len(shape) != 3 or shape[2] != 3:  # noqa: PLR2004 - (height, width, BGR)
        raise ValueError("frames must be BGR images (height, width, 3)")
    height, width = shape[0], shape[1]
    if height % 2 or width % 2:
        raise ValueError(f"4:2:0 needs even frame dimensions, got {width}x{height}")
    return width, height


def write_y4m(path: Path, frames: Sequence[Frame], *, fps: int) -> None:
    """Write ``frames`` as an uncompressed 4:2:0 YUV4MPEG2 clip at ``fps`` frames per second."""
    width, height = _check_frames(frames)
    with path.open("wb") as out:
        out.write(f"YUV4MPEG2 W{width} H{height} F{fps}:1 Ip A1:1 C420jpeg\n".encode("ascii"))
        for frame in frames:
            out.write(_FRAME_MARKER)
            out.write(cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420).tobytes())


def read_y4m(path: Path) -> tuple[int, list[Frame]]:
    """Read a 4:2:0 YUV4MPEG2 clip back into ``(fps, BGR frames)``."""
    data = path.read_bytes()
    header, _, body = data.partition(b"\n")
    tokens = header.split(b" ")
    if tokens[0] != _MAGIC:
        raise ValueError(f"{path} is not a Y4M file")
    tags = {token[:1]: token[1:].decode("ascii") for token in tokens[1:]}
    if not tags.get(b"C", "420").startswith("420"):
        raise ValueError(f"{path}: only 4:2:0 Y4M is supported, got C{tags[b'C']}")
    width, height = int(tags[b"W"]), int(tags[b"H"])
    numerator, _, denominator = tags[b"F"].partition(":")
    fps = int(numerator) // int(denominator or "1")
    frame_bytes = width * height * 3 // 2
    frames: list[Frame] = []
    offset = 0
    while offset < len(body):
        newline = body.find(b"\n", offset)
        end = len(body) if newline < 0 else newline + 1
        if not body[offset:end].startswith(b"FRAME"):
            raise ValueError(f"{path}: bad Y4M frame marker at byte {offset}")
        planes = body[end : end + frame_bytes]
        if len(planes) != frame_bytes:
            raise ValueError(f"{path}: truncated Y4M frame")
        yuv = np.frombuffer(planes, dtype=np.uint8).reshape(height * 3 // 2, width)
        frames.append(np.ascontiguousarray(cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR_I420)))
        offset = end + frame_bytes
    return fps, frames
