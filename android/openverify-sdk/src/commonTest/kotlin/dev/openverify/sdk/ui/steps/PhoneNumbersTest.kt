package dev.openverify.sdk.ui.steps

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * C55.8: the phone step sends a number in international form, `+`, the country calling code and the
 * number, which the server parses (and whose national trunk prefix it strips) with libphonenumber.
 */
class PhoneNumbersTest {

    @Test
    fun eachRegionHasItsCountryCallingCode() {
        val expected = mapOf("US" to "1", "CA" to "1", "GB" to "44", "IT" to "39", "DE" to "49", "MX" to "52", "IN" to "91", "AC" to "247", "XK" to "383")

        assertEquals(expected, expected.keys.associateWith { PhoneNumbers.callingCode(it) })
    }

    @Test
    fun aRegionWithoutACallingCodeHasNone() {
        assertNull(PhoneNumbers.callingCode("AQ"))
        assertNull(PhoneNumbers.callingCode("ZZ"))
        assertNull(PhoneNumbers.callingCode("us"))
    }

    @Test
    fun theTableCoversEveryRegionWithACallingCodeAndNothingElse() {
        assertEquals(245, PhoneNumbers.regions.size)
        assertTrue(PhoneNumbers.regions.all { Regex("[A-Z]{2}").matches(it) }, PhoneNumbers.regions.toString())
        assertTrue(PhoneNumbers.regions.all { PhoneNumbers.callingCode(it)?.let(Regex("[1-9][0-9]{0,2}")::matches) == true })
    }

    @Test
    fun aNumberTypedForACountryGetsItsCallingCode() {
        assertEquals("+1 555 555 0100", PhoneNumbers.international("US", "555 555 0100"))
        // The server strips a national trunk prefix, as libphonenumber does, so it is kept as typed.
        assertEquals("+44 07700 900123", PhoneNumbers.international("GB", " 07700 900123 "))
        assertEquals("+39 06 1234 5678", PhoneNumbers.international("IT", "06 1234 5678"))
    }

    @Test
    fun aNumberTypedWithAPlusIsAlreadyInternational() {
        assertEquals("+1 555 555 0100", PhoneNumbers.international("GB", "  +1 555 555 0100"))
    }

    @Test
    fun withoutACallingCodeTheNumberIsSentAsTyped() {
        assertEquals("555 0100", PhoneNumbers.international(null, " 555 0100 "))
        assertEquals("555 0100", PhoneNumbers.international("AQ", "555 0100"))
    }

    @Test
    fun aBlankNumberStaysBlank() {
        assertEquals("", PhoneNumbers.international("US", "   "))
    }
}
