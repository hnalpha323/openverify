"""C60.2: the guarded child's entry point (``python -I -B -m openverify_vision.guarded.worker``).

It reads the request header from stdin, sets ``PR_SET_NO_NEW_PRIVS`` and its rlimits, then reads
the document and runs the task, writing the answer to stdout. Standard library only at import:
each task imports pypdfium2, pypdf or Pillow itself, after the limits are set.

- ``-I`` ignores the environment, the user site and the working directory; ``-B`` writes no
  bytecode (``RLIMIT_FSIZE`` is 0, so no file may grow).
- ``RLIMIT_NPROC`` 0 means no ``fork``, ``exec`` or thread; ``RLIMIT_CORE`` 0 no core dump;
  ``RLIMIT_AS`` and ``RLIMIT_CPU`` bound memory and CPU time (``SIGXCPU``, then ``SIGKILL`` one
  second later).
- A document the task refuses is answered ``{"ok": false, "error": <code>}``; anything else that
  goes wrong ends the process with a non-zero status, which the parent answers as a failure:
  ``OVER_LIMITS_EXIT_STATUS`` when Python ran out of its address space.
"""

from __future__ import annotations

import ctypes
import json
import os
import resource
import sys
from collections.abc import Mapping
from typing import Any, Final

from openverify_vision.guarded.protocol import (
    MAX_REQUEST_HEADER_BYTES,
    OVER_LIMITS_EXIT_STATUS,
    TaskRefusal,
    pack,
    read_frame,
    read_magic,
)

__all__ = ["TASK_MODULES", "TaskRefusal", "harden", "main", "run_task"]

PR_SET_NO_NEW_PRIVS: Final = 38
"""``<linux/prctl.h>``."""

TASK_MODULES: Final = (
    "openverify_vision.guarded.probe",
    "openverify_vision.guarded.pdf_measure",
    "openverify_vision.guarded.pdf_scan",
    "openverify_vision.guarded.text_layer",
    "openverify_vision.guarded.xmp_scan",
    "openverify_vision.guarded.images",
)
"""Every module a task runs in; the probe loads them all to report what a task may load."""


def _set_no_new_privs() -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        errno = ctypes.get_errno()
        raise OSError(errno, os.strerror(errno))


def harden(limits: Mapping[str, Any]) -> None:
    """Clear the environment, set ``PR_SET_NO_NEW_PRIVS`` and the rlimits. Any failure raises:
    the child must not read a document it could not confine."""
    os.environ.clear()
    _set_no_new_privs()
    address_space = int(limits["address_space_bytes"])
    cpu = int(limits["cpu_seconds"])
    files = int(limits["open_files"])
    resource.setrlimit(resource.RLIMIT_AS, (address_space, address_space))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 1))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (files, files))
    resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))


def run_task(
    task: str, params: Mapping[str, Any], data: bytes
) -> tuple[dict[str, Any], list[bytes]]:
    """The answer header and frames of ``task`` over ``data``. A refusal is answered, not
    raised."""
    # Each task imports its libraries here, after the limits are set (PLC0415).
    try:
        if task == "probe":
            from openverify_vision.guarded.probe import probe  # noqa: PLC0415

            return probe(params)
        if task == "analyze_pdf":
            from openverify_vision.guarded.pdf_measure import analyze  # noqa: PLC0415

            return analyze(data)
        if task == "count_pdf_pages":
            from openverify_vision.guarded.pdf_measure import count_pages  # noqa: PLC0415

            return count_pages(data, int(params["max_pages"]))
        if task == "render_pdf_page":
            from openverify_vision.guarded.pdf_measure import render_page  # noqa: PLC0415

            return render_page(data, int(params["page"]), int(params["max_side"]))
        if task == "decode_portrait":
            from openverify_vision.guarded.images import decode_portrait  # noqa: PLC0415

            side = params.get("max_side")
            return decode_portrait(
                data,
                max_side=None if side is None else int(side),
                max_pixels=int(params["max_pixels"]),
            )
    except TaskRefusal as refusal:
        return {"ok": False, "error": refusal.code}, []
    raise ValueError(f"unknown task {task!r}")


def main() -> int:
    """Run one guarded task: the request header, the limits, the document, the answer. Running
    out of the address space ends it with :data:`OVER_LIMITS_EXIT_STATUS`."""
    stdin = sys.stdin.buffer
    read_magic(stdin)
    request = json.loads(read_frame(stdin, max_bytes=MAX_REQUEST_HEADER_BYTES))
    harden(request["limits"])
    try:
        data = read_frame(stdin, max_bytes=int(request["max_data_bytes"]))
        header, frames = run_task(str(request["task"]), request.get("params") or {}, data)
        body = pack([json.dumps(header).encode("ascii"), *frames])
    except MemoryError:
        raise SystemExit(OVER_LIMITS_EXIT_STATUS) from None
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":  # pragma: no cover - run as the child, outside the test process
    raise SystemExit(main())
