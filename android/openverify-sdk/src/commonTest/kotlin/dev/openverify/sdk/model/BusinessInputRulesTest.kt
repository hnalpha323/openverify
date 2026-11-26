package dev.openverify.sdk.model

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The C52.3 business registry and business website bodies on the device (contracts
 * `databaseBusinessInputsSchema`, `businessWebsiteInputsSchema`): each member's length and form, a
 * registration number in the format of the chosen country's register, an LEI's check digits, the
 * associated persons, and a website URL as the server reads it. The device is never stricter than
 * the server, which checks everything again. Every value is synthetic.
 */
class BusinessInputRulesTest {

    /**
     * A synthetic LEI (ISO 17442): 18 invented characters and the ISO 7064 MOD 97-10 check digits
     * that make it valid; it names no registered entity.
     */
    private fun syntheticLei(base: String = "OPENVERIFYSYNTH001"): String {
        var remainder = 0
        for (character in base + "00") {
            for (digit in character.digitToInt(36).toString()) {
                remainder = (remainder * 10 + digit.digitToInt()) % 97
            }
        }
        return base + (98 - remainder).toString().padStart(2, '0')
    }

    private val business = DatabaseBusinessInputs(
        businessName = "Example Widgets Ltd",
        countryCode = "GB",
        registrationNumber = "01234567",
        lei = syntheticLei(),
        addressStreet1 = "1 Synthetic Way",
        addressStreet2 = "Unit 2",
        addressCity = "Exampleton",
        addressSubdivision = "Utopia",
        addressPostalCode = "EX1 1AA",
    )

    @Test
    fun aBusinessBodyWithinItsContractHasNoProblem() {
        assertEquals(emptyMap(), InputRules.problems(business))
        assertEquals(emptyMap(), InputRules.problems(DatabaseBusinessInputs("Example Widgets Ltd", "FR")))
    }

    @Test
    fun eachBusinessMemberHasItsLengthLimit() {
        val long = business.copy(
            businessName = "a".repeat(301),
            addressStreet1 = "a".repeat(201),
            addressStreet2 = "a".repeat(201),
            addressCity = "a".repeat(101),
            addressSubdivision = "a".repeat(101),
            addressPostalCode = "a".repeat(21),
        )

        assertEquals(
            listOf(
                InputField.BUSINESS_NAME, InputField.ADDRESS_STREET_1, InputField.ADDRESS_STREET_2, InputField.ADDRESS_CITY,
                InputField.ADDRESS_SUBDIVISION, InputField.ADDRESS_POSTAL_CODE,
            ).associateWith { InputProblem.TOO_LONG },
            InputRules.problems(long),
        )
        assertEquals(emptyMap(), InputRules.problems(business.copy(businessName = "a".repeat(300))))
    }

    @Test
    fun anEmptyBusinessMemberIsMissing() {
        assertEquals(
            mapOf(InputField.BUSINESS_NAME to InputProblem.MISSING, InputField.COUNTRY_CODE to InputProblem.MISSING),
            InputRules.problems(DatabaseBusinessInputs("", "")),
        )
    }

    @Test
    fun theCountryIsAnIsoAlpha2Code() {
        for (country in listOf("gb", "GBR", "G1")) {
            assertEquals(
                mapOf(InputField.COUNTRY_CODE to InputProblem.INVALID),
                InputRules.problems(DatabaseBusinessInputs("Example Widgets Ltd", country)),
                country,
            )
        }
    }

    @Test
    fun aRegistrationNumberIsInTheFormatOfTheChosenCountrysRegister() {
        val accepted = listOf("GB" to "01234567", "GB" to "SC123456", "US" to "12345", "US" to "1234567890", "FR" to "AB12", "DE" to "A".repeat(20))
        val refused = listOf("GB" to "sc123456", "GB" to "1234567", "US" to "12A", "US" to "12345678901", "FR" to "AB 12", "DE" to "AB-12")
        for ((country, number) in accepted) {
            assertEquals(emptyMap(), InputRules.problems(DatabaseBusinessInputs("Example Widgets Ltd", country, registrationNumber = number)), "$country $number")
        }
        for ((country, number) in refused) {
            assertEquals(
                mapOf(InputField.REGISTRATION_NUMBER to InputProblem.INVALID),
                InputRules.problems(DatabaseBusinessInputs("Example Widgets Ltd", country, registrationNumber = number)),
                "$country $number",
            )
        }
        assertEquals(
            mapOf(InputField.REGISTRATION_NUMBER to InputProblem.TOO_LONG),
            InputRules.problems(DatabaseBusinessInputs("Example Widgets Ltd", "DE", registrationNumber = "A".repeat(21))),
        )
    }

