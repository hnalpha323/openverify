"""C60.2: the parent side of the guard: one fresh child per task, killed on any overrun.

:func:`run_guarded` starts ``python -I -B -m openverify_vision.guarded.worker`` with an empty
environment, writes the request to its stdin, reads at most ``output_bytes`` of its stdout, kills
it after ``wall_seconds`` and returns its answer. A child that was killed, timed out, wrote too
much, exited with an error or answered something malformed raises :class:`GuardedWorkerError`
(the routes answer 503 ``guarded_worker_failed``, and the document analysis 422
``pdf_unprocessable`` when the child stopped on its own limits: ``over_limits``); a document the
child refused raises :class:`GuardedRefusal` with the refusal's code. The child's stderr is
discarded: it could carry document text, which is never logged.
"""

from __future__ import annotations

import ctypes
import json
import logging
import os
import selectors
import signal
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Any, Final

from openverify_vision.guarded import DEFAULT_LIMITS, WORKER_MODULE, GuardLimits
from openverify_vision.guarded.protocol import OVER_LIMITS_EXIT_STATUS, ProtocolError, pack, unpack

logger = logging.getLogger(__name__)

REFUSAL_CODES: Final = frozenset(
    {
        "pdf_encrypted",
        "pdf_unprocessable",
        "too_many_pages",
        "unsupported_format",
        "too_large",
        "corrupt",
        "page_out_of_range",
    }
)
"""What a child may refuse a document with; any other answer is malformed."""

MAX_ANSWER_FRAMES: Final = 16
"""A header and its rasters: four pages and an embedded JPEG fit well within it."""

LIMIT_SIGNALS: Final = frozenset({signal.SIGXCPU, signal.SIGABRT, signal.SIGSEGV, signal.SIGBUS})
"""How a child dies on its own limits (Workflow 5C review P003): ``SIGXCPU`` at its CPU limit;
``SIGABRT``, ``SIGSEGV`` or ``SIGBUS`` when native code (PDFium, OpenJPEG) fails an allocation
under its address-space limit or breaks on the document. ``SIGKILL`` is not one: the container's
out-of-memory killer sends it too, whatever the document."""

_CHUNK: Final = 1024 * 1024


class GuardedWorkerError(RuntimeError):
    """The child did not answer: killed, timed out, over its output cap, or malformed."""

    def __init__(self, reason: str, *, over_limits: bool = False) -> None:
        super().__init__(f"guarded worker failed: {reason}")
        self.reason = reason
        self.over_limits = over_limits
        """Workflow 5C review P003: the child stopped on its own limits (CPU, address space,
        output), as the same document would stop it again; not its kill timer, which a loaded
        host stretches, nor an error of its own code."""


class GuardedRefusal(Exception):  # noqa: N818 - a refusal is an answer, not an error
    """The child read the document and refused it with ``code`` (one of :data:`REFUSAL_CODES`)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class GuardedAnswer:
    """The child's JSON header and the binary frames after it."""

    header: dict[str, Any]
    frames: tuple[bytes, ...]


