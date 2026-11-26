"""C216.2, C216.3: the size check, over synthetic bundletool reports and synthetic baselines."""

from __future__ import annotations

import copy
import unittest

from support import load

check = load("check-size")

REPORT = "ABI,MIN,MAX\nx86,3333470,3357260\nx86_64,3307968,3331761\narm64-v8a,3264687,3288472\narmeabi-v7a,3177141,3200929\n"


def sizes(download: int, install: int) -> dict[str, int]:
    return {"download_bytes": download, "install_bytes": install}


BASELINE = {"arm64-v8a": sizes(1000, 3000), "x86_64": sizes(2000, 5000)}


class ParseSizes(unittest.TestCase):
    def test_reads_the_largest_download_of_each_abi(self) -> None:
        self.assertEqual(
            {"x86": 3357260, "x86_64": 3331761, "arm64-v8a": 3288472, "armeabi-v7a": 3200929},
            check.parse_sizes(REPORT),
        )

    def test_ignores_log_lines_before_the_table(self) -> None:
        self.assertEqual({"x86": 9}, check.parse_sizes("INFO: something\nABI,MIN,MAX\nx86,7,9\n"))

    def test_refuses_a_report_without_the_abi_table(self) -> None:
        for text in ("", "MIN,MAX\n1,2\n", "ABI,MIN,MAX\n", "ABI,MIN,MAX\nx86,one,two\n"):
            with self.subTest(text=text), self.assertRaises(check.SizeError):
                check.parse_sizes(text)


class Compare(unittest.TestCase):
    def test_equal_sizes_pass(self) -> None:
        self.assertEqual([], check.compare(BASELINE, copy.deepcopy(BASELINE), 10))

    def test_a_growth_of_exactly_the_tolerance_passes_and_one_byte_more_fails(self) -> None:
        measured = {"arm64-v8a": sizes(1100, 3300), "x86_64": sizes(2200, 5500)}
        self.assertEqual([], check.compare(BASELINE, measured, 10))
        measured["arm64-v8a"]["download_bytes"] = 1101
        failures = check.compare(BASELINE, measured, 10)
        self.assertEqual(1, len(failures))
        self.assertIn("arm64-v8a", failures[0])
        self.assertIn("download", failures[0])
        self.assertIn("1101", failures[0])
        self.assertIn("1000", failures[0])

    def test_the_install_size_is_held_too(self) -> None:
        measured = {"arm64-v8a": sizes(1000, 3000), "x86_64": sizes(2000, 5501)}
        failures = check.compare(BASELINE, measured, 10)
        self.assertEqual(1, len(failures))
        self.assertIn("x86_64", failures[0])
        self.assertIn("install", failures[0])

    def test_a_smaller_build_passes(self) -> None:
        self.assertEqual([], check.compare(BASELINE, {"arm64-v8a": sizes(1, 1), "x86_64": sizes(1, 1)}, 10))

    def test_an_abi_the_baseline_does_not_hold_fails(self) -> None:
        measured = copy.deepcopy(BASELINE) | {"riscv64": sizes(1, 1)}
        failures = check.compare(BASELINE, measured, 10)
        self.assertEqual(1, len(failures))
        self.assertIn("riscv64", failures[0])

    def test_an_abi_that_was_not_measured_fails(self) -> None:
        failures = check.compare(BASELINE, {"arm64-v8a": sizes(1000, 3000)}, 10)
        self.assertEqual(1, len(failures))
        self.assertIn("x86_64", failures[0])


class Shrunk(unittest.TestCase):
    def test_names_the_figures_that_fell_by_more_than_the_tolerance(self) -> None:
        measured = {"arm64-v8a": sizes(899, 3000), "x86_64": sizes(1800, 5000)}
        notes = check.shrunk(BASELINE, measured, 10)
        self.assertEqual(1, len(notes))
        self.assertIn("arm64-v8a", notes[0])


