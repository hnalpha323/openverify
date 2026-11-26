package dev.openverify.sdk.api

import io.ktor.http.Url
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import org.junit.jupiter.params.provider.ValueSource

/**
 * The common [ApiBaseUrl] parser against what it replaced: OkHttp's `HttpUrl` with the SDK's
 * rules on top (K4). Both must accept and refuse the same URLs and agree on every part, and
 * the request URL Ktor sends must be the one OkHttp built. IDN hosts are the one difference
 * (decision 3).
 */
class ApiBaseUrlParityTest {

    @ParameterizedTest(name = "[{index}] \"{0}\"")
    @MethodSource("inputs")
    fun `the parser accepts and refuses what HttpUrl did, with the same parts`(input: String) {
        val expected = runCatching { okHttpParse(input) }
        val actual = runCatching { ApiBaseUrl.parse(input) }

        if (expected.isFailure) {
            assertTrue(actual.isFailure, "OkHttp refused '$input' but the parser accepted ${actual.getOrNull()}")
            assertTrue(actual.exceptionOrNull() is IllegalArgumentException, "'$input': ${actual.exceptionOrNull()}")
            return
        }
        val okHttp = expected.getOrThrow()
        val url = actual.getOrElse { throw AssertionError("OkHttp accepted '$input' as $okHttp but the parser refused it", it) }
        assertEquals(
            listOf<Any>(okHttp.scheme, okHttp.host, okHttp.port, okHttp.encodedPathSegments, okHttp.toString()),
            listOf<Any>(url.scheme, url.host, url.port, url.encodedPathSegments, url.toString()),
            input,
        )
        val okHttpSession = okHttp.newBuilder().addPathSegments("api/v1/flow").addPathSegment("session").build().toString()
        val session = url.resolve("api", "v1", "flow", "session")
        assertEquals(okHttpSession, session, input)
        // Ktor's Url keeps the string as it is, and OkHttp's engine reads it back unchanged.
        assertEquals(okHttpSession, Url(session).toString(), input)
        assertEquals(okHttpSession, Url(session).toString().toHttpUrl().toString(), input)
    }

    /** Every printable ASCII character inside a host, accepted or refused as HttpUrl did. */
    @Test
    fun `each ASCII character in a host is treated as HttpUrl treated it`() {
        val mismatches = (0x21..0x7e).map(Int::toChar).mapNotNull { c ->
            val input = "https://a${c}b.example.com/"
            val expected = runCatching { okHttpParse(input).host }.getOrNull()
            val actual = runCatching { ApiBaseUrl.parse(input).host }.getOrNull()
            if (expected == actual) null else "'$c': HttpUrl $expected, parser $actual"
        }

        assertEquals(emptyList<String>(), mismatches)
    }

    /** Decision 3: HttpUrl punycoded them; the parser refuses them and names the xn-- form, which works. */
    @ParameterizedTest
    @ValueSource(strings = ["https://exämple.com", "https://ВЕРИФИКАЦИЯ.рф/api", "https://例え.jp", "https://ex%C3%A4mple.com", "https://exa\u00ADmple.com"])
    fun `an IDN host is the one difference`(input: String) {
        val punycode = okHttpParse(input).host
        val error = assertThrows<IllegalArgumentException> { ApiBaseUrl.parse(input) }

        assertTrue(error.message!!.contains("xn--"), error.message)
        assertEquals(punycode, ApiBaseUrl.parse(input.replaceHost(punycode)).host)
    }

    private fun String.replaceHost(host: String): String = "https://$host" + substringAfter("://").dropWhile { it != '/' }

    /**
     * Found in GREEN: HttpUrl sent a stray '%' in the path prefix as it was, but Ktor's Url
     * refuses it, so every request would fail. The parser refuses it up front instead.
     */
    @ParameterizedTest
    @ValueSource(strings = ["https://api.example.com/a%zz", "https://api.example.com/a%", "https://api.example.com/a%4/", "https://api.example.com/%/x"])
    fun `a path prefix with a malformed percent escape, which Ktor cannot send, is refused`(input: String) {
        val okHttpSession = okHttpParse(input).newBuilder().addPathSegments("api/v1/flow").addPathSegment("session").build().toString()
        assertThrows<Exception> { Url(okHttpSession) }

        val error = assertThrows<IllegalArgumentException> { ApiBaseUrl.parse(input) }
        assertTrue(error.message!!.contains("%XX"), error.message)
    }

