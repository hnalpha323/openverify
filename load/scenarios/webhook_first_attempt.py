"""Scenario `webhook-first-attempt` (C269.1): Event to the first webhook delivery attempt the
receiver sees, at 50 events/s (top 200/s).
"""

from __future__ import annotations

from collections.abc import Iterator

from driver import PlannedRequest
from scenarios.common import API, api_headers, arrivals, body, documentation_addresses, pick
from scenarios.seed import Seed
from scenarios.spec import Budget, PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="webhook-first-attempt",
    contract="C269.1",
    owner="calibration-load-11d",
    budget=Budget("p95", "<=", 5, "s"),
    expected_statuses=frozenset({200, 201}),
    loads=(PolicyLoad("api", 80, 200.0),),
    environments=("load-b sandbox",),
    addresses=64,
    address_range="198.51.100.0/24",
    deliberately_over=False,
)

ADDRESSES = documentation_addresses("198.51.100.0/24", 64)


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """Events at `rate_per_s`: each request creates an inquiry in `load-b` sandbox, whose
    `inquiry.created` event the seeded webhook delivers to the receiver (`load/receiver.py`), which
    records each event's first attempt; event to first attempt is the receiver's arrival minus the
    event's `created-at`."""
    keys = seed.pool("webhook")
    template = seed.ref("template:load-b")
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        n = offset + i
        payload = {
            "data": {
                "attributes": {"inquiry-template-id": template, "reference-id": f"load-event-{n}"}
            }
        }
        yield PlannedRequest(
            at,
            "POST",
            "event",
            path=f"{API}/inquiries",
            headers=api_headers(pick(keys, n), pick(ADDRESSES, n), json_body=True),
            body=body(payload),
            unit=n,
        )
