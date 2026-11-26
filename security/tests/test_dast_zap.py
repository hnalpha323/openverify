"""Tests of security/zap/dast-zap.py (C283.2; Workflow 11F, dast-11f).

The helper splits the stack's OpenAPI document into the API scan's groups, keeps the scan's rules
(security/zap/rules.tsv), and renders the committed DAST report from ZAP's raw reports with every
request and response header, evidence, attack and credential removed. The raw report of
fixtures/zap/ is synthetic: it carries an Authorization header, a Cookie and an API key (every
token-shaped value names itself "synthetic", .gitleaks.toml) as the positive control.
No test touches the network or Docker.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "security" / "zap" / "dast-zap.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "zap"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("dast_zap", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["dast_zap"] = module
    spec.loader.exec_module(module)
    return module


dz = _load()

RAW = json.loads((FIXTURES / "raw-report.json").read_text(encoding="utf-8"))
CREDENTIALS = json.loads((FIXTURES / "credentials.json").read_text(encoding="utf-8"))
SECRETS = [
    CREDENTIALS["apiKey"]["token"],
    CREDENTIALS["users"]["api"]["token"],
    CREDENTIALS["users"]["console"]["token"],
    CREDENTIALS["flow"]["sessionToken"],
    CREDENTIALS["handoff"]["token"],
]
TEMPLATES = [
    "/api/v1/inquiries",
    "/api/v1/inquiries/{id}",
    "/api/v1/accounts/{id}/redact",
    "/api/v1/flow/session",
]


def _spec() -> dict[str, Any]:
    def op(
        tag: str, security: list[dict[str, list[str]]] | None = None
    ) -> dict[str, Any]:
        operation: dict[str, Any] = {
            "tags": [tag],
            "responses": {"200": {"description": "ok"}},
        }
        if security is not None:
            operation["security"] = security
        return operation

    handoff_body = {
        "content": {
            "application/json": {
                "schema": {
                    "type": "object",
                    "properties": {
                        "inquiry-id": {"type": "string"},
                        "handoff-token": {"type": "string"},
                        "confirmation-code": {"type": "string"},
                    },
                }
            }
        }
    }
    preview = op("flow")
    preview["requestBody"] = copy.deepcopy(handoff_body)
    return {
        "openapi": "3.0.3",
        "info": {"title": "synthetic", "version": "1"},
        "components": {
            "securitySchemes": {"apiKey": {"type": "http", "scheme": "bearer"}}
        },
        "paths": {
            "/api/v1/inquiries": {"get": op("inquiries"), "post": op("inquiries")},
            "/api/v1/accounts/{id}": {"get": op("accounts")},
            "/api/v1/dashboard/me": {"get": op("dashboard", [{"userSession": []}])},
            "/api/v1/dashboard/sessions": {"post": op("dashboard", [])},
            "/api/v1/dashboard/sessions/current": {
                "delete": op("dashboard", [{"userSession": []}])
            },
            "/api/v1/flow/session": {"get": op("flow", [{"sessionToken": []}])},
            "/api/v1/flow/handoffs/preview": {"post": preview},
        },
    }


GROUPS_TSV = (
    "# group\tauth\ttags\n"
    "server\tapiKey\tinquiries,accounts\n"
    "dashboard\tuserSession\tdashboard\n"
    "flow\tsessionToken\tflow\n"
    "hold\tDELETE /api/v1/dashboard/sessions/current\tit ends the session the scan holds\n"
)


# ------------------------------------------------------------------ rules ----


def test_parse_rules_reads_the_three_actions_and_each_ignore_reason() -> None:
    rules = dz.parse_rules(
        "# id\taction\tname\treason\n"
        "10038\tWARN\t(CSP Header Not Set)\n"
        "40018\tFAIL\t(SQL Injection)\n"
        "10096\tIGNORE\t(Timestamp Disclosure)\tthe API's dates are ISO-8601 by contract (C12)\n"
    )
    assert sorted(rules) == ["10038", "10096", "40018"]
    assert rules["40018"].action == "FAIL"
    assert rules["10096"].reason.startswith("the API's dates")
    assert rules["10038"].reason == ""


@pytest.mark.parametrize(
    "line",
    [
        "10096\tIGNORE\t(Timestamp Disclosure)",
        "10096\tIGNORE\t(Timestamp Disclosure)\t ",
        "10096\tINFO\t(Timestamp Disclosure)",
        "10096\tPASS\t(Timestamp Disclosure)",
        "ten\tWARN\t(Timestamp Disclosure)",
        "10096\tWARN",
        "10096\tWARN\t(a)\treason\textra",
        "10096\tWARN\t",
    ],
)
def test_parse_rules_refuses_a_bad_line(line: str) -> None:
    with pytest.raises(ValueError):
        dz.parse_rules(line + "\n")


def test_parse_rules_refuses_a_rule_twice() -> None:
    with pytest.raises(ValueError, match="10038"):
        dz.parse_rules("10038\tWARN\t(a)\n10038\tFAIL\t(a)\n")


def test_the_committed_rules_file_parses_and_lists_rules() -> None:
    rules = dz.parse_rules(
        (ROOT / "security" / "zap" / "rules.tsv").read_text(encoding="utf-8")
    )
    assert len(rules) >= 100
    assert all(
        rule.reason.strip() for rule in rules.values() if rule.action == "IGNORE"
    )
    assert {rule.action for rule in rules.values()} <= set(dz.ACTIONS)


# ----------------------------------------------------------------- groups ----


def test_split_spec_keeps_each_operation_in_its_group_and_holds_one_out() -> None:
    groups, holds = dz.parse_groups(GROUPS_TSV)
    parts = dz.split_spec(_spec(), groups, holds)
    assert sorted(parts) == ["dashboard", "flow", "server"]
    assert sorted(parts["server"]["paths"]) == [
        "/api/v1/accounts/{id}",
        "/api/v1/inquiries",
    ]
    assert sorted(parts["dashboard"]["paths"]) == [
        "/api/v1/dashboard/me",
        "/api/v1/dashboard/sessions",
    ]
    assert "/api/v1/dashboard/sessions/current" not in parts["dashboard"]["paths"]
    assert parts["server"]["components"] == _spec()["components"]
    assert holds[0].reason == "it ends the session the scan holds"


def test_split_spec_refuses_a_tag_no_group_names() -> None:
    groups, holds = dz.parse_groups(
        GROUPS_TSV.replace("inquiries,accounts", "inquiries")
    )
    with pytest.raises(ValueError, match="accounts"):
        dz.split_spec(_spec(), groups, holds)


def test_split_spec_refuses_an_operation_whose_security_is_not_the_groups() -> None:
    text = GROUPS_TSV.replace("dashboard\tuserSession\tdashboard\n", "").replace(
        "inquiries,accounts", "inquiries,accounts,dashboard"
    )
    groups, holds = dz.parse_groups(text)
    with pytest.raises(ValueError, match="userSession"):
        dz.split_spec(_spec(), groups, holds)


def test_split_spec_refuses_a_hold_that_names_no_operation() -> None:
    groups, holds = dz.parse_groups(
        GROUPS_TSV + "hold\tPOST /api/v1/nowhere\ta reason\n"
    )
    with pytest.raises(ValueError, match="nowhere"):
        dz.split_spec(_spec(), groups, holds)


@pytest.mark.parametrize(
    "text",
    [
        "server\tcookie\tinquiries\n",
        "server\tapiKey\t\n",
        "hold\tDELETE /x\t\n",
        "hold\tDELETE\ta reason\n",
        "server\tapiKey\tinquiries\nserver\tapiKey\taccounts\n",
        "a\tapiKey\tinquiries\nb\tapiKey\tinquiries\n",
        "a\tapiKey\n",
    ],
)
def test_parse_groups_refuses_a_bad_file(text: str) -> None:
    with pytest.raises(ValueError):
        dz.parse_groups(text)


def test_the_committed_groups_cover_the_committed_openapi_document() -> None:
    spec = json.loads(
        (ROOT / "docs" / "api" / "openapi.json").read_text(encoding="utf-8")
    )
    groups, holds = dz.parse_groups(
        (ROOT / "security" / "zap" / "api-groups.tsv").read_text(encoding="utf-8")
    )
    parts = dz.split_spec(spec, groups, holds)
    kept = sum(
        1
        for part in parts.values()
        for item in part["paths"].values()
        for method in item
        if method in dz.METHODS
    )
    total = sum(
        1 for item in spec["paths"].values() for method in item if method in dz.METHODS
    )
    assert kept + len(holds) == total


def test_with_handoff_sets_the_runs_values_on_the_three_public_routes_only() -> None:
    handoff = {
        "inquiry-id": "inq_synthetic",
        "handoff-token": "ovh_synthetic",
        "code": "000000",
    }
    spec = _spec()
    filled = dz.with_handoff(spec, handoff)
    preview = filled["paths"]["/api/v1/flow/handoffs/preview"]["post"]
    props = preview["requestBody"]["content"]["application/json"]["schema"][
        "properties"
    ]
    assert props["inquiry-id"]["example"] == "inq_synthetic"
    assert props["handoff-token"]["default"] == "ovh_synthetic"
    assert props["confirmation-code"]["example"] == "000000"
    original = spec["paths"]["/api/v1/flow/handoffs/preview"]["post"]["requestBody"]
    untouched = original["content"]["application/json"]["schema"]["properties"][
        "inquiry-id"
    ]
    assert "example" not in untouched


# ----------------------------------------------------------------- routes ----


@pytest.mark.parametrize(
    ("uri", "route"),
    [
        ("http://127.0.0.1:1/api/v1/inquiries?page[size]=10", "/api/v1/inquiries"),
        (
            "http://127.0.0.1:1/api/v1/inquiries/inq_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            "/api/v1/inquiries/{id}",
        ),
        (
            "http://127.0.0.1:1/api/v1/accounts/10/redact",
            "/api/v1/accounts/{id}/redact",
        ),
        (
            "http://localhost:2/inquiries/inq_01ARZ3NDEKTSV4RRFFQ69G5FAV/files",
            "/inquiries/{id}/files",
        ),
        ("http://localhost:2/", "/"),
        (
            "http://localhost:2/_next/static/chunks/a1b2c3d4e5f6a7b8.js",
            "/_next/static/chunks/{file}.js",
        ),
        ("http://localhost:2/x#inquiry-id=inq_1&handoff-token=ovh_secret", "/x"),
        ("http://localhost:2/" + "ovs_" + "a" * 43, "/{id}"),
    ],
)
def test_route_template_names_the_route_never_a_concrete_value(
    uri: str, route: str
) -> None:
    assert dz.route_template(uri, TEMPLATES) == route


def test_alerts_from_report_keep_the_rule_route_and_risk_and_nothing_a_request_carried() -> (
    None
):
    alerts = dz.alerts_from_report(RAW, "api-server", TEMPLATES)
    keys = sorted((a.rule_id, a.method, a.route) for a in alerts)
    assert keys == [
        ("10021", "POST", "/api/v1/accounts/{id}/redact"),
        ("10038", "GET", "/api/v1/flow/session"),
        ("10038", "GET", "/api/v1/inquiries/{id}"),
        ("40018", "POST", "/api/v1/inquiries"),
    ]
    sql = next(a for a in alerts if a.rule_id == "40018")
    assert (sql.risk, sql.confidence, sql.param, sql.scan) == (
        3,
        2,
        "reference-id",
        "api-server",
    )
    flat = json.dumps([a.__dict__ for a in alerts])
    for needle in (
        "Authorization",
        "Cookie",
        "Bearer",
        "OR '1'",
        "syntax error",
        *SECRETS,
    ):
        assert needle not in flat


# ------------------------------------------------------------------ leaks ----


def test_leaked_finds_each_secret_and_any_token_shaped_value() -> None:
    other = "ov" + "m_" + "synthetic" + "Z" * 34
    text = f"a {SECRETS[0]} b {other} c"
    found = dz.leaked(text, SECRETS[1:])
    assert SECRETS[0] in found and other in found
    assert dz.leaked("nothing here, ov_sbx_ alone", SECRETS) == []
    assert dz.leaked("Authorization: Basic x", []) == ["Authorization:"]
    assert dz.scrub(text, SECRETS) == "a [credential removed] b [credential removed] c"


# ---------------------------------------------------------------- headers ----


def test_parse_flow_response_headers_reads_the_flows_four_headers() -> None:
    source = (
        ROOT / "apps" / "flow" / "src" / "security" / "response-headers.ts"
    ).read_text(encoding="utf-8")
    headers = dz.parse_flow_response_headers(source)
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Content-Security-Policy"] == "frame-ancestors 'none'"
    assert len(headers) == 4


EXPECTED = {
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Permissions-Policy": "camera=(self), geolocation=(), microphone=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}
GOOD_HEADERS = (
    "HTTP/1.1 200 OK\r\n"
    "Content-Security-Policy: default-src 'self'; script-src 'self'; frame-ancestors 'none'\r\n"
    "Permissions-Policy: camera=(self), geolocation=(), microphone=()\r\n"
    "Referrer-Policy: no-referrer\r\n"
    "X-Content-Type-Options: nosniff\r\n"
    "X-Frame-Options: DENY\r\n"
    "Content-Type: text/html\r\n\r\n"
)
GOOD_HTML = (
    '<html><head><meta http-equiv="Content-Security-Policy" '
    "content=\"default-src 'self'; script-src 'self'\"></head></html>"
)


def test_check_flow_headers_passes_the_flows_headers_and_its_meta_policy() -> None:
    checks = dz.check_flow_headers("hosted /", GOOD_HEADERS, GOOD_HTML, EXPECTED)
    assert checks and all(check.ok for check in checks), checks
    assert {check.header for check in checks} >= {
        *EXPECTED,
        "X-Frame-Options",
        "CSP <meta>",
    }


@pytest.mark.parametrize(
    ("headers", "html", "failing"),
    [
        (
            GOOD_HEADERS.replace("X-Content-Type-Options: nosniff\r\n", ""),
            GOOD_HTML,
            "X-Content-Type-Options",
        ),
        (
            GOOD_HEADERS.replace("; frame-ancestors 'none'", ""),
            GOOD_HTML,
            "Content-Security-Policy",
        ),
        (GOOD_HEADERS.replace("no-referrer", "origin"), GOOD_HTML, "Referrer-Policy"),
        (
            GOOD_HEADERS,
            GOOD_HTML.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
            "CSP <meta>",
        ),
        (GOOD_HEADERS, "<html></html>", "CSP <meta>"),
        (
            GOOD_HEADERS.replace(
                "script-src 'self';", "script-src 'self' 'unsafe-eval';"
            ),
            GOOD_HTML,
            "Content-Security-Policy",
        ),
    ],
)
def test_check_flow_headers_fails_a_missing_or_weakened_header(
    headers: str, html: str, failing: str
) -> None:
    checks = dz.check_flow_headers("hosted /", headers, html, EXPECTED)
    assert [check.header for check in checks if not check.ok] == [failing]


# ------------------------------------------------------------------- gate ----


def _alert(rule: str, risk: int) -> Any:
    return dz.Alert("api-server", rule, rule, "synthetic", risk, 2, "GET", "/x", "")


def test_gate_fails_an_open_high_and_a_fail_rule_but_not_an_ignored_high() -> None:
    rules = dz.parse_rules(
        "40018\tWARN\t(SQL Injection)\n"
        "10202\tFAIL\t(Absence of Anti-CSRF Tokens)\n"
        "90022\tIGNORE\t(Application Error Disclosure)\tthe synthetic error probe page (C170)\n"
    )
    alerts = [
        _alert("40018", 3),
        _alert("10202", 2),
        _alert("90022", 3),
        _alert("1", 2),
    ]
    verdict = dz.gate(alerts, rules)
    assert [a.rule_id for a in verdict.open_high] == ["40018"]
    assert [a.rule_id for a in verdict.failed] == ["10202"]


def test_gate_reports_a_low_alert_of_a_fail_rule_without_failing() -> None:
    # ZAP's "weakness" variants (a payload echoed in a JSON response, 40014-2) are Low, low confidence.
    rules = dz.parse_rules("40014\tFAIL\t(Cross Site Scripting (Persistent))\n")
    verdict = dz.gate([_alert("40014", 1), _alert("40014", 0)], rules)
    assert verdict.failed == () and verdict.open_high == ()


# -------------------------------------------------------------------- CLI ----


def _run_dir(tmp_path: Path) -> Path:
    run = tmp_path / "run"
    (run / "wrk").mkdir(parents=True)
    (run / "wrk" / "api-server.json").write_text(json.dumps(RAW), encoding="utf-8")
    api = "http://127.0.0.1:43000/api/v1"
    (run / "wrk" / "api-server-messages.json").write_text(
        json.dumps(
            [
                ["GET", f"{api}/inquiries/inq_01ARZ3NDEKTSV4RRFFQ69G5FAV", 200],
                ["POST", f"{api}/inquiries", 429],
                ["GET", f"{api}/flow/session", 401],
            ]
        ),
        encoding="utf-8",
    )
    (run / "wrk" / "headers-flow-guidance-root.txt").write_text(
        GOOD_HEADERS, encoding="utf-8"
    )
    (run / "wrk" / "body-flow-guidance-root.html").write_text(
        GOOD_HTML, encoding="utf-8"
    )
    (run / "credentials.json").write_text(json.dumps(CREDENTIALS), encoding="utf-8")
    (run / "openapi.json").write_text(
        json.dumps({"openapi": "3.0.3", "paths": {t: {"get": {}} for t in TEMPLATES}}),
        encoding="utf-8",
    )
    (run / "facts.json").write_text(
        json.dumps(
            {
                "date": "2026-11-20",
                "ladder": "i",
                "machine": "synthetic machine",
                "images": [
                    {"name": "openverify/api:11c-local", "id": "sha256:" + "0" * 64}
                ],
                "zapImage": "zap-image-under-test@sha256:" + "1" * 64,
                "internalRoute": {
                    "path": "/api/v1/internal/embed-policies/{id}",
                    "status": 401,
                },
            }
        ),
        encoding="utf-8",
    )
    (run / "scans.tsv").write_text(
        "api-server\tapi\t2026-11-20T00:00:00Z\t61\t1.00 1.00 1.00\t2\tno\n",
        encoding="utf-8",
    )
    return run


def _report_command(run: Path, rules_file: Path, out: Path) -> list[str]:
    return [
        sys.executable,
        "-I",
        str(SCRIPT),
        "report",
        "--run-dir",
        str(run),
        "--rules",
        str(rules_file),
        "--flow-headers",
        str(ROOT / "apps" / "flow" / "src" / "security" / "response-headers.ts"),
        "--out",
        str(out),
    ]


def _report(tmp_path: Path, rules: str) -> tuple[subprocess.CompletedProcess[str], str]:
    run = _run_dir(tmp_path)
    rules_file = tmp_path / "rules.tsv"
    rules_file.write_text(rules, encoding="utf-8")
    out = tmp_path / "dast-2026-11-20.md"
    result = subprocess.run(
        _report_command(run, rules_file, out),
        capture_output=True,
        text=True,
        check=False,
    )
    return result, out.read_text(encoding="utf-8") if out.exists() else ""


BASE_RULES = "10038\tWARN\t(CSP)\n10021\tWARN\t(XCTO)\n"


def test_report_strips_every_header_and_credential_and_fails_on_an_open_high(
    tmp_path: Path,
) -> None:
    result, text = _report(tmp_path, BASE_RULES + "40018\tWARN\t(SQL Injection)\n")
    assert result.returncode == 1, result.stderr
    assert "open high" in result.stderr
    for needle in (
        "Authorization",
        "Cookie",
        "Bearer",
        "Set-Cookie",
        "syntax error",
        "OR '1'",
        *SECRETS,
    ):
        assert needle not in text, needle
    assert (
        "| `POST` `/api/v1/inquiries` | 40018 SQL Injection | High | open (WARN)"
        in text
    )
    assert "found nothing on the routes it reached" in text
    assert "rules file SHA-256" in text
    assert "openverify/api:11c-local" in text
    assert "/api/v1/internal/embed-policies/{id}" in text
    assert "| api-server | api | 61 s |" in text
    assert "429" in text


def test_report_passes_when_the_high_is_ignored_with_its_reason(tmp_path: Path) -> None:
    result, text = _report(
        tmp_path,
        BASE_RULES
        + "40018\tIGNORE\t(SQL Injection)\ta synthetic false positive for the test\n",
    )
    assert result.returncode == 0, result.stderr
    assert "ignored: a synthetic false positive for the test" in text


def test_report_refuses_to_write_when_a_credential_would_reach_it(
    tmp_path: Path,
) -> None:
    run = _run_dir(tmp_path)
    facts = json.loads((run / "facts.json").read_text(encoding="utf-8"))
    facts["machine"] = "a machine " + CREDENTIALS["apiKey"]["token"]
    (run / "facts.json").write_text(json.dumps(facts), encoding="utf-8")
    rules_file = tmp_path / "rules.tsv"
    rules_file.write_text(
        BASE_RULES + "40018\tWARN\t(SQL Injection)\n", encoding="utf-8"
    )
    out = tmp_path / "dast.md"
    result = subprocess.run(
        _report_command(run, rules_file, out),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 3
    assert not out.exists()
    assert CREDENTIALS["apiKey"]["token"] not in result.stderr


def test_split_command_writes_one_document_per_group(tmp_path: Path) -> None:
    spec = tmp_path / "openapi.json"
    spec.write_text(json.dumps(_spec()), encoding="utf-8")
    groups = tmp_path / "groups.tsv"
    groups.write_text(GROUPS_TSV, encoding="utf-8")
    out = tmp_path / "out"
    creds = tmp_path / "credentials.json"
    creds.write_text(json.dumps(CREDENTIALS), encoding="utf-8")
    command = [
        sys.executable,
        "-I",
        str(SCRIPT),
        "split",
        "--spec",
        str(spec),
        "--groups",
        str(groups),
        "--out",
        str(out),
        "--credentials",
        str(creds),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == [
        "server\tapiKey\t3",
        "dashboard\tuserSession\t2",
        "flow\tsessionToken\t2",
    ]
    flow = json.loads((out / "openapi-flow.json").read_text(encoding="utf-8"))
    body = flow["paths"]["/api/v1/flow/handoffs/preview"]["post"]["requestBody"]
    props = body["content"]["application/json"]["schema"]["properties"]
    assert props["handoff-token"]["example"] == CREDENTIALS["handoff"]["token"]
    server = json.loads((out / "openapi-server.json").read_text(encoding="utf-8"))
    assert CREDENTIALS["handoff"]["token"] not in json.dumps(server)
    assert oct((out / "openapi-flow.json").stat().st_mode & 0o777) == "0o600"


def test_the_cli_refuses_an_unknown_command() -> None:
    result = subprocess.run(
        [sys.executable, "-I", str(SCRIPT), "nothing"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2


# ------------------------------------------------------------ in process ----


def test_main_report_in_process_lists_triage_fixes_headers_and_unreached_routes(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    run = _run_dir(tmp_path)
    (run / "wrk" / "openapi-server.json").write_text(
        json.dumps({"paths": {"/api/v1/inquiries": {"get": {}, "post": {}}}}),
        encoding="utf-8",
    )
    (run / "scans.tsv").write_text(
        "api-server\tapi\t2026-11-20T00:00:00Z\t61\t1.00 1.00 1.00\t2\tno\n",
        encoding="utf-8",
    )
    triage = tmp_path / "triage.tsv"
    triage.write_text(
        "# rule\troute\tstatus\treference\tnote\n"
        "10021\t*\topen: followup\tfix-server\tthe redact route's nosniff (KP11-70)\n"
        "40012\t/api/v1/accounts/{id}\tfixed\tabc1234\tthe error body escaped\n",
        encoding="utf-8",
    )
    rules = tmp_path / "rules.tsv"
    rules.write_text(
        BASE_RULES + "40018\tIGNORE\t(SQL Injection)\tsynthetic\n", encoding="utf-8"
    )
    out = tmp_path / "report.md"
    code = dz.main(
        [
            "report",
            "--run-dir",
            str(run),
            "--rules",
            str(rules),
            "--triage",
            str(triage),
            "--flow-headers",
            str(ROOT / "apps" / "flow" / "src" / "security" / "response-headers.ts"),
            "--out",
            str(out),
        ]
    )
    assert code == 0, capsys.readouterr().err
    text = out.read_text(encoding="utf-8")
    assert "open: followup | fix-server the redact route's nosniff (KP11-70)" in text
    assert (
        "| 40012 | `/api/v1/accounts/{id}` | abc1234 | the error body escaped |" in text
    )
    assert (
        "| flow-guidance-root | X-Content-Type-Options | nosniff | as expected |"
        in text
    )
    # In the group's document, never sent (the messages hold the POST, not the GET).
    assert "- api-server: 1: `GET /api/v1/inquiries`" in text
    assert "| api-server | api | 61 s | 1.00 1.00 1.00 | 2 | no | n/a | 3 |" in text
    alerts = json.loads((run / "alerts.json").read_text(encoding="utf-8"))
    assert {alert["rule_id"] for alert in alerts} == {"10021", "10038", "40018"}


def test_main_report_in_process_names_the_host_process_stack_first(
    tmp_path: Path,
) -> None:
    run = _run_dir(tmp_path)
    facts = json.loads((run / "facts.json").read_text(encoding="utf-8"))
    facts["ladder"] = "iii"
    (run / "facts.json").write_text(json.dumps(facts), encoding="utf-8")
    rules = tmp_path / "rules.tsv"
    rules.write_text(BASE_RULES + "40018\tFAIL\t(SQL Injection)\n", encoding="utf-8")
    out = tmp_path / "report.md"
    assert (
        dz.main(
            ["report", "--run-dir", str(run), "--rules", str(rules), "--out", str(out)]
        )
        == 1
    )
    head = out.read_text(encoding="utf-8").splitlines()[2]
    assert head.startswith("**This scan ran against the host-process e2e stack")


def test_main_split_and_check_in_process(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    spec = tmp_path / "openapi.json"
    spec.write_text(json.dumps(_spec()), encoding="utf-8")
    groups = tmp_path / "groups.tsv"
    groups.write_text(GROUPS_TSV, encoding="utf-8")
    rules = tmp_path / "rules.tsv"
    rules.write_text(BASE_RULES, encoding="utf-8")
    out = tmp_path / "out"
    assert (
        dz.main(
            [
                "split",
                "--spec",
                str(spec),
                "--groups",
                str(groups),
                "--out",
                str(out),
                "--group",
                "flow",
            ]
        )
        == 0
    )
    assert capsys.readouterr().out.splitlines() == ["flow\tsessionToken\t2"]
    assert sorted(path.name for path in out.iterdir()) == ["openapi-flow.json"]
    assert (
        dz.main(
            [
                "check",
                "--rules",
                str(rules),
                "--groups",
                str(groups),
                "--spec",
                str(spec),
            ]
        )
        == 0
    )
    assert "7 operations" not in capsys.readouterr().err
    bad = tmp_path / "bad.tsv"
    bad.write_text("10\tNOPE\t(x)\n", encoding="utf-8")
    assert (
        dz.main(
            ["check", "--rules", str(bad), "--groups", str(groups), "--spec", str(spec)]
        )
        == 2
    )
    assert dz.main(["report"]) == 2


def test_triage_refuses_a_bad_line() -> None:
    with pytest.raises(ValueError):
        dz.parse_triage("10021\t*\topen\n")
    assert (
        dz.parse_triage("# c\n10021\t*\topen\tfix-server\tnote\n")[0].reference
        == "fix-server"
    )


def test_route_template_prefers_the_most_literal_template() -> None:
    templates = ["/api/v1/lists/{id}", "/api/v1/lists/match"]
    assert dz.route_template("http://127.0.0.1:1/api/v1/lists/match", templates) == (
        "/api/v1/lists/match"
    )
    assert dz.route_template("http://127.0.0.1:1/assets/index-a1B2c3D4.js", []) == (
        "/assets/index-{hash}.js"
    )


def test_flow_headers_read_the_last_response_after_a_redirect() -> None:
    raw = "HTTP/1.1 301 Moved\r\nLocation: /\r\n\r\n" + GOOD_HEADERS
    checks = dz.check_flow_headers("hosted /", raw, GOOD_HTML, EXPECTED)
    assert all(check.ok for check in checks)
    with pytest.raises(ValueError):
        dz.parse_flow_response_headers("export const OTHER = {};")


def test_report_reads_only_zaps_reports_among_the_run_files(tmp_path: Path) -> None:
    # The hooks write <scan>-messages.json, <scan>-progress.json (a list) and <scan>-capped.txt beside
    # ZAP's report; only a report (an object with "site") is read as one.
    run = _run_dir(tmp_path)
    (run / "wrk" / "api-server-progress.json").write_text(
        json.dumps([["40018", "SQL Injection", "Complete"]]), encoding="utf-8"
    )
    (run / "wrk" / "api-server-capped.txt").write_text("no\n", encoding="utf-8")
    rules = tmp_path / "rules.tsv"
    rules.write_text(
        BASE_RULES + "40018\tIGNORE\t(SQL Injection)\tsynthetic\n", encoding="utf-8"
    )
    out = tmp_path / "report.md"
    assert (
        dz.main(
            ["report", "--run-dir", str(run), "--rules", str(rules), "--out", str(out)]
        )
        == 0
    )
    assert "40018 SQL Injection" in out.read_text(encoding="utf-8")


def test_an_unexpected_error_exits_2_never_the_gates_1(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = _run_dir(tmp_path)
    rules = tmp_path / "rules.tsv"
    rules.write_text(BASE_RULES, encoding="utf-8")

    def broken(*_args: object) -> str:
        raise AttributeError("synthetic")

    monkeypatch.setattr(dz, "render_report", broken)
    out = tmp_path / "report.md"
    assert (
        dz.main(
            ["report", "--run-dir", str(run), "--rules", str(rules), "--out", str(out)]
        )
        == 2
    )
    assert not out.exists()


def test_report_lists_informational_alerts_once_per_rule_and_counts_server_errors(
    tmp_path: Path,
) -> None:
    run = _run_dir(tmp_path)
    many = copy.deepcopy(RAW)
    many["site"][0]["alerts"].append(
        {
            "pluginid": "100000",
            "alertRef": "100000-1",
            "name": "A Client Error response code was returned by the server",
            "riskcode": "0",
            "confidence": "3",
            "instances": [
                {"uri": f"http://127.0.0.1:43000/api/v1/inquiries/{n}", "method": "GET"}
                for n in range(5)
            ]
            + [{"uri": "http://127.0.0.1:43000/api/v1/inquiries", "method": "POST"}],
        }
    )
    (run / "wrk" / "api-server.json").write_text(json.dumps(many), encoding="utf-8")
    rules = tmp_path / "rules.tsv"
    rules.write_text(
        BASE_RULES + "40018\tIGNORE\t(SQL Injection)\tsynthetic\n", encoding="utf-8"
    )
    out = tmp_path / "report.md"
    assert (
        dz.main(
            ["report", "--run-dir", str(run), "--rules", str(rules), "--out", str(out)]
        )
        == 0
    )
    text = out.read_text(encoding="utf-8")
    assert (
        "| 100000 A Client Error response code was returned by the server | api-server | 2 | open (WARN, unlisted) |"
        in text
    )
    assert "100000 A Client Error" not in text.split("## Informational alerts")[0]
    assert "3 requests answered; 0 with a 5xx status" in text


def test_report_names_the_scan_settings_and_the_active_rules_each_scan_finished(
    tmp_path: Path,
) -> None:
    run = _run_dir(tmp_path)
    (run / "wrk" / "api-server-progress.json").write_text(
        json.dumps(
            [
                ["6", "Path Traversal", "Complete"],
                ["7", "Remote File Inclusion", "Skipped"],
            ]
        ),
        encoding="utf-8",
    )
    facts = json.loads((run / "facts.json").read_text(encoding="utf-8"))
    facts["settings"] = "attack strength LOW, 2 threads 70 ms apart, 6 minutes a group"
    (run / "facts.json").write_text(json.dumps(facts), encoding="utf-8")
    rules = tmp_path / "rules.tsv"
    rules.write_text(
        BASE_RULES + "40018\tIGNORE\t(SQL Injection)\tsynthetic\n", encoding="utf-8"
    )
    out = tmp_path / "report.md"
    assert (
        dz.main(
            ["report", "--run-dir", str(run), "--rules", str(rules), "--out", str(out)]
        )
        == 0
    )
    text = out.read_text(encoding="utf-8")
    assert (
        "- The API scans: attack strength LOW, 2 threads 70 ms apart, 6 minutes a group."
        in text
    )
    assert "| api-server | api | 61 s | 1.00 1.00 1.00 | 2 | no | 1 of 2 | 3 |" in text


def test_a_group_may_take_one_tags_operations_under_a_path_prefix() -> None:
    text = GROUPS_TSV.replace(
        "dashboard\tuserSession\tdashboard\n",
        "dash-me\tuserSession\tdashboard@/api/v1/dashboard/me\n"
        "dashboard\tuserSession\tdashboard\n",
    )
    groups, holds = dz.parse_groups(text)
    parts = dz.split_spec(_spec(), groups, holds)
    assert sorted(parts["dash-me"]["paths"]) == ["/api/v1/dashboard/me"]
    assert sorted(parts["dashboard"]["paths"]) == ["/api/v1/dashboard/sessions"]


def test_a_path_prefix_that_takes_no_operation_is_refused() -> None:
    text = GROUPS_TSV.replace(
        "dashboard\tuserSession\tdashboard\n",
        "dash-x\tuserSession\tdashboard@/api/v1/dashboard/nowhere\n"
        "dashboard\tuserSession\tdashboard\n",
    )
    groups, holds = dz.parse_groups(text)
    with pytest.raises(ValueError, match="nowhere"):
        dz.split_spec(_spec(), groups, holds)


def test_the_same_tag_and_prefix_twice_is_refused() -> None:
    with pytest.raises(ValueError):
        dz.parse_groups(
            "a\tuserSession\tdashboard@/api/v1/dashboard/me\n"
            "b\tuserSession\tdashboard@/api/v1/dashboard/me\n"
        )
