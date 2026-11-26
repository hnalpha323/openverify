#!/usr/bin/env python3
"""The supply-chain gate (C259.2, C259.3; decision 43, review H14) of infra/scripts/supply-chain.sh.

Every scanner report is reduced to findings with ids (an advisory's id and aliases, a check id or an
audit name), a package or a path, and a severity. A finding at critical or high, or one the scanner
gives no severity, fails unless an unexpired entry of security/allowlist.yaml names one of its ids
with its package or path; zizmor's step fails at medium too. An entry that has expired, or whose
expiry is more than 90 days ahead, or that breaks security/allowlist.schema.json, fails the step
whatever the report holds. Medium and low findings, the allowlisted ones and the entries no finding
used are written to the step summary. A vulnerability database whose build date is older than 24
hours, or unknown, fails (db-age).

Honesty (C259.5): a scanner finds known, published weaknesses in what it can see; a clean report
is not a security review.

Usage (from supply-chain.sh, which passes the allowlist, the schema, the day and the summary):
  supply-chain-gate.py [common options] check-allowlist
  supply-chain-gate.py [common options] gate <format> [--fail-at high|medium] [--root <prefix>]
                       [<prefix>=]<report.json>...
  supply-chain-gate.py [common options] db-age <trivy-version|grype-status> <json>
Common options: --allowlist <yaml> --schema <json> --today <YYYY-MM-DD> --now <ISO-8601>
                --summary <file> --label <step>
Formats: osv, pnpm-audit, pip-audit, zizmor, trivy-config, trivy-image, grype.
Exit status: 0 pass; 1 a failing finding, a refused entry or a stale database; 2 usage, an
unreadable report or one in an unexpected shape.

PyYAML reads the allowlist (system python3's, or security/python's hashed environment).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SEVERITY_ORDER = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
FAIL_AT = {
    "high": {"high", "critical", "unknown"},
    "medium": {"medium", "high", "critical", "unknown"},
}
MAX_DAYS_AHEAD = 90
MAX_DB_AGE = dt.timedelta(hours=24)
FORMATS = ("osv", "pnpm-audit", "pip-audit", "zizmor", "trivy-config", "trivy-image", "grype")


class UsageError(Exception):
    """A report or argument the gate cannot read: exit 2."""


@dataclass
class Finding:
    ids: list[str]
    severity: str
    package: str | None = None
    path: str | None = None
    version: str = ""
    fix: str = ""
    sources: list[str] = field(default_factory=list)

    @property
    def subject(self) -> str:
        return self.package if self.package is not None else (self.path or "")

    def describe(self) -> str:
        where = self.subject + (f"@{self.version}" if self.version else "")
        extra = f" fix {self.fix}" if self.fix else ""
        src = f" in {', '.join(self.sources)}" if self.sources else ""
        return f"{self.ids[0]} {where} {self.severity}{extra}{src}"


@dataclass
class Entry:
    id: str
    package: str | None
    path: str | None
    reason: str
    expires: dt.date
    added_by: str
    used: bool = False

    def subject_text(self) -> str:
        return self.package if self.package is not None else (self.path or "")

    def covers(self, finding: Finding) -> bool:
        if self.id.casefold() not in {i.casefold() for i in finding.ids}:
            return False
        if self.package is not None:
            return (
                finding.package is not None
                and self.package.casefold() == finding.package.casefold()
            )
        if self.path is None:
            return False
        if finding.path is None:
            # A lockfile finding (osv-scanner) names its lockfiles, not one path: a path entry covers
            # it only when every lockfile it was found in is under that path (integration-11c).
            return bool(finding.sources) and all(self._covers_location(s) for s in finding.sources)
        return self._covers_location(finding.path.split(":", 1)[0])

    def _covers_location(self, location: str) -> bool:
        assert self.path is not None
        if self.path.endswith("/"):
            return location.startswith(self.path)
        return location == self.path


# ------------------------------------------------------------------- the allowlist ----


def _as_text(value: Any) -> Any:
    """YAML reads an unquoted 2027-01-31 as a date; the schema's member is that date as text."""
    if isinstance(value, dt.date):
        return value.isoformat()
    return value


