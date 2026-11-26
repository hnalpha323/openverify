#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Download the pinned bundletool jar (C214.7, C216.2; review F22).

bundletool measures the minified demo's download and install size per ABI and reads a bundle's
``PAGE_ALIGNMENT_16K`` (``android/scripts/check-size.py``, C216). It is build tooling only: never
shipped, never committed. The pin below holds its https release URL, SHA-256 and byte size; the
jar is written only after its digest matches, and a jar already present with the right digest is
kept, so the script is safe to rerun.

A failed connection, a timeout or a 5xx answer is retried, at most five attempts with a doubling
delay; a 4xx answer and a size or digest that differs from the pin fail at once. An optional cache
directory keeps the verified jar between runs (a CI cache); a cached copy is used only when its
size and SHA-256 match the pin, and is discarded otherwise (KP10-52; the pattern of
``infra/scripts/install-gitleaks.sh``).

Usage, before Gradle::

    python3 -I scripts/fetch_bundletool.py            # into android/build/bundletool/
    python3 -I scripts/fetch_bundletool.py --dest /tmp/tools
    python3 -I scripts/fetch_bundletool.py --cache-dir ~/.cache/openverify-bundletool

Env: ``BUNDLETOOL_CACHE_DIR`` (the cache directory when ``--cache-dir`` is not given);
``BUNDLETOOL_RETRY_DELAY_SECONDS`` (the first retry's delay, default 2).

Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent
DEFAULT_DEST: Final = REPO_ROOT / "android" / "build" / "bundletool"
"""Under ``android/build/``, which git ignores: the jar is never committed (rule 9)."""
DEFAULT_TIMEOUT_SECONDS: Final = 120.0
CHUNK_SIZE: Final = 1 << 16
ATTEMPTS: Final = 5
DEFAULT_RETRY_DELAY_SECONDS: Final = 2.0
FIRST_SERVER_ERROR: Final = 500
"""A 5xx answer is retried; a 4xx answer fails at once."""

LICENSE: Final = "Apache-2.0"
"""bundletool's licence (``THIRD_PARTY_LICENSES.md``): build tooling, never shipped."""
RELEASED: Final = "2025-12-15"
"""The release's publication date (GitHub's release metadata, read 2026-11-10): the newest release
on or before 2026-10-15 and more than 14 days old on its adoption day (C214.7, decision 62)."""


@dataclass(frozen=True, slots=True)
class Pin:
    """One pinned download."""

    version: str
    url: str
    sha256: str
    size: int


PIN: Final = Pin(
    version="1.18.3",
    url="https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar",
    sha256="a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29",
    size=32_520_401,
)

Opener = Callable[[str, float], IO[bytes]]
"""``opener(url, timeout_seconds)`` returns a readable, closeable response."""


class FetchError(Exception):
    """The download failed or did not match its pin."""


class _TransientError(Exception):
    """A failure a later attempt may not meet: a connection failure, a timeout, a 5xx answer."""


def default_opener(url: str, timeout: float) -> IO[bytes]:
    """Open ``url`` over https, following redirects, with a generic client name."""
    request = urllib.request.Request(url, headers={"User-Agent": "fetch-bundletool"})  # noqa: S310
    response: IO[bytes] = urllib.request.urlopen(request, timeout=timeout)  # noqa: S310
    return response


def jar_path(pinned: Pin, dest: Path) -> Path:
    """Where the pinned jar lives under ``dest``."""
    return dest / f"bundletool-all-{pinned.version}.jar"


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _matches(pinned: Pin, path: Path) -> bool:
    return (
        path.is_file() and path.stat().st_size == pinned.size and _sha256_of(path) == pinned.sha256
    )


def _install(source: Path, target: Path) -> None:
    """Copy ``source`` to ``target`` through a temporary file in the same directory."""
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, name = tempfile.mkstemp(prefix=".bundletool-", suffix=".part", dir=target.parent)
    os.close(handle)
    partial = Path(name)
    try:
        shutil.copyfile(source, partial)
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)


