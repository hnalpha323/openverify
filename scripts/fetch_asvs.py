#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Download the pinned OWASP ASVS 5.0.0 export and check the committed Level 2 id list (C274.2).

The checklist ``docs/security/asvs-5.0.0-l2.csv`` holds one row per requirement at Level 1 or 2
(253: 70 at L1, 183 at L2), with our statuses, notes and evidence only. The standard's texts are
CC-BY-SA-4.0 (share-alike), so the export is fetched into a git-ignored directory and never
committed or shipped; only its ids and levels are committed, in
``docs/security/asvs-5.0.0-l2-ids.txt``, and that list is written from the export by this script,
never typed by hand (11E rule 15).

The pin holds the release asset's https URL, SHA-256 and byte size; the file is written only after
its digest matches, and a file already present with the right digest is kept, so the script is safe
to rerun. A failed connection, a timeout or a 5xx answer is retried (at most five attempts, the
delay doubling); a 4xx answer and a size or digest that differs from the pin fail at once.

Usage::

    python3 -I scripts/fetch_asvs.py               # fetch into data/standards/
    python3 -I scripts/fetch_asvs.py --verify-ids  # fetch, derive the id list, compare it
    python3 -I scripts/fetch_asvs.py --write-ids   # fetch and (re)write the committed id list

