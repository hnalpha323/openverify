package dev.openverify.sdk

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

/**
 * C190.2 (decision 65; review P03): a one-time link supplies only the inquiry and its one-time
 * token. The API is always the base URL compiled into the host app, never the link's origin, so a
 * link another app sends cannot point the SDK at a server of its choosing.
 */
class OpenVerifyInquiryOneTimeLinkTest {

    @Test
    fun `a one-time link is read from its fragment, and the API is the host's own`() {
        val link = OpenVerifyInquiry.fromOneTimeLink("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN", API)

        assertEquals(INQUIRY_ID, link.inquiryId)
        assertEquals(API, link.apiBaseUrl)
        assertEquals(TOKEN, link.oneTimeToken)
    }

    @Test
    fun `two links on different origins reach the same compiled-in API`() {
        val links = listOf(
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN",
            "https://links.example.net:8443/other/path/?utm=1#one-time-token=$TOKEN&inquiry-id=$INQUIRY_ID",
            "http://192.0.2.10/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN",
        ).map { OpenVerifyInquiry.fromOneTimeLink(it, API) }

        assertEquals(listOf(API, API, API), links.map { it.apiBaseUrl })
        assertEquals(1, links.toSet().size)
    }

    @Test
    fun `an API for local development is given the same way`() {
        val link = OpenVerifyInquiry.fromOneTimeLink(
            "http://10.0.2.2:5173/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN",
            apiBaseUrl = "http://10.0.2.2:3000",
        )

        assertEquals("http://10.0.2.2:3000", link.apiBaseUrl)
    }

    @Test
    fun `the link's locale and appearance are the host's options`() {
        val link = OpenVerifyInquiry.fromOneTimeLink(
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN",
            API,
            locale = "ar-EG",
            appearance = Appearance.DARK,
        )

        assertEquals("ar-EG", link.locale)
        assertEquals(Appearance.DARK, link.appearance)
    }

    @Test
    fun `a link with a locale that is not a BCP 47 tag is refused`() {
        val error = assertThrows<IllegalArgumentException> {
            OpenVerifyInquiry.fromOneTimeLink("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN", API, locale = "es_MX")
        }

        assertEquals(RequestOptions.LOCALE_REFUSED, error.message)
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "https://verify.example.com/",
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID",
            "https://verify.example.com/#one-time-token=$TOKEN_VALUE",
            "https://verify.example.com/#inquiry-id=inq_123&one-time-token=$TOKEN_VALUE",
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=ovo_short",
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$SESSION_TOKEN_VALUE",
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN_VALUE&one-time-token=$TOKEN_VALUE",
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN_VALUE&session-token=$SESSION_TOKEN_VALUE",
            "https://verify.example.com/?inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN_VALUE",
            "not a url",
        ],
    )
    fun `a link that is not exactly one well-formed one-time link is refused`(url: String) {
        assertThrows<IllegalArgumentException> { OpenVerifyInquiry.fromOneTimeLink(url, API) }
    }

    @Test
    fun `an API base URL that would send the session in clear text is refused, whatever the link's origin`() {
        assertThrows<IllegalArgumentException> {
            OpenVerifyInquiry.fromOneTimeLink(
                "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN",
                apiBaseUrl = "http://api.example.com",
            )
        }
    }

    @Test
    fun `errors and toString never show the token`() {
        val malformed = "ovo_" + "!".repeat(43)
        val error = assertThrows<IllegalArgumentException> {
            OpenVerifyInquiry.fromOneTimeLink("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$malformed", API)
        }
        val link = OpenVerifyInquiry.fromOneTimeLink("https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN", API)

        assertFalse(error.message!!.contains(malformed), error.message)
        assertFalse(link.toString().contains(TOKEN), link.toString())
        assertEquals("OneTimeLink(inquiryId=$INQUIRY_ID, oneTimeToken=<redacted>, apiBaseUrl=$API, locale=null, appearance=SYSTEM)", link.toString())
    }

    @Test
    fun `links are equal when they carry the same values`() {
        val url = "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=$TOKEN"
        val other = "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=${"ovo_" + "p".repeat(43)}"

        assertEquals(OpenVerifyInquiry.fromOneTimeLink(url, API), OpenVerifyInquiry.fromOneTimeLink(url, API))
        assertEquals(OpenVerifyInquiry.fromOneTimeLink(url, API).hashCode(), OpenVerifyInquiry.fromOneTimeLink(url, API).hashCode())
        assertNotEquals(OpenVerifyInquiry.fromOneTimeLink(url, API), OpenVerifyInquiry.fromOneTimeLink(other, API))
    }

    companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** The host's compiled-in API base URL. */
        const val API = "https://api.example.com"

        /** Synthetic: the `ovo_` prefix plus 43 base64url characters. */
        const val TOKEN_VALUE = "ovo_ooooooooooooooooooooooooooooooooooooooooooo"
        const val TOKEN = TOKEN_VALUE
        const val SESSION_TOKEN_VALUE = "ovs_ttttttttttttttttttttttttttttttttttttttttttt"
    }
}