def _schema_problems(entries: Any, schema: dict[str, Any]) -> list[str]:
    """The subset of JSON Schema that security/allowlist.schema.json uses, read from the schema."""
    if schema.get("type") != "array" or not isinstance(entries, list):
        return ["the allowlist is not a list of entries"]
    item = schema.get("items", {})
    props: dict[str, dict[str, Any]] = item.get("properties", {})
    problems: list[str] = []
    for index, raw in enumerate(entries):
        label = f"entry {index + 1}"
        if not isinstance(raw, dict):
            problems.append(f"{label} is not a mapping")
            continue
        entry = {key: _as_text(value) for key, value in raw.items()}
        label = f"entry {index + 1} ({entry.get('id', 'no id')})"
        for name in item.get("required", []):
            if name not in entry:
                problems.append(f"{label} has no {name}")
        if item.get("additionalProperties") is False:
            for name in entry:
                if name not in props:
                    problems.append(f"{label} has a member the schema does not name: {name}")
        branches = item.get("oneOf", [])
        if branches:
            met = sum(all(k in entry for k in branch.get("required", [])) for branch in branches)
            if met != 1:
                problems.append(f"{label} must name exactly one of package or path")
        for name, rule in props.items():
            if name not in entry:
                continue
            value = entry[name]
            if rule.get("type") == "string" and not isinstance(value, str):
                problems.append(f"{label}: {name} is not text")
                continue
            if "minLength" in rule and len(value) < rule["minLength"]:
                problems.append(f"{label}: {name} is shorter than {rule['minLength']} characters")
            if "maxLength" in rule and len(value) > rule["maxLength"]:
                problems.append(f"{label}: {name} is longer than {rule['maxLength']} characters")
            if "pattern" in rule and re.search(rule["pattern"], value) is None:
                problems.append(f"{label}: {name} does not match {rule['pattern']}")
            if rule.get("format") == "date":
                try:
                    dt.date.fromisoformat(value)
                except ValueError:
                    problems.append(f"{label}: {name} is not a date (YYYY-MM-DD)")
    return problems


def load_allowlist(path: Path, schema_path: Path, today: dt.date) -> tuple[list[Entry], list[str]]:
    """The entries, and every problem that fails the step (schema, expired, too far ahead)."""
    try:
        import yaml  # type: ignore[import-untyped]  # PyYAML is needed only here, without stubs
    except ImportError as exc:
        raise UsageError(
            "PyYAML is needed to read the allowlist: run with security/python's environment "
            "(uv run --project security/python --frozen python -I ...)"
        ) from exc
    try:
        entries = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        return [], [f"the allowlist {path} cannot be read: {str(exc).splitlines()[0]}"]
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise UsageError(f"the allowlist schema {schema_path} cannot be read: {exc}") from exc
    problems = _schema_problems(entries, schema)
    if problems:
        return [], problems
    out: list[Entry] = []
    for raw in entries:
        entry = Entry(
            id=str(raw["id"]),
            package=raw.get("package"),
            path=raw.get("path"),
            reason=str(raw["reason"]),
            expires=dt.date.fromisoformat(_as_text(raw["expires"])),
            added_by=str(raw["added-by"]),
        )
        if entry.expires < today:
            problems.append(
                f"expired: {entry.id} ({entry.subject_text()}) expired on {entry.expires}"
            )
        elif entry.expires > today + dt.timedelta(days=MAX_DAYS_AHEAD):
            problems.append(
                f"more than 90 days ahead: {entry.id} ({entry.subject_text()}) expires on "
                f"{entry.expires}, after {today + dt.timedelta(days=MAX_DAYS_AHEAD)}"
            )
        out.append(entry)
    return out, problems


# ---------------------------------------------------------------- the report formats ----


def _cvss_rating(score: str) -> str | None:
    try:
        value = float(score)
    except ValueError:
        return None
    if value >= 9.0:
        return "critical"
    if value >= 7.0:
        return "high"
    if value >= 4.0:
        return "medium"
    if value > 0.0:
        return "low"
    return "info"


def _word(severity: Any) -> str:
    text = str(severity or "").strip().lower()
    return {
        "critical": "critical",
        "high": "high",
        "moderate": "medium",
        "medium": "medium",
        "low": "low",
        "negligible": "low",
        "informational": "info",
        "info": "info",
    }.get(text, "unknown")


def _need(condition: bool, what: str) -> None:
    if not condition:
        raise UsageError(f"the report is not {what}")


