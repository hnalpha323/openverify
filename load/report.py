"""C268.7, C279.1, C284.4: the report's tables and its machine-readable summary block.

Each calibration report (docs/calibration/{load,watchlist,lists}-phase11.md) carries exactly one
summary block between `START_MARKER` and `END_MARKER`: a fenced `json` code block holding one object
valid against contracts/fixtures/calibration/summary.schema.json (Workflow 11D Stage 1a amendment
14). `summary_block` writes it, `parse_summary` reads it back from a report, and `check_summary`
checks it with the schema's rules, whose constants a test holds equal to the schema's. 11E's
generator and the release notes read each verdict from the block, never from the prose.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

SUMMARY_SCHEMA = "openverify/calibration-summary@1"
START_MARKER = "<!-- openverify:calibration-summary:start -->"
END_MARKER = "<!-- openverify:calibration-summary:end -->"

STATUSES: tuple[str, ...] = ("template", "published")
VERDICTS: tuple[str, ...] = (
    "pending",
    "met",
    "missed",
    "invalid",
    "not-measured",
    "reported",
    "kept",
    "revert",
    "identical",
    "not-identical",
    "not-calibrated",
)
METRICS: tuple[str, ...] = ("p95", "median", "mean", "max", "rate", "ratio", "growth")
COMPARISONS: tuple[str, ...] = ("<=", ">=")
UNITS: tuple[str, ...] = ("ms", "s", "per-s", "per-hour", "percent", "ratio", "mib", "count")
TAKE_STATUSES: tuple[str, ...] = ("valid", "invalid")

SUMMARY_KEYS: tuple[str, ...] = (
    "schema",
    "report",
    "workflow",
    "status",
    "method-commit",
    "base",
    "head",
    "machine",
    "rows",
)
MACHINE_KEYS: tuple[str, ...] = ("cpu", "logical-cpus", "memory-gib", "disk-class")
ROW_KEYS: tuple[str, ...] = (
    "id",
    "title",
    "contract",
    "owner",
    "budget",
    "verdict",
    "median",
    "unit",
    "gap",
    "configuration",
    "takes",
)
BUDGET_KEYS: tuple[str, ...] = ("metric", "comparison", "value", "unit")
TAKE_KEYS: tuple[str, ...] = ("value", "status", "load-start", "load-end")


def summary_json(summary: Mapping[str, object]) -> str:
    """The canonical JSON text of a summary: sorted keys, indent 2, a final newline. The example
    contracts/fixtures/calibration/summary.example.json is this text of a declared record."""
    return json.dumps(summary, indent=2, sort_keys=True) + "\n"


def summary_block(summary: Mapping[str, object]) -> str:
    """The block for a report: the markers around a fenced `json` block (sorted keys, indent 2)."""
    return f"{START_MARKER}\n```json\n{summary_json(summary)}```\n{END_MARKER}\n"


def parse_summary(markdown: str) -> dict[str, object]:
    """The summary object of the one block in `markdown`.

    Raises:
        ValueError: when the report has no block, more than one, or one that is not a fenced json
            block holding an object.
    """
    count = markdown.count(START_MARKER)
    if count == 0:
        raise ValueError("the report has no summary block")
    if count > 1:
        raise ValueError("the report has more than one summary block")
    inner = markdown.split(START_MARKER, 1)[1].split(END_MARKER, 1)[0]
    fenced = _FENCED.fullmatch(inner)
    if fenced is None:
        raise ValueError("the summary block is not a fenced json block")
    summary = json.loads(fenced.group(1))
    if not isinstance(summary, dict):
        raise ValueError("the summary block is not a fenced json block holding an object")
    return summary


_FENCED = re.compile(r"\n```json\n(.*)\n```\n", re.DOTALL)
_KEBAB = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
_COMMIT = re.compile(r"[0-9a-f]{40}")
_REPORT = re.compile(r"docs/calibration/[a-z0-9-]+\.md")
_WORKFLOW = re.compile(r"[0-9]+[A-Z]")


def _number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _text(value: object) -> bool:
    return isinstance(value, str) and value != ""


def _keys(where: str, value: Mapping[str, object], expected: tuple[str, ...]) -> list[str]:
    missing = sorted(set(expected) - set(value))
    extra = sorted(set(value) - set(expected))
    if missing or extra:
        return [f"{where} keys: missing {missing}, unexpected {extra}"]
    return []


def _check_budget(where: str, budget: object) -> list[str]:
    if budget is None:
        return []
    if not isinstance(budget, dict):
        return [f"{where}.budget is neither null nor an object"]
    errors = _keys(f"{where}.budget", budget, BUDGET_KEYS)
    if errors:
        return errors
    if budget["metric"] not in METRICS:
        errors.append(f"{where}.budget metric {budget['metric']!r} is not one of {METRICS}")
    if budget["comparison"] not in COMPARISONS:
        errors.append(f"{where}.budget comparison {budget['comparison']!r} is not <= or >=")
    if not _number(budget["value"]):
        errors.append(f"{where}.budget value is not a number")
    if budget["unit"] not in UNITS:
        errors.append(f"{where}.budget unit {budget['unit']!r} is not one of {UNITS}")
    return errors


def _check_take(where: str, take: object) -> list[str]:
    if not isinstance(take, dict):
        return [f"{where} take is not an object"]
    errors = _keys(f"{where} take", take, TAKE_KEYS)
    if errors:
        return errors
    if take["value"] is not None and not _number(take["value"]):
        errors.append(f"{where} take value is neither null nor a number")
    if take["status"] not in TAKE_STATUSES:
        errors.append(f"{where} take status {take['status']!r} is not valid or invalid")
    for key in ("load-start", "load-end"):
        if not _number(take[key]) or float(str(take[key])) < 0:
            errors.append(f"{where} take {key} is not a load average")
    return errors


def _check_row(where: str, row: object) -> list[str]:
    if not isinstance(row, dict):
        return [f"{where} is not an object"]
    errors = _keys(where, row, ROW_KEYS)
    if errors:
        return errors
    for key in ("id", "owner"):
        if not isinstance(row[key], str) or _KEBAB.fullmatch(row[key]) is None:
            errors.append(f"{where}.{key} {row[key]!r} is not a kebab-case name")
    for key in ("title", "contract", "configuration"):
        if not _text(row[key]):
            errors.append(f"{where}.{key} is not a non-empty string")
    errors += _check_budget(where, row["budget"])
    if row["verdict"] not in VERDICTS:
        errors.append(f"{where}.verdict {row['verdict']!r} is not one of {VERDICTS}")
    for key in ("median", "gap"):
        if row[key] is not None and not _number(row[key]):
            errors.append(f"{where}.{key} is neither null nor a number")
    if row["unit"] is not None and row["unit"] not in UNITS:
        errors.append(f"{where}.unit {row['unit']!r} is neither null nor one of {UNITS}")
    takes = row["takes"]
    if not isinstance(takes, list):
        return [*errors, f"{where}.takes is not a list"]
    for index, take in enumerate(takes):
        errors += _check_take(f"{where}.takes[{index}]", take)
    return errors


def _check_machine(machine: object) -> list[str]:
    if machine is None:
        return []
    if not isinstance(machine, dict):
        return ["machine is neither null nor an object"]
    errors = _keys("machine", machine, MACHINE_KEYS)
    if errors:
        return errors
    cpus = machine["logical-cpus"]
    if not _text(machine["cpu"]) or not _text(machine["disk-class"]):
        errors.append("machine cpu and disk-class are non-empty strings")
    if not isinstance(cpus, int) or isinstance(cpus, bool) or cpus < 1:
        errors.append("machine logical-cpus is a whole number of at least 1")
    if not _number(machine["memory-gib"]) or float(str(machine["memory-gib"])) <= 0:
        errors.append("machine memory-gib is a positive number")
    return errors


def check_summary(summary: object) -> list[str]:
    """Every way `summary` breaks the schema's rules, as messages; empty when it holds them."""
    if not isinstance(summary, dict):
        return ["the summary is not an object"]
    errors = _keys("summary", summary, SUMMARY_KEYS)
    if errors:
        return errors
    if summary["schema"] != SUMMARY_SCHEMA:
        errors.append(f"schema {summary['schema']!r} is not {SUMMARY_SCHEMA}")
    if not isinstance(summary["report"], str) or _REPORT.fullmatch(summary["report"]) is None:
        errors.append("report is not a docs/calibration/<name>.md path")
    if not isinstance(summary["workflow"], str) or _WORKFLOW.fullmatch(summary["workflow"]) is None:
        errors.append("workflow is not a Workflow name such as 11D")
    if summary["status"] not in STATUSES:
        errors.append(f"status {summary['status']!r} is not template or published")
    for key in ("method-commit", "base", "head"):
        value = summary[key]
        if value is not None and (not isinstance(value, str) or _COMMIT.fullmatch(value) is None):
            errors.append(f"{key} is neither null nor a full commit id")
    errors += _check_machine(summary["machine"])
    rows = summary["rows"]
    if not isinstance(rows, list) or not rows:
        return [*errors, "rows is not a non-empty list"]
    for index, row in enumerate(rows):
        errors += _check_row(f"rows[{index}]", row)
    return errors


