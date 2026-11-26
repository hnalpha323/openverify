"""tools/benchmark_selfie.py: the C41.5 budget benchmark.

Centre, left and right selfies at 1,280 pixels (person A's re-posed renders) go through
``/v1/analyze/selfie`` of the app in process, 10 times after a warm-up, and the median is judged
against the 3 s budget with a per-stage breakdown and the CPU model. Here the kit is
:class:`selfie_fakes.MarkerKit`, the face engine finds one fixed face, the liveness engine measures
nothing, and the "photos" are synthetic; the real run is recorded in the evidence.
"""

from __future__ import annotations

import contextlib
import io
import json
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray

from benchmark_selfie import (
    BUDGET_SECONDS,
    DEFAULT_LONG_SIDE,
    DEFAULT_RUNS,
    STAGES,
    Run,
    benchmark_poses,
    main,
    measure_runs,
    render,
    summarize,
)
from fixture_inputs import make_workspace
from head_turn import decode_jpeg, load_capture_constants
from make_synthetic_fixtures import FixtureError
from openverify_vision import analysis
from openverify_vision.analysis import FaceEngine
from openverify_vision.faces import Face
from openverify_vision.quality import QualityThresholds
from openverify_vision.schemas import EMBEDDING_DIMENSIONS
from selfie_fakes import MarkerKit, textured
from synthetic_selfie import Source

STAGE_NAMES = (
    "faces, quality and embedding",
    "face quality",
    "head pose",
    "passive liveness",
    "occlusion",
    "synthetic face",
    "background",
    "consistency",
)


class FixedDetector:
    def load(self) -> None:
        pass

    def detect(self, img: NDArray[np.uint8]) -> list[Face]:
        height, width = img.shape[:2]
        x, y, w, h = width * 0.4, height * 0.3, width * 0.2, height * 0.35
        points = (
            (x + w * 0.3, y + h * 0.4),
            (x + w * 0.7, y + h * 0.4),
            (x + w * 0.5, y + h * 0.6),
        )
        mouth = ((x + w * 0.35, y + h * 0.8), (x + w * 0.65, y + h * 0.8))
        return [Face(box=(x, y, w, h), landmarks=(*points, *mouth), score=0.95)]


class UnitRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: NDArray[np.uint8], face: Face) -> NDArray[np.float32]:
        vector = np.ones(EMBEDDING_DIMENSIONS, dtype=np.float32)
        return vector / np.linalg.norm(vector)


class NoLiveness:
    """Stands in for the MiniFASNet ensemble: it measures nothing."""

    @property
    def versions(self) -> tuple[str | None, str | None]:
        return (None, None)

    def measure(self, image: object, face: object) -> None:
        del image, face


def stub_engine() -> FaceEngine:
    return FaceEngine(FixedDetector(), UnitRecognizer(), long_sides=(10_000,))


