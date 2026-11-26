"""Scenario `connect-redeem` (C269.1; C240.3): Redeem an inquiry with three verifications and six
files at 5 redemptions/s (top 10/s) over 20 destination keys of one destination environment; the
API answer's p95 within 300 ms.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, datetime

from driver import Answer, FollowUp, PlannedRequest
from scenarios.common import API, api_headers, arrivals, body, member, pick, poll, succeeded
from scenarios.seed import Key, Seed
from scenarios.spec import Budget, PolicyLoad, ScenarioSpec

SPEC = ScenarioSpec(
    id="connect-redeem",
    contract="C269.1; C240.3",
    owner="calibration-load-11d",
    budget=Budget("p95", "<=", 5, "s"),
    expected_statuses=frozenset({200, 201, 202}),
    loads=(
        PolicyLoad("connect-redeem", 20, 10.0),
        PolicyLoad("api", 8, 10.0),
    ),
    environments=("load-a sandbox", "load-b sandbox"),
    addresses=0,
    address_range=None,
    deliberately_over=False,
)

POLL_SECONDS = 0.5
POLL_ATTEMPTS = 120
#: What both consent records cover: the policy's shared categories, attested (C234; the load
#: connection's policy accepts attested consent for non-biometric shares).
CATEGORIES = ("identity-fields", "check-results")
CONSENT_SECONDS = 86_400


#: A share token's terminal statuses.
TERMINAL = frozenset({"redeemed", "failed", "expired"})


def redeemed(answer: Answer) -> bool:
    return member(answer, "data", "attributes", "status") in TERMINAL


def consent(side: str, connection: str, subject: tuple[str, str], at: str) -> bytes:
    """An attested consent record of one side (C234): the source's about its inquiry, the
    destination's about the share token. Synthetic text and evidence reference only."""
    return body(
        {
            "data": {
                "type": "consent-record",
                "attributes": {
                    "side": side,
                    "connection-id": connection,
                    subject[0]: subject[1],
                    "data-categories": list(CATEGORIES),
                    "explicit-biometric": False,
                    "expires-in-seconds": CONSENT_SECONDS,
                    "evidence-reference": f"load-{side}-consent",
                    "attested-at": at,
                    "text-locale": "en",
                    "text-body": "Synthetic load consent text.",
                },
            }
        }
    )


def plan(
    seed: Seed,
    rate_per_s: float,
    duration_s: float,
    *,
    offset: int = 0,
    now: Callable[[], str] = lambda: datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
) -> Iterator[PlannedRequest]:
    """Redemptions at `rate_per_s`: a source key (`load-a` sandbox) attests its consent for one of
    the source inquiries and creates a share token citing it; a destination key (`load-b` sandbox)
    attests its consent for that token and redeems it (the API answer, 202), then polls the token
    until the job settles it (the job's time). A consent record is cited by one token only, so
    each redemption attests its own (C232.4)."""
    sources = seed.id_pool("connect-source-inquiries")
    connection = seed.ref("connect-connection")
    #: The clone's template in the destination organisation (the redemption makes an inquiry there).
    template = seed.ref("template:load-b")
    source_keys = seed.pool("connect-source")
    destination_keys = seed.pool("connect-destination")
    for i, at in enumerate(arrivals(rate_per_s, duration_s)):
        n = offset + i
        source_key = pick(source_keys, n)
        destination = pick(destination_keys, n)
        inquiry = pick(sources, n)

        def after_source_consent(
            answer: Answer,
            source_key: Key = source_key,
            destination: Key = destination,
            inquiry: str = inquiry,
            n: int = n,
        ) -> FollowUp | None:
            record = member(answer, "data", "id")
            if not succeeded(answer) or record is None:
                return None
            create = {
                "data": {
                    "type": "connect/share-token",
                    "attributes": {
                        "connection-id": connection,
                        "source-id": inquiry,
                        "consent-record-id": record,
                    },
                }
            }

            def after_share(shared: Answer) -> FollowUp | None:
                token = member(shared, "data", "id")
                if not succeeded(shared) or token is None:
                    return None

                def after_destination_consent(attested: Answer) -> FollowUp | None:
                    destination_record = member(attested, "data", "id")
                    if not succeeded(attested) or destination_record is None:
                        return None
                    redeem = {
                        "data": {"type": "connect/share-token", "attributes": {}},
                        "meta": {
                            "destination-consent-record-id": destination_record,
                            "inquiry-template-id": template,
                        },
                    }

                    def request() -> PlannedRequest:
                        return PlannedRequest(
                            0.0,
                            "GET",
                            "redeemed",
                            path=f"{API}/connect/share-tokens/{token}",
                            headers=api_headers(destination),
                            unit=n,
                        )

                    polling = poll(
                        request, redeemed, every_seconds=POLL_SECONDS, attempts=POLL_ATTEMPTS
                    )
                    return FollowUp(
                        PlannedRequest(
                            0.0,
                            "POST",
                            "redeem",
                            path=f"{API}/connect/share-tokens/{token}/redeem",
                            headers=api_headers(destination, json_body=True),
                            body=body(redeem),
                            unit=n,
                            then=polling,
                        )
                    )

                return FollowUp(
                    PlannedRequest(
                        0.0,
                        "POST",
                        "destination-consent",
                        path=f"{API}/connect/consent-records",
                        headers=api_headers(destination, json_body=True),
                        body=consent("destination", connection, ("share-token-id", token), now()),
                        unit=n,
                        then=after_destination_consent,
                    )
                )

            return FollowUp(
                PlannedRequest(
                    0.0,
                    "POST",
                    "share",
                    path=f"{API}/connect/share-tokens",
                    headers=api_headers(source_key, json_body=True),
                    body=body(create),
                    unit=n,
                    then=after_share,
                )
            )

        yield PlannedRequest(
            at,
            "POST",
            "source-consent",
            path=f"{API}/connect/consent-records",
            headers=api_headers(source_key, json_body=True),
            body=consent("source", connection, ("subject-id", inquiry), now()),
            unit=n,
            then=after_source_consent,
        )
