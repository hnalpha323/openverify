"""Scenario `api-writes` (C269.1): POST /inquiries 40%, PATCH 20%, tags 20%, approve 10%, decline
10%, at 50 requests/s (top step 200/s).
"""

from __future__ import annotations

from collections.abc import Iterator

from driver import PlannedRequest
from scenarios.common import API, api_headers, arrivals, body, documentation_addresses, pick
from scenarios.seed import Seed
from scenarios.spec import Budget, PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="api-writes",
    contract="C269.1",
    owner="calibration-load-11d",
    budget=Budget("p95", "<=", 300, "ms"),
    expected_statuses=frozenset({200, 201}),
    loads=(PolicyLoad("api", 80, 200.0),),
    environments=("load-a sandbox",),
    addresses=64,
    address_range="198.51.100.0/24",
    deliberately_over=False,
)

ADDRESSES = documentation_addresses("198.51.100.0/24", 64)
#: Ten slots: create 40%, update 20%, add a tag 20%, approve 10%, decline 10% (the method).
PATTERN = ("create",) * 4 + ("update",) * 2 + ("tag",) * 2 + ("approve", "decline")


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """The requests one take of `api-writes` sends. An approve or a decline takes the next unused
    inquiry awaiting review (each once: `offset` moves past the ones earlier takes used)."""
    keys = seed.pool("api-writes")
    template = seed.ref("template:load-a")
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        n = offset + i
        step = PATTERN[n % len(PATTERN)]
        headers = api_headers(pick(keys, n), pick(ADDRESSES, n), json_body=True)
        if step == "create":
            path = f"{API}/inquiries"
            payload: object = {
                "data": {
                    "attributes": {
                        "inquiry-template-id": template,
                        "reference-id": f"load-write-{n}",
                    }
                }
            }
            method = "POST"
        elif step == "update":
            path = f"{API}/inquiries/{pick(seed.id_pool('write-inquiries'), n)}"
            payload = {"data": {"attributes": {"reference-id": f"load-update-{n}"}}}
            method = "PATCH"
        elif step == "tag":
            path = f"{API}/inquiries/{pick(seed.id_pool('write-inquiries'), n)}/add-tag"
            payload = {"meta": {"tag-name": f"load-{n % 50}"}}
            method = "POST"
        else:
            review = seed.id_pool("review-inquiries")
            slot = (n // len(PATTERN)) * 2 + (0 if step == "approve" else 1)
            if slot >= len(review):
                raise ValueError(
                    "the seed's inquiries awaiting review are used up; seed more or lower the rate"
                )
            path = f"{API}/inquiries/{review[slot]}/{step}"
            payload = {"meta": {"comment": "Synthetic load decision."}}
            method = "POST"
        yield PlannedRequest(
            at, method, step, path=path, headers=headers, body=body(payload), unit=n
        )
