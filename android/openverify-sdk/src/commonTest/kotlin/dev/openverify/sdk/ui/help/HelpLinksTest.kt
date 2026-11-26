package dev.openverify.sdk.ui.help

import dev.openverify.sdk.i18n.SDK_LANGUAGES
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * C162.3 (C195.3's rule for links): the help slot opens `https:` URLs only, which the server also
 * requires on save; C199.3: each SDK language is named in its own language, as on the web.
 */
internal class HelpLinksTest {

    @Test
    fun httpsLinksAreAllowed() {
        assertTrue(isAllowedLink("https://help.example.com/flow"))
        assertTrue(isAllowedLink("HTTPS://example.com/privacy?lang=en#top"))
    }

    @Test
    fun anyOtherSchemeOrAMalformedUrlIsRefused() {
        for (url in listOf(
            "http://help.example.com", "javascript:alert(1)", "intent://example.com#Intent;end",
            "file:///sdcard/x", "content://x", "https://", "https:// example.com", "https://exa\nmple.com",
            "//example.com", "", "ftp://example.com",
        )) {
            assertFalse(isAllowedLink(url), url)
        }
    }

    @Test
    fun eachLanguageIsNamedInItself() {
        assertEquals(
            mapOf("en" to "English", "es" to "Español", "fr" to "Français", "de" to "Deutsch", "ar" to "العربية"),
            SDK_LANGUAGE_NAMES,
        )
        assertEquals(SDK_LANGUAGES, SDK_LANGUAGE_NAMES.keys.toList())
    }
}
