# Derived from RapidOCR v3.10.0 (https://github.com/RapidAI/RapidOCR, tag v3.10.0, commit
# bd941dae09da793e76c6ba15c7aaf40f8424232a): python/rapidocr/ch_ppocr_rec/main.py
# (TextRecognizer.__call__, resize_norm_img) and python/rapidocr/ch_ppocr_rec/utils.py
# (CTCLabelDecode); the defaults are those of python/rapidocr/config.yaml.
# Copyright (c) 2021 RapidOCR Authors. Copyright (c) 2020 PaddlePaddle Authors.
# Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0);
# see services/vision/NOTICE.
#
# Changed by the OpenVerify authors: rewritten as typed functions; the decoder can be limited
# to an alphabet (the MRZ characters), taking the most probable allowed class at each step;
# word boxes and right-to-left reordering are left out; a batch is never wider than 64 times
# its height; a document's reading is bounded by a budget of line units and a deadline.
"""Text recognition: line pre-processing and greedy CTC decoding."""

from __future__ import annotations

import math
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.imaging import ImageArray
from openverify_vision.inference import InferenceError
from openverify_vision.ocr.runtime import InferenceModel

REC_HEIGHT: Final = 48
REC_WIDTH: Final = 320
"""The recognizer's input is ``(N, 3, 48, W)``; a batch is at least 320 pixels wide."""

REC_BATCH: Final = 6
"""Lines recognised per model call (RapidOCR's ``rec_batch_num``)."""

MAX_LINE_RATIO: Final = 64
"""A batch is at most this many times as wide as it is high; a longer line is squeezed to it.
The recognizer's time grows with the width (about 1 s for a batch of six at 64), and the longest
real line, a TD3 MRZ line, is about 34 times its height (Workflow 3B review G011)."""

BLANK: Final = 0
"""Index of the CTC blank in the class table."""

_CONFIDENCE_DECIMALS: Final = 5


@dataclass(frozen=True, slots=True)
class Reading:
    """One recognised line and the mean probability of its characters (0 when empty)."""

    text: str
    confidence: float


class RecognitionDeadlineError(RuntimeError):
    """A reading passed its deadline (Workflow 5C review P009)."""


def line_units(crop: ImageArray) -> float:
    """What recognising ``crop`` on its own costs, in line heights of the recognizer's input
    width: its width over its height, at least ``REC_WIDTH / REC_HEIGHT`` (a batch is never
    narrower) and at most :data:`MAX_LINE_RATIO` (a longer line is squeezed). The recognizer's
    time grows with it: about 2 ms of wall time and 12 ms of CPU a unit on the development
    machine (Workflow 5C review P009)."""
    height, width = int(crop.shape[0]), int(crop.shape[1])
    return max(REC_WIDTH / REC_HEIGHT, min(width / max(height, 1), float(MAX_LINE_RATIO)))


@dataclass(slots=True)
class RecognitionBudget:
    """How much recognition one document page may still cost, in :func:`line_units`, and when
    its reading must stop (a :func:`time.monotonic` value; none without one). Workflow 5C
    review P009: the work, not only the answer, is bounded.

    Lines are admitted in order until the first that does not fit; it and every line after it
    stay unread, so what is read is always a prefix."""

    units: float
    deadline: float | None = None
    spent: float = 0.0
    exhausted: bool = False

    def admit(self, crop: ImageArray) -> bool:
        """Whether ``crop`` may still be read; its cost is spent when it may."""
        cost = line_units(crop)
        if self.exhausted or self.spent + cost > self.units:
            self.exhausted = True
            return False
        self.spent += cost
        return True

    def check_deadline(self) -> None:
        """Raise :class:`RecognitionDeadlineError` once the deadline has passed."""
        if self.deadline is not None and time.monotonic() > self.deadline:
            raise RecognitionDeadlineError("the reading passed its deadline")


