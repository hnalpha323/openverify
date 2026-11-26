package dev.openverify.sdk.i18n

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * C212.2: the pseudo-locale the clipped-text check runs under. It is English made longer and
 * accented, read through the same facade as every SDK string, and no locale choice reaches it.
 */
class PseudoLocaleTest {

    @Test
    fun aTextIsAccentedAndAtLeastAThirdLonger() {
        val english = "Take the photo"
        val pseudo = pseudoLocalized(english)

        assertNotEquals(english, pseudo)
        assertTrue(pseudo.length * 3 >= english.length * 4, "\"$pseudo\" is not a third longer than \"$english\"")
        assertTrue(english.none { it.isLetter() && it in pseudo }, "an unaccented letter of the English text is left in \"$pseudo\"")
    }

    @Test
    fun placeholdersStayAsTheyAre() {
        val pseudo = pseudoLocalized("Photo %1\$d of %2\$d for %3\$s")

        assertTrue("%1\$d" in pseudo && "%2\$d" in pseudo && "%3\$s" in pseudo, pseudo)
    }

    @Test
    fun theFacadeReadsEnglishThroughThePseudoLocaleAndFillsIt() {
        val english = checkNotNull(sdkStringIn("en", "openverify_capture_progress", listOf("1", "2")))
        val pseudo = checkNotNull(sdkStringIn(SDK_PSEUDO_LANGUAGE, "openverify_capture_progress", listOf("1", "2")))

        assertNotEquals(english, pseudo)
        assertTrue("1" in pseudo && "2" in pseudo && '%' !in pseudo, pseudo)
        assertEquals(pseudoLocalized(checkNotNull(sdkStringIn("en", "openverify_cancel", emptyList()))), sdkStringIn(SDK_PSEUDO_LANGUAGE, "openverify_cancel", emptyList()))
    }

    @Test
    fun aPluralIsReadThroughThePseudoLocaleByTheEnglishRule() {
        val one = checkNotNull(sdkPluralIn(SDK_PSEUDO_LANGUAGE, "openverify_selfie_time_limit", 1, listOf("1")))
        val three = checkNotNull(sdkPluralIn(SDK_PSEUDO_LANGUAGE, "openverify_selfie_time_limit", 3, listOf("3")))

        assertNotEquals(checkNotNull(sdkPluralIn("en", "openverify_selfie_time_limit", 1, listOf("1"))), one)
        assertNotEquals(one.replace("1", "3"), three)
    }

    @Test
    fun noLocaleChoiceReachesThePseudoLocale() {
        assertTrue(SDK_PSEUDO_LANGUAGE !in SDK_LANGUAGES)
        assertEquals("en", chooseLanguage(SDK_PSEUDO_LANGUAGE, SDK_PSEUDO_LANGUAGE, listOf(SDK_PSEUDO_LANGUAGE), null).language)
    }
}