class Configurations(unittest.TestCase):
    PLAIN = '<manifest><uses-permission android:name="android.permission.CAMERA"/></manifest>'
    NFC = '<manifest><uses-permission android:name="android.permission.NFC"/></manifest>'
    NO_LIBRARY = ["base/lib/arm64-v8a/libzxingcpp_android.so", "base/dex/classes.dex"]
    ORT = ["base/lib/arm64-v8a/libzxingcpp_android.so", "base/lib/arm64-v8a/libonnxruntime.so", "base/lib/arm64-v8a/libonnxruntime4j_jni.so"]

    def test_only_the_configurations_whose_artifacts_exist_are_known(self) -> None:
        # Workflow 10E: the reader and the face detector exist; no Play Integrity artifact does (Phase 10 P3 declined).
        self.assertEqual(["sdk", "sdk,face", "sdk,nfc", "sdk,nfc,face"], sorted(check.CONFIGURATIONS))
        for name, entry in check.CONFIGURATIONS.items():
            with self.subTest(name=name):
                self.assertNotIn("without the reader", entry["label"])
                self.assertEqual("nfc" in name.split(","), entry["nfc"])
                self.assertEqual("face" in name.split(","), entry["face"])
        self.assertIn("JMRTD reader", check.CONFIGURATIONS["sdk,nfc"]["label"])
        self.assertIn("ONNX Runtime", check.CONFIGURATIONS["sdk,face"]["label"])

    def test_a_bundle_is_told_apart_by_the_nfc_permission_only_openverify_nfc_declares(self) -> None:
        self.assertIsNone(check.configuration_problem("sdk", self.PLAIN, self.NO_LIBRARY))
        self.assertIsNone(check.configuration_problem("sdk,nfc", self.NFC, self.NO_LIBRARY))
        self.assertIn("NFC permission", check.configuration_problem("sdk", self.NFC, self.NO_LIBRARY))
        self.assertIn("NFC permission", check.configuration_problem("sdk,nfc", self.PLAIN, self.NO_LIBRARY))

    def test_a_bundle_is_told_apart_by_onnx_runtimes_native_library_only_openverify_face_brings(self) -> None:
        self.assertIsNone(check.configuration_problem("sdk,face", self.PLAIN, self.ORT))
        self.assertIsNone(check.configuration_problem("sdk,nfc,face", self.NFC, self.ORT))
        self.assertIn("libonnxruntime.so", check.configuration_problem("sdk", self.PLAIN, self.ORT))
        self.assertIn("libonnxruntime.so", check.configuration_problem("sdk,nfc", self.NFC, self.ORT))
        self.assertIn("libonnxruntime.so", check.configuration_problem("sdk,face", self.PLAIN, self.NO_LIBRARY))
        self.assertIn("libonnxruntime.so", check.configuration_problem("sdk,nfc,face", self.NFC, self.NO_LIBRARY))
        self.assertIn("NFC permission", check.configuration_problem("sdk,nfc,face", self.PLAIN, self.ORT))
        self.assertIn("NFC permission", check.configuration_problem("sdk,face", self.NFC, self.ORT))

    def test_a_configuration_whose_artifact_does_not_exist_is_refused(self) -> None:
        for name in ("sdk,integrity-play", "sdk,face,nfc", "nfc", "face", ""):
            with self.subTest(name=name), self.assertRaises(check.SizeError):
                check.configuration_problem(name, "<manifest/>", [])


