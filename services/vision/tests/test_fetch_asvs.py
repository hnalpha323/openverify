"""scripts/fetch_asvs.py: the pinned ASVS 5.0.0 export and the committed Level 2 id list (C274.2).

Network access is faked with an injected opener, and every export here is synthetic (ids and
levels with placeholder texts). Nothing here touches the internet; the committed list is read from
the repository.
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import re
import sys
import urllib.error
from pathlib import Path
from types import ModuleType

import pytest

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "scripts" / "fetch_asvs.py"


@pytest.fixture(scope="module")
def fa() -> ModuleType:
    spec = importlib.util.spec_from_file_location("fetch_asvs", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_asvs"] = module
    spec.loader.exec_module(module)
    return module


def synthetic_export(rows: list[tuple[str, str]]) -> bytes:
    """An export of the real shape whose texts are placeholders."""
    requirements = [
        {
            "chapter_id": req_id.split(".")[0],
            "chapter_name": "synthetic chapter",
            "section_id": ".".join(req_id.split(".")[:2]),
            "section_name": "synthetic section",
            "req_id": req_id,
            "req_description": "synthetic text",
            "L": level,
        }
        for req_id, level in rows
    ]
    return json.dumps({"requirements": requirements}).encode()


EXPORT = synthetic_export(
    [("V1.1.1", "2"), ("V1.1.2", "1"), ("V1.2.1", "3"), ("V2.10.3", "2"), ("V17.3.2", "1")]
)


class Opener:
    """Answers every URL with ``payload``, after ``failures`` HTTP errors, and counts the calls."""

    def __init__(self, payload: bytes, failures: list[int] | None = None) -> None:
        self.payload = payload
        self.failures = list(failures or [])
        self.urls: list[str] = []

    def __call__(self, url: str, timeout: float) -> io.BytesIO:
        assert timeout > 0
        self.urls.append(url)
        if self.failures:
            code = self.failures.pop(0)
            raise urllib.error.HTTPError(url, code, "synthetic", {}, None)  # type: ignore[arg-type]
        return io.BytesIO(self.payload)


def pin(fa: ModuleType, payload: bytes = EXPORT) -> object:
    return fa.Pin(
        version="5.0.0",
        url="https://example.invalid/asvs.flat.json",
        sha256=hashlib.sha256(payload).hexdigest(),
        size=len(payload),
        filename="asvs.flat.json",
    )


def test_the_pin_is_the_v5_release_asset_with_its_hash_size_licence_and_date(
    fa: ModuleType,
) -> None:
    assert fa.PIN.url == (
        "https://github.com/OWASP/ASVS/releases/download/v5.0.0_release/"
        "OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json"
    )
    assert fa.PIN.sha256 == "8201b20eec2908c3380ac600c91c8ba746346fbb808859366abb232027532311"
    assert fa.PIN.size == 162_870
    assert fa.LICENSE == "CC-BY-SA-4.0"
    assert fa.RELEASED == "2025-05-30"
    assert fa.TAG == "v5.0.0_release"
    assert re.fullmatch(r"[0-9a-f]{40}", fa.TAG_COMMIT)


def test_it_downloads_into_the_ignored_data_directory_and_reads_the_committed_list(
    fa: ModuleType,
) -> None:
    assert fa.DEFAULT_DEST == REPO / "data" / "standards"
    assert fa.IDS_PATH == REPO / "docs" / "security" / "asvs-5.0.0-l2-ids.txt"
    gitignore = (REPO / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "data/*" in gitignore


def test_it_writes_the_export_only_after_its_hash_matches(fa: ModuleType, tmp_path: Path) -> None:
    opener = Opener(EXPORT)

    assert fa.fetch(pin(fa), tmp_path, opener=opener) == "downloaded"
    assert (tmp_path / "asvs.flat.json").read_bytes() == EXPORT
    assert fa.fetch(pin(fa), tmp_path, opener=opener) == "present"
    assert opener.urls == ["https://example.invalid/asvs.flat.json"]


def test_it_refuses_a_different_digest_or_size_and_leaves_nothing(
    fa: ModuleType, tmp_path: Path
) -> None:
    with pytest.raises(fa.FetchError, match="SHA-256"):
        fa.fetch(pin(fa, EXPORT[:-1] + b" "), tmp_path, opener=Opener(EXPORT))
    with pytest.raises(fa.FetchError, match="over the pinned"):
        fa.fetch(pin(fa, EXPORT[:10]), tmp_path, opener=Opener(EXPORT))
    with pytest.raises(fa.FetchError, match="not the pinned"):
        fa.fetch(pin(fa, EXPORT + b"x"), tmp_path, opener=Opener(EXPORT))
    assert list(tmp_path.iterdir()) == []


def test_it_retries_a_server_error_but_not_a_client_error(fa: ModuleType, tmp_path: Path) -> None:
    delays: list[float] = []
    retried = Opener(EXPORT, failures=[503, 502])
    status = fa.fetch(pin(fa), tmp_path, opener=retried, retry_delay=0.5, sleep=delays.append)
    assert status == "downloaded"
    assert delays == [0.5, 1.0]

    refused = Opener(EXPORT, failures=[404])
    with pytest.raises(fa.FetchError, match="HTTP 404"):
        fa.fetch(pin(fa), tmp_path / "other", opener=refused, sleep=delays.append)
    assert len(refused.urls) == 1

    with pytest.raises(fa.FetchError, match="all 5 attempts"):
        fa.fetch(
            pin(fa), tmp_path / "third", opener=Opener(EXPORT, [500] * 5), sleep=lambda _: None
        )


def test_it_refuses_a_plain_http_pin(fa: ModuleType, tmp_path: Path) -> None:
    plain = fa.Pin(
        version="5.0.0", url="http://example.invalid/a", sha256="0" * 64, size=1, filename="a"
    )
    with pytest.raises(fa.FetchError, match="https"):
        fa.fetch(plain, tmp_path, opener=Opener(EXPORT))


def test_it_derives_the_level_2_ids_in_the_export_order_without_any_text(fa: ModuleType) -> None:
    assert fa.ids_from_export(EXPORT) == [
        ("v5.0.0-1.1.1", "2"),
        ("v5.0.0-1.1.2", "1"),
        ("v5.0.0-2.10.3", "2"),
        ("v5.0.0-17.3.2", "1"),
    ]
    rendered = fa.render_ids(fa.ids_from_export(EXPORT))
    assert "synthetic" not in rendered
    assert "(4: 2 at L1, 2 at L2)" in rendered
    assert fa.parse_ids(rendered) == fa.ids_from_export(EXPORT)


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (b"not json", "not JSON"),
        (b"[]", "no requirements array"),
        (json.dumps({"requirements": ["x"]}).encode(), "not an object"),
        (synthetic_export([("V1.1.1", "4")]), "level"),
        (synthetic_export([("1.1.1", "2")]), "malformed"),
        (synthetic_export([("V1.1.1", "1"), ("V1.1.1", "2")]), "repeated"),
    ],
    ids=["not-json", "no-array", "not-object", "level", "malformed", "repeated"],
)
def test_it_refuses_an_export_of_another_shape(
    fa: ModuleType, payload: bytes, message: str
) -> None:
    with pytest.raises(fa.ExportError, match=message):
        fa.ids_from_export(payload)


def test_the_list_parser_refuses_a_line_that_is_not_an_id_and_a_level(fa: ModuleType) -> None:
    with pytest.raises(fa.ExportError, match="line 2"):
        fa.parse_ids("# header\nV1.1.1 2\n")


def test_compare_names_each_difference(fa: ModuleType) -> None:
    derived = [("v5.0.0-1.1.1", "2"), ("v5.0.0-1.1.2", "1")]
    assert fa.compare_ids(derived, derived) == []
    assert fa.compare_ids(derived, [("v5.0.0-1.1.1", "2"), ("v5.0.0-9.9.9", "1")]) == [
        "missing from the committed list: v5.0.0-1.1.2 L1",
        "not in the export: v5.0.0-9.9.9 L1",
    ]
    assert fa.compare_ids(derived, list(reversed(derived))) == ["the same ids in another order"]


def test_main_writes_the_list_then_verifies_it_and_fails_on_drift(
    fa: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    ids = tmp_path / "ids.txt"
    dest = tmp_path / "dest"
    common = ["--dest", str(dest), "--ids", str(ids)]

    assert fa.main([*common, "--write-ids"], opener=Opener(EXPORT), pinned=pin(fa)) == 0
    assert fa.parse_ids(ids.read_text(encoding="utf-8")) == fa.ids_from_export(EXPORT)
    assert fa.main([*common, "--verify-ids"], opener=Opener(EXPORT), pinned=pin(fa)) == 0
    assert "matches the export (4 ids)" in capsys.readouterr().out

    ids.write_text(ids.read_text(encoding="utf-8").replace("v5.0.0-17.3.2 1\n", ""), "utf-8")
    assert fa.main([*common, "--verify-ids"], opener=Opener(EXPORT), pinned=pin(fa)) == 1
    assert "missing from the committed list: v5.0.0-17.3.2 L1" in capsys.readouterr().err

    assert (
        fa.main(
            ["--dest", str(dest), "--ids", str(tmp_path / "absent.txt"), "--verify-ids"],
            opener=Opener(EXPORT),
            pinned=pin(fa),
        )
        == 1
    )
    assert fa.main([*common], opener=Opener(EXPORT, [404]), pinned=pin(fa, b"other")) == 1
    assert "FAILED" in capsys.readouterr().err


def test_the_retry_delay_comes_from_the_environment(
    fa: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ASVS_RETRY_DELAY_SECONDS", "0.25")
    assert fa.retry_delay_from_env() == 0.25
    monkeypatch.setenv("ASVS_RETRY_DELAY_SECONDS", "soon")
    assert fa.retry_delay_from_env() == fa.DEFAULT_RETRY_DELAY_SECONDS
    monkeypatch.delenv("ASVS_RETRY_DELAY_SECONDS")
    assert fa.retry_delay_from_env() == fa.DEFAULT_RETRY_DELAY_SECONDS


def test_the_committed_list_holds_the_253_level_2_ids_with_no_text(fa: ModuleType) -> None:
    text = fa.IDS_PATH.read_text(encoding="utf-8")
    ids = fa.parse_ids(text)

    assert len(ids) == 253
    assert sum(1 for _, level in ids if level == "1") == 70
    assert sum(1 for _, level in ids if level == "2") == 183
    assert len({listed for listed, _ in ids}) == 253
    assert text == fa.render_ids(ids)
