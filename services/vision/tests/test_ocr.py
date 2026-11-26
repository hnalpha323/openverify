"""``ocr/``: the OCR engine (C32.1 ``text``) over the fake models of ``ocr_fakes.py``, so no
weights are needed. The real PP-OCRv6 models run in ``test_ocr_models.py``.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray

from ocr_fakes import (
    HEIGHT,
    LINES,
    WIDTH,
    FakeDetector,
    FakeRecognizer,
    FixedCharacters,
    engine,
    page,
)
from openverify_vision.faces import ModelNotAvailableError
from openverify_vision.ocr import (
    TEXT_DETECTOR_VERSION,
    TEXT_RECOGNIZER_VERSION,
    OcrEngine,
    visual_zone,
)
from openverify_vision.ocr.dictionary import CharacterDictionary
from openverify_vision.schemas import MAX_TEXT_LENGTH, MAX_TEXT_LINES, TextLine
from openverify_vision.settings import Settings

# --- models and versions --------------------------------------------------------------------


def test_without_the_text_models_nothing_is_read_and_no_model_is_named(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": tmp_path})
    reader = OcrEngine.from_settings(settings)

    with caplog.at_level(logging.WARNING, logger="openverify_vision.ocr"):
        assert reader.load() is False
    assert reader.detector_version is None
    assert reader.recognizer_version is None
    assert reader.read_text(page()) == []
    assert "text models unavailable" in caplog.text


def test_the_loaded_engine_names_its_models() -> None:
    reader, detector, recognizer = engine()

    assert reader.load() is True
    assert reader.load() is True  # loading again is free
    assert (reader.detector_version, reader.recognizer_version) == (
        TEXT_DETECTOR_VERSION,
        TEXT_RECOGNIZER_VERSION,
    )
    assert (detector.loads, recognizer.loads) == (1, 1)


def test_models_fetched_later_are_picked_up() -> None:
    reader, detector, _ = engine()
    detector.missing = True
    assert reader.load() is False

    detector.missing = False

    assert reader.load() is True
    assert reader.detector_version == TEXT_DETECTOR_VERSION


def test_a_dictionary_this_reader_refuses_leaves_the_text_models_unloaded(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    broken = tmp_path / "inference.yml"
    broken.write_text("PostProcess:\n  name: CTCLabelDecode\n  character_dict:\n  - AB\n")
    _, detector, recognizer = engine()
    reader = OcrEngine(detector, recognizer, CharacterDictionary(broken))

    with caplog.at_level(logging.WARNING, logger="openverify_vision.ocr"):
        assert reader.load() is False
    assert reader.recognizer_version is None
    assert "one character" in caplog.text


def test_concurrent_first_requests_load_each_model_once() -> None:
    reader, detector, recognizer = engine()
    start = threading.Barrier(8)
    results: list[bool] = []

    def load() -> None:
        start.wait()
        results.append(reader.load())

    threads = [threading.Thread(target=load) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert results == [True] * 8
    assert (detector.loads, recognizer.loads) == (1, 1)


# --- read_text ------------------------------------------------------------------------------


def test_each_line_comes_back_in_reading_order_with_its_box_confidence_and_strokes() -> None:
    reader, _, _ = engine()

    lines = reader.read_text(page())

    assert [line.text for line in lines] == ["UTOPIA", "SURNAME", "VALEMONT", "12 08 1984"]
    assert [line.confidence for line in lines] == [0.98, 0.95, 0.97, 0.9]
    for line, (region, _, _) in zip(lines, LINES.values(), strict=True):
        x, y, w, h = region
        bx, by, bw, bh = line.box
        # The region, grown by the unclip margin (about 28 pixels here).
        assert x - 35 <= bx <= x - 15
        assert y - 35 <= by <= y - 15
        assert w + 30 <= bw <= w + 70
        assert h + 30 <= bh <= h + 70
        assert line.stroke_width_mean == pytest.approx(5.0, abs=0.5)
        assert line.stroke_width_cv is not None
        assert line.stroke_width_cv < 0.1


def test_a_grayscale_image_is_read_like_its_colour_version() -> None:
    reader, _, _ = engine()
    colour = page()

    assert reader.read_text(colour[:, :, 0].copy()) == reader.read_text(colour)


def test_lines_under_the_text_score_or_empty_are_dropped() -> None:
    lines = {
        180: ((100, 60, 300, 40), "UTOPIA", 0.98),
        200: ((550, 60, 300, 40), "FAINT", 0.4),
        220: ((100, 200, 300, 40), "", 0.99),
        240: ((100, 340, 300, 40), "   ", 0.99),
    }
    reader, _, _ = engine(lines)

    assert [line.text for line in reader.read_text(page(lines))] == ["UTOPIA"]


def test_surrounding_spaces_are_trimmed() -> None:
    lines = {180: ((100, 60, 300, 40), " JANE  ", 0.9)}
    reader, _, _ = engine(lines)

    (line,) = reader.read_text(page(lines))

    assert line.text == "JANE"


@pytest.mark.parametrize(
    ("text", "kept"),
    [
        ("A" * 250, "A" * MAX_TEXT_LENGTH),
        # Outside the Basic Multilingual Plane a character is two UTF-16 code units, which is
        # how the API's zod schema counts: 100 of them fill the 200 units.
        ("🚨" * 150, "🚨" * 100),
        ("A" + "🚨" * 120, "A" + "🚨" * 99),
    ],
    ids=["ascii", "astral", "mixed"],
)
def test_a_line_is_cut_to_200_utf16_code_units(text: str, kept: str) -> None:
    lines = {180: ((100, 60, 300, 40), text, 0.9)}
    reader, _, _ = engine(lines)

    (line,) = reader.read_text(page(lines))

    assert line.text == kept
    assert len(line.text.encode("utf-16-le")) // 2 <= MAX_TEXT_LENGTH


def test_at_most_200_lines_are_reported() -> None:
    regions = [(40 + 95 * c, 20 + 27 * r, 60, 10) for r in range(25) for c in range(10)]
    detector = FakeDetector(regions, (WIDTH, HEIGHT))
    reader = OcrEngine(detector, FakeRecognizer({255: ("A", 0.9)}), FixedCharacters())

    lines = reader.read_text(np.full((HEIGHT, WIDTH, 3), 255, dtype=np.uint8))

    assert len(lines) == MAX_TEXT_LINES


class CountingRecognizer(FakeRecognizer):
    """A :class:`FakeRecognizer` that counts the lines it is asked to read."""

    def __init__(self, texts: dict[int, tuple[str, float]]) -> None:
        super().__init__(texts)
        self.lines = 0

    def run(self, batch: NDArray[np.float32]) -> NDArray[np.float32]:
        self.lines += len(batch)
        return super().run(batch)


def test_only_the_lines_that_can_be_reported_are_recognised() -> None:
    """G011 (Workflow 3B review): every detected box (up to 1000) was cropped and recognised,
    then only 200 lines reported; a dense page cost five times the work it could return."""
    regions = [(40 + 95 * c, 20 + 27 * r, 60, 10) for r in range(25) for c in range(10)]
    recognizer = CountingRecognizer({255: ("A", 0.9)})
    reader = OcrEngine(FakeDetector(regions, (WIDTH, HEIGHT)), recognizer, FixedCharacters())

    lines = reader.read_text(np.full((HEIGHT, WIDTH, 3), 255, dtype=np.uint8))

    assert len(lines) == MAX_TEXT_LINES
    assert recognizer.lines == MAX_TEXT_LINES


def test_an_inference_failure_is_raised_not_read_as_no_text() -> None:
    reader, _, recognizer = engine()
    recognizer.failure = RuntimeError("onnxruntime failed")

    with pytest.raises(RuntimeError, match="onnxruntime failed"):
        reader.read_text(page())


def test_a_page_without_text_has_no_lines() -> None:
    reader = OcrEngine(
        FakeDetector([], (WIDTH, HEIGHT)), FakeRecognizer({0: ("", 0.0)}), FixedCharacters()
    )

    assert reader.read_text(page({})) == []


# --- recognize (the MRZ's line reader) ------------------------------------------------------


def test_recognize_can_be_limited_to_an_alphabet() -> None:
    reader, _, _ = engine({180: ((0, 0, 10, 10), "c", 0.6)})
    crop = np.full((48, 200, 3), 180, dtype=np.uint8)

    (free,) = reader.recognize([crop])
    (limited,) = reader.recognize([crop], alphabet="AB<")

    assert free.text == "c"
    assert set(limited.text) <= set("AB<")


def test_recognize_without_the_models_says_so(tmp_path: Path) -> None:
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": tmp_path})

    with pytest.raises(ModelNotAvailableError):
        OcrEngine.from_settings(settings).recognize([np.zeros((48, 100, 3), dtype=np.uint8)])


# --- visual_zone ----------------------------------------------------------------------------


def line_at(x: float, y: float) -> TextLine:
    return TextLine(
        text="TEXT",
        confidence=0.9,
        box=(x, y, 100.0, 20.0),
        stroke_width_mean=None,
        stroke_width_cv=None,
    )


def test_the_visual_zone_leaves_out_the_lines_of_the_machine_readable_zone() -> None:
    viz, mrz_line, straddling = line_at(10, 10), line_at(50, 460), line_at(10, 430)

    kept = visual_zone([viz, mrz_line, straddling], (40.0, 450.0, 900.0, 160.0))

    assert kept == [viz, straddling]  # the third line's centre (60, 440) is above the zone


def test_without_a_machine_readable_zone_every_line_is_visual() -> None:
    lines = [line_at(10, 10), line_at(10, 460)]

    assert visual_zone(lines, None) == lines