def parse_osv(report: Any, root: str) -> list[Finding]:
    _need(isinstance(report, dict) and isinstance(report.get("results"), list), "osv-scanner JSON")
    merged: dict[tuple[str, str, str], Finding] = {}
    for result in report["results"]:
        source = str(result.get("source", {}).get("path", ""))
        if root and source.startswith(root):
            source = source[len(root) :]
        for pkg in result.get("packages") or []:
            meta = pkg.get("package", {})
            advisory = {v.get("id"): v for v in pkg.get("vulnerabilities") or []}
            for group in pkg.get("groups") or []:
                ids = list(dict.fromkeys([*group.get("ids", []), *group.get("aliases", [])]))
                severity = _cvss_rating(str(group.get("max_severity", ""))) or "unknown"
                if severity == "unknown":
                    words = [
                        _word(advisory.get(i, {}).get("database_specific", {}).get("severity"))
                        for i in group.get("ids", [])
                    ]
                    known = [w for w in words if w != "unknown"]
                    if known:
                        severity = max(known, key=lambda w: SEVERITY_ORDER[w])
                key = (str(meta.get("name")), str(meta.get("version", "")), ids[0])
                finding = merged.setdefault(
                    key,
                    Finding(ids=ids, severity=severity, package=key[0], version=key[1]),
                )
                if source not in finding.sources:
                    finding.sources.append(source)
    return list(merged.values())


def parse_pnpm_audit(report: Any, _root: str) -> list[Finding]:
    _need(
        isinstance(report, dict) and isinstance(report.get("advisories"), dict), "pnpm audit JSON"
    )
    out = []
    for key, adv in report["advisories"].items():
        ids = [i for i in [adv.get("github_advisory_id"), *(adv.get("cves") or []), str(key)] if i]
        versions = sorted({str(f.get("version")) for f in adv.get("findings") or []})
        out.append(
            Finding(
                ids=ids,
                severity=_word(adv.get("severity")),
                package=str(adv.get("module_name")),
                version=",".join(versions),
                fix=str(adv.get("patched_versions") or ""),
            )
        )
    return out


def parse_pip_audit(report: Any, _root: str) -> list[Finding]:
    _need(
        isinstance(report, dict) and isinstance(report.get("dependencies"), list), "pip-audit JSON"
    )
    out = []
    for dep in report["dependencies"]:
        for vuln in dep.get("vulns") or []:
            out.append(
                Finding(
                    ids=[str(vuln.get("id")), *vuln.get("aliases", [])],
                    severity="unknown",  # pip-audit reports no severity: fail closed
                    package=str(dep.get("name")),
                    version=str(dep.get("version", "")),
                    fix=",".join(vuln.get("fix_versions") or []),
                )
            )
    return out


def parse_zizmor(report: Any, root: str) -> list[Finding]:
    _need(isinstance(report, list), "zizmor JSON")
    out = []
    for item in report:
        locations = item.get("locations") or []
        primary = [loc for loc in locations if loc.get("symbolic", {}).get("kind") == "Primary"]
        loc = (primary or locations or [{}])[0]
        path = str(loc.get("symbolic", {}).get("key", {}).get("Local", {}).get("verbatim_path", ""))
        if root and path.startswith(root):
            path = path[len(root) :]  # an absolute location, named as its repository path
        row = loc.get("concrete", {}).get("location", {}).get("start_point", {}).get("row")
        where = f"{path}:{row + 1}" if isinstance(row, int) and path else path
        sev = _word(item.get("determinations", {}).get("severity"))
        out.append(Finding(ids=[str(item.get("ident"))], severity=sev, path=where))
    return out


def parse_trivy_config(report: Any, root: str) -> list[Finding]:
    _need(
        isinstance(report, dict) and ("Results" in report or "SchemaVersion" in report),
        "Trivy config JSON",
    )
    out = []
    for result in report.get("Results") or []:
        target = root + str(result.get("Target", ""))
        for mis in result.get("Misconfigurations") or []:
            if mis.get("Status") != "FAIL":
                continue
            ids = [i for i in (mis.get("ID"), mis.get("AVDID")) if i]
            out.append(Finding(ids=ids, severity=_word(mis.get("Severity")), path=target))
    return out


