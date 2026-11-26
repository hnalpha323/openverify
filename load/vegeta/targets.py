"""vegeta's targets and its runs for the single-route rows (`api-reads`, `transactions-search`,
`lists-match`; C268.2, C268.5).

Targets are vegeta's JSON format, built from the seed's ids by each scenario's `vegeta_targets`, and
streamed to `vegeta attack -lazy` on its standard input, so no key or address is ever written to a
file. vegeta keeps its own constant-rate schedule; its take is judged by the rate its report says it
sent at (below 99% of the requested rate, the take is invalid) and by the method's error budget.
Results keep no body (`-max-body=0`), and the parsed outcomes hold status and timings only.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from driver import Outcome

#: The pinned vegeta release (C258.3; infra/scripts/install-vegeta.sh).
VEGETA_VERSION = "12.13.0"
#: The logical CPU vegeta runs on (the method's core split: containers 0-9, vegeta 10).
VEGETA_CPU = "10"
#: Below this share of the requested rate, a vegeta take is invalid (the method).
MIN_ACHIEVED_RATE_SHARE = 0.99


def target_line(
    method: str, url: str, headers: Mapping[str, str] | None = None, body: bytes | None = None
) -> str:
    """One target in vegeta's JSON format (`-format=json`): headers as lists, the body base64."""
    target: dict[str, object] = {"method": method, "url": url}
    if headers:
        target["header"] = {name: [value] for name, value in headers.items()}
    if body is not None:
        target["body"] = base64.b64encode(body).decode("ascii")
    return json.dumps(target, separators=(",", ":"), sort_keys=True)


def targets(scenario: str, base_url: str, seed: object) -> Iterator[str]:
    """vegeta's target lines for `scenario` against `base_url`, from the seed's pools (an endless
    cycle: vegeta reads only as many as its rate and duration take)."""
    from scenarios import SCENARIOS, module_of  # noqa: PLC0415 - scenarios import vegeta's helpers

    if scenario not in SCENARIOS:
        raise KeyError(f"unknown scenario {scenario}")
    module = module_of(scenario)
    build = getattr(module, "vegeta_targets", None)
    if build is None:
        raise ValueError(f"scenario {scenario} is not a vegeta row")
    return build(seed, base_url)  # type: ignore[no-any-return]


def rate_flag(rate: float) -> str:
    """vegeta's -rate: whole requests per period, so a fractional rate is counted over 1,000 s."""
    if float(rate).is_integer():
        return f"-rate={int(rate)}/1s"
    return f"-rate={round(rate * 1000)}/1000s"


def attack_command(  # noqa: PLR0913 - the attack's settings, the optional ones keyword-only
    vegeta: str,
    rate: float,
    duration_seconds: float,
    output: Path,
    *,
    timeout_seconds: int = 30,
    cpu: str = VEGETA_CPU,
) -> list[str]:
    """`vegeta attack` at a constant rate, pinned to the method's CPU, reading targets lazily."""
    return [
        "taskset",
        "-c",
        cpu,
        vegeta,
        "attack",
        "-format=json",
        "-lazy",
        rate_flag(rate),
        f"-duration={duration_seconds:g}s",
        f"-timeout={timeout_seconds}s",
        "-keepalive=true",
        "-max-body=0",
        "-workers=64",
        f"-output={output}",
    ]


@dataclass(frozen=True, slots=True)
class VegetaTake:
    """A vegeta take: its outcomes, its achieved rate, and vegeta's CPU time over its wall time."""

    outcomes: list[Outcome]
    requested_rate: float
    achieved_rate: float
    cpu_share: float

    @property
    def rate_ok(self) -> bool:
        return self.achieved_rate >= MIN_ACHIEVED_RATE_SHARE * self.requested_rate


_FRACTION = re.compile(r"\.(\d+)")


def _instant(text: str) -> float:
    """An RFC 3339 instant with nanoseconds (vegeta's) as epoch seconds, to the microsecond."""
    text = _FRACTION.sub(lambda m: "." + m.group(1)[:6].ljust(6, "0"), text, count=1)
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def parse_results(lines: Iterable[str], step: str) -> list[Outcome]:
    """`vegeta encode --to json` lines as outcomes (status 0 or an error is a failed request),
    timed from the first request; vegeta's own schedule makes planned and sent the same."""
    raw = []
    for line in lines:
        if line.strip():
            entry = json.loads(line)
            raw.append(
                (
                    _instant(entry["timestamp"]),
                    int(entry["code"]),
                    entry.get("error") or "",
                    int(entry["latency"]),
                )
            )
    if not raw:
        return []
    start = min(r[0] for r in raw)
    outcomes = []
    for at, code, _error, latency_ns in sorted(raw):
        status = None if code == 0 else code
        outcomes.append(Outcome(step, status, at - start, at - start, latency_ns / 1e6))
    return outcomes


def achieved_rate(report: Mapping[str, object]) -> float:
    """The rate `vegeta report -type=json` says was sent."""
    rate = report.get("rate")
    return float(rate) if isinstance(rate, int | float) else 0.0


def run_take(  # noqa: PLR0913 - one take's whole configuration, keyword-only
    vegeta: str,
    lines: Iterable[str],
    *,
    rate: float,
    duration_seconds: float,
    output: Path,
    step: str,
    cpu: str = VEGETA_CPU,
) -> VegetaTake:
    """Runs one vegeta take: streams the targets, waits for vegeta and reads its CPU time from the
    kernel (wait4's rusage), then decodes the results and its report. Never writes a target."""
    process = subprocess.Popen(  # noqa: S603 - our own argument list, no shell
        attack_command(vegeta, rate, duration_seconds, output, cpu=cpu),
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    assert process.stdin is not None  # noqa: S101 - Popen with PIPE always sets it
    needed = int(rate * duration_seconds * 1.1) + 100
    try:
        for count, line in enumerate(lines):
            if count >= needed:
                break
            process.stdin.write(line.encode() + b"\n")
        process.stdin.close()
    except BrokenPipeError:
        pass
    _, status, usage = os.wait4(process.pid, 0)
    process.returncode = os.waitstatus_to_exitcode(status)
    if process.returncode != 0:
        raise RuntimeError(f"vegeta attack exited {process.returncode}")
    decoded = subprocess.run(  # noqa: S603
        [vegeta, "encode", "--to", "json", str(output)], check=True, capture_output=True, text=True
    ).stdout
    report = json.loads(
        subprocess.run(  # noqa: S603
            [vegeta, "report", "-type=json", str(output)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    outcomes = parse_results(decoded.splitlines(), step)
    return VegetaTake(
        outcomes=outcomes,
        requested_rate=rate,
        achieved_rate=achieved_rate(report),
        cpu_share=(usage.ru_utime + usage.ru_stime) / duration_seconds
        if duration_seconds > 0
        else 0.0,
    )


def cycle(items: Sequence[str]) -> Iterator[str]:
    """`items` again and again (a scenario's targets are a finite pattern repeated)."""
    if not items:
        raise ValueError("a vegeta row needs at least one target")
    while True:
        yield from items
