package dev.openverify.sdk.flow

import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.model.DeviceHandoffStep
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowHandoff
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import kotlin.time.Duration.Companion.seconds

/**
 * C96.1, C96.3, C194.2 (F01; C221.13): an SDK session is already on a phone, so the server skips
 * the handoff step for it (Phase 7 C96.1 amended, built by api-android-10a), and the driver never
 * walks past a step on its own. A position that still names a `device_handoff` step, whatever its
 * state, renders the unsupported screen through the registry rather than leaving the user on a step
 * the SDK has no screen for. The client's own walk over `FlowHandoff.done` is gone with the driver.
 */
internal class FlowCoordinatorHandoffTest {

    private val handoffStep = DeviceHandoffStep("handoff")
    private val flow = DEFAULT_FLOW.copy(steps = listOf(DEFAULT_FLOW.steps[0], handoffStep) + DEFAULT_FLOW.steps.drop(1))

    /** A server that serves the handoff step's position anyway, with the inquiry's handoff state (C96.3). */
    private suspend fun started(handoff: FlowHandoff?): FlowCoordinator {
        val api = FakeFlowServer(flow = flow, consent = FlowConsent(NOW), handoff = handoff)
        api.scripted = FakeFlowServer.Position(handoffStep.id, FakeFlowServer.State.ACTIVE, previousStepId = DEFAULT_FLOW.steps[0].id)
        return FlowCoordinator(api, INQUIRY_ID, FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3))
            .also { it.cameraReady() }
            .also { it.start() }
    }

    @ParameterizedTest
    @ValueSource(strings = ["pending", "issued", "rejected", "declined", "a-state-from-a-newer-server"])
    fun `a handoff step that is not done is unsupported here`(state: String) = runTest {
        val coordinator = started(FlowHandoff("handoff", state))

        assertEquals(FlowState.Unsupported("step device_handoff"), coordinator.state.value)
    }

    @Test
    fun `a handoff step without a state from the server is unsupported here`() = runTest {
        val coordinator = started(handoff = null)

        assertEquals(FlowState.Unsupported("step device_handoff"), coordinator.state.value)
    }
}
