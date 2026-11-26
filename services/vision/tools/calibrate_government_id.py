"""Run every synthetic variant through the government ID analysis and write the raw measurements.

C36 calibration, step one: this script measures; ``packages/checks/scripts/calibration-report.ts``
(``checks-logic``) scores the measurements with the real evaluators and writes the report. The
analysis runs in process (``openverify_vision.analysis.analyze_government_id_side``) on the exact
bytes the fixture generator writes, with the real models from ``--models`` (YuNet and SFace are
required; the OCR models are used when present, and the output says when they were not).

What is measured:

- every C36 variant of the Utopia card, the happy card first (``synthetic_variants``);
- distinct happy cards of other fictional holders and re-encodings of the happy card, for the
  pHash distances C34 needs between distinct cards of one design and between copies of one card;
- every AAMVA barcode-only image, as the back side it would be uploaded as.

Output (JSON, ``--out``; default ``fixtures/generated/calibration/``, gitignored)::

    {"generator_version": 5,
     "model_versions": {C32.1 model_versions},
     "quality_thresholds": {"blur_min", "glare_max", "brightness_min", "brightness_max"},
     "variants": [{"name", "group", "expect": [check ids], "description",
                   "sides": {"front": <C32.1 side analysis>, "back": <...> | null},
                   "truth": {"front": <what the side shows>, "back": <...> | null}}],
     "aamva": [{"id", "valid", "side": <C32.1 side analysis>}]}

``quality_thresholds`` are the whole-image thresholds vision judged ``quality`` with (the service's
defaults unless configured), so the report can judge them as the defaults of ``min-blur-score``
and ``max-glare-ratio``. ``group`` is ``happy``, ``variant``, ``distinct-holder`` or
``re-encoding``. A side analysis holds the portrait's embedding (of a public-domain face) and the
OCR text of synthetic cards only.

Usage::

    cd services/vision && uv run python tools/calibrate_government_id.py
    cd services/vision && uv run python tools/calibrate_government_id.py --only happy --only glare
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

from PIL import Image

from make_synthetic_fixtures import (
    DEFAULT_MANIFEST,
    GENERATOR_VERSION,
    FixtureError,
    ManifestShapeError,
    portraits,
)
from openverify_vision.analysis import (
    FaceEngine,
    analyze_government_id_side,
    government_id_model_versions,
)
from openverify_vision.faces import FETCH_MODELS_HINT, ModelNotAvailableError
from openverify_vision.imaging import decode_image
from openverify_vision.ocr import OcrEngine
from openverify_vision.quality import QualityThresholds
from openverify_vision.settings import Settings
from synthetic_aamva import AamvaVector, load_vectors, render_barcode
from synthetic_variants import (
    Portrait,
    Side,
    Variant,
    c36_variants,
    distinct_holders,
    re_encodings,
)

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
DEFAULT_MODELS: Final = REPO_ROOT / "models"
DEFAULT_OUT: Final = (
    REPO_ROOT / "fixtures" / "generated" / "calibration" / "government-id-measurements.json"
)
MAX_IMAGE_PIXELS: Final = 40_000_000
"""The vision service's default decode limit."""


@dataclass(frozen=True, slots=True)
class Analysers:
    """The engines and thresholds the analysis runs with (the service's defaults by default)."""

    engine: FaceEngine
    reader: OcrEngine
    thresholds: QualityThresholds = field(default_factory=QualityThresholds)
    max_pixels: int = MAX_IMAGE_PIXELS


def analysers_for(models: Path) -> Analysers:
    """The real engines over ``models``, configured from code and never from the environment,
    so a run measures the same everywhere. Nothing is loaded yet."""
    settings = Settings.model_construct(models_dir=models)
    return Analysers(
        engine=FaceEngine.from_settings(settings), reader=OcrEngine.from_settings(settings)
    )


def calibration_set(portrait: Portrait, other: Portrait) -> tuple[Variant, ...]:
    """Every C36 variant, then the distinct holders, then the re-encodings."""
    return (
        *c36_variants(portrait, other),
        *distinct_holders(portrait, other),
        *re_encodings(portrait),
    )


def _analyse(data: bytes, analysers: Analysers, *, front: bool) -> dict[str, Any]:
    image = decode_image(data, max_pixels=analysers.max_pixels)
    side = analyze_government_id_side(
        data, image, analysers.engine, analysers.reader, analysers.thresholds, front=front
    )
    return side.model_dump(mode="json")


def _png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _per_side(
    variant: Variant, read: Callable[[Side, bool], dict[str, Any]]
) -> dict[str, dict[str, Any] | None]:
    """``read(side, is_front)`` of the front and of the back (``None`` without a back)."""
    back = None if variant.back is None else read(variant.back, False)
    return {"front": read(variant.front, True), "back": back}


def measure(
    variants: Sequence[Variant],
    analysers: Analysers,
    *,
    barcodes: Sequence[AamvaVector] = (),
) -> dict[str, Any]:
    """The raw measurements of ``variants`` and ``barcodes`` (see the module docstring)."""
    measured = [
        {
            "name": variant.name,
            "group": variant.group,
            "expect": list(variant.expect),
            "description": variant.description,
            "sides": _per_side(
                variant, lambda side, front: _analyse(side.encode(), analysers, front=front)
            ),
            "truth": _per_side(variant, lambda side, _: side.truth()),
        }
        for variant in variants
    ]
    aamva = [
        {
            "id": vector.id,
            "valid": vector.valid,
            "side": _analyse(_png(render_barcode(vector.payload)), analysers, front=False),
        }
        for vector in barcodes
    ]
    # Read last: the OCR engine reports its models only once it has loaded them.
    versions = government_id_model_versions(analysers.reader).model_dump(mode="json")
    return {
        "generator_version": GENERATOR_VERSION,
        "model_versions": versions,
        "quality_thresholds": analysers.thresholds.model_dump(mode="json"),
        "variants": measured,
        "aamva": aamva,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Measure every synthetic ID variant.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--faces", type=Path, default=None, help="photo directory (default: <manifest dir>/faces)"
    )
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--only",
        action="append",
        default=[],
        metavar="NAME",
        help="measure only this variant (repeatable); the AAMVA images are then skipped",
    )
    return parser


def main(argv: Sequence[str] | None = None, *, analysers: Analysers | None = None) -> int:
    args = _parser().parse_args(argv)
    faces_dir: Path = args.faces if args.faces is not None else args.manifest.parent / "faces"
    chosen = analysers if analysers is not None else analysers_for(args.models)
    try:
        portrait, other = portraits(args.manifest, faces_dir)
        chosen.engine.ensure_loaded()
    except (FixtureError, ManifestShapeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except ModelNotAvailableError as exc:
        print(f"error: {exc}; {FETCH_MODELS_HINT}", file=sys.stderr)
        return 1

    variants = calibration_set(portrait, other)
    barcodes: Sequence[AamvaVector] = load_vectors()
    if args.only:
        known = [variant.name for variant in variants]
        unknown = [name for name in args.only if name not in known]
        if unknown:
            print(
                f"error: no variant named {', '.join(unknown)}; known: {', '.join(known)}",
                file=sys.stderr,
            )
            return 2
        variants = tuple(variant for variant in variants if variant.name in args.only)
        barcodes = ()

    document = measure(variants, chosen, barcodes=barcodes)
    if document["model_versions"]["text_detector"] is None:
        print(
            "warning: no text model ran, so text and the MRZ were not measured; "
            f"{FETCH_MODELS_HINT}",
            file=sys.stderr,
        )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out}: {len(variants)} variants, {len(barcodes)} AAMVA images")
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through main()
    raise SystemExit(main())