def _kill(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        process.kill()
    process.wait()


def _exchange(
    process: subprocess.Popen[bytes], request: bytes, limits: GuardLimits, deadline: float
) -> bytes:
    """Write ``request`` and read the answer at once, so neither side can block the other."""
    stdin, stdout = process.stdin, process.stdout
    if stdin is None or stdout is None:  # pragma: no cover - both are pipes
        raise GuardedWorkerError("spawn_failed")
    output = bytearray()
    view = memoryview(request)
    written = 0
    with selectors.DefaultSelector() as selector:
        os.set_blocking(stdin.fileno(), False)
        selector.register(stdin, selectors.EVENT_WRITE)
        selector.register(stdout, selectors.EVENT_READ)
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise GuardedWorkerError("timeout")
            for key, _ in selector.select(remaining):
                if key.fileobj is stdin:
                    try:
                        written += os.write(stdin.fileno(), view[written : written + _CHUNK])
                    except BlockingIOError:
                        continue
                    except BrokenPipeError:
                        written = len(view)  # the child stopped reading: nothing more to send
                    if written >= len(view):
                        selector.unregister(stdin)
                        stdin.close()
                    continue
                chunk = os.read(stdout.fileno(), _CHUNK)
                if not chunk:
                    selector.unregister(stdout)
                    continue
                output += chunk
                if len(output) > limits.output_bytes:
                    raise GuardedWorkerError("output_too_large", over_limits=True)
    return bytes(output)


def collect(command: Sequence[str], request: bytes, limits: GuardLimits) -> tuple[int, bytes]:
    """Run ``command`` with ``request`` on stdin under the parent's limits; its exit status and
    stdout. Raises :class:`GuardedWorkerError` when it overruns its time or output."""
    deadline = time.monotonic() + limits.wall_seconds
    try:
        process = subprocess.Popen(  # noqa: S603 - our own interpreter and module, no shell
            list(command),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env={},
            cwd="/",
            close_fds=True,
        )
    except OSError as exc:
        raise GuardedWorkerError("spawn_failed") from exc
    try:
        output = _exchange(process, request, limits, deadline)
        status = process.wait(timeout=max(0.0, deadline - time.monotonic()))
    except subprocess.TimeoutExpired as exc:
        raise GuardedWorkerError("timeout") from exc
    finally:
        _kill(process)
        for pipe in (process.stdin, process.stdout):
            if pipe is not None and not pipe.closed:
                pipe.close()
    return status, output


def parse_answer(output: bytes) -> GuardedAnswer:
    """The child's answer, or :class:`GuardedRefusal` for a refusal it answered, or
    :class:`GuardedWorkerError` for anything malformed."""
    try:
        frames = unpack(output, max_frames=MAX_ANSWER_FRAMES)
        if not frames:
            raise ProtocolError("no header")
        header = json.loads(frames[0].decode("utf-8"))
    except (ProtocolError, UnicodeDecodeError, ValueError) as exc:
        raise GuardedWorkerError("malformed_output") from exc
    if not isinstance(header, dict) or not isinstance(header.get("ok"), bool):
        raise GuardedWorkerError("malformed_output")
    if not header["ok"]:
        code = header.get("error")
        if not isinstance(code, str) or code not in REFUSAL_CODES:
            raise GuardedWorkerError("malformed_output")
        raise GuardedRefusal(code)
    return GuardedAnswer(header=header, frames=tuple(frames[1:]))


PR_SET_DUMPABLE: Final = 4
"""``<linux/prctl.h>``."""


def protect_parent() -> bool:
    """Workflow 5C review P018: make this (the vision) process non-dumpable, so a child running
    as the same user cannot open its ``/proc`` entries: ``environ`` (the service token Docker
    started it with), ``fd`` (the spooled uploads) or ``mem``, nor attach to it, whatever Yama's
    ``ptrace_scope``. ``execve`` makes each child dumpable again, so the child still reads its
    own entries. ``False`` where there is no ``prctl`` (not Linux); a failing call raises."""
    try:
        prctl = ctypes.CDLL(None, use_errno=True).prctl
    except (OSError, AttributeError):
        return False
    if prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
        errno = ctypes.get_errno()
        raise OSError(errno, os.strerror(errno))
    return True


def _over_limits(status: int) -> bool:
    """Whether the exit ``status`` is the child stopping on its own limits."""
    if status == OVER_LIMITS_EXIT_STATUS:
        return True
    return status < 0 and -status in LIMIT_SIGNALS


def _describe(status: int) -> str:
    if status < 0:
        try:
            return f"killed by {signal.Signals(-status).name}"
        except ValueError:
            return f"killed by signal {-status}"
    return f"exit status {status}"


def run_guarded(
    task: str,
    data: bytes = b"",
    params: Mapping[str, object] | None = None,
    *,
    limits: GuardLimits = DEFAULT_LIMITS,
) -> GuardedAnswer:
    """Run ``task`` over ``data`` in a fresh guarded child and return its answer."""
    header = {
        "task": task,
        "params": dict(params or {}),
        "limits": {
            key: value
            for key, value in asdict(limits).items()
            if key in {"address_space_bytes", "cpu_seconds", "open_files"}
        },
        "max_data_bytes": len(data),
    }
    request = pack([json.dumps(header).encode("ascii"), data])
    command = [sys.executable, "-I", "-B", "-m", WORKER_MODULE]
    try:
        status, output = collect(command, request, limits)
    except GuardedWorkerError as exc:
        logger.warning("guarded %s task failed: %s", task, exc.reason)
        raise
    if status != 0:
        logger.warning("guarded %s task failed: %s", task, _describe(status))
        raise GuardedWorkerError("exit_status", over_limits=_over_limits(status))
    return parse_answer(output)
