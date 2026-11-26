"""tools/synthetic_poa.py, the main set (C65.2): what each file is, shows and carries.

The set is generated once for a fixed ``as_of`` date. Each property a variant is built to show is
read back with PDFium (pypdfium2's raw API), strict pypdf or Pillow, never taken from the sidecar
alone; the sidecars are then checked against those readings.
"""

from __future__ import annotations

import hashlib
import io
import re
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
import pypdfium2 as pdfium  # type: ignore[import-untyped]
import pytest
from PIL import Image
from pypdf import PdfReader

from synthetic_poa import (
    DOCUMENT_CHECKS,
    DOCUMENT_CLASSES,
    EDITOR_PRODUCER,
    EDITOR_SOFTWARE,
    MAIN_LANGUAGES,
    PHOTO_SIZE,
    SYNTHETIC_BANNER,
    Fixture,
    main_set,
)
from synthetic_poa_checks import (
    catalog,
    filled_paths,
    has_valid_xref,
    is_linearized,
    page_count,
    page_text,
    reader,
    signature_byte_ranges,
    text_objects,
    trailer_ends,
)

AS_OF = date(2026, 10, 24)

SIDECAR_KEYS = {
    "schema_version",
    "file",
    "media_type",
    "sha256",
    "set",
    "group",
    "variant",
    "class",
    "language",
    "form",
    "description",
    "as_of",
    "read_on",
    "pages",
    "issuer",
    "holder",
    "inquiry_fields",
    "fields",
    "printed_dates",
    "hidden_text",
    "text_layer_differs",
    "cues",
    "pdf",
    "image",
    "expect",
}
FIELD_KEYS = {
    "name",
    "address-street-1",
    "address-street-2",
    "address-city",
    "address-subdivision",
    "address-postal-code",
    "address-country-code",
    "issue-date",
    "issuer",
    "expiration-date",
}
STATUSES = {"passed", "failed", "not_applicable", None}


@pytest.fixture(scope="module")
def fixtures() -> list[Fixture]:
    return main_set(AS_OF)


@pytest.fixture(scope="module")
def by_path(fixtures: list[Fixture]) -> dict[str, Fixture]:
    return {fixture.path: fixture for fixture in fixtures}


def get(by_path: dict[str, Fixture], path: str) -> Fixture:
    assert path in by_path, sorted(by_path)
    return by_path[path]


def iso(value: str) -> date:
    return date.fromisoformat(value)


def status(fixture: Fixture, check: str) -> Any:
    return fixture.sidecar["expect"][check]["status"]


def reasons(fixture: Fixture, check: str) -> list[str]:
    found: list[str] = fixture.sidecar["expect"][check]["reasons"]
    return found


def kebab(name: str) -> str:
    return name.replace("_", "-")


def text_of(fixture: Fixture) -> str:
    return "\n".join(page_text(fixture.data, index) for index in range(page_count(fixture.data)))


# --- the shape of the set -----------------------------------------------------------------------


def test_every_class_and_language_comes_as_a_pdf_and_a_photo(by_path: dict[str, Fixture]) -> None:
    for kind in DOCUMENT_CLASSES:
        for language in MAIN_LANGUAGES:
            pdf = get(by_path, f"{language}/{kebab(kind)}/happy.pdf")
            photo = get(by_path, f"{language}/{kebab(kind)}/happy-photo.jpg")
            for fixture, form in ((pdf, "pdf"), (photo, "photo")):
                assert fixture.sidecar["class"] == kind
                assert fixture.sidecar["language"] == language
                assert fixture.sidecar["form"] == form
                assert fixture.sidecar["group"] == "happy"


