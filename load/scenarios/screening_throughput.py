"""Scenario `screening-throughput` (C269.1): watchlist report runs through the stack's worker at
concurrency 1 and 4, at 100,000 and 2,000,000 names; floor 10,000 an hour per process at
2,000,000.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime

from driver import Answer, FollowUp, PlannedRequest
from scenarios.common import API, api_headers, arrivals, body, member, pick, poll, succeeded
from scenarios.seed import Seed
from scenarios.spec import Budget, PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="screening-throughput",
    contract="C269.1",
    owner="calibration-load-11d",
    budget=Budget("rate", ">=", 10000, "per-hour"),
    expected_statuses=frozenset({200, 201}),
    loads=(
        PolicyLoad("reports", 4, 20.0),
        PolicyLoad("api", 8, 20.0),
    ),
    environments=("load-s01 sandbox", "load-s02 sandbox", "load-s03 sandbox", "load-s04 sandbox"),
    addresses=0,
    address_range=None,
    deliberately_over=False,
)

#: Polls of a report run: every 2 s, for at most 10 minutes.
POLL_SECONDS = 2.0
POLL_ATTEMPTS = 300
SETTLED = frozenset({"ready", "errored"})


def settled(answer: Answer) -> bool:
    return member(answer, "data", "attributes", "status") in SETTLED


def settled_ms(answer: Answer) -> float | None:
    """A settled report's own time, `created-at` to `completed-at` in ms (None before it settles):
    the fairness victim's figure, free of the 2 s poll (Workflow 11D fix-11d, P001)."""
    if not settled(answer):
        return None
    created = member(answer, "data", "attributes", "created-at")
    completed = member(answer, "data", "attributes", "completed-at")
    if not (isinstance(created, str) and isinstance(completed, str)):
        return None
    start = datetime.fromisoformat(created.replace("Z", "+00:00"))
    end = datetime.fromisoformat(completed.replace("Z", "+00:00"))
    return round((end - start).total_seconds() * 1000.0, 3)


def report_unit(
    seed: Seed, pool: str, at: float, n: int, *, step: str = "submit"
) -> PlannedRequest:
    """One `watchlist` report run in a key's own environment, polled until it settles; the query is
    one of the seed's synthetic names."""
    key = pick(seed.pool(pool), n)
    template = seed.ref(f"watchlist-template:{key.environment}")
    first, last = pick(seed.id_pool("screening-names"), n).split("|", 1)
    payload = {
        "data": {
            "type": "report/watchlist",
            "attributes": {
                "report-template-id": template,
                "query": {"name-first": first, "name-last": last},
            },
        }
    }

    def after_submit(answer: Answer) -> FollowUp | None:
        report = member(answer, "data", "id")
        if not succeeded(answer) or report is None:
            return None

        def request() -> PlannedRequest:
            return PlannedRequest(
                0.0,
                "GET",
                "settled",
                path=f"{API}/reports/{report}",
                headers=api_headers(key),
                unit=n,
                measure=settled_ms,
            )

        return poll(request, settled, every_seconds=POLL_SECONDS, attempts=POLL_ATTEMPTS)(
            Answer(200, b"{}")
        )

    return PlannedRequest(
        at,
        "POST",
        step,
        path=f"{API}/reports",
        headers=api_headers(key, json_body=True),
        body=body(payload),
        unit=n,
        then=after_submit,
    )


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """Report runs at `rate_per_s` over the screening keys (`load-s01`...`s04` sandbox); throughput
    is settled runs an hour per worker process at the worker's concurrency."""
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        yield report_unit(seed, "screening", at, offset + i)
