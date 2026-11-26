package dev.openverify.sdk.model

/**
 * A member of an entered-values body (C52.3), named as the body names it. The database and AAMVA
 * forms show them; a 422's JSON Pointer names one.
 */
internal enum class InputField(val wireName: String) {
    NAME_FIRST("name-first"),
    NAME_MIDDLE("name-middle"),
    NAME_LAST("name-last"),
    BIRTHDATE("birthdate"),
    ADDRESS_STREET_1("address-street-1"),
    ADDRESS_STREET_2("address-street-2"),
    ADDRESS_CITY("address-city"),
    ADDRESS_SUBDIVISION("address-subdivision"),
    ADDRESS_POSTAL_CODE("address-postal-code"),
    ADDRESS_COUNTRY_CODE("address-country-code"),
    IDENTIFICATION_NUMBER("identification-number"),
    PHONE_NUMBER("phone-number"),
    EMAIL_ADDRESS("email-address"),
    ISSUING_AUTHORITY("issuing-authority"),
    ISSUE_DATE("issue-date"),
    EXPIRATION_DATE("expiration-date"),

    // The business registry and website bodies (C52.3, C61).
    BUSINESS_NAME("business-name"),
    COUNTRY_CODE("country-code"),
    REGISTRATION_NUMBER("registration-number"),
    LEI("lei"),
    WEBSITE_URL("website-url"),
}

/** A member of an associated person in a business body (C52.3), named as the body names it. */
internal enum class PersonField(val wireName: String) {
    NAME_FIRST("name-first"),
    NAME_LAST("name-last"),
    BIRTHDATE("birthdate"),
}

/** The person at [index] of a business body's `associated-persons`, and their [field]. */
internal data class PersonInput(val index: Int, val field: PersonField)

/** Why a value breaks the body's contract (C52.3). */
internal enum class InputProblem {
    /** The member must be present and is empty. */
    MISSING,

    /** The value is not of the member's form, such as a date that does not exist. */
    INVALID,

    /** The value is longer than the member allows. */
    TOO_LONG,

    /**
     * The server refused the value (a 422 pointer, C52.3) for a reason the device does not check,
     * such as a field the step requires or a rule of its own.
     */
    REFUSED,
}

/**
 * The C52.3 body contracts (contracts `databaseInputsSchema`, `aamvaInputsSchema`,
 * `databaseBusinessInputsSchema` and `businessWebsiteInputsSchema`), checked on the device so a
 * form says what to fix before anything is sent. The server checks them again, with the step's own
 * rules, and answers 422 with a JSON Pointer per member; where the device cannot read a value the
 * way the server does (a website URL), it is looser, never stricter.
 */
internal object InputRules {
    /** Each member of [inputs] that breaks its contract, with why. */
    fun problems(inputs: VerificationInputs): Map<InputField, InputProblem> = when (inputs) {
        is DatabaseInputs -> database(inputs)
        is AamvaInputs -> aamva(inputs)
        is DatabaseBusinessInputs -> business(inputs)
        is BusinessWebsiteInputs -> website(inputs)
    }

    /** Each associated person's member of [inputs] that breaks its contract, with why (C52.3). */
    fun personProblems(inputs: DatabaseBusinessInputs): Map<PersonInput, InputProblem> = buildMap {
        inputs.associatedPersons.orEmpty().forEachIndexed { index, person ->
            rule(PersonInput(index, PersonField.NAME_FIRST), person.nameFirst, max = NAME_MAX)
            rule(PersonInput(index, PersonField.NAME_LAST), person.nameLast, max = NAME_MAX)
            rule(PersonInput(index, PersonField.BIRTHDATE), person.birthdate, form = { isIsoDate(it) || BIRTH_MONTH.matches(it) })
        }
    }

    private fun database(inputs: DatabaseInputs): Map<InputField, InputProblem> = buildMap {
        rule(InputField.NAME_FIRST, inputs.nameFirst, max = NAME_MAX)
        rule(InputField.NAME_MIDDLE, inputs.nameMiddle, max = NAME_MAX)
        rule(InputField.NAME_LAST, inputs.nameLast, max = NAME_MAX)
        rule(InputField.BIRTHDATE, inputs.birthdate, form = ::isIsoDate)
        rule(InputField.ADDRESS_STREET_1, inputs.addressStreet1, max = STREET_MAX)
        rule(InputField.ADDRESS_STREET_2, inputs.addressStreet2, max = STREET_MAX)
        rule(InputField.ADDRESS_CITY, inputs.addressCity, max = CITY_MAX)
        rule(InputField.ADDRESS_SUBDIVISION, inputs.addressSubdivision, max = SUBDIVISION_MAX)
        rule(InputField.ADDRESS_POSTAL_CODE, inputs.addressPostalCode, max = POSTAL_CODE_MAX)
        rule(InputField.ADDRESS_COUNTRY_CODE, inputs.addressCountryCode, form = COUNTRY_CODE::matches)
        rule(InputField.IDENTIFICATION_NUMBER, inputs.identificationNumber, max = IDENTIFICATION_NUMBER_MAX)
        rule(InputField.PHONE_NUMBER, inputs.phoneNumber, form = E164::matches)
        rule(InputField.EMAIL_ADDRESS, inputs.emailAddress, max = EMAIL_MAX, form = EMAIL::matches)
    }

