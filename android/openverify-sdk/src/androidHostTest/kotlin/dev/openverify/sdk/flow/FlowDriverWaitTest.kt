package dev.openverify.sdk.flow

import dev.openverify.sdk.FailureReason
import dev.openverify.sdk.InquiryOutcomes
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.conflict
import dev.openverify.sdk.flow.FakeFlowServer.Position
import dev.openverify.sdk.flow.FakeFlowServer.State
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.VerificationStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import kotlin.time.Duration.Companion.seconds

/**
 * C197.1, C197.2, C193.5: the waiting and halted positions, and the 409s the driver answers by
 * reading the session. A wait reads the session again after the server's `retry-after-ms` (2 s when
 * it names none) and names nothing of what is awaited; a halted flow ends `Failed(FLOW_HALTED)`; a
 * 409 `flow_step_not_current` from any step route reads the session and renders its position, never
 * an error screen and never a retry of the call.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class FlowDriverWaitTest {

    private val consent = DEFAULT_FLOW.steps[0] as ConsentStep
    private val idStep = DEFAULT_FLOW.steps[1] as GovernmentIdStep
    private val selfieId = DEFAULT_FLOW.steps[2].id
    private val done = CompletionStep("done")
    private val photo = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg")

    private suspend fun coordinator(api: FakeFlowServer, settings: FlowCoordinator.Settings = FlowCoordinator.Settings()) =
        FlowCoordinator(api, INQUIRY_ID, settings).also { it.cameraReady() }

    private fun TestScope.recordStates(coordinator: FlowCoordinator): List<FlowState> {
        val states = mutableListOf<FlowState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { coordinator.state.collect { states += it } }
        return states
    }

    // Waiting (C150.5, C197.1) ----------------------------------------------------------------

    @Test
    fun `a wait polls after the server's retry-after-ms, once, then renders the position it moves to`() = runTest {
        val server = FakeFlowServer(consent = FlowConsent(NOW))
        server.upcoming += Position("check", State.WAITING, previousStepId = consent.id, retryAfterMs = 1500)
        val coordinator = coordinator(server)
        val states = recordStates(coordinator)

        launch { coordinator.start() }
        runCurrent()
        assertEquals(FlowState.Waiting(1500), coordinator.state.value)
        advanceTimeBy(1499)
        runCurrent()
        assertEquals(listOf("getSession"), server.calls)
        advanceTimeBy(2)
        runCurrent()

        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
        assertEquals(listOf("getSession", "getSession"), server.calls)
        assertEquals(1, states.count { it is FlowState.Waiting }, states.toString())
    }

    @Test
    fun `a wait without retry-after-ms polls after 2 s, and a long wait is one waiting screen, announced once`() = runTest {
        val server = FakeFlowServer(consent = FlowConsent(NOW))
        repeat(3) { server.upcoming += Position("check", State.WAITING, previousStepId = consent.id) }
        val coordinator = coordinator(server)
        val states = recordStates(coordinator)

        coordinator.start()

        assertEquals(6_000, currentTime)
        assertEquals(4, server.calls.count { it == "getSession" })
        assertEquals(listOf(FlowState.Waiting(null)), states.filterIsInstance<FlowState.Waiting>())
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
    }

    @Test
    fun `an action after consent is a wait, then the step the server names (step-action)`() = runTest {
        val server = FakeFlowServer()
        val coordinator = coordinator(server)
        coordinator.start()
        server.upcoming += Position("run_check", State.WAITING, previousStepId = consent.id, retryAfterMs = 2000)

        coordinator.acceptConsent()

        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
        assertEquals(listOf("getSession", "acceptConsent", "getSession", "getSession"), server.calls)
    }

    @Test
    fun `a branch waiting on facts after the ID waits, then shows the step its route names (step-branch)`() = runTest {
        val server = FakeFlowServer(consent = FlowConsent(NOW), routes = mapOf(idStep.id to selfieId))
        server.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(server)
        val states = recordStates(coordinator)
        coordinator.start()
        server.upcoming += Position("id_routes", State.WAITING, previousStepId = idStep.id, retryAfterMs = 1000)

        coordinator.capture(photo)
        coordinator.confirmCapture()
        coordinator.capture(photo)
        coordinator.confirmCapture()

        assertTrue(FlowState.Waiting(1000) in states, states.toString())
        assertEquals(FileKind.SELFIE_CENTER, (coordinator.state.value as FlowState.Capture).kind)
    }

    @Test
    fun `a wait that never ends stops with a retry that reads the session again`() = runTest {
        val server = FakeFlowServer(consent = FlowConsent(NOW))
        val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)
        server.scripted = Position("check", State.WAITING, previousStepId = consent.id)
        val coordinator = coordinator(server, settings)

        coordinator.start()
        assertEquals(FlowState.Error(FlowError.STILL_PROCESSING, canRetry = true), coordinator.state.value)
        assertEquals(1 + settings.pollAttempts, server.calls.count { it == "getSession" })
        server.scripted = null

        coordinator.retry()

        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
    }

    // Halted (C151.2, C197.2) -------------------------------------------------------------------

    @Test
    fun `a halted position is the halted screen, which ends Failed FLOW_HALTED, and nothing more is called`() = runTest {
        val server = FakeFlowServer(consent = FlowConsent(NOW))
        server.scripted = Position(idStep.id, State.HALTED, previousStepId = consent.id)
        val coordinator = coordinator(server)

        coordinator.start()

        assertEquals(FlowState.Halted, coordinator.state.value)
        assertEquals(listOf("getSession"), server.calls)
        assertEquals(InquiryResult.Failed(INQUIRY_ID, FailureReason.FLOW_HALTED), InquiryOutcomes.forFinish(coordinator.state.value, INQUIRY_ID))
    }

    // flow_step_not_current (C193.5) ------------------------------------------------------------

    /** A call that the server refuses with 409 `flow_step_not_current`, by the action that sends it. */
    private class NotCurrent(val call: String, val start: FakeFlowServer.() -> Unit = {}, val act: suspend FlowCoordinator.() -> Unit)

    private val otpStep = PhoneOtpStep("phone", allowedCountries = listOf("US"), codeLength = 6)
    private val details = ScreenStep("extra_details", listOf(TextComponent("intro", "body", "extra_details.intro.text"), ButtonComponent("go", "extra_details.go.label", "submit")))

    @TestFactory
    fun `a 409 flow_step_not_current from each step route reads the session and renders its position, never an error`(): List<DynamicTest> = listOf(
        NotCurrent("acceptConsent", act = { acceptConsent() }),
        NotCurrent("createVerification:government-id", start = { consent = FlowConsent(NOW) }, act = { capture(photo); confirmCapture(); capture(photo); confirmCapture() }),
        NotCurrent("upload:front", start = { consent = FlowConsent(NOW) }, act = { capture(photo); confirmCapture(); capture(photo); confirmCapture() }),
        NotCurrent("submit", start = { consent = FlowConsent(NOW) }, act = { capture(photo); confirmCapture(); capture(photo); confirmCapture() }),
        NotCurrent("submitScreen", start = { consent = FlowConsent(NOW) }, act = { submitScreen(mapOf("nickname" to FlowValue.Text("Sam")), null) }),
        NotCurrent("sendOtp", start = { consent = FlowConsent(NOW) }, act = { sendOtp(OtpDestination.Phone("+12025550123")) }),
    ).map { case ->
        dynamicTest(case.call) {
            runTest {
                val steps = when (case.call) {
                    "submitScreen" -> listOf(consent, details, done)
                    "sendOtp" -> listOf(consent, otpStep, done)
                    else -> DEFAULT_FLOW.steps
                }
                val server = FakeFlowServer(steps = steps).apply(case.start)
                val coordinator = coordinator(server)
                val states = recordStates(coordinator)
                coordinator.start()
                server.failNext(case.call, conflict(FlowProblemCodes.FLOW_STEP_NOT_CURRENT))
                // The server's position moved on elsewhere (another device, a wait that ended).
                server.scripted = Position(done.id, State.ENDED, previousStepId = consent.id)

                case.act(coordinator)

                assertTrue(states.none { it is FlowState.Error }, states.toString())
                assertEquals(case.call, server.calls.dropLast(1).last(), server.calls.toString())
                assertEquals("getSession", server.calls.last())
                assertEquals(1, server.calls.count { it == case.call }, "never retried: ${server.calls}")
                assertTrue(coordinator.state.value is FlowState.Completed, coordinator.state.value.toString())
            }
        }
    }

    // Single-use POSTs whose earlier send may have landed (C193.5, review P26) -------------------

    @Test
    fun `a 409 to a submit that may already have landed reads the session before any error, and goes on from it`() = runTest {
        val server = FakeFlowServer(consent = FlowConsent(NOW))
        server.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(server)
        val states = recordStates(coordinator)
        coordinator.start()
        // The first submit landed and its answer was lost; the client's resend got the 409.
        server.loseAnswerOfNext("submit", conflict("verification_not_initiated"))

        coordinator.capture(photo)
        coordinator.confirmCapture()
        coordinator.capture(photo)
        coordinator.confirmCapture()

        assertTrue(states.none { it is FlowState.Error }, states.toString())
        assertEquals(1, server.calls.count { it == "submit" })
        assertEquals(FileKind.SELFIE_CENTER, (coordinator.state.value as FlowState.Capture).kind)
    }
}
