"""Phase 12A Stage 3 (integration-12a): the committed end-to-end answers of the service.

``contracts/fixtures/quebec-dl/vision/*.json`` are what ``/v1/analyze/government-id`` answers for
the synthetic Quebec-format licence (``tools/quebec_e2e.py``); the API's
``quebec-phone-capture.test.ts`` runs the extraction, the checks and the decision on them. These
tests keep the files honest: each is the service's answer today, within a tolerance for the ONNX
Runtime arithmetic of another machine, and the vision side of the proof holds on it.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, Final

import pytest

import quebec_e2e
from model_paths import MODELS_DIR, missing_text_models
from openverify_vision.faces import YUNET_FILENAME
from openverify_vision.recognition import SFACE_FILENAME
from openverify_vision.schemas import GovernmentIdAnalysis
from quebec_e2e import E2E_CAPTURES, FACES_DIR, OUT_DIR, analyse, summary
from synthetic_quebec import CAPTURES, photograph

TOLERANCE: Final = 0.02
"""How far a measure may move on another machine (ONNX Runtime's CPU kernels round differently,
which can move an OCR box or a face box by a pixel)."""


def _missing() -> list[str]:
    missing = list(missing_text_models())
    missing += [f"models/{name}" for name in (YUNET_FILENAME, SFACE_FILENAME)]
    missing = [name for name in missing if not (MODELS_DIR.parent / name).is_file()]
    if not (FACES_DIR / "person-a-id.jpg").is_file():
        missing.append("fixtures/faces/person-a-id.jpg")
    return missing


needs_models = pytest.mark.skipif(bool(_missing()), reason=f"missing {_missing()}")


def committed(capture: str) -> dict[str, Any]:
    answer: dict[str, Any] = json.loads((OUT_DIR / f"{capture}.json").read_text(encoding="utf-8"))
    return answer


def test_every_recorded_capture_is_committed_and_valid() -> None:
    assert sorted(path.stem for path in OUT_DIR.glob("*.json")) == sorted(E2E_CAPTURES)
    for capture in E2E_CAPTURES:
        GovernmentIdAnalysis.model_validate(committed(capture))


@pytest.mark.parametrize("capture", E2E_CAPTURES)
def test_the_committed_back_carries_exactly_the_barcode_payload(capture: str) -> None:
    payload = photograph("back", CAPTURES[capture]).payload
    assert payload is not None

    back = committed(capture)["sides"]["back"]

    decoded = [base64.b64decode(code["bytes_b64"]) for code in back["barcodes"]]
    assert decoded == [payload.encode("latin-1")]


@pytest.mark.parametrize("capture", E2E_CAPTURES)
def test_the_committed_sides_find_the_card_and_its_portrait(capture: str) -> None:
    sides = committed(capture)["sides"]

    for side in ("front", "back"):
        assert sides[side]["document"]["found"], side
        assert sides[side]["document_quality"] is not None, side
    assert sides["front"]["portrait"] is not None
    assert sides["front"]["barcodes"] == []


@needs_models
@pytest.mark.parametrize("capture", E2E_CAPTURES)
def test_the_committed_answer_is_the_services_answer_today(capture: str) -> None:
    fresh = analyse(capture)
    stored = committed(capture)

    assert fresh["model_versions"] == stored["model_versions"]
    for side in ("front", "back"):
        now, then = fresh["sides"][side], stored["sides"][side]
        assert now["document"]["method"] == then["document"]["method"], side
        assert [line["text"] for line in now["text"]] == [line["text"] for line in then["text"]]
        assert now["barcodes"] == then["barcodes"], side
        assert (now["portrait"] is None) == (then["portrait"] is None), side
        for key in ("blur_score", "tenengrad"):
            assert now["document_quality"][key] == pytest.approx(
                then["document_quality"][key], rel=TOLERANCE
            ), (side, key)


def test_the_summary_names_shapes_never_text() -> None:
    answer = committed("phone-1080")
    texts = [line["text"] for side in ("front", "back") for line in answer["sides"][side]["text"]]

    line = summary("phone-1080", answer)

    assert line.startswith("phone-1080; front: document text_layout, ")
    assert all(text not in line for text in texts if len(text) > 3)


@needs_models
def test_the_command_writes_one_file_per_capture(tmp_path: Path) -> None:
    assert quebec_e2e.main(["--out", str(tmp_path), "--capture", "flat"]) == 0

    written = json.loads((tmp_path / "flat.json").read_text(encoding="utf-8"))
    assert written["sides"]["back"]["barcodes"] == committed("flat")["sides"]["back"]["barcodes"]
