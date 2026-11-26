"""tools/calibrate_selfie.py with the real models, on the three public-domain test faces.

Skipped unless YuNet, SFace and the faces are present. The faces stand in for a calibration set
of two identities (person A's two photos, person B's one) under pseudonymous ids, copied into a
temporary directory; the run measures the face match only (``--skip-provisional``). Its cosines
are printed for the evidence; no embedding may reach the output.
"""

from __future__ import annotations

import contextlib
import io
import json
import shutil
from pathlib import Path
from typing import Any

import pytest

from calibrate_selfie import main
from openverify_vision.faces import YUNET_FILENAME
from openverify_vision.recognition import SFACE_FILENAME
from schema_check import errors

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS = REPO_ROOT / "models"
FACES = REPO_ROOT / "fixtures" / "faces"
MANIFEST = REPO_ROOT / "fixtures" / "manifest.json"
SCHEMA = json.loads(
    (REPO_ROOT / "contracts/fixtures/calibration/selfie-calibration.schema.json").read_text(
        encoding="utf-8"
    )
)
FACE_MATCH_THRESHOLD = 0.394
"""``FACE_MATCH_DEFAULTS.threshold`` (C39.3; calibrated by C49)."""

ENTRIES = json.loads(MANIFEST.read_text(encoding="utf-8"))["faces"]
MISSING = [
    str(path.relative_to(REPO_ROOT))
    for path in [MODELS / YUNET_FILENAME, MODELS / SFACE_FILENAME]
    + [FACES / face["filename"] for face in ENTRIES]
    if not path.is_file()
]
pytestmark = pytest.mark.skipif(
    bool(MISSING),
    reason=f"real-model fixtures missing ({', '.join(MISSING)}); run scripts/fetch_models.py"
    " and scripts/fetch_fixtures.py",
)

PSEUDONYMS = {"person_a_id": "p0001-1", "person_a_selfie": "p0001-2", "person_b_selfie": "p0002-1"}


def calibration_set(root: Path) -> tuple[Path, Path]:
    images = root / "images"
    images.mkdir()
    identities: dict[str, dict[str, Any]] = {}
    for face in ENTRIES:
        name = PSEUDONYMS[face["name"]]
        identity = name.split("-")[0]
        shutil.copyfile(FACES / face["filename"], images / f"{name}.jpg")
        identities.setdefault(identity, {"id": identity, "sex": "female", "images": []})
        identities[identity]["images"].append(
            {
                "id": name,
                "url": face["url"],
                "source_page": face["source_page"],
                "revision_id": 1,
                "sha256": face["sha256"],
                "sha1": face["sha1"],
                "size": face["size"],
                "license_template": face["license_template"],
            }
        )
    manifest = root / "calibration-manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "description": "the three test faces as a tiny calibration set",
                "purpose": "a smoke test of the measurement",
                "takedown": "not applicable",
                "identities": list(identities.values()),
            }
        ),
        encoding="utf-8",
    )
    return manifest, images


def test_the_real_models_score_the_test_faces_without_writing_an_embedding(
    tmp_path: Path,
) -> None:
    manifest, images = calibration_set(tmp_path)
    out = tmp_path / "selfie-measurements.json"
    printed, warned = io.StringIO(), io.StringIO()

    with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(warned):
        code = main(
            [
                "--manifest", str(manifest), "--images", str(images), "--models", str(MODELS),
                "--out", str(out), "--skip-provisional",
            ]
        )  # fmt: skip

    assert code == 0, warned.getvalue()
    document = json.loads(out.read_text(encoding="utf-8"))
    print(f"\npairs: {document['pairs']}\nskew: {document['skew']}")
    assert errors(document, SCHEMA) == []
    assert document["set"]["identities"] == 2
    assert document["set"]["images"] == 3
    pairs = {(p["a"], p["b"]): p for p in document["pairs"]}
    assert pairs[("p0001-1", "p0001-2")]["genuine"]
    assert pairs[("p0001-1", "p0001-2")]["cosine"] >= FACE_MATCH_THRESHOLD
    assert pairs[("p0001-1", "p0002-1")]["cosine"] < FACE_MATCH_THRESHOLD
    assert len(document["skew"]["ita_degrees"]) == 2
    assert "embedding" not in out.read_text(encoding="utf-8")
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "calibration-manifest.json",
        "images",
        "selfie-measurements.json",
    ]
