"""The C32.4 budget: analysing both sides of a 1,600-pixel card, median of 10 runs.

The plan (C32.4) caps the government ID analysis of both sides of a 1,600-pixel card at a median
of 5 s over 10 runs on the development machine's CPU, and never raises the budget. This script
measures it the way the API calls vision:

- the card is the happy synthetic Utopia card (``synthetic_variants.happy``, with the
  public-domain portrait of ``fixtures/manifest.json``), each side scaled to the benchmark width
  (1,600 pixels by default) and encoded as a JPEG;
- both sides go to ``POST /v1/analyze/government-id`` of the app, in process (FastAPI's test
  client, with the service token), with the real models from ``--models``;
- one warm-up request loads the models, then the timed runs follow;
- each stage of ``analysis.analyze_government_id_side`` is timed too (both sides added up), so a
  run over the budget shows where the time goes; "other" is what the stages leave (decoding,
  the multipart upload and the JSON response).

The CPU model and the number of logical CPUs are recorded with the result. The output is a
Markdown summary (the CI vision job appends it to the job summary); ``--json`` also writes the
numbers. The exit code is 0 unless ``--enforce`` is given and the median is over the budget:
CI logs the figure without failing on a shared runner's speed.

Usage::

    cd services/vision && uv run python tools/benchmark_government_id.py
    cd services/vision && uv run python tools/benchmark_government_id.py --runs 10 --enforce
"""

from __future__ import annotations

import argparse
import contextlib
import functools
import io
import json
import os
import platform
import secrets
import statistics
import sys
import time
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

from fastapi.testclient import TestClient
from PIL import Image
from pydantic import SecretStr

from make_synthetic_fixtures import (
    DEFAULT_MANIFEST,
    FixtureError,
    ManifestShapeError,
    portraits,
)
from openverify_vision import analysis, barcode, document, forensics, mrz_locate, ocr
from openverify_vision.analysis import FaceEngine
from openverify_vision.app import create_app
from openverify_vision.auth import SERVICE_TOKEN_HEADER
from openverify_vision.faces import FETCH_MODELS_HINT, ModelNotAvailableError
from openverify_vision.ocr import OcrEngine
from openverify_vision.settings import Settings
from synthetic_variants import happy

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
DEFAULT_MODELS: Final = REPO_ROOT / "models"

BUDGET_SECONDS: Final = 5.0
"""C32.4: the median analysis time of both sides, in seconds."""

DEFAULT_RUNS: Final = 10
DEFAULT_WIDTH: Final = 1600
JPEG_QUALITY: Final = 92
"""The generator's JPEG quality; the web flow sends 0.92 and Android 90."""

STAGES: Final[tuple[tuple[str, object, str], ...]] = (
    ("faces and quality", analysis, "analyze_image"),
    ("document", document, "detect_document"),
    ("mrz", mrz_locate, "locate_mrz"),
    ("ocr (visual zone)", ocr.OcrEngine, "read_text"),
    ("barcodes", barcode, "decode_side_barcodes"),
    ("portrait clarity", document, "measure_portrait_clarity"),
    ("document quality", document, "measure_document_quality"),
    ("phash", document, "perceptual_hash"),
    ("forensics", forensics, "analyze_forensics"),
)
"""Each stage ``analyze_government_id_side`` calls: its name, and where the call is looked up."""

Clock = Callable[[], float]


@dataclass(frozen=True, slots=True)
class Run:
    """One timed request: its wall time and the seconds each stage took (both sides)."""

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


def cpu_model(cpuinfo: Path = Path("/proc/cpuinfo")) -> str:
    """The CPU's model name (Linux ``/proc/cpuinfo``), else what the platform reports."""
    try:
        text = cpuinfo.read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = ""
    for line in text.splitlines():
        key, _, value = line.partition(":")
        if key.strip() == "model name" and value.strip():
            return value.strip()
    return platform.processor() or platform.machine() or "unknown"


def scaled_jpeg(image: Image.Image, width: int) -> bytes:
    """``image`` scaled to ``width`` pixels wide (aspect kept), as a JPEG upload."""
    height = round(image.height * width / image.width)
    buffer = io.BytesIO()
    image.convert("RGB").resize((width, height), Image.Resampling.LANCZOS).save(
        buffer, format="JPEG", quality=JPEG_QUALITY
    )
    return buffer.getvalue()


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
        "## Government ID analysis benchmark (C32.4)",
        "",
        f"- CPU: {summary.cpu}{cpus}",
        f"- Input: both sides of the synthetic Utopia card, {width} x {height} px, "
        f"JPEG quality {JPEG_QUALITY}",
        f"- Runs: {summary.runs}, after one warm-up request that loads the models",
        f"- Median {summary.median:.2f} s (min {summary.minimum:.2f} s, "
        f"max {summary.maximum:.2f} s): {verdict} the {summary.budget:.2f} s budget",
        "",
        "| Stage (both sides) | Median (ms) |",
        "|---|---|",
        *(f"| {name} | {seconds * 1000:.0f} |" for name, seconds in summary.stages.items()),
        f"| other (decode, upload, response) | {summary.other * 1000:.0f} |",
        "",
    ]
    return "\n".join(lines)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Time the government ID analysis (C32.4).")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--faces", type=Path, default=None, help="photo directory (default: <manifest dir>/faces)"
    )
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    parser.add_argument("--runs", type=int, default=DEFAULT_RUNS)
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--budget", type=float, default=BUDGET_SECONDS)
    parser.add_argument("--json", type=Path, default=None, help="also write the numbers here")
    parser.add_argument(
        "--enforce", action="store_true", help="exit 1 when the median is over the budget"
    )
    return parser


def _engines(
    settings: Settings, engines: tuple[FaceEngine, OcrEngine] | None
) -> tuple[FaceEngine, OcrEngine]:
    """The given engines, or the real ones over ``settings.models_dir``, loaded."""
    face, reader = (
        engines
        if engines is not None
        else (FaceEngine.from_settings(settings), OcrEngine.from_settings(settings))
    )
    face.ensure_loaded()
    if not reader.load():
        raise ModelNotAvailableError("the text models are not available, and the budget covers OCR")
    return face, reader


def main(
    argv: Sequence[str] | None = None,
    *,
    engines: tuple[FaceEngine, OcrEngine] | None = None,
    clock: Clock = time.perf_counter,
) -> int:
    args = _parser().parse_args(argv)
    faces_dir: Path = args.faces if args.faces is not None else args.manifest.parent / "faces"
    token = secrets.token_hex(24)
    # Configured from code, never from the environment, so a run measures the same everywhere.
    settings = Settings.model_construct(service_token=SecretStr(token), models_dir=args.models)
    try:
        portrait, _ = portraits(args.manifest, faces_dir)
        face, reader = _engines(settings, engines)
    except (FixtureError, ManifestShapeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except ModelNotAvailableError as exc:
        print(f"error: {exc}; {FETCH_MODELS_HINT}", file=sys.stderr)
        return 1

    card = happy(portrait)
    assert card.back is not None  # noqa: S101 - the happy card is two-sided
    front = scaled_jpeg(card.front.image, args.width)
    back = scaled_jpeg(card.back.image, args.width)
    with Image.open(io.BytesIO(front)) as image:
        size = image.size
    files = {
        "front": ("front.jpg", front, "image/jpeg"),
        "back": ("back.jpg", back, "image/jpeg"),
    }

    app = create_app(settings, face_engine=face, ocr_engine=reader)
    with TestClient(app) as client:

        def post() -> None:
            response = client.post(
                "/v1/analyze/government-id", files=files, headers={SERVICE_TOKEN_HEADER: token}
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
