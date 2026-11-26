"""Safe decoding of untrusted image uploads into OpenCV-style BGR arrays."""

from __future__ import annotations

import io
import warnings
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageOps, UnidentifiedImageError

ImageArray = NDArray[np.uint8]
"""An 8-bit image: grayscale ``(H, W)`` or OpenCV BGR ``(H, W, 3)``."""

ALLOWED_FORMATS: Final = ("JPEG", "PNG", "WEBP")
"""Pillow format names accepted for uploads. Anything else is rejected before decoding."""


class ImageDecodeError(ValueError):
    """Base class for uploads that cannot be turned into an image."""


class UnsupportedImageError(ImageDecodeError):
    """The bytes are not an image in one of :data:`ALLOWED_FORMATS`."""


class CorruptImageError(ImageDecodeError):
    """The bytes look like an allowed format but cannot be decoded."""


class ImageTooLargeError(ImageDecodeError):
    """The decoded image would exceed the configured pixel limit."""


SIXTEEN_BIT_TO_EIGHT: Final = 257.0
"""``65535 / 255``: maps a 16-bit level onto the 8-bit range."""


def _to_rgb(image: Image.Image) -> ImageArray:
    """Return ``image`` as an ``(H, W, 3)`` uint8 RGB array.

    Integer greyscale modes (``I;16`` from a 16-bit grey PNG, or ``I``) are scaled from 16 bits
    to 8. Pillow's ``convert("RGB")`` clips them at 255 instead, which turns the image white.
    """
    if image.mode.startswith("I"):
        levels = np.asarray(image).astype(np.float32) / SIXTEEN_BIT_TO_EIGHT
        gray = np.clip(np.rint(levels), 0, 255).astype(np.uint8)
        return np.asarray(cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB), dtype=np.uint8)
    return np.asarray(image.convert("RGB"), dtype=np.uint8)


def decode_image(data: bytes, *, max_pixels: int) -> ImageArray:
    """Decode ``data`` into a contiguous ``(H, W, 3)`` uint8 BGR array.

    The format is sniffed from the content (the client's declared type is ignored), the
    dimensions are checked against ``max_pixels`` *before* pixel data is decoded, EXIF
    orientation is applied so the array is upright, and 16-bit grey is scaled to 8 bits.
    """
    try:
        with warnings.catch_warnings():
            # Our own max_pixels check is authoritative; Pillow's hard DecompressionBombError
            # (above twice its MAX_IMAGE_PIXELS) remains as a backstop.
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data), formats=ALLOWED_FORMATS) as image:
                width, height = image.size
                if width * height > max_pixels:
                    raise ImageTooLargeError(
                        f"image is {width}x{height} = {width * height} pixels; "
                        f"the limit is {max_pixels}"
                    )
                rgb = _to_rgb(ImageOps.exif_transpose(image))
    except ImageDecodeError:
        raise
    except Image.DecompressionBombError as exc:
        raise ImageTooLargeError("image dimensions exceed the decompression-bomb limit") from exc
    except UnidentifiedImageError as exc:  # subclass of OSError, so it must come first
        allowed = ", ".join(ALLOWED_FORMATS)
        raise UnsupportedImageError(f"not a supported image; allowed formats: {allowed}") from exc
    except Exception as exc:  # any decoder failure on untrusted bytes counts as "corrupt"
        raise CorruptImageError("image data could not be decoded") from exc
    return np.ascontiguousarray(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), dtype=np.uint8)


def validate_image(img: ImageArray) -> ImageArray:
    """Return ``img`` unchanged if it is a non-empty uint8 grayscale or BGR array.

    Raises ``ValueError`` otherwise.
    """
    if not isinstance(img, np.ndarray) or img.dtype != np.uint8:
        raise ValueError("image must be a uint8 numpy array")
    if img.ndim == 2 or (img.ndim == 3 and img.shape[2] == 3):  # noqa: PLR2004
        if img.size == 0:
            raise ValueError("image must not be empty")
        return img
    raise ValueError("image must be grayscale (H, W) or BGR (H, W, 3)")


def ensure_gray(img: ImageArray) -> ImageArray:
    """Validate ``img`` and return it as a single-channel array."""
    img = validate_image(img)
    if img.ndim == 2:  # noqa: PLR2004
        return img
    return np.asarray(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), dtype=np.uint8)


def ensure_bgr(img: ImageArray) -> ImageArray:
    """Validate ``img`` and return it as a three-channel BGR array."""
    img = validate_image(img)
    if img.ndim == 3:  # noqa: PLR2004
        return img
    return np.asarray(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR), dtype=np.uint8)
