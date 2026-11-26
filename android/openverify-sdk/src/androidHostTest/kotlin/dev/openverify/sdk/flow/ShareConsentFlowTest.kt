package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowServer.Position
import dev.openverify.sdk.flow.FakeFlowServer.State
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowWithdrawableShareConsent
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.ShareConsentBiometric
import dev.openverify.sdk.model.ShareConsentSide
import dev.openverify.sdk.model.ShareConsentStep
import dev.openverify.sdk.model.ShareConsentText
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.security.MessageDigest
import kotlin.time.Duration.Companion.seconds

/**
 * C238.7, C237.6 (Phase 11, Workflow 11A; `clients-connect`): the driver at a `share_consent` step.
 * It shows the step the server composed, and before it reports a digest it takes SHA-256 over the
 * text it displays: a text (or biometric text) whose digest is not the one served, or a category
 * this SDK has no words for, is the unsupported screen, and nothing is sent. Accept sends the
 * digests and the separate tick (asked for first when the share carries biometric data); decline
 * sends nothing else; both then render where the server moved. The session's withdrawable share
 * consents are offered on every later screen, and a withdrawal keeps the person where they are.
 */
internal class ShareConsentFlowTest {

    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)
    private val consent = ConsentStep("consent", listOf("consent.biometric"), required = true)
    private val done = CompletionStep("done")
    private val body = "Example Source asks for your agreement to share the details it verified about you with Example Partner.\n\nTo withdraw, email privacy@example.com."
    private val biometricBody = "I agree that Example Source shares my biometric data with Example Partner."
    private val share = ShareConsentStep(
        id = "share_back",
        side = ShareConsentSide.SOURCE,
        recipientName = "Example Partner",
        sourceName = "Example Source",
        categories = listOf("identity-fields", "biometric"),
        text = ShareConsentText("en", body, sha256(body), listOf("share.consent.source")),
        biometric = ShareConsentBiometric(biometricBody, sha256(biometricBody)),
    )
    private val withdrawable = FlowWithdrawableShareConsent("share_back", ShareConsentSide.SOURCE, "Example Partner")

    private fun server(step: ShareConsentStep = share) =
        FakeFlowServer(listOf(consent, step, done), consent = FlowConsent(NOW)).apply {
            // The server moves on once the person chose, as the engine leaves the step on either exit.
            onShareConsentExit = { exit -> if (exit.exit != "withdraw") scripted = Position("done", State.ENDED, "share_back") }
        }

    private suspend fun started(server: FakeFlowServer) = FlowCoordinator(server, INQUIRY_ID, settings).also {
        it.cameraReady()
        it.start()
    }

    @Test
    fun `the step the server composed is shown as served`() = runTest {
        val coordinator = started(server())

        assertEquals(ShareConsentView(share), coordinator.state.value.shareConsentView())
    }

    @Test
    fun `a text or a biometric text whose digest is not the one served is the unsupported screen, and nothing is sent`() = runTest {
        val changed = listOf(
            share.copy(text = share.text.copy(sha256 = sha256("another text"))),
            share.copy(biometric = share.biometric?.copy(sha256 = sha256("another text"))),
        )
        for (step in changed) {
            val server = server(step)
            val coordinator = started(server)

            val state = coordinator.state.value
            assertTrue(state is FlowState.Unsupported, "$state")
            assertEquals(emptyList<FakeFlowApi.ShareConsentExit>(), server.shareConsentExits)
        }
    }

    @Test
    fun `a category this SDK has no words for is the unsupported screen`() = runTest {
        val coordinator = started(server(share.copy(categories = listOf("identity-fields", "later-category"))))

        assertTrue(coordinator.state.value is FlowState.Unsupported, "${coordinator.state.value}")
    }

    @Test
    fun `an accept that carries biometric data asks for the tick first, and sends nothing`() = runTest {
        val server = server()
        val coordinator = started(server)

        coordinator.acceptShareConsent(biometricTicked = false)

        assertEquals(ShareConsentView(share, tickMissing = true), coordinator.state.value.shareConsentView())
        assertEquals(emptyList<FakeFlowApi.ShareConsentExit>(), server.shareConsentExits)
    }

    @Test
    fun `accept sends the digest of each text displayed and the tick, then renders where the server moved`() = runTest {
        val server = server()
        val coordinator = started(server)

        coordinator.acceptShareConsent(biometricTicked = true)

        assertEquals(
            listOf(FakeFlowApi.ShareConsentExit("share_back", "accept", sha256(body), sha256(biometricBody), explicitBiometric = true)),
            server.shareConsentExits,
        )
        assertTrue(coordinator.state.value is FlowState.Completed, "${coordinator.state.value}")
    }

    @Test
    fun `a share without biometric data is accepted with no biometric digest and no tick`() = runTest {
        val server = server(share.copy(categories = listOf("identity-fields"), biometric = null))
        val coordinator = started(server)

        coordinator.acceptShareConsent(biometricTicked = false)

        assertEquals(listOf(FakeFlowApi.ShareConsentExit("share_back", "accept", sha256(body), null, explicitBiometric = false)), server.shareConsentExits)
    }

    @Test
    fun `decline sends nothing but the step, and the flow goes on`() = runTest {
        val server = server()
        val coordinator = started(server)

        coordinator.declineShareConsent()

        assertEquals(listOf(FakeFlowApi.ShareConsentExit("share_back", "decline")), server.shareConsentExits)
        assertTrue(coordinator.state.value is FlowState.Completed, "${coordinator.state.value}")
    }

    @Test
    fun `a step the server has moved past is read again and rendered, never an error`() = runTest {
        val server = server()
        val coordinator = started(server)
        server.failNext("acceptShareConsent", FlowApiException.Conflict(Problem(title = "Conflict", status = 409, code = FlowProblemCodes.FLOW_STEP_NOT_CURRENT), null))
        server.scripted = Position("done", State.ENDED, "share_back")

        coordinator.acceptShareConsent(biometricTicked = true)

        assertTrue(coordinator.state.value is FlowState.Completed, "${coordinator.state.value}")
    }

    @Test
    fun `the session's withdrawable share consents are offered, and a withdrawal keeps the person where they are`() = runTest {
        val server = server().apply {
            withdrawableShareConsents = listOf(withdrawable)
            scripted = Position("done", State.ENDED, "share_back")
        }
        val coordinator = started(server)
        assertEquals(ShareConsentWithdrawals(listOf(withdrawable)), coordinator.shareConsentWithdrawals.value)

        coordinator.withdrawShareConsent("share_back")

        assertEquals(listOf(FakeFlowApi.ShareConsentExit("share_back", "withdraw")), server.shareConsentExits)
        assertEquals(ShareConsentWithdrawals(withdrawnRecipient = "Example Partner"), coordinator.shareConsentWithdrawals.value)
        assertTrue(coordinator.state.value is FlowState.Completed, "${coordinator.state.value}")
    }

    @Test
    fun `a refused withdrawal says so and offers it again, and the screen stays`() = runTest {
        val server = server().apply {
            withdrawableShareConsents = listOf(withdrawable)
            scripted = Position("done", State.ENDED, "share_back")
        }
        val coordinator = started(server)
        server.failNext("withdrawShareConsent", FlowApiException.Network(java.io.IOException("offline")))

        coordinator.withdrawShareConsent("share_back")

        assertEquals(ShareConsentWithdrawals(listOf(withdrawable), failed = true), coordinator.shareConsentWithdrawals.value)
        assertTrue(coordinator.state.value is FlowState.Completed, "${coordinator.state.value}")
        // A step the session does not list is never sent.
        coordinator.withdrawShareConsent("another_step")
        assertEquals(emptyList<FakeFlowApi.ShareConsentExit>(), server.shareConsentExits)
    }

    @Test
    fun `no share consent is offered while the session lists none`() = runTest {
        val coordinator = started(server())

        assertEquals(ShareConsentWithdrawals.NONE, coordinator.shareConsentWithdrawals.value)
        assertNull(FlowState.Loading.shareConsentView())
    }

    private fun sha256(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.encodeToByteArray()).joinToString("") { "%02x".format(it) }
}
