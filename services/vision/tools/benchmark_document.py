"""The C60 budget: analysing a 3-page born-digital PDF, median of 10 runs.

The plan (Workflow 5B, ``vision-document``) caps ``POST /v1/analyze/document`` on a 3-page
born-digital PDF at a median of 4 s on the development machine's CPU, in process with the real
models; going over is a blocker reported with this script's stage breakdown. It measures the
analysis the way the API calls vision:

- the document is a synthetic three-page water bill built here with ``minimal_pdf`` (a bill
  summary with its charges, a year of usage, and a page of notices; invented names, C65.1);
- it goes to ``POST /v1/analyze/document`` of the app in process (FastAPI's test client, with
  the service token), with the real text models from ``--models``;
- one warm-up request loads the models, then the timed runs follow;
- each stage is timed: the guarded child (spawn, PDFium, pypdf and the raw scanner, rendering
  the grey rasters), the OCR of the text-layer boxes, the OCR of whole pages (none on a
  born-digital bill) and the image forensics; "other" is what they leave (the upload, the answer's
  validation and the JSON response).

The CPU model, the number of logical CPUs and the characters the OCR read are recorded with the
result: the OCR's cost grows with them. The output is Markdown; ``--json`` also writes the
numbers; the exit code is 0 unless ``--enforce`` is given and the median is over the budget.

``--sample dense`` times four analysed pages of 600 visible lines instead, the most the OCR is
asked to read, against :data:`DENSE_BUDGET_SECONDS` (Workflow 5C review P009).

Usage::

    cd services/vision && uv run python tools/benchmark_document.py
    cd services/vision && uv run python tools/benchmark_document.py --runs 10 --enforce
    cd services/vision && uv run python tools/benchmark_document.py --sample dense --runs 3
"""

from __future__ import annotations

import argparse
import contextlib
import functools
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
from pydantic import SecretStr

from minimal_pdf import Text, content, document, pdf_string
from openverify_vision import document_analysis, ocr
from openverify_vision.app import create_app
from openverify_vision.auth import SERVICE_TOKEN_HEADER
from openverify_vision.faces import FETCH_MODELS_HINT, ModelNotAvailableError
from openverify_vision.ocr import OcrEngine
from openverify_vision.settings import Settings

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
DEFAULT_MODELS: Final = REPO_ROOT / "models"

BUDGET_SECONDS: Final = 4.0
"""Workflow 5B: the median analysis time of a 3-page born-digital PDF, in seconds."""

DEFAULT_RUNS: Final = 10
PAGES: Final = 3

STAGES: Final[tuple[tuple[str, object, str], ...]] = (
    ("guarded child (PDFium, pypdf, scan, render)", document_analysis, "run_guarded"),
    ("ocr (text-layer boxes)", ocr.OcrEngine, "read_regions"),
    ("ocr (whole pages)", ocr.OcrEngine, "read_document"),
    ("image forensics", document_analysis, "measure_image"),
)
"""Each stage of the analysis: its name, and where the call is looked up."""

Clock = Callable[[], float]

_FIRST_YEAR_MONTHS: Final = 3
"""October to December belong to the earlier year."""

_MONTHS: Final = (
    "Oct",
    "Nov",
    "Dec",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
)


def _summary_page() -> list[Text]:
    lines = [
        Text(72, 742, "UTOPIA WATER BOARD", size=18),
        Text(72, 728, "Customer service 0800 000 0000 - utopia-water.example", size=8),
        Text(72, 700, "Statement date: 30 September 2026"),
        Text(72, 686, "Account number: 4471-2208-19"),
        Text(72, 672, "Bill number: 2026-09-118432"),
        Text(72, 640, "QUINN VALEMONT"),
        Text(72, 626, "14 LANTERN ROW"),
        Text(72, 612, "MERIDALE UT 00000"),
        Text(72, 580, "Billing period: 01 Jul 2026 - 30 Sep 2026"),
        Text(72, 566, "Meter number: UT-55102-A"),
        Text(72, 552, "Previous reading 1,204.6 m3 on 30 Jun 2026"),
        Text(72, 538, "Current reading 1,223.0 m3 on 30 Sep 2026"),
        Text(72, 524, "Water used: 18.4 m3"),
    ]
    charges = (
        ("Standing charge (92 days)", "12.88"),
        ("Water supply 18.4 m3 at 1.21 a m3", "22.26"),
        ("Wastewater 17.5 m3 at 0.62 a m3", "10.85"),
        ("Surface water drainage", "2.21"),
        ("Subtotal", "48.20"),
        ("Tax at 0%", "0.00"),
    )
    for row, (label, amount) in enumerate(charges):
        y = 490 - 14 * row
        lines += [Text(72, y, label), Text(480, y, amount, font="F2")]
    lines += [
        Text(72, 390, "Amount due: 48.20", size=12, font="F2"),
        Text(72, 374, "Due date: 21 October 2026"),
        Text(72, 340, "Pay by direct debit, online at utopia-water.example/pay or by transfer."),
        Text(72, 326, "Bank code 00-00-00   Account 00000000   Reference 4471220819"),
        Text(72, 300, "Keep this statement as a record of your account."),
    ]
    return lines


