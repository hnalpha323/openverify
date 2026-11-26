package dev.openverify.sdk.capture.document

import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/** C202: the document owner's guidance is for an ID side only; a passport-only step's front is a TD3 page with its band. */
class DocumentGuidanceFactoryTest {
    private val factory = DocumentGuidanceFactory()

    private fun capture(kind: FileKind, classes: List<String>? = null): FlowState.Capture = FlowState.Capture(
        step = GovernmentIdStep("id", DocumentSides.BOTH, allowedIdClasses = classes, maxAttempts = 3, captureMethods = listOf(CaptureMethod.CAMERA)),
        kind = kind,
        index = 0,
        count = 2,
    )

    @Test
    fun eachIdSideHasTheCardGuidance() {
        for (kind in listOf(FileKind.FRONT, FileKind.BACK)) {
            val guidance = assertIs<DocumentGuidance>(factory.create(capture(kind)))
            guidance.close()
            assertEquals(DocumentGuide.CARD_ASPECT, DocumentGuide.aspectOf(capture(kind)))
            assertEquals(false, DocumentGuide.isPassportPage(capture(kind)))
        }
    }

    @Test
    fun aPassportOnlyStepsFrontIsAPassportPage() {
        val front = capture(FileKind.FRONT, listOf("passport"))
        assertEquals(true, DocumentGuide.isPassportPage(front))
        assertEquals(DocumentGuide.PASSPORT_ASPECT, DocumentGuide.aspectOf(front))
        assertEquals(false, DocumentGuide.isPassportPage(capture(FileKind.FRONT, listOf("passport", "drivers_license"))))
        assertEquals(false, DocumentGuide.isPassportPage(capture(FileKind.BACK, listOf("passport"))))
    }

    @Test
    fun selfiesAndDocumentsKeepTodaysScreen() {
        for (kind in listOf(FileKind.SELFIE_CENTER, FileKind.SELFIE_LEFT, FileKind.SELFIE_RIGHT, FileKind.DOCUMENT, FileKind.PORTRAIT)) {
            assertNull(factory.create(capture(kind)), kind.name)
        }
    }
}
