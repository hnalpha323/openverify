"""C60.1: how far a page's visible text layer and the OCR of the same raster agree.

Each visible text-layer line is compared with the OCR reading of its own box: both folded
(NFKC, case-folded, whitespace removed) and scored by ``difflib``'s similarity ratio; a box the
OCR read nothing in scores 0. The page's agreement is the mean score weighted by each line's
length, in [0, 1]; ``None`` without a visible line. Vision measures; the document checks decide
what a low agreement means (C60.5, C60.6).
"""

from __future__ import annotations

import unicodedata
from collections.abc import Sequence
from difflib import SequenceMatcher
from typing import Final

_DECIMALS: Final = 4


def _fold(text: str) -> str:
    return "".join(unicodedata.normalize("NFKC", text).casefold().split())


def text_layer_ocr_agreement(texts: Sequence[str], readings: Sequence[str | None]) -> float | None:
    """The agreement of ``texts`` (visible lines) with ``readings`` (the OCR of each line's
    box, ``None`` when nothing was read)."""
    total = 0
    score = 0.0
    for text, reading in zip(texts, readings, strict=True):
        line = _fold(text)
        if not line:
            continue
        read = _fold(reading) if reading else ""
        ratio = SequenceMatcher(None, line, read, autojunk=False).ratio() if read else 0.0
        total += len(line)
        score += len(line) * ratio
    return None if total == 0 else round(score / total, _DECIMALS)
