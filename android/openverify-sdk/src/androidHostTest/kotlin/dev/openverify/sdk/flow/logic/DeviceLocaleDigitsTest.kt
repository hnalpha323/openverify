package dev.openverify.sdk.flow.logic

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import java.util.Locale

/**
 * C196.3 (review H08): the SDK never changes the JVM default locale (C199.4), so a device set to a
 * locale whose digits are not ASCII must not reach a value sent to the server or the chip. Under
 * `Locale.setDefault` for `ar-EG`, `fa-IR`, `bn-BD`, `mr-IN` and `my-MM`, [normalizeDigits] and the
 * consent digests' [Sha256] answer exactly what they answer under `en-US`. The control proves the
 * hazard is real on this JVM: the same default makes a locale-less `"%d".format` non-ASCII.
 */
internal class DeviceLocaleDigitsTest {

    private lateinit var saved: Locale

    @BeforeEach
    fun save() {
        saved = Locale.getDefault()
    }

    @AfterEach
    fun restore() {
        Locale.setDefault(saved)
    }

    private fun arabicIndic(digits: String): String = digits.map { (0x0660 + (it - '0')).toChar() }.joinToString("")

    @ParameterizedTest(name = "{0}")
    @MethodSource("dev.openverify.sdk.flow.logic.DeviceLocales#tags")
    fun `normalised digits and digests stay ASCII under the device's own locale`(tag: String) {
        Locale.setDefault(Locale.forLanguageTag(tag))
        assertEquals("0123456789", normalizeDigits(arabicIndic("0123456789")), tag)
        assertEquals("2024-02-29", normalizeDigits(arabicIndic("2024") + "-" + arabicIndic("02") + "-" + arabicIndic("29")), tag)
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Sha256.hexOfUtf8("abc"), tag)
        assertEquals("30", 30.toString(), "Kotlin's own number text is ASCII under $tag")
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("dev.openverify.sdk.flow.logic.DeviceLocales#digitLocales")
    fun `the control - a locale-less format under that default is not ASCII`(tag: String) {
        Locale.setDefault(Locale.forLanguageTag(tag))
        val formatted = String.format("%d", 30)
        assertTrue(formatted.any { it !in '0'..'9' }, "$tag formats 30 as $formatted")
    }
}

/** The device locales of C196.3 whose default digits are not ASCII. */
internal object DeviceLocales {
    @JvmStatic
    fun tags(): List<String> = listOf("ar-EG", "fa-IR", "bn-BD", "mr-IN", "my-MM")

    /** The ones whose CLDR default numbering system the JDK applies to `%d` (measured: see the TDD file). */
    @JvmStatic
    fun digitLocales(): List<String> = tags()
}
