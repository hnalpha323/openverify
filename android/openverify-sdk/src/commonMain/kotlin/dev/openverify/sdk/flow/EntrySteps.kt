package dev.openverify.sdk.flow

import dev.openverify.sdk.model.AamvaInputs
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.AssociatedPersonInputs
import dev.openverify.sdk.model.BusinessWebsiteInputs
import dev.openverify.sdk.model.BusinessWebsiteStep
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CryptoChains
import dev.openverify.sdk.model.CryptoWalletGuidance
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.DatabaseBusinessGuidance
import dev.openverify.sdk.model.DatabaseBusinessInputs
import dev.openverify.sdk.model.DatabaseBusinessStep
import dev.openverify.sdk.model.DatabaseField
import dev.openverify.sdk.model.DatabaseGuidance
import dev.openverify.sdk.model.DatabaseInputs
import dev.openverify.sdk.model.DatabaseStep
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.DocumentGuidance
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.EmailAddressGuidance
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.OtpGuidanceState
import dev.openverify.sdk.model.OtpLimits
import dev.openverify.sdk.model.PersonField
import dev.openverify.sdk.model.PersonInput
import dev.openverify.sdk.model.PhoneNumberGuidance
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.VerificationInputs
import dev.openverify.sdk.model.guidanceAs
import kotlin.time.Instant

// The screens of the Phase 5 steps the user types into (C64.2), built from the step and, once the
// server has made the verification, its guidance (C52.2). Pure: the coordinator decides when.

/**
 * The phone or email step's screen: the server's guidance for [verification] when it has some (its
 * countries, code length and open code), else the step's own values with no code open.
 */
internal fun otpState(step: FlowStep, verification: FlowVerification?, hints: List<RetryHint>): FlowState.Otp = when (step) {
    is PhoneOtpStep -> {
        val guidance = verification?.guidanceAs(PhoneNumberGuidance.serializer())
        FlowState.Otp(
            step = step,
            channel = OtpChannel.PHONE,
            allowedCountries = guidance?.allowedCountries ?: step.allowedCountries,
            codeLength = guidance?.codeLength ?: step.codeLength ?: OtpLimits.DEFAULT_CODE_LENGTH,
            code = guidance?.otp?.toCode(),
            retryHints = hints,
        )
    }
    is EmailOtpStep -> {
        val guidance = verification?.guidanceAs(EmailAddressGuidance.serializer())
        FlowState.Otp(
            step = step,
            channel = OtpChannel.EMAIL,
            allowedCountries = emptyList(),
            codeLength = guidance?.codeLength ?: step.codeLength ?: OtpLimits.DEFAULT_CODE_LENGTH,
            code = guidance?.otp?.toCode(),
            retryHints = hints,
        )
    }
    else -> throw IllegalArgumentException("${step.type} is not a one-time code step")
}

/**
 * The database or AAMVA form: for a database step, the fields and required fields of the server's
 * guidance when it has some, else the step's fields, and its required fields together with the ones
 * every database step collects and the server always requires (C50.3, C52.3). The AAMVA form takes a
 * card's details (C52.3).
 */
