#!/usr/bin/env python3
"""C217.2, C217.3: the staged Maven repository under ``android/build/staging-repo/`` is complete.

Run after ``./gradlew publishAllPublicationsToStagingRepository``, from the repository root or from
``android/`` (``./gradlew -p consumer-check build`` runs it too)::

    python3 -I android/scripts/check-staged-repository.py

The publishing plugin validates a deployment only at the Central Portal, which nothing here reaches
(the upload is the owner's, Phase 10 P4). So this check holds the staged repository to what the
Portal would ask for, and to what this release promises:

- exactly four modules at the one version: ``openverify-sdk`` (the root KMP module),
  ``openverify-sdk-android`` (its Android target), ``openverify-nfc`` and ``openverify-face``
  (Workflow 10E; no Play Integrity artifact exists, Phase 10 P3); nothing for iOS, no demo;
- for each: the POM, the Gradle module metadata, the artifact, a sources jar and a javadoc jar, every
  file with ``.md5``, ``.sha1``, ``.sha256`` and ``.sha512`` files that match it;
- each POM: its own coordinates, no ``-SNAPSHOT``, ``name``, ``description``, ``url``, a licence
  (Apache-2.0 for the SDK and openverify-face, LGPL-3.0-or-later for openverify-nfc), a developer, and ``scm`` with
  ``connection``, ``developerConnection`` and ``url``;
- the Android target's POM gives OkHttp and androidx.activity at scope ``compile`` (each is in a public
  signature, C214.4: ``OpenVerifyInquiry.Contract`` extends ``ActivityResultContract``) and
  names no optional or copyleft artifact (C191.2);
- each optional artifact's POM names only the libraries reserved for it (``RESERVED_FOR``): the reader's
  LGPL stack and Bouncy Castle only in openverify-nfc, ONNX Runtime only in openverify-face, no
  ``com.google.android.play`` module anywhere (Phase 10 P3), and no optional artifact names another;
- the root's Gradle metadata points its Android variants at the staged Android target;
- the Android target's AAR ships the committed consumer rules, its javadoc jar holds real pages and
  its sources jar holds Kotlin;
- each optional artifact's AAR carries its licence papers (``LICENCE_PAPERS``; review E001), byte for
  byte the committed files: for openverify-nfc, inside ``classes.jar``, its ``NOTICE``, the LGPL-2.1,
  LGPL-3.0, GPL-2.0 and Classpath-exception texts and where the two SCUBA files' source is (the
  conditions of the owner's exception P1); for openverify-face, as assets, its ``NOTICE`` with Eigen's
  source location, ONNX Runtime's licence and third-party notices and YuNet's licence and notice
  (the conditions of P2). The third-party texts are also held to their recorded SHA-256 values;
- no key or keystore lies in the repository.

Signatures (``.asc``) are not asked for: nothing is signed without the owner's key.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ANDROID = Path(__file__).resolve().parent.parent
STAGING = ANDROID / "build/staging-repo"
SDK_RULES_PATH = ANDROID / "openverify-sdk/consumer-rules.pro"

CHECKSUMS = ("md5", "sha1", "sha256", "sha512")
POM_NS = "{http://maven.apache.org/POM/4.0.0}"
KEY_SUFFIXES = (".jks", ".keystore", ".p12", ".pfx", ".pem", ".key", ".gpg", ".kbx")
MIN_JAVADOC_PAGES = 10

# artifact: (packaging suffix of the main file, licence)
MODULES = {
    "openverify-sdk": (".jar", "Apache-2.0"),
    "openverify-sdk-android": (".aar", "Apache-2.0"),
    "openverify-nfc": (".aar", "LGPL-3.0-or-later"),
    "openverify-face": (".aar", "Apache-2.0"),
}
ANDROID_TARGET = "openverify-sdk-android"

# C191.2, C214.6: what the Apache-2.0 SDK never depends on.
FORBIDDEN_GROUPS = ("org.jmrtd", "net.sf.scuba", "org.ejbca", "org.bouncycastle", "com.microsoft.onnxruntime", "com.google.android.play")
OPTIONAL_ARTIFACTS = ("openverify-nfc", "openverify-face", "openverify-integrity-play")

# The groups of FORBIDDEN_GROUPS each optional artifact is built on (C205.1, C209.1; Phase 10 P1 and P2).
# Every other module may name none of them.
RESERVED_FOR = {
    "openverify-nfc": ("org.jmrtd", "net.sf.scuba", "org.ejbca", "org.bouncycastle"),
    "openverify-face": ("com.microsoft.onnxruntime",),
}

# Review E001 (the owner's exceptions P1 and P2 hold only while these travel with the artifact). Per
# optional artifact: the archive inside its AAR that holds its papers (None: the AAR itself), the
# folder of the entries there, the committed folder they are built from, and the files.
LICENCE_PAPERS = {
    "openverify-nfc": (
        "classes.jar",
        "META-INF/openverify-nfc/",
        "openverify-nfc/src/main/resources/META-INF/openverify-nfc/",
        ("NOTICE", "licenses/Classpath-exception-2.0.txt", "licenses/GPL-2.0-only.txt", "licenses/LGPL-2.1-or-later.txt", "licenses/LGPL-3.0-or-later.txt", "licenses/SOURCE.txt"),
    ),
    "openverify-face": (
        None,
        "assets/openverify-face/",
        "openverify-face/",
        ("NOTICE", "licenses/onnxruntime/LICENSE.txt", "licenses/onnxruntime/ThirdPartyNotices.txt", "licenses/yunet/LICENSE.txt", "licenses/yunet/NOTICE.txt"),
    ),
}

# The SHA-256 of each committed third-party text (SPDX license-list-data v3.27.0; ONNX Runtime at its
# v1.31.0 tag; opencv_zoo's YuNet licence), by its path under android/. Our own NOTICE and SOURCE files
# are held only to the committed bytes.
PINNED_TEXTS = {
    "openverify-nfc/src/main/resources/META-INF/openverify-nfc/licenses/Classpath-exception-2.0.txt": "f36ecd7d28dc3c49854d3908a3824696972aed34f5ffe426174f35fb03c5f194",
    "openverify-nfc/src/main/resources/META-INF/openverify-nfc/licenses/GPL-2.0-only.txt": "aaf135472f81c5b4a0dca9367e5bb5e9750032b5bebe5442b36e4c0a47430df3",
    "openverify-nfc/src/main/resources/META-INF/openverify-nfc/licenses/LGPL-2.1-or-later.txt": "5749785c8bdefafcb5d798270ed0a967036fe2ca63dcedade1627565dfef81d2",
    "openverify-nfc/src/main/resources/META-INF/openverify-nfc/licenses/LGPL-3.0-or-later.txt": "996af0513df21f7496288951c41428a03c174e9e4a9d63665c57d670f845ccb1",
    "openverify-face/licenses/onnxruntime/LICENSE.txt": "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c",
    "openverify-face/licenses/onnxruntime/ThirdPartyNotices.txt": "143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3",
    "openverify-face/licenses/yunet/LICENSE.txt": "c83b8120c50ccbd4c4f96edf53141bdd566ebb8f8e9227e415326aa1b1aba958",
}


class RepositoryError(Exception):
    """The repository or its coordinates cannot be read at all."""


def coordinates(properties: str) -> tuple[str, str]:
    """``openverifyGroup`` and ``openverifyVersion`` from ``android/gradle.properties``."""
    values = {}
    for line in properties.splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    try:
        return values["openverifyGroup"], values["openverifyVersion"]
    except KeyError as error:
        raise RepositoryError(f"gradle.properties holds no {error.args[0]}") from error


def active_rules(text: str) -> list[str]:
    return [rule for rule in (line.split("#", 1)[0].strip() for line in text.splitlines()) if rule]


def digest(path: Path, algorithm: str) -> str:
    return hashlib.new(algorithm, path.read_bytes()).hexdigest()


def checksum_problems(path: Path, shown: str) -> list[str]:
    problems = []
    for algorithm in CHECKSUMS:
        side = Path(f"{path}.{algorithm}")
        if not side.is_file():
            problems.append(f"{shown}.{algorithm} is missing")
        elif side.read_text(encoding="utf-8").strip().lower() != digest(path, algorithm):
            problems.append(f"{shown}.{algorithm} is not the file's {algorithm} digest")
    return problems


def text_of(root: ET.Element, path: str) -> str:
    found = root.find("/".join(POM_NS + part for part in path.split("/")))
    return (found.text or "").strip() if found is not None else ""


def pom_problems(path: Path, group: str, artifact: str, version: str, licence: str) -> list[str]:
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as error:
        return [f"{artifact}: the POM does not parse ({error})"]
    problems = []
    for member, wanted in (("groupId", group), ("artifactId", artifact), ("version", version)):
        if text_of(root, member) != wanted:
            problems.append(f"{artifact}: the POM's {member} is '{text_of(root, member)}', not '{wanted}'")
    for member in ("name", "description", "url", "scm/connection", "scm/developerConnection", "scm/url"):
        if not text_of(root, member):
            problems.append(f"{artifact}: the POM has no {member}")
    if not text_of(root, "developers/developer/name") and not text_of(root, "developers/developer/id"):
        problems.append(f"{artifact}: the POM has no developers entry")
    licences = [(entry.findtext(POM_NS + "name") or "").strip() for entry in root.findall(f"{POM_NS}licenses/{POM_NS}license")]
    if licences != [licence]:
        problems.append(f"{artifact}: the POM's licence is {licences or 'missing'}, not {licence}")
    elif not text_of(root, "licenses/license/url"):
        problems.append(f"{artifact}: the POM's licence has no url")
    problems.extend(dependency_problems(root, artifact))
    return problems


def dependency_problems(root: ET.Element, artifact: str) -> list[str]:
    problems = []
    okhttp_scopes = []
    activity_scopes = []
    for entry in root.findall(f"{POM_NS}dependencies/{POM_NS}dependency"):
        group = (entry.findtext(POM_NS + "groupId") or "").strip()
        name = (entry.findtext(POM_NS + "artifactId") or "").strip()
        scope = (entry.findtext(POM_NS + "scope") or "compile").strip()
        reserved = [bad for bad in FORBIDDEN_GROUPS if group == bad or group.startswith(bad + ".")]
        if name in OPTIONAL_ARTIFACTS or any(bad not in RESERVED_FOR.get(artifact, ()) for bad in reserved):
            why = "which is reserved for another artifact (C205.1, C209.1)" if artifact in RESERVED_FOR else "which the Apache-2.0 SDK never does (C191.2)"
            problems.append(f"{artifact}: the POM depends on {group}:{name}, {why}")
        if group == "com.squareup.okhttp3" and name in ("okhttp", "okhttp-android", "okhttp-jvm"):
            okhttp_scopes.append(scope)
        if group == "androidx.activity":
            activity_scopes.append(scope)
    if artifact == ANDROID_TARGET and "compile" not in okhttp_scopes:
        problems.append(f"{artifact}: okhttp is not at scope compile in the POM (found {okhttp_scopes or 'no okhttp'}); it is in a public signature (C214.4)")
    if artifact == ANDROID_TARGET and "compile" not in activity_scopes:
        problems.append(f"{artifact}: androidx.activity is not at scope compile in the POM (found {activity_scopes or 'no androidx.activity'}); it is in a public signature (C214.4)")
    return problems


def root_variants(root: Path, group: str, version: str) -> dict[str, list[str]]:
    """The modules the root's Gradle metadata points at, split by whether they are staged."""
    base = root / group.replace(".", "/")
    document = json.loads((base / "openverify-sdk" / version / f"openverify-sdk-{version}.module").read_text(encoding="utf-8"))
    named = sorted({entry["available-at"]["module"] for entry in document.get("variants", []) if "available-at" in entry})
    staged = [module for module in named if (base / module / version / f"{module}-{version}.module").is_file()]
    return {"staged": staged, "not_staged": [module for module in named if module not in staged]}


