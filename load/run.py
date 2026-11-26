"""C268.5: one take of a scenario, written as a take file the report reads.

    taskset -c 11 uv run python run.py take --scenario api-writes --rate 50 --duration 360 \
        --warmup 60 --seed-file /tmp/openverify-load/seed.json \
        --env-file /tmp/openverify-load/load.env \
        --out load/results/<run> [--configuration default] [--offset 0] [--lock-wait 0]
    uv run python run.py take --scenario api-reads --generator vegeta ...   (vegeta's rows)

A take file (`<scenario>-<configuration>-<started>.take.json`) holds the scenario's budget, the
take's value in the budget's unit (the measured step's p95, or the row's own metric), whether it is
valid by the method's rules and why not, the 1-minute load average at its start and end, the lock
wait, the generator, its CPU share and affinity, every status count and each step's figures. It
holds no body, token, address or secret (rule 11). Takes run only under the e2e lock (rule 7).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from driver import OpenModelDriver, Outcome, PlannedRequest, Take
from driver.cpu import proc_affinity
from driver.stats import (
    TakeSummary,
    percentile,
    summarise,
    unit_durations_ms,
    unit_server_durations_ms,
)
from sampler import RespClient, read_env_file, run_command, sample_queues, watched_queues
from scenarios import SCENARIOS, module_of
from scenarios.limiter_refusal import login_plan
from scenarios.seed import Seed
from scenarios.spec import ScenarioSpec
from vegeta import run_take as vegeta_take
from vegeta import targets

#: The step whose p95 is a row's value, or the step whose first success ends a unit (a
#: submit-to-done figure); None: every step of the take.
MEASURED_STEP: dict[str, str | None] = {
    "api-reads": None,
    "api-writes": None,
    "flow-upload": "upload",
    "console-login": "password",
    "webhook-first-attempt": None,
    "limiter-refusal": None,
    "lists-match": "match",
    "transactions-write": "create",
    "transactions-search": "search",
    "connect-redeem": "redeem",
    "soak": None,
}
#: Rows whose value is a unit's time from its first send to its last step's success (each unit's
#: completion is also recorded under "units").
UNIT_STEP: dict[str, str] = {
    "verification": "decided",
    "account-export": "ready",
    "graph-queries": "completed",
    "lists-import": "imported",
    "screening-throughput": "settled",
    "fairness": "settled",
}
#: Every unit completion a take records: the rows above and the redemption's job (C269.1's second
#: budget of `connect-redeem`: the redeem's answer is the row's value, the job's time beside it).
COMPLETIONS: dict[str, str] = {
    **UNIT_STEP,
    "connect-redeem": "redeemed",
    # The two-step sign-in, password to TOTP success, beside the password row (fix-11d).
    "console-login": "totp",
}
#: Rows whose take value is in milliseconds whatever their budget's unit: the fairness victim's p95
#: (the ratio of two configurations' medians is the row's verdict, `report.fairness_ratio`).
UNIT_OVERRIDE: dict[str, str] = {"fairness": "ms"}
#: Rows whose unit time is the server's own (the report's created-at to completed-at), so the poll's
#: interval does not floor it (Workflow 11D fix-11d, P001).
SERVER_TIMED: frozenset[str] = frozenset({"fairness"})


#: Discard rule 2 (docs/calibration/load-phase11.md): a take starts only once the stack is idle
#: (the 1-minute load at most 4, no queue depth), waited for at most 15 minutes.
IDLE_MAX_LOAD = 4.0
IDLE_TIMEOUT_SECONDS = 900.0
IDLE_POLL_SECONDS = 5.0
#: The webhook row waits at most this long after a take for the receiver to see every event.
RECEIVER_DRAIN_SECONDS = 120.0
#: Events created this long after a take's last planned send still belong to it (a create answered
#: after the end).
RECEIVER_WINDOW_SLACK_SECONDS = 30.0
#: `run.py take`'s exit status when the idle baseline was not reached (discard rule 2).
NOT_STARTED = 9
#: The load stack's compose project, whose containers' restarts invalidate a take (rule 1).
PROJECT = "openverify-load"


@dataclass(frozen=True, slots=True)
class IdleProbe:
    """One look at the stack before a take: the 1-minute load, the waiting jobs and the queues
    with active jobs (repeatable sweeps aside)."""

    load: float
    waiting: int
    active: tuple[str, ...] = ()


class NotIdleError(Exception):
    """Discard rule 2: the idle baseline was not reached in time; the take is not started."""

    def __init__(self, baseline: Mapping[str, object]) -> None:
        super().__init__("the idle baseline was not reached")
        self.baseline = dict(baseline)


def wait_for_idle(
    probe: Callable[[], IdleProbe],
    *,
    timeout_s: float,
    clock: Callable[[], float],
    sleep: Callable[[float], None],
) -> dict[str, object]:
    """Discard rule 2 (Workflow 11D fix-11d, P003): looks every `IDLE_POLL_SECONDS` until the load
    is at most `IDLE_MAX_LOAD` with no waiting or active job, and returns that baseline; raises
    `NotIdleError` with the last look once `timeout_s` has passed without it."""
    start = clock()
    while True:
        look = probe()
        idle = look.load <= IDLE_MAX_LOAD and look.waiting == 0 and not look.active
        baseline: dict[str, object] = {
            "idle": idle,
            "baseline-load": look.load,
            "waited-seconds": round(clock() - start, 1),
            "waiting": look.waiting,
            "active": list(look.active),
        }
        if idle:
            return baseline
        if clock() - start >= timeout_s:
            raise NotIdleError(baseline)
        sleep(IDLE_POLL_SECONDS)


def stack_probe(env: Mapping[str, str]) -> IdleProbe:
    """The real look at the load stack: the 1-minute load and the watched queues' depth."""
    client = RespClient(
        env.get("OPENVERIFY_BIND_ADDRESS", "127.0.0.1"),
        int(env.get("REDIS_PORT", "26379")),
        env.get("REDIS_PASSWORD"),
    )
    try:
        samples = sample_queues(client, watched_queues(), time.time() * 1000.0)
    finally:
        client.close()
    return IdleProbe(
        loadavg(),
        sum(s.waiting for s in samples),
        tuple(s.queue for s in samples if s.active and not s.queue.endswith("sweep")),
    )


