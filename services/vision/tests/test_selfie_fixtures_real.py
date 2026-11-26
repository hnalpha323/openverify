"""The C45.2 selfie set on the real public-domain faces, read back with the real models.

Skipped (with the fetch commands) unless the YuNet and SFace weights, the canonical face mesh
and the faces are present. The set is generated into a temporary directory; the measurements are
printed (run with ``-s``) for the TDD evidence and the report.

What is checked against ``contracts/fixtures/flow/selfie-capture.json`` (C40.11), independently
of the generator's own search:

- each head-turn clip is MJPEG at the constants' size, at Chromium's fixed 30 fps, cycles from
  the centre through the constants' cycle within the period, and holds each extreme at least the
  minimum;
- YuNet reads each clip's centre within the client's centre trigger (0.8 x the server's
  ``max-center-yaw-ratio``) and each extreme beyond the side trigger (1.25 x the server's
  ``min-side-yaw-ratio-change``), both as the client sees it (the 320-pixel preview) and as the
  server sees the uploaded frame (the browser's I420 frame encoded as a JPEG, through the
  service's multi-scale detection).

The thresholds are the shared constants; nothing here is tuned to pass.
"""

from __future__ import annotations

import io
import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image

from benchmark_selfie import main as benchmark
from calibrate_selfie import app_analyser, provisional
from head_turn import (
    CaptureConstants,
    ModelKit,
    decode_jpeg,
    load_capture_constants,
    read_mjpeg,
    split_mjpeg,
)
from make_synthetic_fixtures import selfie_sources
from openverify_vision.analysis import FaceEngine
from openverify_vision.faces import YUNET_FILENAME, FaceDetector
from openverify_vision.pose import yaw_ratio
from openverify_vision.recognition import SFACE_FILENAME, FaceRecognizer
from openverify_vision.settings import Settings
from repose import MESH_FILENAME
from synthetic_selfie import generate_selfie_set

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS = REPO_ROOT / "models"
FACES = REPO_ROOT / "fixtures" / "faces"
MANIFEST = REPO_ROOT / "fixtures" / "manifest.json"

FACE_MATCH_THRESHOLD = 0.394
"""``FACE_MATCH_DEFAULTS.threshold`` (C39.3; calibrated by C49): A must match the ID, B must not."""

MIN_SIDE_IDENTITY_COSINE = 0.4
"""``min-side-identity-cosine`` (C39.3, provisional): liveness's identity continuity."""


def _missing() -> list[str]:
    required = [MODELS / YUNET_FILENAME, MODELS / SFACE_FILENAME, MODELS / MESH_FILENAME]
    faces = json.loads(MANIFEST.read_text(encoding="utf-8"))["faces"]
    required += [FACES / face["filename"] for face in faces]
    return [str(path.relative_to(REPO_ROOT)) for path in required if not path.is_file()]


MISSING = _missing()
pytestmark = pytest.mark.skipif(
    bool(MISSING),
    reason=(
        f"real-model fixtures missing ({', '.join(MISSING)}); run python3 scripts/fetch_models.py"
        " and python3 scripts/fetch_fixtures.py"
    ),
)


class _NoRecognizer:
    def load(self) -> None:
        pass

    def embed(self, img: NDArray[np.uint8], face: Any) -> NDArray[np.float32]:
        raise AssertionError("the yaw readings never embed")


@pytest.fixture(scope="module")
def constants() -> CaptureConstants:
    return load_capture_constants()


@pytest.fixture(scope="module")
def selfie_set(
    tmp_path_factory: pytest.TempPathFactory, constants: CaptureConstants
) -> tuple[Path, dict[str, Any]]:
    out = tmp_path_factory.mktemp("generated")
    kit = ModelKit.from_models(MODELS, preview_width=constants.preview_width_px)
    _, index = generate_selfie_set(selfie_sources(MANIFEST, FACES), kit, constants, out)
    return out, index


@pytest.fixture(scope="module")
def detector() -> FaceDetector:
    return FaceDetector(MODELS / YUNET_FILENAME)


def clip(index: dict[str, Any], name: str) -> dict[str, Any]:
    found: dict[str, Any] = next(c for c in index["clips"] if c["name"] == name)
    return found


def uploaded(frame: NDArray[np.uint8]) -> NDArray[np.uint8]:
    """The frame as the web flow uploads it: Chromium's I420 frame, drawn and encoded as a JPEG."""
    i420 = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420)
    rgb = cv2.cvtColor(cv2.cvtColor(i420, cv2.COLOR_YUV2BGR_I420), cv2.COLOR_BGR2RGB)
    buffer = io.BytesIO()
    Image.fromarray(rgb).save(buffer, format="JPEG", quality=92)
    return np.asarray(cv2.cvtColor(np.asarray(Image.open(buffer)), cv2.COLOR_RGB2BGR))


