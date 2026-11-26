"""C41.1 background layout and C41.2 background comparison (research §8).

Frames are drawn here: a backdrop of coloured blocks or a seeded texture, with a "person" (a
head ellipse over shoulders) in front of it. The face finder is a fake that reports the drawn
head, so no model is needed; the public-domain checks at the end need YuNet and the faces.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from PIL import Image as PILImage

from openverify_vision.analysis import FaceEngine
from openverify_vision.app import create_app
from openverify_vision.background import (
    MAX_COMPARE_LONG_SIDE,
    MAX_ORB_FEATURES,
    compare_backgrounds,
    measure_background,
    person_mask,
)
from openverify_vision.faces import YUNET_FILENAME, Face
from openverify_vision.schemas import (
    BACKGROUND_CELLS,
    BACKGROUND_LAYOUT_LENGTH,
    MAX_BACKGROUND_CANDIDATES,
    BoundingBox,
)
from openverify_vision.settings import Settings

from synthetic import Image, encode

GRID_COLUMNS, GRID_ROWS = 8, 6


def lab_of(bgr: tuple[int, int, int]) -> NDArray[np.float64]:
    """OpenCV's CIE Lab (L 0-100, a and b about -128 to 127) of one 8-bit BGR colour."""
    pixel = np.asarray([[bgr]], dtype=np.float32) / 255.0
    return np.asarray(cv2.cvtColor(pixel, cv2.COLOR_BGR2Lab), dtype=np.float64).reshape(3)


def face_at(box: BoundingBox) -> Face:
    x, y, w, h = box
    landmarks = (
        (x + 0.3 * w, y + 0.4 * h),
        (x + 0.7 * w, y + 0.4 * h),
        (x + 0.5 * w, y + 0.6 * h),
        (x + 0.35 * w, y + 0.8 * h),
        (x + 0.65 * w, y + 0.8 * h),
    )
    return Face(box=box, landmarks=landmarks, score=0.95)


