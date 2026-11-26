"""scripts/fetch_data.py: pinned, license-checked, idempotent data downloads (plan C56, C67).

Network access is faked with an injected opener, plus a local http.server for the real urllib
path. Nothing here touches the internet. The last tests read the committed data/manifest.json.
"""

from __future__ import annotations

import hashlib
import http.server
import importlib.util
import io
import json
import sys
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "scripts" / "fetch_data.py"
MANIFEST = REPO_ROOT / "data" / "manifest.json"
PAYLOAD = b"disposable.test\nthrowaway.example\n" * 8
PAYLOAD_SHA = hashlib.sha256(PAYLOAD).hexdigest()
URL = "https://example.invalid/lists/toy.conf"
COMMIT = "0123456789abcdef0123456789abcdef01234567"


@pytest.fixture(scope="module")
def fd() -> ModuleType:
    spec = importlib.util.spec_from_file_location("fetch_data", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_data"] = module
    spec.loader.exec_module(module)
    return module


def entry_dict(**overrides: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "name": "toy_list",
        "filename": "toy.conf",
        "url": URL,
        "sha256": PAYLOAD_SHA,
        "size": len(PAYLOAD),
        "license": "CC0-1.0",
        "license_url": "https://example.invalid/LICENSE",
        "source_repo": "https://example.invalid/toy",
        "commit": COMMIT,
    }
    entry.update(overrides)
    return entry


def write_manifest(path: Path, *entries: dict[str, Any]) -> Path:
    path.write_text(json.dumps({"schema_version": 1, "data": list(entries)}))
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


# --- manifest -----------------------------------------------------------------------------------


def test_load_manifest_parses_entries(fd: ModuleType, tmp_path: Path) -> None:
    (entry,) = fd.load_manifest(write_manifest(tmp_path / "manifest.json", entry_dict()))

    assert (entry.name, entry.filename, entry.sha256, entry.size) == (
        "toy_list",
        "toy.conf",
        PAYLOAD_SHA,
        len(PAYLOAD),
    )
    assert (entry.license, entry.commit) == ("CC0-1.0", COMMIT)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"url": "http://example.invalid/toy.conf"}, "https"),
        ({"license_url": "ftp://example.invalid/LICENSE"}, "https"),
        ({"sha256": "abc123"}, "sha256"),
        ({"sha256": PAYLOAD_SHA.upper()}, "sha256"),
        ({"license": "CC-BY-NC-4.0"}, "license"),
        ({"license": "CC-BY-SA-4.0"}, "license"),
        ({"license": "ODbL-1.0"}, "license"),
        ({"filename": "../escape.conf"}, "filename"),
        ({"filename": "nested/list.conf"}, "filename"),
        ({"filename": "manifest.json"}, "filename"),
        ({"size": 0}, "size"),
        ({"size": True}, "size"),
        ({"name": "Not-Snake"}, "name"),
        ({"commit": "6fcca80"}, "commit"),
        ({"sha_256": "typo"}, "unknown field"),
        ({"notes": ["not", "text"]}, "notes"),
    ],
)
def test_invalid_entries_are_rejected(
    fd: ModuleType, tmp_path: Path, overrides: dict[str, Any], message: str
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict(**overrides))

    with pytest.raises(fd.ManifestError, match=message):
        fd.load_manifest(manifest)


@pytest.mark.parametrize("field", ["sha256", "license_url", "source_repo"])
def test_missing_field_is_rejected(fd: ModuleType, tmp_path: Path, field: str) -> None:
    broken = entry_dict()
    del broken[field]

    with pytest.raises(fd.ManifestError, match=field):
        fd.load_manifest(write_manifest(tmp_path / "manifest.json", broken))


def test_duplicate_names_or_filenames_are_rejected(fd: ModuleType, tmp_path: Path) -> None:
    same_name = write_manifest(tmp_path / "a.json", entry_dict(), entry_dict(filename="b.conf"))
    same_file = write_manifest(tmp_path / "b.json", entry_dict(), entry_dict(name="other"))

    for manifest in (same_name, same_file):
        with pytest.raises(fd.ManifestError, match="duplicate"):
            fd.load_manifest(manifest)


@pytest.mark.parametrize("content", ["not json", "[]", '{"data": {}}', '{"data": [1]}'], ids=repr)
def test_malformed_manifest_is_rejected(fd: ModuleType, tmp_path: Path, content: str) -> None:
    path = tmp_path / "manifest.json"
    path.write_text(content)

    with pytest.raises(fd.ManifestError):
        fd.load_manifest(path)


