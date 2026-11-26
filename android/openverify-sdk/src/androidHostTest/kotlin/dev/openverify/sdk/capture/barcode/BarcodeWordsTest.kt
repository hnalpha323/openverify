package dev.openverify.sdk.capture.barcode

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * C203.3, C203.4 (review H21): the barcode hint never claims more than a decode on the device. In every
 * locale the found text says "found" and no word of reading, validity or verification, because the
 * server re-decodes a re-encoded photo and decides every barcode check.
 */
class BarcodeWordsTest {

    private val resources = File("src/commonMain/composeResources")

    private fun texts(folder: String): Map<String, String> {
        val root = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File(resources, "$folder/strings_pdf417.xml")).documentElement
        return (0 until root.childNodes.length).map(root.childNodes::item).filterIsInstance<Element>()
            .associate { it.getAttribute("name") to it.textContent }
    }

    /** Words a hint must not use, by locale: reading, validity, verification, success. */
    private val claims = mapOf(
        "values" to listOf("read", "valid", "verif", "success", "accepted", "ok"),
        "values-es" to listOf("legible", "leído", "válido", "verific", "aceptado"),
        "values-fr" to listOf("lisible", "lu", "valide", "vérifi", "accepté"),
        "values-de" to listOf("lesbar", "gelesen", "gültig", "geprüft", "akzeptiert"),
        "values-ar" to listOf("مقروء", "قراءة", "صالح", "تحقق", "مقبول"),
    )

    @Test
    fun everyLocaleHasTheTwoHints() {
        for (folder in claims.keys) {
            assertEquals(setOf("openverify_pdf417_guide", "openverify_pdf417_found"), texts(folder).keys, folder)
        }
    }

    @Test
    fun noHintClaimsTheBarcodeWasReadOrIsValid() {
        for ((folder, words) in claims) {
            for ((name, text) in texts(folder)) {
                val tokens = text.lowercase().split(Regex("[\\s\\p{Punct}]+"))
                for (word in words) {
                    assertFalse(tokens.any { it.startsWith(word) }, "$folder $name says \"$word\": $text")
                }
            }
        }
    }
}
