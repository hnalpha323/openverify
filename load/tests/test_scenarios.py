"""The scenarios hold the method's table (docs/calibration/load-phase11.md; C268.3, C269.1): one
module per scenario id, the shipped limits only, every principal at most at half its limit at the
scenario's top step (except `limiter-refusal`, which goes past them by design), and each plan's
requests, run through the driver against a fake API over a fake clock."""

from __future__ import annotations

import asyncio
import importlib
import json
import re
from collections import Counter
from pathlib import Path

import httpx
import pytest

from driver import Answer, OpenModelDriver, Outcome, PlannedRequest
from driver.clock import FakeClock
from limits import MAX_SHARE
from scenarios import SCENARIOS, fairness, module_of
from scenarios.limiter_refusal import login_plan
from scenarios.lists_import import csv_rows
from scenarios.screening_throughput import settled_ms
from scenarios.spec import PolicyLoad, ScenarioSpec
from scenarios.workflow_steps import command
from tests.fixtures import synthetic_seed

REPO = Path(__file__).resolve().parents[2]
METHOD = REPO / "docs" / "calibration" / "load-phase11.md"
SPECS = sorted(SCENARIOS.values(), key=lambda spec: spec.id)
HTTP_SCENARIOS = sorted(set(SCENARIOS) - {"workflow-steps"})


def method_ids() -> set[str]:
    text = METHOD.read_text(encoding="utf-8")
    method = text[: text.index("## Results")]
    return set(re.findall(r"^\| `([a-z0-9-]+)` \|", method, re.MULTILINE))


def test_every_scenario_of_the_method_has_its_module() -> None:
    assert method_ids() <= set(SCENARIOS) | {"soak"}
    assert {"soak", "workflow-steps"} <= set(SCENARIOS)


@pytest.mark.parametrize("spec", SPECS, ids=lambda spec: spec.id)
def test_each_scenario_is_its_module_s(spec: ScenarioSpec) -> None:
    module = importlib.import_module(f"scenarios.{spec.id.replace('-', '_')}")
    assert module.SPEC is spec
    assert module_of(spec.id) is module
    assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", spec.id)
    assert spec.owner == "calibration-load-11d"
    assert spec.check_policies() == []


def test_an_unknown_scenario_has_no_module() -> None:
    with pytest.raises(KeyError):
        module_of("no-such-scenario")


@pytest.mark.parametrize(
    "spec", [spec for spec in SPECS if not spec.deliberately_over], ids=lambda spec: spec.id
)
def test_every_principal_stays_at_half_its_limit_at_the_top_step(spec: ScenarioSpec) -> None:
    for load in spec.loads:
        assert load.share() <= MAX_SHARE, (spec.id, load.policy, load.share())


def test_the_refusal_scenario_goes_past_its_limits() -> None:
    spec = SCENARIOS["limiter-refusal"]
    assert spec.deliberately_over
    assert 429 in spec.expected_statuses
    assert max(load.share() for load in spec.loads) > 1.0


def test_a_policy_load_s_share() -> None:
    assert PolicyLoad("api", 160, 400.0).share() == 0.5
    assert PolicyLoad("connect-redeem", 20, 10.0).share() == 0.5
    assert PolicyLoad("login-per-email", 4000, 20.0).share() == pytest.approx(0.45)


def test_an_unknown_policy_is_named() -> None:
    spec = ScenarioSpec(
        id="x",
        contract="test",
        owner="calibration-load-11d",
        budget=None,
        expected_statuses=frozenset({200}),
        loads=(PolicyLoad("no-such-policy", 1, 1.0),),
        environments=(),
    )
    assert spec.check_policies() == ["no-such-policy"]
    with pytest.raises(KeyError):
        spec.loads[0].share()


def test_the_documentation_ranges_only() -> None:
    allowed = ("192.0.2.", "198.51.100.", "203.0.113.", "2001:db8:")
    for spec in SPECS:
        if spec.address_range is not None:
            assert spec.address_range.startswith(allowed), spec.id


