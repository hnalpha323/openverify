"""Each polled resource ends on its own vocabulary (the smoke run polled an import forever: the
importer ends `ready`, not `completed`): every scenario's terminal statuses are read against the
status lists the API packages declare, so a poll stops on every terminal status and on no other."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from scenarios import (
    account_export,
    connect_redeem,
    graph_queries,
    lists_import,
    screening_throughput,
    verification,
)

REPO = Path(__file__).resolve().parents[2]


def declared(path: str, name: str) -> set[str]:
    text = (REPO / path).read_text(encoding="utf-8")
    match = re.search(rf"export const {name} = (?:Object\.freeze\()?\[(.*?)\]", text, re.DOTALL)
    assert match is not None, name
    return set(re.findall(r"'([a-z_]+)'", match.group(1)))


CASES = [
    (lists_import.TERMINAL, "packages/core/src/lists.ts", "IMPORTER_STATUSES", {"pending"}),
    (
        account_export.TERMINAL,
        "packages/contracts/src/account-exports.ts",
        "ACCOUNT_EXPORT_STATUSES",
        {"pending"},
    ),
    (
        connect_redeem.TERMINAL,
        "packages/contracts/src/connect.ts",
        "SHARE_TOKEN_STATUSES",
        {"created", "pending"},
    ),
    (
        graph_queries.TERMINAL,
        "packages/core/src/graph-queries.ts",
        "GRAPH_QUERY_STATUSES",
        {"submitted"},
    ),
    (
        screening_throughput.SETTLED,
        "packages/core/src/report-state-machine.ts",
        "REPORT_STATUSES",
        {"pending", "submitted"},
    ),
    (
        verification.DECIDED,
        "packages/core/src/enums.ts",
        "VERIFICATION_STATUSES",
        {"initiated", "confirmed", "submitted"},
    ),
]


@pytest.mark.parametrize(
    ("terminal", "path", "name", "open_statuses"), CASES, ids=[c[2] for c in CASES]
)
def test_a_poll_stops_on_every_terminal_status_and_no_other(
    terminal: frozenset[str], path: str, name: str, open_statuses: set[str]
) -> None:
    assert set(terminal) == declared(path, name) - open_statuses
