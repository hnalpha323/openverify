package dev.openverify.sdk.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject

/**
 * A server-driven verification flow (`@openverify/flow-spec`). Field names are camelCase, as in
 * the flow-spec JSON Schema.
 *
 * Steps run in list order. After a step completes, its outgoing [transitions] are evaluated in
 * order and the first whose condition is absent or true picks the next step; if none matches,
 * the next step in the list runs. `completion` and `failure` steps end the flow.
 */
@Serializable
internal data class Flow(
    val metadata: FlowMetadata,
    val steps: List<FlowStep>,
    val transitions: List<FlowTransition> = emptyList(),
)

@Serializable
internal data class FlowMetadata(
    val specVersion: Int,
    val id: String,
    val version: Int,
    val name: String,
    val description: String? = null,
)

@Serializable
internal data class FlowTransition(
    val from: String,
    val to: String,
    /** JSONLogic rule; `null` means "always". */
    val condition: JsonObject? = null,
)

/**
 * One step. The SDK renders [ConsentStep], [GovernmentIdStep], [SelfieStep], [CompletionStep],
 * [FailureStep] and the Phase 5 [PhoneOtpStep], [EmailOtpStep], [DatabaseStep], [AamvaStep],
 * [CryptoWalletStep], [DocumentStep], [DatabaseBusinessStep] and [BusinessWebsiteStep] (C64.2).
 * Every other step, and a known step whose values this SDK version
 * cannot use, decodes as [UnsupportedStep].
 */
@Serializable(with = FlowStepSerializer::class)
internal sealed interface FlowStep {
    public val id: String

    /** The flow-spec step type, such as `government_id`. */
    public val type: String
}

@Serializable
internal data class ConsentStep(
    override val id: String,
    /** Keys of the consent texts shown to the user. */
    val textKeys: List<String>,
    /** Whether the user must accept to continue. */
    val required: Boolean,
    /**
     * Keys of optional consent texts (C42.3), each shown with its own checkbox, unticked. Declining
     * one still lets the user verify. Flows from before Phase 4 have none.
     */
    val optionalTextKeys: List<String> = emptyList(),
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "consent"
    }
}

@Serializable
internal data class GovernmentIdStep(
    override val id: String,
    val sides: DocumentSides,
    /** `null` accepts every country. */
    val allowedCountries: List<String>? = null,
    /** `null` accepts every ID class. */
    val allowedIdClasses: List<String>? = null,
    val maxAttempts: Int,
    val captureMethods: List<CaptureMethod>,
    /** C153.2 (Phase 9): the methods per device class; the SDK applies `native` (C206.1). */
    val captureMethodsByDevice: CaptureMethodsByDevice? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "government_id"
    }
}

@Serializable
internal data class SelfieStep(
    override val id: String,
    val poses: List<SelfiePose>,
    val liveness: Liveness,
    val maxAttempts: Int,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "selfie"
    }
}

@Serializable
internal data class CompletionStep(
    override val id: String,
    val messageKey: String? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "completion"
    }
}

@Serializable
internal data class FailureStep(
    override val id: String,
    val messageKey: String? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "failure"
    }
}

/**
 * C50.3, C55: a phone number, confirmed with a code sent by text message. The server checks the
 * number (C55.8), so [allowVoip] is only what the template says.
 */
@Serializable
internal data class PhoneOtpStep(
    override val id: String,
    /** The countries whose numbers may receive a code, in the template's order (C55.8). */
    val allowedCountries: List<String>,
    /** Digits in a code; `null` means six (C55.2). */
    val codeLength: Int? = null,
    /** Whether VoIP numbers are accepted; `null` means not. */
    val allowVoip: Boolean? = null,
    /** `null` means the type's default (C50.1). */
    val maxAttempts: Int? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "phone_otp"
    }
}

/** C50.3, C55: an email address, confirmed with a code sent to it. */
@Serializable
internal data class EmailOtpStep(
    override val id: String,
    /** Digits in a code; `null` means six (C55.2). */
    val codeLength: Int? = null,
    /** `null` means the type's default (C50.1). */
    val maxAttempts: Int? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "email_otp"
    }
}

/** C50.3, C52.3: the details a database verification compares with a record. */
@Serializable
internal data class DatabaseStep(
    override val id: String,
    /** The fields the step collects. */
    val fields: List<DatabaseField>,
    /** The collected fields the user must fill; `null` leaves it to the server's guidance. */
    val requiredFields: List<DatabaseField>? = null,
    /** `null` means the type's default (C50.1). */
    val maxAttempts: Int? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "database"
    }
}

