"""A load scenario's specification (C269.1; C268.3's spread).

Each module of this package holds one scenario of the method (docs/calibration/load-phase11.md):
its `SPEC` (the data the method fixed before any take) and its `plan` (the requests one take sends,
built by Workflow 11D's load-harness on the driver's interface).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from limits import LIMITS


@dataclass(frozen=True, slots=True)
class PolicyLoad:
    """At the scenario's top step, `rate_per_s` requests a second counted by `policy` spread over
    `principals` (keys, sessions, users, addresses or environments: whatever the policy keys on)."""

    policy: str
    principals: int
    rate_per_s: float

    def share(self) -> float:
        """The share of its limit each principal uses at the top step (KeyError for a policy
        `limits.LIMITS` does not hold)."""
        return (self.rate_per_s / self.principals) / LIMITS[self.policy].per_second


@dataclass(frozen=True, slots=True)
class Budget:
    """A C269.1 budget: `metric` (p95, median, mean, max, rate, ratio or growth), `comparison`,
    `value` and `unit`."""

    metric: str
    comparison: str
    value: float
    unit: str


@dataclass(frozen=True, slots=True)
class ScenarioSpec:
    """What the method fixed for one scenario."""

    id: str
    contract: str
    owner: str
    budget: Budget | None
    expected_statuses: frozenset[int]
    loads: tuple[PolicyLoad, ...]
    environments: tuple[str, ...]
    addresses: int = 0
    address_range: str | None = None
    #: The limiter-refusal scenario goes past its limits by design (429 expected).
    deliberately_over: bool = False
    notes: tuple[str, ...] = field(default=())

    def check_policies(self) -> list[str]:
        """The policies this scenario names that `limits.LIMITS` does not hold."""
        return sorted({load.policy for load in self.loads} - set(LIMITS))
