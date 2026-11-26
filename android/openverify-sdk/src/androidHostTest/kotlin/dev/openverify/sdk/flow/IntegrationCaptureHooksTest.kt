package dev.openverify.sdk.flow

import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.GUIDANCE
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CaptureMethodsByDevice
import dev.openverify.sdk.model.EnvironmentKind
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowEnvironment
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.testTimeSource
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Workflow 10B Stage 3 (integration-10b): the coordinator hooks the Stage 2 reports named.
 * - C204 (selfie-guidance's missing hook): the open selfie capture's window carries the capture's own
 *   pose thresholds, so the selfie guidance never guesses them.
 * - C206.1 (capture-pipeline's missing hook): what the SDK offers for an ID step is its native entry
 *   (`nativeCaptureMethods`), not the web's list.
 */
internal class IntegrationCaptureHooksTest {

    private val idStep = DEFAULT_FLOW.steps[1] as GovernmentIdStep
    private val passedId = verification("ver_01M5CJZC301G4JHXZQ3PZBYH3P", VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED)
    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)

    private fun consented(steps: List<dev.openverify.sdk.model.FlowStep> = DEFAULT_FLOW.steps, vararg verifications: dev.openverify.sdk.model.FlowVerification) =
        FakeFlowServer(steps = steps, inquiryStatus = InquiryStatus.PENDING, consent = FlowConsent(NOW), verifications = verifications.toList())

    private suspend fun TestScope.coordinator(api: FakeFlowApi) =
        FlowCoordinator(api, INQUIRY_ID, settings.copy(timeSource = testTimeSource)).also { it.cameraReady() }

    @Test
    fun `the open selfie capture's window carries the capture's pose thresholds`() = runTest {
        val api = consented(DEFAULT_FLOW.steps, passedId).also { it.decide(VerificationStatus.PASSED, InquiryStatus.PENDING) }
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(GUIDANCE, coordinator.selfieCapture.value?.guidance)
    }

    @Test
    fun `an ID step whose native entry names the camera is captured, though its web list names only uploads`() = runTest {
        val step = idStep.copy(captureMethods = listOf(CaptureMethod.UPLOAD), captureMethodsByDevice = CaptureMethodsByDevice(native = listOf(CaptureMethod.CAMERA)))
        val coordinator = coordinator(consented(listOf(DEFAULT_FLOW.steps[0], step)))

        coordinator.start()

        assertTrue(coordinator.state.value is FlowState.Capture, "${coordinator.state.value}")
    }

    @Test
    fun `an ID step whose native entry names only uploads is unsupported, though its web list names the camera`() = runTest {
        val step = idStep.copy(captureMethods = listOf(CaptureMethod.CAMERA), captureMethodsByDevice = CaptureMethodsByDevice(native = listOf(CaptureMethod.UPLOAD)))
        val coordinator = coordinator(consented(listOf(DEFAULT_FLOW.steps[0], step)))

        coordinator.start()

        assertTrue(coordinator.state.value is FlowState.Unsupported, "${coordinator.state.value}")
    }

    @Test
    fun `in a sandbox a photo may be picked only when the native entry allows uploads`() = runTest {
        val allowed = idStep.copy(
            captureMethods = listOf(CaptureMethod.CAMERA),
            captureMethodsByDevice = CaptureMethodsByDevice(native = listOf(CaptureMethod.CAMERA, CaptureMethod.UPLOAD)),
        )
        val refused = idStep.copy(
            captureMethods = listOf(CaptureMethod.CAMERA, CaptureMethod.UPLOAD),
            captureMethodsByDevice = CaptureMethodsByDevice(native = listOf(CaptureMethod.CAMERA)),
        )
        for ((step, expected) in listOf(allowed to true, refused to false)) {
            val api = consented(listOf(DEFAULT_FLOW.steps[0], step)).also { it.environment = FlowEnvironment(EnvironmentKind.SANDBOX) }
            val coordinator = coordinator(api)
            coordinator.start()
            val capture = coordinator.state.value as FlowState.Capture
            if (expected) assertTrue(capture.uploadAllowed) else assertFalse(capture.uploadAllowed)
        }
    }
}
