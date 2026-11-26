package dev.openverify.sdk.capture

import dev.openverify.sdk.InquiryLaunchScope
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.capture.document.DocumentGuidance
import dev.openverify.sdk.capture.selfie.FakeFaceDetector
import dev.openverify.sdk.capture.selfie.SelfieCaptureWindow
import dev.openverify.sdk.capture.selfie.SelfieGuidance
import dev.openverify.sdk.face.FaceDetector
import dev.openverify.sdk.face.FaceDetectorFactory
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.Liveness
import dev.openverify.sdk.model.SelfieCaptureGuidance
import dev.openverify.sdk.model.SelfiePose
import dev.openverify.sdk.model.SelfieStep
import kotlin.time.TimeSource
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

/**
 * Workflow 10B Stage 3 (integration-10b; selfie-guidance's and capture-pipeline's missing hook): each
 * launch holds one capture guidance, the selfie guidance over the built-in document and barcode guidance,
 * so a rotation keeps it and the centre yaw ratio passes between a capture's prompts. A selfie prompt is
 * guided only with an installed detector and the open capture's thresholds (C204.6: without a detector,
 * today's manual shutter); every other capture goes to the built-in guidance.
 */
internal class LaunchCaptureGuidanceTest {

    private val selfie = SelfieStep("selfie", listOf(SelfiePose.CENTER, SelfiePose.LEFT, SelfiePose.RIGHT), Liveness.PASSIVE, maxAttempts = 3)
    private val id = GovernmentIdStep("id", DocumentSides.FRONT, maxAttempts = 3, captureMethods = listOf(CaptureMethod.CAMERA))
    private val thresholds = SelfieCaptureGuidance(maxCenterYawRatio = 0.021, minSideYawRatioChange = 0.077, holdMs = 500)
    private val detectors = object : FaceDetectorFactory {
        override fun create(): FaceDetector = FakeFaceDetector()
    }
    private val centre = FlowState.Capture(selfie, FileKind.SELFIE_CENTER, 0, 3)
    private val front = FlowState.Capture(id, FileKind.FRONT, 0, 1)

    private fun scope(installed: FaceDetectorFactory?, guidance: SelfieCaptureGuidance?) =
        InquiryLaunchScope("inq_01M5CJZC301G4JHXZQ3PZBYH3P", OpenVerifyComponents(faceDetectorFactory = installed)).also {
            it.selfieWindow = MutableStateFlow(SelfieCaptureWindow("self_x", TimeSource.Monotonic.markNow(), guidance))
        }

    @Test
    fun `a selfie prompt is guided with an installed detector and the open capture's thresholds`() {
        assertInstanceOf(SelfieGuidance::class.java, scope(detectors, thresholds).captureGuidance.create(centre)?.also { it.close() })
    }

    @Test
    fun `without a detector, or before the capture names its thresholds, the selfie keeps the manual shutter`() {
        assertNull(scope(null, thresholds).captureGuidance.create(centre))
        assertNull(scope(detectors, null).captureGuidance.create(centre))
    }

    @Test
    fun `an ID side goes to the built-in guidance, and the launch keeps one guidance`() {
        val scope = scope(detectors, thresholds)
        assertInstanceOf(DocumentGuidance::class.java, scope.captureGuidance.create(front)?.also { it.close() })
        assertSame(scope.captureGuidance, scope.captureGuidance)
    }
}