def container_states(run_command: Callable[[Sequence[str]], str], project: str) -> dict[str, str]:
    """Discard rule 1 (P003): each of the project's containers' restart count and start time."""
    ids = run_command(["docker", "compose", "-p", project, "ps", "-q"]).split()
    if not ids:
        return {}
    text = run_command(
        ["docker", "inspect", "--format", "{{.Name}} {{.RestartCount}} {{.State.StartedAt}}", *ids]
    )
    states: dict[str, str] = {}
    for line in text.splitlines():
        if line.strip():
            name, _, state = line.strip().partition(" ")
            states[name] = state
    return states


def restart_reasons(before: Mapping[str, str], after: Mapping[str, str]) -> list[str]:
    """The invalid reason when a container's restart count or start time changed (or it went)."""
    changed = sorted(name for name, state in before.items() if after.get(name) != state)
    return [f"a container restarted during the take: {', '.join(changed)}"] if changed else []


def webhook_figures(
    lines: Iterable[str], *, window_start: float, window_end: float, expected: int
) -> dict[str, object]:
    """C269.1's webhook row (Workflow 11D fix-11d, P002): first attempts of the events created in
    the measured window only; an event created there that the receiver never saw is missing, and
    a missing event makes the p95 unknown (None) and the take invalid, never fast."""
    first: dict[str, float] = {}
    created: dict[str, float] = {}
    for line in lines:
        if not line.strip():
            continue
        entry = json.loads(line)
        stamp = datetime.fromisoformat(str(entry["created"]).replace("Z", "+00:00")).timestamp()
        if not window_start <= stamp < window_end:
            continue
        event = str(entry["event"])
        first[event] = min(first.get(event, float("inf")), float(entry["received"]))
        created[event] = stamp
    latencies = sorted(max(0.0, (first[e] - created[e]) * 1000.0) for e in first)
    missing = max(0, expected - len(latencies))
    reasons = (
        [f"{missing} of {expected} events created in the window never reached the receiver"]
        if missing
        else []
    )
    return {
        "received": len(latencies),
        "missing": missing,
        "p95_ms": None if missing else percentile(latencies, 0.95),
        "reasons": reasons,
    }


def loadavg(path: Path = Path("/proc/loadavg")) -> float:
    """The 1-minute load average."""
    return float(path.read_text(encoding="ascii").split()[0])


def to_unit(milliseconds: float | None, unit: str) -> float | None:
    if milliseconds is None:
        return None
    return round(milliseconds / 1000.0, 4) if unit == "s" else round(milliseconds, 3)


def unit_of(spec: ScenarioSpec) -> str:
    """The unit a take's value is in."""
    if spec.id in UNIT_OVERRIDE:
        return UNIT_OVERRIDE[spec.id]
    return spec.budget.unit if spec.budget is not None else "ms"


