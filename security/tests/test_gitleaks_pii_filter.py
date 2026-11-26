"""Tests of security/gitleaks-pii-filter.py (C260.3; Workflow 11C, sast-pii-11c).

The filter runs gitleaks with security/gitleaks-pii.toml and keeps a card match only when it is
Luhn-valid with a card network's prefix and length, and an IBAN match only when its mod-97 check
holds; every other finding is kept. Every card number and IBAN here is assembled at test time
(its check digit computed below), so no committed literal matches the scan that reads this file.
A fake gitleaks (a small Python script written to tmp_path) stands in for the binary; no test
touches the network.
"""

from __future__ import annotations

import importlib.util
import json
import stat
import sys
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "security" / "gitleaks-pii-filter.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("gitleaks_pii_filter", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["gitleaks_pii_filter"] = module
    spec.loader.exec_module(module)
    return module


pf = _load()


# ------------------------------------------------------------------ builders ----
def luhn_digit(body: str) -> str:
    """The Luhn check digit that completes ``body`` (computed here, never written as a literal)."""
    total = 0
    for index, character in enumerate(reversed(body)):
        number = int(character)
        if index % 2 == 0:
            number *= 2
            if number > 9:
                number -= 9
        total += number
    return str((10 - total % 10) % 10)


def card(prefix: str, length: int, filler: str = "7") -> str:
    """A Luhn-valid number of ``length`` digits starting with ``prefix``."""
    body = (prefix + filler * length)[: length - 1]
    return body + luhn_digit(body)


def broken(number: str) -> str:
    """The same number with a wrong check digit."""
    return number[:-1] + str((int(number[-1]) + 1) % 10)


def iban(country: str, bban: str) -> str:
    """An IBAN whose two check digits are computed for ``bban`` (ISO 13616-1)."""
    rearranged = bban + country + "00"
    number = int("".join(str(int(character, 36)) for character in rearranged))
    return f"{country}{98 - number % 97:02d}{bban}"


def finding(rule: str, secret: str, **extra: Any) -> dict[str, Any]:
    body = {"RuleID": rule, "Secret": secret, "File": "docs/sample.md", "StartLine": 3}
    body.update(extra)
    return body


# ------------------------------------------------------------------ checksums ----
def test_luhn_accepts_a_completed_number_and_refuses_a_changed_one() -> None:
    number = card("4", 16)
    assert pf.luhn_valid(number)
    assert not pf.luhn_valid(broken(number))
    assert not pf.luhn_valid("12a4")
    assert not pf.luhn_valid("")


@pytest.mark.parametrize(
    ("prefix", "length", "network"),
    [
        ("4", 16, "visa"),
        ("4", 13, "visa"),
        ("53", 16, "mastercard"),
        ("2300", 16, "mastercard"),
        ("34", 15, "amex"),
        ("37", 15, "amex"),
        ("6011", 16, "discover"),
        ("645", 19, "discover"),
        ("65", 16, "discover"),
        ("3530", 16, "jcb"),
        ("301", 14, "diners"),
        ("36", 14, "diners"),
        ("38", 16, "diners"),
        ("62", 19, "unionpay"),
        ("2201", 16, "mir"),
        ("6759", 12, "maestro"),
    ],
)
def test_card_network_names_the_prefix_and_length(
    prefix: str, length: int, network: str
) -> None:
    assert pf.card_network(card(prefix, length)) == network


@pytest.mark.parametrize(
    ("prefix", "length"),
    [("4", 15), ("53", 15), ("34", 16), ("1", 16), ("9", 16), ("7", 16), ("2720", 14)],
)
def test_card_network_refuses_an_unknown_prefix_or_length(
    prefix: str, length: int
) -> None:
    assert pf.card_network(card(prefix, length)) is None


def test_a_card_number_needs_both_the_network_and_the_luhn_digit() -> None:
    number = card("4", 16)
    grouped = " ".join(number[index : index + 4] for index in range(0, 16, 4))
    assert pf.is_card_number(number)
    assert pf.is_card_number(grouped)
    assert pf.is_card_number(grouped.replace(" ", "-"))
    assert not pf.is_card_number(broken(number))
    # A Luhn-valid run of an epoch-millisecond length with no network's prefix is not a card.
    assert not pf.is_card_number(card("1", 13))