# ------------------------------------------------------------------ the plans, run ----

ANSWERS: list[tuple[str, str, int, object]] = [
    ("POST", r"/inquiries/[^/]+/resume$", 200, {"meta": {"session-token": "synthetic-session"}}),
    ("POST", r"/flow/integrity-challenges$", 201, {"id": "ich_synthetic"}),
    ("POST", r"/flow/integrity-tokens$", 202, None),
    ("POST", r"/flow/verifications$", 201, {"data": {"id": "ver_synthetic"}}),
    ("POST", r"/flow/verifications/[^/]+/files$", 201, {}),
    ("POST", r"/flow/verifications/[^/]+/submit$", 200, {}),
    ("GET", r"/flow/verifications/[^/]+$", 200, {"data": {"attributes": {"status": "passed"}}}),
    ("POST", r"/flow/consent$", 201, {}),
    ("POST", r"/flow/signals$", 202, None),
    ("GET", r"/flow/session$", 200, {}),
    ("POST", r"/dashboard/sessions$", 202, {"mfa-token": "ovm_synthetic"}),
    ("POST", r"/dashboard/sessions/mfa$", 201, {}),
    ("POST", r"/reports$", 201, {"data": {"id": "rep_synthetic"}}),
    ("GET", r"/reports/[^/]+$", 200, {"data": {"attributes": {"status": "ready"}}}),
    ("POST", r"/accounts/[^/]+/export$", 202, {"data": {"id": "acx_synthetic"}}),
    ("GET", r"/account-exports/[^/]+$", 200, {"data": {"attributes": {"status": "ready"}}}),
    ("POST", r"/connect/consent-records$", 201, {"data": {"id": "cnsr_synthetic"}}),
    ("POST", r"/connect/share-tokens$", 201, {"data": {"id": "cnst_synthetic"}}),
    ("POST", r"/connect/share-tokens/[^/]+/redeem$", 202, {}),
    ("GET", r"/connect/share-tokens/[^/]+$", 200, {"data": {"attributes": {"status": "redeemed"}}}),
    ("POST", r"/importer/list-item/[a-z-]+$", 201, {"data": {"id": "mprt_synthetic"}}),
    ("GET", r"/importers/[^/]+$", 200, {"data": {"attributes": {"status": "ready"}}}),
    ("POST", r"/graph-queries$", 201, {"data": {"id": "grphq_synthetic"}}),
    ("GET", r"/graph-queries/[^/]+$", 200, {"data": {"attributes": {"status": "completed"}}}),
    ("POST", r"/inquiries$", 201, {}),
    ("POST", r"/transactions$", 201, {}),
]


def fake_api(seen: list[httpx.Request]) -> httpx.MockTransport:
    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        for method, pattern, status, payload in ANSWERS:
            if request.method == method and re.search(pattern, request.url.path):
                return (
                    httpx.Response(status, json=payload)
                    if payload is not None
                    else httpx.Response(status)
                )
        return httpx.Response(200, json={})

    return httpx.MockTransport(handler)


def run(schedule: list[PlannedRequest]) -> tuple[list[Outcome], list[httpx.Request]]:
    clock = FakeClock()
    seen: list[httpx.Request] = []
    driver = OpenModelDriver(
        "http://load.test", transport=fake_api(seen), clock=clock, cpu_seconds=lambda: 0.0
    )
    take = asyncio.run(clock.run(driver.take(schedule)))
    return take.outcomes, seen


def plan_of(scenario: str, rate: float, duration: float, **kwargs: object) -> list[PlannedRequest]:
    return list(module_of(scenario).plan(synthetic_seed(), rate, duration, **kwargs))


