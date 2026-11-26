#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Download the pinned public-domain fixtures: faces and federal forms, or the calibration set.

Two manifests, both committed (the downloads never are):

- ``fixtures/manifest.json`` (the default): the few faces behind the vision service's real-model
  tests and the synthetic ID, selfie and fake-camera generators of the e2e flow. Each entry pins an
  https URL, a SHA-256 digest and a byte size, and records its source page, author and license
  (any ``{{PD-USGov...}}`` template), and optionally the Commons SHA-1. Into ``fixtures/faces/``.
  Its ``forms`` list (Phase 5, C60.7) pins the blank US federal forms of the held-out document set
  (a W-2, a 1099-NEC and a 1040): public domain under 17 U.S.C. 105, fetched only from a federal
  agency's own host (:data:`FORM_HOSTS`) at a prior-year URL whose bytes no longer change, each
  with the pages the held-out set takes. Into ``fixtures/generated/federal-forms/`` (gitignored;
  ``--forms-dest``), where ``services/vision/tools/make_synthetic_fixtures.py`` fills them with
  synthetic values.
- ``fixtures/calibration-manifest.json`` (``--calibration``, C49.1): the face-match calibration set
  of Workflow 4B, Commons ``PD-USGov-NASA``, ``-DOS`` and ``-Military*`` official portraits only,
  under pseudonymous identities. Into ``fixtures/faces/calibration/``. Never fetched in CI.

A file is written only after its size and digest match; a mismatch is refused and nothing is left
behind. Files already present with the right digest are skipped, so the script is safe to rerun.
Both directories are gitignored: never commit the images.

