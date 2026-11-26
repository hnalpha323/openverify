package dev.openverify.sdk.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/** An enum constant with the exact string the API uses for it. */
internal interface WireValue {
    val wireValue: String
}

/**
 * Serializes an enum by its wire value ([wireValueOf]; a [WireValue]'s own). With an [unknown] entry, values this SDK version does
 * not know decode to it instead of failing, and the entry itself is never encoded. Without
 * one, unknown values are rejected.
 */
internal open class WireEnumSerializer<E : Enum<E>>(
    serialName: String,
    private val entries: List<E>,
    private val unknown: E?,
    private val wireValueOf: (E) -> String,
) : KSerializer<E> {

    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor(serialName, PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): E {
        val value = decoder.decodeString()
        return entries.firstOrNull { it != unknown && wireValueOf(it) == value }
            ?: unknown
            // KP10-37: the value came from the server, so the message names the enum alone.
            ?: throw SerializationException("${descriptor.serialName} has no such value")
    }

    override fun serialize(encoder: Encoder, value: E) {
        if (value == unknown) {
            throw SerializationException("${descriptor.serialName}.${value.name} is a placeholder and cannot be sent")
        }
        encoder.encodeString(wireValueOf(value))
    }
}

/** Inquiry status (`@openverify/core` `INQUIRY_STATUSES`). */
// KP10-12: no @Serializable on a public enum, whose companion would publish serializer(): KSerializer
// (a kotlinx.serialization type) in the ABI. The wire models name [InquiryStatus.Serializer] instead
// (`@file:UseSerializers` in model/Resources.kt).
public enum class InquiryStatus(
    /** The status as the API spells it, such as `needs_review`. */
    public val wireValue: String,
) {
    CREATED("created"),
    PENDING("pending"),
    COMPLETED("completed"),
    FAILED("failed"),
    EXPIRED("expired"),
    APPROVED("approved"),
    DECLINED("declined"),
    NEEDS_REVIEW("needs_review"),

    /** A status added after this SDK version. */
    UNKNOWN("unknown"),
    ;

    internal object Serializer : WireEnumSerializer<InquiryStatus>("dev.openverify.InquiryStatus", entries, UNKNOWN, { it.wireValue })
}

/** Verification status (`VERIFICATION_STATUSES`). `requires_retry` is deprecated upstream. */
@Serializable(with = VerificationStatus.Serializer::class)
internal enum class VerificationStatus(override val wireValue: String) : WireValue {
    INITIATED("initiated"),
    CONFIRMED("confirmed"),
    SUBMITTED("submitted"),
    PASSED("passed"),
    FAILED("failed"),
    REQUIRES_RETRY("requires_retry"),
    CANCELED("canceled"),
    SKIPPED("skipped"),

    /** An operator decides it (C30.4); for the user it is done, so polling stops (C30.6). */
    NEEDS_REVIEW("needs_review"),

    /** A status added after this SDK version. */
    UNKNOWN("unknown"),
    ;

    /** Whether the server has finished with the verification, so polling can stop. */
    public val isDecided: Boolean
        get() =
            this == PASSED || this == FAILED || this == REQUIRES_RETRY || this == CANCELED || this == SKIPPED ||
                this == NEEDS_REVIEW

    internal object Serializer :
        WireEnumSerializer<VerificationStatus>("dev.openverify.VerificationStatus", entries, UNKNOWN, { it.wireValue })
}

/** Outcome of one check (`CHECK_STATUSES`). */
@Serializable(with = CheckStatus.Serializer::class)
internal enum class CheckStatus(override val wireValue: String) : WireValue {
    PASSED("passed"),
    FAILED("failed"),
    NOT_APPLICABLE("not_applicable"),
    PENDING("pending"),

    /** A status added after this SDK version. */
    UNKNOWN("unknown"),
    ;

    internal object Serializer : WireEnumSerializer<CheckStatus>("dev.openverify.CheckStatus", entries, UNKNOWN, { it.wireValue })
}

/** Whether the template requires a check (C2 `checks[].requirement`). */
@Serializable(with = CheckRequirement.Serializer::class)
internal enum class CheckRequirement(override val wireValue: String) : WireValue {
    REQUIRED("required"),
    NOT_REQUIRED("not_required"),

    /** A value added after this SDK version. */
    UNKNOWN("unknown"),
    ;

    internal object Serializer :
        WireEnumSerializer<CheckRequirement>("dev.openverify.CheckRequirement", entries, UNKNOWN, { it.wireValue })
}

/**
 * Kind of a file (C3, C52.4): the government ID and selfie images this SDK captures, and the
 * Phase 5 document and chip files. A kind added after this SDK version decodes as [UNKNOWN],
 * which is never sent.
 */
