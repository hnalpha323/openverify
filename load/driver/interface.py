"""The open-model driver (C268.2; reviews H11, V16).

A scenario yields `PlannedRequest`s on a constant-arrival schedule; the driver sends each at its
planned time whether or not earlier ones have answered (an open model, so it does not omit
coordinated delays) and returns one `Outcome` each. A request may carry a `then`: given the answer,
it names the next request of the same unit (a session's upload after its start, a login's TOTP step
after its password, a poll after a submit) and how long after the answer it is due. Locust could
replace `OpenModelDriver` under Q12 without a scenario changing, because scenarios see only this
interface.

The schedule-lag bound is the method's (docs/calibration/load-phase11.md, "The core split and
the generators"): a take is invalid when its p99 lag exceeds 10 ms or its largest lag exceeds
100 ms.

An outcome holds no body, token or address: its step, unit, status and timings only (rule 11).
Bodies and headers live in memory for the request alone and are never written anywhere.
"""

from __future__ import annotations

import asyncio
import json
import math
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from driver.clock import Clock, MonotonicClock

#: The method's bound on the driver's schedule lag (V16): the p99, in milliseconds.
SCHEDULE_LAG_P99_MS = 10.0
#: The method's bound on the largest single lag, in milliseconds.
SCHEDULE_LAG_MAX_MS = 100.0


class NotBuiltError(NotImplementedError):
    """A part of the harness that Workflow 11D's load-harness builds; until then it refuses."""

    def __init__(self, what: str) -> None:
        super().__init__(f"{what}: not built yet (Workflow 11D load-harness)")


@dataclass(frozen=True, slots=True)
class Answer:
    """What a follow-up sees of the answer before it: the status (None for a timeout or a
    connection error) and the body, in memory only."""

    status: int | None
    body: bytes

    def json(self) -> object:
        """The body parsed as JSON, or None when it is not JSON."""
        try:
            return json.loads(self.body)
        except ValueError:
            return None


@dataclass(frozen=True, slots=True)
class FollowUp:
    """The next request of a unit, due `delay_seconds` after the answer it follows."""

    request: PlannedRequest
    delay_seconds: float = 0.0


@dataclass(frozen=True, slots=True)
class PlannedRequest:
    """One request of a scenario, planned at `at_seconds` after the take's start. `then`, when
    given, names the unit's next request from this one's answer (None ends the unit)."""

    at_seconds: float
    method: str
    step: str
    path: str = "/"
    headers: tuple[tuple[str, str], ...] = ()
    body: bytes | None = None
    unit: int = 0
    then: Callable[[Answer], FollowUp | None] | None = field(default=None, compare=False)
    #: The server's own duration of the unit read from this request's answer (ms), recorded as the
    #: outcome's `server_ms` (a duration only, never a body): the fairness victim's report time.
    measure: Callable[[Answer], float | None] | None = field(default=None, compare=False)


@dataclass(frozen=True, slots=True)
class Outcome:
    """What happened to one planned request: its status (None for a timeout or a connection error)
    and its planned and actual send times, in seconds from the take's start, and its latency.
    `follow_up` marks a request a unit sent after an answer (planned at that answer plus its delay).
    """

    step: str
    status: int | None
    planned_seconds: float
    sent_seconds: float
    latency_ms: float
    unit: int = 0
    follow_up: bool = False
    server_ms: float | None = None

    @property
    def lag_ms(self) -> float:
        """How late the request was sent, in milliseconds (never negative)."""
        return max(0.0, (self.sent_seconds - self.planned_seconds) * 1000.0)


def lag_within_bound(outcomes: Sequence[Outcome]) -> bool:
    """Whether a take's schedule lag is within the method's bound: its nearest-rank p99 at most
    `SCHEDULE_LAG_P99_MS` and its largest at most `SCHEDULE_LAG_MAX_MS` (an empty take is)."""
    if not outcomes:
        return True
    lags = sorted(outcome.lag_ms for outcome in outcomes)
    p99 = lags[math.ceil(0.99 * len(lags)) - 1]
    return p99 <= SCHEDULE_LAG_P99_MS and lags[-1] <= SCHEDULE_LAG_MAX_MS


