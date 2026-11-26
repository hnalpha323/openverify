"""Start-up checks of the vision image (Phase 11, Workflow 11C, images-11c).

C249.2 as amended for vision (orchestrator decision 18; plan, Workflow 11C Stage 1a amendment 13):
each secret the service reads is also read from ``<NAME>_FILE``, a path to a mounted file, with
the API's rules (``apps/api/src/config/secret-files.ts``): both forms set, a relative path, an
unreadable or an empty file stop the start, the trailing line ends are trimmed, and a
world-readable file is the warning ``secret_file_readable`` (group read is how the chart's 0440
mount with ``fsGroup`` is read, so it is not warned). Messages name variables, never a value.

C257.1 as amended (15): with ``OPENVERIFY_VISION_MODELS_MANIFEST`` set (the image sets it), the
service refuses to start when a model file in the models directory differs from the SHA-256 the
manifest pins. A model not fetched is skipped: models load on first use, and a missing one is
reported then, as before.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Iterable, MutableMapping
from pathlib import Path
from typing import Final

logger = logging.getLogger(__name__)

FILE_SUFFIX: Final = "_FILE"
WORLD_READABLE: Final = 0o004
"""``S_IROTH``: readable by every user of the host."""
CHUNK_BYTES: Final = 1024 * 1024


class SecretFileError(ValueError):
    """A ``<NAME>_FILE`` the service cannot use; names the variable, never a value."""


class ModelDigestError(RuntimeError):
    """A model file whose SHA-256 differs from ``models/manifest.json``."""


def _without_trailing_line_ends(text: str) -> str:
    return text.rstrip("\r\n")


def resolve_secret_files(
    env: MutableMapping[str, str], names: Iterable[str]
) -> list[dict[str, str]]:
    """Read each ``<NAME>_FILE`` of ``names`` into ``<NAME>`` in ``env``; answer the warnings.

    Raises:
        SecretFileError: for the first file form the service cannot use.
    """
    warnings: list[dict[str, str]] = []
    for name in names:
        file_name = name + FILE_SUFFIX
        path = env.get(file_name, "").strip()
        if path == "":
            continue
        if env.get(name, "") != "":
            raise SecretFileError(f"{name}: is set together with {file_name}; set one")
        if not Path(path).is_absolute():
            raise SecretFileError(f"{file_name}: must be an absolute path")
        try:
            text = _without_trailing_line_ends(Path(path).read_text(encoding="utf-8"))
            mode = Path(path).stat().st_mode
        except (OSError, UnicodeDecodeError):
            raise SecretFileError(f"{file_name}: cannot be read") from None
        if text == "":
            raise SecretFileError(f"{file_name}: is empty")
        if mode & WORLD_READABLE:
            warnings.append({"event": "secret_file_readable", "variable": file_name})
            logger.warning(
                "secret_file_readable: %s is readable by every user of the host; mount it "
                "0400, or 0440 with the process's group",
                file_name,
            )
        env[name] = text
    return warnings


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def check_model_digests(models_dir: Path, manifest: Path) -> list[str]:
    """Compare every fetched model with its pin; answer the files checked.

    Raises:
        ModelDigestError: naming each file whose SHA-256 differs, or when the manifest cannot be
            read.
    """
    try:
        entries = json.loads(manifest.read_text(encoding="utf-8"))["models"]
        pins = {str(entry["filename"]): str(entry["sha256"]) for entry in entries}
    except (OSError, ValueError, KeyError, TypeError):
        raise ModelDigestError(f"the models manifest {manifest} cannot be read") from None
    checked: list[str] = []
    mismatched: list[str] = []
    for filename, pinned in pins.items():
        path = models_dir / filename
        if not path.is_file():
            continue
        checked.append(filename)
        if _sha256(path) != pinned:
            mismatched.append(filename)
    if mismatched:
        raise ModelDigestError(
            "refusing to start: the SHA-256 of "
            + ", ".join(mismatched)
            + f" in {models_dir} differs from {manifest}; fetch the models again with "
            "scripts/fetch_models.py"
        )
    return checked
