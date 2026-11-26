"""C217.2, C217.3: the staged repository check, over a synthetic repository built in a temporary
directory (no Gradle output is read)."""

from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from support import load

check = load("check-staged-repository")

GROUP = "dev.example"
VERSION = "1.2.3"
RULES = "# why\n-keepnames class a.B\n"

# Review E001: synthetic licence papers, shaped as LICENCE_PAPERS gives the real ones: per artifact, the
# archive inside the AAR that holds them (None: the AAR itself) and each entry with its committed bytes.
PAPERS = {
    "openverify-nfc": ("classes.jar", {"META-INF/openverify-nfc/NOTICE": b"synthetic notice", "META-INF/openverify-nfc/licenses/GPL-2.0-only.txt": b"synthetic licence text"}),
    "openverify-face": (None, {"assets/openverify-face/NOTICE": b"synthetic notice", "assets/openverify-face/licenses/onnxruntime/ThirdPartyNotices.txt": b"synthetic notices"}),
}


def aar(artifact: str, rules: str, papers: dict | None = None) -> bytes:
    """An AAR of ``artifact`` that carries ``papers`` (default: PAPERS) where the check looks for them."""
    container, entries = (papers or PAPERS)[artifact]
    held = {name: data.decode("utf-8") for name, data in entries.items()}
    if container is None:
        return zipped({"classes.jar": "x", "AndroidManifest.xml": "<manifest/>", "proguard.txt": rules, **held})
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as out:
        out.writestr(container, zipped({"dev/example/A.class": "x", **held}))
        out.writestr("AndroidManifest.xml", "<manifest/>")
        out.writestr("proguard.txt", rules)
    return buffer.getvalue()


