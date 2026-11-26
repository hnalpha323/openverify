"""scripts/fetch_models.py: pinned, license-checked, idempotent model downloads.

Network access is faked with an injected opener, plus a local http.server for the real
urllib path. Nothing here touches the internet.
"""

from __future__ import annotations

import hashlib
import http.server
import importlib.util
import io
import json
import socket
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

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "fetch_models.py"
PAYLOAD = b"not really an onnx model, just deterministic test bytes" * 10
PAYLOAD_SHA = hashlib.sha256(PAYLOAD).hexdigest()
URL = "https://example.invalid/models/toy.onnx"


@pytest.fixture(scope="module")
def fm() -> ModuleType:
    spec = importlib.util.spec_from_file_location("fetch_models", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_models"] = module
    spec.loader.exec_module(module)
    return module


def entry_dict(**overrides: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "name": "toy_model",
        "filename": "toy.onnx",
        "url": URL,
        "sha256": PAYLOAD_SHA,
        "size": len(PAYLOAD),
        "license": "MIT",
        "license_url": "https://example.invalid/LICENSE",
        "source_repo": "https://example.invalid/toy",
    }
    entry.update(overrides)
    return entry


def write_manifest(path: Path, *entries: dict[str, Any]) -> Path:
    path.write_text(json.dumps({"schema_version": 1, "models": list(entries)}))
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


# --- manifest parsing -----------------------------------------------------------------------


def test_load_manifest_parses_entries(fm: ModuleType, tmp_path: Path) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict())

    (entry,) = fm.load_manifest(manifest)

    assert entry.name == "toy_model"
    assert entry.filename == "toy.onnx"
    assert entry.sha256 == PAYLOAD_SHA
    assert entry.size == len(PAYLOAD)
    assert entry.license == "MIT"


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"url": "http://example.invalid/toy.onnx"}, "https"),
        ({"license_url": "ftp://example.invalid/LICENSE"}, "https"),
        ({"sha256": "abc123"}, "sha256"),
        ({"sha256": PAYLOAD_SHA.upper()}, "sha256"),
        ({"license": "CC-BY-NC-4.0"}, "license"),
        ({"license": "BUSL-1.1"}, "license"),
        ({"license": "AGPL-3.0-only"}, "license"),
        ({"filename": "../escape.onnx"}, "filename"),
        ({"filename": "nested/dir.onnx"}, "filename"),
        ({"filename": ".hidden"}, "filename"),
        ({"size": 0}, "size"),
        ({"size": "12"}, "size"),
        ({"name": ""}, "name"),
    ],
)
def test_invalid_entries_are_rejected(
    fm: ModuleType, tmp_path: Path, overrides: dict[str, Any], message: str
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict(**overrides))

    with pytest.raises(fm.ManifestError, match=message):
        fm.load_manifest(manifest)


def test_missing_field_is_rejected(fm: ModuleType, tmp_path: Path) -> None:
    broken = entry_dict()
    del broken["sha256"]
    manifest = write_manifest(tmp_path / "manifest.json", broken)

    with pytest.raises(fm.ManifestError, match="sha256"):
        fm.load_manifest(manifest)


def test_duplicate_names_or_filenames_are_rejected(fm: ModuleType, tmp_path: Path) -> None:
    same_name = write_manifest(tmp_path / "a.json", entry_dict(), entry_dict(filename="other.onnx"))
    same_file = write_manifest(tmp_path / "b.json", entry_dict(), entry_dict(name="other"))

    with pytest.raises(fm.ManifestError, match="duplicate"):
        fm.load_manifest(same_name)
    with pytest.raises(fm.ManifestError, match="duplicate"):
        fm.load_manifest(same_file)


@pytest.mark.parametrize(
    "content", ["not json", "[]", '{"models": {}}', '{"models": [1]}'], ids=repr
)
def test_malformed_manifest_is_rejected(fm: ModuleType, tmp_path: Path, content: str) -> None:
    path = tmp_path / "manifest.json"
    path.write_text(content)

    with pytest.raises(fm.ManifestError):
        fm.load_manifest(path)


