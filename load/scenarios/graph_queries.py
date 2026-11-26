"""Scenario `graph-queries` (Workflow 7B (f)): Asynchronous graph queries, submit to completed, 4 a
second over 16 environments; reported beside graph:benchmark.
"""

from __future__ import annotations

from collections.abc import Iterator

from driver import Answer, FollowUp, PlannedRequest
from scenarios.common import API, api_headers, arrivals, body, member, pick, poll, succeeded
from scenarios.seed import Seed
from scenarios.spec import PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="graph-queries",
    contract="Workflow 7B (f)",
    owner="calibration-load-11d",
    budget=None,
    expected_statuses=frozenset({200, 201, 202}),
    loads=(PolicyLoad("graph-queries", 16, 4.0),),
    environments=(
        "load-s01 sandbox",
        "load-s01 production",
        "load-s02 sandbox",
        "load-s02 production",
        "load-s03 sandbox",
        "load-s03 production",
        "load-s04 sandbox",
        "load-s04 production",
        "load-s05 sandbox",
        "load-s05 production",
        "load-s06 sandbox",
        "load-s06 production",
        "load-s07 sandbox",
        "load-s07 production",
        "load-s08 sandbox",
        "load-s08 production",
    ),
    addresses=0,
    address_range=None,
    deliberately_over=False,
)

POLL_SECONDS = 0.25
POLL_ATTEMPTS = 240


#: A graph query's terminal statuses.
TERMINAL = frozenset({"completed", "errored", "cancelled", "timed_out"})


def completed(answer: Answer) -> bool:
    return member(answer, "data", "attributes", "status") in TERMINAL


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """Asynchronous graph queries at `rate_per_s` over the 16 graph keys (one per environment of
    `load-s01`...`s08`, both kinds), each from its environment's published template and one of its
    indexed accounts, polled from submit to `completed`."""
    keys = seed.pool("graph")
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        n = offset + i
        key = pick(keys, n)
        account = pick(seed.id_pool(f"graph-accounts:{key.environment}"), n // len(keys))
        payload = {
            "data": {
                "type": "graph-query",
                "attributes": {
                    "graph-query-template-id": seed.ref(f"graph-template:{key.environment}"),
                    "parameter-map": {"account_id": account},
                },
            }
        }

        def after_submit(answer: Answer, key=key, n=n) -> FollowUp | None:  # type: ignore[no-untyped-def]
            query = member(answer, "data", "id")
            if not succeeded(answer) or query is None:
                return None

            def request() -> PlannedRequest:
                return PlannedRequest(
                    0.0,
                    "GET",
                    "completed",
                    path=f"{API}/graph-queries/{query}",
                    headers=api_headers(key),
                    unit=n,
                )

            return poll(request, completed, every_seconds=POLL_SECONDS, attempts=POLL_ATTEMPTS)(
                Answer(200, b"{}")
            )

        yield PlannedRequest(
            at,
            "POST",
            "submit",
            path=f"{API}/graph-queries",
            headers=api_headers(key, json_body=True),
            body=body(payload),
            unit=n,
            then=after_submit,
        )
