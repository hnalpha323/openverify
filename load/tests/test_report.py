"""The summary block (Workflow 11D Stage 1a amendment 14; rule 24's exported file).

The example contracts/fixtures/calibration/summary.example.json is what `summary_json` renders from
the record this file declares: the test fails when they differ, and writes the file only under
UPDATE_CONTRACT_FIXTURES=1. The three calibration reports' blocks must hold the schema's rules, and
`check_summary`'s constants are held equal to the schema's.
"""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any

import pytest

import report

REPO = Path(__file__).resolve().parents[2]
SCHEMA = REPO / "contracts" / "fixtures" / "calibration" / "summary.schema.json"
EXAMPLE = REPO / "contracts" / "fixtures" / "calibration" / "summary.example.json"
REPORTS = [
    REPO / "docs" / "calibration" / f"{name}-phase11.md" for name in ("load", "watchlist", "lists")
]


def take(value: float | None, status: str, start: float, end: float) -> dict[str, Any]:
    return {"value": value, "status": status, "load-start": start, "load-end": end}


def declared_record() -> dict[str, Any]:
    """A synthetic published summary: a budget met, a budget missed and a reported row."""
    return {
        "schema": "openverify/calibration-summary@1",
        "report": "docs/calibration/example-phase11.md",
        "workflow": "11D",
        "status": "published",
        "method-commit": "a" * 40,
        "base": "b" * 40,
        "head": "c" * 40,
        "machine": {
            "cpu": "Synthetic CPU",
            "logical-cpus": 12,
            "memory-gib": 31.3,
            "disk-class": "SATA SSD",
        },
        "rows": [
            {
                "id": "api-reads",
                "title": "API reads at 100 requests/s",
                "contract": "C269.1",
                "owner": "calibration-load-11d",
                "budget": {"metric": "p95", "comparison": "<=", "value": 150, "unit": "ms"},
                "verdict": "met",
                "median": 92.5,
                "unit": "ms",
                "gap": -57.5,
                "configuration": "default",
                "takes": [
                    take(90.25, "valid", 1.5, 3.25),
                    take(92.5, "valid", 1.75, 3.5),
                    take(97.75, "valid", 2.25, 3.75),
                    take(None, "invalid", 2.5, 4.25),
                ],
            },
            {
                "id": "rescreen-1000",
                "title": "Re-screen, 1,000 changed entries and 200,000 subjects",
                "contract": "C271",
                "owner": "calibration-matcher-11d",
                "budget": {"metric": "median", "comparison": "<=", "value": 60, "unit": "s"},
                "verdict": "missed",
                "median": 71.25,
                "unit": "s",
                "gap": 11.25,
                "configuration": "default",
                "takes": [
                    take(70.75, "valid", 1.75, 1.5),
                    take(71.25, "valid", 2.25, 2.25),
                    take(71.5, "valid", 2.0, 2.0),
                ],
            },
            {
                "id": "process-memory",
                "title": "Resident memory of the worker at rest",
                "contract": "Workflow 7A (a)",
                "owner": "calibration-load-11d",
                "budget": None,
                "verdict": "reported",
                "median": 512.25,
                "unit": "mib",
                "gap": None,
                "configuration": "default sources",
                "takes": [],
            },
        ],
    }


def test_the_committed_example_is_the_declared_record_rendered() -> None:
    text = report.summary_json(declared_record())
    if os.environ.get("UPDATE_CONTRACT_FIXTURES") == "1":
        EXAMPLE.write_text(text, encoding="utf-8")
    assert EXAMPLE.read_text(encoding="utf-8") == text


def test_the_example_holds_the_schema_rules() -> None:
    assert report.check_summary(json.loads(EXAMPLE.read_text(encoding="utf-8"))) == []


def test_the_block_round_trips_through_a_report() -> None:
    record = declared_record()
    markdown = f"# A report\n\n## Summary block\n\n{report.summary_block(record)}"
    assert report.summary_block(record).startswith(report.START_MARKER + "\n```json\n")
    assert report.summary_block(record).endswith("```\n" + report.END_MARKER + "\n")
    assert report.parse_summary(markdown) == record


