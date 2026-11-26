"""Tests of the models-fetch Job's program (C263.5; Workflow 11C Stage 2, chart-11c).

Standard library only, no network: the fetch is an injected runner that writes files, and every
directory is a temporary one. Run from the repository root:

    python3 -I -m unittest discover -s deploy/helm/openverify/files -p 'test_*.py'
"""

from __future__ import annotations

import hashlib
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType

HERE = Path(__file__).resolve().parent
PROGRAM = HERE / "models-fetch.py"


def load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("models_fetch", PROGRAM)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mf = load()

A = "a" * 64
B = "b" * 64
C = "c" * 64


class Recorder:
    """A fetch that records its command and writes one file into --dest, or fails."""

    def __init__(self, status: int = 0) -> None:
        self.calls: list[list[str]] = []
        self.status = status

    def __call__(self, command: Sequence[str]) -> int:
        self.calls.append(list(command))
        dest = Path(command[command.index("--dest") + 1])
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "model.onnx").write_bytes(b"weights")
        return self.status


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "models"
        self.root.mkdir()
        self.manifest = Path(self.tmp.name) / "manifest.json"
        self.manifest.write_bytes(b'{"schema_version": 1, "models": []}\n')
        self.digest = hashlib.sha256(self.manifest.read_bytes()).hexdigest()

    def complete(self, digest: str, mtime: float) -> Path:
        directory = self.root / digest
        directory.mkdir()
        (directory / "model.onnx").write_bytes(b"weights")
        marker = directory / mf.MARKER
        marker.write_text(digest + "\n")
        os.utime(marker, (mtime, mtime))
        return directory

    def argv(self, digest: str | None = None) -> list[str]:
        return [
            digest or self.digest,
            str(self.manifest),
            "/app/scripts/fetch_models.py",
        ]


class ManifestDigest(Base):
    def test_is_the_sha256_of_the_manifest_bytes(self) -> None:
        self.assertEqual(mf.manifest_digest(self.manifest), self.digest)


class Fetch(Base):
    def test_fetches_into_the_digest_directory_with_the_images_script_isolated(
        self,
    ) -> None:
        run = Recorder()
        self.assertEqual(mf.main(self.argv(), root=self.root, run=run), 0)
        self.assertEqual(
            run.calls,
            [
                [
                    sys.executable,
                    "-I",
                    "/app/scripts/fetch_models.py",
                    "--manifest",
                    str(self.manifest),
                    "--dest",
                    str(self.root / self.digest),
                ]
            ],
        )

    def test_marks_the_directory_complete_after_the_fetch(self) -> None:
        mf.main(self.argv(), root=self.root, run=Recorder())
        self.assertEqual(
            (self.root / self.digest / mf.MARKER).read_text(), self.digest + "\n"
        )

    def test_exits_at_once_when_the_directory_is_complete(self) -> None:
        self.complete(self.digest, 1_000)
        run = Recorder()
        self.assertEqual(mf.main(self.argv(), root=self.root, run=run), 0)
        self.assertEqual(run.calls, [])

    def test_a_failed_fetch_answers_its_status_and_marks_nothing(self) -> None:
        self.assertEqual(
            mf.main(self.argv(), root=self.root, run=Recorder(status=1)), 1
        )
        self.assertFalse((self.root / self.digest / mf.MARKER).exists())

    def test_a_failed_fetch_prunes_nothing(self) -> None:
        old = self.complete(A, 1_000)
        older = self.complete(B, 500)
        mf.main(self.argv(), root=self.root, run=Recorder(status=1))
        self.assertTrue(old.exists())
        self.assertTrue(older.exists())

    def test_refuses_a_manifest_whose_digest_is_not_the_charts(self) -> None:
        run = Recorder()
        status = mf.main(self.argv(C), root=self.root, run=run)
        self.assertEqual(status, 2)
        self.assertEqual(run.calls, [])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_refuses_a_digest_that_is_not_64_lower_case_hex(self) -> None:
        self.assertEqual(
            mf.main(
                ["../etc", str(self.manifest), "x"], root=self.root, run=Recorder()
            ),
            2,
        )
        self.assertEqual(
            mf.main(
                [self.digest.upper(), str(self.manifest), "x"],
                root=self.root,
                run=Recorder(),
            ),
            2,
        )

    def test_refuses_the_wrong_number_of_arguments(self) -> None:
        self.assertEqual(mf.main([self.digest], root=self.root, run=Recorder()), 2)


class Prune(Base):
    def test_keeps_the_current_and_the_newest_other_complete_directory(self) -> None:
        self.complete(A, 3_000)
        self.complete(B, 2_000)
        self.complete(C, 1_000)
        removed = mf.prune(self.root, A)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), [A, B])
        self.assertEqual(removed, [self.root / C])

    def test_removes_an_incomplete_directory_that_is_not_current(self) -> None:
        self.complete(A, 3_000)
        (self.root / B).mkdir()
        self.complete(C, 1_000)
        mf.prune(self.root, A)
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), [A, C])

    def test_leaves_entries_that_are_not_digest_directories(self) -> None:
        self.complete(A, 3_000)
        (self.root / "lost+found").mkdir()
        (self.root / "README").write_text("operator's note")
        self.complete(B, 2_000)
        self.complete(C, 1_000)
        mf.prune(self.root, A)
        self.assertEqual(
            sorted(p.name for p in self.root.iterdir()),
            sorted([A, B, "README", "lost+found"]),
        )

    def test_main_prunes_after_a_fetch(self) -> None:
        self.complete(A, 3_000)
        self.complete(B, 2_000)
        mf.main(self.argv(), root=self.root, run=Recorder())
        self.assertEqual(
            sorted(p.name for p in self.root.iterdir()), sorted([self.digest, A])
        )

    def test_main_prunes_when_already_complete(self) -> None:
        self.complete(self.digest, 4_000)
        self.complete(A, 3_000)
        self.complete(B, 2_000)
        mf.main(self.argv(), root=self.root, run=Recorder())
        self.assertEqual(
            sorted(p.name for p in self.root.iterdir()), sorted([self.digest, A])
        )


class AsTheJobRunsIt(Base):
    def test_runs_as_python3_isolated_with_the_program_as_c(self) -> None:
        # The Job passes this file as -c; a missing fetch script fails the fetch, not the program.
        program = PROGRAM.read_text()
        result = subprocess.run(
            [
                sys.executable,
                "-I",
                "-c",
                program,
                "../x",
                str(self.manifest),
                "/nonexistent.py",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("digest", result.stderr)


if __name__ == "__main__":
    unittest.main()