internal fun formState(step: FlowStep, verification: FlowVerification?, hints: List<RetryHint>): FlowState.Form = when (step) {
    is DatabaseStep -> {
        val guidance = verification?.guidanceAs(DatabaseGuidance.serializer())
        val fields = guidance?.fields?.mapNotNull(::inputFieldNamed)?.takeIf { it.isNotEmpty() }
            ?: step.fields.map { it.inputField() }
        val required = guidance?.requiredFields?.mapNotNull(::inputFieldNamed)?.toSet()
            ?: (step.requiredFields.orEmpty().map { it.inputField() }.toSet() + DATABASE_COLLECTED_ALWAYS)
        FlowState.Form(step, fields, required intersect fields.toSet(), hints)
    }
    is AamvaStep -> FlowState.Form(step, AAMVA_FORM_FIELDS, AAMVA_FORM_REQUIRED, hints)
    // C52.2, C52.3: the business's name and country, and every input each match group names.
    is DatabaseBusinessStep -> {
        val guidance = verification?.guidanceAs(DatabaseBusinessGuidance.serializer())
        val required = BUSINESS_REQUIRED + guidance?.requiredInputs.orEmpty().mapNotNull(::inputFieldNamed)
        FlowState.Form(
            step,
            BUSINESS_FORM_FIELDS,
            required intersect BUSINESS_FORM_FIELDS.toSet(),
            hints,
            collectsPersons = guidance?.collectAssociatedPersons ?: step.collectAssociatedPersons ?: false,
        )
    }
    is BusinessWebsiteStep -> FlowState.Form(step, WEBSITE_FORM_FIELDS, setOf(InputField.WEBSITE_URL), hints)
    else -> throw IllegalArgumentException("${step.type} is not a form step")
}

/**
 * C52.2, C60: the document step's screen: the server's guidance for [verification] when it has some
 * (the accepted classes, the window, the pages, the media types), else the step's classes with no
 * window and every media type this SDK sends. A photo can be taken when the step allows the camera
 * and an image is accepted; a file can be chosen when the step allows uploads, or no photo can be.
 */
internal fun documentState(step: DocumentStep, verification: FlowVerification?, hints: List<RetryHint>): FlowState.Document {
    val guidance = verification?.guidanceAs(DocumentGuidance.serializer())
    val mediaTypes = guidance?.acceptedMimeTypes?.filter { it in DocumentFile.MIME_TYPES } ?: DocumentFile.MIME_TYPES
    val camera = CaptureMethod.CAMERA in step.captureMethods && mediaTypes.any { it.startsWith("image/") }
    return FlowState.Document(
        step = step,
        acceptedTypes = guidance?.acceptedTypes ?: step.documentTypes,
        maxAgeDays = guidance?.maxAgeDays,
        maxPages = guidance?.maxPages,
        mediaTypes = mediaTypes,
        upload = CaptureMethod.UPLOAD in step.captureMethods || !camera,
        camera = camera,
        retryHints = hints,
    )
}

/**
 * The body a form sends: [values], trimmed and only for its own fields, a blank one left out; a
 * business body also carries [persons], each by its fields, a blank birth date left out.
 */
