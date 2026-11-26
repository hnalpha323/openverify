"""Scenario `transactions-search` (Workflow 7B (g)): GET
/api/v1/transactions?filter[identifier]=... at 100/s (top 400/s); reported.
"""

from __future__ import annotations

import itertools
from collections.abc import Iterator
from urllib.parse import quote

from driver import PlannedRequest
from scenarios.common import API, api_headers, arrivals, pick
from scenarios.seed import Seed
from scenarios.spec import PolicyLoad, ScenarioSpec
from scenarios.transactions_write import FIELDS, fields
from vegeta.targets import target_line

SPEC = ScenarioSpec(
    id="transactions-search",
    contract="Workflow 7B (g)",
    owner="calibration-load-11d",
    budget=None,
    expected_statuses=frozenset({200}),
    loads=(PolicyLoad("api", 160, 400.0),),
    environments=("load-b sandbox",),
    addresses=0,
    address_range=None,
    deliberately_over=False,
)


def request(seed: Seed, index: int) -> tuple[str, tuple[tuple[str, str], ...]]:
    """The `index`th search: one searchable field and a value the seed wrote."""
    key = FIELDS[index % len(FIELDS)]
    value = fields(index * 7919)[key]
    path = (
        f"{API}/transactions?filter%5Bidentifier%5D%5Bkey%5D={quote(key)}"
        f"&filter%5Bidentifier%5D%5Bvalue%5D={quote(value)}&page%5Bsize%5D=25"
    )
    return path, api_headers(pick(seed.pool("transactions-search"), index))


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """The requests one take of `transactions-search` sends."""
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        path, headers = request(seed, offset + i)
        yield PlannedRequest(at, "GET", "search", path=path, headers=headers, unit=offset + i)


def vegeta_targets(seed: Seed, base_url: str) -> Iterator[str]:
    for i in itertools.count():
        path, headers = request(seed, i)
        yield target_line("GET", base_url + path, dict(headers))
