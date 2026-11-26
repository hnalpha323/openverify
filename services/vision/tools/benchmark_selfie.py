"""The C41.5 budget: the selfie analysis of centre, left and right at 1,280 pixels, median of 10.

The plan (C41.5) caps ``POST /v1/analyze/selfie`` with centre, left and right selfies at 1,280
pixels on the long side at a median of 3 s over 10 runs on the development CPU; exceeding it is a
blocker reported with a per-stage breakdown, never a raised budget. This script measures it the
way the API calls vision:

- the poses are person A's (``fixtures/manifest.json``) unmodified portrait and its re-posed left
  and right turns at the capture constants' target yaw (:mod:`head_turn`), rendered at 1,280 x 960
  and encoded as JPEGs at the web flow's quality;
- the three go to ``POST /v1/analyze/selfie`` of the app, in process (FastAPI's test client, with
  the service token), with the real models from ``--models``;
- one warm-up request loads the models, then the timed runs follow;
- each stage of ``analysis.analyze_selfie_pose`` and the cross-pose consistency is timed (every
  pose added up), so a run over the budget shows where the time goes; "other" is what the stages
  leave (decoding, the multipart upload and the JSON response).

The CPU model and the number of logical CPUs are recorded with the result. The output is a
Markdown summary (a CI job can append it to the job summary); ``--json`` also writes the
numbers. The exit code is 0 unless ``--enforce`` is given and the median is over the budget.

Usage::

    cd services/vision && uv run python tools/benchmark_selfie.py
    cd services/vision && uv run python tools/benchmark_selfie.py --runs 10 --enforce
"""

from __future__ import annotations

import argparse
import contextlib
import functools
import json
import os
import secrets
import statistics
import sys
import time
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

from fastapi.testclient import TestClient
from pydantic import SecretStr

from benchmark_government_id import cpu_model
from head_turn import (
    FACE_TOP,
    FRAMINGS,
    POSE_SIGN,
    POSES,
    CaptureConstants,
    Framing,
    ModelKit,
    SelfieKit,
    base_frame,
    encode_jpeg,
    load_capture_constants,
)
from make_synthetic_fixtures import (
    DEFAULT_MANIFEST,
    DEFAULT_MODELS,
    FixtureError,
    ManifestShapeError,
    selfie_sources,
)
from openverify_vision import analysis
from openverify_vision.analysis import FaceEngine
from openverify_vision.app import create_app
from openverify_vision.auth import SERVICE_TOKEN_HEADER
from openverify_vision.faces import FETCH_MODELS_HINT, ModelNotAvailableError
from openverify_vision.liveness import PassiveLivenessEngine
from openverify_vision.settings import Settings
from synthetic_selfie import STILL_JPEG_QUALITY, Source

BUDGET_SECONDS: Final = 3.0
"""C41.5: the median analysis time of the three poses, in seconds."""

DEFAULT_RUNS: Final = 10
DEFAULT_LONG_SIDE: Final = 1280
ASPECT: Final = 4 / 3
"""The poses are landscape 4:3, like a webcam frame."""

STAGES: Final[tuple[tuple[str, object, str], ...]] = (
    ("faces, quality and embedding", analysis, "analyze_image"),
    ("face quality", analysis, "measure_face_quality"),
    ("head pose", analysis, "estimate_head_pose"),
    ("passive liveness", PassiveLivenessEngine, "measure"),
    ("occlusion", analysis, "measure_occlusion"),
    ("synthetic face", analysis, "measure_synthetic"),
    ("background", analysis, "measure_background"),
    ("consistency", analysis, "measure_consistency"),
)
"""Each stage of a selfie analysis: its name, and where the call is looked up."""

Clock = Callable[[], float]


