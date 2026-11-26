#!/usr/bin/env python3
"""C216.2, C216.3: the minified demo's download and install size per ABI against the committed baseline.

Run after ``python3 -I scripts/fetch_bundletool.py`` and ``./gradlew :demo-app:bundleRelease``, from
the repository root or from ``android/``::

    python3 -I android/scripts/check-size.py                       # the SDK-only configuration
    python3 -I android/scripts/check-size.py --configuration sdk,nfc --bundle <that build's .aab>
    python3 -I android/scripts/check-size.py --configuration sdk,nfc,face   # after -PopenverifyDemoArtifacts=sdk,nfc,face :demo-app:bundleRelease
    python3 -I android/scripts/check-size.py --write-baseline      # after a change that is meant to grow it

It fails when a figure grew by more than ``tolerance_percent`` (10) over ``android/size-baseline.json``.
A growth that is meant goes in with a baseline change in the same commit, where a reviewer sees it.

It also fails when a figure is above its configuration's **absolute cap** (``CAPS``; C216.2, set by
Workflow 10E), which a baseline change cannot move: the caps are constants of this script. Each cap
is the largest ABI's figure as Workflow 10E measured it with the official ONNX Runtime 1.31.0 AAR
(the custom-build spike of C205.5 was not measured: the build host has no Android NDK), plus
``CAP_MARGIN_PERCENT`` (25), rounded up to a whole MiB. Provisional: a cap changes only with a
recorded reason, never to make a build pass.

**What is measured** (every figure is measured, none estimated; bundletool is the pinned one):

- ``download_bytes``: ``bundletool get-size total --dimensions=ABI``, the MAX column: the largest
  compressed download of the APKs Google Play would serve a device of that ABI, over every screen
  density, language and Android version the bundle splits by.
- ``install_bytes``: the bytes of the APK files ``bundletool extract-apks`` selects for one reference
  device of that ABI (``REFERENCE_DEVICE``), as they are stored on the device. It leaves out what
  Android adds after install (ART's compiled code, the app's data).

The demo app is the yardstick, so the figures are the demo with the SDK, not the SDK's own cost.

**Configurations** are only those whose artifacts exist in full (C216.3): ``sdk``, ``sdk,nfc``
(openverify-nfc with its JMRTD reader), ``sdk,face`` (openverify-face with ONNX Runtime) and
``sdk,nfc,face``. No Play Integrity artifact exists (Phase 10 P3 was declined). The bundle of a
configuration is recognised by the NFC permission that only openverify-nfc's manifest declares and
by ONNX Runtime's native library, ``libonnxruntime.so``, that only openverify-face brings, so a
bundle built for one configuration cannot be measured as another.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ANDROID = Path(__file__).resolve().parent.parent
BASELINE_PATH = ANDROID / "size-baseline.json"
DEFAULT_BUNDLE = ANDROID / "demo-app/build/outputs/bundle/release"
TOLERANCE_PERCENT = 10
NFC_PERMISSION = 'android:name="android.permission.NFC"'

# The device the install size is measured for: a current phone profile. Provisional; changing it
# changes every install figure, so it changes with the baseline.
REFERENCE_DEVICE = {"sdkVersion": 34, "screenDensity": 480, "locale": "en"}

ORT_LIBRARY = "libonnxruntime.so"

CONFIGURATIONS = {
    "sdk": {"label": "the demo with openverify-sdk only", "nfc": False, "face": False},
    "sdk,nfc": {"label": "the demo with openverify-sdk and openverify-nfc (the JMRTD reader with Bouncy Castle)", "nfc": True, "face": False},
    "sdk,face": {"label": "the demo with openverify-sdk and openverify-face (YuNet through ONNX Runtime)", "nfc": False, "face": True},
    "sdk,nfc,face": {"label": "the demo with openverify-sdk, openverify-nfc (the JMRTD reader with Bouncy Castle) and openverify-face (YuNet through ONNX Runtime)", "nfc": True, "face": True},
}

# C216.2: the absolute caps, in bytes, for every ABI of a configuration. Each is the largest ABI's
# figure of android/size-baseline.json as Workflow 10E measured it (2026-11-11, bundletool 1.18.3,
# the official onnxruntime-android 1.31.0 AAR), plus CAP_MARGIN_PERCENT, rounded up to a whole MiB.
# Provisional. A baseline change does not move them.
CAP_MARGIN_PERCENT = 25
MEBIBYTE = 1024 * 1024
CAPS: dict[str, dict[str, int]] = {
    # measured largest ABI (x86 or x86_64): download 3,448,225; install 7,193,626
    "sdk": {"download_bytes": 5 * MEBIBYTE, "install_bytes": 9 * MEBIBYTE},
    # download 4,972,850; install 11,016,120
    "sdk,nfc": {"download_bytes": 6 * MEBIBYTE, "install_bytes": 14 * MEBIBYTE},
    # download 18,911,915; install 48,502,596
    "sdk,face": {"download_bytes": 23 * MEBIBYTE, "install_bytes": 58 * MEBIBYTE},
    # download 20,441,242; install 52,320,994
    "sdk,nfc,face": {"download_bytes": 25 * MEBIBYTE, "install_bytes": 63 * MEBIBYTE},
}

FIGURES = {"download_bytes": "download", "install_bytes": "install"}


class SizeError(Exception):
    """A report, baseline or configuration this check cannot use."""


def parse_sizes(report: str) -> dict[str, int]:
    """The MAX column of ``bundletool get-size total --dimensions=ABI`` per ABI."""
    lines = [line.strip() for line in report.splitlines() if line.strip()]
    if "ABI,MIN,MAX" not in lines:
        raise SizeError("no ABI,MIN,MAX table in bundletool's size report")
    sizes: dict[str, int] = {}
    for line in lines[lines.index("ABI,MIN,MAX") + 1 :]:
        parts = line.split(",")
        if len(parts) != 3 or not parts[1].isdigit() or not parts[2].isdigit():
            raise SizeError(f"unreadable size row: {line}")
        sizes[parts[0]] = int(parts[2])
    if not sizes:
        raise SizeError("bundletool's size report holds no ABI")
    return sizes


def compare(baseline: dict[str, dict[str, int]], measured: dict[str, dict[str, int]], tolerance_percent: int) -> list[str]:
    """One failure per figure that grew past the tolerance and per ABI on one side only."""
    failures = []
    for abi in sorted(set(baseline) | set(measured)):
        if abi not in baseline:
            failures.append(f"{abi}: measured but not in the baseline (a new ABI needs a baseline change)")
            continue
        if abi not in measured:
            failures.append(f"{abi}: in the baseline but not measured (the bundle no longer holds this ABI)")
            continue
        for figure, word in FIGURES.items():
            before, now = baseline[abi][figure], measured[abi][figure]
            # Integer arithmetic: now may be at most before * (100 + tolerance) / 100.
            if now * 100 > before * (100 + tolerance_percent):
                grown = (now - before) * 100 / before
                failures.append(f"{abi}: the {word} size grew from {before} to {now} bytes (+{grown:.1f}%, above {tolerance_percent}%)")
    return failures


def shrunk(baseline: dict[str, dict[str, int]], measured: dict[str, dict[str, int]], tolerance_percent: int) -> list[str]:
    """Notes, not failures: figures that fell by more than the tolerance, so the baseline can follow."""
    notes = []
    for abi in sorted(set(baseline) & set(measured)):
        for figure, word in FIGURES.items():
            before, now = baseline[abi][figure], measured[abi][figure]
            if now * 100 < before * (100 - tolerance_percent):
                notes.append(f"{abi}: the {word} size fell from {before} to {now} bytes; lower the baseline (--write-baseline)")
    return notes


def over_cap(caps: dict[str, int], measured: dict[str, dict[str, int]]) -> list[str]:
    """One failure per figure above its absolute cap (C216.2)."""
    failures = []
    for abi in sorted(measured):
        for figure, word in FIGURES.items():
            if measured[abi][figure] > caps[figure]:
                failures.append(f"{abi}: the {word} size is {measured[abi][figure]} bytes, above the absolute cap of {caps[figure]} bytes (C216.2; the cap changes only with a recorded reason)")
    return failures


def configuration_problem(configuration: str, manifest: str, entries: list[str]) -> str | None:
    """Why this bundle (its manifest, and the names of its ``entries``) is not this configuration's, or ``None``."""
    if configuration not in CONFIGURATIONS:
        raise SizeError(f"'{configuration}' is no size configuration: only {', '.join(sorted(CONFIGURATIONS))} exist (C216.3)")
    wanted = CONFIGURATIONS[configuration]
    nfc = NFC_PERMISSION in manifest
    if wanted["nfc"] != nfc:
        if nfc:
            return f"the bundle declares the NFC permission, so it was built with openverify-nfc, not as '{configuration}'"
        return f"the bundle declares no NFC permission, so it was built without openverify-nfc, not as '{configuration}'"
    face = any(name.rsplit("/", 1)[-1] == ORT_LIBRARY for name in entries)
    if wanted["face"] != face:
        if face:
            return f"the bundle holds {ORT_LIBRARY}, so it was built with openverify-face, not as '{configuration}'"
        return f"the bundle holds no {ORT_LIBRARY}, so it was built without openverify-face, not as '{configuration}'"
    return None