    companion object {
        /** The HttpUrl-based parser this stage replaced (SessionCredentials, before K4), verbatim. */
        fun okHttpParse(value: String): HttpUrl {
            val url = requireNotNull(value.toHttpUrlOrNull()) { "apiBaseUrl must be an absolute http(s) URL" }
            require(url.query == null && url.fragment == null) { "apiBaseUrl must not have a query or a fragment" }
            require(url.username.isEmpty() && url.password.isEmpty()) { "apiBaseUrl must not contain credentials" }
            require(url.isHttps || url.host in setOf("localhost", "127.0.0.1", "::1", "10.0.2.2")) {
                "apiBaseUrl must use https; plain http is allowed only for localhost and 10.0.2.2"
            }
            return url
        }

        @JvmStatic
        fun inputs(): List<String> = listOf(
            // The SDK's own cases (FlowApiClientTest).
            "https://api.example.com", "http://10.0.2.2:3000", "http://localhost:3000", "http://127.0.0.1:3000/", "http://[::1]:3000",
            "api.example.com", "ftp://api.example.com", "http://api.example.com", "http://192.168.1.20:3000",
            "https://api.example.com/?tenant=1", "https://user:pass@api.example.com",
            // Not absolute http(s) URLs.
            "", " ", "https://", "https:///", "localhost:3000", "/api/v1", "https://exa mple.com/", "javascript:alert(1)", "https//api.example.com",
            // Case and surrounding whitespace.
            "HTTPS://API.Example.COM/OpenVerify", "Http://LOCALHOST:3000", " https://api.example.com/ ", "\thttps://api.example.com\r\n",
            // Tabs and newlines inside, which HttpUrl drops from paths but not from hosts.
            "https://api.\texample.com", "https://api.example.com/open\tverify/\n", "https://api.example.com:44\t3",
            // Slashes: WHATWG-style leniency.
            "https:api.example.com", "https:/api.example.com", "https:///api.example.com", "https:\\\\api.example.com\\openverify\\", "https://api.example.com\\x",
            // User info, empty or not.
            "https://@api.example.com", "https://:@api.example.com", "https://\t@api.example.com", "https://user@api.example.com",
            "https://:pass@api.example.com", "https://a@b@api.example.com", "https://%40@api.example.com", "https://::@api.example.com",
            // Queries and fragments, even empty ones.
            "https://api.example.com?", "https://api.example.com#", "https://api.example.com/#frag", "https://api.example.com/p?x#y",
            // Hosts.
            "https://api.example.com.", "https://api..example.com", "https://.example.com", "https://api_x.example.com", "https://a!b.example.com",
            "https://api%2Eexample.com", "http://%6C%6Fcalhost:3000", "https://api.exa%mple.com", "https://api.exa%zzmple.com",
            "https://" + "a".repeat(63) + ".com", "https://" + "a".repeat(64) + ".com", "https://" + ("a".repeat(63) + ".").repeat(4) + "com",
            "https://[example.com]", "https://xn--exmple-cua.com", "https://XN--EXMPLE-CUA.com",
            // IPv4: only the exact local strings may use http.
            "http://127.1:3000", "http://0177.0.0.1", "http://127.0.0.1.:3000", "https://192.168.1.20",
            // IPv6.
            "http://[0:0:0:0:0:0:0:1]:3000", "http://[::ffff:127.0.0.1]:3000", "https://[2001:DB8::1]/", "https://[2001:db8:0:0:1:0:0:1]",
            "https://[1::2:3:4:5:6:7]", "https://[::127.0.0.1]", "https://[::1", "https://::1", "https://[::1::2]", "https://[1:2:3:4:5:6:7:8:9]",
            "https://[::1%25eth0]", "https://[12345::]", "https://[::1.2.3.04]", "https://[::256.0.0.1]",
            // Ports.
            "https://api.example.com:443", "https://api.example.com:443/", "http://localhost:80", "https://api.example.com:8443",
            "https://api.example.com:0", "https://api.example.com:1", "https://api.example.com:65535", "https://api.example.com:65536",
            "https://api.example.com:99999", "https://api.example.com:", "https://api.example.com:/", "https://api.example.com:+443",
            "https://api.example.com:0443", "https://api.example.com:4 43", "https://api.example.com:1:2", "https://api.example.com:-1",
            "https://api.example.com:٤٤٣",
            // Path prefixes.
            "https://api.example.com/openverify", "https://api.example.com/openverify/", "https://api.example.com/a/./b/../c",
            "https://api.example.com/a/..", "https://api.example.com/a/.", "https://api.example.com/%2e%2E/x/%2E", "https://api.example.com/..",
            "https://api.example.com/my path", "https://api.example.com/café/", "https://api.example.com/a%41%2f",
            "https://api.example.com//double", "https://api.example.com/a//", "https://api.example.com/[x]", "https://api.example.com/a|b{c}",
            "https://api.example.com/~user;v=1,2", "https://api.example.com/\u0001\u007f", "https://api.example.com/a\"<>^`b", "https://api.example.com/😀",
        )
    }
}
