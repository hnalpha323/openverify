package dev.openverify.sdk.flow.logic

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * C196.3 (Phase 9 C161.4): hand cases from Phase 9's `digits.ts` and its test, before the exported
 * vectors landed ([DigitsVectorsTest] runs those). Digits are built from code points, so none is
 * typed by hand.
 */
internal class DigitsTest {

    private fun shifted(digits: String, zero: Int): String = digits.map { (zero + (it - '0')).toChar() }.joinToString("")

    private fun arabicIndic(digits: String) = shifted(digits, 0x0660)

    private fun extendedArabicIndic(digits: String) = shifted(digits, 0x06f0)

    @Test
    fun mapsEveryArabicIndicDigitToItsAsciiDigit() {
        assertEquals("0123456789", normalizeDigits(arabicIndic("0123456789")))
    }

    @Test
    fun mapsEveryExtendedArabicIndicDigitToItsAsciiDigit() {
        assertEquals("0123456789", normalizeDigits(extendedArabicIndic("0123456789")))
    }

    @Test
    fun keepsEverythingElseAsItIsInPlace() {
        val separator = 0x066b.toChar().toString()
        val mixed = "code ${arabicIndic("12")}-${extendedArabicIndic("34")} 56 $separator x"
        assertEquals("code 12-34 56 $separator x", normalizeDigits(mixed))
        assertEquals("", normalizeDigits(""))
        assertEquals("no digits", normalizeDigits("no digits"))
        assertEquals("😀${"1"}", normalizeDigits("😀${arabicIndic("1")}"), "a surrogate pair stays whole")
    }

    @Test
    fun leavesOtherScriptsDigitsAloneOnlyTheTwoArabicRangesAreInC161_4() {
        // Devanagari six, fullwidth seven, Bengali one, Myanmar two, and the code points either side of both ranges.
        val other = listOf(0x096c, 0xff17, 0x09e7, 0x1042, 0x065f, 0x066a, 0x06ef, 0x06fa).map { it.toChar() }.joinToString("")
        assertEquals(other, normalizeDigits(other))
    }
}
