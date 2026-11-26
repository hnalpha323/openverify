"""C269.1's webhook row: the local receiver of `webhook-first-attempt`.

It listens where the stack's worker reaches it (the host through `host.docker.internal`, with
`OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` in the load override), answers every delivery 200
at once, and records only the event's id, name and `created-at` with the time it arrived: never the
body, a header or the signature (rule 11). Event to first attempt is each event's earliest arrival
minus its `created-at`.

Run: python receiver.py --port 28080 --out load/results/<take>/webhooks.jsonl
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from collections.abc import Callable, Iterable, Sequence
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import IO


def record_of(body: bytes, received: float) -> dict[str, object] | None:
    """The event's id, name and creation time from a delivery, or None for anything else."""
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return None
    attributes = data.get("attributes")
    if not isinstance(attributes, dict):
        return None
    event, name, created = data.get("id"), attributes.get("name"), attributes.get("created-at")
    if not (isinstance(event, str) and isinstance(created, str)):
        return None
    return {
        "event": event,
        "name": name if isinstance(name, str) else None,
        "created": created,
        "received": received,
    }


def first_attempt_latencies_ms(lines: Iterable[str]) -> list[float]:
    """Each event's first arrival minus its `created-at`, in ms, sorted."""
    first: dict[str, float] = {}
    created: dict[str, float] = {}
    for line in lines:
        if not line.strip():
            continue
        entry = json.loads(line)
        event = str(entry["event"])
        first[event] = min(first.get(event, float("inf")), float(entry["received"]))
        created[event] = datetime.fromisoformat(
            str(entry["created"]).replace("Z", "+00:00")
        ).timestamp()
    return sorted(max(0.0, (first[e] - created[e]) * 1000.0) for e in first)


def handler_for(
    sink: IO[str], lock: threading.Lock, clock: Callable[[], float] = time.time
) -> type[BaseHTTPRequestHandler]:
    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            received = clock()
            length = int(self.headers.get("content-length") or 0)
            record = record_of(self.rfile.read(length), received)
            if record is not None:
                with lock:
                    sink.write(json.dumps(record, sort_keys=True) + "\n")
                    sink.flush()
            self.send_response(200)
            self.send_header("content-length", "0")
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:
            return

    return Receiver


class ReceiverServer(ThreadingHTTPServer):
    """The receiver's server; closing it closes its record file."""

    daemon_threads = True

    def __init__(self, address: tuple[str, int], out: Path) -> None:
        self.sink = out.open("a", encoding="utf-8")
        super().__init__(address, handler_for(self.sink, threading.Lock()))

    def server_close(self) -> None:
        super().server_close()
        self.sink.close()


def serve(host: str, port: int, out: Path) -> ReceiverServer:
    """A receiver writing to `out`; the caller serves, then shuts it down and closes it."""
    return ReceiverServer((host, port), out)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="receiver.py")
    parser.add_argument("--host", default="0.0.0.0")  # noqa: S104 - the stack's worker reaches the host
    parser.add_argument("--port", type=int, default=28080)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    server = serve(args.host, args.port, args.out)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