def parse_trivy_image(report: Any, root: str) -> list[Finding]:
    _need(isinstance(report, dict) and "Results" in report, "Trivy image JSON")
    out = []
    for result in report.get("Results") or []:
        for vuln in result.get("Vulnerabilities") or []:
            out.append(
                Finding(
                    ids=[str(vuln.get("VulnerabilityID"))],
                    severity=_word(vuln.get("Severity")),
                    package=str(vuln.get("PkgName")),
                    version=str(vuln.get("InstalledVersion", "")),
                    fix=str(vuln.get("FixedVersion") or ""),
                    sources=[root + str(result.get("Target", ""))],
                )
            )
    return out


def parse_grype(report: Any, root: str) -> list[Finding]:
    _need(isinstance(report, dict) and isinstance(report.get("matches"), list), "Grype JSON")
    out = []
    for match in report["matches"]:
        vuln = match.get("vulnerability", {})
        related = [
            str(r.get("id")) for r in match.get("relatedVulnerabilities") or [] if r.get("id")
        ]
        art = match.get("artifact", {})
        fixes = vuln.get("fix", {}).get("versions") or []
        out.append(
            Finding(
                ids=[str(vuln.get("id")), *related],
                severity=_word(vuln.get("severity")),
                package=str(art.get("name")),
                version=str(art.get("version", "")),
                fix=",".join(fixes),
                sources=[root] if root else [],
            )
        )
    return out


PARSERS = {
    "osv": parse_osv,
    "pnpm-audit": parse_pnpm_audit,
    "pip-audit": parse_pip_audit,
    "zizmor": parse_zizmor,
    "trivy-config": parse_trivy_config,
    "trivy-image": parse_trivy_image,
    "grype": parse_grype,
}


def read_json(path: str) -> Any:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        raise UsageError(f"cannot read the report {path}: {exc}") from exc


# ------------------------------------------------------------------------ the summary ----


class Summary:
    def __init__(self, path: str | None, label: str) -> None:
        self.path = path
        self.lines: list[str] = []
        self.label = label

    def add(self, *lines: str) -> None:
        self.lines.extend(lines)

    def write(self) -> None:
        if not self.lines:
            return
        text = "\n".join([f"### supply-chain: {self.label}", "", *self.lines, ""]) + "\n"
        if self.path:
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write(text)
        else:
            sys.stdout.write(text)


def _bullets(title: str, items: Iterable[str]) -> list[str]:
    items = list(items)
    if not items:
        return []
    return [f"**{title}** ({len(items)})", "", *[f"- {i}" for i in items], ""]


# ------------------------------------------------------------------------ the commands ----


def report_allowlist_problems(problems: list[str], summary: Summary) -> None:
    for problem in problems:
        print(f"FAIL allowlist: {problem}")
    summary.add(*_bullets("Allowlist problems (each fails the step)", problems))


def cmd_check_allowlist(args: argparse.Namespace, summary: Summary) -> int:
    entries, problems = load_allowlist(args.allowlist, args.schema, args.today)
    report_allowlist_problems(problems, summary)
    if problems:
        return 1
    print(f"allowlist: {len(entries)} entries, none expired, none more than 90 days ahead")
    summary.add(
        f"Allowlist: {len(entries)} entries, each with its reason and an expiry within 90 days.",
        "",
    )
    return 0


