"""The open-model driver (C268.2; reviews H11, V16): a constant arrival rate over a fake transport
and a fake clock, a slow server that must not slow the schedule, follow-ups, the lag bound and the
generator's CPU share."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from driver import (
    SCHEDULE_LAG_MAX_MS,
    SCHEDULE_LAG_P99_MS,
    Answer,
    FollowUp,
    OpenModelDriver,
    Outcome,
    PlannedRequest,
    lag_within_bound,
)
from driver.clock import FakeClock, MonotonicClock


def outcome(lag_ms: float) -> Outcome:
    return Outcome("step", 200, 1.0, 1.0 + lag_ms / 1000.0, 12.0)


def test_the_bound_is_the_method_s() -> None:
    assert SCHEDULE_LAG_P99_MS == 10.0
    assert SCHEDULE_LAG_MAX_MS == 100.0


def test_a_lag_is_never_negative() -> None:
    assert Outcome("step", 200, 2.0, 1.5, 3.0).lag_ms == 0.0
    assert outcome(4.0).lag_ms == pytest.approx(4.0)


def test_a_take_within_the_bound() -> None:
    assert lag_within_bound([outcome(1.0)] * 99 + [outcome(9.0)])
    assert lag_within_bound([])


def test_a_p99_past_10_ms_is_out_of_bound() -> None:
    assert not lag_within_bound([outcome(1.0)] * 97 + [outcome(11.0)] * 3)


def test_one_stall_past_100_ms_is_out_of_bound() -> None:
    assert not lag_within_bound([outcome(1.0)] * 999 + [outcome(101.0)])


def constant(rate: float, seconds: float, step: str = "read") -> list[PlannedRequest]:
    count = int(rate * seconds)
    return [PlannedRequest(i / rate, "GET", step, path=f"/item/{i}") for i in range(count)]


def slow_server(clock: FakeClock, seconds: float, status: int = 200) -> httpx.MockTransport:
    async def handler(request: httpx.Request) -> httpx.Response:
        await clock.sleep(seconds)
        return httpx.Response(status, json={"path": request.url.path})

    return httpx.MockTransport(handler)


def run(driver: OpenModelDriver, clock: FakeClock, schedule: list[PlannedRequest]):  # type: ignore[no-untyped-def]
    return asyncio.run(clock.run(driver.take(schedule)))


def test_each_request_is_sent_at_its_planned_time_whatever_the_server_does() -> None:
    clock = FakeClock()
    driver = OpenModelDriver(
        "http://load.test", transport=slow_server(clock, 5.0), clock=clock, cpu_seconds=lambda: 0.0
    )
    take = run(driver, clock, constant(10.0, 6.0))
    assert len(take.outcomes) == 60
    assert [o.sent_seconds for o in take.outcomes] == pytest.approx([i / 10 for i in range(60)])
    assert all(o.lag_ms == pytest.approx(0.0) for o in take.outcomes)
    assert all(o.latency_ms == pytest.approx(5000.0) for o in take.outcomes)
    assert lag_within_bound(take.outcomes)
    # The last request answers 5 s after it was sent: the take lasts 5.9 + 5 s.
    assert take.wall_seconds == pytest.approx(10.9)


def test_a_slow_server_does_not_slow_the_schedule_a_closed_loop_would() -> None:
    clock = FakeClock()
    fast = OpenModelDriver(
        "http://load.test", transport=slow_server(clock, 0.01), clock=clock, cpu_seconds=lambda: 0.0
    )
    clock_slow = FakeClock()
    slow = OpenModelDriver(
        "http://load.test",
        transport=slow_server(clock_slow, 3.0),
        clock=clock_slow,
        cpu_seconds=lambda: 0.0,
    )
    sent_fast = [o.sent_seconds for o in run(fast, clock, constant(20.0, 2.0)).outcomes]
    sent_slow = [o.sent_seconds for o in run(slow, clock_slow, constant(20.0, 2.0)).outcomes]
    assert sent_slow == pytest.approx(sent_fast)


def test_statuses_and_errors_are_recorded() -> None:
    clock = FakeClock()

    async def handler(request: httpx.Request) -> httpx.Response:
        index = int(request.url.path.rsplit("/", 1)[1])
        if index == 1:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(503 if index == 2 else 200)

    driver = OpenModelDriver(
        "http://load.test",
        transport=httpx.MockTransport(handler),
        clock=clock,
        cpu_seconds=lambda: 0.0,
    )
    take = run(driver, clock, constant(1.0, 3.0))
    assert [o.status for o in take.outcomes] == [200, None, 503]


def test_a_follow_up_is_sent_after_the_answer_with_its_delay() -> None:
    clock = FakeClock()
    seen: list[tuple[str, bytes]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        await clock.sleep(0.5)
        seen.append((request.url.path, request.content))
        if request.url.path == "/start":
            return httpx.Response(201, json={"token": "synthetic-session"})
        return httpx.Response(200)

    def then(answer: Answer) -> FollowUp | None:
        assert answer.status == 201
        token = answer.json()
        assert token == {"token": "synthetic-session"}
        return FollowUp(
            PlannedRequest(0.0, "POST", "upload", path="/upload", body=b"synthetic", unit=7),
            delay_seconds=2.0,
        )

    driver = OpenModelDriver(
        "http://load.test",
        transport=httpx.MockTransport(handler),
        clock=clock,
        cpu_seconds=lambda: 0.0,
    )
    take = run(
        driver, clock, [PlannedRequest(1.0, "POST", "start", path="/start", unit=7, then=then)]
    )
    start, upload = take.outcomes
    assert (start.step, start.unit, start.follow_up) == ("start", 7, False)
    assert (upload.step, upload.unit, upload.follow_up, upload.status) == ("upload", 7, True, 200)
    assert upload.planned_seconds == pytest.approx(3.5)
    assert upload.sent_seconds == pytest.approx(3.5)
    assert seen[1] == ("/upload", b"synthetic")


def test_a_follow_up_may_end_the_unit() -> None:
    clock = FakeClock()
    driver = OpenModelDriver(
        "http://load.test", transport=slow_server(clock, 0.1), clock=clock, cpu_seconds=lambda: 0.0
    )
    take = run(driver, clock, [PlannedRequest(0.0, "GET", "read", then=lambda answer: None)])
    assert len(take.outcomes) == 1
    assert Answer(200, b"not json").json() is None


def test_headers_and_bodies_reach_the_server() -> None:
    clock = FakeClock()
    seen: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204)

    driver = OpenModelDriver(
        "http://load.test",
        transport=httpx.MockTransport(handler),
        clock=clock,
        cpu_seconds=lambda: 0.0,
    )
    run(
        driver,
        clock,
        [
            PlannedRequest(
                0.0,
                "POST",
                "write",
                path="/api/v1/inquiries",
                headers=(
                    ("authorization", "Bearer synthetic-key"),
                    ("x-forwarded-for", "198.51.100.7"),
                ),
                body=b'{"data":{}}',
            )
        ],
    )
    assert seen[0].headers["x-forwarded-for"] == "198.51.100.7"
    assert seen[0].content == b'{"data":{}}'


def test_the_schedule_must_be_in_planned_order() -> None:
    clock = FakeClock()
    driver = OpenModelDriver(
        "http://load.test", transport=slow_server(clock, 0.1), clock=clock, cpu_seconds=lambda: 0.0
    )
    with pytest.raises(ValueError, match="planned order"):
        run(driver, clock, [PlannedRequest(1.0, "GET", "a"), PlannedRequest(0.5, "GET", "b")])


def test_the_cpu_share_is_the_meter_over_the_window() -> None:
    clock = FakeClock()
    readings = iter([10.0, 12.5])
    driver = OpenModelDriver(
        "http://load.test",
        transport=slow_server(clock, 0.0),
        clock=clock,
        cpu_seconds=lambda: next(readings),
    )
    take = run(driver, clock, constant(1.0, 5.0))
    assert take.wall_seconds == pytest.approx(4.0)
    assert take.cpu_share == pytest.approx(2.5 / 4.0)


def test_an_empty_take_has_no_share() -> None:
    clock = FakeClock()
    driver = OpenModelDriver("http://load.test", transport=slow_server(clock, 0.0), clock=clock)
    take = run(driver, clock, [])
    assert take.outcomes == []
    assert take.cpu_share == 0.0


def test_the_fake_clock_refuses_a_task_blocked_elsewhere() -> None:
    clock = FakeClock()

    async def blocked() -> None:
        await asyncio.Event().wait()

    with pytest.raises(RuntimeError, match="blocked"):
        asyncio.run(clock.run(blocked()))


def test_the_synchronous_run_uses_the_real_clock() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200)

    driver = OpenModelDriver("http://load.test", transport=httpx.MockTransport(handler))
    outcomes = driver.run([PlannedRequest(0.0, "GET", "a"), PlannedRequest(0.01, "GET", "b")])
    assert [o.status for o in outcomes] == [200, 200]
    assert MonotonicClock().now() > 0


def test_the_real_clock_sleeps_until_its_deadline() -> None:
    clock = MonotonicClock()

    async def wait() -> float:
        start = clock.now()
        await clock.sleep_until(start + 0.02)
        await clock.sleep_until(start)
        return clock.now() - start

    assert asyncio.run(wait()) >= 0.02


def test_a_request_s_measure_records_the_server_s_own_duration() -> None:
    """P001: a poll's answer carries the server's own times; the driver keeps the duration they
    give (never the body) on the outcome, so a unit's time is free of the poll's interval."""
    clock = FakeClock()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"took": 125.5})

    def took(answer: Answer) -> float | None:
        data = answer.json()
        return float(data["took"]) if isinstance(data, dict) else None

    driver = OpenModelDriver(
        "http://api", transport=httpx.MockTransport(handler), clock=clock, cpu_seconds=lambda: 0.0
    )
    plan = [
        PlannedRequest(0.0, "GET", "settled", measure=took),
        PlannedRequest(0.5, "GET", "other"),
    ]
    take = asyncio.run(clock.run(driver.take(plan)))
    by_step = {o.step: o for o in take.outcomes}
    assert by_step["settled"].server_ms == 125.5
    assert by_step["other"].server_ms is None
