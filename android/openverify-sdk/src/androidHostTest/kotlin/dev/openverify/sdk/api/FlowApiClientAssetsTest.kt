package dev.openverify.sdk.api

import dev.openverify.sdk.flow.FlowProblemCodes
import dev.openverify.sdk.model.Fixtures
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * C171.4, C204.5: `POST /api/v1/flow/selfie-captures/:id/extend` answers the selfie resource (no
 * nonce), read for its id and new expiry; C160.6, C198.3: `GET /api/v1/flow/theme-assets/:id` answers
 * the asset's bytes, never more than 256 KiB read into memory. Ids outside their contract are refused
 * before any request.
 */
internal class FlowApiClientAssetsTest {

    private class Sent(val method: String, val path: String, val body: ByteArray, val contentType: String?)

    private val sent = mutableListOf<Sent>()
    private var status = HttpStatusCode.OK
    private var answer: ByteArray = Fixtures.read("api/selfie.json").encodeToByteArray()
    private var answerType = "application/json"

    private val client = FlowApiClient(
        "https://verify.example.com",
        TOKEN,
        flowHttpClient(
            MockEngine { request ->
                sent += Sent(request.method.value, request.url.encodedPath, request.body.toByteArray(), request.body.contentType?.toString())
                respond(answer, status, headersOf(HttpHeaders.ContentType, answerType))
            },
        ),
    )

    @Test
    fun `an extension posts to the capture's route with no body and reads its id and new expiry`() = runTest {
        val extended = client.extendSelfieCapture(CAPTURE)

        val request = sent.single()
        assertEquals("POST" to "/api/v1/flow/selfie-captures/$CAPTURE/extend", request.method to request.path)
        assertEquals(0, request.body.size)
        assertEquals(FlowSelfieCaptureExtension("self_01M5CJXHG07XPHF3HRM6NREDH9", "2026-10-21T12:03:00.000Z"), extended)
    }

    @Test
    fun `an extension after the selfie was sent is the server's 409 selfie_capture_not_extendable`() = runTest {
        status = HttpStatusCode.Conflict
        answer = Fixtures.read("problems/flow-engine/selfie-capture-not-extendable.json").encodeToByteArray()
        answerType = "application/problem+json"

        val error = assertThrows<FlowApiException.Conflict> { client.extendSelfieCapture(CAPTURE) }

        assertEquals(FlowProblemCodes.SELFIE_CAPTURE_NOT_EXTENDABLE, error.problem?.code)
    }

    @Test
    fun `a theme asset is read as its bytes from its route`() = runTest {
        answer = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 1, 2, 3)
        answerType = "image/png"

        val bytes = client.fetchThemeAsset(ASSET)

        assertEquals("GET" to "/api/v1/flow/theme-assets/$ASSET", sent.single().method to sent.single().path)
        assertArrayEquals(answer, bytes)
    }

    @Test
    fun `a theme asset over 256 KiB is refused, unread beyond the limit`() = runTest {
        answer = ByteArray(THEME_ASSET_MAX_BYTES + 1)
        answerType = "image/png"

        val error = assertThrows<FlowApiException.InvalidResponse> { client.fetchThemeAsset(ASSET) }

        assertNull(error.cause)
    }

    @Test
    fun `an asset at exactly 256 KiB is read whole`() = runTest {
        answer = ByteArray(THEME_ASSET_MAX_BYTES) { 7 }
        answerType = "image/jpeg"

        assertEquals(THEME_ASSET_MAX_BYTES, client.fetchThemeAsset(ASSET).size)
    }

    @Test
    fun `an unknown asset is the server's 404`() = runTest {
        status = HttpStatusCode.NotFound
        answer = """{"type":"about:blank","title":"Not Found","status":404}""".encodeToByteArray()
        answerType = "application/problem+json"

        assertThrows<FlowApiException.NotFound> { client.fetchThemeAsset(ASSET) }
    }

    @Test
    fun `a capture id or an asset id outside its contract is refused before any request`() = runTest {
        assertThrows<IllegalArgumentException> { client.extendSelfieCapture("../verifications") }
        assertThrows<IllegalArgumentException> { client.fetchThemeAsset("tsa_../../session") }
        assertThrows<IllegalArgumentException> { client.fetchThemeAsset(CAPTURE) }

        assertEquals(0, sent.size)
    }

    private companion object {
        const val CAPTURE = "self_01M5CJXHG07XPHF3HRM6NREDH9"
        const val ASSET = "tsa_01M5CJXHG07XPHF3HRM6NREDH9"
        val TOKEN = "ovs_" + "t".repeat(43)
    }
}
