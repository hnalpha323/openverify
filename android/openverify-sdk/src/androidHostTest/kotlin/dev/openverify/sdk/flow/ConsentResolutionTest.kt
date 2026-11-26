package dev.openverify.sdk.flow

import dev.openverify.sdk.FailureReason
import dev.openverify.sdk.InquiryOutcomes
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.Problem
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.time.Duration.Companion.seconds

/**
 * The consent step's two coordinator hooks carried from Workflow 10A (Stage 4 amendment 9):
 * - KP10-6, C200.5: a 422 `consent_text_mismatch` is never a consent: the coordinator reads the
 *   session and shows the consent again with [FlowState.Consent.textChanged], not the generic
 *   "out of sync" retry;
 * - KP10-7, C200.2, C199.7: a required legal consent text that cannot be shown as written (an
 *   operator text naming a value the session does not give) ends the flow unsupported, so closing it
 *   reports `Failed(UNSUPPORTED_FLOW)`, whatever language the person later picks.
 */
internal class ConsentResolutionTest {

    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)

    private suspend fun coordinator(api: FlowApi) = FlowCoordinator(api, INQUIRY_ID, settings).also { it.cameraReady() }

    /** [server] with operator [copy] and the organisation's name (C162, C200.2) on every session it answers. */
    private fun withCopy(server: FakeFlowServer, copy: FlowCopy, organization: String?) = object : FlowApi by server {
        override suspend fun getSession(): FlowSession = server.getSession().copy(copy = copy, organizationDisplayName = organization)
    }

    private val mismatch = FlowApiException.Rejected(422, Problem(status = 422, code = FlowProblemCodes.CONSENT_TEXT_MISMATCH), null)

    // KP10-6 ---------------------------------------------------------------------------------------

    @Test
    fun `a consent the server cannot match is shown again from a fresh session with textChanged, and nothing is recorded`() = runTest {
        val server = FakeFlowServer()
        val coordinator = coordinator(server)
        coordinator.start()
        server.failNext("acceptConsent", mismatch)

        coordinator.acceptConsent()

        assertEquals(listOf("getSession", "acceptConsent", "getSession"), server.calls)
        val state = coordinator.state.value
        assertTrue(state is FlowState.Consent && state.textChanged && !state.submitting, "$state")
        assertNull(server.consent)
    }

    @Test
    fun `the next acceptance after a changed text records the consent and goes on`() = runTest {
        val server = FakeFlowServer()
        val coordinator = coordinator(server)
        coordinator.start()
        server.failNext("acceptConsent", mismatch)
        coordinator.acceptConsent()

        coordinator.acceptConsent()

        assertTrue(server.consent != null)
        assertFalse(coordinator.state.value is FlowState.Consent, "${coordinator.state.value}")
    }

    @Test
    fun `any other refusal of the consent still shows the error with its retry`() = runTest {
        val server = FakeFlowServer()
        val coordinator = coordinator(server)
        coordinator.start()
        server.failNext("acceptConsent", FlowApiException.Rejected(422, Problem(status = 422, code = "validation_failed"), null))

        coordinator.acceptConsent()

        assertTrue(coordinator.state.value is FlowState.Error, "${coordinator.state.value}")
        assertEquals(listOf("getSession", "acceptConsent"), server.calls)
    }

    // KP10-7 ---------------------------------------------------------------------------------------

    @Test
    fun `an operator legal consent text naming an absent organisation ends unsupported, so closing fails UNSUPPORTED_FLOW`() = runTest {
        val api = withCopy(FakeFlowServer(), FlowCopy(mapOf("en" to mapOf("consent.biometric" to "{organization} compares your selfie with your ID."))), organization = null)
        val coordinator = coordinator(api)

        coordinator.start()

        val state = coordinator.state.value
        assertEquals(FlowState.Unsupported("consent text consent.biometric"), state)
        assertEquals(InquiryResult.Failed(INQUIRY_ID, FailureReason.UNSUPPORTED_FLOW), InquiryOutcomes.forFinish(state, INQUIRY_ID))
    }

    @Test
    fun `the check does not depend on the language chosen later, a text in another language counts too`() = runTest {
        val api = withCopy(FakeFlowServer(), FlowCopy(mapOf("es" to mapOf("consent.processing" to "Tratamos {nombre} para esta verificación."))), organization = "Example Verification Ltd")
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Unsupported("consent text consent.processing"), coordinator.state.value)
    }

    @Test
    fun `an operator legal text whose placeholders the session fills shows the consent`() = runTest {
        val api = withCopy(FakeFlowServer(), FlowCopy(mapOf("en" to mapOf("consent.biometric" to "{organization} compares your selfie with your ID."))), organization = "Example Verification Ltd")
        val coordinator = coordinator(api)

        coordinator.start()

        assertTrue(coordinator.state.value is FlowState.Consent, "${coordinator.state.value}")
    }
}
