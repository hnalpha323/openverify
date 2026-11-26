"""C216.1: the 16 KB checks, over synthetic ELF headers, archives and bundle configurations."""

from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from support import PT_DYNAMIC, PT_LOAD, PT_NOTE, elf, load

check = load("check-elf-alignment")

KB16 = 16384
KB4 = 4096


def archive(directory: Path, name: str, entries: dict[str, bytes]) -> Path:
    path = directory / name
    with zipfile.ZipFile(path, "w") as out:
        for entry, data in entries.items():
            out.writestr(entry, data)
    return path


class LoadAlignments(unittest.TestCase):
    def test_reads_the_alignment_of_every_load_segment_and_of_no_other(self) -> None:
        data = elf([(PT_LOAD, KB16), (PT_NOTE, 4), (PT_LOAD, 65536), (PT_DYNAMIC, 8)])
        self.assertEqual([KB16, 65536], check.load_alignments(data))

    def test_reads_32_bit_and_big_endian_headers(self) -> None:
        self.assertEqual([KB16, KB4], check.load_alignments(elf([(PT_LOAD, KB16), (PT_LOAD, KB4)], bits=32)))
        self.assertEqual([KB16], check.load_alignments(elf([(PT_LOAD, KB16)], bits=64, little=False)))
        self.assertEqual([KB16], check.load_alignments(elf([(PT_LOAD, KB16)], bits=32, little=False)))

    def test_refuses_what_is_not_an_elf_file(self) -> None:
        for data in (b"", b"PK\x03\x04", b"\x7fELF", b"\x7fELF\x03\x01\x01" + bytes(60)):
            with self.subTest(data=data[:8]), self.assertRaises(check.ElfError):
                check.load_alignments(data)

    def test_refuses_a_program_header_table_past_the_end_of_the_file(self) -> None:
        with self.assertRaises(check.ElfError):
            check.load_alignments(elf([(PT_LOAD, KB16), (PT_LOAD, KB16)])[:-10])


class LibraryProblem(unittest.TestCase):
    def test_a_library_whose_load_segments_are_all_16_kb_aligned_has_no_problem(self) -> None:
        self.assertIsNone(check.library_problem(elf([(PT_LOAD, KB16), (PT_LOAD, 65536)])))
        self.assertIsNone(check.library_problem(elf([(PT_LOAD, KB16)], bits=32)))

    def test_a_4_kb_segment_is_named_with_its_alignment(self) -> None:
        problem = check.library_problem(elf([(PT_LOAD, KB16), (PT_LOAD, KB4)]))
        self.assertIsNotNone(problem)
        self.assertIn("4096", problem)

    def test_an_alignment_that_is_no_multiple_of_16_kb_is_a_problem(self) -> None:
        self.assertIsNotNone(check.library_problem(elf([(PT_LOAD, KB16 + KB4)])))
        self.assertIsNotNone(check.library_problem(elf([(PT_LOAD, 0)])))

    def test_a_library_with_no_load_segment_is_a_problem_not_a_pass(self) -> None:
        self.assertIsNotNone(check.library_problem(elf([(PT_NOTE, 4)])))

    def test_a_file_that_is_no_elf_is_a_problem_not_a_crash(self) -> None:
        self.assertIsNotNone(check.library_problem(b"not a library"))


class ScanArchive(unittest.TestCase):
    def test_an_aar_is_read_under_jni_and_an_apk_under_lib(self) -> None:
        good, bad = elf([(PT_LOAD, KB16)]), elf([(PT_LOAD, KB4)])
        with tempfile.TemporaryDirectory() as tmp:
            aar = archive(Path(tmp), "x.aar", {"jni/arm64-v8a/liba.so": good, "jni/x86_64/libb.so": bad, "classes.jar": b"x", "lib/arm64-v8a/libc.so": bad})
            apk = archive(Path(tmp), "x.apk", {"lib/arm64-v8a/liba.so": good, "lib/x86/libb.so": bad, "jni/x86/libc.so": bad, "assets/lib/x/liba.so": bad})
            found = check.scan_archive(aar, "jni")
            self.assertEqual(["jni/arm64-v8a/liba.so", "jni/x86_64/libb.so"], [name for name, _ in found])
            self.assertEqual([True, False], [problem is None for _, problem in found])
            found = check.scan_archive(apk, "lib")
            self.assertEqual(["lib/arm64-v8a/liba.so", "lib/x86/libb.so"], [name for name, _ in found])
            self.assertEqual([True, False], [problem is None for _, problem in found])

    def test_an_archive_without_native_code_answers_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual([], check.scan_archive(archive(Path(tmp), "x.aar", {"classes.jar": b"x"}), "jni"))


