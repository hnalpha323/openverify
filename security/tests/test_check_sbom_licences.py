"""Tests of security/check-sbom-licences.py (C261.2; Workflow 11C, sbom-release-11c).

The SBOMs are synthetic CycloneDX documents built here; the ledger is the synthetic
fixtures/licences.md, and the last group reads the repository's own THIRD_PARTY_LICENSES.md so a
moved or reworded row fails here first. No test touches the network.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "security" / "check-sbom-licences.py"
FIXTURE_LEDGER = Path(__file__).resolve().parent / "fixtures" / "licences.md"
REAL_LEDGER = ROOT / "THIRD_PARTY_LICENSES.md"
FLOW_ROW_GRANTED = "| Unmodified; the source location is served beside it | granted 2026-11-08 (Phase 10 P2) |"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_sbom_licences", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_sbom_licences"] = module
    spec.loader.exec_module(module)
    return module


csl = _load()


# ------------------------------------------------------------------ builders ----
def comp(
    purl: str,
    licences: list[dict[str, Any]] | None = None,
    *,
    locations: list[str] | None = None,
    group: str | None = None,
) -> dict[str, Any]:
    """A CycloneDX component as Syft or the CycloneDX Gradle plugin writes it."""
    body = purl.split("/")[-1].split("?")[0]
    pname, _, version = body.partition("@")
    namespace = purl.split("/")[-2] if purl.count("/") >= 2 else ""
    name = pname
    if namespace.startswith("%40"):
        name = namespace.replace("%40", "@") + "/" + pname
    entry: dict[str, Any] = {
        "type": "library",
        "name": name,
        "version": version,
        "purl": purl,
    }
    if group is not None:
        entry["group"] = group
    if licences is not None:
        entry["licenses"] = licences
    if locations:
        entry["properties"] = [
            {"name": f"syft:location:{index}:path", "value": path}
            for index, path in enumerate(locations)
        ]
    return entry


def lid(spdx: str) -> dict[str, Any]:
    return {"license": {"id": spdx}}


def lname(name: str) -> dict[str, Any]:
    return {"license": {"name": name}}


def lexpr(expression: str) -> dict[str, Any]:
    return {"expression": expression}


def bom(*components: dict[str, Any]) -> dict[str, Any]:
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "version": 1,
        "metadata": {"component": {"type": "container", "name": "synthetic"}},
        "components": list(components),
    }


@pytest.fixture(scope="module")
def ledger() -> Any:
    return csl.parse_ledger(
        FIXTURE_LEDGER.read_text(encoding="utf-8"), FIXTURE_LEDGER.name
    )


@pytest.fixture(scope="module")
def real_ledger() -> Any:
    return csl.parse_ledger(REAL_LEDGER.read_text(encoding="utf-8"))


def judge(artifact: str, ledger: Any, *components: dict[str, Any]) -> list[Any]:
    return list(csl.evaluate(artifact, csl.read_sbom(bom(*components)), ledger))


def one(findings: list[Any], name: str) -> Any:
    matches = [finding for finding in findings if finding.name == name]
    assert len(matches) == 1, [(f.name, f.outcome, f.reason) for f in findings]
    return matches[0]


def outcome(findings: list[Any], name: str) -> tuple[str, str]:
    finding = one(findings, name)
    return (finding.outcome, finding.reason)


# --------------------------------------------------------- SPDX expressions ----
@pytest.mark.parametrize(
    ("expression", "allowed"),
    [
        ("MIT", True),
        ("Apache-2.0", True),
        ("BSD-2-Clause", True),
        ("BSD-3-Clause", True),
        ("ISC", True),
        ("PostgreSQL", True),
        ("CC0-1.0", True),
        ("CC-BY-4.0", True),
        ("BlueOak-1.0.0", True),
        ("PSF-2.0", True),
        ("MIT-CMU", True),
        ("mit OR apache-2.0", True),
        ("MIT OR GPL-3.0-only", True),
        ("(MIT AND (BSD-3-Clause OR GPL-2.0-only))", True),
        ("Apache-2.0 WITH LLVM-exception", True),
        ("MIT AND GPL-3.0-only", False),
        ("GPL-2.0-only WITH Classpath-exception-2.0", False),
        ("MIT WITH Classpath-exception-2.0", False),
        ("CC-BY-SA-4.0", False),
        ("CC-BY-NC-4.0", False),
        ("0BSD", False),
        ("MIT-0", False),
        ("MPL-2.0", False),
        ("LGPL-2.1-or-later", False),
        ("LicenseRef-proprietary", False),
        ("The Apache Software License, Version 2.0", True),
        ("MIT License", True),
    ],
)
def test_licence_allowed_reads_rule_4_as_spdx_expressions(
    expression: str, allowed: bool
) -> None:
    assert csl.licence_allowed(expression) is allowed


@pytest.mark.parametrize("expression", ["", "MIT AND", "(MIT", "MIT OR OR ISC", "MIT)"])
def test_licence_allowed_cannot_read_a_broken_expression(expression: str) -> None:
    assert csl.licence_allowed(expression) is None


# ------------------------------------------------------------------- ledger ----
def _rows_by_first_name(ledger: Any) -> dict[str, Any]:
    return {row.cells[0].split(" (")[0].split(",")[0]: row for row in ledger.rows}


def test_parse_ledger_reads_the_sections_and_their_decisions(ledger: Any) -> None:
    rows = _rows_by_first_name(ledger)
    assert (rows["tslib"].kind, rows["tslib"].status) == ("runtime", "owner")
    assert rows["nodemailer"].status == "owner"
    assert rows["mailsender"].status == "owner"
    assert (rows["NumPy"].status, rows["NumPy"].ecosystem) == ("decided", "pypi")
    assert rows["Fastify"].ecosystem == "npm"
    assert rows["JMRTD"].ecosystem == "maven"
    assert rows["lightningcss"].kind == "tooling"
    assert (rows["JUnit 4"].kind, rows["JUnit 4"].status) == ("tooling", "owner")
    assert rows["RapidOCR v3.10.0"].kind == "vendored"
    assert (rows["plannedlib"].kind, rows["plannedlib"].status) == (
        "planned",
        "planned",
    )
    assert rows["MinIO server"].kind == "other"
    assert rows["gitleaks"].kind == "other"
    exceptions = [row for row in ledger.rows if row.kind == "exception"]
    assert len(exceptions) == 4
    assert {row.status for row in exceptions} == {"decided"}
    assert ledger.aggregation_note is True


def test_parse_ledger_takes_names_from_backticks_and_the_plain_cell(
    ledger: Any,
) -> None:
    rows = _rows_by_first_name(ledger)
    assert {"fastify", "fastify-plugin"} <= rows["Fastify"].names
    assert {"org.jmrtd:jmrtd", "jmrtd"} <= rows["JMRTD"].names
    assert "bcutil-jdk18on" in rows["Bouncy Castle"].names
    assert {"@node-rs/argon2-linux-x64-gnu", "@node-rs/argon2"} <= rows[
        "@node-rs/argon2"
    ].names
    assert "junit:junit" in rows["JUnit 4"].names
    assert "@axe-core/playwright" in rows["`@axe-core/playwright` 4.14.0"].names


def test_parse_ledger_without_the_aggregation_note() -> None:
    text = FIXTURE_LEDGER.read_text(encoding="utf-8").replace(
        "ordinary aggregation", "ordinary"
    )
    assert csl.parse_ledger(text).aggregation_note is False


# --------------------------------------------------------------------- SBOM ----
def test_read_sbom_takes_keys_licences_and_locations() -> None:
    components = csl.read_sbom(
        bom(
            comp(
                "pkg:npm/%40fastify/cors@11.3.1",
                [lid("MIT")],
                locations=["/app/x/package.json"],
            ),
            comp(
                "pkg:maven/org.jmrtd/jmrtd@0.8.9?type=jar",
                [lname("LGPL")],
                group="org.jmrtd",
            ),
            comp("pkg:pypi/Pillow_SIMD@13.0.0", [lexpr("MIT-CMU")]),
            {
                "type": "library",
                "name": "outer",
                "version": "1",
                "purl": "pkg:npm/outer@1",
                "licenses": [lid("ISC")],
                "components": [comp("pkg:npm/inner@2", [lid("MIT")])],
            },
        )
    )
    by_name = {c.name: c for c in components}
    cors = by_name["@fastify/cors"]
    assert (cors.keys, cors.ecosystem, cors.licences) == (
        frozenset({"@fastify/cors"}),
        "npm",
        ("MIT",),
    )
    assert cors.locations == ("/app/x/package.json",)
    assert {"org.jmrtd:jmrtd", "jmrtd"} <= by_name["jmrtd"].keys
    assert (by_name["jmrtd"].ecosystem, by_name["jmrtd"].licences) == (
        "maven",
        ("LGPL",),
    )
    assert "pillow-simd" in by_name["Pillow_SIMD"].keys
    assert by_name["Pillow_SIMD"].ecosystem == "pypi"
    assert "inner" in by_name, "nested components are read too"


def test_read_sbom_refuses_a_document_that_is_not_cyclonedx() -> None:
    with pytest.raises(ValueError, match="CycloneDX"):
        csl.read_sbom({"spdxVersion": "SPDX-2.3"})
    with pytest.raises(TypeError, match="components"):
        csl.read_sbom({"bomFormat": "CycloneDX", "components": "nope"})


def test_read_sbom_accepts_a_document_without_components() -> None:
    assert csl.read_sbom({"bomFormat": "CycloneDX", "specVersion": "1.6"}) == []


def test_read_sbom_skips_syfts_file_entries_but_not_a_file_with_a_licence() -> None:
    # Syft records each file it read as a `file` component with only hashes (a directory scan's
    # package.json, for one): not a package, so nothing to judge. A file that declares a licence
    # is still judged.
    read = {
        "type": "file",
        "name": "/tmp/unpacked/package/package.json",
        "hashes": [{"alg": "SHA-256", "content": "0" * 64}],
    }
    licensed = {"type": "file", "name": "vendor/blob.js", "licenses": [lid("MIT")]}
    components = csl.read_sbom(
        bom(comp("pkg:npm/zod@4.6.7", [lid("MIT")]), read, licensed)
    )
    assert [component.name for component in components] == ["zod", "vendor/blob.js"]


@pytest.mark.parametrize(
    "artifact", ["image:api", "image:flow", "aar:openverify-sdk", "npm:openverify-node"]
)
def test_an_empty_sbom_of_a_shipped_artifact_fails(artifact: str, ledger: Any) -> None:
    # A scan that saw nothing proves nothing: a cataloguer left out, a wrong path.
    findings = csl.evaluate(artifact, [], ledger)
    assert [(f.outcome, f.reason) for f in findings if f.reason == "empty-sbom"] == [
        ("fail", "empty-sbom")
    ]
    assert csl.build_report(artifact, "x.cdx.json", findings)["result"] == "fail"


def test_an_sbom_holding_only_file_entries_is_empty(ledger: Any) -> None:
    findings = judge(
        "npm:openverify-js",
        ledger,
        {"type": "file", "name": "/tmp/unpacked/package/package.json"},
    )
    assert ("fail", "empty-sbom") in {(f.outcome, f.reason) for f in findings}


def test_an_empty_source_tree_sbom_is_not_failed(ledger: Any) -> None:
    assert csl.evaluate("source:load", [], ledger) == []


PNPM = "/app/apps/api/node_modules/.pnpm"


def test_a_manifest_inside_another_package_is_part_of_it(ledger: Any) -> None:
    # Syft catalogues every package.json in an image: a package's subpath manifests and test
    # fixtures (libphonenumber-js/min, pino's test/fixtures/transport) are files of the package
    # around them, whose own licence is judged.
    root = f"{PNPM}/pino@10.4.0/node_modules/pino"
    phone = f"{PNPM}/libphonenumber-js@1.13.14/node_modules/libphonenumber-js"
    findings = judge(
        "image:api",
        ledger,
        comp("pkg:npm/pino@10.4.0", [lid("MIT")], locations=[f"{root}/package.json"]),
        comp(
            "pkg:npm/transport@0.0.1",
            None,
            locations=[f"{root}/test/fixtures/transport/package.json"],
        ),
        comp(
            "pkg:npm/libphonenumber-js@1.13.14",
            [lid("MIT")],
            locations=[f"{phone}/package.json"],
        ),
        # Syft names a subpath manifest by its own name field, as the package wrote it.
        {
            **comp(
                "pkg:npm/libphonenumber-js/min",
                None,
                locations=[f"{phone}/min/package.json"],
            ),
            "name": "libphonenumber-js/min",
        },
    )
    transport = one(findings, "transport")
    assert (transport.outcome, transport.reason) == ("pass", "inside-package")
    assert transport.extra["inside"] == "pino"
    assert outcome(findings, "pino") == ("pass", "licence")
    assert one(findings, "libphonenumber-js/min").extra["inside"] == "libphonenumber-js"
    assert csl.build_report("image:api", "a.cdx.json", findings)["result"] == "pass"


def test_a_package_installed_under_another_is_judged_on_its_own(ledger: Any) -> None:
    root = f"{PNPM}/a@1.0.0/node_modules/a"
    findings = judge(
        "image:api",
        ledger,
        comp("pkg:npm/a@1.0.0", [lid("MIT")], locations=[f"{root}/package.json"]),
        comp(
            "pkg:npm/b@2.0.0", None, locations=[f"{root}/node_modules/b/package.json"]
        ),
    )
    assert outcome(findings, "b") == ("fail", "unknown-licence")


def test_a_nested_manifest_without_its_package_in_the_sbom_is_judged(
    ledger: Any,
) -> None:
    findings = judge(
        "image:api",
        ledger,
        comp(
            "pkg:npm/transport@0.0.1",
            None,
            locations=[
                f"{PNPM}/pino@10.4.0/node_modules/pino/test/fixtures/transport/package.json"
            ],
        ),
    )
    assert outcome(findings, "transport") == ("fail", "unknown-licence")


def test_pypis_3_clause_bsd_licence_name_is_bsd_3_clause(ledger: Any) -> None:
    # protobuf's wheel metadata, as Syft reads it in the vision image.
    findings = judge(
        "image:vision",
        ledger,
        comp("pkg:pypi/protobuf@7.36.2", [lname("3-Clause BSD License")]),
    )
    assert outcome(findings, "protobuf") == ("pass", "licence")


def test_the_python_bases_own_interpreter_is_the_base_distribution(ledger: Any) -> None:
    # python:3.12-slim builds CPython into /usr/local (Syft's binary classifier, no licence).
    python = comp(
        "pkg:generic/python@3.12.16",
        None,
        locations=["/usr/local/bin/python3.12", "/usr/local/lib/libpython3.12.so.1.0"],
    )
    assert outcome(judge("image:vision", ledger, python), "python") == (
        "aggregation",
        "base-distribution",
    )


def test_ffmpeg_inside_a_wheel_is_not_the_base_distribution(ledger: Any) -> None:
    # The libraries a wheel bundles are the application's, never the base image's.
    libs = "/app/.venv/lib/python3.12/site-packages/opencv_python_headless.libs"
    ffmpeg = comp(
        "pkg:generic/ffmpeg@8.1.1",
        None,
        locations=[f"{libs}/libavcodec-c4204469.so.62"],
    )
    assert outcome(judge("image:vision", ledger, ffmpeg), "ffmpeg") == (
        "fail",
        "unknown-licence",
    )


def test_the_operating_system_component_is_the_base_distribution(ledger: Any) -> None:
    system = {"type": "operating-system", "name": "debian", "version": "12.13"}
    assert outcome(judge("image:vision", ledger, system), "debian") == (
        "aggregation",
        "base-distribution",
    )
    assert outcome(judge("aar:openverify-sdk", ledger, system), "debian") == (
        "fail",
        "base-outside-image",
    )


# ----------------------------------------------------------- the decisions ----
def test_a_permissive_component_passes_by_its_licence(ledger: Any) -> None:
    findings = judge(
        "image:api",
        ledger,
        comp("pkg:npm/fastify@5.12.7", [lid("MIT")]),
        comp("pkg:npm/openid-client@6.8.8", [lid("MIT")]),
        comp("pkg:npm/oauth4webapi@3.8.8", [lid("MIT")]),
        comp("pkg:npm/jose@6.2.12", [lexpr("MIT")]),
    )
    assert {(f.name, f.outcome, f.reason) for f in findings} == {
        ("fastify", "pass", "licence"),
        ("openid-client", "pass", "licence"),
        ("oauth4webapi", "pass", "licence"),
        ("jose", "pass", "licence"),
    }


def test_an_owner_row_is_reported_as_owner_and_never_passes_silently(
    ledger: Any,
) -> None:
    findings = judge(
        "image:api", ledger, comp("pkg:npm/nodemailer@10.1.6", [lid("MIT-0")])
    )
    finding = one(findings, "nodemailer")
    assert (finding.outcome, finding.reason) == ("owner", "owner-to-confirm")
    assert finding.row is not None and finding.row.startswith("licences.md:")
    report = csl.build_report("image:api", "api.cdx.json", findings)
    assert (report["result"], report["pending-owner"], report["label"]) == (
        "owner",
        True,
        "pending-owner",
    )
    assert [entry["name"] for entry in report["owner"]] == ["nodemailer"]


def test_a_pending_owner_decision_row_is_owner_too(ledger: Any) -> None:
    findings = judge(
        "image:api",
        ledger,
        comp("pkg:npm/mailsender@1.0.0", [lid("LicenseRef-Custom")]),
    )
    assert outcome(findings, "mailsender") == ("owner", "owner-to-confirm")


def test_tslib_passes_as_phase_5_decision_46(ledger: Any) -> None:
    finding = one(
        judge("image:api", ledger, comp("pkg:npm/tslib@2.8.1", [lid("0BSD")])), "tslib"
    )
    assert (finding.outcome, finding.reason) == ("pass", "recorded-decision")
    assert finding.decision is not None and "decision 46" in finding.decision
    assert finding.row is not None


def test_a_row_with_a_recorded_decision_passes_with_its_row_named(ledger: Any) -> None:
    expression = "BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0"
    findings = judge(
        "image:vision", ledger, comp("pkg:pypi/numpy@2.5.4", [lexpr(expression)])
    )
    finding = one(findings, "numpy")
    assert (finding.outcome, finding.reason) == ("pass", "recorded-decision")
    assert finding.row is not None and "§2.1" in finding.row


def test_a_row_of_another_ecosystem_is_not_a_decision(ledger: Any) -> None:
    findings = judge("image:api", ledger, comp("pkg:npm/numpy@1.0.0", [lid("0BSD")]))
    assert outcome(findings, "numpy") == ("fail", "unknown-licence")


def test_a_planned_row_records_no_decision(ledger: Any) -> None:
    findings = judge(
        "image:api",
        ledger,
        comp("pkg:npm/plannedlib@1.0.0", [lid("LicenseRef-Unknown")]),
    )
    assert outcome(findings, "plannedlib") == ("fail", "unknown-licence")


@pytest.mark.parametrize(
    "licences",
    [
        [lid("LicenseRef-proprietary")],
        [],
        None,
        [lname("Some Licence")],
        [lexpr("MIT AND")],
    ],
)
def test_an_unknown_licence_fails(
    ledger: Any, licences: list[dict[str, Any]] | None
) -> None:
    findings = judge("image:api", ledger, comp("pkg:npm/mystery@1.0.0", licences))
    assert outcome(findings, "mystery") == ("fail", "unknown-licence")


def test_a_section_5_tooling_exception_fails_when_it_ships(ledger: Any) -> None:
    findings = judge(
        "image:dashboard",
        ledger,
        comp("pkg:npm/lightningcss@1.30.0", [lid("MPL-2.0")]),
        comp("pkg:npm/%40axe-core/playwright@4.14.0", [lid("MPL-2.0")]),
    )
    for name in ("lightningcss", "@axe-core/playwright"):
        finding = one(findings, name)
        assert (finding.outcome, finding.reason) == ("fail", "tooling-shipped")
        assert finding.row is not None and "§5" in finding.row


def test_junit_4_in_a_runtime_sbom_fails_as_shipped_tooling_not_as_owner(
    ledger: Any,
) -> None:
    junit = comp(
        "pkg:maven/junit/junit@4.13.2?type=jar", [lname("EPL-1.0")], group="junit"
    )
    findings = judge("aar:openverify-sdk", ledger, junit)
    assert outcome(findings, "junit") == ("fail", "tooling-shipped")


def test_first_party_components_pass(ledger: Any) -> None:
    findings = judge(
        "aar:openverify-sdk",
        ledger,
        comp(
            "pkg:maven/dev.openverify/openverify-sdk@0.1.0?project_path=%3Aopenverify-sdk",
            [],
            group="dev.openverify",
        ),
        comp("pkg:npm/%40openverify/js@0.1.0", None),
        comp("pkg:pypi/openverify-vision@0.1.0", None),
    )
    assert {(f.name, f.outcome, f.reason) for f in findings} == {
        ("openverify-sdk", "pass", "first-party"),
        ("@openverify/js", "pass", "first-party"),
        ("openverify-vision", "pass", "first-party"),
    }


def test_a_google_play_library_fails_in_every_artifact(ledger: Any) -> None:
    play = comp(
        "pkg:maven/com.google.android.play/integrity@1.4.0?type=aar",
        [lid("Apache-2.0")],
        group="com.google.android.play",
    )
    assert outcome(judge("aar:openverify-sdk", ledger, play), "integrity") == (
        "fail",
        "google-play",
    )


# ----------------------------------------------- section 6 and hand-listed ----
def test_the_flow_image_names_eigens_wasm_row_even_when_syft_sees_no_wasm(
    ledger: Any,
) -> None:
    findings = judge("image:flow", ledger, comp("pkg:npm/react@19.3.1", [lid("MIT")]))
    eigen = one(findings, "Eigen")
    assert eigen.hand_listed is True
    assert (eigen.outcome, eigen.reason) == ("pass", "recorded-decision")
    assert eigen.row is not None and "§6" in eigen.row
    assert eigen.decision is not None and "granted" in eigen.decision
    assert "onnxruntime-web" in eigen.extra["inside"]


def test_the_flow_image_with_onnxruntime_web_lists_eigen_once(ledger: Any) -> None:
    findings = judge(
        "image:flow", ledger, comp("pkg:npm/onnxruntime-web@1.30.0", [lid("MIT")])
    )
    assert one(findings, "onnxruntime-web").outcome == "pass"
    assert one(findings, "Eigen").outcome == "pass"


def test_the_no_guidance_flow_image_lists_no_eigen(ledger: Any) -> None:
    findings = judge(
        "image:flow-noguidance", ledger, comp("pkg:npm/react@19.3.1", [lid("MIT")])
    )
    assert [f.name for f in findings] == ["react"]


def test_onnxruntime_web_in_the_no_guidance_image_fails(ledger: Any) -> None:
    findings = judge(
        "image:flow-noguidance",
        ledger,
        comp("pkg:npm/onnxruntime-web@1.30.0", [lid("MIT")]),
    )
    assert outcome(findings, "Eigen") == ("fail", "exception-outside-artifact")


def test_eigen_found_in_another_image_fails(ledger: Any) -> None:
    findings = judge(
        "image:api", ledger, comp("pkg:npm/onnxruntime-web@1.30.0", [lid("MIT")])
    )
    eigen = one(findings, "Eigen")
    assert (eigen.outcome, eigen.reason) == ("fail", "exception-outside-artifact")
    assert eigen.row is not None and "§6" in eigen.row


def test_the_vision_image_names_the_wheels_row_and_its_vendored_source(
    ledger: Any,
) -> None:
    findings = judge(
        "image:vision", ledger, comp("pkg:pypi/onnxruntime@1.31.0", [lid("MIT")])
    )
    eigen = one(findings, "Eigen")
    assert (eigen.outcome, eigen.reason) == ("pass", "recorded-decision")
    assert "wheel" in eigen.extra["inside"]
    rapid = one(findings, "RapidOCR v3.10.0")
    assert rapid.hand_listed is True
    assert (rapid.outcome, rapid.reason, rapid.licences) == (
        "pass",
        "licence",
        ("Apache-2.0",),
    )


def test_the_face_aar_names_the_onnxruntime_android_row(ledger: Any) -> None:
    ort = comp(
        "pkg:maven/com.microsoft.onnxruntime/onnxruntime-android@1.31.0?type=aar",
        [lid("MIT")],
        group="com.microsoft.onnxruntime",
    )
    eigen = one(judge("aar:openverify-face", ledger, ort), "Eigen")
    assert (eigen.outcome, eigen.reason) == ("pass", "recorded-decision")
    assert "onnxruntime-android" in eigen.extra["inside"]


LGPL_NAME = "GNU Library or Lesser General Public License (LGPL)"


def test_the_nfc_aar_passes_lgpl_and_names_scubas_two_files(ledger: Any) -> None:
    findings = judge(
        "aar:openverify-nfc",
        ledger,
        comp(
            "pkg:maven/org.jmrtd/jmrtd@0.8.9?type=jar",
            [lname(LGPL_NAME)],
            group="org.jmrtd",
        ),
        comp(
            "pkg:maven/net.sf.scuba/scuba-smartcards@0.0.21?type=jar",
            [lname(LGPL_NAME)],
            group="net.sf.scuba",
        ),
        comp(
            "pkg:maven/org.ejbca.cvc/cert-cvc@1.4.13?type=jar",
            [lid("LGPL-2.1-only")],
            group="org.ejbca.cvc",
        ),
        comp(
            "pkg:maven/org.bouncycastle/bcutil-jdk18on@1.86?type=jar",
            [lname("Bouncy Castle Licence")],
            group="org.bouncycastle",
        ),
    )
    jmrtd = one(findings, "jmrtd")
    assert (jmrtd.outcome, jmrtd.reason) == ("pass", "lgpl-in-nfc")
    assert jmrtd.row is not None
    assert one(findings, "cert-cvc").outcome == "pass"
    assert one(findings, "scuba-smartcards").outcome == "pass"
    scuba = one(findings, "Two files of SCUBA")
    assert (scuba.outcome, scuba.reason) == ("pass", "recorded-decision")
    assert scuba.decision is not None and "P1" in scuba.decision
    assert outcome(findings, "bcutil-jdk18on") == ("pass", "recorded-decision")


def test_lgpl_without_a_row_fails_even_in_the_nfc_aar(ledger: Any) -> None:
    stray = comp(
        "pkg:maven/org.example/stray@1.0?type=jar",
        [lid("LGPL-3.0-only")],
        group="org.example",
    )
    assert outcome(judge("aar:openverify-nfc", ledger, stray), "stray") == (
        "fail",
        "unknown-licence",
    )


def test_lgpl_and_scuba_outside_the_nfc_aar_fail(ledger: Any) -> None:
    scuba = comp(
        "pkg:maven/net.sf.scuba/scuba-smartcards@0.0.21?type=jar",
        [lname(LGPL_NAME)],
        group="net.sf.scuba",
    )
    findings = judge("aar:openverify-face", ledger, scuba)
    assert outcome(findings, "scuba-smartcards") == ("fail", "lgpl-outside-nfc")
    assert outcome(findings, "Two files of SCUBA") == (
        "fail",
        "exception-outside-artifact",
    )


def test_the_decline_path_a_section_6_row_reading_owner_to_confirm_reports_owner() -> (
    None
):
    text = FIXTURE_LEDGER.read_text(encoding="utf-8").replace(
        FLOW_ROW_GRANTED,
        "| Unmodified; the source location is served beside it | owner to confirm |",
    )
    findings = judge(
        "image:flow", csl.parse_ledger(text), comp("pkg:npm/react@19.3.1", [lid("MIT")])
    )
    assert outcome(findings, "Eigen") == ("owner", "owner-to-confirm")
    report = csl.build_report("image:flow", "flow.cdx.json", findings)
    assert (report["result"], report["pending-owner"]) == ("owner", True)


def test_a_declined_section_6_row_fails() -> None:
    text = FIXTURE_LEDGER.read_text(encoding="utf-8").replace(
        FLOW_ROW_GRANTED,
        "| Unmodified; the source location is served beside it | declined 2026-12-01 |",
    )
    assert outcome(judge("image:flow", csl.parse_ledger(text)), "Eigen") == (
        "fail",
        "declined",
    )


# --------------------------------------------------------- base distribution ----
def test_base_distribution_packages_are_reported_as_aggregation_not_failed(
    ledger: Any,
) -> None:
    findings = judge(
        "image:vision",
        ledger,
        comp("pkg:deb/debian/bash@5.2.15-2?arch=amd64", [lid("GPL-3.0-or-later")]),
        comp(
            "pkg:deb/debian/libc6@2.36-9",
            [lid("LGPL-2.1-or-later"), lid("GPL-2.0-only")],
        ),
        comp(
            "pkg:npm/npm@10.9.4",
            [lid("Artistic-2.0")],
            locations=["/usr/local/lib/node_modules/npm/package.json"],
        ),
    )
    for name in ("bash", "libc6", "npm"):
        assert outcome(findings, name) == ("aggregation", "base-distribution")
    report = csl.build_report("image:vision", "vision.cdx.json", findings)
    assert (report["result"], report["pending-owner"]) == ("pass", False)
    assert sorted(entry["name"] for entry in report["aggregation"]) == [
        "bash",
        "libc6",
        "npm",
    ]


def test_an_application_package_is_not_base_because_another_copy_is(
    ledger: Any,
) -> None:
    leftpad = comp(
        "pkg:npm/leftpad@1.0.0",
        [lid("WTFPL")],
        locations=[
            "/usr/local/lib/node_modules/npm/node_modules/leftpad/package.json",
            "/app/node_modules/leftpad/package.json",
        ],
    )
    assert outcome(judge("image:api", ledger, leftpad), "leftpad") == (
        "fail",
        "unknown-licence",
    )


def test_base_packages_fail_without_the_recorded_aggregation_note() -> None:
    text = FIXTURE_LEDGER.read_text(encoding="utf-8").replace(
        "ordinary aggregation", "ordinary"
    )
    bash = comp("pkg:deb/debian/bash@5.2.15-2", [lid("GPL-3.0-or-later")])
    findings = judge("image:vision", csl.parse_ledger(text), bash)
    assert outcome(findings, "bash") == ("fail", "aggregation-not-recorded")


def test_a_distribution_package_in_an_aar_fails(ledger: Any) -> None:
    bash = comp("pkg:deb/debian/bash@5.2.15-2", [lid("GPL-3.0")])
    assert outcome(judge("aar:openverify-sdk", ledger, bash), "bash") == (
        "fail",
        "base-outside-image",
    )


def test_a_source_tree_is_reported_never_judged(ledger: Any) -> None:
    findings = judge(
        "source:pnpm",
        ledger,
        comp("pkg:npm/fastify@5.12.7", None),
        comp("pkg:npm/lightningcss@1.30.0", [lid("MPL-2.0")]),
    )
    assert {(f.outcome, f.reason) for f in findings} == {("report", "source-tree")}
    assert (
        csl.build_report("source:pnpm", "pnpm.cdx.json", findings)["result"] == "pass"
    )


def test_an_unknown_artifact_is_refused(ledger: Any) -> None:
    with pytest.raises(KeyError):
        csl.evaluate("image:nope", [], ledger)


# ------------------------------------------------------------------- report ----
def test_build_report_counts_and_orders(ledger: Any) -> None:
    findings = judge(
        "image:api",
        ledger,
        comp("pkg:npm/zod@4.6.7", [lid("MIT")]),
        comp("pkg:npm/nodemailer@10.1.6", [lid("MIT-0")]),
        comp("pkg:npm/mystery@1.0.0", [lid("LicenseRef-x")]),
    )
    report = csl.build_report("image:api", "api.cdx.json", findings)
    assert report["schema"] == csl.REPORT_SCHEMA
    assert (report["artifact"], report["sbom"]) == ("image:api", "api.cdx.json")
    assert (report["result"], report["pending-owner"]) == ("fail", True)
    assert report["counts"] == {
        "components": 3,
        "pass": 1,
        "owner": 1,
        "fail": 1,
        "aggregation": 0,
        "report": 0,
    }
    assert [entry["name"] for entry in report["components"]] == [
        "mystery",
        "nodemailer",
        "zod",
    ]
    assert report["failures"][0]["reason"] == "unknown-licence"
    entry = report["owner"][0]
    assert set(entry) >= {
        "name",
        "version",
        "purl",
        "licences",
        "outcome",
        "reason",
        "row",
    }


def test_a_clean_report_carries_no_label(ledger: Any) -> None:
    findings = judge("image:api", ledger, comp("pkg:npm/zod@4.6.7", [lid("MIT")]))
    report = csl.build_report("image:api", "api.cdx.json", findings)
    assert (report["result"], report["pending-owner"], report["label"]) == (
        "pass",
        False,
        None,
    )


# ---------------------------------------------------------------------- CLI ----
def write(path: Path, document: dict[str, Any]) -> Path:
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def test_main_writes_the_report_and_exits_0_on_owner(
    tmp_path: Path, capsys: Any
) -> None:
    sbom = write(
        tmp_path / "api.cdx.json",
        bom(comp("pkg:npm/nodemailer@10.1.6", [lid("MIT-0")])),
    )
    report_path = tmp_path / "out" / "api.licences.json"
    argv = [
        "--artifact",
        "image:api",
        "--sbom",
        str(sbom),
        "--licences",
        str(FIXTURE_LEDGER),
    ]
    assert csl.main([*argv, "--report", str(report_path)]) == csl.EXIT_PASS
    assert json.loads(report_path.read_text(encoding="utf-8"))["pending-owner"] is True
    out = capsys.readouterr().out
    assert "owner: nodemailer 10.1.6" in out
    assert "result: owner" in out
    assert "pending-owner" in out


def test_main_defaults_the_report_beside_the_sbom_and_exits_1_on_a_failure(
    tmp_path: Path, capsys: Any
) -> None:
    sbom = write(
        tmp_path / "dash.cdx.json",
        bom(comp("pkg:npm/lightningcss@1.30.0", [lid("MPL-2.0")])),
    )
    argv = [
        "--artifact",
        "image:dashboard",
        "--sbom",
        str(sbom),
        "--licences",
        str(FIXTURE_LEDGER),
    ]
    assert csl.main(argv) == csl.EXIT_FAIL
    assert (tmp_path / "dash.cdx.licences.json").is_file()
    assert "fail: lightningcss 1.30.0" in capsys.readouterr().out


def test_main_reads_the_repository_ledger_by_default(tmp_path: Path) -> None:
    sbom = write(tmp_path / "a.json", bom(comp("pkg:npm/zod@4.6.7", [lid("MIT")])))
    assert csl.main(["--artifact", "image:api", "--sbom", str(sbom)]) == csl.EXIT_PASS


@pytest.mark.parametrize(
    "argv",
    [
        [],
        ["--artifact", "image:nope", "--sbom", "{ok}"],
        ["--artifact", "image:api", "--sbom", "/nonexistent/sbom.json"],
        [
            "--artifact",
            "image:api",
            "--sbom",
            "{ok}",
            "--licences",
            "/nonexistent/ledger.md",
        ],
    ],
)
def test_main_answers_2_on_bad_usage_or_input(argv: list[str], tmp_path: Path) -> None:
    ok = write(tmp_path / "ok.json", bom())
    assert (
        csl.main([str(ok) if arg == "{ok}" else arg for arg in argv]) == csl.EXIT_USAGE
    )


def test_main_answers_2_on_a_document_that_is_not_json_or_not_cyclonedx(
    tmp_path: Path,
) -> None:
    broken = tmp_path / "broken.json"
    broken.write_text("{", encoding="utf-8")
    spdx = write(tmp_path / "spdx.json", {"spdxVersion": "SPDX-2.3"})
    array = tmp_path / "array.json"
    array.write_text("[]", encoding="utf-8")
    listless = write(
        tmp_path / "listless.json", {"bomFormat": "CycloneDX", "components": {}}
    )
    for path in (broken, spdx, array, listless):
        assert (
            csl.main(["--artifact", "image:api", "--sbom", str(path)]) == csl.EXIT_USAGE
        )


def test_main_lists_the_artifacts(capsys: Any) -> None:
    assert csl.main(["--list-artifacts"]) == csl.EXIT_PASS
    listed = set(capsys.readouterr().out.split())
    assert listed == set(csl.ARTIFACTS)
    assert listed == {
        "image:api",
        "image:dashboard",
        "image:flow",
        "image:flow-noguidance",
        "image:vision",
        "image:code-runner",
        "aar:openverify-sdk",
        "aar:openverify-nfc",
        "aar:openverify-face",
        "npm:openverify-js",
        "npm:openverify-node",
        "npm:openverify-react",
        "source:pnpm",
        "source:vision",
        "source:load",
    }


def test_the_script_runs_isolated_as_a_program(tmp_path: Path) -> None:
    sbom = write(tmp_path / "a.json", bom(comp("pkg:npm/zod@4.6.7", [lid("MIT")])))
    done = subprocess.run(
        [
            sys.executable,
            "-I",
            str(SCRIPT),
            "--artifact",
            "image:api",
            "--sbom",
            str(sbom),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    assert "result: pass" in done.stdout


# ------------------------------------------- the repository's own ledger ----
def test_the_real_ledger_holds_the_four_section_6_rows_as_granted(
    real_ledger: Any,
) -> None:
    rows = [row for row in real_ledger.rows if row.kind == "exception"]
    assert len(rows) == 4
    assert all(row.status == "decided" and "granted" in row.cells[-1] for row in rows)
    assert real_ledger.aggregation_note is True


def test_the_real_ledger_passes_nodemailer_in_the_api_image_as_q11_decided_it(
    real_ledger: Any,
) -> None:
    # Q11 granted (2026-11-21; Workflow 11G records-11g): the row records MIT-0 as accepted, so the
    # check reads a decided row and the API image is no longer labelled pending-owner.
    findings = judge(
        "image:api",
        real_ledger,
        comp("pkg:npm/nodemailer@10.1.6", [lid("MIT-0")]),
        comp("pkg:npm/tslib@2.8.1", [lid("0BSD")]),
        comp("pkg:npm/openid-client@6.8.8", [lid("MIT")]),
        comp("pkg:npm/oauth4webapi@3.8.8", [lid("MIT")]),
        comp("pkg:npm/jose@6.2.12", [lid("MIT")]),
    )
    nodemailer = one(findings, "nodemailer")
    assert (nodemailer.outcome, nodemailer.reason) == ("pass", "recorded-decision")
    assert nodemailer.row is not None and nodemailer.row.startswith(
        "THIRD_PARTY_LICENSES.md:"
    )
    assert outcome(findings, "tslib") == ("pass", "recorded-decision")
    for name in ("openid-client", "oauth4webapi", "jose"):
        assert one(findings, name).outcome == "pass"
    report = csl.build_report("image:api", "api.cdx.json", findings)
    assert (report["result"], report["pending-owner"], report["label"]) == (
        "pass",
        False,
        None,
    )


@pytest.mark.parametrize(
    ("artifact", "inside"),
    [
        ("image:flow", "onnxruntime-web"),
        ("image:vision", "wheel"),
        ("aar:openverify-face", "onnxruntime-android"),
        ("aar:openverify-nfc", "scuba-smartcards"),
    ],
)
def test_the_real_ledger_names_each_section_6_row_only_where_it_ships(
    real_ledger: Any, artifact: str, inside: str
) -> None:
    findings = judge(artifact, real_ledger)
    hand = [f for f in findings if f.hand_listed and "§6" in (f.row or "")]
    assert len(hand) == 1, [(f.name, f.row) for f in findings]
    assert (hand[0].outcome, hand[0].reason) == ("pass", "recorded-decision")
    assert inside in hand[0].extra["inside"]


def test_the_real_ledger_gives_each_section_6_row_its_licence_expression_alone(
    real_ledger: Any,
) -> None:
    # The licence cell may add a note after the expression in backticks (SCUBA's names the file
    # headers); the report carries the expression only.
    licences = {
        f.licences
        for artifact in ("aar:openverify-nfc", "aar:openverify-face", "image:flow")
        for f in judge(artifact, real_ledger)
        if f.hand_listed and "§6" in (f.row or "")
    }
    assert licences == {("GPL-2.0-only WITH Classpath-exception-2.0",), ("MPL-2.0",)}


@pytest.mark.parametrize(
    "artifact",
    [
        "image:api",
        "image:dashboard",
        "image:flow-noguidance",
        "image:code-runner",
        "aar:openverify-sdk",
        "npm:openverify-js",
    ],
)
def test_the_real_ledger_names_no_section_6_row_elsewhere(
    real_ledger: Any, artifact: str
) -> None:
    assert not [f for f in judge(artifact, real_ledger) if "§6" in (f.row or "")]


def test_the_real_ledger_holds_junit_4_as_test_scope_tooling(real_ledger: Any) -> None:
    junit = comp(
        "pkg:maven/junit/junit@4.13.2?type=jar", [lname("EPL-1.0")], group="junit"
    )
    assert outcome(judge("aar:openverify-sdk", real_ledger, junit), "junit") == (
        "fail",
        "tooling-shipped",
    )


def test_the_real_ledger_records_q12_granted_for_locust_and_keeps_it_out_of_this_release(
    real_ledger: Any,
) -> None:
    # Q12 granted (2026-11-21, after Workflow 11D's Stage 1a; verification V16): the grant is
    # recorded and changes nothing in this release, so load/ keeps vegeta and the httpx driver.
    rows = [row for row in real_ledger.rows if row.cells[0].startswith("Locust ")]
    assert len(rows) == 1
    text = " | ".join(rows[0].cells)
    assert "Q12" in text and "granted" in text
    assert "pending" not in text.lower()
    assert "next release" in text
    assert 'name = "locust"' not in (ROOT / "load" / "uv.lock").read_text(
        encoding="utf-8"
    )
