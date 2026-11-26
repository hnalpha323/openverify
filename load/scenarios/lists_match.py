"""Scenario `lists-match` (Workflow 7B (e)): POST /api/v1/lists/match at 10/s (top 20/s);
reported.
"""

from __future__ import annotations

import itertools
from collections.abc import Iterator

from driver import PlannedRequest
from scenarios.common import API, api_headers, arrivals, body, pick
from scenarios.seed import Seed
from scenarios.spec import PolicyLoad, ScenarioSpec
from vegeta.targets import target_line

SPEC = ScenarioSpec(
    id="lists-match",
    contract="Workflow 7B (e)",
    owner="calibration-load-11d",
    budget=None,
    expected_statuses=frozenset({200}),
    loads=(PolicyLoad("lists-match", 40, 20.0),),
    environments=("load-a sandbox",),
    addresses=0,
    address_range=None,
    deliberately_over=False,
)


def probe(index: int) -> dict[str, str]:
    """One probe a match carries: an email address, a name or an IP address of the seeded lists
    (a hit about one time in two, so both paths are timed)."""
    n = index * 7919 % 20000
    kind = index % 3
    if kind == 0:
        return {"kind": "email-address", "value": f"listed-{n}@example.com"}
    if kind == 1:
        return {
            "kind": "name",
            "name-first": f"Loadfirst{n % 997}",
            "name-last": f"Loadlast{n % 1009}",
        }
    return {"kind": "ip-address", "value": f"2001:db8:4d00::{n:x}"}


def request(seed: Seed, index: int) -> tuple[bytes, tuple[tuple[str, str], ...]]:
    payload = {"data": {"attributes": {"probes": [probe(index)]}}}
    return body(payload), api_headers(pick(seed.pool("lists-match"), index), json_body=True)


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """The requests one take of `lists-match` sends."""
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        payload, headers = request(seed, offset + i)
        yield PlannedRequest(
            at,
            "POST",
            "match",
            path=f"{API}/lists/match",
            headers=headers,
            body=payload,
            unit=offset + i,
        )


def vegeta_targets(seed: Seed, base_url: str) -> Iterator[str]:
    for i in itertools.count():
        payload, headers = request(seed, i)
        yield target_line("POST", f"{base_url}{API}/lists/match", dict(headers), payload)
