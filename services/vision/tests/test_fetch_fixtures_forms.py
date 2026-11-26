"""scripts/fetch_fixtures.py: the blank US federal forms of the held-out document set (C60.7).

The manifest's ``forms`` list pins each form like a face: an https URL on a federal agency's own
host, a SHA-256 digest and a byte size, the pages the held-out set takes and why the work is
public domain. A default run fetches them beside the faces, into
``<manifest dir>/generated/federal-forms`` (gitignored). Nothing here touches the network: the
web is :class:`FakeWeb`, the clock :class:`FakeClock`, and the "forms" are plain bytes.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from fetch_script import FakeClock, FakeWeb, Reply, load_script

FORM_BYTES = b"%PDF-1.7 not really a form, deterministic test bytes" * 8
FORM_SHA = hashlib.sha256(FORM_BYTES).hexdigest()
FORM_URL = "https://www.irs.gov/pub/irs-prior/fw2--2025.pdf"
FACE_BYTES = b"not really a jpeg" * 20
FACE_URL = "https://upload.example.invalid/wikipedia/commons/a/ab/Face.jpg"


@pytest.fixture(scope="module")
def ff() -> ModuleType:
    return load_script()


def form_dict(**overrides: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "name": "irs_w2_2025",
        "form": "w2",
        "filename": "fw2--2025.pdf",
        "source_page": "https://www.irs.gov/forms-pubs/about-form-w-2",
        "url": FORM_URL,
        "sha256": FORM_SHA,
        "size": len(FORM_BYTES),
        "license": "public-domain",
        "publisher": "Internal Revenue Service",
        "pages": [4],
        "revision": "2025",
    }
    entry.update(overrides)
    return entry


def face_dict(**overrides: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "name": "person_a_id",
        "person": "A",
        "role": "id_portrait",
        "filename": "person-a-id.jpg",
        "source_page": "https://commons.example.invalid/wiki/File:Face.jpg",
        "url": FACE_URL,
        "sha256": hashlib.sha256(FACE_BYTES).hexdigest(),
        "size": len(FACE_BYTES),
        "license": "public-domain",
        "license_template": "PD-USGov-NASA",
        "author": "NASA/Example Photographer",
        "face_box": [1, 2, 3, 4],
    }
    entry.update(overrides)
    return entry


def write_manifest(path: Path, *, faces: list[Any], forms: list[Any] | None) -> Path:
    document: dict[str, Any] = {"schema_version": 1, "faces": faces}
    if forms is not None:
        document["forms"] = forms
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def run(ff: ModuleType, web: FakeWeb, clock: FakeClock, *argv: str) -> int:
    code: int = ff.main(list(argv), opener=web, clock=clock, sleep=clock.sleep)
    return code


# --- the manifest -------------------------------------------------------------------------------


def test_load_forms_parses_each_pinned_form(ff: ModuleType, tmp_path: Path) -> None:
    manifest = write_manifest(
        tmp_path / "manifest.json",
        faces=[face_dict()],
        forms=[
            form_dict(notes="checked"),
            form_dict(name="irs_1040", form="1040", filename="f1040--2025.pdf", pages=[1, 2]),
        ],
    )

    first, second = ff.load_forms(manifest)

    assert first == ff.FormFixture(
        name="irs_w2_2025",
        form="w2",
        filename="fw2--2025.pdf",
        source_page="https://www.irs.gov/forms-pubs/about-form-w-2",
        url=FORM_URL,
        sha256=FORM_SHA,
        size=len(FORM_BYTES),
        license="public-domain",
        publisher="Internal Revenue Service",
        pages=(4,),
        revision="2025",
        notes="checked",
    )
    assert second.pages == (1, 2)
    assert first.sha1 == ""  # no Commons archive fallback for a form
    assert first.license_template == "17 U.S.C. 105"


def test_a_manifest_without_forms_has_none(ff: ModuleType, tmp_path: Path) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", faces=[face_dict()], forms=None)

    assert ff.load_forms(manifest) == []


@pytest.mark.parametrize(
    ("overrides", "complaint"),
    [
        ({"url": "http://www.irs.gov/pub/irs-prior/fw2--2025.pdf"}, "https"),
        ({"url": "https://irs.example.invalid/fw2.pdf"}, "federal"),
        ({"source_page": "ftp://www.irs.gov/x"}, "https"),
        ({"license": "CC-BY-4.0"}, "public-domain"),
        ({"sha256": "ABC"}, "sha256"),
        ({"size": 0}, "size"),
        ({"pages": []}, "pages"),
        ({"pages": [0]}, "pages"),
        ({"pages": [2, 2]}, "pages"),
        ({"pages": ["1"]}, "pages"),
        ({"form": "1099-int"}, "form"),
        ({"name": "Bad Name"}, "name"),
        ({"filename": "../escape.pdf"}, "filename"),
        ({"publisher": " "}, "publisher"),
        ({"revision": ""}, "revision"),
        ({"surprise": 1}, "unknown"),
    ],
)
def test_a_form_that_breaks_the_policy_is_refused(
    ff: ModuleType, tmp_path: Path, overrides: dict[str, Any], complaint: str
) -> None:
    manifest = write_manifest(
        tmp_path / "manifest.json", faces=[face_dict()], forms=[form_dict(**overrides)]
    )

    with pytest.raises(ff.ManifestError, match=complaint):
        ff.load_forms(manifest)


def test_a_form_without_a_required_field_is_refused(ff: ModuleType, tmp_path: Path) -> None:
    entry = form_dict()
    del entry["pages"]
    manifest = write_manifest(tmp_path / "manifest.json", faces=[face_dict()], forms=[entry])

    with pytest.raises(ff.ManifestError, match="pages"):
        ff.load_forms(manifest)


def test_duplicate_form_names_or_files_are_refused(ff: ModuleType, tmp_path: Path) -> None:
    names = write_manifest(
        tmp_path / "names.json",
        faces=[face_dict()],
        forms=[form_dict(), form_dict(filename="other.pdf")],
    )
    files = write_manifest(
        tmp_path / "files.json", faces=[face_dict()], forms=[form_dict(), form_dict(name="b")]
    )

    with pytest.raises(ff.ManifestError, match="duplicate"):
        ff.load_forms(names)
    with pytest.raises(ff.ManifestError, match="duplicate"):
        ff.load_forms(files)


def test_forms_must_be_a_list_of_objects(ff: ModuleType, tmp_path: Path) -> None:
    not_a_list = tmp_path / "a.json"
    not_a_list.write_text(json.dumps({"faces": [], "forms": {"w2": 1}}), encoding="utf-8")
    not_objects = write_manifest(tmp_path / "b.json", faces=[], forms=["fw2.pdf"])

    with pytest.raises(ff.ManifestError, match="forms"):
        ff.load_forms(not_a_list)
    with pytest.raises(ff.ManifestError, match="form entry #0"):
        ff.load_forms(not_objects)


# --- the command line ---------------------------------------------------------------------------


def test_a_default_run_fetches_the_faces_and_the_forms(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", faces=[face_dict()], forms=[form_dict()])
    clock = FakeClock()
    web = FakeWeb({FACE_URL: Reply(body=FACE_BYTES), FORM_URL: Reply(body=FORM_BYTES)}, clock)

    assert run(ff, web, clock, "--manifest", str(manifest)) == 0
    assert run(ff, web, clock, "--manifest", str(manifest)) == 0  # rerunnable: nothing refetched

    assert sorted(web.urls) == sorted([FACE_URL, FORM_URL])
    form = tmp_path / "generated" / "federal-forms" / "fw2--2025.pdf"
    assert form.read_bytes() == FORM_BYTES
    assert (tmp_path / "faces" / "person-a-id.jpg").read_bytes() == FACE_BYTES
    out = capsys.readouterr().out
    assert f"irs_w2_2025: downloaded {form} (17 U.S.C. 105)" in out
    assert f"irs_w2_2025: present {form} (17 U.S.C. 105)" in out


def test_forms_dest_and_only_choose_where_and_what(ff: ModuleType, tmp_path: Path) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", faces=[face_dict()], forms=[form_dict()])
    clock = FakeClock()
    web = FakeWeb({FACE_URL: Reply(body=FACE_BYTES), FORM_URL: Reply(body=FORM_BYTES)}, clock)

    code = run(
        ff,
        web,
        clock,
        "--manifest",
        str(manifest),
        "--forms-dest",
        str(tmp_path / "forms"),
        "--only",
        "irs_w2_2025",
    )

    assert code == 0
    assert web.urls == [FORM_URL]
    assert (tmp_path / "forms" / "fw2--2025.pdf").is_file()
    assert not (tmp_path / "faces").exists()


def test_a_tampered_form_is_refused_and_fails_the_run(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(tmp_path / "manifest.json", faces=[face_dict()], forms=[form_dict()])
    clock = FakeClock()
    web = FakeWeb({FACE_URL: Reply(body=FACE_BYTES), FORM_URL: Reply(body=b"x" * 40)}, clock)

    code = run(ff, web, clock, "--manifest", str(manifest))

    assert code == 1
    assert "irs_w2_2025: FAILED" in capsys.readouterr().err
    assert list((tmp_path / "generated" / "federal-forms").iterdir()) == []
    assert web.urls.count(FORM_URL) == 1  # not a Commons file: no archive lookup


def test_an_invalid_form_entry_stops_the_run_before_any_download(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(
        tmp_path / "manifest.json", faces=[face_dict()], forms=[form_dict(license="unknown")]
    )
    clock = FakeClock()
    web = FakeWeb({}, clock)

    assert run(ff, web, clock, "--manifest", str(manifest)) == 2
    assert web.urls == []
    assert "public-domain" in capsys.readouterr().err


def test_a_name_shared_by_a_face_and_a_form_is_refused(
    ff: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(
        tmp_path / "manifest.json",
        faces=[face_dict()],
        forms=[form_dict(name="person_a_id")],
    )
    clock = FakeClock()

    assert run(ff, FakeWeb({}, clock), clock, "--manifest", str(manifest)) == 2
    assert "person_a_id" in capsys.readouterr().err


def test_the_calibration_mode_fetches_no_form(ff: ModuleType, tmp_path: Path) -> None:
    # A regression guard: the C49 calibration run reads its own manifest and never the forms.
    calibration = tmp_path / "calibration-manifest.json"
    calibration.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "description": "d",
                "purpose": "p",
                "takedown": "t",
                "identities": [],
            }
        ),
        encoding="utf-8",
    )
    write_manifest(tmp_path / "manifest.json", faces=[face_dict()], forms=[form_dict()])
    clock = FakeClock()
    web = FakeWeb({FORM_URL: Reply(body=FORM_BYTES)}, clock)

    assert run(ff, web, clock, "--calibration", "--manifest", str(calibration)) == 0
    assert web.urls == []
