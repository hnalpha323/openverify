"""C41.1 ``passive_liveness``: the MiniFASNetV2 (scale 2.7) + V1SE (scale 4.0) ensemble with
upstream's preprocessing reimplemented exactly (research §3), and the YuNet box transform.

The parity numbers below were recorded once, on 2026-10-21, from the upstream reference
implementation: minivision-ai/Silent-Face-Anti-Spoofing at b6d5f04 (Apache-2.0), running its own
``CropImage`` (``src/generate_patches.py``), its own ``ToTensor`` (``src/data_io``), its MiniFASNet
definitions and ``AntiSpoofPredict.predict`` (``src/anti_spoof_predict.py``) on its own
checkpoints ``2.7_80x80_MiniFASNetV2.pth`` (sha256 a5eb02e1...bec0) and
``4_0_0_80x80_MiniFASNetV1SE.pth`` (sha256 84ee1d37...5990), with torch 2.14.1+cpu, numpy 2.5.4
and opencv-python-headless 5.0.0.93 on the CPU, exactly as its ``test.py`` does, minus the Caffe
face detector (the boxes are given). The inputs are :func:`parity_image`, exact integer patterns
that are the same on every platform. The one-off recording script is reproduced in
``docs/tdd/phase4-vision-face.tdd.md``. The pinned ONNX files are a re-export of those
checkpoints (``models/manifest.json``), so our pipeline must reproduce upstream's softmax.
"""

from __future__ import annotations

import logging
import math
import time
from collections.abc import Sequence
from pathlib import Path

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray

from openverify_vision.faces import Face, ModelNotAvailableError
from openverify_vision.inference import InferenceError
from openverify_vision.liveness import (
    ANTI_SPOOF_V1SE_FILENAME,
    ANTI_SPOOF_V1SE_VERSION,
    ANTI_SPOOF_V2_FILENAME,
    ANTI_SPOOF_V2_VERSION,
    BOX_HEIGHT_SHARE,
    BOX_TOP_SHIFT,
    BOX_WIDTH_SHARE,
    INPUT_SIZE,
    REAL_CLASS,
    V1SE_SCALE,
    V2_SCALE,
    IntBox,
    PassiveLivenessEngine,
    crop_box,
    crop_patch,
    softmax,
    to_input,
    upstream_box,
)
from openverify_vision.ocr.runtime import OnnxModel
from openverify_vision.schemas import PassiveLiveness
from openverify_vision.settings import Settings
from selfie_faces import draw_face

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = REPO_ROOT / "models"
GOLDEN = REPO_ROOT / "contracts" / "fixtures" / "vision" / "analyze-selfie.json"

Probabilities = tuple[float, float, float]

# (width, height, seed, upstream bbox, V2 crop corners, V2 softmax, V1SE crop corners, V1SE softmax)
UPSTREAM_OUTPUTS: tuple[
    tuple[int, int, int, IntBox, IntBox, Probabilities, IntBox, Probabilities], ...
] = (
    (480, 640, 0, (140, 200, 200, 220), (0, 46, 479, 573), (0.00755995465, 0.988570273, 0.00386973494), (0, 46, 479, 573), (0.0225420985, 0.957336426, 0.0201214124)),  # noqa: E501
    (480, 640, 1, (200, 260, 80, 90), (132, 183, 348, 426), (0.00591326086, 0.936928153, 0.0571586117), (80, 125, 400, 485), (0.00446305284, 0.995167732, 0.000369227055)),  # noqa: E501
    (640, 480, 2, (5, 100, 120, 150), (0, 0, 324, 405), (0.00259099831, 0.994543076, 0.00286596688), (0, 0, 383, 479), (0.208234578, 0.264105707, 0.527659714)),  # noqa: E501
    (640, 480, 3, (560, 380, 100, 120), (369, 155, 639, 479), (0.0905736983, 0.871386051, 0.0380401388), (239, 0, 639, 479), (0.359313488, 0.580995679, 0.0596908443)),  # noqa: E501
    (320, 240, 4, (-20, -15, 100, 110), (0, 0, 217, 239), (0.0299193189, 0.958738923, 0.0113417087), (0, 0, 217, 239), (0.12189164, 0.849938154, 0.0281702913)),  # noqa: E501
    (1280, 960, 5, (500, 300, 280, 330), (262, 19, 1018, 910), (0.00431847107, 0.954912543, 0.0407689922), (233, 0, 1046, 959), (0.00224629557, 0.994377911, 0.00337571022)),  # noqa: E501
    (40, 30, 6, (10, 8, 20, 15), (0, 0, 39, 29), (0.0256428923, 0.0717422813, 0.902614832), (0, 0, 39, 29), (0.000850710901, 0.0122465696, 0.986902714)),  # noqa: E501
    (200, 150, 7, (-10, -10, 230, 180), (8, 0, 199, 149), (0.0144622233, 0.457949847, 0.527587891), (8, 0, 199, 149), (0.0107395034, 0.913861692, 0.0753988251)),  # noqa: E501
)  # fmt: skip