/**
 * C50.3, C59.6: an AAMVA check of a US driver's license or ID card. With [AamvaSource.GOVERNMENT_ID]
 * the server runs it on the inquiry's own ID and the user sees no screen; with [AamvaSource.FORM]
 * the user enters the card's details.
 */
@Serializable
internal data class AamvaStep(
    override val id: String,
    val source: AamvaSource,
    /** `null` means the type's default (C50.1). */
    val maxAttempts: Int? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "aamva"
    }
}

/**
 * C207.1 (Workflow 10C): the `nfc` step's client view (`nfcClientViewSchema`). [fallbackAvailable]
 * says the step has an `exhausted` edge, so "use another way" may be offered (C207.9);
 * [sandboxChipAvailable] that the sandbox test chip is offered (C208.2); [prefillMrz] the access
 * key from the inquiry's government ID, served to an SDK client at this step only (C207.2).
 */
@Serializable
internal data class NfcStep(
    override val id: String,
    /** Always true: a chip is read by the native SDK only. */
    val androidOnly: Boolean = true,
    /** `null` means the type's default (C50.1). */
    val maxAttempts: Int? = null,
    val fallbackAvailable: Boolean = false,
    val sandboxChipAvailable: Boolean = false,
    val prefillMrz: NfcPrefillMrz? = null,
) : FlowStep {
    override val type: String get() = TYPE

    override fun toString(): String =
        "NfcStep(id=$id, maxAttempts=$maxAttempts, fallbackAvailable=$fallbackAvailable, " +
            "sandboxChipAvailable=$sandboxChipAvailable, prefillMrz=${if (prefillMrz == null) "null" else "<redacted>"})"

    internal companion object {
        const val TYPE = "nfc"
    }
}

/** C50.3, C57: a crypto wallet whose control the user proves by signing a server message. */
@Serializable
internal data class CryptoWalletStep(
    override val id: String,
    /** The CAIP-2 chains offered (C57.1), in their canonical form. */
    val chains: List<String>,
    /** How the user may sign; this SDK signs only by pasting (C64.2). */
    val signing: List<CryptoSigningMethod>,
    /** `null` means the type's default (C50.1). */
    val maxAttempts: Int? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "crypto_wallet"
    }
}

/**
 * C50.3, C60: a supporting document, such as a proof of address, uploaded as a PDF or a photo. The
 * window it must be dated within and the media types it may be come in its guidance (C52.2).
 */
@Serializable
internal data class DocumentStep(
    override val id: String,
    /** The document classes the step accepts, in the template's order. */
    val documentTypes: List<DocumentClass>,
    /** How the user may provide it: a file, a photo, or both. */
    val captureMethods: List<CaptureMethod>,
    /** `null` means the type's default (C50.1). */
    val maxAttempts: Int? = null,
    /** C153.2 (Phase 9): the methods per device class; the SDK applies `native` (C206.1). */
    val captureMethodsByDevice: CaptureMethodsByDevice? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "document"
    }
}

/** C50.3, C61: a business looked up in business registers. */
@Serializable
internal data class DatabaseBusinessStep(
    override val id: String,
    /** Whether the step asks for the business's officers and owners; `null` means not (C52.3). */
    val collectAssociatedPersons: Boolean? = null,
    /** `null` means the type's default (C50.1). */
    val maxAttempts: Int? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "database_business"
    }
}

/** C50.3, C61: a business website, by its URL. The site itself is never opened (C61.3). */
@Serializable
internal data class BusinessWebsiteStep(
    override val id: String,
    /** `null` means the type's default (C50.1). */
    val maxAttempts: Int? = null,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "business_website"
    }
}

/**
 * C96.1 (Phase 7): the move from a desktop to a phone. An SDK session is already on a phone, so the
 * server skips the step for it; the coordinator treats it as done from [FlowHandoff.done] and never
 * stays on it (F01).
 */
@Serializable
internal data class DeviceHandoffStep(
    override val id: String,
) : FlowStep {
    override val type: String get() = TYPE

    internal companion object {
        const val TYPE = "device_handoff"
    }
}

/** C153.2 (Phase 9): a capture step's methods per device class (`captureMethodsByDeviceSchema`). */
@Serializable
internal data class CaptureMethodsByDevice(
    @SerialName("desktop-web") val desktopWeb: List<CaptureMethod>? = null,
    @SerialName("mobile-web") val mobileWeb: List<CaptureMethod>? = null,
    val native: List<CaptureMethod>? = null,
)