def test_missing_manifest_is_rejected(fm: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(fm.ManifestError, match="manifest"):
        fm.load_manifest(tmp_path / "absent.json")


# --- fetch_model ----------------------------------------------------------------------------


def make_entry(fm: ModuleType, **overrides: Any) -> Any:
    return fm.ModelEntry.from_dict(entry_dict(**overrides))


def leftovers(directory: Path) -> list[str]:
    return sorted(p.name for p in directory.iterdir())


def test_downloads_and_verifies(fm: ModuleType, tmp_path: Path) -> None:
    opener = FakeOpener({URL: PAYLOAD})

    status = fm.fetch_model(make_entry(fm), tmp_path, opener=opener)

    assert status == "downloaded"
    assert (tmp_path / "toy.onnx").read_bytes() == PAYLOAD
    assert opener.calls == [URL]
    assert leftovers(tmp_path) == ["toy.onnx"]


def test_creates_destination_directory(fm: ModuleType, tmp_path: Path) -> None:
    dest = tmp_path / "deep" / "models"

    fm.fetch_model(make_entry(fm), dest, opener=FakeOpener({URL: PAYLOAD}))

    assert (dest / "toy.onnx").is_file()


def test_is_idempotent_when_file_already_verified(fm: ModuleType, tmp_path: Path) -> None:
    opener = FakeOpener({URL: PAYLOAD})
    entry = make_entry(fm)
    fm.fetch_model(entry, tmp_path, opener=opener)

    status = fm.fetch_model(entry, tmp_path, opener=opener)

    assert status == "present"
    assert opener.calls == [URL]  # no second download


def test_refuses_checksum_mismatch_and_leaves_nothing_behind(
    fm: ModuleType, tmp_path: Path
) -> None:
    tampered = PAYLOAD[:-1] + b"!"

    with pytest.raises(fm.ChecksumMismatchError, match=PAYLOAD_SHA):
        fm.fetch_model(make_entry(fm), tmp_path, opener=FakeOpener({URL: tampered}))

    assert leftovers(tmp_path) == []


def test_replaces_a_corrupted_local_copy(fm: ModuleType, tmp_path: Path) -> None:
    (tmp_path / "toy.onnx").write_bytes(b"stale or corrupted")

    status = fm.fetch_model(make_entry(fm), tmp_path, opener=FakeOpener({URL: PAYLOAD}))

    assert status == "downloaded"
    assert (tmp_path / "toy.onnx").read_bytes() == PAYLOAD


def test_bad_download_does_not_overwrite_existing_file(fm: ModuleType, tmp_path: Path) -> None:
    (tmp_path / "toy.onnx").write_bytes(b"stale")

    with pytest.raises(fm.ChecksumMismatchError):
        fm.fetch_model(make_entry(fm), tmp_path, opener=FakeOpener({URL: b"evil"}))

    assert (tmp_path / "toy.onnx").read_bytes() == b"stale"
    assert leftovers(tmp_path) == ["toy.onnx"]


def test_aborts_download_larger_than_declared_size(fm: ModuleType, tmp_path: Path) -> None:
    oversized = PAYLOAD + b"x" * 10_000

    with pytest.raises(fm.DownloadTooLargeError):
        fm.fetch_model(make_entry(fm), tmp_path, opener=FakeOpener({URL: oversized}))

    assert leftovers(tmp_path) == []


# --- real urllib path against a local http.server -------------------------------------------


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
    fm: ModuleType, tmp_path: Path, local_server: Callable[[dict[str, Route]], str]
) -> None:
    base = local_server({"/toy.onnx": (200, {}, PAYLOAD)})
    entry = fm.ModelEntry(**{**entry_dict(), "url": f"{base}/toy.onnx"})

    assert fm.fetch_model(entry, tmp_path) == "downloaded"
    assert fm.fetch_model(entry, tmp_path) == "present"
    assert (tmp_path / "toy.onnx").read_bytes() == PAYLOAD


def test_http_error_is_reported(
    fm: ModuleType, tmp_path: Path, local_server: Callable[[dict[str, Route]], str]
) -> None:
    base = local_server({})
    entry = fm.ModelEntry(**{**entry_dict(), "url": f"{base}/absent.onnx"})

    with pytest.raises(fm.FetchError, match="404"):
        fm.fetch_model(entry, tmp_path)
    assert leftovers(tmp_path) == []


def test_redirect_to_non_https_is_refused(
    fm: ModuleType, tmp_path: Path, local_server: Callable[[dict[str, Route]], str]
) -> None:
    target = local_server({"/toy.onnx": (200, {}, PAYLOAD)})
    base = local_server({"/toy.onnx": (302, {"Location": f"{target}/toy.onnx"}, b"")})
    entry = fm.ModelEntry(**{**entry_dict(), "url": f"{base}/toy.onnx"})

    with pytest.raises(fm.FetchError, match="non-https"):
        fm.fetch_model(entry, tmp_path)
    assert leftovers(tmp_path) == []


# --- command line ---------------------------------------------------------------------------


