#!/usr/bin/env python3
"""C215.1, C215.4: the consumer R8 rules each published module ships, read back from the minified demo.

Run after ``./gradlew :openverify-sdk:assemble assembleDebug :demo-app:assembleRelease``, from the
repository root or from ``android/``::

    python3 -I android/scripts/check-consumer-rules.py

The KMP library plugin has no build types, so a library's rules can only be proven by a consumer
that R8 minifies: the demo's ``release`` build type (and ``minifiedSmoke``, the same build signed for
the device tests, checked too when it was built). The check reads what R8 wrote for that build:

1. each library's built AAR ships exactly the rules of its committed ``consumer-rules.pro`` as its
   ``proguard.txt`` (``LIBRARIES``: the SDK, openverify-nfc and openverify-face, each built by the
   task its entry names);
2. R8's merged ``configuration.txt`` of the demo carries the SDK's rules (they reached the consumer
   without the demo naming them) and zxing-cpp's own rule from its AAR;
3. R8's ``mapping.txt``: the SDK's activity is present under its name. Nothing in the SDK reads a
   class name as text any more (KP10-56: ``FlowApiException.InvalidResponse.decodeFailure`` is a
   fixed code chosen by type), so R8 may rename kotlinx.serialization's exceptions, and the SDK
   ships no consumer rule; its section of the merged configuration is checked only when it has one.

What it cannot show is that the minified app runs. That is the demo's smoke device test on the
``minifiedSmoke`` build, which needs a device.
"""

from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path
from typing import NamedTuple

ANDROID = Path(__file__).resolve().parent.parent
SDK_RULES_PATH = ANDROID / "openverify-sdk/consumer-rules.pro"
NFC_RULES_PATH = ANDROID / "openverify-nfc/consumer-rules.pro"
SDK_AAR = ANDROID / "openverify-sdk/build/outputs/aar/openverify-sdk.aar"
NFC_AAR = ANDROID / "openverify-nfc/build/outputs/aar/openverify-nfc-release.aar"
FACE_RULES_PATH = ANDROID / "openverify-face/consumer-rules.pro"
FACE_AAR = ANDROID / "openverify-face/build/outputs/aar/openverify-face-release.aar"


class Library(NamedTuple):
    """A published library module: its committed rules, the AAR that must ship them, and the task that builds it."""

    module: str
    rules: Path
    aar: Path
    task: str


# Every library module of the build, in settings.gradle.kts' order (a test holds the two together).
LIBRARIES = (
    Library("openverify-sdk", SDK_RULES_PATH, SDK_AAR, ":openverify-sdk:assemble"),
    Library("openverify-nfc", NFC_RULES_PATH, NFC_AAR, ":openverify-nfc:assembleRelease"),
    Library("openverify-face", FACE_RULES_PATH, FACE_AAR, ":openverify-face:assembleRelease"),
)
MAPPINGS = ANDROID / "demo-app/build/outputs/mapping"

SDK_ACTIVITY = "dev.openverify.sdk.OpenVerifyInquiryActivity"
ZXING_SECTION = "io.github.zxing-cpp:android"
ZXING_RULE = "-keep class zxingcpp.** { *; }"

CLASS_LINE = re.compile(r"^(\S+) -> (\S+):$")
SECTION_START = "# The proguard configuration file for the following section is "
SECTION_END = "# End of content from "


def active_rules(text: str) -> list[str]:
    """The rules of a ProGuard file: its lines without comments and blank lines."""
    rules = []
    for line in text.splitlines():
        rule = line.split("#", 1)[0].strip()
        if rule:
            rules.append(rule)
    return rules


def class_names(mapping: str) -> dict[str, str]:
    """Original class name to the name R8 gave it, from the class lines of a mapping file."""
    names = {}
    for line in mapping.splitlines():
        if line and not line[0].isspace() and line[0] != "#":
            match = CLASS_LINE.match(line)
            if match:
                names[match.group(1)] = match.group(2)
    return names


def mapping_problems(mapping: str) -> list[str]:
    names = class_names(mapping)
    if SDK_ACTIVITY not in names:
        return [f"{SDK_ACTIVITY} is not in the mapping: without it the check proves nothing"]
    if names[SDK_ACTIVITY] != SDK_ACTIVITY:
        return [f"{SDK_ACTIVITY} was renamed to {names[SDK_ACTIVITY]}"]
    return []