@pytest.mark.parametrize("scenario", HTTP_SCENARIOS)
def test_each_http_plan_runs_with_its_expected_statuses(scenario: str) -> None:
    rate = {"console-login": 0.2, "fairness": 1.0}.get(scenario, 2.0)
    kwargs: dict[str, object] = {"flood_runs": 5} if scenario == "fairness" else {}
    schedule = plan_of(scenario, rate, 3.0, **kwargs)
    assert schedule, scenario
    assert [r.at_seconds for r in schedule] == sorted(r.at_seconds for r in schedule)
    outcomes, seen = run(schedule)
    expected = SCENARIOS[scenario].expected_statuses
    assert all(o.status in expected for o in outcomes), (
        scenario,
        Counter(o.status for o in outcomes),
    )
    assert all(r.url.path.startswith("/api/v1/") for r in seen)


def test_the_reads_are_one_third_each_spread_over_keys_and_addresses() -> None:
    schedule = plan_of("api-reads", 30.0, 1.0)
    assert len(schedule) == 30
    assert Counter(r.step for r in schedule) == {"inquiry": 10, "account": 10, "list": 10}
    headers = [dict(r.headers) for r in schedule]
    assert len({h["authorization"] for h in headers}) == 4
    assert all(h["x-forwarded-for"].startswith("198.51.100.") for h in headers)


def test_the_writes_follow_the_method_s_shares_and_use_each_review_once() -> None:
    schedule = plan_of("api-writes", 20.0, 2.0)
    assert Counter(r.step for r in schedule) == {
        "create": 16,
        "update": 8,
        "tag": 8,
        "approve": 4,
        "decline": 4,
    }
    decided = [r.path for r in schedule if r.step in {"approve", "decline"}]
    assert len(decided) == len({p.rsplit("/", 1)[0] for p in decided})
    later = [r.path for r in plan_of("api-writes", 20.0, 2.0, offset=40) if r.step == "approve"]
    assert not set(later) & set(decided)
    with pytest.raises(ValueError, match="used up"):
        plan_of("api-writes", 100.0, 10.0)


def test_a_flow_session_uploads_twice_within_upload_limits() -> None:
    outcomes, seen = run(plan_of("flow-upload", 2.0, 1.0))
    unit = [o.step for o in outcomes if o.unit == 0]
    assert unit == [
        "resume",
        "session",
        "consent",
        "signals",
        "integrity-challenge",
        "integrity-token",
        "verification",
        "upload",
        "upload",
        "signals",
    ]
    uploads = [r for r in seen if r.url.path.endswith("/files")]
    assert len(uploads) == 2
    body = uploads[0].content
    assert body.count(b"Content-Disposition") <= 8
    for field in (
        b'name="kind"',
        b'name="capture-trigger"',
        b'name="capture-method"',
        b'name="file"',
    ):
        assert field in body
    assert 900_000 < len(body) < 3_200_000
    flow = [r for r in seen if "/flow/" in r.url.path]
    assert all(r.headers["authorization"] == "Bearer synthetic-session" for r in flow)
    assert all(r.headers["x-forwarded-for"].startswith("203.0.113.") for r in flow)
    consent = json.loads(next(r.content for r in seen if r.url.path.endswith("/consent")))
    assert "notice.play-integrity" in consent["text-keys"]
    with pytest.raises(ValueError, match="used up"):
        plan_of("flow-upload", 200.0, 10.0)


def test_a_verification_is_submitted_and_polled_to_its_decision() -> None:
    outcomes, _ = run(plan_of("verification", 1.0, 1.0))
    steps = [o.step for o in outcomes]
    assert steps[-2:] == ["submit", "decided"]


