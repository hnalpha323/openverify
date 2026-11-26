"""C269: one module per scenario of the method (docs/calibration/load-phase11.md)."""

from __future__ import annotations

import importlib
from types import ModuleType

from scenarios import (
    account_export,
    api_reads,
    api_writes,
    connect_redeem,
    console_login,
    fairness,
    flow_upload,
    graph_queries,
    limiter_refusal,
    lists_import,
    lists_match,
    screening_throughput,
    soak,
    transactions_search,
    transactions_write,
    verification,
    webhook_first_attempt,
    workflow_steps,
)
from scenarios.spec import ScenarioSpec

#: Every scenario, by its id (the method's and the summary block's).
SCENARIOS: dict[str, ScenarioSpec] = {
    api_reads.SPEC.id: api_reads.SPEC,
    api_writes.SPEC.id: api_writes.SPEC,
    flow_upload.SPEC.id: flow_upload.SPEC,
    console_login.SPEC.id: console_login.SPEC,
    verification.SPEC.id: verification.SPEC,
    webhook_first_attempt.SPEC.id: webhook_first_attempt.SPEC,
    screening_throughput.SPEC.id: screening_throughput.SPEC,
    connect_redeem.SPEC.id: connect_redeem.SPEC,
    account_export.SPEC.id: account_export.SPEC,
    fairness.SPEC.id: fairness.SPEC,
    soak.SPEC.id: soak.SPEC,
    limiter_refusal.SPEC.id: limiter_refusal.SPEC,
    lists_import.SPEC.id: lists_import.SPEC,
    lists_match.SPEC.id: lists_match.SPEC,
    graph_queries.SPEC.id: graph_queries.SPEC,
    transactions_write.SPEC.id: transactions_write.SPEC,
    transactions_search.SPEC.id: transactions_search.SPEC,
    workflow_steps.SPEC.id: workflow_steps.SPEC,
}


def module_of(scenario: str) -> ModuleType:
    """The module of a scenario id (`api-reads` is `scenarios.api_reads`)."""
    if scenario not in SCENARIOS:
        raise KeyError(f"unknown scenario {scenario}")
    return importlib.import_module(f"scenarios.{scenario.replace('-', '_')}")


__all__ = ["SCENARIOS", "ScenarioSpec", "module_of"]
