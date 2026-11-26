"""What the scenarios share: the constant-arrival times, the spread of keys and documentation
addresses, request headers and bodies, TOTP codes, multipart uploads and synthetic images.

Nothing here writes anywhere: a body or a header lives in a `PlannedRequest` in memory only.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import math
import random
import struct
import zlib
from collections.abc import Callable, Iterator, Sequence
from typing import TypeVar

from driver import Answer, FollowUp, PlannedRequest
from scenarios.seed import Key

T = TypeVar("T")

API = "/api/v1"
#: A 2xx status: its hundreds digit.
SUCCESS_CLASS = 2
JSON = "application/json"
#: The client address header a trusted gateway forwards (OPENVERIFY_TRUST_PROXY; C268.3).
FORWARDED_FOR = "x-forwarded-for"


def arrivals(rate_per_s: float, duration_s: float) -> Iterator[float]:
    """The planned send times of a constant arrival rate: i / rate for each i under `duration_s`."""
    if rate_per_s <= 0 or duration_s <= 0:
        return
    for i in range(math.ceil(rate_per_s * duration_s)):
        at = i / rate_per_s
        if at >= duration_s:
            return
        yield at


def pick[T](items: Sequence[T], index: int) -> T:
    """The spread: item `index` of a pool used round-robin."""
    if not items:
        raise ValueError("an empty pool")
    return items[index % len(items)]


def documentation_addresses(network: str, count: int) -> list[str]:
    """The first `count` host addresses of a documentation range (192.0.2.0/24, 198.51.100.0/24,
    203.0.113.0/24 or a subnet of 2001:db8::/32), never any other address (rule 9)."""
    net = ipaddress.ip_network(network)
    documentation = [
        ipaddress.ip_network("192.0.2.0/24"),
        ipaddress.ip_network("198.51.100.0/24"),
        ipaddress.ip_network("203.0.113.0/24"),
        ipaddress.ip_network("2001:db8::/32"),
    ]
    if not any(net.version == doc.version and net.subnet_of(doc) for doc in documentation):  # type: ignore[arg-type]
        raise ValueError(f"{network} is not a documentation range")
    hosts: list[str] = []
    for host in net.hosts():
        hosts.append(str(host))
        if len(hosts) == count:
            return hosts
    raise ValueError(f"{network} holds fewer than {count} addresses")


def api_headers(
    key: Key, address: str | None = None, *, json_body: bool = False
) -> tuple[tuple[str, str], ...]:
    """An API key's authorisation, the client address when the scenario spreads one, and JSON."""
    headers: list[tuple[str, str]] = [("authorization", f"Bearer {key.token}"), ("accept", JSON)]
    if address is not None:
        headers.append((FORWARDED_FOR, address))
    if json_body:
        headers.append(("content-type", JSON))
    return tuple(headers)


def session_headers(
    token: str, address: str | None = None, *, json_body: bool = False
) -> tuple[tuple[str, str], ...]:
    """A flow session token's authorisation (the token from `resume`, in memory only)."""
    return api_headers(Key(token, ""), address, json_body=json_body)


def body(value: object) -> bytes:
    """A JSON body."""
    return json.dumps(value, separators=(",", ":")).encode()


def member(answer: Answer, *path: str) -> str | None:
    """A string at `path` in a JSON answer (None when absent or not a string)."""
    value: object = answer.json()
    for name in path:
        if not isinstance(value, dict):
            return None
        value = value.get(name)
    return value if isinstance(value, str) else None


def totp(secret_base32: str, at_unix: float, *, digits: int = 6, step: int = 30) -> str:
    """RFC 6238 over HMAC-SHA-1, as the API's `operator-auth/totp.ts` checks it."""
    padded = secret_base32.upper() + "=" * (-len(secret_base32) % 8)
    key = base64.b32decode(padded)
    counter = struct.pack(">Q", int(at_unix // step))
    mac = hmac.new(key, counter, hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    binary = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(binary % 10**digits).zfill(digits)


def multipart(  # noqa: PLR0913 - the parts of one form, the boundary keyword-only
    fields: Sequence[tuple[str, str]],
    file_field: str,
    filename: str,
    content_type: str,
    data: bytes,
    *,
    boundary: str,
) -> tuple[str, bytes]:
    """A multipart/form-data body: its content type and bytes (fields first, the file last)."""
    parts: list[bytes] = []
    for name, value in fields:
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
            + f"{value}\r\n".encode()
        )
    parts.append(
        (
            f"--{boundary}\r\nContent-Disposition: form-data; "
            f'name="{file_field}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        + data
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return f"multipart/form-data; boundary={boundary}", b"".join(parts)


def synthetic_png(target_bytes: int, seed: int) -> bytes:
    """A valid PNG of random RGB noise of about `target_bytes` (stored, not compressed), drawn from
    `seed`: a synthetic upload of a known size with no person in it (rule 9)."""
    side = max(8, int(math.sqrt(max(1, target_bytes) / 3)))
    rng = random.Random(seed)  # noqa: S311 - synthetic image bytes, not a secret
    row_bytes = side * 3
    raw = b"".join(b"\x00" + rng.randbytes(row_bytes) for _ in range(side))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", side, side, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 0))
        + chunk(b"IEND", b"")
    )


def chain(*steps: Callable[[Answer], FollowUp | None]) -> Callable[[Answer], FollowUp | None]:
    """The first step that gives a follow-up; for the readers of a scenario's units."""

    def then(answer: Answer) -> FollowUp | None:
        for step in steps:
            following = step(answer)
            if following is not None:
                return following
        return None

    return then


def succeeded(answer: Answer) -> bool:
    return answer.status is not None and answer.status // 100 == SUCCESS_CLASS


def poll(
    request: Callable[[], PlannedRequest],
    done: Callable[[Answer], bool],
    *,
    every_seconds: float,
    attempts: int,
) -> Callable[[Answer], FollowUp | None]:
    """Polls with `request` every `every_seconds` until `done` holds of an answer (the unit ends)
    or `attempts` polls were sent (the last one's step names the timeout)."""

    def make(left: int) -> Callable[[Answer], FollowUp | None]:
        def then(answer: Answer) -> FollowUp | None:
            if done(answer) or left <= 0 or not succeeded(answer):
                return None
            following = request()
            return FollowUp(
                PlannedRequest(
                    0.0,
                    following.method,
                    following.step,
                    path=following.path,
                    headers=following.headers,
                    body=following.body,
                    unit=following.unit,
                    then=make(left - 1),
                    measure=following.measure,
                ),
                every_seconds,
            )

        return then

    return make(attempts)
