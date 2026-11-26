package dev.openverify.sdk

import android.app.Activity
import android.content.Intent
import dev.openverify.sdk.api.SessionCredentials
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.JsonPrimitive

/** Converts between flow states, results and the intents that carry them. */
internal object InquiryResults {
    const val EXTRA_INQUIRY_ID = "dev.openverify.sdk.extra.INQUIRY_ID"
    const val EXTRA_SESSION_TOKEN = "dev.openverify.sdk.extra.SESSION_TOKEN"
    const val EXTRA_API_BASE_URL = "dev.openverify.sdk.extra.API_BASE_URL"
    const val EXTRA_ONE_TIME_TOKEN = "dev.openverify.sdk.extra.ONE_TIME_TOKEN"

    /** C190.2: `Request.locale` or `OneTimeLink.locale`, absent for `null`. Only in the launch intent. */
    const val EXTRA_LOCALE = "dev.openverify.sdk.extra.LOCALE"

    /** C190.2: the [Appearance]'s name. Only in the launch intent. */
    const val EXTRA_APPEARANCE = "dev.openverify.sdk.extra.APPEARANCE"

    private const val EXTRA_RESULT = "dev.openverify.sdk.extra.RESULT"
    private const val EXTRA_INQUIRY_STATUS = "dev.openverify.sdk.extra.INQUIRY_STATUS"
    private const val EXTRA_FAILURE_REASON = "dev.openverify.sdk.extra.FAILURE_REASON"
    private const val COMPLETED = "completed"
    private const val FAILED = "failed"
    private const val CANCELED = "canceled"

    /** The result of ending the flow in [state], as [InquiryOutcomes] gives it on every platform. */
    fun forFinish(state: FlowState, inquiryId: String): InquiryResult = InquiryOutcomes.forFinish(state, inquiryId)

    /** What a launch intent starts: a session, or a one-time link to redeem first (C19), with the host's options (C190.2). */
    sealed interface Launch {
        val inquiryId: String
        val apiBaseUrl: String
        val locale: String?
        val appearance: Appearance

        data class Session(val request: OpenVerifyInquiry.Request) : Launch {
            override val inquiryId: String get() = request.inquiryId
            override val apiBaseUrl: String get() = request.apiBaseUrl
            override val locale: String? get() = request.locale
            override val appearance: Appearance get() = request.appearance
        }

        data class OneTimeLink(val link: OpenVerifyInquiry.OneTimeLink) : Launch {
            override val inquiryId: String get() = link.inquiryId
            override val apiBaseUrl: String get() = link.apiBaseUrl
            override val locale: String? get() = link.locale
            override val appearance: Appearance get() = link.appearance
        }
    }

    /**
     * The launch in an intent, or `null` when it is missing, malformed, or carries both a session
     * token and a one-time token.
     */
    fun launchFrom(intent: Intent): Launch? {
        val session = intent.hasExtra(EXTRA_SESSION_TOKEN)
        val oneTimeLink = intent.hasExtra(EXTRA_ONE_TIME_TOKEN)
        return when {
            session && oneTimeLink -> null
            session -> requestFrom(intent)?.let(Launch::Session)
            oneTimeLink -> oneTimeLinkFrom(intent)?.let(Launch::OneTimeLink)
            else -> null
        }
    }

    private fun oneTimeLinkFrom(intent: Intent): OpenVerifyInquiry.OneTimeLink? {
        val inquiryId = intent.getStringExtra(EXTRA_INQUIRY_ID) ?: return null
        val token = intent.getStringExtra(EXTRA_ONE_TIME_TOKEN) ?: return null
        val apiBaseUrl = intent.getStringExtra(EXTRA_API_BASE_URL) ?: return null
        val appearance = appearanceFrom(intent) ?: return null
        return try {
            OpenVerifyInquiry.OneTimeLink(inquiryId, token, apiBaseUrl, intent.getStringExtra(EXTRA_LOCALE), appearance)
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /** The request in a launch intent, or `null` when it is missing or malformed. */
    fun requestFrom(intent: Intent): OpenVerifyInquiry.Request? {
        val inquiryId = intent.getStringExtra(EXTRA_INQUIRY_ID) ?: return null
        val sessionToken = intent.getStringExtra(EXTRA_SESSION_TOKEN) ?: return null
        val apiBaseUrl = intent.getStringExtra(EXTRA_API_BASE_URL) ?: return null
        val appearance = appearanceFrom(intent) ?: return null
        return try {
            OpenVerifyInquiry.Request(inquiryId, sessionToken, apiBaseUrl, intent.getStringExtra(EXTRA_LOCALE), appearance)
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /** The intent's [Appearance]: [Appearance.SYSTEM] when it names none, `null` for a name this SDK does not know. */
    private fun appearanceFrom(intent: Intent): Appearance? {
        val name = intent.getStringExtra(EXTRA_APPEARANCE) ?: return Appearance.SYSTEM
        return Appearance.entries.firstOrNull { it.name == name }
    }

    /**
     * C190.2: the host's options beside the credentials. They live only in the launch intent the
     * activity was started with, never in saved state: a recreated activity reads its intent again.
     */
    fun Intent.putOptions(locale: String?, appearance: Appearance): Intent = apply {
        if (locale != null) putExtra(EXTRA_LOCALE, locale)
        putExtra(EXTRA_APPEARANCE, appearance.name)
    }

    /** The inquiry ID of a launch intent, when it is well formed. */
    fun inquiryIdFrom(intent: Intent): String? = intent.getStringExtra(EXTRA_INQUIRY_ID)?.takeIf(SessionCredentials::isInquiryId)

    /** The activity result code and data for [result]. */
    fun toActivityResult(result: InquiryResult): Pair<Int, Intent> {
        val data = Intent().putExtra(EXTRA_INQUIRY_ID, result.inquiryId)
        return when (result) {
            is InquiryResult.Completed -> Activity.RESULT_OK to data
                .putExtra(EXTRA_RESULT, COMPLETED)
                .putExtra(EXTRA_INQUIRY_STATUS, result.inquiryStatus.wireValue)
            is InquiryResult.Failed -> Activity.RESULT_OK to data
                .putExtra(EXTRA_RESULT, FAILED)
                .putExtra(EXTRA_FAILURE_REASON, result.reason.name)
            is InquiryResult.Canceled -> Activity.RESULT_CANCELED to data.putExtra(EXTRA_RESULT, CANCELED)
        }
    }

    /**
     * The result carried by an activity result's data. The result code adds nothing: data
     * without a result, for example from an activity the system removed, counts as canceled.
     */
    fun fromActivityResult(intent: Intent?): InquiryResult {
        val inquiryId = intent?.getStringExtra(EXTRA_INQUIRY_ID)
        return when (intent?.getStringExtra(EXTRA_RESULT)) {
            COMPLETED if inquiryId != null -> InquiryResult.Completed(inquiryId, statusOf(intent.getStringExtra(EXTRA_INQUIRY_STATUS)))
            FAILED -> InquiryResult.Failed(inquiryId, reasonOf(intent.getStringExtra(EXTRA_FAILURE_REASON)))
            else -> InquiryResult.Canceled(inquiryId)
        }
    }

    private fun statusOf(value: String?): InquiryStatus =
        OpenVerifyJson.decodeFromJsonElement(InquiryStatus.Serializer, JsonPrimitive(value ?: ""))

    private fun reasonOf(value: String?): FailureReason =
        FailureReason.entries.firstOrNull { it.name == value } ?: FailureReason.SERVER_ERROR
}
