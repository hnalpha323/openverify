"""tools/calibrate_government_id.py: the raw measurements of every synthetic variant (C36).

The analysis runs in process with stub analysers: a face engine whose detector finds one fixed
face and whose recognizer returns a fixed unit vector (no model files), and the OCR engine over an
empty models directory, which reads no text and reports no text model. Every other stage of
``analyze_government_id_side`` runs as it is. The real-model run is the ``integration`` agent's.
"""

from __future__ import annotations

import contextlib
import dataclasses
import io
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.typing import NDArray

import calibrate_government_id
from calibrate_government_id import Analysers, main, measure
from fixture_inputs import A, make_workspace
from make_synthetic_fixtures import GENERATOR_VERSION
from openverify_vision.analysis import FaceEngine
from openverify_vision.faces import Face
from openverify_vision.ocr import OcrEngine
from openverify_vision.quality import (
    DEFAULT_BLUR_MIN,
    DEFAULT_BRIGHTNESS_MAX,
    DEFAULT_BRIGHTNESS_MIN,
    DEFAULT_GLARE_MAX,
    QualityThresholds,
)
from openverify_vision.schemas import EMBEDDING_DIMENSIONS, GovernmentIdModelVersions, SideAnalysis
from openverify_vision.settings import Settings
from synthetic_aamva import AamvaVector, load_vectors
from synthetic_variants import Variant, happy, not_an_id

FACE = Face(box=(40.0, 132.0, 280.0, 380.0), landmarks=((120.0, 260.0),) * 5, score=0.95)


class FixedDetector:
    def load(self) -> None:
        pass

    def detect(self, img: NDArray[np.uint8]) -> list[Face]:
        return [FACE]


class UnitRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: NDArray[np.uint8], face: Face) -> NDArray[np.float32]:
        vector = np.ones(EMBEDDING_DIMENSIONS, dtype=np.float32)
        return vector / np.linalg.norm(vector)


def stub_analysers(models: Path) -> Analysers:
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": models})
    engine = FaceEngine(FixedDetector(), UnitRecognizer(), long_sides=(10_000,))
    return Analysers(engine=engine, reader=OcrEngine.from_settings(settings))


@pytest.fixture
def analysers(tmp_path: Path) -> Analysers:
    empty = tmp_path / "models"
    empty.mkdir()
    return stub_analysers(empty)


def test_it_measures_each_side_of_each_variant_with_the_c32_side_analysis(
    analysers: Analysers,
) -> None:
    document = measure([happy(A), not_an_id()], analysers)

    assert document["generator_version"] == GENERATOR_VERSION
    model_versions = GovernmentIdModelVersions.model_validate(document["model_versions"])
    assert model_versions.text_detector is None  # no text model ran: text is not measured
    card, page = document["variants"]
    assert (card["name"], card["group"], card["expect"]) == ("happy", "happy", [])
    assert page["expect"] == ["id_unprocessable_submission_detection"]
    front = SideAnalysis.model_validate(card["sides"]["front"])
    back = SideAnalysis.model_validate(card["sides"]["back"])
    assert front.portrait is not None
    assert back.portrait is None
    assert page["sides"]["back"] is None
    SideAnalysis.model_validate(page["sides"]["front"])


def test_it_records_the_whole_image_thresholds_vision_judged_with(analysers: Analysers) -> None:
    # The report judges vision's own defaults (min-blur-score, max-glare-ratio) against them.
    document = measure([], analysers)

    assert document["quality_thresholds"] == {
        "blur_min": DEFAULT_BLUR_MIN,
        "glare_max": DEFAULT_GLARE_MAX,
        "brightness_min": DEFAULT_BRIGHTNESS_MIN,
        "brightness_max": DEFAULT_BRIGHTNESS_MAX,
    }
    tuned = dataclasses.replace(analysers, thresholds=QualityThresholds(blur_min=80.0))
    assert measure([], tuned)["quality_thresholds"]["blur_min"] == 80.0