#: Three valid takes make a figure; a scenario gets at most six attempts (discard rule 3).
TAKES_FOR_A_FIGURE = 3
MAX_ATTEMPTS = 6


@dataclass(frozen=True, slots=True)
class TakeRecord:
    """One take as the report lists it: its value (the take's p95, or the row's metric), its status
    and the 1-minute load average at its start and end, the lock wait, and why it is invalid."""

    value: float | None
    status: str
    load_start: float
    load_end: float
    lock_wait_seconds: float = 0.0
    reasons: tuple[str, ...] = ()

    def summary(self) -> dict[str, object]:
        """The take as the summary block's schema holds it."""
        return {
            "value": self.value,
            "status": self.status,
            "load-start": self.load_start,
            "load-end": self.load_end,
        }


def median_of_valid(takes: Sequence[TakeRecord]) -> float | None:
    """The headline: the median of the first three valid takes' values (None with fewer)."""
    values = [t.value for t in takes if t.status == "valid" and t.value is not None]
    if len(values) < TAKES_FOR_A_FIGURE:
        return None
    return float(statistics.median(values[:TAKES_FOR_A_FIGURE]))


def verdict(
    budget: Mapping[str, object] | None, takes: Sequence[TakeRecord]
) -> tuple[str, float | None, float | None]:
    """The row's verdict, median and gap by the method's rules: `met` or `missed` (gap = median
    minus the budget) for a budgeted row with three valid takes, `reported` without a budget,
    `invalid` when every attempt so far was invalid, `not-measured` when six attempts gave fewer
    than three valid takes, else `pending`."""
    median = median_of_valid(takes)
    if median is None:
        if len(takes) >= MAX_ATTEMPTS:
            return "not-measured", None, None
        if takes and all(t.status == "invalid" for t in takes):
            return "invalid", None, None
        return "pending", None, None
    if budget is None:
        return "reported", median, None
    value = float(str(budget["value"]))
    met = median <= value if budget["comparison"] == "<=" else median >= value
    return ("met" if met else "missed"), median, round(median - value, 3)


