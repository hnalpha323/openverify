"""Where the real text models are, and which of them are missing (for skip reasons)."""

from __future__ import annotations

from pathlib import Path
from typing import Final

from openverify_vision.ocr import (
    TEXT_DETECTOR_FILENAME,
    TEXT_DICTIONARY_FILENAME,
    TEXT_RECOGNIZER_FILENAME,
)

REPO_ROOT: Final = Path(__file__).resolve().parents[3]
MODELS_DIR: Final = REPO_ROOT / "models"


def missing_text_models() -> list[str]:
    """The text model files not yet fetched into ``models/``, repository-relative."""
    names = (TEXT_DETECTOR_FILENAME, TEXT_RECOGNIZER_FILENAME, TEXT_DICTIONARY_FILENAME)
    return [f"models/{name}" for name in names if not (MODELS_DIR / name).is_file()]
