"""Shared helpers of the release-check script tests: loading a hyphenated script as a module, and
building synthetic ELF files. Nothing here reads a real library, APK or size report."""

from __future__ import annotations

import importlib.util
import struct
from pathlib import Path
from types import ModuleType

SCRIPTS = Path(__file__).resolve().parent.parent

PT_LOAD = 1
PT_DYNAMIC = 2
PT_NOTE = 4


def load(script: str) -> ModuleType:
    """Loads ``android/scripts/<script>.py`` under an importable name."""
    path = SCRIPTS / f"{script}.py"
    spec = importlib.util.spec_from_file_location(script.replace("-", "_"), path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def elf(segments: list[tuple[int, int]], *, bits: int = 64, little: bool = True) -> bytes:
    """An ELF file of ``bits`` width that holds only its header and the program headers of
    ``segments``, each ``(p_type, p_align)``."""
    order = "<" if little else ">"
    ident = b"\x7fELF" + bytes([2 if bits == 64 else 1, 1 if little else 2, 1]) + bytes(9)
    count = len(segments)
    if bits == 64:
        header_size, entry_size = 64, 56
        header = struct.pack(order + "HHIQQQIHHHHHH", 3, 183, 1, 0, header_size, 0, 0, header_size, entry_size, count, 0, 0, 0)
        entries = b"".join(struct.pack(order + "IIQQQQQQ", kind, 5, 0, 0, 0, 0, 0, align) for kind, align in segments)
    else:
        header_size, entry_size = 52, 32
        header = struct.pack(order + "HHIIIIIHHHHHH", 3, 40, 1, 0, header_size, 0, 0, header_size, entry_size, count, 0, 0, 0)
        entries = b"".join(struct.pack(order + "IIIIIIII", kind, 0, 0, 0, 0, 0, 5, align) for kind, align in segments)
    return ident + header + entries