def test_paths_are_unique_and_every_sidecar_is_complete(fixtures: list[Fixture]) -> None:
    assert len({fixture.path for fixture in fixtures}) == len(fixtures)
    for fixture in fixtures:
        sidecar = fixture.sidecar
        assert set(sidecar) == SIDECAR_KEYS, fixture.path
        assert sidecar["schema_version"] == 1
        assert sidecar["file"] == fixture.path
        assert sidecar["set"] == "main"
        assert sidecar["sha256"] == hashlib.sha256(fixture.data).hexdigest()
        assert sidecar["as_of"] == AS_OF.isoformat()
        assert set(sidecar["fields"]) == FIELD_KEYS, fixture.path
        assert set(sidecar["expect"]) == set(DOCUMENT_CHECKS), fixture.path
        for check in DOCUMENT_CHECKS:
            assert sidecar["expect"][check]["status"] in STATUSES, (fixture.path, check)
        assert re.fullmatch(r"[a-z]{2}/[a-z-]+/[a-z0-9-]+\.(pdf|jpg)", fixture.path), fixture.path


def test_media_types_match_the_bytes(fixtures: list[Fixture]) -> None:
    for fixture in fixtures:
        if fixture.path.endswith(".pdf"):
            assert fixture.sidecar["media_type"] == "application/pdf"
            assert fixture.data.startswith(b"%PDF-")
        else:
            assert fixture.sidecar["media_type"] == "image/jpeg"
            with Image.open(io.BytesIO(fixture.data)) as image:
                assert image.format == "JPEG"
                assert image.size == PHOTO_SIZE


def test_the_set_is_deterministic(fixtures: list[Fixture]) -> None:
    again = main_set(AS_OF)

    assert [(f.path, f.data, f.sidecar) for f in again] == [
        (f.path, f.data, f.sidecar) for f in fixtures
    ]


# --- synthetic only (C65.1) ---------------------------------------------------------------------


def test_every_pdf_page_prints_the_synthetic_banner(fixtures: list[Fixture]) -> None:
    for fixture in fixtures:
        if fixture.sidecar["form"] != "pdf" or fixture.sidecar["variant"] == "password-protected":
            continue
        for index in range(page_count(fixture.data)):
            assert SYNTHETIC_BANNER in page_text(fixture.data, index), fixture.path


def test_only_reserved_domains_and_fictional_numbers_are_printed(fixtures: list[Fixture]) -> None:
    for fixture in fixtures:
        if fixture.sidecar["form"] != "pdf" or fixture.sidecar["variant"] == "password-protected":
            continue
        text = text_of(fixture)
        # A host name: labels and a top-level label of three letters or more (S.A., S.L. are not).
        for domain in re.findall(r"\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{3,}\b", text.lower()):
            assert domain.endswith(".example"), (fixture.path, domain)
        for phone in re.findall(r"\(\d{3}\) \d{3}-\d{4}", text):
            assert re.fullmatch(r"\(555\) 01\d-\d{4}", phone), (fixture.path, phone)
        assert "www." not in text.lower()


def test_holders_match_their_inquiry_fields(fixtures: list[Fixture]) -> None:
    for fixture in fixtures:
        holder, inquiry = fixture.sidecar["holder"], fixture.sidecar["inquiry_fields"]
        assert holder["name"].upper() == (
            f"{inquiry['name_first']} {inquiry['name_last']}".upper()
        ), fixture.path
        if fixture.sidecar["language"] == "en":
            assert inquiry["address_country_code"] == "US"
            assert inquiry["address_postal_code"].startswith("000")  # unassigned ZIP codes
        else:
            assert inquiry["address_country_code"] == "ES"
            assert inquiry["address_postal_code"].startswith("53")  # beyond Spain's 52 provinces


# --- what each happy PDF says -------------------------------------------------------------------


@pytest.mark.parametrize("language", MAIN_LANGUAGES)
@pytest.mark.parametrize("kind", DOCUMENT_CLASSES)
def test_a_happy_pdf_prints_its_fields_in_visible_text(
    by_path: dict[str, Fixture], kind: str, language: str
) -> None:
    fixture = get(by_path, f"{language}/{kebab(kind)}/happy.pdf")
    fields = fixture.sidecar["fields"]

    reader(fixture.data)  # parses strictly
    visible = "\n".join(
        obj.text
        for index in range(page_count(fixture.data))
        for obj in text_objects(fixture.data, index)
        if obj.render_mode == 0
    )
    assert fields["name"] in visible
    assert fields["address-street-1"] in visible
    assert fields["address-city"] in visible
    assert fields["address-postal-code"] in visible
    assert fields["issuer"].upper() in visible.upper()
    assert fixture.sidecar["printed_dates"]["issue-date"]["text"] in visible
    assert fixture.sidecar["hidden_text"] == []
    assert fixture.sidecar["cues"] == []
    assert fixture.sidecar["pdf"]["revisions"] == 1
    info = reader(fixture.data).metadata
    assert info is not None
    assert fixture.sidecar["pdf"]["producer"] == info.producer