def device_spec(abi: str) -> dict:
    return {
        "supportedAbis": [abi],
        "supportedLocales": [REFERENCE_DEVICE["locale"]],
        "screenDensity": REFERENCE_DEVICE["screenDensity"],
        "sdkVersion": REFERENCE_DEVICE["sdkVersion"],
    }


def empty_baseline() -> dict:
    return {
        "tool": "bundletool (the version scripts/fetch_bundletool.py pins), over :demo-app:bundleRelease (minified, resources shrunk, R8 full mode)",
        "download_bytes": "measured: bundletool get-size total --dimensions=ABI, the MAX column (the largest compressed download for that ABI)",
        "install_bytes": "measured: the bytes of the APK files bundletool extract-apks selects for the reference device of that ABI, as stored on the device; without ART's compiled code and the app's data",
        "reference_device": dict(REFERENCE_DEVICE),
        "tolerance_percent": TOLERANCE_PERCENT,
        "configurations": {},
    }


def with_configuration(document: dict, configuration: str, measured: dict[str, dict[str, int]]) -> dict:
    document["configurations"][configuration] = {"label": CONFIGURATIONS[configuration]["label"], "abis": measured}
    return document


def baseline_of(document: dict, configuration: str) -> dict[str, dict[str, int]]:
    try:
        return document["configurations"][configuration]["abis"]
    except (KeyError, TypeError) as error:
        raise SizeError(f"the baseline holds no configuration '{configuration}': measure it with --write-baseline") from error


