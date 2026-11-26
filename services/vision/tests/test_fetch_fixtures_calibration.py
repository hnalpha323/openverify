"""scripts/fetch_fixtures.py --calibration: the C49 face-match calibration set.

``fixtures/calibration-manifest.json`` (Workflow 4B builds it) lists pseudonymous identities
(``p0001``) and their Commons ``PD-USGov-NASA``, ``-DOS`` and ``-Military*`` originals, each
pinned by URL (no query string), SHA-256, size, Commons SHA-1 and the file page's revision id.
The run tolerates a few deleted files (404 or 410) and says how many images it used, but fails
on any digest mismatch. Manifests here are written by the tests; payloads are plain bytes.
"""

from __future__ import annotations

import copy
import hashlib
import itertools
import json
import threading
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from fetch_script import FakeClock, FakeWeb, Reply, load_script


def payload(index: int) -> bytes:
    return f"calibration test bytes {index}, not a photo".encode() * 10


def commons_url(name: str) -> str:
    digest = hashlib.md5(name.encode()).hexdigest()  # noqa: S324 - Commons' directory scheme
    return f"https://upload.wikimedia.org/wikipedia/commons/{digest[0]}/{digest[:2]}/{name}"


def image(identity: str, number: int, index: int, **overrides: Any) -> dict[str, Any]:
    name = f"Official_portrait_{index}.jpg"
    data = payload(index)
    raw: dict[str, Any] = {
        "id": f"{identity}-{number}",
        "url": commons_url(name),
        "source_page": f"https://commons.wikimedia.org/wiki/File:{name}",
        "revision_id": 100_000 + index,
        "sha256": hashlib.sha256(data).hexdigest(),
        "sha1": hashlib.sha1(data).hexdigest(),  # noqa: S324 - Commons pins SHA-1
        "size": len(data),
        "license_template": "PD-USGov-NASA",
        "year": 2000 + index,
    }
    raw.update(overrides)
    return raw


def document(images: int = 5) -> dict[str, Any]:
    """Two identities: p0001 with three images, p0002 with the rest."""
    owned: dict[str, list[dict[str, Any]]] = {"p0001": [], "p0002": []}
    for index in range(images):
        identity = "p0001" if index < 3 else "p0002"
        owned[identity].append(image(identity, len(owned[identity]) + 1, index))
    identities = [
        {"id": "p0001", "sex": "female", "images": owned["p0001"]},
        {"id": "p0002", "sex": "male", "images": owned["p0002"]},
    ]
    return {
        "schema_version": 1,
        "description": "test calibration set",
        "purpose": "measure the face-match error rates of the pipeline",
        "takedown": "remove the identity's entry and rerun",
        "identities": identities,
    }


def write(path: Path, content: dict[str, Any]) -> Path:
    path.write_text(json.dumps(content), encoding="utf-8")
    return path


def web_for(content: dict[str, Any], clock: FakeClock, missing: dict[str, int]) -> FakeWeb:
    routes: dict[str, Reply | list[Reply]] = {}
    for identity in content["identities"]:
        for entry in identity["images"]:
            index = int(entry["revision_id"]) - 100_000
            status = missing.get(entry["id"])
            routes[entry["url"]] = Reply(status) if status else Reply(body=payload(index))
    return FakeWeb(routes, clock)


@pytest.fixture(scope="module")
def ff() -> ModuleType:
    return load_script()


# --- the manifest ---------------------------------------------------------------------------------


def test_the_manifest_lists_every_image_with_its_identity(ff: ModuleType, tmp_path: Path) -> None:
    images = ff.load_calibration_manifest(write(tmp_path / "c.json", document()))

    assert [i.name for i in images] == ["p0001-1", "p0001-2", "p0001-3", "p0002-1", "p0002-2"]
    first = images[0]
    assert first.identity == "p0001"
    assert first.filename == "p0001-1.jpg"
    assert first.revision_id == 100_000
    assert first.license_template == "PD-USGov-NASA"
    assert len(first.sha1) == 40


@pytest.mark.parametrize(
    "template",
    [
        "PD-USGov-NASA",
        "PD-USGov-DOS",
        "PD-USGov-Military",
        "PD-USGov-Military-Air Force",
        "PD-USGov-Military-Marine Corps",
        "PD-USGov-Military-National Guard",
    ],
)
def test_nasa_state_and_military_templates_are_accepted(
    ff: ModuleType, tmp_path: Path, template: str
) -> None:
    content = document()
    content["identities"][0]["images"][0]["license_template"] = template

    images = ff.load_calibration_manifest(write(tmp_path / "c.json", content))

    assert images[0].license_template == template


