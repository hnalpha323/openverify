#!/usr/bin/env python3
"""The licence check over the release's SBOMs (C261.2; Workflow 11C, sbom-release-11c).

    python3 -I security/check-sbom-licences.py --artifact <id> --sbom <cyclonedx.json>
        [--licences THIRD_PARTY_LICENSES.md] [--report <report.json>]
    python3 -I security/check-sbom-licences.py --list-artifacts

It reads one CycloneDX JSON SBOM (Syft's for an image, a source tree or an npm tarball; the
CycloneDX Gradle plugin's for an AAR) and THIRD_PARTY_LICENSES.md, judges every component of the
artifact under CLAUDE.md rule 4, and writes a machine-readable report (REPORT_SCHEMA) that
`pnpm release:check --tag` reads (C284.2). Each component ends as one of:

  pass         its licence is in rule 4's list (an SPDX expression), it is ours, or a row of
               THIRD_PARTY_LICENSES.md records a decision for it (the row is named);
  owner        its row still reads "owner to confirm" or "pending owner decision": never a silent
               pass. The check still exits 0, and the report sets `pending-owner`, the label the
               staged artifact carries (review H19, verification V01);
  fail         an unknown licence, a section 5 tooling exception that shipped, a section 6
               exception outside the artifact its row names, LGPL outside android/openverify-nfc,
               or a com.google.android.play library (Phase 10 P3 declined);
  aggregation  a package of the image's base distribution, listed apart and never failed when the
               ledger records the aggregation note (C257.5);
  report       a component of a source-tree SBOM, which has no licences offline and ships nothing
               (Stage 1a amendment 21): listed, never judged.

The vendored and compiled-in code no SBOM tool can see is listed by hand from the ledger and
judged by the same rule (review H20, C261.4): the rows of section 6 by the artifact their
"Shipped in" names (Eigen inside onnxruntime-web, which Syft catalogues as MIT), and the vendored
and derived source of sections 2.1.4 and 2.1.5 by the path their usage names.

Exit codes: 0 pass (owner items included), 1 a failure, 2 a usage or input error.
Standard library only; run with `python3 -I`. An SBOM lists what its tool resolved, and a clean
check says only that every listed component has a licence the project accepts (C261.4).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote

EXIT_PASS = 0
EXIT_FAIL = 1
EXIT_USAGE = 2

REPORT_SCHEMA = "openverify/sbom-licence-report@1"
REPOSITORY = Path(__file__).resolve().parent.parent
DEFAULT_LEDGER = REPOSITORY / "THIRD_PARTY_LICENSES.md"

# CLAUDE.md rule 4: MIT, Apache-2.0, BSD, ISC, PostgreSQL, CC0, CC-BY, BlueOak-1.0.0, PSF-2.0,
# MIT-CMU, as SPDX identifiers (compared without case, as SPDX allows).
ALLOWED_LICENCES = frozenset(
    name.lower()
    for name in (
        "MIT",
        "Apache-2.0",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "ISC",
        "PostgreSQL",
        "CC0-1.0",
        "CC-BY-3.0",
        "CC-BY-4.0",
        "BlueOak-1.0.0",
        "PSF-2.0",
        "MIT-CMU",
    )
)
# Exceptions that only widen a permissive grant.
ALLOWED_EXCEPTIONS = frozenset({"llvm-exception"})
# Licence names the registries and POMs write instead of an SPDX identifier, each one meaning
# exactly that identifier. Anything else needs an SPDX identifier or a row of the ledger.
LICENCE_ALIASES: Mapping[str, str] = {
    "the apache software license, version 2.0": "Apache-2.0",
    "apache license, version 2.0": "Apache-2.0",
    "apache license 2.0": "Apache-2.0",
    "apache 2.0": "Apache-2.0",
    "apache-2.0 license": "Apache-2.0",
    "mit license": "MIT",
    "the mit license": "MIT",
    "the mit license (mit)": "MIT",
    "isc license": "ISC",
    "bsd 3-clause": "BSD-3-Clause",
    "the bsd 3-clause license": "BSD-3-Clause",
    "3-clause bsd license": "BSD-3-Clause",
    "bsd 2-clause": "BSD-2-Clause",
}

# Decisions recorded outside the ledger's rows, which the ledger still words as open. Rule 21 of
# Workflow 11C: tslib's 0BSD row reads "owner to confirm", but Phase 5 decision 46 accepted it.
RECORDED_DECISIONS: Mapping[str, str] = {
    "tslib": (
        "Phase 5 decision 46: 0BSD accepted under rule 4 (phase-5.plan.md, 'Owner-delegated "
        "decisions after Workflow 5B (2026-10-24)', item 2; confirmed 2026-10-24)"
    ),
}

LGPL_DECISION = (
    "CLAUDE.md rule 4: LGPL code lives only in android/openverify-nfc (ADR 0009)"
)
GOOGLE_PLAY_GROUP = "com.google.android.play"
# Where a base image keeps its own packages: Debian's, Node's global npm and corepack, and the
# Python base's own interpreter and site-packages. Application code lives elsewhere (/app, the venv).
BASE_PATH_PREFIXES = (
    "/usr/local/lib/node_modules/",
    "/usr/local/lib/python3",
    "/usr/local/lib/libpython3",
    "/usr/lib/",
    "/usr/share/",
    "/usr/local/bin/",
    "/opt/yarn",
    "/var/lib/dpkg/",
    "/lib/",
)
BASE_PURL_TYPES = frozenset({"deb", "rpm", "apk", "alpm"})


@dataclass(frozen=True)
class Artifact:
    """One release artifact the check knows: its kind and the repository path it is built from.

    `without` names what a variant leaves out on purpose: the flow image built with
    OPENVERIFY_FLOW_FACE_GUIDANCE=off carries no onnxruntime-web (C289), so no row of it applies,
    and a component of it found there fails.
    """

    kind: str
    source: str
    without: tuple[str, ...] = ()


ARTIFACTS: Mapping[str, Artifact] = {
    "image:api": Artifact("image", "apps/api"),
    "image:dashboard": Artifact("image", "apps/dashboard"),
    "image:flow": Artifact("image", "apps/flow"),
    "image:flow-noguidance": Artifact("image", "apps/flow", ("onnxruntime-web",)),
    "image:vision": Artifact("image", "services/vision"),
    "image:code-runner": Artifact("image", "packages/workflow-engine"),
    "aar:openverify-sdk": Artifact("aar", "android/openverify-sdk"),
    "aar:openverify-nfc": Artifact("aar", "android/openverify-nfc"),
    "aar:openverify-face": Artifact("aar", "android/openverify-face"),
    "npm:openverify-js": Artifact("npm", "packages/sdk-js"),
    "npm:openverify-node": Artifact("npm", "packages/node"),
    "npm:openverify-react": Artifact("npm", "packages/sdk-react"),
    "source:pnpm": Artifact("source", "."),
    "source:vision": Artifact("source", "services/vision"),
    "source:load": Artifact("source", "load"),
}
NFC_ARTIFACT = "aar:openverify-nfc"


@dataclass(frozen=True)
class Row:
    """One table row of THIRD_PARTY_LICENSES.md.

    kind: runtime (section 2), tooling (5), exception (6), vendored (2.1.4 and 2.1.5),
    planned (2.2) or other. status: decided, owner, declined or planned.
    """

    line: int
    section: str
    kind: str
    cells: tuple[str, ...]
    columns: tuple[str, ...]
    names: frozenset[str]
    ecosystem: str | None
    status: str

    def cell(self, column: str) -> str:
        """The cell under a column whose header starts with `column` ("" when there is none)."""
        return _column(self.columns, self.cells, column)


def _column(columns: Sequence[str], cells: Sequence[str], column: str) -> str:
    for header, value in zip(columns, cells, strict=False):
        if header.lower().startswith(column.lower()):
            return value
    return ""


@dataclass(frozen=True)
class Ledger:
    """THIRD_PARTY_LICENSES.md as the check reads it."""

    rows: tuple[Row, ...]
    aggregation_note: bool
    name: str = "THIRD_PARTY_LICENSES.md"


@dataclass(frozen=True)
class Component:
    """One component of an SBOM."""

    name: str
    version: str
    purl: str
    ecosystem: str
    keys: frozenset[str]
    licences: tuple[str, ...]
    locations: tuple[str, ...] = ()
    group: str = ""
    # The CycloneDX component type: "library", "file", "operating-system", ...
    kind: str = "library"


@dataclass
class Finding:
    """The check's answer for one component."""

    name: str
    version: str
    purl: str
    licences: tuple[str, ...]
    outcome: str
    reason: str
    row: str | None = None
    decision: str | None = None
    hand_listed: bool = False
    extra: dict[str, Any] = field(default_factory=dict)

    def as_json(self) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "name": self.name,
            "version": self.version,
            "purl": self.purl,
            "licences": list(self.licences),
            "outcome": self.outcome,
            "reason": self.reason,
            "row": self.row,
            "decision": self.decision,
            "hand-listed": self.hand_listed,
        }
        entry.update(self.extra)
        return entry