class Caps(unittest.TestCase):
    """C216.2: the absolute cap, set after Workflow 10E measured the official ONNX Runtime AAR."""

    CAPS = {"download_bytes": 1000, "install_bytes": 2000}

    def test_a_figure_at_its_cap_passes_and_one_byte_more_fails(self) -> None:
        self.assertEqual([], check.over_cap(self.CAPS, {"arm64-v8a": sizes(1000, 2000)}))
        failures = check.over_cap(self.CAPS, {"arm64-v8a": sizes(1001, 2000), "x86": sizes(1000, 2001)})
        self.assertEqual(2, len(failures))
        self.assertIn("arm64-v8a", failures[0])
        self.assertIn("download", failures[0])
        self.assertIn("1001", failures[0])
        self.assertIn("x86", failures[1])
        self.assertIn("install", failures[1])

    def test_a_baseline_change_cannot_move_a_cap(self) -> None:
        # The caps are constants of the script, not members of the baseline file --write-baseline rewrites.
        self.assertNotIn("caps", check.empty_baseline())
        self.assertNotIn("CAPS", check.render(check.with_configuration(check.empty_baseline(), "sdk", BASELINE)))

    def test_every_configuration_has_a_cap_above_its_committed_baseline_by_the_stated_margin_at_most(self) -> None:
        document = check.parse(check.BASELINE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(sorted(check.CONFIGURATIONS), sorted(check.CAPS))
        self.assertEqual(25, check.CAP_MARGIN_PERCENT)
        mebibyte = 1024 * 1024
        for name, caps in check.CAPS.items():
            abis = check.baseline_of(document, name)
            for figure in ("download_bytes", "install_bytes"):
                with self.subTest(name=name, figure=figure):
                    largest = max(entry[figure] for entry in abis.values())
                    # The rule the cap was set by: the largest ABI's measured figure plus the margin, rounded up to a whole MiB.
                    wanted = -(-(largest * (100 + check.CAP_MARGIN_PERCENT)) // (100 * mebibyte)) * mebibyte
                    self.assertGreaterEqual(caps[figure], largest)
                    self.assertLessEqual(caps[figure], wanted)
                    self.assertEqual(0, caps[figure] % mebibyte)
            self.assertEqual([], check.over_cap(caps, abis))


class DeviceSpec(unittest.TestCase):
    def test_one_reference_device_per_abi(self) -> None:
        spec = check.device_spec("arm64-v8a")
        self.assertEqual(["arm64-v8a"], spec["supportedAbis"])
        self.assertEqual(check.REFERENCE_DEVICE["sdkVersion"], spec["sdkVersion"])
        self.assertEqual(check.REFERENCE_DEVICE["screenDensity"], spec["screenDensity"])
        self.assertEqual([check.REFERENCE_DEVICE["locale"]], spec["supportedLocales"])


class Baseline(unittest.TestCase):
    def document(self) -> dict:
        return check.empty_baseline()

    def test_a_new_baseline_says_how_each_figure_was_measured(self) -> None:
        document = self.document()
        self.assertEqual(10, document["tolerance_percent"])
        self.assertIn("measured", document["download_bytes"])
        self.assertIn("measured", document["install_bytes"])
        self.assertIn("bundletool", document["tool"])
        self.assertEqual({}, document["configurations"])

    def test_writing_one_configuration_keeps_the_others(self) -> None:
        document = self.document()
        check.with_configuration(document, "sdk", BASELINE)
        check.with_configuration(document, "sdk,nfc", {"arm64-v8a": sizes(1, 2)})
        check.with_configuration(document, "sdk", {"arm64-v8a": sizes(5, 6)})
        self.assertEqual({"arm64-v8a": sizes(5, 6)}, document["configurations"]["sdk"]["abis"])
        self.assertEqual({"arm64-v8a": sizes(1, 2)}, document["configurations"]["sdk,nfc"]["abis"])
        self.assertEqual(check.CONFIGURATIONS["sdk,nfc"]["label"], document["configurations"]["sdk,nfc"]["label"])

    def test_the_baseline_of_a_configuration_is_read_or_missing(self) -> None:
        document = self.document()
        check.with_configuration(document, "sdk", BASELINE)
        self.assertEqual(BASELINE, check.baseline_of(document, "sdk"))
        with self.assertRaises(check.SizeError):
            check.baseline_of(document, "sdk,nfc")

    def test_the_text_is_stable_and_ends_with_a_newline(self) -> None:
        document = self.document()
        check.with_configuration(document, "sdk", {"x86": sizes(1, 2), "arm64-v8a": sizes(3, 4)})
        text = check.render(document)
        self.assertTrue(text.endswith("}\n"))
        self.assertLess(text.index("arm64-v8a"), text.index("x86"))
        self.assertEqual(text, check.render(check.parse(text)))


class CommittedBaseline(unittest.TestCase):
    """The committed ``android/size-baseline.json`` holds what C216.3 lets it hold."""

    def test_it_holds_the_four_existing_configurations_for_the_same_abis_and_no_other(self) -> None:
        document = check.parse(check.BASELINE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(["sdk", "sdk,face", "sdk,nfc", "sdk,nfc,face"], sorted(document["configurations"]))
        self.assertEqual(10, document["tolerance_percent"])
        plain = check.baseline_of(document, "sdk")
        every = [check.baseline_of(document, name) for name in sorted(document["configurations"])]
        for abis in every:
            self.assertEqual(sorted(plain), sorted(abis))
        self.assertIn("arm64-v8a", plain)
        for name, entry in document["configurations"].items():
            self.assertEqual(check.CONFIGURATIONS[name]["label"], entry["label"])
            self.assertNotIn("without the reader", entry["label"])
        # The reader's stack and ONNX Runtime each cost something: a configuration measured without its artifact would not.
        for abi in plain:
            self.assertGreater(check.baseline_of(document, "sdk,nfc")[abi]["download_bytes"], plain[abi]["download_bytes"] + 500_000)
            self.assertGreater(check.baseline_of(document, "sdk,face")[abi]["download_bytes"], plain[abi]["download_bytes"] + 5_000_000)
            self.assertGreater(check.baseline_of(document, "sdk,nfc,face")[abi]["download_bytes"], check.baseline_of(document, "sdk,face")[abi]["download_bytes"] + 500_000)
        for abis in every:
            for abi, figures in abis.items():
                with self.subTest(abi=abi):
                    self.assertEqual(["download_bytes", "install_bytes"], sorted(figures))
                    self.assertGreater(figures["download_bytes"], 0)
                    self.assertGreater(figures["install_bytes"], figures["download_bytes"])
        self.assertEqual(check.render(document), check.BASELINE_PATH.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
