#!/usr/bin/env python3
"""The DAST helper of security/zap/run.sh (Phase 11, Workflow 11F, dast-11f; C283).

Standard library only, run with `python3 -I`. Commands:

  split  --spec <openapi.json> --groups <api-groups.tsv> --out <dir> [--credentials <file>]
         One OpenAPI document per API scan group (security/zap/api-groups.tsv), each holding the
         operations of its tags, minus the held-out ones; the flow group's three public handoff
         routes carry the run's own handoff as their examples. Prints "<group> TAB <auth> TAB <ops>".
  check  --rules <rules.tsv> --groups <api-groups.tsv> --spec <openapi.json>
         The rules parse, and every operation of the document is in a group or held out.
  report --run-dir <dir> --rules <rules.tsv> --out <md> [--flow-headers <ts>] [--triage <tsv>]
         The committed report (C283.2-C283.5) from ZAP's raw reports in <dir>/wrk: route, rule,
         risk, status and the fix or the reason, per scan the routes reached, the flow's header
         checks. Nothing a request or a response carried is copied (no header, evidence, attack,
         body or other info), and the text is refused (exit 3, nothing written) when it would hold
         a credential of the run or any token-shaped value. Exit 1 when a high alert is open (not
         IGNOREd) or a FAIL rule fired; 0 otherwise.

Exit codes: 0 ok, 1 the gate failed, 2 usage or an invalid input file, 3 a credential would leak.
"""

from __future__ import annotations

import argparse
import copy
import functools
import hashlib
import html
import json
import os
import re
import sys
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

ACTIONS = ("FAIL", "WARN", "IGNORE")
AUTH_SCHEMES = ("apiKey", "userSession", "sessionToken")
METHODS = ("get", "put", "post", "delete", "options", "head", "patch", "trace")
RISKS = {0: "Informational", 1: "Low", 2: "Medium", 3: "High"}

# .gitleaks.toml's OpenVerify bearer tokens, from 20 characters on (a shortened one counts too).
TOKEN_RE = re.compile(r"(?:ov_(?:sbx|prod)|ov[suomih])_[A-Za-z0-9_-]{20,}")
# A header line a raw report may carry; the report never writes one.
HEADER_RE = re.compile(
    r"\b(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-Api-Key)[ \t]*:",
    re.IGNORECASE,
)
REMOVED = "[credential removed]"
SAFE_PARAM = re.compile(r"[A-Za-z][A-Za-z0-9_.\[\]-]{0,63}")
GROUP_NAME = re.compile(r"[a-z][a-z0-9-]{0,31}")
ID_SEGMENT = re.compile(
    r"[a-z]{2,8}_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}"  # an OpenVerify id (prefix and ULID)
    r"|[0-9]+"
    r"|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    r"|[A-Za-z0-9_-]{24,}"
)
HANDOFF_ROUTES = (
    "/api/v1/flow/handoffs/preview",
    "/api/v1/flow/handoffs/decline",
    "/api/v1/flow/handoffs/redeem",
)
HANDOFF_FIELDS = (("inquiry-id", "inquiry-id"), ("handoff-token", "handoff-token"))
HANDOFF_CODE = ("confirmation-code", "code")


@dataclass(frozen=True)
class Rule:
    rule_id: str
    action: str
    name: str
    reason: str


@dataclass(frozen=True)
class Group:
    name: str
    auth: str
    tags: tuple[str, ...]


@dataclass(frozen=True)
class Hold:
    method: str
    path: str
    reason: str


@dataclass(frozen=True)
class Alert:
    scan: str
    rule_id: str
    alert_ref: str
    name: str
    risk: int
    confidence: int
    method: str
    route: str
    param: str


@dataclass(frozen=True)
class HeaderCheck:
    entry: str
    header: str
    expected: str
    ok: bool


@dataclass(frozen=True)
class Gate:
    open_high: tuple[Alert, ...]
    failed: tuple[Alert, ...]


# ------------------------------------------------------------------------------------- rules ----


def _lines(text: str) -> Iterable[tuple[int, str]]:
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.rstrip("\r")
        if line.strip() == "" or line.startswith("#"):
            continue
        yield number, line