@dataclass(frozen=True, slots=True)
class Take:
    """A take's outcomes, its wall window on the driver's clock and the driver's CPU time in it."""

    outcomes: list[Outcome]
    wall_seconds: float
    cpu_seconds: float

    @property
    def cpu_share(self) -> float:
        """The driver's CPU time over the window, as a share of one logical CPU."""
        return self.cpu_seconds / self.wall_seconds if self.wall_seconds > 0 else 0.0


class Driver(Protocol):
    """Sends a scenario's planned requests on their schedule and returns one outcome each."""

    def run(self, schedule: Iterable[PlannedRequest]) -> list[Outcome]: ...


class OpenModelDriver:
    """The `httpx` driver: a constant-arrival scheduler over one `httpx.AsyncClient`.

    `transport` replaces the network (tests give a mock transport), `clock` the time source (tests
    give a `FakeClock`) and `cpu_seconds` the CPU meter (`time.process_time` by default: utime plus
    stime of this process, the method's generator share). Each request is sent by its own task, so
    a slow answer never delays the next planned send.
    """

    def __init__(  # noqa: PLR0913 - the driver's injectable parts, keyword-only
        self,
        base_url: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Clock | None = None,
        cpu_seconds: Callable[[], float] = time.process_time,
        timeout_seconds: float = 30.0,
        max_connections: int = 4096,
    ) -> None:
        self.base_url = base_url
        self._transport = transport
        self._clock: Clock = clock if clock is not None else MonotonicClock()
        self._cpu_seconds = cpu_seconds
        self._timeout = timeout_seconds
        self._max_connections = max_connections

    def run(self, schedule: Iterable[PlannedRequest]) -> list[Outcome]:
        """Runs the schedule on a new event loop and returns its outcomes in send order."""
        return asyncio.run(self.take(schedule)).outcomes

    async def take(self, schedule: Iterable[PlannedRequest]) -> Take:
        """Sends every planned request (and its follow-ups) and returns the take."""
        limits = httpx.Limits(
            max_connections=self._max_connections,
            max_keepalive_connections=self._max_connections,
        )
        timeout = httpx.Timeout(self._timeout)
        async with httpx.AsyncClient(
            base_url=self.base_url, transport=self._transport, limits=limits, timeout=timeout
        ) as client:
            outcomes: list[Outcome] = []
            tasks: list[asyncio.Task[None]] = []
            start = self._clock.now()
            cpu_start = self._cpu_seconds()
            previous = -math.inf
            for planned in schedule:
                if planned.at_seconds < previous:
                    raise ValueError("a schedule is in planned order")
                previous = planned.at_seconds
                await self._clock.sleep_until(start + planned.at_seconds)
                tasks.append(
                    asyncio.create_task(
                        self._send(client, start, planned, planned.at_seconds, False, outcomes)
                    )
                )
            if tasks:
                await asyncio.gather(*tasks)
            return Take(
                outcomes=sorted(outcomes, key=lambda o: (o.sent_seconds, o.planned_seconds)),
                wall_seconds=self._clock.now() - start,
                cpu_seconds=self._cpu_seconds() - cpu_start,
            )

    async def _send(  # noqa: PLR0913, PLR0917 - one send's context, private
        self,
        client: httpx.AsyncClient,
        start: float,
        planned: PlannedRequest,
        planned_seconds: float,
        follow_up: bool,
        outcomes: list[Outcome],
    ) -> None:
        sent = self._clock.now()
        status: int | None
        body = b""
        try:
            response = await client.request(
                planned.method,
                planned.path,
                headers=list(planned.headers),
                content=planned.body,
            )
            status = response.status_code
            body = response.content
        except httpx.HTTPError:
            status = None
        done = self._clock.now()
        server_ms = planned.measure(Answer(status, body)) if planned.measure is not None else None
        outcomes.append(
            Outcome(
                step=planned.step,
                status=status,
                planned_seconds=planned_seconds,
                sent_seconds=sent - start,
                latency_ms=(done - sent) * 1000.0,
                unit=planned.unit,
                follow_up=follow_up,
                server_ms=server_ms,
            )
        )
        if planned.then is None:
            return
        following = planned.then(Answer(status, body))
        if following is None:
            return
        due = done - start + following.delay_seconds
        await self._clock.sleep_until(start + due)
        await self._send(client, start, following.request, due, True, outcomes)
