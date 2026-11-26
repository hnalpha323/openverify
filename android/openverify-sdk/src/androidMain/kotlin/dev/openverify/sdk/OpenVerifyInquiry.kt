package dev.openverify.sdk

import android.content.Context
import android.content.Intent
import androidx.activity.result.contract.ActivityResultContract
import dev.openverify.sdk.InquiryResults.putOptions
import dev.openverify.sdk.api.OneTimeLinks
import dev.openverify.sdk.api.SessionCredentials
import java.util.Objects

/** Entry point for running an inquiry's verification flow from an Android app. */
public object OpenVerifyInquiry {

    /**
     * The inquiry to run. Your server creates the inquiry and its session token with an API key
     * (`POST /api/v1/inquiries/:id/resume`) and hands only the session token to the app.
     *
     * ```
     * OpenVerifyInquiry.Request(inquiryId, sessionToken, "https://verify.example.com", locale = "es")
     * ```
     *
     * @param apiBaseUrl origin of the OpenVerify API, such as `https://verify.example.com`;
     *   https is required except for `localhost`, `127.0.0.1`, `::1` and `10.0.2.2` in a
     *   debuggable app (C190.2): a flow launched in any other app over plain http ends as
     *   [FailureReason.INVALID_REQUEST] before any request. An internationalized domain name is
     *   written in its `xn--` form.
     * @param locale a BCP 47 tag of at most 35 characters, such as `es` or `ar-EG`, that the flow
     *   is shown in when it is enabled; `null` follows the device (C199.2). An unsupported tag
     *   falls back without error.
     * @param appearance the flow's light or dark look (C198.5).
     * @throws IllegalArgumentException if a value is malformed. Messages never contain the token.
     */
    public data class Request(
        val inquiryId: String,
        val sessionToken: String,
        val apiBaseUrl: String,
        val locale: String? = null,
        val appearance: Appearance = Appearance.SYSTEM,
    ) {
        init {
            require(SessionCredentials.isInquiryId(inquiryId)) { "inquiryId must be an OpenVerify inquiry ID (inq_...)" }
            SessionCredentials.requireSessionToken(sessionToken)
            SessionCredentials.parseApiBaseUrl(apiBaseUrl)
            require(locale == null || RequestOptions.isLocale(locale)) { RequestOptions.LOCALE_REFUSED }
        }

        override fun toString(): String =
            "Request(inquiryId=$inquiryId, sessionToken=<redacted>, apiBaseUrl=$apiBaseUrl, locale=$locale, appearance=$appearance)"
    }

    /**
     * Launches the verification flow and returns how it ended:
     * ```
     * val verify = registerForActivityResult(OpenVerifyInquiry.Contract()) { result -> ... }
     * verify.launch(OpenVerifyInquiry.Request(inquiryId, sessionToken, apiBaseUrl))
     * ```
     */
    public class Contract : ActivityResultContract<Request, InquiryResult>() {
        override fun createIntent(context: Context, input: Request): Intent =
            Intent(context, OpenVerifyInquiryActivity::class.java)
                .putExtra(InquiryResults.EXTRA_INQUIRY_ID, input.inquiryId)
                .putExtra(InquiryResults.EXTRA_SESSION_TOKEN, input.sessionToken)
                .putExtra(InquiryResults.EXTRA_API_BASE_URL, input.apiBaseUrl)
                .putOptions(input.locale, input.appearance)

        override fun parseResult(resultCode: Int, intent: Intent?): InquiryResult =
            InquiryResults.fromActivityResult(intent)
    }