def test_a_verification_submits_and_polls_from_its_session_s_address() -> None:
    """calibration-load-11d's followup: the submit and the polls count against `flow-ip` per
    client address, so each carries the session's documentation address, never the gateway's."""
    _, seen = run(plan_of("verification", 1.0, 1.0))
    addresses = {
        request.url.path.rsplit("/", 1)[-1]
        if request.method == "POST"
        else "poll": request.headers.get("x-forwarded-for")
        for request in seen
        if "/flow/verifications/" in request.url.path and not request.url.path.endswith("/files")
    }
    session = {r.headers.get("x-forwarded-for") for r in seen if r.url.path.endswith("/files")}
    assert len(session) == 1
    assert addresses == {"submit": next(iter(session)), "poll": next(iter(session))}


def test_the_login_address_half_uses_one_email_per_attempt() -> None:
    """calibration-load-11d's followup: one probe email would be refused by its own bucket from the
    11th attempt; one email per attempt lets the per-address bucket refuse from the 51st."""
    logins = [r for r in login_plan(synthetic_seed()) if r.step == "login-address"]
    emails = {json.loads(r.body or b"{}")["email"] for r in logins}
    assert len(emails) == len(logins) == 60
    assert all(email.endswith("@example.com") for email in emails)


def test_a_sign_in_is_two_steps_from_the_user_s_own_address() -> None:
    outcomes, seen = run(plan_of("console-login", 0.2, 10.0, now=lambda: 0.0))
    assert [o.step for o in outcomes] == ["password", "totp", "password", "totp"]
    totp = json.loads(seen[1].content)
    assert totp == {"mfa-token": "ovm_synthetic", "totp-code": "282760"}
    assert seen[0].headers["x-forwarded-for"] == "2001:db8:4c00::1"
    with pytest.raises(ValueError, match="within 3 minutes"):
        plan_of("console-login", 1.0, 1.0)


def test_the_refusals() -> None:
    api = plan_of("limiter-refusal", 10.0, 60.0)
    assert len(api) == 600
    assert {dict(r.headers)["x-forwarded-for"] for r in api} == {"192.0.2.10"}
    logins = list(login_plan(synthetic_seed()))
    assert Counter(r.step for r in logins) == {"login-address": 60, "login-email": 12}
    assert logins[-1].at_seconds < 900


def test_fairness_without_a_flood_is_the_idle_take() -> None:
    idle = plan_of("fairness", 1.0, 5.0)
    assert Counter(r.step for r in idle) == {"victim": 5}
    flood = plan_of("fairness", 1.0, 5.0, flood_runs=10)
    assert Counter(r.step for r in flood) == {"victim": 5, "flood": 10}
    assert all(r.then is None for r in flood if r.step == "flood")


def test_the_flood_opens_with_a_burst_that_reaches_the_cap() -> None:
    """P001: a flood at 5 a second never exceeds what the worker settles (about 15 a second), so
    it never reaches the cap; it opens with its first 500 runs at 50 a second (inside the reports
    policy's burst, which is its whole limit of 600) and sends the rest at 5 a second."""
    assert (fairness.FLOOD_BURST_RUNS, fairness.FLOOD_BURST_RATE) == (500, 50.0)
    flood = [r for r in plan_of("fairness", 1.0, 450.0, flood_runs=2000) if r.step == "flood"]
    assert len(flood) == 2000
    times = [r.at_seconds for r in flood]
    assert times[499] == pytest.approx(499 / 50.0)
    assert times[500] == pytest.approx(10.0)
    assert times[501] - times[500] == pytest.approx(1 / 5.0)
    assert times[-1] == pytest.approx(10.0 + 1499 / 5.0)
    small = [
        r.at_seconds for r in plan_of("fairness", 1.0, 5.0, flood_runs=10) if r.step == "flood"
    ]
    assert small[-1] == pytest.approx(9 / 50.0)


def test_the_victim_s_settled_poll_measures_the_report_s_own_time() -> None:
    """P001: the victim's figure is the report's created-at to completed-at, read from the
    settled answer, so the 2 s poll does not floor it."""
    ready = {
        "data": {
            "attributes": {
                "status": "ready",
                "created-at": "2026-11-17T10:00:00.000Z",
                "completed-at": "2026-11-17T10:00:00.840Z",
            }
        }
    }
    assert settled_ms(Answer(200, json.dumps(ready).encode())) == pytest.approx(840.0)
    pending = {"data": {"attributes": {"status": "pending", "created-at": "2026-11-17T10:00:00Z"}}}
    assert settled_ms(Answer(200, json.dumps(pending).encode())) is None
    assert settled_ms(Answer(None, b"")) is None