class Ticks:
    """A clock that moves one second each time it is read."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        self.now += 1.0
        return self.now


# --- the parts ------------------------------------------------------------------------------------


def test_the_budget_is_the_plans() -> None:
    assert (BUDGET_SECONDS, DEFAULT_RUNS, DEFAULT_LONG_SIDE) == (3.0, 10, 1280)
    assert tuple(name for name, _, _ in STAGES) == STAGE_NAMES
    for _, owner, attribute in STAGES:
        assert callable(getattr(owner, attribute))


def test_the_poses_are_person_as_renders_at_the_long_side() -> None:
    source = Source("a_selfie", "A", textured((1600, 2000), seed=1), (500, 300, 200, 260))

    poses = benchmark_poses(source, MarkerKit(), load_capture_constants(), 1280)

    assert list(poses) == ["center", "left", "right"]
    decoded = {pose: decode_jpeg(data) for pose, data in poses.items()}
    assert {frame.shape for frame in decoded.values()} == {(960, 1280, 3)}
    assert len(set(poses.values())) == 3


def test_the_poses_need_a_face() -> None:
    source = Source("a_selfie", "A", textured((1600, 2000), seed=1), (500, 300, 200, 260))

    with pytest.raises(FixtureError, match="no face"):
        benchmark_poses(source, MarkerKit(faceless_calls=1), load_capture_constants(), 640)


def test_measure_runs_times_each_post_and_its_stages_and_restores_them() -> None:
    original = analysis.analyze_image
    engine = stub_engine()

    def post() -> None:
        image = np.zeros((40, 40, 3), dtype=np.uint8)
        analysis.analyze_image(image, engine, QualityThresholds(), embed_primary=False)

    runs = measure_runs(post, 2, clock=Ticks())

    assert runs == [Run(total=3.0, stages={"faces, quality and embedding": 1.0})] * 2
    assert analysis.analyze_image is original


def test_summarize_and_render_judge_the_three_second_budget() -> None:
    runs = [
        Run(total=2.0, stages={"head pose": 0.5}),
        Run(total=4.0, stages={"head pose": 1.5, "consistency": 0.5}),
        Run(total=3.0, stages={"head pose": 1.0}),
    ]

    summary = summarize(runs, cpu="Test CPU", logical_cpus=4, size=(1280, 960), budget=3.0)

    assert (summary.median, summary.minimum, summary.maximum) == (3.0, 2.0, 4.0)
    assert summary.stages == {"head pose": 1.0, "consistency": 0.0}
    assert summary.within_budget
    assert summary.as_json()["median_s"] == 3.0
    assert summary.as_json()["size"] == [1280, 960]
    text = render(summary)
    assert "Selfie analysis benchmark (C41.5)" in text
    assert "Test CPU, 4 logical CPUs" in text
    assert "1280 x 960" in text
    assert "within the 3.00 s budget" in text
    assert "| head pose | 1000 |" in text
    over = summarize(runs, cpu="Test CPU", logical_cpus=None, size=(1280, 960), budget=1.0)
    assert "OVER the 1.00 s budget" in render(over)


# --- main -----------------------------------------------------------------------------------------


def run_main(argv: Sequence[str], *, stubs: bool = True) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        if stubs:
            code = main(argv, kit=MarkerKit(), engine=stub_engine(), liveness=NoLiveness())  # type: ignore[arg-type]
        else:
            code = main(argv)
    return code, out.getvalue(), err.getvalue()


def workspace_args(tmp_path: Path, *extra: str) -> list[str]:
    manifest, faces = make_workspace(tmp_path)
    return ["--manifest", str(manifest), "--faces", str(faces), *extra]


def test_main_posts_the_three_poses_and_reports_the_median_and_the_stages(tmp_path: Path) -> None:
    out = tmp_path / "benchmark.json"

    code, printed, _ = run_main(
        workspace_args(tmp_path, "--runs", "2", "--long-side", "320", "--json", str(out))
    )

    assert code == 0
    assert "Selfie analysis benchmark (C41.5)" in printed
    assert "320 x 240" in printed
    numbers = json.loads(out.read_text(encoding="utf-8"))
    assert numbers["runs"] == 2
    assert numbers["size"] == [320, 240]
    # Every stage the app runs inside the request was timed (the stub liveness is not the app's).
    assert set(numbers["stages_median_s"]) == set(STAGE_NAMES) - {"passive liveness"}


def test_main_fails_over_budget_only_when_asked(tmp_path: Path) -> None:
    args = workspace_args(tmp_path, "--runs", "1", "--long-side", "320", "--budget", "0.000001")

    code, printed, _ = run_main(args)
    assert code == 0
    assert "OVER the" in printed

    code, printed, _ = run_main([*args, "--enforce"])
    assert code == 1


def test_main_without_the_models_points_at_the_fetch_script(tmp_path: Path) -> None:
    empty = tmp_path / "models"
    empty.mkdir()

    code, _, warned = run_main(workspace_args(tmp_path, "--models", str(empty)), stubs=False)

    assert code == 1
    assert "fetch_models.py" in warned


def test_main_reports_missing_faces(tmp_path: Path) -> None:
    manifest, faces = make_workspace(tmp_path)
    (faces / "a-selfie.jpg").unlink()

    code, _, warned = run_main(["--manifest", str(manifest), "--faces", str(faces)])

    assert code == 1
    assert "fetch_fixtures.py" in warned


@pytest.mark.parametrize("value", ["0", "-3"])
def test_main_refuses_a_run_count_below_one(tmp_path: Path, value: str) -> None:
    with pytest.raises(SystemExit):
        run_main(workspace_args(tmp_path, "--runs", value))
