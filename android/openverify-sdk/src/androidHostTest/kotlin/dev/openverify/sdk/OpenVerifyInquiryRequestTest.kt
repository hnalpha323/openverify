package dev.openverify.sdk

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

class OpenVerifyInquiryRequestTest {

    @Test
    fun `a well-formed request is accepted`() {
        val request = OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, "http://10.0.2.2:3000")

        assertEquals(INQUIRY_ID, request.inquiryId)
    }

    @ParameterizedTest
    @ValueSource(strings = ["", "inq_123", "ver_01M5CJXHG07XPHF3HRM6NREDH7", "inq_01m5cjxhg07xphf3hrm6nredh7"])
    fun `an inquiry ID that is not an inq_ ULID is refused`(inquiryId: String) {
        assertThrows<IllegalArgumentException> { OpenVerifyInquiry.Request(inquiryId, TOKEN, BASE_URL) }
    }

    @Test
    fun `a value that is not a session token is refused without being echoed`() {
        val apiKey = "key_01M5CJXHG07XPHF3HRM6NREDH7.not-a-session-token"

        val error = assertThrows<IllegalArgumentException> { OpenVerifyInquiry.Request(INQUIRY_ID, apiKey, BASE_URL) }

        assertFalse(error.message!!.contains(apiKey), error.message)
    }

    @Test
    fun `a base URL that would send the token in clear text is refused`() {
        assertThrows<IllegalArgumentException> { OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, "http://verify.example.com") }
    }

    /** C190.2: a BCP 47 tag of at most 35 characters, whether or not the SDK has its language (C199.2 falls back). */
    @ParameterizedTest
    @ValueSource(strings = ["es", "ar-EG", "fr-CA", "ES-mx", "zh-Hant-TW", "sr-Latn-RS", "ja", "en-US-u-ca-gregory-nu-arabext-co-tr"])
    fun `a locale that is a BCP 47 tag of at most 35 characters is accepted, a language the SDK has or not`(locale: String) {
        assertEquals(locale, OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, BASE_URL, locale = locale).locale)
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "", " ", " es", "es ", "es_MX", "es-", "-es", "es--MX", "e", "1es", "es MX", "es-MX-", "*", "es\nMX", "fr-CA-x",
            "en-US-u-ca-gregory-nu-arabext-co-trd",
        ],
    )
    fun `a locale that is not a BCP 47 tag of at most 35 characters is refused, without the token in the message`(locale: String) {
        val error = assertThrows<IllegalArgumentException> { OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, BASE_URL, locale = locale) }

        assertFalse(error.message!!.contains(TOKEN), error.message)
        assertEquals(RequestOptions.LOCALE_REFUSED, error.message)
    }

    @Test
    fun `the longest locale accepted is 35 characters`() {
        assertEquals(35, "en-US-u-ca-gregory-nu-arabext-co-tr".length)
        assertEquals(36, "en-US-u-ca-gregory-nu-arabext-co-trd".length)
        assertEquals(35, RequestOptions.LOCALE_MAX_LENGTH)
    }

    @Test
    fun `toString never shows the session token`() {
        val text = OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, BASE_URL).toString()

        assertFalse(text.contains(TOKEN), text)
        assertEquals("Request(inquiryId=$INQUIRY_ID, sessionToken=<redacted>, apiBaseUrl=$BASE_URL, locale=null, appearance=SYSTEM)", text)
    }

    companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
        const val BASE_URL = "https://verify.example.com"
        val TOKEN = "ovs_" + "t".repeat(43)
    }
}
