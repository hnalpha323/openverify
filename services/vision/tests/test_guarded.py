"""C60.2: the guarded child and the parent that runs it.

Every PDF and every JPEG 2000 decode runs in a fresh ``python -I -B -m
openverify_vision.guarded.worker`` with an empty environment, ``PR_SET_NO_NEW_PRIVS`` and the
plan's rlimits; the parent kills it after its wall-clock budget, reads at most 64 MiB of its
answer and refuses anything malformed. These tests start real children: the ``probe`` task
reports the child's own view of its limits and, on request, overruns them on purpose.
"""

from __future__ import annotations

import ctypes
import errno
import io
import json
import pathlib
import subprocess
import sys
import time
from typing import Any, Final

import pytest

from openverify_vision.guarded import DEFAULT_LIMITS, MIB, WORKER_MODULE, GuardLimits
from openverify_vision.guarded.protocol import (
    MAGIC,
    OVER_LIMITS_EXIT_STATUS,
    ProtocolError,
    pack,
    read_frame,
    unpack,
)
from openverify_vision.guarded.runner import (
    REFUSAL_CODES,
    GuardedRefusal,
    GuardedWorkerError,
    collect,
    parse_answer,
    run_guarded,
)
from openverify_vision.guarded.worker import run_task
from openverify_vision.settings import Settings

ALLOWED_THIRD_PARTY = frozenset(
    {"pypdfium2", "pypdfium2_raw", "pypdfium2_cfg", "pypdf", "PIL", "openverify_vision"}
)
"""C60.2: besides the standard library, the only packages the child may load (pypdfium2's
distribution installs three top-level modules)."""

INTERPRETER_HOOKS = frozenset({"sitecustomize"})
"""What the interpreter's own installation may load at start-up: Debian and Ubuntu ship a
``sitecustomize`` with ``libpython3.12-minimal``; the ``python:3.12-slim`` image has none."""

FORBIDDEN = frozenset({"numpy", "cv2", "onnxruntime", "pydantic", "fastapi", "starlette"})


def framed(*frames: bytes) -> bytes:
    """The wire format, written out independently of :func:`pack`: the magic, then each frame's
    4-byte big-endian length and bytes."""
    return MAGIC + b"".join(len(frame).to_bytes(4, "big") + frame for frame in frames)


# --- the framing -------------------------------------------------------------------------------


def test_frames_round_trip() -> None:
    frames = [b'{"ok": true}', b"", b"\x00\x01\x02"]
    assert pack(frames) == framed(*frames)
    assert unpack(pack(frames), max_frames=3) == frames


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"OVG2" + b"\x00\x00\x00\x00",
        MAGIC + b"\x00\x00\x00\x05abc",
        MAGIC + b"\x00\x00",
        framed(b"{}") + b"!",
    ],
    ids=["empty", "bad-magic", "cut-frame", "cut-length", "trailing-bytes"],
)
def test_malformed_framing_is_refused(data: bytes) -> None:
    with pytest.raises(ProtocolError):
        unpack(data, max_frames=4)


def test_more_frames_than_allowed_are_refused() -> None:
    with pytest.raises(ProtocolError):
        unpack(framed(b"a", b"b", b"c"), max_frames=2)


def test_a_frame_longer_than_allowed_is_refused_before_it_is_read() -> None:
    stream = io.BytesIO(b"\x00\x00\x10\x00" + b"x" * 16)
    with pytest.raises(ProtocolError):
        read_frame(stream, max_bytes=1024)


def test_a_frame_is_read_from_a_stream() -> None:
    stream = io.BytesIO(b"\x00\x00\x00\x03abc rest")
    assert read_frame(stream, max_bytes=16) == b"abc"


def test_a_frame_cut_short_is_refused() -> None:
    with pytest.raises(ProtocolError):
        read_frame(io.BytesIO(b"\x00\x00\x00\x09abc"), max_bytes=16)


# --- the limits as planned ---------------------------------------------------------------------


def test_the_default_limits_are_the_plans() -> None:
    assert WORKER_MODULE == "openverify_vision.guarded.worker"
    planned = GuardLimits(
        address_space_bytes=1536 * MIB,
        cpu_seconds=20,
        open_files=64,
        wall_seconds=30.0,
        output_bytes=64 * MIB,
    )
    assert planned == DEFAULT_LIMITS


