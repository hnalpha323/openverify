"""One take of a scenario written as a take file the report reads (C268.5): its value in the
budget's unit, its validity by the method's rules, its loads and its generator."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

import report
import run
from driver import OpenModelDriver, Outcome, PlannedRequest, Take
from driver.clock import FakeClock
from driver.stats import summarise
from scenarios import SCENARIOS
from tests.fixtures import record
from tests.test_vegeta import fake_vegeta


def write_inputs(tmp_path: Path) -> tuple[Path, Path]:
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps(record()), encoding="utf-8")
    seed.chmod(0o600)
    env = tmp_path / "load.env"
    env.write_text("OPENVERIFY_API_PORT=23000\n", encoding="utf-8")
    return seed, env


CLOCK = FakeClock()


def driver_factory(url: str) -> OpenModelDriver:
    """The take's driver over a fake API and the fake clock (deterministic at any machine load)."""
    assert url == "http://127.0.0.1:23000"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/reports") or "/reports/" in request.url.path:
            status = 201 if request.method == "POST" else 200
            attributes = {
                "status": "ready",
                "created-at": "2026-11-17T10:00:00.000Z",
                "completed-at": "2026-11-17T10:00:00.840Z",
            }
            return httpx.Response(
                status, json={"data": {"id": "rep_synthetic", "attributes": attributes}}
            )
        if "/importer" in request.url.path or "/importers/" in request.url.path:
            return httpx.Response(
                201 if request.method == "POST" else 200,
                json={"data": {"id": "mprt_synthetic", "attributes": {"status": "ready"}}},
            )
        return httpx.Response(201 if request.method == "POST" else 200, json={})

    return OpenModelDriver(
        url, transport=httpx.MockTransport(handler), clock=CLOCK, cpu_seconds=lambda: 0.0
    )


def on_fake_clock(driver: OpenModelDriver, schedule: Iterable[PlannedRequest]) -> Take:
    return asyncio.run(CLOCK.run(driver.take(schedule)))


