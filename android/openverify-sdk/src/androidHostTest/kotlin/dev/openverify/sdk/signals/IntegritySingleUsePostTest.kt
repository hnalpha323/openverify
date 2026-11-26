package dev.openverify.sdk.signals

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.defaultFlowHttpClient
import dev.openverify.sdk.integrity.IntegrityTokenProvider
import kotlinx.coroutines.test.runTest
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import mockwebserver3.SocketEffect
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * C193.5 (review P26) for the token post: the shared OkHttp client resends a POST whose answer was lost
 * (`retryOnConnectionFailure`), and flow calls carry no idempotency key, so a token that landed the first
 * time is refused 409 `integrity_challenge_invalid` the second time. MockWebServer drops the connection
 * after it read the first body; OkHttp sends it again; the request answers the 409 by reading the
 * session once, and asks for no second challenge.
 *
 * Every call is the real [FlowApiClient]'s, the integrity calls included (wired by integration-10b).
 */
internal class IntegritySingleUsePostTest {

    private lateinit var server: MockWebServer

    /** Every request the server read: its method and path, and each token post's body. */
    private val requests = ConcurrentLinkedQueue<String>()
    private val tokenBodies = ConcurrentLinkedQueue<String>()

    @BeforeEach
    fun start() {
        server = MockWebServer().also { it.start() }
        var landed = false
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val route = "${request.method} ${request.url.encodedPath}"
                requests += route
                return when (route) {
                    "POST /api/v1/flow/integrity-challenges" -> json(CHALLENGE)
                    "POST /api/v1/flow/integrity-tokens" -> {
                        tokenBodies += request.body?.utf8().orEmpty()
                        if (!landed) {
                            landed = true
                            MockResponse.Builder().code(202).onResponseStart(SocketEffect.ShutdownConnection).build()
                        } else {
                            MockResponse.Builder().code(409).addHeader("Content-Type", "application/problem+json")
                                .body("""{"type":"about:blank","title":"Conflict","status":409,"code":"integrity_challenge_invalid"}""").build()
                        }
                    }
                    "GET /api/v1/flow/session" -> json(SESSION)
                    else -> MockResponse.Builder().code(404).build()
                }
            }
        }
    }

    @AfterEach
    fun stop() = server.close()

    /** The real client, every call its own. */
    private fun client(): FlowApi = FlowApiClient(server.url("/").toString(), TOKEN, defaultFlowHttpClient())

    @Test
    fun `a token post whose answer was lost and whose resend got integrity_challenge_invalid reads the session and stops`() = runTest {
        val api = client()
        val provider = object : IntegrityTokenProvider {
            override suspend fun token(requestHash: String): String = INTEGRITY_TOKEN
        }

        integrityVerdictRequest(api, provider).requestIntegrityVerdict(api.getSession())

        assertEquals(
            listOf(
                "GET /api/v1/flow/session", "POST /api/v1/flow/integrity-challenges",
                "POST /api/v1/flow/integrity-tokens", "POST /api/v1/flow/integrity-tokens", "GET /api/v1/flow/session",
            ),
            requests.toList(),
        )
        assertEquals(List(2) { """{"challenge-id":"$CHALLENGE_ID","token":"$INTEGRITY_TOKEN"}""" }, tokenBodies.toList())
    }

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
        const val CHALLENGE_ID = "ich_01M5CK3190XEVBM5ZXA76E1JS0"
        val TOKEN = "ovs_" + "t".repeat(43)

        /** A synthetic token, never a real device's attestation. */
        const val INTEGRITY_TOKEN = "synthetic-integrity-token"

        val CHALLENGE = """{"id":"$CHALLENGE_ID","request-hash":"syntheticAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","expires-at":"2026-11-09T12:10:00.000Z"}"""

        val SESSION =
            """{"inquiry":{"id":"$INQUIRY_ID","status":"pending"},"flow":{"metadata":{"specVersion":1,"id":"integrity","version":1,"name":"Integrity"},"steps":[],"transitions":[]},""" +
                """"verifications":[],"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"},"spec-version":2,""" +
                """"position":{"step-id":"done","state":"ended","previous-step-id":"consent"},"step":{"id":"done","type":"completion"},""" +
                """"integrity":{"request":true}}"""
    }
}
