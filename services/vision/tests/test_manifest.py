"""The committed models/manifest.json is valid, pinned and permissively licensed."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from openverify_vision import ocr

REPO_ROOT = Path(__file__).resolve().parents[3]
MANIFEST = REPO_ROOT / "models" / "manifest.json"
OPENCV_ZOO = "https://github.com/opencv/opencv_zoo"
PADDLE_HF = "https://huggingface.co/PaddlePaddle"
PADDLE_OCR_MODELS = {
    # name: (Hugging Face repository, pinned commit, file in the repository, local file name)
    "text_detection_ppocrv6_small": (
        "PP-OCRv6_small_det_onnx",
        "28fe5895c24fd108c19eb3e8479f4ab385fbfc62",
        "inference.onnx",
        ocr.TEXT_DETECTOR_FILENAME,
    ),
    "text_recognition_ppocrv6_small": (
        "PP-OCRv6_small_rec_onnx",
        "b8f84f0b80c529de40b4fbb3544b84fa7233a513",
        "inference.onnx",
        ocr.TEXT_RECOGNIZER_FILENAME,
    ),
    "text_recognition_ppocrv6_small_dict": (
        "PP-OCRv6_small_rec_onnx",
        "b8f84f0b80c529de40b4fbb3544b84fa7233a513",
        "inference.yml",
        ocr.TEXT_DICTIONARY_FILENAME,
    ),
}


@pytest.fixture(scope="module")
def entries() -> dict[str, Any]:
    spec = importlib.util.spec_from_file_location(
        "fetch_models", REPO_ROOT / "scripts" / "fetch_models.py"
    )
    assert spec is not None
    assert spec.loader is not None
    module: ModuleType = importlib.util.module_from_spec(spec)
    sys.modules["fetch_models"] = module
    spec.loader.exec_module(module)
    return {entry.name: entry for entry in module.load_manifest(MANIFEST)}


def test_manifest_lists_yunet_from_opencv_zoo_under_mit(entries: dict[str, Any]) -> None:
    yunet = entries["face_detection_yunet"]

    assert yunet.license == "MIT"
    assert yunet.source_repo == OPENCV_ZOO
    assert yunet.filename == "face_detection_yunet_2026may.onnx"


def test_manifest_lists_sface_from_opencv_zoo_under_apache(entries: dict[str, Any]) -> None:
    sface = entries["face_recognition_sface"]

    assert sface.license == "Apache-2.0"
    assert sface.source_repo == OPENCV_ZOO


@pytest.mark.parametrize("name", sorted(PADDLE_OCR_MODELS))
def test_manifest_pins_the_pp_ocrv6_small_text_models_at_their_commits(
    entries: dict[str, Any], name: str
) -> None:
    # C33: PaddlePaddle's official ONNX files, at the commits whose model cards were read.
    repo, commit, upstream_file, filename = PADDLE_OCR_MODELS[name]
    entry = entries[name]

    assert entry.filename == filename
    assert entry.url == f"{PADDLE_HF}/{repo}/resolve/{commit}/{upstream_file}"
    assert entry.source_repo == f"{PADDLE_HF}/{repo}"
    assert entry.license == "Apache-2.0"
    assert entry.license_url == f"{PADDLE_HF}/{repo}/blob/{commit}/README.md"
    assert "PaddleOCR" in entry.upstream


def test_every_url_is_pinned_to_an_immutable_revision(entries: dict[str, Any]) -> None:
    for entry in entries.values():
        for moving_ref in ("/main/", "/master/", "/latest/", "/HEAD/"):
            assert moving_ref not in entry.url, entry.name
            assert moving_ref not in entry.license_url, entry.name


def test_weights_are_gitignored() -> None:
    gitignore = (REPO_ROOT / ".gitignore").read_text()

    assert "models/**/*.onnx" in gitignore


def test_git_ignores_every_file_the_fetch_script_downloads(entries: dict[str, Any]) -> None:
    # CLAUDE.md: never commit model weights or downloaded data, whatever their extension (the
    # OCR dictionary is a .yml file). `git check-ignore` prints each ignored path.
    downloaded = sorted(f"models/{entry.filename}" for entry in entries.values())

    result = subprocess.run(  # noqa: S603 - a fixed git command over the manifest's file names
        ["git", "check-ignore", *downloaded],  # noqa: S607 - git from PATH, as in development
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert sorted(result.stdout.split()) == downloaded


MEDIAPIPE = "https://github.com/google-ai-edge/mediapipe"
MESH_URL = (
    f"{MEDIAPIPE}/raw/a908d668c730da128dfa8d9f6bd25d519d006692"
    "/mediapipe/modules/face_geometry/data/canonical_face_model.obj"
)


def test_manifest_pins_the_canonical_face_mesh_under_apache(entries: dict[str, Any]) -> None:
    # C41.1, C45.2 (research §10.4): MediaPipe's canonical face mesh, pinned by commit and digest.
    mesh = entries["canonical_face_mesh"]

    assert mesh.filename == "canonical_face_model.obj"
    assert mesh.license == "Apache-2.0"
    assert mesh.source_repo == MEDIAPIPE
    assert mesh.url == MESH_URL
    assert mesh.sha256 == "8bac80443397e113f41a8b565ea72c59390bc031d9defab289dba7bc0c54e618"
    assert mesh.size == 45_999


def test_the_canonical_face_mesh_is_never_committed() -> None:
    ignored = subprocess.run(
        ["git", "check-ignore", "-q", "models/canonical_face_model.obj"],  # noqa: S607
        cwd=REPO_ROOT,
        check=False,
    )
    assert ignored.returncode == 0
