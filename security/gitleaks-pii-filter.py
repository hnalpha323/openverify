#!/usr/bin/env python3
"""Run gitleaks with the PII-pattern configuration and keep what is personal data (C260.3).

gitleaks 8.30.1 matches regular expressions and has no Luhn or mod-97 validator, so the shape
rules ``pii-card-number`` and ``pii-iban`` of ``security/gitleaks-pii.toml`` match every long
digit run and every IBAN-shaped word. This script keeps a card match only when it is Luhn-valid
and starts with a card network's prefix at a length the network issues, and an IBAN match only
when its mod-97 check holds; every other rule's finding is kept as gitleaks reported it (their
exceptions are in ``security/gitleaks-pii-allowlist.toml``).

It prints each kept finding as its rule, file and line (and commit, for a history scan), never the
matched value, and a count per rule. gitleaks writes its JSON report, which holds the values, to a
private temporary directory that is removed before this script exits.

Usage, from the repository root (gitleaks resolves the configuration's ``[extend]`` path from the
working directory)::

    python3 -I security/gitleaks-pii-filter.py --gitleaks <gitleaks> dir .
    python3 -I security/gitleaks-pii-filter.py --gitleaks <gitleaks> git --pre-commit --staged .
    python3 -I security/gitleaks-pii-filter.py --gitleaks <gitleaks> git .        # full history
    python3 -I security/gitleaks-pii-filter.py --report <gitleaks JSON report>    # filter only

Exit status: 0 nothing kept, 1 findings kept, 2 a usage error, an unreadable report or a gitleaks
failure (the pre-commit hook and the supply-chain step fail closed on both 1 and 2).

Honesty (C260.4): a pattern catches what looks like personal data; it cannot tell a real number
from a synthetic one. Standard library only.
"""

from __future__ import annotations

import argparse
import collections
import json
import subprocess
import sys
import tempfile
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = "security/gitleaks-pii.toml"
CARD_RULE = "pii-card-number"
IBAN_RULE = "pii-iban"
SCAN_MODES = ("dir", "git")
EXIT_CLEAN = 0
EXIT_FINDINGS = 1
EXIT_ERROR = 2

# Card networks' issuer prefixes (inclusive ranges over the leading digits) and the lengths each
# issues: Visa, Mastercard, American Express, Discover, JCB, Diners Club, UnionPay, Mir, Maestro.
_NETWORKS: tuple[tuple[str, int, int, frozenset[int]], ...] = (
    ("visa", 4, 4, frozenset({13, 16, 19})),
    ("mastercard", 51, 55, frozenset({16})),
    ("mastercard", 2221, 2720, frozenset({16})),
    ("amex", 34, 34, frozenset({15})),
    ("amex", 37, 37, frozenset({15})),
    ("discover", 6011, 6011, frozenset(range(16, 20))),
    ("discover", 644, 649, frozenset(range(16, 20))),
    ("discover", 65, 65, frozenset(range(16, 20))),
    ("jcb", 3528, 3589, frozenset(range(16, 20))),
    ("diners", 300, 305, frozenset(range(14, 20))),
    ("diners", 36, 36, frozenset(range(14, 20))),
    ("diners", 38, 39, frozenset(range(16, 20))),
    ("unionpay", 62, 62, frozenset(range(16, 20))),
    ("mir", 2200, 2204, frozenset(range(16, 20))),
    ("maestro", 5018, 5018, frozenset(range(12, 20))),
    ("maestro", 5020, 5020, frozenset(range(12, 20))),
    ("maestro", 5038, 5038, frozenset(range(12, 20))),
    ("maestro", 5893, 5893, frozenset(range(12, 20))),
    ("maestro", 6304, 6304, frozenset(range(12, 20))),
    ("maestro", 6759, 6759, frozenset(range(12, 20))),
    ("maestro", 6761, 6763, frozenset(range(12, 20))),
)


def digits_of(value: str) -> str:
    """The digits of a card-shaped value, its spaces and hyphens dropped."""
    return "".join(character for character in value if character.isdigit())


def luhn_valid(digits: str) -> bool:
    """True when the digit string passes the Luhn check (ISO/IEC 7812-1)."""
    if not digits.isdigit():
        return False
    total = 0
    for index, character in enumerate(reversed(digits)):
        number = int(character)
        if index % 2 == 1:
            number *= 2
            if number > 9:
                number -= 9
        total += number
    return total % 10 == 0


def card_network(digits: str) -> str | None:
    """The network whose prefix and length the digits have, or None."""
    for name, low, high, lengths in _NETWORKS:
        width = len(str(low))
        if (
            len(digits) in lengths
            and len(digits) >= width
            and low <= int(digits[:width]) <= high
        ):
            return name
    return None


def is_card_number(value: str) -> bool:
    """A Luhn-valid number with a card network's prefix and length."""
    digits = digits_of(value)
    return card_network(digits) is not None and luhn_valid(digits)


