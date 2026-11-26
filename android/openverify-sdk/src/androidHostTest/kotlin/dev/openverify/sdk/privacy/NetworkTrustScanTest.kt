package dev.openverify.sdk.privacy

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C213.4 (review P11): trust follows the host app's network security configuration, which the SDK
 * runs inside and never overrides. No shipped source installs a trust manager, a hostname verifier, a
 * socket factory, a certificate pinner or a proxy of its own, or follows redirects; plain http is
 * decided in one place (`LoopbackPolicy`: loopback and `10.0.2.2`, in a debuggable host or under the
 * SDK's own test override). The README's network note rests on these facts.
 */
internal class NetworkTrustScanTest {

    @Test
    fun `no source overrides the host's trust, pins, proxies or redirects`() {
        val found = SourceScan.sources.flatMap { (path, text) ->
            SourceScan.codeLines(text).flatMap { (number, line) -> REFUSED.filter { it.containsMatchIn(line) }.map { "$path:$number: ${it.pattern}" } }
        }

        assertEquals(emptyList<String>(), found)
    }

    @Test
    fun `every HTTP client the SDK makes or derives has redirects off`() {
        val makers = SourceScan.sources.filter { (_, text) -> CLIENT.containsMatchIn(text) }

        assertEquals(CLIENT_MAKERS, makers.map { it.first.substringAfterLast('/') }.sorted())
        makers.forEach { (path, text) ->
            assertTrue(Regex("""followRedirects\s*(=\s*false|\(false\))""").containsMatchIn(text), "$path: redirects are not turned off")
            assertTrue(!Regex("""followRedirects\s*(=\s*true|\(true\))|followSslRedirects\s*\(true\)""").containsMatchIn(text), "$path: redirects on")
        }
    }

    @Test
    fun `plain http is for the loopback hosts only, and only where the loopback policy allows it`() {
        val base = File("src/commonMain/kotlin/dev/openverify/sdk/api/ApiBaseUrl.kt").readText()
        val policy = File("src/commonMain/kotlin/dev/openverify/sdk/api/LoopbackPolicy.kt").readText()
        val actual = File("src/androidMain/kotlin/dev/openverify/sdk/api/LoopbackPolicy.android.kt").readText()
        val activity = File("src/androidMain/kotlin/dev/openverify/sdk/OpenVerifyInquiryActivity.kt").readText()

        // An address is https, or one of four loopback hosts.
        assertTrue("""private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "::1", "10.0.2.2")""" in base)
        assertTrue("""require(url.scheme == "https" || url.host in LOCAL_HOSTS)""" in base)
        // The loopback hosts' plain http needs a debuggable host, or the SDK's own test override.
        assertTrue("""fun allows(apiBaseUrl: String): Boolean = ApiBaseUrl.parse(apiBaseUrl).scheme == "https" || loopbackHttpAllowed()""" in policy)
        assertTrue("internal val allowed: Boolean get() = testOverride ?: hostDebuggable" in actual)
        assertTrue("FLAG_DEBUGGABLE" in actual)
        // The activity refuses the launch before any request.
        assertTrue("if (launch == null || !LoopbackPolicy.allows(launch.apiBaseUrl))" in activity)
        // No main source sets the test override.
        val setters = SourceScan.sources.filter { (_, text) -> Regex("""testOverride\s*=[^=]""").containsMatchIn(text) }.map { it.first.substringAfterLast('/') }
        assertEquals(emptyList<String>(), setters)
    }

    private companion object {
        val REFUSED = listOf(
            """\bX509TrustManager\b|\bTrustManager(Factory)?\b""",
            """\bHostnameVerifier\b|\bhostnameVerifier\s*\(""",
            """\bsslSocketFactory\s*\(|\bSSLContext\b|\bSSLSocketFactory\b""",
            """\bCertificatePinner\b|\bcertificatePinner\s*\(""",
            """\bProxy\b|\bproxySelector\s*\(|\bproxy\s*\(""",
            """\bNetworkSecurityPolicy\b""",
            """\bHttpLoggingInterceptor\b|\binstall\(Logging\)""",
            """\bWebView\b|\bWebViewClient\b""",
            """\bHttpURLConnection\b|\bopenConnection\s*\(""",
        ).map(::Regex)

        val CLIENT = Regex("""\bHttpClient\s*\(|\bOkHttpClient\s*\(|\bOkHttpClient\.Builder\s*\(|\.newBuilder\s*\(\)""")

        /** Where an HTTP client is made or derived, by file. */
        val CLIENT_MAKERS: List<String> = listOf("FlowHttpPlatform.android.kt", "FlowHttpPlatform.kt", "OpenVerifyAndroidTransport.kt")
    }
}