def test_missing_manifest_is_rejected(fd: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(fd.ManifestError, match="manifest"):
        fd.load_manifest(tmp_path / "absent.json")


# --- fetch_entry ----------------------------------------------------------------------------------


def make_entry(fd: ModuleType, **overrides: Any) -> Any:
    return fd.DataEntry.from_dict(entry_dict(**overrides))


def test_downloads_verifies_and_is_idempotent(fd: ModuleType, tmp_path: Path) -> None:
    opener = FakeOpener({URL: PAYLOAD})
    entry = make_entry(fd)

    assert fd.fetch_entry(entry, tmp_path, opener=opener) == "downloaded"
    assert fd.fetch_entry(entry, tmp_path, opener=opener) == "present"

    assert (tmp_path / "toy.conf").read_bytes() == PAYLOAD
    assert opener.calls == [URL]
    assert leftovers(tmp_path) == ["toy.conf"]


def test_refuses_checksum_mismatch_and_keeps_the_old_file(fd: ModuleType, tmp_path: Path) -> None:
    (tmp_path / "toy.conf").write_bytes(b"stale")

    with pytest.raises(fd.ChecksumMismatchError, match=PAYLOAD_SHA):
        fd.fetch_entry(make_entry(fd), tmp_path, opener=FakeOpener({URL: PAYLOAD[:-1] + b"!"}))

    assert (tmp_path / "toy.conf").read_bytes() == b"stale"
    assert leftovers(tmp_path) == ["toy.conf"]


def test_aborts_a_download_larger_than_declared(fd: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(fd.DownloadTooLargeError):
        fd.fetch_entry(make_entry(fd), tmp_path, opener=FakeOpener({URL: PAYLOAD + b"x" * 100}))

    assert leftovers(tmp_path) == []


Route = tuple[int, dict[str, str], bytes]


@pytest.fixture
def local_server() -> Iterator[Callable[[dict[str, Route]], str]]:
    servers: list[http.server.ThreadingHTTPServer] = []

    def start(routes: dict[str, Route]) -> str:
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
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
        return f"http://127.0.0.1:{server.server_address[1]}"

    yield start
    for server in servers:
        server.shutdown()
        server.server_close()


def test_real_download_over_http_server(
    fd: ModuleType, tmp_path: Path, local_server: Callable[[dict[str, Route]], str]
) -> None:
    base = local_server({"/toy.conf": (200, {}, PAYLOAD)})
    entry = fd.DataEntry(**{**entry_dict(), "url": f"{base}/toy.conf"})

    assert fd.fetch_entry(entry, tmp_path) == "downloaded"
    assert (tmp_path / "toy.conf").read_bytes() == PAYLOAD


def test_http_error_and_insecure_redirect_are_refused(
    fd: ModuleType, tmp_path: Path, local_server: Callable[[dict[str, Route]], str]
) -> None:
    target = local_server({"/toy.conf": (200, {}, PAYLOAD)})
    base = local_server({"/moved.conf": (302, {"Location": f"{target}/toy.conf"}, b"")})

    with pytest.raises(fd.FetchError, match="404"):
        fd.fetch_entry(fd.DataEntry(**{**entry_dict(), "url": f"{base}/absent.conf"}), tmp_path)
    with pytest.raises(fd.FetchError, match="non-https"):
        fd.fetch_entry(fd.DataEntry(**{**entry_dict(), "url": f"{base}/moved.conf"}), tmp_path)
    assert leftovers(tmp_path) == []


# --- command line ---------------------------------------------------------------------------------


def test_main_fetches_everything_next_to_the_manifest_and_is_rerunnable(
    fd: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    other = "https://example.invalid/lists/other.conf"
    manifest = write_manifest(
        tmp_path / "manifest.json",
        entry_dict(),
        entry_dict(name="other", filename="other.conf", url=other),
    )
    opener = FakeOpener({URL: PAYLOAD, other: PAYLOAD})

    assert fd.main(["--manifest", str(manifest)], opener=opener) == 0
    assert fd.main(["--manifest", str(manifest)], opener=opener) == 0

    assert len(opener.calls) == 2
    assert leftovers(tmp_path) == ["manifest.json", "other.conf", "toy.conf"]
    out = capsys.readouterr().out
    assert (out.count("downloaded"), out.count("present")) == (2, 2)


def test_main_fetches_only_the_named_entries(fd: ModuleType, tmp_path: Path) -> None:
    other = "https://example.invalid/lists/other.conf"
    manifest = write_manifest(
        tmp_path / "manifest.json",
        entry_dict(),
        entry_dict(name="other", filename="other.conf", url=other),
    )
    opener = FakeOpener({URL: PAYLOAD, other: PAYLOAD})
    dest = tmp_path / "out"

    code = fd.main(
        ["--manifest", str(manifest), "--dest", str(dest), "--only", "other"], opener=opener
    )

    assert code == 0
    assert opener.calls == [other]
    assert leftovers(dest) == ["other.conf"]


def test_main_exit_codes(
    fd: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    good = write_manifest(tmp_path / "good.json", entry_dict())
    bad = write_manifest(tmp_path / "bad.json", entry_dict(license="CC-BY-NC-4.0"))

    assert fd.main(["--manifest", str(good), "--only", "nope"], opener=FakeOpener({})) == 2
    assert fd.main(["--manifest", str(bad)], opener=FakeOpener({})) == 2
    assert fd.main(["--manifest", str(good)], opener=FakeOpener({URL: b"tampered"})) == 1
    err = capsys.readouterr().err
    assert "nope" in err
    assert "license" in err
    assert "toy_list: FAILED" in err


# --- the committed manifest -----------------------------------------------------------------------


def test_the_committed_manifest_is_valid(fd: ModuleType) -> None:
    entries = {entry.name: entry for entry in fd.load_manifest(MANIFEST)}

    assert "disposable_email_domains" in entries


def test_the_disposable_list_is_pinned_as_the_plan_records(fd: ModuleType) -> None:
    """C56: disposable_email_blocklist.conf at 6fcca80, CC0, 9,213 domains, this SHA-256."""
    entry = {e.name: e for e in fd.load_manifest(MANIFEST)}["disposable_email_domains"]

    assert entry.filename == "disposable_email_blocklist.conf"
    assert entry.commit == "6fcca80a3fd4c4a5f7c364788f3b4812a8325754"
    assert entry.commit in entry.url
    assert entry.commit in entry.license_url
    assert entry.sha256 == "e3bd73552549f2fef7997b4892909835907f0045742a06d961bc9af8d7380f79"
    assert (entry.size, entry.license) == (130_453, "CC0-1.0")


def test_the_rigour_person_names_are_pinned_as_the_phase_6_plan_records(fd: ModuleType) -> None:
    """C78.3: rigour person_names.txt at b0ba4ad (v2.5.0), MIT repository, Wikidata CC0 groups."""
    entry = {e.name: e for e in fd.load_manifest(MANIFEST)}["rigour_person_names"]

    assert entry.filename == "rigour-person_names.txt"
    assert entry.commit == "b0ba4adce7c99a5947b45d3461c69278e808521d"
    assert entry.commit in entry.url
    assert entry.commit in entry.license_url
    assert entry.url.endswith("/rust/data/names/person_names.txt")
    assert entry.sha256 == "be47a435969da3fa7311d8c682e462d6d20e6cf27cf90ad1473ce213c9a91c79"
    assert (entry.size, entry.license) == (8_610_609, "MIT")


def test_the_asn_seeds_are_pinned_as_the_phase_7_plan_records(fd: ModuleType) -> None:
    """C92.6: the X4BNet datacenter and VPN ASN files at 30c56a5 (2026-10-15, MIT declared in the
    README), and bad-asn-list at b825d2e (2026-04-12, MIT); each at least 14 days old."""
    entries = {e.name: e for e in fd.load_manifest(MANIFEST)}
    x4b = "30c56a5dfe5465afd41b5c628939fbe3e02f89aa"
    expected = {
        "x4bnet_datacenter_asns": (
            "x4bnet-datacenter-ASN.txt",
            x4b,
            "/input/datacenter/ASN.txt",
            "d59258ef0f777f0e8142471e4848e279bb51e813f634d4c397693dbf63c621cb",
            35_009,
        ),
        "x4bnet_vpn_asns": (
            "x4bnet-vpn-ASN.txt",
            x4b,
            "/input/vpn/ASN.txt",
            "d97f44f94c96902e9049f8eba1c268a9ad50e14e9f7fba662857bb9dfee7f5a5",
            509,
        ),
        "bad_asn_list": (
            "bad-asn-list.csv",
            "b825d2e0e09684842599b75881fc76cb42f0e8c6",
            "/bad-asn-list.csv",
            "0af8e58dc07ba070a10c9083a1a9f5c9fc76be35fab32bb6d144e72caa20a252",
            24_159,
        ),
    }
    for name, (filename, commit, path, sha256, size) in expected.items():
        entry = entries[name]
        assert entry.filename == filename
        assert entry.commit == commit
        assert entry.commit in entry.url
        assert entry.url.endswith(path)
        assert entry.commit in entry.license_url
        assert (entry.sha256, entry.size, entry.license) == (sha256, size, "MIT")