def parse_rules(text: str) -> dict[str, Rule]:
    """security/zap/rules.tsv: id TAB FAIL|WARN|IGNORE TAB (name) [TAB reason], IGNORE with one."""
    rules: dict[str, Rule] = {}
    for number, line in _lines(text):
        fields = line.split("\t")
        if len(fields) not in (3, 4):
            raise ValueError(
                f"rules line {number}: expected 3 or 4 tab-separated fields"
            )
        rule_id, action, name = fields[0], fields[1], fields[2].strip()
        reason = fields[3].strip() if len(fields) == 4 else ""
        if not rule_id.isdigit():
            raise ValueError(f"rules line {number}: the rule id is ZAP's number")
        if action not in ACTIONS:
            raise ValueError(
                f"rules line {number}: the action is one of {', '.join(ACTIONS)}"
            )
        if name == "":
            raise ValueError(f"rules line {number}: the rule's name is empty")
        if action == "IGNORE" and reason == "":
            raise ValueError(f"rules line {number}: IGNORE {rule_id} needs its reason")
        if rule_id in rules:
            raise ValueError(f"rules line {number}: rule {rule_id} is listed twice")
        rules[rule_id] = Rule(rule_id, action, name, reason)
    return rules


# ------------------------------------------------------------------------------------ groups ----


def parse_groups(text: str) -> tuple[list[Group], list[Hold]]:
    """security/zap/api-groups.tsv: group TAB auth TAB tag,tag... (a tag@/prefix takes that tag's
    operations under the path prefix) and hold TAB METHOD /path TAB reason."""
    groups: list[Group] = []
    holds: list[Hold] = []
    seen_tags: dict[str, str] = {}
    for number, line in _lines(text):
        fields = line.split("\t")
        if len(fields) != 3:
            raise ValueError(f"groups line {number}: expected 3 tab-separated fields")
        if fields[0] == "hold":
            operation, reason = fields[1].split(" "), fields[2].strip()
            if len(operation) != 2 or operation[0].lower() not in METHODS:
                raise ValueError(f"groups line {number}: a hold names METHOD /path")
            if not operation[1].startswith("/") or reason == "":
                raise ValueError(
                    f"groups line {number}: a hold names a /path and its reason"
                )
            holds.append(Hold(operation[0].upper(), operation[1], reason))
            continue
        name, auth = fields[0], fields[1]
        tags = tuple(tag.strip() for tag in fields[2].split(",") if tag.strip())
        if GROUP_NAME.fullmatch(name) is None or auth not in AUTH_SCHEMES or not tags:
            raise ValueError(
                f"groups line {number}: group, one of {AUTH_SCHEMES}, and its tags"
            )
        if any(group.name == name for group in groups):
            raise ValueError(f"groups line {number}: group {name} is listed twice")
        for tag in tags:
            if tag in seen_tags:
                raise ValueError(
                    f"groups line {number}: tag {tag} is in {seen_tags[tag]} already"
                )
            seen_tags[tag] = name
        groups.append(Group(name, auth, tags))
    return groups, holds


def _declared(operation: Mapping[str, Any]) -> set[str]:
    schemes: set[str] = set()
    for requirement in operation.get("security") or []:
        schemes.update(requirement)
    return schemes


def split_spec(
    spec: Mapping[str, Any], groups: Sequence[Group], holds: Sequence[Hold]
) -> dict[str, dict[str, Any]]:
    """One document per group (only groups with an operation), in the groups' order."""
    by_tag = {tag: group for group in groups for tag in group.tags if "@" not in tag}
    # tag@/prefix: the tag's operations under that path prefix, the longest prefix first.
    prefixed = sorted(
        (
            (token.split("@", 1)[0], token.split("@", 1)[1], group)
            for group in groups
            for token in group.tags
            if "@" in token
        ),
        key=lambda entry: -len(entry[1]),
    )
    used: set[tuple[str, str]] = set()
    paths: Mapping[str, Any] = spec.get("paths", {})
    held = {(hold.method, hold.path) for hold in holds}
    missing = sorted(
        f"{method} {path}"
        for method, path in held
        if method.lower() not in paths.get(path, {})
    )
    if missing:
        raise ValueError(
            f"a hold names no operation of the document: {', '.join(missing)}"
        )
    unknown: set[str] = set()
    parts: dict[str, dict[str, Any]] = {}
    for path, item in paths.items():
        for method, operation in item.items():
            if method not in METHODS or (method.upper(), path) in held:
                continue
            tags = operation.get("tags") or ["(untagged)"]
            group = by_tag.get(tags[0])
            for tag, prefix, candidate in prefixed:
                if tag == tags[0] and path.startswith(prefix):
                    group = candidate
                    used.add((tag, prefix))
                    break
            if group is None:
                unknown.add(tags[0])
                continue
            declared = _declared(operation)
            if declared and group.auth not in declared:
                raise ValueError(
                    f"{method.upper()} {path} declares {', '.join(sorted(declared))}; "
                    f"group {group.name} sends {group.auth}"
                )
            part = parts.setdefault(group.name, {})
            target = part.setdefault(
                path, {k: v for k, v in item.items() if k not in METHODS}
            )
            target[method] = operation
    if unknown:
        raise ValueError(f"no group names the tag(s): {', '.join(sorted(unknown))}")
    idle = sorted(
        f"{tag}@{prefix}" for tag, prefix, _ in prefixed if (tag, prefix) not in used
    )
    if idle:
        raise ValueError(f"a path prefix takes no operation: {', '.join(idle)}")
    documents: dict[str, dict[str, Any]] = {}
    for group in groups:
        if group.name in parts:
            document = {key: value for key, value in spec.items() if key != "paths"}
            document["paths"] = parts[group.name]
            documents[group.name] = document
    return documents


