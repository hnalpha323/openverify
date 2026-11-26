"""A take's figures and its validity by the method's rules (C268.5, C268.6)."""

from __future__ import annotations

import pytest

from driver import Outcome
from driver.stats import (
    ERROR_BUDGET,
    HISTOGRAM_BOUNDS_MS,
    SATURATED_CPU_SHARE,
    histogram,
    percentile,
    status_label,
    summarise,
    unit_durations_ms,
    unit_server_durations_ms,
)

OK = frozenset({200})


def at(
    planned: float,
    latency: float,
    status: int | None = 200,
    *,
    lag_ms: float = 0.0,
    step: str = "read",
) -> Outcome:
    return Outcome(step, status, planned, planned + lag_ms / 1000.0, latency)


def test_the_method_s_constants() -> None:
    assert ERROR_BUDGET == 0.001
    assert SATURATED_CPU_SHARE == 0.9
    assert HISTOGRAM_BOUNDS_MS[0] == 1


def test_nearest_rank_percentiles() -> None:
    values = [float(v) for v in range(1, 101)]
    assert percentile(values, 0.95) == 95.0
    assert percentile(values, 0.5) == 50.0
    assert percentile(values, 1.0) == 100.0
    assert percentile([], 0.5) is None
    with pytest.raises(ValueError, match="fraction"):
        percentile(values, 0.0)


def test_the_histogram_lists_every_bucket() -> None:
    buckets = dict(histogram([0.5, 1.0, 3.0, 40000.0]))
    assert buckets["<=1"] == 2
    assert buckets["<=5"] == 1
    assert buckets[">30000"] == 1
    assert len(buckets) == len(HISTOGRAM_BOUNDS_MS) + 1


def test_a_valid_take_over_its_window_and_expected_statuses() -> None:
    outcomes = [at(0.5, 900.0)] + [at(1.0 + i / 100, float(i + 1)) for i in range(100)]
    summary = summarise(outcomes, OK, cpu_share=0.2, warmup_seconds=1.0)
    assert summary.requests == 100
    assert summary.p95_ms == 95.0
    assert summary.p50_ms == 50.0
    assert summary.max_ms == 100.0
    assert summary.statuses == {"200": 100}
    assert summary.valid
    assert summary.invalid_reasons == ()


def test_unexpected_outcomes_at_the_error_budget_invalidate_a_take() -> None:
    outcomes = [at(i / 1000, 5.0) for i in range(999)] + [at(1.0, 5.0, None)]
    summary = summarise(outcomes, OK, cpu_share=0.1)
    assert summary.unexpected == 1
    assert summary.unexpected_share == pytest.approx(0.001)
    assert not summary.valid
    assert "error budget" in summary.invalid_reasons[0]
    assert summary.statuses == {"200": 999, "error": 1}
    below = summarise([*outcomes[:-1], at(1.0, 5.0), at(1.1, 5.0, 500)], OK, cpu_share=0.1)
    assert below.unexpected == 1
    assert below.valid


def test_the_lag_bound_and_a_saturated_generator_invalidate_a_take() -> None:
    lagging = summarise([at(0.0, 1.0, lag_ms=150.0)], OK, cpu_share=0.1)
    assert not lagging.valid
    assert "schedule lag" in lagging.invalid_reasons[0]
    saturated = summarise([at(0.0, 1.0)], OK, cpu_share=0.95)
    assert "saturated" in saturated.invalid_reasons[0]
    assert not summarise([], OK, cpu_share=0.0).valid


def test_a_follow_up_s_wait_is_not_schedule_lag() -> None:
    follow = Outcome("upload", 200, 2.0, 2.5, 10.0, unit=1, follow_up=True)
    assert summarise([at(0.0, 1.0), follow], OK, cpu_share=0.1).valid


def test_one_step_s_figures_with_the_take_s_validity() -> None:
    outcomes = [
        at(0.0, 10.0, step="start"),
        at(0.1, 300.0, step="upload"),
        at(0.2, 5.0, 503, step="start"),
    ]
    upload = summarise(outcomes, OK, cpu_share=0.1, step="upload")
    assert upload.requests == 1
    assert upload.p95_ms == 300.0
    assert not upload.valid  # 1 unexpected of 3 in the window


def test_unit_durations_from_first_plan_to_the_last_step_s_success() -> None:
    outcomes = [
        Outcome("submit", 202, 1.0, 1.0, 50.0, unit=1),
        Outcome("poll", 200, 2.0, 2.0, 20.0, unit=1, follow_up=True),
        Outcome("done", 200, 3.0, 3.0, 20.0, unit=1, follow_up=True),
        Outcome("submit", 202, 1.5, 1.5, 50.0, unit=2),
        Outcome("done", 500, 4.0, 4.0, 20.0, unit=2, follow_up=True),
    ]
    assert unit_durations_ms(outcomes, "done") == pytest.approx([2020.0])


def test_status_labels() -> None:
    assert status_label(None) == "error"
    assert status_label(429) == "429"


def test_unit_server_durations_take_each_unit_s_first_server_time() -> None:
    """P001: the fairness victim's time is the server's own (the report's created-at to
    completed-at), one per unit that settled with a success, never a poll's interval."""
    outcomes = [
        Outcome("victim", 201, 0.0, 0.0, 5.0, unit=1),
        Outcome("settled", 200, 2.0, 2.0, 3.0, unit=1, follow_up=True, server_ms=None),
        Outcome("settled", 200, 4.0, 4.0, 3.0, unit=1, follow_up=True, server_ms=2150.0),
        Outcome("victim", 201, 1.0, 1.0, 5.0, unit=2),
        Outcome("settled", 200, 3.0, 3.0, 3.0, unit=2, follow_up=True, server_ms=310.0),
        Outcome("victim", 201, 1.5, 1.5, 5.0, unit=3),
        Outcome("settled", 500, 3.5, 3.5, 3.0, unit=3, follow_up=True, server_ms=99.0),
    ]
    assert unit_server_durations_ms(outcomes, "settled") == [310.0, 2150.0]
