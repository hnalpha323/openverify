"""Scenario `api-reads` (C269.1): GET /inquiries/:id, GET /accounts/:id and list pages of 25, one
third each, at 100 requests/s (top step 400/s).
"""

from __future__ import annotations

import itertools
from collections.abc import Iterator

from driver import PlannedRequest
from scenarios.common import API, api_headers, arrivals, documentation_addresses, pick
from scenarios.seed import Seed
from scenarios.spec import Budget, PolicyLoad, ScenarioSpec
from vegeta.targets import target_line

SPEC = ScenarioSpec(
    id="api-reads",
    contract="C269.1",
    owner="calibration-load-11d",
    budget=Budget("p95", "<=", 150, "ms"),
    expected_statuses=frozenset({200}),
    loads=(PolicyLoad("api", 160, 400.0),),
    environments=("load-a sandbox",),
    addresses=64,
    address_range="198.51.100.0/24",
    deliberately_over=False,
)

#: The client addresses the reads spread over (a documentation range only).
ADDRESSES = documentation_addresses("198.51.100.0/24", 64)
#: One third each: an inquiry, an account, a list page of 25.
STEPS = ("inquiry", "account", "list")


def request(seed: Seed, index: int) -> tuple[str, str, tuple[tuple[str, str], ...]]:
    """The `index`th read: its step, path and headers (a key and an address of the spread)."""
    key = pick(seed.pool("api-reads"), index)
    headers = api_headers(key, pick(ADDRESSES, index))
    step = STEPS[index % 3]
    if step == "inquiry":
        path = f"{API}/inquiries/{pick(seed.id_pool('settled-inquiries'), index // 3)}"
    elif step == "account":
        path = f"{API}/accounts/{pick(seed.id_pool('accounts'), index // 3)}"
    else:
        path = f"{API}/inquiries?page%5Bsize%5D=25"
    return step, path, headers


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """The requests one take of `api-reads` sends at `rate_per_s` for `duration_s` seconds."""
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        step, path, headers = request(seed, offset + i)
        yield PlannedRequest(at, "GET", step, path=path, headers=headers, unit=offset + i)


def vegeta_targets(seed: Seed, base_url: str) -> Iterator[str]:
    """The same reads as vegeta targets (the row's constant-rate generator)."""
    for i in itertools.count():
        _, path, headers = request(seed, i)
        yield target_line("GET", base_url + path, dict(headers))
