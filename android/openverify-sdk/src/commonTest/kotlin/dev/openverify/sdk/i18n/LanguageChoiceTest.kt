package dev.openverify.sdk.i18n

import dev.openverify.sdk.model.FlowLocales
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * C199.2 (Phase 9 C161.2; review H21): the person's choice in the selector, then `Request.locale`,
 * then the device's locales, matched by RFC 4647 lookup against the version's enabled locales that
 * the SDK also bundles; then the version's default; then English. As Phase 9's
 * `apps/flow/src/i18n/languages.ts` does it.
 */
internal class LanguageChoiceTest {

    private val allFive = FlowLocales(enabled = listOf("en", "es", "fr", "de", "ar"), default = "en")

    @Test
    fun aCandidateIsCanonicalisedOrRefused() {
        assertEquals("es-MX", canonicalLanguageTag("ES_mx"))
        assertEquals("ar-EG", canonicalLanguageTag(" ar-eg "))
        assertEquals("zh-Hant-TW", canonicalLanguageTag("zh-hant-tw"))
        assertEquals("es-419", canonicalLanguageTag("es-419"))
        assertEquals("de-CH-1996", canonicalLanguageTag("de-ch-1996"))
        assertEquals("en-US-u-nu-arab", canonicalLanguageTag("en-US-u-nu-arab"))
        assertEquals("ar-x-private", canonicalLanguageTag("ar-x-private"))
        for (refused in listOf(null, "", "  ", "*", "e", "english1", "a1", "en--US", "en-", "-en", "en-toolongsubtag", "en-u", "x-private", "en US", "ënglish")) {
            assertNull(canonicalLanguageTag(refused), "$refused")
        }
    }

    @Test
    fun lookupTruncatesFromTheEndAndComparesWholeSubtags() {
        assertEquals("ar", lookupLanguage("ar-EG", SDK_LANGUAGES))
        assertEquals("es", lookupLanguage("es-419", SDK_LANGUAGES))
        assertEquals("de", lookupLanguage("de-CH-1996", SDK_LANGUAGES))
        assertEquals("en", lookupLanguage("en-US-u-nu-arab", SDK_LANGUAGES), "a single-letter subtag goes with the one after it")
        assertNull(lookupLanguage("ara", listOf("ar")), "ara never matches ar")
        assertNull(lookupLanguage("fa-IR", SDK_LANGUAGES))
        assertNull(lookupLanguage("es-MX", listOf("en", "fr")))
        assertEquals("es", lookupLanguage("ES-mx", SDK_LANGUAGES), "compared without case")
    }

    @Test
    fun theAvailableLanguagesAreTheEnabledOnesTheSdkBundles() {
        assertEquals(SDK_LANGUAGES, availableLanguages(null))
        assertEquals(listOf("fr", "ar"), availableLanguages(FlowLocales(enabled = listOf("fr", "ar"), default = "fr")))
        assertEquals(listOf("de"), availableLanguages(FlowLocales(enabled = listOf("de", "pt"), default = "de")), "a language the SDK does not bundle is never offered")
    }

    @Test
    fun theSelectorThenTheRequestThenTheDeviceInPriorityOrder() {
        assertEquals(LanguageChoice("fr", "fr-CA"), chooseLanguage(selected = "fr-CA", requested = "de", device = listOf("es-MX"), locales = allFive))
        assertEquals(LanguageChoice("de", "de-AT"), chooseLanguage(selected = null, requested = "de-AT", device = listOf("es-MX"), locales = allFive))
        assertEquals(LanguageChoice("es", "es-MX"), chooseLanguage(selected = null, requested = null, device = listOf("es-MX", "fr"), locales = allFive))
        assertEquals(LanguageChoice("ar", "ar-EG"), chooseLanguage(selected = null, requested = null, device = listOf("fa-IR", "ar-EG"), locales = allFive), "the first device locale that matches")
        assertEquals(LanguageChoice("es", "es-MX"), chooseLanguage(selected = "not a tag!", requested = "pt-BR", device = listOf("es-MX"), locales = allFive), "an unusable or unmatched candidate is passed over")
    }

    @Test
    fun onlyTheVersionsEnabledLocalesMayBeChosen() {
        val frenchAndArabic = FlowLocales(enabled = listOf("fr", "ar"), default = "ar")
        assertEquals(LanguageChoice("ar", "ar"), chooseLanguage(selected = null, requested = "es", device = listOf("de-DE"), locales = frenchAndArabic), "none enabled: the version's default")
        assertEquals(LanguageChoice("fr", "fr-BE"), chooseLanguage(selected = null, requested = "es", device = listOf("fr-BE"), locales = frenchAndArabic))
    }

    @Test
    fun theFallbackIsTheVersionsDefaultThenEnglishThenTheFirstAvailable() {
        assertEquals(LanguageChoice("de", "de"), chooseLanguage(null, null, emptyList(), FlowLocales(enabled = listOf("en", "de"), default = "de")))
        assertEquals(LanguageChoice("en", "en"), chooseLanguage(null, null, emptyList(), FlowLocales(enabled = listOf("en", "de"), default = "pt")), "a default the SDK does not bundle")
        assertEquals(LanguageChoice("fr", "fr"), chooseLanguage(null, null, emptyList(), FlowLocales(enabled = listOf("fr", "de"), default = "pt")), "no English enabled")
        assertEquals(LanguageChoice("en", "en"), chooseLanguage(null, null, listOf("ja-JP"), null), "no locales member: every bundled language, then English")
        assertEquals(LanguageChoice("en", "en"), chooseLanguage(null, null, emptyList(), FlowLocales(enabled = listOf("pt"), default = "pt")), "nothing bundled is enabled")
    }

    @Test
    fun arabicIsTheOneRightToLeftLanguage() {
        assertTrue(isRightToLeft("ar"))
        for (language in listOf("en", "es", "fr", "de")) assertFalse(isRightToLeft(language), language)
    }
}