def consumer_section(configuration: str, marker: str) -> str | None:
    """The rules R8's merged configuration holds for the library whose section title names ``marker``."""
    lines = configuration.splitlines()
    for index, line in enumerate(lines):
        if line.startswith(SECTION_START) and marker in line:
            body = []
            for following in lines[index + 1 :]:
                if following.startswith(SECTION_END):
                    return "\n".join(body) + "\n"
                body.append(following)
    return None


def configuration_problems(configuration: str, sdk_rules: str) -> list[str]:
    problems = []
    section = consumer_section(configuration, ":openverify-sdk")
    if section is None:
        if active_rules(sdk_rules):
            problems.append("R8's merged configuration holds no section of :openverify-sdk: its consumer rules did not reach the demo")
    elif active_rules(section) != active_rules(sdk_rules):
        problems.append(f"R8's merged configuration holds {active_rules(section)} for :openverify-sdk, not the committed {active_rules(sdk_rules)}")
    zxing = consumer_section(configuration, ZXING_SECTION)
    if zxing is None or ZXING_RULE not in active_rules(zxing):
        problems.append(f"zxing-cpp's own rule ({ZXING_RULE}) did not arrive from its AAR: the SDK would have to ship it")
    return problems


def aar_rules(aar: Path) -> list[str]:
    """The consumer rules an AAR ships (its ``proguard.txt``); none when it has no such file."""
    with zipfile.ZipFile(aar) as archive:
        if "proguard.txt" not in archive.namelist():
            return []
        return active_rules(archive.read("proguard.txt").decode("utf-8"))


def check_r8_outputs(folder: Path, label: str, sdk_rules: str) -> list[str]:
    """The problems of one minified build, from R8's configuration.txt and mapping.txt in ``folder``."""
    configuration = (folder / "configuration.txt").read_text(encoding="utf-8")
    mapping = (folder / "mapping.txt").read_text(encoding="utf-8")
    return [f"{label}: {problem}" for problem in configuration_problems(configuration, sdk_rules) + mapping_problems(mapping)]


def aar_problems(library: Library) -> list[str]:
    """Why ``library``'s built AAR does not ship its committed rules; empty when it does."""
    wanted = active_rules(library.rules.read_text(encoding="utf-8"))
    if not library.aar.is_file():
        return [f"{library.aar} is missing: run ./gradlew {library.task}"]
    shipped = aar_rules(library.aar)
    if shipped != wanted:
        return [f"{library.aar.name} ships {shipped}, not the committed rules of {library.module} {wanted}"]
    return []


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--consumer", type=Path, help="check only this folder of R8 outputs (android/consumer-check's, built from the staged AARs)")
    args = parser.parse_args(argv)
    failures: list[str] = []
    sdk_rules = SDK_RULES_PATH.read_text(encoding="utf-8")

    if args.consumer:
        if not (args.consumer / "mapping.txt").is_file() or not (args.consumer / "configuration.txt").is_file():
            failures.append(f"{args.consumer} holds no R8 output")
        else:
            failures.extend(check_r8_outputs(args.consumer, "consumer", sdk_rules))
            if not failures:
                print("consumer: R8's merged configuration holds the SDK's committed rules, and the mapping keeps the SDK's activity")
        for failure in failures:
            print(f"FAIL: {failure}")
        print("check-consumer-rules: " + ("failed" if failures else "passed (R8's outputs only; the minified app was not run)"))
        return 1 if failures else 0

    for library in LIBRARIES:
        problems = aar_problems(library)
        failures.extend(problems)
        if not problems:
            print(f"AAR: {library.aar.name} ships {len(aar_rules(library.aar))} consumer rule(s), as committed")

    for variant, required in (("release", True), ("minifiedSmoke", False)):
        folder = MAPPINGS / variant
        if not (folder / "mapping.txt").is_file() or not (folder / "configuration.txt").is_file():
            if required:
                failures.append(f"{folder} holds no R8 output: run ./gradlew :demo-app:assembleRelease")
            else:
                print(f"{variant}: not built here, not checked (the device-test build: ./gradlew :demo-app:assembleMinifiedSmoke)")
            continue
        problems = check_r8_outputs(folder, variant, sdk_rules)
        failures.extend(problems)
        if not problems:
            print(f"{variant}: R8's merged configuration holds the SDK's committed rules, and the mapping keeps the SDK's activity")

    for failure in failures:
        print(f"FAIL: {failure}")
    print("check-consumer-rules: " + ("failed" if failures else "passed (R8's outputs only; the minified app was not run)"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