// KP10-12: no @Serializable on a public enum, whose companion would publish serializer(): KSerializer
// (a kotlinx.serialization type) in the ABI. The wire models name [FileKind.Serializer] instead
// (`@file:UseSerializers` in model/Resources.kt).
public enum class FileKind(
    /** The kind as the API spells it, such as `chip-dg1`. */
    public val wireValue: String,
) {
    FRONT("front"),
    BACK("back"),
    PORTRAIT("portrait"),
    SELFIE_CENTER("selfie-center"),
    SELFIE_LEFT("selfie-left"),
    SELFIE_RIGHT("selfie-right"),

    /** C52.4: a document's file (an image or a PDF). */
    DOCUMENT("document"),

    /** C52.4: the chip's security object and data groups, uploaded by the NFC step. */
    CHIP_SOD("chip-sod"),
    CHIP_DG1("chip-dg1"),
    CHIP_DG2("chip-dg2"),
    CHIP_DG14("chip-dg14"),
    CHIP_DG15("chip-dg15"),
    CHIP_CARD_SECURITY("chip-card-security"),
    CHIP_CARD_ACCESS("chip-card-access"),
    CHIP_COM("chip-com"),

    /** C52.4: written by the server, never uploaded: a document's first page, the chip's portrait. */
    DOCUMENT_PREVIEW("document-preview"),
    CHIP_PORTRAIT("chip-portrait"),

    /** A kind added after this SDK version. */
    UNKNOWN("unknown"),
    ;

    internal object Serializer : WireEnumSerializer<FileKind>("dev.openverify.FileKind", entries, UNKNOWN, { it.wireValue })
}

/** Kind of environment a flow session runs in (C19). Sandbox shows a banner and allows uploads. */
@Serializable(with = EnvironmentKind.Serializer::class)
internal enum class EnvironmentKind(override val wireValue: String) : WireValue {
    SANDBOX("sandbox"),
    PRODUCTION("production"),

    /** A kind added after this SDK version; treated like production. */
    UNKNOWN("unknown"),
    ;

    internal object Serializer : WireEnumSerializer<EnvironmentKind>("dev.openverify.EnvironmentKind", entries, UNKNOWN, { it.wireValue })
}

/** Status of an inquiry session (C10 `INQUIRY_SESSION_STATUSES`). */
@Serializable(with = InquirySessionStatus.Serializer::class)
internal enum class InquirySessionStatus(override val wireValue: String) : WireValue {
    ACTIVE("active"),
    EXPIRED("expired"),
    CANCELED("canceled"),

    /** A status added after this SDK version. */
    UNKNOWN("unknown"),
    ;

    internal object Serializer :
        WireEnumSerializer<InquirySessionStatus>("dev.openverify.InquirySessionStatus", entries, UNKNOWN, { it.wireValue })
}

/** The verification types (C50.1) and their API spellings. */
internal enum class VerificationType(
    /** Value of `type` in `POST /api/v1/flow/verifications`. */
    public val apiValue: String,
    /** JSON:API resource `type`. */
    public val resourceType: String,
) {
    GOVERNMENT_ID("government-id", "verification/government-id"),
    SELFIE("selfie", "verification/selfie"),
    DOCUMENT("document", "verification/document"),
    DATABASE("database", "verification/database"),
    AAMVA("aamva", "verification/aamva"),
    PHONE_NUMBER("phone-number", "verification/phone-number"),
    EMAIL_ADDRESS("email-address", "verification/email-address"),
    GOVERNMENT_ID_NFC("government-id-nfc", "verification/government-id-nfc"),
    CRYPTO_WALLET("crypto-wallet", "verification/crypto-wallet"),
    DATABASE_BUSINESS("database-business", "verification/database-business"),
    BUSINESS_WEBSITE("business-website", "verification/business-website"),

    /** A verification type this SDK version cannot run. */
    UNKNOWN("unknown", "unknown"),
    ;

    public companion object {
        public fun fromResourceType(type: String): VerificationType =
            entries.firstOrNull { it != UNKNOWN && it.resourceType == type } ?: UNKNOWN
    }
}

/**
 * Why a flow session was canceled: `reason` of the 401 `session_canceled` problem (C25.8,
 * `SESSION_CANCELED_REASONS`), derived from the inquiry when the call was made.
 */
@Serializable(with = SessionCanceledReason.Serializer::class)
internal enum class SessionCanceledReason(override val wireValue: String) : WireValue {
    INQUIRY_REDACTED("inquiry_redacted"),
    INQUIRY_EXPIRED("inquiry_expired"),
    INQUIRY_FINISHED("inquiry_finished"),

    /** A reason added after this SDK version. */
    UNKNOWN("unknown"),
    ;

    internal object Serializer :
        WireEnumSerializer<SessionCanceledReason>("dev.openverify.SessionCanceledReason", entries, UNKNOWN, { it.wireValue })
}
