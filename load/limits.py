"""The shipped limits the load scenarios stay under (C268.3; reviews H10, F06, V11).

Mirrors of `packages/contracts/src/rate-limits.ts` (`RATE_LIMIT_DEFAULTS` and
`RATE_LIMIT_POLICY_WINDOWS`) and of the console's login limiter
(`apps/api/src/operator-auth/login-rate-limiter.ts`), for the policies a scenario meets; a test
holds each equal to its source. No scenario raises a limit (the load override raises none).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Limit:
    """A limit of `requests` per `window_seconds` for one principal."""

    requests: int
    window_seconds: int

    @property
    def per_second(self) -> float:
        return self.requests / self.window_seconds


#: The rate policies (by their name in rate-limits.ts) and the login limiter's two windows.
LIMITS: dict[str, Limit] = {
    "api": Limit(300, 60),
    "flow-session": Limit(120, 60),
    "flow-ip": Limit(600, 60),
    "flow-signals": Limit(60, 60),
    "flow-integrity": Limit(5, 3600),
    "reports": Limit(600, 60),
    "connect-redeem": Limit(60, 60),
    "account-export": Limit(10, 3600),
    "importers": Limit(10, 3600),
    "lists-match": Limit(60, 60),
    "graph-queries": Limit(30, 60),
    "login-per-address": Limit(50, 900),
    "login-per-email": Limit(10, 900),
}

#: The share of a limit any principal may use at a scenario's top step (the method's spread rule).
MAX_SHARE = 0.5