internal fun formInputs(
    step: FlowStep,
    values: Map<InputField, String>,
    persons: List<Map<PersonField, String>> = emptyList(),
): VerificationInputs = when (step) {
    is DatabaseStep -> DatabaseInputs(
        nameFirst = values[InputField.NAME_FIRST],
        nameMiddle = values[InputField.NAME_MIDDLE],
        nameLast = values[InputField.NAME_LAST],
        birthdate = values[InputField.BIRTHDATE],
        addressStreet1 = values[InputField.ADDRESS_STREET_1],
        addressStreet2 = values[InputField.ADDRESS_STREET_2],
        addressCity = values[InputField.ADDRESS_CITY],
        addressSubdivision = values[InputField.ADDRESS_SUBDIVISION],
        addressPostalCode = values[InputField.ADDRESS_POSTAL_CODE],
        addressCountryCode = values[InputField.ADDRESS_COUNTRY_CODE],
        identificationNumber = values[InputField.IDENTIFICATION_NUMBER],
        phoneNumber = values[InputField.PHONE_NUMBER],
        emailAddress = values[InputField.EMAIL_ADDRESS],
    )
    // The required members are never empty here: the form checks them first.
    is AamvaStep -> AamvaInputs(
        nameFirst = values[InputField.NAME_FIRST].orEmpty(),
        nameLast = values[InputField.NAME_LAST].orEmpty(),
        birthdate = values[InputField.BIRTHDATE].orEmpty(),
        identificationNumber = values[InputField.IDENTIFICATION_NUMBER].orEmpty(),
        issuingAuthority = values[InputField.ISSUING_AUTHORITY].orEmpty(),
        issueDate = values[InputField.ISSUE_DATE],
        expirationDate = values[InputField.EXPIRATION_DATE],
        addressPostalCode = values[InputField.ADDRESS_POSTAL_CODE],
    )
    // The required members are never empty here: the form checks them first.
    is DatabaseBusinessStep -> DatabaseBusinessInputs(
        businessName = values[InputField.BUSINESS_NAME].orEmpty(),
        countryCode = values[InputField.COUNTRY_CODE].orEmpty(),
        registrationNumber = values[InputField.REGISTRATION_NUMBER],
        lei = values[InputField.LEI],
        addressStreet1 = values[InputField.ADDRESS_STREET_1],
        addressStreet2 = values[InputField.ADDRESS_STREET_2],
        addressCity = values[InputField.ADDRESS_CITY],
        addressSubdivision = values[InputField.ADDRESS_SUBDIVISION],
        addressPostalCode = values[InputField.ADDRESS_POSTAL_CODE],
        associatedPersons = persons.map { person ->
            AssociatedPersonInputs(
                nameFirst = person[PersonField.NAME_FIRST].orEmpty(),
                nameLast = person[PersonField.NAME_LAST].orEmpty(),
                birthdate = person[PersonField.BIRTHDATE]?.takeIf { it.isNotEmpty() },
            )
        }.takeIf { it.isNotEmpty() },
    )
    is BusinessWebsiteStep -> BusinessWebsiteInputs(
        websiteUrl = values[InputField.WEBSITE_URL].orEmpty(),
        businessName = values[InputField.BUSINESS_NAME],
    )
    else -> throw IllegalArgumentException("${step.type} is not a form step")
}

/**
 * The associated person a 422's JSON Pointer names, such as `/associated-persons/1/name-last`
 * (C52.3); `null` for any other member.
 */
internal fun personInputAt(pointer: String?): PersonInput? {
    val segments = pointer?.removePrefix("/data/attributes")?.split('/')?.drop(1) ?: return null
    if (segments.size != 3 || segments[0] != "associated-persons") return null
    val index = segments[1].toIntOrNull() ?: return null
    val field = PersonField.entries.firstOrNull { it.wireName == segments[2] } ?: return null
    return PersonInput(index, field)
}

/**
 * The field a 422's JSON Pointer names, such as `/birthdate` (C52.3); `null` for another member,
 * an associated person's included.
 */
internal fun inputFieldAt(pointer: String?): InputField? =
    pointer?.takeIf { personInputAt(it) == null }?.substringAfterLast('/')?.let(::inputFieldNamed)

private fun inputFieldNamed(name: String): InputField? = InputField.entries.firstOrNull { it.wireName == name }

/** The body member a database step's field is sent as (C52.3). */
internal fun DatabaseField.inputField(): InputField = when (this) {
    DatabaseField.NAME_FIRST -> InputField.NAME_FIRST
    DatabaseField.NAME_MIDDLE -> InputField.NAME_MIDDLE
    DatabaseField.NAME_LAST -> InputField.NAME_LAST
    DatabaseField.BIRTHDATE -> InputField.BIRTHDATE
    DatabaseField.ADDRESS_STREET_1 -> InputField.ADDRESS_STREET_1
    DatabaseField.ADDRESS_STREET_2 -> InputField.ADDRESS_STREET_2
    DatabaseField.ADDRESS_CITY -> InputField.ADDRESS_CITY
    DatabaseField.ADDRESS_SUBDIVISION -> InputField.ADDRESS_SUBDIVISION
    DatabaseField.ADDRESS_POSTAL_CODE -> InputField.ADDRESS_POSTAL_CODE
    DatabaseField.ADDRESS_COUNTRY_CODE -> InputField.ADDRESS_COUNTRY_CODE
    DatabaseField.IDENTIFICATION_NUMBER -> InputField.IDENTIFICATION_NUMBER
    DatabaseField.PHONE_NUMBER -> InputField.PHONE_NUMBER
    DatabaseField.EMAIL_ADDRESS -> InputField.EMAIL_ADDRESS
}