def test_the_soak_mixes_by_the_budget_proportions() -> None:
    steps = Counter(r.step for r in plan_of("soak", 16.0, 5.0))
    assert steps["resume"] == 3  # 1 upload a second: a session every 2 s, at 0, 2 and 4 s
    assert steps["inquiry"] + steps["account"] + steps["list"] == 50


def test_a_graph_query_names_its_template_s_account_parameter() -> None:
    _, seen = run(plan_of("graph-queries", 1.0, 1.0))
    submitted = json.loads(next(r.content for r in seen if r.url.path.endswith("/graph-queries")))
    assert set(submitted["data"]["attributes"]["parameter-map"]) == {"account_id"}


def test_transactions_carry_the_seeded_type_s_searchable_fields() -> None:
    _, seen = run(plan_of("transactions-write", 1.0, 1.0))
    fields = json.loads(seen[0].content)["data"]["attributes"]["fields"]
    assert set(fields) == {"payer_email", "card_fingerprint", "merchant_id"}
    search = plan_of("transactions-search", 1.0, 1.0)[0]
    assert "filter%5Bidentifier%5D%5Bkey%5D=payer_email" in search.path


def test_a_redemption_attests_both_consents_then_redeems_and_polls() -> None:
    outcomes, seen = run(plan_of("connect-redeem", 1.0, 1.0))
    assert [o.step for o in outcomes] == [
        "source-consent", "share", "destination-consent", "redeem", "redeemed",
    ]  # fmt: skip
    source, share, destination = (json.loads(r.content) for r in seen[:3])
    assert source["data"]["attributes"]["side"] == "source"
    assert source["data"]["attributes"]["subject-id"].startswith("inq_")
    assert share["data"]["attributes"]["consent-record-id"] == "cnsr_synthetic"
    assert destination["data"]["attributes"]["side"] == "destination"
    assert destination["data"]["attributes"]["share-token-id"] == "cnst_synthetic"
    redeem = json.loads(seen[3].content)
    assert redeem["meta"] == {
        "destination-consent-record-id": "cnsr_synthetic",
        "inquiry-template-id": "itmpl_syntheticb",
    }


def test_imports_are_one_per_kind_a_minute_apart() -> None:
    schedule = plan_of("lists-import", 0.0, 0.0, rows=3)
    assert [r.path.rsplit("/", 1)[1] for r in schedule] == [
        "email-addresses",
        "phone-numbers",
        "names",
        "ip-addresses",
    ]
    assert [r.at_seconds for r in schedule] == [0.0, 60.0, 120.0, 180.0]
    assert csv_rows("names", 2, 1).splitlines()[0] == b"name_first,name_last"
    assert csv_rows("email-addresses", 2, 1).splitlines() == [
        b"value,match_type",
        b"import-1-0@example.com,",
        b"import-1-1@example.com,",
    ]
    phones = csv_rows("phone-numbers", 70_000, 0).splitlines()[1:]
    assert phones[0] == b"+61491570000"
    assert len(set(phones)) > 60_000
    assert csv_rows("phone-numbers", 3, 1) != csv_rows("phone-numbers", 3, 2)
    assert csv_rows("ip-addresses", 2, 1).splitlines()[1].startswith(b"2001:db8:")


def test_the_workflow_row_is_the_executor_s_benchmark() -> None:
    assert command()[-2:] == ["--runs=200", "--clients=1,8,32"]
    with pytest.raises(ValueError, match="executor"):
        plan_of("workflow-steps", 1.0, 1.0)
