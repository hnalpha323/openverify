"""tools/make_synthetic_fixtures.py: the CLI that turns fetched faces into e2e assets.

Runs against a temporary manifest whose "faces" are synthetic gradients, so no real photo
is needed here. ``test_real_faces.py`` runs the same CLI on the real public-domain photos.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from fake_camera import read_y4m
from fixture_inputs import make_workspace
from head_turn import CONSTANTS_PATH, load_capture_constants
from make_synthetic_fixtures import (
    AAMVA_DIR,
    FORMS_DIR,
    GENERATOR_VERSION,
    HELD_OUT_DIR,
    INDEX_NAME,
    NFC_DIR,
    OUTPUTS,
    POA_DIR,
    SET_INDEX,
    STAMP_NAME,
    VARIANTS_DIR,
    generator_stamp,
    main,
    today,
)
from selfie_fakes import MarkerKit
from synthetic_aamva import load_vectors
from synthetic_id import CARD_SIZE
from synthetic_poa_checks import PAGES, stand_in_form
from synthetic_selfie import SELFIE_DIR
from synthetic_travel import DG2_PORTRAIT_SIZE

AS_OF = date(2026, 10, 24)


def with_forms(manifest: Path) -> Path:
    """Pin stand-in federal forms in ``manifest`` and put them where the fetch would."""
    forms_dir = manifest.parent / "generated" / FORMS_DIR
    forms_dir.mkdir(parents=True, exist_ok=True)
    document = json.loads(manifest.read_text(encoding="utf-8"))
    document["forms"] = []
    for form in ("w2", "1099-nec", "1040"):
        data = stand_in_form(form)
        filename = f"{form}.pdf"
        (forms_dir / filename).write_bytes(data)
        document["forms"].append(
            {
                "name": f"irs_{form.replace('-', '_')}",
                "form": form,
                "filename": filename,
                "source_page": "https://www.irs.gov/forms",
                "url": f"https://www.irs.gov/pub/irs-prior/{filename}",
                "sha256": hashlib.sha256(data).hexdigest(),
                "size": len(data),
                "license": "public-domain",
                "publisher": "Internal Revenue Service",
                "pages": list(PAGES[form]),
                "revision": "2025",
            }
        )
    manifest.write_text(json.dumps(document), encoding="utf-8")
    return manifest


@pytest.fixture
def workspace(tmp_path: Path) -> tuple[Path, Path]:
    manifest, faces = make_workspace(tmp_path)
    return with_forms(manifest), faces


@pytest.fixture(scope="module")
def generated(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, str]:
    """One complete run (2 fps, 1 s clips) and what it printed, shared by the read-only tests."""
    root = tmp_path_factory.mktemp("generator")
    manifest, faces = make_workspace(root)
    with_forms(manifest)
    out = root / "generated"
    printed = io.StringIO()
    with contextlib.redirect_stdout(printed):
        assert run(manifest, faces, out, "--fps", "2", "--seconds", "1") == 0
    return out, printed.getvalue()


def every_file(directory: Path) -> dict[str, bytes]:
    """Every file the generator wrote (the fetched forms beside them are not its output)."""
    return {
        str(path.relative_to(directory)): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file() and path.relative_to(directory).parts[0] != FORMS_DIR
    }


def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def run(manifest: Path, faces: Path, out: Path, *extra: str) -> int:
    # The C45.2 selfie set needs YuNet and the canonical mesh; MarkerKit stands in for both.
    as_of = [] if "--as-of" in extra else ["--as-of", AS_OF.isoformat()]
    return main(
        ["--manifest", str(manifest), "--faces", str(faces), "--out", str(out), *as_of, *extra],
        kit=MarkerKit(),
    )


def test_outputs_are_named_for_the_e2e_suite() -> None:
    assert OUTPUTS == (
        "id-front.jpg",
        "id-back.jpg",
        "selfie-a.jpg",
        "selfie-a.y4m",
        "selfie-b.jpg",
        "selfie-b.y4m",
    )


def test_generates_every_asset(generated: tuple[Path, str]) -> None:
    out, printed = generated

    assert sorted(p.name for p in out.iterdir()) == sorted(
        [
            *OUTPUTS,
            STAMP_NAME,
            INDEX_NAME,
            VARIANTS_DIR,
            AAMVA_DIR,
            SELFIE_DIR,
            POA_DIR,
            HELD_OUT_DIR,
            NFC_DIR,
            FORMS_DIR,  # where the fetch put the forms: the generator's own output sits beside
        ]
    )
    assert image_size(out / "id-front.jpg") == CARD_SIZE
    assert image_size(out / "id-back.jpg") == CARD_SIZE
    assert image_size(out / "selfie-a.jpg") == (640, 480)
    fps, frames = read_y4m(out / "selfie-b.y4m")
    assert (fps, len(frames)) == (2, 2)
    assert "selfie-a.y4m" in printed


def test_output_is_byte_for_byte_reproducible(
    generated: tuple[Path, str], workspace: tuple[Path, Path], tmp_path: Path
) -> None:
    out, _ = generated
    run(*workspace, tmp_path / "again", "--fps", "2", "--seconds", "1")

    first, second = every_file(out), every_file(tmp_path / "again")
    assert sorted(first) == sorted(second)
    for name, content in first.items():
        assert content == second[name], name


# --- C36 variants and AAMVA barcode-only images ---------------------------------------------------


def index(out: Path) -> dict[str, Any]:
    document: dict[str, Any] = json.loads((out / INDEX_NAME).read_text(encoding="utf-8"))
    return document


def test_the_index_lists_the_happy_card_and_every_variant_with_its_files(
    generated: tuple[Path, str],
) -> None:
    out, _ = generated
    document = index(out)
    variants = {variant["name"]: variant for variant in document["variants"]}

    assert document["generator_version"] == GENERATOR_VERSION
    assert len(variants) == len(document["variants"]) == 23
    assert document["variants"][0]["name"] == "happy"
    assert variants["happy"]["sides"]["front"]["file"] == "id-front.jpg"
    assert variants["happy"]["sides"]["back"]["file"] == "id-back.jpg"
    assert variants["expired"]["sides"]["front"]["file"] == f"{VARIANTS_DIR}/expired-front.jpg"
    assert variants["expired"]["expect"] == ["id_expired_detection"]
    assert variants["not-an-id"]["sides"]["back"] is None
    for variant in document["variants"]:
        assert set(variant) == {"name", "group", "expect", "description", "sides"}
        for side in variant["sides"].values():
            if side is None:
                continue
            assert set(side) == {
                "file",
                "fields",
                "text",
                "mrz",
                "quad",
                "jpeg_quality",
                "portrait",
            }
            with Image.open(out / side["file"]) as image:
                assert image.format == "JPEG"


def test_the_index_records_what_each_side_shows(generated: tuple[Path, str]) -> None:
    out, _ = generated
    variants = {variant["name"]: variant for variant in index(out)["variants"]}
    happy, background = variants["happy"]["sides"], variants["on-background"]["sides"]

    assert happy["front"]["fields"]["Surname"] == "CALDERWOOD"
    assert happy["front"]["portrait"] == "a_id"  # the manifest entry of the photo it shows
    assert happy["back"]["portrait"] is None
    assert variants["portrait-swap"]["sides"]["front"]["portrait"] == "b_selfie"
    assert happy["front"]["mrz"] is None
    assert len(happy["back"]["mrz"]) == 3
    assert "OpenVerify synthetic test card" in happy["front"]["text"]
    assert happy["front"]["quad"] is None
    assert len(background["front"]["quad"]) == 4
    assert variants["front-as-back"]["sides"]["back"]["jpeg_quality"] == 80


def test_every_variant_file_is_written_and_nothing_else(generated: tuple[Path, str]) -> None:
    out, _ = generated
    listed = {
        side["file"]
        for variant in index(out)["variants"]
        for side in variant["sides"].values()
        if side is not None
    }

    on_disk = {str(path.relative_to(out)) for path in (out / VARIANTS_DIR).iterdir()}
    assert on_disk == {name for name in listed if name.startswith(f"{VARIANTS_DIR}/")}
    assert {"id-front.jpg", "id-back.jpg"} <= listed


def test_every_aamva_vector_is_written_as_a_barcode_only_png(generated: tuple[Path, str]) -> None:
    out, _ = generated
    barcodes = index(out)["aamva"]

    assert [entry["id"] for entry in barcodes] == [vector.id for vector in load_vectors()]
    for entry, vector in zip(barcodes, load_vectors(), strict=True):
        assert entry == {
            "id": vector.id,
            "valid": vector.valid,
            "file": f"{AAMVA_DIR}/{vector.id}.png",
        }
        with Image.open(out / entry["file"]) as image:
            assert image.format == "PNG"
    assert len(list((out / AAMVA_DIR).iterdir())) == len(barcodes)


def test_a_run_replaces_what_an_older_version_left_behind(
    workspace: tuple[Path, Path], tmp_path: Path
) -> None:
    out = tmp_path / "generated"
    owned = (VARIANTS_DIR, AAMVA_DIR, SELFIE_DIR, POA_DIR, HELD_OUT_DIR, NFC_DIR)
    for directory in owned:
        (out / directory).mkdir(parents=True)
        (out / directory / "renamed-long-ago.jpg").write_bytes(b"stale")

    assert run(*workspace, out, "--fps", "2", "--seconds", "1") == 0

    for directory in owned:
        assert not (out / directory / "renamed-long-ago.jpg").exists(), directory
    assert len(list((out / FORMS_DIR).iterdir())) == 3  # the fetched forms are never removed


def test_default_clip_is_two_seconds_at_fifteen_fps(
    workspace: tuple[Path, Path], tmp_path: Path
) -> None:
    run(*workspace, tmp_path / "out")

    fps, frames = read_y4m(tmp_path / "out" / "selfie-a.y4m")
    assert (fps, len(frames)) == (15, 30)


def test_missing_face_points_at_the_fetch_script(
    workspace: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest, faces = workspace
    (faces / "b-selfie.jpg").unlink()

    assert run(manifest, faces, tmp_path / "out") == 1
    assert "scripts/fetch_fixtures.py" in capsys.readouterr().err


def test_tampered_face_is_refused(
    workspace: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest, faces = workspace
    (faces / "a-id.jpg").write_bytes(b"swapped for something else")

    assert run(manifest, faces, tmp_path / "out") == 1
    assert "sha256" in capsys.readouterr().err


def test_manifest_without_person_b_is_rejected(
    workspace: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest, faces = workspace
    document = json.loads(manifest.read_text())
    document["faces"] = [f for f in document["faces"] if f["person"] != "B"]
    manifest.write_text(json.dumps(document))

    assert run(manifest, faces, tmp_path / "out") == 2
    assert "person B" in capsys.readouterr().err


# --- generator version stamp (C36) -------------------------------------------------------------


def test_the_generator_has_a_positive_integer_version() -> None:
    assert isinstance(GENERATOR_VERSION, int)
    assert GENERATOR_VERSION >= 1
    assert STAMP_NAME == ".generator-version"


def test_the_version_is_bumped_for_the_card_without_specimen_markers() -> None:
    # Version 1 drew the Phase 1 card (SAMPLE, SPEC12345); a stale stamp must regenerate it.
    assert GENERATOR_VERSION >= 2


def test_the_version_is_bumped_for_the_variants_and_barcodes() -> None:
    # Version 2 wrote the happy pair only: a version-2 stamp must not hide missing variants.
    assert GENERATOR_VERSION >= 3


def test_the_version_is_bumped_for_the_portrait_names_and_the_readable_recapture() -> None:
    # Version 3 wrote a darker screen recapture and no portrait names in variants.json.
    assert GENERATOR_VERSION >= 4


def test_the_version_is_bumped_for_the_specimen_banner_and_the_overprint_variant() -> None:
    # Version 4 drew the specimen-stamped card without its banner and no overprint variant.
    assert GENERATOR_VERSION >= 5


def test_the_version_is_bumped_for_the_selfie_set() -> None:
    # Version 5 wrote no head-turn clip, spoof or composite (C45.2): its stamp must regenerate.
    assert GENERATOR_VERSION >= 6


def test_the_stamp_names_the_version_the_capture_constants_and_the_day() -> None:
    constants = load_capture_constants()

    assert generator_stamp(constants, AS_OF) == (
        f"{GENERATOR_VERSION}+{constants.sha256[:12]}+2026-10-24"
    )


def test_the_stamp_changes_when_the_capture_constants_change(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    document = json.loads(CONSTANTS_PATH.read_text(encoding="utf-8"))
    document["clip"]["target-yaw-deg"] = 23.0
    edited = tmp_path / "selfie-capture.json"
    edited.write_text(json.dumps(document), encoding="utf-8")

    assert main(["--print-version", "--as-of", "2026-10-24"]) == 0
    assert main(["--print-version", "--as-of", "2026-10-24", "--constants", str(edited)]) == 0

    current, changed = capsys.readouterr().out.splitlines()
    assert current != changed
    assert current.split("+")[0] == changed.split("+")[0] == str(GENERATOR_VERSION)
    assert current.split("+")[2] == changed.split("+")[2] == "2026-10-24"


def test_without_the_models_it_points_at_the_fetch_script(
    workspace: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest, faces = workspace
    out = tmp_path / "out"

    code = main(
        [
            "--manifest",
            str(manifest),
            "--faces",
            str(faces),
            "--out",
            str(out),
            "--models",
            str(tmp_path / "no-models"),
        ]
    )

    assert code == 1
    assert "fetch_models.py" in capsys.readouterr().err
    assert not (out / STAMP_NAME).exists()


def test_it_stamps_its_version_after_writing_every_asset(generated: tuple[Path, str]) -> None:
    out, _ = generated

    stamp = out / STAMP_NAME
    expected = generator_stamp(load_capture_constants(), AS_OF)
    assert stamp.read_text(encoding="utf-8") == f"{expected}\n"
    assets = [path for path in out.rglob("*") if path.is_file() and path != stamp]
    assert len(assets) > len(OUTPUTS)
    assert stamp.stat().st_mtime_ns >= max(path.stat().st_mtime_ns for path in assets)


def test_a_failed_run_leaves_no_stamp(workspace: tuple[Path, Path], tmp_path: Path) -> None:
    manifest, faces = workspace
    (faces / "b-selfie.jpg").unlink()
    out = tmp_path / "generated"
    out.mkdir(exist_ok=True)  # it holds the fetched forms already
    (out / STAMP_NAME).write_text("0\n", encoding="utf-8")

    assert run(manifest, faces, out) == 1
    assert not (out / STAMP_NAME).exists()


def test_print_version_prints_only_the_stamp(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--print-version", "--as-of", "2026-10-24"]) == 0
    assert capsys.readouterr().out == f"{generator_stamp(load_capture_constants(), AS_OF)}\n"


def test_the_stamp_follows_the_day_so_the_documents_stay_current(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # e2e/setup/stack.ts regenerates when the stamp differs from --print-version: once a day.
    assert main(["--print-version"]) == 0
    assert capsys.readouterr().out.strip().endswith(f"+{today().isoformat()}")


# --- Phase 5: the proof-of-address sets and the chip's inputs (C65.2, C60.7, C65.3) --------------


def test_the_version_is_bumped_for_the_proof_of_address_sets() -> None:
    # Version 6 wrote no document, held-out, hostile or chip input: its stamp must regenerate.
    assert GENERATOR_VERSION >= 7


def read_index(directory: Path) -> dict[str, Any]:
    document: dict[str, Any] = json.loads((directory / SET_INDEX).read_text(encoding="utf-8"))
    return document


def test_the_document_sets_are_written_with_a_sidecar_per_file(
    generated: tuple[Path, str],
) -> None:
    out, _ = generated
    for directory, sets in (
        (out / POA_DIR, {"main", "hostile"}),
        (out / HELD_OUT_DIR, {"held-out"}),
    ):
        index = read_index(directory)
        assert index["generator_version"] == GENERATOR_VERSION
        assert index["as_of"] == AS_OF.isoformat()
        assert {entry["set"] for entry in index["files"]} == sets
        listed = {entry["file"] for entry in index["files"]}
        on_disk = {
            str(path.relative_to(directory))
            for path in directory.rglob("*")
            if path.is_file() and path.suffix != ".json"
        }
        assert listed == on_disk
        for entry in index["files"]:
            data = (directory / entry["file"]).read_bytes()
            assert hashlib.sha256(data).hexdigest() == entry["sha256"]
            sidecar = (directory / entry["file"]).with_suffix(".json")
            assert json.loads(sidecar.read_text(encoding="utf-8")) == entry


def test_the_main_set_holds_the_happy_bill_the_e2e_uploads(generated: tuple[Path, str]) -> None:
    out, _ = generated
    index = read_index(out / POA_DIR)
    by_file = {entry["file"]: entry for entry in index["files"]}

    assert len([e for e in index["files"] if e["set"] == "main"]) == 47
    assert len([e for e in index["files"] if e["set"] == "hostile"]) == 15
    happy = by_file["en/utility-bill/happy.pdf"]
    assert happy["expect"]["document_recency_detection"]["status"] == "passed"
    assert (
        by_file["en/utility-bill/edited-covered-amount.pdf"]["expect"][
            "document_fabrication_detection"
        ]["status"]
        == "failed"
    )
    assert by_file["en/utility-bill/too-old.pdf"]["expect"]["document_recency_detection"][
        "reasons"
    ] == ["document_too_old"]


def test_the_held_out_index_counts_its_documents(generated: tuple[Path, str]) -> None:
    out, _ = generated
    index = read_index(out / HELD_OUT_DIR)

    assert len(index["files"]) == 59
    assert index["counts"]["by_label"]["other"] == 10
    assert index["counts"]["by_form"] == {"pdf": 45, "photo": 14}
    assert index["covered_languages"] == ["en", "es", "fr", "de"]


def test_the_chip_inputs_are_person_as_portrait_and_the_td3_page(
    generated: tuple[Path, str],
) -> None:
    out, _ = generated
    nfc = out / NFC_DIR
    page = json.loads((nfc / "td3-passport.json").read_text(encoding="utf-8"))
    portrait = json.loads((nfc / "person-a-portrait.json").read_text(encoding="utf-8"))
    codestream = json.loads((nfc / "person-a-portrait-codestream.json").read_text(encoding="utf-8"))

    assert (nfc / "td3-passport.jpg").read_bytes() == (
        out / VARIANTS_DIR / "td3-passport-front.jpg"
    ).read_bytes()
    assert len(page["dg1_mrz"]) == 88
    assert page["dg1_mrz"] == "".join(page["mrz"])
    assert page["portrait"] == {"file": "nfc/person-a-portrait.jp2", "source": "a_id"}
    for record, name, media_type in (
        (portrait, "person-a-portrait.jp2", "image/jp2"),
        (codestream, "person-a-portrait-codestream.j2k", "image/j2k"),
    ):
        data = (nfc / name).read_bytes()
        assert record["file"] == f"nfc/{name}"
        assert record["media_type"] == media_type
        assert record["sha256"] == hashlib.sha256(data).hexdigest()
        assert (record["width"], record["height"]) == DG2_PORTRAIT_SIZE
        assert record["source"] == "a_id"
        with Image.open(io.BytesIO(data)) as decoded:
            assert decoded.size == DG2_PORTRAIT_SIZE


def test_the_documents_follow_the_day_asked(workspace: tuple[Path, Path], tmp_path: Path) -> None:
    out = tmp_path / "later"

    assert run(*workspace, out, "--fps", "2", "--seconds", "1", "--as-of", "2027-03-01") == 0

    happy = json.loads((out / POA_DIR / "en" / "utility-bill" / "happy.json").read_text())
    assert happy["as_of"] == "2027-03-01"
    assert happy["printed_dates"]["issue-date"]["date"] == "2027-02-17"  # twelve days before
    assert (out / STAMP_NAME).read_text().strip().endswith("+2027-03-01")


def test_without_the_federal_forms_it_points_at_the_fetch_script(
    workspace: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest, faces = workspace
    (manifest.parent / "generated" / FORMS_DIR / "w2.pdf").unlink()

    assert run(manifest, faces, tmp_path / "out") == 1
    assert "scripts/fetch_fixtures.py" in capsys.readouterr().err
    assert not (tmp_path / "out" / STAMP_NAME).exists()


def test_a_tampered_federal_form_is_refused(
    workspace: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest, faces = workspace
    (manifest.parent / "generated" / FORMS_DIR / "1040.pdf").write_bytes(b"%PDF-1.7 swapped")

    assert run(manifest, faces, tmp_path / "out") == 1
    assert "sha256" in capsys.readouterr().err
