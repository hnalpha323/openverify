"""The ``vision-ocr`` blocks of ``analysis.py`` and ``app.py`` (C32.1).

- ``text`` is the visual zone: the lines read inside the machine-readable zone are reported in
  ``mrz`` only (as the golden fixture shows).
- The OCR engine is loaded before either side is read, so ``model_versions`` names the text
  models from the very first request, and names none while the models are absent.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray

from ocr_fakes import engine, page
from openverify_vision import mrz_locate, ocr
from openverify_vision.analysis import FaceEngine, analyze_government_id_side
from openverify_vision.app import create_app
from openverify_vision.faces import Face
from openverify_vision.quality import QualityThresholds
from openverify_vision.schemas import EMBEDDING_DIMENSIONS, MrzReading, TextLine
from openverify_vision.settings import Settings

from synthetic import Image, encode, make_checkerboard

TOKEN = "s" * 40
AUTH = {"x-service-token": TOKEN}


class NoFaces:
    def load(self) -> None:
        pass

    def detect(self, img: Image) -> list[Face]:
        return []


class UnitRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: Image, face: Face) -> NDArray[np.float32]:
        return np.full(EMBEDDING_DIMENSIONS, EMBEDDING_DIMENSIONS**-0.5, dtype=np.float32)


def faces() -> FaceEngine:
    return FaceEngine(NoFaces(), UnitRecognizer())


def line(text: str, box: tuple[float, float, float, float]) -> TextLine:
    return TextLine(text=text, confidence=0.9, box=box, stroke_width_mean=3.0, stroke_width_cv=0.1)


VIZ_LINE = line("UTOPIA", (10.0, 10.0, 80.0, 20.0))
MRZ_LINES = [line("I<UTOD231458907", (20.0, 470.0 + 55 * i, 900.0, 30.0)) for i in range(3)]
ZONE = MrzReading(
    found=True,
    format_guess="TD1",
    lines=[
        "I<UTOD231458907<<<<<<<<<<<<<<<",
        "7408122F1204159UTO<<<<<<<<<<<6",
        "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
    ],
    line_confidences=[0.97, 0.98, 0.96],
    box=(15.0, 465.0, 950.0, 150.0),
)


def test_the_side_text_is_the_visual_zone_and_the_mrz_lines_stay_in_mrz(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def read_text(self: ocr.OcrEngine, img: Image) -> list[TextLine]:
        return [VIZ_LINE, *MRZ_LINES]

    def locate(img: Image, reader: ocr.OcrEngine) -> MrzReading:
        return ZONE

    monkeypatch.setattr(ocr.OcrEngine, "read_text", read_text)
    monkeypatch.setattr(mrz_locate, "locate_mrz", locate)
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": tmp_path})
    image = make_checkerboard(size=320)

    side = analyze_government_id_side(
        encode(image, "PNG"),
        image,
        faces(),
        ocr.OcrEngine.from_settings(settings),
        QualityThresholds(),
        front=False,
    )

    assert side.text == [VIZ_LINE]
    assert side.mrz == ZONE


def test_without_a_zone_every_line_is_text(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    lines: Sequence[TextLine] = [VIZ_LINE, *MRZ_LINES]
    monkeypatch.setattr(ocr.OcrEngine, "read_text", lambda self, img: list(lines))
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": tmp_path})
    image = make_checkerboard(size=320)

    side = analyze_government_id_side(
        encode(image, "PNG"),
        image,
        faces(),
        ocr.OcrEngine.from_settings(settings),
        QualityThresholds(),
        front=True,
    )

    assert side.text == lines
    assert side.mrz.found is False


def test_the_first_request_names_the_text_models_it_ran() -> None:
    reader, _, _ = engine()
    settings = Settings.model_validate({"service_token": TOKEN})
    client = TestClient(create_app(settings, face_engine=faces(), ocr_engine=reader))

    response = client.post(
        "/v1/analyze/government-id",
        files={"front": ("front.png", encode(page(), "PNG"), "image/png")},
        headers=AUTH,
    )

    assert response.status_code == 200, response.text
    versions = response.json()["model_versions"]
    assert versions["text_detector"] == ocr.TEXT_DETECTOR_VERSION
    assert versions["text_recognizer"] == ocr.TEXT_RECOGNIZER_VERSION


def test_without_the_text_models_the_analysis_names_none(tmp_path: Path) -> None:
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": tmp_path})
    client = TestClient(create_app(settings, face_engine=faces()))

    response = client.post(
        "/v1/analyze/government-id",
        files={"front": ("front.png", encode(page(), "PNG"), "image/png")},
        headers=AUTH,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["model_versions"]["text_detector"] is None
    assert body["model_versions"]["text_recognizer"] is None
    assert body["sides"]["front"]["text"] == []
    assert body["sides"]["front"]["mrz"]["found"] is False


def test_a_recognizer_output_the_dictionary_does_not_fit_is_a_typed_inference_failure() -> None:
    reader, _, recognizer = engine()
    recognizer.extra_classes = 3  # the model answers more classes than the dictionary has
    settings = Settings.model_validate({"service_token": TOKEN})
    client = TestClient(
        create_app(settings, face_engine=faces(), ocr_engine=reader),
        raise_server_exceptions=False,
    )

    response = client.post(
        "/v1/analyze/government-id",
        files={"front": ("front.png", encode(page(), "PNG"), "image/png")},
        headers=AUTH,
    )

    assert response.status_code == 500, response.text
    assert response.json()["code"] == "inference_failed"
