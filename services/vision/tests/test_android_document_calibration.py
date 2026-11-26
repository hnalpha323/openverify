"""C202.2: ``contracts/fixtures/flow/document-capture.json``, the Android SDK's document capture
constants, read by Python through ``tools/android_document_guidance.py`` (this test) and by Kotlin
(``DocumentCaptureConstantsTest``), and calibrated on synthetic renders only.

The thresholds come from the calibration rule (``RULE``), fixed before any frame was measured, run
over the seeded synthetic frames; this test re-runs it and checks that each committed threshold is
still what the rule gives (within 1%, so a different CPU's floating-point path cannot fail it) and
still separates the groups the report says it does. It never tunes a threshold: a change is made
only by ``android_document_guidance.py --write`` from the rule.
"""

from __future__ import annotations

import json
from typing import Any, Final

import numpy as np
import pytest

from android_document_guidance import (
    DOCUMENT_CAPTURE,
    FRAME_SIZE,
    GATES,
    REPORT,
    calibration_scenes,
    guide_in_frame,
    hint_of,
    measure_scene,
    read_client_constants,
    run,
    shrunk_guide,
    three_figures,
)

REQUIRED: Final = {
    "hold-ms",
    "guidance-hz",
    "analysis-width-px",
    "barcode-analysis-width-px",
    "manual-shutter-after-ms",
    "sharpness-laplacian-variance-min",
    "sharpness-tenengrad-min",
    "glare-share-max",
    "brightness-mean-min",
    "brightness-mean-max",
    "framing-edge-ratio-min",
    "mrz-band-edge-density-min",
}


@pytest.fixture(scope="module")
def committed() -> dict[str, Any]:
    document: dict[str, Any] = json.loads(DOCUMENT_CAPTURE.read_text(encoding="utf-8"))
    return document


@pytest.fixture(scope="module")
def calibrated() -> tuple[dict[str, Any], dict[str, Any], str]:
    return run()


def test_python_reads_the_constants_from_the_shared_file(committed: dict[str, Any]) -> None:
    client = read_client_constants()
    assert client == {key: float(value) for key, value in committed["client"].items()}
    assert set(client) == REQUIRED
    assert client["manual-shutter-after-ms"] == 10_000
    assert client["guidance-hz"] == 8
    assert committed["calibration"] == {
        "report": "docs/calibration/android-document-guidance.md",
        "covers": "synthetic renders only",
    }
    assert set(committed["basis"]) == REQUIRED


def test_each_threshold_is_what_the_rule_gives(
    committed: dict[str, Any], calibrated: tuple[dict[str, Any], dict[str, Any], str]
) -> None:
    document, _, _ = calibrated
    for key, value in document["client"].items():
        assert committed["client"][key] == pytest.approx(value, rel=0.01), key


def test_each_separable_threshold_separates_its_groups(
    committed: dict[str, Any], calibrated: tuple[dict[str, Any], dict[str, Any], str]
) -> None:
    _, calibration, _ = calibrated
    client = committed["client"]
    for gate in GATES:
        result = calibration[gate.key]
        if not result["separable"]:
            continue
        good, broken = result["good"], result["broken"]
        if gate.minimum:
            assert broken["max"] < client[gate.key] <= good["min"], gate.key
        else:
            assert good["max"] <= client[gate.key] < broken["min"], gate.key


def test_good_frames_get_no_hint_and_each_broken_group_its_own(
    committed: dict[str, Any],
) -> None:
    """A passport page whose band is covered is never taken (``none`` never holds), whichever hint
    comes first: covering a third of the page also lowers the crop's sharpness, so the report shows
    most of those frames asked to hold still before the band hint (the order is fixed, C202.3)."""
    client = {key: float(value) for key, value in committed["client"].items()}
    scenes = calibration_scenes(
        {"good": 6, "dark": 3, "small": 3, "glare": 3, "mrz-hidden": 2, "bright": 3}
    )
    hints = {
        scene.name: hint_of(measure_scene(scene), client, passport=scene.document == "passport")
        for scene in scenes
    }
    expected = {
        "good": None,
        "dark": "more-light",
        "small": "move-closer",
        "glare": "tilt-away",
        "bright": "tilt-away",
    }
    for scene in scenes:
        if scene.group == "mrz-hidden":
            assert hints[scene.name] in {"show-mrz", "hold-still"}, scene.name
        else:
            assert hints[scene.name] in {expected[scene.group], "fit-card"}, scene.name
    goods = [scene for scene in scenes if scene.group == "good"]
    assert all(hints[scene.name] is None for scene in goods)


def test_the_report_is_committed_and_says_what_it_covers(
    calibrated: tuple[dict[str, Any], dict[str, Any], str],
) -> None:
    text = REPORT.read_text(encoding="utf-8")
    assert "**This covers synthetic renders only.**" in text
    assert "real camera frame" in text
    _, calibration, report = calibrated
    for gate in GATES:
        assert f"`{gate.key}`" in text
        assert f"`{gate.key}`" in report
        assert calibration[gate.key]["good"]["count"] > 0


def test_the_guide_and_its_shrunk_copies_are_centred() -> None:
    width, height = FRAME_SIZE
    guide = guide_in_frame(width, height, 85.60 / 53.98)
    assert guide == (24, 184, 456, 456)
    assert shrunk_guide(guide, 55) == (121, 245, 359, 395)
    assert shrunk_guide((0, 0, 3, 3), 10) == (1, 1, 2, 2)


def test_three_figures() -> None:
    assert three_figures(0.0) == 0.0
    assert three_figures(123_456.0) == 123_000.0
    assert three_figures(0.012345) == 0.0123
    assert np.isclose(three_figures(19.06), 19.1)