def zipped(entries: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as out:
        for name, text in entries.items():
            out.writestr(name, text)
    return buffer.getvalue()


def pom(artifact: str, licence: str, dependencies: str = "") -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>{GROUP}</groupId>
  <artifactId>{artifact}</artifactId>
  <version>{VERSION}</version>
  <name>Example</name>
  <description>An example.</description>
  <url>https://example.com/project</url>
  <licenses><license><name>{licence}</name><url>https://example.com/licence</url></license></licenses>
  <developers><developer><id>example</id><name>Example contributors</name></developer></developers>
  <scm>
    <connection>scm:git:https://example.com/project.git</connection>
    <developerConnection>scm:git:ssh://git@example.com/project.git</developerConnection>
    <url>https://example.com/project</url>
  </scm>
  <dependencies>{dependencies}</dependencies>
</project>
"""


OKHTTP = "<dependency><groupId>com.squareup.okhttp3</groupId><artifactId>okhttp-android</artifactId><version>5.4.0</version><scope>compile</scope></dependency>"
ACTIVITY = "<dependency><groupId>androidx.activity</groupId><artifactId>activity-compose</artifactId><version>1.12.0</version><scope>compile</scope></dependency>"
RUNTIME = "<scope>runtime</scope>"
COMPILE = "<scope>compile</scope>"


def variant(name: str, module: str | None) -> dict:
    entry: dict = {"name": name, "attributes": {"org.jetbrains.kotlin.platform.type": "androidJvm" if "android" in name else "native"}}
    if module is not None:
        entry["available-at"] = {"url": f"../../{module}/{VERSION}/{module}-{VERSION}.module", "group": GROUP, "module": module, "version": VERSION}
    return entry


def root_metadata() -> str:
    return json.dumps(
        {
            "formatVersion": "1.1",
            "component": {"group": GROUP, "module": "openverify-sdk", "version": VERSION},
            "variants": [
                {"name": "metadataApiElements", "attributes": {"org.jetbrains.kotlin.platform.type": "common"}},
                variant("androidApiElements-published", "openverify-sdk-android"),
                variant("androidRuntimeElements-published", "openverify-sdk-android"),
                variant("iosArm64ApiElements-published", "openverify-sdk-iosarm64"),
                variant("iosSimulatorArm64ApiElements-published", "openverify-sdk-iossimulatorarm64"),
            ],
        }
    )


def target_metadata(module: str) -> str:
    return json.dumps({"formatVersion": "1.1", "component": {"group": GROUP, "module": module, "version": VERSION}, "variants": [{"name": "releaseRuntimeElements"}]})


def write(path: Path, data: bytes | str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = data.encode("utf-8") if isinstance(data, str) else data
    path.write_bytes(raw)
    for algorithm in ("md5", "sha1", "sha256", "sha512"):
        Path(f"{path}.{algorithm}").write_text(hashlib.new(algorithm, raw).hexdigest(), encoding="utf-8")


def stage(root: Path) -> None:
    """A complete synthetic staged repository: the root module, the Android target, openverify-nfc and openverify-face."""
    javadoc = zipped({"index.html": "<html/>", **{f"sdk/page-{n}.html": "<html/>" for n in range(12)}})
    sources = zipped({"commonMain/dev/example/A.kt": "package dev.example"})

    def folder(artifact: str) -> Path:
        return root / GROUP.replace(".", "/") / artifact / VERSION

    base = folder("openverify-sdk")
    write(base / f"openverify-sdk-{VERSION}.pom", pom("openverify-sdk", "Apache-2.0"))
    write(base / f"openverify-sdk-{VERSION}.module", root_metadata())
    write(base / f"openverify-sdk-{VERSION}.jar", zipped({"META-INF/MANIFEST.MF": "x"}))
    write(base / f"openverify-sdk-{VERSION}-sources.jar", sources)
    write(base / f"openverify-sdk-{VERSION}-javadoc.jar", javadoc)

    base = folder("openverify-sdk-android")
    write(base / f"openverify-sdk-android-{VERSION}.pom", pom("openverify-sdk-android", "Apache-2.0", OKHTTP + ACTIVITY))
    write(base / f"openverify-sdk-android-{VERSION}.module", target_metadata("openverify-sdk-android"))
    write(base / f"openverify-sdk-android-{VERSION}.aar", zipped({"classes.jar": "x", "AndroidManifest.xml": "<manifest/>", "proguard.txt": RULES}))
    write(base / f"openverify-sdk-android-{VERSION}-sources.jar", sources)
    write(base / f"openverify-sdk-android-{VERSION}-javadoc.jar", javadoc)

    base = folder("openverify-nfc")
    write(base / f"openverify-nfc-{VERSION}.pom", pom("openverify-nfc", "LGPL-3.0-or-later"))
    write(base / f"openverify-nfc-{VERSION}.module", target_metadata("openverify-nfc"))
    write(base / f"openverify-nfc-{VERSION}.aar", aar("openverify-nfc", "# nothing yet\n"))
    write(base / f"openverify-nfc-{VERSION}-sources.jar", zipped({"README": "no sources yet"}))
    write(base / f"openverify-nfc-{VERSION}-javadoc.jar", zipped({"index.html": "<html/>"}))

    base = folder("openverify-face")
    write(base / f"openverify-face-{VERSION}.pom", pom("openverify-face", "Apache-2.0"))
    write(base / f"openverify-face-{VERSION}.module", target_metadata("openverify-face"))
    write(base / f"openverify-face-{VERSION}.aar", aar("openverify-face", "# nothing yet\n"))
    write(base / f"openverify-face-{VERSION}-sources.jar", zipped({"dev/openverify/face/A.kt": "package dev.openverify.face"}))
    write(base / f"openverify-face-{VERSION}-javadoc.jar", zipped({"index.html": "<html/>"}))


class StagedRepository(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "staging-repo"
        stage(self.root)

    def problems(self) -> list[str]:
        return check.check_repository(self.root, GROUP, VERSION, RULES, PAPERS)

    def file(self, artifact: str, suffix: str) -> Path:
        return self.root / GROUP.replace(".", "/") / artifact / VERSION / f"{artifact}-{VERSION}{suffix}"

    def rewrite(self, path: Path, text: str) -> None:
        write(path, text)

    def assert_one(self, *words: str) -> None:
        problems = self.problems()
        self.assertEqual(1, len(problems), problems)
        for word in words:
            self.assertIn(word, problems[0])

    def test_a_complete_repository_has_no_problem(self) -> None:
        self.assertEqual([], self.problems())

    def test_a_missing_repository_is_one_problem(self) -> None:
        shutil.rmtree(self.root)
        self.assert_one("publishAllPublicationsToStagingRepository")

    def test_each_required_file_is_missed_by_name(self) -> None:
        for artifact, suffix in (
            ("openverify-sdk", ".pom"),
            ("openverify-sdk", ".module"),
            ("openverify-sdk", "-sources.jar"),
            ("openverify-sdk-android", ".aar"),
            ("openverify-sdk-android", "-javadoc.jar"),
            ("openverify-sdk-android", "-sources.jar"),
            ("openverify-nfc", ".aar"),
            ("openverify-nfc", ".pom"),
        ):
            with self.subTest(artifact=artifact, suffix=suffix):
                shutil.rmtree(self.root)
                stage(self.root)
                self.file(artifact, suffix).unlink()
                problems = self.problems()
                self.assertTrue(any(f"{artifact}-{VERSION}{suffix}" in problem and "missing" in problem for problem in problems), problems)

    def test_a_missing_checksum_is_a_problem(self) -> None:
        Path(f"{self.file('openverify-sdk-android', '.aar')}.sha1").unlink()
        self.assert_one(".aar.sha1")

    def test_a_checksum_that_is_not_the_files_digest_is_a_problem(self) -> None:
        Path(f"{self.file('openverify-nfc', '.pom')}.sha256").write_text("0" * 64, encoding="utf-8")
        self.assert_one(".pom.sha256")

    def test_a_snapshot_version_is_refused(self) -> None:
        problems = check.check_repository(self.root, GROUP, "1.2.3-SNAPSHOT", RULES)
        self.assertTrue(any("SNAPSHOT" in problem for problem in problems), problems)

    def test_each_pom_member_central_requires_is_missed_by_name(self) -> None:
        original = self.file("openverify-sdk", ".pom").read_text(encoding="utf-8")
        for member, cut in (
            ("name", "<name>Example</name>"),
            ("description", "<description>An example.</description>"),
            ("url", "<url>https://example.com/project</url>\n  <licenses>"),
            ("developers", "<developers><developer><id>example</id><name>Example contributors</name></developer></developers>"),
            ("scm/connection", "<connection>scm:git:https://example.com/project.git</connection>"),
            ("scm/developerConnection", "<developerConnection>scm:git:ssh://git@example.com/project.git</developerConnection>"),
        ):
            with self.subTest(member=member):
                self.assertIn(cut, original)
                self.rewrite(self.file("openverify-sdk", ".pom"), original.replace(cut, "<licenses>" if member == "url" else ""))
                self.assert_one("openverify-sdk", member)

    def test_the_pom_names_its_own_coordinates(self) -> None:
        path = self.file("openverify-nfc", ".pom")
        self.rewrite(path, path.read_text(encoding="utf-8").replace(f"<version>{VERSION}</version>", "<version>9.9.9</version>"))
        self.assert_one("openverify-nfc", "version")

    def test_each_module_keeps_its_own_licence(self) -> None:
        path = self.file("openverify-nfc", ".pom")
        self.rewrite(path, path.read_text(encoding="utf-8").replace("LGPL-3.0-or-later", "Apache-2.0"))
        self.assert_one("openverify-nfc", "LGPL-3.0-or-later")
        path = self.file("openverify-sdk-android", ".pom")
        self.rewrite(self.file("openverify-nfc", ".pom"), pom("openverify-nfc", "LGPL-3.0-or-later"))
        self.rewrite(path, path.read_text(encoding="utf-8").replace("Apache-2.0", "LGPL-3.0-or-later"))
        self.assert_one("openverify-sdk-android", "Apache-2.0")

    def test_okhttp_is_an_api_dependency_of_the_android_target(self) -> None:
        self.rewrite(self.file("openverify-sdk-android", ".pom"), pom("openverify-sdk-android", "Apache-2.0", OKHTTP.replace(COMPILE, RUNTIME) + ACTIVITY))
        self.assert_one("okhttp", "compile")

    def test_androidx_activity_is_an_api_dependency_of_the_android_target(self) -> None:
        # OpenVerifyInquiry.Contract extends androidx.activity's ActivityResultContract: at scope
        # runtime a consumer that does not declare androidx.activity itself cannot compile.
        for dependencies in (OKHTTP + ACTIVITY.replace(COMPILE, RUNTIME), OKHTTP):
            with self.subTest(dependencies=dependencies):
                self.rewrite(self.file("openverify-sdk-android", ".pom"), pom("openverify-sdk-android", "Apache-2.0", dependencies))
                self.assert_one("androidx.activity", "compile", "public signature")

    def test_the_sdk_depends_on_no_optional_or_copyleft_artifact(self) -> None:
        for group, artifact in ((GROUP, "openverify-nfc"), ("org.jmrtd", "jmrtd"), ("org.bouncycastle", "bcprov-jdk18on"), ("com.google.android.play", "integrity")):
            with self.subTest(group=group):
                extra = f"<dependency><groupId>{group}</groupId><artifactId>{artifact}</artifactId><version>1</version><scope>runtime</scope></dependency>"
                self.rewrite(self.file("openverify-sdk-android", ".pom"), pom("openverify-sdk-android", "Apache-2.0", OKHTTP + ACTIVITY + extra))
                self.assert_one("openverify-sdk-android", f"{group}:{artifact}")

    def test_each_optional_artifact_may_depend_only_on_the_libraries_reserved_for_it(self) -> None:
        def dependency(group: str, artifact: str) -> str:
            return f"<dependency><groupId>{group}</groupId><artifactId>{artifact}</artifactId><version>1</version><scope>runtime</scope></dependency>"

        # ONNX Runtime only in openverify-face; the reader's LGPL stack and Bouncy Castle only in openverify-nfc.
        self.rewrite(self.file("openverify-face", ".pom"), pom("openverify-face", "Apache-2.0", dependency("com.microsoft.onnxruntime", "onnxruntime-android")))
        self.rewrite(
            self.file("openverify-nfc", ".pom"),
            pom("openverify-nfc", "LGPL-3.0-or-later", dependency("org.jmrtd", "jmrtd") + dependency("net.sf.scuba", "scuba-sc-android") + dependency("org.ejbca.cvc", "cert-cvc") + dependency("org.bouncycastle", "bcprov-jdk18on")),
        )
        self.assertEqual([], self.problems())

        for module, licence, group, artifact in (
            ("openverify-face", "Apache-2.0", "org.jmrtd", "jmrtd"),
            ("openverify-face", "Apache-2.0", "net.sf.scuba", "scuba-smartcards"),
            ("openverify-face", "Apache-2.0", "org.bouncycastle", "bcprov-jdk18on"),
            ("openverify-face", "Apache-2.0", GROUP, "openverify-nfc"),
            ("openverify-nfc", "LGPL-3.0-or-later", "com.microsoft.onnxruntime", "onnxruntime-android"),
            ("openverify-nfc", "LGPL-3.0-or-later", GROUP, "openverify-face"),
            ("openverify-nfc", "LGPL-3.0-or-later", "com.google.android.play", "integrity"),
            ("openverify-face", "Apache-2.0", "com.google.android.play", "integrity"),
        ):
            with self.subTest(module=module, group=group):
                stage(self.root)
                self.rewrite(self.file(module, ".pom"), pom(module, licence, dependency(group, artifact)))
                self.assert_one(module, f"{group}:{artifact}")

    def test_openverify_face_is_staged_whole_under_apache_2(self) -> None:
        self.assertEqual((".aar", "Apache-2.0"), check.MODULES["openverify-face"])
        self.file("openverify-face", ".aar").unlink()
        self.assert_one("openverify-face", ".aar")
        stage(self.root)
        self.rewrite(self.file("openverify-face", ".pom"), pom("openverify-face", "LGPL-3.0-or-later"))
        self.assert_one("openverify-face", "Apache-2.0")

    # Review E001 (Workflow 10E): the owner's exceptions hold only while the texts travel with the artifact.

    def test_an_optional_artifact_whose_aar_lacks_one_of_its_licence_papers_is_a_problem(self) -> None:
        for artifact, (_, entries) in PAPERS.items():
            for missing in entries:
                with self.subTest(artifact=artifact, missing=missing):
                    container, _ = PAPERS[artifact]
                    kept = {name: data for name, data in entries.items() if name != missing}
                    self.rewrite(self.file(artifact, ".aar"), aar(artifact, "# nothing yet\n", {artifact: (container, kept)}))
                    self.assert_one(artifact, missing, "is missing")
                    stage(self.root)

    def test_a_licence_paper_that_is_not_the_committed_file_is_a_problem(self) -> None:
        for artifact, (container, entries) in PAPERS.items():
            with self.subTest(artifact=artifact):
                changed = {name: data + b" changed" for name, data in entries.items()}
                first = sorted(entries)[0]
                changed.update({name: data for name, data in entries.items() if name != first})
                self.rewrite(self.file(artifact, ".aar"), aar(artifact, "# nothing yet\n", {artifact: (container, changed)}))
                self.assert_one(artifact, first, "is not the committed file")
                stage(self.root)

    def test_the_readers_papers_are_looked_for_in_its_classes_jar_and_an_aar_without_one_is_a_problem(self) -> None:
        self.rewrite(self.file("openverify-nfc", ".aar"), zipped({"AndroidManifest.xml": "<manifest/>", "proguard.txt": "# nothing yet\n"}))
        problems = self.problems()
        self.assertEqual(len(PAPERS["openverify-nfc"][1]), len(problems), problems)
        for problem in problems:
            self.assertIn("classes.jar", problem)

    def test_the_committed_papers_are_the_ones_the_owners_exceptions_name(self) -> None:
        papers, problems = check.committed_papers()
        self.assertEqual([], problems)
        container, nfc = papers["openverify-nfc"]
        self.assertEqual("classes.jar", container)
        self.assertEqual(
            sorted(f"META-INF/openverify-nfc/{name}" for name in ("NOTICE", "licenses/Classpath-exception-2.0.txt", "licenses/GPL-2.0-only.txt", "licenses/LGPL-2.1-or-later.txt", "licenses/LGPL-3.0-or-later.txt", "licenses/SOURCE.txt")),
            sorted(nfc),
        )
        container, face = papers["openverify-face"]
        self.assertIsNone(container)
        self.assertEqual(
            sorted(f"assets/openverify-face/{name}" for name in ("NOTICE", "licenses/onnxruntime/LICENSE.txt", "licenses/onnxruntime/ThirdPartyNotices.txt", "licenses/yunet/LICENSE.txt", "licenses/yunet/NOTICE.txt")),
            sorted(face),
        )
        # P2's condition: the notice gives where Eigen's source is.
        self.assertIn(b"eigen", face["assets/openverify-face/NOTICE"].lower())
        # P1's condition: the notice gives where the two files' source is.
        self.assertIn(b"scuba", nfc["META-INF/openverify-nfc/NOTICE"].lower())
        self.assertEqual(set(check.PINNED_TEXTS), {path for path in check.PINNED_TEXTS if (check.ANDROID / path).is_file()})

    def test_a_committed_third_party_text_that_is_not_the_pinned_one_is_a_problem(self) -> None:
        pinned = dict(check.PINNED_TEXTS)
        path = sorted(pinned)[0]
        pinned[path] = "0" * 64
        _, problems = check.committed_papers(pinned)
        self.assertEqual(1, len(problems), problems)
        self.assertIn(path, problems[0])

    def test_every_published_module_of_the_build_is_one_the_check_expects(self) -> None:
        # Each module the build includes but the demo publishes under its own name; the SDK also as its Android target.
        settings = (check.ANDROID / "settings.gradle.kts").read_text(encoding="utf-8")
        included = [name for name in re.findall(r'include\(":([^"]+)"\)', settings) if name != "demo-app"]
        self.assertEqual(sorted([*included, "openverify-sdk-android"]), sorted(check.MODULES))

    def test_nothing_is_staged_for_ios(self) -> None:
        folder = self.root / GROUP.replace(".", "/") / "openverify-sdk-iosarm64" / VERSION
        write(folder / f"openverify-sdk-iosarm64-{VERSION}.klib", b"klib")
        problems = self.problems()
        self.assertTrue(problems)
        self.assertTrue(all("openverify-sdk-iosarm64" in problem for problem in problems), problems)

    def test_an_artifact_nobody_named_is_a_problem(self) -> None:
        folder = self.root / GROUP.replace(".", "/") / "demo-app" / VERSION
        write(folder / f"demo-app-{VERSION}.pom", pom("demo-app", "Apache-2.0"))
        self.assert_one("demo-app")

    def test_the_root_module_must_name_the_android_target_that_is_staged(self) -> None:
        path = self.file("openverify-sdk", ".module")
        document = json.loads(path.read_text(encoding="utf-8"))
        document["variants"] = [entry for entry in document["variants"] if "android" not in entry["name"]]
        self.rewrite(path, json.dumps(document))
        self.assert_one("openverify-sdk", "android")

    def test_the_android_targets_aar_carries_the_committed_consumer_rules(self) -> None:
        problems = check.check_repository(self.root, GROUP, VERSION, "-keepnames class other.C\n", PAPERS)
        self.assertEqual(1, len(problems), problems)
        self.assertIn("proguard.txt", problems[0])

    def test_an_empty_javadoc_jar_of_the_sdk_is_a_problem(self) -> None:
        write(self.file("openverify-sdk-android", "-javadoc.jar"), zipped({"README.txt": "placeholder"}))
        self.assert_one("javadoc")

    def test_a_sources_jar_of_the_sdk_without_kotlin_is_a_problem(self) -> None:
        write(self.file("openverify-sdk-android", "-sources.jar"), zipped({"README.txt": "placeholder"}))
        self.assert_one("sources")

    def test_a_key_or_keystore_in_the_repository_is_a_problem(self) -> None:
        write(self.root / "release.jks", b"x")
        self.assert_one("release.jks")


class Summary(unittest.TestCase):
    def test_the_ios_variants_the_root_names_are_reported_as_not_staged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "staging-repo"
            stage(root)
            facts = check.root_variants(root, GROUP, VERSION)
            self.assertEqual(["openverify-sdk-android"], facts["staged"])
            self.assertEqual(["openverify-sdk-iosarm64", "openverify-sdk-iossimulatorarm64"], facts["not_staged"])


class GradleProperties(unittest.TestCase):
    def test_reads_the_group_and_version(self) -> None:
        text = "# comment\nopenverifyVersion=0.1.0\nopenverifyGroup = dev.openverify\nother=1\n"
        self.assertEqual(("dev.openverify", "0.1.0"), check.coordinates(text))

    def test_refuses_properties_without_them(self) -> None:
        with self.assertRaises(check.RepositoryError):
            check.coordinates("openverifyVersion=0.1.0\n")


if __name__ == "__main__":
    unittest.main()