    @Test
    fun anLeiHasTwentyCharactersAndItsCheckDigits() {
        val lei = syntheticLei()
        val wrongDigits = lei.dropLast(1) + if (lei.last() == '0') '1' else '0'
        for (refused in listOf(wrongDigits, lei.dropLast(1), lei.lowercase(), lei + "0")) {
            assertEquals(
                mapOf(InputField.LEI to InputProblem.INVALID),
                InputRules.problems(DatabaseBusinessInputs("Example Widgets Ltd", "FR", lei = refused)),
                refused,
            )
        }
        assertEquals(emptyMap(), InputRules.problems(DatabaseBusinessInputs("Example Widgets Ltd", "FR", lei = lei)))
    }

    @Test
    fun eachAssociatedPersonHasNamesAndABirthMonthOrDate() {
        val persons = DatabaseBusinessInputs(
            "Example Widgets Ltd",
            "GB",
            associatedPersons = listOf(
                AssociatedPersonInputs("Robin", "Sample", "1980-04"),
                AssociatedPersonInputs("Casey", "Placeholder", "1980-04-23"),
                AssociatedPersonInputs("", "a".repeat(201), "1980-13"),
                AssociatedPersonInputs("Alex", "Example", "04/1980"),
                AssociatedPersonInputs("Alex", "Example", "1980-02-30"),
            ),
        )

        assertEquals(emptyMap(), InputRules.problems(persons))
        assertEquals(
            mapOf(
                PersonInput(2, PersonField.NAME_FIRST) to InputProblem.MISSING,
                PersonInput(2, PersonField.NAME_LAST) to InputProblem.TOO_LONG,
                PersonInput(2, PersonField.BIRTHDATE) to InputProblem.INVALID,
                PersonInput(3, PersonField.BIRTHDATE) to InputProblem.INVALID,
                PersonInput(4, PersonField.BIRTHDATE) to InputProblem.INVALID,
            ),
            InputRules.personProblems(persons),
        )
    }

    @Test
    fun aWebsiteIsAnHttpOrHttpsUrlOfANamedHostOnAWebPort() {
        val accepted = listOf(
            "https://www.example.com",
            "http://example.com",
            "https://shop.example.com/about?lang=en#top",
            "http://example.com:443/",
            "https://example.com:80",
            "HTTPS://WWW.EXAMPLE.COM",
            // WHATWG URL reading, as the server's: a special scheme may omit its slashes.
            "https:example.com",
            "https://example.com/a b",
        )
        val refused = listOf(
            "www.example.com",
            "ftp://example.com",
            "https://user:secret@example.com",
            "https://user@example.com",
            "https://192.0.2.1",
            "https://[2001:db8::1]",
            "https://localhost",
            "https://www.example.com:8443",
            "https://.example.com",
            "https://example.com.",
            "https://",
        )
        for (url in accepted) {
            assertEquals(emptyMap(), InputRules.problems(BusinessWebsiteInputs(url)), url)
        }
        for (url in refused) {
            assertEquals(mapOf(InputField.WEBSITE_URL to InputProblem.INVALID), InputRules.problems(BusinessWebsiteInputs(url)), url)
        }
        assertEquals(
            mapOf(InputField.WEBSITE_URL to InputProblem.TOO_LONG),
            InputRules.problems(BusinessWebsiteInputs("https://example.com/" + "a".repeat(2049))),
        )
        assertEquals(
            mapOf(InputField.BUSINESS_NAME to InputProblem.TOO_LONG),
            InputRules.problems(BusinessWebsiteInputs("https://example.com", businessName = "a".repeat(301))),
        )
        assertEquals(mapOf(InputField.WEBSITE_URL to InputProblem.MISSING), InputRules.problems(BusinessWebsiteInputs("")))
    }
}
