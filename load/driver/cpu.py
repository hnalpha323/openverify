"""Each generator's CPU share and affinity (C268.6): read from `/proc`, never assumed.

The share is (utime + stime) from `/proc/<pid>/stat` over the take's window, divided by the window,
as a share of one logical CPU; the affinity is the CPU list the kernel reports for the process
(`Cpus_allowed_list` in `/proc/<pid>/status`), so the report states what `taskset` really set.
"""

from __future__ import annotations

import os
from pathlib import Path

PROC = Path("/proc")


def clock_ticks() -> int:
    """The kernel's clock ticks a second (`SC_CLK_TCK`), the unit of utime and stime."""
    return os.sysconf("SC_CLK_TCK")


def proc_cpu_seconds(pid: int, *, proc: Path = PROC, ticks: int | None = None) -> float:
    """utime + stime of `pid` in seconds, from `/proc/<pid>/stat` (fields 14 and 15)."""
    text = (proc / str(pid) / "stat").read_text(encoding="ascii")
    # The command name (field 2) is in parentheses and may hold spaces: split after its last ')'.
    fields = text[text.rindex(")") + 2 :].split()
    utime, stime = int(fields[11]), int(fields[12])
    return (utime + stime) / (ticks if ticks is not None else clock_ticks())


def proc_affinity(pid: int, *, proc: Path = PROC) -> str:
    """The CPUs `pid` may run on, as the kernel lists them (for example "10" or "0-9")."""
    for line in (proc / str(pid) / "status").read_text(encoding="ascii").splitlines():
        if line.startswith("Cpus_allowed_list:"):
            return line.split(":", 1)[1].strip()
    raise ValueError(f"/proc/{pid}/status names no Cpus_allowed_list")


def cpu_share(cpu_start: float, cpu_end: float, wall_seconds: float) -> float:
    """CPU seconds over a window as a share of one logical CPU (0 for an empty window)."""
    if wall_seconds <= 0:
        return 0.0
    return max(0.0, cpu_end - cpu_start) / wall_seconds
