"""scripts/fetch_fixtures.py: Wikimedia etiquette and re-uploaded files (C48, research §10.2).

- Request starts are at least 1 s apart, and at most 2 requests are in flight.
- 429 and 503 answers are retried after ``Retry-After`` (seconds or an HTTP date), else after an
  exponential backoff; the script gives up after a few attempts or a wait it will not make.
- A pinned Commons original whose bytes changed (a re-upload) is fetched from its archived
  revision, found through the Commons API by the pinned SHA-1 (else the size), and accepted only
  with the pinned SHA-256.

The web is :class:`fetch_script.FakeWeb` and time is :class:`fetch_script.FakeClock`: no network,
no real waiting. Payloads are plain bytes, never a photo.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import threading
import urllib.parse
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from fetch_script import FakeClock, FakeWeb, Reply, load_script

PAYLOAD = b"deterministic test bytes, not a photo" * 20
PAYLOAD_SHA256 = hashlib.sha256(PAYLOAD).hexdigest()
PAYLOAD_SHA1 = hashlib.sha1(PAYLOAD).hexdigest()  # noqa: S324 - Commons pins SHA-1
NAME = "Jim_Lovell_official_1964_portrait.jpg"
URL = f"https://upload.wikimedia.org/wikipedia/commons/9/98/{NAME}"
ARCHIVED = f"https://upload.wikimedia.org/wikipedia/commons/archive/9/98/20151212114455%21{NAME}"
OLDER = f"https://upload.wikimedia.org/wikipedia/commons/archive/9/98/20120101000000%21{NAME}"
PINNED_REVISION = {
    "sha1": PAYLOAD_SHA1,
    "size": len(PAYLOAD),
    "archivename": f"20151212114455!{NAME}",
}
"""The archived revision whose bytes are the pinned ones."""


@pytest.fixture(scope="module")
def ff() -> ModuleType:
    return load_script()


def entry(ff: ModuleType, **overrides: Any) -> Any:
    raw: dict[str, Any] = {
        "name": "person_x",
        "person": "A",
        "role": "selfie",
        "filename": "person-x.jpg",
        "source_page": f"https://commons.wikimedia.org/wiki/File:{NAME}",
        "url": URL,
        "sha256": PAYLOAD_SHA256,
        "sha1": PAYLOAD_SHA1,
        "size": len(PAYLOAD),
        "license": "public-domain",
        "license_template": "PD-USGov-NASA",
        "author": "NASA",
        "face_box": [1, 2, 3, 4],
    }
    raw.update(overrides)
    return ff.FaceFixture.from_dict({k: v for k, v in raw.items() if v is not None})


def manifest(path: Path, count: int) -> Path:
    faces = []
    for index in range(count):
        faces.append(
            {
                "name": f"face_{index}",
                "person": "A",
                "role": "selfie",
                "filename": f"face-{index}.jpg",
                "source_page": "https://commons.wikimedia.org/wiki/File:X.jpg",
                "url": f"https://upload.example.invalid/{index}.jpg",
                "sha256": PAYLOAD_SHA256,
                "size": len(PAYLOAD),
                "license": "public-domain",
                "license_template": "PD-USGov-NASA",
                "author": "NASA",
                "face_box": [1, 2, 3, 4],
            }
        )
    path.write_text(json.dumps({"schema_version": 1, "faces": faces}), encoding="utf-8")
    return path


def polite(ff: ModuleType, web: FakeWeb, clock: FakeClock) -> Any:
    return ff.PoliteOpener(web, ff.RateLimiter(clock=clock, sleep=clock.sleep))


# --- spacing and connections ----------------------------------------------------------------------


def test_the_policy_constants_are_wikimedias(ff: ModuleType) -> None:
    assert ff.MIN_REQUEST_INTERVAL_SECONDS >= 1.0
    assert ff.MAX_CONNECTIONS == 2


def test_request_starts_are_at_least_one_second_apart(ff: ModuleType, tmp_path: Path) -> None:
    clock = FakeClock()
    routes = {f"https://upload.example.invalid/{i}.jpg": Reply(body=PAYLOAD) for i in range(4)}
    web = FakeWeb(routes, clock)

    code = ff.main(
        ["--manifest", str(manifest(tmp_path / "m.json", 4))],
        opener=web,
        clock=clock,
        sleep=clock.sleep,
    )

    assert code == 0
    assert len(web.calls) == 4
    starts = sorted(web.times)
    assert all(b - a >= 1.0 for a, b in itertools.pairwise(starts))
    # Spacing, not slowness: the first request waits for nothing and no gap exceeds the interval.
    assert starts[0] == 1000.0
    assert starts[-1] - starts[0] == pytest.approx(3.0)


def test_a_verified_file_needs_no_request_and_no_wait(ff: ModuleType, tmp_path: Path) -> None:
    clock = FakeClock()
    web = FakeWeb({"https://upload.example.invalid/0.jpg": Reply(body=PAYLOAD)}, clock)
    path = manifest(tmp_path / "m.json", 1)
    ff.main(["--manifest", str(path)], opener=web, clock=clock, sleep=clock.sleep)

    ff.main(["--manifest", str(path)], opener=web, clock=clock, sleep=clock.sleep)

    assert len(web.calls) == 1
    assert clock.sleeps == []


def test_two_downloads_run_at_once_but_never_more(ff: ModuleType, tmp_path: Path) -> None:
    clock = FakeClock()
    routes = {f"https://upload.example.invalid/{i}.jpg": Reply(body=PAYLOAD) for i in range(6)}
    # The first two responses wait for each other: they must be open at the same time.
    web = FakeWeb(routes, clock, barrier=threading.Barrier(2, timeout=10))

    code = ff.main(
        ["--manifest", str(manifest(tmp_path / "m.json", 6))],
        opener=web,
        clock=clock,
        sleep=clock.sleep,
    )

    assert code == 0
    assert web.max_in_flight == 2


def test_one_job_downloads_one_file_at_a_time(ff: ModuleType, tmp_path: Path) -> None:
    clock = FakeClock()
    routes = {f"https://upload.example.invalid/{i}.jpg": Reply(body=PAYLOAD) for i in range(3)}
    web = FakeWeb(routes, clock)

    code = ff.main(
        ["--manifest", str(manifest(tmp_path / "m.json", 3)), "--jobs", "1"],
        opener=web,
        clock=clock,
        sleep=clock.sleep,
    )

    assert code == 0
    assert web.max_in_flight == 1


def test_more_than_two_connections_are_refused(ff: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as exited:
        ff.main(["--manifest", str(manifest(tmp_path / "m.json", 1)), "--jobs", "3"])
    assert exited.value.code == 2


# --- 429 and 503 ----------------------------------------------------------------------------------


def test_retry_after_in_seconds_is_honoured(ff: ModuleType, tmp_path: Path) -> None:
    clock = FakeClock()
    web = FakeWeb({URL: [Reply(429, headers={"Retry-After": "7"}), Reply(body=PAYLOAD)]}, clock)

    status = ff.fetch_fixture(entry(ff), tmp_path, opener=polite(ff, web, clock))

    assert status == "downloaded"
    first, second = web.times
    assert second - first >= 7.0
    assert (tmp_path / "person-x.jpg").read_bytes() == PAYLOAD


def test_a_503_with_retry_after_is_retried_like_a_429(ff: ModuleType, tmp_path: Path) -> None:
    clock = FakeClock()
    web = FakeWeb({URL: [Reply(503, headers={"Retry-After": "3"}), Reply(body=PAYLOAD)]}, clock)

    assert ff.fetch_fixture(entry(ff), tmp_path, opener=polite(ff, web, clock)) == "downloaded"
    first, second = web.times
    assert second - first >= 3.0


def test_without_retry_after_the_backoff_doubles(ff: ModuleType, tmp_path: Path) -> None:
    clock = FakeClock()
    web = FakeWeb({URL: [Reply(429), Reply(429), Reply(body=PAYLOAD)]}, clock)

    assert ff.fetch_fixture(entry(ff), tmp_path, opener=polite(ff, web, clock)) == "downloaded"
    first, second, third = web.times
    assert second - first >= 2.0
    assert third - second >= 4.0


def test_a_short_retry_after_still_keeps_the_spacing(ff: ModuleType, tmp_path: Path) -> None:
    clock = FakeClock()
    web = FakeWeb({URL: [Reply(429, headers={"Retry-After": "0"}), Reply(body=PAYLOAD)]}, clock)

    assert ff.fetch_fixture(entry(ff), tmp_path, opener=polite(ff, web, clock)) == "downloaded"
    first, second = web.times
    assert second - first >= 1.0


def test_it_gives_up_after_a_few_attempts_and_leaves_nothing(
    ff: ModuleType, tmp_path: Path
) -> None:
    clock = FakeClock()
    web = FakeWeb({URL: Reply(429, headers={"Retry-After": "2"})}, clock)

    with pytest.raises(ff.RateLimitedError, match="429"):
        ff.fetch_fixture(entry(ff), tmp_path, opener=polite(ff, web, clock))

    assert 2 <= len(web.calls) <= 8
    assert list(tmp_path.iterdir()) == []


def test_it_refuses_to_wait_longer_than_its_cap(ff: ModuleType, tmp_path: Path) -> None:
    clock = FakeClock()
    web = FakeWeb({URL: Reply(429, headers={"Retry-After": "86400"})}, clock)

    with pytest.raises(ff.RateLimitedError, match="86400"):
        ff.fetch_fixture(entry(ff), tmp_path, opener=polite(ff, web, clock))

    assert len(web.calls) == 1
    assert sum(clock.sleeps) < 60


def test_other_errors_are_not_retried(ff: ModuleType, tmp_path: Path) -> None:
    clock = FakeClock()
    web = FakeWeb({URL: Reply(500)}, clock)

    with pytest.raises(ff.FetchError, match="500") as raised:
        ff.fetch_fixture(entry(ff), tmp_path, opener=polite(ff, web, clock))

    assert not isinstance(raised.value, ff.RateLimitedError)
    assert len(web.calls) == 1


@pytest.mark.parametrize("status", [404, 410])
def test_a_deleted_file_is_a_not_found_error(ff: ModuleType, tmp_path: Path, status: int) -> None:
    web = FakeWeb({URL: Reply(status)})

    with pytest.raises(ff.NotFoundError, match=str(status)):
        ff.fetch_fixture(entry(ff), tmp_path, opener=web)

    assert list(tmp_path.iterdir()) == []


def test_retry_after_values(ff: ModuleType) -> None:
    now = datetime(2026, 10, 21, 12, 0, 0, tzinfo=UTC)
    in_ninety = (now + timedelta(seconds=90)).strftime("%a, %d %b %Y %H:%M:%S GMT")
    past = (now - timedelta(seconds=90)).strftime("%a, %d %b %Y %H:%M:%S GMT")

    assert ff.retry_after_seconds("120", now) == 120.0
    assert ff.retry_after_seconds(" 5 ", now) == 5.0
    assert ff.retry_after_seconds(in_ninety, now) == pytest.approx(90.0)
    assert ff.retry_after_seconds(past, now) == 0.0
    assert ff.retry_after_seconds(None, now) is None
    assert ff.retry_after_seconds("soon", now) is None
    assert ff.retry_after_seconds("-5", now) is None


# --- the archive fallback for re-uploaded Commons files -------------------------------------------


def test_commons_file_name_reads_an_original_url(ff: ModuleType) -> None:
    assert ff.commons_file_name(URL) == NAME
    hammock = (
        "https://upload.wikimedia.org/wikipedia/commons/3/3f/Christina_M._Hammock_portrait.jpg"
    )
    assert ff.commons_file_name(hammock) == "Christina_M._Hammock_portrait.jpg"
    encoded = "https://upload.wikimedia.org/wikipedia/commons/8/8c/Christina_Koch_official_portrait_in_an_EMU.jpg"
    assert ff.commons_file_name(encoded) == "Christina_Koch_official_portrait_in_an_EMU.jpg"


@pytest.mark.parametrize(
    "url",
    [
        f"https://upload.wikimedia.org/wikipedia/commons/1/12/{NAME}",  # wrong hash directories
        f"https://upload.wikimedia.org/wikipedia/commons/9/98/{NAME}?utm_source=x",
        f"https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/{NAME}/500px-{NAME}",
        f"http://upload.wikimedia.org/wikipedia/commons/9/98/{NAME}",
        f"https://upload.example.invalid/wikipedia/commons/9/98/{NAME}",
        "https://upload.wikimedia.org/wikipedia/commons/9/98/",
    ],
)
def test_commons_file_name_refuses_anything_else(ff: ModuleType, url: str) -> None:
    assert ff.commons_file_name(url) is None


def test_archive_url_is_the_superseded_revisions_path(ff: ModuleType) -> None:
    # The research's verified example (research §10.2): `!` is escaped as %21.
    assert ff.archive_url(NAME, f"20151212114455!{NAME}") == ARCHIVED


@pytest.mark.parametrize(
    "archivename", [f"2015!{NAME}", "20151212114455!Other.jpg", NAME, f"20151212114455!{NAME}/x"]
)
def test_archive_url_refuses_another_files_revision(ff: ModuleType, archivename: str) -> None:
    with pytest.raises(ValueError, match="archivename"):
        ff.archive_url(NAME, archivename)


def imageinfo(*revisions: dict[str, Any]) -> Reply:
    page = {"title": f"File:{NAME}", "imageinfo": list(revisions)}
    return Reply(body=json.dumps({"query": {"pages": [page]}}).encode())


def test_a_re_uploaded_file_is_fetched_from_its_archived_revision(
    ff: ModuleType, tmp_path: Path
) -> None:
    reuploaded = b"a cropped re-upload with other bytes"
    api = ff.commons_api_url(NAME)
    web = FakeWeb(
        {
            URL: Reply(body=reuploaded),
            api: imageinfo(
                {"sha1": "0" * 40, "size": len(reuploaded)},
                {"sha1": "1" * 40, "size": 5, "archivename": f"20120101000000!{NAME}"},
                PINNED_REVISION,
            ),
            ARCHIVED: Reply(body=PAYLOAD),
        }
    )

    status = ff.fetch_fixture(entry(ff), tmp_path, opener=web)

    assert status == "archived"
    assert web.urls == [URL, api, ARCHIVED]
    assert (tmp_path / "person-x.jpg").read_bytes() == PAYLOAD
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(api).query)
    assert query["titles"] == [f"File:{NAME}"]
    assert set(query["iiprop"][0].split("|")) >= {"sha1", "size", "archivename"}


def test_without_a_pinned_sha1_the_revision_is_found_by_size(
    ff: ModuleType, tmp_path: Path
) -> None:
    same_size_other_bytes = bytes(len(PAYLOAD))
    api = ff.commons_api_url(NAME)
    web = FakeWeb(
        {
            URL: Reply(body=b"re-upload"),
            api: imageinfo(
                {"sha1": "0" * 40, "size": 9},
                {"sha1": "1" * 40, "size": len(PAYLOAD), "archivename": f"20120101000000!{NAME}"},
                {"sha1": "2" * 40, "size": len(PAYLOAD), "archivename": f"20151212114455!{NAME}"},
            ),
            OLDER: Reply(body=same_size_other_bytes),
            ARCHIVED: Reply(body=PAYLOAD),
        }
    )

    status = ff.fetch_fixture(entry(ff, sha1=None), tmp_path, opener=web)

    assert status == "archived"
    assert web.urls == [URL, api, OLDER, ARCHIVED]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["person-x.jpg"]


def test_no_matching_revision_keeps_the_digest_mismatch(ff: ModuleType, tmp_path: Path) -> None:
    api = ff.commons_api_url(NAME)
    web = FakeWeb(
        {
            URL: Reply(body=b"re-upload"),
            api: imageinfo(
                {"sha1": "1" * 40, "size": 3, "archivename": f"20120101000000!{NAME}"},
                {"sha1": PAYLOAD_SHA1, "size": len(PAYLOAD), "archivename": f"2015!{NAME}"},
            ),
        }
    )

    with pytest.raises(ff.ChecksumMismatchError, match="archive"):
        ff.fetch_fixture(entry(ff), tmp_path, opener=web)

    assert web.urls == [URL, api]
    assert list(tmp_path.iterdir()) == []


def test_an_archived_revision_must_still_match_the_pinned_sha256(
    ff: ModuleType, tmp_path: Path
) -> None:
    api = ff.commons_api_url(NAME)
    web = FakeWeb(
        {
            URL: Reply(body=b"re-upload"),
            api: imageinfo(PINNED_REVISION),
            ARCHIVED: Reply(body=b"x" * len(PAYLOAD)),
        }
    )

    with pytest.raises(ff.ChecksumMismatchError):
        ff.fetch_fixture(entry(ff), tmp_path, opener=web)

    assert list(tmp_path.iterdir()) == []


def test_a_larger_re_upload_also_falls_back(ff: ModuleType, tmp_path: Path) -> None:
    api = ff.commons_api_url(NAME)
    web = FakeWeb(
        {
            URL: Reply(body=PAYLOAD * 3),
            api: imageinfo(PINNED_REVISION),
            ARCHIVED: Reply(body=PAYLOAD),
        }
    )

    assert ff.fetch_fixture(entry(ff), tmp_path, opener=web) == "archived"


def test_a_file_off_commons_has_no_archive_to_fall_back_on(ff: ModuleType, tmp_path: Path) -> None:
    other = "https://upload.example.invalid/faces/person.jpg"
    web = FakeWeb({other: Reply(body=b"tampered")})

    with pytest.raises(ff.ChecksumMismatchError):
        ff.fetch_fixture(entry(ff, url=other), tmp_path, opener=web)

    assert web.urls == [other]


def test_a_failed_archive_lookup_is_reported_with_the_mismatch(
    ff: ModuleType, tmp_path: Path
) -> None:
    api = ff.commons_api_url(NAME)
    web = FakeWeb({URL: Reply(body=b"re-upload"), api: Reply(500)})

    with pytest.raises(ff.ChecksumMismatchError, match="archive lookup"):
        ff.fetch_fixture(entry(ff), tmp_path, opener=web)


@pytest.mark.parametrize("body", [b"not json", b"[]", b'{"query": {"pages": [{"imageinfo": 5}]}}'])
def test_an_unreadable_archive_answer_is_a_mismatch(
    ff: ModuleType, tmp_path: Path, body: bytes
) -> None:
    api = ff.commons_api_url(NAME)
    web = FakeWeb({URL: Reply(body=b"re-upload"), api: Reply(body=body)})

    with pytest.raises(ff.ChecksumMismatchError):
        ff.fetch_fixture(entry(ff), tmp_path, opener=web)


def test_a_retry_after_date_without_a_zone_is_read_as_utc(ff: ModuleType) -> None:
    now = datetime(2026, 10, 21, 12, 0, 0, tzinfo=UTC)

    assert ff.retry_after_seconds("Wed, 21 Oct 2026 12:00:30 -0000", now) == pytest.approx(30.0)


@pytest.mark.parametrize(
    "body",
    [
        b'{"query": {}}',
        b'{"query": []}',
        b'{"query": {"pages": [5]}}',
        b"{" + b" " * (1 << 20) + b"}",
    ],
    ids=["no pages", "query not an object", "page not an object", "oversized"],
)
def test_an_archive_answer_of_the_wrong_shape_is_a_mismatch(
    ff: ModuleType, tmp_path: Path, body: bytes
) -> None:
    api = ff.commons_api_url(NAME)
    web = FakeWeb({URL: Reply(body=b"re-upload"), api: Reply(body=body)})

    with pytest.raises(ff.ChecksumMismatchError, match="archive lookup"):
        ff.fetch_fixture(entry(ff), tmp_path, opener=web)


def test_at_most_three_archived_revisions_are_tried(ff: ModuleType, tmp_path: Path) -> None:
    stamps = [f"2015010100000{i}" for i in range(5)]
    revisions = [
        {"sha1": PAYLOAD_SHA1, "size": len(PAYLOAD), "archivename": f"{stamp}!{NAME}"}
        for stamp in stamps
    ]
    api = ff.commons_api_url(NAME)
    web = FakeWeb(
        {
            URL: Reply(body=b"re-upload"),
            api: imageinfo(*revisions),
            **{ff.archive_url(NAME, f"{s}!{NAME}"): Reply(body=b"wrong") for s in stamps},
        }
    )

    with pytest.raises(ff.ChecksumMismatchError, match="no archived revision"):
        ff.fetch_fixture(entry(ff), tmp_path, opener=web)

    assert len(web.urls) == 2 + ff.MAX_ARCHIVE_CANDIDATES
