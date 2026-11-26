"""Tests of the PII-pattern scan's configuration (C260.3; Workflow 11C, sast-pii-11c).

security/gitleaks-pii.toml holds the rules and the scanned paths; security/gitleaks-pii-allowlist.toml
the reviewed exceptions, joined through [extend]. These tests read both files as TOML and check
their shape: the rules C260.3 names, one scope shared by every rule, the generated paths named
with their reason, and a reason for every exception. infra/tests/gitleaks-pii.test.sh runs the
real gitleaks over positive and negative values assembled at run time.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "security" / "gitleaks-pii.toml"
ALLOWLIST = ROOT / "security" / "gitleaks-pii-allowlist.toml"
RULES = (
    "pii-email",
    "pii-ipv4",
    "pii-ipv6",
    "pii-phone",
    "pii-mrz-name",
    "pii-card-number",
    "pii-iban",
    "pii-us-ssn",
)


def load(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        return tomllib.load(handle)


@pytest.fixture(scope="module")
def config() -> dict[str, Any]:
    return load(CONFIG)


@pytest.fixture(scope="module")
def allowlist() -> dict[str, Any]:
    return load(ALLOWLIST)


def test_the_configuration_extends_only_the_reviewed_allowlist(
    config: dict[str, Any],
) -> None:
    assert config["extend"] == {"path": "security/gitleaks-pii-allowlist.toml"}
    assert "useDefault" not in config["extend"]


def test_it_holds_the_rules_c260_3_names(config: dict[str, Any]) -> None:
    assert tuple(rule["id"] for rule in config["rules"]) == RULES
    for rule in config["rules"]:
        assert rule["description"]
        assert rule["secretGroup"] == 1
        re.compile(rule["regex"])


def test_every_rule_reads_the_same_sample_data_paths(config: dict[str, Any]) -> None:
    scopes = {rule["path"] for rule in config["rules"]}
    assert len(scopes) == 1
    scope = re.compile(scopes.pop())
    inside = [
        "contracts/fixtures/api/inquiry.json",
        "fixtures/manifest.json",
        "docs/research/notes.md",
        "e2e/tests/support/flow.ts",
        "load/seed.py",
        "apps/api/src/test-support/oidc/provider.ts",
        "apps/api/src/services/x.test-support.ts",
        "packages/db/src/testing.ts",
        "packages/contracts/src/test-support.ts",
        "apps/api/src/routes/flow/inputs.test.ts",
        "apps/dashboard/src/app/page.test.tsx",
        "packages/watchlist/scripts/benchmark-report.test.mjs",
        "e2e/tests/connect.spec.ts",
        "services/vision/tests/test_icao_mrz.py",
        "android/openverify-sdk/src/commonTest/kotlin/dev/openverify/sdk/X.kt",
        "android/demo-app/src/test/kotlin/X.kt",
        "android/openverify-nfc/src/androidTest/kotlin/X.kt",
        "android/openverify-sdk/src/androidHostTest/kotlin/dev/openverify/sdk/api/ApiBaseUrlParityTest.kt",
        "infra/tests/pre-commit-hook.test.sh",
        "deploy/helm/openverify/tests/networkpolicies_test.yaml",
        "apps/api/scripts/seed-dev.ts",
        "apps/api/src/seed/connect-seed.ts",
        "apps/api/scripts/seed-load.ts",
    ]
    outside = [
        "apps/api/src/config.ts",
        "packages/contracts/src/tokens.ts",
        "README.md",
        "THIRD_PARTY_LICENSES.md",
        "security/gitleaks-pii-allowlist.toml",
        "deploy/helm/openverify/values.yaml",
        "apps/api/scripts/retention-run.ts",
    ]
    assert [path for path in inside if not scope.search(path)] == []
    assert [path for path in outside if scope.search(path)] == []


def global_allowlists(config: dict[str, Any]) -> list[dict[str, Any]]:
    return list(config.get("allowlists", []))


def test_generated_and_binary_files_are_not_read(config: dict[str, Any]) -> None:
    paths = [
        re.compile(path)
        for entry in global_allowlists(config)
        for path in entry.get("paths", [])
    ]

    def skipped(path: str) -> bool:
        return any(pattern.search(path) for pattern in paths)

    for path in (
        "node_modules/x/test/a.test.js",
        "apps/flow/dist/assets/a.js",
        "android/openverify-sdk/build/tmp/test/a.txt",
        "apps/dashboard/.next/server/a.js",
        "packages/db/coverage/index.html",
        "models/face_detection_yunet.onnx",
        "data/network/dbip.mmdb",
        "fixtures/generated/selfie-a.y4m",
        "fixtures/faces/person_a_id.jpg",
        "e2e/.artifacts/stack.json",
        "e2e/.env.e2e",
    ):
        assert skipped(path), path
    for path in (
        "e2e/tests/connect.spec.ts",
        "docs/PLAN.md",
        "contracts/fixtures/i18n/es.json",
    ):
        assert not skipped(path), path


def test_the_e2e_run_files_are_named_with_their_reason(config: dict[str, Any]) -> None:
    named = [
        entry for entry in global_allowlists(config) if "e2e" in entry["description"]
    ]
    assert len(named) == 1
    assert (
        "credentials" in named[0]["description"]
        and "gitignored" in named[0]["description"]
    )


def exceptions(allowlist: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Each exception with the id of the rule it sits under."""
    return [
        (rule["id"], entry)
        for rule in allowlist["rules"]
        for entry in rule.get("allowlists", [])
    ]


