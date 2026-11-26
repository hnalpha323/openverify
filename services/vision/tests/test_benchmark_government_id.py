"""tools/benchmark_government_id.py: the C32.4 budget benchmark.

Both sides of the happy synthetic card, scaled to the benchmark width, go through
``/v1/analyze/government-id`` of the app in process. The tests use stub engines (a fixed face
and the fake OCR models of ``ocr_fakes``) and gradient "photos", so no weight is needed; every
other stage of the analysis runs as it is. The real-model run is recorded in the evidence file
and logged by the CI vision job.
"""

from __future__ import annotations

import contextlib
import io
import json
import platform
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image

from benchmark_government_id import (
    BUDGET_SECONDS,
    DEFAULT_RUNS,
    DEFAULT_WIDTH,
    STAGES,
    Run,
    cpu_model,
    main,
    measure_runs,
    render,
    scaled_jpeg,
    summarize,
    timed_stages,
)
from fixture_inputs import make_workspace
from ocr_fakes import engine as fake_ocr_engine
from openverify_vision import document
from openverify_vision.analysis import FaceEngine
from openverify_vision.document import NOT_FOUND, DocumentResult
from openverify_vision.faces import Face
from openverify_vision.ocr import OcrEngine
from openverify_vision.schemas import EMBEDDING_DIMENSIONS
from openverify_vision.settings import Settings

STAGE_NAMES = (
    "faces and quality",
    "document",
    "mrz",
    "ocr (visual zone)",
    "barcodes",
    "portrait clarity",
    "document quality",
    "phash",
    "forensics",
)


class FixedDetector:
    def load(self) -> None:
        pass

    def detect(self, img: NDArray[np.uint8]) -> list[Face]:
        return [Face(box=(40.0, 132.0, 280.0, 380.0), landmarks=((120.0, 260.0),) * 5, score=0.95)]


class UnitRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: NDArray[np.uint8], face: Face) -> NDArray[np.float32]:
        vector = np.ones(EMBEDDING_DIMENSIONS, dtype=np.float32)
        return vector / np.linalg.norm(vector)


def stub_engines() -> tuple[FaceEngine, OcrEngine]:
    reader, _, _ = fake_ocr_engine()
    return FaceEngine(FixedDetector(), UnitRecognizer(), long_sides=(10_000,)), reader


NOTHING = DocumentResult(NOT_FOUND, None)
"""A side where no document was found: the pHash stage answers ``None`` at once."""


