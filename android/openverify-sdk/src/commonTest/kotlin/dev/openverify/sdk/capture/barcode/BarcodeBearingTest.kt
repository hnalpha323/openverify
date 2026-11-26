package dev.openverify.sdk.capture.barcode

import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.Liveness
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.SelfiePose
import dev.openverify.sdk.model.SelfieStep
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * C203.3, C201.2: the side the server's guidance marks as barcode-bearing. The session names no
 * barcode side; the server's mark is the existing `barcode_not_found` hint family (a retry hint of
 * `id_barcode_detection`), which names the side that carries the barcode: the back of a two-sided or
 * back-only ID, the front of a front-only one.
 */
class BarcodeBearingTest {

    private val barcodeNotFound = RetryHint("id_barcode_detection", listOf("barcode_not_found"))

    private fun id(sides: DocumentSides) =
        GovernmentIdStep("id_card", sides, maxAttempts = 3, captureMethods = listOf(CaptureMethod.CAMERA))

    private fun capture(sides: DocumentSides, kind: FileKind, vararg hints: RetryHint) =
        FlowState.Capture(id(sides), kind, 0, if (sides == DocumentSides.BOTH) 2 else 1, hints.toList())

    @Test
    fun theBackOfATwoSidedIdIsBarcodeBearingAfterABarcodeHint() {
        assertTrue(isBarcodeBearing(capture(DocumentSides.BOTH, FileKind.BACK, barcodeNotFound)))
        assertFalse(isBarcodeBearing(capture(DocumentSides.BOTH, FileKind.FRONT, barcodeNotFound)))
    }

    @Test
    fun theOnlySideOfAOneSidedIdIsTheBarcodeSide() {
        assertTrue(isBarcodeBearing(capture(DocumentSides.BACK, FileKind.BACK, barcodeNotFound)))
        assertTrue(isBarcodeBearing(capture(DocumentSides.FRONT, FileKind.FRONT, barcodeNotFound)))
    }

    @Test
    fun theHintMayStandAmongOthers() {
        val blurry = RetryHint("id_image_quality", listOf("image_blurry"))
        val both = RetryHint("id_barcode_detection", listOf("glare_present", "barcode_not_found"))
        assertTrue(isBarcodeBearing(capture(DocumentSides.BOTH, FileKind.BACK, blurry, both)))
    }

    @Test
    fun noSideIsWithoutTheServersMark() {
        assertFalse(isBarcodeBearing(capture(DocumentSides.BOTH, FileKind.BACK)))
        val other = RetryHint("id_image_quality", listOf("image_blurry", "glare_present"))
        assertFalse(isBarcodeBearing(capture(DocumentSides.BOTH, FileKind.BACK, other)))
        // The check's name alone is not the mark: only its barcode_not_found reason is.
        assertFalse(isBarcodeBearing(capture(DocumentSides.BOTH, FileKind.BACK, RetryHint("id_barcode_detection"))))
    }

    @Test
    fun onlyAGovernmentIdSideIsEver() {
        val selfie = SelfieStep("selfie", listOf(SelfiePose.CENTER), Liveness.PASSIVE, maxAttempts = 3)
        assertFalse(isBarcodeBearing(FlowState.Capture(selfie, FileKind.SELFIE_CENTER, 0, 1, listOf(barcodeNotFound))))
        assertFalse(isBarcodeBearing(FlowState.Capture(id(DocumentSides.BOTH), FileKind.DOCUMENT, 0, 1, listOf(barcodeNotFound))))
    }
}
