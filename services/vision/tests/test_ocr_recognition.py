"""``ocr/recognition.py``: RapidOCR's line pre-processing and greedy CTC decoding.

As in RapidOCR v3.10.0 (``ch_ppocr_rec``): a line is resized to 48 pixels high, normalised to
[-1, 1] and right-padded to the batch width; the class table is the CTC blank, the dictionary,
then a space. Restricting the decoder to an alphabet (the MRZ) chooses, at each step, the most
probable allowed class, so no character is ever added that the model did not score there.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pytest
from numpy.typing import NDArray

from openverify_vision.inference import InferenceError
from openverify_vision.ocr.recognition import (
    REC_BATCH,
    REC_HEIGHT,
    CtcDecoder,
    Reading,
    recognition_input,
    recognize,
)

DECODER = CtcDecoder(["a", "b", "c"])
BLANK, A, B, C, SPACE = range(5)


def steps(*rows: dict[int, float], classes: int = 5) -> NDArray[np.float32]:
    """One batch item: a probability row per time step (unlisted classes share the rest)."""
    probs = np.zeros((1, len(rows), classes), dtype=np.float32)
    for t, row in enumerate(rows):
        rest = (1.0 - sum(row.values())) / (classes - len(row))
        probs[0, t, :] = rest
        for index, value in row.items():
            probs[0, t, index] = value
    return probs


# --- pre-processing -------------------------------------------------------------------------


def test_a_line_is_resized_to_48_high_normalised_and_padded() -> None:
    crop = np.zeros((24, 120, 3), dtype=np.uint8)
    crop[:, :60] = 255

    batch = recognition_input(crop, 320 / 48)

    assert batch.shape == (3, REC_HEIGHT, 320)
    assert batch.dtype == np.float32
    assert batch[:, :, :100].max() == pytest.approx(1.0)  # 255 -> (1 - 0.5) / 0.5
    assert batch[:, :, 140:240].min() == pytest.approx(-1.0)  # 0 -> -1
    assert np.all(batch[:, :, 240:] == 0.0)  # right padding


def test_a_line_wider_than_the_batch_ratio_fills_the_width() -> None:
    crop = np.full((10, 400, 3), 128, dtype=np.uint8)

    batch = recognition_input(crop, 320 / 48)

    assert batch.shape == (3, REC_HEIGHT, 320)
    assert not np.any(batch == 0.0)  # no padding: squeezed to the full width


# --- CTC decoding ---------------------------------------------------------------------------


def test_the_class_table_is_blank_the_dictionary_and_a_space() -> None:
    assert DECODER.classes == 5
    assert DECODER.class_ids("ba").tolist() == [BLANK, A, B]


def test_an_alphabet_character_missing_from_the_dictionary_is_refused() -> None:
    with pytest.raises(ValueError, match="'z'"):
        DECODER.class_ids("az")


def test_repeats_collapse_and_blanks_separate_doubled_letters() -> None:
    probs = steps({A: 0.9}, {A: 0.8}, {BLANK: 0.9}, {A: 0.7}, {B: 0.6}, {SPACE: 0.9})

    (reading,) = DECODER.decode(probs)

    assert reading.text == "aab "
    assert reading.confidence == pytest.approx(np.mean([0.9, 0.7, 0.6, 0.9]), abs=1e-5)


def test_nothing_read_is_empty_with_zero_confidence() -> None:
    assert DECODER.decode(steps({BLANK: 0.99}, {BLANK: 0.99})) == [Reading("", 0.0)]


def test_an_alphabet_takes_the_most_probable_allowed_class_at_each_step() -> None:
    probs = steps({C: 0.6, A: 0.3}, {BLANK: 0.9}, {B: 0.5})

    (free,) = DECODER.decode(probs)
    (limited,) = DECODER.decode(probs, DECODER.class_ids("ab"))

    assert free.text == "cb"
    assert limited.text == "ab"
    assert limited.confidence == pytest.approx((0.3 + 0.5) / 2, abs=1e-5)


def test_an_alphabet_never_fills_a_blank_step() -> None:
    probs = steps({BLANK: 0.5, C: 0.4}, {B: 0.9})

    (limited,) = DECODER.decode(probs, DECODER.class_ids("ab"))

    assert limited.text == "b"


def test_a_model_output_of_the_wrong_width_is_an_inference_failure() -> None:
    # A dictionary that does not fit the recognizer: an unusable output, answered as a typed
    # inference failure (1B F021), never decoded into wrong text.
    with pytest.raises(InferenceError, match="classes"):
        DECODER.decode(np.zeros((1, 4, 7), dtype=np.float32))


# --- the whole recognizer, on a fake model --------------------------------------------------


class SpellingModel:
    """Spells, for each batch item, the letter whose class is the item's mean grey level / 50."""

    def __init__(self) -> None:
        self.batches: list[tuple[int, ...]] = []

    def load(self) -> None:
        pass

    def run(self, batch: NDArray[np.float32]) -> NDArray[np.float32]:
        self.batches.append(batch.shape)
        items, _, _, width = batch.shape
        probs = np.zeros((items, width // 8, 5), dtype=np.float32)
        probs[:, :, BLANK] = 1.0
        for i in range(items):
            level = float(batch[i, 0, 0, 0] * 0.5 + 0.5) * 255
            probs[i, 0, BLANK] = 0.0
            probs[i, 0, round(level / 50)] = 1.0
        return probs


def crop(level: int, width: int) -> NDArray[np.uint8]:
    return np.full((48, width, 3), level, dtype=np.uint8)


def test_readings_come_back_in_the_order_of_the_crops() -> None:
    model = SpellingModel()
    crops: Sequence[NDArray[np.uint8]] = [crop(50, 900), crop(150, 100), crop(100, 400)]

    readings = recognize(crops, model, DECODER)

    assert [r.text for r in readings] == ["a", "c", "b"]
    # One batch, as wide as the widest line (sorted by aspect ratio), never under 320.
    assert model.batches == [(3, 3, REC_HEIGHT, 900)]


def test_a_very_long_line_is_squeezed_to_64_times_the_line_height() -> None:
    """G011 (Workflow 3B review): a batch is as wide as its widest line, and the recognizer's
    time grows with the width (about 0.08 s for a batch 320 wide, 1 s at 64 times the height,
    1.5 s at 100). The longest real line, a TD3 MRZ line, is about 34 times its height."""
    model = SpellingModel()

    readings = recognize([crop(50, 200 * REC_HEIGHT), crop(100, 400)], model, DECODER)

    assert [r.text for r in readings] == ["a", "b"]
    assert model.batches == [(2, 3, REC_HEIGHT, 64 * REC_HEIGHT)]


def test_lines_are_recognised_in_batches_of_six() -> None:
    model = SpellingModel()

    readings = recognize([crop(50, 100 + i) for i in range(8)], model, DECODER)

    assert len(readings) == 8
    assert [shape[0] for shape in model.batches] == [REC_BATCH, 2]
    assert all(shape[3] == 320 for shape in model.batches)


def test_recognising_nothing_runs_no_model() -> None:
    model = SpellingModel()

    assert recognize([], model, DECODER) == []
    assert model.batches == []


def test_an_alphabet_reaches_the_decoder() -> None:
    class AlwaysC(SpellingModel):
        def run(self, batch: NDArray[np.float32]) -> NDArray[np.float32]:
            probs = np.zeros((batch.shape[0], 2, 5), dtype=np.float32)
            probs[:, 0, C], probs[:, 0, A] = 0.7, 0.2
            probs[:, 1, BLANK] = 1.0
            return probs

    (reading,) = recognize([crop(10, 100)], AlwaysC(), DECODER, allowed=DECODER.class_ids("a"))

    assert reading.text == "a"
