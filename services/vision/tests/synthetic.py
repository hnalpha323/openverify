"""Synthetic test-image generators. Every test image comes from here; no real photos are used."""

from __future__ import annotations

import io

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image as PILImage

Image = NDArray[np.uint8]


def make_checkerboard(size: int = 256, square: int = 16, low: int = 0, high: int = 255) -> Image:
    """Return a sharp BGR checkerboard alternating between ``low`` and ``high`` intensities."""
    cells = size // square
    pattern = (np.indices((cells, cells)).sum(axis=0) % 2).astype(bool)
    mask = np.kron(pattern, np.ones((square, square), dtype=bool))
    board = np.where(mask, np.uint8(high), np.uint8(low)).astype(np.uint8)
    return np.ascontiguousarray(np.stack([board] * 3, axis=-1))


def make_uniform(value: int | tuple[int, int, int], height: int = 120, width: int = 160) -> Image:
    """Return a solid BGR image filled with ``value``."""
    image = np.zeros((height, width, 3), dtype=np.uint8)
    image[:] = value
    return image


def make_noise(height: int = 64, width: int = 64, seed: int = 0) -> Image:
    """Return seeded uniform BGR noise: deterministic and incompressible."""
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(height, width, 3), dtype=np.uint8)


def gaussian_blur(image: Image, sigma: float = 6.0) -> Image:
    blurred: Image = cv2.GaussianBlur(image, (0, 0), sigmaX=sigma)
    return blurred


def encode(image_bgr: Image, fmt: str, **save_kwargs: object) -> bytes:
    """Encode a BGR array with Pillow (``fmt`` is a Pillow format name such as ``PNG``)."""
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    buffer = io.BytesIO()
    PILImage.fromarray(rgb).save(buffer, format=fmt, **save_kwargs)  # type: ignore[arg-type]
    return buffer.getvalue()