def _usage_page() -> list[Text]:
    lines = [
        Text(72, 742, "Your water use over the last year", size=14),
        Text(72, 716, "Month        Used        A day        Charge"),
    ]
    for row, month in enumerate(_MONTHS):
        used = 5.4 + (row * 7 % 5) * 0.4
        y = 700 - 16 * row
        lines.append(
            Text(
                72,
                y,
                f"{month} {2025 if row < _FIRST_YEAR_MONTHS else 2026}    {used:.1f} m3    "
                f"{used / 30:.2f} m3    {used * 1.83:.2f}",
            )
        )
    lines += [
        Text(72, 490, "Average use: 6.1 m3 a month, 0.20 m3 a day."),
        Text(72, 476, "Homes like yours in Meridale use 6.8 m3 a month."),
        Text(72, 450, "Readings are taken every three months by the meter reader."),
        Text(72, 436, "An estimated reading is marked E on your statement."),
    ]
    return lines


def _notices_page() -> list[Text]:
    sentences = (
        "How we work out your bill: the standing charge covers the cost of",
        "keeping the network ready, and the volume charges follow what your",
        "meter records. Wastewater is charged on 95 percent of the water you",
        "use, because some of it never returns to the sewer. If you think a",
        "reading is wrong, call us and we will check it at no charge to you.",
        "Paying late may add a charge of 5.00 to your next statement. If you",
        "find it hard to pay, ask about our payment plans and support scheme.",
        "We will never ask for your bank password by phone or by message.",
        "This statement was produced for the account holder named overleaf.",
        "Utopia Water Board, 1 Reservoir Way, Meridale UT 00000.",
    )
    lines = [Text(72, 742, "Notices", size=14)]
    for row, sentence in enumerate(sentences * 2):
        lines.append(Text(72, 716 - 14 * row, sentence))
    return lines


DENSE_BUDGET_SECONDS: Final = 10.0
"""Workflow 5C review P009: the dense sample's budget. It costs the child for four 600-line
pages (about 3 s on the development machine) and the OCR's whole unit budget
(``document_analysis.OCR_UNITS_PER_DOCUMENT``, about 5 s there)."""

DENSE_LINES_PER_PAGE: Final = 600
"""The most visible lines the text layer reports on a page (C60.1)."""

DENSE_PAGES: Final = 4


def dense_document() -> bytes:
    """Workflow 5C review P009: four analysed pages, each three columns of 3.2 pt lines, 600
    visible lines a page (synthetic): the most the OCR is asked to read."""
    columns = 3
    rows = DENSE_LINES_PER_PAGE // columns
    page = content(
        [
            Text(20 + 195 * column, 780 - 3.7 * row, f"Row {column}-{row:03d} use 1.2 m3", size=3.2)
            for column in range(columns)
            for row in range(rows)
        ]
    )
    return document([page] * DENSE_PAGES).data


def sample_document() -> bytes:
    """The benchmark's 3-page born-digital bill (synthetic)."""
    pages = [content(page) for page in (_summary_page(), _usage_page(), _notices_page())]
    info = {
        "Producer": pdf_string("Utopia Billing 4.2"),
        "CreationDate": pdf_string("D:20260930100000+02'00'"),
    }
    return document(pages, info=info).data


@dataclass(frozen=True, slots=True)
class Sample:
    """A document the benchmark times, and its budget."""

    build: Callable[[], bytes]
    pages: int
    description: str
    budget: float


SAMPLES: Final = {
    "bill": Sample(sample_document, PAGES, f"the synthetic {PAGES}-page born-digital bill", 4.0),
    "dense": Sample(
        dense_document,
        DENSE_PAGES,
        f"the synthetic {DENSE_PAGES}-page dense PDF ({DENSE_LINES_PER_PAGE} visible lines a page)",
        DENSE_BUDGET_SECONDS,
    ),
}
"""``--sample``: the plan's bill (the default), or the dense case of Workflow 5C review P009."""


