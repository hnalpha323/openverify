"""Visual-zone OCR over the rectified document (C32.1 ``text``), on PP-OCRv6 small (C33).

The pre- and post-processing is RapidOCR v3.10.0's, vendored on the existing onnxruntime
(``detection``, ``recognition``, ``geometry``; attribution in ``services/vision/NOTICE``), without
the ``rapidocr``, ``pyclipper`` or ``shapely`` packages. The engine is created once per app
(``app.state.ocr_engine``) and loads its models lazily, like the face engine, so ``/health``
works before the weights are fetched and weights fetched later are picked up.

**Not measured is not "no text".** When the text models cannot be loaded (not fetched, or a file
this package refuses), :meth:`OcrEngine.read_text` reads nothing and both model versions are
``None``, so the response names no text model: the API must then treat ``text`` and ``mrz`` as
not measured, never as an empty document (C32.1, Workflow 3A Stage 1 amendment 12). A failure
while a loaded model runs is raised, never read as no text.

OCR text is PII (C32.5): it is returned, never logged.
"""

from __future__ import annotations

import logging
import math
import threading
from collections.abc import Sequence
from typing import Final, Protocol

import numpy as np

from openverify_vision.faces import FETCH_MODELS_HINT, ModelNotAvailableError
from openverify_vision.imaging import ImageArray, ensure_bgr
from openverify_vision.ocr import recognition
from openverify_vision.ocr.detection import DetectionParams, detect_text
from openverify_vision.ocr.dictionary import CharacterDictionary, DictionaryError
from openverify_vision.ocr.geometry import Quad, quad_bounds, rotate_crop
from openverify_vision.ocr.recognition import CtcDecoder, Reading, RecognitionBudget
from openverify_vision.ocr.runtime import InferenceModel, OnnxModel
from openverify_vision.ocr.strokes import stroke_width_stats
from openverify_vision.schemas import (
    MAX_DOCUMENT_LINE_LENGTH,
    MAX_DOCUMENT_LINES,
    MAX_TEXT_LENGTH,
    MAX_TEXT_LINES,
    BoundingBox,
    DocumentOcrLine,
    TextLine,
)
from openverify_vision.settings import Settings

logger = logging.getLogger(__name__)

TEXT_DETECTOR_FILENAME: Final = "ppocrv6_small_det.onnx"
"""Must match the ``text_detection_ppocrv6_small`` entry in ``models/manifest.json``."""

TEXT_RECOGNIZER_FILENAME: Final = "ppocrv6_small_rec.onnx"
"""Must match the ``text_recognition_ppocrv6_small`` entry in ``models/manifest.json``."""

TEXT_DICTIONARY_FILENAME: Final = "ppocrv6_small_rec_inference.yml"
"""The recognizer's ``inference.yml`` (its character dictionary); the
``text_recognition_ppocrv6_small_dict`` entry in ``models/manifest.json``."""

TEXT_DETECTOR_VERSION: Final = "pp-ocrv6-small-det"
"""Reported as ``model_versions.text_detector`` once the text models are loaded."""

TEXT_RECOGNIZER_VERSION: Final = "pp-ocrv6-small-rec"
"""Reported as ``model_versions.text_recognizer`` once the text models are loaded."""

TEXT_SCORE: Final = 0.5
"""Lines read with a lower mean character probability are dropped (RapidOCR's ``text_score``)."""

REGION_PADDING: Final = 0.3
"""C60.1: a text-layer box is read with this share of its height added on every side, as the
text detector's unclip margin would leave around a line."""

MIN_REGION_SIDE: Final = 2

_CONFIDENCE_DECIMALS: Final = 4
_BOX_DECIMALS: Final = 2
_STROKE_DECIMALS: Final = 3
_BMP_LAST: Final = 0xFFFF


class CharacterTable(Protocol):
    """The recognizer's characters, without the CTC blank and the trailing space."""

    def load(self) -> Sequence[str]: ...


def _clip_utf16(text: str, limit: int) -> str:
    """The longest prefix of ``text`` of at most ``limit`` UTF-16 code units (how the API's
    zod schema counts a string), so no character is ever cut in half."""
    units = 0
    for index, char in enumerate(text):
        units += 2 if ord(char) > _BMP_LAST else 1
        if units > limit:
            return text[:index]
    return text


