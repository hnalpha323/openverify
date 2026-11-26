package dev.openverify.sdk.signals

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.integrity.IntegrityTokenProvider
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSessionIntegrity
import dev.openverify.sdk.model.GovernmentIdStep
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.time.Duration.Companion.seconds

/**
 * C211.3 (Workflow 10B): the integrity request through the coordinator's hook, over a fake server that
 * asks for a token once consent is recorded (`integrity { request: true }`), as the server does when the
 * environment binds a device-integrity provider: nothing before consent, one challenge and one token
 * after it, none again on the next read, and a host provider that never answers holds nothing.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class IntegrityCoordinatorTest {

    private val idStep = DEFAULT_FLOW.steps[1] as GovernmentIdStep
    private val idFront = FlowState.Capture(idStep, FileKind.FRONT, index = 0, count = 2)
    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)

    /** [server]'s answers, its session asking for a token once it has consent. */
    private class AskingServer(val server: FakeFlowServer = FakeFlowServer()) : FlowApi by server {
        override suspend fun getSession(): FlowSession =
            server.getSession().let { session -> if (session.consent != null) session.copy(integrity = FlowSessionIntegrity(true)) else session }
    }

    private class Provider : IntegrityTokenProvider {
        val hashes = mutableListOf<String>()

        override suspend fun token(requestHash: String): String = TOKEN.also { hashes += requestHash }
    }

    private suspend fun coordinator(api: FlowApi, provider: IntegrityTokenProvider) =
        FlowCoordinator(api, INQUIRY_ID, settings, integrity = integrityVerdictRequest(api, provider)).also { it.cameraReady() }

    @Test
    fun `nothing before consent, and after it one challenge, the host's token for its hash, and one token post`() = runTest {
        val api = AskingServer()
        val provider = Provider()
        val coordinator = coordinator(api, provider)

        coordinator.start()
        advanceUntilIdle()
        assertEquals(emptyList<Any>(), api.server.integrityChallenges)

        coordinator.acceptConsent()
        advanceUntilIdle()

        val challenge = api.server.integrityChallenges.single()
        assertEquals(listOf(challenge.requestHash), provider.hashes)
        assertEquals(listOf(challenge.id to TOKEN), api.server.integrityTokens)
        assertEquals(idFront, coordinator.state.value)
    }

    @Test
    fun `a consented load requests it once, and a later read of the same launch requests nothing more`() = runTest {
        val api = AskingServer(FakeFlowServer(consent = FlowConsent(NOW)))
        val provider = Provider()
        val coordinator = coordinator(api, provider)

        coordinator.start()
        advanceUntilIdle()
        coordinator.start()
        advanceUntilIdle()

        assertEquals(1, api.server.integrityChallenges.size)
        assertEquals(1, api.server.integrityTokens.size)
    }

    @Test
    fun `a host provider that never answers holds neither the flow nor its next action`() = runTest {
        val cancelled = CompletableDeferred<Unit>()
        val silent = object : IntegrityTokenProvider {
            override suspend fun token(requestHash: String): String? = try {
                awaitCancellation()
            } finally {
                cancelled.complete(Unit)
            }
        }
        val api = AskingServer()
        val coordinator = coordinator(api, silent)
        coordinator.start()

        val consent = launch { coordinator.acceptConsent() }
        advanceUntilIdle()

        assertEquals(idFront, coordinator.state.value)
        assertEquals(1, api.server.integrityChallenges.size)
        assertEquals(emptyList<Pair<String, String>>(), api.server.integrityTokens)
        consent.cancel()
        advanceUntilIdle()
        assertTrue(cancelled.isCompleted)
    }

    private companion object {
        /** A synthetic token, never a real device's attestation. */
        const val TOKEN = "synthetic-integrity-token"
    }
}
