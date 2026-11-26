package dev.openverify.sdk.api

import dev.openverify.sdk.model.Fixtures
import io.ktor.client.engine.okhttp.OkHttpConfig
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.SocketEffect
import okhttp3.OkHttpClient
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * How the Ktor client sits on OkHttp on Android (K2, K4): the shared OkHttp client keeps its
 * settings, and a host app's own OkHttp client keeps its own, except that no flow call ever
 * follows a redirect.
 */
class OkHttpTransportTest {

    private lateinit var server: MockWebServer

    @BeforeEach
    fun startServer() {
        server = MockWebServer()
        server.start()
    }

    @AfterEach
    fun stopServer() = server.close()

    @Test
    fun `the shared OkHttp client keeps its 15, 30 and 60 second timeouts and never follows a redirect`() {
        val shared = sharedOkHttpClient

        assertEquals(listOf(15_000, 30_000, 60_000), listOf(shared.connectTimeoutMillis, shared.readTimeoutMillis, shared.writeTimeoutMillis))
        assertFalse(shared.followRedirects)
        assertFalse(shared.followSslRedirects)
        assertTrue(shared.retryOnConnectionFailure)
    }

    @Test
    fun `the default flow client is one Ktor client on the OkHttp engine over the shared OkHttp client`() {
        val client = defaultFlowHttpClient()

        assertSame(client, defaultFlowHttpClient())
        assertSame(sharedOkHttpClient, (client.engine.config as OkHttpConfig).preconfigured)
    }

    @Test
    fun `a host app's OkHttp client, which follows redirects itself, does not follow one for a flow call`() = runTest {
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", server.url("/elsewhere").toString()).build())
        server.enqueue(json(Fixtures.read("api/flow-session.json")))

        val error = assertThrows<FlowApiException.UnexpectedStatus> {
            FlowApiClient(server.url("/").toString(), TOKEN, OkHttpClient()).getSession()
        }

        assertEquals(302, error.status)
        assertEquals(1, server.requestCount)
    }

    /** A pooled connection the server has closed fails the next call: OkHttp retries it only when allowed to. */
    @Test
    fun `a host app's OkHttp client keeps its choice not to retry a failed connection`() = runTest {
        val noRetry = OkHttpClient.Builder().retryOnConnectionFailure(false).build()
        val client = FlowApiClient(server.url("/").toString(), TOKEN, noRetry)
        server.enqueue(json(Fixtures.read("api/flow-session.json")).newBuilder().onResponseEnd(SocketEffect.ShutdownConnection).build())
        server.enqueue(json(Fixtures.read("api/flow-session.json")))

        client.getSession()
        assertThrows<FlowApiException.Network> { client.getSession() }
    }

    @Test
    fun `the shared client retries a failed pooled connection, as OkHttp does by default`() = runTest {
        val client = FlowApiClient(server.url("/").toString(), TOKEN)
        server.enqueue(json(Fixtures.read("api/flow-session.json")).newBuilder().onResponseEnd(SocketEffect.ShutdownConnection).build())
        server.enqueue(json(Fixtures.read("api/flow-session.json")))

        client.getSession()
        client.getSession()

        assertEquals(2, server.requestCount)
    }

    private fun json(body: String): MockResponse =
        MockResponse.Builder().code(200).addHeader("Content-Type", "application/json; charset=utf-8").body(body).build()

    private companion object {
        val TOKEN = "ovs_" + "t".repeat(43)
    }
}