def with_handoff(spec: Mapping[str, Any], handoff: Mapping[str, str]) -> dict[str, Any]:
    """A copy whose three public handoff routes take the run's handoff as their examples."""
    filled: dict[str, Any] = copy.deepcopy(dict(spec))
    for route in HANDOFF_ROUTES:
        operation = filled.get("paths", {}).get(route, {}).get("post")
        if operation is None:
            continue
        content = operation.get("requestBody", {}).get("content", {})
        schema = content.get("application/json", {}).get("schema", {})
        properties = schema.get("properties", {})
        for field, key in (*HANDOFF_FIELDS, HANDOFF_CODE):
            value = handoff.get(key)
            if field in properties and value:
                properties[field]["example"] = value
                properties[field]["default"] = value
    return filled


def _count(document: Mapping[str, Any]) -> int:
    return sum(
        1 for item in document["paths"].values() for method in item if method in METHODS
    )


# ------------------------------------------------------------------------------------ routes ----


@functools.lru_cache(maxsize=4096)
def _template_pattern(template: str) -> re.Pattern[str]:
    parts = [
        "[^/]+"
        if segment.startswith("{") and segment.endswith("}")
        else re.escape(segment)
        for segment in template.split("/")
    ]
    return re.compile("/".join(parts))


def _segment(segment: str) -> str:
    if ID_SEGMENT.fullmatch(segment) or TOKEN_RE.search(segment):
        return "{id}"
    stem, dot, extension = segment.partition(".")
    if dot and re.fullmatch(r"[0-9a-fA-F]{8,}", stem):
        return "{file}." + extension
    hashed = re.fullmatch(r"(.+)-([A-Za-z0-9_]{6,})", stem)
    if (
        dot
        and hashed
        and re.search(r"\d", hashed.group(2))
        and re.search("[A-Za-z]", hashed.group(2))
    ):
        return f"{hashed.group(1)}-{{hash}}.{extension}"
    return segment


def route_template(uri: str, templates: Sequence[str]) -> str:
    """The OpenAPI template the URI's path matches, else the path with id-like segments named."""
    return _route(urlsplit(uri).path or "/", tuple(templates))


@functools.lru_cache(maxsize=65536)
def _route(path: str, templates: tuple[str, ...]) -> str:
    best: tuple[int, str] | None = None
    for template in templates:
        if _template_pattern(template).fullmatch(path):
            literal = sum(
                1 for segment in template.split("/") if not segment.startswith("{")
            )
            if best is None or literal > best[0]:
                best = (literal, template)
    if best is not None:
        return best[1]
    return "/".join(_segment(segment) for segment in path.split("/")) or "/"


def alerts_from_report(
    report: Mapping[str, Any], scan: str, templates: Sequence[str]
) -> list[Alert]:
    """ZAP's traditional JSON report as alerts: rule, risk, method, route and parameter name only."""
    alerts: dict[tuple[str, str, str, str, str], Alert] = {}
    for site in report.get("site") or []:
        for alert in site.get("alerts") or []:
            rule_id = str(alert.get("pluginid", ""))
            name = str(alert.get("name") or alert.get("alert") or "")
            for instance in alert.get("instances") or []:
                method = str(instance.get("method", "")).upper()
                method = method if method.lower() in METHODS else "?"
                param = str(instance.get("param", ""))
                if SAFE_PARAM.fullmatch(param) is None or HEADER_RE.search(param + ":"):
                    param = ""
                found = Alert(
                    scan=scan,
                    rule_id=rule_id,
                    alert_ref=str(alert.get("alertRef", rule_id)),
                    name=name,
                    risk=int(alert.get("riskcode", 0)),
                    confidence=int(alert.get("confidence", 0)),
                    method=method,
                    route=route_template(str(instance.get("uri", "")), templates),
                    param=param,
                )
                alerts[(found.rule_id, found.alert_ref, method, found.route, param)] = (
                    found
                )
    return list(alerts.values())


