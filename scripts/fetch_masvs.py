#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Download the pinned OWASP MASVS v2.1.0 export and check the committed control id list (C275).

The checklist ``docs/security/masvs-2.1.0.csv`` holds one row per MASVS v2.1.0 control (24 in eight
groups) for ``openverify-sdk``, ``openverify-nfc`` and ``openverify-face``, with our statuses,
notes and evidence only. The standard is CC-BY-SA-4.0 (share-alike; ``License.md`` at the
``v2.1.0`` tag), so its CycloneDX export is fetched into a git-ignored directory and never
committed or shipped; only the control ids and their groups are committed, in
``docs/security/masvs-2.1.0-ids.txt``, written from the export by this script, never typed by
hand (11E rule 15).

The pin holds the release asset's https URL, SHA-256 and byte size; the file is written only after
its digest matches, and a file already present with the right digest is kept, so the script is safe
to rerun. A failed connection, a timeout or a 5xx answer is retried (at most five attempts, the
delay doubling); a 4xx answer and a size or digest that differs from the pin fail at once.

Usage::

    python3 -I scripts/fetch_masvs.py               # fetch into data/standards/
    python3 -I scripts/fetch_masvs.py --verify-ids  # fetch, derive the id list, compare it
    python3 -I scripts/fetch_masvs.py --write-ids   # fetch and (re)write the committed id list

