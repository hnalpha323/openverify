"""The models-fetch Job's program (C263.5, decision 5; Workflow 11C Stage 2, chart-11c).

The chart runs it in the vision image as ``python3 -I -c <this file> <digest> <manifest>
<fetch_models.py>``, a pre-install,pre-upgrade hook in its own pod with no Secret, writing into the
models claim mounted at ``/models``. It fetches the weights ``models/manifest.json`` pins into
``/models/<digest>/`` (the manifest's SHA-256, which the chart renders) with the image's own
``scripts/fetch_models.py``, exits 0 at once when that directory is already complete, and removes
every digest directory except the current one and the previous one. Standard library only; no
shell.

Exit status: 0 done, 1 (or the fetch's own status) the fetch failed, 2 a refused argument or a
manifest whose SHA-256 is not the chart's (a chart and an image of different releases).
"""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Final

MARKER: Final = ".openverify-complete"
"""Written into a digest directory once every pinned file in it is verified."""
DIGEST_PATTERN: Final = re.compile(r"^[0-9a-f]{64}$")
MODELS_ROOT: Final = Path("/models")

Runner = Callable[[Sequence[str]], int]
"""Runs a command (the fetch) and answers its exit status."""


def _run(command: Sequence[str]) -> int:
    return subprocess.run(list(command), check=False).returncode


def manifest_digest(manifest: Path) -> str:
    """The SHA-256 of the manifest's bytes, as lower-case hex."""
    return hashlib.sha256(manifest.read_bytes()).hexdigest()


def _completed_at(directory: Path) -> float | None:
    marker = directory / MARKER
    return marker.stat().st_mtime if marker.is_file() else None


def prune(root: Path, current: str) -> list[Path]:
    """Remove every digest directory under ``root`` but ``current`` and the newest other complete one.

    An entry whose name is not 64 lower-case hex characters is the operator's and is left alone.
    Answers the directories removed, oldest first.
    """
    others = [
        entry
        for entry in root.iterdir()
        if entry.is_dir() and DIGEST_PATTERN.match(entry.name) and entry.name != current
    ]
    complete = sorted(
        (entry for entry in others if _completed_at(entry) is not None),
        key=lambda entry: _completed_at(entry) or 0.0,
        reverse=True,
    )
    keep = {complete[0]} if complete else set()
    removed = sorted(
        (entry for entry in others if entry not in keep),
        key=lambda entry: (_completed_at(entry) or 0.0, entry.name),
    )
    for entry in removed:
        shutil.rmtree(entry)
    return removed


def main(
    argv: Sequence[str], *, root: Path = MODELS_ROOT, run: Runner | None = None
) -> int:
    """``<digest> <manifest> <fetch_models.py>``: fetch, mark complete, prune; answer the exit status."""
    if len(argv) != 3:
        print(
            "usage: models-fetch <digest> <manifest> <fetch_models.py>", file=sys.stderr
        )
        return 2
    digest, manifest, fetcher = argv
    if not DIGEST_PATTERN.match(digest):
        print(
            "models-fetch: the digest must be 64 lower-case hex characters",
            file=sys.stderr,
        )
        return 2
    found = manifest_digest(Path(manifest))
    if found != digest:
        print(
            f"models-fetch: {manifest} has SHA-256 {found}, not the chart's {digest}: "
            "install the chart and the images of one release",
            file=sys.stderr,
        )
        return 2
    current = root / digest
    if _completed_at(current) is not None:
        print(f"models-fetch: {current} is complete")
    else:
        command = [
            sys.executable,
            "-I",
            fetcher,
            "--manifest",
            manifest,
            "--dest",
            str(current),
        ]
        status = (run or _run)(command)
        if status != 0:
            print(
                f"models-fetch: the fetch failed with status {status}", file=sys.stderr
            )
            return status
        (current / MARKER).write_text(digest + "\n")
        print(f"models-fetch: {current} is complete")
    for entry in prune(root, digest):
        print(f"models-fetch: removed {entry}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