class Ticks:
    """A clock that moves one second each time it is read."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        self.now += 1.0
        return self.now


# --- the parts --------------------------------------------------------------------------------


def test_the_budget_is_the_plans() -> None:
    assert (BUDGET_SECONDS, DEFAULT_RUNS, DEFAULT_WIDTH) == (5.0, 10, 1600)
    assert tuple(name for name, _, _ in STAGES) == STAGE_NAMES
    for _, owner, attribute in STAGES:
        assert callable(getattr(owner, attribute))


def test_cpu_model_reads_the_model_name(tmp_path: Path) -> None:
    cpuinfo = tmp_path / "cpuinfo"
    cpuinfo.write_text(
        "processor\t: 0\nvendor_id\t: GenuineTest\nmodel name\t: Test CPU E0 @ 1.00GHz\n\n"
        "processor\t: 1\nmodel name\t: Test CPU E0 @ 1.00GHz\n",
        encoding="utf-8",
    )

    assert cpu_model(cpuinfo) == "Test CPU E0 @ 1.00GHz"


def test_cpu_model_falls_back_to_the_platform(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(platform, "processor", lambda: "")
    monkeypatch.setattr(platform, "machine", lambda: "test64")
    without = tmp_path / "cpuinfo"
    without.write_text("processor\t: 0\n", encoding="utf-8")

    assert cpu_model(tmp_path / "missing") == "test64"
    assert cpu_model(without) == "test64"
    monkeypatch.setattr(platform, "machine", lambda: "")
    assert cpu_model(without) == "unknown"


def test_scaled_jpeg_keeps_the_aspect_at_the_width() -> None:
    card = Image.new("RGB", (1027, 648), (200, 210, 220))

    with Image.open(io.BytesIO(scaled_jpeg(card, 1600))) as image:
        assert image.format == "JPEG"
        assert image.size == (1600, 1010)


def test_timed_stages_times_each_stage_call_and_restores_it() -> None:
    original = document.perceptual_hash
    spent: dict[str, float] = {}

    with timed_stages(spent, Ticks()):
        assert document.perceptual_hash is not original
        assert document.perceptual_hash(NOTHING) is None
        assert document.perceptual_hash(NOTHING) is None

    assert spent == {"phash": 2.0}
    assert document.perceptual_hash is original


def test_timed_stages_restores_the_stages_after_a_failure() -> None:
    originals = [getattr(owner, attribute) for _, owner, attribute in STAGES]

    with pytest.raises(RuntimeError), timed_stages({}):
        raise RuntimeError("the request failed")

    assert [getattr(owner, attribute) for _, owner, attribute in STAGES] == originals


def test_measure_runs_times_each_post_and_its_stages() -> None:
    posts: list[int] = []

    def post() -> None:
        posts.append(1)
        document.perceptual_hash(NOTHING)

    runs = measure_runs(post, 3, clock=Ticks())

    assert len(posts) == 3
    # Each run reads the clock four times: start, the stage's start and end, then the end.
    assert runs == [Run(total=3.0, stages={"phash": 1.0})] * 3


def test_summarize_takes_the_medians_and_judges_the_budget() -> None:
    runs = [
        Run(total=3.0, stages={"document": 1.0, "forensics": 1.5}),
        Run(total=1.0, stages={"document": 0.5}),
        Run(total=2.0, stages={"document": 0.75, "forensics": 0.25}),
    ]

    summary = summarize(
        runs, cpu="Test CPU", logical_cpus=4, size=(1600, 1010), budget=BUDGET_SECONDS
    )

    assert (summary.median, summary.minimum, summary.maximum) == (2.0, 1.0, 3.0)
    assert summary.stages == {"document": 0.75, "forensics": 0.25}
    assert summary.other == 0.5  # the median of what the stages leave: 0.5, 0.5 and 1.0
    assert summary.within_budget
    assert not summarize(
        runs, cpu="Test CPU", logical_cpus=4, size=(1600, 1010), budget=1.5
    ).within_budget
    assert summary.as_json() == {
        "cpu": "Test CPU",
        "logical_cpus": 4,
        "size": [1600, 1010],
        "runs": 3,
        "budget_s": 5.0,
        "median_s": 2.0,
        "min_s": 1.0,
        "max_s": 3.0,
        "stages_median_s": {"document": 0.75, "forensics": 0.25},
        "other_median_s": 0.5,
        "within_budget": True,
    }


def test_render_names_the_cpu_the_median_the_verdict_and_each_stage() -> None:
    runs = [Run(total=2.5, stages={"document": 0.25, "ocr (visual zone)": 1.5})]
    summary = summarize(runs, cpu="Test CPU", logical_cpus=None, size=(1600, 1010), budget=5.0)

    text = render(summary)

    assert "Test CPU" in text
    assert "1600 x 1010" in text
    assert "2.50 s" in text
    assert "within the 5.00 s budget" in text
    assert "| document | 250 |" in text
    assert "| ocr (visual zone) | 1500 |" in text
    assert "| other (decode, upload, response) | 750 |" in text
    over = summarize(runs, cpu="Test CPU", logical_cpus=2, size=(1600, 1010), budget=1.0)
    assert "OVER the 1.00 s budget" in render(over)


# --- main -------------------------------------------------------------------------------------


def run_main(
    argv: Sequence[str], engines: tuple[FaceEngine, OcrEngine] | None
) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = main(argv, engines=engines)
    return code, out.getvalue(), err.getvalue()


def workspace_args(tmp_path: Path, *extra: str) -> list[str]:
    manifest, faces = make_workspace(tmp_path)
    return ["--manifest", str(manifest), "--faces", str(faces), *extra]


def test_main_posts_both_sides_and_reports_the_median_and_the_stages(tmp_path: Path) -> None:
    out = tmp_path / "benchmark.json"

    code, printed, _ = run_main(
        workspace_args(tmp_path, "--runs", "2", "--width", "400", "--json", str(out)),
        stub_engines(),
    )

    assert code == 0
    assert "Government ID analysis benchmark (C32.4)" in printed
    assert "400 x 252" in printed
    document_json = json.loads(out.read_text(encoding="utf-8"))
    assert document_json["runs"] == 2
    assert document_json["size"] == [400, 252]
    assert document_json["median_s"] > 0
    # Every stage of both sides ran inside the request.
    assert set(document_json["stages_median_s"]) == set(STAGE_NAMES)
    assert all(seconds > 0 for seconds in document_json["stages_median_s"].values())


def test_main_fails_over_budget_only_when_asked(tmp_path: Path) -> None:
    args = workspace_args(tmp_path, "--runs", "1", "--width", "300", "--budget", "0.000001")

    code, printed, _ = run_main(args, stub_engines())
    assert code == 0
    assert "OVER the" in printed

    code, printed, _ = run_main([*args, "--enforce"], stub_engines())
    assert code == 1
    assert "OVER the" in printed


def test_main_without_the_face_models_points_at_the_fetch_script(tmp_path: Path) -> None:
    empty = tmp_path / "models"
    empty.mkdir()

    code, _, warned = run_main(workspace_args(tmp_path, "--models", str(empty)), None)

    assert code == 1
    assert "fetch_models.py" in warned


def test_main_without_the_text_models_refuses_to_report_a_budget(tmp_path: Path) -> None:
    empty = tmp_path / "models"
    empty.mkdir()
    settings = Settings.model_validate({"service_token": "s" * 40, "models_dir": empty})
    face, _ = stub_engines()

    code, _, warned = run_main(workspace_args(tmp_path), (face, OcrEngine.from_settings(settings)))

    assert code == 1
    assert "text models" in warned
    assert "fetch_models.py" in warned


def test_main_reports_missing_faces(tmp_path: Path) -> None:
    manifest, faces = make_workspace(tmp_path)
    (faces / "a-id.jpg").unlink()

    code, _, warned = run_main(["--manifest", str(manifest), "--faces", str(faces)], stub_engines())

    assert code == 1
    assert "fetch_fixtures.py" in warned
