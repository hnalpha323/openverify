"""Phase 12A V3: calibrate the document blur measure on the synthetic Quebec-format captures.

Each capture of ``synthetic_quebec.CAPTURES`` (both sides, the standard back) is analysed as
``/v1/analyze/government-id`` analyses it (``analysis.analyze_government_id_side`` with the real
text models): the upload's own document detection (``contour`` on the flat and
12-megapixel frames, ``text_layout`` on the 1080x1920 ones), the OCR of the rectified card, and
:func:`openverify_vision.document.measure_document_quality` over the OCR's own text boxes, which is
what ``id_blur_detection`` judges. The legible captures (:data:`PASS`) must score at or above the
proposed ``min-document-blur-score`` and ``min-document-tenengrad``, the blurred and moved ones
(:data:`FAIL`) under them. Each proposed value is the geometric mean of the lowest legible score
and the highest failing one, so it sits as far from both in ratio; the margin is that ratio.

integration-12a (Workflow 12A Stage 3) moved the measurement from the true quad and the printed
lines' tight boxes to the analysis itself: the OCR's boxes are about 1.5 times the printed ones, so
the same card scores about two thirds as much on them, and the values proposed on the tight boxes
failed the legible ``phone-1080-soft`` capture in the analysis
(``docs/tdd/phase12a-integration-12a.tdd.md``).

Two more captures are measured for information, outside both sets: the same scene as
``phone-1080`` at 2160x3840 with the optical blur scaled with the frame, and the plan's literal
2160x3840 pair (``blur_sigma`` 1.2), which doubles only part of the blur and so is sharper.

``uv run python tools/calibrate_blur_phase12a.py`` rewrites the generated part of
``docs/calibration/blur-phase12a.md`` (between its markers); ``--check`` exits 1 when it is stale.
It needs the text models (``python3 scripts/fetch_models.py``). Every value is synthetic; nothing
here reads a real card.
"""

from __future__ import annotations

import argparse
import functools
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy as np
from numpy.typing import NDArray

from openverify_vision.analysis import FaceEngine, analyze_government_id_side
from openverify_vision.faces import Face
from openverify_vision.imaging import ImageArray
from openverify_vision.ocr import OcrEngine
from openverify_vision.quality import QualityThresholds
from openverify_vision.settings import Settings
from synthetic_quebec import CAPTURES, Capture, Side, photograph

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
MODELS_DIR: Final = REPO_ROOT / "models"
DOCUMENT: Final = REPO_ROOT / "docs" / "calibration" / "blur-phase12a.md"
BEGIN: Final = "<!-- calibration:begin (tools/calibrate_blur_phase12a.py) -->"
END: Final = "<!-- calibration:end -->"

PASS: Final = (
    "flat",
    "phone-1080",
    "phone-1080-soft",
    "phone-1080-tilt",
    "phone-1080-q75",
    "phone-1080-glare",
    "phone-full",
)
FAIL: Final = ("phone-1080-blur", "phone-1080-motion")

SAME_SCENE: Final = Capture(
    "same-scene-2160", frame=(2160, 3840), blur_sigma=round(math.sqrt(4 * 0.61 - 0.25), 4)
)
"""``phone-1080`` at twice the size: 0.5 px of lens blur and ``blur_sigma`` 0.6 at 1080 are
sqrt(0.61) px in all, so at 2160 the total is 2 sqrt(0.61) and ``blur_sigma`` sqrt(4 x 0.61 -
0.25) = 1.48."""

PLAN_PAIR: Final = Capture("plan-2160", frame=(2160, 3840), blur_sigma=1.2, noise=1.5)

INFORMATIVE: Final = (SAME_SCENE, PLAN_PAIR)
SIDES: Final[tuple[Side, Side]] = ("front", "back")


@dataclass(frozen=True, slots=True)
class Row:
    capture: str
    side: Side
    width_px: int
    blur_score: float
    tenengrad: float


@dataclass(frozen=True, slots=True)
class Proposal:
    min_document_blur_score: float
    min_document_tenengrad: float
    blur_margin: float
    tenengrad_margin: float
    lowest_legible: tuple[Row, Row]
    """The legible rows with the lowest blur score and the lowest Tenengrad."""
    highest_failing: tuple[Row, Row]


class _NoFaces:
    """A face detector that finds none: the synthetic portrait is a drawn silhouette, and faces
    do not enter the document's sharpness."""

    def load(self) -> None:
        pass

    def detect(self, img: ImageArray) -> list[Face]:
        return []

    def embed(self, img: ImageArray, face: Face) -> NDArray[np.float32]:  # pragma: no cover
        raise AssertionError("no face is ever embedded")


@functools.cache
def _engines() -> tuple[FaceEngine, OcrEngine]:
    """The analysis's engines: no faces, and the real text models of ``models/``."""
    settings = Settings.model_validate({"service_token": "c" * 40, "models_dir": MODELS_DIR})
    reader = OcrEngine.from_settings(settings)
    if not reader.load():
        raise RuntimeError(
            f"the text models are missing from {MODELS_DIR}: run python3 scripts/fetch_models.py"
        )
    return FaceEngine(_NoFaces(), _NoFaces()), reader