# ------------------------------------------------------------------------------------- leaks ----


def leaked(text: str, secrets: Sequence[str]) -> list[str]:
    """Each secret of the run, token-shaped value and header line the text holds."""
    found: list[str] = []
    for secret in secrets:
        if secret and secret in text and secret not in found:
            found.append(secret)
    for match in [*TOKEN_RE.findall(text), *HEADER_RE.findall(text)]:
        if match not in found:
            found.append(match)
    return found


def scrub(text: str, secrets: Sequence[str]) -> str:
    for secret in sorted((s for s in secrets if s), key=len, reverse=True):
        text = text.replace(secret, REMOVED)
    return TOKEN_RE.sub(REMOVED, text)


def _secrets_of(credentials: Any) -> list[str]:
    values: list[str] = []
    if isinstance(credentials, Mapping):
        for key, value in credentials.items():
            if (
                isinstance(value, str)
                and key in ("token", "sessionToken", "code")
                and value
            ):
                values.append(value)
            else:
                values.extend(_secrets_of(value))
    elif isinstance(credentials, list):
        for value in credentials:
            values.extend(_secrets_of(value))
    return values


# ----------------------------------------------------------------------------------- headers ----


def parse_flow_response_headers(ts_source: str) -> dict[str, str]:
    """FLOW_RESPONSE_HEADERS of apps/flow/src/security/response-headers.ts."""
    body = re.search(
        r"FLOW_RESPONSE_HEADERS[^=]*=\s*Object\.freeze\(\{(.*?)\}\)",
        ts_source,
        re.DOTALL,
    )
    if body is None:
        raise ValueError("no FLOW_RESPONSE_HEADERS object in the source")
    pairs = re.findall(
        r"'([A-Za-z-]+)':\s*\"([^\"]*)\"|'([A-Za-z-]+)':\s*'([^']*)'", body.group(1)
    )
    return {a or c: b or d for a, b, c, d in pairs}


def _last_response(raw_headers: str) -> dict[str, list[str]]:
    blocks = [
        b for b in re.split(r"\r?\n\r?\n", raw_headers) if b.strip().startswith("HTTP/")
    ]
    headers: dict[str, list[str]] = {}
    for line in (blocks[-1] if blocks else "").splitlines()[1:]:
        name, colon, value = line.partition(":")
        if colon:
            headers.setdefault(name.strip().lower(), []).append(value.strip())
    return headers


def _directives(policy: str) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for part in policy.split(";"):
        tokens = part.split()
        if tokens:
            result[tokens[0].lower()] = tokens[1:]
    return result


def _weak(policy: Mapping[str, list[str]]) -> bool:
    return any(
        token in ("'unsafe-inline'", "'unsafe-eval'")
        for directive in ("default-src", "script-src", "style-src")
        for token in policy.get(directive, [])
    )


def _meta_policy(page: str) -> str | None:
    for tag in re.findall(r"<meta\b[^>]*>", page, re.IGNORECASE):
        if re.search(
            r"http-equiv\s*=\s*[\"']Content-Security-Policy[\"']", tag, re.IGNORECASE
        ):
            content = re.search(
                r"content\s*=\s*\"([^\"]*)\"|content\s*=\s*'([^']*)'", tag
            )
            if content is not None:
                return html.unescape(content.group(1) or content.group(2) or "")
    return None


def check_flow_headers(
    entry: str, raw_headers: str, html_text: str, expected: Mapping[str, str]
) -> list[HeaderCheck]:
    """The hosted flow's headers (FLOW_RESPONSE_HEADERS, C107.9) and its CSP <meta> (C157)."""
    headers = _last_response(raw_headers)
    checks: list[HeaderCheck] = []
    for name, value in expected.items():
        sent = headers.get(name.lower(), [])
        if name.lower() == "content-security-policy":
            policies = [_directives(policy) for policy in sent]
            wanted = _directives(value)
            ok = (
                bool(policies)
                and all(
                    any(policy.get(d) == tokens for policy in policies)
                    for d, tokens in wanted.items()
                )
                and not any(_weak(policy) for policy in policies)
            )
            checks.append(
                HeaderCheck(
                    entry, name, f"holds {value}; no unsafe-inline or unsafe-eval", ok
                )
            )
        else:
            ok = [" ".join(v.split()) for v in sent] == [" ".join(value.split())]
            checks.append(HeaderCheck(entry, name, value, ok))
    frame = headers.get("x-frame-options", [])
    checks.append(
        HeaderCheck(
            entry, "X-Frame-Options", "DENY", [v.upper() for v in frame] == ["DENY"]
        )
    )
    meta = _meta_policy(html_text)
    checks.append(
        HeaderCheck(
            entry,
            "CSP <meta>",
            "present; no unsafe-inline or unsafe-eval",
            meta is not None and not _weak(_directives(meta)),
        )
    )
    return checks


