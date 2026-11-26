"""The webhook receiver (C269.1): it records an event's id, name and creation time with its
arrival, never the body, and event to first attempt is the earliest arrival minus `created-at`."""

from __future__ import annotations

import json
import threading
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from receiver import first_attempt_latencies_ms, record_of, serve


def test_a_delivery_s_record_holds_ids_and_times_only() -> None:
    body = json.dumps(
        {
            "data": {
                "id": "evt_1",
                "attributes": {
                    "name": "inquiry.created",
                    "created-at": "2026-11-16T10:00:00Z",
                    "payload": {"email": "x@example.com"},
                },
            }
        }
    ).encode()
    assert record_of(body, 5.0) == {
        "event": "evt_1",
        "name": "inquiry.created",
        "created": "2026-11-16T10:00:00Z",
        "received": 5.0,
    }
    assert record_of(b"not json", 1.0) is None
    assert record_of(b"[]", 1.0) is None
    assert record_of(b'{"data": {"attributes": 1}}', 1.0) is None
    assert record_of(b'{"data": {"id": "e", "attributes": {}}}', 1.0) is None


def test_first_attempt_latencies() -> None:
    base = datetime(2026, 11, 16, 10, tzinfo=UTC).timestamp()
    lines = [
        json.dumps({"event": "a", "created": "2026-11-16T10:00:00Z", "received": base + 30.0}),
        json.dumps({"event": "a", "created": "2026-11-16T10:00:00Z", "received": base + 0.5}),
        "",
        json.dumps({"event": "b", "created": "2026-11-16T10:00:00+00:00", "received": base + 1.25}),
    ]
    assert first_attempt_latencies_ms(lines) == [500.0, 1250.0]


def test_the_server_records_and_answers_200(tmp_path: Path) -> None:
    out = tmp_path / "hooks.jsonl"
    server = serve("127.0.0.1", 0, out)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        body = json.dumps(
            {
                "data": {
                    "id": "evt_9",
                    "attributes": {"name": "n", "created-at": "2026-11-16T10:00:00Z"},
                }
            }
        ).encode()
        request = urllib.request.Request(f"http://127.0.0.1:{port}/hook", data=body, method="POST")
        with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310 - the local receiver
            assert response.status == 200
        urllib.request.urlopen(
            urllib.request.Request(f"http://127.0.0.1:{port}/", data=b"x", method="POST"), timeout=5
        ).close()
    finally:
        server.shutdown()
        server.server_close()
    lines = out.read_text(encoding="utf-8").splitlines()
    assert [json.loads(line)["event"] for line in lines] == ["evt_9"]
