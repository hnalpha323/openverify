"""Barcode decoding with zxing-cpp (Apache-2.0; research §1), C32.1.

Each side is read twice: on the upright upload, and on the rectified document when one was found,
whose barcodes are mapped back to upload pixels. A barcode both passes read (same format and
bytes) is reported once, with its upload quad. ``text`` is zxing-cpp's ``Plain`` text: the
default HRI text renders AAMVA's control characters as ``<LF><RS><CR>``, so the payload would
not parse; ``bytes_b64`` carries the raw bytes. Quads are zxing-cpp's corners in upload pixels:
clockwise from the symbol's own top-left corner.

Payloads are PII (C32.5): returned to the API, never logged. A barcode beyond the contract limits
(``MAX_BARCODE_BASE64_LENGTH``, ``MAX_BARCODE_TEXT_LENGTH``) is left out rather than truncated,
since a cut payload would read as a different one; at most ``MAX_BARCODES`` are reported, PDF417
first.

**PDF417 recovery (Phase 12A V1).** When neither pass decodes a PDF417, :func:`recover_pdf417`
tries harder on the regions a barcode can be in, because a phone frame of a licence's back loses
the symbol to tilt, glare, softness or a denser symbol (``docs/plans/phase-12a.plan.md`` 2.1):

1. **Regions.** Dense-texture regions (Sobel magnitude, box-filtered, Otsu, closed; clipped
   highlights count as texture, so glare does not split a symbol): those of the rectified card
   first, mapped back to the upload through the document's quad (which takes out the card's
   perspective), then those of the upload as rotated rectangles. Regions that map onto one already
   kept are dropped.
2. **Crops.** Each region, grown by :data:`REGION_MARGIN` for the quiet zone, is warped upright
   (Lanczos) to a fixed width, so a symbol of up to about 20 columns has 5 or more pixels a
   module however small it was on the upload.
3. **Gate.** The crop and its unsharp-masked copy are read first, asking zxing-cpp to report
   symbols it found but could not decode. If neither shows a PDF417 at all (a front's text, a
   portrait), the region is left.
4. **Enhancements.** Otherwise: a local contrast stretch (each pixel between the local minimum
   and maximum, which undoes a highlight's veil) binarized by Otsu and by zxing-cpp's global
   histogram, at three widths; an adaptive Gaussian threshold; Otsu on the sharpened crop; and
   rotations of 3 and 6 degrees each way.

The sequence stops at the first pass that decodes exactly one PDF417, whole: zxing-cpp's own
Reed-Solomon correction accepted it (``valid``, no error) with some of the symbol's error
correction left unused (zxing-cpp's ``UEC`` above 0). A decode that used all of it may be a
miscorrection, a different valid-looking payload: on the synthetic glare captures both wrong
decodes seen had ``UEC`` 0, as did 26 right ones. Such a decode is reported only once a second
pass decodes the same bytes. A pass that decodes two different PDF417 payloads is ambiguous and
reports nothing. At most :data:`MAX_RECOVERY_PASSES` passes run
per side. What is lost cannot be recovered: a highlight that clips more codewords than the symbol's
error correction can erase (a 0.19 mm, 17-column symbol under the generator's glare) or a blur
wider than a module stays undecoded, and is never reported as anything else.
"""

from __future__ import annotations

import base64
import itertools
import logging
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Final

import cv2
import numpy as np
import zxingcpp
from numpy.typing import NDArray

from openverify_vision.document import DocumentResult
from openverify_vision.forensics.geometry import fit_within, map_points, rectified_to_upload
from openverify_vision.imaging import ImageArray, ensure_gray
from openverify_vision.quality import GLARE_VALUE_MIN
from openverify_vision.schemas import (
    MAX_BARCODE_BASE64_LENGTH,
    MAX_BARCODE_TEXT_LENGTH,
    MAX_BARCODES,
    Barcode,
    Point,
    Quad,
)

BARCODE_FORMATS: Final = zxingcpp.BarcodeFormats(
    [
        zxingcpp.BarcodeFormat.PDF417,
        zxingcpp.BarcodeFormat.QRCode,
        zxingcpp.BarcodeFormat.DataMatrix,
        zxingcpp.BarcodeFormat.Aztec,
        zxingcpp.BarcodeFormat.Code128,
        zxingcpp.BarcodeFormat.Code39,
    ]
)
"""The symbologies identity documents carry: PDF417 (AAMVA), the 2D codes of some national IDs,
and the 1D codes on the back of some licences."""

