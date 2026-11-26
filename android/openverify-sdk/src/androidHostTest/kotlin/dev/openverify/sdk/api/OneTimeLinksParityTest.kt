package dev.openverify.sdk.api

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource

/**
 * The common [OneTimeLinks] reader against what it replaced: `OpenVerifyInquiry.fromOneTimeLink`
 * on OkHttp's `HttpUrl` with `OneTimeLink`'s checks (K2). Both accept and refuse the same links
 * and read the same values. Since C190.2 (decision 65) the API is always the host's own, so each
 * link is read with one: [API] where the case names none. An IDN API host is the one difference
 * (decision 3).
 */
class OneTimeLinksParityTest {

    @ParameterizedTest(name = "[{index}] \"{0}\" api={1}")
    @MethodSource("inputs")
    fun `links are read as HttpUrl read them`(url: String, apiBaseUrl: String) {
        val expected = runCatching { okHttpRead(url, apiBaseUrl) }
        val actual = runCatching { OneTimeLinks.parse(url, apiBaseUrl).let { listOf(it.inquiryId, it.oneTimeToken, it.apiBaseUrl) } }

        if (expected.isFailure) {
            assertTrue(actual.isFailure, "HttpUrl refused '$url' but OneTimeLinks read ${actual.getOrNull()}")
            assertTrue(actual.exceptionOrNull() is IllegalArgumentException, "'$url': ${actual.exceptionOrNull()}")
        } else {
            assertEquals(expected.getOrThrow(), actual.getOrElse { throw AssertionError("HttpUrl read '$url' but OneTimeLinks refused it", it) })
        }
    }

    @Test
    fun `an IDN API host is the one difference`() {
        val explicit = "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN"

        assertEquals("https://exämple.com", okHttpRead(explicit, "https://exämple.com")[2])
        val error = assertThrows<IllegalArgumentException> { OneTimeLinks.parse(explicit, "https://exämple.com") }
        assertTrue(error.message!!.contains("xn--"), error.message)
    }

    companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** The host's compiled-in API base URL, for a case that names none. */
        const val API = "https://api.example.com/"
        val TOKEN = "ovo_" + "o".repeat(43)
        val SESSION_TOKEN = "ovs_" + "t".repeat(43)

        /**
         * `fromOneTimeLink` and the `OneTimeLink` checks before K4, verbatim except that it returns
         * the inquiry ID, token and API base URL.
         */
        fun okHttpRead(url: String, apiBaseUrl: String?): List<String> {
            val link = requireNotNull(url.trim().toHttpUrlOrNull()) { "url must be an absolute http(s) link" }
            val fragment = requireNotNull(link.encodedFragment) { "url must carry the one-time link in its fragment" }
            val params = requireNotNull("https://fragment.invalid/?$fragment".toHttpUrlOrNull()) { "url has a malformed fragment" }
            val inquiryIds = params.queryParameterValues("inquiry-id")
            val tokens = params.queryParameterValues("one-time-token")
            require(inquiryIds.size == 1 && tokens.size == 1) { "url must carry exactly one inquiry ID and one one-time token" }
            require(params.queryParameterValues("session-token").isEmpty()) { "url must not carry a session token as well" }
            val origin = link.newBuilder().encodedPath("/").query(null).fragment(null).build().toString()
            val inquiryId = inquiryIds.single().orEmpty()
            val oneTimeToken = tokens.single().orEmpty()
            val api = apiBaseUrl ?: origin
            require(SessionCredentials.isInquiryId(inquiryId)) { "inquiryId must be an OpenVerify inquiry ID (inq_...)" }
            SessionCredentials.requireOneTimeToken(oneTimeToken)
            ApiBaseUrlParityTest.okHttpParse(api)
            return listOf(inquiryId, oneTimeToken, api)
        }

        @JvmStatic
        fun inputs(): List<Array<Any?>> {
            val ok = "inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN"
            val links = listOf(
                // OpenVerifyInquiryOneTimeLinkTest's links.
                "https://verify.example.com/#$ok", "https://example.com:8443/verify/#one-time-token=$TOKEN&inquiry-id=$INQUIRY_ID",
                "http://verify.example.com/#$ok", "https://verify.example.com/", "https://verify.example.com/#inquiry-id=$INQUIRY_ID",
                "https://verify.example.com/#one-time-token=$TOKEN", "https://verify.example.com/#inquiry-id=inq_123&one-time-token=$TOKEN",
                "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=ovo_short",
                "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$SESSION_TOKEN",
                "https://verify.example.com/#$ok&one-time-token=$TOKEN", "https://verify.example.com/#$ok&session-token=$SESSION_TOKEN",
                "https://verify.example.com/?$ok", "not a url",
                // Surrounding whitespace, case, a query, a default port, an IPv6 host, user info.
                "  https://verify.example.com/#$ok \u00A0\n", "HTTPS://VERIFY.Example.com/#$ok", "https://verify.example.com/app?utm=1#$ok",
                "https://verify.example.com:443/#$ok", "http://[::1]:5173/#$ok", "http://[0:0::1]:5173/#$ok", "https://user:pw@verify.example.com/#$ok",
                "https://@verify.example.com/#$ok", "https:verify.example.com#$ok", "https://verify.example.com\\path#$ok",
                // The fragment read as a query: encodings, '+', separators, empty and repeated pairs.
                "https://verify.example.com/#inquiry%2Did=$INQUIRY_ID&one-time-token=%6Fvo_${"o".repeat(43)}",
                "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=ovo_+${"o".repeat(42)}",
                "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=ovo_%2B${"o".repeat(42)}",
                "https://verify.example.com/#&&$ok&&", "https://verify.example.com/#$ok&=x&other", "https://verify.example.com/#inquiry-id&one-time-token=$TOKEN",
                "https://verify.example.com/#inquiry-id=&$ok", "https://verify.example.com/#inquiry-id=$INQUIRY_ID;one-time-token=$TOKEN",
                "https://verify.example.com/#$ok#more", "https://verify.example.com/#inquiry-id=$INQUIRY_ID#&one-time-token=$TOKEN",
                "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=ovo_\t${"o".repeat(43)}",
                "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN%", "https://verify.example.com/#$ok&session-token",
                "https://verify.example.com/#$ok&session-token=", "https://verify.example.com/#$ok&x=%E2%82%AC%zzé \"<>",
                "https://verify.example.com/#INQUIRY-ID=$INQUIRY_ID&one-time-token=$TOKEN", "https://verify.example.com/# $ok",
                "https://verify.example.com/#$ok ",
                // Hosts the parser refuses or rewrites, as HttpUrl did.
                "https://verify example.com/#$ok", "https://verify.example.com:99999/#$ok", "https://[::1/#$ok",
            )
            val withApi = listOf(
                "http://10.0.2.2:5173/#$ok" to "http://10.0.2.2:3000",
                "https://verify.example.com/#$ok" to "http://api.example.com",
                "https://verify.example.com/#$ok" to "https://api.example.com/openverify/",
                "https://user:pw@verify.example.com/#$ok" to "https://api.example.com",
                "https://exämple.com/#$ok" to "https://api.example.com",
            )
            return links.map { arrayOf<Any?>(it, API) } + withApi.map { (url, api) -> arrayOf<Any?>(url, api) }
        }
    }
}