def iban_valid(value: str) -> bool:
    """True when the value is an IBAN whose mod-97 check holds (ISO 13616-1)."""
    compact = value.replace(" ", "").upper()
    if not 15 <= len(compact) <= 34 or not compact.isalnum() or not compact.isascii():
        return False
    if not (compact[:2].isalpha() and compact[2:4].isdigit()):
        return False
    rearranged = compact[4:] + compact[:4]
    number = "".join(str(int(character, 36)) for character in rearranged)
    return int(number) % 97 == 1


def keep(finding: Mapping[str, Any]) -> bool:
    """Whether a gitleaks finding is kept: card and IBAN shapes only when their checksum holds."""
    rule = str(finding.get("RuleID", ""))
    secret = str(finding.get("Secret", ""))
    if rule == CARD_RULE:
        return is_card_number(secret)
    if rule == IBAN_RULE:
        return iban_valid(secret)
    return True


def filter_findings(findings: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The findings :func:`keep` keeps, in gitleaks' order."""
    return [finding for finding in findings if keep(finding)]


def describe(finding: Mapping[str, Any]) -> str:
    """One line naming a finding without its value: rule, file:line and, for history, commit."""
    where = f"{finding.get('File', '?')}:{finding.get('StartLine', '?')}"
    commit = str(finding.get("Commit", ""))
    return f"{finding.get('RuleID', '?')} {where}" + (
        f" (commit {commit[:12]})" if commit else ""
    )


def summary(findings: Sequence[Mapping[str, Any]]) -> list[str]:
    """The report's lines: each finding, then a count per rule (sorted by rule)."""
    counts = collections.Counter(
        str(finding.get("RuleID", "?")) for finding in findings
    )
    lines = [describe(finding) for finding in findings]
    lines += [f"{rule}: {count}" for rule, count in sorted(counts.items())]
    return lines


def read_report(path: Path) -> list[Mapping[str, Any]]:
    """gitleaks' JSON report (an array; an empty file reads as no finding)."""
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return []
    document = json.loads(text)
    if not isinstance(document, list) or not all(
        isinstance(item, dict) for item in document
    ):
        raise ValueError("a gitleaks JSON report is an array of findings")
    return document


def run_gitleaks(gitleaks: str, config: str, scan: Sequence[str], report: Path) -> int:
    """Run gitleaks' ``scan`` with the configuration, writing its JSON report; its exit status."""
    command = [
        gitleaks,
        *scan,
        "--config",
        config,
        "--report-format",
        "json",
        "--report-path",
        str(report),
        "--exit-code",
        "0",
        "--no-banner",
        "--no-color",
        "--log-level",
        "error",
    ]
    # The binary is the caller's pinned gitleaks, run with an argument list and no shell.
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        sys.stderr.write(completed.stderr[-2000:])
    return completed.returncode


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the PII-pattern scan and keep the checksum-valid card and IBAN matches.",
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--gitleaks", help="the gitleaks binary to run")
    source.add_argument(
        "--report", type=Path, help="filter an existing gitleaks JSON report"
    )
    parser.add_argument(
        "--config", default=DEFAULT_CONFIG, help="the gitleaks configuration"
    )
    parser.add_argument(
        "scan", nargs=argparse.REMAINDER, help="dir|git and gitleaks' arguments"
    )
    arguments = parser.parse_args(argv)
    if arguments.gitleaks is not None and (
        not arguments.scan or arguments.scan[0] not in SCAN_MODES
    ):
        parser.error("name the gitleaks scan: dir <path> or git [flags] <path>")
    if arguments.report is not None and arguments.scan:
        parser.error("--report takes no scan arguments")
    return arguments


def main(argv: Sequence[str] | None = None) -> int:
    try:
        arguments = parse_args(sys.argv[1:] if argv is None else argv)
    except SystemExit as exit_:
        return EXIT_CLEAN if exit_.code == 0 else EXIT_ERROR
    try:
        if arguments.report is not None:
            findings = read_report(arguments.report)
        else:
            with tempfile.TemporaryDirectory(prefix="openverify-pii-") as private:
                report = Path(private) / "report.json"
                status = run_gitleaks(
                    arguments.gitleaks, arguments.config, arguments.scan, report
                )
                if status != 0:
                    print(f"pii scan: gitleaks failed (exit {status})", file=sys.stderr)
                    return EXIT_ERROR
                findings = read_report(report)
    except (OSError, ValueError) as error:
        print(
            f"pii scan: cannot read the gitleaks report: {type(error).__name__}",
            file=sys.stderr,
        )
        return EXIT_ERROR
    kept = filter_findings(findings)
    for line in summary(kept):
        print(line)
    print(f"pii scan: {len(kept)} finding(s) kept of {len(findings)} matched")
    return EXIT_FINDINGS if kept else EXIT_CLEAN


if __name__ == "__main__":
    sys.exit(main())