Env: ``MASVS_RETRY_DELAY_SECONDS`` (the first retry's delay, default 2). Standard library only.
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
IDS_PATH: Final = REPO_ROOT / "docs" / "security" / "masvs-2.1.0-ids.txt"
"""The committed id list (control ids and their groups only)."""
DEFAULT_TIMEOUT_SECONDS: Final = 120.0
CHUNK_SIZE: Final = 1 << 16
ATTEMPTS: Final = 5
DEFAULT_RETRY_DELAY_SECONDS: Final = 2.0
FIRST_SERVER_ERROR: Final = 500

LICENSE: Final = "CC-BY-SA-4.0"
"""The standard's licence (``License.md`` at the ``v2.1.0`` tag, read 2026-11-20): share-alike, so
no text is committed, only ids, our statuses, our notes and our evidence (C275.2)."""
RELEASED: Final = "2024-01-18"
"""The ``v2.1.0`` GitHub release's publication date (its release metadata, read 2026-11-20)."""
TAG: Final = "v2.1.0"
TAG_COMMIT: Final = "8e133d09f4140518ed04cc254b18be9ff4990ffc"
VERSION: Final = "2.1.0"
STANDARD_REF: Final = "MASVS-v2.1.0"
"""The ``bom-ref`` of the one standard the export defines."""
GROUPS: Final = (
    "MASVS-STORAGE",
    "MASVS-CRYPTO",
    "MASVS-AUTH",
    "MASVS-NETWORK",
    "MASVS-PLATFORM",
    "MASVS-CODE",
    "MASVS-RESILIENCE",
    "MASVS-PRIVACY",
)
"""The eight groups of v2.1.0, in the standard's order (C275.1)."""

_CONTROL_ID: Final = re.compile(r"(MASVS-[A-Z]+)-([1-9][0-9]?)")
_LIST_LINE: Final = re.compile(r"(MASVS-[A-Z]+-[1-9][0-9]?) (MASVS-[A-Z]+)")


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
    url="https://github.com/OWASP/masvs/releases/download/v2.1.0/OWASP_MASVS.cdx.json",
    sha256="abedfcdf6cbd38ffa30a2ae6fc9f98ad7cddff59f0ad35932117559a2a27e0ae",
    size=28_264,
    filename="OWASP_MASVS-2.1.0.cdx.json",
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
    request = urllib.request.Request(url, headers={"User-Agent": "fetch-masvs"})  # noqa: S310
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
    handle, name = tempfile.mkstemp(prefix=".masvs-", suffix=".part", dir=dest)
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
    """The control ids and their groups, in the export's order.

    Reads only each requirement's ``identifier`` and ``parent``; never its title or text. Raises
    :class:`ExportError` on a shape this script does not know, a malformed or repeated id, a
    control whose group is not its id's, or a group list that is not :data:`GROUPS`.
    """
    try:
        document = json.loads(data)
    except ValueError as exc:
        raise ExportError("the export is not JSON") from exc
    definitions = document.get("definitions") if isinstance(document, dict) else None
    standards = definitions.get("standards") if isinstance(definitions, dict) else None
    if not isinstance(standards, list) or len(standards) != 1 or not isinstance(standards[0], dict):
        raise ExportError("the export does not define exactly one standard")
    standard = standards[0]
    if standard.get("bom-ref") != STANDARD_REF:
        raise ExportError(
            f"the export's standard is {standard.get('bom-ref')!r}, not {STANDARD_REF}"
        )
    requirements = standard.get("requirements")
    if not isinstance(requirements, list):
        raise ExportError("the standard has no requirements array")
    groups: list[str] = []
    ids: list[tuple[str, str]] = []
    seen: set[str] = set()
    for requirement in requirements:
        if not isinstance(requirement, dict):
            raise ExportError("a requirement is not an object")
        identifier = str(requirement.get("identifier", ""))
        parent = requirement.get("parent")
        if parent is None:
            groups.append(identifier)
            continue
        match = _CONTROL_ID.fullmatch(identifier)
        if match is None or match.group(1) != parent:
            raise ExportError(f"a control id is malformed or outside its group: {identifier!r}")
        if identifier in seen:
            raise ExportError(f"a control id is repeated: {identifier}")
        seen.add(identifier)
        ids.append((identifier, str(parent)))
    if tuple(groups) != GROUPS:
        raise ExportError(f"the groups are {groups}, not v{VERSION}'s eight")
    return ids


def render_ids(ids: Sequence[tuple[str, str]]) -> str:
    """The committed list's text: a header, then ``<id> <group>`` per line, in export order."""
    header = [
        f"# OWASP MASVS v{VERSION}: the ids of the {len(ids)} controls and their groups"
        f" ({len({group for _, group in ids})} groups), in the export's order.",
        f"# Ids only: the standard's texts are {LICENSE} and are never committed (C275.2).",
        "# Written by `python3 -I scripts/fetch_masvs.py --write-ids` from the pinned export;"
        " `--verify-ids` checks it.",
        "# <id> <group>",
    ]
    return "\n".join([*header, *(f"{listed} {group}" for listed, group in ids)]) + "\n"


def parse_ids(text: str) -> list[tuple[str, str]]:
    """The committed list's ids and groups; comment lines are skipped. Raises on a bad line."""
    ids: list[tuple[str, str]] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if line.startswith("#") or line == "":
            continue
        match = _LIST_LINE.fullmatch(line)
        if match is None:
            raise ExportError(f"line {number} of the id list is not '<id> <group>': {line!r}")
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
        f"missing from the committed list: {i} {g}"
        for i, g in derived
        if (i, g) not in committed_set
    ]
    problems += [f"not in the export: {i} {g}" for i, g in committed if (i, g) not in derived_set]
    return problems or ["the same ids in another order"]


def retry_delay_from_env() -> float:
    """``MASVS_RETRY_DELAY_SECONDS``, or the default."""
    raw = os.environ.get("MASVS_RETRY_DELAY_SECONDS", "")
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
        print(f"MASVS {pinned.version}: FAILED: {exc}", file=sys.stderr)
        return 1
    print(
        f"MASVS {pinned.version}: {status} {export_path(pinned, dest)} ({LICENSE}, never committed)"
    )
    if args.write_ids:
        ids_path.parent.mkdir(parents=True, exist_ok=True)
        ids_path.write_text(render_ids(derived), encoding="utf-8")
        print(f"MASVS {pinned.version}: wrote {len(derived)} ids to {ids_path}")
    elif args.verify_ids:
        try:
            committed = parse_ids(ids_path.read_text(encoding="utf-8"))
        except (OSError, ExportError) as exc:
            print(f"MASVS {pinned.version}: FAILED: {exc}", file=sys.stderr)
            return 1
        problems = compare_ids(derived, committed)
        for problem in problems:
            print(f"MASVS {pinned.version}: {problem}", file=sys.stderr)
        if problems:
            return 1
        print(f"MASVS {pinned.version}: the committed list matches the export ({len(derived)} ids)")
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by hand and by the Validation
    raise SystemExit(main())