def value_of(
    spec: ScenarioSpec,
    outcomes: Sequence[Outcome],
    summary: TakeSummary,
    warmup: float,
    duration: float,
) -> float | None:
    """The take's value in its unit: the measured step's p95 (or median for a median budget), a
    unit's submit-to-done time, or a throughput an hour. The soak's comes from the sampler
    (`report.memory_growth`), so its take has none."""
    if spec.id == "soak":
        return None
    unit = unit_of(spec)
    measured = [o for o in outcomes if o.planned_seconds >= warmup]
    if spec.id in UNIT_STEP:
        timed = unit_server_durations_ms if spec.id in SERVER_TIMED else unit_durations_ms
        durations = timed(measured, UNIT_STEP[spec.id])
        if spec.budget is not None and spec.budget.metric == "rate":
            window = max(1e-9, duration - warmup)
            return round(len(durations) * 3600.0 / window, 1)
        median = spec.budget is not None and spec.budget.metric == "median"
        fraction = 0.5 if median and spec.id not in UNIT_OVERRIDE else 0.95
        return to_unit(percentile(durations, fraction), unit)
    return to_unit(summary.p95_ms, unit)


def completions(outcomes: Sequence[Outcome], warmup: float, step: str) -> dict[str, object]:
    """A unit completion's figures: how many units reached `step`, and their p50, p95 and max."""
    durations = unit_durations_ms([o for o in outcomes if o.planned_seconds >= warmup], step)
    return {
        "count": len(durations),
        "p50_ms": percentile(durations, 0.5),
        "p95_ms": percentile(durations, 0.95),
        "max_ms": max(durations, default=None),
    }


def take_record(  # noqa: PLR0913 - a take file's members, keyword-only
    spec: ScenarioSpec,
    outcomes: Sequence[Outcome],
    *,
    cpu_share: float,
    warmup: float,
    duration: float,
    configuration: str,
    generator: str,
    rate: float,
    load_start: float,
    load_end: float,
    lock_wait: float,
    affinity: str,
    extra_reasons: Sequence[str] = (),
) -> dict[str, object]:
    """The take file's content."""
    step = MEASURED_STEP.get(spec.id)
    overall = summarise(
        outcomes, spec.expected_statuses, cpu_share=cpu_share, warmup_seconds=warmup
    )
    measured = summarise(
        outcomes, spec.expected_statuses, cpu_share=cpu_share, warmup_seconds=warmup, step=step
    )
    steps = sorted({o.step for o in outcomes})
    reasons = [*overall.invalid_reasons, *extra_reasons]
    return {
        "scenario": spec.id,
        "configuration": configuration,
        "title": spec.id,
        "contract": spec.contract,
        "owner": spec.owner,
        "budget": None if spec.budget is None else asdict(spec.budget),
        "unit": unit_of(spec),
        "value": value_of(spec, outcomes, measured, warmup, duration),
        "units": {COMPLETIONS[spec.id]: completions(outcomes, warmup, COMPLETIONS[spec.id])}
        if spec.id in COMPLETIONS
        else {},
        "valid": not reasons,
        "invalid-reasons": reasons,
        "load-start": load_start,
        "load-end": load_end,
        "lock-wait-seconds": lock_wait,
        "generator": generator,
        "generator-cpu-share": round(cpu_share, 4),
        "generator-affinity": affinity,
        "rate-per-s": rate,
        "duration-seconds": duration,
        "warmup-seconds": warmup,
        "statuses": overall.statuses,
        "lag-p99-ms": round(overall.lag_p99_ms, 3),
        "lag-max-ms": round(overall.lag_max_ms, 3),
        "steps": {
            name: {
                k: v
                for k, v in asdict(
                    summarise(
                        outcomes,
                        spec.expected_statuses,
                        cpu_share=cpu_share,
                        warmup_seconds=warmup,
                        step=name,
                    )
                ).items()
                if k not in {"invalid_reasons", "cpu_share", "lag_p99_ms", "lag_max_ms", "step"}
            }
            for name in steps
        },
    }


def base_url(env: Mapping[str, str]) -> str:
    host = env.get("OPENVERIFY_BIND_ADDRESS", "127.0.0.1")
    return f"http://{host}:{env.get('OPENVERIFY_API_PORT', '23000')}"


def execute_take(driver: OpenModelDriver, schedule: Iterable[PlannedRequest]) -> Take:
    """Runs a take on a new event loop on the driver's own clock (the real one in a take)."""
    return asyncio.run(driver.take(schedule))