@pytest.mark.parametrize("language", MAIN_LANGUAGES)
@pytest.mark.parametrize("kind", DOCUMENT_CLASSES)
def test_a_happy_document_passes_every_check_on_its_day(
    by_path: dict[str, Fixture], kind: str, language: str
) -> None:
    for form in ("happy.pdf", "happy-photo.jpg"):
        fixture = get(by_path, f"{language}/{kebab(kind)}/{form}")
        assert fixture.sidecar["read_on"] == AS_OF.isoformat()
        for check in (
            "document_type_detection",
            "document_extracted_properties_detection",
            "document_recency_detection",
            "document_fabrication_detection",
            "document_name_comparison",
            "document_address_comparison",
        ):
            assert status(fixture, check) == "passed", (fixture.path, check)
        # C60.6: only a lease prints an expiry; the other classes have none to judge.
        if kind == "lease":
            assert status(fixture, "document_expired_detection") == "passed"
        else:
            assert status(fixture, "document_expired_detection") == "not_applicable"
            assert reasons(fixture, "document_expired_detection") == ["feature_absent"]


@pytest.mark.parametrize("language", MAIN_LANGUAGES)
@pytest.mark.parametrize("kind", DOCUMENT_CLASSES)
def test_happy_documents_are_recent_on_their_day(
    by_path: dict[str, Fixture], kind: str, language: str
) -> None:
    dates = get(by_path, f"{language}/{kebab(kind)}/happy.pdf").sidecar["printed_dates"]
    issued = iso(dates["issue-date"]["date"])

    assert issued <= AS_OF
    if kind == "lease":
        assert iso(dates["lease-start"]["date"]) <= AS_OF <= iso(dates["lease-end"]["date"])
    elif kind == "tax_document":
        assert (AS_OF - issued).days <= 548  # 18 months (C60.6)
    else:
        assert (AS_OF - issued).days <= 90


def test_a_photo_shows_the_same_document_as_its_pdf(by_path: dict[str, Fixture]) -> None:
    for kind in DOCUMENT_CLASSES:
        for language in MAIN_LANGUAGES:
            pdf = get(by_path, f"{language}/{kebab(kind)}/happy.pdf").sidecar
            photo = get(by_path, f"{language}/{kebab(kind)}/happy-photo.jpg").sidecar
            assert photo["fields"] == pdf["fields"]
            assert photo["printed_dates"] == pdf["printed_dates"]
            assert photo["pdf"] is None
            assert photo["image"]["jpeg_quality"] == 88
            assert photo["image"]["exif_software"] is None


# --- the date cases (C60.6, V13) ----------------------------------------------------------------


def test_a_too_old_bill_fails_recency(by_path: dict[str, Fixture]) -> None:
    for path in ("en/utility-bill/too-old.pdf", "en/utility-bill/too-old-photo.jpg"):
        fixture = get(by_path, path)
        issued = iso(fixture.sidecar["printed_dates"]["issue-date"]["date"])
        assert (AS_OF - issued).days > 90
        assert status(fixture, "document_recency_detection") == "failed"
        assert reasons(fixture, "document_recency_detection") == ["document_too_old"]
        assert status(fixture, "document_type_detection") == "passed"