def parse(text: str) -> dict:
    return json.loads(text)


def render(document: dict) -> str:
    ordered = dict(document)
    ordered["configurations"] = {
        name: {"label": entry["label"], "abis": {abi: entry["abis"][abi] for abi in sorted(entry["abis"])}}
        for name, entry in sorted(document["configurations"].items())
    }
    return json.dumps(ordered, indent=2, ensure_ascii=False) + "\n"


def bundletool(jar: Path, *arguments: str) -> str:
    result = subprocess.run(["java", "-jar", str(jar), *arguments], capture_output=True, text=True, check=False)
    if result.returncode:
        raise SizeError(f"bundletool {arguments[0]} exited {result.returncode}: {result.stderr.strip()[:400]}")
    return result.stdout


def measure(jar: Path, bundle: Path, configuration: str) -> dict[str, dict[str, int]]:
    with zipfile.ZipFile(bundle) as archive:
        entries = archive.namelist()
    problem = configuration_problem(configuration, bundletool(jar, "dump", "manifest", f"--bundle={bundle}"), entries)
    if problem:
        raise SizeError(problem)
    with tempfile.TemporaryDirectory() as scratch:
        apks = Path(scratch) / "demo.apks"
        bundletool(jar, "build-apks", f"--bundle={bundle}", f"--output={apks}")
        downloads = parse_sizes(bundletool(jar, "get-size", "total", f"--apks={apks}", "--dimensions=ABI"))
        measured = {}
        for abi in sorted(downloads):
            spec = Path(scratch) / f"{abi}.json"
            spec.write_text(json.dumps(device_spec(abi)), encoding="utf-8")
            out = Path(scratch) / abi
            bundletool(jar, "extract-apks", f"--apks={apks}", f"--output-dir={out}", f"--device-spec={spec}")
            installed = sum(path.stat().st_size for path in out.glob("*.apk"))
            if not installed:
                raise SizeError(f"bundletool selected no APK for {abi}")
            measured[abi] = {"download_bytes": downloads[abi], "install_bytes": installed}
    return measured


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--configuration", default="sdk", help="sdk (default), sdk,nfc, sdk,face or sdk,nfc,face: what the bundle was built with")
    parser.add_argument("--bundle", type=Path, help="the release bundle to measure (default: demo-app's release output)")
    parser.add_argument("--baseline", type=Path, default=BASELINE_PATH)
    parser.add_argument("--write-baseline", action="store_true", help="write the measured figures as this configuration's baseline")
    args = parser.parse_args(argv)

    try:
        jars = sorted((ANDROID / "build/bundletool").glob("bundletool-all-*.jar"))
        if len(jars) != 1:
            raise SizeError("bundletool was not found: run python3 -I scripts/fetch_bundletool.py")
        bundles = [args.bundle] if args.bundle else sorted(DEFAULT_BUNDLE.glob("*.aab"))
        if len(bundles) != 1 or not bundles[0].is_file():
            raise SizeError("the release bundle is missing: run ./gradlew :demo-app:bundleRelease")
        measured = measure(jars[0], bundles[0], args.configuration)
        print(f"check-size: '{args.configuration}' ({CONFIGURATIONS[args.configuration]['label']}), measured with {jars[0].name} over {bundles[0].name}")
        for abi, figures in measured.items():
            print(f"  {abi}: download {figures['download_bytes']} bytes, install {figures['install_bytes']} bytes")
        document = parse(args.baseline.read_text(encoding="utf-8")) if args.baseline.is_file() else empty_baseline()
        if args.write_baseline:
            if args.configuration in CAPS and over_cap(CAPS[args.configuration], measured):
                raise SizeError("; ".join(over_cap(CAPS[args.configuration], measured)))
            args.baseline.write_text(render(with_configuration(document, args.configuration, measured)), encoding="utf-8")
            print(f"check-size: wrote the baseline of '{args.configuration}' to {args.baseline.name}; commit it with the change that moved it")
            return 0
        tolerance = document["tolerance_percent"]
        baseline = baseline_of(document, args.configuration)
        failures = compare(baseline, measured, tolerance) + over_cap(CAPS[args.configuration], measured)
    except SizeError as error:
        print(f"FAIL: {error}")
        print("check-size: failed")
        return 1
    for note in shrunk(baseline, measured, tolerance):
        print(f"note: {note}")
    for failure in failures:
        print(f"FAIL: {failure}")
    print("check-size: " + ("failed (a growth that is meant needs a baseline change in the same commit)" if failures else f"passed (no figure grew by more than {tolerance}% over the baseline or is above its absolute cap)"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