/** flow-spec `DATABASE_REQUIRED_FIELDS`: every database step collects them, and every body carries them. */
private val DATABASE_COLLECTED_ALWAYS = setOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.ADDRESS_COUNTRY_CODE)

/** C52.3 `aamvaInputsSchema`: a US driver's license or ID card as printed, in the order it is asked. */
internal val AAMVA_FORM_FIELDS: List<InputField> = listOf(
    InputField.NAME_FIRST,
    InputField.NAME_LAST,
    InputField.BIRTHDATE,
    InputField.IDENTIFICATION_NUMBER,
    InputField.ISSUING_AUTHORITY,
    InputField.ISSUE_DATE,
    InputField.EXPIRATION_DATE,
    InputField.ADDRESS_POSTAL_CODE,
)
private val AAMVA_FORM_REQUIRED: Set<InputField> = AAMVA_FORM_FIELDS.take(5).toSet()

/** C52.3 `databaseBusinessInputsSchema`: the business, its identifiers and its registered address, in order. */
internal val BUSINESS_FORM_FIELDS: List<InputField> = listOf(
    InputField.BUSINESS_NAME,
    InputField.COUNTRY_CODE,
    InputField.REGISTRATION_NUMBER,
    InputField.LEI,
    InputField.ADDRESS_STREET_1,
    InputField.ADDRESS_STREET_2,
    InputField.ADDRESS_CITY,
    InputField.ADDRESS_SUBDIVISION,
    InputField.ADDRESS_POSTAL_CODE,
)

/** The members every business body carries (its schema requires them). */
private val BUSINESS_REQUIRED: Set<InputField> = setOf(InputField.BUSINESS_NAME, InputField.COUNTRY_CODE)

/** C52.3 `businessWebsiteInputsSchema`: the URL, and the business's name if the user likes. */
internal val WEBSITE_FORM_FIELDS: List<InputField> = listOf(InputField.WEBSITE_URL, InputField.BUSINESS_NAME)

/**
 * The crypto wallet step's entry: the chains offered (the server's guidance, else the step's) that
 * this SDK knows, as only those can be sent (C57.1).
 */
internal fun cryptoState(
    step: CryptoWalletStep,
    verification: FlowVerification?,
    hints: List<RetryHint>,
    restarted: Boolean,
): FlowState.CryptoWallet {
    val chains = verification?.guidanceAs(CryptoWalletGuidance.serializer())?.chains ?: step.chains
    return FlowState.CryptoWallet(step, chains.filter(CryptoChains::isChainId), retryHints = hints, restarted = restarted)
}

/** Whether [destination] is where this channel's codes go: a phone number for a phone step. */
internal fun OtpChannel.takes(destination: OtpDestination): Boolean = when (this) {
    OtpChannel.PHONE -> destination is OtpDestination.Phone
    OtpChannel.EMAIL -> destination is OtpDestination.Email
}

/**
 * The open code a send answered with. A server that sends no guidance yet still sent a code, so
 * the screen shows one it knows nothing about: what it cannot read stays `null`.
 */
internal val UNDESCRIBED_CODE = OtpCode(maskedDestination = null, expiresAt = null, resendAvailableAt = null, sendsRemaining = null, attemptsRemaining = null)

internal fun OtpGuidanceState.toCode(): OtpCode =
    OtpCode(maskedDestination, parseInstant(expiresAt), parseInstant(resendAvailableAt), sendsRemaining, attemptsRemaining)

/** An RFC 3339 time from the server, or `null` when it cannot be read. */
internal fun parseInstant(value: String?): Instant? = value?.let {
    try {
        Instant.parse(it)
    } catch (_: IllegalArgumentException) {
        null
    }
}
