package dev.openverify.sdk.signals

import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.api.FlowHttp
import dev.openverify.sdk.api.SessionCredentials
import dev.openverify.sdk.api.flowHttpClient
import dev.openverify.sdk.model.FlowIntegrityChallenge
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * C211.3 (Workflow 10B): the integrity routes as the SDK sends them: `POST /api/v1/flow/integrity-challenges`
 * with an empty object, decoded as the challenge; `POST /api/v1/flow/integrity-tokens` with the challenge's
 * id and the token, answered 202 with no body; each with the session's bearer token and the SDK's headers,
 * and a problem mapped as every flow call maps it. A refused value is never named in a message.
 */
class IntegrityRequestsTest {

    private class Recorded(val method: String, val path: String, val headers: Map<String, String?>, val body: String)

    private val requests = mutableListOf<Recorded>()
    private var status = HttpStatusCode.OK
    private var answer = ""
    private var answerType = "application/json"

    private val engine = MockEngine { request ->
        requests += Recorded(
            request.method.value,
            request.url.encodedPath,
            listOf(HttpHeaders.Authorization, HttpHeaders.Accept, HttpHeaders.UserAgent, "OpenVerify-Flow-Spec").associateWith { request.headers[it] },
            request.body.toByteArray().decodeToString(),
        )
        respond(answer, status, headersOf(HttpHeaders.ContentType, answerType))
    }

    private val http = FlowHttp(flowHttpClient(engine))
    private val apiBase = SessionCredentials.parseApiBaseUrl("https://verify.example.com/prefix")

    @Test
    fun theChallengeIsAnEmptyPostDecodedAsTheChallenge() = runTest {
        answer = """{"id":"$CHALLENGE_ID","request-hash":"$HASH","expires-at":"2026-11-09T12:10:00.000Z"}"""

        val challenge = IntegrityRequests.challenge(http, apiBase, AUTHORIZATION)

        assertEquals(FlowIntegrityChallenge(CHALLENGE_ID, HASH, "2026-11-09T12:10:00.000Z"), challenge)
        val sent = requests.single()
        assertEquals("POST" to "/prefix/api/v1/flow/integrity-challenges", sent.method to sent.path)
        assertEquals("{}", sent.body)
        assertEquals(AUTHORIZATION, sent.headers[HttpHeaders.Authorization])
        assertEquals("2", sent.headers["OpenVerify-Flow-Spec"])
        assertTrue(sent.headers[HttpHeaders.UserAgent]!!.startsWith("OpenVerify-"))
    }

    @Test
    fun theTokenIsPostedWithItsChallengeAndAnsweredWithNoBody() = runTest {
        status = HttpStatusCode.Accepted

        IntegrityRequests.token(http, apiBase, AUTHORIZATION, CHALLENGE_ID, TOKEN)

        val sent = requests.single()
        assertEquals("POST" to "/prefix/api/v1/flow/integrity-tokens", sent.method to sent.path)
        assertEquals("""{"challenge-id":"$CHALLENGE_ID","token":"$TOKEN"}""", sent.body)
        assertEquals(AUTHORIZATION, sent.headers[HttpHeaders.Authorization])
    }

    @Test
    fun aConflictIsTheFlowApisConflictWithItsCode() = runTest {
        status = HttpStatusCode.Conflict
        answerType = "application/problem+json"
        answer = """{"type":"about:blank","title":"Conflict","status":409,"code":"integrity_challenge_invalid"}"""

        val conflict = assertFailsWith<FlowApiException.Conflict> { IntegrityRequests.token(http, apiBase, AUTHORIZATION, CHALLENGE_ID, TOKEN) }

        assertEquals("integrity_challenge_invalid", conflict.problem?.code)
    }

    @Test
    fun aChallengeOutsideTheContractIsAnInvalidResponse() = runTest {
        answer = """{"id":"$CHALLENGE_ID"}"""

        assertFailsWith<FlowApiException.InvalidResponse> { IntegrityRequests.challenge(http, apiBase, AUTHORIZATION) }
    }

    @Test
    fun aChallengeIdOrTokenOutsideTheContractIsNeverSentAndNeverNamed() = runTest {
        val refused = listOf(
            assertFailsWith<IllegalArgumentException> { IntegrityRequests.token(http, apiBase, AUTHORIZATION, "ich_../../x", TOKEN) },
            assertFailsWith<IllegalArgumentException> { IntegrityRequests.token(http, apiBase, AUTHORIZATION, CHALLENGE_ID, "") },
            assertFailsWith<IllegalArgumentException> { IntegrityRequests.token(http, apiBase, AUTHORIZATION, CHALLENGE_ID, "s".repeat(16 * 1024 + 1)) },
        )

        assertEquals(emptyList(), requests)
        refused.forEach { failure ->
            assertFalse("ich_../../x" in failure.message.orEmpty())
            assertFalse("sss" in failure.message.orEmpty())
        }
    }

    @Test
    fun aTokenOfTheContractsLongestLengthIsSent() = runTest {
        status = HttpStatusCode.Accepted

        IntegrityRequests.token(http, apiBase, AUTHORIZATION, CHALLENGE_ID, "s".repeat(16 * 1024))

        assertEquals(1, requests.size)
    }

    private companion object {
        val AUTHORIZATION = "Bearer ovs_" + "t".repeat(43)
        const val CHALLENGE_ID = "ich_01M5CK3190XEVBM5ZXA76E1JS0"
        const val HASH = "syntheticAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

        /** A synthetic token, never a real device's attestation. */
        const val TOKEN = "synthetic-integrity-token"
    }
}
