package dev.openverify.sdk.ui

import dev.openverify.sdk.generated.resources.*
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.PluralStringResource
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getPluralString
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

/**
 * The SDK on a Spanish device (C37), as the web flow offers Spanish: every string has its own
 * Spanish text, consent is recorded with the language its texts were shown in, and every reason
 * a retry hint can carry reads in Spanish. The texts are Compose Multiplatform resources, which
 * follow the default locale on Android, so each is read with the default locale set to Spanish,
 * then to English, as the device's language sets it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "es")
class SpanishMessagesTest {

    /** [read] with the default locale set to [tag]; the previous default is restored afterwards. */
    private fun <T> inLocale(tag: String, read: suspend () -> T): T {
        val previous = Locale.getDefault()
        Locale.setDefault(Locale.forLanguageTag(tag))
        try {
            return runBlocking { read() }
        } finally {
            Locale.setDefault(previous)
        }
    }

    private fun spanish(res: StringResource) = inLocale("es") { getString(res) }

    private fun english(res: StringResource) = inLocale("en") { getString(res) }

    private fun spanish(res: PluralStringResource, n: Int) = inLocale("es") { getPluralString(res, n, n) }

    private fun english(res: PluralStringResource, n: Int) = inLocale("en") { getPluralString(res, n, n) }

    @Test
    fun `consent is recorded with the language its texts were shown in`() {
        assertEquals("es", spanish(Res.string.openverify_locale))
        assertEquals("en", english(Res.string.openverify_locale))
    }

    @Test
    fun `every SDK string has its own Spanish text`() {
        val untranslated = Res.allStringResources
            .filterKeys { it.startsWith("openverify_") }
            .filterValues { spanish(it) == english(it) }
            .keys.toList()

        assertEquals(emptyList<String>(), untranslated)
    }

    @Test
    fun `every SDK plural has its own Spanish text, for one and for several (4B H015)`() {
        val plurals = Res.allPluralStringResources.filterKeys { it.startsWith("openverify_") }
        val untranslated = plurals
            .filterValues { plural -> listOf(1, 3).any { n -> spanish(plural, n) == english(plural, n) } }
            .keys.toList()

        assertTrue("openverify_selfie_time_limit" in plurals.keys)
        assertEquals(emptyList<String>(), untranslated)
    }

    @Test
    fun `every reason a retry hint can carry reads in Spanish (C29_4)`() {
        val untranslated = retryHintReasons().filter { reason ->
            val message = retryReasonMessage(reason)
            message == Res.string.openverify_retry_generic || spanish(message) == english(message)
        }

        assertEquals(emptyList<String>(), untranslated)
    }
}
