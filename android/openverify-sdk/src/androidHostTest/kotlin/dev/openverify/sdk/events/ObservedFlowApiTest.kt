package dev.openverify.sdk.events

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.CaptureFailureReason
import dev.openverify.sdk.OpenVerifyEvent
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.camera.CameraCaptureException
import dev.openverify.sdk.camera.CameraLens
import dev.openverify.sdk.camera.CaptureCamera
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * The flow API as the coordinator sees it, observed for the chrome (every session the server answers)
 * and for C192's `Submitted` (each submission the server accepted), and the camera observed for
 * `CaptureFailed`. Neither changes a call, an answer or a failure.
 */
internal class ObservedFlowApiTest {

    private val sessions = mutableListOf<FlowSession>()
    private var submitted = 0

    private fun observed(server: FakeFlowServer) = ObservedFlowApi(server, onSession = { sessions += it }, onSubmitted = { submitted += 1 })

    @Test
    fun `a session read is seen as the server answered it`() = runTest {
        val api = observed(FakeFlowServer())

        val session = api.getSession()

        assertEquals(listOf(session), sessions)
        assertEquals(0, submitted)
    }

    @Test
    fun `a consent, a verification submit and a screen submission the server accepted are each one submission`() = runTest {
        val screen = ScreenStep("about-you", listOf(TextComponent("title", "title", "about-you.title.title")))
        val server = FakeFlowServer(steps = listOf(screen) + FakeFlowApi.DEFAULT_FLOW.steps)
        val api = observed(server)

        api.acceptConsent(listOf("consent.biometric"), "en")
        val verification = api.createVerification(VerificationType.GOVERNMENT_ID)
        assertEquals(1, submitted)
        api.submitVerification(verification.id)
        val answered = api.submitScreen("about-you", emptyMap(), null)

        assertEquals(3, submitted)
        assertEquals(listOf(answered), sessions)
    }

    @Test
    fun `a refused submission is not one, and its failure reaches the coordinator unchanged`() = runTest {
        val refusing = object : FakeFlowApi() {
            override suspend fun submitVerification(verificationId: String, capture: FlowSubmitCapture?): FlowVerification =
                throw FlowApiException.Conflict(null, null)
        }
        val api = ObservedFlowApi(refusing, onSession = { sessions += it }, onSubmitted = { submitted += 1 })

        assertThrows<FlowApiException.Conflict> { api.submitVerification("ver_01M5CK16P0D13FXHZSS4TCFBV0") }

        assertEquals(0, submitted)
    }

    private class FailingCamera(private val failure: Throwable) : CaptureCamera {
        @Composable
        override fun Preview(lens: CameraLens, modifier: Modifier) = Unit

        override suspend fun takePicture(): CapturedImage = throw failure
    }

    private val events = mutableListOf<OpenVerifyEvent>()
    private val tracker = FlowEventTracker("inq_01M5CJXHG07XPHF3HRM6NREDH7", FlowEvents({ events += it }))

    @Test
    fun `a photo the camera could not take is a camera error, and its failure goes on as it was`() = runTest {
        val failure = CameraCaptureException("The camera could not take a photo")

        val thrown = assertThrows<CameraCaptureException> { EventingCaptureCamera(FailingCamera(failure), tracker).takePicture() }

        assertSame(failure, thrown)
        assertEquals(listOf<OpenVerifyEvent>(OpenVerifyEvent.CaptureFailed(CaptureFailureReason.CAMERA_ERROR)), events)
    }

    @Test
    fun `a photo too large for the heap is out of memory`() = runTest {
        assertThrows<OutOfMemoryError> { EventingCaptureCamera(FailingCamera(OutOfMemoryError("synthetic")), tracker).takePicture() }

        assertEquals(listOf<OpenVerifyEvent>(OpenVerifyEvent.CaptureFailed(CaptureFailureReason.OUT_OF_MEMORY)), events)
    }

    @Test
    fun `a cancelled photo is no failure`() = runTest {
        assertThrows<kotlinx.coroutines.CancellationException> {
            EventingCaptureCamera(FailingCamera(kotlinx.coroutines.CancellationException("left the screen")), tracker).takePicture()
        }

        assertEquals(emptyList<OpenVerifyEvent>(), events)
    }
}