@dataclass(frozen=True, slots=True)
class Run:
    """One timed request: its wall time and the seconds each stage took (every pose)."""

    total: float
    stages: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Summary:
    """The medians of the timed runs, and what they ran on."""

    cpu: str
    logical_cpus: int | None
    size: tuple[int, int]
    runs: int
    budget: float
    median: float
    minimum: float
    maximum: float
    stages: dict[str, float]
    """The median of each stage's seconds over the runs."""
    other: float
    """The median of what the stages leave of a run: decoding, the upload and the response."""

    @property
    def within_budget(self) -> bool:
        return self.median <= self.budget

    def as_json(self) -> dict[str, Any]:
        return {
            "cpu": self.cpu,
            "logical_cpus": self.logical_cpus,
            "size": list(self.size),
            "runs": self.runs,
            "budget_s": self.budget,
            "median_s": self.median,
            "min_s": self.minimum,
            "max_s": self.maximum,
            "stages_median_s": dict(self.stages),
            "other_median_s": self.other,
            "within_budget": self.within_budget,
        }


def benchmark_poses(
    source: Source, kit: SelfieKit, constants: CaptureConstants, long_side: int
) -> dict[str, bytes]:
    """Centre, left and right of ``source`` at ``long_side`` x 3/4 of it, as JPEG uploads: the
    framed portrait, unmodified, and its turns at the target yaw."""
    size = (long_side, round(long_side / ASPECT))
    base = base_frame(source.photo, source.face_box, Framing(FRAMINGS[0], FACE_TOP), size)
    landmarks = kit.landmarks(base)
    if landmarks is None:
        raise FixtureError(f"no face in {source.name} at {size[0]} x {size[1]}")
    frames = {
        pose: base
        if pose == "center"
        else kit.render(base, landmarks, POSE_SIGN[pose] * constants.target_yaw_deg)
        for pose in POSES
    }
    return {pose: encode_jpeg(frame, STILL_JPEG_QUALITY) for pose, frame in frames.items()}


def _timed[**P, R](
    name: str, function: Callable[P, R], spent: dict[str, float], clock: Clock
) -> Callable[P, R]:
    @functools.wraps(function)
    def timed(*args: P.args, **kwargs: P.kwargs) -> R:
        start = clock()
        try:
            return function(*args, **kwargs)
        finally:
            spent[name] = spent.get(name, 0.0) + clock() - start

    return timed


@contextlib.contextmanager
def timed_stages(spent: dict[str, float], clock: Clock = time.perf_counter) -> Iterator[None]:
    """Within the block, every stage call adds its seconds to ``spent[stage]``; the stages are
    restored afterwards, whatever happens."""
    replaced: list[tuple[object, str, object]] = []
    try:
        for name, owner, attribute in STAGES:
            original = getattr(owner, attribute)
            replaced.append((owner, attribute, original))
            setattr(owner, attribute, _timed(name, original, spent, clock))
        yield
    finally:
        for owner, attribute, original in reversed(replaced):
            setattr(owner, attribute, original)


def measure_runs(
    post: Callable[[], None], runs: int, *, clock: Clock = time.perf_counter
) -> list[Run]:
    """``runs`` timed calls of ``post``, each with its stages timed."""
    measured: list[Run] = []
    for _ in range(runs):
        spent: dict[str, float] = {}
        with timed_stages(spent, clock):
            start = clock()
            post()
            total = clock() - start
        measured.append(Run(total=total, stages=spent))
    return measured


def summarize(
    runs: Sequence[Run],
    *,
    cpu: str,
    logical_cpus: int | None,
    size: tuple[int, int],
    budget: float,
) -> Summary:
    """The medians of ``runs``; a stage a run did not reach counts 0 in that run."""
    totals = [run.total for run in runs]
    names = [name for name, _, _ in STAGES if any(name in run.stages for run in runs)]
    return Summary(
        cpu=cpu,
        logical_cpus=logical_cpus,
        size=size,
        runs=len(runs),
        budget=budget,
        median=statistics.median(totals),
        minimum=min(totals),
        maximum=max(totals),
        stages={
            name: statistics.median(run.stages.get(name, 0.0) for run in runs) for name in names
        },
        other=statistics.median(run.total - sum(run.stages.values()) for run in runs),
    )


