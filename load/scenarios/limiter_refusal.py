"""Scenario `limiter-refusal` (C268.5; C246): The API limiter at twice its limit for 60 s and the
login limiter past 50 per address and 10 per email: refusals expected.
"""

from __future__ import annotations

from collections.abc import Iterator

from driver import PlannedRequest
from scenarios.common import API, FORWARDED_FOR, JSON, api_headers, arrivals, body
from scenarios.seed import Seed
from scenarios.spec import PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="limiter-refusal",
    contract="C268.5; C246",
    owner="calibration-load-11d",
    budget=None,
    expected_statuses=frozenset({200, 201, 401, 429}),
    loads=(
        PolicyLoad("api", 1, 10.0),
        PolicyLoad("login-per-address", 1, 60 / 900),
        PolicyLoad("login-per-email", 1, 12 / 900),
    ),
    environments=("load-a sandbox",),
    addresses=1,
    address_range="192.0.2.0/24",
    deliberately_over=True,
)

#: The one address both refusals come from (a documentation address).
ADDRESS = "192.0.2.10"


def plan(
    seed: Seed, rate_per_s: float = 10.0, duration_s: float = 60.0, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """The API limiter's refusal: one key at `rate_per_s` (twice `api`'s 300 a minute at 10/s):
    every request past the limit is refused with 429, and none before it."""
    (key,) = seed.pool("limiter")[:1]
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        yield PlannedRequest(
            at,
            "GET",
            "api",
            path=f"{API}/inquiries?page%5Bsize%5D=1",
            headers=api_headers(key, ADDRESS),
            unit=offset + i,
        )


def login_plan(
    seed: Seed, *, address_attempts: int = 60, email_attempts: int = 12, duration_s: float = 840.0
) -> Iterator[PlannedRequest]:
    """The login limiter's refusal: `address_attempts` sign-ins from one address over `duration_s`
    (refused from the 51st), then `email_attempts` for one email from other addresses (refused from
    the 11th). Each uses a wrong password, so an attempt that passes the limiter answers 401."""
    user = seed.users[0]
    headers = (("accept", JSON), ("content-type", JSON))
    step = duration_s / (address_attempts + email_attempts)
    for i in range(address_attempts):
        yield PlannedRequest(
            i * step,
            "POST",
            "login-address",
            path=f"{API}/dashboard/sessions",
            headers=(*headers, (FORWARDED_FOR, ADDRESS)),
            # One email an attempt, so only the per-address bucket refuses (from the 51st); one
            # probe email's own bucket would refuse from the 11th (Workflow 11D fix-11d).
            body=body(
                {"email": f"limiter-probe-{i}@example.com", "password": "synthetic-wrong-password"}
            ),
            unit=i,
        )
    for j in range(email_attempts):
        yield PlannedRequest(
            (address_attempts + j) * step,
            "POST",
            "login-email",
            path=f"{API}/dashboard/sessions",
            headers=(*headers, (FORWARDED_FOR, f"192.0.2.{20 + j}")),
            body=body({"email": user.email, "password": "synthetic-wrong-password"}),
            unit=address_attempts + j,
        )