# ------------------------------------------------------------------ SPDX ----
_TOKEN = re.compile(r"\s*(\(|\)|[^\s()]+)")


def _tokens(expression: str) -> list[str]:
    tokens: list[str] = []
    position = 0
    while position < len(expression):
        match = _TOKEN.match(expression, position)
        if match is None:
            break
        tokens.append(match.group(1))
        position = match.end()
    return tokens


class _Parser:
    """A recursive-descent reader of SPDX license expressions (OR < AND < WITH < atom)."""

    def __init__(self, tokens: list[str]) -> None:
        self.tokens = tokens
        self.index = 0

    def peek(self) -> str | None:
        return self.tokens[self.index] if self.index < len(self.tokens) else None

    def take(self) -> str:
        token = self.peek()
        if token is None:
            raise ValueError("expression ends early")
        self.index += 1
        return token

    def parse(self) -> bool:
        value = self.disjunction()
        if self.peek() is not None:
            raise ValueError(f"unexpected {self.peek()!r}")
        return value

    def disjunction(self) -> bool:
        value = self.conjunction()
        while (self.peek() or "").upper() == "OR":
            self.take()
            right = self.conjunction()
            value = value or right
        return value

    def conjunction(self) -> bool:
        value = self.exception()
        while (self.peek() or "").upper() == "AND":
            self.take()
            right = self.exception()
            value = value and right
        return value

    def exception(self) -> bool:
        value = self.atom()
        if (self.peek() or "").upper() == "WITH":
            self.take()
            name = self.take()
            if name in ("(", ")") or name.upper() in ("AND", "OR", "WITH"):
                raise ValueError("WITH needs an exception")
            value = value and name.lower() in ALLOWED_EXCEPTIONS
        return value

    def atom(self) -> bool:
        token = self.take()
        if token == "(":
            value = self.disjunction()
            if self.take() != ")":
                raise ValueError("unbalanced parenthesis")
            return value
        if token == ")" or token.upper() in ("AND", "OR", "WITH"):
            raise ValueError(f"unexpected {token!r}")
        return token.lower() in ALLOWED_LICENCES


