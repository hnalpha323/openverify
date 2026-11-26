"""scripts/fetch_fixtures.py: pinned, public-domain-only, idempotent face-fixture downloads.

Network access is faked with an injected opener, plus a local http.server for the real
urllib path. Nothing here touches the internet and no real photo is involved: payloads are
plain bytes.
"""

from __future__ import annotations

import hashlib
import http.server
import importlib.util
import io
import json
import subprocess
import sys
import threading
import urllib.request
from collections.abc import Callable, Iterator
from http.client import HTTPMessage
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "fetch_fixtures.py"
PAYLOAD = b"not really a jpeg, just deterministic test bytes" * 10
PAYLOAD_SHA = hashlib.sha256(PAYLOAD).hexdigest()
URL = "https://example.invalid/faces/person.jpg"


@pytest.fixture(scope="module")
def ff() -> ModuleType:
    spec = importlib.util.spec_from_file_location("fetch_fixtures", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_fixtures"] = module
    spec.loader.exec_module(module)
    return module


def entry_dict(**overrides: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "name": "person_a_id",
        "person": "A",
        "role": "id_portrait",
        "filename": "person-a-id.jpg",
        "source_page": "https://commons.example.invalid/wiki/File:Person.jpg",
        "url": URL,
        "sha256": PAYLOAD_SHA,
        "size": len(PAYLOAD),
        "license": "public-domain",
        "license_template": "PD-USGov-NASA",
        "author": "NASA/Example Photographer",
        "face_box": [10, 20, 30, 40],
    }
    entry.update(overrides)
    return entry


def write_manifest(path: Path, *entries: dict[str, Any]) -> Path:
    path.write_text(json.dumps({"schema_version": 1, "faces": list(entries)}))
    return path


class FakeOpener:
    """Serves ``payloads`` by URL and records every request."""

    def __init__(self, payloads: dict[str, bytes]) -> None:
        self.payloads = payloads
        self.calls: list[str] = []

    def __call__(self, url: str, timeout: float) -> io.BytesIO:
        assert timeout > 0
        self.calls.append(url)
        return io.BytesIO(self.payloads[url])


def leftovers(directory: Path) -> list[str]:
    return sorted(p.name for p in directory.iterdir())


# --- manifest parsing -----------------------------------------------------------------------


def test_load_manifest_parses_entries(ff: ModuleType, tmp_path: Path) -> None:
    manifest = write_manifest(
        tmp_path / "manifest.json", entry_dict(subject="Example", notes="checked")
    )

    (entry,) = ff.load_manifest(manifest)

    assert entry.name == "person_a_id"
    assert entry.person == "A"
    assert entry.role == "id_portrait"
    assert entry.filename == "person-a-id.jpg"
    assert entry.sha256 == PAYLOAD_SHA
    assert entry.size == len(PAYLOAD)
    assert entry.license_template == "PD-USGov-NASA"
    assert entry.face_box == (10, 20, 30, 40)
    assert entry.subject == "Example"


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"url": "http://example.invalid/a.jpg"}, "url"),
        ({"source_page": "ftp://example.invalid/page"}, "source_page"),
        ({"sha256": "abc123"}, "sha256"),
        ({"sha256": PAYLOAD_SHA.upper()}, "sha256"),
        ({"license": "CC-BY-NC-4.0"}, "license"),
        ({"license": "CC-BY-SA-4.0"}, "license"),
        ({"license_template": "Cc-by-sa-4.0"}, "license_template"),
        ({"license_template": "PD-self"}, "license_template"),
        ({"filename": "../escape.jpg"}, "filename"),
        ({"filename": "nested/dir.jpg"}, "filename"),
        ({"filename": ".hidden"}, "filename"),
        ({"size": 0}, "size"),
        ({"size": True}, "size"),
        ({"name": "Bad Name"}, "name"),
        ({"person": "a"}, "person"),
        ({"role": "passport"}, "role"),
        ({"author": ""}, "author"),
        ({"face_box": [1, 2, 3]}, "face_box"),
        ({"face_box": [1, 2, 0, 4]}, "face_box"),
        ({"face_box": [-1, 2, 3, 4]}, "face_box"),
        ({"face_box": [1, 2, 3, 4.5]}, "face_box"),
        ({"face_box": "1,2,3,4"}, "face_box"),
        ({"subject": 5}, "subject"),
        ({"sha_256": "typo"}, "unknown field"),
    ],
)
def test_invalid_entries_are_rejected(
    ff: ModuleType, tmp_path: Path, overrides: dict[str, Any], message: str
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict(**overrides))

    with pytest.raises(ff.ManifestError, match=message):
        ff.load_manifest(manifest)


