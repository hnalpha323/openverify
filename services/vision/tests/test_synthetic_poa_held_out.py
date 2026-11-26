"""tools/synthetic_poa.py, the held-out set (C60.7): other layouts, other people, other words.

Written apart from the classifier (H23). The federal forms are stand-ins built here with the same
nested field names as the pinned IRS files (and the XFA, JavaScript and usage-rights entries the
fill must drop); ``test_the_real_federal_forms_fill`` runs on the pinned files once fetched.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
from collections import Counter
from datetime import date
from pathlib import Path

import pytest
from PIL import Image
from pypdf import PdfReader, PdfWriter

from synthetic_poa import (
    COVERED_LANGUAGES,
    DOCUMENT_CLASSES,
    FEDERAL_FILLS,
    HELD_OUT_PEOPLE_NAMES,
    SYNTHETIC_BANNER,
    FederalForm,
    Fixture,
    FormFillError,
    fill_federal_form,
    held_out_set,
    main_set,
)
from synthetic_poa_checks import PAGES, page_count, page_text, stand_in_form, text_objects

AS_OF = date(2026, 10, 24)
REPO_ROOT = Path(__file__).resolve().parents[3]
FORMS_DIR = REPO_ROOT / "fixtures" / "generated" / "federal-forms"
MANIFEST = REPO_ROOT / "fixtures" / "manifest.json"
KEYS = {
    "schema_version",
    "file",
    "media_type",
    "sha256",
    "set",
    "id",
    "label",
    "identity_document",
    "language",
    "covered_language",
    "layout",
    "form",
    "source",
    "pages",
    "description",
    "as_of",
    "expected_answer",
    "acceptable_answers",
    "expect",
    "fields",
}


def stand_in_forms() -> list[FederalForm]:
    return [
        FederalForm(form, stand_in_form(form), PAGES[form]) for form in ("w2", "1099-nec", "1040")
    ]


def identity_images() -> dict[str, bytes]:
    images = {}
    for key, colour in (("td3-passport", (180, 200, 220)), ("td1-card", (200, 220, 210))):
        buffer = io.BytesIO()
        Image.new("RGB", (640, 420), colour).save(buffer, format="JPEG", quality=90)
        images[key] = buffer.getvalue()
    return images


@pytest.fixture(scope="module")
def held_out() -> dict[str, Fixture]:
    fixtures = held_out_set(AS_OF, stand_in_forms(), identity_images())
    return {fixture.path: fixture for fixture in fixtures}


def kebab(name: str) -> str:
    return name.replace("_", "-")


# --- shape and counts ---------------------------------------------------------------------------


def test_every_file_has_a_complete_sidecar(held_out: dict[str, Fixture]) -> None:
    for path, fixture in held_out.items():
        sidecar = fixture.sidecar
        assert set(sidecar) == KEYS, path
        assert sidecar["set"] == "held-out"
        assert sidecar["file"] == path
        assert "/" not in path
        assert sidecar["id"] == path.rsplit(".", 1)[0]
        assert sidecar["sha256"] == hashlib.sha256(fixture.data).hexdigest()
        assert sidecar["covered_language"] == (sidecar["language"] in COVERED_LANGUAGES)
        assert sidecar["expected_answer"] in sidecar["acceptable_answers"]
        json.dumps(sidecar)  # JSON as it is


def test_the_set_holds_fifty_nine_documents(held_out: dict[str, Fixture]) -> None:
    labels = Counter(f.sidecar["label"] for f in held_out.values())
    layouts = Counter(f.sidecar["layout"].split("-")[0] for f in held_out.values())
    forms = Counter(f.sidecar["form"] for f in held_out.values())

    assert len(held_out) == 59
    assert layouts == {"B": 34, "C": 10, "other": 8, "identity": 2, "federal": 5}
    assert labels["other"] == 10
    assert labels["tax_document"] == 4 + 2 + 2 + 5  # B en/es/fr/de, B photos, C en/es, federal
    assert forms == {"pdf": 45, "photo": 14}


@pytest.mark.parametrize("kind", DOCUMENT_CLASSES)
def test_each_class_comes_in_two_new_layouts_and_four_covered_languages(
    held_out: dict[str, Fixture], kind: str
) -> None:
    for language in ("en", "es"):
        assert f"b-{language}-{kebab(kind)}.pdf" in held_out
        assert f"b-{language}-{kebab(kind)}-photo.jpg" in held_out
        assert f"c-{language}-{kebab(kind)}.pdf" in held_out
    for language in ("fr", "de"):
        assert f"b-{language}-{kebab(kind)}.pdf" in held_out


# --- the answers --------------------------------------------------------------------------------


def test_a_class_in_a_covered_language_should_be_named(held_out: dict[str, Fixture]) -> None:
    fixture = held_out["b-fr-lease.pdf"]

    assert fixture.sidecar["expected_answer"] == "lease"
    assert fixture.sidecar["acceptable_answers"] == ["lease"]
    assert fixture.sidecar["expect"]["document_type_detection"] == {
        "status": "passed",
        "reasons": [],
    }


@pytest.mark.parametrize(
    "path",
    [
        "b-it-utility-bill.pdf",
        "b-pt-utility-bill.pdf",
        "b-it-bank-statement.pdf",
        "b-pt-bank-statement.pdf",
    ],
)
def test_a_language_the_lexicons_do_not_cover_should_be_unknown(
    held_out: dict[str, Fixture], path: str
) -> None:
    sidecar = held_out[path].sidecar

    assert sidecar["covered_language"] is False
    assert sidecar["label"] in DOCUMENT_CLASSES  # the truth stays the class
    assert sidecar["expected_answer"] == "unknown"
    assert sidecar["expect"]["document_type_detection"] == {
        "status": "not_applicable",
        "reasons": ["document_type_unknown"],
    }


@pytest.mark.parametrize("path", ["identity-td3-passport.jpg", "identity-td1-card.jpg"])
def test_an_identity_document_is_other_and_not_accepted(
    held_out: dict[str, Fixture], path: str
) -> None:
    sidecar = held_out[path].sidecar

    assert sidecar["label"] == "other"
    assert sidecar["identity_document"] is True
    assert sidecar["expect"]["document_type_detection"] == {
        "status": "failed",
        "reasons": ["document_type_not_accepted"],
    }


def test_a_document_of_no_class_goes_to_review(held_out: dict[str, Fixture]) -> None:
    others = [f for path, f in held_out.items() if path.startswith("other-")]

    assert {f.sidecar["layout"] for f in others} == {
        "other-receipt",
        "other-invitation",
        "other-newsletter",
        "other-menu",
    }
    for fixture in others:
        assert fixture.sidecar["acceptable_answers"] == ["other", "unknown"]
        assert fixture.sidecar["expect"]["document_type_detection"] == {
            "status": "not_applicable",
            "reasons": ["document_type_unknown"],
        }
        assert fixture.sidecar["fields"] is None


# --- what the documents print -------------------------------------------------------------------


def visible(data: bytes) -> str:
    return "\n".join(
        obj.text
        for index in range(page_count(data))
        for obj in text_objects(data, index)
        if obj.render_mode == 0
    )


def test_each_synthetic_pdf_prints_its_holder_issuer_and_date(held_out: dict[str, Fixture]) -> None:
    for path, fixture in held_out.items():
        if fixture.sidecar["source"] != "synthetic" or not path.endswith(".pdf"):
            continue
        text = visible(fixture.data)
        assert SYNTHETIC_BANNER in text, path
        fields = fixture.sidecar["fields"]
        if fields is None:
            continue
        assert fields["name"] in text, path
        assert fields["address-street-1"] in text, path
        assert fields["issuer"].upper() in text.upper(), path


def test_the_held_out_people_and_issuers_are_not_the_main_sets(
    held_out: dict[str, Fixture],
) -> None:
    main = main_set(AS_OF)
    main_names = {f.sidecar["holder"]["name"] for f in main}
    main_issuers = {f.sidecar["issuer"] for f in main}
    held_names = {
        f.sidecar["fields"]["name"] for f in held_out.values() if f.sidecar["fields"] is not None
    }
    held_issuers = {
        f.sidecar["fields"]["issuer"]
        for f in held_out.values()
        if f.sidecar["fields"] is not None and f.sidecar["fields"]["issuer"] is not None
    }

    assert held_names
    assert held_names <= {name.upper() for name in HELD_OUT_PEOPLE_NAMES}
    assert held_names.isdisjoint(main_names)
    assert held_issuers.isdisjoint(main_issuers)


def test_photos_are_jpegs(held_out: dict[str, Fixture]) -> None:
    for path, fixture in held_out.items():
        if path.endswith(".jpg"):
            with Image.open(io.BytesIO(fixture.data)) as image:
                assert image.format == "JPEG", path


def test_the_set_is_deterministic(held_out: dict[str, Fixture]) -> None:
    again = held_out_set(AS_OF, stand_in_forms(), identity_images())

    assert {f.path: f.data for f in again} == {p: f.data for p, f in held_out.items()}


# --- the federal forms --------------------------------------------------------------------------


@pytest.mark.parametrize("form", ["w2", "1099-nec", "1040"])
def test_a_filled_form_prints_every_value_and_keeps_nothing_active(form: str) -> None:
    filled = fill_federal_form(FederalForm(form, stand_in_form(form), PAGES[form]))

    assert page_count(filled) == len(PAGES[form])
    text = "\n".join(page_text(filled, index) for index in range(page_count(filled)))
    for value in FEDERAL_FILLS[form].values():
        for line in value.split("\n"):
            assert line in text, (form, line)
    assert SYNTHETIC_BANNER in text
    for marker in (b"/AcroForm", b"/XFA", b"/JavaScript", b"/Perms", b"/Widget", b"/AA"):
        assert marker not in filled, (form, marker)
    assert PdfReader(io.BytesIO(filled)).metadata.producer == "OpenVerify synthetic form filler"  # type: ignore[union-attr]


def test_a_form_missing_a_field_of_the_fill_is_refused() -> None:
    writer = PdfWriter()
    for _ in range(4):
        writer.add_blank_page(612, 792)
    buffer = io.BytesIO()
    writer.write(buffer)

    with pytest.raises(FormFillError, match="has no field"):
        fill_federal_form(FederalForm("w2", buffer.getvalue(), (4,)))


def test_the_federal_forms_are_tax_documents_of_the_held_out_holder(
    held_out: dict[str, Fixture],
) -> None:
    federal = {path: f for path, f in held_out.items() if path.startswith("federal-")}

    assert set(federal) == {
        "federal-w2.pdf",
        "federal-w2-photo.jpg",
        "federal-1099-nec.pdf",
        "federal-1040.pdf",
        "federal-1040-photo.jpg",
    }
    for fixture in federal.values():
        assert fixture.sidecar["label"] == "tax_document"
        assert fixture.sidecar["expected_answer"] == "tax_document"
        assert fixture.sidecar["fields"]["name"] == "ARLO PENHALLOW"
        assert fixture.sidecar["fields"]["issue-date"] is None  # no federal form prints one
        assert re.fullmatch(r"irs-(w2|1099-nec|1040)", fixture.sidecar["source"])


def pinned_forms() -> list[FederalForm] | None:
    entries = json.loads(MANIFEST.read_text(encoding="utf-8")).get("forms", [])
    forms = []
    for entry in entries:
        path = FORMS_DIR / entry["filename"]
        if not path.is_file():
            return None
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == entry["sha256"]
        forms.append(FederalForm(entry["form"], data, tuple(entry["pages"])))
    return forms


@pytest.mark.skipif(
    pinned_forms() is None,
    reason="the pinned federal forms are not fetched; run python3 scripts/fetch_fixtures.py",
)
def test_the_real_federal_forms_fill() -> None:
    forms = pinned_forms()
    assert forms is not None
    for form in forms:
        filled = fill_federal_form(form)
        assert page_count(filled) == len(form.pages)
        text = "\n".join(page_text(filled, index) for index in range(page_count(filled)))
        for value in FEDERAL_FILLS[form.form].values():
            for line in value.split("\n"):
                assert line in text, (form.form, line)
        for marker in (b"/AcroForm", b"/XFA", b"/JavaScript", b"/Perms", b"/Widget"):
            assert marker not in filled, (form.form, marker)
