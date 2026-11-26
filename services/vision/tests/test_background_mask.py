"""C99.7: the person-masked background copy a selfie-background list item keeps.

A list item outlives the selfie it came from, so it holds no person: every face the finder sees
goes with its head and shoulders, grown as the comparison grows them, and what is left still
confirms the same room through ``POST /v1/compare/background``. Frames are drawn by
``test_background``'s helpers; the public-domain check at the end needs YuNet and the faces.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from openverify_vision.analysis import FaceEngine
from openverify_vision.app import create_app
from openverify_vision.background import (
    MAX_COMPARE_LONG_SIDE,
    compare_backgrounds,
    mask_person,
)
from openverify_vision.faces import Face
from openverify_vision.settings import Settings
from test_background import (
    AUTH,
    FACES_DIR,
    FEW_INLIERS,
    MANY_INLIERS,
    MODELS_DIR,
    TOKEN,
    HeadFinder,
    _public_domain,
    face_at,
    needs_faces,
    reframe,
    room,
    with_person,
)

from synthetic import Image, encode

_ROUTE = "/v1/mask/background"
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class TwoHeads:
    """Reports two fixed faces, largest first, whatever the image."""

    def find_faces(self, img: Image) -> list[Face]:
        _ = img
        return [face_at((60.0, 120.0, 90.0, 120.0)), face_at((460.0, 140.0, 80.0, 100.0))]


class NoHead:
    def find_faces(self, img: Image) -> list[Face]:
        _ = img
        return []


def _magenta(image: Image) -> int:
    blue, green, red = (image[..., channel].astype(np.int16) for channel in range(3))
    return int(np.count_nonzero((red > 180) & (blue > 180) & (green < 90)))


def test_the_person_is_gone_and_the_finder_sees_no_face() -> None:
    frame = with_person(room(1))
    assert _magenta(frame) > 0
    masked = mask_person(frame, HeadFinder())
    assert masked is not None
    assert _magenta(masked) == 0
    assert HeadFinder().find_faces(masked) == []


def test_nothing_of_the_shoulders_is_left() -> None:
    backdrop = np.full((480, 640, 3), 200, dtype=np.uint8)
    masked = mask_person(with_person(backdrop), HeadFinder())
    assert masked is not None
    # The drawn shoulders are dark on a light wall; the fill takes the wall's colour.
    assert int(masked.min()) >= 190


def test_every_face_in_the_frame_goes() -> None:
    frame = room(3)
    masked = mask_person(frame, TwoHeads())
    assert masked is not None
    for x, y, w, h in ((60, 120, 90, 120), (460, 140, 80, 100)):
        centre = (y + h // 2, x + w // 2)
        assert not np.array_equal(masked[centre], frame[centre])


def test_the_background_outside_the_person_is_kept_pixel_for_pixel() -> None:
    frame = with_person(room(4))
    masked = mask_person(frame, HeadFinder())
    assert masked is not None
    # The top corners are far from the head; the frame is at most 640 pixels already.
    assert np.array_equal(masked[:60, :120], frame[:60, :120])
    assert np.array_equal(masked[:60, -120:], frame[:60, -120:])


def test_the_copy_is_at_most_640_pixels_long() -> None:
    large = cv2.resize(with_person(room(5)), (1600, 1200), interpolation=cv2.INTER_NEAREST)
    masked = mask_person(large, HeadFinder())
    assert masked is not None
    assert max(masked.shape[:2]) == MAX_COMPARE_LONG_SIDE


def test_no_face_gives_no_copy() -> None:
    assert mask_person(room(6), NoHead()) is None


def test_a_frame_filled_by_the_person_keeps_nothing_of_it() -> None:
    frame = np.full((480, 640, 3), (90, 40, 40), dtype=np.uint8)

    class Filled:
        def find_faces(self, img: Image) -> list[Face]:
            _ = img
            return [face_at((-200.0, -200.0, 1000.0, 1000.0))]

    masked = mask_person(frame, Filled())
    assert masked is not None
    assert int(masked.max()) == 0


def test_the_masked_copy_still_confirms_the_same_room_and_not_another() -> None:
    masked = mask_person(with_person(room(1)), HeadFinder())
    assert masked is not None
    probe, other = reframe(with_person(room(1))), with_person(room(2))
    results = compare_backgrounds(probe, [masked, other], HeadFinder())
    assert results[0].inliers >= MANY_INLIERS
    assert results[0].inlier_ratio >= 0.5
    assert results[1].inliers < FEW_INLIERS


def test_a_masked_copy_of_another_room_is_not_confirmed() -> None:
    masked = mask_person(with_person(room(2)), HeadFinder())
    assert masked is not None
    results = compare_backgrounds(with_person(room(1)), [masked], HeadFinder())
    assert results[0].inliers < FEW_INLIERS


@pytest.fixture
def client() -> Iterator[TestClient]:
    class Recognizer:
        def load(self) -> None:
            pass

    settings = Settings(service_token=TOKEN, models_dir=Path("missing"))  # type: ignore[call-arg]
    engine = FaceEngine(HeadFinder(), Recognizer(), long_sides=(640,))  # type: ignore[arg-type]
    with TestClient(create_app(settings, face_engine=engine)) as test_client:
        yield test_client


def _upload(image: Image) -> dict[str, tuple[str, bytes, str]]:
    return {"image": ("frame.jpg", encode(image, "JPEG", quality=92), "image/jpeg")}


def test_the_route_answers_a_png_of_the_masked_copy(client: TestClient) -> None:
    large = cv2.resize(with_person(room(7)), (1280, 960), interpolation=cv2.INTER_NEAREST)
    response = client.post(_ROUTE, headers=AUTH, files=_upload(large))
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(_PNG_SIGNATURE)
    decoded = cv2.imdecode(np.frombuffer(response.content, np.uint8), cv2.IMREAD_COLOR)
    assert max(decoded.shape[:2]) == MAX_COMPARE_LONG_SIDE
    assert _magenta(decoded) == 0


def test_the_route_needs_the_service_token(client: TestClient) -> None:
    response = client.post(_ROUTE, files=_upload(with_person(room(7))))
    assert response.status_code == 401


def test_the_route_names_a_frame_without_a_face(client: TestClient) -> None:
    response = client.post(_ROUTE, headers=AUTH, files=_upload(room(8)))
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["code"] == "no_face_found"


def test_the_route_refuses_what_is_no_image(client: TestClient) -> None:
    response = client.post(
        _ROUTE, headers=AUTH, files={"image": ("frame.jpg", b"not an image", "image/jpeg")}
    )
    assert response.status_code in {415, 422}


@needs_faces
def test_a_public_domain_selfie_loses_its_face_and_keeps_its_room() -> None:
    assert (FACES_DIR / "person-a-selfie.jpg").is_file()
    settings = Settings(service_token=TOKEN, models_dir=MODELS_DIR)  # type: ignore[call-arg]
    engine = FaceEngine.from_settings(settings)
    a, b = _public_domain("person-a-selfie.jpg"), _public_domain("person-b-selfie.jpg")
    masked = mask_person(a, engine)
    assert masked is not None
    assert engine.find_faces(masked) == []
    results = compare_backgrounds(reframe(a), [masked, b], engine)
    assert results[0].inliers >= MANY_INLIERS
    assert results[0].inlier_ratio >= 0.5
    assert results[1].inliers < MANY_INLIERS
