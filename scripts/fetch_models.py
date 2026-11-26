#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Download the model weights listed in ``models/manifest.json``.

Every entry pins an https URL, a SHA-256 digest, a byte size and an SPDX license. A file is
written only after its digest matches; a mismatch is refused and nothing is left behind.
Files already present with the right digest are skipped, so the script is safe to rerun.
Only permissively licensed weights are accepted.

Usage::

    python3 scripts/fetch_models.py                # fetch everything into models/
    python3 scripts/fetch_models.py --only face_detection_yunet
    python3 scripts/fetch_models.py --dest /models # e.g. a container volume

Standard library only, so it runs without the vision service's virtualenv.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, fields
from http.client import HTTPMessage
from pathlib import Path
from types import TracebackType
from typing import IO, Any, Final, Literal, Protocol, Self, override

REPO_ROOT: Final = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST: Final = REPO_ROOT / "models" / "manifest.json"
DEFAULT_TIMEOUT_SECONDS: Final = 60.0
CHUNK_SIZE: Final = 1 << 16

PERMISSIVE_LICENSES: Final = frozenset(
    {
        "MIT",
        "Apache-2.0",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "ISC",
        "PostgreSQL",
        "CC0-1.0",
        "CC-BY-4.0",
    }
)
"""SPDX identifiers allowed for model weights (see CLAUDE.md, rule 4)."""

_REQUIRED_FIELDS: Final = (
    "name",
    "filename",
    "url",
    "sha256",
    "size",
    "license",
    "license_url",
    "source_repo",
)
_URL_FIELDS: Final = ("url", "license_url", "source_repo")
_TEXT_FIELDS: Final = ("upstream", "description", "notes")
_NAME_RE: Final = re.compile(r"^[a-z0-9][a-z0-9_]*$")
_FILENAME_RE: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")

FetchStatus = Literal["present", "downloaded"]


class FetchError(Exception):
    """A model could not be fetched."""


class ManifestError(FetchError):
    """The manifest is missing, malformed or violates policy."""


class ChecksumMismatchError(FetchError):
    """The downloaded bytes do not match the pinned SHA-256."""


class DownloadTooLargeError(FetchError):
    """The server sent more bytes than the manifest declares."""


class Response(Protocol):
    def read(self, size: int = -1, /) -> bytes: ...

    def __enter__(self) -> Self: ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> object: ...


Opener = Callable[[str, float], Response]
"""``opener(url, timeout_seconds)`` returns a readable, closeable response."""


@dataclass(frozen=True, slots=True)
class ModelEntry:
    """One manifest entry. :meth:`from_dict` validates; the constructor trusts its caller."""

    name: str
    filename: str
    url: str
    sha256: str
    size: int
    license: str
    license_url: str
    source_repo: str
    upstream: str = ""
    description: str = ""
    notes: str = ""

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> ModelEntry:
        _check_keys(raw, known={f.name for f in fields(cls)})
        _check_identity(raw)
        _check_provenance(raw)
        return cls(**dict(raw))


def _check_keys(raw: Mapping[str, Any], known: set[str]) -> None:
    unknown = sorted(set(raw) - known)
    if unknown:
        raise ManifestError(f"unknown field(s): {', '.join(unknown)}")
    for required in _REQUIRED_FIELDS:
        if required not in raw:
            raise ManifestError(f"missing field {required!r}")


def _check_identity(raw: Mapping[str, Any]) -> None:
    name, filename, sha256, size = raw["name"], raw["filename"], raw["sha256"], raw["size"]
    if not isinstance(name, str) or not _NAME_RE.fullmatch(name):
        raise ManifestError("name must be lowercase letters, digits and underscores")
    if not isinstance(filename, str) or not _FILENAME_RE.fullmatch(filename):
        raise ManifestError(f"filename {filename!r} must be a plain file name")
    if not isinstance(sha256, str) or not _SHA256_RE.fullmatch(sha256):
        raise ManifestError("sha256 must be 64 lowercase hex characters")
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise ManifestError("size must be a positive integer (bytes)")


def _check_provenance(raw: Mapping[str, Any]) -> None:
    spdx = raw["license"]
    if spdx not in PERMISSIVE_LICENSES:
        allowed = ", ".join(sorted(PERMISSIVE_LICENSES))
        raise ManifestError(f"license {spdx!r} is not permissive; allowed: {allowed}")
    for key in _URL_FIELDS:
        value = raw[key]
        if not isinstance(value, str) or urllib.parse.urlsplit(value).scheme != "https":
            raise ManifestError(f"{key} must be an https URL")
    for key in _TEXT_FIELDS:
        if not isinstance(raw.get(key, ""), str):
            raise ManifestError(f"{key} must be a string")


