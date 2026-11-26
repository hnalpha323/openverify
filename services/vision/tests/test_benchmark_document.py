"""tools/benchmark_document.py: the Workflow 5B budget benchmark (a 3-page born-digital PDF).

The bill goes through ``/v1/analyze/document`` of the app in process and a real guarded child;
the tests use the fake OCR models of ``ocr_fakes``, so no weight is needed. The real-model run
is recorded in the evidence file (``docs/tdd/phase5-vision-document.tdd.md``).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from benchmark_document import (
    BUDGET_SECONDS,
    DEFAULT_RUNS,
    DENSE_BUDGET_SECONDS,
    STAGES,
    Run,
    cpu_model,
    dense_document,
    main,
    measure_runs,
    render,
    sample_document,
    summarize,
    timed_stages,
)
from ocr_fakes import engine as fake_ocr_engine
from openverify_vision import document_analysis
from openverify_vision.guarded.pdf_measure import analyze
from openverify_vision.guarded.runner import GuardedWorkerError


def test_the_budget_is_the_plans() -> None:
    assert BUDGET_SECONDS == 4.0
    assert DEFAULT_RUNS == 10
    assert [name for name, _, _ in STAGES] == [
        "guarded child (PDFium, pypdf, scan, render)",
        "ocr (text-layer boxes)",
        "ocr (whole pages)",
        "image forensics",
    ]


def test_the_sample_is_a_three_page_born_digital_bill() -> None:
    header, frames = analyze(sample_document())
    assert header["page_count"] == 3
    assert len(frames) == 3
    for page in header["pages"]:
        visible = [line for line in page["text_layer"] if line["visible"]]
        assert len(visible) >= 15
        assert page["embedded_jpeg"] is None
    texts = [line["text"] for line in header["pages"][0]["text_layer"]]
    assert "Amount due: 48.20" in texts


def test_the_dense_sample_is_four_analysed_pages_of_600_visible_lines() -> None:
    # Workflow 5C review P009: the most the text layer reports, and the OCR's whole budget.
    header, _ = analyze(dense_document())
    assert header["page_count"] == 4
    assert [sum(line["visible"] for line in page["text_layer"]) for page in header["pages"]] == [
        600
    ] * 4
    assert DENSE_BUDGET_SECONDS == 10.0


def test_main_benchmarks_the_dense_sample_against_its_own_budget(tmp_path: Path) -> None:
    engine, _, _ = fake_ocr_engine()
    out = tmp_path / "dense.json"
    assert main(["--sample", "dense", "--runs", "1", "--json", str(out)], reader=engine) == 0
    numbers = json.loads(out.read_text(encoding="utf-8"))
    assert (numbers["sample"], numbers["pages"], numbers["budget_s"]) == ("dense", 4, 10.0)


def test_cpu_model_reads_the_model_name(tmp_path: Path) -> None:
    info = tmp_path / "cpuinfo"
    info.write_text("processor\t: 0\nmodel name\t: Synthetic CPU 9000\n", encoding="utf-8")
    assert cpu_model(info) == "Synthetic CPU 9000"
    assert cpu_model(tmp_path / "missing")  # the platform's answer, whatever it is


def test_timed_stages_times_each_call_and_restores_the_stage() -> None:
    original = document_analysis.run_guarded
    ticks = iter([0.0, 0.25])
    spent: dict[str, float] = {}
    with timed_stages(spent, clock=lambda: next(ticks)):
        assert document_analysis.run_guarded is not original
        with pytest.raises(GuardedWorkerError):
            document_analysis.run_guarded("no_such_task")
    assert document_analysis.run_guarded is original
    assert spent == {"guarded child (PDFium, pypdf, scan, render)": 0.25}


def test_measure_runs_and_summarize_take_the_medians() -> None:
    ticks = iter(float(t) for t in range(100))
    runs = measure_runs(lambda: None, 3, clock=lambda: next(ticks))
    assert [run.total for run in runs] == [1.0, 1.0, 1.0]
    summary = summarize(
        [Run(1.0, {"ocr (text-layer boxes)": 0.6}), Run(5.0, {}), Run(3.0, {})],
        cpu="Synthetic CPU",
        logical_cpus=4,
        characters=2600,
        budget=4.0,
    )
    assert (summary.median, summary.minimum, summary.maximum) == (3.0, 1.0, 5.0)
    assert summary.stages == {"ocr (text-layer boxes)": 0.0}
    assert summary.within_budget is True
    text = render(summary)
    assert "within the 4.00 s budget" in text
    assert "2600 characters" in text
    assert summary.as_json()["ocr_characters"] == 2600


def test_main_reports_the_median_and_the_stages(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    engine, _, _ = fake_ocr_engine()
    out = tmp_path / "bench.json"
    assert main(["--runs", "2", "--json", str(out)], reader=engine) == 0
    printed = capsys.readouterr().out
    assert "Document analysis benchmark" in printed
    assert "guarded child" in printed
    numbers = json.loads(out.read_text(encoding="utf-8"))
    assert numbers["runs"] == 2
    assert (numbers["sample"], numbers["pages"], numbers["budget_s"]) == ("bill", 3, 4.0)


def test_main_fails_over_budget_only_when_asked() -> None:
    engine, _, _ = fake_ocr_engine()
    assert main(["--runs", "1", "--budget", "0.000001"], reader=engine) == 0
    assert main(["--runs", "1", "--budget", "0.000001", "--enforce"], reader=engine) == 1


def test_main_without_the_text_models_refuses_to_report_a_budget(
    capsys: pytest.CaptureFixture[str],
) -> None:
    engine, detector, _ = fake_ocr_engine()
    detector.missing = True
    assert main(["--runs", "1"], reader=engine) == 1
    assert "text models are not available" in capsys.readouterr().err