@pytest.mark.parametrize("path", REPORTS, ids=lambda path: path.name)
def test_each_calibration_report_carries_one_valid_block(path: Path) -> None:
    summary = report.parse_summary(path.read_text(encoding="utf-8"))
    assert report.check_summary(summary) == []
    assert summary["report"] == str(path.relative_to(REPO))
    assert summary["workflow"] == "11D"


def test_a_report_without_a_block_or_with_two_is_refused() -> None:
    block = report.summary_block(declared_record())
    with pytest.raises(ValueError, match="no summary block"):
        report.parse_summary("# Nothing here\n")
    with pytest.raises(ValueError, match="more than one summary block"):
        report.parse_summary(block + block)
    with pytest.raises(ValueError, match="not a fenced json block"):
        report.parse_summary(f"{report.START_MARKER}\n{{}}\n{report.END_MARKER}\n")


def broken(path: tuple[Any, ...], value: Any) -> dict[str, Any]:
    record = copy.deepcopy(declared_record())
    target: Any = record
    for key in path[:-1]:
        target = target[key]
    if value is DELETE:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    return record


DELETE = object()


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("schema",), "openverify/calibration-summary@2", "schema"),
        (("status",), "draft", "status"),
        (("report",), "docs/other/report.md", "report"),
        (("workflow",), "eleven", "workflow"),
        (("method-commit",), "abc", "method-commit"),
        (("head",), 7, "head"),
        (("machine", "logical-cpus"), 0, "machine"),
        (("machine", "cpu"), DELETE, "machine"),
        (("rows",), [], "rows"),
        (("rows", 0, "verdict"), "passed", "verdict"),
        (("rows", 0, "id"), "Api_Reads", "id"),
        (("rows", 0, "owner"), "", "owner"),
        (("rows", 0, "unit"), "minutes", "unit"),
        (("rows", 0, "median"), "fast", "median"),
        (("rows", 0, "budget", "metric"), "p90", "budget"),
        (("rows", 0, "budget", "comparison"), "<", "budget"),
        (("rows", 0, "budget", "value"), "150", "budget"),
        (("rows", 0, "takes", 0, "status"), "discarded", "take"),
        (("rows", 0, "takes", 0, "load-start"), -1, "take"),
        (("rows", 0, "configuration"), "", "configuration"),
        (("rows", 0, "title"), DELETE, "keys"),
        (("rows", 0, "extra"), 1, "keys"),
        (("extra",), 1, "keys"),
    ],
)
def test_check_summary_names_each_broken_rule(
    path: tuple[Any, ...], value: Any, message: str
) -> None:
    errors = report.check_summary(broken(path, value))
    assert errors != []
    assert any(message in error for error in errors), errors


def test_check_summary_refuses_what_is_not_an_object() -> None:
    assert report.check_summary([]) == ["the summary is not an object"]


def test_the_constants_are_the_schema_s() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    row = schema["$defs"]["row"]
    budget = row["properties"]["budget"]["oneOf"][1]
    take_schema = row["properties"]["takes"]["items"]
    machine = schema["properties"]["machine"]["oneOf"][1]
    assert schema["properties"]["schema"]["const"] == report.SUMMARY_SCHEMA
    assert tuple(schema["required"]) == report.SUMMARY_KEYS
    assert tuple(schema["properties"]["status"]["enum"]) == report.STATUSES
    assert tuple(row["required"]) == report.ROW_KEYS
    assert tuple(row["properties"]["verdict"]["enum"]) == report.VERDICTS
    assert tuple(budget["required"]) == report.BUDGET_KEYS
    assert tuple(budget["properties"]["metric"]["enum"]) == report.METRICS
    assert tuple(budget["properties"]["comparison"]["enum"]) == report.COMPARISONS
    assert tuple(schema["$defs"]["unit"]["enum"]) == report.UNITS
    assert tuple(take_schema["required"]) == report.TAKE_KEYS
    assert tuple(take_schema["properties"]["status"]["enum"]) == report.TAKE_STATUSES
    assert tuple(machine["required"]) == report.MACHINE_KEYS
