"""C215.1, C215.4: the consumer rules, over synthetic R8 mappings and configurations, and the two
committed rule files."""

from __future__ import annotations

import re
import tempfile
import unittest
import zipfile
from pathlib import Path

from support import load

check = load("check-consumer-rules")

MAPPING = """# compiler: R8
# {"id":"com.android.tools.r8.mapping","version":"2.2"}
dev.openverify.sdk.OpenVerifyInquiryActivity -> dev.openverify.sdk.OpenVerifyInquiryActivity:
# {"id":"sourceFile","fileName":"OpenVerifyInquiryActivity.kt"}
    1:1:void <init>():50:50 -> <init>
dev.openverify.sdk.api.FlowApiException$InvalidResponse -> a61:
kotlinx.serialization.SerializationException -> kotlinx.serialization.SerializationException:
kotlinx.serialization.MissingFieldException -> kotlinx.serialization.MissingFieldException:
    java.util.List missingFields -> a
kotlinx.serialization.json.internal.JsonDecodingException -> kotlinx.serialization.json.internal.JsonDecodingException:
kotlinx.serialization.json.Json -> q12:
kotlinx.serialization.internal.RemovedException -> R8$$REMOVED$$CLASS$$12:
"""

SDK_RULES = "# why\n-keepnames class kotlinx.serialization.SerializationException\n\n-keepnames class * extends kotlinx.serialization.SerializationException\n"

CONFIGURATION = (
    "# The proguard configuration file for the following section is /sdk/proguard-android-optimize.txt\n"
    "-allowaccessmodification\n"
    "# End of content from /sdk/proguard-android-optimize.txt\n"
    "# The proguard configuration file for the following section is Local project :::openverify-sdk (extracted file: /x/lib0/proguard.txt)\n"
    + SDK_RULES
    + "# End of content from Local project :::openverify-sdk (extracted file: /x/lib0/proguard.txt)\n"
    "# The proguard configuration file for the following section is io.github.zxing-cpp:android:3.1.1 (extracted file: /y/proguard.txt)\n"
    "-keep class zxingcpp.** { *; }\n"
    "# End of content from io.github.zxing-cpp:android:3.1.1 (extracted file: /y/proguard.txt)\n"
)


class ActiveRules(unittest.TestCase):
    def test_comments_and_blank_lines_are_not_rules(self) -> None:
        self.assertEqual(
            ["-keepnames class kotlinx.serialization.SerializationException", "-keepnames class * extends kotlinx.serialization.SerializationException"],
            check.active_rules(SDK_RULES),
        )
        self.assertEqual([], check.active_rules("# only\n\n   # comments\n"))

    def test_a_rule_keeps_its_text_before_a_trailing_comment(self) -> None:
        self.assertEqual(["-dontwarn a.b.**"], check.active_rules("  -dontwarn a.b.**   # why\n"))


class ClassNames(unittest.TestCase):
    def test_reads_only_class_lines(self) -> None:
        names = check.class_names(MAPPING)
        self.assertEqual("a61", names["dev.openverify.sdk.api.FlowApiException$InvalidResponse"])
        self.assertEqual("q12", names["kotlinx.serialization.json.Json"])
        self.assertNotIn("java.util.List missingFields", names)
        self.assertEqual(7, len(names))