def recognition_input(img: ImageArray, max_wh_ratio: float) -> NDArray[np.float32]:
    """``img`` (BGR) resized to 48 pixels high keeping its aspect ratio (at most the batch
    width ``48 * max_wh_ratio``), scaled to [-1, 1] and right-padded with zeros, ``(3, 48, W)``."""
    width = int(REC_HEIGHT * max_wh_ratio)
    height, crop_width = img.shape[:2]
    wanted = math.ceil(REC_HEIGHT * crop_width / float(height))
    resized_w = min(width, int(wanted))
    resized = cv2.resize(img, (resized_w, REC_HEIGHT)).astype(np.float32)
    scaled = (resized.transpose(2, 0, 1) / 255.0 - 0.5) / 0.5
    padded = np.zeros((3, REC_HEIGHT, width), dtype=np.float32)
    padded[:, :, :resized_w] = scaled
    return padded


class CtcDecoder:
    """Greedy CTC decoding over the class table: the blank, the dictionary, then a space."""

    def __init__(self, characters: Sequence[str]) -> None:
        self._table: tuple[str, ...] = ("", *characters, " ")
        self._index = {char: i for i, char in enumerate(self._table) if i != BLANK}

    @property
    def classes(self) -> int:
        """Width of the model output this table decodes."""
        return len(self._table)

    def class_ids(self, alphabet: str) -> NDArray[np.int64]:
        """The blank and the class of each character of ``alphabet``, ascending."""
        ids = {BLANK}
        for char in alphabet:
            if char not in self._index:
                raise ValueError(f"{char!r} is not in the recognizer's dictionary")
            ids.add(self._index[char])
        return np.array(sorted(ids), dtype=np.int64)

    def decode(
        self, probs: NDArray[np.float32], allowed: NDArray[np.int64] | None = None
    ) -> list[Reading]:
        """The text of each batch item of ``probs`` ``(N, T, classes)``: the best class at each
        step (among ``allowed`` when given), repeats collapsed, blanks removed. An output the
        class table does not fit raises :class:`~openverify_vision.inference.InferenceError`."""
        if probs.ndim != 3 or probs.shape[2] != self.classes:  # noqa: PLR2004 - (N, T, C)
            raise InferenceError(
                f"model output {probs.shape} does not have the {self.classes} classes "
                "of the dictionary"
            )
        if allowed is None:
            indices = probs.argmax(axis=2)
            scores = probs.max(axis=2)
        else:
            limited = probs[:, :, allowed]
            best = limited.argmax(axis=2)
            indices = allowed[best]
            scores = np.take_along_axis(limited, best[..., None], axis=2)[..., 0]

        readings = []
        for steps, step_scores in zip(indices, scores, strict=True):
            keep = np.ones(len(steps), dtype=bool)
            keep[1:] = steps[1:] != steps[:-1]
            keep &= steps != BLANK
            text = "".join(self._table[int(i)] for i in steps[keep])
            kept = step_scores[keep]
            confidence = round(float(np.mean(kept)), _CONFIDENCE_DECIMALS) if kept.size else 0.0
            readings.append(Reading(text, confidence))
        return readings


def recognize(  # noqa: PLR0913 - keyword options of one reading
    crops: Sequence[ImageArray],
    model: InferenceModel,
    decoder: CtcDecoder,
    *,
    allowed: NDArray[np.int64] | None = None,
    batch_size: int = REC_BATCH,
    budget: RecognitionBudget | None = None,
) -> list[Reading]:
    """The reading of every BGR crop, in the order given. Crops are sorted by aspect ratio and
    recognised ``batch_size`` (:data:`REC_BATCH` by default) at a time, each batch as wide as
    its widest line, at most :data:`MAX_LINE_RATIO` times its height. Documents read one line
    at a time: their lines vary in length, and a padded batch costs more than it saves. With a
    ``budget``, its deadline is checked before each batch."""
    ratios = [crop.shape[1] / float(crop.shape[0]) for crop in crops]
    order = np.argsort(np.asarray(ratios), kind="stable")
    readings: list[Reading | None] = [None] * len(crops)
    for start in range(0, len(crops), batch_size):
        if budget is not None:
            budget.check_deadline()
        members = [int(i) for i in order[start : start + batch_size]]
        widest = max(REC_WIDTH / REC_HEIGHT, *(ratios[i] for i in members))
        max_ratio = min(widest, MAX_LINE_RATIO)
        batch = np.stack([recognition_input(crops[i], max_ratio) for i in members])
        for index, reading in zip(members, decoder.decode(model.run(batch), allowed), strict=True):
            readings[index] = reading
    return [reading for reading in readings if reading is not None]
