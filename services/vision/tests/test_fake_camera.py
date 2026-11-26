"""Chromium fake-camera files: Y4M (YUV4MPEG2, 4:2:0) clips framed like a selfie.

Chromium's ``--use-file-for-fake-video-capture`` plays a ``.y4m`` file in a loop. The frames
here come from a synthetic gradient, not a face.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from fake_camera import (
    FRAME_SIZE,
    read_y4m,
    selfie_crop_box,
    selfie_frames,
    write_y4m,
)

FACE_BOX = (500, 300, 200, 260)


def fake_photo(width: int = 1200, height: int = 1500) -> np.ndarray:
    yy, xx = np.mgrid[0:height, 0:width]
    image = np.stack([40 + xx * 150 // width, 70 + yy * 120 // height, 150 + 0 * xx], axis=-1)
    image = image.astype(np.uint8)
    cv2.rectangle(image, (500, 300), (700, 560), (60, 90, 140), thickness=-1)
    for k in range(0, width, 37):  # some texture, so frames are not flat
        cv2.line(image, (k, 0), (k, height - 1), (20, 20, 20), 1)
    return np.ascontiguousarray(image)


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    return 10 * np.log10(255.0**2 / mse)


def test_frame_size_is_vga() -> None:
    assert FRAME_SIZE == (640, 480)


def test_selfie_crop_is_landscape_and_frames_the_face() -> None:
    left, top, right, bottom = selfie_crop_box(FACE_BOX, (1200, 1500))

    assert (right - left) / (bottom - top) == pytest.approx(4 / 3, abs=0.01)
    assert FACE_BOX[3] / (bottom - top) == pytest.approx(0.45, abs=0.01)
    assert (left + right) / 2 == pytest.approx(600, abs=1)
    assert 0 <= left < right <= 1200
    assert 0 <= top < bottom <= 1500


def test_frames_are_deterministic_vga_and_gently_moving() -> None:
    first = selfie_frames(fake_photo(), FACE_BOX, count=8)
    second = selfie_frames(fake_photo(), FACE_BOX, count=8)

    assert len(first) == 8
    assert all(frame.shape == (480, 640, 3) and frame.dtype == np.uint8 for frame in first)
    assert all(np.array_equal(a, b) for a, b in zip(first, second, strict=True))
    assert not np.array_equal(first[0], first[2])  # the camera "breathes" a little
    assert psnr(first[0], first[2]) > 15  # but the scene stays the same


def test_frame_count_must_be_positive() -> None:
    with pytest.raises(ValueError, match="count"):
        selfie_frames(fake_photo(), FACE_BOX, count=0)


def test_y4m_header_and_size(tmp_path: Path) -> None:
    frames = selfie_frames(fake_photo(), FACE_BOX, count=3)
    path = tmp_path / "clip.y4m"

    write_y4m(path, frames, fps=15)

    data = path.read_bytes()
    header = b"YUV4MPEG2 W640 H480 F15:1 Ip A1:1 C420jpeg\n"
    assert data.startswith(header)
    frame_bytes = 640 * 480 * 3 // 2
    assert len(data) == len(header) + 3 * (len(b"FRAME\n") + frame_bytes)
    assert data[len(header) : len(header) + 6] == b"FRAME\n"


def test_y4m_round_trips(tmp_path: Path) -> None:
    frames = selfie_frames(fake_photo(), FACE_BOX, count=2)
    path = tmp_path / "clip.y4m"
    write_y4m(path, frames, fps=30)

    fps, decoded = read_y4m(path)

    assert fps == 30
    assert len(decoded) == 2
    assert decoded[0].shape == (480, 640, 3)
    assert psnr(decoded[0], frames[0]) > 30  # 4:2:0 subsampling and BT.601 limited range


@pytest.mark.parametrize(
    "frames",
    [
        [],
        [np.zeros((481, 640, 3), dtype=np.uint8)],
        [np.zeros((480, 640, 3), dtype=np.uint8), np.zeros((240, 320, 3), dtype=np.uint8)],
        [np.zeros((480, 640), dtype=np.uint8)],
    ],
    ids=["empty", "odd-height", "mixed-sizes", "grayscale"],
)
def test_write_y4m_rejects_bad_frames(tmp_path: Path, frames: list[np.ndarray]) -> None:
    with pytest.raises(ValueError, match="frame"):
        write_y4m(tmp_path / "bad.y4m", frames, fps=15)


@pytest.mark.parametrize(
    "content",
    [
        b"not a y4m file\n",
        b"YUV4MPEG2 W4 H4 F15:1 Ip A1:1 C444\nFRAME\n" + b"\0" * 48,
        b"YUV4MPEG2 W4 H4 F15:1 Ip A1:1 C420jpeg\nFRAME\n" + b"\0" * 5,
        b"YUV4MPEG2 W4 H4 F15:1 Ip A1:1 C420jpeg\nBOGUS\n" + b"\0" * 24,
    ],
    ids=["no-magic", "not-420", "truncated", "bad-frame-marker"],
)
def test_read_y4m_rejects_invalid_files(tmp_path: Path, content: bytes) -> None:
    path = tmp_path / "bad.y4m"
    path.write_bytes(content)

    with pytest.raises(ValueError, match="Y4M"):
        read_y4m(path)
