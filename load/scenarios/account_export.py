"""Scenario `account-export` (C269.1): An account with 20 inquiries, submit to ready; reported."""

from __future__ import annotations

from collections.abc import Iterator

from driver import Answer, FollowUp, PlannedRequest
from scenarios.common import API, api_headers, arrivals, member, pick, poll, succeeded
from scenarios.seed import Seed
from scenarios.spec import PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="account-export",
    contract="C269.1",
    owner="calibration-load-11d",
    budget=None,
    expected_statuses=frozenset({200, 202}),
    loads=(PolicyLoad("account-export", 6, 15 / 3600),),
    environments=(
        "load-s05 sandbox",
        "load-s06 sandbox",
        "load-s07 sandbox",
        "load-s08 sandbox",
        "load-s09 sandbox",
        "load-s10 sandbox",
    ),
    addresses=0,
    address_range=None,
    deliberately_over=False,
)

POLL_SECONDS = 2.0
POLL_ATTEMPTS = 300


#: An export's terminal statuses.
TERMINAL = frozenset({"ready", "failed", "expired"})


def ready(answer: Answer) -> bool:
    return member(answer, "data", "attributes", "status") in TERMINAL


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """Account exports (an account of 20 inquiries each), submit to `ready`, over the export keys
    of `load-s05`...`s10`; each key exports only accounts of its own environment."""
    keys = seed.pool("export")
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        n = offset + i
        key = pick(keys, n)
        account = pick(seed.id_pool(f"export-accounts:{key.environment}"), n // len(keys))

        def after_submit(answer: Answer, key=key, n=n) -> FollowUp | None:  # type: ignore[no-untyped-def]
            export = member(answer, "data", "id")
            if not succeeded(answer) or export is None:
                return None

            def request() -> PlannedRequest:
                return PlannedRequest(
                    0.0,
                    "GET",
                    "ready",
                    path=f"{API}/account-exports/{export}",
                    headers=api_headers(key),
                    unit=n,
                )

            return poll(request, ready, every_seconds=POLL_SECONDS, attempts=POLL_ATTEMPTS)(
                Answer(200, b"{}")
            )

        yield PlannedRequest(
            at,
            "POST",
            "submit",
            path=f"{API}/accounts/{account}/export",
            headers=api_headers(key, json_body=True),
            body=b"{}",
            unit=n,
            then=after_submit,
        )
