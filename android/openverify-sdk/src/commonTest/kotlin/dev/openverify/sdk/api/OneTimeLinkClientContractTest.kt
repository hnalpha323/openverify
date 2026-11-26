package dev.openverify.sdk.api

import dev.openverify.sdk.model.OpenVerifyJson
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlinx.io.IOException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull

/**
 * The one-time link redeem (C10, C19) on Ktor's MockEngine, in common code so it also runs on
 * iOS. `OneTimeLinkClientTest` checks the same exchange over OkHttp and MockWebServer.
 */
class OneTimeLinkClientContractTest {

    private val requests = mutableListOf<Pair<HttpRequestData, ByteArray>>()
    private var answer: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData = {
        json(200, """{"session-token":"$SESSION_TOKEN","expires-at":"$EXPIRES_AT"}""")
    }
    private val client = OneTimeLinkClient(
        BASE,
        flowHttpClient(
            MockEngine { request ->
                requests += request to request.body.toByteArray()
                answer(request)
            },
        ),
    )

    @Test
    fun redeemPostsTheLinkWithoutCredentialsAndReturnsTheSession() = runTest {
        val session = client.redeem(INQUIRY_ID, ONE_TIME_TOKEN)

        val (request, body) = requests.single()
        assertEquals(RedeemedSession(SESSION_TOKEN, EXPIRES_AT), session)
        assertEquals("POST", request.method.value)
        assertEquals("$BASE/api/v1/flow/one-time-links/redeem", request.url.toString())
        assertNull(request.headers[HttpHeaders.Authorization])
        assertEquals("application/json, application/problem+json", request.headers[HttpHeaders.Accept])
        assertEquals("OpenVerify-$PLATFORM_NAME/${FlowHttp.SDK_VERSION}", request.headers[HttpHeaders.UserAgent])
        assertEquals("application/json; charset=utf-8", request.body.contentType.toString())
        assertEquals(
            buildJsonObject {
                put("inquiry-id", JsonPrimitive(INQUIRY_ID))
                put("one-time-token", JsonPrimitive(ONE_TIME_TOKEN))
            },
            OpenVerifyJson.parseToJsonElement(body.decodeToString()),
        )
        assertFalse(ONE_TIME_TOKEN in request.url.toString())
    }

    @Test
    fun aRefusedLinkIsLinkRefusedWithItsProblem() = runTest {
        answer = {
            json(401, """{"type":"about:blank","title":"Unauthorized","status":401}""", "application/problem+json", "x-request-id" to "req-1")
        }

        val error = assertFailsWith<FlowApiException.LinkRefused> { client.redeem(INQUIRY_ID, ONE_TIME_TOKEN) }

        assertEquals(listOf<Any?>(401, "Unauthorized", "req-1"), listOf(error.status, error.problem?.title, error.requestId))
        assertFalse(ONE_TIME_TOKEN in error.toString())
    }

    @Test
    fun otherFailuresKeepTheirKinds() = runTest {
        answer = { json(429, "{}") }
        assertFailsWith<FlowApiException.RateLimited> { client.redeem(INQUIRY_ID, ONE_TIME_TOKEN) }

        answer = { json(200, """{"session-token":"ovs_short","expires-at":"$EXPIRES_AT"}""") }
        assertFailsWith<FlowApiException.InvalidResponse> { client.redeem(INQUIRY_ID, ONE_TIME_TOKEN) }

        answer = { throw IOException("offline") }
        assertFailsWith<FlowApiException.Network> { client.redeem(INQUIRY_ID, ONE_TIME_TOKEN) }
    }

    @Test
    fun malformedCredentialsAreRefusedBeforeAnyRequestWithoutEchoingTheToken() = runTest {
        val notAToken = "ovs_" + "s".repeat(43)

        val error = assertFailsWith<IllegalArgumentException> { client.redeem(INQUIRY_ID, notAToken) }
        assertFailsWith<IllegalArgumentException> { client.redeem("inq_123", ONE_TIME_TOKEN) }

        assertFalse(notAToken in error.message!!)
        assertEquals(0, requests.size)
    }

    private companion object {
        const val BASE = "https://verify.example.com"
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** Synthetic: the `ovo_` prefix plus 43 base64url characters. */
        val ONE_TIME_TOKEN = "ovo_" + "o".repeat(43)
        val SESSION_TOKEN = "ovs_" + "t".repeat(43)
        const val EXPIRES_AT = "2026-10-21T12:00:00.000Z"

        fun MockRequestHandleScope.json(status: Int, body: String, contentType: String = "application/json", vararg extra: Pair<String, String>) =
            respond(
                body,
                HttpStatusCode.fromValue(status),
                Headers.build {
                    append(HttpHeaders.ContentType, contentType)
                    for ((name, value) in extra) append(name, value)
                },
            )
    }
}
