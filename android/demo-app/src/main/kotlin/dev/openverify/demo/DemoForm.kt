package dev.openverify.demo

import androidx.annotation.StringRes
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.OpenVerifyInquiry
import dev.openverify.sdk.SandboxSignalOutcome

/** A result line for the demo screen: a string resource and its format arguments. */
data class ResultMessage(@StringRes val text: Int, val args: List<String>)

/** The language the flow is asked for (C199.2): the device's, or one of the SDK's own. */
enum class LocaleChoice(val tag: String?) {
    DEVICE(null),
    EN("en"),
    ES("es"),
    FR("fr"),
    DE("de"),
    AR("ar"),
}

/** The bot-detection outcome a sandbox session is asked for (Phase 7 C90.9), or none. */
enum class SandboxOutcomeChoice(val outcome: SandboxSignalOutcome?) {
    NONE(null),
    BOT(SandboxSignalOutcome.BOT),
    HUMAN(SandboxSignalOutcome.HUMAN),
}

/** What the pickers add to a launch (C218.1). */
data class LaunchOptions(val locale: LocaleChoice = LocaleChoice.DEVICE, val appearance: Appearance = Appearance.SYSTEM)

/** The demo screen's logic: turning pasted values into a request, and results into text. */
object DemoForm {
    /** The API's default port (3000) on the development machine, as the Android emulator sees it. */
    const val DEFAULT_API_BASE_URL = "http://10.0.2.2:3000"

    /** A request from the pasted values, or `null` while any of them is missing or malformed. */
    fun requestOrNull(
        inquiryId: String,
        sessionToken: String,
        apiBaseUrl: String,
        options: LaunchOptions = LaunchOptions(),
    ): OpenVerifyInquiry.Request? =
        try {
            OpenVerifyInquiry.Request(inquiryId.trim(), sessionToken.trim(), apiBaseUrl.trim(), options.locale.tag, options.appearance)
        } catch (_: IllegalArgumentException) {
            null
        }

    /**
     * A one-time link (C19) from a pasted link, its API on [apiBaseUrl], or `null` while either is
     * missing or malformed.
     */
    fun oneTimeLinkOrNull(
        link: String,
        apiBaseUrl: String,
        options: LaunchOptions = LaunchOptions(),
    ): OpenVerifyInquiry.OneTimeLink? =
        try {
            OpenVerifyInquiry.fromOneTimeLink(link.trim(), apiBaseUrl.trim(), options.locale.tag, options.appearance)
        } catch (_: IllegalArgumentException) {
            null
        }

    fun describe(result: InquiryResult): ResultMessage {
        val inquiryId = result.inquiryId ?: NO_INQUIRY
        return when (result) {
            is InquiryResult.Completed -> ResultMessage(R.string.result_completed, listOf(inquiryId, result.inquiryStatus.wireValue))
            is InquiryResult.Failed -> ResultMessage(R.string.result_failed, listOf(inquiryId, result.reason.name))
            is InquiryResult.Canceled -> ResultMessage(R.string.result_canceled, listOf(inquiryId))
        }
    }

    private const val NO_INQUIRY = "(none)"
}
