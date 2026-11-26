"""tools/head_turn.py: the C45.2 head-turn clips, from the C40.11 shared constants.

The clip is MJPEG at the constants' size and frame rate, cycles centre -> left -> centre -> right
from the centre, holds each extreme at least ``min-hold-seconds``, and fits in the period. Its
framing and centre yaw are chosen so that YuNet reads the centre within the client's centre
trigger and each extreme beyond the side trigger (plan amendment 2); the triggers never move.

These tests use :class:`selfie_fakes.MarkerKit` (no model); ``test_selfie_fixtures_real.py``
checks the real clips with YuNet.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from head_turn import (
    CLIP_JPEG_QUALITY,
    CONSTANTS_PATH,
    CaptureConstants,
    ClipError,
    Framing,
    ModelKit,
    Pose,
    base_frame,
    browser_upload,
    clip_jpegs,
    clip_timeline,
    decode_jpeg,
    encode_jpeg,
    load_capture_constants,
    plan_head_turn,
    read_mjpeg,
    split_mjpeg,
    static_replay_jpegs,
    write_mjpeg,
)
from openverify_vision.faces import ModelNotAvailableError
from selfie_fakes import MarkerKit, textured

RAW: dict[str, Any] = json.loads(CONSTANTS_PATH.read_text(encoding="utf-8"))
FACE_BOX = (500, 300, 200, 260)


@pytest.fixture(scope="module")
def constants() -> CaptureConstants:
    return load_capture_constants()


def photo(width: int = 1600, height: int = 2000) -> np.ndarray:
    return textured((width, height), seed=11)


# --- the shared constants (C40.11) ----------------------------------------------------------------


def test_the_constants_are_read_from_the_shared_file(constants: CaptureConstants) -> None:
    clip, client, server = RAW["clip"], RAW["client"], RAW["server"]

    assert constants.size == (clip["width"], clip["height"]) == (640, 480)
    assert constants.frame_rate == clip["frame-rate"] == 30
    assert list(constants.cycle) == clip["cycle"] == ["center", "left", "center", "right"]
    assert constants.starts_at == clip["starts-at"] == "center"
    assert constants.min_hold_seconds == clip["min-hold-seconds"]
    assert constants.target_yaw_deg == clip["target-yaw-deg"]
    assert constants.max_period_seconds == clip["max-period-seconds"]
    assert constants.max_center_yaw_ratio == server["max-center-yaw-ratio"]
    assert constants.min_side_yaw_ratio_change == server["min-side-yaw-ratio-change"]
    assert constants.preview_width_px == client["preview-width-px"]
    assert constants.sha256 == hashlib.sha256(CONSTANTS_PATH.read_bytes()).hexdigest()


def test_the_triggers_are_the_clients(constants: CaptureConstants) -> None:
    client, server = RAW["client"], RAW["server"]

    assert constants.center_trigger == pytest.approx(
        client["center-trigger-factor"] * server["max-center-yaw-ratio"]
    )
    assert constants.side_trigger == pytest.approx(
        client["side-trigger-factor"] * server["min-side-yaw-ratio-change"]
    )


def edited(tmp_path: Path, section: str, key: str, value: Any) -> Path:
    document = json.loads(CONSTANTS_PATH.read_text(encoding="utf-8"))
    document[section][key] = value
    path = tmp_path / "selfie-capture.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


@pytest.mark.parametrize(
    ("section", "key", "value", "message"),
    [
        ("clip", "format", "y4m", "mjpeg"),
        ("clip", "cycle", ["left", "center", "right"], "starts"),
        ("clip", "cycle", ["center", "up"], "pose"),
        ("clip", "frame-rate", 15, "30"),
        ("clip", "width", 641, "even"),
    ],
)
def test_constants_the_clip_cannot_follow_are_refused(
    tmp_path: Path, section: str, key: str, value: Any, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        load_capture_constants(edited(tmp_path, section, key, value))


# --- the timeline ---------------------------------------------------------------------------------


YAWS: dict[Pose, float] = {"center": 0.0, "left": 24.0, "right": -24.0}


def test_the_timeline_cycles_through_the_poses_from_the_centre(constants: CaptureConstants) -> None:
    segments = clip_timeline(constants, YAWS)

    holds = [segment for segment in segments if segment.kind == "hold"]
    assert [hold.pose for hold in holds] == list(constants.cycle)
    assert segments[0].kind == "hold"
    assert segments[0].pose == constants.starts_at
    assert segments[0].first_frame == 0
    assert [segment.kind for segment in segments] == ["hold", "turn"] * len(constants.cycle)
    for current, following in itertools.pairwise(segments):
        assert following.first_frame == current.first_frame + current.frames
    last = segments[-1]
    assert (last.pose, last.to) == ("right", "center")  # the loop closes on the first frame


def test_each_extreme_is_held_at_least_the_minimum_and_the_period_fits(
    constants: CaptureConstants,
) -> None:
    segments = clip_timeline(constants, YAWS)

    minimum = math.ceil(constants.min_hold_seconds * constants.frame_rate)
    for hold in (s for s in segments if s.kind == "hold"):
        assert set(hold.yaws) == {YAWS[hold.pose]}
        if hold.pose != "center":
            assert hold.frames >= minimum
    total = sum(segment.frames for segment in segments)
    assert total <= constants.max_period_seconds * constants.frame_rate


def test_a_turn_moves_monotonically_between_its_poses(constants: CaptureConstants) -> None:
    for turn in (s for s in clip_timeline(constants, YAWS) if s.kind == "turn"):
        start, end = YAWS[turn.pose], YAWS[turn.to]
        steps = [start, *turn.yaws, end]
        assert turn.frames >= 2
        assert all((b - a) * (end - start) > 0 for a, b in itertools.pairwise(steps))


def test_a_period_longer_than_the_maximum_is_refused(tmp_path: Path) -> None:
    short = load_capture_constants(edited(tmp_path, "clip", "max-period-seconds", 4))

    with pytest.raises(ValueError, match="period"):
        clip_timeline(short, YAWS)


# --- MJPEG ----------------------------------------------------------------------------------------


def test_mjpeg_is_a_plain_concatenation_of_jpegs(tmp_path: Path) -> None:
    frames = [textured(seed=seed) for seed in (1, 2, 3)]
    jpegs = [encode_jpeg(frame, CLIP_JPEG_QUALITY) for frame in frames]
    path = tmp_path / "clip.mjpeg"

    write_mjpeg(path, jpegs)

    data = path.read_bytes()
    assert data == b"".join(jpegs)
    assert split_mjpeg(data) == jpegs
    assert all(jpeg[:2] == b"\xff\xd8" and jpeg[-2:] == b"\xff\xd9" for jpeg in jpegs)
    decoded = read_mjpeg(path)
    assert [frame.shape for frame in decoded] == [(480, 640, 3)] * 3
    assert np.abs(decoded[1].astype(int) - frames[1].astype(int)).mean() < 3


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"not a jpeg",
        b"\xff\xd8\xff\xe0\x00\x10JFIF",
        b"\xff\xd8\xff\xda\x00\x02abc",
        b"\xff\xd8\x00\x01\x02",
        b"\xff\xd8\xff\xe0\x00",
    ],
    ids=["empty", "garbage", "truncated header", "no end", "no marker", "cut in a marker"],
)
def test_a_broken_mjpeg_is_refused(data: bytes) -> None:
    with pytest.raises(ValueError, match="MJPEG"):
        split_mjpeg(data)


def test_decode_refuses_bytes_that_are_not_an_image() -> None:
    with pytest.raises(ValueError, match="JPEG"):
        decode_jpeg(b"\xff\xd8 nope")


def test_the_browser_upload_is_the_frame_after_i420_and_a_jpeg() -> None:
    frame = textured(seed=5)

    upload = browser_upload(frame)

    assert upload.shape == frame.shape
    assert not np.array_equal(upload, frame)
    mse = float(np.mean((upload.astype(np.float64) - frame.astype(np.float64)) ** 2))
    assert 10 * math.log10(255**2 / mse) > 30


# --- framing --------------------------------------------------------------------------------------


def test_the_base_frame_gives_the_face_its_share_of_the_height() -> None:
    frame = base_frame(photo(), FACE_BOX, Framing(face_height=0.3, face_top=0.3), (640, 480))

    assert frame.shape == (480, 640, 3)
    assert frame.dtype == np.uint8


def test_a_narrow_photo_limits_the_crop_instead_of_padding() -> None:
    narrow = photo(width=700, height=2000)

    frame = base_frame(narrow, (250, 300, 200, 260), Framing(0.3, 0.3), (640, 480))

    assert frame.shape == (480, 640, 3)


# --- choosing the framing and the centre yaw ------------------------------------------------------


def test_the_unmodified_portrait_is_the_centre_when_it_reads_frontal(
    constants: CaptureConstants,
) -> None:
    kit = MarkerKit(slope=0.006)

    plan = plan_head_turn(photo(), FACE_BOX, kit, constants)

    assert plan.framing == Framing(face_height=0.30, face_top=0.3)
    assert plan.center_yaw == 0.0
    assert np.array_equal(plan.poses["center"], plan.base)
    assert plan.pose_yaw("left") == constants.target_yaw_deg
    assert plan.pose_yaw("right") == -constants.target_yaw_deg
    assert MarkerKit.yaw_of(plan.poses["left"]) == constants.target_yaw_deg
    assert set(plan.readings) == {"center", "left", "right"}
    assert plan.readings["left"]["server@640"] == pytest.approx(0.006 * 24)


def test_a_portrait_that_reads_off_centre_is_turned_to_read_frontal(
    constants: CaptureConstants,
) -> None:
    # Reads 0.03 unmodified, above the 0.0168 centre trigger: -3 degrees reads 0.012.
    plan = plan_head_turn(photo(), FACE_BOX, MarkerKit(slope=0.006, bias=0.03), constants)

    assert plan.center_yaw == -3.0
    assert MarkerKit.yaw_of(plan.poses["center"]) == -3.0
    reading = plan.readings["center"]["client@320"]
    assert reading is not None
    assert abs(reading) <= constants.center_trigger


def test_a_framing_without_a_face_is_skipped(constants: CaptureConstants) -> None:
    plan = plan_head_turn(photo(), FACE_BOX, MarkerKit(faceless_calls=1), constants)

    assert plan.framing.face_height == 0.28


def test_a_clip_that_cannot_clear_the_triggers_is_a_reported_error(
    constants: CaptureConstants,
) -> None:
    with pytest.raises(ClipError, match="side trigger") as raised:
        plan_head_turn(photo(), FACE_BOX, MarkerKit(slope=0.001), constants)

    message = str(raised.value)
    assert "0.024" in message  # the change it read at 24 degrees, for the blocker report
    assert "0.096" in message  # 1.25 x the server minimum


# --- the clip -------------------------------------------------------------------------------------


def test_the_clip_has_one_jpeg_per_frame_and_holds_repeat_one_render(
    constants: CaptureConstants,
) -> None:
    kit = MarkerKit()
    plan = plan_head_turn(photo(), FACE_BOX, kit, constants)

    jpegs, segments = clip_jpegs(plan, kit, constants)

    assert len(jpegs) == sum(segment.frames for segment in segments)
    for segment in segments:
        frames = jpegs[segment.first_frame : segment.first_frame + segment.frames]
        if segment.kind == "hold":
            assert len(set(frames)) == 1
        else:
            assert len(set(frames)) == segment.frames
    assert decode_jpeg(jpegs[0]).shape == (480, 640, 3)


def test_the_clip_renders_each_yaw_once(constants: CaptureConstants) -> None:
    kit = MarkerKit()
    plan = plan_head_turn(photo(), FACE_BOX, kit, constants)
    kit.rendered.clear()

    _, segments = clip_jpegs(plan, kit, constants)

    # A turn and its way back pass the same yaws: those share their renders.
    turns = {yaw for segment in segments if segment.kind == "turn" for yaw in segment.yaws}
    assert len(kit.rendered) == len(set(kit.rendered)) == len(turns)
    assert len(turns) == sum(s.frames for s in segments if s.kind == "turn") // 2


def test_the_static_replay_drifts_a_still_and_loops(constants: CaptureConstants) -> None:
    still = textured(seed=9)

    jpegs = static_replay_jpegs(still, constants)

    assert len(jpegs) == 4 * constants.frame_rate
    frames = [decode_jpeg(jpeg) for jpeg in jpegs]
    assert all(frame.shape == (480, 640, 3) for frame in frames)
    assert len(set(jpegs)) > len(jpegs) // 2
    loop_gap = np.abs(frames[-1].astype(int) - frames[0].astype(int)).mean()
    # A quarter of the loop is the widest sway.
    widest = np.abs(frames[len(frames) // 4].astype(int) - frames[0].astype(int)).mean()
    assert loop_gap < widest / 2


# --- the model kit --------------------------------------------------------------------------------


def test_the_model_kit_needs_the_fetched_models(tmp_path: Path) -> None:
    with pytest.raises(ModelNotAvailableError, match=r"fetch_models\.py"):
        ModelKit.from_models(tmp_path, preview_width=320)
