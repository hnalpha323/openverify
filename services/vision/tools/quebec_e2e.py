"""Phase 12A Stage 3 (integration-12a): the synthetic Quebec-format licence through vision.

Each named capture of ``synthetic_quebec.CAPTURES`` is photographed on both sides (the front with
person A's public-domain portrait from ``fixtures/manifest.json``, the standard back) and posted to
``/v1/analyze/government-id`` of the app in process, with the real face and text models of
``models/``. The answers are written to ``contracts/fixtures/quebec-dl/vision/<capture>.json``,
where ``apps/api/src/jobs/quebec-phone-capture.test.ts`` parses them with the API's schema and runs
``extractGovernmentId``, the government ID checks and the decision on them.

```bash
python3 -I scripts/fetch_models.py && python3 -I scripts/fetch_fixtures.py --only person_a_id
uv run python tools/quebec_e2e.py [--out DIR] [--capture NAME ...]
pnpm exec prettier --write contracts/fixtures/quebec-dl/vision/*.json
```

Everything is synthetic: the invented SPECIMEN holder of ``synthetic_quebec`` (C36 as amended by
Phase 12A) and a public-domain face. The answers hold the card's OCR text, which is that invented
text; nothing here reads a real card, and nothing is printed but a summary of shapes.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from http import HTTPStatus
from pathlib import Path
from typing import Any, Final

from fastapi.testclient import TestClient

from make_synthetic_fixtures import portraits
from openverify_vision.app import create_app
from openverify_vision.settings import Settings
from synthetic_quebec import CAPTURES, photograph

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
MODELS_DIR: Final = REPO_ROOT / "models"
MANIFEST: Final = REPO_ROOT / "fixtures" / "manifest.json"
FACES_DIR: Final = REPO_ROOT / "fixtures" / "faces"
OUT_DIR: Final = REPO_ROOT / "contracts" / "fixtures" / "quebec-dl" / "vision"

E2E_CAPTURES: Final = ("flat", "phone-1080", "phone-1080-soft", "phone-1080-tilt")
"""The variants the end-to-end proof records: sharp, phone JPEG, mild blur and perspective."""

_TOKEN: Final = "q" * 40


def analyse(capture: str, client: TestClient | None = None) -> dict[str, Any]:
    """The service's answer for both sides of ``capture`` (a name of ``CAPTURES``)."""
    person_a, _ = portraits(MANIFEST, FACES_DIR)
    chosen = CAPTURES[capture]
    front = photograph("front", chosen, portrait=(person_a.photo, person_a.face_box))
    back = photograph("back", chosen)
    if client is None:
        settings = Settings.model_validate({"service_token": _TOKEN, "models_dir": MODELS_DIR})
        client = TestClient(create_app(settings))
    response = client.post(
        "/v1/analyze/government-id",
        files={
            "front": ("front.jpg", front.jpeg, "image/jpeg"),
            "back": ("back.jpg", back.jpeg, "image/jpeg"),
        },
        headers={"x-service-token": _TOKEN},
    )
    if response.status_code != HTTPStatus.OK:  # pragma: no cover - the captures are valid uploads
        raise RuntimeError(f"{capture}: the service answered {response.status_code}")
    answer: dict[str, Any] = response.json()
    return answer


def summary(capture: str, answer: dict[str, Any]) -> str:
    """One line of shapes per capture: never the text that was read."""
    parts = [capture]
    for name, side in answer["sides"].items():
        if side is None:
            continue
        quality = side["document_quality"]
        parts.append(
            f"{name}: document {side['document']['method']}, {len(side['text'])} lines, "
            f"{len(side['barcodes'])} barcodes, portrait {side['portrait'] is not None}, "
            f"document blur {None if quality is None else quality['blur_score']}"
        )
    return "; ".join(parts)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    parser.add_argument("--capture", action="append", choices=sorted(CAPTURES))
    args = parser.parse_args(argv)
    settings = Settings.model_validate({"service_token": _TOKEN, "models_dir": MODELS_DIR})
    client = TestClient(create_app(settings))
    args.out.mkdir(parents=True, exist_ok=True)
    for capture in args.capture or E2E_CAPTURES:
        answer = analyse(capture, client)
        (args.out / f"{capture}.json").write_text(
            json.dumps(answer, indent=2) + "\n", encoding="utf-8"
        )
        print(summary(capture, answer))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
