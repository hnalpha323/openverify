package dev.openverify.sdk.api

import dev.openverify.sdk.model.Fixtures
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Headers.Companion.headersOf
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * C151.7, C193.1 (decision 7): every flow API request declares `OpenVerify-Flow-Spec: 2`, the one
 * version this SDK renders, the three routes Phase 10 added among them.
 */
internal class FlowSpecHeaderTest {

    private lateinit var server: MockWebServer

    @BeforeEach
    fun start() {
        server = MockWebServer().also { it.start() }
    }

    @AfterEach
    fun stop() = server.close()

    private fun json(body: String) = MockResponse.Builder().code(200)
        .headers(headersOf("Content-Type", "application/json"))
        .body(body)
        .build()

    @Test
    fun `the session read and the consent declare spec 2 (C193_1)`() = runTest {
        val client = FlowApiClient(server.url("/").toString(), TOKEN)
        server.enqueue(json(Fixtures.read("api/flow-session.json")))
        server.enqueue(json("""{"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"}}"""))

        client.getSession()
        client.acceptConsent(listOf("consent.biometric"), "en")

        repeat(2) { assertEquals("2", server.takeRequest().headers["OpenVerify-Flow-Spec"]) }
    }

    @Test
    fun `the screen submission, the extension and the theme-asset read declare spec 2 too (C193_1)`() = runTest {
        val client = FlowApiClient(server.url("/").toString(), TOKEN)
        server.enqueue(json(Fixtures.read("api/flow-session-v2.json")))
        server.enqueue(json(Fixtures.read("api/selfie.json")))
        server.enqueue(MockResponse.Builder().code(200).headers(headersOf("Content-Type", "image/png")).body("png").build())

        client.submitScreen("extra_details", emptyMap(), null)
        client.extendSelfieCapture("self_01M5CJXHG07XPHF3HRM6NREDH9")
        client.fetchThemeAsset("tsa_01M5CJXHG07XPHF3HRM6NREDH9")

        repeat(3) { assertEquals("2", server.takeRequest().headers["OpenVerify-Flow-Spec"]) }
    }

    private companion object {
        val TOKEN = "ovs_" + "t".repeat(43)
    }
}
