"""Fake text models for the OCR tests: no weights needed.

The fake detector marks text where the test says; the fake recognizer spells, for each line,
the text registered for the grey level of the line's background. :func:`page` draws such a
page and :func:`engine` builds an :class:`OcrEngine` that reads it.
"""

from __future__ import annotations

import time
from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

from openverify_vision.faces import ModelNotAvailableError
from openverify_vision.ocr import OcrEngine

CHARACTERS = (*"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<abcdefghijklmnopqrstuvwxyz.,-", "🚨", "中")
CLASSES = len(CHARACTERS) + 2  # the blank, the dictionary, a space

Region = tuple[int, int, int, int]
"""``(x, y, width, height)`` of a text line in image pixels."""


class FakeDetector:
    """A DB probability map that is 0.95 on each region (scaled to the detector input)."""

    def __init__(self, regions: Sequence[Region], image_size: tuple[int, int]) -> None:
        self.regions = list(regions)
        self.width, self.height = image_size
        self.loads = 0
        self.missing = False

    def load(self) -> None:
        if self.missing:
            raise ModelNotAvailableError("text detector model not found")
        self.loads += 1

    def run(self, batch: NDArray[np.float32]) -> NDArray[np.float32]:
        _, _, height, width = batch.shape
        fx, fy = width / self.width, height / self.height
        prob = np.zeros((1, 1, height, width), dtype=np.float32)
        for x, y, w, h in self.regions:
            prob[0, 0, round(y * fy) : round((y + h) * fy), round(x * fx) : round((x + w) * fx)] = (
                0.95
            )
        return prob


class FakeRecognizer:
    """Spells the text registered for the grey level at the left edge of each line."""

    def __init__(self, texts: dict[int, tuple[str, float]]) -> None:
        self.texts = texts
        self.loads = 0
        self.failure: Exception | None = None
        self.extra_classes = 0
        self.rows = 0
        """How many lines it was asked to recognise."""
        self.units = 0.0
        """Their cost: each row's width in line heights (``W / 48``), as the real recognizer's
        time grows with it."""
        self.seconds_per_unit = 0.0
        """Wall time spent per unit, to stand in for the real recognizer's cost."""

    def load(self) -> None:
        self.loads += 1

    def run(self, batch: NDArray[np.float32]) -> NDArray[np.float32]:
        if self.failure is not None:
            raise self.failure
        units = len(batch) * batch.shape[3] / batch.shape[2]
        self.rows += len(batch)
        self.units += units
        if self.seconds_per_unit > 0:
            time.sleep(units * self.seconds_per_unit)
        readings = []
        for item in batch:
            level = float(item[0, item.shape[1] // 2, 0]) * 127.5 + 127.5
            nearest = min(self.texts, key=lambda known: abs(known - level))
            readings.append(self.texts[nearest])
        steps = max(2 * len(text) + 1 for text, _ in readings)
        probs = np.zeros((len(batch), steps, CLASSES + self.extra_classes), dtype=np.float32)
        probs[:, :, 0] = 1.0
        for i, (text, confidence) in enumerate(readings):
            for k, char in enumerate(text):
                index = CLASSES - 1 if char == " " else 1 + CHARACTERS.index(char)
                probs[i, 2 * k, :] = (1.0 - confidence) / (CLASSES - 1)
                probs[i, 2 * k, index] = confidence
        return probs


class FixedCharacters:
    def __init__(self) -> None:
        self.loads = 0

    def load(self) -> Sequence[str]:
        self.loads += 1
        return CHARACTERS


WIDTH, HEIGHT = 1000, 700
LINES: dict[int, tuple[Region, str, float]] = {
    # grey level: (region, text, confidence)
    180: ((100, 60, 300, 40), "UTOPIA", 0.98),
    200: ((550, 60, 300, 40), "SURNAME", 0.95),
    220: ((100, 200, 300, 40), "VALEMONT", 0.97),
    240: ((100, 340, 300, 40), "12 08 1984", 0.9),
}
PATCH_MARGIN = 45
"""Each line's grey background reaches this far around its region, past the unclip margin."""


def page(lines: dict[int, tuple[Region, str, float]] = LINES) -> NDArray[np.uint8]:
    """White page; each line a grey patch with a 5-pixel dark bar in the middle of its region."""
    img = np.full((HEIGHT, WIDTH, 3), 255, dtype=np.uint8)
    for level, ((x, y, w, h), _, _) in lines.items():
        m = PATCH_MARGIN
        img[y - m : y + h + m, x - m : x + w + m] = level
        img[y + h // 2 - 2 : y + h // 2 + 3, x + 60 : x + w - 60] = 20
    return img


def engine(
    lines: dict[int, tuple[Region, str, float]] = LINES,
) -> tuple[OcrEngine, FakeDetector, FakeRecognizer]:
    detector = FakeDetector([region for region, _, _ in lines.values()], (WIDTH, HEIGHT))
    recognizer = FakeRecognizer({level: (text, conf) for level, (_, text, conf) in lines.items()})
    return OcrEngine(detector, recognizer, FixedCharacters()), detector, recognizer