@dataclass(frozen=True, slots=True)
class Run:
    """One timed request: its wall time and the seconds each stage took."""

    total: float
    stages: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Summary:
    """The medians of the timed runs, and what they ran on."""

    cpu: str
    logical_cpus: int | None
    sample: str
    pages: int
    characters: int
    runs: int
    budget: float
    median: float
    minimum: float
    maximum: float
    stages: dict[str, float]
    other: float

    @property
    def within_budget(self) -> bool:
        return self.median <= self.budget

    def as_json(self) -> dict[str, Any]:
        return {
            "cpu": self.cpu,
            "logical_cpus": self.logical_cpus,
            "sample": self.sample,
            "pages": self.pages,
            "ocr_characters": self.characters,
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


def summarize(  # noqa: PLR0913 - keyword facts of one summary
    runs: Sequence[Run],
    *,
    cpu: str,
    logical_cpus: int | None,
    characters: int,
    budget: float,
    sample: str = "bill",
) -> Summary:
    """The medians of ``runs``; a stage a run did not reach counts 0 in that run."""
    totals = [run.total for run in runs]
    names = [name for name, _, _ in STAGES if any(name in run.stages for run in runs)]
    return Summary(
        cpu=cpu,
        logical_cpus=logical_cpus,
        sample=sample,
        pages=SAMPLES[sample].pages,
        characters=characters,
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
    cpus = "" if summary.logical_cpus is None else f", {summary.logical_cpus} logical CPUs"
    verdict = "within" if summary.within_budget else "OVER"
    lines = [
        "## Document analysis benchmark (C60, Workflow 5B)",
        "",
        f"- CPU: {summary.cpu}{cpus}",
        f"- Input: {SAMPLES[summary.sample].description}; the OCR read "
        f"{summary.characters} characters",
        f"- Runs: {summary.runs}, after one warm-up request that loads the models",
        f"- Median {summary.median:.2f} s (min {summary.minimum:.2f} s, "
        f"max {summary.maximum:.2f} s): {verdict} the {summary.budget:.2f} s budget",
        "",
        "| Stage | Median (ms) |",
        "|---|---|",
        *(f"| {name} | {seconds * 1000:.0f} |" for name, seconds in summary.stages.items()),
        f"| other (upload, validation, response) | {summary.other * 1000:.0f} |",
        "",
    ]
    return "\n".join(lines)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Time the document analysis (C60).")
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    parser.add_argument("--runs", type=int, default=DEFAULT_RUNS)
    parser.add_argument("--sample", choices=sorted(SAMPLES), default="bill")
    parser.add_argument(
        "--budget", type=float, default=None, help="seconds (default: the sample's budget)"
    )
    parser.add_argument("--json", type=Path, default=None, help="also write the numbers here")
    parser.add_argument(
        "--enforce", action="store_true", help="exit 1 when the median is over the budget"
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    reader: OcrEngine | None = None,
    clock: Clock = time.perf_counter,
) -> int:
    args = _parser().parse_args(argv)
    token = secrets.token_hex(24)
    # Configured from code, never from the environment, so a run measures the same everywhere.
    settings = Settings.model_construct(service_token=SecretStr(token), models_dir=args.models)
    engine = reader if reader is not None else OcrEngine.from_settings(settings)
    if not engine.load():
        print(
            "error: the text models are not available, and the budget covers OCR; "
            f"{FETCH_MODELS_HINT}",
            file=sys.stderr,
        )
        return 1
    sample = SAMPLES[args.sample]
    data = sample.build()
    files = {"document": ("document.pdf", data, "application/pdf")}
    characters = 0
    app = create_app(settings, ocr_engine=engine)
    with TestClient(app) as client:

        def post() -> None:
            nonlocal characters
            response = client.post(
                "/v1/analyze/document", files=files, headers={SERVICE_TOKEN_HEADER: token}
            )
            response.raise_for_status()
            pages = response.json()["pages"]
            characters = sum(len(line["text"]) for page in pages for line in page["ocr"])

        try:
            post()  # warm-up: the models load on first use
        except ModelNotAvailableError as exc:  # pragma: no cover - load() succeeded above
            print(f"error: {exc}", file=sys.stderr)
            return 1
        runs = measure_runs(post, args.runs, clock=clock)

    summary = summarize(
        runs,
        cpu=cpu_model(),
        logical_cpus=os.cpu_count(),
        characters=characters,
        budget=sample.budget if args.budget is None else args.budget,
        sample=args.sample,
    )
    print(render(summary))
    if args.json is not None:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(summary.as_json(), indent=2) + "\n", encoding="utf-8")
    return 1 if args.enforce and not summary.within_budget else 0


if __name__ == "__main__":  # pragma: no cover - exercised through main()
    raise SystemExit(main())
