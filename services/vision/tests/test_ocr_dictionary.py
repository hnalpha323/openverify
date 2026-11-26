"""``ocr/dictionary.py``: the recognizer's character dictionary from its ``inference.yml``.

The real file (pinned by SHA-256 in ``models/manifest.json``) is read in ``test_ocr_models.py``.
Here the reader is held to the subset of YAML that file uses, and refuses anything else.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from openverify_vision.faces import ModelNotAvailableError
from openverify_vision.ocr.dictionary import (
    CharacterDictionary,
    DictionaryError,
    load_character_dict,
    parse_character_dict,
)

HEAD = """Global:
  model_name: PP-OCRv6_small_rec
PreProcess:
  transform_ops:
  - DecodeImage:
      channel_first: false
      img_mode: BGR
  - RecResizeImg:
      image_shape:
      - 3
      - 48
      - 320
"""

POST = """PostProcess:
  name: CTCLabelDecode
  character_dict:
  - '!'
  - ''''
  - '"'
  - $
  - '0'
  - <
  - A
  - 中
  - 🚨
"""


def test_reads_the_character_dict_of_the_post_process() -> None:
    assert parse_character_dict(HEAD + POST) == ("!", "'", '"', "$", "0", "<", "A", "中", "🚨")


def test_the_list_ends_at_the_next_top_level_key() -> None:
    text = HEAD + POST + "Hpi:\n  backend_configs: {}\n"

    assert parse_character_dict(text)[-1] == "🚨"


def test_windows_line_endings_are_read_like_unix_ones() -> None:
    assert parse_character_dict((HEAD + POST).replace("\n", "\r\n"))[-2:] == ("中", "🚨")


@pytest.mark.parametrize(
    ("text", "message"),
    [
        (HEAD, "PostProcess"),
        (HEAD + "PostProcess:\n  name: CTCLabelDecode\n", "character_dict"),
        (HEAD + "PostProcess:\n  name: AttnLabelDecode\n  character_dict:\n  - A\n", "CTC"),
        (HEAD + "PostProcess:\n  name: CTCLabelDecode\n  character_dict:\n", "empty"),
        (HEAD + POST + '  - "B"\n', "quoted"),
        (HEAD + POST + "  - AB\n", "one character"),
        (HEAD + POST + "  - 'A\n", "quoted"),
        (HEAD + POST + "  - ''\n", "one character"),
        (HEAD + POST + "  - A\n", "twice"),
        (HEAD + POST + "  -\n", "one character"),
        (HEAD + POST + "  - 'a'b'\n", "malformed"),
    ],
    ids=[
        "no-post-process",
        "no-dict",
        "not-ctc",
        "empty",
        "double-quoted",
        "two-characters",
        "unterminated",
        "empty-entry",
        "duplicate",
        "bare-dash",
        "lone-quote",
    ],
)
def test_anything_else_is_refused(text: str, message: str) -> None:
    with pytest.raises(DictionaryError, match=message):
        parse_character_dict(text)


def test_loads_a_file(tmp_path: Path) -> None:
    path = tmp_path / "inference.yml"
    path.write_text(HEAD + POST, encoding="utf-8")

    assert load_character_dict(path)[:3] == ("!", "'", '"')


def test_a_missing_file_is_a_missing_model(tmp_path: Path) -> None:
    with pytest.raises(ModelNotAvailableError, match=r"scripts/fetch_models\.py"):
        load_character_dict(tmp_path / "absent.yml")


def test_a_file_that_is_not_utf8_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "inference.yml"
    path.write_bytes(b"\xff\xfe\x00 not text")

    with pytest.raises(DictionaryError, match="UTF-8"):
        load_character_dict(path)


def test_the_dictionary_file_is_read_once(tmp_path: Path) -> None:
    path = tmp_path / "inference.yml"
    path.write_text(HEAD + POST, encoding="utf-8")
    dictionary = CharacterDictionary(path)

    first = dictionary.load()
    path.unlink()

    assert dictionary.load() == first