def client_ratio(detector: FaceDetector, frame: NDArray[np.uint8], width: int) -> float | None:
    height = round(frame.shape[0] * width / frame.shape[1])
    preview = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
    faces = detector.detect(np.asarray(preview, dtype=np.uint8))
    return None if not faces else yaw_ratio(max(faces, key=lambda f: f.area).landmarks)


def server_ratio(detector: FaceDetector, frame: NDArray[np.uint8]) -> float | None:
    faces = FaceEngine(detector, _NoRecognizer()).find_faces(uploaded(frame))
    return None if not faces else yaw_ratio(faces[0].landmarks)


def hold_frames(entry: dict[str, Any], frames: list[NDArray[np.uint8]]) -> dict[str, Any]:
    """The first frame of each pose's hold (a hold repeats one render)."""
    return {
        segment["pose"]: frames[segment["first_frame"]]
        for segment in entry["segments"]
        if segment["kind"] == "hold"
    }


# --- the clips against the shared constants -------------------------------------------------------


@pytest.mark.parametrize("name", ["head-turn-a", "head-turn-b"])
def test_each_head_turn_clip_follows_the_constants(
    selfie_set: tuple[Path, dict[str, Any]], constants: CaptureConstants, name: str
) -> None:
    out, index = selfie_set
    entry = clip(index, name)
    data = (out / entry["file"]).read_bytes()
    jpegs = split_mjpeg(data)
    frames = read_mjpeg(out / entry["file"])

    assert entry["file"].endswith(".mjpeg")
    assert {frame.shape for frame in frames} == {(constants.height, constants.width, 3)}
    assert entry["frame_rate"] == constants.frame_rate == 30  # Chromium's fixed MJPEG rate
    assert len(frames) == entry["frames"] <= constants.max_period_seconds * constants.frame_rate
    holds = [s for s in entry["segments"] if s["kind"] == "hold"]
    assert [hold["pose"] for hold in holds] == list(constants.cycle)
    assert entry["segments"][0]["pose"] == constants.starts_at
    assert entry["segments"][0]["first_frame"] == 0
    minimum = math.ceil(constants.min_hold_seconds * constants.frame_rate)
    for hold in holds:
        repeated = jpegs[hold["first_frame"] : hold["first_frame"] + hold["frames"]]
        assert len(set(repeated)) == 1, hold
        if hold["pose"] != "center":
            assert hold["frames"] >= minimum
            assert abs(hold["yaw_deg"]) == constants.target_yaw_deg


@pytest.mark.parametrize("name", ["head-turn-a", "head-turn-b"])
def test_yunet_reads_each_extreme_beyond_the_side_trigger(
    selfie_set: tuple[Path, dict[str, Any]],
    constants: CaptureConstants,
    detector: FaceDetector,
    name: str,
) -> None:
    out, index = selfie_set
    entry = clip(index, name)
    poses = hold_frames(entry, read_mjpeg(out / entry["file"]))

    readings = {
        "client": {
            pose: client_ratio(detector, frame, constants.preview_width_px)
            for pose, frame in poses.items()
        },
        "server": {pose: server_ratio(detector, frame) for pose, frame in poses.items()},
    }
    print(
        f"\n{name}: framing {entry['framing']}, centre yaw {entry['center_yaw_deg']} deg, "
        f"extremes +-{entry['target_yaw_deg']} deg; centre trigger {constants.center_trigger:.4f},"
        f" side trigger {constants.side_trigger:.4f}"
    )
    for path, read in readings.items():
        center, left, right = read["center"], read["left"], read["right"]
        assert center is not None
        assert left is not None
        assert right is not None
        print(
            f"  {path}: centre {center:+.4f}, left {left:+.4f} (change {left - center:+.4f}), "
            f"right {right:+.4f} (change {center - right:+.4f})"
        )
        assert abs(center) <= constants.center_trigger
        assert left - center >= constants.side_trigger
        assert center - right >= constants.side_trigger


