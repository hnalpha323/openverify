"""Scenario `soak` (C269.3): 30 minutes at 70% of the mixed knee (reads, writes, the flow), one
network snapshot swap at minute 15.
"""

from __future__ import annotations

import heapq
from collections.abc import Iterator

from driver import PlannedRequest
from scenarios import api_reads, api_writes, flow_upload
from scenarios.seed import Seed
from scenarios.spec import Budget, PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="soak",
    contract="C269.3",
    owner="calibration-load-11d",
    budget=Budget("growth", "<=", 10, "percent"),
    expected_statuses=frozenset({200, 201, 202, 204}),
    loads=(
        PolicyLoad("api", 240, 420.0),
        PolicyLoad("flow-ip", 254, 159.0),
        PolicyLoad("flow-session", 400, 159.0),
    ),
    environments=("load-a sandbox",),
    addresses=254,
    address_range="203.0.113.0/24",
    deliberately_over=False,
)

#: The mixed load's budget proportions: reads 100/s, writes 50/s, uploads 10/s.
PROPORTIONS = (("reads", 100.0), ("writes", 50.0), ("uploads", 10.0))


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """The soak's mixed load at `rate_per_s` requests a second in all (70% of the knee), split by
    the budget proportions: reads, writes and flow uploads, merged in planned order."""
    total = sum(share for _, share in PROPORTIONS)
    rates = {name: rate_per_s * share / total for name, share in PROPORTIONS}
    yield from heapq.merge(
        api_reads.plan(seed, rates["reads"], duration_s, offset=offset),
        api_writes.plan(seed, rates["writes"], duration_s, offset=offset),
        flow_upload.plan(seed, rates["uploads"], duration_s, offset=offset),
        key=lambda r: r.at_seconds,
    )