def _document_line(reading: Reading, box: BoundingBox) -> DocumentOcrLine | None:
    text = _clip_utf16(reading.text.strip(), MAX_DOCUMENT_LINE_LENGTH).rstrip()
    if not text:
        return None
    confidence = round(min(max(reading.confidence, 0.0), 1.0), _CONFIDENCE_DECIMALS)
    return DocumentOcrLine(text=text, confidence=confidence, box=box)


def _box(quad: Quad) -> BoundingBox:
    x, y, w, h = (round(value, _BOX_DECIMALS) for value in quad_bounds(quad))
    return (x, y, w, h)


class OcrEngine:
    """Text detection and recognition over lazily loaded models; thread-safe."""

    def __init__(
        self,
        detector: InferenceModel,
        recognizer: InferenceModel,
        characters: CharacterTable,
        *,
        params: DetectionParams | None = None,
    ) -> None:
        self._detector = detector
        self._recognizer = recognizer
        self._characters = characters
        self._params = params if params is not None else DetectionParams()
        self._decoder: CtcDecoder | None = None
        self._lock = threading.Lock()

    @classmethod
    def from_settings(cls, settings: Settings) -> OcrEngine:
        """An engine over the OCR models in ``settings.models_dir``; nothing is loaded yet."""
        models = settings.models_dir
        return cls(
            OnnxModel(models / TEXT_DETECTOR_FILENAME, name="text detector"),
            OnnxModel(models / TEXT_RECOGNIZER_FILENAME, name="text recognizer"),
            CharacterDictionary(models / TEXT_DICTIONARY_FILENAME),
        )

    def load(self) -> bool:
        """Load the text models and the dictionary if they are there; ``False`` (with a
        warning) when they are not, so text and the MRZ go unmeasured. Safe to repeat."""
        with self._lock:
            if self._decoder is None:
                try:
                    self._detector.load()
                    self._recognizer.load()
                    characters = self._characters.load()
                except (ModelNotAvailableError, DictionaryError) as exc:
                    logger.warning(
                        "text models unavailable, so text and the MRZ are not measured: %s", exc
                    )
                    return False
                self._decoder = CtcDecoder(characters)
        return True

    @property
    def detector_version(self) -> str | None:
        """Reported as ``model_versions.text_detector``; ``None`` while no model is loaded."""
        return TEXT_DETECTOR_VERSION if self._decoder is not None else None

    @property
    def recognizer_version(self) -> str | None:
        """Reported as ``model_versions.text_recognizer``; ``None`` while no model is loaded."""
        return TEXT_RECOGNIZER_VERSION if self._decoder is not None else None

    def read_text(self, img: ImageArray) -> list[TextLine]:
        """Every text line of ``img`` in reading order, with its confidence, its box in the
        pixels of ``img`` and its stroke-width statistics. Only the first 200 detected lines are
        read (the response holds at most 200 lines of 200 characters, so no more work is done:
        Workflow 3B review G011); lines read with a confidence under :data:`TEXT_SCORE`, or
        empty, are dropped. Nothing when the text models are unavailable (see the module
        docstring)."""
        if not self.load() or self._decoder is None:
            return []
        bgr = ensure_bgr(img)
        quads = detect_text(bgr, self._detector, self._params)[:MAX_TEXT_LINES]
        crops = [rotate_crop(bgr, quad) for quad in quads]
        readings = recognition.recognize(crops, self._recognizer, self._decoder)

        lines: list[TextLine] = []
        for quad, crop, reading in zip(quads, crops, readings, strict=True):
            text = _clip_utf16(reading.text.strip(), MAX_TEXT_LENGTH).rstrip()
            if not text or reading.confidence < TEXT_SCORE:
                continue
            strokes = stroke_width_stats(crop)
            lines.append(
                TextLine(
                    text=text,
                    confidence=round(min(max(reading.confidence, 0.0), 1.0), _CONFIDENCE_DECIMALS),
                    box=_box(quad),
                    stroke_width_mean=None if strokes is None else round(strokes[0], 3),
                    stroke_width_cv=None if strokes is None else round(strokes[1], 4),
                )
            )
        return lines

    def read_document(
        self, img: ImageArray, budget: RecognitionBudget | None = None
    ) -> list[DocumentOcrLine]:
        """C60.1: every text line of a document page raster in reading order, at most 600
        lines of 300 characters, each recognised on its own; lines read with a confidence under
        :data:`TEXT_SCORE`, or empty, are dropped. Nothing without the text models.

        With a ``budget`` (Workflow 5C review P009), the detected lines are read in reading
        order as long as it admits them, and the rest are not read; its deadline is checked
        before the detection and before each recognition
        (:class:`~openverify_vision.ocr.recognition.RecognitionDeadlineError`)."""
        if not self.load() or self._decoder is None:
            return []
        if budget is not None:
            budget.check_deadline()
        bgr = ensure_bgr(img)
        quads = detect_text(bgr, self._detector, self._params)[:MAX_DOCUMENT_LINES]
        crops: list[ImageArray] = []
        for quad in quads:
            crop = rotate_crop(bgr, quad)
            if budget is not None and not budget.admit(crop):
                break
            crops.append(crop)
        quads = quads[: len(crops)]
        readings = recognition.recognize(
            crops, self._recognizer, self._decoder, batch_size=1, budget=budget
        )
        lines: list[DocumentOcrLine] = []
        for quad, reading in zip(quads, readings, strict=True):
            line = _document_line(reading, _box(quad))
            if line is not None and line.confidence >= TEXT_SCORE:
                lines.append(line)
        return lines

    def read_regions(
        self,
        img: ImageArray,
        boxes: Sequence[BoundingBox],
        budget: RecognitionBudget | None = None,
    ) -> list[DocumentOcrLine | None]:
        """C60.1, C60.5: the reading of the raster at each box (a text-layer line's), padded by
        :data:`REGION_PADDING` of its height on every side and clipped to the raster; no text
        detection is run. A reading keeps its confidence however low: the box is known to hold
        text, so a poor reading is itself evidence. ``None`` for a box off the raster or read
        as nothing; an empty list without the text models.

        With a ``budget`` (Workflow 5C review P009), the boxes are read in order as long as it
        admits them: the answer covers only that prefix of ``boxes`` (a box off the raster
        costs nothing), and the boxes after it are not read. Its deadline is checked before
        each recognition (:class:`~openverify_vision.ocr.recognition.RecognitionDeadlineError`).
        """
        if not self.load() or self._decoder is None:
            return []
        bgr = ensure_bgr(img)
        height, width = bgr.shape[:2]
        crops: list[ImageArray] = []
        kept: list[tuple[int, BoundingBox]] = []
        considered = 0
        for index, (x, y, w, h) in enumerate(boxes):
            pad = REGION_PADDING * h
            left, top = max(0, math.floor(x - pad)), max(0, math.floor(y - pad))
            right = min(width, math.ceil(x + w + pad))
            bottom = min(height, math.ceil(y + h + pad))
            if right - left >= MIN_REGION_SIDE and bottom - top >= MIN_REGION_SIDE:
                crop = np.ascontiguousarray(bgr[top:bottom, left:right])
                if budget is not None and not budget.admit(crop):
                    break
                crops.append(crop)
                kept.append(
                    (index, (float(left), float(top), float(right - left), float(bottom - top)))
                )
            considered = index + 1
        readings = recognition.recognize(
            crops, self._recognizer, self._decoder, batch_size=1, budget=budget
        )
        found: list[DocumentOcrLine | None] = [None] * considered
        for (index, box), reading in zip(kept, readings, strict=True):
            found[index] = _document_line(reading, box)
        return found

    def recognize(
        self, images: Sequence[ImageArray], *, alphabet: str | None = None
    ) -> list[Reading]:
        """The reading of each line image (no detection), limited to ``alphabet`` when given.
        Raises :class:`~openverify_vision.faces.ModelNotAvailableError` without the models."""
        if not self.load() or self._decoder is None:
            raise ModelNotAvailableError(f"the text models are not available; {FETCH_MODELS_HINT}")
        allowed = None if alphabet is None else self._decoder.class_ids(alphabet)
        crops = [ensure_bgr(image) for image in images]
        return recognition.recognize(crops, self._recognizer, self._decoder, allowed=allowed)


def visual_zone(lines: Sequence[TextLine], mrz_box: BoundingBox | None) -> list[TextLine]:
    """``lines`` without those whose centre lies in the machine-readable zone ``mrz_box``: the
    MRZ is reported on its own (C32.1 ``mrz``), and ``text`` is the visual zone."""
    if mrz_box is None:
        return list(lines)
    x, y, w, h = mrz_box

    def in_zone(line: TextLine) -> bool:
        cx = line.box[0] + line.box[2] / 2
        cy = line.box[1] + line.box[3] / 2
        return x <= cx <= x + w and y <= cy <= y + h

    return [line for line in lines if not in_zone(line)]
