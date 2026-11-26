"""Image forensics of one side of an ID (C32.1): raw measurements, never a decision.

Every measurement comes from Pillow, OpenCV and NumPy (research §5); no pretrained forgery or
recapture model is used. Each module states its method, its range and what it does not see:

- the original bytes (:mod:`.upload`, :mod:`.exif`, :mod:`.jpeg`): EXIF software, make, model and
  GPS presence (never GPS values), the JPEG quality and table standardness, and double
  compression on the encoder's block grid;
- the upload: error levels of the portrait against the rest of the document (:mod:`.ela`), and
  the screen's pixel grid in the document's region (:mod:`.spectral`);
- the document (the rectified copy when one was found, else the upload): moire
  (:mod:`.spectral`), saturation, colourfulness and a regional colour cast (:mod:`.chroma`),
  copy-move (:mod:`.copy_move`), noise across the portrait's frame (:mod:`.portrait`) and the
  REAL ID star (:mod:`.star`, its box in the document's pixels).

The whole is ``None`` (not measured) only when the bytes cannot be read; a zero score would read
as "no sign of tampering", which nothing has established then. Every stage works on a bounded copy
or window, so an upload's size bounds none of the costs beyond decoding. Thresholds and decisions
are TypeScript's (C32.2).
"""

from __future__ import annotations

from typing import Final

import cv2
import numpy as np

from openverify_vision.document import DocumentResult
from openverify_vision.forensics.chroma import chroma_stats, color_cast_score
from openverify_vision.forensics.copy_move import copy_move_score
from openverify_vision.forensics.ela import ela_score
from openverify_vision.forensics.geometry import (
    document_mask,
    map_box,
    mask_bounds,
    upload_to_rectified,
)
from openverify_vision.forensics.jpeg import jpeg_forensics
from openverify_vision.forensics.portrait import portrait_boundary_score
from openverify_vision.forensics.spectral import GRID_MAX_SIDE, moire_score, screen_grid_score
from openverify_vision.forensics.star import find_star_glyph
from openverify_vision.forensics.upload import read_upload, upright_grid_offset
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.schemas import BoundingBox, Forensics

__all__ = ["analyze_forensics"]

_GRID_HALF: Final = GRID_MAX_SIDE // 2


def _grey(bgr: ImageArray) -> ImageArray:
    return np.asarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), dtype=np.uint8)


def _grid_window(bgr: ImageArray, bounds: tuple[int, int, int, int]) -> ImageArray:
    """The centred ``GRID_MAX_SIDE`` square of the document's region of the upload, in grey."""
    left, top, right, bottom = bounds
    centre_x, centre_y = (left + right) // 2, (top + bottom) // 2
    x0, y0 = max(left, centre_x - _GRID_HALF), max(top, centre_y - _GRID_HALF)
    x1, y1 = min(right, x0 + GRID_MAX_SIDE), min(bottom, y0 + GRID_MAX_SIDE)
    return _grey(np.ascontiguousarray(bgr[y0:y1, x0:x1]))


def _portrait_in_document(
    document: DocumentResult, portrait_box: BoundingBox | None, size: tuple[int, int]
) -> BoundingBox | None:
    """The portrait box in the measured document's pixels (``size`` is its width, height)."""
    if portrait_box is None:
        return None
    if document.rectified is None:
        return portrait_box
    to_document = upload_to_rectified(document.detection)
    return None if to_document is None else map_box(to_document, portrait_box, bounds=size)


def analyze_forensics(
    data: bytes,
    img: ImageArray,
    document: DocumentResult,
    *,
    portrait_box: BoundingBox | None,
) -> Forensics | None:
    """Raw forensic scores of one side.

    ``data`` is the upload as received (EXIF and JPEG tables), ``img`` its upright decode,
    ``document`` the detection with the rectified image, and ``portrait_box`` the front
    portrait in upload pixels (``None`` on the back). ``None`` when ``data`` is not a readable
    image.
    """
    source = read_upload(data)
    if source is None:
        return None
    upload = ensure_bgr(img)
    page = upload if document.rectified is None else ensure_bgr(document.rectified)
    page_grey = _grey(page)
    region = document_mask(document.detection, (upload.shape[0], upload.shape[1]))
    portrait = _portrait_in_document(document, portrait_box, (page.shape[1], page.shape[0]))
    return Forensics(
        exif=source.exif,
        jpeg=jpeg_forensics(source, upload),
        ela_score=ela_score(
            upload,
            region=region,
            portrait_box=portrait_box,
            offset=upright_grid_offset(source, upload.shape),
        ),
        moire_score=moire_score(page_grey),
        screen_grid_score=screen_grid_score(_grid_window(upload, mask_bounds(region))),
        chroma=chroma_stats(page),
        color_cast_score=color_cast_score(page),
        copy_move_score=copy_move_score(page_grey),
        portrait_boundary_score=(
            None if portrait is None else portrait_boundary_score(page_grey, portrait)
        ),
        star_glyph=find_star_glyph(page),
    )