    private fun aamva(inputs: AamvaInputs): Map<InputField, InputProblem> = buildMap {
        rule(InputField.NAME_FIRST, inputs.nameFirst, max = NAME_MAX)
        rule(InputField.NAME_LAST, inputs.nameLast, max = NAME_MAX)
        rule(InputField.BIRTHDATE, inputs.birthdate, form = ::isIsoDate)
        rule(InputField.IDENTIFICATION_NUMBER, inputs.identificationNumber, max = IDENTIFICATION_NUMBER_MAX)
        rule(InputField.ISSUING_AUTHORITY, inputs.issuingAuthority, form = { it in US_JURISDICTIONS })
        rule(InputField.ISSUE_DATE, inputs.issueDate, form = ::isIsoDate)
        rule(InputField.EXPIRATION_DATE, inputs.expirationDate, form = ::isIsoDate)
        rule(InputField.ADDRESS_POSTAL_CODE, inputs.addressPostalCode, form = ZIP_CODE::matches)
    }

    private fun business(inputs: DatabaseBusinessInputs): Map<InputField, InputProblem> = buildMap {
        val country = inputs.countryCode
        rule(InputField.BUSINESS_NAME, inputs.businessName, max = BUSINESS_NAME_MAX)
        rule(InputField.COUNTRY_CODE, country, form = COUNTRY_CODE::matches)
        // The register's format is read only once the country is one: the server reads it the same.
        rule(InputField.REGISTRATION_NUMBER, inputs.registrationNumber, max = REGISTRATION_NUMBER_MAX, form = { number ->
            !COUNTRY_CODE.matches(country) || registrationNumberAccepted(country, number)
        })
        rule(InputField.LEI, inputs.lei, form = ::isLei)
        rule(InputField.ADDRESS_STREET_1, inputs.addressStreet1, max = STREET_MAX)
        rule(InputField.ADDRESS_STREET_2, inputs.addressStreet2, max = STREET_MAX)
        rule(InputField.ADDRESS_CITY, inputs.addressCity, max = CITY_MAX)
        rule(InputField.ADDRESS_SUBDIVISION, inputs.addressSubdivision, max = SUBDIVISION_MAX)
        rule(InputField.ADDRESS_POSTAL_CODE, inputs.addressPostalCode, max = POSTAL_CODE_MAX)
    }

    private fun website(inputs: BusinessWebsiteInputs): Map<InputField, InputProblem> = buildMap {
        rule(InputField.WEBSITE_URL, inputs.websiteUrl, max = WEBSITE_URL_MAX, form = ::isAcceptableWebsiteUrl)
        rule(InputField.BUSINESS_NAME, inputs.businessName, max = BUSINESS_NAME_MAX)
    }

    /** Adds [field]'s problem, if any: an absent value has none, an empty one is missing. */
    private fun <K> MutableMap<K, InputProblem>.rule(
        field: K,
        value: String?,
        max: Int? = null,
        form: ((String) -> Boolean)? = null,
    ) {
        val problem = when {
            value == null -> null
            value.isEmpty() -> InputProblem.MISSING
            max != null && value.length > max -> InputProblem.TOO_LONG
            form != null && !form(value) -> InputProblem.INVALID
            else -> null
        }
        if (problem != null) put(field, problem)
    }

    // The C52.3 bounds (contracts `verification-inputs.ts`); lengths count UTF-16 units, as zod does.
    private const val NAME_MAX = 200
    private const val STREET_MAX = 200
    private const val CITY_MAX = 100
    private const val SUBDIVISION_MAX = 100
    private const val POSTAL_CODE_MAX = 20
    private const val IDENTIFICATION_NUMBER_MAX = 64
    private const val EMAIL_MAX = 254
    private const val BUSINESS_NAME_MAX = 300
    private const val REGISTRATION_NUMBER_MAX = 20

