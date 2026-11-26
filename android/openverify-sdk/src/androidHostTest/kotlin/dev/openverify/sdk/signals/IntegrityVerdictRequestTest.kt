package dev.openverify.sdk.signals

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.integrity.IntegrityTokenProvider
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowIntegrityChallenge
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSessionIntegrity
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.Problem
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException

/**
 * C211.2, C211.3 (Workflow 10B): the SDK's integrity request over a fake flow API and a fake host
 * provider: one challenge, the host's token for its request hash, one token post; at most once, only
 * when a consented, undecided session asks; every failure sends nothing more. Synthetic tokens only.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class IntegrityVerdictRequestTest {

    /** The flow API's integrity calls and session reads, in order, with failures to inject. */
    private class RecordingApi(
        val challengeFailure: Exception? = null,
        val challenge: FlowIntegrityChallenge? = null,
        val tokenFailure: Exception? = null,
        private val fake: FakeFlowApi = FakeFlowServer(),
    ) : FlowApi by fake {
        val calls = mutableListOf<String>()
        val tokens: List<Pair<String, String>> get() = fake.integrityTokens
        val challenges: List<FlowIntegrityChallenge> get() = fake.integrityChallenges

        override suspend fun createIntegrityChallenge(): FlowIntegrityChallenge {
            calls += "challenge"
            challengeFailure?.let { throw it }
            return challenge ?: fake.createIntegrityChallenge()
        }

        override suspend fun sendIntegrityToken(challengeId: String, token: String) {
            calls += "token"
            tokenFailure?.let { throw it }
            fake.sendIntegrityToken(challengeId, token)
        }

        override suspend fun getSession(): FlowSession = fake.getSession().also { calls += "session" }
    }

    /** A host provider answering [answer] (or throwing [failure]), recording each hash it was asked for. */
    private class RecordingProvider(val answer: String? = TOKEN, val failure: Exception? = null) : IntegrityTokenProvider {
        val hashes = mutableListOf<String>()

        override suspend fun token(requestHash: String): String? {
            hashes += requestHash
            failure?.let { throw it }
            return answer
        }
    }

    private suspend fun asking(request: Boolean? = true, consent: Boolean = true, status: InquiryStatus = InquiryStatus.PENDING): FlowSession =
        FakeFlowServer(consent = if (consent) FlowConsent(NOW) else null, inquiryStatus = status).getSession().let { session ->
            session.copy(integrity = request?.let(::FlowSessionIntegrity))
        }

    @Test
    fun `a consented session that asks gets one challenge, the host's token for its hash, and one token post`() = runTest {
        val api = RecordingApi()
        val provider = RecordingProvider()

        integrityVerdictRequest(api, provider).requestIntegrityVerdict(asking())

        assertEquals(listOf("challenge", "token"), api.calls)
        val challenge = api.challenges.single()
        assertEquals(listOf(challenge.requestHash), provider.hashes)
        assertEquals(listOf(challenge.id to TOKEN), api.tokens)
    }

    @Test
    fun `without a provider nothing is requested, not even a challenge`() = runTest {
        val api = RecordingApi()

        val request = integrityVerdictRequest(api, null)
        request.requestIntegrityVerdict(asking())

        assertSame(IntegrityVerdictRequest.None, request)
        assertEquals(emptyList<String>(), api.calls)
    }

    @Test
    fun `a session that does not ask, has no consent, or is decided reads nothing and sends nothing`() = runTest {
        val sessions = listOf(
            asking(request = null),
            asking(request = false),
            asking(consent = false),
            asking(status = InquiryStatus.COMPLETED),
            asking(status = InquiryStatus.FAILED),
            asking(status = InquiryStatus.EXPIRED),
        )
        sessions.forEach { session ->
            val api = RecordingApi()
            val provider = RecordingProvider()

            integrityVerdictRequest(api, provider).requestIntegrityVerdict(session)

            assertEquals(emptyList<String>(), api.calls, session.toString())
            assertEquals(emptyList<String>(), provider.hashes)
        }
    }

    @Test
    fun `at most once per launch, however often and however concurrently the coordinator calls`() = runTest {
        val api = RecordingApi()
        val provider = RecordingProvider()
        val request = integrityVerdictRequest(api, provider)
        val session = asking()

        (1..3).map { async { request.requestIntegrityVerdict(session) } }.awaitAll()
        request.requestIntegrityVerdict(session)

        assertEquals(listOf("challenge", "token"), api.calls)
        assertEquals(1, provider.hashes.size)
    }

    @Test
    fun `a request that failed is not tried again in the same launch`() = runTest {
        val api = RecordingApi(challengeFailure = FlowApiException.Network(IOException("synthetic")))
        val request = integrityVerdictRequest(api, RecordingProvider())

        request.requestIntegrityVerdict(asking())
        request.requestIntegrityVerdict(asking())

        assertEquals(listOf("challenge"), api.calls)
    }

    @Test
    fun `a challenge the server refused, or a client that cannot send it yet, asks the host for nothing`() = runTest {
        listOf(
            FlowApiException.Conflict(null, null),
            FlowApiException.ServerError(503, null, null),
            UnsupportedOperationException("flow_api_not_wired: createIntegrityChallenge"),
        ).forEach { failure ->
            val provider = RecordingProvider()
            val api = RecordingApi(challengeFailure = failure)

            integrityVerdictRequest(api, provider).requestIntegrityVerdict(asking())

            assertEquals(listOf("challenge"), api.calls)
            assertEquals(emptyList<String>(), provider.hashes)
        }
    }

    @Test
    fun `a challenge outside the contract asks the host for nothing`() = runTest {
        listOf(
            FlowIntegrityChallenge("ich_short", VALID_HASH, NOW),
            FlowIntegrityChallenge("ver_01M5CK3190XEVBM5ZXA76E1JS0", VALID_HASH, NOW),
            FlowIntegrityChallenge(VALID_ID, "too-short", NOW),
            FlowIntegrityChallenge(VALID_ID, "$VALID_HASH=", NOW),
            FlowIntegrityChallenge(VALID_ID, VALID_HASH.dropLast(1) + "+", NOW),
        ).forEach { challenge ->
            val provider = RecordingProvider()
            val api = RecordingApi(challenge = challenge)

            integrityVerdictRequest(api, provider).requestIntegrityVerdict(asking())

            assertEquals(listOf("challenge"), api.calls, challenge.toString())
            assertEquals(emptyList<String>(), provider.hashes)
        }
    }

    @Test
    fun `a provider that gives nothing, throws, or gives a token outside the contract sends nothing`() = runTest {
        listOf(
            RecordingProvider(answer = null),
            RecordingProvider(failure = IllegalStateException("synthetic provider failure")),
            RecordingProvider(answer = ""),
            RecordingProvider(answer = "s".repeat(16 * 1024 + 1)),
        ).forEach { provider ->
            val api = RecordingApi()

            integrityVerdictRequest(api, provider).requestIntegrityVerdict(asking())

            assertEquals(listOf("challenge"), api.calls)
            assertEquals(1, provider.hashes.size)
            assertEquals(emptyList<Pair<String, String>>(), api.tokens)
        }
    }

    @Test
    fun `a token of exactly the contract's length is sent`() = runTest {
        val api = RecordingApi()
        val longest = "s".repeat(16 * 1024)

        integrityVerdictRequest(api, RecordingProvider(answer = longest)).requestIntegrityVerdict(asking())

        assertEquals(longest.length, api.tokens.single().second.length)
    }

    @Test
    fun `a 409 integrity_challenge_invalid on the token is answered by one session read, never a second challenge`() = runTest {
        val api = RecordingApi(tokenFailure = conflict("integrity_challenge_invalid"))

        integrityVerdictRequest(api, RecordingProvider()).requestIntegrityVerdict(asking())

        assertEquals(listOf("challenge", "token", "session"), api.calls)
    }

    @Test
    fun `any other failure of the token post sends nothing more`() = runTest {
        listOf(
            conflict("flow_step_not_current"),
            FlowApiException.Rejected(422, null, null),
            FlowApiException.RateLimited(null, null, 30),
            FlowApiException.Network(IOException("synthetic")),
            UnsupportedOperationException("flow_api_not_wired: sendIntegrityToken"),
        ).forEach { failure ->
            val api = RecordingApi(tokenFailure = failure)

            integrityVerdictRequest(api, RecordingProvider()).requestIntegrityVerdict(asking())

            assertEquals(listOf("challenge", "token"), api.calls, failure.toString())
        }
    }

    @Test
    fun `a provider that never answers is cancelled with its caller, and nothing is sent`() = runTest {
        val cancelled = CompletableDeferred<Unit>()
        val provider = object : IntegrityTokenProvider {
            override suspend fun token(requestHash: String): String? = try {
                awaitCancellation()
            } finally {
                cancelled.complete(Unit)
            }
        }
        val api = RecordingApi()

        val job = launch { integrityVerdictRequest(api, provider).requestIntegrityVerdict(asking()) }
        advanceUntilIdle()
        job.cancel()
        advanceUntilIdle()

        assertTrue(cancelled.isCompleted)
        assertTrue(job.isCancelled)
        assertEquals(listOf("challenge"), api.calls)
    }

    private fun conflict(code: String) = FlowApiException.Conflict(Problem(type = "about:blank", title = "Conflict", status = 409, code = code), null)

    private companion object {
        /** A synthetic token, never a real device's attestation. */
        const val TOKEN = "synthetic-integrity-token"
        const val VALID_ID = "ich_01M5CK3190XEVBM5ZXA76E1JS0"
        const val VALID_HASH = "syntheticAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    }
}
