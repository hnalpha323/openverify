#!/usr/bin/env python3
"""C216.1: the three 16 KB page-size checks of the minified demo and of every built AAR.

Run after ``python3 -I scripts/fetch_bundletool.py`` and the Android gate's builds
(``:openverify-sdk:assemble``, ``:demo-app:assembleRelease :demo-app:bundleRelease``), from the
repository root or from ``android/``::

    python3 -I android/scripts/check-elf-alignment.py

It checks, and fails on the first kind of thing it cannot check:

1. **ELF.** The ``p_align`` of every ``PT_LOAD`` segment of every ``jni/*/*.so`` in every built AAR
   (each module's ``build/outputs/aar/`` and the staged repository), and of every ``lib/*/*.so`` in
   the minified demo APK. Our own AARs hold no native code yet, so the APK scan is what reaches the
   libraries a host really ships (zxing-cpp's and CameraX's, which arrive as dependencies). An APK
   without any native library fails: the scan would prove nothing.
2. **zipalign.** ``zipalign -c -P 16 -v 4`` on that APK, with the newest build-tools under
   ``ANDROID_HOME`` (``-P`` needs build-tools 35 or later).
3. **bundletool.** ``bundletool dump config`` on the demo's release bundle names
   ``PAGE_ALIGNMENT_16K``.

Every library must be aligned, on the 32-bit ABIs too: Google Play's rule covers 64-bit devices
only, but every library Phase 10 ships is aligned on all four ABIs (C216.1), so a 4 KB library on
any ABI is a change to look at. Nothing here runs on a device: a library that is aligned and still
fails when loaded on a 16 KB device is what the release matrix's 16 KB emulator leg would show.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

PAGE_16K = 16384
PT_LOAD = 1
EXPECTED_ALIGNMENT = "PAGE_ALIGNMENT_16K"

ANDROID = Path(__file__).resolve().parent.parent


class ElfError(Exception):
    """The bytes are not an ELF file this reader understands."""


def load_alignments(data: bytes) -> list[int]:
    """The ``p_align`` of every ``PT_LOAD`` program header, in file order."""
    if len(data) < 16 or data[:4] != b"\x7fELF":
        raise ElfError("not an ELF file")
    width, encoding = data[4], data[5]
    if width not in (1, 2) or encoding not in (1, 2):
        raise ElfError("unknown ELF class or byte order")
    order = "<" if encoding == 1 else ">"
    # e_phoff, then e_phentsize and e_phnum; the fields between them differ in width by class.
    if width == 2:
        header, offset_format, offset_at, sizes_at, align_format, align_at, entry_min = 64, "Q", 32, 54, "Q", 48, 56
    else:
        header, offset_format, offset_at, sizes_at, align_format, align_at, entry_min = 52, "I", 28, 42, "I", 28, 32
    if len(data) < header:
        raise ElfError("truncated ELF header")
    (offset,) = struct.unpack_from(order + offset_format, data, offset_at)
    entry_size, count = struct.unpack_from(order + "HH", data, sizes_at)
    if count and entry_size < entry_min:
        raise ElfError("program header entries are too small")
    if offset + entry_size * count > len(data):
        raise ElfError("the program header table runs past the end of the file")
    alignments = []
    for index in range(count):
        at = offset + index * entry_size
        (kind,) = struct.unpack_from(order + "I", data, at)
        if kind == PT_LOAD:
            (alignment,) = struct.unpack_from(order + align_format, data, at + align_at)
            alignments.append(alignment)
    return alignments


def library_problem(data: bytes) -> str | None:
    """Why this library is not 16 KB-aligned, or ``None`` when every load segment is."""
    try:
        alignments = load_alignments(data)
    except ElfError as error:
        return str(error)
    if not alignments:
        return "no PT_LOAD segment"
    wrong = sorted({alignment for alignment in alignments if alignment < PAGE_16K or alignment % PAGE_16K})
    if wrong:
        return "p_align " + ", ".join(str(alignment) for alignment in wrong) + f" (every load segment needs a multiple of {PAGE_16K})"
    return None


def scan_archive(path: Path, prefix: str) -> list[tuple[str, str | None]]:
    """Every ``<prefix>/<abi>/<name>.so`` of a zip archive with its problem (``None`` when aligned)."""
    pattern = re.compile(rf"^{re.escape(prefix)}/[^/]+/[^/]+\.so$")
    with zipfile.ZipFile(path) as archive:
        names = sorted(name for name in archive.namelist() if pattern.match(name))
        return [(name, library_problem(archive.read(name))) for name in names]


def plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun.removesuffix('y') + 'ies' if noun.endswith('y') else noun + 's'}"


def check_archives(aars: list[Path], apk: Path) -> tuple[list[str], list[str]]:
    """The ELF check over the AARs and the APK: the lines to print and the failures."""
    lines: list[str] = []
    failures: list[str] = []
    if not aars:
        failures.append("no AAR was found: build them first (./gradlew :openverify-sdk:assemble assembleDebug)")
    libraries = 0
    for aar in aars:
        for name, problem in scan_archive(aar, "jni"):
            libraries += 1
            if problem:
                failures.append(f"{aar.name}: {name}: {problem}")
    lines.append(f"ELF: {plural(libraries, 'native library')} in {plural(len(aars), 'AAR')} ({', '.join(sorted({aar.name for aar in aars})) or 'none'})")
    if not apk.is_file():
        failures.append(f"{apk}: the minified demo APK is missing: run ./gradlew :demo-app:assembleRelease")
        return lines, failures
    found = scan_archive(apk, "lib")
    for name, problem in found:
        if problem:
            failures.append(f"{apk.name}: {name}: {problem}")
    if not found:
        failures.append(f"{apk.name}: no lib/*/*.so: the scan would prove nothing (zxing-cpp's library is expected)")
    lines.append(f"ELF: {plural(len(found), 'native library')} in {apk.name}")
    for name, problem in found:
        lines.append(f"  {name}: {problem or '16 KB-aligned'}")
    return lines, failures


def bundle_alignment(config: str) -> str | None:
    """The page alignment ``bundletool dump config`` reports for uncompressed native libraries."""
    try:
        document = json.loads(config)
        alignment = document["optimizations"]["uncompressNativeLibraries"]["alignment"]
    except (ValueError, KeyError, TypeError):
        return None
    return alignment if isinstance(alignment, str) else None


def bundle_problem(config: str) -> str | None:
    alignment = bundle_alignment(config)
    if alignment == EXPECTED_ALIGNMENT:
        return None
    return f"the bundle's page alignment is {alignment or 'not stated'}, not {EXPECTED_ALIGNMENT}"


def version_key(name: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", name))


def newest_zipalign(sdk: Path) -> Path | None:
    """``zipalign`` of the highest build-tools version under an Android SDK."""
    tools = sorted((path for path in (sdk / "build-tools").glob("*/zipalign") if path.is_file()), key=lambda path: version_key(path.parent.name))
    return tools[-1] if tools else None


def only(paths: list[Path], what: str) -> Path:
    if len(paths) != 1:
        raise SystemExit(f"check-elf-alignment: expected one {what}, found {len(paths)}: {[str(path) for path in paths]}")
    return paths[0]


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apk", type=Path, help="the minified demo APK (default: demo-app's release output)")
    parser.add_argument("--bundle", type=Path, help="the demo's release bundle (default: demo-app's release output)")
    args = parser.parse_args(argv)

    apk = args.apk or only(sorted((ANDROID / "demo-app/build/outputs/apk/release").glob("*.apk")), "release APK (run ./gradlew :demo-app:assembleRelease)")
    bundle = args.bundle or only(sorted((ANDROID / "demo-app/build/outputs/bundle/release").glob("*.aab")), "release bundle (run ./gradlew :demo-app:bundleRelease)")
    aars = sorted(ANDROID.glob("*/build/outputs/aar/*.aar")) + sorted((ANDROID / "build/staging-repo").rglob("*.aar"))

    lines, failures = check_archives(aars, apk)
    print("\n".join(lines))

    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    zipalign = newest_zipalign(Path(sdk)) if sdk else None
    if zipalign is None:
        failures.append("zipalign was not found: set ANDROID_HOME to an SDK with build-tools 35 or later")
    elif apk.is_file():
        result = run([str(zipalign), "-c", "-P", "16", "-v", "4", str(apk)])
        if result.returncode == 0:
            checked = sum(1 for line in result.stdout.splitlines() if ".so " in line)
            print(f"zipalign: {zipalign.parent.name} -c -P 16 -v 4 {apk.name}: verified ({checked} libraries listed)")
        else:
            bad = [line.strip() for line in result.stdout.splitlines() if "BAD" in line][:10]
            failures.append(f"zipalign -c -P 16 -v 4 {apk.name} exited {result.returncode}: {'; '.join(bad) or result.stderr.strip()[:300]}")

    bundletool = sorted((ANDROID / "build/bundletool").glob("bundletool-all-*.jar"))
    if len(bundletool) != 1:
        failures.append("bundletool was not found: run python3 -I scripts/fetch_bundletool.py")
    else:
        result = run(["java", "-jar", str(bundletool[0]), "dump", "config", f"--bundle={bundle}"])
        problem = f"bundletool dump config exited {result.returncode}: {result.stderr.strip()[:300]}" if result.returncode else bundle_problem(result.stdout)
        if problem:
            failures.append(f"{bundle.name}: {problem}")
        else:
            print(f"bundletool: {bundletool[0].name} dump config {bundle.name}: {EXPECTED_ALIGNMENT}")

    for failure in failures:
        print(f"FAIL: {failure}")
    print("check-elf-alignment: " + ("failed" if failures else "passed (static checks only; nothing was loaded on a 16 KB device)"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
