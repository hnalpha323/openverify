package dev.openverify.sdk.ui.a11y

import dev.openverify.sdk.capture.selfie.CAPTURE_WARNING
import dev.openverify.sdk.flow.SelfieCaptureProtocol
import dev.openverify.sdk.nfc.NfcStepController
import dev.openverify.sdk.privacy.SdkModule
import dev.openverify.sdk.privacy.SourceScan
import java.io.File
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * C212.3 (WCAG 2.2.1; review H17; Workflow 10D, android-a11y-audit): the SDK adds no time limit of
 * its own. Every duration in the shipped sources is one of the list below, each classified in
 * `docs/android/accessibility.md`; a new one fails here until it is classified there. The page's
 * table of lifetimes names the device's own constants with their values and host tests that exist.
 */
internal class A11yTimingTest {

    private val page = File("../../docs/android/accessibility.md").readText()

    /** A duration written in a source: a `Duration` literal, a timeout call, a `..._MS` constant, an HTTP timeout. */
    private val duration = Regex("""\b[0-9_]+\.(?:seconds|milliseconds|minutes|hours|days)\b|\bwithTimeout(?:OrNull)?\(|\b[A-Z_]+_MS\b[^=\n]*=\s*[0-9_]+|\b(?:connect|read|write|call)Timeout\([^)]*\)""")

    /** Every duration of the shipped sources, by file: what it is, as the page's two tables say. */
    private val classified: Map<String, List<String>> = mapOf(
        // The optional reader's backstops (Workflow 10E, nfc-reader): the paths are as SourceScan gives a module outside the SDK.
        "../openverify-nfc/src/main/kotlin/dev/openverify/nfc/JmrtdChipSession.kt" to listOf("EXCHANGE_TIMEOUT_MS: Int = 5_000"),
        "../openverify-nfc/src/main/kotlin/dev/openverify/nfc/NfcChipReader.kt" to listOf("withTimeoutOrNull(", "withTimeoutOrNull(", "5.minutes", "5.minutes"),
        "src/androidMain/kotlin/dev/openverify/sdk/api/FlowHttpPlatform.android.kt" to listOf("connectTimeout(15, TimeUnit.SECONDS)", "readTimeout(30, TimeUnit.SECONDS)", "writeTimeout(60, TimeUnit.SECONDS)"),
        "src/commonMain/kotlin/dev/openverify/sdk/api/FlowApi.kt" to listOf("2.seconds"),
        "src/commonMain/kotlin/dev/openverify/sdk/camera/FrameRelay.kt" to listOf("withTimeoutOrNull(", "withTimeoutOrNull(", "50.milliseconds", "1.seconds"),
        "src/commonMain/kotlin/dev/openverify/sdk/capture/barcode/BarcodeGuidance.kt" to listOf("READ_INTERVAL_MS: Long = 250", "FOUND_HOLD_MS: Long = 1_500"),
        "src/commonMain/kotlin/dev/openverify/sdk/capture/document/DocumentCaptureConstants.kt" to listOf("500.milliseconds", "10_000.milliseconds"),
        "src/commonMain/kotlin/dev/openverify/sdk/capture/selfie/Extension.kt" to listOf("20.seconds", "1.seconds"),
        "src/commonMain/kotlin/dev/openverify/sdk/capture/selfie/SelfieGuidanceConstants.kt" to listOf("MANUAL_SHUTTER_AFTER_MS: Long = 10_000", "ANNOUNCE_AFTER_MS: Long = 1_500"),
        "src/commonMain/kotlin/dev/openverify/sdk/flow/FlowCoordinator.kt" to listOf("2.seconds"),
        "src/commonMain/kotlin/dev/openverify/sdk/flow/SelfieCaptureProtocol.kt" to listOf("180.seconds"),
        "src/commonMain/kotlin/dev/openverify/sdk/model/SelfieCapture.kt" to listOf("MAX_CLIENT_ELAPSED_MS: Long = 600_000"),
        "src/commonMain/kotlin/dev/openverify/sdk/nfc/NfcStepController.kt" to listOf("300.seconds"),
        "src/commonMain/kotlin/dev/openverify/sdk/ui/steps/StepParts.kt" to listOf("1.seconds"),
    )

    private fun section(name: String): List<List<String>> =
        page.substringAfter("<!-- $name:start -->").substringBefore("<!-- $name:end -->").lines()
            .filter { it.startsWith("|") }
            .drop(2)
            .map { row -> row.trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() } }

    @Test
    fun `every duration in the shipped sources is one the accessibility page classifies`() {
        val sources = SdkModule.SHIPPED.flatMap(SourceScan::sourcesOf)
        val found = sources
            .map { (path, text) -> path to duration.findAll(SourceScan.code(text)).map { it.value }.toList() }
            .filter { it.second.isNotEmpty() }
            .toMap()

        assertTrue(sources.size > 100, "the scan read no source")
        assertEquals(classified.toSortedMap().toString().replace("], ", "]\n"), found.toSortedMap().toString().replace("], ", "]\n"))
    }

    @Test
    fun `the page's table of other durations names every file that holds one`() {
        val named = section("durations").joinToString(" ") { it[0] }
        val lifetimes = section("lifetimes").joinToString(" ")
        val missing = classified.keys.map { it.substringAfterLast('/') }.filter { file -> "`$file`" !in named && file.removeSuffix(".kt") !in lifetimes }

        assertEquals(emptyList<String>(), missing)
    }

    @Test
    fun `the page lists each lifetime with the device's own value and host tests that exist`() {
        val rows = section("lifetimes")
        val tests = File("src/androidHostTest/kotlin").walkTopDown().filter { it.isFile }.map { it.nameWithoutExtension }.toSet() +
            File("src/commonTest/kotlin").walkTopDown().filter { it.isFile }.map { it.nameWithoutExtension }.toSet()

        assertEquals(
            listOf("A selfie capture", "A chip challenge (NFC)", "A one-time code", "A wallet message", "The session", "The inquiry and a one-time link"),
            rows.map { it[0] },
        )
        rows.forEach { row ->
            val cited = Regex("`([A-Za-z0-9]+Test)`").findAll(row[3]).map { it.groupValues[1] }.toList()
            assertTrue(cited.isNotEmpty(), "${row[0]} cites no host test")
            assertEquals(emptyList<String>(), cited.filter { it !in tests }, "${row[0]} cites tests that do not exist")
        }
        assertTrue("${SelfieCaptureProtocol.CAPTURE_TTL.inWholeSeconds} s" in rows[0][1], rows[0][1])
        assertTrue("${CAPTURE_WARNING.inWholeSeconds} s before" in rows[0][2], rows[0][2])
        assertTrue("${NfcStepController.CHALLENGE_LIFETIME.inWholeSeconds} s" in rows[1][1], rows[1][1])
        assertTrue("up to nine" in rows[1][2] && NfcStepController.MAX_CHALLENGES == 9, rows[1][2])
    }
}