class Mapping(unittest.TestCase):
    def test_a_mapping_that_keeps_the_sdk_activity_has_no_problem(self) -> None:
        self.assertEqual([], check.mapping_problems(MAPPING))

    def test_a_renamed_serialization_exception_is_no_problem(self) -> None:
        # KP10-56: the SDK reads no class name as text (InvalidResponse.decodeFailure is a fixed code
        # chosen by type), so R8 may rename kotlinx.serialization's exceptions as it renames anything.
        renamed = MAPPING.replace(
            "kotlinx.serialization.MissingFieldException -> kotlinx.serialization.MissingFieldException:",
            "kotlinx.serialization.MissingFieldException -> gj2:",
        ).replace(
            "kotlinx.serialization.SerializationException -> kotlinx.serialization.SerializationException:",
            "kotlinx.serialization.SerializationException -> oc4:",
        )
        self.assertEqual([], check.mapping_problems(renamed))

    def test_a_mapping_without_the_decoding_exceptions_still_proves_the_activity(self) -> None:
        without = "\n".join(line for line in MAPPING.splitlines() if "Exception" not in line or "FlowApiException" in line)
        self.assertEqual([], check.mapping_problems(without))

    def test_a_mapping_without_the_sdk_activity_fails(self) -> None:
        without = MAPPING.replace("dev.openverify.sdk.OpenVerifyInquiryActivity -> dev.openverify.sdk.OpenVerifyInquiryActivity:", "")
        problems = check.mapping_problems(without)
        self.assertEqual(1, len(problems))
        self.assertIn("OpenVerifyInquiryActivity", problems[0])

    def test_the_sdk_activity_renamed_fails(self) -> None:
        renamed = MAPPING.replace("-> dev.openverify.sdk.OpenVerifyInquiryActivity:", "-> zz:")
        self.assertEqual(1, len(check.mapping_problems(renamed)))


class Configuration(unittest.TestCase):
    def test_the_section_of_a_library_is_read_from_the_merged_configuration(self) -> None:
        self.assertEqual(check.active_rules(SDK_RULES), check.active_rules(check.consumer_section(CONFIGURATION, ":openverify-sdk")))
        self.assertEqual(["-keep class zxingcpp.** { *; }"], check.active_rules(check.consumer_section(CONFIGURATION, "io.github.zxing-cpp:android")))
        self.assertIsNone(check.consumer_section(CONFIGURATION, ":openverify-face"))

    def test_the_merged_configuration_must_carry_the_sdk_rules_as_committed(self) -> None:
        self.assertEqual([], check.configuration_problems(CONFIGURATION, SDK_RULES))
        self.assertEqual(1, len(check.configuration_problems(CONFIGURATION.replace("-keepnames class * extends", "-keep class * extends"), SDK_RULES)))
        without = CONFIGURATION.replace(":::openverify-sdk", ":::other")
        self.assertEqual(1, len(check.configuration_problems(without, SDK_RULES)))

    def test_an_sdk_that_ships_no_rule_needs_no_section(self) -> None:
        # KP10-56: the SDK's consumer-rules.pro holds comments only, and its AAR ships no active rule.
        no_rules = "# why: none\n"
        without = CONFIGURATION.replace(":::openverify-sdk", ":::other")
        self.assertEqual([], check.configuration_problems(without, no_rules))
        empty = CONFIGURATION.replace(SDK_RULES, no_rules)
        self.assertEqual([], check.configuration_problems(empty, no_rules))
        self.assertEqual(1, len(check.configuration_problems(CONFIGURATION, no_rules)))

    def test_zxing_cpps_own_rule_must_travel_in_its_aar(self) -> None:
        without = CONFIGURATION.replace("-keep class zxingcpp.** { *; }\n", "")
        problems = check.configuration_problems(without, SDK_RULES)
        self.assertEqual(1, len(problems))
        self.assertIn("zxing", problems[0])


