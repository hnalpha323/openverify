"""Test doubles for ``scripts/fetch_fixtures.py``: the script itself, a fake clock and a fake web.

Nothing here touches the network: :class:`FakeWeb` answers by URL with recorded replies, the way
``urllib`` would (an ``HTTPError`` carrying the reply's headers for any status of 400 or more).
"""

from __future__ import annotations

import importlib.util
import io
import sys
import threading
import urllib.error
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from http.client import HTTPMessage
from pathlib import Path
from types import ModuleType

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "fetch_fixtures.py"


def load_script() -> ModuleType:
    """``scripts/fetch_fixtures.py`` as a module (it is a standalone script, not a package)."""
    spec = importlib.util.spec_from_file_location("fetch_fixtures", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_fixtures"] = module
    spec.loader.exec_module(module)
    return module


class FakeClock:
    """A monotonic clock that only moves when someone sleeps on it. Thread-safe."""

    def __init__(self, start: float = 1000.0) -> None:
        self._now = start
        self._lock = threading.Lock()
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        with self._lock:
            return self._now

    def sleep(self, seconds: float) -> None:
        assert seconds >= 0
        with self._lock:
            self.sleeps.append(seconds)
            self._now += seconds


@dataclass(frozen=True)
class Reply:
    status: int = 200
    body: bytes = b""
    headers: dict[str, str] = field(default_factory=dict)


class _Body(io.BytesIO):
    """A response body that reports when it is closed, to count connections in flight."""

    def __init__(self, data: bytes, web: FakeWeb) -> None:
        super().__init__(data)
        self._web = web

    def close(self) -> None:
        if not self.closed:
            self._web.finished()
        super().close()


class FakeWeb:
    """Serves recorded replies by URL and records each request with the clock's time.

    A route holds one reply, or a list consumed in order whose last reply then repeats. A URL with
    no route answers 404. ``barrier`` makes the first reads of that many responses wait for each
    other, which proves they were open at the same time."""

    def __init__(
        self,
        routes: Mapping[str, Reply | Sequence[Reply]],
        clock: FakeClock | None = None,
        barrier: threading.Barrier | None = None,
    ) -> None:
        self._routes = {
            url: list(r) if isinstance(r, Sequence) else [r] for url, r in routes.items()
        }
        self._clock = clock
        self._barrier = barrier
        self._lock = threading.Lock()
        self.calls: list[tuple[str, float]] = []
        self.in_flight = 0
        self.max_in_flight = 0

    @property
    def urls(self) -> list[str]:
        return [url for url, _ in self.calls]

    @property
    def times(self) -> list[float]:
        return [at for _, at in self.calls]

    def finished(self) -> None:
        with self._lock:
            self.in_flight -= 1

    def __call__(self, url: str, timeout: float) -> io.BytesIO:
        assert timeout > 0
        with self._lock:
            self.calls.append((url, self._clock() if self._clock is not None else 0.0))
            replies = self._routes.get(url)
            reply = Reply(404, b"missing") if not replies else replies[0]
            if replies is not None and len(replies) > 1:
                replies.pop(0)
        if reply.status >= 400:  # urllib raises HTTPError from 400 on
            headers = HTTPMessage()
            for key, value in reply.headers.items():
                headers[key] = value
            raise urllib.error.HTTPError(url, reply.status, "fake", headers, io.BytesIO(reply.body))
        with self._lock:
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
            opened = len(self.calls)
        if self._barrier is not None and opened <= self._barrier.parties:
            self._barrier.wait()
        return _Body(reply.body, self)
