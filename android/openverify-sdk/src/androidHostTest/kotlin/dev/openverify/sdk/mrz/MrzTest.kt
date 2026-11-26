package dev.openverify.sdk.mrz

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource

/**
 * Test vectors come from ICAO Doc 9303, Eighth Edition (2021), Part 3, Appendix A
 * ("Examples of check digit calculation"). All of it is ICAO specimen data.
 */
class MrzTest {

    @Test
    fun `Part 3 Example 1 - date 520727 has check digit 3`() {
        assertEquals(3, Mrz.checkDigit("520727"))
    }

    @Test
    fun `Part 3 Example 2 - document number AB2134 padded with fillers has check digit 5`() {
        assertEquals(5, Mrz.checkDigit("AB2134<<<"))
    }

    @ParameterizedTest(name = "\"{0}\" has check digit {1}")
    @CsvSource(
        value = [
            // Example 3 TD3 lower line: document number, date of birth, date of expiry, personal number.
            "HA672242<, 6",
            "580225, 4",
            "960108, 6",
            "<<<<<<<<<<<<<<, 0",
            // Example 4 TD1: document number, date of birth, date of expiry.
            "D23145890, 7",
            "340712, 7",
            "950712, 2",
        ],
    )
    fun `field check digits printed in the Part 3 Appendix A MRZ lines`(field: String, expected: Int) {
        assertEquals(expected, Mrz.checkDigit(field))
    }

    @Test
    fun `Part 3 Example 3 - TD3 composite check digit is 8`() {
        val lower = "HA672242<6YTO5802254M9601086<<<<<<<<<<<<<<0"
        // TD3 composite: positions 1-10, 14-20 and 22-43 of the lower line.
        val composite = lower.substring(0, 10) + lower.substring(13, 20) + lower.substring(21, 43)

        assertEquals(8, Mrz.checkDigit(composite))
    }

    @Test
    fun `Part 3 Example 4 - TD1 composite check digit is 2`() {
        val upper = "I<YTOD231458907<<<<<<<<<<<<<<<"
        val middle = "3407127M9507122YTO<<<<<<<<<<<"
        // TD1 composite: upper 6-30, middle 1-7, 9-15 and 19-29.
        val composite = upper.substring(5, 30) +
            middle.substring(0, 7) + middle.substring(8, 15) + middle.substring(18, 29)

        assertEquals(2, Mrz.checkDigit(composite))
    }

    @Test
    fun `Part 3 Example 5 - TD2 composite check digit is 8`() {
        val lower = "HA672242<6YTO5802254M9601086<<<<<<<"
        // TD2 composite: positions 1-10, 14-20 and 22-35 of the lower line.
        val composite = lower.substring(0, 10) + lower.substring(13, 20) + lower.substring(21, 35)

        assertEquals(8, Mrz.checkDigit(composite))
    }

    @ParameterizedTest(name = "rejects \"{0}\"")
    @ValueSource(strings = ["ab2134", "AB 2134", "AB-2134", "AB2134Ä"])
    fun `rejects characters outside the MRZ character set`(field: String) {
        assertThrows<IllegalArgumentException> { Mrz.checkDigit(field) }
    }

    @Test
    fun `error message does not echo the field value, which may be PII`() {
        val field = "L898902c<"

        val error = assertThrows<IllegalArgumentException> { Mrz.checkDigit(field) }

        assertFalse(error.message.orEmpty().contains("L898902"), "message leaked the input: ${error.message}")
    }
}
