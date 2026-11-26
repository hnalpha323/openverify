"""Each generator's CPU share and affinity, read from /proc (C268.6)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from driver.cpu import clock_ticks, cpu_share, proc_affinity, proc_cpu_seconds


def fake_proc(tmp_path: Path, stat: str, status: str) -> Path:
    pid = tmp_path / "4242"
    pid.mkdir()
    (pid / "stat").write_text(stat, encoding="ascii")
    (pid / "status").write_text(status, encoding="ascii")
    return tmp_path


def test_utime_and_stime_after_a_command_name_with_spaces(tmp_path: Path) -> None:
    # Fields 14 and 15 (utime, stime) are 300 and 100 ticks.
    fields = " ".join(
        ["S", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "300", "100", "0", "0"]
    )
    proc = fake_proc(tmp_path, f"4242 (vegeta (attack)) {fields}\n", "Name:\tvegeta\n")
    assert proc_cpu_seconds(4242, proc=proc, ticks=100) == pytest.approx(4.0)


def test_the_affinity_as_the_kernel_lists_it(tmp_path: Path) -> None:
    proc = fake_proc(tmp_path, "4242 (x) S\n", "Name:\tvegeta\nCpus_allowed_list:\t10\n")
    assert proc_affinity(4242, proc=proc) == "10"
    empty = tmp_path / "other"
    empty.mkdir()
    (empty / "4242").mkdir()
    (empty / "4242" / "status").write_text("Name:\tx\n", encoding="ascii")
    with pytest.raises(ValueError, match="Cpus_allowed_list"):
        proc_affinity(4242, proc=empty)


def test_this_process_is_readable() -> None:
    assert proc_cpu_seconds(os.getpid()) >= 0
    assert proc_affinity(os.getpid()) != ""
    assert clock_ticks() > 0


def test_a_share_of_one_cpu() -> None:
    assert cpu_share(1.0, 4.0, 10.0) == pytest.approx(0.3)
    assert cpu_share(1.0, 4.0, 0.0) == 0.0
    assert cpu_share(4.0, 1.0, 10.0) == 0.0
