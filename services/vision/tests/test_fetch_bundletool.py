"""scripts/fetch_bundletool.py: one pinned, hash-checked, idempotent download (C214.7, C216.2).

Network access is faked with an injected opener. Nothing here touches the internet.
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import sys
import urllib.error
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "fetch_bundletool.py"
PAYLOAD = b"not really a jar, just deterministic test bytes" * 20


@pytest.fixture(scope="module")
def fb() -> ModuleType:
    spec = importlib.util.spec_from_file_location("fetch_bundletool", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_bundletool"] = module
    spec.loader.exec_module(module)
    return module


class Opener:
    """Answers every URL with ``payload`` and counts the calls."""

    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.urls: list[str] = []

    def __call__(self, url: str, timeout: float) -> io.BytesIO:
        assert timeout > 0
        self.urls.append(url)
        return io.BytesIO(self.payload)


def pin(fb: ModuleType, payload: bytes = PAYLOAD) -> object:
    return fb.Pin(
        version="9.9.9",
        url="https://example.invalid/bundletool-all-9.9.9.jar",
        sha256=hashlib.sha256(payload).hexdigest(),
        size=len(payload),
    )


def test_the_pin_is_an_https_release_asset_with_its_hash_size_and_licence(fb: ModuleType) -> None:
    assert fb.PIN.version == "1.18.3"
    assert fb.PIN.url == (
        "https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar"
    )
    assert len(fb.PIN.sha256) == 64
    assert fb.PIN.sha256 == fb.PIN.sha256.lower()
    assert fb.PIN.size == 32_520_401
    assert fb.LICENSE == "Apache-2.0"
    # C214.7, decision 62: the newest release on or before 2026-10-15, at least 14 days old.
    assert fb.RELEASED == "2025-12-15"


def test_it_downloads_into_the_ignored_build_directory_by_default(fb: ModuleType) -> None:
    assert fb.DEFAULT_DEST == fb.REPO_ROOT / "android" / "build" / "bundletool"
    assert fb.jar_path(fb.PIN, fb.DEFAULT_DEST).name == "bundletool-all-1.18.3.jar"


def test_it_writes_the_jar_only_after_its_hash_matches(fb: ModuleType, tmp_path: Path) -> None:
    opener = Opener(PAYLOAD)

    status = fb.fetch(pin(fb), tmp_path, opener=opener)

    assert status == "downloaded"
    assert (tmp_path / "bundletool-all-9.9.9.jar").read_bytes() == PAYLOAD
    assert opener.urls == ["https://example.invalid/bundletool-all-9.9.9.jar"]
    assert sorted(path.name for path in tmp_path.iterdir()) == ["bundletool-all-9.9.9.jar"]


def test_a_present_jar_with_the_right_hash_is_kept_without_a_request(
    fb: ModuleType, tmp_path: Path
) -> None:
    (tmp_path / "bundletool-all-9.9.9.jar").write_bytes(PAYLOAD)
    opener = Opener(PAYLOAD)

    assert fb.fetch(pin(fb), tmp_path, opener=opener) == "present"
    assert opener.urls == []


def test_a_present_jar_with_another_hash_is_replaced(fb: ModuleType, tmp_path: Path) -> None:
    (tmp_path / "bundletool-all-9.9.9.jar").write_bytes(b"stale")

    assert fb.fetch(pin(fb), tmp_path, opener=Opener(PAYLOAD)) == "downloaded"
    assert (tmp_path / "bundletool-all-9.9.9.jar").read_bytes() == PAYLOAD


@pytest.mark.parametrize("served", [PAYLOAD + b"x", PAYLOAD[:-1], b""])
def test_a_download_with_another_hash_or_size_is_refused_and_leaves_nothing(
    fb: ModuleType, tmp_path: Path, served: bytes
) -> None:
    with pytest.raises(fb.FetchError):
        fb.fetch(pin(fb), tmp_path, opener=Opener(served))

    assert list(tmp_path.iterdir()) == []


def test_a_download_larger_than_the_pin_stops_at_the_pinned_size(
    fb: ModuleType, tmp_path: Path
) -> None:
    with pytest.raises(fb.FetchError, match="size"):
        fb.fetch(pin(fb), tmp_path, opener=Opener(PAYLOAD * 3))

    assert list(tmp_path.iterdir()) == []


def test_main_prints_the_path_and_answers_zero(
    fb: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = fb.main(["--dest", str(tmp_path)], opener=Opener(PAYLOAD), pinned=pin(fb))

    assert code == 0
    assert str(tmp_path / "bundletool-all-9.9.9.jar") in capsys.readouterr().out


def test_main_answers_one_and_names_no_partial_file_on_a_refused_download(
    fb: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = fb.main(["--dest", str(tmp_path)], opener=Opener(b"other"), pinned=pin(fb))

    assert code == 1
    assert "FAILED" in capsys.readouterr().err
    assert list(tmp_path.iterdir()) == []


# KP10-52 (10D review A007; Workflow 11C scanners-11c): retries with a growing delay and a
# verified cache, as infra/scripts/install-gitleaks.sh does (GITLEAKS_RETRY_DELAY_SECONDS,
# GITLEAKS_CACHE_DIR).


class Flaky:
    """Answers each call from a plan: an exception to raise, or bytes to serve; then ``payload``."""

    def __init__(self, plan: list[BaseException | bytes], payload: bytes = PAYLOAD) -> None:
        self.plan = list(plan)
        self.payload = payload
        self.urls: list[str] = []

    def __call__(self, url: str, timeout: float) -> io.BytesIO:
        self.urls.append(url)
        step = self.plan.pop(0) if self.plan else self.payload
        if isinstance(step, BaseException):
            raise step
        return io.BytesIO(step)


def http_error(code: int) -> BaseException:
    return urllib.error.HTTPError("https://example.invalid/x", code, "synthetic", {}, None)  # type: ignore[arg-type]


def connection_refused() -> BaseException:
    return urllib.error.URLError(ConnectionRefusedError("synthetic connection refused"))


def test_a_transient_failure_is_retried_after_a_delay_and_then_passes(
    fb: ModuleType, tmp_path: Path
) -> None:
    opener = Flaky([connection_refused(), http_error(503), TimeoutError("synthetic timeout")])
    slept: list[float] = []

    status = fb.fetch(pin(fb), tmp_path, opener=opener, retry_delay=2.0, sleep=slept.append)

    assert status == "downloaded"
    assert len(opener.urls) == 4
    assert slept == [2.0, 4.0, 8.0]
    assert (tmp_path / "bundletool-all-9.9.9.jar").read_bytes() == PAYLOAD


def test_a_permanent_failure_fails_closed_after_five_attempts_and_leaves_nothing(
    fb: ModuleType, tmp_path: Path
) -> None:
    opener = Flaky([connection_refused() for _ in range(10)])
    slept: list[float] = []

    with pytest.raises(fb.FetchError, match="5 attempts"):
        fb.fetch(pin(fb), tmp_path, opener=opener, retry_delay=1.0, sleep=slept.append)

    assert len(opener.urls) == 5
    assert slept == [1.0, 2.0, 4.0, 8.0]
    assert list(tmp_path.iterdir()) == []


def test_a_client_error_is_not_retried(fb: ModuleType, tmp_path: Path) -> None:
    opener = Flaky([http_error(404)])

    with pytest.raises(fb.FetchError, match="404"):
        fb.fetch(pin(fb), tmp_path, opener=opener, sleep=lambda _s: None)

    assert len(opener.urls) == 1
    assert list(tmp_path.iterdir()) == []


def test_a_digest_mismatch_is_not_retried(fb: ModuleType, tmp_path: Path) -> None:
    opener = Flaky([b"x" * len(PAYLOAD)])

    with pytest.raises(fb.FetchError, match="SHA-256"):
        fb.fetch(pin(fb), tmp_path, opener=opener, sleep=lambda _s: None)

    assert len(opener.urls) == 1
    assert list(tmp_path.iterdir()) == []


def test_a_cached_jar_matching_the_pin_is_used_without_a_request(
    fb: ModuleType, tmp_path: Path
) -> None:
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "bundletool-all-9.9.9.jar").write_bytes(PAYLOAD)
    dest = tmp_path / "dest"
    opener = Flaky([])

    status = fb.fetch(pin(fb), dest, opener=opener, cache_dir=cache)

    assert status == "cached"
    assert opener.urls == []
    assert (dest / "bundletool-all-9.9.9.jar").read_bytes() == PAYLOAD


@pytest.mark.parametrize(
    "cached",
    [b"y" * len(PAYLOAD), PAYLOAD[:-1], PAYLOAD + b"z"],
    ids=["same-size-other-digest", "short", "long"],
)
def test_a_cached_jar_that_differs_from_the_pin_is_discarded_and_downloaded_again(
    fb: ModuleType, tmp_path: Path, cached: bytes
) -> None:
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "bundletool-all-9.9.9.jar").write_bytes(cached)
    dest = tmp_path / "dest"
    opener = Flaky([])

    status = fb.fetch(pin(fb), dest, opener=opener, cache_dir=cache)

    assert status == "downloaded"
    assert len(opener.urls) == 1
    assert (dest / "bundletool-all-9.9.9.jar").read_bytes() == PAYLOAD
    assert (cache / "bundletool-all-9.9.9.jar").read_bytes() == PAYLOAD


def test_a_verified_download_fills_the_cache_and_a_refused_one_does_not(
    fb: ModuleType, tmp_path: Path
) -> None:
    cache = tmp_path / "cache"
    fb.fetch(pin(fb), tmp_path / "a", opener=Flaky([]), cache_dir=cache)
    assert (cache / "bundletool-all-9.9.9.jar").read_bytes() == PAYLOAD

    other = tmp_path / "other-cache"
    with pytest.raises(fb.FetchError):
        fb.fetch(pin(fb), tmp_path / "b", opener=Flaky([b"bad"]), cache_dir=other)
    assert not (other / "bundletool-all-9.9.9.jar").exists()


def test_main_reads_the_cache_and_the_retry_delay_from_the_environment(
    fb: ModuleType,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "bundletool-all-9.9.9.jar").write_bytes(PAYLOAD)
    monkeypatch.setenv("BUNDLETOOL_CACHE_DIR", str(cache))
    monkeypatch.setenv("BUNDLETOOL_RETRY_DELAY_SECONDS", "0")

    code = fb.main(["--dest", str(tmp_path / "dest")], opener=Flaky([]), pinned=pin(fb))

    assert code == 0
    assert "cached" in capsys.readouterr().out
    assert fb.retry_delay_from_env() == 0.0


def test_main_takes_a_cache_directory_argument(
    fb: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cache = tmp_path / "cache"
    code = fb.main(
        ["--dest", str(tmp_path / "dest"), "--cache-dir", str(cache)],
        opener=Flaky([]),
        pinned=pin(fb),
    )

    assert code == 0
    assert (cache / "bundletool-all-9.9.9.jar").read_bytes() == PAYLOAD