@functools.cache
def measure(side: Side, capture: Capture) -> Row:
    """One capture's row (cached: a capture is deterministic)."""
    shot = photograph(side, capture)
    faces, reader = _engines()
    image = np.ascontiguousarray(np.asarray(shot.image)[:, :, ::-1], dtype=np.uint8)
    analysed = analyze_government_id_side(
        shot.jpeg, image, faces, reader, QualityThresholds(), front=side == "front"
    )
    quality = analysed.document_quality
    if quality is None:  # pragma: no cover - the calibration captures are all found
        raise RuntimeError(f"{capture.name} {side}: no document was found to measure")
    return Row(capture.name, side, quality.width_px, quality.blur_score, quality.tenengrad)


def measure_captures(*, informative: bool = False) -> list[Row]:
    """Every calibration capture on both sides; with ``informative``, the 2160 pairs too."""
    captures = [CAPTURES[name] for name in (*PASS, *FAIL)]
    if informative:
        captures.extend(INFORMATIVE)
    return [measure(side, capture) for capture in captures for side in SIDES]


def _threshold(low: float, high: float) -> tuple[float, float]:
    """The geometric mean of the lowest legible and the highest failing score, and the ratio
    by which it clears each (1 or less: the sets overlap)."""
    value = math.sqrt(low * high)
    return round(value, 2), round(math.sqrt(low / high), 3)


def propose(rows: Sequence[Row]) -> Proposal:
    legible = [row for row in rows if row.capture in PASS]
    failing = [row for row in rows if row.capture in FAIL]
    low_blur = min(legible, key=lambda row: row.blur_score)
    low_ten = min(legible, key=lambda row: row.tenengrad)
    high_blur = max(failing, key=lambda row: row.blur_score)
    high_ten = max(failing, key=lambda row: row.tenengrad)
    blur, blur_margin = _threshold(low_blur.blur_score, high_blur.blur_score)
    ten, ten_margin = _threshold(low_ten.tenengrad, high_ten.tenengrad)
    return Proposal(
        min_document_blur_score=blur,
        min_document_tenengrad=ten,
        blur_margin=blur_margin,
        tenengrad_margin=ten_margin,
        lowest_legible=(low_blur, low_ten),
        highest_failing=(high_blur, high_ten),
    )


def _set(capture: str) -> str:
    if capture in PASS:
        return "legible"
    if capture in FAIL:
        return "blurred"
    return "information"


def render(rows: Sequence[Row], proposal: Proposal) -> str:
    """The generated part of the calibration document (between the markers)."""
    lines = [
        "| Capture | Side | Set | Card width (px) | blur_score | tenengrad |",
        "|---|---|---|---|---|---|",
    ]
    lines.extend(
        f"| {row.capture} | {row.side} | {_set(row.capture)} | {row.width_px} "
        f"| {row.blur_score:.2f} | {row.tenengrad:.1f} |"
        for row in rows
    )
    blur_low, ten_low = proposal.lowest_legible
    blur_high, ten_high = proposal.highest_failing
    lines.extend(
        [
            "",
            "| Key | Proposed | Lowest legible | Highest blurred | Margin (ratio each side) |",
            "|---|---|---|---|---|",
            f"| `min-document-blur-score` | {proposal.min_document_blur_score} "
            f"| {blur_low.blur_score:.2f} ({blur_low.capture} {blur_low.side}) "
            f"| {blur_high.blur_score:.2f} ({blur_high.capture} {blur_high.side}) "
            f"| {proposal.blur_margin} |",
            f"| `min-document-tenengrad` | {proposal.min_document_tenengrad} "
            f"| {ten_low.tenengrad:.1f} ({ten_low.capture} {ten_low.side}) "
            f"| {ten_high.tenengrad:.1f} ({ten_high.capture} {ten_high.side}) "
            f"| {proposal.tenengrad_margin} |",
        ]
    )
    return "\n".join(lines)


def _replace(text: str, generated: str) -> str:
    start, stop = text.find(BEGIN), text.find(END)
    if start < 0 or stop < start:
        raise ValueError(f"the calibration document has no {BEGIN} ... {END} markers")
    return f"{text[: start + len(BEGIN)]}\n{generated}\n{text[stop:]}"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument("--doc", type=Path, default=DOCUMENT)
    parser.add_argument("--check", action="store_true", help="exit 1 when the document is stale")
    args = parser.parse_args(argv)
    rows = measure_captures(informative=True)
    core = [row for row in rows if row.capture in (*PASS, *FAIL)]
    current = args.doc.read_text(encoding="utf-8")
    updated = _replace(current, render(rows, propose(core)))
    if args.check:
        if updated != current:
            print(f"stale: {args.doc}")
            return 1
        return 0
    args.doc.write_text(updated, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
