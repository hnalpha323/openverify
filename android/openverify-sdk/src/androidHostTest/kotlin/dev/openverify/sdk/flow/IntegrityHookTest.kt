package dev.openverify.sdk.flow

import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.signals.IntegrityVerdictRequest
import java.io.IOException
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * C211.3 (Workflow 10B Stage 1b, foundation-10b's hook for `device-integrity-android`): the coordinator
 * calls [IntegrityVerdictRequest.requestIntegrityVerdict] after this session's consent, with the session
 * read after it, and on a load of a session that already has consent, beside the flow as it sends the
 * signals (rule 22): never before consent, never for a decided inquiry, never awaited, a failure
 * swallowed, so a server or provider that never answers holds neither the flow nor its actions.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class IntegrityHookTest {

    private val idStep = DEFAULT_FLOW.steps[1] as GovernmentIdStep
    private val idFront = FlowState.Capture(idStep, FileKind.FRONT, index = 0, count = 2)
    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)

    /** Records each session it was called with; [silent] never answers, [failure] throws. */
    private class RecordingRequest(
        val silent: CompletableDeferred<Unit>? = null,
        val failure: Exception? = null,
    ) : IntegrityVerdictRequest {
        val sessions = mutableListOf<FlowSession>()

        override suspend fun requestIntegrityVerdict(session: FlowSession) {
            sessions += session
            failure?.let { throw it }
            silent?.let { cancelled ->
                try {
                    awaitCancellation()
                } finally {
                    cancelled.complete(Unit)
                }
            }
        }
    }

    private suspend fun coordinator(api: FakeFlowApi, request: IntegrityVerdictRequest) =
        FlowCoordinator(api, INQUIRY_ID, settings, integrity = request).also { it.cameraReady() }

    @Test
    fun `nothing is requested before consent`() = runTest {
        val request = RecordingRequest()
        val coordinator = coordinator(FakeFlowServer(), request)

        coordinator.start()
        advanceUntilIdle()

        assertEquals(emptyList<FlowSession>(), request.sessions)
    }

    @Test
    fun `after consent, the request runs once with the session read after it`() = runTest {
        val api = FakeFlowServer()
        val request = RecordingRequest()
        val coordinator = coordinator(api, request)
        coordinator.start()

        coordinator.acceptConsent()
        advanceUntilIdle()

        assertEquals(1, request.sessions.size)
        val session = request.sessions.single()
        assertTrue(session.consent != null)
        assertEquals(idStep.id, session.position?.stepId)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `a load of a session that already has consent requests it, for the step its position names`() = runTest {
        val request = RecordingRequest()
        val coordinator = coordinator(FakeFlowServer(consent = FlowConsent(NOW)), request)

        coordinator.start()
        advanceUntilIdle()

        assertEquals(listOf(idStep.id), request.sessions.map { it.position?.stepId })
    }

    @Test
    fun `a decided inquiry requests nothing`() = runTest {
        val request = RecordingRequest()
        val api = FakeFlowServer(inquiryStatus = InquiryStatus.COMPLETED, consent = FlowConsent(NOW))
        val coordinator = coordinator(api, request)

        coordinator.start()
        advanceUntilIdle()

        assertTrue(coordinator.state.value is FlowState.Completed)
        assertEquals(emptyList<FlowSession>(), request.sessions)
    }

    @Test
    fun `a request that fails is swallowed and the flow goes on`() = runTest {
        val request = RecordingRequest(failure = IOException("offline"))
        val coordinator = coordinator(FakeFlowServer(), request)
        coordinator.start()

        coordinator.acceptConsent()
        advanceUntilIdle()

        assertEquals(1, request.sessions.size)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `a request that never answers holds neither the consent nor the next action, and ends with the caller's scope`() = runTest {
        val cancelled = CompletableDeferred<Unit>()
        val request = RecordingRequest(silent = cancelled)
        val coordinator = coordinator(FakeFlowServer(), request)
        coordinator.start()

        // As the view model runs every action: one launch per action.
        val consent = launch { coordinator.acceptConsent() }
        advanceUntilIdle()

        assertEquals(idFront, coordinator.state.value)
        assertEquals(1, request.sessions.size)
        coordinator.capture(dev.openverify.sdk.camera.CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg"))
        launch { coordinator.confirmCapture() }
        advanceUntilIdle()
        assertEquals(FlowState.Capture(idStep, FileKind.BACK, index = 1, count = 2), coordinator.state.value)

        consent.cancel()
        advanceUntilIdle()
        assertTrue(cancelled.isCompleted)
    }

    @Test
    fun `without a request installed the flow is today's`() = runTest {
        val api = FakeFlowServer()
        val coordinator = FlowCoordinator(api, INQUIRY_ID, settings).also { it.cameraReady() }
        coordinator.start()

        coordinator.acceptConsent()
        advanceUntilIdle()

        assertEquals(idFront, coordinator.state.value)
        assertEquals(listOf("getSession", "acceptConsent", "getSession"), api.calls)
        assertEquals(emptyList<Any>(), api.integrityChallenges)
    }
}
