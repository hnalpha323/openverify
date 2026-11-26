"""Synthetic inputs of the fixture generator tests: gradient "photos" and a pinned manifest.

No real photo is used here; ``test_real_faces.py`` runs the generator on the public-domain faces.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from synthetic_variants import Portrait

FACE_BOX = (150, 120, 100, 130)


def gradient(seed: int, width: int = 400, height: int = 500) -> Image.Image:
    """A smooth synthetic "photo" with a darker block where a face would be."""
    rng = np.random.default_rng(seed)
    base = rng.integers(40, 120, size=3)
    yy, xx = np.mgrid[0:height, 0:width]
    rgb = np.stack(
        [base[0] + xx * 120 // width, base[1] + yy * 100 // height, base[2] + 0 * xx], axis=-1
    )
    rgb[120:250, 150:250] = rng.integers(60, 160, size=3)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


A = Portrait(gradient(1), FACE_BOX, "gradient_a")
"""The card holder's "photo"."""

B = Portrait(gradient(2), FACE_BOX, "gradient_b")
"""Another person's "photo", for the portrait swap and the distinct holders."""


def synthetic_photo(path: Path, seed: int) -> str:
    """Write a gradient JPEG to ``path`` and return its SHA-256, as the manifest pins it."""
    rng = np.random.default_rng(seed)
    base = rng.integers(60, 180, size=3)
    yy, xx = np.mgrid[0:600, 0:480]
    rgb = np.stack([base[0] + xx // 8, base[1] + yy // 10, base[2] + 0 * xx], axis=-1)
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").save(path, quality=90)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def entry(name: str, person: str, role: str, filename: str, sha256: str) -> dict[str, Any]:
    return {
        "name": name,
        "person": person,
        "role": role,
        "filename": filename,
        "source_page": "https://commons.example.invalid/wiki/File:X.jpg",
        "url": "https://upload.example.invalid/X.jpg",
        "sha256": sha256,
        "size": 1,
        "license": "public-domain",
        "license_template": "PD-USGov-NASA",
        "author": "NASA/Example",
        "face_box": [180, 150, 120, 160],
    }


def make_workspace(tmp_path: Path) -> tuple[Path, Path]:
    """A manifest of three gradient "faces" (A's ID portrait and selfie, B's selfie)."""
    faces = tmp_path / "faces"
    faces.mkdir()
    entries = [
        entry("a_id", "A", "id_portrait", "a-id.jpg", synthetic_photo(faces / "a-id.jpg", 1)),
        entry(
            "a_selfie", "A", "selfie", "a-selfie.jpg", synthetic_photo(faces / "a-selfie.jpg", 2)
        ),
        entry(
            "b_selfie", "B", "selfie", "b-selfie.jpg", synthetic_photo(faces / "b-selfie.jpg", 3)
        ),
    ]
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"schema_version": 1, "faces": entries}))
    return manifest, faces
