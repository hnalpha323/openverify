"""Measure the C40.11 yaw anchor: what YuNet's yaw ratio reads for known rendered turns.

C40.11 sets the server's provisional pose thresholds from a principled anchor, never from the
clip: each public-domain face in ``fixtures/manifest.json`` is re-posed with the canonical mesh
(:mod:`repose`) at known yaws, and YuNet's landmarks are read back with the C41.1 yaw ratio.

- ``min-side-yaw-ratio-change`` is the median change YuNet reports for a 12 degree turn (both
  directions, every face);
- ``max-center-yaw-ratio`` is the median absolute ratio at a 5 degree turn;
- the change at the clip's target yaw (22 degrees) must clear 1.25 x the minimum change for every
  face and direction, so the client's auto-capture trigger is reachable; if it does not, the
  clip's yaw is raised up to 25 degrees (the research limit for 2.5-D re-posing); if even that
  fails, the report says so and nobody lowers the anchor.

Usage (after ``scripts/fetch_models.py`` and ``scripts/fetch_fixtures.py``)::

    uv run python tools/measure_yaw_anchor.py      # prints the JSON report

Rendered faces are pipeline fixtures, not real turns: these numbers anchor provisional
defaults, they do not calibrate them.
"""

from __future__ import annotations

import json
import statistics
import sys
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

from openverify_vision.faces import YUNET_FILENAME, Face, FaceDetector
from openverify_vision.imaging import ImageArray
from openverify_vision.pose import yaw_ratio
from repose import CanonicalMesh, default_mesh_path, load_canonical_mesh, render_reposed

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
FRAME_LONG_SIDE: Final = 640
"""Every portrait is measured as a 640-pixel frame, the C40.11 clip width."""

SIDE_YAW_DEG: Final = 12.0
CENTER_YAW_DEG: Final = 5.0
CLIP_YAW_DEG: Final = 22.0
MAX_CLIP_YAW_DEG: Final = 25.0
CLIP_MARGIN: Final = 1.25
"""The client captures a side pose once the change is 1.25 x the server minimum (C40.11)."""

DECIMALS: Final = 3

Finder = Callable[[ImageArray], list[Face]]
Renderer = Callable[[ImageArray, NDArray[np.float64], float], ImageArray]


@dataclass(frozen=True, slots=True)
class FaceResponse:
    """The yaw ratio YuNet read at each rendered yaw (degrees) of one face."""

    face: str
    ratios: dict[float, float]


@dataclass(frozen=True, slots=True)
class Anchor:
    max_center_yaw_ratio: float
    min_side_yaw_ratio_change: float
    clip_yaw_deg: float
    clip_change_median: float
    clip_change_min: float
    clears_margin: bool


def _largest(faces: Sequence[Face]) -> Face | None:
    return max(faces, key=lambda face: face.area) if faces else None


def measure_face(
    name: str,
    image: ImageArray,
    find: Finder,
    render: Renderer,
    yaws: Sequence[float],
) -> FaceResponse | None:
    """Render ``image`` at each yaw and read the primary face's yaw ratio. ``None`` when the
    source has no face; a yaw whose render loses the face is left out."""
    source = _largest(find(image))
    if source is None:
        return None
    landmarks = np.asarray(source.landmarks, dtype=np.float64)
    ratios: dict[float, float] = {}
    for yaw in yaws:
        found = _largest(find(render(image, landmarks, yaw)))
        ratio = None if found is None else yaw_ratio(found.landmarks)
        if ratio is not None:
            ratios[yaw] = ratio
    return FaceResponse(face=name, ratios=ratios)


def _changes(responses: Sequence[FaceResponse], yaw: float) -> list[float]:
    return [
        abs(response.ratios[sign * yaw] - response.ratios[0.0])
        for response in responses
        for sign in (1.0, -1.0)
        if sign * yaw in response.ratios and 0.0 in response.ratios
    ]


def anchor(responses: Sequence[FaceResponse], clip_yaw: float = CLIP_YAW_DEG) -> Anchor:
    """The C40.11 thresholds from the responses, and whether the clip's yaw clears the margin."""
    centers = [
        abs(response.ratios[sign * CENTER_YAW_DEG])
        for response in responses
        for sign in (1.0, -1.0)
        if sign * CENTER_YAW_DEG in response.ratios
    ]
    sides = _changes(responses, SIDE_YAW_DEG)
    clips = _changes(responses, clip_yaw)
    if not centers or not sides or not clips:
        raise ValueError("no face was measured at every yaw the anchor needs")
    min_change = round(statistics.median(sides), DECIMALS)
    return Anchor(
        max_center_yaw_ratio=round(statistics.median(centers), DECIMALS),
        min_side_yaw_ratio_change=min_change,
        clip_yaw_deg=clip_yaw,
        clip_change_median=round(statistics.median(clips), DECIMALS),
        clip_change_min=round(min(clips), DECIMALS),
        clears_margin=min(clips) >= CLIP_MARGIN * min_change,
    )


def choose_clip_yaw(responses: Sequence[FaceResponse]) -> Anchor:
    """The anchor at the default clip yaw, raised a degree at a time up to 25 degrees if the
    change does not clear 1.25 x the minimum. The last anchor tried is returned either way;
    ``clears_margin`` false is a blocker to report, never a reason to lower the anchor."""
    yaw = CLIP_YAW_DEG
    result = anchor(responses, yaw)
    while not result.clears_margin and yaw < MAX_CLIP_YAW_DEG:
        yaw += 1.0
        result = anchor(responses, yaw)
    return result


def all_yaws() -> list[float]:
    """Every yaw measured: the centre, the anchor turns, and the clip's possible yaws."""
    magnitudes = [CENTER_YAW_DEG, SIDE_YAW_DEG] + [
        CLIP_YAW_DEG + step for step in range(int(MAX_CLIP_YAW_DEG - CLIP_YAW_DEG) + 1)
    ]
    return [0.0] + [sign * value for value in magnitudes for sign in (1.0, -1.0)]


def as_frame(image: ImageArray) -> ImageArray:
    scale = FRAME_LONG_SIDE / max(image.shape[:2])
    return np.asarray(
        cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), dtype=np.uint8
    )


def report(responses: Sequence[FaceResponse]) -> dict[str, object]:
    result = choose_clip_yaw(responses)
    return {
        "anchor": asdict(result),
        "faces": [
            {"face": r.face, "ratios": {f"{yaw:+.0f}": round(v, 4) for yaw, v in r.ratios.items()}}
            for r in responses
        ],
    }


def main(repo_root: Path = REPO_ROOT) -> int:
    models = repo_root / "models"
    manifest = json.loads((repo_root / "fixtures" / "manifest.json").read_text(encoding="utf-8"))
    detector = FaceDetector(models / YUNET_FILENAME)
    mesh: CanonicalMesh = load_canonical_mesh(default_mesh_path(models))

    def render(image: ImageArray, landmarks: NDArray[np.float64], yaw: float) -> ImageArray:
        return render_reposed(image, landmarks, yaw, mesh)

    responses: list[FaceResponse] = []
    for entry in manifest["faces"]:
        image = cv2.imread(str(repo_root / "fixtures" / "faces" / entry["filename"]))
        if image is None:
            raise FileNotFoundError(f"fetch the faces first: {entry['filename']}")
        measured = measure_face(
            entry["filename"],
            as_frame(np.asarray(image, dtype=np.uint8)),
            detector.detect,
            render,
            all_yaws(),
        )
        if measured is not None:
            responses.append(measured)
    print(json.dumps(report(responses), indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through main()
    sys.exit(main())