def zip_names(path: Path) -> list[str]:
    try:
        with zipfile.ZipFile(path) as archive:
            return archive.namelist()
    except zipfile.BadZipFile:
        return []


def committed_papers(pinned: dict[str, str] | None = None) -> tuple[dict[str, tuple[str | None, dict[str, bytes]]], list[str]]:
    """Each optional artifact's licence papers as committed (entry in the AAR: bytes), and what is wrong with the committed files."""
    pinned = PINNED_TEXTS if pinned is None else pinned
    papers: dict[str, tuple[str | None, dict[str, bytes]]] = {}
    problems = []
    for artifact, (container, entry_folder, committed_folder, names) in LICENCE_PAPERS.items():
        entries = {}
        for name in names:
            path = ANDROID / committed_folder / name
            if not path.is_file():
                problems.append(f"{artifact}: its committed licence paper android/{committed_folder}{name} is missing")
                continue
            entries[entry_folder + name] = path.read_bytes()
            wanted = pinned.get(committed_folder + name)
            if wanted is not None and hashlib.sha256(entries[entry_folder + name]).hexdigest() != wanted:
                problems.append(f"{artifact}: android/{committed_folder}{name} is not the recorded text (SHA-256 {wanted})")
        papers[artifact] = (container, entries)
    return papers, problems


