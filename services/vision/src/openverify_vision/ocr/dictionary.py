"""The recognizer's character dictionary, read from the model's ``inference.yml``.

PaddlePaddle's official PP-OCRv6 recognition repository ships no separate dictionary file: the
characters are ``PostProcess.character_dict`` in ``inference.yml`` (written by PyYAML). The file
is pinned by SHA-256 in ``models/manifest.json``, so this reader understands exactly the YAML
that list uses, and refuses anything else rather than guess:

- one entry per line, ``  - <value>``, two spaces in, right under ``  character_dict:``;
- a value is a plain scalar, or a single-quoted one in which ``''`` stands for ``'``;
- every value is exactly one character, and no character appears twice;
- the post-processing is ``CTCLabelDecode``, the only decoding this package implements.

No YAML library is needed (the vision service adds no dependency for it).
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Final

from openverify_vision.faces import FETCH_MODELS_HINT, ModelNotAvailableError

_SECTION: Final = "PostProcess:"
_NAME: Final = "  name: CTCLabelDecode"
_LIST: Final = "  character_dict:"
_ITEM: Final = "  - "


class DictionaryError(ValueError):
    """The file is not a character dictionary this reader understands."""


def _section(lines: list[str]) -> list[str]:
    """The lines of the top-level ``PostProcess`` mapping."""
    try:
        start = lines.index(_SECTION) + 1
    except ValueError:
        raise DictionaryError(f"no {_SECTION} section") from None
    end = start
    while end < len(lines) and (not lines[end] or lines[end].startswith(" ")):
        end += 1
    return lines[start:end]


def _scalar(value: str, number: int) -> str:
    if value.startswith('"'):
        raise DictionaryError(f"entry {number}: double-quoted values are not read")
    if value.startswith("'"):
        if len(value) < 2 or not value.endswith("'"):  # noqa: PLR2004 - two quotes
            raise DictionaryError(f"entry {number}: unterminated quoted value")
        inner = value[1:-1]
        if "'" in inner.replace("''", ""):
            raise DictionaryError(f"entry {number}: malformed quoted value")
        return inner.replace("''", "'")
    return value


def parse_character_dict(text: str) -> tuple[str, ...]:
    """The ``PostProcess.character_dict`` list of ``text``, in order."""
    lines = text.replace("\r\n", "\n").split("\n")
    section = _section(lines)
    if _NAME not in section:
        raise DictionaryError("the post-processing is not CTCLabelDecode (CTC decoding)")
    try:
        start = section.index(_LIST) + 1
    except ValueError:
        raise DictionaryError(f"no {_LIST.strip()} in {_SECTION}") from None

    characters: list[str] = []
    seen: set[str] = set()
    for line in section[start:]:
        if not line.startswith(_ITEM.rstrip()):
            break
        number = len(characters) + 1
        value = _scalar(line[len(_ITEM) :], number)
        if len(value) != 1:
            raise DictionaryError(f"entry {number}: each entry is one character")
        if value in seen:
            raise DictionaryError(f"entry {number}: {value!r} is listed twice")
        seen.add(value)
        characters.append(value)
    if not characters:
        raise DictionaryError("the character dictionary is empty")
    return tuple(characters)


def load_character_dict(path: Path) -> tuple[str, ...]:
    """:func:`parse_character_dict` of the UTF-8 file at ``path``."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ModelNotAvailableError(
            f"text recognizer dictionary not found at {path}; {FETCH_MODELS_HINT}"
        ) from None
    except UnicodeDecodeError as exc:
        raise DictionaryError(f"{path.name} is not UTF-8 text") from exc
    return parse_character_dict(text)


class CharacterDictionary:
    """The dictionary file at ``path``, read on first use and kept (thread-safe)."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._characters: tuple[str, ...] | None = None
        self._lock = threading.Lock()

    def load(self) -> tuple[str, ...]:
        with self._lock:
            if self._characters is None:
                self._characters = load_character_dict(self._path)
            return self._characters
