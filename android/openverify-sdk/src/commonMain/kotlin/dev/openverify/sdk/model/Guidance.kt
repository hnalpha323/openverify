package dev.openverify.sdk.model

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// C52.2: the `guidance` of a Phase 5 type's flow view, one shape per type, as the contracts'
// `<type>GuidanceSchema` and the OpenAPI components `Flow<Type>Verification` define it.

/**
 * C52.2, C55: the open code of a phone or email verification; `null` before the first send. It
 * never holds the code.
 */
@Serializable
internal data class OtpGuidanceState(
    /** The destination with most characters hidden, so the user can spot a typo. */
    @SerialName("masked-destination") val maskedDestination: String,
    @SerialName("expires-at") val expiresAt: String,
    /** When the next send is allowed; `null` when no send is left. */
    @SerialName("resend-available-at") val resendAvailableAt: String? = null,
    @SerialName("sends-remaining") val sendsRemaining: Int,
    @SerialName("attempts-remaining") val attemptsRemaining: Int,
) {
    /** Even masked, the destination is the user's: it is shown to them, never printed (C53.8). */
    override fun toString(): String =
        "OtpGuidanceState(maskedDestination=<redacted>, expiresAt=$expiresAt, resendAvailableAt=$resendAvailableAt, " +
            "sendsRemaining=$sendsRemaining, attemptsRemaining=$attemptsRemaining)"
}

@Serializable
internal data class PhoneNumberGuidance(
    @SerialName("allowed-countries") val allowedCountries: List<String>,
    @SerialName("code-length") val codeLength: Int,
    val otp: OtpGuidanceState? = null,
)

@Serializable
internal data class EmailAddressGuidance(
    @SerialName("code-length") val codeLength: Int,
    val otp: OtpGuidanceState? = null,
)

/** The body members (C52.3 names, kebab-case) a database step collects, and the ones it requires. */
@Serializable
internal data class DatabaseGuidance(
    val fields: List<String>,
    @SerialName("required-fields") val requiredFields: List<String>,
)

@Serializable
internal data class AamvaGuidance(val source: AamvaSource)

@Serializable
internal data class CryptoWalletGuidance(
    val chains: List<String>,
    val signing: List<CryptoSigningMethod>,
)

/**
 * C52.2, C60: the documents a document step accepts, the window they must be dated within
 * (`document_recency_detection`'s `max-age-days`), the most pages a PDF may have, and the media types.
 */
@Serializable
internal data class DocumentGuidance(
    @SerialName("accepted-types") val acceptedTypes: List<DocumentClass>,
    @SerialName("max-age-days") val maxAgeDays: Int,
    @SerialName("max-pages") val maxPages: Int,
    @SerialName("accepted-mime-types") val acceptedMimeTypes: List<String>,
)

/**
 * C52.2, C61: whether a business step asks for associated persons, and the inputs every configured
 * match group names, which the body must carry (C52.3).
 */
@Serializable
internal data class DatabaseBusinessGuidance(
    @SerialName("collect-associated-persons") val collectAssociatedPersons: Boolean,
    @SerialName("required-inputs") val requiredInputs: List<String>,
)

/**
 * The verification's guidance read as [deserializer]'s shape, or `null` when it has none or it is
 * not that shape: the step's own definition then stands in for it.
 */
internal fun <T> FlowVerification.guidanceAs(deserializer: DeserializationStrategy<T>): T? {
    val guidance = attributes.guidance ?: return null
    return try {
        OpenVerifyJson.decodeFromJsonElement(deserializer, guidance)
    } catch (_: IllegalArgumentException) {
        // SerializationException is an IllegalArgumentException: guidance of another shape.
        null
    }
}