def normalise_licence(text: str) -> str:
    """An alias written by a registry or a POM, as its SPDX identifier; anything else unchanged."""
    stripped = text.strip()
    return LICENCE_ALIASES.get(stripped.lower(), stripped)


def licence_allowed(expression: str) -> bool | None:
    """Whether an SPDX expression is allowed by rule 4 (None when it cannot be read)."""
    text = normalise_licence(expression)
    if not text:
        return None
    try:
        return _Parser(_tokens(text)).parse()
    except ValueError:
        return None


def _is_lgpl(licence: str) -> bool:
    lowered = licence.lower()
    return "lgpl" in lowered or "lesser general public" in lowered


# ---------------------------------------------------------------- ledger ----
_HEADING = re.compile(r"^(#{2,3})\s+(.*\S)\s*$")
_SECTION_NUMBER = re.compile(r"^(\d+(?:\.\d+)*)\.?\s")
_BACKTICKED = re.compile(r"`([^`]+)`")
_NAME_LIKE = re.compile(r"^[@A-Za-z0-9][\w.@/:+-]*$")
_VERSIONISH = re.compile(r"^v?\d")
_OWNER = ("owner to confirm", "pending owner decision")


def _split_row(line: str) -> list[str]:
    body = line.strip().removeprefix("|").removesuffix("|")
    return [cell.strip() for cell in body.split("|")]


def _section_kind(title: str, number: str) -> str:
    lowered = title.lower()
    if "vendored source" in lowered or "derived source" in lowered:
        return "vendored"
    if number == "2.2":
        return "planned"
    if number == "2" or number.startswith("2."):
        return "runtime"
    if number == "5":
        return "tooling"
    if number == "6":
        return "exception"
    return "other"