def read_cursor(path: Path) -> int:
    """The next unused offset of the consumed pools (0 for a new seed)."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return 0
    return int(data["next"]) if isinstance(data, dict) else 0


def write_cursor(path: Path, value: int) -> None:
    """Records the next unused offset in a 0600 file beside the seed record."""
    fd = os.open(path.with_suffix(".tmp"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as sink:
        sink.write(json.dumps({"next": value}) + "\n")
    path.with_suffix(".tmp").replace(path)


def plan_options(args: argparse.Namespace) -> dict[str, object]:
    """The scenario-specific options a plan takes (the flood's runs, an import's rows)."""
    options: dict[str, object] = {}
    if args.scenario == "fairness":
        options["flood_runs"] = args.flood_runs
    if args.scenario == "lists-import" and args.rows is not None:
        options["rows"] = args.rows
    return options


def idle_baseline(
    args: argparse.Namespace,
    spec: ScenarioSpec,
    probe: Callable[[], IdleProbe],
    *,
    clock: Callable[[], float],
    sleep: Callable[[float], None],
) -> dict[str, object]:
    """The take's idle baseline; a take that cannot have one is not started and is listed as such
    (`<scenario>-<configuration>-<time>.not-started.json`, discard rule 2)."""
    try:
        return wait_for_idle(probe, timeout_s=args.idle_timeout, clock=clock, sleep=sleep)
    except NotIdleError as refused:
        args.out.mkdir(parents=True, exist_ok=True)
        name = f"{spec.id}-{args.configuration.replace(' ', '-')}-{int(clock())}.not-started.json"
        (args.out / name).write_text(
            json.dumps(refused.baseline, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        raise


def receiver_events(
    args: argparse.Namespace,
    spec: ScenarioSpec,
    outcomes: Sequence[Outcome],
    *,
    started: float,
    sleep: Callable[[float], None],
) -> dict[str, object] | None:
    """The webhook row's receiver figures (`webhook_figures`), read again every few seconds for at
    most `--receiver-drain` seconds while an event created in the window has not arrived."""
    if args.receiver_file is None:
        return None
    expected = sum(
        1
        for o in outcomes
        if o.planned_seconds >= args.warmup and o.status in spec.expected_statuses
    )
    total = args.warmup + args.duration
    window = (started + args.warmup, started + total + RECEIVER_WINDOW_SLACK_SECONDS)
    waited = 0.0
    while True:
        events = webhook_figures(
            args.receiver_file.read_text(encoding="utf-8").splitlines(),
            window_start=window[0],
            window_end=window[1],
            expected=expected,
        )
        if events["missing"] == 0 or waited >= args.receiver_drain:
            return events
        sleep(IDLE_POLL_SECONDS)
        waited += IDLE_POLL_SECONDS


def take_extras(
    args: argparse.Namespace,
    spec: ScenarioSpec,
    *,
    offset: int,
    planned: int,
    events: Mapping[str, object] | None,
) -> dict[str, object]:
    """A take file's scenario-specific members (the flood, the rows, the receiver's figures)."""
    extras: dict[str, object] = {"offset": offset, "planned-units": planned}
    if spec.id == "fairness":
        extras["flood-runs"] = args.flood_runs
    if spec.id == "lists-import" and args.rows is not None:
        extras["rows"] = args.rows
    if events is not None:
        extras["receiver-events"] = events["received"]
        extras["receiver-missing"] = events["missing"]
        p95 = events["p95_ms"]
        extras["value"] = to_unit(p95 if isinstance(p95, float) else None, unit_of(spec))
    return extras


def run_take(  # noqa: PLR0913 - the take's injectable parts, keyword-only
    args: argparse.Namespace,
    *,
    driver_factory: Callable[[str], OpenModelDriver] = OpenModelDriver,
    execute: Callable[[OpenModelDriver, Iterable[PlannedRequest]], Take] = execute_take,
    clock: Callable[[], float] = time.time,
    load: Callable[[], float] = loadavg,
    idle: Callable[[], IdleProbe] | None = None,
    states: Callable[[], dict[str, str]] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> Path:
    """Runs one take and writes its file; returns the file's path. Without `--offset`, the take
    starts at the shared cursor beside the seed record, so no two takes act on one inquiry."""
    spec = SCENARIOS[args.scenario]
    seed = Seed.load(args.seed_file)
    env = read_env_file(args.env_file)
    url = base_url(env)
    total = args.warmup + args.duration
    cursor = args.seed_file.parent / "cursors.json"
    offset = read_cursor(cursor) if args.offset is None else args.offset
    probe = idle if idle is not None else (lambda: stack_probe(env))
    look = states if states is not None else (lambda: container_states(run_command, args.project))
    baseline = idle_baseline(args, spec, probe, clock=clock, sleep=sleep)
    before = look()
    load_start = load()
    started = clock()
    extra: list[str] = []
    planned = 0
    if args.generator == "vegeta":
        args.out.mkdir(parents=True, exist_ok=True)
        result = vegeta_take(
            args.vegeta,
            targets(spec.id, url, seed),
            rate=args.rate,
            duration_seconds=total,
            output=args.out / f"{spec.id}-{int(started)}.vegeta.bin",
            step=MEASURED_STEP.get(spec.id) or spec.id,
            cpu=args.vegeta_cpu,
        )
        outcomes, cpu = result.outcomes, result.cpu_share
        affinity = f"{args.vegeta_cpu} (taskset -c {args.vegeta_cpu})"
        if not result.rate_ok:
            extra.append(f"vegeta sent {result.achieved_rate:.2f}/s, below 99% of {args.rate:g}/s")
    else:
        module = module_of(spec.id)
        if args.login:
            if spec.id != "limiter-refusal":
                raise SystemExit("--login is the limiter-refusal scenario's login half")
            schedule = list(login_plan(seed))
        else:
            schedule = list(
                module.plan(seed, args.rate, total, offset=offset, **plan_options(args))
            )
        planned = len(schedule)
        take = execute(driver_factory(url), schedule)
        outcomes, cpu = take.outcomes, take.cpu_share
        affinity = proc_affinity(os.getpid())
        if args.offset is None:
            write_cursor(cursor, offset + planned)
    extra.extend(restart_reasons(before, look()))
    events = receiver_events(args, spec, outcomes, started=started, sleep=sleep)
    if events is not None and isinstance(events["reasons"], list):
        extra.extend(str(reason) for reason in events["reasons"])
    record = take_record(
        spec,
        outcomes,
        cpu_share=cpu,
        warmup=args.warmup,
        duration=total,
        configuration=args.configuration,
        generator=args.generator,
        rate=args.rate,
        load_start=load_start,
        load_end=load(),
        lock_wait=args.lock_wait,
        affinity=affinity,
        extra_reasons=extra,
    )
    record.update(take_extras(args, spec, offset=offset, planned=planned, events=events))
    record["idle-baseline"] = baseline
    args.out.mkdir(parents=True, exist_ok=True)
    name = f"{spec.id}-{args.configuration.replace(' ', '-')}-{int(started)}.take.json"
    path: Path = args.out / name
    path.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="run.py")
    sub = root.add_subparsers(dest="command", required=True)
    take = sub.add_parser("take")
    take.add_argument("--scenario", required=True, choices=sorted(SCENARIOS))
    take.add_argument("--rate", type=float, required=True)
    take.add_argument("--duration", type=float, required=True, help="measured seconds")
    take.add_argument("--warmup", type=float, default=0.0)
    take.add_argument("--seed-file", type=Path, required=True)
    take.add_argument("--env-file", type=Path, required=True)
    take.add_argument("--out", type=Path, required=True)
    take.add_argument("--configuration", default="default")
    take.add_argument("--generator", choices=("driver", "vegeta"), default="driver")
    take.add_argument("--vegeta", default=str(Path.home() / ".local" / "bin" / "vegeta"))
    take.add_argument("--offset", type=int, default=None, help="default: the shared cursor")
    take.add_argument("--vegeta-cpu", default="10")
    take.add_argument("--flood-runs", type=int, default=0)
    take.add_argument("--rows", type=int, default=None)
    take.add_argument("--receiver-file", type=Path, default=None)
    take.add_argument("--login", action="store_true", help="limiter-refusal: the login half")
    take.add_argument("--lock-wait", type=float, default=0.0)
    take.add_argument("--idle-timeout", type=float, default=IDLE_TIMEOUT_SECONDS)
    take.add_argument("--project", default=PROJECT)
    take.add_argument("--receiver-drain", type=float, default=RECEIVER_DRAIN_SECONDS)
    return root


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        path = run_take(args)
    except NotIdleError as refused:
        print(f"not started: the idle baseline was not reached ({refused.baseline})")
        return NOT_STARTED
    record = json.loads(path.read_text(encoding="utf-8"))
    print(
        f"{path}: value {record['value']} {record['unit']}, valid {record['valid']}, "
        f"statuses {record['statuses']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
