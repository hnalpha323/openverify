"""Scenario `flow-upload` (C269.1; Workflow 7A (c); 10B): A session's 1-3 MB synthetic upload with
capture-trigger within UPLOAD_LIMITS, its signal bodies and its integrity challenge and token,
at 10 uploads/s (top 40/s).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from functools import cache

from driver import Answer, FollowUp, PlannedRequest
from scenarios.common import (
    API,
    api_headers,
    arrivals,
    body,
    documentation_addresses,
    member,
    multipart,
    pick,
    session_headers,
    succeeded,
    synthetic_png,
)
from scenarios.seed import Seed
from scenarios.spec import Budget, PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="flow-upload",
    contract="C269.1; Workflow 7A (c); 10B",
    owner="calibration-load-11d",
    budget=Budget("p95", "<=", 1.5, "s"),
    expected_statuses=frozenset({200, 201, 202, 204}),
    loads=(
        PolicyLoad("flow-ip", 254, 227.0),
        PolicyLoad("flow-session", 400, 227.0),
        PolicyLoad("flow-signals", 400, 80.0),
        PolicyLoad("flow-integrity", 1, 2 / 3600),
        PolicyLoad("api", 16, 13.4),
    ),
    environments=("load-a sandbox",),
    addresses=254,
    address_range="203.0.113.0/24",
    deliberately_over=False,
)

ADDRESSES = documentation_addresses("203.0.113.0/24", 254)
#: The consent texts of the load template: the default template's, with Play Integrity's notice
#: beside the session-integrity notice (the stack binds the sandbox deviceIntegrity provider).
CONSENT_KEYS = (
    "consent.biometric",
    "consent.processing",
    "notice.session-integrity",
    "notice.play-integrity",
)
#: The sandbox provider's token for a strong verdict (C211.4).
SANDBOX_INTEGRITY_TOKEN = "sandbox-strong"  # noqa: S105 - a sandbox verdict name, not a secret
#: Upload sizes, cycled: 1, 2 and 3 MB (the method's 1-3 MB synthetic image).
UPLOAD_SIZES = (1_000_000, 2_000_000, 3_000_000)


@cache
def image(size: int) -> bytes:
    """A synthetic PNG of `size` bytes or so, drawn once per size."""
    return synthetic_png(size, seed=size)


Then = Callable[[Answer], FollowUp | None]


def upload(  # noqa: PLR0913, PLR0917 - one upload's context, built inside a unit
    token: str, address: str, verification: str, kind: str, n: int, then: Then | None
) -> PlannedRequest:
    """One file upload of a session: the image with its kind and the capture fields `UPLOAD_LIMITS`
    allows (`capture-method`, `capture-trigger`)."""
    content_type, data = multipart(
        [("kind", kind), ("capture-method", "upload"), ("capture-trigger", "manual")],
        "file",
        f"{kind}.png",
        "image/png",
        image(UPLOAD_SIZES[n % len(UPLOAD_SIZES)]),
        boundary=f"load-{n}-{kind}",
    )
    headers = (*session_headers(token, address), ("content-type", content_type))
    return PlannedRequest(
        0.0,
        "POST",
        "upload",
        path=f"{API}/flow/verifications/{verification}/files",
        headers=headers,
        body=data,
        unit=n,
        then=then,
    )


def session_unit(
    token: str,
    address: str,
    n: int,
    after_uploads: Callable[[str, str, str], Then | None] | None = None,
) -> PlannedRequest:
    """A flow session from its first read: the session, consent, the integrity challenge and token,
    a government ID verification, its front and back, and one signal body per closed screen.
    `after_uploads`, given the session token and the verification id, may continue the unit (the
    verification row)."""

    def flow(
        method: str, step: str, path: str, payload: object | None, then: Then | None
    ) -> PlannedRequest:
        return PlannedRequest(
            0.0,
            method,
            step,
            path=f"{API}/flow{path}",
            headers=session_headers(token, address, json_body=payload is not None),
            body=None if payload is None else body(payload),
            unit=n,
            then=then,
        )

    def signals(screen: str, sequence: int, then: Then | None) -> PlannedRequest:
        payload = {
            "platform": "web",
            "collector-version": 1,
            "screen": screen,
            "sequence": sequence,
            "sandbox-outcome": "human",
        }
        return flow("POST", "signals", "/signals", payload, then)

    def after_verification(answer: Answer) -> FollowUp | None:
        verification = member(answer, "data", "id")
        if not succeeded(answer) or verification is None:
            return None
        rest = after_uploads(token, verification, address) if after_uploads is not None else None

        def after_back(back: Answer) -> FollowUp | None:
            return FollowUp(signals("government_id", 1, rest)) if succeeded(back) else None

        def after_front(front: Answer) -> FollowUp | None:
            return (
                FollowUp(upload(token, address, verification, "back", n, after_back))
                if succeeded(front)
                else None
            )

        return FollowUp(upload(token, address, verification, "front", n, after_front))

    def after_token(answer: Answer) -> FollowUp | None:
        return FollowUp(
            flow(
                "POST",
                "verification",
                "/verifications",
                {"type": "government-id"},
                after_verification,
            )
        )

    def after_challenge(answer: Answer) -> FollowUp | None:
        challenge = member(answer, "id") or member(answer, "data", "id")
        if challenge is None:
            return FollowUp(
                flow(
                    "POST",
                    "verification",
                    "/verifications",
                    {"type": "government-id"},
                    after_verification,
                )
            )
        payload = {"challenge-id": challenge, "token": SANDBOX_INTEGRITY_TOKEN}
        return FollowUp(flow("POST", "integrity-token", "/integrity-tokens", payload, after_token))

    def after_consent_signals(answer: Answer) -> FollowUp | None:
        return FollowUp(
            flow("POST", "integrity-challenge", "/integrity-challenges", {}, after_challenge)
        )

    def after_consent(answer: Answer) -> FollowUp | None:
        return FollowUp(signals("consent", 0, after_consent_signals)) if succeeded(answer) else None

    def after_session(answer: Answer) -> FollowUp | None:
        payload = {"accepted": True, "text-keys": list(CONSENT_KEYS), "locale": "en"}
        return (
            FollowUp(flow("POST", "consent", "/consent", payload, after_consent))
            if succeeded(answer)
            else None
        )

    return flow("GET", "session", "/session", None, after_session)


def resume_unit(
    seed: Seed,
    at: float,
    n: int,
    inquiry: str,
    after_uploads: Callable[[str, str, str], Then | None] | None = None,
) -> PlannedRequest:
    """A unit from its start: a customer key resumes the inquiry (its session token in memory),
    then the session runs from the client's documentation address."""
    address = pick(ADDRESSES, n)
    key = pick(seed.pool("flow"), n)

    def after_resume(answer: Answer) -> FollowUp | None:
        token = member(answer, "meta", "session-token")
        return (
            FollowUp(session_unit(token, address, n, after_uploads)) if token is not None else None
        )

    return PlannedRequest(
        at,
        "POST",
        "resume",
        path=f"{API}/inquiries/{inquiry}/resume",
        headers=api_headers(key, json_body=True),
        body=b"{}",
        unit=n,
        then=after_resume,
    )


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """The units one take of `flow-upload` starts: `rate_per_s` uploads a second, two a session,
    so a session starts every 2 / `rate_per_s` seconds, each on an inquiry no take used before."""
    inquiries = seed.id_pool("flow-inquiries")
    for i, at in enumerate(arrivals(rate_per_s / 2, duration_s)):
        n = offset + i
        if n >= len(inquiries):
            raise ValueError(
                "the seed's pending flow inquiries are used up; seed more or lower the rate"
            )
        yield resume_unit(seed, at, n, inquiries[n])
