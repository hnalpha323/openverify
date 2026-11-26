package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.capture.AutoCapture
import dev.openverify.sdk.capture.CaptureGuidance
import dev.openverify.sdk.capture.CaptureGuidanceFactory
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
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.camera.AnalysisFrame

/**
 * C204.3, C204.6: the selfie owner's factory guides a selfie pose's prompt only with an installed
 * detector and the open capture's server thresholds, leaves every other state to the next factory, and
 * keeps today's manual shutter (no guidance) without a detector.
 */
internal class SelfieGuidanceFactoryTest {

    private val selfie = SelfieStep("selfie", listOf(SelfiePose.CENTER, SelfiePose.LEFT, SelfiePose.RIGHT), Liveness.PASSIVE, maxAttempts = 3)
    private val id = GovernmentIdStep("id", DocumentSides.FRONT, maxAttempts = 3, captureMethods = listOf(CaptureMethod.CAMERA))
    private val server = SelfieCaptureGuidance(maxCenterYawRatio = 0.021, minSideYawRatioChange = 0.077, holdMs = 500)
    private val detectors = object : FaceDetectorFactory {
        override fun create(): FaceDetector = FakeFaceDetector()
    }

    private fun pose(kind: FileKind, index: Int = 0, image: CapturedImage? = null) = FlowState.Capture(selfie, kind, index, 3, image = image)

    private object Next : CaptureGuidanceFactory {
        val guidance = object : CaptureGuidance {
            override suspend fun run(frames: Flow<AnalysisFrame>, autoCapture: AutoCapture) {}
            override val shutterPrimary: StateFlow<Boolean> = MutableStateFlow(false)

            @Composable
            override fun Overlay(modifier: Modifier) {}

            override fun close() {}
        }

        override fun create(state: FlowState.Capture): CaptureGuidance = guidance
    }

    @Test
    fun eachSelfiePosesPromptIsGuidedWithItsOwnPose() {
        val factory = SelfieGuidanceFactory(detectors, { server })

        for ((kind, pose) in listOf(FileKind.SELFIE_CENTER to SelfiePose.CENTER, FileKind.SELFIE_LEFT to SelfiePose.LEFT, FileKind.SELFIE_RIGHT to SelfiePose.RIGHT)) {
            val guidance = assertIs<SelfieGuidance>(factory.create(pose(kind)))
            assertEquals(GuidanceMachine.instruction(pose), guidance.view.value.message)
        }
    }

    @Test
    fun withoutADetectorASelfieKeepsTodaysShutter() {
        assertNull(SelfieGuidanceFactory(null, { server }).create(pose(FileKind.SELFIE_CENTER)))
    }

    @Test
    fun withoutTheCapturesThresholdsNoGuidanceGuessesThem() {
        assertNull(SelfieGuidanceFactory(detectors, { null }).create(pose(FileKind.SELFIE_CENTER)))
    }

    @Test
    fun aPhotoUnderReviewIsNotGuided() {
        val image = CapturedImage(byteArrayOf(1, 2, 3), "image/jpeg")

        assertNull(SelfieGuidanceFactory(detectors, { server }).create(pose(FileKind.SELFIE_CENTER, image = image)))
    }

    @Test
    fun everyOtherStateGoesToTheNextFactory() {
        val factory = SelfieGuidanceFactory(detectors, { server }, next = Next)

        assertSame(Next.guidance, factory.create(FlowState.Capture(id, FileKind.FRONT, 0, 1)))
        assertNull(SelfieGuidanceFactory(detectors, { server }).create(FlowState.Capture(id, FileKind.FRONT, 0, 1)))
    }

    @Test
    fun thePromptsOfOneCaptureShareTheCentreRatio() {
        val factory = SelfieGuidanceFactory(detectors, { server })
        val centre = assertIs<SelfieGuidance>(factory.create(pose(FileKind.SELFIE_CENTER)))
        val left = assertIs<SelfieGuidance>(factory.create(pose(FileKind.SELFIE_LEFT, index = 1)))

        assertSame(centre.centreRatio, left.centreRatio)
    }
}
