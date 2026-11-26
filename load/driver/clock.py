"""The driver's clock (C268.2): the monotonic wall clock for takes, and a discrete-event fake one
for tests, so a test can run a 60-second schedule against a slow server in no wall time at all.
"""

from __future__ import annotations

import asyncio
import heapq
import itertools
import time
from collections.abc import Awaitable
from typing import Protocol, TypeVar

T = TypeVar("T")


class Clock(Protocol):
    """Seconds on a monotonic scale, and a way to wait until a point on it."""

    def now(self) -> float: ...

    async def sleep_until(self, deadline: float) -> None: ...


class MonotonicClock:
    """`time.monotonic` and `asyncio.sleep`: the clock of a real take."""

    def now(self) -> float:
        return time.monotonic()

    async def sleep_until(self, deadline: float) -> None:
        delay = deadline - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)
        else:
            await asyncio.sleep(0)


class FakeClock:
    """A discrete-event clock for tests: time moves only when every task waits on the clock, and
    then straight to the earliest deadline. Tasks must wait only on this clock (a fake transport
    simulates a slow server with `sleep`), never on real I/O."""

    #: How many times the event loop is yielded before time moves on: enough for every ready task
    #: of a test's driver (an httpx request through a mock transport takes a few dozen yields).
    SETTLE_YIELDS = 400

    def __init__(self, start: float = 0.0) -> None:
        self._now = start
        self._waiters: list[tuple[float, int, asyncio.Future[None]]] = []
        self._sequence = itertools.count()

    def now(self) -> float:
        return self._now

    async def sleep_until(self, deadline: float) -> None:
        if deadline <= self._now:
            await asyncio.sleep(0)
            return
        future: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        heapq.heappush(self._waiters, (deadline, next(self._sequence), future))
        await future

    async def sleep(self, seconds: float) -> None:
        await self.sleep_until(self._now + seconds)

    async def run(self, work: Awaitable[T]) -> T:
        """Runs `work` to completion, moving time forward whenever nothing else can run."""
        task = asyncio.ensure_future(work)
        while not task.done():
            for _ in range(self.SETTLE_YIELDS):
                await asyncio.sleep(0)
                if task.done():
                    break
            if task.done():
                break
            if not self._waiters:
                task.cancel()
                raise RuntimeError(
                    "FakeClock: every task is blocked on something other than the clock"
                )
            deadline, _, future = heapq.heappop(self._waiters)
            self._now = max(self._now, deadline)
            if not future.cancelled():
                future.set_result(None)
        return task.result()