def test_missing_field_is_rejected(ff: ModuleType, tmp_path: Path) -> None:
    broken = entry_dict()
    del broken["license_template"]
    manifest = write_manifest(tmp_path / "manifest.json", broken)

    with pytest.raises(ff.ManifestError, match="license_template"):
        ff.load_manifest(manifest)


def test_duplicate_names_or_filenames_are_rejected(ff: ModuleType, tmp_path: Path) -> None:
    same_name = write_manifest(tmp_path / "a.json", entry_dict(), entry_dict(filename="b.jpg"))
    same_file = write_manifest(tmp_path / "b.json", entry_dict(), entry_dict(name="other"))

    with pytest.raises(ff.ManifestError, match="duplicate"):
        ff.load_manifest(same_name)
    with pytest.raises(ff.ManifestError, match="duplicate"):
        ff.load_manifest(same_file)


@pytest.mark.parametrize("content", ["not json", "[]", '{"faces": {}}', '{"faces": [1]}'], ids=repr)
def test_malformed_manifest_is_rejected(ff: ModuleType, tmp_path: Path, content: str) -> None:
    path = tmp_path / "manifest.json"
    path.write_text(content)

    with pytest.raises(ff.ManifestError):
        ff.load_manifest(path)


def test_missing_manifest_is_rejected(ff: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(ff.ManifestError, match="manifest"):
        ff.load_manifest(tmp_path / "absent.json")


# --- fetch_fixture --------------------------------------------------------------------------


def make_entry(ff: ModuleType, **overrides: Any) -> Any:
    return ff.FaceFixture.from_dict(entry_dict(**overrides))


def test_downloads_and_verifies(ff: ModuleType, tmp_path: Path) -> None:
    opener = FakeOpener({URL: PAYLOAD})

    status = ff.fetch_fixture(make_entry(ff), tmp_path, opener=opener)

    assert status == "downloaded"
    assert (tmp_path / "person-a-id.jpg").read_bytes() == PAYLOAD
    assert opener.calls == [URL]
    assert leftovers(tmp_path) == ["person-a-id.jpg"]
    assert (tmp_path / "person-a-id.jpg").stat().st_mode & 0o777 == 0o644


def test_creates_destination_directory(ff: ModuleType, tmp_path: Path) -> None:
    dest = tmp_path / "deep" / "faces"

    ff.fetch_fixture(make_entry(ff), dest, opener=FakeOpener({URL: PAYLOAD}))

    assert (dest / "person-a-id.jpg").is_file()


def test_is_idempotent_when_file_already_verified(ff: ModuleType, tmp_path: Path) -> None:
    opener = FakeOpener({URL: PAYLOAD})
    entry = make_entry(ff)
    ff.fetch_fixture(entry, tmp_path, opener=opener)

    assert ff.fetch_fixture(entry, tmp_path, opener=opener) == "present"
    assert opener.calls == [URL]


def test_refuses_checksum_mismatch_and_leaves_nothing_behind(
    ff: ModuleType, tmp_path: Path
) -> None:
    with pytest.raises(ff.ChecksumMismatchError, match=PAYLOAD_SHA):
        ff.fetch_fixture(make_entry(ff), tmp_path, opener=FakeOpener({URL: PAYLOAD[:-1] + b"!"}))

    assert leftovers(tmp_path) == []


def test_bad_download_does_not_overwrite_existing_file(ff: ModuleType, tmp_path: Path) -> None:
    (tmp_path / "person-a-id.jpg").write_bytes(b"stale")

    with pytest.raises(ff.ChecksumMismatchError):
        ff.fetch_fixture(make_entry(ff), tmp_path, opener=FakeOpener({URL: b"evil"}))

    assert (tmp_path / "person-a-id.jpg").read_bytes() == b"stale"
    assert leftovers(tmp_path) == ["person-a-id.jpg"]


def test_replaces_a_corrupted_local_copy(ff: ModuleType, tmp_path: Path) -> None:
    (tmp_path / "person-a-id.jpg").write_bytes(b"stale or corrupted")

    status = ff.fetch_fixture(make_entry(ff), tmp_path, opener=FakeOpener({URL: PAYLOAD}))

    assert status == "downloaded"
    assert (tmp_path / "person-a-id.jpg").read_bytes() == PAYLOAD


def test_aborts_download_larger_than_declared_size(ff: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(ff.DownloadTooLargeError):
        ff.fetch_fixture(
            make_entry(ff), tmp_path, opener=FakeOpener({URL: PAYLOAD + b"x" * 10_000})
        )

    assert leftovers(tmp_path) == []


# --- real urllib path against a local http.server -------------------------------------------

Route = tuple[int, dict[str, str], bytes]


@pytest.fixture
def local_server() -> Iterator[Callable[[dict[str, Route]], tuple[str, list[str]]]]:
    servers: list[http.server.ThreadingHTTPServer] = []

    def start(routes: dict[str, Route]) -> tuple[str, list[str]]:
        agents: list[str] = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                agents.append(self.headers.get("User-Agent", ""))
                status, headers, body = routes.get(self.path, (404, {}, b"missing"))
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: object) -> None:
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        return f"http://127.0.0.1:{server.server_address[1]}", agents

    yield start
    for server in servers:
        server.shutdown()
        server.server_close()


def test_real_download_sends_a_descriptive_user_agent(
    ff: ModuleType,
    tmp_path: Path,
    local_server: Callable[[dict[str, Route]], tuple[str, list[str]]],
) -> None:
    base, agents = local_server({"/a.jpg": (200, {}, PAYLOAD)})
    entry = ff.FaceFixture(**{**entry_dict(), "url": f"{base}/a.jpg", "face_box": (1, 2, 3, 4)})

    assert ff.fetch_fixture(entry, tmp_path) == "downloaded"
    assert ff.fetch_fixture(entry, tmp_path) == "present"
    # Wikimedia asks automated clients to identify themselves with a contact URL.
    assert agents
    assert agents[0].startswith("OpenVerify-fetch-fixtures/")
    assert "https://" in agents[0]


def test_http_error_is_reported(
    ff: ModuleType,
    tmp_path: Path,
    local_server: Callable[[dict[str, Route]], tuple[str, list[str]]],
) -> None:
    base, _ = local_server({})
    entry = ff.FaceFixture(
        **{**entry_dict(), "url": f"{base}/absent.jpg", "face_box": (1, 2, 3, 4)}
    )

    with pytest.raises(ff.FetchError, match="404"):
        ff.fetch_fixture(entry, tmp_path)
    assert leftovers(tmp_path) == []


def test_redirect_to_non_https_is_refused(
    ff: ModuleType,
    tmp_path: Path,
    local_server: Callable[[dict[str, Route]], tuple[str, list[str]]],
) -> None:
    target, _ = local_server({"/a.jpg": (200, {}, PAYLOAD)})
    base, _ = local_server({"/a.jpg": (302, {"Location": f"{target}/a.jpg"}, b"")})
    entry = ff.FaceFixture(**{**entry_dict(), "url": f"{base}/a.jpg", "face_box": (1, 2, 3, 4)})

    with pytest.raises(ff.FetchError, match="non-https"):
        ff.fetch_fixture(entry, tmp_path)
    assert leftovers(tmp_path) == []


def test_https_redirects_are_followed(ff: ModuleType) -> None:
    handler = ff._HttpsOnlyRedirectHandler()
    original = urllib.request.Request("https://example.invalid/a")

    follow = handler.redirect_request(
        original, io.BytesIO(), 302, "Found", HTTPMessage(), "https://cdn.example.invalid/b"
    )

    assert follow is not None
    assert follow.full_url == "https://cdn.example.invalid/b"


# --- command line ---------------------------------------------------------------------------


def test_main_fetches_everything_into_faces_dir_and_is_rerunnable(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    other_url = "https://example.invalid/faces/other.jpg"
    manifest = write_manifest(
        tmp_path / "manifest.json",
        entry_dict(),
        entry_dict(name="person_b", person="B", filename="b.jpg", url=other_url),
    )
    opener = FakeOpener({URL: PAYLOAD, other_url: PAYLOAD})

    first = ff.main(["--manifest", str(manifest)], opener=opener)
    second = ff.main(["--manifest", str(manifest)], opener=opener)

    assert (first, second) == (0, 0)
    assert len(opener.calls) == 2
    assert leftovers(tmp_path / "faces") == ["b.jpg", "person-a-id.jpg"]
    out = capsys.readouterr().out
    assert out.count("downloaded") == 2
    assert out.count("present") == 2
    assert "PD-USGov-NASA" in out


def test_main_honours_dest_and_only(ff: ModuleType, tmp_path: Path) -> None:
    other_url = "https://example.invalid/faces/other.jpg"
    manifest = write_manifest(
        tmp_path / "manifest.json",
        entry_dict(),
        entry_dict(name="person_b", person="B", filename="b.jpg", url=other_url),
    )
    opener = FakeOpener({URL: PAYLOAD, other_url: PAYLOAD})

    code = ff.main(
        ["--manifest", str(manifest), "--dest", str(tmp_path / "x"), "--only", "person_b"],
        opener=opener,
    )

    assert code == 0
    assert opener.calls == [other_url]
    assert leftovers(tmp_path / "x") == ["b.jpg"]


def test_main_rejects_unknown_fixture_name(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict())

    code = ff.main(["--manifest", str(manifest), "--only", "nope"], opener=FakeOpener({}))

    assert code == 2
    assert "nope" in capsys.readouterr().err


def test_main_reports_failure_with_nonzero_exit(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict())

    code = ff.main(["--manifest", str(manifest)], opener=FakeOpener({URL: b"tampered"}))

    assert code == 1
    assert "person_a_id" in capsys.readouterr().err


def test_main_reports_invalid_manifest(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict(license="CC-BY-SA-4.0"))

    code = ff.main(["--manifest", str(manifest)], opener=FakeOpener({}))

    assert code == 2
    assert "license" in capsys.readouterr().err


def test_runs_as_a_standalone_script(tmp_path: Path) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict())

    result = subprocess.run(  # noqa: S603 - fixed interpreter and script path
        [sys.executable, "-I", str(SCRIPT), "--manifest", str(manifest), "--only", "nope"],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )

    assert result.returncode == 2
    assert "not in manifest: nope" in result.stderr


# --- Workflow 4A (C48): template names with spaces, the Commons SHA-1 pin -------------------------


@pytest.mark.parametrize(
    "template",
    [
        "PD-USGov",
        "PD-USGov-NASA",
        "PD-USGov-Military-Air Force",
        "PD-USGov-Military-Marine Corps",
        "PD-USGov-Military-National Guard",
        "PD-USGov-Military-Space Force",
    ],
)
def test_template_names_may_contain_single_spaces(
    ff: ModuleType, tmp_path: Path, template: str
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict(license_template=template))

    (entry,) = ff.load_manifest(manifest)

    assert entry.license_template == template


@pytest.mark.parametrize(
    "template",
    [
        "PD-USGov-Military-Air  Force",
        "PD-USGov-Military-Air Force ",
        "PD-USGov- NASA",
        " PD-USGov-NASA",
        "PD-USGov-Military-Air\tForce",
    ],
    ids=repr,
)
def test_template_names_with_stray_spaces_are_refused(
    ff: ModuleType, tmp_path: Path, template: str
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict(license_template=template))

    with pytest.raises(ff.ManifestError, match="license_template"):
        ff.load_manifest(manifest)


def test_the_commons_sha1_is_an_optional_pin(ff: ModuleType, tmp_path: Path) -> None:
    sha1 = hashlib.sha1(PAYLOAD).hexdigest()  # noqa: S324 - Commons pins SHA-1
    pinned = write_manifest(tmp_path / "a.json", entry_dict(sha1=sha1))
    unpinned = write_manifest(tmp_path / "b.json", entry_dict())

    assert ff.load_manifest(pinned)[0].sha1 == sha1
    assert ff.load_manifest(unpinned)[0].sha1 == ""


@pytest.mark.parametrize("sha1", ["abc", "G" * 40, "A" * 40, 5])
def test_a_malformed_sha1_is_refused(ff: ModuleType, tmp_path: Path, sha1: object) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict(sha1=sha1))

    with pytest.raises(ff.ManifestError, match="sha1"):
        ff.load_manifest(manifest)