PDF417: Final = "PDF417"

PDF417_ONLY: Final = zxingcpp.BarcodeFormats([zxingcpp.BarcodeFormat.PDF417])

MAX_DECODE_SIDE: Final = 2560
"""Longest side, in pixels, of the image zxing-cpp searches; larger uploads are downscaled, which
keeps a licence barcode photographed at 12 megapixels at several pixels per module."""

_QUAD_DECIMALS: Final = 2

MAX_RECOVERY_PASSES: Final = 24
"""The most zxing-cpp reads :func:`recover_pdf417` makes on one side (plan V1: at most 24)."""

REGION_WORK_LONG_SIDE: Final = 1200
"""Texture regions are searched on a copy at most this long."""

REGION_MIN_AREA_RATIO: Final = 0.005
"""A texture region smaller than this share of the searched image is not a barcode."""

REGIONS_PER_IMAGE: Final = 2
"""The largest regions of each searched image (the rectified card, the upload) are tried."""

REGION_MARGIN: Final = 0.06
"""A region is grown by this share of its width on every side: the symbol's quiet zone."""

CROP_WIDTH: Final = 2000
"""The width a region is warped to: a 13-column symbol (290 modules) at about 6 pixels a module."""

STRETCH_WIDTHS: Final = (2800, 2000, 1400)
"""The widths the contrast-stretched crops are read at, the widest first."""

_ROTATIONS: Final = (3.0, -3.0, 6.0, -6.0)
_STRETCH_DIVISOR: Final = 130
"""The stretch's window is the crop's width over this: about 2.5 modules of a 13-column symbol."""
_STRETCH_FLOOR: Final = 16.0
"""A local range under this many grey levels is stretched as if it were this wide: noise in a
flat area is not amplified into bars."""
_ADAPTIVE_DIVISOR: Final = 30
_UNSHARP_SIGMA: Final = 2.0 / CROP_WIDTH
_UNSHARP_AMOUNT: Final = 1.5
_TEXTURE_KERNEL_SHARE: Final = 0.025
_SAME_REGION_SHARE: Final = 0.1
"""Two regions whose corners all lie within this share of the first's width are the same."""

Homography = NDArray[np.float64]
Points = NDArray[np.float64]

logger = logging.getLogger(__name__)


def _utf16_length(text: str) -> int:
    """Length as the API's zod schema counts it (UTF-16 code units)."""
    return len(text.encode("utf-16-le")) // 2


def _corner(point: zxingcpp.Point, fx: float, fy: float) -> Point:
    """A corner found on an image scaled by ``1/fx``, ``1/fy``, in the original's pixels."""
    return (
        round((point.x + 0.5) * fx - 0.5, _QUAD_DECIMALS),
        round((point.y + 0.5) * fy - 0.5, _QUAD_DECIMALS),
    )


def _barcode(result: zxingcpp.Barcode, fx: float, fy: float) -> Barcode | None:
    """The contract's barcode for a zxing-cpp result found on an image scaled by ``1/fx``,
    ``1/fy``; ``None`` beyond the contract limits."""
    encoded = base64.b64encode(bytes(result.bytes)).decode("ascii")
    text: str = result.text
    if len(encoded) > MAX_BARCODE_BASE64_LENGTH or _utf16_length(text) > MAX_BARCODE_TEXT_LENGTH:
        return None
    position = result.position
    quad = (
        _corner(position.top_left, fx, fy),
        _corner(position.top_right, fx, fy),
        _corner(position.bottom_right, fx, fy),
        _corner(position.bottom_left, fx, fy),
    )
    return Barcode(format=str(result.format), bytes_b64=encoded, text=text, quad=quad)


def _reported(barcodes: Iterable[Barcode]) -> list[Barcode]:
    """PDF417 first, then in reading order, at most ``MAX_BARCODES``."""
    return sorted(barcodes, key=lambda found: found.format != PDF417)[:MAX_BARCODES]


