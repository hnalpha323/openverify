package dev.openverify.sdk.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * C238.3, C238.4, C237.6 (Phase 11, Workflow 11A; `clients-connect`): the wire models of the
 * `share_consent` step, as `@openverify/flow-spec` (`shareConsentClientViewSchema`) and
 * `@openverify/contracts` (`flow-api.ts`) freeze them. The client view is composed by the server: the
 * SDK shows its text as served and never composes one. No token, connection or consent-record id is
 * in any of them (C238.5).
 */

/** Which side of a share a `share_consent` step records (C236): the one who discloses, or the one who receives. */
@Serializable
internal enum class ShareConsentSide {
    @SerialName("source")
    SOURCE,

    @SerialName("destination")
    DESTINATION,
}

/**
 * A server-composed text (C238.3): [body] is the logical text (placeholders filled, NFC), [sha256]
 * its digest in lower-case hex, [keys] the copy keys it came from, [locale] the language it is in.
 */
@Serializable
internal data class ShareConsentText(
    val locale: String,
    val body: String,
    val sha256: String,
    val keys: List<String>,
)

/** The separate biometric text the person ticks (C238.3), with its digest. */
@Serializable
internal data class ShareConsentBiometric(
    val body: String,
    val sha256: String,
)

/**
 * C238.3: the `share_consent` step's client view. [recipientName] and [sourceName] are the two
 * organisations' names as shown; [categories] the share's categories (the words are the SDK's, from
 * the web catalogs); [biometric] is present when the share carries biometric data.
 */
@Serializable
internal data class ShareConsentStep(
    override val id: String,
    val side: ShareConsentSide,
    val recipientName: String,
    val sourceName: String,
    val categories: List<String>,
    val text: ShareConsentText,
    val biometric: ShareConsentBiometric? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "share_consent"
    }
}

/**
 * C237.6 (V02): one of this session's accepted, unwithdrawn share consents, by the step that
 * recorded it (the session's `withdrawable-share-consents`).
 */
@Serializable
internal data class FlowWithdrawableShareConsent(
    @SerialName("step-id") val stepId: String,
    val side: ShareConsentSide,
    @SerialName("recipient-name") val recipientName: String,
)

/**
 * C238.4: the accept exit's body (`flowShareConsentAcceptBodySchema`): the SHA-256 of each text the
 * SDK displayed, and the separate biometric tick.
 */
@Serializable
internal data class FlowShareConsentAcceptBody(
    @SerialName("text-sha256") val textSha256: String,
    @SerialName("biometric-text-sha256") val biometricTextSha256: String? = null,
    @SerialName("explicit-biometric") val explicitBiometric: Boolean,
) {
    init {
        require(SHA256_HEX.matches(textSha256)) { "A text digest is 64 lower-case hex characters" }
        require(biometricTextSha256 == null || SHA256_HEX.matches(biometricTextSha256)) { "A text digest is 64 lower-case hex characters" }
    }
}

/** A SHA-256 digest in lower-case hex. */
private val SHA256_HEX: Regex = Regex("[0-9a-f]{64}")
