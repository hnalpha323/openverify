package dev.openverify.sdk.api

import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.assertThrows

/**
 * C213.3 (review P06, V03): every exception the flow API client lets reach the driver (and through
 * it a host's crash report) carries a constant code and a fixed message, never a serialization
 * excerpt, a response body or a server `detail`. A session holding a canary is fed through every
 * kind of decoding failure, and an error answer carries it in its problem; the canary appears in no
 * message, no `toString` and no cause of the chain. [FlowApiException.InvalidResponse] keeps only its
 * cause's kind as a fixed code (KP10-56) and the JSON path, names and indices only.
 */
internal class FlowApiExceptionCanaryTest {

    private val golden: JsonObject = OpenVerifyJson.parseToJsonElement(Fixtures.read("api/flow-session-v2.json")).jsonObject

    private fun withMember(name: String, value: String): String =
        JsonObject(golden + (name to OpenVerifyJson.parseToJsonElement(value))).toString()

    /** Each answer breaks the session contract differently, with the canary somewhere in it. */
    private val bodies: Map<String, String> = mapOf(
        "malformed JSON" to """{"inquiry":{"id":"$CANARY",""",
        "a wrong type beside the canary" to withMember("inquiry", """{"id":12,"status":"$CANARY"}"""),
        "a missing required member" to JsonObject(golden - "inquiry" + ("organization-display-name" to JsonPrimitive(CANARY))).toString(),
        "a value of no FlowValue shape" to withMember("values", """{"nickname":{"text":"$CANARY"}}"""),
        "a canary as a map key" to withMember("values", """{"$CANARY": {"deep": [1, {"x": true}]}}"""),
        "trailing bytes" to golden.toString() + CANARY,
    )

    private fun client(status: HttpStatusCode, body: String, contentType: String = "application/json") =
        FlowApiClient("https://verify.example.com", TOKEN, flowHttpClient(MockEngine { respond(body, status, headersOf(HttpHeaders.ContentType, contentType)) }))

    @TestFactory
    fun `no decoding failure carries the session's canary in any message or cause`(): List<DynamicTest> = bodies.map { (name, body) ->
        dynamicTest(name) {
            runTest {
                val error = assertThrows<FlowApiException.InvalidResponse> { client(HttpStatusCode.OK, body).getSession() }

                assertClean(error)
                assertEquals("flow_api.invalid_response", error.code)
                assertEquals("Unexpected response body", error.message)
                assertNull(error.cause)
                error.jsonPath?.let { path -> assertTrue(PATH.matches(path) && CANARY !in path, "$name: $path") }
            }
        }
    }

    /**
     * KP10-56: the decoding failure is a fixed code chosen by the failure's type, never a class name
     * read as text (which R8 renames in a host's minified build), so no consumer rule has to keep one.
     */
    @TestFactory
    fun `each decoding failure is one fixed code of its kind`(): List<DynamicTest> = mapOf(
        "malformed JSON" to "malformed_json",
        "a wrong type beside the canary" to "malformed_json",
        "a missing required member" to "missing_field",
        "trailing bytes" to "malformed_json",
    ).map { (name, code) ->
        dynamicTest(name) {
            runTest {
                val error = assertThrows<FlowApiException.InvalidResponse> { client(HttpStatusCode.OK, bodies.getValue(name)).getSession() }

                assertEquals(code, error.decodeFailure)
            }
        }
    }

    @Test
    fun `every decoding failure's code is one of the fixed codes`() = runTest {
        for ((name, body) in bodies) {
            val error = assertThrows<FlowApiException.InvalidResponse> { client(HttpStatusCode.OK, body).getSession() }
            assertTrue(error.decodeFailure in FlowApiException.InvalidResponse.DECODE_FAILURES, "$name: ${error.decodeFailure}")
        }
    }

    @Test
    fun `an identifier the model refuses in its own checks keeps only the check's kind`() = runTest {
        val capture = """{"data":{"type":"selfie","id":"self_$CANARY","attributes":{"prompts":["center"],"expires-at":"2026-10-20T12:03:00.000Z",""" +
            """"nonce":"$CANARY","guidance":{"max-center-yaw-ratio":0.021,"min-side-yaw-ratio-change":0.077,"hold-ms":500}}}}"""

        val error = assertThrows<FlowApiException.InvalidResponse> {
            client(HttpStatusCode.Created, capture).createSelfieCapture("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", dev.openverify.sdk.model.CaptureMethod.CAMERA)
        }

        assertClean(error)
        assertEquals("invalid_value", error.decodeFailure)
        assertNull(error.cause)
    }

    @Test
    fun `the JSON path of a wrong type names where it is, with names and indices only`() = runTest {
        val error = assertThrows<FlowApiException.InvalidResponse> {
            client(HttpStatusCode.OK, withMember("inquiry", """{"id":12,"status":"pending"}""")).getSession()
        }

        assertEquals("$.inquiry.id", error.jsonPath)
    }

    @TestFactory
    fun `an error answer's title and detail never reach a message`(): List<DynamicTest> = listOf(401, 403, 404, 409, 410, 422, 429, 500, 418).map { status ->
        dynamicTest("HTTP $status") {
            runTest {
                val problem = """{"type":"about:blank","title":"$CANARY title","status":$status,"detail":"$CANARY detail","code":"synthetic_code"}"""
                val error = assertThrows<FlowApiException.Http> { client(HttpStatusCode.fromValue(status), problem, "application/problem+json").getSession() }

                assertClean(error)
                assertEquals("HTTP $status", error.message)
                assertEquals("flow_api.http_$status", error.code)
                // The problem stays for the driver's own use (its code), never in the message.
                assertEquals("synthetic_code", error.problem?.code)
            }
        }
    }

    @Test
    fun `every exception class has a constant code`() {
        assertEquals("flow_api.still_processing", FlowApiException.StillProcessing("ver_01M5CJZC301G4JHXZQ3PZBYH3Q").code)
        assertEquals("flow_api.network", FlowApiException.Network(kotlinx.io.IOException("synthetic: offline")).code)
        assertEquals("flow_api.invalid_response", FlowApiException.InvalidResponse(null).code)
    }

    /** The canary is in no message, no `toString` and no cause or suppressed exception of [error]'s chain. */
    private fun assertClean(error: Throwable) {
        val seen = mutableSetOf<Throwable>()
        val pending = ArrayDeque(listOf(error))
        while (pending.isNotEmpty()) {
            val next = pending.removeFirst()
            if (!seen.add(next)) continue
            assertFalse(next.message.orEmpty().contains(CANARY), "${next::class.simpleName}: message carries the canary")
            assertFalse(next.toString().contains(CANARY), "${next::class.simpleName}: toString carries the canary")
            assertFalse(next.stackTraceToString().contains(CANARY), "${next::class.simpleName}: its trace carries the canary")
            next.cause?.let(pending::addLast)
            pending.addAll(next.suppressed)
        }
    }

    private companion object {
        /** Synthetic, and distinct from any word of the contract or the SDK. */
        const val CANARY = "SyntheticCanaryQv7Zx"
        val TOKEN = "ovs_" + "t".repeat(43)

        /** A JSON path of member names and array indices only. */
        val PATH = Regex("""\$((\.[A-Za-z][A-Za-z0-9_-]{0,63})|(\[[0-9]{1,6}]))*""")
    }
}