    /**
     * A one-time link (C10), read by [fromOneTimeLink]. The flow redeems it once, when it starts,
     * and keeps the session token it gets in memory only. Opening the same link again ends as
     * [FailureReason.LINK_INVALID].
     */
    public class OneTimeLink internal constructor(
        public val inquiryId: String,
        /** The single-use credential. It never appears in [toString] or in error messages. */
        internal val oneTimeToken: String,
        /** Origin of the OpenVerify API, as in [Request.apiBaseUrl]: always your app's own. */
        public val apiBaseUrl: String,
        /** As [Request.locale]. */
        public val locale: String? = null,
        /** As [Request.appearance]. */
        public val appearance: Appearance = Appearance.SYSTEM,
    ) {
        init {
            require(SessionCredentials.isInquiryId(inquiryId)) { "inquiryId must be an OpenVerify inquiry ID (inq_...)" }
            SessionCredentials.requireOneTimeToken(oneTimeToken)
            SessionCredentials.parseApiBaseUrl(apiBaseUrl)
            require(locale == null || RequestOptions.isLocale(locale)) { RequestOptions.LOCALE_REFUSED }
        }

        override fun equals(other: Any?): Boolean =
            other is OneTimeLink &&
                inquiryId == other.inquiryId &&
                oneTimeToken == other.oneTimeToken &&
                apiBaseUrl == other.apiBaseUrl &&
                locale == other.locale &&
                appearance == other.appearance

        override fun hashCode(): Int = Objects.hash(inquiryId, oneTimeToken, apiBaseUrl, locale, appearance)

        override fun toString(): String =
            "OneTimeLink(inquiryId=$inquiryId, oneTimeToken=<redacted>, apiBaseUrl=$apiBaseUrl, locale=$locale, appearance=$appearance)"
    }

    /**
     * Reads a one-time link, `https://verify.example.com/#inquiry-id=inq_...&one-time-token=ovo_...`,
     * as `POST /api/v1/inquiries/:id/generate-one-time-link` builds it. The link travels in the
     * fragment, so an app link or a message hands it over without any server seeing it. Launch it
     * with [OneTimeLinkContract].
     *
     * ```
     * val link = OpenVerifyInquiry.fromOneTimeLink(intent.dataString!!, apiBaseUrl = BuildConfig.OPENVERIFY_API)
     * ```
     *
     * @param apiBaseUrl origin of the OpenVerify API, compiled into your app: the link supplies only
     *   the inquiry and its one-time token, never the server the SDK talks to (C190.2, decision 65).
     * @param locale as [Request.locale].
     * @param appearance as [Request.appearance].
     * @throws IllegalArgumentException unless the fragment holds exactly one inquiry ID and one
     *   one-time token, and nothing else that grants access, and the API base URL is valid (an
     *   internationalized domain name only in its `xn--` form). Messages never contain the token.
     */
    @JvmStatic
    @JvmOverloads
    public fun fromOneTimeLink(
        url: String,
        apiBaseUrl: String,
        locale: String? = null,
        appearance: Appearance = Appearance.SYSTEM,
    ): OneTimeLink {
        val link = OneTimeLinks.parse(url, apiBaseUrl)
        return OneTimeLink(link.inquiryId, link.oneTimeToken, link.apiBaseUrl, locale, appearance)
    }

    /**
     * Launches the verification flow from a one-time link and returns how it ended:
     * ```
     * val verify = registerForActivityResult(OpenVerifyInquiry.OneTimeLinkContract()) { result -> ... }
     * verify.launch(OpenVerifyInquiry.fromOneTimeLink(link, apiBaseUrl = BuildConfig.OPENVERIFY_API))
     * ```
     */
    public class OneTimeLinkContract : ActivityResultContract<OneTimeLink, InquiryResult>() {
        override fun createIntent(context: Context, input: OneTimeLink): Intent =
            Intent(context, OpenVerifyInquiryActivity::class.java)
                .putExtra(InquiryResults.EXTRA_INQUIRY_ID, input.inquiryId)
                .putExtra(InquiryResults.EXTRA_ONE_TIME_TOKEN, input.oneTimeToken)
                .putExtra(InquiryResults.EXTRA_API_BASE_URL, input.apiBaseUrl)
                .putOptions(input.locale, input.appearance)

        override fun parseResult(resultCode: Int, intent: Intent?): InquiryResult =
            InquiryResults.fromActivityResult(intent)
    }
}