def test_the_child_runs_under_the_plans_rlimits_and_without_new_privileges() -> None:
    report = run_guarded("probe").header["probe"]
    assert report["rlimits"] == {
        "as": [1536 * MIB, 1536 * MIB],
        "cpu": [20, 21],
        "fsize": [0, 0],
        "core": [0, 0],
        "nofile": [64, 64],
        "nproc": [0, 0],
    }
    assert report["no_new_privs"] == 1


def test_the_child_starts_with_an_empty_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    # The service token, and anything else of the parent's, must never reach the child.
    monkeypatch.setenv("OPENVERIFY_VISION_SERVICE_TOKEN", "t" * 40)
    report = run_guarded("probe").header["probe"]
    # The block execve received, not os.environ: CPython's own LC_CTYPE (PEP 538) is not in it.
    assert report["environ"] == []


def test_the_probe_sees_an_environment_the_child_was_started_with(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Workflow 5C review P010, the control for the test above: had the parent let its
    # environment through, the probe must report it, whatever harden() clears afterwards.
    real = subprocess.Popen

    def inheriting(*args: Any, **kwargs: Any) -> subprocess.Popen[bytes]:
        kwargs.pop("env", None)
        return real(*args, **kwargs)

    monkeypatch.setenv("OPENVERIFY_VISION_SERVICE_TOKEN", "t" * 40)
    monkeypatch.setattr(subprocess, "Popen", inheriting)
    report = run_guarded("probe").header["probe"]
    assert "OPENVERIFY_VISION_SERVICE_TOKEN" in report["environ"]


def test_the_child_is_spawned_with_an_empty_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    # Workflow 5C review P010: the spawn itself passes no environment.
    real = subprocess.Popen
    seen: list[object] = []

    def spy(*args: Any, **kwargs: Any) -> subprocess.Popen[bytes]:
        seen.append(kwargs.get("env"))
        return real(*args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", spy)
    run_guarded("probe")
    assert seen == [{}]


PARENT: Final = """
import json, sys
from openverify_vision.guarded.runner import protect_parent, run_guarded
if sys.argv[1] == "protected":
    assert protect_parent() is True
print(json.dumps(run_guarded("probe", params={"read_parent": True}).header["probe"]["parent"]))
"""
"""A vision parent started, as Docker starts it, with the service token in its environment."""


def parent_seen_by_its_child(mode: str) -> dict[str, bool]:
    done = subprocess.run(  # noqa: S603 - our own interpreter and script
        [sys.executable, "-I", "-c", PARENT, mode],
        env={"OPENVERIFY_VISION_SERVICE_TOKEN": "t" * 40},
        capture_output=True,
        check=True,
        timeout=60,
    )
    view: dict[str, bool] = json.loads(done.stdout)
    return view


def test_a_child_can_read_an_unprotected_parents_proc_entries() -> None:
    # Workflow 5C review P018, the control: /proc/<ppid>/environ and fd need only the same uid
    # (Yama restricts attaching, not reading), whatever the child's own limits.
    assert parent_seen_by_its_child("unprotected") == {
        "environ_readable": True,
        "token_seen": True,
        "fds_readable": True,
    }


def test_a_protected_parent_keeps_its_token_and_its_files_from_the_child() -> None:
    assert parent_seen_by_its_child("protected") == {
        "environ_readable": False,
        "token_seen": False,
        "fds_readable": False,
    }


class FakeLibc:
    def __init__(self, answer: int | None) -> None:
        self.answer = answer

    def __getattr__(self, name: str) -> Any:
        if self.answer is None:
            raise AttributeError(name)

        def call(*_args: object) -> int | None:
            ctypes.set_errno(errno.EPERM)
            return self.answer

        return call


@pytest.mark.parametrize(("answer", "expected"), [(None, False), (0, True)], ids=["none", "set"])
def test_protecting_the_parent_needs_prctl(
    monkeypatch: pytest.MonkeyPatch, answer: int | None, expected: bool
) -> None:
    from openverify_vision.guarded import runner  # noqa: PLC0415

    monkeypatch.setattr(ctypes, "CDLL", lambda *_args, **_kwargs: FakeLibc(answer))
    assert runner.protect_parent() is expected


def test_a_failing_prctl_is_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    from openverify_vision.guarded import runner  # noqa: PLC0415

    monkeypatch.setattr(ctypes, "CDLL", lambda *_args, **_kwargs: FakeLibc(-1))
    with pytest.raises(PermissionError, match="Operation not permitted"):
        runner.protect_parent()


def test_the_app_protects_its_process_when_it_is_created(monkeypatch: pytest.MonkeyPatch) -> None:
    from openverify_vision import app  # noqa: PLC0415

    calls: list[str] = []

    def protect() -> bool:
        calls.append("protect")
        return True

    monkeypatch.setattr(app, "protect_parent", protect, raising=False)
    app.create_app(Settings.model_validate({"service_token": "s" * 40}))
    assert calls == ["protect"]


def test_the_child_loads_only_the_standard_library_and_the_pdf_and_image_libraries() -> None:
    report = run_guarded("probe", params={"import_tasks": True}).header["probe"]
    modules = set(report["modules"])
    assert FORBIDDEN.isdisjoint(modules), sorted(FORBIDDEN & modules)
    known = set(sys.stdlib_module_names) | ALLOWED_THIRD_PARTY | INTERPRETER_HOOKS | {"__main__"}
    unexpected = modules - known
    assert unexpected == set()
    assert {"pypdfium2", "pypdf", "PIL"} <= modules


def test_the_child_can_start_no_process_and_no_thread() -> None:
    report = run_guarded("probe").header["probe"]
    assert report["fork_refused"] is True
    assert report["thread_refused"] is True


# --- overruns: the parent survives and answers a worker failure --------------------------------


def test_a_child_over_its_address_space_is_stopped() -> None:
    limits = GuardLimits(address_space_bytes=256 * MIB)
    with pytest.raises(GuardedWorkerError) as caught:
        run_guarded("probe", params={"allocate_mib": 512}, limits=limits)
    assert caught.value.reason == "exit_status"
    # Workflow 5C review P003: stopped by its own limits, which a retry cannot cure.
    assert caught.value.over_limits is True


def test_a_child_over_its_cpu_time_is_stopped() -> None:
    limits = GuardLimits(cpu_seconds=1, wall_seconds=20.0)
    started = time.monotonic()
    with pytest.raises(GuardedWorkerError) as caught:
        run_guarded("probe", params={"spin": True}, limits=limits)
    assert caught.value.reason == "exit_status"
    assert caught.value.over_limits is True
    assert time.monotonic() - started < 10


def test_a_child_past_its_wall_clock_budget_is_killed() -> None:
    limits = GuardLimits(wall_seconds=0.5)
    started = time.monotonic()
    with pytest.raises(GuardedWorkerError) as caught:
        run_guarded("probe", params={"sleep_seconds": 10}, limits=limits)
    assert caught.value.reason == "timeout"
    # The kill timer counts wall time, which a loaded host stretches: not the child's own limit.
    assert caught.value.over_limits is False
    assert time.monotonic() - started < 5


def test_a_child_writing_more_than_its_output_cap_is_killed() -> None:
    limits = GuardLimits(output_bytes=MIB)
    with pytest.raises(GuardedWorkerError) as caught:
        run_guarded("probe", params={"output_bytes": 2 * MIB}, limits=limits)
    assert caught.value.reason == "output_too_large"
    assert caught.value.over_limits is True


def test_output_within_the_cap_is_returned_as_a_frame() -> None:
    answer = run_guarded("probe", params={"output_bytes": 1000})
    assert answer.frames == (b"\x00" * 1000,)


def test_a_child_that_never_reads_its_input_cannot_block_the_parent() -> None:
    command = [sys.executable, "-I", "-c", "import time; time.sleep(30)"]
    started = time.monotonic()
    with pytest.raises(GuardedWorkerError) as caught:
        collect(command, b"x" * (8 * MIB), GuardLimits(wall_seconds=1.0))
    assert caught.value.reason == "timeout"
    assert time.monotonic() - started < 5


def test_the_exit_status_of_the_child_is_returned() -> None:
    status, output = collect(
        [sys.executable, "-I", "-c", "import sys; sys.stdout.write('hi'); sys.exit(3)"],
        b"",
        DEFAULT_LIMITS,
    )
    assert (status, output) == (3, b"hi")


def test_an_unknown_task_is_a_worker_failure() -> None:
    with pytest.raises(GuardedWorkerError) as caught:
        run_guarded("no_such_task")
    assert caught.value.reason == "exit_status"
    # An error of the child's own code is ours, not the document's limits.
    assert caught.value.over_limits is False


# --- the answer --------------------------------------------------------------------------------


@pytest.mark.parametrize("code", sorted(REFUSAL_CODES))
def test_a_refusal_is_raised_with_its_code(code: str) -> None:
    output = framed(f'{{"ok": false, "error": "{code}"}}'.encode())
    with pytest.raises(GuardedRefusal) as caught:
        parse_answer(output)
    assert caught.value.code == code


@pytest.mark.parametrize(
    "output",
    [
        b"junk",
        framed(b"not json"),
        framed(b"[]"),
        framed(b'{"ok": "yes"}'),
        framed(b'{"ok": false, "error": "made_up"}'),
        framed(b"\xff\xfe"),
        framed(),
    ],
    ids=["unframed", "not-json", "list", "ok-not-bool", "unknown-code", "not-utf8", "no-header"],
)
def test_a_malformed_answer_is_a_worker_failure(output: bytes) -> None:
    with pytest.raises(GuardedWorkerError) as caught:
        parse_answer(output)
    assert caught.value.reason == "malformed_output"


def test_an_answer_keeps_its_frames_in_order() -> None:
    answer = parse_answer(framed(b'{"ok": true, "n": 2}', b"one", b"two"))
    assert answer.header == {"ok": True, "n": 2}
    assert answer.frames == (b"one", b"two")


# --- the worker's own dispatch, in process -----------------------------------------------------


def test_the_probe_runs_in_process_too() -> None:
    header, frames = run_task("probe", {"output_bytes": 3}, b"")
    assert header["ok"] is True
    assert set(header["probe"]) >= {"rlimits", "no_new_privs", "environ", "modules"}
    assert frames == [b"\x00\x00\x00"]


def test_the_worker_refuses_an_unknown_task_in_process() -> None:
    with pytest.raises(ValueError, match="unknown task"):
        run_task("no_such_task", {}, b"")


def test_main_reads_the_request_then_hardens_then_answers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # In process, with harden() recorded rather than applied to the test process itself.
    from openverify_vision.guarded import worker  # noqa: PLC0415

    order: list[str] = []
    monkeypatch.setattr(worker, "harden", lambda limits: order.append(f"harden {limits}"))
    header = (
        b'{"task": "probe", "params": {"output_bytes": 2}, "max_data_bytes": 4, '
        b'"limits": {"address_space_bytes": 1, "cpu_seconds": 2, "open_files": 3}}'
    )

    class Stream:
        def __init__(self, data: bytes) -> None:
            self.buffer = io.BytesIO(data)

    stdout = Stream(b"")
    monkeypatch.setattr(sys, "stdin", Stream(framed(header, b"data")))
    monkeypatch.setattr(sys, "stdout", stdout)
    assert worker.main() == 0
    assert order == ["harden {'address_space_bytes': 1, 'cpu_seconds': 2, 'open_files': 3}"]
    answer = parse_answer(stdout.buffer.getvalue())
    assert answer.header["ok"] is True
    assert answer.frames == (b"\x00\x00",)


def test_main_ends_with_the_over_limits_status_when_memory_runs_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Workflow 5C review P003, in process: harden() recorded, the task out of address space.
    from openverify_vision.guarded import worker  # noqa: PLC0415

    def out_of_memory(*_args: object) -> None:
        raise MemoryError

    monkeypatch.setattr(worker, "harden", lambda _limits: None)
    monkeypatch.setattr(worker, "run_task", out_of_memory)
    header = (
        b'{"task": "probe", "params": {}, "max_data_bytes": 0, '
        b'"limits": {"address_space_bytes": 1, "cpu_seconds": 2, "open_files": 3}}'
    )

    class Stream:
        def __init__(self, data: bytes) -> None:
            self.buffer = io.BytesIO(data)

    monkeypatch.setattr(sys, "stdin", Stream(framed(header, b"")))
    with pytest.raises(SystemExit) as caught:
        worker.main()
    assert caught.value.code == OVER_LIMITS_EXIT_STATUS


def test_the_probe_reports_no_environment_without_proc(monkeypatch: pytest.MonkeyPatch) -> None:
    def unreadable(_path: object) -> bytes:
        raise FileNotFoundError("/proc/self/environ")

    monkeypatch.setattr(pathlib.Path, "read_bytes", unreadable)
    header, _ = run_task("probe", {}, b"")
    assert header["probe"]["environ"] is None


def test_the_probe_overruns_on_request_in_process() -> None:
    header, _ = run_task("probe", {"allocate_mib": 1, "sleep_seconds": 0.01}, b"")
    assert header["probe"]["held_bytes"] == MIB
    assert header["probe"]["fork_refused"] is False  # this process has no RLIMIT_NPROC 0