def test_a_future_dated_bill_is_missing_its_date(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/future-dated.pdf")
    issued = iso(fixture.sidecar["printed_dates"]["issue-date"]["date"])

    assert issued > AS_OF + timedelta(days=1)
    assert status(fixture, "document_recency_detection") == "not_applicable"
    assert reasons(fixture, "document_recency_detection") == ["input_missing"]


def test_a_lease_signed_long_ago_still_in_its_term_is_recent(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/lease/lease-in-term-signed-long-ago.pdf")
    dates = fixture.sidecar["printed_dates"]

    assert (AS_OF - iso(dates["issue-date"]["date"])).days > 365
    assert iso(dates["lease-start"]["date"]) <= AS_OF < iso(dates["lease-end"]["date"])
    assert status(fixture, "document_recency_detection") == "passed"
    assert status(fixture, "document_expired_detection") == "passed"
    assert fixture.sidecar["fields"]["expiration-date"] == dates["lease-end"]["date"]


def test_a_lease_whose_term_ended_is_expired(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/lease/lease-ended.pdf")
    dates = fixture.sidecar["printed_dates"]

    assert iso(dates["lease-end"]["date"]) < AS_OF
    assert status(fixture, "document_expired_detection") == "failed"
    assert reasons(fixture, "document_expired_detection") == ["document_expired"]
    assert status(fixture, "document_recency_detection") == "not_applicable"
    assert reasons(fixture, "document_recency_detection") == ["input_missing"]


def test_a_january_w2_read_in_october_is_recent(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/tax-document/w2-january-read-october.pdf")
    issued = iso(fixture.sidecar["printed_dates"]["issue-date"]["date"])
    read_on = iso(fixture.sidecar["read_on"])

    assert issued.month == 1
    assert read_on.month == 10
    assert 90 < (read_on - issued).days <= 548
    assert "W-2" in text_of(fixture)
    assert status(fixture, "document_recency_detection") == "passed"


# --- the password cases (decision 17) -----------------------------------------------------------


def test_a_password_protected_bill_cannot_be_opened(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/password-protected.pdf")

    with pytest.raises(pdfium.PdfiumError, match="password"):
        pdfium.PdfDocument(fixture.data)
    assert PdfReader(io.BytesIO(fixture.data)).is_encrypted
    assert status(fixture, "document_type_detection") == "failed"
    assert reasons(fixture, "document_type_detection") == ["document_password_protected"]
    for check in DOCUMENT_CHECKS[1:]:  # C60.6's cascade: one mistake, one failed check
        assert status(fixture, check) == "not_applicable", check
        assert reasons(fixture, check) == ["input_missing"], check
    assert fixture.sidecar["pdf"]["encryption"] == "user-password"


def test_an_owner_password_alone_does_not_stop_reading(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/owner-password-only.pdf")

    assert PdfReader(io.BytesIO(fixture.data)).is_encrypted
    assert fixture.sidecar["fields"]["name"] in page_text(fixture.data)
    assert fixture.sidecar["pdf"]["encryption"] == "owner-password"
    assert status(fixture, "document_type_detection") == "passed"


# --- edited variants ----------------------------------------------------------------------------


def cue_names(fixture: Fixture) -> set[str]:
    return {cue["cue"] for cue in fixture.sidecar["cues"]}


def happy_bill(by_path: dict[str, Fixture]) -> Fixture:
    return get(by_path, "en/utility-bill/happy.pdf")


def test_an_amount_changed_by_an_editor_increment(by_path: dict[str, Fixture]) -> None:
    original = happy_bill(by_path)
    fixture = get(by_path, "en/utility-bill/edited-amount-increment.pdf")

    assert fixture.data.startswith(original.data)  # an incremental update of the genuine file
    assert trailer_ends(fixture.data) == 2
    info = reader(fixture.data).metadata
    assert info is not None
    assert info.producer == EDITOR_PRODUCER
    xmp = re.search(rb"<pdf:Producer>(.*?)</pdf:Producer>", fixture.data)
    assert xmp is not None
    assert xmp.group(1).decode() != EDITOR_PRODUCER  # Info and XMP now disagree
    assert page_text(fixture.data) != page_text(original.data)
    assert cue_names(fixture) == {
        "incremental-revisions",
        "editor-producer",
        "metadata-inconsistent",
    }
    assert all(cue["strength"] == "weak" for cue in fixture.sidecar["cues"])
    # C60.6: weak cues are capped at 0.45 in total, under the 0.5 threshold.
    assert status(fixture, "document_fabrication_detection") == "passed"
    assert fixture.sidecar["pdf"]["revisions"] == 2


def test_an_amount_covered_by_a_white_box_stays_in_the_text_layer(
    by_path: dict[str, Fixture],
) -> None:
    fixture = get(by_path, "en/utility-bill/edited-covered-amount.pdf")
    hidden = fixture.sidecar["hidden_text"]

    assert [entry["reason"] for entry in hidden] == ["covered"]
    covered = next(obj for obj in text_objects(fixture.data) if obj.text == hidden[0]["text"])
    whites = [path for path in filled_paths(fixture.data) if path.rgba[:3] == (255, 255, 255)]
    assert any(
        path.bounds[0] <= covered.bounds[0]
        and path.bounds[1] <= covered.bounds[1]
        and path.bounds[2] >= covered.bounds[2]
        and path.bounds[3] >= covered.bounds[3]
        for path in whites
    )
    assert trailer_ends(fixture.data) == 2
    assert "hidden-text-over-field" in cue_names(fixture)
    assert status(fixture, "document_fabrication_detection") == "failed"
    assert "pdf_hidden_text" in reasons(fixture, "document_fabrication_detection")


def test_a_font_swapped_inside_the_amount_line(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/edited-font-swap.pdf")
    objects = text_objects(fixture.data)
    total = next(obj for obj in objects if obj.text == "Amount due")
    amount = next(
        obj
        for obj in objects
        if obj.text.startswith("$") and abs(obj.bounds[1] - total.bounds[1]) < 2
    )

    assert amount.font != total.font
    assert "amount-line-font" in cue_names(fixture)
    assert status(fixture, "document_fabrication_detection") is None  # a medium cue: open


def test_an_old_bill_with_an_invisible_recent_date(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/edited-invisible-recent-date.pdf")
    objects = text_objects(fixture.data)
    (hidden,) = [obj for obj in objects if obj.render_mode == 3]
    printed = fixture.sidecar["printed_dates"]["issue-date"]
    visible = next(obj for obj in objects if obj.render_mode == 0 and printed["text"] in obj.text)

    assert (AS_OF - iso(printed["date"])).days > 90  # the visible date is old
    assert abs(hidden.bounds[1] - visible.bounds[1]) < 2  # over the same field
    assert fixture.sidecar["hidden_text"] == [
        {"page": 1, "text": hidden.text, "reason": "render_mode_invisible"}
    ]
    assert status(fixture, "document_recency_detection") == "failed"  # never the hidden date
    assert reasons(fixture, "document_recency_detection") == ["document_too_old"]
    assert status(fixture, "document_fabrication_detection") == "failed"


def test_a_text_layer_that_reads_other_digits_than_it_prints(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/edited-text-layer-mismatch.pdf")
    (differs,) = fixture.sidecar["text_layer_differs"]

    assert differs["extracted"] in page_text(fixture.data)
    assert differs["painted"] != differs["extracted"]
    page: Any = reader(fixture.data).pages[0]
    fonts = page["/Resources"]["/Font"]
    assert any("/ToUnicode" in font.get_object() for font in fonts.values())
    assert cue_names(fixture) == {"text-layer-mismatch"}


def test_a_pdf_created_before_its_printed_date(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/edited-created-before-issue.pdf")
    created = reader(fixture.data).metadata
    assert created is not None
    when = datetime.strptime(str(created["/CreationDate"]), "D:%Y%m%d%H%M%SZ").date()

    assert when < iso(fixture.sidecar["printed_dates"]["issue-date"]["date"])
    assert cue_names(fixture) == {"created-before-issue-date"}
    assert status(fixture, "document_fabrication_detection") == "passed"


def test_info_and_xmp_that_disagree(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/edited-metadata-inconsistent.pdf")
    info = reader(fixture.data).metadata
    assert info is not None
    xmp = re.search(rb"<pdf:Producer>(.*?)</pdf:Producer>", fixture.data)
    assert xmp is not None

    assert info.producer != xmp.group(1).decode()
    assert cue_names(fixture) == {"metadata-inconsistent"}


def test_active_content_runs_when_the_file_opens(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/edited-active-content.pdf")

    assert catalog(fixture.data)["/OpenAction"]["/S"] == "/JavaScript"
    assert fixture.sidecar["pdf"]["actions"]["javascript"] == 1
    assert cue_names(fixture) == {"active-content"}
    assert status(fixture, "document_fabrication_detection") == "failed"
    assert reasons(fixture, "document_fabrication_detection") == ["pdf_active_content"]


def test_an_edit_after_a_signature(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/bank-statement/edited-after-signature.pdf")
    (byte_range,) = signature_byte_ranges(fixture.data)

    assert byte_range[2] + byte_range[3] < len(fixture.data)  # bytes the signature never saw
    assert trailer_ends(fixture.data) == 2
    assert fixture.sidecar["pdf"]["edits_after_signature"] is True
    assert "edits-after-signature" in cue_names(fixture)
    assert status(fixture, "document_fabrication_detection") == "failed"


def test_a_repaired_cross_reference_table(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/edited-repaired-xref.pdf")

    assert not has_valid_xref(fixture.data)
    assert fixture.sidecar["fields"]["name"] in page_text(fixture.data)
    assert cue_names(fixture) == {"xref-repaired"}
    # The cue ids and reasons are the checks' FABRICATION_SIGNALS (packages/checks).
    assert fixture.sidecar["cues"][0]["reason"] == "pdf_incremental_update"
    assert status(fixture, "document_fabrication_detection") == "passed"


def photo_pixels(fixture: Fixture) -> np.ndarray:
    with Image.open(io.BytesIO(fixture.data)) as image:
        pixels: np.ndarray = np.asarray(image.convert("L")).astype(int)
    return pixels


def test_a_photo_with_an_edited_amount_is_recompressed(by_path: dict[str, Fixture]) -> None:
    genuine = get(by_path, "en/utility-bill/happy-photo.jpg")
    fixture = get(by_path, "en/utility-bill/edited-photo-ela.jpg")
    left, top, right, bottom = fixture.sidecar["image"]["edited_region"]
    before, after = photo_pixels(genuine), photo_pixels(fixture)

    changed = np.abs(before - after)
    inside = changed[top:bottom, left:right].mean()
    outside = changed[: top - 40].mean()
    assert inside > 5 * outside
    assert fixture.sidecar["image"]["jpeg_quality"] != 88
    assert fixture.sidecar["image"]["double_compressed"] is True
    assert "double-compression-ela" in cue_names(fixture)
    assert status(fixture, "document_fabrication_detection") is None  # a medium cue: open


def test_a_photo_an_image_editor_saved(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/edited-photo-exif-editor.jpg")

    with Image.open(io.BytesIO(fixture.data)) as image:
        assert image.getexif()[305] == EDITOR_SOFTWARE
    assert cue_names(fixture) == {"image-editor-software"}
    assert status(fixture, "document_fabrication_detection") == "passed"


def test_a_photo_with_a_copied_patch(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/edited-photo-copy-move.jpg")
    source, target = fixture.sidecar["image"]["copy_move"]
    pixels = photo_pixels(fixture)

    def patch(box: list[int]) -> np.ndarray:
        left, top, right, bottom = box
        return pixels[top:bottom, left:right].astype(float)

    first, second = patch(source), patch(target)
    assert first.shape == second.shape
    assert np.corrcoef(first.ravel(), second.ravel())[0, 1] > 0.95
    assert source != target
    assert "copy-move" in cue_names(fixture)
    assert status(fixture, "document_fabrication_detection") == "failed"


# --- genuine variants under the fabrication threshold --------------------------------------------


GENUINE = (
    "en/utility-bill/genuine-linearized.pdf",
    "en/utility-bill/genuine-goto-open-action.pdf",
    "en/utility-bill/genuine-distinct-xmp-ids.pdf",
    "en/utility-bill/genuine-generated-after-date.pdf",
    "en/utility-bill/genuine-scanned.pdf",
    "en/bank-statement/genuine-signed-ltv.pdf",
)


@pytest.mark.parametrize("path", GENUINE)
def test_a_genuine_variant_carries_no_medium_or_strong_cue_and_passes(
    by_path: dict[str, Fixture], path: str
) -> None:
    fixture = get(by_path, path)

    assert fixture.sidecar["group"] == "genuine"
    assert all(cue["strength"] == "weak" for cue in fixture.sidecar["cues"])
    assert status(fixture, "document_fabrication_detection") == "passed"


def test_the_linearized_bill(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/genuine-linearized.pdf")

    assert is_linearized(fixture.data)
    assert fixture.sidecar["pdf"]["linearized"] is True
    assert fixture.sidecar["pdf"]["revisions"] == 1  # the first-page section is no revision


def test_the_goto_open_action(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/genuine-goto-open-action.pdf")

    assert catalog(fixture.data)["/OpenAction"]["/S"] == "/GoTo"
    assert fixture.sidecar["pdf"]["actions"] == {}


def test_distinct_xmp_ids(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/genuine-distinct-xmp-ids.pdf")
    document_id = re.search(rb"<xmpMM:DocumentID>(.*?)</xmpMM:DocumentID>", fixture.data)
    instance_id = re.search(rb"<xmpMM:InstanceID>(.*?)</xmpMM:InstanceID>", fixture.data)

    assert document_id is not None
    assert instance_id is not None
    assert document_id.group(1) != instance_id.group(1)


def test_a_file_generated_after_its_printed_date(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/genuine-generated-after-date.pdf")
    info = reader(fixture.data).metadata
    assert info is not None
    created = datetime.strptime(str(info["/CreationDate"]), "D:%Y%m%d%H%M%SZ").date()

    assert created > iso(fixture.sidecar["printed_dates"]["issue-date"]["date"])


def test_a_scanned_bill_has_no_text_layer(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/utility-bill/genuine-scanned.pdf")

    assert page_text(fixture.data).strip() == ""
    assert fixture.sidecar["form"] == "scanned-pdf"
    assert len(reader(fixture.data).pages[0].images) == 1


def test_a_signature_extended_for_long_term_validation(by_path: dict[str, Fixture]) -> None:
    fixture = get(by_path, "en/bank-statement/genuine-signed-ltv.pdf")
    (byte_range,) = signature_byte_ranges(fixture.data)
    signed_length = byte_range[2] + byte_range[3]

    assert fixture.data[:signed_length].endswith(b"%%EOF\n")  # the signed revision ends there
    assert trailer_ends(fixture.data) == 2
    assert "/DSS" in catalog(fixture.data)
    signed = [int(n) for n in re.findall(rb"(\d+) 0 obj", fixture.data[:signed_length])]
    added = [int(n) for n in re.findall(rb"(\d+) 0 obj", fixture.data[signed_length:])]
    root = int(re.findall(rb"/Root (\d+) 0 R", fixture.data)[0])
    assert root in added  # the catalogue, which gains /DSS ...
    assert all(n == root or n > max(signed) for n in added)  # ... and new objects only
    assert fixture.sidecar["pdf"]["edits_after_signature"] is False
    assert fixture.sidecar["pdf"]["signatures"] == 1
    # C60.1 leaves a DSS-only increment out of the edits after a signature, not out of the
    # revisions: the file carries that one weak cue, and only that one.
    assert [cue["cue"] for cue in fixture.sidecar["cues"]] == ["incremental-revisions"]


# --- the sidecars' counts -----------------------------------------------------------------------


def test_the_set_holds_every_listed_variant(fixtures: list[Fixture]) -> None:
    groups = Counter(fixture.sidecar["group"] for fixture in fixtures)

    assert groups["happy"] == 20
    assert groups["date-case"] == 6
    assert groups["protected"] == 2
    assert groups["edited"] == 13
    assert groups["genuine"] == 6