def take(tmp_path: Path, *argv: str) -> dict[str, object]:
    seed, env = write_inputs(tmp_path)
    args = run.parser().parse_args(
        [
            "take",
            *argv,
            "--seed-file",
            str(seed),
            "--env-file",
            str(env),
            "--out",
            str(tmp_path / "takes"),
        ]
    )
    loads = iter([1.5, 2.5])
    path = run.run_take(
        args,
        driver_factory=driver_factory,
        execute=on_fake_clock,
        clock=lambda: 1700000000.0,
        load=lambda: next(loads),
        idle=lambda: run.IdleProbe(1.0, 0),
        states=lambda: {"/openverify-load-api-1": "0 2026-11-17T10:00:00Z"},
        sleep=lambda _: None,
    )
    assert path.name.endswith(".take.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


def test_a_driver_take_file(tmp_path: Path) -> None:
    data = take(
        tmp_path,
        "--scenario",
        "api-writes",
        "--rate",
        "10",
        "--duration",
        "1",
        "--lock-wait",
        "3",
    )
    assert data["scenario"] == "api-writes"
    assert data["valid"] is True
    assert data["unit"] == "ms"
    assert data["budget"] == {"metric": "p95", "comparison": "<=", "value": 300, "unit": "ms"}
    assert (data["load-start"], data["load-end"], data["lock-wait-seconds"]) == (1.5, 2.5, 3.0)
    assert data["generator"] == "driver"
    assert isinstance(data["value"], float)
    steps = data["steps"]
    assert isinstance(steps, dict)
    assert set(steps) == {"create", "update", "tag", "approve", "decline"}
    rows = report.rows_from_takes(report.load_takes(tmp_path / "takes"))
    assert rows[0]["verdict"] == "pending"


def test_a_throughput_row_counts_settled_units_an_hour(tmp_path: Path) -> None:
    data = take(tmp_path, "--scenario", "screening-throughput", "--rate", "4", "--duration", "1")
    assert data["unit"] == "per-hour"
    assert data["value"] == pytest.approx(4 * 3600.0, rel=0.01)


def test_values_in_the_budget_s_unit() -> None:
    spec = SCENARIOS["flow-upload"]
    outcomes = [Outcome("upload", 201, 0.0, 0.0, 1200.0), Outcome("upload", 201, 0.1, 0.1, 1400.0)]
    summary = summarise(outcomes, spec.expected_statuses, cpu_share=0.1, step="upload")
    assert run.value_of(spec, outcomes, summary, 0.0, 1.0) == 1.4
    verification = SCENARIOS["verification"]
    units = [
        Outcome("resume", 200, 0.0, 0.0, 10.0, unit=1),
        Outcome("decided", 200, 3.0, 3.0, 500.0, unit=1, follow_up=True),
    ]
    assert run.value_of(verification, units, summary, 0.0, 1.0) == 3.5
    assert run.to_unit(None, "ms") is None


def test_the_load_average(tmp_path: Path) -> None:
    path = tmp_path / "loadavg"
    path.write_text("3.21 2.00 1.00 1/100 42\n", encoding="ascii")
    assert run.loadavg(path) == 3.21
    assert run.loadavg() >= 0


def test_the_command_line_takes_every_scenario_and_no_other() -> None:
    common = ["--rate", "1", "--duration", "1", "--seed-file", "s", "--env-file", "e", "--out", "o"]
    for scenario in SCENARIOS:
        assert (
            run.parser().parse_args(["take", "--scenario", scenario, *common]).scenario == scenario
        )
    with pytest.raises(SystemExit):
        run.parser().parse_args(["take", "--scenario", "no-such", *common])


def test_consumed_pools_advance_a_cursor_so_no_take_reuses_an_inquiry(tmp_path: Path) -> None:
    first = take(tmp_path, "--scenario", "api-writes", "--rate", "10", "--duration", "1")
    second = take(tmp_path, "--scenario", "flow-upload", "--rate", "2", "--duration", "1")
    third = take(
        tmp_path, "--scenario", "api-writes", "--rate", "10", "--duration", "1", "--offset", "7"
    )
    assert (first["offset"], second["offset"], third["offset"]) == (0, 10, 7)
    cursors = tmp_path / "cursors.json"
    assert json.loads(cursors.read_text(encoding="utf-8")) == {"next": 11}
    assert cursors.stat().st_mode & 0o777 == 0o600


def test_fairness_records_the_victim_p95_with_its_flood(tmp_path: Path) -> None:
    data = take(
        tmp_path, "--scenario", "fairness", "--rate", "1", "--duration", "2", "--flood-runs", "4"
    )
    assert data["unit"] == "ms"
    assert data["flood-runs"] == 4
    assert isinstance(data["value"], float)
    steps = data["steps"]
    assert isinstance(steps, dict)
    assert set(steps) == {"victim", "flood", "settled"}


def test_the_fairness_victim_s_value_is_the_report_s_own_time(tmp_path: Path) -> None:
    """P001: the victim's p95 is over each report's created-at to completed-at (840 ms here),
    not submit to the first poll that saw it settled (at least the 2 s poll interval)."""
    data = take(
        tmp_path, "--scenario", "fairness", "--rate", "1", "--duration", "3", "--flood-runs", "4"
    )
    assert data["value"] == pytest.approx(840.0)


def test_the_webhook_row_reads_the_receiver(tmp_path: Path) -> None:
    receiver = tmp_path / "hooks.jsonl"
    receiver.write_text(
        "\n".join(
            json.dumps(
                {
                    "event": f"evt_{i}",
                    "created": "2023-11-14T22:13:20Z",
                    "received": 1700000000.0 + 0.1 * i,
                }
            )
            for i in range(1, 21)
        )
        + "\n",
        encoding="utf-8",
    )
    data = take(
        tmp_path,
        "--scenario",
        "webhook-first-attempt",
        "--rate",
        "2",
        "--duration",
        "1",
        "--receiver-file",
        str(receiver),
    )
    assert data["value"] == pytest.approx(1.9)
    assert data["receiver-events"] == 20


def test_a_unit_row_records_its_completion_time_beside_the_answer(tmp_path: Path) -> None:
    data = take(
        tmp_path, "--scenario", "lists-import", "--rate", "0", "--duration", "0", "--rows", "3"
    )
    assert data["rows"] == 3
    units = data["units"]
    assert isinstance(units, dict)
    assert set(units) == {"imported"}


def test_the_soak_s_value_comes_from_the_sampler() -> None:
    spec = SCENARIOS["soak"]
    summary = summarise([Outcome("x", 200, 0.0, 0.0, 5.0)], spec.expected_statuses, cpu_share=0.1)
    assert run.value_of(spec, [Outcome("x", 200, 0.0, 0.0, 5.0)], summary, 0.0, 1.0) is None


def test_a_vegeta_take_is_named_by_its_measured_step(tmp_path: Path) -> None:
    vegeta = ["--generator", "vegeta", "--vegeta", fake_vegeta(tmp_path), "--vegeta-cpu", "0"]
    data = take(tmp_path, "--scenario", "lists-match", "--rate", "5", "--duration", "1", *vegeta)
    steps = data["steps"]
    assert isinstance(steps, dict)
    assert set(steps) == {"match"}
    assert data["value"] is not None


def test_the_login_refusal_is_its_own_take(tmp_path: Path) -> None:
    data = take(
        tmp_path, "--scenario", "limiter-refusal", "--rate", "0", "--duration", "0", "--login"
    )
    steps = data["steps"]
    assert isinstance(steps, dict)
    assert set(steps) == {"login-address", "login-email"}
    assert data["planned-units"] == 72


def hook(event: int, created: float, received: float) -> str:
    stamp = datetime.fromtimestamp(created, tz=UTC).isoformat().replace("+00:00", "Z")
    return json.dumps({"event": f"evt_{event}", "created": stamp, "received": received})


def test_webhook_figures_count_missing_events_and_keep_to_the_window() -> None:
    """P002: an event the receiver never saw is a missing first attempt, not a fast one; events
    created during the warm-up are outside the measured window."""
    lines = [
        hook(1, 990.0, 991.0),  # warm-up: not counted
        hook(2, 1000.5, 1000.6),
        hook(3, 1001.0, 1001.2),
        hook(4, 1002.0, 1002.3),
    ]
    figures = run.webhook_figures(lines, window_start=1000.0, window_end=1010.0, expected=5)
    assert figures["received"] == 3
    assert figures["missing"] == 2
    assert figures["p95_ms"] is None
    assert figures["reasons"] == ["2 of 5 events created in the window never reached the receiver"]
    whole = run.webhook_figures(lines, window_start=1000.0, window_end=1010.0, expected=3)
    assert whole["missing"] == 0
    assert whole["p95_ms"] == pytest.approx(300.0)
    assert whole["reasons"] == []


def test_a_webhook_take_with_missing_events_is_invalid(tmp_path: Path) -> None:
    receiver = tmp_path / "hooks.jsonl"
    receiver.write_text(hook(1, 1700000000.2, 1700000000.4) + "\n", encoding="utf-8")
    data = take(
        tmp_path,
        "--scenario",
        "webhook-first-attempt",
        "--rate",
        "2",
        "--duration",
        "1",
        "--receiver-file",
        str(receiver),
        "--receiver-drain",
        "0",
    )
    assert data["valid"] is False
    assert data["value"] is None
    assert data["receiver-missing"] == 1
    reasons = data["invalid-reasons"]
    assert isinstance(reasons, list)
    assert "1 of 2 events created in the window never reached the receiver" in reasons


def test_wait_for_idle_returns_the_baseline_once_idle() -> None:
    """P003, discard rule 2: the take waits for a load of at most 4 and no queue depth."""
    probes = iter([run.IdleProbe(5.1, 0), run.IdleProbe(3.9, 2), run.IdleProbe(3.5, 0)])
    now = [0.0]

    def sleep(seconds: float) -> None:
        now[0] += seconds

    baseline = run.wait_for_idle(
        lambda: next(probes), timeout_s=900.0, clock=lambda: now[0], sleep=sleep
    )
    assert baseline == {
        "idle": True,
        "baseline-load": 3.5,
        "waited-seconds": 10.0,
        "waiting": 0,
        "active": [],
    }


def test_wait_for_idle_gives_up_after_its_timeout() -> None:
    now = [0.0]

    def sleep(seconds: float) -> None:
        now[0] += seconds

    with pytest.raises(run.NotIdleError) as raised:
        run.wait_for_idle(
            lambda: run.IdleProbe(6.0, 0, ("report-run",)),
            timeout_s=12.0,
            clock=lambda: now[0],
            sleep=sleep,
        )
    assert raised.value.baseline["idle"] is False
    assert raised.value.baseline["active"] == ["report-run"]


def test_a_take_is_not_started_without_its_idle_baseline(tmp_path: Path) -> None:
    seed, env = write_inputs(tmp_path)
    args = run.parser().parse_args(
        [
            *("take", "--scenario", "api-writes", "--rate", "1", "--duration", "1"),
            *("--seed-file", str(seed), "--env-file", str(env), "--out", str(tmp_path / "takes")),
            *("--idle-timeout", "0"),
        ]
    )
    sent: list[str] = []

    def factory(url: str) -> OpenModelDriver:
        sent.append(url)
        return driver_factory(url)

    with pytest.raises(run.NotIdleError):
        run.run_take(
            args,
            driver_factory=factory,
            execute=on_fake_clock,
            clock=lambda: 1700000000.0,
            load=lambda: 5.0,
            idle=lambda: run.IdleProbe(5.0, 0),
            states=dict,
            sleep=lambda _: None,
        )
    assert sent == []
    listed = list((tmp_path / "takes").glob("*.not-started.json"))
    assert len(listed) == 1
    assert json.loads(listed[0].read_text(encoding="utf-8"))["idle"] is False


def test_container_states_and_a_restart() -> None:
    """P003, discard rule 1: a container whose restart count or start time changed during the
    take invalidates it."""
    calls: list[list[str]] = []

    def run_command(args: object) -> str:
        argv = list(args)  # type: ignore[call-overload]
        calls.append(argv)
        if argv[:2] == ["docker", "compose"]:
            return "c1\nc2\n"
        return "/openverify-load-api-1 0 2026-11-17T10:00:00Z\n/openverify-load-worker-1 1 t1\n"

    states = run.container_states(run_command, "openverify-load")
    assert states == {
        "/openverify-load-api-1": "0 2026-11-17T10:00:00Z",
        "/openverify-load-worker-1": "1 t1",
    }
    assert calls[0] == ["docker", "compose", "-p", "openverify-load", "ps", "-q"]
    assert calls[1][:3] == ["docker", "inspect", "--format"]
    after = {**states, "/openverify-load-api-1": "1 2026-11-17T10:03:00Z"}
    assert run.restart_reasons(states, after) == [
        "a container restarted during the take: /openverify-load-api-1"
    ]
    assert run.restart_reasons(states, states) == []
    gone = {"/openverify-load-worker-1": "1 t1"}
    assert run.restart_reasons(states, gone) == [
        "a container restarted during the take: /openverify-load-api-1"
    ]


def test_a_restart_during_a_take_invalidates_it(tmp_path: Path) -> None:
    seed, env = write_inputs(tmp_path)
    args = run.parser().parse_args(
        [
            *("take", "--scenario", "api-writes", "--rate", "1", "--duration", "1"),
            *("--seed-file", str(seed), "--env-file", str(env), "--out", str(tmp_path / "takes")),
        ]
    )
    looks = iter([{"/api": "0 t0"}, {"/api": "1 t1"}])
    path = run.run_take(
        args,
        driver_factory=driver_factory,
        execute=on_fake_clock,
        clock=lambda: 1700000000.0,
        load=lambda: 1.0,
        idle=lambda: run.IdleProbe(1.0, 0),
        states=lambda: next(looks),
        sleep=lambda _: None,
    )
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["valid"] is False
    assert data["invalid-reasons"] == ["a container restarted during the take: /api"]
    assert data["idle-baseline"] == {
        "idle": True,
        "baseline-load": 1.0,
        "waited-seconds": 0.0,
        "waiting": 0,
        "active": [],
    }


def test_a_sign_in_s_two_steps_are_a_unit_completion() -> None:
    """calibration-load-11d's followup: console-login records each sign-in's password-to-TOTP
    time, so the two-step figure is measured beside the password row."""
    assert run.COMPLETIONS["console-login"] == "totp"
    outcomes = [
        Outcome("password", 202, 0.0, 0.0, 60.0, unit=1),
        Outcome("totp", 201, 0.06, 0.06, 90.0, unit=1, follow_up=True),
    ]
    assert run.completions(outcomes, 0.0, "totp")["p95_ms"] == pytest.approx(150.0)
