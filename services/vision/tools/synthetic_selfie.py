"""The C45.2 selfie fixture set: what ``make_synthetic_fixtures.py`` writes into ``selfie/``.

**Pipeline fixtures, not attack-detection rates** (the index says so too). From person A's photo
(who matches the ID portrait) and person B's (who does not), both public-domain:

- ``head-turn-<a|b>.mjpeg``: the head-turn clips of :mod:`head_turn` (Chromium fake cameras);
- ``head-turn-<a|b>-<pose>.jpg``: still triples of the same renders, for unit tests and the
  sandbox upload fallback;
- ``static-replay-a.mjpeg``: person A's centre still, drifting but never turning;
- ``<spoof>-a-<pose>.jpg``: the spoofs of :mod:`selfie_spoofs` on person A's renders;
- ``covering-<item>-a-<pose>.jpg`` and ``glasses-<clear|dark>-a-<pose>.jpg``: the composites of
  :mod:`selfie_composites` on person A's renders;
- ``index.json``: every file and what it shows: the constants file and its digest, each clip's
  timeline, framing, centre yaw and YuNet readings per pose and measurement path, each spoof's
  recipe and seed. No landmark, box or embedding is written.

Deterministic: the same photos, models and constants give the same bytes.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from head_turn import (
    POSES,
    CaptureConstants,
    Frame,
    HeadTurnPlan,
    Pose,
    Segment,
    SelfieKit,
    clip_jpegs,
    encode_jpeg,
    plan_head_turn,
    static_replay_jpegs,
    write_mjpeg,
)
from selfie_composites import COVERINGS, cover, glasses
from selfie_spoofs import RECIPES, SPOOFS

SELFIE_DIR: Final = "selfie"
INDEX_FILE: Final = "index.json"
LABEL: Final = "pipeline fixtures, not attack-detection rates"
CONSTANTS_FILE: Final = "contracts/fixtures/flow/selfie-capture.json"
STILL_JPEG_QUALITY: Final = 92
"""The stills, spoofs and composites: the quality of every other generated JPEG."""

SPOOF_SEEDS: Final = {
    "screen_replay": 4100,
    "phone_bezel": 4200,
    "phone_full_frame": 4300,
    "print_halftone": 4400,
}
"""Each spoof's seed for the centre; the left and right poses take the next two."""

COVERING_SEED: Final = 4500
READING_DECIMALS: Final = 4


class FixtureError(Exception):
    """A render lost the face a composite is drawn along."""


@dataclass(frozen=True, slots=True)
class Source:
    """A public-domain portrait the set is rendered from."""

    name: str
    """Its ``fixtures/manifest.json`` entry."""
    person: str
    photo: Frame
    """BGR, upright."""
    face_box: tuple[int, int, int, int]


def _readings(plan: HeadTurnPlan) -> dict[str, dict[str, float | None]]:
    return {
        pose: {
            path: None if value is None else round(value, READING_DECIMALS)
            for path, value in plan.readings[pose].items()
        }
        for pose in POSES
    }


def _segment(segment: Segment) -> dict[str, Any]:
    if segment.kind == "hold":
        return {
            "kind": "hold",
            "pose": segment.pose,
            "first_frame": segment.first_frame,
            "frames": segment.frames,
            "yaw_deg": segment.yaws[0],
        }
    return {
        "kind": "turn",
        "from": segment.pose,
        "to": segment.to,
        "first_frame": segment.first_frame,
        "frames": segment.frames,
    }


def _clip(
    name: str, kind: str, source: Source, frames: int, constants: CaptureConstants
) -> dict[str, Any]:
    return {
        "name": name,
        "kind": kind,
        "person": source.person,
        "source": source.name,
        "file": f"{SELFIE_DIR}/{name}.mjpeg",
        "format": "mjpeg",
        "width": constants.width,
        "height": constants.height,
        "frame_rate": constants.frame_rate,
        "frames": frames,
        "period_seconds": frames / constants.frame_rate,
    }


class _Writer:
    """Writes the set's files and remembers them."""

    def __init__(self, out: Path) -> None:
        self.out = out
        self.written: list[Path] = []

    def jpeg(self, name: str, frame: Frame) -> str:
        relative = f"{SELFIE_DIR}/{name}"
        path = self.out / relative
        path.write_bytes(encode_jpeg(frame, STILL_JPEG_QUALITY))
        self.written.append(path)
        return relative

    def mjpeg(self, name: str, jpegs: list[bytes]) -> None:
        path = self.out / SELFIE_DIR / f"{name}.mjpeg"
        write_mjpeg(path, jpegs)
        self.written.append(path)

    def poses(self, stem: str, frames: dict[Pose, Frame]) -> dict[str, str]:
        return {pose: self.jpeg(f"{stem}-{pose}.jpg", frames[pose]) for pose in POSES}