def summary_row(  # noqa: PLR0913 - the schema's row members, keyword-only
    *,
    id: str,
    title: str,
    contract: str,
    owner: str,
    budget: Mapping[str, object] | None,
    unit: str | None,
    configuration: str,
    takes: Sequence[TakeRecord],
) -> dict[str, object]:
    """A row of the summary block, its verdict computed from its takes."""
    result, median, gap = verdict(budget, takes)
    return {
        "id": id,
        "title": title,
        "contract": contract,
        "owner": owner,
        "budget": None if budget is None else dict(budget),
        "verdict": result,
        "median": median,
        "unit": unit,
        "gap": gap,
        "configuration": configuration,
        "takes": [t.summary() for t in takes],
    }


def _cell(value: object) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:g}"
    return str(value).replace("|", "\\|")


def results_table(rows: Sequence[Mapping[str, object]]) -> str:
    """A results table of the report: one line per row with its verdict, then every take listed
    with its value, status and loads (a row's takes are summary-block takes)."""
    lines = [
        "| Row | Configuration | Budget | Median | Gap | Verdict |"
        " Takes (value, status, load start -> end) |",
        "|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        budget = row.get("budget")
        if isinstance(budget, Mapping):
            value = _cell(budget["value"])
            budget_text = f"{budget['metric']} {budget['comparison']} {value} {budget['unit']}"
        else:
            budget_text = "none"
        takes = row.get("takes")
        take_text = "; ".join(
            f"{_cell(t.get('value'))} {t.get('status')} "
            f"({_cell(t.get('load-start'))} -> {_cell(t.get('load-end'))})"
            for t in (takes if isinstance(takes, list) else [])
            if isinstance(t, Mapping)
        )
        unit = row.get("unit")
        median = row.get("median")
        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{row.get('id')}`",
                    _cell(row.get("configuration")),
                    budget_text,
                    "-" if median is None else f"{_cell(median)} {unit}",
                    _cell(row.get("gap")),
                    _cell(row.get("verdict")),
                    take_text or "none",
                ]
            )
            + " |"
        )
    return "\n".join(lines) + "\n"


def fairness_ratio(idle: Sequence[TakeRecord], flood: Sequence[TakeRecord]) -> float | None:
    """C269.2: the victim's p95 under the flood over its idle p95 (each the median of three valid
    takes); None until both have three."""
    under, alone = median_of_valid(flood), median_of_valid(idle)
    if under is None or alone is None or alone <= 0:
        return None
    return round(under / alone, 3)


#: The reason a flood take is invalid when the flooder never waited for a slot (Workflow 11D
#: fix-11d, P001): C251.5 is about the cap, and a flood below it does not exercise it.
FLOOD_UNDER_CAP = "the flood never reached the cap: no flooder run waited for admission"


def flood_reached_cap(admissions: Sequence[Mapping[str, object]], environment: str) -> bool:
    """Whether a flood take tested the cap: some run of the flooding environment waited for a slot
    (`sampler.py admissions` over the take's window)."""
    return any(
        row.get("environment") == environment and int(str(row.get("waited", 0))) > 0
        for row in admissions
    )


#: The soaked containers whose memory growth the soak judges (C269.3).
SOAKED = ("api", "worker", "flow", "dashboard", "vision")


def memory_growth(samples: Path, *, warmup_seconds: float) -> dict[str, float]:
    """C269.3: each soaked container's growth, in percent, from its memory at the end of the warm-up
    to its largest after it (the API, the worker, the flow, the console and vision)."""
    rows = [
        json.loads(line)
        for line in samples.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not rows:
        return {}
    start = float(rows[0]["at"]) + warmup_seconds
    after = [row for row in rows if float(row["at"]) >= start]
    if not after:
        return {}
    growth: dict[str, float] = {}
    for name, base in after[0].get("memory_mib", {}).items():
        if not any(name.endswith(f"-{service}-1") for service in SOAKED) or base <= 0:
            continue
        largest = max(float(row.get("memory_mib", {}).get(name, base)) for row in after)
        growth[name] = round((largest - float(base)) / float(base) * 100.0, 2)
    return growth


# -------------------------------------------------------------------------------- CLI ----


def load_takes(directory: Path) -> list[dict[str, object]]:
    """Every take file (`*.take.json`, as `run.py take` writes them) in `directory`, by name."""
    takes = []
    for path in sorted(directory.glob("*.take.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            takes.append(data)
    return takes


def _reasons(value: object) -> tuple[str, ...]:
    return tuple(str(r) for r in value) if isinstance(value, list) else ()


def rows_from_takes(takes: Sequence[Mapping[str, object]]) -> list[dict[str, object]]:
    """Groups take files by scenario and configuration into summary rows, in first-seen order."""
    groups: dict[tuple[str, str], list[Mapping[str, object]]] = {}
    for take in takes:
        key = (str(take["scenario"]), str(take.get("configuration", "default")))
        groups.setdefault(key, []).append(take)
    rows = []
    for (scenario, configuration), group in groups.items():
        first = group[0]
        records = [
            TakeRecord(
                value=None if t.get("value") is None else float(str(t["value"])),
                status="valid" if t.get("valid") else "invalid",
                load_start=float(str(t.get("load-start", 0))),
                load_end=float(str(t.get("load-end", 0))),
                lock_wait_seconds=float(str(t.get("lock-wait-seconds", 0))),
                reasons=_reasons(t.get("invalid-reasons")),
            )
            for t in group
        ]
        budget = first.get("budget")
        rows.append(
            summary_row(
                id=scenario,
                title=str(first.get("title", scenario)),
                contract=str(first.get("contract", "C269.1")),
                owner=str(first.get("owner", "calibration-load-11d")),
                budget=budget if isinstance(budget, Mapping) else None,
                unit=str(first.get("unit", "ms")),
                configuration=configuration,
                takes=records,
            )
        )
    return rows


def build_report(takes_dir: Path, *, title: str, report_path: str, workflow: str = "11D") -> str:
    """A report from a directory of take files: its results table and its summary block (status
    template, since a smoke run or a partial set is not a published calibration)."""
    rows = rows_from_takes(load_takes(takes_dir))
    summary = {
        "schema": SUMMARY_SCHEMA,
        "report": report_path,
        "workflow": workflow,
        "status": "template",
        "method-commit": None,
        "base": None,
        "head": None,
        "machine": None,
        "rows": rows,
    }
    errors = check_summary(summary)
    if errors:
        raise ValueError("; ".join(errors))
    return (
        f"# {title}\n\n## Results\n\n{results_table(rows)}\n"
        f"## Summary block\n\n{summary_block(summary)}"
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="report.py")
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--takes", type=Path, required=True)
    build.add_argument("--out", type=Path, required=True)
    build.add_argument("--title", default="Load harness smoke run")
    build.add_argument("--report-path", default="docs/calibration/load-phase11.md")
    check = sub.add_parser("check")
    check.add_argument("report", type=Path)
    args = parser.parse_args(argv)
    if args.command == "build":
        args.out.write_text(
            build_report(args.takes, title=args.title, report_path=args.report_path),
            encoding="utf-8",
        )
        print(f"wrote {args.out}")
        return 0
    errors = check_summary(parse_summary(args.report.read_text(encoding="utf-8")))
    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
