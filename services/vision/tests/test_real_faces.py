"""Real YuNet + SFace on the public-domain face fixtures, through the HTTP API.

Skipped (with the reason and the fetch commands) unless both are present:

- the model weights: ``python3 scripts/fetch_models.py``
- the face photos:   ``python3 scripts/fetch_fixtures.py``

The synthetic ID, selfie stills and fake-camera clips are generated into a temporary
directory by ``tools/make_synthetic_fixtures.py``. Similarities are printed (run with ``-s``)
so they can be recorded in the TDD evidence.
"""

from __future__ import annotations

import io
import json
import math
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fake_camera import read_y4m
from make_synthetic_fixtures import main as make_synthetic_fixtures
from openverify_vision.app import create_app
from openverify_vision.faces import YUNET_FILENAME
from openverify_vision.recognition import SFACE_FILENAME
from openverify_vision.settings import Settings
from repose import MESH_FILENAME

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = REPO_ROOT / "models"
FACES_DIR = REPO_ROOT / "fixtures" / "faces"
MANIFEST = REPO_ROOT / "fixtures" / "manifest.json"
SFACE_COSINE_THRESHOLD = 0.363
TOKEN = "r" * 40
AUTH = {"x-service-token": TOKEN}


def _missing() -> list[str]:
    # The generator re-poses the selfies with the canonical face mesh (C45.2).
    required = [
        MODELS_DIR / YUNET_FILENAME,
        MODELS_DIR / SFACE_FILENAME,
        MODELS_DIR / MESH_FILENAME,
    ]
    faces = json.loads(MANIFEST.read_text(encoding="utf-8"))["faces"]
    required += [FACES_DIR / face["filename"] for face in faces]
    return [str(path.relative_to(REPO_ROOT)) for path in required if not path.is_file()]


MISSING = _missing()
pytestmark = pytest.mark.skipif(
    bool(MISSING),
    reason=(
        f"real-model fixtures missing ({', '.join(MISSING)}); run python3 scripts/fetch_models.py"
        " and python3 scripts/fetch_fixtures.py"
    ),
)


@pytest.fixture(scope="module")
def generated(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("generated")
    assert make_synthetic_fixtures(["--out", str(out), "--fps", "5", "--seconds", "1"]) == 0
    return out


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    settings = Settings.model_validate({"service_token": TOKEN, "models_dir": str(MODELS_DIR)})
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def upload(path_or_bytes: Path | bytes, name: str = "image.jpg") -> tuple[str, bytes, str]:
    data = path_or_bytes.read_bytes() if isinstance(path_or_bytes, Path) else path_or_bytes
    return (name, data, "image/jpeg")


def cosine(a: list[float], b: list[float]) -> float:
    return math.fsum(x * y for x, y in zip(a, b, strict=True))


@pytest.fixture(scope="module")
def id_analysis(client: TestClient, generated: Path) -> dict[str, Any]:
    response = client.post(
        "/v1/analyze/government-id",
        files={
            "front": upload(generated / "id-front.jpg"),
            "back": upload(generated / "id-back.jpg"),
        },
        headers=AUTH,
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def selfie_face(client: TestClient, image: Path | bytes) -> dict[str, Any]:
    response = client.post("/v1/analyze/selfie", files={"center": upload(image)}, headers=AUTH)
    assert response.status_code == 200, response.text
    center: dict[str, Any] = response.json()["poses"]["center"]
    return center


def jpeg(frame_bgr: Any) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(frame_bgr[..., ::-1]).save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


# --- the synthetic ID -----------------------------------------------------------------------


def test_synthetic_id_front_yields_exactly_one_portrait(id_analysis: dict[str, Any]) -> None:
    front = id_analysis["sides"]["front"]

    print(f"\nID front: faces={front['faces']} quality={front['quality']}")
    assert len(front["faces"]) == 1
    assert front["portrait"] is not None
    assert front["quality"]["is_blurry"] is False
    assert front["quality"]["has_glare"] is False


def test_synthetic_id_back_has_no_face_and_passes_quality(id_analysis: dict[str, Any]) -> None:
    back = id_analysis["sides"]["back"]

    print(f"\nID back: quality={back['quality']}")
    assert back["faces"] == []
    assert back["portrait"] is None
    assert back["quality"]["is_blurry"] is False
    assert back["quality"]["has_glare"] is False


# --- selfies against the ID portrait --------------------------------------------------------


@pytest.mark.parametrize(
    ("still", "same_person"),
    [("selfie-a.jpg", True), ("selfie-b.jpg", False)],
)
def test_selfie_still_against_id_portrait(
    client: TestClient,
    generated: Path,
    id_analysis: dict[str, Any],
    still: str,
    same_person: bool,
) -> None:
    portrait = id_analysis["sides"]["front"]["portrait"]["embedding"]
    center = selfie_face(client, generated / still)

    similarity = cosine(center["face"]["embedding"], portrait)

    print(f"\n{still} vs ID portrait(A): cosine={similarity:.4f} quality={center['quality']}")
    assert len(center["faces"]) == 1
    assert center["quality"]["is_blurry"] is False
    assert center["quality"]["is_too_dark"] is False
    assert center["quality"]["is_too_bright"] is False
    assert (similarity > SFACE_COSINE_THRESHOLD) is same_person


@pytest.mark.parametrize(
    ("clip", "same_person"),
    [("selfie-a.y4m", True), ("selfie-b.y4m", False)],
)
def test_fake_camera_frames_against_id_portrait(
    client: TestClient,
    generated: Path,
    id_analysis: dict[str, Any],
    clip: str,
    same_person: bool,
) -> None:
    portrait = id_analysis["sides"]["front"]["portrait"]["embedding"]
    _, frames = read_y4m(generated / clip)

    similarities = []
    for frame in frames:
        center = selfie_face(client, jpeg(frame))
        assert len(center["faces"]) == 1
        assert center["quality"]["is_blurry"] is False
        similarities.append(cosine(center["face"]["embedding"], portrait))

    print(f"\n{clip} frames vs ID portrait(A): {[round(s, 4) for s in similarities]}")
    assert all((s > SFACE_COSINE_THRESHOLD) is same_person for s in similarities)


def test_embed_face_on_the_source_photos(client: TestClient) -> None:
    def embed(name: str) -> list[float]:
        with Image.open(FACES_DIR / name) as photo:  # the 43 MP original exceeds the pixel cap
            photo.thumbnail((2000, 2000))
            buffer = io.BytesIO()
            photo.convert("RGB").save(buffer, format="JPEG", quality=92)
        response = client.post(
            "/v1/embed/face", files={"image": upload(buffer.getvalue())}, headers=AUTH
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["face_count"] == 1
        embedding: list[float] = body["face"]["embedding"]
        return embedding

    a_id, a_selfie, b_selfie = (
        embed("person-a-id.jpg"),
        embed("person-a-selfie.jpg"),
        embed("person-b-selfie.jpg"),
    )
    same = cosine(a_id, a_selfie)
    different = cosine(a_id, b_selfie)

    print(f"\nsource photos: A-id vs A-selfie={same:.4f}, A-id vs B-selfie={different:.4f}")
    assert same > SFACE_COSINE_THRESHOLD
    assert different < SFACE_COSINE_THRESHOLD
