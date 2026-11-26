"""Scenario `transactions-write` (Workflow 7B (g)): POST /api/v1/transactions against a published
type with three searchable fields at 50/s (top 200/s); reported.
"""

from __future__ import annotations

from collections.abc import Iterator

from driver import PlannedRequest
from scenarios.common import API, api_headers, arrivals, body, pick
from scenarios.seed import Seed
from scenarios.spec import PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="transactions-write",
    contract="Workflow 7B (g)",
    owner="calibration-load-11d",
    budget=None,
    expected_statuses=frozenset({201}),
    loads=(PolicyLoad("api", 80, 200.0),),
    environments=("load-b sandbox",),
    addresses=0,
    address_range=None,
    deliberately_over=False,
)

#: The published type's three searchable fields (seed:load's `Load payment` type in load-b
#: sandbox, apps/api/src/seed/load/lists.ts `LOAD_TRANSACTION_FIELDS`).
FIELDS = ("payer_email", "card_fingerprint", "merchant_id")


def fields(n: int) -> dict[str, str]:
    """A transaction's synthetic field values (one HMAC each on write: C114)."""
    return {
        "payer_email": f"payer-{n % 50000}@example.com",
        "card_fingerprint": f"fp{n % 20000:014d}",
        "merchant_id": f"merchant-{n % 500}",
    }


def plan(
    seed: Seed, rate_per_s: float, duration_s: float, *, offset: int = 0
) -> Iterator[PlannedRequest]:
    """The requests one take of `transactions-write` sends."""
    keys = seed.pool("transactions-write")
    type_id = seed.ref("transaction-type:load-b")
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        n = offset + i
        payload = {
            "data": {
                "type": "transaction",
                "attributes": {
                    "transaction-type-id": type_id,
                    "reference-id": f"load-txn-{n}",
                    "fields": fields(n),
                },
            }
        }
        yield PlannedRequest(
            at,
            "POST",
            "create",
            path=f"{API}/transactions",
            headers=api_headers(pick(keys, n), json_body=True),
            body=body(payload),
            unit=n,
        )
