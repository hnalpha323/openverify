"""`limits.LIMITS` mirrors the shipped limits (C268.3): each rate policy as
packages/contracts/src/rate-limits.ts holds it, and the login limiter's two windows as
apps/api/src/operator-auth/login-rate-limiter.ts holds them."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from limits import LIMITS, MAX_SHARE, Limit

REPO = Path(__file__).resolve().parents[2]
RATE_LIMITS = REPO / "packages" / "contracts" / "src" / "rate-limits.ts"
LOGIN = REPO / "apps" / "api" / "src" / "operator-auth" / "login-rate-limiter.ts"


def object_body(source: str, name: str) -> str:
    start = source.index(f"export const {name} = Object.freeze({{")
    return source[start : source.index("} as const", start)]


def entries(body: str) -> dict[str, str]:
    pattern = re.compile(r"^\s+'?([a-z][a-z-]*)'?: ([A-Z_0-9]+|[0-9_]+),$", re.MULTILINE)
    return dict(pattern.findall(body))


def shipped() -> dict[str, Limit]:
    source = RATE_LIMITS.read_text(encoding="utf-8")
    window = int(re.search(r"RATE_LIMIT_WINDOW_SECONDS = (\d+);", source).group(1))  # type: ignore[union-attr]
    defaults = entries(object_body(source, "RATE_LIMIT_DEFAULTS"))
    windows = entries(object_body(source, "RATE_LIMIT_POLICY_WINDOWS"))
    out: dict[str, Limit] = {}
    for policy, value in defaults.items():
        seconds = windows[policy]
        out[policy] = Limit(
            int(value.replace("_", "")),
            window if seconds == "RATE_LIMIT_WINDOW_SECONDS" else int(seconds.replace("_", "")),
        )
    return out


@pytest.mark.parametrize("policy", sorted(name for name in LIMITS if not name.startswith("login-")))
def test_each_rate_policy_is_the_shipped_one(policy: str) -> None:
    assert LIMITS[policy] == shipped()[policy]


def test_the_login_limiter_is_the_shipped_one() -> None:
    source = LOGIN.read_text(encoding="utf-8")
    assert "const FIFTEEN_MINUTES = 15 * 60 * 1000;" in source
    per_ip = re.search(r"perIp: Object\.freeze\(\{ max: (\d+), windowMs: FIFTEEN_MINUTES", source)
    per_email = re.search(
        r"perEmail: Object\.freeze\(\{ max: (\d+), windowMs: FIFTEEN_MINUTES", source
    )
    assert per_ip is not None
    assert per_email is not None
    assert LIMITS["login-per-address"] == Limit(int(per_ip.group(1)), 900)
    assert LIMITS["login-per-email"] == Limit(int(per_email.group(1)), 900)


def test_a_limit_s_rate_and_the_spread_rule() -> None:
    assert Limit(300, 60).per_second == 5.0
    assert MAX_SHARE == 0.5
