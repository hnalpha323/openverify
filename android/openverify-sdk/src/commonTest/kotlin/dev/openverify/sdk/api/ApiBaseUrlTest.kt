package dev.openverify.sdk.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** The API base URL rules (contract C1, K4), in common code so they also run on iOS. */
class ApiBaseUrlTest {

    /** https, or plain http on the developer's machine and the Android emulator's alias for it. */
    @Test
    fun acceptsHttpsAndTheLocalDevelopmentHosts() {
        assertParts("https", "api.example.com", 443, listOf(""), ApiBaseUrl.parse("https://api.example.com"))
        assertParts("http", "localhost", 3000, listOf(""), ApiBaseUrl.parse("http://localhost:3000"))
        assertParts("http", "127.0.0.1", 3000, listOf(""), ApiBaseUrl.parse("http://127.0.0.1:3000/"))
        assertParts("http", "10.0.2.2", 3000, listOf(""), ApiBaseUrl.parse("http://10.0.2.2:3000"))
        assertParts("http", "::1", 3000, listOf(""), ApiBaseUrl.parse("http://[::1]:3000"))
    }

    @Test
    fun refusesPlainHttpForAnyOtherHost() {
        for (url in listOf("http://api.example.com", "http://192.168.1.20:3000", "http://localhost.example.com", "http://127.0.0.2")) {
            assertRefused(url)
        }
    }

    @Test
    fun refusesWhatIsNotAnAbsoluteHttpUrl() {
        for (url in listOf("", " ", "api.example.com", "localhost:3000", "ftp://api.example.com", "https://", "https://exa mple.com/", "/api")) {
            assertRefused(url)
        }
    }

    @Test
    fun refusesAQueryAFragmentOrCredentials() {
        val refused = listOf(
            "https://api.example.com/?tenant=1",
            "https://api.example.com?",
            "https://api.example.com/#section",
            "https://api.example.com#",
            "https://user:pass@api.example.com",
            "https://user@api.example.com",
            "https://:pass@api.example.com",
        )
        for (url in refused) assertRefused(url)
    }

    @Test
    fun lowerCasesTheSchemeAndTheHostButNotThePath() {
        assertParts("https", "api.example.com", 443, listOf("OpenVerify"), ApiBaseUrl.parse("HTTPS://API.Example.COM/OpenVerify"))
    }

    @Test
    fun ignoresSurroundingWhitespace() {
        assertParts("https", "api.example.com", 443, listOf(""), ApiBaseUrl.parse(" \thttps://api.example.com/\n "))
    }

    /** Decision 3: IDN hosts are refused; their xn-- form works. */
    @Test
    fun refusesAHostThatIsNotAsciiAndNamesTheXnForm() {
        for (url in listOf("https://exämple.com", "https://例え.jp/", "https://ex%C3%A4mple.com")) {
            val error = assertFailsWith<IllegalArgumentException>(url) { ApiBaseUrl.parse(url) }
            assertTrue(error.message!!.contains("xn--"), "$url: ${error.message}")
        }
        assertEquals("xn--exmple-cua.com", ApiBaseUrl.parse("https://xn--exmple-cua.com").host)
    }

    @Test
    fun canonicalisesIpv6HostsBeforeTheLocalHostCheck() {
        assertEquals("::1", ApiBaseUrl.parse("http://[0:0:0:0:0:0:0:1]:3000").host)
        assertEquals("2001:db8::1", ApiBaseUrl.parse("https://[2001:DB8:0:0:0:0:0:1]").host)
        assertEquals("2001:db8::1:0:0:1", ApiBaseUrl.parse("https://[2001:db8:0:0:1:0:0:1]").host)
        // An IPv4-mapped address is its IPv4 address.
        assertEquals("127.0.0.1", ApiBaseUrl.parse("http://[::ffff:127.0.0.1]:3000").host)
        for (url in listOf("https://[::1", "https://::1", "https://[::1::2]", "https://[12345::1]", "https://[1:2:3:4:5:6:7:8:9]")) {
            assertRefused(url)
        }
    }

    @Test
    fun acceptsOnlyAValidPort() {
        assertEquals(8443, ApiBaseUrl.parse("https://api.example.com:8443").port)
        assertEquals(65535, ApiBaseUrl.parse("https://api.example.com:65535").port)
        assertEquals(443, ApiBaseUrl.parse("https://api.example.com:/").port)
        for (port in listOf("0", "65536", "99999", "-1", "abc", "1:2")) {
            assertRefused("https://api.example.com:$port")
        }
    }

    @Test
    fun printsTheCanonicalUrlWithoutTheDefaultPort() {
        assertEquals("https://api.example.com/", ApiBaseUrl.parse("HTTPS://API.EXAMPLE.COM:443").toString())
        assertEquals("http://[::1]:3000/", ApiBaseUrl.parse("http://[::1]:3000").toString())
        assertEquals("https://api.example.com:8443/openverify/", ApiBaseUrl.parse("https://api.example.com:8443/openverify/").toString())
    }

    @Test
    fun normalisesThePathPrefix() {
        assertEquals(listOf("a", "c"), ApiBaseUrl.parse("https://api.example.com/a/./b/../c").encodedPathSegments)
        assertEquals(listOf(""), ApiBaseUrl.parse("https://api.example.com/a/..").encodedPathSegments)
        assertEquals(listOf("my%20path"), ApiBaseUrl.parse("https://api.example.com/my path").encodedPathSegments)
        assertEquals(listOf("caf%C3%A9", ""), ApiBaseUrl.parse("https://api.example.com/café/").encodedPathSegments)
    }

    /** Ktor's Url cannot carry a '%' that does not start an escape, so such a prefix could never be requested. */
    @Test
    fun refusesAPathPrefixWithAMalformedPercentEscape() {
        for (url in listOf("https://api.example.com/a%zz", "https://api.example.com/a%", "https://api.example.com/a%4/")) {
            val error = assertFailsWith<IllegalArgumentException>(url) { ApiBaseUrl.parse(url) }
            assertTrue(error.message!!.contains("%XX"), "$url: ${error.message}")
        }
        assertEquals(listOf("a%41%2f"), ApiBaseUrl.parse("https://api.example.com/a%41%2f").encodedPathSegments)
    }

    /** Request URLs go under any path prefix, with or without its trailing slash. */
    @Test
    fun resolvesRequestPathsUnderThePrefix() {
        val session = arrayOf("api", "v1", "flow", "session")
        assertEquals("https://api.example.com/api/v1/flow/session", ApiBaseUrl.parse("https://api.example.com").resolve(*session))
        assertEquals("https://api.example.com/openverify/api/v1/flow/session", ApiBaseUrl.parse("https://api.example.com/openverify").resolve(*session))
        assertEquals("https://api.example.com/openverify/api/v1/flow/session", ApiBaseUrl.parse("https://api.example.com/openverify/").resolve(*session))
        assertEquals("http://[::1]:3000/api/v1/flow/session", ApiBaseUrl.parse("http://[::1]:3000").resolve(*session))
        assertEquals("http://10.0.2.2:3000/api/v1/flow/session", ApiBaseUrl.parse("http://10.0.2.2:3000/").resolve(*session))
    }

    private fun assertParts(scheme: String, host: String, port: Int, path: List<String>, url: ApiBaseUrl) {
        assertEquals(listOf<Any>(scheme, host, port, path), listOf<Any>(url.scheme, url.host, url.port, url.encodedPathSegments))
    }

    private fun assertRefused(url: String) {
        assertFailsWith<IllegalArgumentException>("'$url' should be refused") { ApiBaseUrl.parse(url) }
    }
}
