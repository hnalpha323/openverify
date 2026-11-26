"""Scenario `verification` (C269.1; C32.4; C41.5; phase-5.plan.md:627): Submit to decision per
worker at concurrency 4 with one vision: per-analysis medians (government ID 5 s, selfie 3 s,
document 4 s), the p95 recorded only.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator

from driver import Answer, FollowUp, PlannedRequest
from scenarios.common import API, arrivals, member, poll, session_headers
from scenarios.flow_upload import Then, resume_unit
from scenarios.seed import Seed
from scenarios.spec import Budget, PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="verification",
    contract="C269.1; C32.4; C41.5; phase-5.plan.md:627",
    owner="calibration-load-11d",
    budget=Budget("median", "<=", 5, "s"),
    expected_statuses=frozenset({200, 201, 202, 204}),
    loads=(
        PolicyLoad("flow-ip", 254, 57.0),
        PolicyLoad("flow-session", 100, 57.0),
        PolicyLoad("flow-signals", 100, 20.0),
        PolicyLoad("flow-integrity", 1, 2 / 3600),
    ),
    environments=("load-a sandbox",),
    addresses=254,
    address_range="203.0.113.0/24",
    deliberately_over=False,
)

#: Polls of a submitted verification: every second, for at most two minutes.
POLL_SECONDS = 1.0
POLL_ATTEMPTS = 120
#: A verification's statuses once its analysis has decided.
DECIDED = frozenset({"passed", "failed", "requires_retry", "canceled", "skipped", "needs_review"})


def decided(answer: Answer) -> bool:
    return member(answer, "data", "attributes", "status") in DECIDED


def submit_then_poll(n: int) -> Callable[[str, str, str], Then]:
    """After the uploads: submit the verification, then poll it until its analysis decides (the
    unit's first `decided` answer is the submit-to-decision time per worker)."""

    def continue_with(token: str, verification: str, address: str) -> Then:
        def request() -> PlannedRequest:
            return PlannedRequest(
                0.0,
                "GET",
                "decided",
                path=f"{API}/flow/verifications/{verification}",
                headers=session_headers(token, address),
                unit=n,
            )

        polling = poll(request, decided, every_seconds=POLL_SECONDS, attempts=POLL_ATTEMPTS)

        def after_signals(answer: Answer) -> FollowUp | None:
            return FollowUp(
                PlannedRequest(
                    0.0,
                    "POST",
                    "submit",
                    path=f"{API}/flow/verifications/{verification}/submit",
                    headers=session_headers(token, address, json_body=True),
                    body=b"{}",
                    unit=n,
                    then=polling,
                )
            )

        return after_signals

    return continue_with


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """Units of `verification`: a session uploads a government ID (the upload row's synthetic
    images), submits it and polls it to its decision. The rate is sessions a second, to the knee."""
    inquiries = seed.id_pool("verification-inquiries")
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        n = offset + i
        if n >= len(inquiries):
            raise ValueError("the seed's verification inquiries are used up")
        yield resume_unit(seed, at, n, inquiries[n], submit_then_poll(n))