def broken(path: tuple[Any, ...], value: Any) -> dict[str, Any]:
    """The test manifest with the value at ``path`` replaced (or deleted when ``value`` is ...)."""
    content = copy.deepcopy(document())
    target: Any = content
    for key in path[:-1]:
        target = target[key]
    if value is ...:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    return content


IMAGE = ("identities", 0, "images", 0)


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("schema_version",), 2, "schema_version"),
        (("purpose",), "", "purpose"),
        (("takedown",), ..., "takedown"),
        (("identities", 0, "id"), "person-1", "id"),
        (("identities", 0, "id"), "p1", "id"),
        (("identities", 1, "id"), "p0001", "duplicate"),
        (("identities", 0, "sex"), "f", "sex"),
        (("identities", 0, "name"), "Jane Doe", "unknown field"),
        (("identities", 0, "images"), [], "image"),
        ((*IMAGE, "id"), "p0002-1", "p0001"),
        ((*IMAGE, "id"), "p0001-0", "id"),
        ((*IMAGE, "url"), commons_url("Official_portrait_0.jpg") + "?utm_source=x", "url"),
        ((*IMAGE, "url"), "https://upload.example.invalid/a.jpg", "url"),
        ((*IMAGE, "url"), commons_url("Official_portrait_0.gif"), "url"),
        ((*IMAGE, "source_page"), "https://commons.wikimedia.org/wiki/File:Other.jpg", "source"),
        ((*IMAGE, "license_template"), "PD-USGov-Congress", "license_template"),
        ((*IMAGE, "license_template"), "PD-USGov", "license_template"),
        ((*IMAGE, "license_template"), "PD-self", "license_template"),
        ((*IMAGE, "license_template"), "PD-USGov-Military-Air  Force", "license_template"),
        ((*IMAGE, "sha1"), ..., "sha1"),
        ((*IMAGE, "sha1"), "abc", "sha1"),
        ((*IMAGE, "sha256"), "ABC", "sha256"),
        ((*IMAGE, "size"), 0, "size"),
        ((*IMAGE, "revision_id"), 0, "revision_id"),
        ((*IMAGE, "revision_id"), "12", "revision_id"),
        ((*IMAGE, "year"), 1850, "year"),
        ((*IMAGE, "review"), {"decision": "exclude"}, "reason"),
        ((*IMAGE, "review"), {"decision": "exclude", "reason": "low_score"}, "reason"),
        ((*IMAGE, "review"), {"decision": "maybe"}, "decision"),
        ((*IMAGE, "review"), {"decision": "keep", "reason": "misattribution"}, "reason"),
        ((*IMAGE, "subject"), "Jane Doe", "unknown field"),
    ],
)
def test_a_manifest_that_breaks_a_rule_is_refused(
    ff: ModuleType, tmp_path: Path, path: tuple[Any, ...], value: Any, message: str
) -> None:
    with pytest.raises(ff.ManifestError, match=message):
        ff.load_calibration_manifest(write(tmp_path / "c.json", broken(path, value)))


def test_the_same_file_twice_is_refused(ff: ModuleType, tmp_path: Path) -> None:
    content = document()
    content["identities"][1]["images"][0]["sha256"] = content["identities"][0]["images"][0][
        "sha256"
    ]

    with pytest.raises(ff.ManifestError, match="duplicate"):
        ff.load_calibration_manifest(write(tmp_path / "c.json", content))


def test_review_decisions_are_accepted(ff: ModuleType, tmp_path: Path) -> None:
    content = document()
    content["identities"][0]["images"][1]["review"] = {"decision": "keep"}
    content["identities"][0]["images"][2]["review"] = {
        "decision": "exclude",
        "reason": "different_person_per_metadata",
    }
    content["identities"][1]["images"][0]["year"] = None

    assert len(ff.load_calibration_manifest(write(tmp_path / "c.json", content))) == 5


@pytest.mark.parametrize("raw", ["not json", "[]", '{"identities": {}}'])
def test_a_malformed_manifest_is_refused(ff: ModuleType, tmp_path: Path, raw: str) -> None:
    path = tmp_path / "c.json"
    path.write_text(raw, encoding="utf-8")

    with pytest.raises(ff.ManifestError):
        ff.load_calibration_manifest(path)


