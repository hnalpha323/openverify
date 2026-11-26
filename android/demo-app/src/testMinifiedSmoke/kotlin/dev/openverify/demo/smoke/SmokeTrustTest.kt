package dev.openverify.demo.smoke

import okhttp3.Request
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException
import javax.net.ssl.SSLException

/**
 * C215.2 (review V01), host twin: the smoke launcher's client trusts the one certificate it was
 * handed and no other, over TLS to 127.0.0.1, so the smoke build needs no network security
 * configuration of its own and no cleartext.
 */
class SmokeTrustTest {

    private fun ok(): (String) -> Pair<Int, String> = { 200 to "{}" }

    @Test
    fun `the client reaches the server whose certificate it was handed`() {
        SmokeTlsServer(ok()).use { server ->
            val client = SmokeTrust.clientTrusting(server.certificatePem)

            client.newCall(Request.Builder().url("${server.url}/ping").build()).execute().use { response ->
                assertEquals(200, response.code)
                assertTrue(response.handshake != null, "the answer came over TLS")
            }
            assertEquals(listOf("GET /ping"), server.requests.toList())
        }
    }

    @Test
    fun `the client refuses a server that holds any other certificate`() {
        SmokeTlsServer(ok()).use { trusted ->
            SmokeTlsServer(ok()).use { other ->
                val client = SmokeTrust.clientTrusting(trusted.certificatePem)

                val refused = assertThrows(IOException::class.java) {
                    client.newCall(Request.Builder().url("${other.url}/ping").build()).execute().close()
                }
                assertTrue(refused is SSLException, "refused in the TLS handshake, got $refused")
                assertEquals(emptyList<String>(), other.requests.toList())
            }
        }
    }

    @Test
    fun `the client trusts none of the system's authorities`() {
        SmokeTlsServer(ok()).use { server ->
            val trusted = SmokeTrust.trustManagerFor(server.certificatePem).acceptedIssuers

            assertEquals(1, trusted.size)
            assertEquals("CN=127.0.0.1", trusted.single().subjectX500Principal.name)
        }
    }
}

/** The report's text is made in the smoke package, so the device test needs no SDK class to read it. */
class SmokeReportTest {
    @org.junit.jupiter.api.AfterEach
    fun reset() = SmokeReport.reset()

    @Test
    fun `each way a flow ends has its line`() {
        val inquiry = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        SmokeReport.ended(dev.openverify.sdk.InquiryResult.Completed(inquiry, dev.openverify.sdk.model.InquiryStatus.COMPLETED))
        SmokeReport.ended(dev.openverify.sdk.InquiryResult.Failed(inquiry, dev.openverify.sdk.FailureReason.NETWORK_ERROR))
        SmokeReport.ended(dev.openverify.sdk.InquiryResult.Canceled(inquiry))

        assertEquals(listOf("Completed $inquiry completed", "Failed $inquiry NETWORK_ERROR", "Canceled $inquiry"), SmokeReport.results.toList())
    }
}
