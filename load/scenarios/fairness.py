"""Scenario `fairness` (C251.5; C269.2): One environment floods report runs at 10 times its cap
while another runs 1 a second; at the default cap and at the ceiling 200.
"""

from __future__ import annotations

import heapq
from collections.abc import Iterator

from driver import PlannedRequest
from scenarios.common import arrivals
from scenarios.screening_throughput import report_unit
from scenarios.seed import Seed
from scenarios.spec import Budget, PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="fairness",
    contract="C251.5; C269.2",
    owner="calibration-load-11d",
    budget=Budget("ratio", "<=", 2, "ratio"),
    expected_statuses=frozenset({200, 201}),
    loads=(
        PolicyLoad("reports", 1, 5.0),
        PolicyLoad("api", 4, 5.0),
    ),
    environments=("load-s11 sandbox", "load-s12 sandbox"),
    addresses=0,
    address_range=None,
    deliberately_over=False,
)

#: The victim's normal load: one report run a second (the method).
VICTIM_RATE = 1.0
#: The flooder submits at 5 a second: 500 runs (10 times the default cap) in 100 s, 2,000 (10 times
#: the "ceiling 200" configuration) in 400 s.
FLOOD_RATE = 5.0
#: The flood's opening burst (Workflow 11D fix-11d, P001): at 5 a second the worker settles the
#: flood as fast as it comes (about 15 runs a second at concurrency 4), so the cap is never
#: reached. The first 500 runs go at 50 a second (10 s), inside the `reports` policy's burst (its
#: whole limit of 600 an environment; GCRA, load-harness amendment 8) and each flooder key's `api`
#: burst (300; 125 a key), so nothing is refused; the rest follow at `FLOOD_RATE`.
FLOOD_BURST_RUNS = 500
FLOOD_BURST_RATE = 50.0


def strip(unit: PlannedRequest, n: int) -> PlannedRequest:
    """A flood run: its submit alone (the flood fills the queue; nobody waits for it)."""
    return PlannedRequest(
        unit.at_seconds,
        unit.method,
        "flood",
        path=unit.path,
        headers=unit.headers,
        body=unit.body,
        unit=n,
    )


def flood_times(flood_runs: int) -> Iterator[float]:
    """The flood's send times: its burst, then the rest at `FLOOD_RATE` after it."""
    burst = min(flood_runs, FLOOD_BURST_RUNS)
    yield from arrivals(FLOOD_BURST_RATE, burst / FLOOD_BURST_RATE)
    after = burst / FLOOD_BURST_RATE
    rest = flood_runs - burst
    yield from (after + at for at in arrivals(FLOOD_RATE, rest / FLOOD_RATE))


def plan(
    seed: Seed,
    rate_per_s: float = VICTIM_RATE,
    duration_s: float = 120.0,
    *,
    offset: int = 0,
    flood_runs: int = 0,
) -> Iterator[PlannedRequest]:
    """The victim's runs (`victim` steps, polled to settled) at `rate_per_s` from `load-s12`, and,
    when `flood_runs` > 0, the flooder's `flood_runs` runs from `load-s11`, a burst then 5 a second
    (`flood_times`; unpolled: the flood only fills the queue). `flood_runs` 0 is the idle take."""
    victim = (
        report_unit(seed, "fairness-victim", at, offset + i, step="victim")
        for i, at in enumerate(arrivals(rate_per_s, duration_s))
    )
    flood = (
        strip(report_unit(seed, "fairness-flooder", at, 10**6 + offset + i), -1 - i)
        for i, at in enumerate(flood_times(flood_runs))
    )
    yield from heapq.merge(victim, flood, key=lambda r: r.at_seconds)
