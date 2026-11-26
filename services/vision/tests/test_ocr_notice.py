"""Attribution for the vendored RapidOCR code and the PaddleOCR models (C33, CLAUDE.md rule 4),
the Phase 4 derived code (Workflow 4B review H009) and the notices the flow serves (K204).

Apache-2.0 §4: a derived file keeps its copyright notices and says it was changed; the NOTICE
names what was taken and from where; ``THIRD_PARTY_LICENSES.md`` lists every component with its
licence and, for downloads, the SHA-256.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

VISION = Path(__file__).resolve().parents[1]
REPO_ROOT = VISION.parents[1]
OCR = VISION / "src" / "openverify_vision" / "ocr"
RAPIDOCR_COMMIT = "bd941dae09da793e76c6ba15c7aaf40f8424232a"
VENDORED = ("geometry.py", "detection.py", "recognition.py")


SRC = VISION / "src" / "openverify_vision"
SILENT_FACE_COMMIT = "b6d5f04ad78778917853b25c778acef6d5626d15"
CANONICAL_MESH_COMMIT = "a908d668c730da128dfa8d9f6bd25d519d006692"
PHASE_4_DERIVED = {
    "liveness.py": ("Silent-Face-Anti-Spoofing", SILENT_FACE_COMMIT, "Copyright 2020 Minivision"),
    "pose.py": (
        "canonical_face_model.obj",
        CANONICAL_MESH_COMMIT,
        "Copyright 2020 The MediaPipe Authors",
    ),
}
"""Phase 4 modules derived from Apache-2.0 work: the upstream, its commit and its copyright line."""


def text_models() -> list[dict[str, str]]:
    manifest = json.loads((REPO_ROOT / "models" / "manifest.json").read_text(encoding="utf-8"))
    return [entry for entry in manifest["models"] if entry["name"].startswith("text_")]


def test_the_notice_credits_rapidocr_paddleocr_and_the_models() -> None:
    notice = (VISION / "NOTICE").read_text(encoding="utf-8")

    for needle in (
        "RapidOCR v3.10.0",
        RAPIDOCR_COMMIT,
        "Copyright (c) 2021 RapidOCR Authors",
        "Copyright (c) 2020 PaddlePaddle Authors",
        "Apache License, Version 2.0",
        *(f"src/openverify_vision/ocr/{name}" for name in VENDORED),
    ):
        assert needle in notice, needle
    for entry in text_models():
        assert entry["source_repo"] in notice, entry["name"]


@pytest.mark.parametrize("name", VENDORED)
def test_each_vendored_module_keeps_the_notices_and_says_it_was_changed(name: str) -> None:
    header = (OCR / name).read_text(encoding="utf-8").split('"""', 1)[0]

    assert "RapidOCR v3.10.0" in header
    assert RAPIDOCR_COMMIT in header
    assert "Copyright (c) 2021 RapidOCR Authors" in header
    assert "Copyright (c) 2020 PaddlePaddle Authors" in header
    assert "Licensed under the Apache License, Version 2.0" in header
    assert "services/vision/NOTICE" in header
    assert "Changed by the OpenVerify authors" in header


def test_the_vision_image_ships_the_notice_next_to_the_application() -> None:
    """K102 (Workflow 3B review): the image redistributes the vendored Apache-2.0 code, so it
    carries the NOTICE too (Apache-2.0 §4(d)). Compose builds it from ``services/vision``."""
    runtime = (VISION / "Dockerfile").read_text(encoding="utf-8").split(" AS runtime", 1)[1]
    ignored = (VISION / ".dockerignore").read_text(encoding="utf-8").split()

    assert re.search(r"^COPY (--\S+ )*NOTICE /app/NOTICE$", runtime, re.MULTILINE), runtime
    assert "NOTICE" not in ignored


def test_third_party_licenses_lists_the_vendored_code_and_each_text_model() -> None:
    licences = (REPO_ROOT / "THIRD_PARTY_LICENSES.md").read_text(encoding="utf-8")

    assert f"RapidOCR v3.10.0 (vendored source, commit `{RAPIDOCR_COMMIT[:7]}`" in licences
    for entry in text_models():
        assert entry["sha256"] in licences, entry["name"]
        assert entry["filename"] in licences, entry["name"]
    assert "PaddleOCR models (ONNX, via RapidOCR) | Apache-2.0 | RapidOCR model zoo" not in licences


FLOW_ORT_LICENCES = REPO_ROOT / "apps" / "flow" / "licenses" / "onnxruntime-web"
FLOW_ORT_NOTICES = ("LICENSE.txt", "ThirdPartyNotices.txt")


def licence_row(component: str) -> str:
    """The one row of ``THIRD_PARTY_LICENSES.md`` whose first cell is ``component``."""
    licences = (REPO_ROOT / "THIRD_PARTY_LICENSES.md").read_text(encoding="utf-8")
    rows = [line for line in licences.splitlines() if line.startswith(f"| {component} |")]
    assert len(rows) == 1, (component, rows)
    return rows[0]


def test_the_onnxruntime_web_row_names_the_notices_the_flow_serves() -> None:
    """K204 (Workflow 4B review): the flow vendors ONNX Runtime's licence and third-party notices
    and serves them beside the WASM. The row says where they are kept and served, so a distributor
    of the flow can find them and does not drop them as unused files."""
    row = licence_row("onnxruntime-web")

    assert "`apps/flow/licenses/onnxruntime-web/`" in row
    for name in FLOW_ORT_NOTICES:
        assert (FLOW_ORT_LICENCES / name).is_file(), name
        assert f"`/licenses/onnxruntime-web/{name}`" in row, name
    assert "Eigen (MPL-2.0)" in row  # the owner decision stays (plan decision 11)


def test_the_notice_credits_the_phase_4_derived_code() -> None:
    """H009 (Workflow 4B review): liveness.py reimplements Minivision's preprocessing and pose.py
    carries five points of MediaPipe's canonical face, both Apache-2.0. The image ships the NOTICE
    as its attribution, so it names them (Apache-2.0 4(b)-(d))."""
    notice = (VISION / "NOTICE").read_text(encoding="utf-8")

    for name, (upstream, commit, holder) in PHASE_4_DERIVED.items():
        for needle in (f"src/openverify_vision/{name}", upstream, commit, holder):
            assert needle in notice, (name, needle)


@pytest.mark.parametrize("name", sorted(PHASE_4_DERIVED))
def test_each_phase_4_derived_module_keeps_the_notice_and_says_what_changed(name: str) -> None:
    header = (SRC / name).read_text(encoding="utf-8").split('"""', 1)[0]
    upstream, commit, holder = PHASE_4_DERIVED[name]

    assert upstream in header
    assert commit in header
    assert holder in header
    assert "Licensed under the Apache License, Version 2.0" in header
    assert "services/vision/NOTICE" in header
    assert "Changed by the OpenVerify authors" in header


def test_third_party_licenses_names_the_phase_4_derived_code_and_its_holders() -> None:
    licences = (REPO_ROOT / "THIRD_PARTY_LICENSES.md").read_text(encoding="utf-8")

    for upstream, commit, holder in PHASE_4_DERIVED.values():
        assert f"commit `{commit[:7]}`" in licences, upstream
        assert holder in licences, upstream