# -------------------------------------------------------------------------------------- gate ----


def _action(rules: Mapping[str, Rule], rule_id: str) -> str:
    rule = rules.get(rule_id)
    return rule.action if rule is not None else "WARN"


def gate(alerts: Sequence[Alert], rules: Mapping[str, Rule]) -> Gate:
    """A high alert not IGNOREd is open; an alert of a FAIL rule fails from Medium risk up (its Low
    variants, ZAP's "weakness" alerts such as a payload echoed in a JSON response, are reported)."""
    open_high = tuple(
        a for a in alerts if a.risk == 3 and _action(rules, a.rule_id) != "IGNORE"
    )
    failed = tuple(
        a for a in alerts if a.risk >= 2 and _action(rules, a.rule_id) == "FAIL"
    )
    return Gate(open_high, failed)


# ------------------------------------------------------------------------------------ report ----


@dataclass(frozen=True)
class Triage:
    rule_id: str
    route: str
    status: str
    reference: str
    note: str


def parse_triage(text: str) -> list[Triage]:
    """security/zap/triage.tsv: rule TAB route|* TAB status TAB reference TAB note."""
    entries: list[Triage] = []
    for number, line in _lines(text):
        fields = line.split("\t")
        if len(fields) != 5 or not fields[0].isdigit() or fields[2] == "":
            raise ValueError(
                f"triage line {number}: rule, route, status, reference, note"
            )
        entries.append(Triage(*(field.strip() for field in fields)))
    return entries


def _status(
    alert: Alert, rules: Mapping[str, Rule], triage: Sequence[Triage]
) -> tuple[str, str]:
    rule = rules.get(alert.rule_id)
    if rule is not None and rule.action == "IGNORE":
        return f"ignored: {rule.reason}", ""
    for entry in triage:
        if entry.rule_id == alert.rule_id and entry.route in ("*", alert.route):
            return entry.status, " ".join(
                part for part in (entry.reference, entry.note) if part
            )
    action = rule.action if rule is not None else "WARN, unlisted"
    return f"open ({action})", ""


def _scans(text: str) -> list[list[str]]:
    return [line.split("\t") for _, line in _lines(text)]


def _messages(path: Path, templates: Sequence[str]) -> tuple[Counter[str], set[str]]:
    statuses: Counter[str] = Counter()
    routes: set[str] = set()
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return statuses, routes
    for row in rows:
        if isinstance(row, list) and len(row) == 3:
            routes.add(
                f"{str(row[0]).upper()} {route_template(str(row[1]), templates)}"
            )
            statuses[str(row[2])] += 1
    return statuses, routes