def test_it_records_the_truth_each_side_shows(analysers: Analysers) -> None:
    card = measure([happy(A)], analysers)["variants"][0]

    truth = card["truth"]
    assert truth["front"]["fields"]["Surname"] == "CALDERWOOD"
    assert truth["front"]["mrz"] is None
    assert len(truth["back"]["mrz"]) == 3
    assert truth["back"]["jpeg_quality"] == 92
    assert "file" not in truth["front"]
    assert card["description"]


def test_it_measures_the_aamva_barcode_only_images_as_back_sides(analysers: Analysers) -> None:
    vectors = load_vectors()[:2]

    document = measure([], analysers, barcodes=vectors)

    assert [entry["id"] for entry in document["aamva"]] == [vector.id for vector in vectors]
    for entry, vector in zip(document["aamva"], vectors, strict=True):
        assert entry["valid"] is vector.valid
        side = SideAnalysis.model_validate(entry["side"])
        assert side.portrait is None
        assert side.portrait_clarity is None


def run_main(argv: Sequence[str], analysers: Analysers | None) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = main(argv, analysers=analysers)
    return code, out.getvalue(), err.getvalue()


def args(workspace: tuple[Path, Path], out: Path, *extra: str) -> list[str]:
    manifest, faces = workspace
    return ["--manifest", str(manifest), "--faces", str(faces), "--out", str(out), *extra]


def test_main_writes_the_measurements_of_the_chosen_variants(
    analysers: Analysers, tmp_path: Path
) -> None:
    out = tmp_path / "calibration" / "measurements.json"
    workspace = make_workspace(tmp_path)

    code, printed, warned = run_main(
        args(workspace, out, "--only", "happy", "--only", "expired"), analysers
    )

    assert code == 0
    document: dict[str, Any] = json.loads(out.read_text(encoding="utf-8"))
    assert [variant["name"] for variant in document["variants"]] == ["happy", "expired"]
    assert document["aamva"] == []
    assert str(out) in printed
    assert "no text model" in warned  # the stub OCR read nothing: say so, never imply no text


def test_main_measures_every_variant_holder_re_encoding_and_aamva_image_by_default(
    analysers: Analysers, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    chosen: dict[str, Any] = {}

    def recorded(
        variants: Sequence[Variant], _: Analysers, *, barcodes: Sequence[AamvaVector] = ()
    ) -> dict[str, Any]:
        chosen.update(variants=variants, barcodes=barcodes)
        return {"model_versions": {"text_detector": "stub"}, "variants": [], "aamva": []}

    monkeypatch.setattr(calibrate_government_id, "measure", recorded)

    assert run_main(args(make_workspace(tmp_path), tmp_path / "m.json"), analysers)[0] == 0

    groups = [variant.group for variant in chosen["variants"]]
    assert groups[0] == "happy"
    assert groups.count("variant") >= 18
    assert groups.count("distinct-holder") >= 4
    assert groups.count("re-encoding") >= 3
    assert [vector.id for vector in chosen["barcodes"]] == [v.id for v in load_vectors()]


def test_main_refuses_an_unknown_variant_name(analysers: Analysers, tmp_path: Path) -> None:
    code, _, warned = run_main(
        args(make_workspace(tmp_path), tmp_path / "m.json", "--only", "nonesuch"), analysers
    )

    assert code == 2
    assert "nonesuch" in warned
    assert "expired" in warned  # it lists the names it knows


def test_main_without_the_face_models_points_at_the_fetch_script(tmp_path: Path) -> None:
    empty = tmp_path / "models"
    empty.mkdir()

    code, _, warned = run_main(
        [*args(make_workspace(tmp_path), tmp_path / "m.json"), "--models", str(empty)], None
    )

    assert code == 1
    assert "fetch_models.py" in warned


def test_main_reports_missing_faces(analysers: Analysers, tmp_path: Path) -> None:
    manifest, faces = make_workspace(tmp_path)
    (faces / "a-id.jpg").unlink()

    code, _, warned = run_main(args((manifest, faces), tmp_path / "m.json"), analysers)

    assert code == 1
    assert "fetch_fixtures.py" in warned
