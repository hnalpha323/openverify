package dev.openverify.sdk

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.BASE_URL
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.INQUIRY_ID
import dev.openverify.sdk.OpenVerifyInquiryRequestTest.Companion.TOKEN
import dev.openverify.sdk.model.InquiryStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class OpenVerifyInquiryContractTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val contract = OpenVerifyInquiry.Contract()
    private val request = OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, BASE_URL)

    @Test
    fun `the launch intent opens the SDK activity with the request`() {
        val intent = contract.createIntent(context, request)

        assertEquals(OpenVerifyInquiryActivity::class.java.name, intent.component?.className)
        assertEquals(context.packageName, intent.component?.packageName)
        assertEquals(request, InquiryResults.requestFrom(intent))
    }

    @Test
    fun `a launch intent with a missing or malformed value carries no request`() {
        val missingToken = contract.createIntent(context, request).apply { removeExtra(InquiryResults.EXTRA_SESSION_TOKEN) }
        val badToken = contract.createIntent(context, request).putExtra(InquiryResults.EXTRA_SESSION_TOKEN, "ovs_short")

        assertNull(InquiryResults.requestFrom(missingToken))
        assertNull(InquiryResults.requestFrom(badToken))
        assertNull(InquiryResults.requestFrom(Intent()))
    }

    @Test
    fun `a one-time link launches the SDK activity with the link, never a session token`() {
        val link = OpenVerifyInquiry.fromOneTimeLink(
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=${OpenVerifyInquiryOneTimeLinkTest.TOKEN}",
            BASE_URL,
        )

        val intent = OpenVerifyInquiry.OneTimeLinkContract().createIntent(context, link)

        assertEquals(OpenVerifyInquiryActivity::class.java.name, intent.component?.className)
        assertNull(intent.getStringExtra(InquiryResults.EXTRA_SESSION_TOKEN))
        assertEquals(InquiryResults.Launch.OneTimeLink(link), InquiryResults.launchFrom(intent))
        assertNull(InquiryResults.requestFrom(intent))
    }

    @Test
    fun `a session launch intent carries the request as before`() {
        val intent = contract.createIntent(context, request)

        assertEquals(InquiryResults.Launch.Session(request), InquiryResults.launchFrom(intent))
    }

    @Test
    fun `a one-time link intent with a missing or malformed value carries no launch`() {
        val link = OpenVerifyInquiry.fromOneTimeLink(
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=${OpenVerifyInquiryOneTimeLinkTest.TOKEN}",
            BASE_URL,
        )
        val contract = OpenVerifyInquiry.OneTimeLinkContract()
        val badToken = contract.createIntent(context, link).putExtra(InquiryResults.EXTRA_ONE_TIME_TOKEN, "ovo_short")
        val noUrl = contract.createIntent(context, link).apply { removeExtra(InquiryResults.EXTRA_API_BASE_URL) }
        val both = contract.createIntent(context, link).putExtra(InquiryResults.EXTRA_SESSION_TOKEN, TOKEN)

        assertNull(InquiryResults.launchFrom(badToken))
        assertNull(InquiryResults.launchFrom(noUrl))
        assertNull(InquiryResults.launchFrom(both))
        assertNull(InquiryResults.launchFrom(Intent()))
    }

    // C190.2: the request options travel as extras beside the credentials, in the launch intent only.

    @Test
    fun `a request's locale and appearance travel as extras beside the credentials`() {
        val withOptions = OpenVerifyInquiry.Request(INQUIRY_ID, TOKEN, BASE_URL, locale = "ar-EG", appearance = Appearance.DARK)

        val intent = contract.createIntent(context, withOptions)

        assertEquals("ar-EG", intent.getStringExtra(InquiryResults.EXTRA_LOCALE))
        assertEquals("DARK", intent.getStringExtra(InquiryResults.EXTRA_APPEARANCE))
        assertEquals(withOptions, InquiryResults.requestFrom(intent))
        assertEquals(InquiryResults.Launch.Session(withOptions), InquiryResults.launchFrom(intent))
    }

    @Test
    fun `a request without a locale sends no locale extra, and its appearance follows the system`() {
        val intent = contract.createIntent(context, request)

        assertFalse(intent.hasExtra(InquiryResults.EXTRA_LOCALE))
        assertEquals("SYSTEM", intent.getStringExtra(InquiryResults.EXTRA_APPEARANCE))
        assertEquals(request, InquiryResults.requestFrom(intent))
    }

    @Test
    fun `a link's locale and appearance travel the same way, never with a session token`() {
        val link = OpenVerifyInquiry.fromOneTimeLink(
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=${OpenVerifyInquiryOneTimeLinkTest.TOKEN}",
            BASE_URL,
            locale = "es",
            appearance = Appearance.LIGHT,
        )

        val intent = OpenVerifyInquiry.OneTimeLinkContract().createIntent(context, link)

        assertEquals("es", intent.getStringExtra(InquiryResults.EXTRA_LOCALE))
        assertEquals("LIGHT", intent.getStringExtra(InquiryResults.EXTRA_APPEARANCE))
        assertEquals(InquiryResults.Launch.OneTimeLink(link), InquiryResults.launchFrom(intent))
        assertNull(intent.getStringExtra(InquiryResults.EXTRA_SESSION_TOKEN))
    }

    @Test
    fun `an intent without the appearance extra follows the system`() {
        val intent = contract.createIntent(context, request).apply { removeExtra(InquiryResults.EXTRA_APPEARANCE) }

        assertEquals(request, InquiryResults.requestFrom(intent))
    }

    @Test
    fun `a launch intent with a malformed locale or an unknown appearance carries no launch`() {
        val link = OpenVerifyInquiry.fromOneTimeLink(
            "https://verify.example.com/#inquiry-id=$INQUIRY_ID&one-time-token=${OpenVerifyInquiryOneTimeLinkTest.TOKEN}",
            BASE_URL,
        )
        val badLocale = contract.createIntent(context, request).putExtra(InquiryResults.EXTRA_LOCALE, "es_MX")
        val badAppearance = contract.createIntent(context, request).putExtra(InquiryResults.EXTRA_APPEARANCE, "SEPIA")
        val linkLocale = OpenVerifyInquiry.OneTimeLinkContract().createIntent(context, link).putExtra(InquiryResults.EXTRA_LOCALE, "x".repeat(36))
        val linkAppearance = OpenVerifyInquiry.OneTimeLinkContract().createIntent(context, link).putExtra(InquiryResults.EXTRA_APPEARANCE, "dark")

        assertNull(InquiryResults.launchFrom(badLocale))
        assertNull(InquiryResults.launchFrom(badAppearance))
        assertNull(InquiryResults.launchFrom(linkLocale))
        assertNull(InquiryResults.launchFrom(linkAppearance))
    }

    @Test
    fun `the one-time link contract parses results like the session contract`() {
        val (code, data) = InquiryResults.toActivityResult(InquiryResult.Failed(INQUIRY_ID, FailureReason.LINK_INVALID))

        assertEquals(
            InquiryResult.Failed(INQUIRY_ID, FailureReason.LINK_INVALID),
            OpenVerifyInquiry.OneTimeLinkContract().parseResult(code, data),
        )
    }

    @Test
    fun `every result survives the trip through the activity result`() {
        val results = listOf(
            InquiryResult.Completed(INQUIRY_ID, InquiryStatus.COMPLETED),
            InquiryResult.Failed(INQUIRY_ID, FailureReason.INQUIRY_FAILED),
            InquiryResult.Failed(null, FailureReason.INVALID_REQUEST),
            InquiryResult.Canceled(INQUIRY_ID),
        ) + FailureReason.entries.map { InquiryResult.Failed(INQUIRY_ID, it) }

        results.forEach { result ->
            val (code, data) = InquiryResults.toActivityResult(result)
            assertEquals(result, contract.parseResult(code, data))
        }
    }

    @Test
    fun `an inquiry in review survives the trip through the activity result as a completion (C30_6)`() {
        val result = InquiryResult.Completed(INQUIRY_ID, InquiryStatus.NEEDS_REVIEW)

        val (code, data) = InquiryResults.toActivityResult(result)

        assertEquals(Activity.RESULT_OK, code)
        assertEquals(result, contract.parseResult(code, data))
    }

    @Test
    fun `completion and failure return RESULT_OK, cancellation RESULT_CANCELED`() {
        assertEquals(Activity.RESULT_OK, InquiryResults.toActivityResult(InquiryResult.Completed(INQUIRY_ID, InquiryStatus.COMPLETED)).first)
        assertEquals(Activity.RESULT_OK, InquiryResults.toActivityResult(InquiryResult.Failed(INQUIRY_ID, FailureReason.NETWORK_ERROR)).first)
        assertEquals(Activity.RESULT_CANCELED, InquiryResults.toActivityResult(InquiryResult.Canceled(INQUIRY_ID)).first)
    }

    @Test
    fun `an activity that ended without data was canceled`() {
        assertEquals(InquiryResult.Canceled(null), contract.parseResult(Activity.RESULT_CANCELED, null))
        assertEquals(InquiryResult.Canceled(null), contract.parseResult(Activity.RESULT_OK, Intent()))
    }

    @Test
    fun `an inquiry status this SDK version does not know is reported as UNKNOWN`() {
        val (code, data) = InquiryResults.toActivityResult(InquiryResult.Completed(INQUIRY_ID, InquiryStatus.COMPLETED))
        data.putExtra("dev.openverify.sdk.extra.INQUIRY_STATUS", "on_hold")

        assertEquals(InquiryResult.Completed(INQUIRY_ID, InquiryStatus.UNKNOWN), contract.parseResult(code, data))
    }
}
