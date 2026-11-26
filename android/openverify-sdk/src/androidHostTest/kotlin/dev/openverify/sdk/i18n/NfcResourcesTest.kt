package dev.openverify.sdk.i18n

import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File
import java.text.Normalizer

/**
 * C200.2 (reviews H07, F06, V13): the consent digests are taken over each text's NFC form, and the
 * device has no normaliser, so the texts are NFC when they are built: every SDK string and every
 * generated catalog entry, in every locale folder, is NFC. A filled consent text is then NFC
 * without normalising it on the device when each part is NFC and they are joined at stable
 * boundaries (Unicode UAX #15): the server serves a filled value NFC and starting at a stable
 * boundary (`days` is ASCII digits; `organization-display-name` is refused on save otherwise), and
 * this test requires each placeholder of a consent or notice text to be followed by the end of the
 * text or a stable boundary.
 */
internal class NfcResourcesTest {

    private val keyMap = OpenVerifyJson.parseToJsonElement(File("i18n/key-map.json").readText()).jsonObject
        .getValue("entries").jsonArray.map { it.jsonObject }

    /** The resources whose text has legal weight: a consent, a notice or a decision text (C199.1). */
    private val legalResources: Set<String> = keyMap
        .filter { entry -> entry["legal"].let { it != null && it !is JsonNull } }
        .map { it.getValue("resource").jsonPrimitive.content }
        .toSet()

    @Test
    fun `every SDK string and generated catalog entry in every locale folder is NFC (C200_2)`() {
        val folders = SdkResourceTexts.folders()
        val notNfc = folders.flatMap { folder ->
            SdkResourceTexts.resources(folder).values.flatMap { resource ->
                resource.texts.filterNot { Normalizer.isNormalized(it, Normalizer.Form.NFC) }.map { "$folder/${resource.file}: ${resource.name}" }
            }
        }

        assertEquals(SdkResourceTexts.LOCALE_FOLDERS.values.sorted(), folders.filter { it in SdkResourceTexts.LOCALE_FOLDERS.values }.sorted())
        assertEquals(emptyList<String>(), notNfc)
    }

    @Test
    fun `each placeholder of a consent or notice text is followed by its end or a stable boundary (C200_2)`() {
        val unstable = SdkResourceTexts.LOCALE_FOLDERS.values.flatMap { folder ->
            SdkResourceTexts.resources(folder).values.filter { it.name in legalResources }.flatMap { resource ->
                resource.texts.flatMap { text ->
                    PLACEHOLDER.findAll(text).mapNotNull { placeholder ->
                        val next = placeholder.range.last + 1
                        if (next >= text.length || isStableNfcBoundary(text.codePointAt(next))) {
                            null
                        } else {
                            "$folder/${resource.name}: ${placeholder.value} before U+%04X".format(text.codePointAt(next))
                        }
                    }.toList()
                }
            }
        }

        assertEquals(true, legalResources.isNotEmpty(), "the key map names no legal text")
        assertEquals(emptyList<String>(), unstable)
    }

    @Test
    fun `a stable boundary is a starter that nothing before it can compose with`() {
        val refused = listOf(0x0301, 0x0BBE, 0x0344, 0x0958, 0x1161, 0x1175, 0x11A8, 0x11C2, 0x3099)
        val accepted = listOf(' '.code, '.'.code, ','.code, 0x060C, 'a'.code, 'D'.code, 0x00E9, 0x0644, 0xAC00, 0x1100, 0x65E5)

        assertEquals(emptyList<String>(), refused.filter(::isStableNfcBoundary).map { "U+%04X".format(it) })
        assertEquals(emptyList<String>(), accepted.filterNot(::isStableNfcBoundary).map { "U+%04X".format(it) })
    }

    private companion object {
        /** The web's `{{name}}` placeholders and Compose's positional ones. */
        val PLACEHOLDER = Regex("""\{\{[a-z][A-Za-z0-9_]*\}\}|%[1-9][0-9]*\$[sd]""")

        /**
         * Whether [codePoint] is a stable NFC boundary (UAX #15): canonical combining class 0 and
         * `NFC_Quick_Check=Yes`. Every character with a non-zero class or `NFC_Quick_Check=Maybe` is a
         * mark (`Mn`, `Mc`, `Me`) except the conjoining Hangul vowels and trailing consonants
         * (U+1161 to U+1175 and U+11A8 to U+11C2), which have class 0 but compose with what precedes
         * them; a character with `NFC_Quick_Check=No` is not NFC on its own.
         */
        fun isStableNfcBoundary(codePoint: Int): Boolean {
            val type = Character.getType(codePoint)
            val mark = type == Character.NON_SPACING_MARK.toInt() ||
                type == Character.COMBINING_SPACING_MARK.toInt() ||
                type == Character.ENCLOSING_MARK.toInt()
            val conjoiningJamo = codePoint in 0x1161..0x1175 || codePoint in 0x11A8..0x11C2
            return !mark && !conjoiningJamo && Normalizer.isNormalized(String(Character.toChars(codePoint)), Normalizer.Form.NFC)
        }
    }
}