def decode_barcodes(img: ImageArray) -> list[Barcode]:
    """Every barcode on ``img`` (grey or BGR), quads in ``img``'s pixels."""
    grey = ensure_gray(img)
    work, _ = fit_within(grey, MAX_DECODE_SIDE)
    fx, fy = grey.shape[1] / work.shape[1], grey.shape[0] / work.shape[0]
    results = zxingcpp.read_barcodes(
        work, formats=BARCODE_FORMATS, text_mode=zxingcpp.TextMode.Plain
    )
    found = [_barcode(result, fx, fy) for result in results]
    kept = [barcode for barcode in found if barcode is not None]
    if len(kept) < len(found):
        logger.warning("left out %d barcode(s) beyond the contract limits", len(found) - len(kept))
    return _reported(kept)


def _in_upload(found: Barcode, quad: list[Point]) -> Barcode:
    top_left, top_right, bottom_right, bottom_left = (
        (round(x, _QUAD_DECIMALS), round(y, _QUAD_DECIMALS)) for x, y in quad
    )
    upload_quad: Quad = (top_left, top_right, bottom_right, bottom_left)
    return Barcode(
        format=found.format, bytes_b64=found.bytes_b64, text=found.text, quad=upload_quad
    )


def decode_side_barcodes(img: ImageArray, document: DocumentResult) -> list[Barcode]:
    """Barcodes of one side: those on the upload, then those only the rectified document shows
    (mapped to upload pixels). Without a rectified document, or a usable mapping back to the
    upload, only the upload is read. When neither read gave a PDF417, :func:`recover_pdf417`
    tries the barcode regions (Phase 12A V1)."""
    found = decode_barcodes(img)
    to_upload = rectified_to_upload(document.detection)
    if document.rectified is not None and to_upload is not None:
        seen = {(barcode.format, barcode.bytes_b64) for barcode in found}
        for barcode in decode_barcodes(document.rectified):
            key = (barcode.format, barcode.bytes_b64)
            quad = map_points(to_upload, barcode.quad)
            if key in seen or quad is None:
                continue
            seen.add(key)
            found.append(_in_upload(barcode, quad))
    if not any(barcode.format == PDF417 for barcode in found):
        recovered = recover_pdf417(img, document)
        if recovered is not None:
            found.append(recovered)
    return _reported(found)


# --- PDF417 recovery (Phase 12A V1) --------------------------------------------------------------


def _read_pdf417(
    image: ImageArray,
    binarizer: zxingcpp.Binarizer = zxingcpp.Binarizer.LocalAverage,
    *,
    return_errors: bool = False,
) -> list[zxingcpp.Barcode]:
    """One zxing-cpp read for PDF417 only (with ``return_errors``, also the symbols it found but
    could not decode)."""
    return list(
        zxingcpp.read_barcodes(
            np.ascontiguousarray(image),
            formats=PDF417_ONLY,
            text_mode=zxingcpp.TextMode.Plain,
            binarizer=binarizer,
            return_errors=return_errors,
        )
    )


def _ordered(quad: Points) -> Points:
    """A rotated rectangle's corners clockwise from the top left of its longer (top) side."""
    centre = quad.mean(axis=0)
    p = quad[np.argsort(np.arctan2(quad[:, 1] - centre[1], quad[:, 0] - centre[0]))]
    if np.linalg.norm(p[2] - p[1]) > np.linalg.norm(p[1] - p[0]):
        p = np.roll(p, -1, axis=0)
    if p[0, 1] + p[1, 1] > p[2, 1] + p[3, 1]:
        p = np.roll(p, 2, axis=0)
    return p


