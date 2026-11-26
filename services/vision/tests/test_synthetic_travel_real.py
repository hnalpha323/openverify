"""Person A's chip portrait (C65.3) against the real YuNet and SFace, through the HTTP API.

The NFC e2e (C65.5) needs DG2 to match person A's selfie and not person B's: the portrait is
decoded as a chip portrait (``subject=chip``, through the guard) and compared with VGA selfies cut
the way the generator cuts them. Skipped, with the fetch commands, unless the models and the
public-domain faces are present. The similarities are printed (run with ``-s``).
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fake_camera import selfie_frames
from make_synthetic_fixtures import DEFAULT_MANIFEST, portraits, selfie_sources
from openverify_vision.app import create_app
from openverify_vision.faces import YUNET_FILENAME
from openverify_vision.recognition import SFACE_FILENAME
from openverify_vision.settings import Settings
from synthetic_travel import encode_jpeg2000, passport_portrait

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = REPO_ROOT / "models"
FACES_DIR = REPO_ROOT / "fixtures" / "faces"
TOKEN = "r" * 40
FACE_MATCH_THRESHOLD = 0.394
"""FACE_MATCH_DEFAULTS.threshold (C49, packages/core), the NFC selfie comparison's default."""

MISSING = [
    str(path.relative_to(REPO_ROOT))
    for path in (MODELS_DIR / YUNET_FILENAME, MODELS_DIR / SFACE_FILENAME)
    if not path.is_file()
] + [
    name
    for name in ("person-a-id.jpg", "person-a-selfie.jpg", "person-b-selfie.jpg")
    if not (FACES_DIR / name).is_file()
]
pytestmark = pytest.mark.skipif(
    bool(MISSING),
    reason=(
        f"real-model fixtures missing ({', '.join(MISSING)}); run python3 scripts/fetch_models.py"
        " and python3 scripts/fetch_fixtures.py"
    ),
)


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": str(MODELS_DIR)})
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def embed(client: TestClient, data: bytes, media_type: str, subject: str) -> Any:
    response = client.post(
        "/v1/embed/face",
        headers={"x-service-token": TOKEN},
        data={"subject": subject},
        files={"image": ("upload", data, media_type)},
    )
    assert response.status_code == 200, response.text
    return np.asarray(response.json()["face"]["embedding"], dtype=float)


def selfie_jpeg(person: str) -> bytes:
    a, b = selfie_sources(DEFAULT_MANIFEST, FACES_DIR)
    source = a if person == "A" else b
    (frame,) = selfie_frames(source.photo, source.face_box, count=1)
    buffer = io.BytesIO()
    Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).save(buffer, format="JPEG", quality=92)
    return buffer.getvalue()


def cosine(a: Any, b: Any) -> float:
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


def test_person_as_chip_portrait_matches_person_as_selfie_and_not_bs(client: TestClient) -> None:
    portrait, _ = portraits(DEFAULT_MANIFEST, FACES_DIR)
    chip = embed(
        client,
        encode_jpeg2000(passport_portrait(portrait.photo, portrait.face_box)),
        "image/jp2",
        "chip",
    )
    same = cosine(chip, embed(client, selfie_jpeg("A"), "image/jpeg", "selfie"))
    other = cosine(chip, embed(client, selfie_jpeg("B"), "image/jpeg", "selfie"))

    print(f"chip A vs selfie A {same:.3f}, vs selfie B {other:.3f}")
    assert same > FACE_MATCH_THRESHOLD
    assert other < FACE_MATCH_THRESHOLD
