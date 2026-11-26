package dev.openverify.demo

import dev.openverify.sdk.Appearance
import dev.openverify.sdk.FailureReason
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.OpenVerifyInquiry
import dev.openverify.sdk.model.InquiryStatus
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource

class DemoFormTest {

    @Test
    fun `pasted values become a request, without surrounding whitespace`() {
        assertEquals(
            OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, DemoForm.DEFAULT_API_BASE_URL),
            DemoForm.requestOrNull(" $INQUIRY_ID\n", "\t$TOKEN ", " ${DemoForm.DEFAULT_API_BASE_URL} "),
        )
    }

    @ParameterizedTest
    @CsvSource(
        "'', $TOKEN_VALUE, http://10.0.2.2:3000",
        "inq_123, $TOKEN_VALUE, http://10.0.2.2:3000",
        "$INQUIRY_ID, '', http://10.0.2.2:3000",
        "$INQUIRY_ID, ovs_short, http://10.0.2.2:3000",
        "$INQUIRY_ID, $TOKEN_VALUE, ''",
        "$INQUIRY_ID, $TOKEN_VALUE, http://example.com",
    )
    fun `there is no request while a value is missing or malformed`(inquiryId: String, token: String, url: String) {
        assertNull(DemoForm.requestOrNull(inquiryId, token, url))
    }

    @Test
    fun `the pickers' language and appearance ride on both launches`() {
        val options = LaunchOptions(LocaleChoice.ES, Appearance.DARK)

        val request = DemoForm.requestOrNull(INQUIRY_ID, TOKEN, DemoForm.DEFAULT_API_BASE_URL, options)
        val link = DemoForm.oneTimeLinkOrNull(DemoViewModelTest.LINK, DemoForm.DEFAULT_API_BASE_URL, options)

        assertEquals("es", request?.locale)
        assertEquals(Appearance.DARK, request?.appearance)
        assertEquals("es", link?.locale)
        assertEquals(Appearance.DARK, link?.appearance)
    }

    @Test
    fun `with nothing picked the flow follows the device`() {
        val request = DemoForm.requestOrNull(INQUIRY_ID, TOKEN, DemoForm.DEFAULT_API_BASE_URL)

        assertNull(request?.locale)
        assertEquals(Appearance.SYSTEM, request?.appearance)
    }

    @Test
    fun `the language picker offers the device's language and the SDK's five`() {
        assertEquals(listOf(null, "en", "es", "fr", "de", "ar"), LocaleChoice.entries.map { it.tag })
    }

    @Test
    fun `the default base URL reaches the API on the development machine from the emulator`() {
        assertEquals("http://10.0.2.2:3000", DemoForm.DEFAULT_API_BASE_URL)
    }

    @Test
    fun `results are described with the inquiry and its outcome`() {
        assertEquals(
            ResultMessage(R.string.result_completed, listOf(INQUIRY_ID, "completed")),
            DemoForm.describe(InquiryResult.Completed(INQUIRY_ID, InquiryStatus.COMPLETED)),
        )
        assertEquals(
            ResultMessage(R.string.result_failed, listOf(INQUIRY_ID, "SESSION_EXPIRED")),
            DemoForm.describe(InquiryResult.Failed(INQUIRY_ID, FailureReason.SESSION_EXPIRED)),
        )
        assertEquals(
            ResultMessage(R.string.result_canceled, listOf(INQUIRY_ID)),
            DemoForm.describe(InquiryResult.Canceled(INQUIRY_ID)),
        )
    }

    @Test
    fun `a result without an inquiry ID says so`() {
        assertEquals(
            ResultMessage(R.string.result_failed, listOf("(none)", "INVALID_REQUEST")),
            DemoForm.describe(InquiryResult.Failed(null, FailureReason.INVALID_REQUEST)),
        )
        assertEquals(ResultMessage(R.string.result_canceled, listOf("(none)")), DemoForm.describe(InquiryResult.Canceled(null)))
    }

    companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"

        /** Synthetic: the `ovs_` prefix plus 43 base64url characters. */
        const val TOKEN_VALUE = "ovs_ttttttttttttttttttttttttttttttttttttttttttt"
        const val TOKEN = TOKEN_VALUE
    }
}