/** A step this SDK version cannot render. It keeps the step's [id] and [type]. */
internal data class UnsupportedStep(
    override val id: String,
    override val type: String,
) : FlowStep

@Serializable
internal enum class DocumentSides {
    @SerialName("front")
    FRONT,

    @SerialName("back")
    BACK,

    @SerialName("both")
    BOTH,
}

@Serializable
internal enum class CaptureMethod {
    @SerialName("upload")
    UPLOAD,

    @SerialName("camera")
    CAMERA,
}

/** The wire value of a capture method, as `CAPTURE_METHODS` spells it (C153.2). */
internal fun CaptureMethod.wireValue(): String = when (this) {
    CaptureMethod.UPLOAD -> "upload"
    CaptureMethod.CAMERA -> "camera"
}

/**
 * C206.2 (Workflow 10B; ours): how a photo upload says the shutter fired, sent as the optional
 * multipart field `capture-trigger` and stored and served as client-reported; the server cannot
 * prove it (C206.3).
 */
@Serializable
internal enum class CaptureTrigger(internal val wireValue: String) {
    @SerialName("auto")
    AUTO("auto"),

    @SerialName("manual")
    MANUAL("manual"),
}

@Serializable
internal enum class SelfiePose {
    @SerialName("center")
    CENTER,

    @SerialName("left")
    LEFT,

    @SerialName("right")
    RIGHT,
}

@Serializable
internal enum class Liveness {
    @SerialName("passive")
    PASSIVE,

    @SerialName("active")
    ACTIVE,
}

/** A field a database step collects (flow-spec `DATABASE_FIELDS`, C50.3). */
@Serializable
internal enum class DatabaseField {
    @SerialName("name_first")
    NAME_FIRST,

    @SerialName("name_middle")
    NAME_MIDDLE,

    @SerialName("name_last")
    NAME_LAST,

    @SerialName("birthdate")
    BIRTHDATE,

    @SerialName("address_street_1")
    ADDRESS_STREET_1,

    @SerialName("address_street_2")
    ADDRESS_STREET_2,

    @SerialName("address_city")
    ADDRESS_CITY,

    @SerialName("address_subdivision")
    ADDRESS_SUBDIVISION,

    @SerialName("address_postal_code")
    ADDRESS_POSTAL_CODE,

    @SerialName("address_country_code")
    ADDRESS_COUNTRY_CODE,

    @SerialName("identification_number")
    IDENTIFICATION_NUMBER,

    @SerialName("phone_number")
    PHONE_NUMBER,

    @SerialName("email_address")
    EMAIL_ADDRESS,
}

/** Where an AAMVA step's details come from (flow-spec `AAMVA_SOURCES`, C50.3). */
@Serializable
internal enum class AamvaSource {
    /** The inquiry's own US license or ID card; the server creates the verification (C59.6). */
    @SerialName("government_id")
    GOVERNMENT_ID,

    /** The user enters the card's details. */
    @SerialName("form")
    FORM,
}

/** How a crypto wallet step lets the user sign (flow-spec `CRYPTO_SIGNING_METHODS`, C57). */
@Serializable
internal enum class CryptoSigningMethod {
    /** An injected EIP-1193 wallet, in a browser only. */
    @SerialName("wallet")
    WALLET,

    /** The user signs in their own wallet app and pastes the signature. */
    @SerialName("paste")
    PASTE,
}

/** A supporting document's class (core `DOCUMENT_TYPES`, C60.5). */
@Serializable
internal enum class DocumentClass {
    @SerialName("utility_bill")
    UTILITY_BILL,

    @SerialName("bank_statement")
    BANK_STATEMENT,

    @SerialName("lease")
    LEASE,

    @SerialName("pay_stub")
    PAY_STUB,

    @SerialName("tax_document")
    TAX_DOCUMENT,
}