def _head_turn(
    source: Source, kit: SelfieKit, constants: CaptureConstants, writer: _Writer
) -> tuple[HeadTurnPlan, dict[str, Any], dict[str, Any]]:
    plan = plan_head_turn(source.photo, source.face_box, kit, constants)
    name = f"head-turn-{source.person.lower()}"
    jpegs, segments = clip_jpegs(plan, kit, constants)
    writer.mjpeg(name, jpegs)
    clip = {
        **_clip(name, "head_turn", source, len(jpegs), constants),
        "framing": {"face_height": plan.framing.face_height, "face_top": plan.framing.face_top},
        "center_yaw_deg": plan.center_yaw,
        "target_yaw_deg": plan.target_yaw,
        "triggers": {"center": constants.center_trigger, "side": constants.side_trigger},
        "readings": _readings(plan),
        "segments": [_segment(segment) for segment in segments],
    }
    still = {
        "name": name,
        "person": source.person,
        "source": source.name,
        "poses": writer.poses(name, dict(plan.poses)),
    }
    return plan, clip, still


def _landmarks_of(kit: SelfieKit, frames: dict[Pose, Frame]) -> dict[Pose, Any]:
    found: dict[Pose, Any] = {}
    for pose, frame in frames.items():
        landmarks = kit.landmarks(frame)
        if landmarks is None:
            raise FixtureError(f"YuNet finds no face on the {pose} render to draw along")
        found[pose] = landmarks
    return found


def _composites(
    person: Source, frames: dict[Pose, Frame], kit: SelfieKit, writer: _Writer
) -> list[dict[str, Any]]:
    landmarks = _landmarks_of(kit, frames)
    suffix = person.person.lower()
    entries: list[dict[str, Any]] = []
    for item in COVERINGS:
        name = f"covering-{item}-{suffix}"
        drawn = {
            pose: cover(frames[pose], landmarks[pose], item, COVERING_SEED + index)
            for index, pose in enumerate(POSES)
        }
        entries.append(
            {"name": name, "kind": "covering", "item": item, "person": person.person,
             "poses": writer.poses(name, drawn)}
        )  # fmt: skip
    for dark in (False, True):
        lens = "dark" if dark else "clear"
        name = f"glasses-{lens}-{suffix}"
        worn = {pose: glasses(frames[pose], landmarks[pose], dark=dark) for pose in POSES}
        entries.append(
            {"name": name, "kind": "glasses", "item": lens, "person": person.person,
             "poses": writer.poses(name, worn)}
        )  # fmt: skip
    return entries


def generate_selfie_set(
    people: tuple[Source, Source], kit: SelfieKit, constants: CaptureConstants, out: Path
) -> tuple[list[Path], dict[str, Any]]:
    """Write the set into ``out / SELFIE_DIR`` from person A (who matches the ID) and person B.

    Returns every path written (the index last) and the index. Raises ``head_turn.ClipError``
    when a clip cannot meet the C40.11 triggers, and :class:`FixtureError` when a render loses the
    face; the directory is then incomplete, and the caller writes no stamp."""
    directory = out / SELFIE_DIR
    shutil.rmtree(directory, ignore_errors=True)
    directory.mkdir(parents=True)
    writer = _Writer(out)
    clips: list[dict[str, Any]] = []
    stills: list[dict[str, Any]] = []
    plans: list[HeadTurnPlan] = []
    for source in people:
        plan, clip, still = _head_turn(source, kit, constants, writer)
        plans.append(plan)
        clips.append(clip)
        stills.append(still)

    person_a, frames = people[0], dict(plans[0].poses)
    suffix = person_a.person.lower()
    replay = static_replay_jpegs(frames["center"], constants)
    writer.mjpeg(f"static-replay-{suffix}", replay)
    clips.append(
        {
            **_clip(f"static-replay-{suffix}", "static_replay", person_a, len(replay), constants),
            "description": "the centre still, drifting up to 1% of the frame, never turning",
        }
    )
    spoofs = []
    for kind, spoof in SPOOFS.items():
        name = f"{kind.replace('_', '-')}-{suffix}"
        seed = SPOOF_SEEDS[kind]
        made = {pose: spoof(frames[pose], seed + index) for index, pose in enumerate(POSES)}
        spoofs.append(
            {"name": name, "kind": kind, "person": person_a.person, "seed": seed,
             "recipe": RECIPES[kind], "poses": writer.poses(name, made)}
        )  # fmt: skip

    index = {
        "label": LABEL,
        "constants": {"file": CONSTANTS_FILE, "sha256": constants.sha256},
        "clips": clips,
        "stills": stills,
        "spoofs": spoofs,
        "composites": _composites(person_a, frames, kit, writer),
    }
    index_path = directory / INDEX_FILE
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return [*writer.written, index_path], index