**Etiquette** (Wikimedia's User-Agent and robot policies, research §10.2): a descriptive
User-Agent; the starts of two requests at least :data:`MIN_REQUEST_INTERVAL_SECONDS` apart; at
most :data:`MAX_CONNECTIONS` requests in flight (``--jobs``); downloads under
:data:`MAX_DOWNLOAD_BITS_PER_SECOND` on average, in every mode: each one's bytes hold the next
request back, and the holds of downloads in flight together add up; a 429 or 503 answer is
retried after its ``Retry-After`` (seconds or an HTTP date), else after a doubling backoff, at
most :data:`MAX_ATTEMPTS` times, and never after a wait over :data:`MAX_RETRY_AFTER_SECONDS`.

**Re-uploaded files.** A Commons original URL always serves the file's latest revision, so a
re-upload (a crop, a colour fix) changes the bytes behind a pinned URL. When the bytes do not
match, the script asks the Commons API for the file's revisions, picks the superseded ones whose
SHA-1 equals the pinned ``sha1`` (else whose size equals the pinned size), and fetches them from
their archive URL; one is accepted only if its SHA-256 equals the pin. Otherwise the mismatch
stands and the run fails.

**Calibration mode** tolerates up to ``--max-missing`` deleted files (HTTP 404 or 410; Commons
deletes files after licence reviews) and reports how many images it used; any digest mismatch,
or any other failure, fails the run.

The calibration manifest::

    {"schema_version": 1,
     "description": "...", "purpose": "...", "takedown": "how to remove a person",
     "identities": [
       {"id": "p0001", "sex": "female" | "male" | "unknown",
        "images": [
          {"id": "p0001-1",
           "url": "https://upload.wikimedia.org/wikipedia/commons/a/ab/<name>.jpg",
           "source_page": "https://commons.wikimedia.org/wiki/File:<name>.jpg",
           "revision_id": <the file page's revision id>,
           "sha256": "<64 hex>", "sha1": "<Commons' 40 hex>", "size": <bytes>,
           "license_template": "PD-USGov-NASA",
           "year": 2014 | null,                       # optional: the photo's year
           "review": {"decision": "keep"}             # optional, pinned after the tails review
                   | {"decision": "exclude",
                      "reason": "different_person_per_metadata" | "misattribution"}}]}]}

No names: identities are pseudonymous, and no field but the file's own URL and page names anyone.
Each image is saved as ``<id><extension>`` (``p0001-1.jpg``).

Usage::

    python3 scripts/fetch_fixtures.py                    # every test face and federal form
    python3 scripts/fetch_fixtures.py --only person_b_selfie
    python3 scripts/fetch_fixtures.py --only irs_w2_2025 --forms-dest /tmp/forms
    python3 scripts/fetch_fixtures.py --dest /tmp/faces
    python3 scripts/fetch_fixtures.py --calibration      # the C49 set
    python3 scripts/fetch_fixtures.py --calibration --max-missing 20 --jobs 1
    python3 scripts/fetch_fixtures.py --harvest-calibration   # rebuild the C49 manifest

``--harvest-calibration`` builds ``fixtures/calibration-manifest.json`` from the Commons and
Wikidata APIs and downloads its images (the rules are in the harvest section below): one person
per file, named by structured-data depicts or a per-person category, with every source agreeing;
pinned from the downloaded bytes; pseudonymous. Every API request carries ``maxlag``, and the
downloads keep under Wikimedia's 25 Mbps.

Standard library only, so it runs without the vision service's virtualenv.
"""

from __future__ import annotations

import argparse
import email.utils
import hashlib
import http.client
import json
import os
import random
import re
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, fields
from datetime import UTC, date, datetime
from http.client import HTTPMessage
from pathlib import Path, PurePosixPath
from types import TracebackType
from typing import IO, Any, Final, Literal, Protocol, Self, override

REPO_ROOT: Final = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST: Final = REPO_ROOT / "fixtures" / "manifest.json"
DEFAULT_CALIBRATION_MANIFEST: Final = REPO_ROOT / "fixtures" / "calibration-manifest.json"
DEFAULT_TIMEOUT_SECONDS: Final = 60.0
CHUNK_SIZE: Final = 1 << 16
USER_AGENT: Final = "OpenVerify-fetch-fixtures/1.0 (+https://github.com/hnalpha323/openverify)"
"""Wikimedia asks automated clients for a descriptive User-Agent with contact information."""

MIN_REQUEST_INTERVAL_SECONDS: Final = 1.0
"""Wikimedia's robot policy: at least this long between the starts of two requests."""

MAX_CONNECTIONS: Final = 2
"""Wikimedia's robot policy: at most this many requests in flight at once."""

MAX_DOWNLOAD_BITS_PER_SECOND: Final = 25_000_000
"""Wikimedia's robot policy for upload.wikimedia.org: at most 25 Mbps (research §10.2)."""

MAX_ATTEMPTS: Final = 5
"""Tries of one URL answered 429 or 503, the first included."""

FIRST_BACKOFF_SECONDS: Final = 2.0
MAX_BACKOFF_SECONDS: Final = 60.0
"""Without ``Retry-After``, the n-th retry waits ``2 ** n`` seconds, at most a minute."""

MAX_RETRY_AFTER_SECONDS: Final = 300.0
"""A server that asks for a longer wait fails the file instead of stalling the run."""

RETRYABLE_STATUSES: Final = frozenset({429, 503})
GONE_STATUSES: Final = frozenset({404, 410})

DEFAULT_MAX_MISSING: Final = 10
"""Calibration mode: deleted files tolerated before the run fails (C49.1, research §10.2)."""

LICENSE: Final = "public-domain"
_TEMPLATE_WORDS: Final = r"[A-Za-z0-9]+(?: [A-Za-z0-9]+)*"
_TEMPLATE_RE: Final = re.compile(rf"^PD-USGov(?:-{_TEMPLATE_WORDS})*$")
"""Commons license templates for works of the US federal government (e.g. ``PD-USGov-NASA``).
Words may be separated by single spaces: ``PD-USGov-Military-Air Force``."""

_CALIBRATION_TEMPLATE_RE: Final = re.compile(
    rf"^PD-USGov-(?:NASA|DOS|Military(?:-{_TEMPLATE_WORDS})*)$"
)
"""C49.1: NASA, Department of State and Armed Forces portraits only (Congress is left out)."""

COMMONS_UPLOAD: Final = "https://upload.wikimedia.org/wikipedia/commons/"
COMMONS_API: Final = "https://commons.wikimedia.org/w/api.php"
COMMONS_FILE_PAGE: Final = "https://commons.wikimedia.org/wiki/File:"
MAX_API_RESPONSE_BYTES: Final = 1 << 20
MAX_ARCHIVE_CANDIDATES: Final = 3
"""Archived revisions tried for one re-uploaded file."""

ROLES: Final = frozenset({"id_portrait", "selfie"})

_REQUIRED_FIELDS: Final = (
    "name",
    "person",
    "role",
    "filename",
    "source_page",
    "url",
    "sha256",
    "size",
    "license",
    "license_template",
    "author",
    "face_box",
)
_URL_FIELDS: Final = ("url", "source_page")
_OPTIONAL_TEXT_FIELDS: Final = ("subject", "notes")
_NAME_RE: Final = re.compile(r"^[a-z0-9][a-z0-9_]*$")
_PERSON_RE: Final = re.compile(r"^[A-Z]$")
_FILENAME_RE: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_SHA256_RE: Final = re.compile(r"^[0-9a-f]{64}$")
_SHA1_RE: Final = re.compile(r"^[0-9a-f]{40}$")
_COMMONS_PATH_RE: Final = re.compile(r"^/wikipedia/commons/([0-9a-f])/([0-9a-f]{2})/([^/]+)$")
_ARCHIVENAME_RE: Final = re.compile(r"^(\d{14})!(.+)$")

FetchStatus = Literal["present", "downloaded", "archived"]


class FetchError(Exception):
    """A fixture could not be fetched."""


class ManifestError(FetchError):
    """The manifest is missing, malformed or violates policy."""


class ChecksumMismatchError(FetchError):
    """The downloaded bytes do not match the pinned SHA-256."""


class DownloadTooLargeError(FetchError):
    """The server sent more bytes than the manifest declares."""


class NotFoundError(FetchError):
    """The server answered 404 or 410: the file was deleted (calibration mode tolerates a few)."""


class RateLimitedError(FetchError):
    """The server kept answering 429 or 503, or asked to wait longer than we will."""


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

Clock = Callable[[], float]
Sleep = Callable[[float], None]


class Pinned(Protocol):
    """What :func:`fetch_fixture` needs of a manifest entry."""

    @property
    def name(self) -> str: ...

    @property
    def filename(self) -> str: ...

    @property
    def url(self) -> str: ...

    @property
    def sha256(self) -> str: ...

    @property
    def sha1(self) -> str:
        """Commons' SHA-1 of the file, or ``""`` when not pinned."""
        ...

    @property
    def size(self) -> int: ...

    @property
    def license_template(self) -> str: ...


# --- fixtures/manifest.json -----------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class FaceFixture:
    """One manifest entry. :meth:`from_dict` validates; the constructor trusts its caller."""

    name: str
    person: str
    role: str
    filename: str
    source_page: str
    url: str
    sha256: str
    size: int
    license: str
    license_template: str
    author: str
    face_box: tuple[int, int, int, int]
    """Approximate face box ``(x, y, width, height)`` in source pixels, used to frame crops."""
    subject: str = ""
    notes: str = ""
    sha1: str = ""
    """Commons' SHA-1 of the file (``""`` when not pinned): it finds an archived revision."""

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> FaceFixture:
        _check_keys(raw, known={f.name for f in fields(cls)}, required=_REQUIRED_FIELDS)
        _check_identity(raw)
        _check_provenance(raw)
        return cls(**{**raw, "face_box": _face_box(raw["face_box"])})


def _check_keys(raw: Mapping[str, Any], known: set[str], required: Sequence[str]) -> None:
    unknown = sorted(set(raw) - known)
    if unknown:
        raise ManifestError(f"unknown field(s): {', '.join(unknown)}")
    for key in required:
        if key not in raw:
            raise ManifestError(f"missing field {key!r}")


def _check_pattern(raw: Mapping[str, Any], key: str, pattern: re.Pattern[str], meaning: str) -> str:
    value = raw[key]
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ManifestError(f"{key} must be {meaning}, got {value!r}")
    return value


def _positive_int(raw: Mapping[str, Any], key: str, meaning: str) -> int:
    value = raw[key]
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ManifestError(f"{key} must be a positive integer ({meaning})")
    return value


def _check_identity(raw: Mapping[str, Any]) -> None:
    checks: tuple[tuple[str, re.Pattern[str], str], ...] = (
        ("name", _NAME_RE, "lowercase letters, digits and underscores"),
        ("person", _PERSON_RE, "one uppercase letter"),
        ("filename", _FILENAME_RE, "a plain file name"),
        ("sha256", _SHA256_RE, "64 lowercase hex characters"),
    )
    for key, pattern, meaning in checks:
        _check_pattern(raw, key, pattern, meaning)
    if "sha1" in raw:
        _check_pattern(raw, "sha1", _SHA1_RE, "40 lowercase hex characters (Commons' SHA-1)")
    if raw["role"] not in ROLES:
        raise ManifestError(f"role must be one of {', '.join(sorted(ROLES))}")
    _positive_int(raw, "size", "bytes")


def _check_provenance(raw: Mapping[str, Any]) -> None:
    if raw["license"] != LICENSE:
        raise ManifestError(f"license must be {LICENSE!r}; only public-domain faces are allowed")
    template = raw["license_template"]
    if not isinstance(template, str) or not _TEMPLATE_RE.fullmatch(template):
        raise ManifestError(
            "license_template must be a US federal government work template (PD-USGov...)"
        )
    for key in _URL_FIELDS:
        value = raw[key]
        if not isinstance(value, str) or urllib.parse.urlsplit(value).scheme != "https":
            raise ManifestError(f"{key} must be an https URL")
    author = raw["author"]
    if not isinstance(author, str) or not author.strip():
        raise ManifestError("author must be a non-empty string")
    for key in _OPTIONAL_TEXT_FIELDS:
        if not isinstance(raw.get(key, ""), str):
            raise ManifestError(f"{key} must be a string")


def _face_box(value: object) -> tuple[int, int, int, int]:
    if (
        not isinstance(value, list)
        or len(value) != 4  # noqa: PLR2004 - x, y, width, height
        or not all(isinstance(v, int) and not isinstance(v, bool) for v in value)
    ):
        raise ManifestError("face_box must be a list of four integers [x, y, width, height]")
    x, y, width, height = value
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise ManifestError("face_box needs x, y >= 0 and a positive width and height")
    return (x, y, width, height)


def _read_document(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ManifestError(f"cannot read manifest {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ManifestError(f"manifest {path} is not valid JSON: {exc}") from exc


def load_manifest(path: Path) -> list[FaceFixture]:
    """Parse and validate the manifest at ``path``."""
    document = _read_document(path)
    if not isinstance(document, dict) or not isinstance(document.get("faces"), list):
        raise ManifestError(f"manifest {path} must be an object with a 'faces' list")

    entries: list[FaceFixture] = []
    names: set[str] = set()
    filenames: set[str] = set()
    for index, raw in enumerate(document["faces"]):
        if not isinstance(raw, dict):
            raise ManifestError(f"face entry #{index} must be an object")
        try:
            entry = FaceFixture.from_dict(raw)
        except ManifestError as exc:
            raise ManifestError(f"face entry #{index} ({raw.get('name', '?')}): {exc}") from exc
        if entry.name in names:
            raise ManifestError(f"duplicate fixture name {entry.name!r}")
        if entry.filename in filenames:
            raise ManifestError(f"duplicate filename {entry.filename!r}")
        names.add(entry.name)
        filenames.add(entry.filename)
        entries.append(entry)
    return entries


# --- fixtures/manifest.json "forms": blank US federal forms (Phase 5, C60.7) ---------------------

FORM_HOSTS: Final = frozenset({"www.irs.gov"})
"""Where a pinned form may come from: a US federal agency's own host, so the work is the federal
government's and public domain (17 U.S.C. 105)."""

FORM_LICENSE_BASIS: Final = "17 U.S.C. 105"
"""Why a federal form is public domain; printed after each form a run fetches."""

FORM_KINDS: Final = frozenset({"w2", "1099-nec", "1040"})
"""The forms the generator knows how to fill."""

_FORM_REQUIRED: Final = (
    "name",
    "form",
    "filename",
    "source_page",
    "url",
    "sha256",
    "size",
    "license",
    "publisher",
    "pages",
    "revision",
)


def _form_pages(value: object) -> tuple[int, ...]:
    if (
        not isinstance(value, list)
        or not value
        or not all(isinstance(page, int) and not isinstance(page, bool) for page in value)
        or min(value) < 1
        or len(set(value)) != len(value)
    ):
        raise ManifestError("pages must be a non-empty list of distinct page numbers from 1")
    return tuple(value)


def _non_empty_text(raw: Mapping[str, Any], key: str) -> str:
    value = raw[key]
    if not isinstance(value, str) or not value.strip():
        raise ManifestError(f"{key} must be a non-empty string")
    return value


def _check_form(raw: Mapping[str, Any]) -> None:
    _check_pattern(raw, "name", _NAME_RE, "lowercase letters, digits and underscores")
    _check_pattern(raw, "filename", _FILENAME_RE, "a plain file name")
    _check_pattern(raw, "sha256", _SHA256_RE, "64 lowercase hex characters")
    _positive_int(raw, "size", "bytes")
    if raw["form"] not in FORM_KINDS:
        raise ManifestError(f"form must be one of {', '.join(sorted(FORM_KINDS))}")
    if raw["license"] != LICENSE:
        raise ManifestError(f"license must be {LICENSE!r}: only public-domain forms are allowed")
    for key in _URL_FIELDS:
        value = raw[key]
        if not isinstance(value, str) or urllib.parse.urlsplit(value).scheme != "https":
            raise ManifestError(f"{key} must be an https URL")
    if urllib.parse.urlsplit(raw["url"]).hostname not in FORM_HOSTS:
        raise ManifestError(
            f"url must be on a US federal agency's own host ({', '.join(sorted(FORM_HOSTS))})"
        )
    _non_empty_text(raw, "publisher")
    _non_empty_text(raw, "revision")
    if not isinstance(raw.get("notes", ""), str):
        raise ManifestError("notes must be a string")


@dataclass(frozen=True, slots=True)
class FormFixture:
    """One blank US federal form of the held-out document set (C60.7): pinned like a face, never
    committed, and filled with synthetic values by the fixture generator."""

    name: str
    form: str
    """What the generator fills: ``w2``, ``1099-nec`` or ``1040``."""
    filename: str
    source_page: str
    url: str
    sha256: str
    size: int
    license: str
    publisher: str
    pages: tuple[int, ...]
    """The 1-based pages of the pinned file the held-out set takes."""
    revision: str
    notes: str = ""

    @property
    def sha1(self) -> str:
        """Forms are not Commons files: no SHA-1 and no archive fallback."""
        return ""

    @property
    def license_template(self) -> str:
        return FORM_LICENSE_BASIS

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> FormFixture:
        _check_keys(raw, known={f.name for f in fields(cls)}, required=_FORM_REQUIRED)
        _check_form(raw)
        return cls(**{**raw, "pages": _form_pages(raw["pages"])})


def load_forms(path: Path) -> list[FormFixture]:
    """The manifest's ``forms`` list (absent means none), validated."""
    document = _read_document(path)
    if not isinstance(document, dict):
        raise ManifestError(f"manifest {path} must be an object")
    raw_forms = document.get("forms", [])
    if not isinstance(raw_forms, list):
        raise ManifestError(f"manifest {path}: 'forms' must be a list")

    forms: list[FormFixture] = []
    names: set[str] = set()
    filenames: set[str] = set()
    for index, raw in enumerate(raw_forms):
        if not isinstance(raw, dict):
            raise ManifestError(f"form entry #{index} must be an object")
        try:
            form = FormFixture.from_dict(raw)
        except ManifestError as exc:
            raise ManifestError(f"form entry #{index} ({raw.get('name', '?')}): {exc}") from exc
        if form.name in names:
            raise ManifestError(f"duplicate form name {form.name!r}")
        if form.filename in filenames:
            raise ManifestError(f"duplicate form filename {form.filename!r}")
        names.add(form.name)
        filenames.add(form.filename)
        forms.append(form)
    return forms


# --- fixtures/calibration-manifest.json (C49.1) ---------------------------------------------------

SEXES: Final = frozenset({"female", "male", "unknown"})
REVIEW_DECISIONS: Final = frozenset({"keep", "exclude"})
EXCLUSION_REASONS: Final = frozenset({"different_person_per_metadata", "misattribution"})
"""C49.1: an exclusion needs Commons metadata showing another person or a misattribution, never
a low score (near-duplicates are found by the calibration tool's fixed rules)."""

IMAGE_SUFFIXES: Final = frozenset({".jpg", ".jpeg", ".png", ".tif", ".tiff"})
_IDENTITY_RE: Final = re.compile(r"^p[0-9]{4}$")
_TOP_FIELDS: Final = ("schema_version", "description", "purpose", "takedown", "identities")
_IDENTITY_FIELDS: Final = ("id", "sex", "images")
_IMAGE_FIELDS: Final = (
    "id",
    "url",
    "source_page",
    "revision_id",
    "sha256",
    "sha1",
    "size",
    "license_template",
)
_IMAGE_OPTIONAL: Final = ("year", "review")
MIN_YEAR: Final = 1900
MAX_YEAR: Final = 2100


@dataclass(frozen=True, slots=True)
class CalibrationImage:
    """One image of ``fixtures/calibration-manifest.json``, with its identity's facts."""

    name: str
    """The image id: ``<identity>-<n>``, e.g. ``p0001-1``."""
    identity: str
    filename: str
    url: str
    source_page: str
    sha256: str
    sha1: str
    size: int
    revision_id: int
    license_template: str
    sex: str = "unknown"
    year: int | None = None
    review_decision: str | None = None
    review_reason: str | None = None


def _text(raw: Mapping[str, Any], key: str) -> str:
    value = raw[key]
    if not isinstance(value, str) or not value.strip():
        raise ManifestError(f"{key} must be a non-empty string")
    return value


def _review(raw: object) -> tuple[str, str | None]:
    if not isinstance(raw, dict):
        raise ManifestError("review must be an object")
    _check_keys(raw, known={"decision", "reason"}, required=("decision",))
    decision = raw["decision"]
    if decision not in REVIEW_DECISIONS:
        raise ManifestError("review decision must be keep or exclude")
    reason = raw.get("reason")
    if decision == "keep":
        if reason is not None:
            raise ManifestError("a review reason is only for an exclusion")
        return "keep", None
    if reason not in EXCLUSION_REASONS:
        raise ManifestError(
            f"review reason must be one of {', '.join(sorted(EXCLUSION_REASONS))}, got {reason!r}"
        )
    return "exclude", str(reason)


def _year(raw: Mapping[str, Any]) -> int | None:
    value = raw.get("year")
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not MIN_YEAR <= value <= MAX_YEAR:
        raise ManifestError(f"year must be null or an integer from {MIN_YEAR} to {MAX_YEAR}")
    return value


def _calibration_image(raw: object, identity: str, sex: str) -> CalibrationImage:
    if not isinstance(raw, dict):
        raise ManifestError("an image must be an object")
    _check_keys(raw, known={*_IMAGE_FIELDS, *_IMAGE_OPTIONAL}, required=_IMAGE_FIELDS)
    image_id = raw["id"]
    if (
        not isinstance(image_id, str)
        or not re.fullmatch(rf"{identity}-[1-9][0-9]*", image_id)
        or not identity
    ):
        raise ManifestError(f"id must be {identity}-<n> (n from 1), got {image_id!r}")
    url = raw["url"]
    name = commons_file_name(url) if isinstance(url, str) else None
    suffix = PurePosixPath(name).suffix.lower() if name else ""
    if name is None or suffix not in IMAGE_SUFFIXES:
        raise ManifestError(
            "url must be a Commons original of a JPEG, PNG or TIFF "
            f"({COMMONS_UPLOAD}<a>/<ab>/<name>, no query string), got {url!r}"
        )
    page = raw["source_page"]
    if not isinstance(page, str) or not page.startswith(COMMONS_FILE_PAGE):
        raise ManifestError(f"source_page must start with {COMMONS_FILE_PAGE}")
    if urllib.parse.unquote(page.removeprefix(COMMONS_FILE_PAGE)).replace(" ", "_") != name:
        raise ManifestError(f"source_page must be the file page of {name}")
    template = raw["license_template"]
    if not isinstance(template, str) or not _CALIBRATION_TEMPLATE_RE.fullmatch(template):
        raise ManifestError(
            "license_template must be PD-USGov-NASA, PD-USGov-DOS or PD-USGov-Military... "
            f"(C49.1), got {template!r}"
        )
    decision, reason = (None, None) if raw.get("review") is None else _review(raw["review"])
    return CalibrationImage(
        name=image_id,
        identity=identity,
        filename=f"{image_id}{suffix}",
        url=url,
        source_page=page,
        sha256=_check_pattern(raw, "sha256", _SHA256_RE, "64 lowercase hex characters"),
        sha1=_check_pattern(raw, "sha1", _SHA1_RE, "40 lowercase hex characters"),
        size=_positive_int(raw, "size", "bytes"),
        revision_id=_positive_int(raw, "revision_id", "the file page's revision id"),
        license_template=template,
        sex=sex,
        year=_year(raw),
        review_decision=decision,
        review_reason=reason,
    )


def _identity_images(raw: object, index: int, seen: set[str]) -> list[CalibrationImage]:
    if not isinstance(raw, dict):
        raise ManifestError(f"identity #{index} must be an object")
    try:
        _check_keys(raw, known=set(_IDENTITY_FIELDS), required=_IDENTITY_FIELDS)
        identity = _check_pattern(raw, "id", _IDENTITY_RE, "p followed by four digits")
        if identity in seen:
            raise ManifestError(f"duplicate identity id {identity!r}")
        seen.add(identity)
        if raw["sex"] not in SEXES:
            raise ManifestError(f"sex must be one of {', '.join(sorted(SEXES))}")
        images = raw["images"]
        if not isinstance(images, list) or not images:
            raise ManifestError("an identity needs at least one image")
    except ManifestError as exc:
        raise ManifestError(f"identity #{index} ({raw.get('id', '?')}): {exc}") from exc
    found: list[CalibrationImage] = []
    for number, image in enumerate(images):
        try:
            found.append(_calibration_image(image, identity, str(raw["sex"])))
        except ManifestError as exc:
            raise ManifestError(f"identity {identity}, image #{number}: {exc}") from exc
    return found


def load_calibration_manifest(path: Path) -> list[CalibrationImage]:
    """Parse and validate the calibration manifest at ``path`` (see the module docstring)."""
    document = _read_document(path)
    if not isinstance(document, dict) or not isinstance(document.get("identities"), list):
        raise ManifestError(f"manifest {path} must be an object with an 'identities' list")
    _check_keys(document, known=set(_TOP_FIELDS), required=_TOP_FIELDS)
    if document["schema_version"] != 1:
        raise ManifestError("schema_version must be 1")
    for key in ("description", "purpose", "takedown"):
        _text(document, key)

    seen: set[str] = set()
    images: list[CalibrationImage] = []
    for index, raw in enumerate(document["identities"]):
        images.extend(_identity_images(raw, index, seen))
    for attribute in ("name", "sha256", "url"):
        values = [getattr(image, attribute) for image in images]
        repeated = sorted({value for value in values if values.count(value) > 1})
        if repeated:
            raise ManifestError(f"duplicate {attribute}: {', '.join(repeated)}")
    return images


# --- HTTP -----------------------------------------------------------------------------------------


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
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})  # noqa: S310
    response: Response = opener.open(request, timeout=timeout)
    return response


class RateLimiter:
    """Spaces the starts of requests at least ``min_interval`` seconds apart, across threads,
    holds every request back while a server asked to wait, and keeps the downloads' average under
    ``max_bits_per_second`` (:meth:`spend`)."""

    def __init__(
        self,
        min_interval: float = MIN_REQUEST_INTERVAL_SECONDS,
        *,
        max_bits_per_second: float = MAX_DOWNLOAD_BITS_PER_SECOND,
        clock: Clock = time.monotonic,
        sleep: Sleep = time.sleep,
    ) -> None:
        self.min_interval = min_interval
        self.max_bits_per_second = max_bits_per_second
        self._clock = clock
        self._sleep = sleep
        self._next = float("-inf")
        self._paid = float("-inf")
        self._lock = threading.Lock()

    def now(self) -> float:
        """The limiter's clock: when a download starts, for :meth:`spend`."""
        return self._clock()

    def wait(self) -> None:
        """Block until a request may start, and book the next slot."""
        with self._lock:
            delay = self._next - self._clock()
            if delay > 0:
                self._sleep(delay)
            self._next = max(self._clock(), self._next) + self.min_interval

    def back_off(self, seconds: float) -> None:
        """No request may start within ``seconds`` from now."""
        with self._lock:
            self._next = max(self._next, self._clock() + seconds)

    def spend(self, size: int, *, since: float) -> None:
        """Count ``size`` bytes, downloaded from ``since`` on, against the bandwidth cap: no
        request may start before every byte counted so far, by any thread, could have arrived at
        :attr:`max_bits_per_second`. The counts add up (Workflow 4B review H010), so downloads in
        flight at the same time keep the average under the cap together, not each alone."""
        with self._lock:
            self._paid = max(self._paid, since) + size * 8 / self.max_bits_per_second
            self._next = max(self._next, self._paid)


def retry_after_seconds(value: str | None, now: datetime) -> float | None:
    """The delay a ``Retry-After`` header asks for: delay-seconds, or an HTTP date (a date in the
    past is 0). ``None`` when absent or unreadable."""
    if value is None:
        return None
    text = value.strip()
    if text.isdigit():
        return float(int(text))
    try:
        when = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return max(0.0, (when - now).total_seconds())


class PoliteOpener:
    """An opener that waits for the rate limiter before each request and retries 429 and 503
    answers after their ``Retry-After``, else after a doubling backoff."""

    def __init__(
        self,
        opener: Opener,
        limiter: RateLimiter,
        *,
        max_attempts: int = MAX_ATTEMPTS,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._opener = opener
        self._limiter = limiter
        self._max_attempts = max_attempts
        self._now = now

    def __call__(self, url: str, timeout: float) -> Response:
        attempt = 0
        while True:
            attempt += 1
            self._limiter.wait()
            try:
                return self._opener(url, timeout)
            except urllib.error.HTTPError as exc:
                if exc.code not in RETRYABLE_STATUSES:
                    raise
                asked = retry_after_seconds(exc.headers.get("Retry-After"), self._now())
                exc.close()
                if asked is not None and asked > MAX_RETRY_AFTER_SECONDS:
                    raise RateLimitedError(
                        f"HTTP {exc.code} for {url}: the server asked to wait {asked:.0f} s, "
                        f"more than {MAX_RETRY_AFTER_SECONDS:.0f} s"
                    ) from exc
                if attempt >= self._max_attempts:
                    raise RateLimitedError(
                        f"HTTP {exc.code} for {url}, still after {attempt} attempts"
                    ) from exc
                backoff = min(MAX_BACKOFF_SECONDS, FIRST_BACKOFF_SECONDS * 2 ** (attempt - 1))
                self._limiter.back_off(asked if asked is not None else backoff)


# --- the Commons archive of re-uploaded files -----------------------------------------------------


def _commons_digest(name: str) -> str:
    """Commons spreads files over directories named after the MD5 of the file name."""
    return hashlib.md5(name.encode("utf-8"), usedforsecurity=False).hexdigest()


def commons_file_name(url: str) -> str | None:
    """The Commons file name of an original's URL
    (``https://upload.wikimedia.org/wikipedia/commons/<a>/<ab>/<name>``, with ``<a>/<ab>`` the
    first hex digits of the name's MD5, and no query string); ``None`` for anything else."""
    parts = urllib.parse.urlsplit(url)
    if (
        parts.scheme != "https"
        or parts.netloc != "upload.wikimedia.org"
        or parts.query
        or parts.fragment
    ):
        return None
    match = _COMMONS_PATH_RE.fullmatch(parts.path)
    if match is None:
        return None
    name = urllib.parse.unquote(match[3])
    digest = _commons_digest(name)
    return name if (match[1], match[2]) == (digest[0], digest[:2]) else None


def archive_url(name: str, archivename: str) -> str:
    """The URL of the superseded revision ``archivename`` (``<YYYYMMDDHHMMSS>!<name>``, as the
    Commons API reports it) of the file ``name``."""
    match = _ARCHIVENAME_RE.fullmatch(archivename)
    if match is None or match[2] != name or "/" in name:
        raise ValueError(f"archivename {archivename!r} is not a revision of {name!r}")
    digest = _commons_digest(name)
    quoted = urllib.parse.quote(archivename, safe="")
    return f"{COMMONS_UPLOAD}archive/{digest[0]}/{digest[:2]}/{quoted}"


def commons_api_url(name: str) -> str:
    """The Commons API query listing every revision of the file ``name`` with its SHA-1, size and
    archive name (the current revision has none)."""
    query = urllib.parse.urlencode(
        {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "prop": "imageinfo",
            "iiprop": "sha1|size|archivename",
            "iilimit": "50",
            "titles": f"File:{name}",
        }
    )
    return f"{COMMONS_API}?{query}"


def _revisions(document: object) -> list[dict[str, Any]]:
    """The ``imageinfo`` entries of every page of a Commons API answer."""
    if not isinstance(document, dict):
        raise TypeError("the answer is not an object")
    query = document.get("query")
    pages = query.get("pages") if isinstance(query, dict) else None
    if not isinstance(pages, list):
        raise TypeError("the answer has no pages")
    revisions: list[dict[str, Any]] = []
    for page in pages:
        info = page.get("imageinfo", []) if isinstance(page, dict) else None
        if not isinstance(info, list):
            raise TypeError("a page has no imageinfo list")
        revisions.extend(entry for entry in info if isinstance(entry, dict))
    return revisions


def _archived_urls(
    entry: Pinned, name: str, opener: Opener, timeout: float, mismatch: FetchError
) -> list[str]:
    """The archive URLs of the superseded revisions that may hold the pinned bytes."""
    try:
        with opener(commons_api_url(name), timeout) as response:
            raw = response.read(MAX_API_RESPONSE_BYTES + 1)
        if len(raw) > MAX_API_RESPONSE_BYTES:
            raise ValueError("the answer is larger than expected")
        revisions = _revisions(json.loads(raw))
    except urllib.error.HTTPError as exc:
        exc.close()
        raise ChecksumMismatchError(
            f"{mismatch}; the archive lookup failed: HTTP {exc.code}"
        ) from exc
    except (FetchError, OSError, http.client.HTTPException, ValueError, TypeError) as exc:
        raise ChecksumMismatchError(f"{mismatch}; the archive lookup failed: {exc}") from exc
    urls: list[str] = []
    for revision in revisions:
        archivename = revision.get("archivename")
        if not isinstance(archivename, str):
            continue  # the current revision, which just failed
        pinned = (
            revision.get("sha1") == entry.sha1 if entry.sha1 else revision.get("size") == entry.size
        )
        if not pinned:
            continue
        try:
            urls.append(archive_url(name, archivename))
        except ValueError:
            continue
        if len(urls) == MAX_ARCHIVE_CANDIDATES:
            break
    return urls


# --- harvesting the calibration set (C49.1, Workflow 4B) -----------------------------------------
#
# ``--harvest-calibration`` writes ``fixtures/calibration-manifest.json``. The rules are fixed
# before any image is measured, and none reads a score:
#
# - files from the portrait categories of HARVEST_ROOTS, HARVEST_DEPTH subcategory levels down;
# - JPEG originals of at most MAX_ORIGINAL_BYTES whose title does not announce several people or a
#   derivative (crew, group, crop, poster...);
# - a PD-USGov-NASA, -DOS or -Military* licence template, and no Personality rights, Congress,
#   Creative Commons, GFDL or deletion template;
# - not a group photo: no visible category announcing several people ("Group portrait photographs
#   with 6 persons", "2 men in Florida"), none naming two people, no "and" or "&" in the title;
# - exactly one person named: the humans of the file's structured-data depicts (P180) and the
#   people its visible categories name must be one and the same Wikidata item. A category names a
#   person when its Wikidata item is a human (P31 Q5) or a category item whose single main topic
#   (P301) is one, or when it is "<Name> in ...", "<Name> by ..." or "(Official) portraits of
#   <Name>" for an ancestor (four levels up at most) that names one ("<Name> in June 1965" under
#   "<Name> in 1965" under "<Name> by year" under "<Name>"); "<Name> administration personnel"
#   names no one;
# - one copy of each Commons SHA-1 (the earliest page's); at most MAX_IMAGES_PER_IDENTITY per
#   person, spread over the years; only people left with two photos or more after the downloads.
#
# Every original is downloaded once (resumable, by its SHA-1, into ``<dest>/.harvest/``), checked
# against Commons' size and SHA-1, and pinned by the SHA-256 of its bytes. People get pseudonymous
# ids in a seeded order; the manifest holds no name, no Wikidata id and no category.

WIKIDATA_API: Final = "https://www.wikidata.org/w/api.php"
MAXLAG_SECONDS: Final = 5
"""Every API request asks the servers to refuse it while replication lags more than this; such a
refusal is retried after at least as long (the API's own ``maxlag`` convention)."""

HARVEST_ROOTS: Final = (
    "Category:Official portrait photographs of NASA",
    "Category:Official portrait photographs of the United States Department of State",
    "Category:Official portrait photographs of the United States Armed Forces",
)
"""C49.1 and research §10.1: NASA, Department of State and Armed Forces official portraits."""

HARVEST_DEPTH: Final = 3
"""Subcategory levels below each root (the Armed Forces tree nests services, ranks, years)."""

MAX_ORIGINAL_BYTES: Final = 40_000_000
"""C49.1: originals over 40 MB are skipped."""

MAX_IMAGES_PER_IDENTITY: Final = 5
"""At most this many portraits per person (at most 10 genuine pairs), spread over the years, so
that no one identity outweighs the others."""

HARVEST_SEED: Final = 49
"""Seeds the order of the pseudonymous ids."""

MAX_HARVEST_RESPONSE_BYTES: Final = 64 << 20
"""A batch of 50 Wikidata items with all their claims can run to several megabytes."""

API_BATCH: Final = 50
"""Titles or ids per API request: MediaWiki's limit for a client without bot rights."""

MAX_API_URL_LENGTH: Final = 7000
"""Batches of titles keep each request URL within this many characters: Wikimedia answers 414
past about 8 KiB (measured: 7,988 accepted, 8,888 refused), and a continuation adds a few hundred
characters at most (a page id and a title of up to 255 bytes)."""

CATEGORY_ANCESTOR_LEVELS: Final = 4
HUMAN: Final = "Q5"
WIKIMEDIA_CATEGORY: Final = "Q4167836"
SEX_OF_ITEM: Final = {"Q6581072": "female", "Q6581097": "male"}
"""Wikidata P21 values read as a sex; any other value (or several) is ``unknown``."""

JPEG_MIME: Final = "image/jpeg"
JPEG_SUFFIXES: Final = frozenset({".jpg", ".jpeg"})

_LEFT_OUT_TITLE_RE: Final = re.compile(
    r"\b(?:crops?|cropped|crews?|groups?|posters?|class of|collages?|montages?|teams?|and)\b|&",
    re.IGNORECASE,
)
"""Titles that announce several people ("X and Y") or a derivative of another file."""

_GROUP_CATEGORY_RE: Final = re.compile(
    r"\bgroups?\b|\b(?:[2-9]|[1-9][0-9]+|two|three|four|five|six|seven|eight|nine|ten) "
    r"(?:men|women|people|persons|astronauts|children)\b",
    re.IGNORECASE,
)
"""Categories announcing a photo of several people ("Group portrait photographs with 6 persons",
"5 men and 1 woman", "2 men in Florida")."""

_DISQUALIFYING_TEMPLATE_RE: Final = re.compile(
    r"^(?:Personality rights|PD-USGov-Congress(?:-.*)?|Cc-.*|GFDL.*|Copyvio|Delete"
    r"|Deletion request|Speedydelete|Speedy delete|No permission since|No license since"
    r"|No source since)$",
    re.IGNORECASE,
)
"""C49.1: never a file tagged Personality rights, never a Congress portrait; a Creative Commons or
GFDL tag beside the federal one, or a pending deletion, puts the public-domain status in doubt."""

_TAG_RE: Final = re.compile(r"<[^>]*>")
_YEAR_RE: Final = re.compile(r"(?<![0-9])([0-9]{4})(?![0-9s])")
"""A four-digit year that is not part of a longer number nor a decade ("1970s")."""
_INCEPTION_RE: Final = re.compile(r"^\+([0-9]{4})-")
_QID_RE: Final = re.compile(r"^Q([1-9][0-9]*)$")
_YEAR_PRECISION: Final = 9
"""Wikibase time precision 9 is a year; 10 a month, 11 a day."""

Api = Callable[[str, Mapping[str, str]], dict[str, Any]]
"""``api(base, params)``: one answer of a MediaWiki API (Commons or Wikidata)."""


def api_request_url(base: str, params: Mapping[str, str]) -> str:
    """The URL of one API request: JSON, format version 2, and ``maxlag``."""
    query = {"format": "json", "formatversion": "2", "maxlag": str(MAXLAG_SECONDS), **params}
    return f"{base}?{urllib.parse.urlencode(query)}"


class MediaWikiApi:
    """Answers API requests through a polite opener: a ``maxlag`` refusal holds every request back
    for at least :data:`MAXLAG_SECONDS` (or the reported lag) and is retried, at most
    :data:`MAX_ATTEMPTS` times; any other API error fails."""

    def __init__(
        self,
        opener: Opener,
        limiter: RateLimiter,
        *,
        max_bytes: int = MAX_HARVEST_RESPONSE_BYTES,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._opener = opener
        self._limiter = limiter
        self._max_bytes = max_bytes
        self._timeout = timeout

    def _read(self, base: str, url: str) -> dict[str, Any]:
        try:
            with self._opener(url, self._timeout) as response:
                raw = response.read(self._max_bytes + 1)
        except urllib.error.HTTPError as exc:
            exc.close()
            raise FetchError(f"{base}: HTTP {exc.code} {exc.reason}") from exc
        except (OSError, http.client.HTTPException) as exc:  # pragma: no cover - network only
            raise FetchError(f"{base}: {exc}") from exc
        if len(raw) > self._max_bytes:
            raise FetchError(f"an answer of {base} is larger than {self._max_bytes} bytes")
        try:
            document = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise FetchError(f"{base} answered something that is not JSON: {exc}") from exc
        if not isinstance(document, dict):
            raise FetchError(f"{base} answered something that is not a JSON object")
        return document

    def __call__(self, base: str, params: Mapping[str, str]) -> dict[str, Any]:
        url = api_request_url(base, params)
        for _ in range(MAX_ATTEMPTS):
            document = self._read(base, url)
            error = document.get("error")
            if not isinstance(error, dict):
                if error is not None:
                    raise FetchError(f"{base} refused the request: {error!r}")
                return document
            if error.get("code") != "maxlag":
                raise FetchError(
                    f"{base} refused the request: {error.get('code')}: {error.get('info', '')}"
                )
            lag = error.get("lag")
            reported = (
                float(lag) if isinstance(lag, int | float) and not isinstance(lag, bool) else 0
            )
            self._limiter.back_off(max(float(MAXLAG_SECONDS), reported))
        raise RateLimitedError(
            f"{base} kept refusing for replication lag (maxlag) after {MAX_ATTEMPTS} attempts"
        )


def _batches[T](values: Sequence[T]) -> list[Sequence[T]]:
    return [values[start : start + API_BATCH] for start in range(0, len(values), API_BATCH)]


def _url_batches(
    base: str, params: Mapping[str, str], key: str, values: Sequence[str]
) -> list[list[str]]:
    """``values`` in order, in batches of at most :data:`API_BATCH` whose request (``key`` set to
    the batch joined by ``|``) stays within :data:`MAX_API_URL_LENGTH` characters."""
    batches: list[list[str]] = []
    current: list[str] = []
    for value in values:
        candidate = [*current, value]
        url = api_request_url(base, {**params, key: "|".join(candidate)})
        if current and (len(candidate) > API_BATCH or len(url) > MAX_API_URL_LENGTH):
            batches.append(current)
            current = [value]
        else:
            current = candidate
    if current:
        batches.append(current)
    return batches


def _continued(api: Api, base: str, params: Mapping[str, str]) -> list[dict[str, Any]]:
    """Every answer of a query, following ``continue`` to its end."""
    answers: list[dict[str, Any]] = []
    extra: dict[str, str] = {}
    while True:
        answer = api(base, {**params, **extra})
        answers.append(answer)
        more = answer.get("continue")
        if not isinstance(more, dict):
            return answers
        extra = {str(key): str(value) for key, value in more.items()}


def _query(answer: Mapping[str, Any], key: str) -> list[Any]:
    query = answer.get("query")
    found = query.get(key) if isinstance(query, dict) else None
    return found if isinstance(found, list) else []


_FIRST_ONLY: Final = frozenset({"imageinfo", "revisions"})


def query_pages(api: Api, params: Mapping[str, str]) -> dict[str, dict[str, Any]]:
    """The Commons pages of a ``prop`` query by title, the lists of every continuation merged."""
    pages: dict[str, dict[str, Any]] = {}
    for answer in _continued(api, COMMONS_API, params):
        for page in _query(answer, "pages"):
            if not isinstance(page, dict) or not isinstance(page.get("title"), str):
                continue
            merged = pages.setdefault(page["title"], {})
            for key, value in page.items():
                if isinstance(value, list) and key not in _FIRST_ONLY:
                    known: list[Any] = merged.setdefault(key, [])
                    known.extend(entry for entry in value if entry not in known)
                else:
                    merged.setdefault(key, value)
    return pages


def category_files(api: Api, roots: Sequence[str], depth: int) -> list[str]:
    """The files of ``roots`` and of their subcategories ``depth`` levels down, each once."""
    files: dict[str, None] = {}
    seen: set[str] = set()
    level = list(roots)
    for distance in range(depth + 1):
        below: list[str] = []
        for category in level:
            if category in seen:
                continue
            seen.add(category)
            params = {
                "action": "query",
                "list": "categorymembers",
                "cmtitle": category,
                "cmtype": "file|subcat",
                "cmprop": "title|type",
                "cmlimit": "max",
            }
            for answer in _continued(api, COMMONS_API, params):
                for member in _query(answer, "categorymembers"):
                    title = member.get("title") if isinstance(member, dict) else None
                    if not isinstance(title, str):
                        continue
                    if member.get("type") == "file":
                        files.setdefault(title)
                    elif member.get("type") == "subcat" and distance < depth:
                        below.append(title)
        level = below
    return list(files)


@dataclass(frozen=True, slots=True)
class CommonsFile:
    """What the harvest reads of one Commons file page."""

    title: str
    pageid: int
    url: str
    """The original's URL, query string stripped."""
    source_page: str
    sha1: str
    size: int
    mime: str
    revision_id: int
    templates: frozenset[str]
    """Transcluded templates, without the ``Template:`` prefix."""
    categories: tuple[str, ...]
    """Visible categories (hidden maintenance categories left out)."""
    date: str | None
    """The ``DateTimeOriginal`` of the file's metadata (its description's date, else EXIF)."""


def _titles(entries: object, prefix: str) -> list[str]:
    if not isinstance(entries, list):
        return []
    found = (entry.get("title") for entry in entries if isinstance(entry, dict))
    return [title.removeprefix(prefix) for title in found if isinstance(title, str)]


def _commons_file(page: Mapping[str, Any]) -> CommonsFile | None:
    infos, revisions = page.get("imageinfo"), page.get("revisions")
    info = infos[0] if isinstance(infos, list) and infos else None
    revision = revisions[0] if isinstance(revisions, list) and revisions else None
    if not isinstance(info, dict) or not isinstance(revision, dict):
        return None
    url = str(info.get("url", "")).split("?", 1)[0]
    metadata = info.get("extmetadata")
    original = metadata.get("DateTimeOriginal") if isinstance(metadata, dict) else None
    date = original.get("value") if isinstance(original, dict) else None
    fields_ = (page.get("pageid"), info.get("size"), revision.get("revid"))
    if (
        commons_file_name(url) is None
        or not all(isinstance(v, int) and not isinstance(v, bool) for v in fields_)
        or not isinstance(info.get("sha1"), str)
        or not _SHA1_RE.fullmatch(info["sha1"])
        or not isinstance(info.get("descriptionurl"), str)
    ):
        return None
    return CommonsFile(
        title=str(page["title"]),
        pageid=int(page["pageid"]),
        url=url,
        source_page=info["descriptionurl"],
        sha1=info["sha1"],
        size=int(info["size"]),
        mime=str(info.get("mime", "")),
        revision_id=int(revision["revid"]),
        templates=frozenset(_titles(page.get("templates"), "Template:")),
        categories=tuple(_titles(page.get("categories"), "")),
        date=date if isinstance(date, str) else None,
    )


def commons_files(api: Api, titles: Sequence[str]) -> list[CommonsFile]:
    """Each readable file page of ``titles``, in order."""
    found: list[CommonsFile] = []
    params = {
        "action": "query",
        "prop": "imageinfo|templates|categories|revisions",
        "iiprop": "url|sha1|size|mime|extmetadata",
        "iiextmetadatafilter": "DateTimeOriginal",
        "tlnamespace": "10",
        "tllimit": "max",
        "clshow": "!hidden",
        "cllimit": "max",
        "rvprop": "ids",
    }
    for batch in _url_batches(COMMONS_API, params, "titles", titles):
        pages = query_pages(api, {**params, "titles": "|".join(batch)})
        for title in batch:
            page = pages.get(title)
            parsed = _commons_file(page) if page is not None else None
            if parsed is not None:
                found.append(parsed)
    return found


def licence_template_of(templates: frozenset[str]) -> str | None:
    """The most specific C49.1 licence template of a file (``PD-USGov-NASA``, ``-DOS`` or
    ``-Military*``), or ``None`` when it has none or carries a disqualifying template."""
    if any(_DISQUALIFYING_TEMPLATE_RE.fullmatch(name) for name in templates):
        return None
    allowed = sorted(
        (name for name in templates if _CALIBRATION_TEMPLATE_RE.fullmatch(name)),
        key=lambda name: (-len(name), name),
    )
    return allowed[0] if allowed else None


def _left_out_reason(file: CommonsFile) -> str | None:
    suffix = PurePosixPath(urllib.parse.unquote(file.url)).suffix.lower()
    if _LEFT_OUT_TITLE_RE.search(file.title.removeprefix("File:")):
        return "title"
    if file.mime != JPEG_MIME or suffix not in JPEG_SUFFIXES:
        return "format"
    if file.size > MAX_ORIGINAL_BYTES:
        return "size"
    if licence_template_of(file.templates) is None:
        return "licence"
    return None


def year_of(when: str | None, inception: int | None) -> int | None:
    """The photo's year: the one year its date field ``when`` names (tags stripped; a decade or
    two years name none), else its structured-data inception; ``None`` without either."""
    if when is not None:
        years = {
            int(found)
            for found in _YEAR_RE.findall(_TAG_RE.sub(" ", when))
            if MIN_YEAR <= int(found) <= MAX_YEAR
        }
        if len(years) == 1:
            return years.pop()
    if inception is not None and MIN_YEAR <= inception <= MAX_YEAR:
        return inception
    return None


def _claim_ids(claims: object, prop: str) -> tuple[str, ...]:
    statements = claims.get(prop) if isinstance(claims, dict) else None
    found: list[str] = []
    for statement in statements if isinstance(statements, list) else []:
        snak = statement.get("mainsnak") if isinstance(statement, dict) else None
        datavalue = snak.get("datavalue") if isinstance(snak, dict) else None
        value = datavalue.get("value") if isinstance(datavalue, dict) else None
        if isinstance(value, dict) and isinstance(value.get("id"), str):
            found.append(value["id"])
    return tuple(found)


def _inception_year(claims: object) -> int | None:
    statements = claims.get("P571") if isinstance(claims, dict) else None
    for statement in statements if isinstance(statements, list) else []:
        snak = statement.get("mainsnak") if isinstance(statement, dict) else None
        datavalue = snak.get("datavalue") if isinstance(snak, dict) else None
        value = datavalue.get("value") if isinstance(datavalue, dict) else None
        if not isinstance(value, dict) or not isinstance(value.get("time"), str):
            continue
        precision = value.get("precision")
        match = _INCEPTION_RE.match(value["time"])
        if match is not None and isinstance(precision, int) and precision >= _YEAR_PRECISION:
            return int(match[1])
    return None


@dataclass(frozen=True, slots=True)
class MediaFacts:
    """A file's structured data: its depicts (P180) items and inception (P571) year."""

    depicts: tuple[str, ...]
    inception: int | None


NO_MEDIA_FACTS: Final = MediaFacts(depicts=(), inception=None)


def media_facts(api: Api, pageids: Sequence[int]) -> dict[int, MediaFacts]:
    """The structured data (``M<pageid>``) of each file page."""
    found: dict[int, MediaFacts] = {}
    for batch in _batches(pageids):
        answer = api(
            COMMONS_API,
            {"action": "wbgetentities", "ids": "|".join(f"M{p}" for p in batch), "props": "claims"},
        )
        entities = answer.get("entities")
        for pageid in batch:
            entity = entities.get(f"M{pageid}") if isinstance(entities, dict) else None
            if not isinstance(entity, dict):
                continue
            statements = entity.get("statements") or entity.get("claims")
            found[pageid] = MediaFacts(
                depicts=_claim_ids(statements, "P180"), inception=_inception_year(statements)
            )
    return found


@dataclass(frozen=True, slots=True)
class CategoryLink:
    """A Commons category's Wikidata item (``None`` without one) and its visible parents."""

    item: str | None
    parents: tuple[str, ...]


def category_links(api: Api, titles: Sequence[str]) -> dict[str, CategoryLink]:
    """The Wikidata item and parent categories of each category of ``titles``."""
    links: dict[str, CategoryLink] = {}
    params = {
        "action": "query",
        "prop": "pageprops|categories",
        "ppprop": "wikibase_item",
        "clshow": "!hidden",
        "cllimit": "max",
    }
    for batch in _url_batches(COMMONS_API, params, "titles", titles):
        pages = query_pages(api, {**params, "titles": "|".join(batch)})
        for title in batch:
            page = pages.get(title, {})
            props = page.get("pageprops")
            item = props.get("wikibase_item") if isinstance(props, dict) else None
            links[title] = CategoryLink(
                item=item if isinstance(item, str) and _QID_RE.fullmatch(item) else None,
                parents=tuple(_titles(page.get("categories"), "")),
            )
    return links


_GENERIC_FIRST_WORDS: Final = frozenset(
    {"Black", "Men", "Official", "People", "Photographs", "Portrait", "Portraits", "Women"}
)
"""First words shared by generic categories ("Men facing left...", "Official portrait
photographs of..."): following them up never reaches a person's own category."""


def _first_word(title: str) -> str:
    words = title.removeprefix("Category:").split()
    return words[0] if words else ""


def _may_name(origin: str, ancestor: str) -> bool:
    """Walking up from the category ``origin``, ``ancestor`` may lead to the person ``origin``
    names: ``origin`` names it ("Official portraits of <Name>" under "<Name>"), or both start with
    the same word that is neither a year nor a generic one ("<Name> in June 1965" under "<Name> in
    1965" under "<Name> by year"). Only an efficiency prune: whom a category names is still decided
    by :func:`_is_about` and :func:`_mentions`."""
    first = _first_word(origin)
    same = (
        first == _first_word(ancestor)
        and first not in _GENERIC_FIRST_WORDS
        and not first[:1].isdigit()
    )
    return same or _mentions(origin, ancestor)


def _ancestry(api: Api, categories: set[str]) -> dict[str, CategoryLink]:
    """The links of ``categories`` and of the ancestors (up to the levels a person may sit) that
    may name their person (:func:`_may_name`)."""
    links = category_links(api, sorted(categories))
    frontier = {(title, title) for title in categories}
    for _ in range(CATEGORY_ANCESTOR_LEVELS):
        frontier = {
            (origin, parent)
            for origin, at in frontier
            for parent in links[at].parents
            if _may_name(origin, parent)
        }
        todo = sorted({parent for _, parent in frontier} - links.keys())
        if todo:
            links.update(category_links(api, todo))
    return links


@dataclass(frozen=True, slots=True)
class WikidataItem:
    """What the harvest reads of a Wikidata item (a redirect maps to its target)."""

    id: str
    instance_of: frozenset[str]
    """P31."""
    main_topics: tuple[str, ...]
    """P301, for a category item."""
    sex: tuple[str, ...]
    """P21."""


def _qnumber(qid: str) -> int:
    match = _QID_RE.fullmatch(qid)
    return int(match[1]) if match is not None else 0


def wikidata_items(api: Api, ids: set[str]) -> dict[str, WikidataItem]:
    """The items of ``ids`` (a redirect is found under its own id and its target's)."""
    items: dict[str, WikidataItem] = {}
    wanted = sorted((qid for qid in ids if _QID_RE.fullmatch(qid)), key=_qnumber)
    for batch in _batches(wanted):
        answer = api(
            WIKIDATA_API, {"action": "wbgetentities", "ids": "|".join(batch), "props": "claims"}
        )
        entities = answer.get("entities")
        for key, entity in entities.items() if isinstance(entities, dict) else []:
            if not isinstance(entity, dict) or "missing" in entity:
                continue
            qid = entity.get("id")
            if not isinstance(qid, str):
                continue
            claims = entity.get("claims")
            item = WikidataItem(
                id=qid,
                instance_of=frozenset(_claim_ids(claims, "P31")),
                main_topics=_claim_ids(claims, "P301"),
                sex=_claim_ids(claims, "P21"),
            )
            items[qid] = items[str(key)] = item
            redirect = entity.get("redirects")
            if isinstance(redirect, dict) and isinstance(redirect.get("from"), str):
                items[redirect["from"]] = item
    return items


def _human(qid: str | None, items: Mapping[str, WikidataItem]) -> str | None:
    found = items.get(qid) if qid is not None else None
    return found.id if found is not None and HUMAN in found.instance_of else None


def person_of_item(item: str | None, items: Mapping[str, WikidataItem]) -> str | None:
    """The person an item stands for: itself when it is a human, or the single main topic of a
    category item when that is a human; ``None`` otherwise."""
    human = _human(item, items)
    if human is not None:
        return human
    found = items.get(item) if item is not None else None
    if found is None or WIKIMEDIA_CATEGORY not in found.instance_of:
        return None
    return _human(found.main_topics[0], items) if len(found.main_topics) == 1 else None


def _mentions(title: str, ancestor: str) -> bool:
    """The category ``title`` contains the ancestor's name as whole words."""
    name = re.escape(ancestor.removeprefix("Category:"))
    return re.search(rf"(?<!\w){name}(?!\w)", title.removeprefix("Category:")) is not None


def _is_about(title: str, ancestor: str) -> bool:
    """The category ``title`` is a per-person subcategory of the ancestor's person: "<Name> in
    ...", "<Name> by ...", or "(Official) portraits of <Name>" / "(Official) portrait photographs
    of <Name>"."""
    name = re.escape(ancestor.removeprefix("Category:"))
    forms = (
        rf"{name} (?:in|by) \S.*|(?:Official )?(?:[Pp]ortraits|[Pp]ortrait photographs) of {name}"
    )
    return re.fullmatch(forms, title.removeprefix("Category:")) is not None


def _ancestor_people(
    title: str, links: Mapping[str, CategoryLink], items: Mapping[str, WikidataItem]
) -> list[tuple[str, str]]:
    """Each ancestor of ``title`` (up to :data:`CATEGORY_ANCESTOR_LEVELS` up) that names a person,
    with that person."""
    link = links.get(title)
    found: list[tuple[str, str]] = []
    seen = {title}
    level = list(link.parents) if link is not None else []
    for _ in range(CATEGORY_ANCESTOR_LEVELS):
        above: list[str] = []
        for ancestor in level:
            parent = links.get(ancestor)
            if ancestor in seen or parent is None or not _may_name(title, ancestor):
                continue
            seen.add(ancestor)
            person = person_of_item(parent.item, items)
            if person is not None:
                found.append((ancestor, person))
            above.extend(parent.parents)
        level = above
    return found


def category_persons(
    title: str, links: Mapping[str, CategoryLink], items: Mapping[str, WikidataItem]
) -> frozenset[str]:
    """The people a category is about: its own item's person, else the person of each ancestor
    whose per-person subcategory it is (:func:`_is_about`)."""
    link = links.get(title)
    own = person_of_item(link.item, items) if link is not None else None
    if own is not None:
        return frozenset({own})
    return frozenset(
        person
        for ancestor, person in _ancestor_people(title, links, items)
        if _is_about(title, ancestor)
    )


def category_mentions(
    title: str, links: Mapping[str, CategoryLink], items: Mapping[str, WikidataItem]
) -> frozenset[str]:
    """Every person a category's title names (its own item's, and each person-ancestor's whose
    name it contains): two or more mean a photo of several people."""
    link = links.get(title)
    own = person_of_item(link.item, items) if link is not None else None
    named = {
        person
        for ancestor, person in _ancestor_people(title, links, items)
        if _mentions(title, ancestor)
    }
    return frozenset(named | ({own} if own is not None else set()))


def identity_of(
    depicts: Sequence[str], from_categories: frozenset[str], items: Mapping[str, WikidataItem]
) -> str | None:
    """The one person a file shows: the humans it depicts and the people its categories name
    must be exactly one item; several people, a disagreement or nobody give ``None``."""
    people = set(from_categories)
    people.update(human for value in depicts if (human := _human(value, items)) is not None)
    return next(iter(people)) if len(people) == 1 else None


def spread[T](candidates: Sequence[T], *, key: Callable[[T], Any], cap: int) -> list[T]:
    """At most ``cap`` of ``candidates`` in ``key`` order, evenly spaced from the first to the
    last (so a career's portraits keep their span of years)."""
    ordered = sorted(candidates, key=key)
    if len(ordered) <= cap:
        return ordered
    if cap <= 1:
        return ordered[:cap]
    step = (len(ordered) - 1) / (cap - 1)
    return [ordered[int(index * step + 0.5)] for index in range(cap)]


def _sex(item: WikidataItem | None) -> str:
    values = {SEX_OF_ITEM.get(value, "unknown") for value in item.sex} if item else set()
    return values.pop() if len(values) == 1 else "unknown"


def _download_original(
    file: CommonsFile, staging: Path, opener: Opener, limiter: RateLimiter
) -> Path:
    """``<staging>/<sha1><suffix>``: the original, downloaded unless already there, checked against
    Commons' size and SHA-1. Its bytes count against the limiter's bandwidth cap
    (:meth:`RateLimiter.spend`), which holds the next request back to keep the average under
    :data:`MAX_DOWNLOAD_BITS_PER_SECOND`."""
    suffix = PurePosixPath(urllib.parse.unquote(file.url)).suffix.lower()
    target = staging / f"{file.sha1}{suffix}"
    if target.is_file() and target.stat().st_size == file.size and _sha1_file(target) == file.sha1:
        return target
    staging.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{file.sha1}.", suffix=".part", dir=staging)
    tmp = Path(tmp_name)
    received = 0
    since = limiter.now()
    try:
        digest = hashlib.sha1(usedforsecurity=False)
        try:
            with os.fdopen(fd, "wb") as out, opener(file.url, DEFAULT_TIMEOUT_SECONDS) as response:
                since = limiter.now()
                while chunk := response.read(CHUNK_SIZE):
                    received += len(chunk)
                    if received > file.size:
                        raise DownloadTooLargeError(f"{file.title}: more than {file.size} bytes")
                    digest.update(chunk)
                    out.write(chunk)
        except urllib.error.HTTPError as exc:
            exc.close()
            message = f"{file.title}: HTTP {exc.code} {exc.reason} for {file.url}"
            raise (NotFoundError if exc.code in GONE_STATUSES else FetchError)(message) from exc
        except (OSError, http.client.HTTPException) as exc:  # pragma: no cover - network only
            raise FetchError(f"{file.title}: download from {file.url} failed: {exc}") from exc
        finally:
            limiter.spend(received, since=since)
        if received != file.size or digest.hexdigest() != file.sha1:
            raise ChecksumMismatchError(
                f"{file.title}: {received} bytes with SHA-1 {digest.hexdigest()}, not the "
                f"{file.size} bytes and SHA-1 {file.sha1} Commons lists"
            )
        tmp.chmod(0o644)
        tmp.replace(target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return target


def _sha1_file(path: Path) -> str:
    digest = hashlib.sha1(usedforsecurity=False)
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def _place(source: Path, target: Path) -> None:
    """``target`` holds ``source``'s bytes: a hard link, else a copy."""
    target.unlink(missing_ok=True)
    try:
        os.link(source, target)
    except OSError:  # pragma: no cover - a file system without hard links
        shutil.copyfile(source, target)
        target.chmod(0o644)


@dataclass(frozen=True, slots=True)
class HarvestSummary:
    """What a harvest found, and why each file it left out was left out."""

    files: int
    left_out: Mapping[str, int]
    identities: int
    images: int


Candidate = tuple[CommonsFile, int | None]
"""A harvested file and its year."""


def _manifest_text(
    roots: Sequence[str], depth: int, per_identity: int, harvested: date
) -> dict[str, str]:
    sources = "; ".join(root.removeprefix("Category:") for root in roots)
    return {
        "description": (
            "The C49 face-match calibration set: Wikimedia Commons official portraits under "
            "PD-USGov-NASA, PD-USGov-DOS or PD-USGov-Military* (no Congress portraits, no file "
            "tagged Personality rights), harvested on "
            f"{harvested.isoformat()} by scripts/fetch_fixtures.py --harvest-calibration from "
            f"the categories {sources} and their subcategories ({depth} levels). A file is kept "
            "only when exactly one person is named, by its structured-data depicts or a "
            "per-person category, every source agrees, and neither its title nor a category "
            "announces several people; JPEG originals of at most 40 MB, "
            f"one copy of each, at most {per_identity} per person spread over the years; only "
            "people with two photos or more. Identities are pseudonymous; years come from the "
            "file's date or inception, sex from the person's Wikidata entry."
        ),
        "purpose": (
            "Measuring the false-match and false-non-match rates of OpenVerify's shared SFace "
            "face-match threshold (docs/calibration/selfie-phase4.md). The images are fetched on "
            "demand into fixtures/faces/calibration/ and never committed; embeddings are computed "
            "in memory and never stored; the report keeps aggregate numbers only."
        ),
        "takedown": (
            "To remove a person: delete their identity here (find it by the file URL), delete "
            "their files from fixtures/faces/calibration/, re-run "
            "services/vision/tools/calibrate_selfie.py and the report, and commit both. Removal "
            "requests: open an issue in the project's repository."
        ),
    }


class _Tally:
    """Why files were left out, by reason."""

    def __init__(self) -> None:
        self.counts: dict[str, int] = {}

    def __call__(self, reason: str, count: int = 1) -> None:
        if count:
            self.counts[reason] = self.counts.get(reason, 0) + count


Placed = tuple[CommonsFile, int | None, Path]
"""A downloaded file, its year and where its bytes are."""


def _eligible(files: Sequence[CommonsFile], tally: _Tally) -> list[CommonsFile]:
    eligible: list[CommonsFile] = []
    for file in files:
        reason = _left_out_reason(file)
        if reason is None:
            eligible.append(file)
        else:
            tally(reason)
    return eligible


def _people(
    api: Api, eligible: Sequence[CommonsFile], tally: _Tally
) -> tuple[dict[str, list[Candidate]], dict[str, WikidataItem]]:
    """The eligible files by the one person each shows, and the Wikidata items read."""
    facts = media_facts(api, [file.pageid for file in eligible])
    links = _ancestry(api, {category for file in eligible for category in file.categories})
    items = wikidata_items(
        api,
        {link.item for link in links.values() if link.item is not None}
        | {value for fact in facts.values() for value in fact.depicts},
    )
    topics = {topic for item in items.values() for topic in item.main_topics} - items.keys()
    items.update(wikidata_items(api, topics))
    by_person: dict[str, list[Candidate]] = {}
    for file in eligible:
        if any(
            _GROUP_CATEGORY_RE.search(category)
            or len(category_mentions(category, links, items)) > 1
            for category in file.categories
        ):
            tally("several_people")
            continue
        fact = facts.get(file.pageid, NO_MEDIA_FACTS)
        named = frozenset().union(*(category_persons(c, links, items) for c in file.categories))
        person = identity_of(fact.depicts, named, items)
        if person is None:
            tally("no_single_person")
        else:
            by_person.setdefault(person, []).append((file, year_of(file.date, fact.inception)))
    return by_person, items


def _choose(
    by_person: Mapping[str, Sequence[Candidate]], per_identity: int, tally: _Tally
) -> dict[str, list[Candidate]]:
    """One copy of each SHA-1 (the earliest file page's), at most ``per_identity`` per person,
    people with two or more."""
    chosen: dict[str, list[Candidate]] = {}
    seen: set[str] = set()
    for person in sorted(by_person, key=_qnumber):
        distinct: list[Candidate] = []
        for candidate in sorted(by_person[person], key=lambda c: c[0].pageid):
            if candidate[0].sha1 in seen:
                tally("duplicate")
            else:
                seen.add(candidate[0].sha1)
                distinct.append(candidate)
        picked = spread(
            distinct, key=lambda c: (c[1] is None, c[1] or 0, c[0].title), cap=per_identity
        )
        tally("over_cap", len(distinct) - len(picked))
        if len(picked) < MIN_PHOTOS:
            tally("single_photo", len(picked))
        else:
            chosen[person] = picked
    return chosen


MIN_PHOTOS: Final = 2
"""A genuine pair needs two photos of one person."""


def _download_chosen(  # noqa: PLR0913 - the downloads' inputs
    chosen: Mapping[str, Sequence[Candidate]],
    staging: Path,
    opener: Opener,
    *,
    limiter: RateLimiter,
    jobs: int,
    tally: _Tally,
    log: Callable[[str], None],
) -> dict[str, list[Placed]]:
    """The chosen files downloaded, ``jobs`` at a time; people left with two photos or more."""
    wanted = [file for picked in chosen.values() for file, _ in picked]
    log(f"harvest: downloading {len(wanted)} originals of {len(chosen)} people")

    def fetch(file: CommonsFile) -> Path | FetchError:
        try:
            return _download_original(file, staging, opener, limiter)
        except FetchError as exc:
            log(f"harvest: left out {file.title}: {exc}")
            return exc

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        staged = dict(zip((file.sha1 for file in wanted), pool.map(fetch, wanted), strict=True))
    kept: dict[str, list[Placed]] = {}
    for person, picked in chosen.items():
        ok: list[Placed] = []
        for file, year in picked:
            outcome = staged[file.sha1]
            if isinstance(outcome, Path):
                ok.append((file, year, outcome))
        tally("download", len(picked) - len(ok))
        if len(ok) < MIN_PHOTOS:
            tally("single_photo", len(ok))
        else:
            kept[person] = ok
    return kept


def _identities(
    kept: Mapping[str, Sequence[Placed]],
    items: Mapping[str, WikidataItem],
    dest: Path,
    seed: int,
) -> list[dict[str, Any]]:
    """The manifest's identities, in a seeded order of pseudonymous ids, each image placed in
    ``dest`` under its id."""
    order = sorted(kept, key=_qnumber)
    random.Random(seed).shuffle(order)  # noqa: S311 - a reproducible order, not a secret
    identities: list[dict[str, Any]] = []
    for number, person in enumerate(order, start=1):
        identity = f"p{number:04d}"
        images: list[dict[str, Any]] = []
        for index, (file, year, path) in enumerate(kept[person], start=1):
            image_id = f"{identity}-{index}"
            _place(path, dest / f"{image_id}{path.suffix}")
            images.append(
                {
                    "id": image_id,
                    "url": file.url,
                    "source_page": file.source_page,
                    "revision_id": file.revision_id,
                    "sha256": sha256_file(path),
                    "sha1": file.sha1,
                    "size": file.size,
                    "license_template": licence_template_of(file.templates),
                    "year": year,
                }
            )
        identities.append({"id": identity, "sex": _sex(items.get(person)), "images": images})
    return identities


def harvest_calibration(  # noqa: PLR0913 - the harvest's inputs and its knobs
    api: Api,
    opener: Opener,
    dest: Path,
    manifest: Path,
    *,
    limiter: RateLimiter,
    roots: Sequence[str] = HARVEST_ROOTS,
    depth: int = HARVEST_DEPTH,
    per_identity: int = MAX_IMAGES_PER_IDENTITY,
    seed: int = HARVEST_SEED,
    jobs: int = MAX_CONNECTIONS,
    log: Callable[[str], None] = print,
    today: date | None = None,
) -> HarvestSummary:
    """Build the calibration manifest at ``manifest`` and its images in ``dest`` (see above)."""
    if not 1 <= jobs <= MAX_CONNECTIONS:
        raise ValueError(f"jobs must be from 1 to {MAX_CONNECTIONS}")
    tally = _Tally()
    titles = category_files(api, roots, depth)
    log(f"harvest: {len(titles)} files in {len(roots)} categories, {depth} levels down")
    files = commons_files(api, titles)
    tally("metadata", len(titles) - len(files))
    eligible = _eligible(files, tally)
    log(f"harvest: {len(eligible)} files eligible; resolving who each one shows")
    by_person, items = _people(api, eligible, tally)
    chosen = _choose(by_person, per_identity, tally)
    kept = _download_chosen(
        chosen, dest / ".harvest", opener, limiter=limiter, jobs=jobs, tally=tally, log=log
    )
    identities = _identities(kept, items, dest, seed)

    harvested = today if today is not None else datetime.now(UTC).date()
    document = {
        "schema_version": 1,
        **_manifest_text(roots, depth, per_identity, harvested),
        "identities": identities,
    }
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", "utf-8")
    load_calibration_manifest(manifest)  # the fetcher's own rules, as a last check
    count = sum(len(identity["images"]) for identity in identities)
    pairs = sum(len(i["images"]) * (len(i["images"]) - 1) // 2 for i in identities)
    reasons = ", ".join(f"{reason} {n}" for reason, n in sorted(tally.counts.items()))
    log(
        f"harvest: wrote {manifest}: {len(identities)} identities, {count} images, "
        f"{pairs} genuine pairs before the near-duplicate rule; left out: {reasons or 'none'}"
    )
    return HarvestSummary(
        files=len(titles), left_out=tally.counts, identities=len(identities), images=count
    )


# --- fetching -------------------------------------------------------------------------------------


def _download(  # noqa: PLR0913 - the download's inputs
    url: str,
    entry: Pinned,
    dest_dir: Path,
    opener: Opener,
    timeout: float,
    *,
    limiter: RateLimiter | None,
) -> None:
    """Download ``url`` into ``dest_dir / entry.filename`` if its size and SHA-256 match the pin.

    The bytes go to a temporary file in ``dest_dir``, moved into place only after the checks,
    so a failed or tampered download never replaces a file and never leaves one behind. With a
    ``limiter``, they count against its bandwidth cap (:meth:`RateLimiter.spend`)."""
    target = dest_dir / entry.filename
    dest_dir.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{entry.filename}.", suffix=".part", dir=dest_dir)
    tmp = Path(tmp_name)
    try:
        digest = hashlib.sha256()
        received = 0
        since = 0.0 if limiter is None else limiter.now()
        try:
            with os.fdopen(fd, "wb") as out, opener(url, timeout) as response:
                since = since if limiter is None else limiter.now()
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
            message = f"{entry.name}: HTTP {exc.code} {exc.reason} for {url}"
            if exc.code in GONE_STATUSES:
                raise NotFoundError(message) from exc
            raise FetchError(message) from exc
        except (OSError, http.client.HTTPException) as exc:  # pragma: no cover - network only
            raise FetchError(f"{entry.name}: download from {url} failed: {exc}") from exc
        finally:
            if limiter is not None:
                limiter.spend(received, since=since)

        actual = digest.hexdigest()
        if actual != entry.sha256:
            raise ChecksumMismatchError(
                f"{entry.name}: sha256 mismatch (expected {entry.sha256}, got {actual}); refusing"
            )
        tmp.chmod(0o644)  # mkstemp creates 0600; test containers may read these as another user
        tmp.replace(target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def fetch_fixture(
    entry: Pinned,
    dest_dir: Path,
    *,
    opener: Opener = default_opener,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    limiter: RateLimiter | None = None,
) -> FetchStatus:
    """Ensure ``dest_dir / entry.filename`` exists with the pinned digest.

    Returns ``"present"`` if a verified copy was already there, ``"downloaded"`` after fetching
    the pinned URL, and ``"archived"`` after fetching an archived revision of a re-uploaded
    Commons file (see the module docstring). With a ``limiter`` (the one behind ``opener``), every
    download counts against its bandwidth cap."""
    target = dest_dir / entry.filename
    if target.is_file() and sha256_file(target) == entry.sha256:
        return "present"
    try:
        _download(entry.url, entry, dest_dir, opener, timeout, limiter=limiter)
    except (ChecksumMismatchError, DownloadTooLargeError) as mismatch:
        name = commons_file_name(entry.url)
        if name is None:
            raise
        for url in _archived_urls(entry, name, opener, timeout, mismatch):
            try:
                _download(url, entry, dest_dir, opener, timeout, limiter=limiter)
            except (ChecksumMismatchError, DownloadTooLargeError):
                continue
            return "archived"
        raise ChecksumMismatchError(
            f"{mismatch}; no archived revision of {name} matches the pin"
        ) from mismatch
    return "downloaded"


Outcome = FetchStatus | FetchError


def fetch_all(
    entries: Sequence[Pinned],
    dest_dir: Path,
    opener: Opener,
    *,
    jobs: int,
    limiter: RateLimiter | None = None,
) -> list[Outcome]:
    """Fetch every entry with ``jobs`` downloads in flight at most, outcomes in entry order; with
    a ``limiter``, under its bandwidth cap."""
    if not 1 <= jobs <= MAX_CONNECTIONS:
        raise ValueError(f"jobs must be from 1 to {MAX_CONNECTIONS}")

    def one(entry: Pinned) -> Outcome:
        try:
            return fetch_fixture(entry, dest_dir, opener=opener, limiter=limiter)
        except FetchError as exc:
            return exc

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        return list(pool.map(one, entries))


def _non_negative(value: str) -> int:
    number = int(value)
    if number < 0:
        raise argparse.ArgumentTypeError("must be 0 or more")
    return number


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="the manifest (default: fixtures/manifest.json, or with --calibration "
        "fixtures/calibration-manifest.json)",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=None,
        help="download directory (default: <manifest dir>/faces, or with --calibration "
        "<manifest dir>/faces/calibration)",
    )
    parser.add_argument(
        "--forms-dest",
        type=Path,
        default=None,
        help="download directory of the federal forms (default: <manifest dir>/generated/"
        "federal-forms)",
    )
    parser.add_argument(
        "--only", action="append", metavar="NAME", help="fetch only this entry (repeatable)"
    )
    parser.add_argument(
        "--calibration", action="store_true", help="fetch the C49 calibration set instead"
    )
    parser.add_argument(
        "--harvest-calibration",
        action="store_true",
        help="build the C49 calibration manifest from Commons and download its images "
        "(writes --manifest, default fixtures/calibration-manifest.json)",
    )
    parser.add_argument(
        "--max-missing",
        type=_non_negative,
        default=DEFAULT_MAX_MISSING,
        help=f"calibration: deleted files tolerated (default {DEFAULT_MAX_MISSING})",
    )
    parser.add_argument(
        "--jobs",
        type=int,
        choices=range(1, MAX_CONNECTIONS + 1),
        default=MAX_CONNECTIONS,
        help=f"downloads in flight at once (at most {MAX_CONNECTIONS}, Wikimedia's limit)",
    )
    return parser


def _load(manifest: Path, *, calibration: bool) -> Sequence[Pinned]:
    if calibration:
        return load_calibration_manifest(manifest)
    return load_manifest(manifest)


def _chosen(
    manifest: Path, *, calibration: bool, only: Sequence[str] | None
) -> tuple[Sequence[Pinned], Sequence[Pinned]]:
    """The entries and federal forms a run fetches (a calibration run fetches no form). Raises
    :class:`ManifestError` for an invalid manifest, a name shared by a face and a form, or an
    ``--only`` name the manifest does not hold."""
    entries = _load(manifest, calibration=calibration)
    forms = [] if calibration else load_forms(manifest)
    shared = sorted({entry.name for entry in entries} & {form.name for form in forms})
    if shared:
        raise ManifestError(f"name(s) used by both a face and a form: {', '.join(shared)}")
    if not only:
        return entries, forms
    unknown = sorted(set(only) - {entry.name for entry in [*entries, *forms]})
    if unknown:
        raise ManifestError(f"not in manifest: {', '.join(unknown)}")
    return [entry for entry in entries if entry.name in only], [
        form for form in forms if form.name in only
    ]


def _harvest(args: argparse.Namespace, *, opener: Opener, clock: Clock, sleep: Sleep) -> int:
    manifest: Path = args.manifest if args.manifest is not None else DEFAULT_CALIBRATION_MANIFEST
    dest: Path = args.dest if args.dest is not None else manifest.parent / "faces" / "calibration"
    limiter = RateLimiter(clock=clock, sleep=sleep)
    polite = PoliteOpener(opener, limiter)
    try:
        harvest_calibration(
            MediaWikiApi(polite, limiter),
            polite,
            dest,
            manifest,
            limiter=limiter,
            roots=HARVEST_ROOTS,
            depth=HARVEST_DEPTH,
            jobs=args.jobs,
        )
    except FetchError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def main(
    argv: Sequence[str] | None = None,
    *,
    opener: Opener = default_opener,
    clock: Clock = time.monotonic,
    sleep: Sleep = time.sleep,
) -> int:
    args = _parser().parse_args(argv)
    if args.harvest_calibration:
        return _harvest(args, opener=opener, clock=clock, sleep=sleep)
    calibration: bool = args.calibration
    default = DEFAULT_CALIBRATION_MANIFEST if calibration else DEFAULT_MANIFEST
    manifest: Path = args.manifest if args.manifest is not None else default

    try:
        entries, forms = _chosen(manifest, calibration=calibration, only=args.only)
    except ManifestError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    faces = manifest.parent / "faces"
    dest: Path = (
        args.dest if args.dest is not None else faces / "calibration" if calibration else faces
    )
    forms_dest: Path = (
        args.forms_dest
        if args.forms_dest is not None
        else manifest.parent / "generated" / "federal-forms"
    )
    limiter = RateLimiter(clock=clock, sleep=sleep)
    polite = PoliteOpener(opener, limiter)
    missing = failures = archived = 0
    results: list[tuple[Pinned, Outcome, Path]] = []
    batches: tuple[tuple[Sequence[Pinned], Path], ...] = ((entries, dest), (forms, forms_dest))
    for chosen, where in batches:
        outcomes = fetch_all(chosen, where, polite, jobs=args.jobs, limiter=limiter)
        results += [(entry, done, where) for entry, done in zip(chosen, outcomes, strict=True)]
    for entry, outcome, where in results:
        if isinstance(outcome, NotFoundError) and calibration:
            missing += 1
            print(f"{entry.name}: MISSING: {outcome}", file=sys.stderr)
        elif isinstance(outcome, FetchError):
            failures += 1
            print(f"{entry.name}: FAILED: {outcome}", file=sys.stderr)
        else:
            if outcome == "archived":
                archived += 1
            print(f"{entry.name}: {outcome} {where / entry.filename} ({entry.license_template})")
    if archived:
        print(
            f"note: {archived} file(s) came from the Commons archive: the pinned URL now serves "
            "a re-upload, so pin the archive URL in the manifest"
        )
    if not calibration:
        return 1 if failures else 0
    used = len(entries) - missing - failures
    summary = (
        f"calibration: used {used} of {len(entries)} images "
        f"({missing} missing, deleted on Commons; {failures} failed)"
    )
    if failures or missing > args.max_missing:
        print(f"{summary}; at most {args.max_missing} may be missing", file=sys.stderr)
        return 1
    print(summary)
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by the subprocess smoke test
    raise SystemExit(main())
