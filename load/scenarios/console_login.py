"""Scenario `console-login` (C269.1; C246; C168.2): The password request at 5 logins/s (top 20/s);
the TOTP request and the two-step sign-in reported beside it; no user signs in twice in one 30 s
TOTP step.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator

from driver import Answer, FollowUp, PlannedRequest
from scenarios.common import API, FORWARDED_FOR, JSON, arrivals, body, member, pick, totp
from scenarios.seed import Seed
from scenarios.spec import Budget, PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="console-login",
    contract="C269.1; C246; C168.2",
    owner="calibration-load-11d",
    budget=Budget("p95", "<=", 500, "ms"),
    expected_statuses=frozenset({201, 202}),
    loads=(
        PolicyLoad("login-per-email", 4000, 20.0),
        PolicyLoad("login-per-address", 4000, 20.0),
    ),
    environments=("load-a", "load-b"),
    addresses=4000,
    address_range="2001:db8:4c00::/40",
    deliberately_over=False,
)

#: A user signs in at most 5 times in 15 minutes, at least 3 minutes apart (the method's spread),
#: so never twice in one 30-second TOTP step.
MIN_SECONDS_BETWEEN_SIGN_INS = 180.0
#: The password step's answer when a second factor follows (C25.1).
MFA_REQUIRED = 202


def plan(
    seed: Seed,
    rate_per_s: float,
    duration_s: float,
    *,
    offset: int = 0,
    now: Callable[[], float] = time.time,
) -> Iterator[PlannedRequest]:
    """Two-step sign-ins at `rate_per_s`: the password request (the budget's row, through the Valkey
    limiter) from the user's own documentation address, then the TOTP request with the code of the
    moment it is sent. The users are used round-robin, so each waits `len(users) / rate` seconds."""
    users = seed.users
    if not users:
        raise ValueError("the seed has no console users")
    if len(users) / rate_per_s < MIN_SECONDS_BETWEEN_SIGN_INS:
        raise ValueError(
            f"{len(users)} users at {rate_per_s:g}/s would sign in a user again within 3 minutes"
        )
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        n = offset + i
        user = pick(users, n)
        headers = (("accept", JSON), ("content-type", JSON), (FORWARDED_FOR, user.address))

        def after_password(
            answer: Answer,
            headers: tuple[tuple[str, str], ...] = headers,
            n: int = n,
            secret: str = user.totp_secret,
        ) -> FollowUp | None:
            token = member(answer, "mfa-token")
            if answer.status != MFA_REQUIRED or token is None:
                return None
            payload = {"mfa-token": token, "totp-code": totp(secret, now())}
            return FollowUp(
                PlannedRequest(
                    0.0,
                    "POST",
                    "totp",
                    path=f"{API}/dashboard/sessions/mfa",
                    headers=headers,
                    body=body(payload),
                    unit=n,
                )
            )

        yield PlannedRequest(
            at,
            "POST",
            "password",
            path=f"{API}/dashboard/sessions",
            headers=headers,
            body=body({"email": user.email, "password": user.password}),
            unit=n,
            then=after_password,
        )