# Upstream CropImage._get_new_box(src_w, src_h, bbox, scale) -> (left, top, right, bottom).
UPSTREAM_BOXES: tuple[tuple[int, int, IntBox, float, IntBox], ...] = (
    (640, 480, (100, 100, 50, 60), 2.7, (57, 49, 192, 211)),
    (640, 480, (0, 0, 1, 1), 4.0, (0, 0, 4, 4)),
    (640, 480, (639, 479, 1, 1), 4.0, (635, 475, 639, 479)),
    (640, 480, (300, 200, 639, 479), 2.7, (0, 0, 639, 479)),
    (640, 480, (-50, 300, 200, 250), 2.7, (0, 0, 383, 479)),
    (640, 480, (500, -40, 200, 250), 4.0, (255, 0, 639, 479)),
    (481, 641, (240, 320, 33, 47), 4.0, (190, 249, 322, 437)),
    (3, 3, (1, 1, 1, 1), 2.7, (0, 0, 2, 2)),
    (2, 2, (0, 0, 1, 1), 4.0, (0, 0, 1, 1)),
    (1000, 750, (333, 222, 111, 147), 2.7, (238, 97, 538, 493)),
    (1000, 750, (333, 222, 111, 147), 4.0, (166, 1, 610, 589)),
    (90, 120, (30, 40, 25, 33), 4.0, (0, 0, 89, 117)),
)