def paper_problems(aar: Path, shown: str, container: str | None, entries: dict[str, bytes]) -> list[str]:
    """What ``aar`` lacks of ``entries``, read from ``container`` inside it (None: from the AAR itself)."""
    where = f"{shown}'s {container}" if container else shown
    held: dict[str, bytes] = {}
    try:
        with zipfile.ZipFile(aar) as archive:
            source = archive
            if container is not None:
                if container not in archive.namelist():
                    return [f"{where} is missing, so its licence paper {name} is missing (the owner's exception requires it)" for name in sorted(entries)]
                source = zipfile.ZipFile(io.BytesIO(archive.read(container)))
            for name in entries:
                if name in source.namelist():
                    held[name] = source.read(name)
    except zipfile.BadZipFile:
        return [f"{where} cannot be read, so its licence paper {name} is missing" for name in sorted(entries)]
    problems = []
    for name in sorted(entries):
        if name not in held:
            problems.append(f"{where}: the licence paper {name} is missing (the owner's exception requires it to travel with the artifact)")
        elif held[name] != entries[name]:
            problems.append(f"{where}: the licence paper {name} is not the committed file")
    return problems


def check_repository(root: Path, group: str, version: str, sdk_rules: str, papers: dict[str, tuple[str | None, dict[str, bytes]]] | None = None) -> list[str]:
    """Every problem of the staged repository at ``root``; empty when it is complete.

    ``papers`` is each optional artifact's licence papers (default: the committed ones, ``committed_papers``).
    """
    if "SNAPSHOT" in version:
        return [f"the version {version} is a SNAPSHOT: Maven Central takes releases only"]
    base = root / group.replace(".", "/")
    if not base.is_dir():
        return [f"{base} is missing: run ./gradlew publishAllPublicationsToStagingRepository first"]
    problems = []
    if papers is None:
        papers, problems = committed_papers()

    for extra in sorted(entry.name for entry in base.iterdir() if entry.is_dir() and entry.name not in MODULES):
        why = "nothing is staged for iOS in this release (C217.1)" if "ios" in extra.lower() else "only the SDK, its Android target, openverify-nfc and openverify-face are published"
        problems.append(f"{extra} is staged: {why}")

    for artifact, (packaging, licence) in MODULES.items():
        folder = base / artifact / version
        stem = f"{artifact}-{version}"
        present = []
        for suffix in (".pom", ".module", packaging, "-sources.jar", "-javadoc.jar"):
            path = folder / f"{stem}{suffix}"
            if path.is_file():
                present.append(suffix)
            else:
                problems.append(f"{stem}{suffix} is missing")
        if folder.is_dir():
            for path in sorted(folder.iterdir()):
                if path.is_file() and path.suffix.lstrip(".") not in CHECKSUMS and path.suffix != ".asc":
                    problems.extend(checksum_problems(path, path.name))
        if ".pom" in present:
            problems.extend(pom_problems(folder / f"{stem}.pom", group, artifact, version, licence))
        if packaging in present and artifact in papers:
            container, entries = papers[artifact]
            problems.extend(paper_problems(folder / f"{stem}{packaging}", f"{stem}{packaging}", container, entries))

    android = base / ANDROID_TARGET / version
    stem = f"{ANDROID_TARGET}-{version}"
    if (android / f"{stem}.aar").is_file():
        names = zip_names(android / f"{stem}.aar")
        shipped = ""
        if "proguard.txt" in names:
            with zipfile.ZipFile(android / f"{stem}.aar") as archive:
                shipped = archive.read("proguard.txt").decode("utf-8")
        if active_rules(shipped) != active_rules(sdk_rules):
            problems.append(f"{stem}.aar: its proguard.txt holds {active_rules(shipped)}, not the committed consumer rules {active_rules(sdk_rules)}")
    if (android / f"{stem}-javadoc.jar").is_file():
        pages = [name for name in zip_names(android / f"{stem}-javadoc.jar") if name.endswith(".html")]
        if len(pages) < MIN_JAVADOC_PAGES:
            problems.append(f"{stem}-javadoc.jar holds {len(pages)} HTML pages: the javadoc jar is Dokka's API documentation, not a placeholder (C217.2)")
    if (android / f"{stem}-sources.jar").is_file():
        if not any(name.endswith(".kt") for name in zip_names(android / f"{stem}-sources.jar")):
            problems.append(f"{stem}-sources.jar holds no Kotlin file: the sources jar is the SDK's sources")

    metadata = base / "openverify-sdk" / version / f"openverify-sdk-{version}.module"
    if metadata.is_file():
        try:
            variants = root_variants(root, group, version)
        except (ValueError, KeyError, TypeError) as error:
            problems.append(f"openverify-sdk: its Gradle metadata cannot be read ({error})")
        else:
            if ANDROID_TARGET not in variants["staged"]:
                problems.append(f"openverify-sdk: its Gradle metadata names no android variant at the staged {ANDROID_TARGET}")

    for path in sorted(root.rglob("*")):
        if path.is_file() and (path.suffix.lower() in KEY_SUFFIXES or path.suffix == ".klib"):
            problems.append(f"{path.relative_to(root)} lies in the staged repository: no key, keystore or klib is ever staged")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repository", type=Path, default=STAGING)
    args = parser.parse_args(argv)
    try:
        group, version = coordinates((ANDROID / "gradle.properties").read_text(encoding="utf-8"))
    except RepositoryError as error:
        print(f"FAIL: {error}")
        return 1
    problems = check_repository(args.repository, group, version, SDK_RULES_PATH.read_text(encoding="utf-8"))
    if not problems:
        files = sum(1 for path in args.repository.rglob("*") if path.is_file())
        variants = root_variants(args.repository, group, version)
        print(f"staged repository: {group}:{{{', '.join(MODULES)}}}:{version}, {files} files, every checksum matches")
        print(f"  the root's Gradle metadata names {', '.join(variants['staged'])} (staged) and {', '.join(variants['not_staged']) or 'nothing else'} (not staged: nothing is published for iOS; the consumer check proves an Android consumer resolves without them)")
        print("  licence papers: " + "; ".join(f"{artifact} carries {len(names)} in {container or 'its assets'}" for artifact, (container, _, _, names) in LICENCE_PAPERS.items()))
        print("  unsigned: nothing is signed or uploaded without the owner's key (Phase 10 P4)")
    for problem in problems:
        print(f"FAIL: {problem}")
    print("check-staged-repository: " + ("failed" if problems else "passed"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