def test_main_fetches_everything_and_is_rerunnable(
    fm: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    other_url = "https://example.invalid/models/other.onnx"
    manifest = write_manifest(
        tmp_path / "manifest.json",
        entry_dict(),
        entry_dict(name="other", filename="other.onnx", url=other_url),
    )
    opener = FakeOpener({URL: PAYLOAD, other_url: PAYLOAD})
    dest = tmp_path / "out"

    first = fm.main(["--manifest", str(manifest), "--dest", str(dest)], opener=opener)
    second = fm.main(["--manifest", str(manifest), "--dest", str(dest)], opener=opener)

    assert (first, second) == (0, 0)
    assert len(opener.calls) == 2
    out = capsys.readouterr().out
    assert out.count("downloaded") == 2
    assert out.count("present") == 2


def test_main_defaults_destination_to_manifest_directory(fm: ModuleType, tmp_path: Path) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict())

    code = fm.main(["--manifest", str(manifest)], opener=FakeOpener({URL: PAYLOAD}))

    assert code == 0
    assert (tmp_path / "toy.onnx").is_file()


def test_main_only_fetches_selected_models(fm: ModuleType, tmp_path: Path) -> None:
    other_url = "https://example.invalid/models/other.onnx"
    manifest = write_manifest(
        tmp_path / "manifest.json",
        entry_dict(),
        entry_dict(name="other", filename="other.onnx", url=other_url),
    )
    opener = FakeOpener({URL: PAYLOAD, other_url: PAYLOAD})

    code = fm.main(["--manifest", str(manifest), "--only", "other"], opener=opener)

    assert code == 0
    assert opener.calls == [other_url]


def test_main_rejects_unknown_model_name(
    fm: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict())

    code = fm.main(["--manifest", str(manifest), "--only", "nope"], opener=FakeOpener({}))

    assert code == 2
    assert "nope" in capsys.readouterr().err


def test_main_reports_failure_with_nonzero_exit(
    fm: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict())

    code = fm.main(["--manifest", str(manifest)], opener=FakeOpener({URL: b"tampered"}))

    assert code == 1
    assert "toy_model" in capsys.readouterr().err
    assert not (tmp_path / "toy.onnx").exists()


def test_main_reports_invalid_manifest(
    fm: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", entry_dict(license="CC-BY-NC-4.0"))

    code = fm.main(["--manifest", str(manifest)], opener=FakeOpener({}))

    assert code == 2
    assert "license" in capsys.readouterr().err


# --- edge cases (added after GREEN to pin down the remaining defensive branches) ------------


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda e: e.update(sha_256="typo"), "unknown field"),
        (lambda e: e.pop("license_url"), "license_url"),
        (lambda e: e.pop("source_repo"), "source_repo"),
        (lambda e: e.update(upstream=["not", "text"]), "upstream"),
    ],
    ids=["unknown-field", "missing-license-url", "missing-source-repo", "non-string-upstream"],
)
def test_manifest_shape_errors(
    fm: ModuleType,
    tmp_path: Path,
    mutate: Callable[[dict[str, Any]], object],
    message: str,
) -> None:
    entry = entry_dict()
    mutate(entry)
    manifest = write_manifest(tmp_path / "manifest.json", entry)

    with pytest.raises(fm.ManifestError, match=message):
        fm.load_manifest(manifest)


def test_connection_failure_is_reported(fm: ModuleType, tmp_path: Path) -> None:
    with socket.socket() as probe:  # grab a free port, then close it so nothing listens there
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    entry = fm.ModelEntry(**{**entry_dict(), "url": f"http://127.0.0.1:{port}/toy.onnx"})

    with pytest.raises(fm.FetchError, match="failed"):
        fm.fetch_model(entry, tmp_path, timeout=5.0)
    assert leftovers(tmp_path) == []


def test_https_redirects_are_followed(fm: ModuleType) -> None:
    handler = fm._HttpsOnlyRedirectHandler()
    original = urllib.request.Request("https://example.invalid/a")

    follow = handler.redirect_request(
        original, io.BytesIO(), 302, "Found", HTTPMessage(), "https://cdn.example.invalid/b"
    )

    assert follow is not None
    assert follow.full_url == "https://cdn.example.invalid/b"


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


def test_downloaded_weights_are_world_readable(fm: ModuleType, tmp_path: Path) -> None:
    # Weights are public artefacts; a 0600 temp-file mode would hide them from the container's
    # non-root user when models/ is bind-mounted.
    fm.fetch_model(make_entry(fm), tmp_path, opener=FakeOpener({URL: PAYLOAD}))

    assert (tmp_path / "toy.onnx").stat().st_mode & 0o777 == 0o644
