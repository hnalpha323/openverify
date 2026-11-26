"""Stroke-width statistics of a text line crop (handwriting cue, C32.1).

A crop lower than :data:`MEASURE_HEIGHT` is first enlarged to that height (bicubic): a card's
strokes are two or three pixels wide, which the whole-pixel distance transform would read as 1,
3 or 5 and so make even print look uneven. The copy is binarised with Otsu's threshold; the ink
is whichever class does not hold most of the border, so dark-on-light and light-on-dark lines
read alike. On the medial axis of a stroke (the local maxima of the ink's Euclidean distance
transform), the distance ``d`` to the nearest background pixel is half the stroke, so the stroke
is ``2 * d - 1`` pixels wide, divided back by the enlargement. Printed text keeps one width;
handwriting varies it, which the coefficient of variation measures. The widths are raw
measurements: what counts as handwriting is decided in TypeScript.
"""

from __future__ import annotations

from typing import Final

import cv2
import numpy as np

from openverify_vision.imaging import ImageArray, ensure_gray

MIN_CROP_SIDE: Final = 8
"""Crops with a side shorter than this many pixels are too small to measure."""

MEASURE_HEIGHT: Final = 96
"""Crops lower than this are measured on a copy enlarged to this height."""

MIN_AXIS_PIXELS: Final = 120
"""Fewer medial-axis pixels (on the copy at :data:`MEASURE_HEIGHT`) than this are too few for
statistics: one glyph, or a licence's tiny field numbers ("3", "4a"), whose strokes a phone frame
does not resolve. Phase 12A V4 raised it from 10: such lines read as uneven as handwriting (a
stroke excess of 0.2-0.33 on clean print, ``docs/tdd/phase12a-vision-12a.tdd.md``), and they are
also the lines an OCR reads with the least confidence. On the synthetic captures the field numbers
give 6 to 118 axis pixels, a single 34-pixel glyph about 100, and every line of three characters
or more, the handwritten Utopia field included (153), more."""

_NEIGHBOURHOOD: Final = np.ones((3, 3), dtype=np.uint8)


def stroke_width_stats(crop: ImageArray) -> tuple[float, float] | None:
    """``(mean, coefficient of variation)`` of the stroke width in pixels of ``crop``, or
    ``None`` when the crop is too small or holds no strokes to measure."""
    gray = ensure_gray(crop)
    height, width = gray.shape
    if min(height, width) < MIN_CROP_SIDE or int(gray.min()) == int(gray.max()):
        return None
    scale = max(1.0, MEASURE_HEIGHT / height)
    if scale > 1.0:
        gray = np.asarray(
            cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC),
            dtype=np.uint8,
        )
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    border = np.concatenate([binary[0], binary[-1], binary[:, 0], binary[:, -1]])
    light_background = 2 * np.count_nonzero(border) >= border.size
    ink = (binary == 0) if light_background else (binary > 0)

    distance = cv2.distanceTransform(ink.astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    axis = (distance > 0) & (distance >= cv2.dilate(distance, _NEIGHBOURHOOD))
    widths = (2.0 * distance[axis] - 1.0) / scale
    if widths.size < MIN_AXIS_PIXELS:
        return None
    mean = float(widths.mean())
    return round(mean, 3), round(float(widths.std()) / mean, 4)