    /** contracts `MAX_WEBSITE_URL_LENGTH`. */
    private const val WEBSITE_URL_MAX = 2048

    /** A birth month, `YYYY-MM`, as an associated person's `birthdate` may be (C52.3). */
    private val BIRTH_MONTH = Regex("[0-9]{4}-(?:0[1-9]|1[0-2])")

    /** flow-spec `countryCodeSchema`: ISO 3166-1 alpha-2. */
    private val COUNTRY_CODE = Regex("[A-Z]{2}")

    /** E.164: a plus, then up to 15 digits with no leading zero. */
    private val E164 = Regex("\\+[1-9][0-9]{6,14}")

    /** A US ZIP code, `12345` or `12345-6789`. */
    private val ZIP_CODE = Regex("[0-9]{5}(?:-[0-9]{4})?")

    /** zod 4.6.7's `z.email()` pattern, which the server applies. */
    private val EMAIL = Regex("(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}")
}

/**
 * contracts `registrationNumberAccepted`: [number] in the format of the register that covers
 * [country]: Companies House for GB (8 digits, or 2 letters and 6 digits), a numeric CIK of up to
 * 10 digits for SEC EDGAR (US), otherwise up to 20 letters and digits.
 */
internal fun registrationNumberAccepted(country: String, number: String): Boolean = when (country) {
    "GB" -> Regex("[0-9]{8}|[A-Z]{2}[0-9]{6}").matches(number)
    "US" -> Regex("[0-9]{1,10}").matches(number)
    else -> Regex("[A-Za-z0-9]{1,20}").matches(number)
}

/** contracts `isLei` (ISO 17442): 18 upper-case letters and digits, then ISO 7064 MOD 97-10 check digits. */
internal fun isLei(value: String): Boolean {
    if (!Regex("[A-Z0-9]{18}[0-9]{2}").matches(value)) return false
    var remainder = 0
    for (character in value) {
        for (digit in character.digitToInt(36).toString()) {
            remainder = (remainder * 10 + digit.digitToInt()) % 97
        }
    }
    return remainder == 1
}

private val IPV4 = Regex("[0-9]+(?:\\.[0-9]+){3}")
private val PERCENT_ESCAPE = Regex("%([0-9A-Fa-f]{2})")

/**
 * contracts `isAcceptableWebsiteUrl`, as the device can read it without a WHATWG URL parser: an
 * `http` or `https` URL (any case, its slashes optional as WHATWG reads a special scheme) of a
 * named host with a dot that neither starts nor ends it, not an IPv4 or IPv6 literal, without
 * credentials, on port 80 or 443 or the scheme's own. Where the readings differ (a host written as
 * a hexadecimal IPv4 address), the device accepts and the server's 422 says so: never stricter.
 */
internal fun isAcceptableWebsiteUrl(value: String): Boolean {
    val colon = value.indexOf(':')
    if (colon < 0) return false
    val scheme = value.substring(0, colon).lowercase()
    if (scheme != "http" && scheme != "https") return false
    val rest = value.substring(colon + 1).trimStart('/', '\\')
    val end = rest.indexOfAny(charArrayOf('/', '\\', '?', '#')).let { if (it < 0) rest.length else it }
    val authority = rest.substring(0, end)
    if ('@' in authority || authority.startsWith('[')) return false
    val portAt = authority.lastIndexOf(':')
    val port = if (portAt < 0) "" else authority.substring(portAt + 1)
    if (port.isNotEmpty() && (!port.all { it in '0'..'9' } || port.toIntOrNull() !in setOf(80, 443))) return false
    val host = PERCENT_ESCAPE.replace(if (portAt < 0) authority else authority.substring(0, portAt)) {
        it.groupValues[1].toInt(16).toChar().toString()
    }
    return '.' in host && !host.startsWith('.') && !host.endsWith('.') && !IPV4.matches(host)
}

private val ISO_DATE = Regex("([0-9]{4})-([0-9]{2})-([0-9]{2})")

/** Whether [value] is a `YYYY-MM-DD` day of the Gregorian calendar, as zod's `z.iso.date()` reads it. */
internal fun isIsoDate(value: String): Boolean {
    val (year, month, day) = ISO_DATE.matchEntire(value)?.destructured?.let { (y, m, d) -> Triple(y.toInt(), m.toInt(), d.toInt()) }
        ?: return false
    if (month !in 1..12 || day < 1) return false
    val leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
    val days = when (month) {
        2 -> if (leap) 29 else 28
        4, 6, 9, 11 -> 30
        else -> 31
    }
    return day <= days
}
