package dev.openverify.sdk.ui

import dev.openverify.sdk.capture.document.DocumentGuide
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * Workflow 10B Stage 3 (integration-10b; document-guidance's hook, C202.1): the frame the preview draws
 * on an ID side is the one the document guidance measures, so a passport-only step's front shows the
 * TD3 page (125 x 88 mm) and every other ID side the ID-1 card.
 */
internal class CaptureGuideAspectTest {

    private fun side(classes: List<String>?, kind: FileKind = FileKind.FRONT) = FlowState.Capture(
        GovernmentIdStep("id", DocumentSides.FRONT, allowedIdClasses = classes, maxAttempts = 3, captureMethods = listOf(CaptureMethod.CAMERA)),
        kind,
        0,
        1,
    )

    @Test
    fun `an ID side's frame is the one the document guidance measures`() {
        for (state in listOf(side(listOf("passport")), side(null), side(listOf("passport", "drivers_license")))) {
            assertEquals(DocumentGuide.aspectOf(state).toFloat(), captureGuideAspect(state), "${state.step}")
        }
    }

    @Test
    fun `a passport-only front shows the TD3 page`() {
        assertEquals((125.0 / 88.0).toFloat(), captureGuideAspect(side(listOf("passport"))))
    }
}
