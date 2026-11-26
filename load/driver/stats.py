"""A take's figures and its validity by the method's rules (C268.5, C268.6; docs/calibration/
load-phase11.md, "Expected statuses, the error budget and discards" and "The core split").

Percentiles are nearest-rank over the measured window's expected statuses only; the window starts
after the warm-up. A take is invalid when its unexpected outcomes reach 0.1% of its requests, its
schedule lag breaks the bound, or its generator averaged above 90% of its CPU.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from driver.interface import SCHEDULE_LAG_MAX_MS, SCHEDULE_LAG_P99_MS, Outcome

#: The error budget: unexpected outcomes at or above this share of a take's requests invalidate it.
ERROR_BUDGET = 0.001
#: A generator averaging above this share of its logical CPU cannot hold its schedule.
SATURATED_CPU_SHARE = 0.9
#: A 2xx status: its hundreds digit.
SUCCESS_CLASS = 2
#: The latency histogram's upper bounds, in milliseconds (the last bucket is open).
HISTOGRAM_BOUNDS_MS: tuple[float, ...] = (
    1,
    2,
    5,
    10,
    20,
    50,
    100,
    150,
    200,
    300,
    500,
    750,
    1000,
    1500,
    2000,
    3000,
    5000,
    10000,
    30000,
)


def percentile(values: Sequence[float], fraction: float) -> float | None:
    """The nearest-rank percentile of `values` (None when empty); `fraction` in (0, 1]."""
    if not 0 < fraction <= 1:
        raise ValueError("a percentile's fraction is in (0, 1]")
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def histogram(values: Iterable[float]) -> list[tuple[str, int]]:
    """Counts per bucket, labelled by upper bound in ms ("<=1" ... ">30000"), each one listed."""
    counts = [0] * (len(HISTOGRAM_BOUNDS_MS) + 1)
    for value in values:
        index = next((i for i, b in enumerate(HISTOGRAM_BOUNDS_MS) if value <= b), None)
        counts[len(HISTOGRAM_BOUNDS_MS) if index is None else index] += 1
    labels = [f"<={bound:g}" for bound in HISTOGRAM_BOUNDS_MS] + [f">{HISTOGRAM_BOUNDS_MS[-1]:g}"]
    return list(zip(labels, counts, strict=True))


def status_label(status: int | None) -> str:
    """A status as the report prints it: the code, or "error" for a timeout or connection error."""
    return "error" if status is None else str(status)


@dataclass(frozen=True, slots=True)
class TakeSummary:
    """One take's figures over its measured window (one step, or every step when `step` is None)."""

    step: str | None
    requests: int
    expected: int
    unexpected: int
    statuses: dict[str, int]
    p50_ms: float | None
    p95_ms: float | None
    p99_ms: float | None
    max_ms: float | None
    lag_p99_ms: float
    lag_max_ms: float
    cpu_share: float
    histogram: list[tuple[str, int]]
    invalid_reasons: tuple[str, ...]

    @property
    def unexpected_share(self) -> float:
        return self.unexpected / self.requests if self.requests else 0.0

    @property
    def valid(self) -> bool:
        return not self.invalid_reasons


def summarise(
    outcomes: Iterable[Outcome],
    expected_statuses: frozenset[int],
    *,
    cpu_share: float,
    warmup_seconds: float = 0.0,
    step: str | None = None,
) -> TakeSummary:
    """The take's figures over outcomes planned at or after `warmup_seconds` (of `step` only when
    given), with the reasons it is invalid by the method's rules (none when it is valid). The lag
    and the error budget are judged over every request of the window, whatever its step."""
    window = [o for o in outcomes if o.planned_seconds >= warmup_seconds]
    chosen = window if step is None else [o for o in window if o.step == step]
    good = [o.latency_ms for o in chosen if o.status in expected_statuses]
    unexpected_all = sum(1 for o in window if o.status not in expected_statuses)
    lags = [o.lag_ms for o in window if not o.follow_up]
    lag_p99 = percentile(lags, 0.99) or 0.0
    lag_max = max(lags, default=0.0)
    reasons: list[str] = []
    if window and unexpected_all / len(window) >= ERROR_BUDGET:
        reasons.append(
            f"unexpected outcomes {unexpected_all} of {len(window)} reach the 0.1% error budget"
        )
    if lag_p99 > SCHEDULE_LAG_P99_MS or lag_max > SCHEDULE_LAG_MAX_MS:
        reasons.append(f"schedule lag p99 {lag_p99:.1f} ms, max {lag_max:.1f} ms breaks the bound")
    if cpu_share > SATURATED_CPU_SHARE:
        reasons.append(f"generator CPU share {cpu_share:.0%} is above 90% (saturated)")
    if not window:
        reasons.append("no request in the measured window")
    return TakeSummary(
        step=step,
        requests=len(chosen),
        expected=len(good),
        unexpected=len(chosen) - len(good),
        statuses=dict(sorted(Counter(status_label(o.status) for o in chosen).items())),
        p50_ms=percentile(good, 0.5),
        p95_ms=percentile(good, 0.95),
        p99_ms=percentile(good, 0.99),
        max_ms=max(good, default=None),
        lag_p99_ms=lag_p99,
        lag_max_ms=lag_max,
        cpu_share=cpu_share,
        histogram=histogram(good),
        invalid_reasons=tuple(reasons),
    )


def unit_durations_ms(outcomes: Iterable[Outcome], last_step: str) -> list[float]:
    """For each unit that reached `last_step` with a success (2xx), its time from its first
    planned send to that answer: a submit-to-done figure (an export ready, a query completed)."""
    first: dict[int, float] = {}
    done: dict[int, float] = {}
    for o in outcomes:
        first[o.unit] = min(first.get(o.unit, math.inf), o.planned_seconds)
        if o.step == last_step and o.status is not None and o.status // 100 == SUCCESS_CLASS:
            end = o.sent_seconds + o.latency_ms / 1000.0
            done[o.unit] = min(done.get(o.unit, math.inf), end)
    return sorted((done[u] - first[u]) * 1000.0 for u in done)


def unit_server_durations_ms(outcomes: Iterable[Outcome], last_step: str) -> list[float]:
    """For each unit that reached `last_step` with a success and a server duration, that duration
    (the server's own time, free of the poll's interval: Workflow 11D fix-11d, P001)."""
    done: dict[int, float] = {}
    for o in outcomes:
        if (
            o.step == last_step
            and o.server_ms is not None
            and o.status is not None
            and o.status // 100 == SUCCESS_CLASS
            and o.unit not in done
        ):
            done[o.unit] = o.server_ms
    return sorted(done.values())
