package dev.openverify.sdk.api

import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class OneTimeLinkClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: OneTimeLinkClient

    @BeforeEach
    fun startServer() {
        server = MockWebServer()
        server.start()
        client = OneTimeLinkClient(server.url("/").toString())
    }

    @AfterEach
    fun stopServer() = server.close()

    private fun json(code: Int, body: String): MockResponse =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

    @Test
    fun `redeem posts the inquiry ID and one-time token without credentials, and returns the session`() = runTest {
        server.enqueue(json(200, """{"session-token":"$SESSION_TOKEN","expires-at":"$EXPIRES_AT"}"""))

        val session = client.redeem(INQUIRY_ID, ONE_TIME_TOKEN)

        assertEquals(RedeemedSession(SESSION_TOKEN, EXPIRES_AT), session)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/flow/one-time-links/redeem", request.url.encodedPath)
        assertNull(request.headers["Authorization"])
        assertEquals(
            buildJsonObject {
                put("inquiry-id", JsonPrimitive(INQUIRY_ID))
                put("one-time-token", JsonPrimitive(ONE_TIME_TOKEN))
            },
            OpenVerifyJson.parseToJsonElement(request.body!!.utf8()),
        )
        assertFalse(request.url.toString().contains(ONE_TIME_TOKEN))
    }

    @Test
    fun `a refused link (the one generic 401) is LinkRefused`() = runTest {
        server.enqueue(
            MockResponse.Builder().code(401).addHeader("Content-Type", "application/problem+json")
                .body("""{"type":"about:blank","title":"Unauthorized","status":401}""").build(),
        )

        val error = assertThrows<FlowApiException.LinkRefused> { client.redeem(INQUIRY_ID, ONE_TIME_TOKEN) }

        assertEquals(401, error.status)
        assertFalse(error.toString().contains(ONE_TIME_TOKEN))
    }

    @Test
    fun `other failures keep their usual kinds`() = runTest {
        server.enqueue(json(429, "{}"))
        assertThrows<FlowApiException.RateLimited> { client.redeem(INQUIRY_ID, ONE_TIME_TOKEN) }

        server.enqueue(json(200, """{"session-token":"ovs_short","expires-at":"$EXPIRES_AT"}"""))
        assertThrows<FlowApiException.InvalidResponse> { client.redeem(INQUIRY_ID, ONE_TIME_TOKEN) }

        server.close()
        assertThrows<FlowApiException.Network> { client.redeem(INQUIRY_ID, ONE_TIME_TOKEN) }
    }

    @Test
    fun `malformed credentials are refused before any request, without echoing the token`() = runTest {
        val notAToken = "ovs_" + "s".repeat(43)

        val error = assertThrows<IllegalArgumentException> { client.redeem(INQUIRY_ID, notAToken) }
        assertThrows<IllegalArgumentException> { client.redeem("inq_123", ONE_TIME_TOKEN) }

        assertFalse(error.message!!.contains(notAToken))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `the redeemed session never prints its token`() {
        val text = RedeemedSession(SESSION_TOKEN, EXPIRES_AT).toString()

        assertFalse(text.contains(SESSION_TOKEN), text)
    }

    @Test
    fun `a shared OkHttp client is accepted`() = runTest {
        val shared = OneTimeLinkClient(server.url("/").toString(), OkHttpClient())
        server.enqueue(json(200, """{"session-token":"$SESSION_TOKEN","expires-at":"$EXPIRES_AT"}"""))

        assertEquals(SESSION_TOKEN, shared.redeem(INQUIRY_ID, ONE_TIME_TOKEN).sessionToken)
    }

    companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
        /** Synthetic: the `ovo_` prefix plus 43 base64url characters. */
        val ONE_TIME_TOKEN = "ovo_" + "o".repeat(43)
        val SESSION_TOKEN = "ovs_" + "t".repeat(43)
        const val EXPIRES_AT = "2026-10-21T12:00:00.000Z"
    }
}
