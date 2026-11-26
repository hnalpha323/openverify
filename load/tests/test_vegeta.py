"""vegeta's targets and runs (C268.2, C268.5): JSON targets streamed from the seed's pools, the
command pinned to the method's CPU, results parsed without bodies, the achieved-rate rule."""

from __future__ import annotations

import base64
import json
import stat
from pathlib import Path

import pytest

from scenarios.seed import Seed
from tests.fixtures import synthetic_seed
from vegeta import (
    MIN_ACHIEVED_RATE_SHARE,
    VEGETA_CPU,
    VEGETA_VERSION,
    VegetaTake,
    achieved_rate,
    attack_command,
    cycle,
    parse_results,
    run_take,
    target_line,
    targets,
)

INSTALLER = Path(__file__).resolve().parents[2] / "infra" / "scripts" / "install-vegeta.sh"


def test_the_pinned_version_is_the_installer_s() -> None:
    assert VEGETA_VERSION == "12.13.0"
    assert f'VEGETA_VERSION_DEFAULT="{VEGETA_VERSION}"' in INSTALLER.read_text(encoding="utf-8")


def test_a_target_line_in_vegeta_s_json_format() -> None:
    line = json.loads(
        target_line("POST", "http://x/a", {"authorization": "Bearer synthetic"}, b"{}")
    )
    assert line == {
        "method": "POST",
        "url": "http://x/a",
        "header": {"authorization": ["Bearer synthetic"]},
        "body": base64.b64encode(b"{}").decode(),
    }
    assert json.loads(target_line("GET", "http://x/b")) == {"method": "GET", "url": "http://x/b"}


@pytest.mark.parametrize("scenario", ["api-reads", "transactions-search", "lists-match"])
def test_the_vegeta_rows_stream_endless_targets(scenario: str) -> None:
    seed = synthetic_seed()
    stream = targets(scenario, "http://127.0.0.1:23000", seed)
    lines = [json.loads(next(stream)) for _ in range(30)]
    assert all(line["url"].startswith("http://127.0.0.1:23000/api/v1/") for line in lines)
    tokens = {line["header"]["authorization"][0] for line in lines}
    assert len(tokens) > 1  # the spread over the pool's keys


def test_a_driver_row_and_an_unknown_one_are_refused() -> None:
    seed = synthetic_seed()
    with pytest.raises(ValueError, match="not a vegeta row"):
        targets("api-writes", "http://x", seed)
    with pytest.raises(KeyError):
        targets("no-such", "http://x", seed)


def test_the_attack_is_pinned_to_its_cpu_and_keeps_no_body(tmp_path: Path) -> None:
    command = attack_command("/bin/vegeta", 100.0, 360.0, tmp_path / "r.bin")
    assert command[:3] == ["taskset", "-c", VEGETA_CPU]
    assert VEGETA_CPU == "10"
    assert {"-lazy", "-format=json", "-rate=100/1s", "-duration=360s", "-max-body=0"} <= set(
        command
    )


def test_a_fractional_rate_is_whole_requests_over_a_longer_period(tmp_path: Path) -> None:
    """vegeta's -rate takes whole requests per period (2.5/1s exits 2): 0.25 times a 10/s budget
    is 5 every 2 s, written over a 1,000 s period so every step of the method is exact."""
    command = attack_command("/bin/vegeta", 2.5, 150.0, tmp_path / "r.bin")
    assert "-rate=2500/1000s" in command
    assert "-rate=100/1s" in attack_command("/bin/vegeta", 100.0, 150.0, tmp_path / "r.bin")


def test_results_and_the_achieved_rate() -> None:
    lines = [
        '{"timestamp":"2026-11-16T10:00:00.250000123Z","code":200,"latency":12000000,"error":""}',
        "",
        '{"timestamp":"2026-11-16T10:00:00Z","code":0,"latency":30000000000,"error":"timeout"}',
        '{"timestamp":"2026-11-16T10:00:00.5+00:00","code":429,"latency":1000000,"error":""}',
    ]
    outcomes = parse_results(lines, "api-reads")
    assert [(o.status, o.sent_seconds, o.latency_ms) for o in outcomes] == [
        (None, 0.0, 30000.0),
        (200, 0.25, 12.0),
        (429, 0.5, 1.0),
    ]
    assert parse_results([], "x") == []
    assert achieved_rate({"rate": 99.5}) == 99.5
    assert achieved_rate({}) == 0.0
    assert MIN_ACHIEVED_RATE_SHARE == 0.99
    assert VegetaTake([], 100.0, 99.0, 0.1).rate_ok
    assert not VegetaTake([], 100.0, 98.9, 0.1).rate_ok


def test_cycle() -> None:
    stream = cycle(["a", "b"])
    assert [next(stream) for _ in range(5)] == ["a", "b", "a", "b", "a"]
    with pytest.raises(ValueError, match="at least one"):
        next(cycle([]))


FAKE_VEGETA = """#!/usr/bin/env bash
# A stand-in for vegeta: attack reads its targets and writes how many it read; encode and report
# answer from that count.
case "$1" in
  attack)
    for arg in "$@"; do case "$arg" in -output=*) out="${arg#-output=}" ;; esac; done
    wc -l > "$out"
    [ -n "${FAKE_VEGETA_FAIL:-}" ] && exit 3
    exit 0 ;;
  encode)
    n=$(tr -d ' ' < "$4")
    for i in $(seq 1 "$n"); do
      printf '{"timestamp":"2026-11-16T10:00:0%d.000Z","code":200,' "$((i % 10))"
      printf '"latency":5000000,"error":""}\\n'
    done ;;
  report)
    printf '{"rate": %s}\\n' "${FAKE_VEGETA_RATE:-10}" ;;
esac
"""


def fake_vegeta(tmp_path: Path) -> str:
    path = tmp_path / "vegeta"
    path.write_text(FAKE_VEGETA, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return str(path)


def test_a_take_streams_only_what_its_rate_needs(tmp_path: Path) -> None:
    lines = (f'{{"method":"GET","url":"http://x/{i}"}}' for i in range(10**6))
    take = run_take(
        fake_vegeta(tmp_path),
        lines,
        rate=10.0,
        duration_seconds=1.0,
        output=tmp_path / "r.bin",
        step="api-reads",
        cpu="0",
    )
    # 10 a second for 1 s, 10% over, plus 100 spare.
    assert (tmp_path / "r.bin").read_text(encoding="utf-8").strip() == "111"
    assert len(take.outcomes) == 111
    assert take.rate_ok
    assert take.cpu_share >= 0


def test_a_failed_attack_is_an_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_VEGETA_FAIL", "1")
    with pytest.raises(RuntimeError, match="exited 3"):
        run_take(
            fake_vegeta(tmp_path),
            iter(["{}"]),
            rate=1.0,
            duration_seconds=1.0,
            output=tmp_path / "r.bin",
            step="x",
            cpu="0",
        )


def test_the_seed_fixture_is_a_seed() -> None:
    assert isinstance(synthetic_seed(), Seed)