class AarRules(unittest.TestCase):
    def aar(self, directory: str, entries: dict[str, str]) -> Path:
        path = Path(directory) / "x.aar"
        with zipfile.ZipFile(path, "w") as out:
            for name, text in entries.items():
                out.writestr(name, text)
        return path

    def test_the_rules_an_aar_ships_are_its_proguard_txt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(check.active_rules(SDK_RULES), check.aar_rules(self.aar(tmp, {"proguard.txt": SDK_RULES, "classes.jar": "x"})))

    def test_an_aar_without_the_file_ships_no_rule(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual([], check.aar_rules(self.aar(tmp, {"classes.jar": "x"})))


class CommittedRules(unittest.TestCase):
    def test_the_sdk_ships_no_consumer_rule(self) -> None:
        # KP10-56: nothing in the SDK reads a class name as text any more, so it needs no rule.
        self.assertEqual([], check.active_rules(check.SDK_RULES_PATH.read_text(encoding="utf-8")))

    def test_every_published_library_has_its_rules_file_and_its_aar(self) -> None:
        # The AAR of each library module the build includes, with the committed file its rules must equal.
        settings = (check.ANDROID / "settings.gradle.kts").read_text(encoding="utf-8")
        included = [name for name in re.findall(r'include\(":([^"]+)"\)', settings) if name != "demo-app"]
        self.assertEqual(included, [library.module for library in check.LIBRARIES])
        for library in check.LIBRARIES:
            self.assertTrue(library.rules.is_file(), library.rules)
            self.assertEqual(check.ANDROID / library.module / "consumer-rules.pro", library.rules)
            self.assertEqual(check.ANDROID / library.module / "build/outputs/aar", library.aar.parent)

    def test_an_aar_that_ships_other_rules_than_committed_or_is_missing_is_a_problem(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "rules.pro").write_text("# why\n-keep class a.B\n", encoding="utf-8")
            with zipfile.ZipFile(folder / "same.aar", "w") as out:
                out.writestr("proguard.txt", "-keep class a.B\n")
            with zipfile.ZipFile(folder / "other.aar", "w") as out:
                out.writestr("proguard.txt", "-keep class a.C\n")
            same = check.Library("openverify-x", folder / "rules.pro", folder / "same.aar", ":openverify-x:assembleRelease")
            other = check.Library("openverify-x", folder / "rules.pro", folder / "other.aar", ":openverify-x:assembleRelease")
            missing = check.Library("openverify-x", folder / "rules.pro", folder / "none.aar", ":openverify-x:assembleRelease")

            self.assertEqual([], check.aar_problems(same))
            self.assertEqual(1, len(check.aar_problems(other)))
            self.assertIn("a.C", check.aar_problems(other)[0])
            self.assertEqual(1, len(check.aar_problems(missing)))
            self.assertIn(":openverify-x:assembleRelease", check.aar_problems(missing)[0])

    def test_openverify_face_keeps_what_onnx_runtimes_native_library_finds_by_name(self) -> None:
        # C215.1 (Workflow 10E, face-onnx): ONNX Runtime's native library finds its Java classes and members by name,
        # and without this rule the minified demo renamed OrtException and removed TensorInfo (docs/tdd/phase10-face-onnx.tdd.md).
        rules = check.active_rules((check.ANDROID / "openverify-face/consumer-rules.pro").read_text(encoding="utf-8"))
        self.assertEqual(["-keep class ai.onnxruntime.** { *; }"], rules)
        for rule in rules:
            self.assertNotIn("dev.openverify", rule)
            self.assertNotIn("kotlinx.serialization", rule)

    def test_openverify_nfc_keeps_the_lgpl_libraries_and_what_their_provider_resolves_by_name(self) -> None:
        # C209.4 (KP10-43): the LGPL libraries stay unobfuscated, so a user can replace them, and so
        # does what JMRTD's own security provider loads by class name in Bouncy Castle, which R8
        # removed from the minified demo before these rules (docs/tdd/phase10-nfc-reader.tdd.md).
        rules = check.active_rules(check.NFC_RULES_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            [
                "-keep class org.jmrtd.** { *; }",
                "-keep class net.sf.scuba.** { *; }",
                "-keep class org.ejbca.cvc.** { *; }",
                "-keep class org.bouncycastle.jcajce.provider.** { *; }",
                "-keep class org.bouncycastle.jce.provider.** { *; }",
                "-keepnames class org.bouncycastle.** { *; }",
            ],
            rules,
        )
        # No rule of an optional artifact reaches into the SDK, the demo or kotlinx.serialization.
        for rule in rules:
            for reserved in ("dev.openverify", "kotlinx.serialization"):
                self.assertNotIn(reserved, rule)


if __name__ == "__main__":
    unittest.main()
