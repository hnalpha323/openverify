"""The C40.11 yaw anchor measurement (``tools/measure_yaw_anchor.py``)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray

from measure_yaw_anchor import (
    CLIP_YAW_DEG,
    MAX_CLIP_YAW_DEG,
    FaceResponse,
    all_yaws,
    anchor,
    as_frame,
    choose_clip_yaw,
    main,
    measure_face,
    report,
)
from openverify_vision.faces import YUNET_FILENAME, Face
from openverify_vision.imaging import ImageArray

REPO_ROOT = Path(__file__).resolve().parents[3]


def _linear(face: str, slope: float, bias: float = 0.0) -> FaceResponse:
    """A face whose yaw ratio grows linearly with the rendered yaw."""
    return FaceResponse(face=face, ratios={yaw: bias + slope * yaw for yaw in all_yaws()})


def test_all_yaws_cover_the_centre_the_anchor_turns_and_every_clip_yaw() -> None:
    yaws = all_yaws()
    assert yaws[0] == 0.0
    for magnitude in (5.0, 12.0, 22.0, 23.0, 24.0, 25.0):
        assert magnitude in yaws
        assert -magnitude in yaws


def test_the_anchor_takes_the_medians_the_plan_names() -> None:
    responses = [_linear("a", 0.006, bias=0.01), _linear("b", 0.008), _linear("c", 0.01)]
    result = anchor(responses)
    # |ratio| at +-5: 0.04, 0.02, 0.04, 0.04, 0.05, 0.05 -> median 0.04.
    assert result.max_center_yaw_ratio == pytest.approx(0.04)
    # Change at +-12: 0.072 (x2), 0.096 (x2), 0.12 (x2) -> median 0.096.
    assert result.min_side_yaw_ratio_change == pytest.approx(0.096)
    assert result.clip_yaw_deg == CLIP_YAW_DEG
    assert result.clip_change_min == pytest.approx(0.132)
    assert result.clears_margin


def test_the_clip_yaw_rises_until_the_change_clears_the_margin() -> None:
    # A face that reads little until 24 degrees.
    slow = FaceResponse(
        face="slow",
        ratios={yaw: (0.0035 if abs(yaw) < 24 else 0.0055) * yaw for yaw in all_yaws()},
    )
    responses = [slow, _linear("b", 0.006), _linear("c", 0.007)]
    result = choose_clip_yaw(responses)
    assert result.clip_yaw_deg == 24.0
    assert result.clears_margin


def test_a_clip_that_never_clears_is_reported_not_hidden() -> None:
    flat = FaceResponse(face="flat", ratios={yaw: 0.002 * yaw for yaw in all_yaws()})
    responses = [flat, _linear("b", 0.01), _linear("c", 0.01)]
    result = choose_clip_yaw(responses)
    assert result.clip_yaw_deg == MAX_CLIP_YAW_DEG
    assert not result.clears_margin


def test_the_anchor_needs_every_yaw() -> None:
    with pytest.raises(ValueError, match="every yaw"):
        anchor([FaceResponse(face="a", ratios={0.0: 0.0})])


def _face(ratio: float) -> Face:
    """A face whose five points read ``ratio`` (eyes 40 px apart, level)."""
    return Face(
        box=(80.0, 80.0, 80.0, 100.0),
        landmarks=(
            (100.0, 100.0),
            (140.0, 100.0),
            (120.0 + 40.0 * ratio, 120.0),
            (105.0, 140.0),
            (135.0, 140.0),
        ),
        score=0.9,
    )


def test_measure_face_reads_the_ratio_of_each_rendered_yaw() -> None:
    image = np.zeros((10, 10, 3), dtype=np.uint8)
    rendered: list[float] = []

    def render(img: ImageArray, landmarks: NDArray[np.float64], yaw: float) -> ImageArray:
        assert landmarks.shape == (5, 2)
        rendered.append(yaw)
        return np.full((10, 10, 3), int(yaw) + 100, dtype=np.uint8)

    def find(img: ImageArray) -> list[Face]:
        if not img.any():
            return [_face(0.0)]
        yaw = int(img[0, 0, 0]) - 100
        return [] if yaw == 7 else [_face(yaw / 100)]

    result = measure_face("x", image, find, render, [0.0, 5.0, 7.0, -5.0])
    assert result is not None
    assert rendered == [0.0, 5.0, 7.0, -5.0]
    assert result.ratios == pytest.approx({0.0: 0.0, 5.0: 0.05, -5.0: -0.05})


def test_measure_face_skips_a_portrait_without_a_face() -> None:
    image = np.zeros((10, 10, 3), dtype=np.uint8)
    assert measure_face("x", image, lambda _img: [], lambda img, _l, _y: img, [0.0]) is None


def test_as_frame_scales_the_long_side_to_640() -> None:
    frame = as_frame(np.zeros((1000, 800, 3), dtype=np.uint8))
    assert frame.shape == (640, 512, 3)


def test_the_report_names_the_anchor_and_every_face() -> None:
    result = report([_linear("a", 0.006), _linear("b", 0.008), _linear("c", 0.01)])
    assert set(result) == {"anchor", "faces"}
    assert json.loads(json.dumps(result))["faces"][0]["face"] == "a"


def test_main_needs_the_fetched_faces(tmp_path: Path) -> None:
    (tmp_path / "fixtures").mkdir()
    (tmp_path / "models").mkdir()
    (tmp_path / "fixtures" / "manifest.json").write_text(
        json.dumps({"faces": [{"filename": "missing.jpg"}]}), encoding="utf-8"
    )
    (tmp_path / "models" / "canonical_face_model.obj").write_text(
        "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", encoding="utf-8"
    )
    with pytest.raises(FileNotFoundError, match="fetch the faces"):
        main(tmp_path)


@pytest.mark.skipif(
    not (REPO_ROOT / "models" / YUNET_FILENAME).is_file()
    or not (REPO_ROOT / "models" / "canonical_face_model.obj").is_file()
    or not (REPO_ROOT / "fixtures" / "faces").is_dir(),
    reason="fetch the models and faces: python3 scripts/fetch_models.py; scripts/fetch_fixtures.py",
)
def test_main_measures_the_public_domain_faces(capsys: pytest.CaptureFixture[str]) -> None:
    assert main() == 0
    measured = json.loads(capsys.readouterr().out)
    assert len(measured["faces"]) == 3
    assert measured["anchor"]["min_side_yaw_ratio_change"] > 0
