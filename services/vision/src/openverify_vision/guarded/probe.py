"""C60.2: the guard's self-test task, run inside the child.

``probe`` reports what the child is allowed to do (its rlimits, ``NoNewPrivs``, the names in the
environment it was started with, the modules a real task loads, whether it may start a process
or a thread). Its parameters make it overrun on purpose (allocate, spin, sleep, write too much),
so the tests can watch the parent and the limits stop it. It reads no document. Standard library
only.
"""

from __future__ import annotations

import importlib
import os
import resource
import sys
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Final

RLIMITS: Final = {
    "as": resource.RLIMIT_AS,
    "cpu": resource.RLIMIT_CPU,
    "fsize": resource.RLIMIT_FSIZE,
    "core": resource.RLIMIT_CORE,
    "nofile": resource.RLIMIT_NOFILE,
    "nproc": resource.RLIMIT_NPROC,
}

LIBRARIES: Final = (
    "pypdfium2",
    "pypdfium2.raw",
    "pypdf",
    "PIL.Image",
    "PIL.JpegImagePlugin",
    "PIL.Jpeg2KImagePlugin",
    "PIL.PngImagePlugin",
)
"""The libraries a task may use, loaded by ``import_tasks`` with every task module."""

_MIB: Final = 1024 * 1024
_SPIN_SECONDS: Final = 3600.0


def _no_new_privs() -> int | None:
    """``NoNewPrivs`` from ``/proc/self/status``; ``None`` where there is no such line."""
    try:
        status = Path("/proc/self/status").read_text(encoding="ascii", errors="replace")
    except OSError:
        return None
    for line in status.splitlines():
        if line.startswith("NoNewPrivs:"):
            return int(line.split(":", 1)[1])
    return None


def _initial_environ() -> list[str] | None:
    """The names in the environment the process was started with (``/proc/self/environ``, the
    block ``execve`` received), never their values. ``harden()`` clears ``os.environ``, not this
    block, so it shows what the parent passed (Workflow 5C review P010). ``None`` without
    ``/proc``."""
    try:
        block = Path("/proc/self/environ").read_bytes()
    except OSError:
        return None
    names = {entry.partition(b"=")[0] for entry in block.split(b"\0") if entry}
    return sorted(name.decode("ascii", errors="replace") for name in names)


def _parent_view() -> dict[str, bool]:
    """What the child can read of its parent's ``/proc`` entries (Workflow 5C review P018): its
    initial environment (and whether the service token's name is in it; never a value) and its
    open file descriptors (the spooled uploads)."""
    parent = Path(f"/proc/{os.getppid()}")
    try:
        block = (parent / "environ").read_bytes()
        environ = True
    except OSError:
        block, environ = b"", False
    try:
        fds = bool(list((parent / "fd").iterdir()))
    except OSError:
        fds = False
    return {
        "environ_readable": environ,
        "token_seen": b"OPENVERIFY_VISION_SERVICE_TOKEN=" in block,
        "fds_readable": fds,
    }


def _process_limit_is_zero() -> bool:
    return resource.getrlimit(resource.RLIMIT_NPROC)[0] == 0


def _fork_refused() -> bool:
    """Whether a fork fails. Attempted only under ``RLIMIT_NPROC`` 0, where it must fail; a
    process without that limit could fork, so it reports ``False`` without trying."""
    if not _process_limit_is_zero():
        return False
    try:
        pid = os.fork()
    except OSError:
        return True
    if pid == 0:  # pragma: no cover - only a child that should not exist runs this
        os._exit(0)
    os.waitpid(pid, 0)
    return False


def _thread_refused() -> bool:
    """Whether a thread fails to start; attempted only under ``RLIMIT_NPROC`` 0, as above."""
    if not _process_limit_is_zero():
        return False
    thread = threading.Thread(target=lambda: None)
    try:
        thread.start()
    except RuntimeError:
        return True
    thread.join()
    return False


def import_tasks() -> None:
    """Load every task module and library, as the real tasks would."""
    from openverify_vision.guarded.worker import TASK_MODULES  # noqa: PLC0415 - avoid a cycle

    for name in (*TASK_MODULES, *LIBRARIES):
        importlib.import_module(name)


def _overrun(params: Mapping[str, Any]) -> bytearray | None:
    """The overruns the parameters ask for; the allocation is returned so it stays held."""
    held = None
    allocate = int(params.get("allocate_mib", 0))
    if allocate > 0:
        held = bytearray(allocate * _MIB)
        held[::4096] = b"\x01" * len(held[::4096])
    if params.get("spin"):
        deadline = time.monotonic() + _SPIN_SECONDS
        while time.monotonic() < deadline:
            pass
    sleep = float(params.get("sleep_seconds", 0))
    if sleep > 0:
        time.sleep(sleep)
    return held


def probe(params: Mapping[str, Any]) -> tuple[dict[str, Any], list[bytes]]:
    """The child's own view of its limits, after the overruns ``params`` ask for."""
    if params.get("import_tasks"):
        import_tasks()
    held = _overrun(params)
    report = {
        "rlimits": {name: list(resource.getrlimit(limit)) for name, limit in RLIMITS.items()},
        "no_new_privs": _no_new_privs(),
        "environ": _initial_environ(),
        "modules": sorted({name.partition(".")[0] for name in sys.modules}),
        "fork_refused": _fork_refused(),
        "thread_refused": _thread_refused(),
        "held_bytes": 0 if held is None else len(held),
        "parent": _parent_view() if params.get("read_parent") else None,
    }
    output = int(params.get("output_bytes", 0))
    return {"ok": True, "probe": report}, ([bytes(output)] if output > 0 else [])
