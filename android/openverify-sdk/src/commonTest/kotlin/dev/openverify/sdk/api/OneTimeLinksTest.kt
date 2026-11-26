package dev.openverify.sdk.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * One-time links (C10) read in common code: the fragment's two values. The API is the host's own
 * base URL, never the link's origin (C190.2, decision 65).
 */
class OneTimeLinksTest {

    @Test
    fun readsTheFragmentAndTakesTheHostsApi() {
        val link = OneTimeLinks.parse("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN", API)

        assertEquals(listOf(INQUIRY_ID, TOKEN, API), listOf(link.inquiryId, link.oneTimeToken, link.apiBaseUrl))
    }

    @Test
    fun neverReadsTheLinksOriginAsTheApi() {
        val origins = listOf(
            "HTTPS://Example.com:8443/verify/?utm=1#one-time-token=$TOKEN&inquiry-id=$INQUIRY_ID",
            "http://[::1]:5173/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN",
            "http://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN",
            "https://user:pass@verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN",
        )

        assertEquals(List(origins.size) { API }, origins.map { OneTimeLinks.parse(it, API).apiBaseUrl })
    }

    @Test
    fun usesTheApiForLocalDevelopmentAsGiven() {
        val link = OneTimeLinks.parse("http://10.0.2.2:5173/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN", apiBaseUrl = "http://10.0.2.2:3000")

        assertEquals("http://10.0.2.2:3000", link.apiBaseUrl)
    }

    /** The fragment uses the query syntax: values are percent-decoded, and `+` is a space. */
    @Test
    fun decodesTheFragmentAsAQuery() {
        val encoded = OneTimeLinks.parse("https://verify.example.com/#inquiry%2Did=$INQUIRY_ID&one-time-token=%6Fvo_${"o".repeat(43)}", API)
        assertEquals(listOf(INQUIRY_ID, TOKEN), listOf(encoded.inquiryId, encoded.oneTimeToken))

        assertRefused("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=ovo_+${"o".repeat(42)}")
    }

    @Test
    fun refusesAnythingButExactlyOneWellFormedLink() {
        val refused = listOf(
            "not a url",
            "https://verify.example.com/",
            "https://verify.example.com/#",
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID",
            "https://verify.example.com/#one-time-token=$TOKEN",
            "https://verify.example.com/#inquiry-id=inq_123&one-time-token=$TOKEN",
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=ovo_short",
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$SESSION_TOKEN",
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN&one-time-token=$TOKEN",
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN&session-token=$SESSION_TOKEN",
            "https://verify.example.com/?inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN",
            "https://verify.example.com/#inquiry-id&one-time-token=$TOKEN",
        )
        for (url in refused) assertRefused(url)
    }

    @Test
    fun refusesAnApiThatWouldSendTheSessionInClearText() {
        assertRefused("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN", apiBaseUrl = "http://api.example.com")
        assertRefused("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN", apiBaseUrl = "https://user:pass@api.example.com")
    }

    /** Decision 3: the API base URL must be ASCII; a link on an international origin is read as any other. */
    @Test
    fun refusesAnInternationalApiButNotAnInternationalLink() {
        val error = assertFailsWith<IllegalArgumentException> {
            OneTimeLinks.parse("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN", apiBaseUrl = "https://exämple.com")
        }
        assertTrue(error.message!!.contains("xn--"), error.message)

        val link = OneTimeLinks.parse("https://exämple.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN", apiBaseUrl = API)
        assertEquals(API, link.apiBaseUrl)
    }

    @Test
    fun neverShowsTheToken() {
        val malformed = "ovo_" + "!".repeat(43)
        val error = assertFailsWith<IllegalArgumentException> {
            OneTimeLinks.parse("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$malformed", API)
        }
        val link = OneTimeLinks.parse("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN", API)

        assertFalse(error.message!!.contains(malformed), error.message)
        assertFalse(link.toString().contains(TOKEN), link.toString())
    }

    private fun assertRefused(url: String, apiBaseUrl: String = API) {
        assertFailsWith<IllegalArgumentException>("'$url' should be refused") { OneTimeLinks.parse(url, apiBaseUrl) }
    }

    private companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** The host's compiled-in API base URL. */
        const val API = "https://api.example.com"

        /** Synthetic: the `ovo_` prefix plus 43 base64url characters. */
        val TOKEN = "ovo_" + "o".repeat(43)
        val SESSION_TOKEN = "ovs_" + "t".repeat(43)
    }
}
