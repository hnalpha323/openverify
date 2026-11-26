package dev.openverify.sdk.camera

import dev.openverify.sdk.privacy.SourceScan
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * KP10-23 (Workflow 10B Stage 2, pdf417-guidance 5; Stage 3 amendment 14): the 1,280 px barcode
 * analysis width is stated once in the SDK's shared code, in `DocumentCaptureConstants`, which
 * `DocumentCaptureConstantsTest` holds to `contracts/fixtures/flow/document-capture.json`; the camera's
 * target and the barcode guidance refer to it, so the three cannot drift. Comments are not read.
 */
internal class BarcodeWidthConstantTest {

    @Test
    fun `only one declaration of the capture code holds the barcode width's literal`() {
        val holders = SourceScan.sources
            .filter { (path, _) -> path.startsWith("$SHARED/camera/") || path.startsWith("$SHARED/capture/") }
            .filter { (_, text) -> LITERAL.containsMatchIn(text) }
            .map { (path, _) -> path.removePrefix("$SHARED/") }

        assertEquals(listOf("capture/document/DocumentCaptureConstants.kt"), holders)
    }

    private companion object {
        const val SHARED = "src/commonMain/kotlin/dev/openverify/sdk"

        /** `1280` or `1_280` as a whole number. */
        val LITERAL = Regex("""(?<![\w.])1_?280(?![\w.])""")
    }
}
