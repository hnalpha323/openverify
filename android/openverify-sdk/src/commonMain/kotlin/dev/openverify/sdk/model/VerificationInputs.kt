package dev.openverify.sdk.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The values a user enters for a form type, sent to `POST /api/v1/flow/verifications/:id/inputs`
 * (C52.3, contracts `flowInputsBodySchema`). Members are kebab-case; an absent one is left out of
 * the body. The values are personal data: the server seals them and never echoes them, and they
 * never print (C53.8).
 */
internal sealed interface VerificationInputs

/** C52.3: a database step's values (contracts `databaseInputsSchema`); the step decides which it takes. */
@Serializable
internal data class DatabaseInputs(
    @SerialName("name-first") val nameFirst: String? = null,
    @SerialName("name-middle") val nameMiddle: String? = null,
    @SerialName("name-last") val nameLast: String? = null,
    /** `YYYY-MM-DD`. */
    val birthdate: String? = null,
    @SerialName("address-street-1") val addressStreet1: String? = null,
    @SerialName("address-street-2") val addressStreet2: String? = null,
    @SerialName("address-city") val addressCity: String? = null,
    @SerialName("address-subdivision") val addressSubdivision: String? = null,
    @SerialName("address-postal-code") val addressPostalCode: String? = null,
    /** ISO 3166-1 alpha-2. */
    @SerialName("address-country-code") val addressCountryCode: String? = null,
    @SerialName("identification-number") val identificationNumber: String? = null,
    /** E.164. */
    @SerialName("phone-number") val phoneNumber: String? = null,
    @SerialName("email-address") val emailAddress: String? = null,
) : VerificationInputs {
    /** Which members were entered, never their values. */
    override fun toString(): String {
        val entered = listOf(
            "name-first" to nameFirst,
            "name-middle" to nameMiddle,
            "name-last" to nameLast,
            "birthdate" to birthdate,
            "address-street-1" to addressStreet1,
            "address-street-2" to addressStreet2,
            "address-city" to addressCity,
            "address-subdivision" to addressSubdivision,
            "address-postal-code" to addressPostalCode,
            "address-country-code" to addressCountryCode,
            "identification-number" to identificationNumber,
            "phone-number" to phoneNumber,
            "email-address" to emailAddress,
        ).filter { it.second != null }.map { it.first }
        return "DatabaseInputs(entered=$entered, values=<redacted>)"
    }
}

/** C52.3: the AAMVA form, a US driver's license or ID card as printed (contracts `aamvaInputsSchema`). */
@Serializable
internal data class AamvaInputs(
    @SerialName("name-first") val nameFirst: String,
    @SerialName("name-last") val nameLast: String,
    /** `YYYY-MM-DD`. */
    val birthdate: String,
    @SerialName("identification-number") val identificationNumber: String,
    /** A US state or territory code ([US_JURISDICTIONS]). */
    @SerialName("issuing-authority") val issuingAuthority: String,
    @SerialName("issue-date") val issueDate: String? = null,
    @SerialName("expiration-date") val expirationDate: String? = null,
    /** A ZIP code, `12345` or `12345-6789`. */
    @SerialName("address-postal-code") val addressPostalCode: String? = null,
) : VerificationInputs {
    override fun toString(): String = "AamvaInputs(values=<redacted>)"
}

/**
 * C52.3: a business to look up in business registers (contracts `databaseBusinessInputsSchema`).
 * The registration number must be in the format of the register of [countryCode], and an LEI's
 * check digits must hold (ISO 17442); [associatedPersons] only when the step collects them.
 */
@Serializable
internal data class DatabaseBusinessInputs(
    @SerialName("business-name") val businessName: String,
    /** ISO 3166-1 alpha-2: where the business is registered. */
    @SerialName("country-code") val countryCode: String,
    @SerialName("registration-number") val registrationNumber: String? = null,
    val lei: String? = null,
    @SerialName("address-street-1") val addressStreet1: String? = null,
    @SerialName("address-street-2") val addressStreet2: String? = null,
    @SerialName("address-city") val addressCity: String? = null,
    @SerialName("address-subdivision") val addressSubdivision: String? = null,
    @SerialName("address-postal-code") val addressPostalCode: String? = null,
    /** Up to [MAX_ASSOCIATED_PERSONS] officers or owners; `null` sends none. */
    @SerialName("associated-persons") val associatedPersons: List<AssociatedPersonInputs>? = null,
) : VerificationInputs {
    override fun toString(): String =
        "DatabaseBusinessInputs(values=<redacted>, associatedPersons=${associatedPersons?.size ?: 0})"

    public companion object {
        /** C52.3 `MAX_ASSOCIATED_PERSONS`. */
        public const val MAX_ASSOCIATED_PERSONS: Int = 10
    }
}

/** C52.3: an associated person: their names, and their birth month (`YYYY-MM`) or date. */
@Serializable
internal data class AssociatedPersonInputs(
    @SerialName("name-first") val nameFirst: String,
    @SerialName("name-last") val nameLast: String,
    val birthdate: String? = null,
) {
    override fun toString(): String = "AssociatedPersonInputs(values=<redacted>)"
}

/**
 * C52.3: a business website (contracts `businessWebsiteInputsSchema`): an `http` or `https` URL of a
 * named host on port 80 or 443, without credentials. The site itself is never opened (C61.3).
 */
@Serializable
internal data class BusinessWebsiteInputs(
    @SerialName("website-url") val websiteUrl: String,
    @SerialName("business-name") val businessName: String? = null,
) : VerificationInputs {
    override fun toString(): String = "BusinessWebsiteInputs(values=<redacted>)"
}

/**
 * The US states, the District of Columbia and the territories: the AAMVA issuing authorities, in
 * the contracts' `US_JURISDICTIONS` order.
 */
internal val US_JURISDICTIONS: List<String> = listOf(
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
    "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
    "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "AS", "GU", "MP", "PR", "VI",
)
