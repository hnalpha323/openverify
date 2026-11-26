package dev.openverify.sdk.mrz

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource

/**
 * Worked examples come from ICAO Doc 9303, Eighth Edition (2021), Part 11, Appendix D.2
 * ("Derivation of Document Basic Access Keys"). All of it is ICAO specimen data.
 */
class BacKeySeedTest {

    @Test
    fun `Part 11 D-2 - 9-character document number is padded with a filler`() {
        // Document number "L898902C<" (check digit 3), DOB 690806 (1), DOE 940623 (6).
        assertEquals(
            "L898902C<369080619406236",
            BacKeySeed.mrzInformation(documentNumber = "L898902C", dateOfBirth = "690806", dateOfExpiry = "940623"),
        )
    }

    @Test
    fun `document number already padded as it appears in the MRZ gives the same result`() {
        assertEquals(
            "L898902C<369080619406236",
            BacKeySeed.mrzInformation(documentNumber = "L898902C<", dateOfBirth = "690806", dateOfExpiry = "940623"),
        )
    }

    @Test
    fun `Part 11 D-2 - document number longer than 9 characters is used in full`() {
        // Document number "D23145890734" (check digit 9), DOB 340712 (7), DOE 950712 (2).
        assertEquals(
            "D23145890734934071279507122",
            BacKeySeed.mrzInformation(documentNumber = "D23145890734", dateOfBirth = "340712", dateOfExpiry = "950712"),
        )
    }

    @Test
    fun `unknown parts of the date of birth are fillers that count as zero`() {
        // Part 3 section 4.8: unknown date-of-birth positions are filled with '<'.
        assertEquals(
            "L898902C<369<<<<99406236",
            BacKeySeed.mrzInformation(documentNumber = "L898902C", dateOfBirth = "69<<<<", dateOfExpiry = "940623"),
        )
    }

    @Test
    fun `rejects an empty document number`() {
        assertThrows<IllegalArgumentException> {
            BacKeySeed.mrzInformation(documentNumber = "", dateOfBirth = "690806", dateOfExpiry = "940623")
        }
    }

    @Test
    fun `rejects a document number with characters outside the MRZ character set`() {
        assertThrows<IllegalArgumentException> {
            BacKeySeed.mrzInformation(documentNumber = "l898902c", dateOfBirth = "690806", dateOfExpiry = "940623")
        }
    }

    @ParameterizedTest(name = "rejects date of birth \"{0}\" / date of expiry \"{1}\"")
    @CsvSource(
        value = [
            "69080, 940623", // too short
            "6908061, 940623", // too long
            "69O806, 940623", // letter O, not zero
            "690806, 94062", // too short
            "690806, 9406A3", // letter
            "690806, 94-623", // punctuation
        ],
    )
    fun `rejects dates that are not 6 MRZ date characters`(dateOfBirth: String, dateOfExpiry: String) {
        assertThrows<IllegalArgumentException> {
            BacKeySeed.mrzInformation(documentNumber = "L898902C", dateOfBirth = dateOfBirth, dateOfExpiry = dateOfExpiry)
        }
    }

    @Test
    fun `error message does not echo the date, which is PII`() {
        val error = assertThrows<IllegalArgumentException> {
            BacKeySeed.mrzInformation(documentNumber = "L898902C", dateOfBirth = "69080", dateOfExpiry = "940623")
        }

        assertFalse(error.message.orEmpty().contains("69080"), "message leaked the input: ${error.message}")
    }
}