def _texture_regions(grey: ImageArray) -> list[Points]:
    """The largest dense-texture regions of ``grey`` as quads in its pixels (module docstring)."""
    height, width = grey.shape[:2]
    scale = min(1.0, REGION_WORK_LONG_SIDE / max(height, width))
    small = grey
    if scale < 1.0:
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        small = np.asarray(cv2.resize(grey, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)
    gx = cv2.Sobel(small, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(small, cv2.CV_32F, 0, 1, ksize=3)
    k = max(5, round(min(small.shape[:2]) * _TEXTURE_KERNEL_SHARE))
    energy = cv2.blur(cv2.magnitude(gx, gy), (k, k))
    top = float(energy.max())
    if top <= 0:
        return []
    level = np.asarray(np.clip(energy * (255.0 / top), 0, 255), dtype=np.uint8)
    _, mask = cv2.threshold(level, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    glare = np.asarray(small >= GLARE_VALUE_MIN, dtype=np.uint8) * 255
    mask = np.asarray(mask, dtype=np.uint8) | np.asarray(cv2.dilate(glare, kernel), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    minimum = REGION_MIN_AREA_RATIO * small.shape[0] * small.shape[1]
    large = sorted(
        (c for c in contours if cv2.contourArea(c) >= minimum), key=cv2.contourArea, reverse=True
    )
    return [
        _ordered(np.asarray(cv2.boxPoints(cv2.minAreaRect(c)), dtype=np.float64) / scale)
        for c in large[:REGIONS_PER_IMAGE]
    ]


def _regions(grey: ImageArray, document: DocumentResult) -> list[Points]:
    """The regions to try, in upload pixels: the rectified card's (mapped back through the
    document's quad), then the upload's; a region that repeats one already kept is dropped."""
    found: list[Points] = []
    to_upload = rectified_to_upload(document.detection)
    if document.rectified is not None and to_upload is not None:
        for quad in _texture_regions(ensure_gray(document.rectified)):
            mapped = map_points(to_upload, [(float(x), float(y)) for x, y in quad])
            if mapped is not None:
                found.append(np.asarray(mapped, dtype=np.float64))
    for quad in _texture_regions(grey):
        width = float(np.linalg.norm(quad[1] - quad[0]))
        if not any(
            float(np.max(np.linalg.norm(quad - kept, axis=1))) <= _SAME_REGION_SHARE * width
            for kept in found
        ):
            found.append(quad)
    return found


def _crop(
    grey: ImageArray, quad: Points, width: int, angle: float = 0.0
) -> tuple[ImageArray, Homography]:
    """``quad`` (upload pixels, clockwise from its top left) grown by :data:`REGION_MARGIN`,
    warped upright to ``width`` pixels and turned by ``angle`` degrees; and the homography from
    the crop back to the upload."""
    unit = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float32)
    to_quad = cv2.getPerspectiveTransform(unit, quad.astype(np.float32))
    side_w = (np.linalg.norm(quad[1] - quad[0]) + np.linalg.norm(quad[2] - quad[3])) / 2
    side_h = (np.linalg.norm(quad[3] - quad[0]) + np.linalg.norm(quad[2] - quad[1])) / 2
    mx = REGION_MARGIN
    my = REGION_MARGIN * side_w / max(float(side_h), 1.0)
    grown = np.array([[-mx, -my], [1 + mx, -my], [1 + mx, 1 + my], [-mx, 1 + my]], np.float32)
    source = cv2.perspectiveTransform(grown.reshape(-1, 1, 2), to_quad).reshape(-1, 2)
    height = max(1, round(width * (1 + 2 * my) * side_h / ((1 + 2 * mx) * max(side_w, 1.0))))
    target = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32)
    matrix = np.asarray(cv2.getPerspectiveTransform(source, target), dtype=np.float64)
    if angle:
        turn = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
        matrix = np.vstack([turn, [0.0, 0.0, 1.0]]) @ matrix
    crop = cv2.warpPerspective(
        grey,
        matrix,
        (width, height),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return np.asarray(crop, dtype=np.uint8), np.linalg.inv(matrix)


def _unsharp(image: ImageArray) -> ImageArray:
    sigma = _UNSHARP_SIGMA * image.shape[1]
    blurred = cv2.GaussianBlur(image, (0, 0), sigma)
    return np.asarray(
        cv2.addWeighted(image, 1 + _UNSHARP_AMOUNT, blurred, -_UNSHARP_AMOUNT, 0), dtype=np.uint8
    )


def _stretch(image: ImageArray) -> ImageArray:
    """Each pixel placed between its local minimum and maximum (box-smoothed), 0 to 255."""
    k = max(3, round(image.shape[1] / _STRETCH_DIVISOR) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    high = cv2.blur(np.asarray(cv2.dilate(image, kernel), dtype=np.float32), (k, k))
    low = cv2.blur(np.asarray(cv2.erode(image, kernel), dtype=np.float32), (k, k))
    scaled = (image.astype(np.float32) - low) / np.maximum(high - low, _STRETCH_FLOOR)
    return np.asarray(np.clip(scaled * 255.0, 0, 255), dtype=np.uint8)


def _otsu(image: ImageArray) -> ImageArray:
    _, binary = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return np.asarray(binary, dtype=np.uint8)


def _adaptive(image: ImageArray) -> ImageArray:
    block = max(3, round(image.shape[1] / _ADAPTIVE_DIVISOR) | 1)
    return np.asarray(
        cv2.adaptiveThreshold(
            _unsharp(image), 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 2
        ),
        dtype=np.uint8,
    )


@dataclass(frozen=True, slots=True)
class _Pass:
    image: ImageArray
    to_upload: Homography
    binarizer: zxingcpp.Binarizer = zxingcpp.Binarizer.LocalAverage


def _enhanced(grey: ImageArray, quad: Points) -> Iterator[_Pass]:
    """The enhancement passes of one region, after its gate (module docstring, step 4)."""
    histogram = zxingcpp.Binarizer.GlobalHistogram
    for width in STRETCH_WIDTHS:
        crop, back = _crop(grey, quad, width)
        stretched = _stretch(crop)
        yield _Pass(_otsu(stretched), back)
        yield _Pass(stretched, back, histogram)
    crop, back = _crop(grey, quad, CROP_WIDTH)
    yield _Pass(_adaptive(crop), back)
    yield _Pass(_otsu(_unsharp(crop)), back)
    for angle in _ROTATIONS:
        turned, turned_back = _crop(grey, quad, CROP_WIDTH, angle)
        yield _Pass(_unsharp(turned), turned_back)


def _correction_left(result: zxingcpp.Barcode) -> bool:
    """Whether zxing-cpp left some of the symbol's error correction unused (``UEC`` above 0);
    unknown counts as none."""
    extra = result.extra
    unused = extra.get("UEC") if isinstance(extra, dict) else None
    return isinstance(unused, int | float) and unused > 0


def _whole(results: list[zxingcpp.Barcode]) -> zxingcpp.Barcode | None:
    """The one PDF417 a read decoded whole; ``None`` for none, or for two different payloads."""
    whole = [
        result
        for result in results
        if result.valid and not result.error and result.format == zxingcpp.BarcodeFormat.PDF417
    ]
    payloads = {bytes(result.bytes) for result in whole}
    return whole[0] if len(payloads) == 1 else None


def _in_upload_pixels(result: zxingcpp.Barcode, to_upload: Homography) -> Barcode | None:
    found = _barcode(result, 1.0, 1.0)
    if found is None:
        return None
    mapped = map_points(to_upload, list(found.quad))
    return None if mapped is None else _in_upload(found, mapped)


class _Confirmations:
    """Decodes that used all their error correction, kept until a second pass agrees."""

    def __init__(self) -> None:
        self._seen: set[bytes] = set()

    def accepted(self, result: zxingcpp.Barcode) -> bool:
        if _correction_left(result):
            return True
        payload = bytes(result.bytes)
        if payload in self._seen:
            return True
        self._seen.add(payload)
        return False


def recover_pdf417(img: ImageArray, document: DocumentResult) -> Barcode | None:
    """The side's PDF417, decoded whole by the bounded recovery passes (module docstring), with
    its quad in upload pixels; ``None`` when no pass decodes exactly one that can be trusted."""
    grey = ensure_gray(img)
    confirmations = _Confirmations()
    passes = 0
    for quad in _regions(grey, document):
        crop, back = _crop(grey, quad, CROP_WIDTH)
        shown = False
        for gate in (crop, _unsharp(crop)):
            if passes >= MAX_RECOVERY_PASSES:
                return None
            passes += 1
            results = _read_pdf417(gate, return_errors=True)
            decoded = _whole(results)
            if decoded is not None and confirmations.accepted(decoded):
                return _in_upload_pixels(decoded, back)
            shown = shown or any(r.format == zxingcpp.BarcodeFormat.PDF417 for r in results)
        if not shown:
            continue
        for step in itertools.islice(_enhanced(grey, quad), MAX_RECOVERY_PASSES - passes):
            passes += 1
            decoded = _whole(_read_pdf417(step.image, step.binarizer))
            if decoded is not None and confirmations.accepted(decoded):
                return _in_upload_pixels(decoded, step.to_upload)
    return None
