"""Scenario `lists-import` (Workflow 7B (e)): One 100,000-row CSV per kind (email address, phone
number, name, IP address) a take, rows a second at low load; reported.
"""

from __future__ import annotations

import base64
from collections.abc import Iterator

from driver import Answer, FollowUp, PlannedRequest
from scenarios.common import API, api_headers, body, member, pick, poll, succeeded
from scenarios.seed import Seed
from scenarios.spec import PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="lists-import",
    contract="Workflow 7B (e)",
    owner="calibration-load-11d",
    budget=None,
    expected_statuses=frozenset({200, 201, 202}),
    loads=(PolicyLoad("importers", 4, 12 / 3600),),
    environments=("load-s13 sandbox", "load-s14 sandbox", "load-s15 sandbox", "load-s16 sandbox"),
    addresses=0,
    address_range=None,
    deliberately_over=False,
)

#: The importer route of each kind the take loads (the method: email address, phone number, name,
#: IP address).
KINDS = ("email-addresses", "phone-numbers", "names", "ip-addresses")
POLL_SECONDS = 2.0
POLL_ATTEMPTS = 900


#: Fictional numbers only: ACMA's Australian mobile block (+61 491 570 000 to 579 999), then Ofcom's
#: drama blocks (+44 1xx 496 0xxx for the area codes 1[1-6][1-8], +44 20 7946 0xxx, +44 7700 900xxx,
#: +44 1632 960xxx), 63,000 numbers in all (the PII scan's allowlist names each block).
_OFCOM_AREAS = [f"1{a}{b}4960" for a in range(1, 7) for b in range(1, 9)] + [
    "2079460",
    "7700900",
    "1632960",
]
ACMA_NUMBERS = 10_000
FICTIONAL_PHONES = ACMA_NUMBERS + 1000 * len(_OFCOM_AREAS)


def fictional_phone(n: int) -> str:
    """The `n`th fictional number (cycling past `FICTIONAL_PHONES`)."""
    n %= FICTIONAL_PHONES
    if n < ACMA_NUMBERS:
        return f"+61491{570_000 + n}"
    block, line = divmod(n - ACMA_NUMBERS, 1000)
    return f"+44{_OFCOM_AREAS[block]}{line:03d}"


def csv_rows(kind: str, rows: int, take: int) -> bytes:
    """A synthetic CSV of `rows` `kind` items in the importer's columns (docs/lists/importers.md):
    emails at example.com, fictional numbers (rotated by the take, so no two takes upload the same
    file, which the importer would answer from its earlier import), the generators' names, and
    addresses of the documentation range (rule 9)."""
    lines: list[str]
    if kind == "email-addresses":
        lines = ["value,match_type"] + [f"import-{take}-{i}@example.com," for i in range(rows)]
    elif kind == "phone-numbers":
        lines = ["value"] + [fictional_phone(i + take * 7919) for i in range(rows)]
    elif kind == "names":
        lines = ["name_first,name_last"] + [
            f"Importfirst{i % 1999},Importlast{take}x{i}" for i in range(rows)
        ]
    else:
        lines = ["value"] + [f"2001:db8:{0x4E00 + take % 256:x}::{i:x}" for i in range(rows)]
    return ("\n".join(lines) + "\n").encode()


#: An import's terminal statuses.
TERMINAL = frozenset({"ready", "errored"})


def done(answer: Answer) -> bool:
    return member(answer, "data", "attributes", "status") in TERMINAL


def plan(
    seed: Seed,
    rate_per_s: float = 0.0,
    duration_s: float = 0.0,
    *,
    offset: int = 0,
    rows: int = 100_000,
) -> Iterator[PlannedRequest]:
    """One import per kind, a minute apart, at low load: a CSV of `rows` rows through the importer
    route and the `list-import` job, polled until the import ends (rows a second = rows / time)."""
    keys = seed.pool("lists-import")
    for i, kind in enumerate(KINDS):
        key = pick(keys, offset + i)
        payload = {
            "data": {
                "attributes": {
                    "list-id": seed.ref(f"import-list:{kind}:{key.environment}"),
                    "file": base64.b64encode(csv_rows(kind, rows, offset)).decode("ascii"),
                    "mode": "skip-invalid",
                }
            }
        }

        def after_submit(answer: Answer, key=key, n=offset + i) -> FollowUp | None:  # type: ignore[no-untyped-def]
            importer = member(answer, "data", "id")
            if not succeeded(answer) or importer is None:
                return None

            def request() -> PlannedRequest:
                return PlannedRequest(
                    0.0,
                    "GET",
                    "imported",
                    path=f"{API}/importers/{importer}",
                    headers=api_headers(key),
                    unit=n,
                )

            return poll(request, done, every_seconds=POLL_SECONDS, attempts=POLL_ATTEMPTS)(
                Answer(200, b"{}")
            )

        yield PlannedRequest(
            60.0 * i,
            "POST",
            "import",
            path=f"{API}/importer/list-item/{kind}",
            headers=api_headers(key, json_body=True),
            body=body(payload),
            unit=offset + i,
            then=after_submit,
        )
