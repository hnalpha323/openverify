package dev.openverify.sdk.signals

import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.api.OneTimeLinkFlowApi
import dev.openverify.sdk.api.RedeemedSession
import dev.openverify.sdk.api.flowHttpClient
import dev.openverify.sdk.model.AndroidIntegritySignals
import dev.openverify.sdk.model.AndroidRecognitionSignals
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.OpenVerifyJson
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
 * `POST /api/v1/flow/signals` (C94.2, C94.7): the Android body after consent, answered 202 with no
 * body. The body carries `platform` even though the model defaults it, leaves out every absent member
 * (the contract's members are optional, never null), and never carries a browser member.
 */
class FlowApiClientSignalsTest {

    private class Recorded(val method: String, val url: String, val authorization: String?, val contentType: String?, val body: String)

    private val requests = mutableListOf<Recorded>()
    private var status = HttpStatusCode.Accepted
    private var answer = ""
    private var answerType: String? = null

    private val engine = MockEngine { request ->
        requests += Recorded(
            method = request.method.value,
            url = request.url.toString(),
            authorization = request.headers[HttpHeaders.Authorization],
            contentType = request.body.contentType?.toString(),
            body = request.body.toByteArray().decodeToString(),
        )
        respond(answer, status, answerType?.let { headersOf(HttpHeaders.ContentType, it) } ?: headersOf())
    }

    private fun client(): FlowApiClient = FlowApiClient(BASE, TOKEN, flowHttpClient(engine))

    private val body = FlowSignals(
        collectorVersion = 1,
        screen = "consent",
        sequence = 0,
        androidIntegrity = AndroidIntegritySignals(debuggerConnected = false, appDebuggable = true),
        androidRecognition = AndroidRecognitionSignals(ANDROID_ID),
        deviceClass = "smartphone",
    )

    @Test
    fun posts_the_body_with_its_platform_to_the_signals_route_and_accepts_202_with_no_body() = runTest {
        client().sendSignals(body)

        val request = requests.single()
        assertEquals("POST", request.method)
        assertEquals("$BASE/api/v1/flow/signals", request.url)
        assertEquals("Bearer $TOKEN", request.authorization)
        assertEquals("application/json; charset=utf-8", request.contentType)
        assertEquals(
            OpenVerifyJson.parseToJsonElement(
                """{"platform":"android","collector-version":1,"screen":"consent","sequence":0,""" +
                    """"android-integrity":{"debugger-connected":false,"app-debuggable":true},""" +
                    """"android-recognition":{"android-id":"$ANDROID_ID"},"device-class":"smartphone"}""",
            ),
            OpenVerifyJson.parseToJsonElement(request.body),
        )
    }

    @Test
    fun leaves_absent_members_out_rather_than_sending_null() = runTest {
        client().sendSignals(FlowSignals(collectorVersion = 1, screen = "consent", sequence = 3))

        assertEquals(
            OpenVerifyJson.parseToJsonElement("""{"platform":"android","collector-version":1,"screen":"consent","sequence":3}"""),
            OpenVerifyJson.parseToJsonElement(requests.single().body),
        )
    }

    @Test
    fun a_refused_body_is_a_flow_api_exception() = runTest {
        status = HttpStatusCode.Conflict
        answerType = "application/problem+json"
        answer = """{"type":"about:blank","title":"Conflict","status":409,"code":"consent_required"}"""

        val error = assertFailsWith<FlowApiException.Conflict> { client().sendSignals(body) }

        assertEquals("consent_required", error.problem?.code)
    }

    @Test
    fun a_body_outside_the_contract_is_refused_before_it_is_sent_and_the_message_never_holds_the_android_id() = runTest {
        val outside = listOf(
            body.copy(platform = "web"),
            body.copy(collectorVersion = 0),
            body.copy(collectorVersion = 1001),
            body.copy(screen = "Consent"),
            body.copy(screen = "a".repeat(65)),
            body.copy(sequence = -1),
            body.copy(sequence = 1_000_001),
            body.copy(deviceClass = "tv"),
            body.copy(sandboxOutcome = "robot"),
            body.copy(androidRecognition = AndroidRecognitionSignals("0F1E2D3C4B5A6978")),
            body.copy(androidRecognition = AndroidRecognitionSignals("0f1e2d3c4b5a69780")),
            body.copy(androidRecognition = AndroidRecognitionSignals("")),
        )

        for (signals in outside) {
            val error = assertFailsWith<IllegalArgumentException>(signals.toString()) { client().sendSignals(signals) }
            assertFalse(ANDROID_ID in error.message.orEmpty(), error.message)
            assertFalse("0F1E2D3C4B5A6978" in error.message.orEmpty(), error.message)
        }
        assertTrue(requests.isEmpty())
    }

    @Test
    fun a_sandbox_outcome_is_sent_as_given() = runTest {
        client().sendSignals(body.copy(sandboxOutcome = "bot"))

        assertTrue(""""sandbox-outcome":"bot"""" in requests.single().body, requests.single().body)
    }

    @Test
    fun a_one_time_link_sends_the_body_with_the_session_it_redeemed() = runTest {
        val api = OneTimeLinkFlowApi(
            inquiryId = INQUIRY_ID,
            oneTimeToken = "ovo_" + "o".repeat(43),
            redeem = { _, _ -> RedeemedSession(TOKEN, "2026-10-21T12:00:00.000Z") },
            connect = { token -> FlowApiClient(BASE, token, flowHttpClient(engine)) },
        )

        api.sendSignals(body)

        assertEquals("$BASE/api/v1/flow/signals", requests.single().url)
        assertEquals("Bearer $TOKEN", requests.single().authorization)
    }

    private companion object {
        const val BASE = "https://api.example.com"
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** Synthetic session token: the `ovs_` prefix plus 43 base64url characters. */
        val TOKEN = "ovs_" + "t".repeat(43)

        /** A synthetic ANDROID_ID: 16 lowercase hex digits, never a real device's. */
        const val ANDROID_ID = "0f1e2d3c4b5a6978"
    }
}
