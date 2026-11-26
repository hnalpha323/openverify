"""What the scenarios share (C268.3): arrivals, the spread, documentation addresses only, TOTP as
the API checks it (RFC 6238's SHA-1 vector), multipart bodies and synthetic images, polling."""

from __future__ import annotations

import asyncio
import struct
import zlib

import httpx
import pytest

from driver import Answer, OpenModelDriver, PlannedRequest
from driver.clock import FakeClock
from scenarios.common import (
    api_headers,
    arrivals,
    chain,
    documentation_addresses,
    member,
    multipart,
    pick,
    poll,
    synthetic_png,
    totp,
)
from scenarios.seed import Key


def test_arrivals_at_a_constant_rate() -> None:
    assert list(arrivals(4.0, 1.0)) == [0.0, 0.25, 0.5, 0.75]
    assert list(arrivals(0.0, 5.0)) == []
    assert list(arrivals(3.0, 1.0)) == pytest.approx([0.0, 1 / 3, 2 / 3])


def test_the_spread_and_its_empty_pool() -> None:
    assert [pick("abc", i) for i in range(4)] == ["a", "b", "c", "a"]
    with pytest.raises(ValueError, match="empty"):
        pick([], 0)


def test_documentation_addresses_only() -> None:
    assert documentation_addresses("198.51.100.0/24", 2) == ["198.51.100.1", "198.51.100.2"]
    assert documentation_addresses("2001:db8:4c00::/40", 1) == ["2001:db8:4c00::1"]
    with pytest.raises(ValueError, match="not a documentation range"):
        documentation_addresses("10.0.0.0/24", 1)
    with pytest.raises(ValueError, match="fewer than"):
        documentation_addresses("192.0.2.0/30", 3)


def test_headers() -> None:
    headers = dict(api_headers(Key("synthetic-token", "env"), "192.0.2.1", json_body=True))
    assert headers == {
        "authorization": "Bearer synthetic-token",
        "accept": "application/json",
        "x-forwarded-for": "192.0.2.1",
        "content-type": "application/json",
    }
    assert "synthetic-token" not in repr(Key("synthetic-token", "env"))


def test_totp_matches_rfc_6238_s_sha1_vector() -> None:
    # RFC 6238 appendix B: the ASCII secret "12345678901234567890", T = 59 s, 8 digits.
    assert totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59, digits=8) == "94287082"
    assert totp("JBSWY3DPEHPK3PXP", 0) == "282760"


def test_member_reads_a_string_at_a_path() -> None:
    answer = Answer(200, b'{"data": {"id": "x", "n": 1}}')
    assert member(answer, "data", "id") == "x"
    assert member(answer, "data", "n") is None
    assert member(answer, "data", "id", "deeper") is None
    assert member(Answer(200, b"oops"), "data") is None


def test_a_multipart_body() -> None:
    content_type, body = multipart(
        [("kind", "front")], "file", "f.png", "image/png", b"PNG", boundary="b1"
    )
    assert content_type == "multipart/form-data; boundary=b1"
    assert body.startswith(b'--b1\r\nContent-Disposition: form-data; name="kind"\r\n\r\nfront\r\n')
    assert (
        b'name="file"; filename="f.png"\r\nContent-Type: image/png\r\n\r\nPNG\r\n--b1--\r\n' in body
    )


def test_a_synthetic_png_of_about_its_size_is_valid() -> None:
    data = synthetic_png(1_000_000, seed=1)
    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    assert 950_000 < len(data) < 1_050_000
    width, height = struct.unpack(">II", data[16:24])
    idat_length = struct.unpack(">I", data[33:37])[0]
    raw = zlib.decompress(data[41 : 41 + idat_length])
    assert len(raw) == height * (width * 3 + 1)
    assert synthetic_png(1_000_000, seed=1) == data
    assert synthetic_png(1_000_000, seed=2) != data


def test_chain_takes_the_first_follow_up() -> None:
    assert chain(lambda a: None, lambda a: None)(Answer(200, b"")) is None


def test_polling_until_done_or_out_of_attempts() -> None:
    clock = FakeClock()
    calls = {"n": 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"done": calls["n"] >= 3})

    def request() -> PlannedRequest:
        return PlannedRequest(0.0, "GET", "poll", path="/p")

    then = poll(request, lambda a: a.json() == {"done": True}, every_seconds=2.0, attempts=5)
    first = PlannedRequest(0.0, "GET", "start", path="/s", then=then)
    driver = OpenModelDriver(
        "http://x", transport=httpx.MockTransport(handler), clock=clock, cpu_seconds=lambda: 0.0
    )
    take = asyncio.run(clock.run(driver.take([first])))
    assert [o.step for o in take.outcomes] == ["start", "poll", "poll"]
    assert [o.sent_seconds for o in take.outcomes] == [0.0, 2.0, 4.0]
    limited = poll(request, lambda a: False, every_seconds=1.0, attempts=0)
    assert limited(Answer(200, b"{}")) is None
    assert poll(request, lambda a: False, every_seconds=1.0, attempts=3)(Answer(500, b"")) is None
