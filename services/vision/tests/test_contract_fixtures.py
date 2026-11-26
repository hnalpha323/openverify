"""Golden C6 fixtures in contracts/fixtures/vision/: valid, exact, synthetic and reproducible.

The API worker validates the same files with zod, so they must match the pydantic models
field for field. Their embeddings are seeded pseudo-random unit vectors produced by
``tools/make_contract_fixtures.py``, never features of a real face; regenerating the
fixtures must reproduce the committed files.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from make_contract_fixtures import (
    FIXTURE_DIR,
    ID_SELFIE_COSINE,
    NON_MATCH_COSINE,
    build_fixtures,
    main,
    synthetic_unit_vector,
)
from openverify_vision.page_count import PageCountLimits
from openverify_vision.schemas import (
    EMBEDDING_DIMENSIONS,
    DocumentAnalysis,
    FaceEmbeddingResult,
    GovernmentIdAnalysis,
    Rendition,
    SelfieAnalysis,
    VisionPngLimits,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS: dict[str, type[BaseModel]] = {
    "analyze-government-id.json": GovernmentIdAnalysis,
    "analyze-government-id-barcode.json": GovernmentIdAnalysis,
    "analyze-selfie.json": SelfieAnalysis,
    "embed-face.json": FaceEmbeddingResult,
    # C60.1, C60.4 (Workflow 5B Stage 1).
    "analyze-document-pdf.json": DocumentAnalysis,
    "analyze-document-image.json": DocumentAnalysis,
    "embed-face-chip.json": FaceEmbeddingResult,
    "png-limits.json": VisionPngLimits,
    # C135.3 (Workflow 8B).
    "rendition-image.json": Rendition,
    "rendition-pdf.json": Rendition,
    # Workflow 11B (ingestion-11b): the page count route's bounds.
    "pdf-page-count.json": PageCountLimits,
}
SFACE_THRESHOLD = 0.363


def load(name: str) -> Any:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


def cosine(a: list[float], b: list[float]) -> float:
    return math.fsum(x * y for x, y in zip(a, b, strict=True))


def test_fixture_dir_is_the_shared_contracts_location() -> None:
    assert FIXTURE_DIR == REPO_ROOT / "contracts" / "fixtures" / "vision"
    # yunet-decode.json (C46.1) is recorded from the real model, so it is tested on its own.
    names = {p.name for p in FIXTURE_DIR.glob("*.json")} - {"yunet-decode.json"}
    assert sorted(names) == sorted(MODELS)


@pytest.mark.parametrize("name", sorted(MODELS))
def test_fixture_validates_and_round_trips_exactly(name: str) -> None:
    text = (FIXTURE_DIR / name).read_text(encoding="utf-8")

    parsed = MODELS[name].model_validate_json(text, strict=True)

    assert parsed.model_dump(mode="json") == json.loads(text)


@pytest.mark.parametrize("name", sorted(MODELS))
def test_committed_fixture_equals_the_generator_output(name: str) -> None:
    assert load(name) == build_fixtures()[name]


def test_government_id_fixture_shows_a_front_portrait_and_a_back_without_one() -> None:
    sides = load("analyze-government-id.json")["sides"]

    assert sides["front"]["portrait"] is not None
    assert len(sides["front"]["faces"]) == 1
    assert sides["back"] is not None
    assert sides["back"]["portrait"] is None


def test_selfie_fixture_has_center_and_left_and_null_right() -> None:
    poses = load("analyze-selfie.json")["poses"]

    assert poses["center"]["face"] is not None
    assert poses["left"]["face"] is not None
    assert poses["right"] is None


def test_selfie_left_pose_is_a_turn_to_the_users_left() -> None:
    """C41.1: a turn to the user's own left raises ``yaw_ratio``; the golden left pose is one.

    Its change from the centre clears the server's ``min-side-yaw-ratio-change`` from the
    shared capture constants (C40.11), so an evaluator prompting ``left`` on the golden
    analysis judges a turn, not a turn the other way.
    """
    constants = json.loads(
        (REPO_ROOT / "contracts" / "fixtures" / "flow" / "selfie-capture.json").read_text(
            encoding="utf-8"
        )
    )
    poses = load("analyze-selfie.json")["poses"]
    change = poses["left"]["head_pose"]["yaw_ratio"] - poses["center"]["head_pose"]["yaw_ratio"]

    assert change >= constants["server"]["min-side-yaw-ratio-change"]
    assert poses["left"]["head_pose"]["yaw_deg"] > 0


def test_selfie_center_matches_the_id_portrait() -> None:
    portrait = load("analyze-government-id.json")["sides"]["front"]["portrait"]["embedding"]
    selfie = load("analyze-selfie.json")["poses"]["center"]["face"]["embedding"]

    assert cosine(portrait, selfie) == pytest.approx(ID_SELFIE_COSINE, abs=1e-6)
    assert ID_SELFIE_COSINE > SFACE_THRESHOLD


def test_embed_face_fixture_does_not_match_the_id_portrait() -> None:
    portrait = load("analyze-government-id.json")["sides"]["front"]["portrait"]["embedding"]
    other = load("embed-face.json")["face"]["embedding"]

    assert cosine(portrait, other) == pytest.approx(NON_MATCH_COSINE, abs=1e-6)
    assert NON_MATCH_COSINE < SFACE_THRESHOLD


def test_synthetic_unit_vectors_are_seeded_and_unit_length() -> None:
    first = synthetic_unit_vector(1)

    assert len(first) == EMBEDDING_DIMENSIONS
    assert math.sqrt(math.fsum(v * v for v in first)) == pytest.approx(1.0, abs=1e-6)
    assert synthetic_unit_vector(1) == first
    assert synthetic_unit_vector(2) != first


def test_main_writes_the_fixtures(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    # Without a YuNet model the C46.1 decode fixture is skipped (it has its own test).
    assert main(["--out", str(tmp_path), "--yunet", str(tmp_path / "missing.onnx")]) == 0

    written = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in tmp_path.iterdir()}
    assert written == build_fixtures()
    assert "prettier" in capsys.readouterr().out


# --- C32.1 (Phase 3) ---------------------------------------------------------------------------

PHASE1_PROJECTION_SHA256 = "c9fb0f882cdcb2d134e93bf0efe9b2f934d1c26774f7378f254f9b4351496b7e"
"""SHA-256 of the Phase 1 fields of ``analyze-government-id.json`` as committed before C32.1."""


def test_the_phase_1_fields_of_the_government_id_fixture_are_unchanged() -> None:
    document = load("analyze-government-id.json")
    projection = {
        "model_versions": {
            key: document["model_versions"][key] for key in ("detector", "recognizer")
        },
        "sides": {
            name: {key: side[key] for key in ("quality", "faces", "portrait")}
            for name, side in document["sides"].items()
        },
    }
    canonical = json.dumps(projection, sort_keys=True, separators=(",", ":")).encode()

    assert hashlib.sha256(canonical).hexdigest() == PHASE1_PROJECTION_SHA256


def test_the_card_fixture_shows_every_v2_measurement() -> None:
    document = load("analyze-government-id.json")
    front, back = document["sides"]["front"], document["sides"]["back"]

    assert document["model_versions"]["text_detector"] is not None
    assert front["document"]["found"] is True
    assert front["document"]["method"] == "contour"
    assert front["document_quality"] is not None
    assert len(front["text"]) > 0
    assert front["mrz"]["found"] is False  # a TD1 card carries its MRZ on the back
    assert front["portrait_clarity"] is not None
    assert front["forensics"]["exif"]["has_gps"] is False
    assert back["mrz"]["format_guess"] == "TD1"
    assert [len(line) for line in back["mrz"]["lines"]] == [30, 30, 30]
    assert back["portrait_clarity"] is None
    assert front["phash"] != back["phash"]
    assert front["barcodes"] == back["barcodes"] == []


def test_the_barcode_fixture_is_a_barcode_only_image_with_a_synthetic_aamva_payload() -> None:
    document = load("analyze-government-id-barcode.json")
    front = document["sides"]["front"]
    (barcode,) = front["barcodes"]

    assert document["sides"]["back"] is None
    assert front["document"]["found"] is False
    assert front["portrait"] is None
    assert barcode["format"] == "PDF417"
    assert base64.b64decode(barcode["bytes_b64"]).decode("latin-1") == barcode["text"]
    assert barcode["text"].startswith("@\n\x1e\rANSI ")
    assert "OPENVERIFY SYNTHETIC TEST DATA" in barcode["text"]


# --- C60.1, C60.4 (Phase 5, Workflow 5B) -------------------------------------------------------


def test_the_pdf_document_fixture_shows_every_c60_measurement() -> None:
    document = load("analyze-document-pdf.json")
    first = document["pages"][0]
    pdf = document["pdf"]

    assert document["source"] == "pdf"
    assert document["analysed_pages"] == [1, 2]
    assert document["model_versions"]["pdf_renderer"] is not None
    assert first["width_pt"] is not None
    assert first["text_layer_ocr_agreement"] is not None
    hidden = [line for line in first["text_layer"] if not line["visible"]]
    assert [line["hidden_reason"] for line in hidden] == ["covered"]
    assert any(font["subset_tag"] is not None for font in pdf["fonts"])
    assert pdf["xmp"] is not None
    assert pdf["revisions"] == 1
    assert set(pdf["actions"].values()) == {0}
    assert document["image"] is None


def test_the_image_document_fixture_is_a_photo_read_by_ocr_alone() -> None:
    document = load("analyze-document-image.json")
    (page,) = document["pages"]

    assert document["source"] == "image"
    assert document["pdf"] is None
    assert page["text_layer"] == []
    assert page["width_pt"] is None
    assert page["ocr"]
    assert document["image"]["jpeg_quality"] is not None


def test_the_document_fixtures_describe_a_fictional_issuer() -> None:
    for name in ("analyze-document-pdf.json", "analyze-document-image.json"):
        lines = [line["text"] for page in load(name)["pages"] for line in page["ocr"]]
        assert "UTOPIA WATER BOARD" in lines


def test_the_chip_portrait_embedding_is_the_id_holders() -> None:
    portrait = load("analyze-government-id.json")["sides"]["front"]["portrait"]["embedding"]
    chip = load("embed-face-chip.json")["face"]["embedding"]

    assert cosine(portrait, chip) == pytest.approx(ID_SELFIE_COSINE, abs=1e-6)
