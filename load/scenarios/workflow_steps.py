"""Scenario `workflow-steps` (C269.1): apps/api/scripts/workflow-benchmark.ts --runs=200
--clients=1,8,32 on its own Testcontainers Postgres; reported beside the executor's own figures.
"""

from __future__ import annotations

from collections.abc import Iterator

from driver import PlannedRequest
from scenarios.seed import Seed
from scenarios.spec import ScenarioSpec

SPEC = ScenarioSpec(
    id="workflow-steps",
    contract="C269.1",
    owner="calibration-load-11d",
    budget=None,
    expected_statuses=frozenset(),
    loads=(),
    environments=(),
    addresses=0,
    address_range=None,
    deliberately_over=False,
)


def command(runs: int = 200, clients: str = "1,8,32") -> list[str]:
    """The executor's benchmark on its own Testcontainers Postgres (never the load stack):
    reported beside the executor's own figures, never beside pgbench's."""
    return [
        "pnpm",
        "--filter",
        "@openverify/api",
        "exec",
        "tsx",
        "--conditions=@openverify/source",
        "scripts/workflow-benchmark.ts",
        f"--runs={runs}",
        f"--clients={clients}",
    ]


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """Not an HTTP scenario: `command()` runs it."""
    raise ValueError("workflow-steps is the executor's benchmark: run command(), not the driver")
