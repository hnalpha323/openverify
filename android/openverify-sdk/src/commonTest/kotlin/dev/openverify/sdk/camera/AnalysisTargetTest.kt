package dev.openverify.sdk.camera

import dev.openverify.sdk.fixtures.readContractFixture
import dev.openverify.sdk.model.FileKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** C201.2 (review F11): the analysis size of each capture, at the still's 4:3 shape. */
class AnalysisTargetTest {

    @Test
    fun aSelfieIsReadAtTheFixturesPreviewWidth() {
        val client = Json.parseToJsonElement(readContractFixture("flow/selfie-capture.json")).jsonObject.getValue("client").jsonObject
        val width = client.getValue("preview-width-px").jsonPrimitive.int

        listOf(FileKind.SELFIE_CENTER, FileKind.SELFIE_LEFT, FileKind.SELFIE_RIGHT).forEach { kind ->
            assertEquals(AnalysisTarget.SELFIE, AnalysisTarget.of(kind, barcodeBearing = false))
        }
        assertEquals(width, AnalysisTarget.SELFIE.longSidePx)
        assertEquals(AnalysisTarget.SELFIE, AnalysisTarget.of(CameraLens.FRONT))
    }

    @Test
    fun aCardOrAPageIsReadAtAbout640AndABarcodeBearingSideAtAtLeast1280() {
        listOf(FileKind.FRONT, FileKind.BACK, FileKind.PORTRAIT, FileKind.DOCUMENT).forEach { kind ->
            assertEquals(AnalysisTarget.DOCUMENT, AnalysisTarget.of(kind, barcodeBearing = false), kind.name)
        }
        assertEquals(640, AnalysisTarget.DOCUMENT.longSidePx)
        // KP10-21: the side the server marks, a back or a front-only ID's front, never every back.
        assertEquals(AnalysisTarget.BARCODE, AnalysisTarget.of(FileKind.BACK, barcodeBearing = true))
        assertEquals(AnalysisTarget.BARCODE, AnalysisTarget.of(FileKind.FRONT, barcodeBearing = true))
        assertTrue(AnalysisTarget.BARCODE.longSidePx >= 1280)
        assertEquals(AnalysisTarget.DOCUMENT, AnalysisTarget.of(CameraLens.BACK))
    }

    @Test
    fun theDocumentAndBarcodeWidthsAreTheSharedFiles() {
        // KP10-23: one source for each width, `contracts/fixtures/flow/document-capture.json`.
        val client = Json.parseToJsonElement(readContractFixture("flow/document-capture.json")).jsonObject.getValue("client").jsonObject

        assertEquals(client.getValue("analysis-width-px").jsonPrimitive.int, AnalysisTarget.DOCUMENT.longSidePx)
        assertEquals(client.getValue("barcode-analysis-width-px").jsonPrimitive.int, AnalysisTarget.BARCODE.longSidePx)
    }

    @Test
    fun everyTargetHasTheStillsFourToThreeShape() {
        AnalysisTarget.entries.forEach { target -> assertEquals(target.longSidePx * 3, target.shortSidePx * 4, target.name) }
    }
}