/** Picks the step class from `type`, falling back to [UnsupportedStep]. JSON only. */
internal object FlowStepSerializer : KSerializer<FlowStep> {
    private val known: Map<String, KSerializer<out FlowStep>> = mapOf(
        ConsentStep.TYPE to ConsentStep.serializer(),
        GovernmentIdStep.TYPE to GovernmentIdStep.serializer(),
        SelfieStep.TYPE to SelfieStep.serializer(),
        CompletionStep.TYPE to CompletionStep.serializer(),
        FailureStep.TYPE to FailureStep.serializer(),
        PhoneOtpStep.TYPE to PhoneOtpStep.serializer(),
        EmailOtpStep.TYPE to EmailOtpStep.serializer(),
        DatabaseStep.TYPE to DatabaseStep.serializer(),
        AamvaStep.TYPE to AamvaStep.serializer(),
        CryptoWalletStep.TYPE to CryptoWalletStep.serializer(),
        DocumentStep.TYPE to DocumentStep.serializer(),
        DatabaseBusinessStep.TYPE to DatabaseBusinessStep.serializer(),
        BusinessWebsiteStep.TYPE to BusinessWebsiteStep.serializer(),
        DeviceHandoffStep.TYPE to DeviceHandoffStep.serializer(),
        // C207.1 (Workflow 10C Stage 1a): the nfc step's client view.
        NfcStep.TYPE to NfcStep.serializer(),
        // C148, C151.5 (Workflow 10A Stage 1a): the screen step's client view.
        ScreenStep.TYPE to ScreenStep.serializer(),
        // C238.3 (Workflow 11A, clients-connect): the share_consent step's server-composed client view.
        ShareConsentStep.TYPE to ShareConsentStep.serializer(),
    )

    /** The step types this SDK version decodes. */
    val types: Set<String> get() = known.keys

    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("dev.openverify.FlowStep") {
        element<String>("id")
        element<String>("type")
    }

    override fun deserialize(decoder: Decoder): FlowStep {
        val input = decoder as? JsonDecoder ?: throw SerializationException("Flow steps can only be read from JSON")
        val body = input.decodeJsonElement() as? JsonObject ?: throw SerializationException("A flow step must be an object")
        val id = body.requiredString("id")
        val type = body.requiredString("type")
        val serializer = known[type] ?: return UnsupportedStep(id, type)
        return try {
            input.json.decodeFromJsonElement(serializer, body)
        } catch (_: IllegalArgumentException) {
            // SerializationException is an IllegalArgumentException. A known step with values
            // this version cannot interpret is not renderable, but the rest of the flow is.
            UnsupportedStep(id, type)
        }
    }

    override fun serialize(encoder: Encoder, value: FlowStep) {
        val output = encoder as? JsonEncoder ?: throw SerializationException("Flow steps can only be written as JSON")
        val body = when (value) {
            is ConsentStep -> output.json.encodeToJsonElement(ConsentStep.serializer(), value)
            is GovernmentIdStep -> output.json.encodeToJsonElement(GovernmentIdStep.serializer(), value)
            is SelfieStep -> output.json.encodeToJsonElement(SelfieStep.serializer(), value)
            is CompletionStep -> output.json.encodeToJsonElement(CompletionStep.serializer(), value)
            is FailureStep -> output.json.encodeToJsonElement(FailureStep.serializer(), value)
            is PhoneOtpStep -> output.json.encodeToJsonElement(PhoneOtpStep.serializer(), value)
            is EmailOtpStep -> output.json.encodeToJsonElement(EmailOtpStep.serializer(), value)
            is DatabaseStep -> output.json.encodeToJsonElement(DatabaseStep.serializer(), value)
            is AamvaStep -> output.json.encodeToJsonElement(AamvaStep.serializer(), value)
            is CryptoWalletStep -> output.json.encodeToJsonElement(CryptoWalletStep.serializer(), value)
            is DocumentStep -> output.json.encodeToJsonElement(DocumentStep.serializer(), value)
            is DatabaseBusinessStep -> output.json.encodeToJsonElement(DatabaseBusinessStep.serializer(), value)
            is BusinessWebsiteStep -> output.json.encodeToJsonElement(BusinessWebsiteStep.serializer(), value)
            is DeviceHandoffStep -> output.json.encodeToJsonElement(DeviceHandoffStep.serializer(), value)
            is ScreenStep -> output.json.encodeToJsonElement(ScreenStep.serializer(), value)
            is NfcStep -> output.json.encodeToJsonElement(NfcStep.serializer(), value)
            // C238.3 (Workflow 11A, clients-connect): the share_consent step's client view.
            is ShareConsentStep -> output.json.encodeToJsonElement(ShareConsentStep.serializer(), value)
            is UnsupportedStep -> JsonObject(emptyMap())
        }.jsonObject
        output.encodeJsonElement(
            buildJsonObject {
                put("id", JsonPrimitive(value.id))
                put("type", JsonPrimitive(value.type))
                body.forEach { (key, element) -> if (key != "id") put(key, element) }
            },
        )
    }

    private fun JsonObject.requiredString(key: String): String {
        val value = this[key] as? JsonPrimitive
        if (value == null || !value.isString) {
            throw SerializationException("A flow step needs a string \"$key\"")
        }
        return value.content
    }
}