class CheckArchives(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.good, self.bad = elf([(PT_LOAD, KB16)]), elf([(PT_LOAD, KB4)])

    def test_aars_without_native_code_and_an_aligned_apk_pass_and_the_counts_are_said(self) -> None:
        aar = archive(self.dir, "sdk.aar", {"classes.jar": b"x"})
        apk = archive(self.dir, "demo.apk", {"lib/arm64-v8a/libz.so": self.good, "lib/x86_64/libz.so": self.good})
        lines, failures = check.check_archives([aar], apk)
        self.assertEqual([], failures)
        text = "\n".join(lines)
        self.assertIn("0 native libraries in 1 AAR", text)
        self.assertIn("2 native libraries", text)

    def test_a_misaligned_library_in_an_aar_or_in_the_apk_fails_with_its_archive_and_entry(self) -> None:
        aar = archive(self.dir, "face.aar", {"jni/arm64-v8a/libort.so": self.bad})
        apk = archive(self.dir, "demo.apk", {"lib/arm64-v8a/libz.so": self.good, "lib/x86/libq.so": self.bad})
        _, failures = check.check_archives([aar], apk)
        self.assertEqual(2, len(failures))
        self.assertIn("face.aar", failures[0])
        self.assertIn("jni/arm64-v8a/libort.so", failures[0])
        self.assertIn("lib/x86/libq.so", failures[1])

    def test_no_aar_at_all_fails_because_nothing_was_built(self) -> None:
        apk = archive(self.dir, "demo.apk", {"lib/arm64-v8a/libz.so": self.good})
        _, failures = check.check_archives([], apk)
        self.assertEqual(1, len(failures))

    def test_an_apk_without_any_native_library_fails_because_the_scan_would_prove_nothing(self) -> None:
        aar = archive(self.dir, "sdk.aar", {"classes.jar": b"x"})
        apk = archive(self.dir, "demo.apk", {"classes.dex": b"x"})
        _, failures = check.check_archives([aar], apk)
        self.assertEqual(1, len(failures))
        self.assertIn("demo.apk", failures[0])

    def test_a_missing_apk_fails(self) -> None:
        aar = archive(self.dir, "sdk.aar", {"classes.jar": b"x"})
        _, failures = check.check_archives([aar], self.dir / "absent.apk")
        self.assertEqual(1, len(failures))


class BundleAlignment(unittest.TestCase):
    def config(self, native: object) -> str:
        return json.dumps({"bundletool": {"version": "1.18.3"}, "optimizations": {"uncompressNativeLibraries": native}})

    def test_reads_the_page_alignment_of_a_bundle_configuration(self) -> None:
        self.assertEqual("PAGE_ALIGNMENT_16K", check.bundle_alignment(self.config({"enabled": True, "alignment": "PAGE_ALIGNMENT_16K"})))
        self.assertEqual("PAGE_ALIGNMENT_4K", check.bundle_alignment(self.config({"enabled": True, "alignment": "PAGE_ALIGNMENT_4K"})))

    def test_a_configuration_that_names_no_alignment_answers_none(self) -> None:
        self.assertIsNone(check.bundle_alignment(self.config({"enabled": True})))
        self.assertIsNone(check.bundle_alignment(json.dumps({"optimizations": {}})))
        self.assertIsNone(check.bundle_alignment("not json"))

    def test_only_16_kb_passes(self) -> None:
        self.assertIsNone(check.bundle_problem(self.config({"enabled": True, "alignment": "PAGE_ALIGNMENT_16K"})))
        self.assertIn("PAGE_ALIGNMENT_4K", check.bundle_problem(self.config({"enabled": True, "alignment": "PAGE_ALIGNMENT_4K"})))
        self.assertIsNotNone(check.bundle_problem(self.config({"enabled": True})))


class NewestBuildTools(unittest.TestCase):
    def test_picks_the_highest_version_by_number_not_by_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for version in ("9.0.0", "35.0.1", "36.0.0", "36.1.0-rc1"):
                (root / "build-tools" / version).mkdir(parents=True)
                (root / "build-tools" / version / "zipalign").write_text("")
            (root / "build-tools" / "37.0.0").mkdir()  # holds no zipalign
            self.assertEqual(root / "build-tools" / "36.1.0-rc1" / "zipalign", check.newest_zipalign(root))

    def test_answers_none_without_any(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(check.newest_zipalign(Path(tmp)))


if __name__ == "__main__":
    unittest.main()