def _group_routes(path: Path) -> set[str]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    return {
        f"{method.upper()} {route}"
        for route, item in document.get("paths", {}).items()
        for method in item
        if method in METHODS
    }


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def render_report(
    run_dir: Path,
    rules_text: str,
    rules: Mapping[str, Rule],
    alerts: Sequence[Alert],
    triage: Sequence[Triage],
    expected_headers: Mapping[str, str] | None,
) -> str:
    facts: dict[str, Any] = _json(run_dir / "facts.json", {})
    templates = _templates(run_dir)
    wrk = run_dir / "wrk"
    verdict = gate(alerts, rules)
    risks = Counter(RISKS.get(alert.risk, str(alert.risk)) for alert in alerts)
    ladder = str(facts.get("ladder", "unknown"))
    lines: list[str] = [f"# DAST report, {facts.get('date', 'undated')}", ""]
    if ladder == "iii":
        lines += [
            (
                "**This scan ran against the host-process e2e stack (the same code built on the host), "
                "not the production images.** The images-mode scans (C283.1) stay open with KP11-40."
            ),
            "",
        ]
    lines += [
        (
            "ZAP's scans of the local e2e stack (Phase 11 C283; Workflow 11F, dast-11f), generated by "
            "`security/zap/dast-zap.py` from ZAP's raw reports with every request and response header, "
            "evidence, attack and body removed. **A clean scan means ZAP's rules found nothing on the "
            "routes it reached**; it is not a certification, and it says nothing about what ZAP does "
            "not cover (below)."
        ),
        "",
        "## Verdict",
        "",
        (
            f"- Open high alerts (not IGNOREd): **{len(verdict.open_high)}**; alerts of a FAIL rule: "
            f"**{len(verdict.failed)}**."
        ),
        "- Alerts by risk: "
        + ", ".join(
            f"{risk} {risks.get(risk, 0)}"
            for risk in ("High", "Medium", "Low", "Informational")
        )
        + ".",
        "",
        "## What was scanned",
        "",
        f"- Stack: {_ladder_text(ladder)}",
        (
            f"- ZAP: `{facts.get('zapImage', '')}` (run as an unmodified tool with `-silent`, on the "
            "host network, against loopback URLs only)."
        ),
        (
            f"- The rules file SHA-256: `{hashlib.sha256(rules_text.encode('utf-8')).hexdigest()}` "
            "(`security/zap/rules.tsv`)."
        ),
        f"- Machine: {facts.get('machine', 'not recorded')}.",
        *([f"- The API scans: {facts['settings']}."] if facts.get("settings") else []),
        "",
        "| Image | Image id |",
        "|---|---|",
    ]
    for image in facts.get("images") or []:
        lines.append(
            f"| `{_cell(str(image.get('name', '')))}` | `{_cell(str(image.get('id', '')))}` |"
        )
    lines += [
        "",
        "## Scans",
        "",
        "| Scan | Kind | Duration | Load (1, 5, 15 min) | ZAP exit | Capped | Active rules finished | Routes reached | Answers by status |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    not_reached: dict[str, list[str]] = {}
    total: Counter[str] = Counter()
    for row in _scans(_text(run_dir / "scans.tsv")):
        name, kind, _started, seconds, load, code, capped = (row + [""] * 7)[:7]
        statuses, routes = _messages(wrk / f"{name}-messages.json", templates)
        total.update(statuses)
        planned = _group_routes(wrk / f"openapi-{name.removeprefix('api-')}.json")
        if planned:
            not_reached[name] = sorted(planned - routes)
        answered = ", ".join(
            f"{status} {count}" for status, count in sorted(statuses.items())
        )
        progress = _json(wrk / f"{name}-progress.json", None)
        finished = "n/a"
        if isinstance(progress, list) and progress:
            done = sum(
                1 for row in progress if isinstance(row, list) and row[-1] == "Complete"
            )
            finished = f"{done} of {len(progress)}"
        lines.append(
            f"| {name} | {kind} | {seconds} s | {load} | {code} | {capped} | {finished} "
            f"| {len(routes)} | {answered or 'none'} |"
        )
    server_errors = sum(
        count for status, count in total.items() if status.startswith("5")
    )
    lines += [
        "",
        (
            f"In all, {sum(total.values())} requests answered; {server_errors} with a 5xx status. "
            "Every rate policy's 429 is an expected answer, never a finding; a 429 means the route was "
            "reached and limited."
        ),
        "",
    ]
    if not_reached:
        lines += ["### Operations of each API group ZAP sent no request to", ""]
        for name, missing in not_reached.items():
            lines.append(
                f"- {name}: {len(missing)}"
                + (": " + ", ".join(f"`{m}`" for m in missing) if missing else "")
            )
        lines.append("")
    lines += [
        "## Findings",
        "",
        "| Route | Rule | Risk | Status | Fix or reason | Parameter | Scan |",
        "|---|---|---|---|---|---|---|",
    ]
    listed = [alert for alert in alerts if alert.risk >= 1]
    for alert in sorted(
        listed, key=lambda a: (-a.risk, int(a.rule_id or 0), a.route, a.method, a.scan)
    ):
        status, note = _status(alert, rules, triage)
        route = f"`{alert.method}` `{_cell(alert.route)}`"
        param = f"`{alert.param}`" if alert.param else ""
        lines.append(
            f"| {route} | {alert.rule_id} {_cell(alert.name)} | {RISKS.get(alert.risk, alert.risk)} "
            f"| {_cell(status)} | {_cell(note)} | {param} | {alert.scan} |"
        )
    if not listed:
        lines.append("| none | | | | | | |")
    informational: dict[tuple[str, str, str], list[Alert]] = {}
    for alert in alerts:
        if alert.risk < 1:
            informational.setdefault(
                (alert.rule_id, alert.name, alert.scan), []
            ).append(alert)
    if informational:
        lines += [
            "",
            "## Informational alerts",
            "",
            "One line per rule and scan, with the number of routes it named.",
            "",
            "| Rule | Scan | Routes | Status | Note |",
            "|---|---|---|---|---|",
        ]
        for (rule_id, name, scan), found in sorted(
            informational.items(), key=lambda item: (int(item[0][0] or 0), item[0][2])
        ):
            status, note = _status(found[0], rules, triage)
            named = len({(a.method, a.route) for a in found})
            lines.append(
                f"| {rule_id} {_cell(name)} | {scan} | {named} | {_cell(status)} | {_cell(note)} |"
            )
    fixed = [entry for entry in triage if entry.status == "fixed"]
    if fixed:
        lines += [
            "",
            "## Fixed in this Workflow",
            "",
            "| Rule | Route | Commit | What |",
            "|---|---|---|---|",
        ]
        for entry in fixed:
            lines.append(
                f"| {entry.rule_id} | `{_cell(entry.route)}` | {entry.reference} | {_cell(entry.note)} |"
            )
    if expected_headers is not None:
        checks: list[HeaderCheck] = []
        for headers_file in sorted(wrk.glob("headers-*.txt")):
            captured = headers_file.stem.removeprefix("headers-")
            body = _text(wrk / f"body-{captured}.html")
            checks += check_flow_headers(
                captured, _text(headers_file), body, expected_headers
            )
        if checks:
            lines += [
                "",
                "## The hosted flow's headers",
                "",
                (
                    "Each flow image variant's hosted entry `/`, against `FLOW_RESPONSE_HEADERS` "
                    "(`apps/flow/src/security/response-headers.ts`, C107.9) and the production CSP "
                    "`<meta>` (`apps/flow/src/security/security-meta.ts`); values are not copied."
                ),
                "",
                "| Entry | Header | Expected | Result |",
                "|---|---|---|---|",
            ]
            for check in checks:
                result = "as expected" if check.ok else "**differs**"
                lines.append(
                    f"| {check.entry} | {check.header} | {_cell(check.expected)} | {result} |"
                )
    internal = facts.get("internalRoute") or {}
    if internal:
        lines += [
            "",
            "## The internal route on the public listener (C250.3)",
            "",
            f"- `GET {internal.get('path', '')}` on the API's public listener answered "
            f"**{internal.get('status', 'nothing')}** without the flow server's token. "
            f"{internal.get('note', '')}".rstrip(),
        ]
    lines += [
        "",
        "## What ZAP does not cover (C283.3)",
        "",
        (
            "- Cross-tenant authorisation: its evidence is C240.2's authorisation matrix and the "
            "generated cross-tenant probe (C240.7), not this scan."
        ),
        (
            "- Business logic: Connect's consent and redemption, sessions, quotas and the review rules "
            "are held by their own tests."
        ),
        (
            "- The flow's later steps (capture, documents, selfies, NFC): the API scan reaches their "
            "routes with generated values, not a real verification."
        ),
        (
            "- The console behind real MFA: the scanned console session is a seeded admin's, supplied "
            "through a replacer rule, so no second factor is exercised."
        ),
        "- ZAP is a regression net for headers, error bodies and injection.",
        "",
        "## Re-running one scan",
        "",
        (
            "Each subcommand of `security/zap/run.sh` is one call under the e2e lock, on the reusable "
            "e2e stack in its images mode: `prepare`, `api [group]`, `flow [hosted|noguidance|routes]`, "
            "`console`, `report`, `revoke` (`bash security/zap/run.sh` runs them all in order)."
        ),
        "",
    ]
    return "\n".join(lines)


def _ladder_text(ladder: str) -> str:
    return {
        "i": "the reusable e2e stack in its images mode (C257.3: the five production images and the "
        "no-guidance flow), reached from this host; ZAP's container ran on the engine's host network.",
        "ii": "the reusable e2e stack in its images mode, reached only inside the Docker engine's "
        "host network namespace, where ZAP's container ran.",
        "iii": "the host-process e2e stack (not the production images; KP11-40).",
    }.get(ladder, "not recorded")


def _text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _templates(run_dir: Path) -> list[str]:
    spec = _json(run_dir / "openapi.json", {})
    return sorted(spec.get("paths", {}))


def _raw_reports(wrk: Path) -> list[tuple[Path, dict[str, Any]]]:
    """ZAP's reports among the run's files: the JSON objects holding "site" (the hooks' messages and
    progress lists, the per-group documents and the rest are skipped)."""
    reports: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted(wrk.glob("*.json")):
        if path.name.startswith("openapi-"):
            continue
        document = _json(path, None)
        if isinstance(document, dict) and isinstance(document.get("site"), list):
            reports.append((path, document))
    return reports


def _write_private(path: Path, text: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(text)


# ---------------------------------------------------------------------------------------- CLI ----


def _split(args: argparse.Namespace) -> int:
    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    groups, holds = parse_groups(Path(args.groups).read_text(encoding="utf-8"))
    documents = split_spec(spec, groups, holds)
    handoff: dict[str, str] = {}
    if args.credentials:
        given = _json(Path(args.credentials), {}).get("handoff") or {}
        handoff = {
            "inquiry-id": str(given.get("inquiryId", "")),
            "handoff-token": str(given.get("token", "")),
            "code": str(given.get("code") or ""),
        }
    out = Path(args.out)
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    by_name = {group.name: group for group in groups}
    for name, document in documents.items():
        if args.group and name not in args.group:
            continue
        filled = with_handoff(document, handoff) if handoff else document
        _write_private(out / f"openapi-{name}.json", json.dumps(filled))
        print(f"{name}\t{by_name[name].auth}\t{_count(document)}")
    return 0


def _check(args: argparse.Namespace) -> int:
    parse_rules(Path(args.rules).read_text(encoding="utf-8"))
    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    groups, holds = parse_groups(Path(args.groups).read_text(encoding="utf-8"))
    documents = split_spec(spec, groups, holds)
    total = sum(
        1 for item in spec.get("paths", {}).values() for m in item if m in METHODS
    )
    kept = sum(_count(document) for document in documents.values())
    if kept + len(holds) != total:
        print(
            f"the groups keep {kept} and hold {len(holds)} of {total} operations",
            file=sys.stderr,
        )
        return 1
    print(
        f"rules and groups hold: {kept} operations in {len(documents)} groups, {len(holds)} held out"
    )
    return 0


def _report(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir)
    rules_text = Path(args.rules).read_text(encoding="utf-8")
    rules = parse_rules(rules_text)
    triage = (
        parse_triage(Path(args.triage).read_text(encoding="utf-8"))
        if args.triage
        else []
    )
    expected = None
    if args.flow_headers:
        expected = parse_flow_response_headers(
            Path(args.flow_headers).read_text(encoding="utf-8")
        )
    templates = _templates(run_dir)
    alerts: list[Alert] = []
    for path, document in _raw_reports(run_dir / "wrk"):
        alerts += alerts_from_report(document, path.stem, templates)
    text = render_report(run_dir, rules_text, rules, alerts, triage, expected)
    secrets = _secrets_of(_json(run_dir / "credentials.json", {}))
    found = leaked(text, secrets)
    if found:
        print(
            f"the report would carry {len(found)} credential-shaped value(s); nothing written",
            file=sys.stderr,
        )
        return 3
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    _write_private(
        run_dir / "alerts.json", json.dumps([asdict(alert) for alert in alerts])
    )
    verdict = gate(alerts, rules)
    print(
        f"{out}: {len(alerts)} alerts; open high {len(verdict.open_high)}; FAIL {len(verdict.failed)}"
    )
    if verdict.open_high or verdict.failed:
        for alert in (*verdict.open_high, *verdict.failed):
            print(
                f"open high or FAIL: {alert.rule_id} {alert.method} {alert.route}",
                file=sys.stderr,
            )
        print(
            f"open high: {len(verdict.open_high)}; FAIL rules: {len(verdict.failed)}",
            file=sys.stderr,
        )
        return 1
    return 0


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(prog="dast-zap.py", exit_on_error=False)
    commands = parser.add_subparsers(dest="command", required=True)
    split = commands.add_parser("split")
    split.add_argument("--spec", required=True)
    split.add_argument("--groups", required=True)
    split.add_argument("--out", required=True)
    split.add_argument("--credentials")
    split.add_argument("--group", action="append")
    check = commands.add_parser("check")
    check.add_argument("--rules", required=True)
    check.add_argument("--groups", required=True)
    check.add_argument("--spec", required=True)
    report = commands.add_parser("report")
    report.add_argument("--run-dir", required=True)
    report.add_argument("--rules", required=True)
    report.add_argument("--out", required=True)
    report.add_argument("--flow-headers")
    report.add_argument("--triage")
    try:
        args = parser.parse_args(list(argv))
    except (argparse.ArgumentError, SystemExit):
        return 2
    handlers = {"split": _split, "check": _check, "report": _report}
    try:
        return handlers[args.command](args)
    except (OSError, ValueError) as error:
        print(f"dast-zap.py {args.command}: {error}", file=sys.stderr)
        return 2
    except Exception as error:  # noqa: BLE001 - any other failure is a usage error, never the gate's 1
        print(f"dast-zap.py {args.command}: {type(error).__name__}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