def test_iban_checks_mod_97() -> None:
    value = iban("GB", "ZZZZ" + "1" * 14)
    assert pf.iban_valid(value)
    assert pf.iban_valid(
        " ".join(value[index : index + 4] for index in range(0, len(value), 4))
    )
    assert pf.iban_valid(value.lower())
    wrong = value[:2] + f"{(int(value[2:4]) + 1) % 100:02d}" + value[4:]
    assert not pf.iban_valid(wrong)


@pytest.mark.parametrize(
    "value",
    [
        "GB12",
        "1234" + "5" * 14,
        "G1" + "2" * 16,
        "GBXX" + "1" * 14,
        "GB12" + "1" * 40,
        "GB12_" + "1" * 13,
    ],
)
def test_iban_refuses_what_is_not_iban_shaped(value: str) -> None:
    assert not pf.iban_valid(value)


# ------------------------------------------------------------------ filtering ----
def test_keep_filters_only_the_checksum_rules() -> None:
    number = card("4", 16)
    account = iban("DE", "1" * 18)
    assert pf.keep(finding(pf.CARD_RULE, number))
    assert not pf.keep(finding(pf.CARD_RULE, broken(number)))
    assert pf.keep(finding(pf.IBAN_RULE, account))
    assert not pf.keep(
        finding(
            pf.IBAN_RULE,
            account[:-1] + "9" if account[-1] != "9" else account[:-1] + "8",
        )
    )
    for rule in (
        "pii-email",
        "pii-ipv4",
        "pii-ipv6",
        "pii-phone",
        "pii-mrz-name",
        "pii-us-ssn",
    ):
        assert pf.keep(finding(rule, "anything"))


def test_filter_findings_keeps_gitleaks_order() -> None:
    first = finding("pii-email", "x", StartLine=1)
    dropped = finding(pf.CARD_RULE, broken(card("4", 16)), StartLine=2)
    last = finding("pii-ipv4", "y", StartLine=3)
    assert pf.filter_findings([first, dropped, last]) == [first, last]


def test_the_summary_names_rule_file_and_line_but_never_the_value() -> None:
    number = card("4", 16)
    kept = [
        finding(pf.CARD_RULE, number, File="a.test.ts", StartLine=7),
        finding(
            "pii-email",
            "someone-real",
            File="b.md",
            StartLine=2,
            Commit="0123456789abcdef",
        ),
        finding("pii-email", "someone-else", File="c.md", StartLine=9),
    ]
    lines = pf.summary(kept)
    assert lines == [
        "pii-card-number a.test.ts:7",
        "pii-email b.md:2 (commit 0123456789ab)",
        "pii-email c.md:9",
        "pii-card-number: 1",
        "pii-email: 2",
    ]
    text = "\n".join(lines)
    assert number not in text and "someone-real" not in text


def test_read_report_reads_an_array_and_an_empty_file(tmp_path: Path) -> None:
    report = tmp_path / "report.json"
    report.write_text("", encoding="utf-8")
    assert pf.read_report(report) == []
    report.write_text(json.dumps([finding("pii-email", "x")]), encoding="utf-8")
    assert pf.read_report(report) == [finding("pii-email", "x")]
    report.write_text(json.dumps({"RuleID": "x"}), encoding="utf-8")
    with pytest.raises(ValueError, match="array"):
        pf.read_report(report)


# ------------------------------------------------------------------ the command ----
def write_report(path: Path, findings: list[Mapping[str, Any]]) -> Path:
    path.write_text(json.dumps(findings), encoding="utf-8")
    return path


def test_main_with_a_report_exits_1_on_a_kept_finding_without_printing_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    number = card("53", 16)
    report = write_report(tmp_path / "r.json", [finding(pf.CARD_RULE, number)])
    assert pf.main(["--report", str(report)]) == pf.EXIT_FINDINGS
    out = capsys.readouterr().out
    assert "pii-card-number docs/sample.md:3" in out
    assert "1 finding(s) kept of 1 matched" in out
    assert number not in out


