"""C60.4: the ``decode_portrait`` task of the guarded child: a chip portrait (JPEG, JP2 or J2K)
decoded with Pillow, header first, refused above its pixel bound before any pixel is decoded.

The size comes from the file's header (the JPEG frame header, the JP2 ``ihdr`` box or the J2K
``SIZ`` marker), so a portrait above ``max_pixels`` (4 MP for every chip portrait) is refused as
``too_large`` without decoding it. A JPEG's EXIF orientation is applied; 16-bit grey is scaled to
8 bits rather than clipped. The answer is tight RGB rows. Standard library and Pillow only.
"""

from __future__ import annotations

import io
import warnings
from typing import Any, Final

from PIL import Image, ImageOps, UnidentifiedImageError

from openverify_vision.guarded.protocol import TaskRefusal

PORTRAIT_FORMATS: Final = ("JPEG", "JPEG2000")

_SIXTEEN_TO_EIGHT: Final = 1 / 257


def _rgb(image: Image.Image) -> Image.Image:
    """``image`` as 8-bit RGB; integer grey (``I;16``, ``I``) scaled from 16 bits to 8."""
    if image.mode.startswith("I"):
        image = image.convert("I").point(lambda value: value * _SIXTEEN_TO_EIGHT).convert("L")
    return image.convert("RGB")


def decode_portrait(
    data: bytes, *, max_side: int | None, max_pixels: int
) -> tuple[dict[str, Any], list[bytes]]:
    """The portrait as RGB, scaled to fit ``max_side`` when given. Refuses another format as
    ``unsupported_format``, more than ``max_pixels`` as ``too_large`` and undecodable bytes as
    ``corrupt``."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
        try:
            image = Image.open(io.BytesIO(data), formats=PORTRAIT_FORMATS)
        except Image.DecompressionBombError as exc:  # past Pillow's own bound, at open
            raise TaskRefusal("too_large") from exc
        except UnidentifiedImageError as exc:
            raise TaskRefusal("unsupported_format") from exc
        except (OSError, SyntaxError, ValueError) as exc:
            raise TaskRefusal("corrupt") from exc
        with image:
            width, height = image.size
            if width * height > max_pixels:
                raise TaskRefusal("too_large")
            fmt = image.format or ""
            try:
                image.load()
                upright = ImageOps.exif_transpose(image) if fmt == "JPEG" else image
                rgb = _rgb(upright)
            except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
                raise TaskRefusal("corrupt") from exc
    if max_side is not None and max(rgb.size) > max_side:
        rgb.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    header = {
        "ok": True,
        "format": fmt,
        "raster": {"frame": 0, "width": rgb.width, "height": rgb.height},
    }
    return header, [rgb.tobytes()]
