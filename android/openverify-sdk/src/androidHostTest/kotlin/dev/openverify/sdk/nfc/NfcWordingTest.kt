package dev.openverify.sdk.nfc

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.io.File

/**
 * C207.5 (review H10), C207.11: the device reads and the server verifies, so no NFC text in any of
 * the five locales says a document, a chip or its data is verified, authentic, genuine or valid, or
 * that a check passed. A short list of verdict words per locale, matched as word stems; the phases'
 * own words ("we will check it now") are not verdicts.
 */
internal class NfcWordingTest {
    private val verdicts = mapOf(
        "values" to listOf("verif", "authentic", "genuine", "valid", "passed", "success", "approved", "confirmed"),
        "values-es" to listOf("verific", "auténtic", "autentic", "genuin", "válid", "valid", "aprobad", "superad", "correctamente", "confirmad"),
        "values-fr" to listOf("vérifi", "authenti", "valid", "approuv", "réussi", "succès", "confirmé"),
        "values-de" to listOf("verifiz", "bestätigt", "authenti", "echt", "gültig", "erfolgreich", "bestanden"),
        "values-ar" to listOf("تم التحقق", "موثّق", "موثق", "أصلي", "أصيل", "صالح", "صحيح", "بنجاح", "معتمد"),
    )

    private fun strings(folder: String): Map<String, String> =
        Regex("""<string name="([^"]+)">([^<]*)</string>""").findAll(File("src/commonMain/composeResources/$folder/strings_nfc.xml").readText())
            .associate { it.groupValues[1] to it.groupValues[2] }

    @TestFactory
    fun `no NFC text says a verdict the server has not given`(): List<DynamicTest> = verdicts.map { (folder, words) ->
        dynamicTest(folder) {
            val texts = strings(folder)
            assertTrue(texts.size >= 70, "$folder holds ${texts.size} NFC strings")
            val found = texts.flatMap { (key, text) -> words.filter { it in text.lowercase() }.map { "$key: $it" } }
            assertEquals(emptyList<String>(), found)
        }
    }

    @Test
    fun `the phases read connecting, reading, signing the check code and read - we will check it now`() {
        val english = strings("values")

        assertEquals("Connecting…", english["openverify_nfc_phase_connecting"])
        assertEquals("Reading…", english["openverify_nfc_phase_reading"])
        assertEquals("Signing the check code…", english["openverify_nfc_phase_signing"])
        assertEquals("Read. We will check it now.", english["openverify_nfc_phase_read"])
        assertEquals("Test chip (sandbox)", english["openverify_nfc_sandbox_label"])
    }

    @Test
    fun `every locale defines the same NFC keys`() {
        val english = strings("values").keys

        verdicts.keys.forEach { folder -> assertEquals(english, strings(folder).keys, folder) }
    }
}
