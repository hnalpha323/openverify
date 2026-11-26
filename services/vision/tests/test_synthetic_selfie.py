"""tools/synthetic_selfie.py: the C45.2 selfie fixture set and its index.

With :class:`selfie_fakes.MarkerKit` and synthetic "photos", so no model or real face is needed:
this checks what is written and what the index says. ``test_selfie_fixtures_real.py`` checks the
real set with YuNet and SFace.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest

from head_turn import CaptureConstants, load_capture_constants, split_mjpeg
from selfie_fakes import MarkerKit, textured
from synthetic_selfie import (
    INDEX_FILE,
    LABEL,
    SELFIE_DIR,
    FixtureError,
    Source,
    generate_selfie_set,
)

FACE_BOX = (500, 300, 200, 260)
POSES = ("center", "left", "right")


@pytest.fixture(scope="module")
def constants() -> CaptureConstants:
    return load_capture_constants()


@pytest.fixture(scope="module")
def generated(
    tmp_path_factory: pytest.TempPathFactory, constants: CaptureConstants
) -> tuple[Path, list[Path], dict[str, Any]]:
    out = tmp_path_factory.mktemp("generated")
    people = (
        Source("a_selfie", "A", textured((1600, 2000), seed=1), FACE_BOX),
        Source("b_selfie", "B", textured((1600, 2000), seed=2), FACE_BOX),
    )
    written, index = generate_selfie_set(people, MarkerKit(), constants, out)
    return out, written, index


def entries(index: dict[str, Any]) -> Iterator[dict[str, Any]]:
    for group in ("clips", "stills", "spoofs", "composites"):
        yield from index[group]


def files_of(entry: dict[str, Any]) -> list[str]:
    return [entry["file"]] if "file" in entry else list(entry["poses"].values())


def walk(value: object) -> Iterator[tuple[str, object]]:
    if isinstance(value, dict):
        for key, item in value.items():
            yield key, item
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)


def test_the_index_is_written_beside_the_files_and_labels_them(
    generated: tuple[Path, list[Path], dict[str, Any]], constants: CaptureConstants
) -> None:
    out, written, index = generated

    on_disk = json.loads((out / SELFIE_DIR / INDEX_FILE).read_text(encoding="utf-8"))
    assert on_disk == index
    assert index["label"] == LABEL == "pipeline fixtures, not attack-detection rates"
    assert index["constants"] == {
        "file": "contracts/fixtures/flow/selfie-capture.json",
        "sha256": constants.sha256,
    }
    assert out / SELFIE_DIR / INDEX_FILE in written


def test_every_listed_file_is_written_and_nothing_else(
    generated: tuple[Path, list[Path], dict[str, Any]],
) -> None:
    out, written, index = generated

    listed = {name for entry in entries(index) for name in files_of(entry)}
    assert all(name.startswith(f"{SELFIE_DIR}/") for name in listed)
    on_disk = {str(p.relative_to(out)) for p in (out / SELFIE_DIR).iterdir()}
    assert on_disk == listed | {f"{SELFIE_DIR}/{INDEX_FILE}"}
    assert {str(p.relative_to(out)) for p in written} == on_disk


def test_the_clips_are_both_head_turns_and_the_static_replay(
    generated: tuple[Path, list[Path], dict[str, Any]], constants: CaptureConstants
) -> None:
    out, _, index = generated
    clips = {clip["name"]: clip for clip in index["clips"]}

    assert set(clips) == {"head-turn-a", "head-turn-b", "static-replay-a"}
    assert clips["head-turn-a"]["person"] == "A"
    assert clips["head-turn-b"]["person"] == "B"
    for clip in clips.values():
        assert clip["format"] == "mjpeg"
        assert clip["file"].endswith(".mjpeg")
        assert (clip["width"], clip["height"]) == constants.size
        assert clip["frame_rate"] == constants.frame_rate
        jpegs = split_mjpeg((out / clip["file"]).read_bytes())
        assert len(jpegs) == clip["frames"]
        assert clip["period_seconds"] == pytest.approx(clip["frames"] / constants.frame_rate)
        assert clip["period_seconds"] <= constants.max_period_seconds


def test_a_head_turn_entry_records_its_timeline_choice_and_readings(
    generated: tuple[Path, list[Path], dict[str, Any]], constants: CaptureConstants
) -> None:
    _, _, index = generated
    clip = next(c for c in index["clips"] if c["name"] == "head-turn-a")

    assert clip["kind"] == "head_turn"
    assert clip["framing"] == {"face_height": 0.3, "face_top": 0.3}
    assert clip["center_yaw_deg"] == 0.0
    assert clip["target_yaw_deg"] == constants.target_yaw_deg
    holds = [s for s in clip["segments"] if s["kind"] == "hold"]
    assert [hold["pose"] for hold in holds] == list(constants.cycle)
    assert sum(s["frames"] for s in clip["segments"]) == clip["frames"]
    assert {hold["pose"]: hold["yaw_deg"] for hold in holds} == {
        "center": 0.0,
        "left": constants.target_yaw_deg,
        "right": -constants.target_yaw_deg,
    }
    assert set(clip["readings"]) == set(POSES)
    assert clip["readings"]["left"]["server@640"] == pytest.approx(0.006 * 24)
    assert clip["triggers"] == {
        "center": pytest.approx(constants.center_trigger),
        "side": pytest.approx(constants.side_trigger),
    }


def test_the_still_triples_are_frame_sized_jpegs(
    generated: tuple[Path, list[Path], dict[str, Any]],
) -> None:
    out, _, index = generated

    assert [still["name"] for still in index["stills"]] == ["head-turn-a", "head-turn-b"]
    for still in index["stills"]:
        assert tuple(still["poses"]) == POSES
        for name in still["poses"].values():
            image = cv2.imread(str(out / name))
            assert image is not None
            assert image.shape == (480, 640, 3)


def test_the_spoofs_and_composites_cover_the_plans_list(
    generated: tuple[Path, list[Path], dict[str, Any]],
) -> None:
    _, _, index = generated

    spoofs = {spoof["kind"]: spoof for spoof in index["spoofs"]}
    assert set(spoofs) == {"screen_replay", "phone_bezel", "phone_full_frame", "print_halftone"}
    for spoof in spoofs.values():
        assert spoof["person"] == "A"
        assert spoof["recipe"]
        assert tuple(spoof["poses"]) == POSES
        assert isinstance(spoof["seed"], int)
    composites = {(c["kind"], c["item"]) for c in index["composites"]}
    assert composites == {
        ("covering", "mask"),
        ("covering", "scarf"),
        ("covering", "hand"),
        ("glasses", "clear"),
        ("glasses", "dark"),
    }


def test_no_landmark_or_embedding_is_written(
    generated: tuple[Path, list[Path], dict[str, Any]],
) -> None:
    _, _, index = generated

    keys = {key for key, _ in walk(index)}
    assert not keys & {"landmarks", "embedding", "face_box", "box"}


class LosesTurnedFaces(MarkerKit):
    """Finds the face on the portrait but on no rendered (turned) frame."""

    def landmarks(self, frame: np.ndarray) -> np.ndarray | None:
        return None if MarkerKit.yaw_of(frame) else super().landmarks(frame)


def test_a_render_that_loses_the_face_stops_the_set(
    tmp_path: Path, constants: CaptureConstants
) -> None:
    people = (
        Source("a_selfie", "A", textured((1600, 2000), seed=1), FACE_BOX),
        Source("b_selfie", "B", textured((1600, 2000), seed=2), FACE_BOX),
    )

    with pytest.raises(FixtureError, match="no face on the left render"):
        generate_selfie_set(people, LosesTurnedFaces(), constants, tmp_path)

    assert not (tmp_path / SELFIE_DIR / INDEX_FILE).exists()