def test_the_allowlist_extends_only_rules_of_the_main_file(
    config: dict[str, Any], allowlist: dict[str, Any]
) -> None:
    # gitleaks 8.30.1 ignores targetRules in an extended file, so every exception sits under the
    # rule it serves; an extended rule carries only its id (its pattern is the main file's).
    assert "allowlists" not in allowlist
    assert "extend" not in allowlist
    ids = [rule["id"] for rule in allowlist["rules"]]
    assert ids == list(RULES)
    for rule in allowlist["rules"]:
        assert set(rule) == {"id", "allowlists"}, rule["id"]
    for rule in config["rules"]:
        assert "allowlists" not in rule, rule["id"]


def test_every_exception_has_a_reason_and_names_its_rule(
    allowlist: dict[str, Any],
) -> None:
    entries = exceptions(allowlist)
    assert entries
    for rule, entry in entries:
        description = entry["description"]
        assert re.match(r"^pii-[a-z0-9-]+(?:, pii-[a-z0-9-]+)*: \S", description), (
            description
        )
        named = re.findall(r"pii-[a-z0-9-]+", description.split(":")[0])
        assert rule in named, description
        assert set(named) <= set(RULES), description
        assert len(description) >= 40
        assert entry.get("regexes") or entry.get("paths"), description
        assert "targetRules" not in entry
        for pattern in entry.get("regexes", []):
            re.compile(pattern)


def test_path_scoped_exceptions_need_both_the_path_and_the_value(
    allowlist: dict[str, Any],
) -> None:
    for _, entry in exceptions(allowlist):
        if entry.get("paths"):
            assert entry.get("condition") == "AND", entry["description"]
            assert entry.get("regexes"), entry["description"]


def test_kubectls_signing_identity_is_allowed_by_name_not_reworded(
    allowlist: dict[str, Any],
) -> None:
    identity = "krel-staging" + "@" + "k8s-releng-prod.iam.gserviceaccount.com"
    allowed = [
        entry
        for rule, entry in exceptions(allowlist)
        if rule == "pii-email"
        and entry.get("regexTarget") == "secret"
        and any(re.search(pattern, identity) for pattern in entry.get("regexes", []))
        and not entry.get("paths")
    ]
    assert len(allowed) == 1 and "signing identity" in allowed[0]["description"]