def parity_image(width: int, height: int, seed: int) -> NDArray[np.uint8]:
    """Exact integer patterns (no RNG, no floating point), the same on every platform: the
    inputs the upstream outputs above were recorded on."""
    y, x = np.mgrid[0:height, 0:width].astype(np.int64)
    blue = (x * x * 3 + y * 7 * (seed + 1)) // 17 % 256
    green = ((x // (4 + seed) + y // (6 + seed)) % 2) * 150 + 50
    red = (x * 255 // max(width - 1, 1) + y * (seed + 2)) % 256
    cx, cy = width // 2, height * 2 // 5
    ax, ay = max(width // 5, 1), max(height // 4, 1)
    inside = (x - cx) ** 2 * ay * ay + (y - cy) ** 2 * ax * ax <= ax * ax * ay * ay
    image = np.stack([blue, green, red], axis=-1)
    image[inside] = (image[inside] // 3 + np.array([60, 110, 170])) % 256
    return np.ascontiguousarray(image.astype(np.uint8))


class FakeModel:
    """Returns fixed logits and records every batch it is given."""

    def __init__(self, logits: Sequence[float]) -> None:
        self.logits = np.asarray([logits], dtype=np.float32)
        self.batches: list[NDArray[np.float32]] = []
        self.loads = 0

    def load(self) -> None:
        self.loads += 1

    def run(self, batch: NDArray[np.float32]) -> NDArray[np.float32]:
        self.batches.append(batch)
        return self.logits


class MissingModel:
    def load(self) -> None:
        raise ModelNotAvailableError("anti-spoofing model not found; run fetch_models.py")

    def run(self, batch: NDArray[np.float32]) -> NDArray[np.float32]:  # pragma: no cover
        raise ModelNotAvailableError("not loaded")


def _face(box: tuple[float, float, float, float]) -> Face:
    x, y, w, h = box
    landmarks = (
        (x + 0.3 * w, y + 0.4 * h),
        (x + 0.7 * w, y + 0.4 * h),
        (x + 0.5 * w, y + 0.6 * h),
        (x + 0.35 * w, y + 0.8 * h),
        (x + 0.65 * w, y + 0.8 * h),
    )
    return Face(box=box, landmarks=landmarks, score=0.9)


def _engine(
    v2: Sequence[float] = (0.0, 2.0, 0.0), v1se: Sequence[float] = (1.0, 1.0, 0.0)
) -> tuple[PassiveLivenessEngine, FakeModel, FakeModel]:
    first, second = FakeModel(v2), FakeModel(v1se)
    return PassiveLivenessEngine(first, second), first, second


# --- upstream's crop (research §3: shift, never clamp) ------------------------------------------


@pytest.mark.parametrize(("src_w", "src_h", "bbox", "scale", "expected"), UPSTREAM_BOXES)
def test_the_crop_box_is_upstreams(
    src_w: int, src_h: int, bbox: IntBox, scale: float, expected: IntBox
) -> None:
    corners, effective = crop_box(src_w, src_h, bbox, scale)
    assert corners == expected
    assert effective == pytest.approx(min((src_h - 1) / bbox[3], (src_w - 1) / bbox[2], scale))


@pytest.mark.parametrize("case", UPSTREAM_OUTPUTS, ids=lambda case: f"{case[0]}x{case[1]}")
def test_the_parity_crops_are_upstreams(
    case: tuple[int, int, int, IntBox, IntBox, Probabilities, IntBox, Probabilities],
) -> None:
    width, height, _, bbox, v2_corners, _, v1se_corners, _ = case
    assert crop_box(width, height, bbox, V2_SCALE)[0] == v2_corners
    assert crop_box(width, height, bbox, V1SE_SCALE)[0] == v1se_corners


def test_a_crop_over_the_edge_is_shifted_back_keeping_its_size() -> None:
    corners, scale = crop_box(640, 480, (5, 200, 100, 120), V2_SCALE)
    assert scale == pytest.approx(V2_SCALE)
    # The 270 x 324 crop around (55, 260) starts 80 pixels left of the image: it moves right,
    # keeping its width, where a clamp would have cut it to 190.
    assert corners == (0, 98, 270, 422)


def test_the_scale_is_clipped_to_what_the_image_holds() -> None:
    _, scale = crop_box(640, 480, (200, 100, 200, 220), V1SE_SCALE)
    assert scale == pytest.approx(479 / 220)


def test_the_patch_is_the_crop_resized_to_80_pixels_bilinearly() -> None:
    image = parity_image(640, 480, 3)
    patch, scale = crop_patch(image, (200, 150, 100, 120), V2_SCALE)
    (left, top, right, bottom), expected_scale = crop_box(640, 480, (200, 150, 100, 120), V2_SCALE)
    expected = cv2.resize(image[top : bottom + 1, left : right + 1], (INPUT_SIZE, INPUT_SIZE))
    assert patch.shape == (INPUT_SIZE, INPUT_SIZE, 3)
    assert np.array_equal(patch, expected)
    assert scale == expected_scale


def test_the_input_is_raw_bgr_0_to_255_in_nchw() -> None:
    patch = parity_image(80, 80, 2)
    batch = to_input(patch)
    assert batch.shape == (1, 3, INPUT_SIZE, INPUT_SIZE)
    assert batch.dtype == np.float32
    assert np.array_equal(batch[0, 0], patch[..., 0].astype(np.float32))  # blue first
    assert np.array_equal(batch[0, 2], patch[..., 2].astype(np.float32))
    assert batch.max() > 1.0  # not divided by 255


def test_softmax_is_stable_and_class_1_is_real() -> None:
    assert REAL_CLASS == 1
    probabilities = softmax(np.array([[1000.0, 1001.0, 999.0]]))
    expected = np.exp([-1.0, 0.0, -2.0]) / np.exp([-1.0, 0.0, -2.0]).sum()
    assert probabilities == pytest.approx(expected)
    assert probabilities.sum() == pytest.approx(1.0)


# --- the YuNet box transform -------------------------------------------------------------------


def test_the_yunet_box_becomes_upstreams_near_square_lower_box() -> None:
    assert (BOX_TOP_SHIFT, BOX_HEIGHT_SHARE, BOX_WIDTH_SHARE) == (0.12, 0.88, 0.84)
    box = upstream_box(_face((100.0, 50.0, 150.0, 200.0)))
    # Same bottom and horizontal centre; 0.88 of the height, 0.84 of the height wide.
    assert box == (91, 74, 168, 176)


def test_the_transform_rounds_the_size_and_floors_the_corner() -> None:
    assert upstream_box(_face((10.7, 20.2, 31.0, 40.0))) == (9, 25, 34, 35)
    assert upstream_box(_face((-30.0, -10.0, 60.0, 80.0))) == (-34, -1, 67, 70)


@pytest.mark.parametrize(
    "box",
    [
        (10.0, 10.0, 0.0, 20.0),
        (10.0, 10.0, 20.0, -1.0),
        (float("nan"), 10.0, 20.0, 20.0),
        (10.0, 10.0, float("inf"), 20.0),
    ],
)
def test_a_degenerate_box_has_no_upstream_box(box: tuple[float, float, float, float]) -> None:
    assert upstream_box(_face(box)) is None


def test_a_tiny_box_keeps_at_least_one_pixel() -> None:
    assert upstream_box(_face((5.0, 5.0, 0.4, 0.4))) == (5, 5, 1, 1)


# --- the engine ---------------------------------------------------------------------------------


def test_the_engine_reports_p_real_per_model_and_their_mean() -> None:
    engine, v2, v1se = _engine(v2=(0.0, 2.0, 0.0), v1se=(1.0, 1.0, 0.0))
    image = parity_image(640, 480, 1)
    result = engine.measure(image, _face((260.0, 140.0, 120.0, 160.0)))
    assert result is not None
    p_v2 = math.exp(2) / (math.exp(2) + 2)
    assert result.v2 == pytest.approx(p_v2, abs=1e-4)
    assert result.v1se == pytest.approx(math.e / (2 * math.e + 1), abs=1e-4)
    assert result.mean == pytest.approx((p_v2 + math.e / (2 * math.e + 1)) / 2, abs=1e-4)
    assert len(v2.batches) == len(v1se.batches) == 1
    assert v2.batches[0].shape == (1, 3, INPUT_SIZE, INPUT_SIZE)


def test_each_model_sees_its_own_scale_of_the_transformed_box() -> None:
    engine, v2, v1se = _engine()
    image = parity_image(1280, 960, 2)
    face = _face((600.0, 400.0, 90.0, 120.0))
    result = engine.measure(image, face)
    assert result is not None
    bbox = upstream_box(face)
    assert bbox is not None
    v2_patch, v2_scale = crop_patch(image, bbox, V2_SCALE)
    v1se_patch, v1se_scale = crop_patch(image, bbox, V1SE_SCALE)
    assert np.array_equal(v2.batches[0], to_input(v2_patch))
    assert np.array_equal(v1se.batches[0], to_input(v1se_patch))
    assert result.effective_scales.v2 == pytest.approx(v2_scale, abs=1e-3)
    assert result.effective_scales.v1se == pytest.approx(v1se_scale, abs=1e-3)
    assert (v2_scale, v1se_scale) == (V2_SCALE, V1SE_SCALE)


def test_a_face_near_the_frame_edge_reports_its_clipped_scales() -> None:
    engine, _, _ = _engine()
    image = parity_image(640, 480, 0)
    result = engine.measure(image, _face((20.0, 60.0, 180.0, 240.0)))
    assert result is not None
    assert result.effective_scales.v2 < V2_SCALE
    assert result.effective_scales.v1se == pytest.approx(result.effective_scales.v2)


def test_no_face_runs_no_model() -> None:
    engine, v2, _ = _engine()
    assert engine.measure(parity_image(64, 48, 0), None) is None
    assert v2.batches == []


def test_a_degenerate_face_runs_no_model() -> None:
    engine, v2, _ = _engine()
    assert engine.measure(parity_image(64, 48, 0), _face((5.0, 5.0, 0.0, 9.0))) is None
    assert v2.batches == []


def test_the_versions_name_the_models_once_loaded() -> None:
    engine, _, _ = _engine()
    before = engine.versions
    loaded = engine.load()
    after = engine.versions
    assert before == (None, None)
    assert loaded is True
    assert after == (ANTI_SPOOF_V2_VERSION, ANTI_SPOOF_V1SE_VERSION)
    assert ANTI_SPOOF_V2_VERSION == "minifasnet-v2-2.7"
    assert ANTI_SPOOF_V1SE_VERSION == "minifasnet-v1se-4.0"


def test_without_models_nothing_is_measured_and_a_warning_says_why(
    caplog: pytest.LogCaptureFixture,
) -> None:
    engine = PassiveLivenessEngine(MissingModel(), MissingModel())
    image, face = draw_face()
    with caplog.at_level(logging.WARNING, logger="openverify_vision.liveness"):
        assert engine.measure(image, face) is None
    assert engine.versions == (None, None)
    assert "passive liveness is not measured" in caplog.text
    assert PassiveLivenessEngine().measure(image, face) is None


def test_models_fetched_later_are_picked_up(tmp_path: Path) -> None:
    engine = PassiveLivenessEngine.from_models_dir(tmp_path)
    assert engine.load() is False
    if not (MODELS_DIR / ANTI_SPOOF_V2_FILENAME).is_file():
        pytest.skip("fetch the anti-spoofing models: python3 scripts/fetch_models.py")
    for name in (ANTI_SPOOF_V2_FILENAME, ANTI_SPOOF_V1SE_FILENAME):
        (tmp_path / name).write_bytes((MODELS_DIR / name).read_bytes())
    assert engine.load() is True


def test_the_engine_reads_the_settings_models_dir(tmp_path: Path) -> None:
    settings = Settings.model_validate({"service_token": "x" * 40, "models_dir": str(tmp_path)})
    engine = PassiveLivenessEngine.from_settings(settings)
    assert engine.load() is False


@pytest.mark.parametrize(
    "logits",
    [np.zeros((1, 2), dtype=np.float32), np.array([[0.0, float("nan"), 0.0]], dtype=np.float32)],
)
def test_an_unusable_model_output_is_an_inference_error(logits: NDArray[np.float32]) -> None:
    engine, v2, _ = _engine()
    v2.logits = logits
    image, face = draw_face()
    with pytest.raises(InferenceError):
        engine.measure(image, face)


# --- hostile inputs -----------------------------------------------------------------------------


def test_a_one_pixel_image_stays_bounded() -> None:
    engine, _, _ = _engine()
    image = np.full((1, 1, 3), 128, dtype=np.uint8)
    result = engine.measure(image, _face((0.0, 0.0, 1.0, 1.0)))
    assert result is not None
    assert result.effective_scales.v2 == 0.0


def test_a_face_outside_the_image_is_cropped_inside_it() -> None:
    engine, v2, _ = _engine()
    image = parity_image(320, 240, 4)
    result = engine.measure(image, _face((400.0, 300.0, 60.0, 80.0)))
    assert result is not None
    assert v2.batches[0].shape == (1, 3, INPUT_SIZE, INPUT_SIZE)


def test_grey_input_is_measured_as_bgr() -> None:
    engine, v2, _ = _engine()
    grey = parity_image(320, 240, 4)[..., 1].copy()
    assert engine.measure(grey, _face((100.0, 60.0, 80.0, 100.0))) is not None
    assert np.array_equal(v2.batches[0][0, 0], v2.batches[0][0, 2])


def test_a_huge_image_stays_bounded() -> None:
    engine, _, _ = _engine()
    image = np.full((5000, 7000, 3), 90, dtype=np.uint8)
    started = time.perf_counter()
    result = engine.measure(image, _face((3000.0, 1500.0, 2000.0, 2600.0)))
    assert time.perf_counter() - started < 1.0
    assert result is not None


def test_the_result_is_rounded_for_the_contract() -> None:
    engine, _, _ = _engine(v2=(0.1, 0.7, 0.2), v1se=(0.3, 0.1, 0.9))
    result = engine.measure(parity_image(640, 480, 5), _face((250.0, 120.0, 140.0, 190.0)))
    assert result is not None
    for value in (result.v2, result.v1se, result.mean):
        assert value == round(value, 4)
    assert result.effective_scales.v2 == round(result.effective_scales.v2, 3)


# --- parity with the upstream reference (needs the pinned ONNX files) ---------------------------

MISSING = [
    f"models/{name}"
    for name in (ANTI_SPOOF_V2_FILENAME, ANTI_SPOOF_V1SE_FILENAME)
    if not (MODELS_DIR / name).is_file()
]
needs_models = pytest.mark.skipif(
    bool(MISSING),
    reason=f"anti-spoofing models missing ({', '.join(MISSING)}); run "
    "python3 scripts/fetch_models.py",
)


@needs_models
@pytest.mark.parametrize("case", UPSTREAM_OUTPUTS, ids=lambda case: f"{case[0]}x{case[1]}")
def test_our_pipeline_reproduces_upstreams_softmax(
    case: tuple[int, int, int, IntBox, IntBox, Probabilities, IntBox, Probabilities],
) -> None:
    width, height, seed, bbox, _, v2_expected, _, v1se_expected = case
    image = parity_image(width, height, seed)
    for filename, scale, expected in (
        (ANTI_SPOOF_V2_FILENAME, V2_SCALE, v2_expected),
        (ANTI_SPOOF_V1SE_FILENAME, V1SE_SCALE, v1se_expected),
    ):
        model = OnnxModel(MODELS_DIR / filename, name=filename)
        patch, _ = crop_patch(image, bbox, scale)
        probabilities = softmax(model.run(to_input(patch)))
        assert probabilities == pytest.approx(expected, abs=1e-5), filename


@needs_models
@pytest.mark.parametrize("case", UPSTREAM_OUTPUTS, ids=lambda case: f"{case[0]}x{case[1]}")
def test_the_engine_predicts_upstreams_p_real_and_their_mean(
    case: tuple[int, int, int, IntBox, IntBox, Probabilities, IntBox, Probabilities],
) -> None:
    width, height, seed, bbox, _, v2_expected, _, v1se_expected = case
    engine = PassiveLivenessEngine.from_models_dir(MODELS_DIR)
    result = engine.predict(parity_image(width, height, seed), bbox)
    assert isinstance(result, PassiveLiveness)
    assert result.v2 == pytest.approx(v2_expected[REAL_CLASS], abs=1e-4)
    assert result.v1se == pytest.approx(v1se_expected[REAL_CLASS], abs=1e-4)
    # Upstream's fused score for "real" is the sum of the two softmax vectors' class 1 over 2.
    mean = (v2_expected[REAL_CLASS] + v1se_expected[REAL_CLASS]) / 2
    assert result.mean == pytest.approx(mean, abs=1e-4)
    assert engine.versions == (ANTI_SPOOF_V2_VERSION, ANTI_SPOOF_V1SE_VERSION)


def test_the_golden_fixture_names_the_same_model_versions() -> None:
    import json  # noqa: PLC0415

    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert golden["model_versions"]["anti_spoof_v2"] == ANTI_SPOOF_V2_VERSION
    assert golden["model_versions"]["anti_spoof_v1se"] == ANTI_SPOOF_V1SE_VERSION


def test_the_manifest_pins_both_models() -> None:
    import json  # noqa: PLC0415

    manifest = json.loads((REPO_ROOT / "models" / "manifest.json").read_text(encoding="utf-8"))
    filenames = {entry["filename"] for entry in manifest["models"]}
    assert {ANTI_SPOOF_V2_FILENAME, ANTI_SPOOF_V1SE_FILENAME} <= filenames


@pytest.mark.parametrize(
    ("size", "bbox"),
    [((640, 480), (10, 10, 0, 20)), ((640, 480), (10, 10, 20, -3)), ((0, 5), (0, 0, 1, 1))],
)
def test_a_crop_needs_a_positive_box_and_image(size: tuple[int, int], bbox: IntBox) -> None:
    with pytest.raises(ValueError, match="positive"):
        crop_box(size[0], size[1], bbox, V2_SCALE)
