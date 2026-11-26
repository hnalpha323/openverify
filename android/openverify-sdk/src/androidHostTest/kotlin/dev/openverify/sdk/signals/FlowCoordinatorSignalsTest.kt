package dev.openverify.sdk.signals

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.AndroidIntegritySignals
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSessionSignals
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.InquiryStatus
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.IOException
import kotlin.time.Duration.Companion.seconds

/**
 * C94.6, C94.7: the coordinator reads nothing about the device before the session may collect. Once
 * the server reports the session's tiers (after this session's consent, or on a session that already
 * has it), it sends one body beside the flow: a slow, failing or silent server never holds the flow.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class FlowCoordinatorSignalsTest {

    private val consentStep = DEFAULT_FLOW.steps[0] as ConsentStep
    private val idStep = DEFAULT_FLOW.steps[1] as GovernmentIdStep
    private val idFront = FlowState.Capture(idStep, FileKind.FRONT, index = 0, count = 2)
    private val integrity = FlowSessionSignals(integrity = true, recognition = false)

    /** The fake server with the session's tiers, reported only once consent is recorded (C94.6). */
    private class SignalsFlowApi(val fake: FakeFlowApi, var tiers: FlowSessionSignals?) : FlowApi by fake {
        val sent = mutableListOf<FlowSignals>()
        var sendFailure: Exception? = null

        /** Set when the server never answers the signals call; completed when the call is cancelled. */
        var silentSend: CompletableDeferred<Unit>? = null

        override suspend fun getSession(): FlowSession =
            fake.getSession().let { session -> session.copy(signals = tiers.takeIf { session.consent != null }) }

        override suspend fun sendSignals(signals: FlowSignals) {
            fake.calls += "sendSignals"
            sendFailure?.let { throw it }
            silentSend?.let { cancelled ->
                try {
                    awaitCancellation()
                } finally {
                    cancelled.complete(Unit)
                }
            }
            sent += signals
        }

        /** The session reads and signal sends, in the order they reached the server. */
        val signalCalls: List<String> get() = fake.calls.filter { it == "getSession" || it == "sendSignals" }
    }

    /** Device signals that record each collection and answer [answer]'s body. */
    private class RecordingSignals(
        val answer: (FlowSessionSignals, String, Int) -> FlowSignals? = { _, screen, sequence ->
            FlowSignals(
                collectorVersion = 1,
                screen = screen,
                sequence = sequence,
                androidIntegrity = AndroidIntegritySignals(debuggerConnected = false, appDebuggable = false),
                deviceClass = "smartphone",
            )
        },
    ) : DeviceSignals {
        val collected = mutableListOf<Triple<FlowSessionSignals, String, Int>>()

        override suspend fun collect(tiers: FlowSessionSignals, screen: String, sequence: Int): FlowSignals? {
            collected += Triple(tiers, screen, sequence)
            return answer(tiers, screen, sequence)
        }
    }

    private suspend fun coordinator(api: FlowApi, signals: DeviceSignals) =
        FlowCoordinator(api, INQUIRY_ID, FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3), signals)
            .also { it.cameraReady() }

    @Test
    fun `nothing is read before consent`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(), integrity)
        val signals = RecordingSignals()
        val coordinator = coordinator(api, signals)

        coordinator.start()

        assertEquals(FlowState.Consent(consentStep, retentionDays = FakeFlowApi.RETENTION_DAYS), coordinator.state.value)
        assertEquals(emptyList<Triple<FlowSessionSignals, String, Int>>(), signals.collected)
        assertEquals(listOf("getSession"), api.fake.calls)
    }

    @Test
    fun `after consent the session is read again for its tiers and one body is sent for the consent screen`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(), integrity)
        val signals = RecordingSignals()
        val coordinator = coordinator(api, signals)
        coordinator.start()

        coordinator.acceptConsent()
        advanceUntilIdle()

        assertEquals(listOf(Triple(integrity, "consent", 0)), signals.collected)
        assertEquals(listOf("getSession", "acceptConsent"), api.fake.calls.take(2))
        assertEquals(listOf("getSession", "getSession", "sendSignals"), api.signalCalls)
        assertEquals(listOf(signals.answer(integrity, "consent", 0)), api.sent)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `a session that already has consent sends one body when it loads, from the tiers it read`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(consent = FlowConsent(NOW)), integrity)
        val signals = RecordingSignals()
        val coordinator = coordinator(api, signals)

        coordinator.start()
        advanceUntilIdle()

        // C193.3: the body names the step the server's position names, here the ID after consent.
        assertEquals(listOf(Triple(integrity, idStep.id, 0)), signals.collected)
        assertEquals(listOf("getSession", "sendSignals"), api.signalCalls)
        assertEquals(1, api.sent.size)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `a later launch numbers its body from the session's next sequence (K7A-7)`() = runTest {
        val tiers = integrity.copy(nextSequence = 5)
        val api = SignalsFlowApi(FakeFlowServer(consent = FlowConsent(NOW)), tiers)
        val signals = RecordingSignals()
        val coordinator = coordinator(api, signals)

        coordinator.start()
        advanceUntilIdle()

        assertEquals(listOf(Triple(tiers, idStep.id, 5)), signals.collected)
        assertEquals(5, api.sent.single().sequence)
    }

    @Test
    fun `a decided inquiry shows its end and reads nothing about the device`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(inquiryStatus = InquiryStatus.COMPLETED, consent = FlowConsent(NOW)), integrity)
        val signals = RecordingSignals()
        val coordinator = coordinator(api, signals)

        coordinator.start()
        advanceUntilIdle()

        assertEquals(true, coordinator.state.value is FlowState.Completed, coordinator.state.value.toString())
        assertEquals(emptyList<Triple<FlowSessionSignals, String, Int>>(), signals.collected)
        assertEquals(listOf("getSession"), api.signalCalls)
    }

    @Test
    fun `a coordinator sends one body however often the session loads`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(consent = FlowConsent(NOW)), integrity)
        val signals = RecordingSignals()
        val coordinator = coordinator(api, signals)

        coordinator.start()
        coordinator.start()
        advanceUntilIdle()

        assertEquals(1, signals.collected.size)
        assertEquals(1, api.sent.size)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `a session that reports no tiers after consent reads and sends nothing`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(), tiers = null)
        val signals = RecordingSignals()
        val coordinator = coordinator(api, signals)
        coordinator.start()

        coordinator.acceptConsent()
        advanceUntilIdle()

        assertEquals(emptyList<Triple<FlowSessionSignals, String, Int>>(), signals.collected)
        assertEquals(emptyList<FlowSignals>(), api.sent)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `a body the device signals decline is not sent`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(), integrity)
        val signals = RecordingSignals(answer = { _, _, _ -> null })
        val coordinator = coordinator(api, signals)
        coordinator.start()

        coordinator.acceptConsent()
        advanceUntilIdle()

        assertEquals(1, signals.collected.size)
        assertEquals(false, "sendSignals" in api.fake.calls)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `a failed send never stops the flow`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(), integrity)
        api.sendFailure = FlowApiException.Network(IOException("synthetic: offline"))
        val coordinator = coordinator(api, RecordingSignals())
        coordinator.start()

        coordinator.acceptConsent()
        advanceUntilIdle()

        assertEquals(listOf("getSession", "getSession", "sendSignals"), api.signalCalls)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `a failed read after consent reads nothing about the device, and the retry sends the one body`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(), integrity)
        val signals = RecordingSignals()
        val coordinator = coordinator(api, signals)
        coordinator.start()
        // C193.3: the tiers come with the driver's own read after consent, which fails here.
        api.fake.failNext("getSession", FlowApiException.Network(IOException("synthetic: offline")))
        coordinator.acceptConsent()
        advanceUntilIdle()

        assertEquals(emptyList<Triple<FlowSessionSignals, String, Int>>(), signals.collected)
        assertEquals(FlowState.Error(dev.openverify.sdk.flow.FlowError.NETWORK, canRetry = true), coordinator.state.value)

        coordinator.retry()
        advanceUntilIdle()

        assertEquals(listOf(Triple(integrity, idStep.id, 0)), signals.collected)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `signals cost no session read beyond the driver's own, with or without device signals`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(), integrity)
        val coordinator = coordinator(api, DeviceSignals.None)
        coordinator.start()

        coordinator.acceptConsent()
        advanceUntilIdle()

        // C193.3: the one read after consent is the driver's; it would carry the tiers too.
        assertEquals(listOf("getSession", "getSession"), api.signalCalls)
        assertEquals(emptyList<FlowSignals>(), api.sent)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `a server that never answers the signals call holds neither the flow nor its actions, and the call ends with the caller's scope`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(consent = FlowConsent(NOW)), integrity)
        val cancelled = CompletableDeferred<Unit>().also { api.silentSend = it }
        val coordinator = coordinator(api, RecordingSignals())

        // As the view model runs every action: one launch per action.
        val start = launch { coordinator.start() }
        advanceUntilIdle()

        assertEquals(idFront, coordinator.state.value)
        assertEquals(listOf("getSession", "sendSignals"), api.signalCalls)
        // The coordinator takes its next action while the signals call is still open.
        coordinator.capture(CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg"))
        launch { coordinator.confirmCapture() }
        advanceUntilIdle()
        assertEquals(FlowState.Capture(idStep, FileKind.BACK, index = 1, count = 2), coordinator.state.value)

        start.cancel()
        advanceUntilIdle()
        assertEquals(true, cancelled.isCompleted)
    }

    @Test
    fun `a server that never answers the signals call after consent never holds the consent`() = runTest {
        val api = SignalsFlowApi(FakeFlowServer(), integrity)
        val cancelled = CompletableDeferred<Unit>().also { api.silentSend = it }
        val coordinator = coordinator(api, RecordingSignals())
        coordinator.start()

        // C193.3: the read after consent is the driver's own; the body still goes out beside the flow.
        val consent = launch { coordinator.acceptConsent() }
        advanceUntilIdle()

        assertEquals(idFront, coordinator.state.value)
        assertEquals(listOf("getSession", "getSession", "sendSignals"), api.signalCalls)
        consent.cancel()
        advanceUntilIdle()
        assertEquals(true, cancelled.isCompleted)
    }
}