def fetch(  # noqa: PLR0913 (the opener, cache and sleep are injected for the tests)
    pinned: Pin,
    dest: Path,
    *,
    opener: Opener = default_opener,
    cache_dir: Path | None = None,
    retry_delay: float = DEFAULT_RETRY_DELAY_SECONDS,
    sleep: Callable[[float], object] = time.sleep,
) -> str:
    """Fetch ``pinned`` into ``dest``: ``present`` when it is already there, ``cached`` when a
    verified copy came from ``cache_dir``, else ``downloaded`` (and then kept in ``cache_dir``).

    A transient failure is retried, at most :data:`ATTEMPTS` attempts, the delay doubling from
    ``retry_delay``. Raises :class:`FetchError` when the download fails or its size or digest
    differs from the pin; nothing is left behind then, in ``dest`` or in the cache.
    """
    if not pinned.url.startswith("https://"):
        raise FetchError("the pinned URL must be https")
    target = jar_path(pinned, dest)
    if _matches(pinned, target):
        return "present"
    if cache_dir is not None:
        cached = jar_path(pinned, cache_dir)
        if _matches(pinned, cached):
            _install(cached, target)
            return "cached"
        cached.unlink(missing_ok=True)
    delay = retry_delay
    for attempt in range(1, ATTEMPTS + 1):
        try:
            _download(pinned, dest, target, opener)
            break
        except _TransientError as exc:
            if attempt == ATTEMPTS:
                raise FetchError(f"download failed on all {ATTEMPTS} attempts: {exc}") from exc
            sleep(delay)
            delay *= 2
    if cache_dir is not None:
        _install(target, jar_path(pinned, cache_dir))
    return "downloaded"


def _download(pinned: Pin, dest: Path, target: Path, opener: Opener) -> None:
    """One attempt: writes ``target`` only when the size and digest match the pin."""
    dest.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    received = 0
    handle, name = tempfile.mkstemp(prefix=".bundletool-", suffix=".part", dir=dest)
    partial = Path(name)
    try:
        with os.fdopen(handle, "wb") as out:
            try:
                with opener(pinned.url, DEFAULT_TIMEOUT_SECONDS) as response:
                    while chunk := response.read(CHUNK_SIZE):
                        received += len(chunk)
                        if received > pinned.size:
                            raise FetchError(
                                f"size is over the pinned {pinned.size} bytes; refused"
                            )
                        digest.update(chunk)
                        out.write(chunk)
            except urllib.error.HTTPError as exc:
                if exc.code >= FIRST_SERVER_ERROR:
                    raise _TransientError(f"HTTP {exc.code}") from exc
                raise FetchError(f"download failed: HTTP {exc.code} (not retried)") from exc
            except (urllib.error.URLError, OSError, TimeoutError) as exc:
                raise _TransientError(str(exc)) from exc
        if received != pinned.size:
            raise FetchError(f"size is {received} bytes, not the pinned {pinned.size}; refused")
        if digest.hexdigest() != pinned.sha256:
            raise FetchError("SHA-256 differs from the pin; refused")
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)


def retry_delay_from_env() -> float:
    """``BUNDLETOOL_RETRY_DELAY_SECONDS``, or the default."""
    raw = os.environ.get("BUNDLETOOL_RETRY_DELAY_SECONDS", "")
    try:
        return max(0.0, float(raw)) if raw else DEFAULT_RETRY_DELAY_SECONDS
    except ValueError:
        return DEFAULT_RETRY_DELAY_SECONDS


def main(
    argv: Sequence[str] | None = None,
    *,
    opener: Opener = default_opener,
    pinned: Pin = PIN,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument(
        "--dest", type=Path, default=DEFAULT_DEST, help="download directory (git-ignored)"
    )
    cache_env = os.environ.get("BUNDLETOOL_CACHE_DIR")
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(cache_env) if cache_env else None,
        help="keep the verified jar here between runs (default: BUNDLETOOL_CACHE_DIR)",
    )
    args = parser.parse_args(argv)
    dest: Path = args.dest
    try:
        status = fetch(
            pinned,
            dest,
            opener=opener,
            cache_dir=args.cache_dir,
            retry_delay=retry_delay_from_env(),
        )
    except FetchError as exc:
        print(f"bundletool {pinned.version}: FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"bundletool {pinned.version}: {status} {jar_path(pinned, dest)} ({LICENSE})")
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by hand and by the Android gate
    raise SystemExit(main())
