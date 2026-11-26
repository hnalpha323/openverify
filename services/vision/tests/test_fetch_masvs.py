"""scripts/fetch_masvs.py: the pinned MASVS v2.1.0 export and the committed control id list (C275).

Network access is faked with an injected opener, and every export here is synthetic (ids with
placeholder titles and texts). Nothing here touches the internet; the committed list is read from
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
from typing import Any

import pytest

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "scripts" / "fetch_masvs.py"
GROUPS = [
    "MASVS-STORAGE",
    "MASVS-CRYPTO",
    "MASVS-AUTH",
    "MASVS-NETWORK",
    "MASVS-PLATFORM",
    "MASVS-CODE",
    "MASVS-RESILIENCE",
    "MASVS-PRIVACY",
]


@pytest.fixture(scope="module")
def fm() -> ModuleType:
    spec = importlib.util.spec_from_file_location("fetch_masvs", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_masvs"] = module
    spec.loader.exec_module(module)
    return module


def requirement(identifier: str, parent: str | None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "bom-ref": identifier,
        "identifier": identifier,
        "title": "synthetic title",
        "text": "synthetic text",
    }
    if parent is not None:
        row["parent"] = parent
    return row


def synthetic_export(
    controls: list[tuple[str, str]], groups: list[str] | None = None, ref: str = "MASVS-v2.1.0"
) -> bytes:
    """A CycloneDX export of the real shape whose titles and texts are placeholders."""
    rows = [requirement(group, None) for group in (GROUPS if groups is None else groups)]
    rows += [requirement(identifier, parent) for identifier, parent in controls]
    standard = {"bom-ref": ref, "name": "synthetic", "version": "2.1.0", "requirements": rows}
    return json.dumps({"bomFormat": "CycloneDX", "definitions": {"standards": [standard]}}).encode()


EXPORT = synthetic_export(
    [
        ("MASVS-STORAGE-1", "MASVS-STORAGE"),
        ("MASVS-CRYPTO-2", "MASVS-CRYPTO"),
        ("MASVS-PRIVACY-4", "MASVS-PRIVACY"),
    ]
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


def pin(fm: ModuleType, payload: bytes = EXPORT) -> object:
    return fm.Pin(
        version="2.1.0",
        url="https://example.invalid/masvs.cdx.json",
        sha256=hashlib.sha256(payload).hexdigest(),
        size=len(payload),
        filename="masvs.cdx.json",
    )


def test_the_pin_is_the_v2_1_0_release_asset_with_its_hash_size_licence_and_date(
    fm: ModuleType,
) -> None:
    assert (
        fm.PIN.url == "https://github.com/OWASP/masvs/releases/download/v2.1.0/OWASP_MASVS.cdx.json"
    )
    assert fm.PIN.sha256 == "abedfcdf6cbd38ffa30a2ae6fc9f98ad7cddff59f0ad35932117559a2a27e0ae"
    assert fm.PIN.size == 28_264
    assert fm.LICENSE == "CC-BY-SA-4.0"
    assert fm.RELEASED == "2024-01-18"
    assert fm.TAG == "v2.1.0"
    assert re.fullmatch(r"[0-9a-f]{40}", fm.TAG_COMMIT)
    assert list(fm.GROUPS) == GROUPS


def test_it_downloads_into_the_ignored_data_directory_and_reads_the_committed_list(
    fm: ModuleType,
) -> None:
    assert fm.DEFAULT_DEST == REPO / "data" / "standards"
    assert fm.IDS_PATH == REPO / "docs" / "security" / "masvs-2.1.0-ids.txt"


def test_it_writes_the_export_only_after_its_hash_matches(fm: ModuleType, tmp_path: Path) -> None:
    opener = Opener(EXPORT)

    assert fm.fetch(pin(fm), tmp_path, opener=opener) == "downloaded"
    assert fm.fetch(pin(fm), tmp_path, opener=opener) == "present"
    assert len(opener.urls) == 1
    with pytest.raises(fm.FetchError, match="SHA-256"):
        fm.fetch(pin(fm, EXPORT[:-1] + b" "), tmp_path / "bad", opener=Opener(EXPORT))
    assert not (tmp_path / "bad" / "masvs.cdx.json").exists()


def test_it_retries_a_server_error_but_not_a_client_error(fm: ModuleType, tmp_path: Path) -> None:
    delays: list[float] = []
    assert (
        fm.fetch(
            pin(fm), tmp_path, opener=Opener(EXPORT, [500]), retry_delay=1, sleep=delays.append
        )
        == "downloaded"
    )
    assert delays == [1]
    with pytest.raises(fm.FetchError, match="HTTP 403"):
        fm.fetch(pin(fm), tmp_path / "other", opener=Opener(EXPORT, [403]))


def test_it_derives_the_control_ids_and_their_groups_without_any_text(fm: ModuleType) -> None:
    ids = fm.ids_from_export(EXPORT)

    assert ids == [
        ("MASVS-STORAGE-1", "MASVS-STORAGE"),
        ("MASVS-CRYPTO-2", "MASVS-CRYPTO"),
        ("MASVS-PRIVACY-4", "MASVS-PRIVACY"),
    ]
    rendered = fm.render_ids(ids)
    assert "synthetic" not in rendered
    assert "the ids of the 3 controls and their groups (3 groups)" in rendered
    assert fm.parse_ids(rendered) == ids


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (b"{", "not JSON"),
        (json.dumps({"definitions": {"standards": []}}).encode(), "exactly one standard"),
        (synthetic_export([], ref="MASVS-v2.0.0"), "MASVS-v2.0.0"),
        (
            json.dumps(
                {"definitions": {"standards": [{"bom-ref": "MASVS-v2.1.0", "requirements": {}}]}}
            ).encode(),
            "no requirements array",
        ),
        (
            json.dumps(
                {"definitions": {"standards": [{"bom-ref": "MASVS-v2.1.0", "requirements": [1]}]}}
            ).encode(),
            "not an object",
        ),
        (synthetic_export([("MASVS-STORAGE-1", "MASVS-CODE")]), "outside its group"),
        (synthetic_export([("MASVS-STORAGE-x", "MASVS-STORAGE")]), "malformed"),
        (
            synthetic_export([("MASVS-CODE-1", "MASVS-CODE"), ("MASVS-CODE-1", "MASVS-CODE")]),
            "repeated",
        ),
        (synthetic_export([], groups=GROUPS[:7]), "eight"),
    ],
    ids=[
        "not-json",
        "standards",
        "ref",
        "no-array",
        "not-object",
        "group",
        "malformed",
        "repeated",
        "eight",
    ],
)
def test_it_refuses_an_export_of_another_shape(
    fm: ModuleType, payload: bytes, message: str
) -> None:
    with pytest.raises(fm.ExportError, match=message):
        fm.ids_from_export(payload)


def test_main_writes_the_list_then_verifies_it_and_fails_on_drift(
    fm: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    ids = tmp_path / "ids.txt"
    common = ["--dest", str(tmp_path / "dest"), "--ids", str(ids)]

    assert fm.main([*common, "--write-ids"], opener=Opener(EXPORT), pinned=pin(fm)) == 0
    assert fm.main([*common, "--verify-ids"], opener=Opener(EXPORT), pinned=pin(fm)) == 0
    assert "matches the export (3 ids)" in capsys.readouterr().out

    ids.write_text(ids.read_text(encoding="utf-8") + "MASVS-CODE-9 MASVS-CODE\n", "utf-8")
    assert fm.main([*common, "--verify-ids"], opener=Opener(EXPORT), pinned=pin(fm)) == 1
    assert "not in the export: MASVS-CODE-9 MASVS-CODE" in capsys.readouterr().err

    ids.write_text("MASVS-CODE-9\n", "utf-8")
    assert fm.main([*common, "--verify-ids"], opener=Opener(EXPORT), pinned=pin(fm)) == 1
    assert "'<id> <group>'" in capsys.readouterr().err


def test_the_committed_list_holds_the_24_controls_of_the_eight_groups_with_no_text(
    fm: ModuleType,
) -> None:
    text = fm.IDS_PATH.read_text(encoding="utf-8")
    ids = fm.parse_ids(text)

    assert len(ids) == 24
    assert len({listed for listed, _ in ids}) == 24
    assert [group for group in GROUPS if any(g == group for _, g in ids)] == GROUPS
    assert all(listed.startswith(f"{group}-") for listed, group in ids)
    assert text == fm.render_ids(ids)