Env: ``ASVS_RETRY_DELAY_SECONDS`` (the first retry's delay, default 2). Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
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
DEFAULT_DEST: Final = REPO_ROOT / "data" / "standards"
"""Under ``data/``, which git ignores (``data/*``) and the PII scan skips: never committed."""
IDS_PATH: Final = REPO_ROOT / "docs" / "security" / "asvs-5.0.0-l2-ids.txt"
"""The committed id list (ids and levels only)."""
DEFAULT_TIMEOUT_SECONDS: Final = 120.0
CHUNK_SIZE: Final = 1 << 16
ATTEMPTS: Final = 5
DEFAULT_RETRY_DELAY_SECONDS: Final = 2.0
FIRST_SERVER_ERROR: Final = 500

LICENSE: Final = "CC-BY-SA-4.0"
"""The standard's licence (its ``LICENSE.md``, read 2026-11-20): share-alike, so no text is
committed, only ids, our statuses, our notes and our evidence (C274.2)."""
RELEASED: Final = "2025-05-30"
"""The ``v5.0.0_release`` GitHub release's publication date (its release metadata, read
2026-11-20)."""
TAG: Final = "v5.0.0_release"
TAG_COMMIT: Final = "5cf9b032440be53ce345ab3c130fda46ba1ce7a2"
VERSION: Final = "5.0.0"
LEVELS: Final = ("1", "2")
"""Level 2 holds every requirement at L1 and L2."""

_REQUIREMENT_ID: Final = re.compile(r"V([1-9][0-9]{0,2})\.([1-9][0-9]{0,2})\.([1-9][0-9]{0,2})")
_LIST_LINE: Final = re.compile(r"(v5\.0\.0-[1-9][0-9]*\.[1-9][0-9]*\.[1-9][0-9]*) ([12])")


@dataclass(frozen=True, slots=True)
class Pin:
    """One pinned download."""

    version: str
    url: str
    sha256: str
    size: int
    filename: str


PIN: Final = Pin(
    version=VERSION,
    url=(
        "https://github.com/OWASP/ASVS/releases/download/v5.0.0_release/"
        "OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json"
    ),
    sha256="8201b20eec2908c3380ac600c91c8ba746346fbb808859366abb232027532311",
    size=162_870,
    filename="OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json",
)

Opener = Callable[[str, float], IO[bytes]]
"""``opener(url, timeout_seconds)`` returns a readable, closeable response."""


class FetchError(Exception):
    """The download failed or did not match its pin."""


class ExportError(Exception):
    """The export does not have the shape this script reads."""


class _TransientError(Exception):
    """A failure a later attempt may not meet: a connection failure, a timeout, a 5xx answer."""


def default_opener(url: str, timeout: float) -> IO[bytes]:
    """Open ``url`` over https, following redirects, with a generic client name."""
    request = urllib.request.Request(url, headers={"User-Agent": "fetch-asvs"})  # noqa: S310
    response: IO[bytes] = urllib.request.urlopen(request, timeout=timeout)  # noqa: S310
    return response


def export_path(pinned: Pin, dest: Path) -> Path:
    """Where the pinned export lives under ``dest``."""
    return dest / pinned.filename


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


def fetch(
    pinned: Pin,
    dest: Path,
    *,
    opener: Opener = default_opener,
    retry_delay: float = DEFAULT_RETRY_DELAY_SECONDS,
    sleep: Callable[[float], object] = time.sleep,
) -> str:
    """Fetch ``pinned`` into ``dest``: ``present`` when it is already there, else ``downloaded``.

    Raises :class:`FetchError` when the download fails or its size or digest differs from the pin;
    nothing is left behind then.
    """
    if not pinned.url.startswith("https://"):
        raise FetchError("the pinned URL must be https")
    target = export_path(pinned, dest)
    if _matches(pinned, target):
        return "present"
    delay = retry_delay
    for attempt in range(1, ATTEMPTS + 1):
        try:
            _download(pinned, dest, target, opener)
            return "downloaded"
        except _TransientError as exc:
            if attempt == ATTEMPTS:
                raise FetchError(f"download failed on all {ATTEMPTS} attempts: {exc}") from exc
            sleep(delay)
            delay *= 2
    raise AssertionError("unreachable")  # pragma: no cover


def _download(pinned: Pin, dest: Path, target: Path, opener: Opener) -> None:
    """One attempt: writes ``target`` only when the size and digest match the pin."""
    dest.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    received = 0
    handle, name = tempfile.mkstemp(prefix=".asvs-", suffix=".part", dir=dest)
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


def ids_from_export(data: bytes) -> list[tuple[str, str]]:
    """The Level 2 ids and their levels, in the export's order, as ``v5.0.0-<c>.<s>.<r>``.

    Reads only each requirement's ``req_id`` and ``L``; never its text. Raises
    :class:`ExportError` on a shape this script does not know, a malformed id or a repeated one.
    """
    try:
        document = json.loads(data)
    except ValueError as exc:
        raise ExportError("the export is not JSON") from exc
    requirements = document.get("requirements") if isinstance(document, dict) else None
    if not isinstance(requirements, list):
        raise ExportError("the export has no requirements array")
    ids: list[tuple[str, str]] = []
    seen: set[str] = set()
    for requirement in requirements:
        if not isinstance(requirement, dict):
            raise ExportError("a requirement is not an object")
        level = str(requirement.get("L", ""))
        if level not in {"1", "2", "3"}:
            raise ExportError(f"a requirement has the level {level!r}")
        if level not in LEVELS:
            continue
        match = _REQUIREMENT_ID.fullmatch(str(requirement.get("req_id", "")))
        if match is None:
            raise ExportError(f"a requirement id is malformed: {requirement.get('req_id')!r}")
        listed = f"v{VERSION}-{match.group(1)}.{match.group(2)}.{match.group(3)}"
        if listed in seen:
            raise ExportError(f"a requirement id is repeated: {listed}")
        seen.add(listed)
        ids.append((listed, level))
    return ids


def render_ids(ids: Sequence[tuple[str, str]]) -> str:
    """The committed list's text: a header, then ``<id> <level>`` per line, in export order."""
    at = {level: sum(1 for _, listed in ids if listed == level) for level in LEVELS}
    header = [
        f"# OWASP ASVS {VERSION}, Level 2: the ids of the requirements at levels 1 and 2"
        f" ({len(ids)}: {at['1']} at L1, {at['2']} at L2), in the export's order.",
        f"# Ids and levels only: the standard's texts are {LICENSE}"
        " and are never committed (C274.2).",
        "# Written by `python3 -I scripts/fetch_asvs.py --write-ids` from the pinned export;"
        " `--verify-ids` checks it.",
        "# <id> <level>",
    ]
    return "\n".join([*header, *(f"{listed} {level}" for listed, level in ids)]) + "\n"


def parse_ids(text: str) -> list[tuple[str, str]]:
    """The committed list's ids and levels; comment lines are skipped. Raises on a bad line."""
    ids: list[tuple[str, str]] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if line.startswith("#") or line == "":
            continue
        match = _LIST_LINE.fullmatch(line)
        if match is None:
            raise ExportError(f"line {number} of the id list is not '<id> <level>': {line!r}")
        ids.append((match.group(1), match.group(2)))
    return ids


def compare_ids(
    derived: Sequence[tuple[str, str]], committed: Sequence[tuple[str, str]]
) -> list[str]:
    """How the export's list and the committed one differ, in words; nothing when they are equal."""
    if list(derived) == list(committed):
        return []
    derived_set, committed_set = set(derived), set(committed)
    problems = [
        f"missing from the committed list: {i} L{lv}"
        for i, lv in derived
        if (i, lv) not in committed_set
    ]
    problems += [
        f"not in the export: {i} L{lv}" for i, lv in committed if (i, lv) not in derived_set
    ]
    return problems or ["the same ids in another order"]


def retry_delay_from_env() -> float:
    """``ASVS_RETRY_DELAY_SECONDS``, or the default."""
    raw = os.environ.get("ASVS_RETRY_DELAY_SECONDS", "")
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
    parser.add_argument("--ids", type=Path, default=IDS_PATH, help="the committed id list")
    action = parser.add_mutually_exclusive_group()
    action.add_argument(
        "--verify-ids", action="store_true", help="compare the committed list with the export"
    )
    action.add_argument(
        "--write-ids", action="store_true", help="write the committed list from the export"
    )
    args = parser.parse_args(argv)
    dest: Path = args.dest
    ids_path: Path = args.ids
    try:
        status = fetch(pinned, dest, opener=opener, retry_delay=retry_delay_from_env())
        derived = ids_from_export(export_path(pinned, dest).read_bytes())
    except (FetchError, ExportError) as exc:
        print(f"ASVS {pinned.version}: FAILED: {exc}", file=sys.stderr)
        return 1
    print(
        f"ASVS {pinned.version}: {status} {export_path(pinned, dest)} ({LICENSE}, never committed)"
    )
    if args.write_ids:
        ids_path.parent.mkdir(parents=True, exist_ok=True)
        ids_path.write_text(render_ids(derived), encoding="utf-8")
        print(f"ASVS {pinned.version}: wrote {len(derived)} ids to {ids_path}")
    elif args.verify_ids:
        try:
            committed = parse_ids(ids_path.read_text(encoding="utf-8"))
        except (OSError, ExportError) as exc:
            print(f"ASVS {pinned.version}: FAILED: {exc}", file=sys.stderr)
            return 1
        problems = compare_ids(derived, committed)
        for problem in problems:
            print(f"ASVS {pinned.version}: {problem}", file=sys.stderr)
        if problems:
            return 1
        print(f"ASVS {pinned.version}: the committed list matches the export ({len(derived)} ids)")
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by hand and by the Validation
    raise SystemExit(main())