def _status(kind: str, last_cell: str) -> str:
    lowered = last_cell.lower()
    if any(marker in lowered for marker in _OWNER):
        return "owner"
    if kind == "planned" or "to verify on adoption" in lowered:
        return "planned"
    if re.search(r"\bdeclined\b", lowered) and "granted" not in lowered:
        return "declined"
    return "decided"


def _ecosystem(source: str) -> str | None:
    lowered = source.lower()
    if re.search(r"\bnpm\b", lowered):
        return "npm"
    if "pypi" in lowered:
        return "pypi"
    if "maven" in lowered:
        return "maven"
    return None


def _normalise_name(name: str) -> str:
    return name.strip().strip("*").strip().lower()


def _pypi_key(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def row_names(cell: str) -> frozenset[str]:
    """The package names a component cell gives: backticked tokens, then its plain names."""
    names = {_normalise_name(token) for token in _BACKTICKED.findall(cell)}
    plain = _BACKTICKED.sub(" ", cell)
    plain = re.sub(r"\([^)]*\)", " ", plain)
    for part in re.split(r",|\band\b|\+", plain):
        words = [word for word in part.split() if word]
        while words and _VERSIONISH.match(words[-1]):
            words.pop()
        candidate = _normalise_name(" ".join(words))
        if candidate:
            names.add(candidate)
    expanded = set(names)
    for name in names:
        if ":" in name:
            expanded.add(name.split(":", 1)[1])
        if _NAME_LIKE.match(name):
            expanded.add(_pypi_key(name))
    return frozenset(name for name in expanded if name)


def parse_ledger(text: str, name: str = "THIRD_PARTY_LICENSES.md") -> Ledger:
    """Read THIRD_PARTY_LICENSES.md: every table row with its section, names and decision."""
    rows: list[Row] = []
    section, kind = "", "other"
    columns: tuple[str, ...] = ()
    previous_was_table = False
    aggregation_note = False
    for number, line in enumerate(text.splitlines(), start=1):
        heading = _HEADING.match(line)
        if heading:
            title = heading.group(2)
            found = _SECTION_NUMBER.match(title)
            section = found.group(1) if found else title
            kind = _section_kind(title, section)
            previous_was_table = False
            continue
        if not line.lstrip().startswith("|"):
            previous_was_table = False
            if (
                section == "1"
                and "aggregation" in line.lower()
                and "base distribution" in line
            ):
                aggregation_note = True
            continue
        cells = tuple(_split_row(line))
        if not previous_was_table:
            columns = cells
            previous_was_table = True
            continue
        if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append(
            Row(
                line=number,
                section=section,
                kind=kind,
                cells=cells,
                columns=columns,
                names=row_names(cells[0]),
                ecosystem=_ecosystem(_column(columns, cells, "Source")),
                status=_status(kind, cells[-1]),
            )
        )
    return Ledger(rows=tuple(rows), aggregation_note=aggregation_note, name=name)


def _row_ref(ledger: Ledger, row: Row) -> str:
    return f"{ledger.name}:{row.line} (§{row.section})"


# ------------------------------------------------------------------ SBOM ----
def _purl_parts(purl: str) -> tuple[str, str, str]:
    """(type, namespace, name) of a package URL, percent-decoded."""
    if not purl.startswith("pkg:"):
        return "", "", ""
    body = purl[4:].split("?", 1)[0].split("#", 1)[0]
    kind, _, rest = body.partition("/")
    # The version follows the last "@" that does not start a segment (an unencoded npm scope).
    at = max(
        (
            index
            for index, char in enumerate(rest)
            if char == "@" and index and rest[index - 1] != "/"
        ),
        default=-1,
    )
    path = rest[:at] if at >= 0 else rest
    segments = [unquote(segment) for segment in path.split("/") if segment]
    if not segments:
        return kind.lower(), "", ""
    return kind.lower(), "/".join(segments[:-1]), segments[-1]


def _licences_of(entry: Mapping[str, Any]) -> tuple[str, ...]:
    found: list[str] = []
    for item in entry.get("licenses") or []:
        if not isinstance(item, Mapping):
            continue
        if isinstance(item.get("expression"), str):
            found.append(item["expression"])
            continue
        licence = item.get("license")
        if isinstance(licence, Mapping):
            value = licence.get("id") or licence.get("name")
            if isinstance(value, str) and value.strip():
                found.append(value.strip())
    return tuple(found)


def _locations_of(entry: Mapping[str, Any]) -> tuple[str, ...]:
    paths: list[str] = []
    for prop in entry.get("properties") or []:
        if not isinstance(prop, Mapping):
            continue
        name = str(prop.get("name", ""))
        if re.fullmatch(r"syft:location:\d+:path", name) and isinstance(
            prop.get("value"), str
        ):
            paths.append(prop["value"])
    return tuple(paths)


def _component(entry: Mapping[str, Any]) -> Component:
    purl = str(entry.get("purl") or "")
    kind, namespace, purl_name = _purl_parts(purl)
    name = str(entry.get("name") or purl_name)
    group = str(entry.get("group") or "")
    keys: set[str] = set()
    if kind == "npm":
        keys.add(f"{namespace}/{purl_name}".lower() if namespace else purl_name.lower())
    elif kind == "maven":
        group = group or namespace
        keys.update({f"{group}:{purl_name}".lower(), purl_name.lower()})
    elif kind == "pypi":
        keys.add(_pypi_key(purl_name or name))
    else:
        keys.add((purl_name or name).lower())
    keys.discard("")
    if not keys:
        keys.add(name.lower())
    return Component(
        name=name,
        version=str(entry.get("version") or ""),
        purl=purl,
        ecosystem=kind or "unknown",
        keys=frozenset(keys),
        licences=_licences_of(entry),
        locations=_locations_of(entry),
        group=group,
        kind=str(entry.get("type") or "library"),
    )


def _walk(entries: Iterable[Any]) -> Iterable[Mapping[str, Any]]:
    for entry in entries:
        if not isinstance(entry, Mapping):
            continue
        yield entry
        nested = entry.get("components")
        if isinstance(nested, list):
            yield from _walk(nested)


def read_sbom(document: Mapping[str, Any]) -> list[Component]:
    """Read a CycloneDX JSON document's components (nested ones included)."""
    if document.get("bomFormat") != "CycloneDX":
        raise ValueError("not a CycloneDX JSON document (bomFormat is not CycloneDX)")
    entries = document.get("components", [])
    if not isinstance(entries, list):
        raise TypeError("components is not a list")
    return [_component(entry) for entry in _walk(entries) if not _file_record(entry)]


def _file_record(entry: Mapping[str, Any]) -> bool:
    """Syft's record of a file it read (hashes only): not a package, nothing to judge."""
    return (
        entry.get("type") == "file"
        and not entry.get("purl")
        and not entry.get("licenses")
    )


# -------------------------------------------------------------- the rules ----
def _matching_rows(
    component: Component, ledger: Ledger, kinds: Iterable[str]
) -> list[Row]:
    wanted = set(kinds)
    matches = []
    for row in ledger.rows:
        if row.kind not in wanted or not (row.names & component.keys):
            continue
        if row.ecosystem is not None and row.ecosystem != component.ecosystem:
            continue
        matches.append(row)
    return matches


def _first_party(component: Component) -> bool:
    if component.ecosystem == "npm":
        return any(key.startswith("@openverify/") for key in component.keys)
    if component.ecosystem == "maven":
        return component.group.lower() == "dev.openverify"
    if component.ecosystem == "pypi":
        return any(key.startswith("openverify") for key in component.keys)
    return False


def _base(component: Component) -> bool:
    if component.ecosystem in BASE_PURL_TYPES or component.kind == "operating-system":
        return True
    return bool(component.locations) and all(
        path.startswith(BASE_PATH_PREFIXES) for path in component.locations
    )


# An installed npm package's own manifest: <...>/node_modules/<name or @scope/name>/package.json.
_PACKAGE_ROOT = re.compile(r"^(.*/node_modules/(?:@[^/]+/)?[^/@][^/]*)/package\.json$")


def _package_roots(components: Sequence[Component]) -> dict[str, str]:
    """The directory of every installed npm package the SBOM lists, to its name."""
    roots: dict[str, str] = {}
    for component in components:
        if component.ecosystem != "npm":
            continue
        for path in component.locations:
            match = _PACKAGE_ROOT.match(path)
            if match:
                roots[match.group(1)] = component.name
    return roots


def _enclosing(path: str, roots: Mapping[str, str]) -> str | None:
    """The package whose directory holds this manifest, with no node_modules between them."""
    if _PACKAGE_ROOT.match(path) or not path.endswith("/package.json"):
        return None
    directory = path.rsplit("/", 1)[0]
    while "/" in directory:
        directory = directory.rsplit("/", 1)[0]
        if directory.rsplit("/", 1)[-1] == "node_modules":
            return None
        if directory in roots:
            return roots[directory]
    return None


def _inside_package(component: Component, roots: Mapping[str, str]) -> Finding | None:
    """A package.json inside a catalogued package (a subpath manifest, a test fixture) is a
    file of that package, which is judged on its own licence; not a package of its own."""
    if component.ecosystem != "npm" or not component.locations:
        return None
    enclosing = {_enclosing(path, roots) for path in component.locations}
    if None in enclosing or len(enclosing) != 1:
        return None
    return _finding(
        component, "pass", "inside-package", extra={"inside": enclosing.pop()}
    )


def _finding(component: Component, outcome: str, reason: str, **more: Any) -> Finding:
    return Finding(
        name=component.name,
        version=component.version,
        purl=component.purl,
        licences=component.licences,
        outcome=outcome,
        reason=reason,
        **more,
    )


def _judge(artifact_id: str, component: Component, ledger: Ledger) -> Finding:
    artifact = ARTIFACTS[artifact_id]
    if artifact.kind == "source":
        return _finding(component, "report", "source-tree")
    if _first_party(component):
        return _finding(component, "pass", "first-party")
    if component.ecosystem == "maven" and component.group.lower().startswith(
        GOOGLE_PLAY_GROUP
    ):
        return _finding(component, "fail", "google-play")
    if _base(component):
        if artifact.kind != "image":
            return _finding(component, "fail", "base-outside-image")
        if not ledger.aggregation_note:
            return _finding(component, "fail", "aggregation-not-recorded")
        return _finding(component, "aggregation", "base-distribution")
    tooling = _matching_rows(component, ledger, ["tooling"])
    if tooling:
        return _finding(
            component, "fail", "tooling-shipped", row=_row_ref(ledger, tooling[0])
        )
    runtime = _matching_rows(component, ledger, ["runtime"])
    for key in sorted(component.keys):
        if key in RECORDED_DECISIONS:
            row = _row_ref(ledger, runtime[0]) if runtime else None
            return _finding(
                component,
                "pass",
                "recorded-decision",
                row=row,
                decision=RECORDED_DECISIONS[key],
            )
    owner = [row for row in runtime if row.status == "owner"]
    if owner:
        return _finding(
            component,
            "owner",
            "owner-to-confirm",
            row=_row_ref(ledger, owner[0]),
            decision=owner[0].cells[-1],
        )
    if component.licences and any(_is_lgpl(licence) for licence in component.licences):
        decided = [row for row in runtime if row.status == "decided"]
        if artifact_id != NFC_ARTIFACT:
            return _finding(component, "fail", "lgpl-outside-nfc")
        if decided:
            return _finding(
                component,
                "pass",
                "lgpl-in-nfc",
                row=_row_ref(ledger, decided[0]),
                decision=LGPL_DECISION,
            )
        return _finding(component, "fail", "unknown-licence")
    if component.licences and all(licence_allowed(lic) for lic in component.licences):
        return _finding(component, "pass", "licence")
    decided = [row for row in runtime if row.status == "decided"]
    if decided:
        return _finding(
            component,
            "pass",
            "recorded-decision",
            row=_row_ref(ledger, decided[0]),
            decision=decided[0].cells[-1],
        )
    return _finding(component, "fail", "unknown-licence")


# ------------------------------------------------------------ hand-listed ----
def _source_path(cell: str) -> str:
    for token in _BACKTICKED.findall(cell):
        text = str(token)
        if "/" in text:
            return text.strip().strip("/").removeprefix("./")
    return ""


def _within(path: str, source: str) -> bool:
    return path == source or path.startswith(source.rstrip("/") + "/")


def _hosts(cell: str) -> set[str]:
    """The packages a section 6 row's code is compiled into: backticked or hyphenated names."""
    hosts = {_normalise_name(token) for token in _BACKTICKED.findall(cell)}
    for word in re.split(r"[\s,;:]+", _BACKTICKED.sub(" ", cell)):
        word = re.sub(r"('s|[.)(])+$", "", word)
        if re.fullmatch(r"[A-Za-z0-9][\w.]*-[\w.-]+", word):
            hosts.add(word.lower())
    expanded = set(hosts)
    for host in hosts:
        if ":" in host:
            expanded.add(host.split(":", 1)[1])
    return {host for host in expanded if host}


def _hand_name(cell: str) -> str:
    plain = _BACKTICKED.sub(lambda match: match.group(1), cell)
    return re.split(r"[,:]", plain, maxsplit=1)[0].strip()


def _licence_expression(cell: str) -> str:
    """A licence cell's expression: the leading backticked span when there is one, else the cell
    (a note may follow the expression, as SCUBA's names the file headers)."""
    leading = re.match(r"\s*`([^`]+)`", cell)
    return leading.group(1).strip() if leading else cell.strip("`* ")


def _excluded(row: Row, artifact: Artifact) -> bool:
    return any(name in _hosts(row.cells[0]) for name in artifact.without)


def _exception_findings(
    artifact_id: str, components: Sequence[Component], ledger: Ledger
) -> list[Finding]:
    artifact = ARTIFACTS[artifact_id]
    findings: list[Finding] = []
    present = (
        set().union(*(component.keys for component in components))
        if components
        else set()
    )
    for row in ledger.rows:
        if row.kind != "exception":
            continue
        hosts = _hosts(row.cells[0])
        shipped_in = _source_path(row.cell("Shipped"))
        listed_here = bool(shipped_in) and _within(shipped_in, artifact.source)
        listed_here = listed_here and not _excluded(row, artifact)
        found = sorted(hosts & present)
        if not listed_here and not found:
            continue
        base = Finding(
            name=_hand_name(row.cells[0]),
            version="",
            purl="",
            licences=(_licence_expression(row.cell("Licen")),),
            outcome="pass",
            reason="recorded-decision",
            row=_row_ref(ledger, row),
            decision=row.cells[-1],
            hand_listed=True,
            extra={"inside": row.cells[0], "shipped-in": shipped_in},
        )
        if not listed_here:
            base.outcome, base.reason = "fail", "exception-outside-artifact"
            base.extra["found"] = found
        elif row.status == "owner":
            base.outcome, base.reason = "owner", "owner-to-confirm"
        elif row.status == "declined":
            base.outcome, base.reason = "fail", "declined"
        findings.append(base)
    return findings


def _vendored_findings(artifact_id: str, ledger: Ledger) -> list[Finding]:
    artifact = ARTIFACTS[artifact_id]
    findings: list[Finding] = []
    for row in ledger.rows:
        if row.kind != "vendored":
            continue
        used_in = _source_path(row.cell("Us"))
        if not used_in or not _within(used_in, artifact.source):
            continue
        licence = (
            re.split(r"[:(]", row.cell("Licen"), maxsplit=1)[0].strip().strip("`* ")
        )
        allowed = licence_allowed(licence)
        findings.append(
            Finding(
                name=_BACKTICKED.sub(lambda m: m.group(1), row.cells[0])
                .split(" (")[0]
                .strip(),
                version="",
                purl="",
                licences=(licence,),
                outcome="pass" if allowed else "fail",
                reason="licence" if allowed else "unknown-licence",
                row=_row_ref(ledger, row),
                hand_listed=True,
                extra={"used-in": used_in},
            )
        )
    return findings


def evaluate(
    artifact_id: str, components: Sequence[Component], ledger: Ledger
) -> list[Finding]:
    """Judge every component of one artifact, then the code listed by hand for it."""
    artifact = ARTIFACTS[artifact_id]
    roots = _package_roots(components)
    findings = [
        _inside_package(component, roots) or _judge(artifact_id, component, ledger)
        for component in components
    ]
    if artifact.kind == "source":
        return findings
    if not components:
        # A scan that saw nothing proves nothing (a cataloguer left out, a wrong path).
        findings.append(
            Finding(
                name=artifact_id,
                version="",
                purl="",
                licences=(),
                outcome="fail",
                reason="empty-sbom",
            )
        )
    findings.extend(_exception_findings(artifact_id, components, ledger))
    findings.extend(_vendored_findings(artifact_id, ledger))
    return findings


# ---------------------------------------------------------------- report ----
OUTCOMES = ("pass", "owner", "fail", "aggregation", "report")


def build_report(
    artifact_id: str, sbom: str, findings: Sequence[Finding]
) -> dict[str, Any]:
    """The machine-readable report release:check --tag reads (REPORT_SCHEMA)."""
    ordered = sorted(findings, key=lambda f: (f.name.lower(), f.version, f.purl))
    counts = {"components": len(ordered)}
    counts.update(
        {name: sum(1 for f in ordered if f.outcome == name) for name in OUTCOMES}
    )
    owner = counts["owner"] > 0
    result = "fail" if counts["fail"] else ("owner" if owner else "pass")
    return {
        "schema": REPORT_SCHEMA,
        "artifact": artifact_id,
        "sbom": sbom,
        "result": result,
        "pending-owner": owner,
        "label": "pending-owner" if owner else None,
        "counts": counts,
        "owner": [f.as_json() for f in ordered if f.outcome == "owner"],
        "failures": [f.as_json() for f in ordered if f.outcome == "fail"],
        "aggregation": [f.as_json() for f in ordered if f.outcome == "aggregation"],
        "components": [f.as_json() for f in ordered],
    }


def _default_report(sbom: Path) -> Path:
    stem = sbom.name.removesuffix(".json")
    return sbom.with_name(f"{stem}.licences.json")


def _summary(report: Mapping[str, Any]) -> str:
    lines = []
    for key, label in (("owner", "owner"), ("failures", "fail")):
        for entry in report[key]:
            licences = ", ".join(entry["licences"]) or "no licence"
            where = f" [{entry['row']}]" if entry.get("row") else ""
            lines.append(
                f"{label}: {entry['name']} {entry['version']}".rstrip()
                + f" ({licences}): {entry['reason']}{where}"
            )
    counts = report["counts"]
    tally = ", ".join(f"{counts[name]} {name}" for name in OUTCOMES)
    label = f"; label the staged artifact {report['label']}" if report["label"] else ""
    lines.append(
        f"{report['artifact']}: result: {report['result']} "
        f"({counts['components']} components: {tally}){label}"
    )
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    """Run the check over one SBOM; see the module's docstring."""
    parser = argparse.ArgumentParser(
        prog="check-sbom-licences.py",
        description="C261.2: the licence check over an SBOM.",
    )
    parser.add_argument("--artifact", help="the artifact id (--list-artifacts)")
    parser.add_argument("--sbom", type=Path, help="a CycloneDX JSON SBOM")
    parser.add_argument("--licences", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--report", type=Path, help="where to write the report")
    parser.add_argument("--list-artifacts", action="store_true")
    try:
        args = parser.parse_args(list(sys.argv[1:] if argv is None else argv))
    except SystemExit:
        return EXIT_USAGE
    if args.list_artifacts:
        print("\n".join(sorted(ARTIFACTS)))
        return EXIT_PASS
    if not args.artifact or args.sbom is None:
        print(
            "check-sbom-licences.py: --artifact and --sbom are required",
            file=sys.stderr,
        )
        return EXIT_USAGE
    if args.artifact not in ARTIFACTS:
        print(
            f"check-sbom-licences.py: unknown artifact {args.artifact!r}",
            file=sys.stderr,
        )
        return EXIT_USAGE
    try:
        ledger = parse_ledger(
            args.licences.read_text(encoding="utf-8"), args.licences.name
        )
        document = json.loads(args.sbom.read_text(encoding="utf-8"))
        if not isinstance(document, dict):
            raise TypeError("not a JSON object")
        components = read_sbom(document)
    except (OSError, ValueError, TypeError) as error:
        print(f"check-sbom-licences.py: {error}", file=sys.stderr)
        return EXIT_USAGE
    report = build_report(
        args.artifact, str(args.sbom), evaluate(args.artifact, components, ledger)
    )
    target = args.report if args.report is not None else _default_report(args.sbom)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(_summary(report))
    print(f"report: {target}")
    return EXIT_FAIL if report["result"] == "fail" else EXIT_PASS


if __name__ == "__main__":
    sys.exit(main())