def render(summary: Summary) -> str:
    """The summary as Markdown: the verdict first, then the median of each stage."""
    width, height = summary.size
    cpus = "" if summary.logical_cpus is None else f", {summary.logical_cpus} logical CPUs"
    verdict = "within" if summary.within_budget else "OVER"
    lines = [
        "## Selfie analysis benchmark (C41.5)",
        "",
        f"- CPU: {summary.cpu}{cpus}",
        f"- Input: centre, left and right selfies (person A, re-posed), {width} x {height} px, "
        f"JPEG quality {STILL_JPEG_QUALITY}",
        f"- Runs: {summary.runs}, after one warm-up request that loads the models",
        f"- Median {summary.median:.2f} s (min {summary.minimum:.2f} s, "
        f"max {summary.maximum:.2f} s): {verdict} the {summary.budget:.2f} s budget",
        "",
        "| Stage (three poses) | Median (ms) |",
        "|---|---|",
        *(f"| {name} | {seconds * 1000:.0f} |" for name, seconds in summary.stages.items()),
        f"| other (decode, upload, response) | {summary.other * 1000:.0f} |",
        "",
    ]
    return "\n".join(lines)


def _positive(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be 1 or more")
    return number


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Time the selfie analysis (C41.5).")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--faces", type=Path, default=None, help="photo directory (default: <manifest dir>/faces)"
    )
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    parser.add_argument("--runs", type=_positive, default=DEFAULT_RUNS)
    parser.add_argument("--long-side", type=_positive, default=DEFAULT_LONG_SIDE)
    parser.add_argument("--budget", type=float, default=BUDGET_SECONDS)
    parser.add_argument("--json", type=Path, default=None, help="also write the numbers here")
    parser.add_argument(
        "--enforce", action="store_true", help="exit 1 when the median is over the budget"
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    kit: SelfieKit | None = None,
    engine: FaceEngine | None = None,
    liveness: PassiveLivenessEngine | None = None,
    clock: Clock = time.perf_counter,
) -> int:
    """The command line. ``kit``, ``engine`` and ``liveness`` replace the real models (tests)."""
    args = _parser().parse_args(argv)
    faces_dir: Path = args.faces if args.faces is not None else args.manifest.parent / "faces"
    token = secrets.token_hex(24)
    # Configured from code, never from the environment, so a run measures the same everywhere.
    settings = Settings.model_construct(service_token=SecretStr(token), models_dir=args.models)
    constants = load_capture_constants()
    try:
        person_a, _ = selfie_sources(args.manifest, faces_dir)
        chosen = (
            kit
            if kit is not None
            else ModelKit.from_models(args.models, preview_width=constants.preview_width_px)
        )
        face = engine if engine is not None else FaceEngine.from_settings(settings)
        face.ensure_loaded()
        poses = benchmark_poses(person_a, chosen, constants, args.long_side)
    except (FixtureError, ManifestShapeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except ModelNotAvailableError as exc:
        print(f"error: {exc}; {FETCH_MODELS_HINT}", file=sys.stderr)
        return 1

    files = {pose: (f"{pose}.jpg", data, "image/jpeg") for pose, data in poses.items()}
    size = (args.long_side, round(args.long_side / ASPECT))
    app = create_app(settings, face_engine=face)
    if liveness is not None:
        app.state.liveness_engine = liveness
    with TestClient(app) as client:

        def post() -> None:
            response = client.post(
                "/v1/analyze/selfie", files=files, headers={SERVICE_TOKEN_HEADER: token}
            )
            response.raise_for_status()

        post()  # warm-up: the models load on first use
        runs = measure_runs(post, args.runs, clock=clock)

    summary = summarize(
        runs, cpu=cpu_model(), logical_cpus=os.cpu_count(), size=size, budget=args.budget
    )
    print(render(summary))
    if args.json is not None:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(summary.as_json(), indent=2) + "\n", encoding="utf-8")
    return 1 if args.enforce and not summary.within_budget else 0


if __name__ == "__main__":  # pragma: no cover - exercised through main()
    raise SystemExit(main())