def test_main_with_a_report_exits_0_when_every_match_fails_its_checksum(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    report = write_report(
        tmp_path / "r.json",
        [
            finding(pf.CARD_RULE, broken(card("4", 16))),
            finding(pf.IBAN_RULE, "GB00" + "1" * 14),
        ],
    )
    assert pf.main(["--report", str(report)]) == pf.EXIT_CLEAN
    assert "0 finding(s) kept of 2 matched" in capsys.readouterr().out


def test_main_exits_2_on_an_unreadable_report_or_bad_arguments(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert pf.main(["--report", str(tmp_path / "missing.json")]) == pf.EXIT_ERROR
    (tmp_path / "bad.json").write_text("{", encoding="utf-8")
    assert pf.main(["--report", str(tmp_path / "bad.json")]) == pf.EXIT_ERROR
    assert pf.main([]) == pf.EXIT_ERROR
    assert pf.main(["--gitleaks", "gitleaks"]) == pf.EXIT_ERROR
    assert pf.main(["--gitleaks", "gitleaks", "protect", "."]) == pf.EXIT_ERROR
    assert (
        pf.main(["--report", str(tmp_path / "bad.json"), "dir", "."]) == pf.EXIT_ERROR
    )
    assert pf.main(["--help"]) == pf.EXIT_CLEAN
    err = capsys.readouterr().err
    assert "cannot read the gitleaks report" in err


FAKE_GITLEAKS = """#!{python}
import json, sys
args = sys.argv[1:]
with open({log!r}, "w", encoding="utf-8") as log:
    json.dump(args, log)
if {fail}:
    sys.stderr.write("boom\\n")
    sys.exit(126)
path = args[args.index("--report-path") + 1]
with open(path, "w", encoding="utf-8") as report:
    json.dump({findings}, report)
"""


def fake_gitleaks(
    tmp_path: Path, findings: list[Mapping[str, Any]], *, fail: bool = False
) -> Path:
    binary = tmp_path / "gitleaks"
    log = tmp_path / "args.json"
    binary.write_text(
        FAKE_GITLEAKS.format(
            python=sys.executable, log=str(log), fail=fail, findings=findings
        ),
        encoding="utf-8",
    )
    binary.chmod(binary.stat().st_mode | stat.S_IXUSR)
    return binary


def test_main_runs_gitleaks_with_the_configuration_and_a_private_report(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    number = card("4", 16)
    binary = fake_gitleaks(
        tmp_path, [finding(pf.CARD_RULE, number), finding(pf.CARD_RULE, broken(number))]
    )
    status = pf.main(
        ["--gitleaks", str(binary), "git", "--pre-commit", "--staged", "."]
    )
    assert status == pf.EXIT_FINDINGS
    args = json.loads((tmp_path / "args.json").read_text(encoding="utf-8"))
    assert args[:4] == ["git", "--pre-commit", "--staged", "."]
    assert args[args.index("--config") + 1] == "security/gitleaks-pii.toml"
    assert args[args.index("--report-format") + 1] == "json"
    assert args[args.index("--exit-code") + 1] == "0"
    assert "--redact" not in args
    report = Path(args[args.index("--report-path") + 1])
    assert not report.exists() and not report.parent.exists()
    out = capsys.readouterr().out
    assert "1 finding(s) kept of 2 matched" in out and number not in out


def test_main_passes_another_configuration(tmp_path: Path) -> None:
    binary = fake_gitleaks(tmp_path, [])
    assert (
        pf.main(["--gitleaks", str(binary), "--config", "other.toml", "dir", "."])
        == pf.EXIT_CLEAN
    )
    args = json.loads((tmp_path / "args.json").read_text(encoding="utf-8"))
    assert args[args.index("--config") + 1] == "other.toml"


def test_main_fails_closed_when_gitleaks_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    binary = fake_gitleaks(tmp_path, [], fail=True)
    assert pf.main(["--gitleaks", str(binary), "dir", "."]) == pf.EXIT_ERROR
    err = capsys.readouterr().err
    assert "gitleaks failed (exit 126)" in err and "boom" in err


def test_main_fails_closed_when_gitleaks_cannot_start(tmp_path: Path) -> None:
    assert (
        pf.main(["--gitleaks", str(tmp_path / "absent"), "dir", "."]) == pf.EXIT_ERROR
    )