def test_the_static_replay_never_turns_as_far_as_the_side_trigger(
    selfie_set: tuple[Path, dict[str, Any]], constants: CaptureConstants, detector: FaceDetector
) -> None:
    out, index = selfie_set
    entry = clip(index, "static-replay-a")
    frames = read_mjpeg(out / entry["file"])

    sampled = frames[:: constants.frame_rate // 2]
    ratios = [client_ratio(detector, frame, constants.preview_width_px) for frame in sampled]
    print(f"\nstatic-replay-a client readings: {[round(r or 0, 4) for r in ratios]}")
    assert all(r is not None for r in ratios)
    first = ratios[0] or 0.0
    assert all(abs((r or 0.0) - first) < constants.side_trigger for r in ratios)


# --- the stills -----------------------------------------------------------------------------------


def test_the_still_triples_are_the_clip_renders(selfie_set: tuple[Path, dict[str, Any]]) -> None:
    out, index = selfie_set

    for still in index["stills"]:
        entry = clip(index, still["name"])
        poses = hold_frames(entry, read_mjpeg(out / entry["file"]))
        for pose, name in still["poses"].items():
            image = decode_jpeg((out / name).read_bytes()).astype(np.float64)
            mse = float(np.mean((image - poses[pose].astype(np.float64)) ** 2))
            assert 10 * math.log10(255**2 / mse) > 30, (name, pose)


def embedding(engine: FaceEngine, image: NDArray[np.uint8]) -> NDArray[np.float64]:
    faces = engine.find_faces(image)
    assert faces
    vector = np.asarray(engine.embed(image, faces[0]), dtype=np.float64)
    return np.asarray(vector / np.linalg.norm(vector), dtype=np.float64)


def test_person_a_matches_the_id_portrait_person_b_does_not_and_each_turn_stays_the_same_person(
    selfie_set: tuple[Path, dict[str, Any]],
) -> None:
    out, index = selfie_set
    engine = FaceEngine(
        FaceDetector(MODELS / YUNET_FILENAME), FaceRecognizer(MODELS / SFACE_FILENAME)
    )
    with Image.open(FACES / "person-a-id.jpg") as photo:
        photo.thumbnail((2000, 2000))
        portrait = cv2.cvtColor(np.asarray(photo.convert("RGB")), cv2.COLOR_RGB2BGR)
    reference = embedding(engine, np.asarray(portrait, dtype=np.uint8))

    for still in index["stills"]:
        vectors = {
            pose: embedding(engine, decode_jpeg((out / name).read_bytes()))
            for pose, name in still["poses"].items()
        }
        to_id = float(vectors["center"] @ reference)
        sides = {pose: float(vectors[pose] @ vectors["center"]) for pose in ("left", "right")}
        print(f"\n{still['name']}: centre vs ID portrait {to_id:.4f}; side vs centre {sides}")
        assert (to_id >= FACE_MATCH_THRESHOLD) is (still["person"] == "A")
        assert all(cosine >= MIN_SIDE_IDENTITY_COSINE for cosine in sides.values())


# --- the spoofs and composites --------------------------------------------------------------------


def test_every_spoof_and_composite_keeps_a_face_for_the_pipeline(
    selfie_set: tuple[Path, dict[str, Any]], detector: FaceDetector
) -> None:
    out, index = selfie_set
    engine = FaceEngine(detector, _NoRecognizer())

    scores: dict[str, float] = {}
    for entry in [*index["spoofs"], *index["composites"]]:
        for pose, name in entry["poses"].items():
            faces = engine.find_faces(decode_jpeg((out / name).read_bytes()))
            assert faces, f"no face on {name}"
            scores[f"{entry['name']}/{pose}"] = round(faces[0].score, 3)
    print(f"\nYuNet scores of the spoofs and composites: {scores}")


def test_the_model_kit_finds_no_landmarks_on_a_blank_frame(constants: CaptureConstants) -> None:
    kit = ModelKit.from_models(MODELS, preview_width=constants.preview_width_px)
    blank = np.full((constants.height, constants.width, 3), 128, dtype=np.uint8)

    assert kit.landmarks(blank) is None
    assert set(kit.readings(blank).values()) == {None}


# --- the calibration and benchmark tools on the real set ------------------------------------------


def test_the_provisional_distributions_of_the_real_set(
    selfie_set: tuple[Path, dict[str, Any]],
) -> None:
    out, _ = selfie_set
    settings = Settings.model_validate({"service_token": "r" * 40, "models_dir": str(MODELS)})

    with app_analyser(settings) as analyse:
        found = provisional(out / "selfie", analyse)

    print(f"\nprovisional distributions on the synthetic set: {found}")
    assert "center_yaw_ratio" in found
    assert all(math.isfinite(value) for values in found.values() for value in values)


def test_the_benchmark_runs_on_the_real_models(tmp_path: Path) -> None:
    out = tmp_path / "benchmark.json"

    assert benchmark(["--runs", "1", "--long-side", "640", "--json", str(out)]) == 0

    numbers = json.loads(out.read_text(encoding="utf-8"))
    assert numbers["size"] == [640, 480]
    assert numbers["median_s"] > 0
