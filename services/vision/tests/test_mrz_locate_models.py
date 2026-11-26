"""The real PP-OCRv6 small recognizer on rendered machine-readable zones (C32.1 ``mrz``).

Every ICAO 9303 example of ``contracts/fixtures/mrz/`` whose lines are well formed is rendered
as a document of its format (Pillow's bundled font, 2.54 mm pitch), found with
:func:`locate_mrz` and read with the MRZ alphabet. Per-character accuracy is measured position by
position (a line of the wrong length counts as wrong throughout) and printed (run with ``-s``)
for the TDD evidence. The C32.4 timing of OCR on both sides of a 1,600-pixel card is printed too.

Skipped, with the fetch command, unless the text models are in ``models/``.
"""

from __future__ import annotations

import io
import json
import statistics
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from PIL import Image

from model_paths import MODELS_DIR, missing_text_models
from openverify_vision.imaging import ImageArray
from openverify_vision.mrz_locate import locate_mrz
from openverify_vision.ocr import OcrEngine
from openverify_vision.settings import Settings
from text_images import Placed, positional_accuracy, render_lines, render_mrz_document

MISSING = missing_text_models()
pytestmark = pytest.mark.skipif(
    bool(MISSING),
    reason=f"text models missing ({', '.join(MISSING)}); run python3 scripts/fetch_models.py",
)

VECTORS = Path(__file__).resolve().parents[3] / "contracts" / "fixtures" / "mrz"
FILES = ("icao-td1.json", "icao-td2.json", "icao-td3.json", "icao-mrv.json", "invalid.json")
LINE_LENGTHS = {"TD1": 30, "TD2": 36, "TD3": 44, "MRVA": 44, "MRVB": 36}


def readable_vectors() -> list[dict[str, Any]]:
    """Every vector of a known format whose lines are full-length MRZ characters (the
    lower-case, stray-character and short-line vectors are parser tests, not images)."""
    readable = []
    for file in FILES:
        for vector in json.loads((VECTORS / file).read_text())["vectors"]:
            fmt = vector["format"]
            if fmt is None:
                continue
            lines = vector["lines"]
            if all(len(line) == LINE_LENGTHS[fmt] and line.isupper() for line in lines):
                readable.append(vector)
    return readable


VECTOR_SET = readable_vectors()
VIZ = [Placed("UTOPIA", 36, 19, size=46), Placed("ERIKSSON", 372, 156)]


@pytest.fixture(scope="module")
def reader() -> OcrEngine:
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": MODELS_DIR})
    engine = OcrEngine.from_settings(settings)
    assert engine.load() is True
    return engine


def jpeg(image: ImageArray, quality: int) -> ImageArray:
    buffer = io.BytesIO()
    Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)).save(buffer, "JPEG", quality=quality)
    decoded = cv2.imdecode(np.frombuffer(buffer.getvalue(), dtype=np.uint8), cv2.IMREAD_COLOR)
    return np.asarray(decoded, dtype=np.uint8)


def scaled(image: ImageArray) -> ImageArray:
    resized = cv2.resize(image, None, fx=0.6, fy=0.6, interpolation=cv2.INTER_AREA)
    return np.asarray(resized, dtype=np.uint8)


def blurred(image: ImageArray) -> ImageArray:
    return np.asarray(cv2.GaussianBlur(image, (0, 0), 1.0), dtype=np.uint8)


def jpeg_60(image: ImageArray) -> ImageArray:
    return jpeg(image, 60)


def clean(image: ImageArray) -> ImageArray:
    return image


CONDITIONS: dict[str, Callable[[ImageArray], ImageArray]] = {
    "clean": clean,
    "scale-0.6": scaled,
    "jpeg-60": jpeg_60,
    "blur-1.0": blurred,
}


def test_the_readable_vectors_cover_every_format() -> None:
    assert {vector["format"] for vector in VECTOR_SET} == set(LINE_LENGTHS)


@pytest.mark.parametrize("condition", sorted(CONDITIONS))
def test_reads_the_icao_examples(reader: OcrEngine, condition: str) -> None:
    correct = total = 0
    confusions: dict[str, int] = {}
    for vector in VECTOR_SET:
        document = CONDITIONS[condition](render_mrz_document(vector["lines"], viz=VIZ))

        reading = locate_mrz(document, reader)

        assert reading.found, vector["id"]
        assert reading.format_guess == vector["format"], vector["id"]
        assert [len(line) for line in reading.lines] == [len(line) for line in vector["lines"]]
        right, count = positional_accuracy(vector["lines"], reading.lines)
        correct, total = correct + right, total + count
        for expected, read in zip(vector["lines"], reading.lines, strict=True):
            for a, b in zip(expected, read, strict=True):
                if a != b:
                    confusions[f"{a}->{b}"] = confusions.get(f"{a}->{b}", 0) + 1
        print(f"\n[{condition}] {vector['id']}: {right}/{count} {reading.lines}", end="")
    accuracy = correct / total
    print(
        f"\n[{condition}] {len(VECTOR_SET)} MRZs, per-character accuracy {correct}/{total}"
        f" = {accuracy:.4f}, confusions {confusions}"
    )

    assert accuracy >= 0.97


def test_ocr_time_on_both_sides_of_a_1600_pixel_card(reader: OcrEngine) -> None:
    front_viz = [
        Placed("UTOPIA", 36, 19, size=46),
        Placed("IDENTITY CARD", 372, 34, size=30),
        *(
            Placed(label, 372, 132 + 90 * i, size=20)
            for i, label in enumerate(("Surname", "Given names", "Date of birth", "Document no."))
        ),
        *(
            Placed(value, 372, 156 + 90 * i)
            for i, value in enumerate(("VALEMONT", "QUINN AVERY", "14 02 1990", "X12K45P78"))
        ),
    ]
    back_viz = [Placed("Address", 48, 132, size=20), Placed("12 LANTERN ROW", 48, 156)]
    front = render_lines(front_viz)  # an ID-1 card, 1027 x 648 at 12 px/mm, without an MRZ
    back = render_mrz_document(VECTOR_SET[0]["lines"], viz=back_viz)  # the TD1 zone
    sides = [np.asarray(cv2.resize(card, (1600, 1009)), dtype=np.uint8) for card in (front, back)]

    timings = []
    for _ in range(5):
        start = time.perf_counter()
        for side in sides:
            reader.read_text(side)
            locate_mrz(side, reader)
        timings.append(time.perf_counter() - start)
    median = statistics.median(timings)
    print(
        f"\nOCR + MRZ on both sides of a 1600 x 1009 card: median {median:.3f} s of "
        f"{[round(t, 3) for t in timings]}"
    )

    assert median < 5.0  # the whole C32.4 budget; OCR alone must stay well inside it
