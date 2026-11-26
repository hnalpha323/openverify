package dev.openverify.sdk.model

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The C52.3 body contracts on the device (contracts `databaseInputsSchema`, `aamvaInputsSchema`):
 * each member's length, form and, for the AAMVA form, presence, as zod checks them on the server.
 */
class InputRulesTest {

    private val valid = DatabaseInputs(
        nameFirst = "Jane",
        nameMiddle = "Q",
        nameLast = "Example",
        birthdate = "1990-04-23",
        addressStreet1 = "1 Synthetic Way",
        addressStreet2 = "Unit 2",
        addressCity = "Utopia City",
        addressSubdivision = "UT",
        addressPostalCode = "00000",
        addressCountryCode = "US",
        identificationNumber = "000-00-0000",
        phoneNumber = "+15555550100",
        emailAddress = "jane.example@example.test",
    )

    private val card = AamvaInputs("Jane", "Example", "1990-04-23", "D1234567", "CA", "2020-01-31", "2028-01-31", "90001-1234")

    @Test
    fun aDatabaseBodyWithinItsContractHasNoProblem() {
        assertEquals(emptyMap(), InputRules.problems(valid))
        assertEquals(emptyMap(), InputRules.problems(DatabaseInputs()))
    }

    @Test
    fun eachDatabaseMemberHasItsLengthLimit() {
        val long = DatabaseInputs(
            nameFirst = "a".repeat(201),
            nameMiddle = "a".repeat(201),
            nameLast = "a".repeat(201),
            addressStreet1 = "a".repeat(201),
            addressStreet2 = "a".repeat(201),
            addressCity = "a".repeat(101),
            addressSubdivision = "a".repeat(101),
            addressPostalCode = "a".repeat(21),
            identificationNumber = "a".repeat(65),
            emailAddress = "a".repeat(243) + "@example.test",
        )
        val atLimit = DatabaseInputs(
            nameFirst = "a".repeat(200),
            addressStreet1 = "a".repeat(200),
            addressCity = "a".repeat(100),
            addressSubdivision = "a".repeat(100),
            addressPostalCode = "a".repeat(20),
            identificationNumber = "a".repeat(64),
            emailAddress = "a".repeat(241) + "@example.test",
        )

        assertEquals(
            listOf(
                InputField.NAME_FIRST, InputField.NAME_MIDDLE, InputField.NAME_LAST, InputField.ADDRESS_STREET_1,
                InputField.ADDRESS_STREET_2, InputField.ADDRESS_CITY, InputField.ADDRESS_SUBDIVISION,
                InputField.ADDRESS_POSTAL_CODE, InputField.IDENTIFICATION_NUMBER, InputField.EMAIL_ADDRESS,
            ).associateWith { InputProblem.TOO_LONG },
            InputRules.problems(long),
        )
        assertEquals(emptyMap(), InputRules.problems(atLimit))
    }

    @Test
    fun anEmptyMemberIsMissingRatherThanSentEmpty() {
        assertEquals(
            mapOf(InputField.NAME_FIRST to InputProblem.MISSING, InputField.ADDRESS_CITY to InputProblem.MISSING),
            InputRules.problems(DatabaseInputs(nameFirst = "", addressCity = "")),
        )
    }

    @Test
    fun aBirthdateIsADayThatExistsInTheGregorianCalendar() {
        for (date in listOf("2000-02-29", "2024-02-29", "1600-02-29", "1990-12-31", "1990-04-30", "0001-01-01")) {
            assertEquals(emptyMap(), InputRules.problems(DatabaseInputs(birthdate = date)), date)
        }
        for (date in listOf("1900-02-29", "2023-02-29", "1990-04-31", "1990-13-01", "1990-00-10", "1990-01-00", "1990-1-5", "90-01-05", "1990/01/05", "1990-01-05T00:00:00Z", "")) {
            val problem = if (date.isEmpty()) InputProblem.MISSING else InputProblem.INVALID
            assertEquals(mapOf(InputField.BIRTHDATE to problem), InputRules.problems(DatabaseInputs(birthdate = date)), date)
        }
    }