def two_tone(width: int = 640, height: int = 480) -> Image:
    """Left half one colour, right half another."""
    image = np.zeros((height, width, 3), np.uint8)
    image[:, : width // 2] = (40, 160, 200)
    image[:, width // 2 :] = (190, 90, 30)
    return image


def draw_person(image: Image, box: BoundingBox, colour: tuple[int, int, int]) -> Image:
    """A head in ``box`` and shoulders below it, in one colour."""
    out = image.copy()
    x, y, w, h = box
    centre = (round(x + w / 2), round(y + h / 2))
    cv2.ellipse(out, centre, (round(w / 2), round(h / 2)), 0, 0, 360, colour, -1)
    height = out.shape[0]
    shoulders = np.array(
        [
            (x + 0.3 * w, y + h),
            (x + 0.7 * w, y + h),
            (x + w * 1.9, y + 1.5 * h),
            (x + w * 2.1, height),
            (x - w * 1.1, height),
            (x - w * 0.9, y + 1.5 * h),
        ],
        dtype=np.int32,
    )
    cv2.fillPoly(out, [shoulders], colour)
    return out


BOX: BoundingBox = (270.0, 150.0, 100.0, 120.0)


def cell(layout: list[float], row: int, column: int) -> NDArray[np.float64]:
    index = row * GRID_COLUMNS + column
    return np.asarray(layout[3 * index : 3 * index + 3], dtype=np.float64)


# --- the person mask -------------------------------------------------------------------------


def test_the_person_mask_covers_the_head_and_shoulders_and_leaves_the_corners() -> None:
    mask = person_mask((480, 640), BOX)
    assert mask.dtype == np.uint8
    assert mask.shape == (480, 640)
    x, y, w, h = BOX
    assert mask[round(y + h / 2), round(x + w / 2)] == 255  # the face
    assert mask[round(y - 0.3 * h), round(x + w / 2)] == 255  # hair above the box
    assert mask[479, round(x + w / 2)] == 255  # the chest at the bottom edge
    assert mask[round(y + 1.8 * h), round(x - 0.5 * w)] == 255  # a shoulder
    for corner in ((0, 0), (0, 639), (479, 0), (479, 639)):
        assert mask[corner] == 0, corner


def test_the_person_mask_is_clipped_to_the_frame() -> None:
    mask = person_mask((100, 120), (-50.0, -40.0, 400.0, 300.0))
    assert mask.shape == (100, 120)
    assert set(np.unique(mask)) <= {0, 255}


# --- the layout (8 x 6 cells of mean Lab after a sigma 6 blur) --------------------------------


def test_no_face_leaves_the_background_unmeasured() -> None:
    assert measure_background(two_tone(), None) is None


def test_the_layout_is_48_cells_of_mean_lab_in_row_major_order() -> None:
    image = draw_person(two_tone(), BOX, (128, 128, 128))
    layout = measure_background(image, face_at(BOX))
    assert layout is not None
    assert len(layout.layout) == BACKGROUND_LAYOUT_LENGTH
    assert len(layout.valid_cells) == BACKGROUND_CELLS
    left, right = lab_of((40, 160, 200)), lab_of((190, 90, 30))
    for row in range(GRID_ROWS):
        assert layout.valid_cells[row * GRID_COLUMNS] == "1"
        assert layout.valid_cells[row * GRID_COLUMNS + 7] == "1"
        assert cell(layout.layout, row, 0) == pytest.approx(left, abs=0.5)
        assert cell(layout.layout, row, 7) == pytest.approx(right, abs=0.5)


def test_cells_mostly_covered_by_the_person_are_invalid_and_take_the_background_mean() -> None:
    backdrop = np.full((480, 640, 3), (60, 120, 90), np.uint8)
    image = draw_person(backdrop, BOX, (250, 250, 250))
    layout = measure_background(image, face_at(BOX))
    assert layout is not None
    face_cell = 2 * GRID_COLUMNS + 3  # row 2, column 3: the face
    assert layout.valid_cells[face_cell] == "0"
    assert layout.valid_cells[0] == "1"
    filled = cell(layout.layout, 2, 3)
    assert filled == pytest.approx(lab_of((60, 120, 90)), abs=0.5)
    assert layout.coverage == pytest.approx(
        layout.valid_cells.count("1") / BACKGROUND_CELLS, abs=1e-4
    )
    assert 0.25 < layout.coverage < 1.0


def test_the_persons_colour_does_not_bleed_into_the_background_cells() -> None:
    backdrop = np.full((480, 640, 3), (128, 128, 128), np.uint8)
    image = draw_person(backdrop, BOX, (0, 0, 255))  # a saturated red person
    layout = measure_background(image, face_at(BOX))
    assert layout is not None
    grey = lab_of((128, 128, 128))
    for index, valid in enumerate(layout.valid_cells):
        if valid == "1":
            values = np.asarray(layout.layout[3 * index : 3 * index + 3])
            assert values == pytest.approx(grey, abs=1.0), index


def test_a_frame_filled_by_the_person_has_no_coverage() -> None:
    image = np.full((480, 640, 3), (90, 90, 90), np.uint8)
    layout = measure_background(image, face_at((20.0, 0.0, 600.0, 480.0)))
    assert layout is not None
    assert layout.valid_cells == "0" * BACKGROUND_CELLS
    assert layout.coverage == 0.0
    assert all(np.isfinite(layout.layout))


def test_a_reframed_backdrop_keeps_its_layout_and_another_backdrop_does_not() -> None:
    rng = np.random.default_rng(1)
    blocks = rng.integers(0, 256, (6, 8, 3)).astype(np.uint8)
    backdrop = np.asarray(cv2.resize(blocks, (640, 480), interpolation=cv2.INTER_CUBIC), np.uint8)
    shifted = np.roll(backdrop, 12, axis=1)
    other = np.asarray(
        cv2.resize(
            rng.integers(0, 256, (6, 8, 3)).astype(np.uint8),
            (640, 480),
            interpolation=cv2.INTER_CUBIC,
        ),
        np.uint8,
    )
    face = face_at(BOX)
    base = measure_background(draw_person(backdrop, BOX, (128, 128, 128)), face)
    near = measure_background(draw_person(shifted, BOX, (128, 128, 128)), face)
    far = measure_background(draw_person(other, BOX, (128, 128, 128)), face)
    assert base is not None
    assert near is not None
    assert far is not None
    to_near = float(np.linalg.norm(np.subtract(base.layout, near.layout)))
    to_far = float(np.linalg.norm(np.subtract(base.layout, far.layout)))
    assert to_near < to_far / 3


def test_a_large_frame_is_measured_on_a_copy_at_most_640_pixels_long(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[tuple[int, ...]] = []
    original = cv2.GaussianBlur

    def spy(image: Image, *args: object, **kwargs: object) -> object:
        seen.append(image.shape)
        return original(image, *args, **kwargs)

    monkeypatch.setattr(cv2, "GaussianBlur", spy)
    big = np.asarray(
        cv2.resize(two_tone(), (4000, 3000), interpolation=cv2.INTER_NEAREST), np.uint8
    )
    face = face_at((1690.0, 940.0, 620.0, 750.0))
    layout = measure_background(big, face)
    assert layout is not None
    assert seen
    assert all(max(shape[:2]) <= MAX_COMPARE_LONG_SIDE for shape in seen)


# --- the comparison: ORB + RANSAC on background pixels (C41.2) -------------------------------

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = REPO_ROOT / "models"
FACES_DIR = REPO_ROOT / "fixtures" / "faces"
TOKEN = "t" * 40
AUTH = {"x-service-token": TOKEN}
HEAD = (255, 0, 255)
"""The drawn head's colour, which :class:`HeadFinder` looks for."""
MANY_INLIERS = 100
"""What a re-framed same backdrop must reach: the provisional ``min-orb-inliers``."""
FEW_INLIERS = 50
"""Half of it: a different backdrop stays far below (research §8 measured 0 to 31)."""


def room(seed: int, width: int = 640, height: int = 480) -> Image:
    """A seeded "room": shapes, lines and words on a gradient, rich in corners."""
    rng = np.random.default_rng(seed)
    base = np.linspace(rng.integers(40, 120, 3), rng.integers(120, 220, 3), height)
    image = np.ascontiguousarray(np.repeat(base[:, None, :], width, axis=1).astype(np.uint8))

    def colour() -> tuple[int, int, int]:
        """A random BGR colour, never one :class:`HeadFinder` could take for the head."""
        while True:
            blue, green, red = (int(v) for v in rng.integers(0, 256, 3))
            if not (blue > 140 and red > 140 and green < 130):
                return (blue, green, red)

    def point() -> tuple[int, int]:
        return (int(rng.integers(0, width)), int(rng.integers(0, height)))

    for _ in range(60):
        thickness = -1 if rng.random() < 0.5 else int(rng.integers(1, 4))
        cv2.rectangle(image, point(), point(), colour(), thickness)
    for _ in range(40):
        cv2.circle(image, point(), int(rng.integers(4, 40)), colour(), int(rng.integers(1, 4)))
    for _ in range(30):
        cv2.line(image, point(), point(), colour(), int(rng.integers(1, 4)))
    for index in range(12):
        cv2.putText(
            image, f"ROOM {seed}-{index}", point(), cv2.FONT_HERSHEY_SIMPLEX, 0.8, colour(), 2
        )
    return image


def with_person(image: Image, box: BoundingBox | None = None) -> Image:
    """A magenta head (the finder's face) over dark shoulders, in the middle of ``image``."""
    height, width = image.shape[:2]
    x, y, w, h = (
        box if box is not None else (0.42 * width, 0.3 * height, 0.16 * width, 0.26 * height)
    )
    out = draw_person(image, (x, y, w, h), (90, 40, 40))
    centre = (round(x + w / 2), round(y + h / 2))
    cv2.ellipse(out, centre, (round(w / 2), round(h / 2)), 0, 0, 360, HEAD, -1)
    return out


def reframe(image: Image) -> Image:
    """The research §8 re-frame: shifted 30 px, scaled to 0.95, brightness +10, JPEG q75."""
    height, width = image.shape[:2]
    moved = cv2.warpAffine(
        image,
        np.float32([[0.95, 0, 30], [0, 0.95, 0]]),
        (width, height),
        borderMode=cv2.BORDER_REFLECT,
    )
    brighter = np.clip(moved.astype(np.int16) + 10, 0, 255).astype(np.uint8)
    return jpeg(brighter, 75)


def jpeg(image: Image, quality: int = 90) -> Image:
    ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return np.asarray(cv2.imdecode(buffer, cv2.IMREAD_COLOR), dtype=np.uint8)


class HeadFinder:
    """Reports the magenta head as the face, and records the size of every image it saw."""

    def __init__(self) -> None:
        self.shapes: list[tuple[int, ...]] = []

    def load(self) -> None:
        pass

    def find_faces(self, img: Image) -> list[Face]:
        self.shapes.append(img.shape)
        blue, green, red = (img[..., channel].astype(np.int16) for channel in range(3))
        ys, xs = np.nonzero((red > 180) & (blue > 180) & (green < 90))
        if xs.size == 0:
            return []
        x0, y0 = float(xs.min()), float(ys.min())
        return [face_at((x0, y0, float(xs.max()) - x0 + 1, float(ys.max()) - y0 + 1))]

    def detect(self, img: Image) -> list[Face]:
        return self.find_faces(img)


class FixedBoxFinder:
    """Reports a face at the same share of every image."""

    def __init__(self, share: BoundingBox) -> None:
        self.share = share

    def find_faces(self, img: Image) -> list[Face]:
        height, width = img.shape[:2]
        sx, sy, sw, sh = self.share
        return [face_at((sx * width, sy * height, sw * width, sh * height))]


def test_a_reframed_same_backdrop_has_many_inliers_and_another_backdrop_few() -> None:
    probe = jpeg(with_person(room(1)))
    same, other = reframe(with_person(room(1))), jpeg(with_person(room(2)))
    results = compare_backgrounds(probe, [same, other], HeadFinder())
    assert [result.index for result in results] == [0, 1]
    assert results[0].inliers >= MANY_INLIERS
    assert results[0].inlier_ratio >= 0.5
    assert results[0].good_matches >= results[0].inliers
    assert results[1].inliers < FEW_INLIERS


def test_no_candidate_compares_nothing() -> None:
    assert compare_backgrounds(room(1), [], HeadFinder()) == []


def test_more_than_five_candidates_are_refused() -> None:
    with pytest.raises(ValueError, match="at most 5"):
        compare_backgrounds(room(1), [room(1)] * (MAX_BACKGROUND_CANDIDATES + 1), HeadFinder())


def test_the_same_person_before_different_backdrops_is_not_a_match() -> None:
    texture = room(9, 120, 160)
    share = (0.4, 0.25, 0.2, 0.35)

    def sitter(backdrop: Image) -> Image:
        out = backdrop.copy()
        out[110:270, 250:370] = texture  # an identical, richly textured head
        out[300:480, 230:410] = room(10, 180, 180)  # and an identical shirt
        return out

    results = compare_backgrounds(sitter(room(3)), [sitter(room(4))], FixedBoxFinder(share))
    assert results[0].inliers < FEW_INLIERS


def test_a_featureless_candidate_has_no_match() -> None:
    blank = np.full((480, 640, 3), 128, np.uint8)
    results = compare_backgrounds(with_person(room(1)), [blank], HeadFinder())
    assert results[0].good_matches == 0
    assert results[0].inliers == 0
    assert results[0].inlier_ratio == 0.0


def test_the_keypoints_per_image_are_capped() -> None:
    busy = jpeg(room(5, 640, 480))
    result = compare_backgrounds(busy, [busy.copy()], FixedBoxFinder((0.0, 0.0, 0.01, 0.01)))[0]
    assert MANY_INLIERS <= result.inliers <= result.good_matches <= MAX_ORB_FEATURES
    assert result.inlier_ratio > 0.9


def test_every_image_is_downscaled_to_640_pixels_before_its_faces_are_found() -> None:
    finder = HeadFinder()
    big = np.asarray(
        cv2.resize(with_person(room(6)), (2560, 1920), interpolation=cv2.INTER_LINEAR), np.uint8
    )
    results = compare_backgrounds(big, [reframe(big)], finder)
    assert finder.shapes
    assert all(max(shape[:2]) <= MAX_COMPARE_LONG_SIDE for shape in finder.shapes)
    assert results[0].inliers >= MANY_INLIERS


# --- the route (C41.2) -------------------------------------------------------------------------


@pytest.fixture
def finder() -> HeadFinder:
    return HeadFinder()


@pytest.fixture
def client(finder: HeadFinder) -> Iterator[TestClient]:
    class Recognizer:
        def load(self) -> None:
            pass

    settings = Settings(service_token=TOKEN, models_dir=Path("missing"))  # type: ignore[call-arg]
    engine = FaceEngine(finder, Recognizer(), long_sides=(640,))  # type: ignore[arg-type]
    with TestClient(create_app(settings, face_engine=engine)) as test_client:
        yield test_client


def _upload(image: Image) -> tuple[str, bytes, str]:
    return ("frame.jpg", encode(image, "JPEG", quality=92), "image/jpeg")


def test_the_route_compares_the_probe_with_each_candidate(client: TestClient) -> None:
    probe = with_person(room(1))
    response = client.post(
        "/v1/compare/background",
        headers=AUTH,
        files={
            "probe": _upload(probe),
            "candidate_0": _upload(reframe(probe)),
            "candidate_1": _upload(with_person(room(2))),
        },
    )
    assert response.status_code == 200
    results = response.json()["results"]
    assert [result["index"] for result in results] == [0, 1]
    assert results[0]["inliers"] >= MANY_INLIERS
    assert results[1]["inliers"] < FEW_INLIERS
    assert set(results[0]) == {"index", "good_matches", "inliers", "inlier_ratio"}


def test_the_route_reports_each_candidate_by_its_field_number(client: TestClient) -> None:
    probe = with_person(room(1))
    response = client.post(
        "/v1/compare/background",
        headers=AUTH,
        files={
            "probe": _upload(probe),
            "candidate_3": _upload(probe),
            "candidate_0": _upload(room(2)),
        },
    )
    assert response.status_code == 200
    assert [result["index"] for result in response.json()["results"]] == [0, 3]


def test_the_route_without_candidates_answers_no_results(client: TestClient) -> None:
    response = client.post(
        "/v1/compare/background", headers=AUTH, files={"probe": _upload(room(1))}
    )
    assert response.status_code == 200
    assert response.json() == {"results": []}


def test_the_route_downscales_each_image_after_reading(
    client: TestClient, finder: HeadFinder
) -> None:
    big = np.asarray(
        cv2.resize(with_person(room(6)), (2000, 1500), interpolation=cv2.INTER_LINEAR), np.uint8
    )
    response = client.post(
        "/v1/compare/background",
        headers=AUTH,
        files={"probe": _upload(big), "candidate_0": _upload(big)},
    )
    assert response.status_code == 200
    assert finder.shapes
    assert all(max(shape[:2]) <= MAX_COMPARE_LONG_SIDE for shape in finder.shapes)


def test_the_route_names_an_unreadable_candidate(client: TestClient) -> None:
    truncated = encode(room(1), "JPEG", quality=90)[:400]
    response = client.post(
        "/v1/compare/background",
        headers=AUTH,
        files={"probe": _upload(room(1)), "candidate_1": ("x.jpg", truncated, "image/jpeg")},
    )
    assert response.status_code == 422
    assert "candidate_1" in response.json()["detail"]


# --- public-domain faces with YuNet (research §8's smoke test, in memory only) ------------------

needs_faces = pytest.mark.skipif(
    not (MODELS_DIR / YUNET_FILENAME).is_file()
    or not (FACES_DIR / "person-a-selfie.jpg").is_file(),
    reason="fetch the models and faces: scripts/fetch_models.py and scripts/fetch_fixtures.py",
)


def _public_domain(name: str) -> Image:
    """A public-domain portrait downscaled to 640 pixels, in memory."""
    with PILImage.open(io.BytesIO((FACES_DIR / name).read_bytes())) as photo:
        photo.draft("RGB", (1280, 1280))
        rgb = np.asarray(photo.convert("RGB"), dtype=np.uint8)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    height, width = bgr.shape[:2]
    scale = 640 / max(height, width)
    size = (round(width * scale), round(height * scale))
    return np.asarray(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), dtype=np.uint8)


@needs_faces
def test_a_reframed_public_domain_selfie_matches_and_another_studio_does_not() -> None:
    settings = Settings(service_token=TOKEN, models_dir=MODELS_DIR)  # type: ignore[call-arg]
    engine = FaceEngine.from_settings(settings)
    a, b = _public_domain("person-a-selfie.jpg"), _public_domain("person-b-selfie.jpg")
    results = compare_backgrounds(a, [reframe(a), b], engine)
    assert results[0].inliers >= MANY_INLIERS
    assert results[0].inlier_ratio >= 0.5
    assert results[1].inliers < MANY_INLIERS
