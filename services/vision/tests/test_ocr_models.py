"""The real PP-OCRv6 small models (C33) on rendered text, through :class:`OcrEngine`.

Skipped, with the reason and the fetch command, unless ``python3 scripts/fetch_models.py`` has
put the text models in ``models/`` (CI fetches every model in the manifest, so they run there).
Every image is rendered here with Pillow's bundled font; the holder is fictional. Accuracies
are printed (run with ``-s``) so they can be recorded in the TDD evidence.
"""

from __future__ import annotations

import numpy as np
import pytest

from model_paths import MODELS_DIR, missing_text_models
from openverify_vision.ocr import (
    TEXT_DETECTOR_FILENAME,
    TEXT_DETECTOR_VERSION,
    TEXT_DICTIONARY_FILENAME,
    TEXT_RECOGNIZER_FILENAME,
    TEXT_RECOGNIZER_VERSION,
    OcrEngine,
)
from openverify_vision.ocr.dictionary import load_character_dict
from openverify_vision.ocr.runtime import OnnxModel
from openverify_vision.settings import Settings
from text_images import Placed, character_accuracy, render_lines

MISSING = missing_text_models()
pytestmark = pytest.mark.skipif(
    bool(MISSING),
    reason=f"text models missing ({', '.join(MISSING)}); run python3 scripts/fetch_models.py",
)

VIZ = [
    Placed("UTOPIA", 36, 19, size=46),
    Placed("IDENTITY CARD", 372, 34, size=30),
    Placed("Surname", 372, 132, size=20),
    Placed("VALEMONT", 372, 156, size=34),
    Placed("Given names", 372, 222, size=20),
    Placed("QUINN AVERY", 372, 246, size=34),
    Placed("Sex", 372, 312, size=20),
    Placed("F", 372, 336, size=34),
    Placed("Nationality", 552, 312, size=20),
    Placed("UTO", 552, 336, size=34),
    Placed("Date of birth", 744, 312, size=20),
    Placed("14 02 1990", 744, 336, size=34),
    Placed("Document no.", 372, 402, size=20),
    Placed("X12K45P78", 372, 426, size=34),
    Placed("Date of expiry", 744, 402, size=20),
    Placed("28 02 2034", 744, 426, size=34),
]


@pytest.fixture(scope="module")
def reader() -> OcrEngine:
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": MODELS_DIR})
    engine = OcrEngine.from_settings(settings)
    assert engine.load() is True
    return engine


def test_the_dictionary_fits_the_recognizer() -> None:
    characters = load_character_dict(MODELS_DIR / TEXT_DICTIONARY_FILENAME)
    recognizer = OnnxModel(MODELS_DIR / TEXT_RECOGNIZER_FILENAME, name="text recognizer")

    output = recognizer.run(np.zeros((1, 3, 48, 320), dtype=np.float32))

    assert len(characters) == 18_708
    assert output.shape[2] == len(characters) + 2  # the CTC blank and the trailing space
    assert set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<") <= set(characters)


def test_the_detector_reads_a_document_sized_input() -> None:
    detector = OnnxModel(MODELS_DIR / TEXT_DETECTOR_FILENAME, name="text detector")

    output = detector.run(np.zeros((1, 3, 736, 1152), dtype=np.float32))

    assert output.shape == (1, 1, 736, 1152)


def test_the_engine_names_the_pp_ocrv6_small_models(reader: OcrEngine) -> None:
    assert (reader.detector_version, reader.recognizer_version) == (
        TEXT_DETECTOR_VERSION,
        TEXT_RECOGNIZER_VERSION,
    )


def test_reads_the_visual_zone_of_a_rendered_card(reader: OcrEngine) -> None:
    lines = reader.read_text(render_lines(VIZ))

    accuracies = []
    for placed in VIZ:
        # The line whose box holds the rendered line's first glyph, nearest first.
        candidates = [
            line
            for line in lines
            if line.box[0] - 4 <= placed.x <= line.box[0] + line.box[2]
            and line.box[1] <= placed.y + placed.size / 2 <= line.box[1] + line.box[3]
        ]
        read = (
            min(candidates, key=lambda line: abs(line.box[0] - placed.x)).text if candidates else ""
        )
        accuracies.append(character_accuracy(placed.text, read))
        print(f"\n{placed.text!r:18} read {read!r:20} accuracy {accuracies[-1]:.3f}", end="")
    mean = float(np.mean(accuracies))
    print(f"\nvisual zone: {len(VIZ)} lines, mean per-character accuracy {mean:.4f}")

    assert mean >= 0.95
    assert all(line.stroke_width_mean is not None for line in lines)
    assert all(0.0 <= line.confidence <= 1.0 for line in lines)