def load_manifest(path: Path) -> list[ModelEntry]:
    """Parse and validate the manifest at ``path``."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ManifestError(f"cannot read manifest {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ManifestError(f"manifest {path} is not valid JSON: {exc}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("models"), list):
        raise ManifestError(f"manifest {path} must be an object with a 'models' list")

    entries: list[ModelEntry] = []
    names: set[str] = set()
    filenames: set[str] = set()
    for index, raw in enumerate(document["models"]):
        if not isinstance(raw, dict):
            raise ManifestError(f"model entry #{index} must be an object")
        try:
            entry = ModelEntry.from_dict(raw)
        except ManifestError as exc:
            raise ManifestError(f"model entry #{index} ({raw.get('name', '?')}): {exc}") from exc
        if entry.name in names:
            raise ManifestError(f"duplicate model name {entry.name!r}")
        if entry.filename in filenames:
            raise ManifestError(f"duplicate filename {entry.filename!r}")
        names.add(entry.name)
        filenames.add(entry.filename)
        entries.append(entry)
    return entries


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


class _HttpsOnlyRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow redirects only to https URLs, so a pinned https URL cannot be downgraded."""

    @override
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> urllib.request.Request | None:
        if urllib.parse.urlsplit(newurl).scheme != "https":
            fp.close()
            raise FetchError(f"refusing redirect to non-https URL {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def default_opener(url: str, timeout: float) -> Response:
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler())
    response: Response = opener.open(url, timeout=timeout)
    return response


def fetch_model(
    entry: ModelEntry,
    dest_dir: Path,
    *,
    opener: Opener = default_opener,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> FetchStatus:
    """Ensure ``dest_dir / entry.filename`` exists with the pinned digest.

    Returns ``"present"`` if a verified copy was already there, ``"downloaded"`` otherwise.
    The download goes to a temporary file in ``dest_dir`` and is moved into place only after
    its size and digest check out, so a failed or tampered download never replaces a file.
    """
    target = dest_dir / entry.filename
    if target.is_file() and sha256_file(target) == entry.sha256:
        return "present"

    dest_dir.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{entry.filename}.", suffix=".part", dir=dest_dir)
    tmp = Path(tmp_name)
    try:
        digest = hashlib.sha256()
        received = 0
        try:
            with os.fdopen(fd, "wb") as out, opener(entry.url, timeout) as response:
                while chunk := response.read(CHUNK_SIZE):
                    received += len(chunk)
                    if received > entry.size:
                        raise DownloadTooLargeError(
                            f"{entry.name}: server sent more than the declared {entry.size} bytes"
                        )
                    digest.update(chunk)
                    out.write(chunk)
        except FetchError:
            raise
        except urllib.error.HTTPError as exc:
            exc.close()
            raise FetchError(f"{entry.name}: HTTP {exc.code} {exc.reason} for {entry.url}") from exc
        except (OSError, http.client.HTTPException) as exc:
            raise FetchError(f"{entry.name}: download from {entry.url} failed: {exc}") from exc

        actual = digest.hexdigest()
        if actual != entry.sha256:
            raise ChecksumMismatchError(
                f"{entry.name}: sha256 mismatch (expected {entry.sha256}, got {actual}); refusing"
            )
        tmp.chmod(0o644)  # mkstemp creates 0600; weights are public and must be mount-readable
        tmp.replace(target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return "downloaded"


def main(argv: Sequence[str] | None = None, *, opener: Opener = default_opener) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--dest", type=Path, default=None, help="download directory (default: next to manifest)"
    )
    parser.add_argument(
        "--only", action="append", metavar="NAME", help="fetch only this model (repeatable)"
    )
    args = parser.parse_args(argv)

    try:
        entries = load_manifest(args.manifest)
    except ManifestError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.only:
        unknown = sorted(set(args.only) - {entry.name for entry in entries})
        if unknown:
            print(f"error: not in manifest: {', '.join(unknown)}", file=sys.stderr)
            return 2
        entries = [entry for entry in entries if entry.name in args.only]

    dest: Path = args.dest if args.dest is not None else args.manifest.parent
    failures = 0
    for entry in entries:
        try:
            status = fetch_model(entry, dest, opener=opener)
        except FetchError as exc:
            failures += 1
            print(f"{entry.name}: FAILED: {exc}", file=sys.stderr)
            continue
        print(f"{entry.name}: {status} {dest / entry.filename} ({entry.license})")
    return 1 if failures else 0


if __name__ == "__main__":  # pragma: no cover - exercised by the subprocess smoke test
    raise SystemExit(main())
