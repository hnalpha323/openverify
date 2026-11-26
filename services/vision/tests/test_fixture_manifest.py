"""The committed fixtures/manifest.json: public-domain faces only, pinned, never committed.

Two different photos of person A (ID portrait and selfie) and one photo of a different
person B are required by the face-match tests and the e2e flow.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
MANIFEST = REPO_ROOT / "fixtures" / "manifest.json"


@pytest.fixture(scope="module")
def entries() -> list[Any]:
    spec = importlib.util.spec_from_file_location(
        "fetch_fixtures", REPO_ROOT / "scripts" / "fetch_fixtures.py"
    )
    assert spec is not None
    assert spec.loader is not None
    module: ModuleType = importlib.util.module_from_spec(spec)
    sys.modules["fetch_fixtures"] = module
    spec.loader.exec_module(module)
    loaded: list[Any] = module.load_manifest(MANIFEST)
    return loaded


def test_person_a_has_an_id_portrait_and_a_different_selfie(entries: list[Any]) -> None:
    person_a = {entry.role: entry for entry in entries if entry.person == "A"}

    assert set(person_a) == {"id_portrait", "selfie"}
    assert person_a["id_portrait"].sha256 != person_a["selfie"].sha256
    assert person_a["id_portrait"].source_page != person_a["selfie"].source_page


def test_person_b_is_someone_else_with_a_selfie(entries: list[Any]) -> None:
    person_b = [entry for entry in entries if entry.person == "B"]

    assert [entry.role for entry in person_b] == ["selfie"]
    assert person_b[0].subject
    assert all(person_b[0].subject != entry.subject for entry in entries if entry.person == "A")


def test_every_face_is_a_us_federal_public_domain_work_from_commons(entries: list[Any]) -> None:
    for entry in entries:
        assert entry.license == "public-domain", entry.name
        assert entry.license_template.startswith("PD-USGov"), entry.name
        assert entry.source_page.startswith("https://commons.wikimedia.org/wiki/File:"), entry.name
        assert entry.url.startswith("https://upload.wikimedia.org/wikipedia/commons/"), entry.name
        assert entry.author, entry.name


def test_face_payload_directories_are_gitignored() -> None:
    gitignore = (REPO_ROOT / ".gitignore").read_text().splitlines()

    assert "fixtures/faces/" in gitignore
    assert "fixtures/generated/" in gitignore


def test_no_image_is_tracked_under_fixtures() -> None:
    tracked = subprocess.run(  # noqa: S603 - fixed git invocation
        ["git", "-C", str(REPO_ROOT), "ls-files", "--", "fixtures"],  # noqa: S607
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    ).stdout.split()

    # The two committed manifests (C49.1 commits the calibration one); never an image.
    assert set(tracked) <= {"fixtures/manifest.json", "fixtures/calibration-manifest.json"}


@pytest.fixture(scope="module")
def forms(entries: list[Any]) -> list[Any]:
    # ``entries`` loaded the script as the ``fetch_fixtures`` module.
    loaded: list[Any] = sys.modules["fetch_fixtures"].load_forms(MANIFEST)
    return loaded


def test_the_held_out_set_pins_a_w2_a_1099_nec_and_a_1040(forms: list[Any]) -> None:
    # C60.7, decision 18: blank US federal forms, filled with synthetic values by the generator.
    assert sorted(form.form for form in forms) == ["1040", "1099-nec", "w2"]


def test_every_form_is_a_public_domain_irs_work_pinned_at_a_prior_year_url(
    forms: list[Any],
) -> None:
    for form in forms:
        assert form.license == "public-domain", form.name
        assert form.publisher == "Internal Revenue Service", form.name
        # irs-prior/ keeps superseded revisions unchanged; irs-pdf/ is replaced every year.
        assert form.url.startswith("https://www.irs.gov/pub/irs-prior/"), form.name
        assert form.source_page.startswith("https://www.irs.gov/"), form.name
        assert len(form.sha256) == 64, form.name
        assert form.pages, form.name


def test_the_forms_download_into_a_gitignored_directory() -> None:
    gitignore = (REPO_ROOT / ".gitignore").read_text().splitlines()

    # fetch_fixtures.py writes them to <manifest dir>/generated/federal-forms by default.
    assert "fixtures/generated/" in gitignore


def test_every_face_pins_its_commons_sha1_for_the_archive_fallback(entries: list[Any]) -> None:
    # A re-upload changes the bytes behind a Commons URL; the SHA-1 finds the archived revision.
    for entry in entries:
        assert len(entry.sha1) == 40, entry.name
        assert entry.sha1 in entry.notes, entry.name  # the value the file page check recorded