    @Test
    fun aPhoneNumberIsE164() {
        for (number in listOf("+15555550100", "+4420794600", "+123456789012345")) {
            assertEquals(emptyMap(), InputRules.problems(DatabaseInputs(phoneNumber = number)), number)
        }
        for (number in listOf("15555550100", "+05555550100", "+1 555 555 0100", "+123456", "+1234567890123456", "+1555555010a")) {
            assertEquals(mapOf(InputField.PHONE_NUMBER to InputProblem.INVALID), InputRules.problems(DatabaseInputs(phoneNumber = number)), number)
        }
    }

    @Test
    fun anEmailAddressIsOfTheFormZodAccepts() {
        for (address in listOf("jane@example.test", "jane.q.example+tag@mail.example.test", "o'neil@example.co", "a_b-c@sub-domain.example.org")) {
            assertEquals(emptyMap(), InputRules.problems(DatabaseInputs(emailAddress = address)), address)
        }
        for (address in listOf("jane", "jane@", "@example.test", "jane@example", "jane..q@example.test", ".jane@example.test", "jane@-example.test", "jane@example.t", "jané@example.test")) {
            assertEquals(mapOf(InputField.EMAIL_ADDRESS to InputProblem.INVALID), InputRules.problems(DatabaseInputs(emailAddress = address)), address)
        }
    }

    @Test
    fun aCountryIsTwoCapitalLetters() {
        for (code in listOf("us", "USA", "U", "1A")) {
            assertEquals(mapOf(InputField.ADDRESS_COUNTRY_CODE to InputProblem.INVALID), InputRules.problems(DatabaseInputs(addressCountryCode = code)), code)
        }
    }

    @Test
    fun anAamvaCardWithinItsContractHasNoProblem() {
        assertEquals(emptyMap(), InputRules.problems(card))
        assertEquals(emptyMap(), InputRules.problems(AamvaInputs("Jane", "Example", "1990-04-23", "D1234567", "VI")))
    }

    @Test
    fun anAamvaCardNeedsItsNamesBirthdateNumberAndIssuer() {
        assertEquals(
            listOf(
                InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.IDENTIFICATION_NUMBER,
                InputField.ISSUING_AUTHORITY,
            ).associateWith { InputProblem.MISSING },
            InputRules.problems(AamvaInputs("", "", "", "", "")),
        )
    }

    @Test
    fun anAamvaIssuerIsAUsJurisdictionAndItsDatesAndZipHaveTheirForms() {
        assertEquals(
            mapOf(
                InputField.ISSUING_AUTHORITY to InputProblem.INVALID,
                InputField.ISSUE_DATE to InputProblem.INVALID,
                InputField.EXPIRATION_DATE to InputProblem.INVALID,
                InputField.ADDRESS_POSTAL_CODE to InputProblem.INVALID,
            ),
            InputRules.problems(card.copy(issuingAuthority = "ON", issueDate = "2020-02-30", expirationDate = "2028/01/31", addressPostalCode = "9000")),
        )
        for (zip in listOf("90001", "90001-1234")) assertEquals(emptyMap(), InputRules.problems(card.copy(addressPostalCode = zip)), zip)
        for (zip in listOf("900011", "90001-123", "ABCDE", "90001 1234")) {
            assertEquals(mapOf(InputField.ADDRESS_POSTAL_CODE to InputProblem.INVALID), InputRules.problems(card.copy(addressPostalCode = zip)), zip)
        }
    }

    @Test
    fun anAamvaNameAndNumberHaveTheirLengthLimits() {
        assertEquals(
            mapOf(
                InputField.NAME_FIRST to InputProblem.TOO_LONG,
                InputField.NAME_LAST to InputProblem.TOO_LONG,
                InputField.IDENTIFICATION_NUMBER to InputProblem.TOO_LONG,
            ),
            InputRules.problems(card.copy(nameFirst = "a".repeat(201), nameLast = "a".repeat(201), identificationNumber = "a".repeat(65))),
        )
    }
}
