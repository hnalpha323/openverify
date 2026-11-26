package dev.openverify.sdk.api

import dev.openverify.sdk.flow.FlowProblemCodes
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.FlowPositionState
import dev.openverify.sdk.model.FlowValue
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.http.isSuccess
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * C148.5, C195.7: `POST /api/v1/flow/screens/:stepId/submit` through the real [FlowApiClient]: the
 * values by field key and the button's key, the SDK's headers, and the session the route answers.
 * A value the server holds as set, a step id or a button key outside the contract, is refused before
 * any request, naming no value.
 */
internal class FlowApiClientScreenTest {

    private val sent = mutableListOf<Pair<String, Map<String, String?>>>()
    private var status = HttpStatusCode.OK
    private var body = Fixtures.read("api/flow-session-v2.json")

    private val engine = MockEngine { request ->
        sent += request.url.encodedPath to mapOf(
            "Authorization" to request.headers[HttpHeaders.Authorization],
            "OpenVerify-Flow-Spec" to request.headers["OpenVerify-Flow-Spec"],
            "body" to request.body.toByteArray().decodeToString(),
        )
        respond(body, status, headersOf(HttpHeaders.ContentType, if (status.isSuccess()) "application/json" else "application/problem+json"))
    }

    private val client = FlowApiClient(BASE, TOKEN, flowHttpClient(engine))

    @Test
    fun `a screen is posted to its step's route with the session token and spec 2, and the answer is the session`() = runTest {
        val session = client.submitScreen("extra_details", mapOf("nickname" to FlowValue.Text("Sam")), "skip")

        val (path, request) = sent.single()
        assertEquals("/api/v1/flow/screens/extra_details/submit", path)
        assertEquals("Bearer $TOKEN", request["Authorization"])
        assertEquals("2", request["OpenVerify-Flow-Spec"])
        assertEquals("""{"values":{"nickname":"Sam"},"button":"skip"}""", request["body"])
        assertEquals(FlowPositionState.ACTIVE, session.position?.state)
        assertEquals(2, session.specVersion)
    }

    @Test
    fun `the primary button sends no button member`() = runTest {
        client.submitScreen("extra_details", emptyMap(), button = null)

        assertEquals("""{"values":{}}""", sent.single().second["body"])
    }

    @Test
    fun `a value the server holds as set, a step id or a button outside the contract is refused before any request`() = runTest {
        val set = assertThrows<IllegalArgumentException> { client.submitScreen("extra_details", mapOf("tax_number" to FlowValue.Set), null) }
        assertThrows<IllegalArgumentException> { client.submitScreen("../verifications", emptyMap(), null) }
        assertThrows<IllegalArgumentException> { client.submitScreen("extra_details", emptyMap(), "Skip now") }
        assertThrows<IllegalArgumentException> { client.submitScreen("extra_details", mapOf("Not A Key" to FlowValue.Text("Sam")), null) }

        assertEquals(emptyList<Pair<String, Map<String, String?>>>(), sent)
        assertFalse(set.message.orEmpty().contains("tax_number"), set.message)
    }

    @Test
    fun `a screen that is no longer current is the server's 409, with its code`() = runTest {
        status = HttpStatusCode.Conflict
        body = Fixtures.read("problems/flow-engine/flow-step-not-current.json")

        val error = assertThrows<FlowApiException.Conflict> { client.submitScreen("extra_details", emptyMap(), null) }

        assertEquals(FlowProblemCodes.FLOW_STEP_NOT_CURRENT, error.problem?.code)
    }

    private companion object {
        const val BASE = "https://verify.example.com"
        val TOKEN = "ovs_" + "t".repeat(43)
    }
}
