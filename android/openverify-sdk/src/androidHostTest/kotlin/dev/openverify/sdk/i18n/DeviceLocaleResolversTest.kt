package dev.openverify.sdk.i18n

import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowLocales
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import java.util.Locale

/**
 * C196.3 (review H08), C199.2, C199.6: the language chooser and the copy resolver under
 * `Locale.setDefault` for `ar-EG`, `fa-IR`, `bn-BD`, `mr-IN` and `my-MM`, with the SDK's chosen
 * locale both equal to the device's (the device's own tag chosen) and different from it (a request
 * or a selector choice), answer what they answer under `en-US`: the device's default never enters
 * a tag's case, a lookup, or a filled `{days}`, which stays ASCII as the server fills it.
 */
internal class DeviceLocaleResolversTest {

    private lateinit var saved: Locale

    @BeforeEach
    fun save() {
        saved = Locale.getDefault()
    }

    @AfterEach
    fun restore() {
        Locale.setDefault(saved)
    }

    private val allFive = FlowLocales(enabled = listOf("en", "es", "fr", "de", "ar"), default = "en")

    private val copy = FlowCopy(
        mapOf(
            "ar" to mapOf("consent.biometric" to "نحتفظ بها {days} يومًا لدى {organization}"),
            "fr" to mapOf("consent.biometric" to "Conservée {days} jours par {organization}"),
        ),
    )

    @ParameterizedTest(name = "{0}")
    @MethodSource("dev.openverify.sdk.flow.logic.DeviceLocales#tags")
    fun `the chosen locale equal to the device's`(tag: String) {
        Locale.setDefault(Locale.forLanguageTag(tag))
        val device = listOf(Locale.getDefault().toLanguageTag())
        val choice = chooseLanguage(selected = null, requested = null, device = device, locales = allFive)
        val expected = if (tag.startsWith("ar")) LanguageChoice("ar", "ar-EG") else LanguageChoice("en", "en")
        assertEquals(expected, choice, tag)
        val filled = OperatorCopy(copy, choice.language, "en").forResource("openverify_consent_biometric", mapOf("days" to 30.toString(), "organization" to "Synthetic Bank"))
        if (choice.language == "ar") {
            val text = (filled as ResolvedText.Custom).text.logical
            assertEquals(true, " 30 " in text && text.none { it in '٠'..'٩' }, "$tag: $text")
        } else {
            assertEquals(ResolvedText.BuiltIn, filled, tag)
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("dev.openverify.sdk.flow.logic.DeviceLocales#tags")
    fun `the chosen locale different from the device's`(tag: String) {
        Locale.setDefault(Locale.forLanguageTag(tag))
        val device = listOf(Locale.getDefault().toLanguageTag())
        val choice = chooseLanguage(selected = null, requested = "fr-CA", device = device, locales = allFive)
        assertEquals(LanguageChoice("fr", "fr-CA"), choice, tag)
        val filled = OperatorCopy(copy, choice.language, "en").forResource("openverify_consent_biometric", mapOf("days" to 30.toString(), "organization" to "Synthetic Bank"))
        assertEquals("Conservée 30 jours par Synthetic Bank", (filled as ResolvedText.Custom).text.logical, tag)
    }

    @Test
    fun `a tag's case never follows the device's default (Turkish dotless i)`() {
        Locale.setDefault(Locale.forLanguageTag("tr-TR"))
        assertEquals("it-IT", canonicalLanguageTag("IT-it"))
        assertEquals("id", lookupLanguage("ID", listOf("id")))
    }
}
