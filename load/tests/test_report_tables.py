"""The report's tables and verdicts by the method's rules (C268.5, C268.7): the median of three
valid take p95s, `met` or `missed` with its gap, `reported`, `invalid`, `not-measured`, and a report
built from take files whose summary block holds the schema."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import report
from report import MAX_ATTEMPTS, TAKES_FOR_A_FIGURE, TakeRecord, median_of_valid, verdict

BUDGET = {"metric": "p95", "comparison": "<=", "value": 150, "unit": "ms"}


def valid(value: float) -> TakeRecord:
    return TakeRecord(value, "valid", 1.0, 2.0)


INVALID = TakeRecord(None, "invalid", 1.0, 5.0, reasons=("schedule lag",))


def test_the_rules_constants() -> None:
    assert TAKES_FOR_A_FIGURE == 3
    assert MAX_ATTEMPTS == 6


def test_the_headline_is_the_median_of_three_valid_takes() -> None:
    assert median_of_valid([valid(90.0), INVALID, valid(120.0), valid(100.0)]) == 100.0
    assert median_of_valid([valid(90.0), valid(91.0)]) is None
    assert median_of_valid([valid(1.0), valid(2.0), valid(3.0), valid(100.0)]) == 2.0


def test_met_and_missed_with_the_gap() -> None:
    assert verdict(BUDGET, [valid(90.0), valid(100.0), valid(110.0)]) == ("met", 100.0, -50.0)
    assert verdict(BUDGET, [valid(160.0), valid(170.0), valid(180.0)]) == ("missed", 170.0, 20.0)
    floor = {"metric": "rate", "comparison": ">=", "value": 10000, "unit": "per-hour"}
    assert verdict(floor, [valid(9000.0)] * 3)[0] == "missed"
    assert verdict(floor, [valid(12000.0)] * 3)[0] == "met"


def test_reported_invalid_pending_and_not_measured() -> None:
    assert verdict(None, [valid(5.0)] * 3) == ("reported", 5.0, None)
    assert verdict(BUDGET, [INVALID, INVALID]) == ("invalid", None, None)
    assert verdict(BUDGET, [valid(1.0)]) == ("pending", None, None)
    assert verdict(BUDGET, []) == ("pending", None, None)
    assert verdict(BUDGET, [INVALID] * 4 + [valid(1.0)] * 2) == ("not-measured", None, None)


def test_a_summary_row_holds_the_schema() -> None:
    row = report.summary_row(
        id="api-reads",
        title="API reads at 100 requests/s",
        contract="C269.1",
        owner="calibration-load-11d",
        budget=BUDGET,
        unit="ms",
        configuration="default",
        takes=[valid(90.0), INVALID, valid(100.0), valid(110.0)],
    )
    assert row["verdict"] == "met"
    assert row["gap"] == -50.0
    takes = row["takes"]
    assert isinstance(takes, list)
    assert takes[1] == {"value": None, "status": "invalid", "load-start": 1.0, "load-end": 5.0}
    assert report._check_row("rows[0]", row) == []


def test_the_results_table_lists_every_take() -> None:
    row = report.summary_row(
        id="api-reads",
        title="x",
        contract="C269.1",
        owner="calibration-load-11d",
        budget=BUDGET,
        unit="ms",
        configuration="ceiling 200",
        takes=[valid(90.0), INVALID, valid(100.0), valid(110.0)],
    )
    reported = report.summary_row(
        id="lists-match",
        title="y",
        contract="7B",
        owner="calibration-load-11d",
        budget=None,
        unit=None,
        configuration="a|b",
        takes=[],
    )
    table = report.results_table([row, reported])
    lines = table.splitlines()
    assert lines[0].startswith("| Row | Configuration | Budget |")
    assert "`api-reads` | ceiling 200 | p95 <= 150 ms | 100 ms | -50 | met |" in lines[2]
    assert "90 valid (1 -> 2); - invalid (1 -> 5); 100 valid" in lines[2]
    assert "| `lists-match` | a\\|b | none | - | - | pending | none |" in lines[3]


def write_take(directory: Path, name: str, **fields: object) -> None:
    base = {
        "scenario": "api-reads",
        "configuration": "default",
        "title": "API reads",
        "contract": "C269.1",
        "owner": "calibration-load-11d",
        "budget": BUDGET,
        "unit": "ms",
        "valid": True,
        "value": 100.0,
        "load-start": 1.0,
        "load-end": 2.0,
        "lock-wait-seconds": 0,
        "invalid-reasons": [],
    }
    base.update(fields)
    (directory / f"{name}.take.json").write_text(json.dumps(base), encoding="utf-8")


def test_a_report_from_take_files(tmp_path: Path) -> None:
    write_take(tmp_path, "01", value=90.0)
    write_take(tmp_path, "02", value=None, valid=False, **{"invalid-reasons": ["lag"]})
    write_take(tmp_path, "03", value=100.0)
    write_take(tmp_path, "04", value=110.0)
    write_take(tmp_path, "05", scenario="lists-match", budget=None, value=40.0)
    (tmp_path / "ignored.json").write_text("{}", encoding="utf-8")
    (tmp_path / "list.take.json").write_text("[]", encoding="utf-8")
    text = report.build_report(
        tmp_path, title="Smoke", report_path="docs/calibration/load-phase11.md"
    )
    summary = report.parse_summary(text)
    assert report.check_summary(summary) == []
    rows = summary["rows"]
    assert isinstance(rows, list)
    assert [(r["id"], r["verdict"]) for r in rows] == [
        ("api-reads", "met"),
        ("lists-match", "pending"),
    ]
    assert text.startswith("# Smoke\n")


def test_the_command_line(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    write_take(tmp_path, "01")
    out = tmp_path / "report.md"
    assert report.main(["build", "--takes", str(tmp_path), "--out", str(out)]) == 0
    assert report.main(["check", str(out)]) == 0
    broken = tmp_path / "broken.md"
    broken.write_text(
        out.read_text(encoding="utf-8").replace('"status": "template"', '"status": "draft"'),
        encoding="utf-8",
    )
    assert report.main(["check", str(broken)]) == 1
    assert "status 'draft'" in capsys.readouterr().out


def test_a_report_with_a_broken_row_is_refused(tmp_path: Path) -> None:
    write_take(tmp_path, "01", owner="Not Kebab")
    with pytest.raises(ValueError, match="kebab-case"):
        report.build_report(tmp_path, title="x", report_path="docs/calibration/load-phase11.md")


def test_the_fairness_ratio_is_flood_over_idle() -> None:
    idle = [valid(100.0), valid(110.0), valid(120.0)]
    flood = [valid(200.0), valid(220.0), INVALID, valid(260.0)]
    assert report.fairness_ratio(idle, flood) == pytest.approx(2.0)
    assert report.fairness_ratio(idle, flood[:1]) is None


def test_memory_growth_from_minute_five_to_its_largest(tmp_path: Path) -> None:
    samples = tmp_path / "samples.jsonl"
    lines = [
        {
            "at": 1000.0,
            "memory_mib": {"openverify-load-api-1": 300.0, "openverify-load-worker-1": 500.0},
        },
        {
            "at": 1300.0,
            "memory_mib": {"openverify-load-api-1": 400.0, "openverify-load-worker-1": 500.0},
        },
        {
            "at": 1600.0,
            "memory_mib": {"openverify-load-api-1": 420.0, "openverify-load-worker-1": 540.0},
        },
        {
            "at": 1700.0,
            "memory_mib": {"openverify-load-api-1": 410.0, "openverify-load-postgres-1": 9000.0},
        },
    ]
    samples.write_text("\n".join(json.dumps(line) for line in lines) + "\n", encoding="utf-8")
    growth = report.memory_growth(samples, warmup_seconds=300.0)
    assert growth == {
        "openverify-load-api-1": pytest.approx(5.0),
        "openverify-load-worker-1": pytest.approx(8.0),
    }
    assert report.memory_growth(samples, warmup_seconds=10_000.0) == {}


def test_a_flood_take_counts_only_when_the_flooder_waited_for_a_slot() -> None:
    """P001: C251.5 is tested only when the flood reaches the cap: some run of the flooding
    environment waited for admission. A flood the worker settles as fast as it comes proves
    nothing about fairness, whatever its ratio."""
    rows = [
        {"environment": "env_flood", "runs": 500, "waited": 312, "max_wait_ms": 21000.0},
        {"environment": "env_victim", "runs": 150, "waited": 0, "max_wait_ms": 0.0},
    ]
    assert report.flood_reached_cap(rows, "env_flood") is True
    assert report.flood_reached_cap(rows, "env_victim") is False
    assert report.flood_reached_cap(rows, "env_absent") is False
    assert report.FLOOD_UNDER_CAP.startswith("the flood never reached the cap")