def test_a_missing_manifest_is_refused(ff: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(ff.ManifestError, match="manifest"):
        ff.load_calibration_manifest(tmp_path / "absent.json")


# --- the run --------------------------------------------------------------------------------------


def run(ff: ModuleType, manifest: Path, web: FakeWeb, clock: FakeClock, *extra: str) -> int:
    code: int = ff.main(
        ["--calibration", "--manifest", str(manifest), *extra],
        opener=web,
        clock=clock,
        sleep=clock.sleep,
    )
    return code


def test_a_few_deleted_files_are_tolerated_and_counted(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    content = document()
    clock = FakeClock()
    web = web_for(content, clock, {"p0001-2": 404, "p0002-1": 410})

    code = run(ff, write(tmp_path / "c.json", content), web, clock)

    assert code == 0
    dest = tmp_path / "faces" / "calibration"
    assert sorted(p.name for p in dest.iterdir()) == ["p0001-1.jpg", "p0001-3.jpg", "p0002-2.jpg"]
    out = capsys.readouterr().out
    assert "used 3 of 5 images" in out
    assert "2 missing" in out


def test_more_missing_files_than_allowed_fail_the_run(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    content = document()
    clock = FakeClock()
    web = web_for(content, clock, {"p0001-2": 404, "p0002-1": 404})

    code = run(ff, write(tmp_path / "c.json", content), web, clock, "--max-missing", "1")

    assert code == 1
    assert "2 missing" in capsys.readouterr().err


def test_any_digest_mismatch_fails_the_run(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    content = document()
    clock = FakeClock()
    tampered = content["identities"][1]["images"][1]
    name = tampered["url"].rsplit("/", 1)[1]
    web = FakeWeb(
        {
            **{url: Reply(body=payload(i)) for i, url in enumerate(urls(content))},
            tampered["url"]: Reply(body=b"tampered"),
            ff.commons_api_url(name): Reply(body=b'{"query": {"pages": [{"imageinfo": []}]}}'),
        },
        clock,
    )

    code = run(ff, write(tmp_path / "c.json", content), web, clock)

    assert code == 1
    assert "p0002-2" in capsys.readouterr().err


def urls(content: dict[str, Any]) -> list[str]:
    return [entry["url"] for identity in content["identities"] for entry in identity["images"]]


def test_dest_and_only_select_where_and_what(ff: ModuleType, tmp_path: Path) -> None:
    content = document()
    clock = FakeClock()
    web = web_for(content, clock, {})

    code = run(
        ff,
        write(tmp_path / "c.json", content),
        web,
        clock,
        "--dest",
        str(tmp_path / "x"),
        "--only",
        "p0002-2",
    )

    assert code == 0
    assert [p.name for p in (tmp_path / "x").iterdir()] == ["p0002-2.jpg"]
    assert len(web.calls) == 1


def test_an_invalid_calibration_manifest_exits_2(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    clock = FakeClock()
    code = run(ff, write(tmp_path / "c.json", broken(("purpose",), "")), FakeWeb({}), clock)

    assert code == 2
    assert "purpose" in capsys.readouterr().err


def test_the_default_calibration_manifest_is_the_committed_path(ff: ModuleType) -> None:
    root = Path(__file__).resolve().parents[3]
    assert root / "fixtures" / "calibration-manifest.json" == ff.DEFAULT_CALIBRATION_MANIFEST


def test_a_deleted_face_fixture_still_fails_the_default_mode(
    ff: ModuleType, tmp_path: Path
) -> None:
    faces = {
        "schema_version": 1,
        "faces": [
            {
                "name": "a",
                "person": "A",
                "role": "selfie",
                "filename": "a.jpg",
                "source_page": "https://commons.wikimedia.org/wiki/File:X.jpg",
                "url": "https://upload.example.invalid/a.jpg",
                "sha256": "0" * 64,
                "size": 3,
                "license": "public-domain",
                "license_template": "PD-USGov-NASA",
                "author": "NASA",
                "face_box": [1, 2, 3, 4],
            }
        ],
    }
    clock = FakeClock()

    code = ff.main(
        ["--manifest", str(write(tmp_path / "m.json", faces))],
        opener=FakeWeb({}, clock),
        clock=clock,
        sleep=clock.sleep,
    )

    assert code == 1


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("identities", 0), "p0001", "identity #0 must be an object"),
        (("identities", 0, "images", 0), "p0001-1.jpg", "an image must be an object"),
        ((*IMAGE, "review"), "exclude", "review must be an object"),
        ((*IMAGE, "source_page"), "https://example.invalid/File:X.jpg", "source_page must start"),
        ((*IMAGE, "year"), True, "year"),
    ],
)
def test_entries_of_the_wrong_shape_are_refused(
    ff: ModuleType, tmp_path: Path, path: tuple[Any, ...], value: Any, message: str
) -> None:
    with pytest.raises(ff.ManifestError, match=message):
        ff.load_calibration_manifest(write(tmp_path / "c.json", broken(path, value)))


def test_a_negative_max_missing_is_refused(ff: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as exited:
        ff.main(["--calibration", "--manifest", str(tmp_path / "c.json"), "--max-missing", "-1"])
    assert exited.value.code == 2


def test_fetch_all_refuses_more_jobs_than_connections(ff: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="jobs"):
        ff.fetch_all([], tmp_path, FakeWeb({}), jobs=ff.MAX_CONNECTIONS + 1)
    with pytest.raises(ValueError, match="jobs"):
        ff.fetch_all([], tmp_path, FakeWeb({}), jobs=0)


def test_a_file_from_the_archive_is_reported_with_a_hint_to_pin_it(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    content = document()
    entry = content["identities"][0]["images"][0]
    name = entry["url"].rsplit("/", 1)[1]
    archivename = f"20151212114455!{name}"
    revision = {"sha1": entry["sha1"], "size": entry["size"], "archivename": archivename}
    clock = FakeClock()
    web = FakeWeb(
        {
            entry["url"]: Reply(body=b"a re-upload"),
            ff.commons_api_url(name): Reply(
                body=json.dumps({"query": {"pages": [{"imageinfo": [revision]}]}}).encode()
            ),
            ff.archive_url(name, archivename): Reply(body=payload(0)),
        },
        clock,
    )

    code = run(ff, write(tmp_path / "c.json", content), web, clock, "--only", "p0001-1")

    assert code == 0
    out = capsys.readouterr().out
    assert "p0001-1: archived" in out
    assert "pin the archive URL" in out
    assert "used 1 of 1 images" in out


# --- the bandwidth cap (Workflow 4B review H010) --------------------------------------------------

MB = 1_000_000
BIG = 5 * MB
"""Each big file takes 1.6 s at 25 Mbps, longer than the 1 s between request starts."""


def big_run(
    ff: ModuleType, tmp_path: Path, count: int, *extra: str, parallel: bool = False
) -> tuple[int, FakeWeb]:
    """``--calibration`` over ``count`` files of :data:`BIG` bytes each; with ``parallel``, the
    first two downloads wait for each other to open, so they are in flight at the same time."""
    bodies = [bytes([index]) * BIG for index in range(count)]
    images = [
        image(
            "p0001",
            index + 1,
            index,
            sha256=hashlib.sha256(body).hexdigest(),
            sha1=hashlib.sha1(body).hexdigest(),  # noqa: S324 - Commons pins SHA-1
            size=BIG,
        )
        for index, body in enumerate(bodies)
    ]
    content = {**document(0), "identities": [{"id": "p0001", "sex": "female", "images": images}]}
    clock = FakeClock()
    barrier = threading.Barrier(2, timeout=10) if parallel else None
    routes = {entry["url"]: Reply(body=body) for entry, body in zip(images, bodies, strict=True)}
    web = FakeWeb(routes, clock, barrier=barrier)
    return run(ff, write(tmp_path / "c.json", content), web, clock, *extra), web


def test_the_calibration_downloads_keep_under_the_bandwidth_cap(
    ff: ModuleType, tmp_path: Path
) -> None:
    """H010 (Workflow 4B review): ``--calibration`` (3.78 GB) ran at line speed; only the starts
    of its requests were spaced. Each download now holds the next request back until its bytes fit
    under the cap."""
    code, web = big_run(ff, tmp_path, 3, "--jobs", "1")

    assert code == 0
    gaps = [b - a for a, b in itertools.pairwise(web.times)]
    assert all(gap >= BIG * 8 / ff.MAX_DOWNLOAD_BITS_PER_SECOND - 1e-9 for gap in gaps), gaps


def test_two_calibration_downloads_at_once_keep_under_the_cap_together(
    ff: ModuleType, tmp_path: Path
) -> None:
    """H010: with two downloads in flight, every request but those two waits for all the bytes
    before it: the k-th request starts no earlier than the bytes of k - 2 files allow."""
    code, web = big_run(ff, tmp_path, 6, "--jobs", "2", parallel=True)

    assert code == 0
    assert web.max_in_flight == 2
    starts = sorted(web.times)
    per_file = BIG * 8 / ff.MAX_DOWNLOAD_BITS_PER_SECOND
    for k, start in enumerate(starts, start=1):
        assert start - starts[0] >= (k - 2) * per_file - 1e-9, (k, starts)