def cmd_gate(args: argparse.Namespace, summary: Summary) -> int:
    if args.format not in PARSERS:
        raise UsageError(f"unknown report format {args.format} (one of {', '.join(FORMATS)})")
    entries, problems = load_allowlist(args.allowlist, args.schema, args.today)
    findings: list[Finding] = []
    for spec in args.reports:
        prefix, _, path = spec.rpartition("=") if "=" in spec else ("", "", spec)
        findings.extend(PARSERS[args.format](read_json(path), prefix or args.root))
    failing_levels = FAIL_AT[args.fail_at]
    failing, allowed, reported = [], [], []
    for finding in sorted(
        findings, key=lambda f: (-SEVERITY_ORDER.get(f.severity, 5), f.ids[0], f.subject)
    ):
        if finding.severity not in failing_levels:
            reported.append(finding)
            continue
        cover = next((e for e in entries if e.covers(finding)), None)
        if cover is None:
            failing.append(finding)
        else:
            cover.used = True
            allowed.append((finding, cover))
    for finding in failing:
        print(f"FAIL {finding.describe()}")
    for finding, entry in allowed:
        print(f"allowlisted {finding.describe()} until {entry.expires} ({entry.added_by})")
    unused = [e for e in entries if not e.used]
    report_allowlist_problems(problems, summary)
    print(
        f"{args.format}: {len(findings)} findings, {len(failing)} failing at {args.fail_at} "
        "or above "
        f"(or unscored), {len(allowed)} allowlisted, {len(reported)} below the gate"
    )
    summary.add(
        f"{args.format}: {len(findings)} findings; {len(failing)} failing (critical, high"
        f"{', medium' if args.fail_at == 'medium' else ''} or no severity), "
        f"{len(allowed)} allowlisted, "
        f"{len(reported)} reported.",
        "",
        *_bullets("Failing", (f.describe() for f in failing)),
        *_bullets(
            "Allowlisted",
            (f"{f.describe()}: {e.reason} (until {e.expires}, {e.added_by})" for f, e in allowed),
        ),
        *_bullets("Reported below the gate", (f.describe() for f in reported)),
    )
    # One allowlist serves every step, so an entry another step's report uses is only reported here.
    for entry in unused:
        print(f"notice: unused allowlist entry {entry.id} ({entry.subject_text()}) for this report")
    return 1 if failing or problems else 0


def _parse_time(text: Any) -> dt.datetime | None:
    if not isinstance(text, str) or not text:
        return None
    value = text.strip().replace("Z", "+00:00")
    value = re.sub(r"\.(\d{6})\d+", r".\1", value)  # nanoseconds, as Go writes them
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.UTC)


def cmd_db_age(args: argparse.Namespace, summary: Summary) -> int:
    report = read_json(args.report)
    if args.format == "trivy-version":
        name = "Trivy vulnerability database"
        built_text = (
            (report.get("VulnerabilityDB") or {}).get("UpdatedAt")
            if isinstance(report, dict)
            else None
        )
    elif args.format == "grype-status":
        name = "Grype vulnerability database"
        built_text = report.get("built") if isinstance(report, dict) else None
    else:
        raise UsageError(f"unknown database report {args.format} (trivy-version or grype-status)")
    built = _parse_time(built_text)
    if built is None:
        print(f"FAIL {name}: no build date in {args.report}")
        summary.add(f"{name}: no build date reported: refused (C259.3).", "")
        return 1
    age = args.now - built
    hours = age.total_seconds() / 3600
    if age > MAX_DB_AGE:
        print(
            f"FAIL {name} older than 24 hours: built {built_text}, "
            f"{hours:.1f} hours before {args.now.isoformat()}"
        )
        summary.add(
            f"{name}: built {built_text} ({hours:.1f} hours old): older than 24 hours, "
            "refused (C259.3).",
            "",
        )
        return 1
    print(f"{name}: built {built_text} ({hours:.1f} hours old)")
    summary.add(f"{name}: built {built_text} ({hours:.1f} hours old).", "")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="supply-chain-gate.py", description=__doc__.splitlines()[0]
    )
    parser.add_argument("--allowlist", type=Path, default=Path("security/allowlist.yaml"))
    parser.add_argument("--schema", type=Path, default=Path("security/allowlist.schema.json"))
    parser.add_argument("--today", type=dt.date.fromisoformat, default=None)
    parser.add_argument("--now", type=_parse_time, default=None)
    parser.add_argument("--summary", default=None)
    parser.add_argument("--label", default="gate")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check-allowlist")
    gate = sub.add_parser("gate")
    gate.add_argument("format")
    gate.add_argument("--fail-at", choices=sorted(FAIL_AT), default="high")
    gate.add_argument("--root", default="")
    gate.add_argument("reports", nargs="+")
    age = sub.add_parser("db-age")
    age.add_argument("format")
    age.add_argument("report")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 2 if exc.code else 0
    now = args.now or dt.datetime.now(dt.UTC)
    args.now = now
    args.today = args.today or now.date()
    summary = Summary(args.summary, args.label)
    try:
        if args.command == "check-allowlist":
            rc = cmd_check_allowlist(args, summary)
        elif args.command == "gate":
            rc = cmd_gate(args, summary)
        else:
            rc = cmd_db_age(args, summary)
    except UsageError as exc:
        print(f"supply-chain-gate: {exc}", file=sys.stderr)
        return 2
    summary.write()
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
