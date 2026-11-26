package dev.openverify.sdk.i18n

import dev.openverify.sdk.i18n.SdkPluralCategory.FEW
import dev.openverify.sdk.i18n.SdkPluralCategory.MANY
import dev.openverify.sdk.i18n.SdkPluralCategory.ONE
import dev.openverify.sdk.i18n.SdkPluralCategory.OTHER
import dev.openverify.sdk.i18n.SdkPluralCategory.TWO
import dev.openverify.sdk.i18n.SdkPluralCategory.ZERO
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * C199.4: the CLDR plural rules of the five SDK languages, for the integer counts the SDK passes,
 * over a few of CLDR's own example numbers per category (CLDR's `plurals.xml`, the `@integer`
 * samples of each rule). A count is read by its absolute value, as CLDR's operand `n` is.
 */
internal class SdkPluralRulesTest {

    private fun assertCategory(language: String, expected: SdkPluralCategory, vararg counts: Int) {
        for (count in counts) {
            assertEquals(expected, sdkPluralCategory(language, count), "$language $count")
        }
    }

    @Test
    fun englishAndGermanHaveOneAndOther() {
        for (language in listOf("en", "de")) {
            assertCategory(language, ONE, 1)
            assertCategory(language, OTHER, 0, 2, 3, 16, 100, 1000, 10000, 100000, 1000000)
        }
    }

    @Test
    fun spanishHasOneManyAndOther() {
        assertCategory("es", ONE, 1)
        assertCategory("es", MANY, 1000000, 2000000, 10000000)
        assertCategory("es", OTHER, 0, 2, 16, 100, 1000, 10000, 100000, 1000001)
    }

    @Test
    fun frenchHasOneForZeroAndOneAndManyForMillions() {
        assertCategory("fr", ONE, 0, 1)
        assertCategory("fr", MANY, 1000000, 3000000)
        assertCategory("fr", OTHER, 2, 17, 100, 1000, 10000, 100000, 1000002)
    }

    @Test
    fun arabicHasAllSixCategories() {
        assertCategory("ar", ZERO, 0)
        assertCategory("ar", ONE, 1)
        assertCategory("ar", TWO, 2)
        assertCategory("ar", FEW, 3, 10, 103, 110, 1003)
        assertCategory("ar", MANY, 11, 26, 99, 111, 1011)
        assertCategory("ar", OTHER, 100, 102, 200, 202, 1000, 10000, 100000, 1000000)
    }

    @Test
    fun aNegativeCountTakesItsAbsoluteValuesCategory() {
        assertCategory("en", ONE, -1)
        assertCategory("fr", ONE, -1)
        assertCategory("ar", TWO, -2)
        assertCategory("ar", FEW, -103)
    }
}
