package dev.openverify.sdk

import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.FlowApiException
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.CertificatePinner
import okhttp3.OkHttpClient
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.File
import javax.net.ssl.SSLPeerUnverifiedException

/**
 * C256.2 (Phase 11, Workflow 11A; `clients-connect`; decision 41, B11-S1): the certificate-pinning
 * recipe of `docs/android/integration.md`, run as the guide writes it: a host's `OkHttpClient` with a
 * `CertificatePinner` for the operator's API host (a primary pin and a backup pin), installed through
 * `OpenVerifyAndroidTransport.okHttp`. Against a TLS `MockWebServer` whose certificate chains to a
 * trusted root (okhttp-tls's `HeldCertificate`), the flow's client reaches the server when a pin
 * matches and refuses the connection before any request is sent when none does. Pinning is not built
 * into the SDK: each self-hoster has its own certificates, and a pin set wrong locks every user out.
 * It narrows which certificates a host app accepts; it does not help on a device where the app itself
 * can be modified (C256.5). Synthetic certificates only, made for this test.
 */
internal class CertificatePinningRecipeTest {

    private val root = HeldCertificate.Builder().certificateAuthority(0).commonName("Synthetic Test Root").build()
    private val server = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").signedBy(root).build()

    /** A key the operator holds in reserve: the recipe's backup pin, which the server does not present. */
    private val backup = HeldCertificate.Builder().commonName("Synthetic Backup Key").build()
    private val other = HeldCertificate.Builder().commonName("Synthetic Other Key").build()

    private lateinit var api: MockWebServer

    @BeforeEach
    fun start() {
        api = MockWebServer()
        api.useHttps(HandshakeCertificates.Builder().heldCertificate(server).build().sslSocketFactory())
        api.start()
    }

    @AfterEach
    fun stop() = api.close()

    /** The host's client as the recipe builds it: the platform's trust (here, the synthetic root) and the pins. */
    private fun hostClient(vararg pins: String): OkHttpClient {
        val trust = HandshakeCertificates.Builder().addTrustedCertificate(root.certificate).build()
        return OkHttpClient.Builder()
            .sslSocketFactory(trust.sslSocketFactory(), trust.trustManager)
            .certificatePinner(CertificatePinner.Builder().add(api.hostName, *pins).build())
            .build()
    }

    /** The flow API client over the transport [OpenVerifyAndroidTransport.okHttp] makes of [host]. */
    private fun flowClient(host: OkHttpClient): FlowApiClient {
        val transport = OpenVerifyAndroidTransport.okHttp(host) as OkHttpFlowTransport
        return FlowApiClient(api.url("/").toString(), TOKEN, transport.httpClient)
    }

    @Test
    fun `a pinned client installed through the transport reaches the API when the server's key is pinned`() = runTest {
        api.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(SESSION).build())

        val session = flowClient(hostClient(CertificatePinner.pin(server.certificate), CertificatePinner.pin(backup.certificate))).getSession()

        assertEquals("inq_01M5CJXHG07XPHF3HRM6NREDH7", session.inquiry.id)
        assertEquals(1, api.requestCount)
    }

    @Test
    fun `the same recipe refuses a certificate outside its pins, before any request is sent`() = runTest {
        api.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(SESSION).build())

        val refused = runCatching {
            flowClient(hostClient(CertificatePinner.pin(other.certificate), CertificatePinner.pin(backup.certificate))).getSession()
        }.exceptionOrNull()

        // The SDK reports a network error; its cause is OkHttp's pin refusal, and the server read no request.
        assertInstanceOf(FlowApiException.Network::class.java, refused)
        assertTrue(generateSequence(refused) { it.cause }.any { it is SSLPeerUnverifiedException }, "$refused")
        assertEquals(0, api.requestCount)
    }

    @Test
    fun `without pins the same client reaches the API, so the refusal above is the pins' own`() = runTest {
        api.enqueue(MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(SESSION).build())
        val trust = HandshakeCertificates.Builder().addTrustedCertificate(root.certificate).build()
        val unpinned = OkHttpClient.Builder().sslSocketFactory(trust.sslSocketFactory(), trust.trustManager).build()

        flowClient(unpinned).getSession()

        assertEquals(1, api.requestCount)
    }

    private companion object {
        val TOKEN = "ovs_synthetic" + "p".repeat(34)

        /** A session the API answers, from the frozen golden. */
        val SESSION: String = File("../../contracts/fixtures/api/flow-session-share-consent.json").readText()
    }
}
