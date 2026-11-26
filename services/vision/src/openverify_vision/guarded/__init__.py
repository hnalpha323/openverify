"""C60.2: the guarded child that parses every PDF and decodes every JPEG 2000.

The parent (:mod:`openverify_vision.guarded.runner`) starts ``python -I -B -m
openverify_vision.guarded.worker`` with an empty environment and the request on stdin; the child
sets ``PR_SET_NO_NEW_PRIVS`` and its rlimits before the first byte of the document is read, and
imports only the standard library, pypdfium2, pypdf and Pillow. The parent kills it after
:attr:`GuardLimits.wall_seconds`, reads at most :attr:`GuardLimits.output_bytes` of its stdout and
validates its answer with pydantic.

This package's ``__init__`` and every module the child imports use the standard library only:
the child must never load pydantic, NumPy, OpenCV or onnxruntime (a test asserts it).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

WORKER_MODULE: Final = "openverify_vision.guarded.worker"
"""What the parent runs with ``python -I -B -m``."""

MIB: Final = 1024 * 1024


@dataclass(frozen=True, slots=True)
class GuardLimits:
    """The C60.2 limits of one guarded child. Production uses :data:`DEFAULT_LIMITS`; tests
    lower them to watch a child being stopped."""

    address_space_bytes: int = 1536 * MIB
    """``RLIMIT_AS``: 1.5 GiB of address space."""
    cpu_seconds: int = 20
    """``RLIMIT_CPU`` soft limit (``SIGXCPU``); the hard limit is one second more (``SIGKILL``)."""
    open_files: int = 64
    """``RLIMIT_NOFILE``."""
    wall_seconds: float = 30.0
    """The parent kills the child after this long, whatever it is doing."""
    output_bytes: int = 64 * MIB
    """The most of the child's stdout the parent reads; more kills it."""


DEFAULT_LIMITS: Final = GuardLimits()
"""C60.2 as planned: 1.5 GiB, 20 s of CPU, 64 files, a 30 s kill timer and 64 MiB of output.
``RLIMIT_FSIZE``, ``RLIMIT_CORE`` and ``RLIMIT_NPROC`` are always 0 and not configurable."""
