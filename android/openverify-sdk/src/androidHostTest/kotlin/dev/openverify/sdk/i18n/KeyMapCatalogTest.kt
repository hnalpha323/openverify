package dev.openverify.sdk.i18n

import dev.openverify.sdk.model.ContractSources
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C199.1 (reviews V07, F08, H16): every SDK string the key map names lives only in the generated
 * `strings_catalog.xml` of its locale folder, never in a hand-written file; each one's words are the
 * web catalogs' for its catalog key; a legal string's mark is its flow key's in `COPY_KEYS`; and
 * `review-status.json` lists every SDK string with its file, every non-English locale
 * machine-drafted. `android-i18n`'s generator (`:openverify-sdk:generateLocaleStrings`, Workflow 10A
 * Stage 2) writes `strings_catalog.xml` in the five locale folders, so each one's words are checked
 * here in every locale.
 */
internal class KeyMapCatalogTest {

    private val resources = File("src/commonMain/composeResources")
    private val keyMap = OpenVerifyJson.parseToJsonElement(File("i18n/key-map.json").readText()).jsonObject
    private val entries = keyMap.getValue("entries").jsonArray.map { it.jsonObject }
    private val mapped = entries.map { it.text("resource")!! }

    private fun JsonObject.text(key: String): String? = (get(key) as? JsonElement)?.takeUnless { it is JsonNull }?.jsonPrimitive?.content

    private val stringPattern = Regex("""<(string|plurals) name="([^"]+)"[^>]*>(.*?)</\1>""", RegexOption.DOT_MATCHES_ALL)

    private fun definitions(file: File): Map<String, String> =
        stringPattern.findAll(file.readText().replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), ""))
            .associate { it.groupValues[2] to it.groupValues[3] }

    private fun folders(): List<File> = resources.listFiles { file -> file.isDirectory && file.name.startsWith("values") }.orEmpty().sortedBy { it.name }

    @Test
    fun `no hand-written resource file defines a key-mapped string (C199_1, V07)`() {
        val offenders = folders().flatMap { folder ->
            folder.listFiles { file -> file.extension == "xml" && file.name != "strings_catalog.xml" }.orEmpty()
                .flatMap { file -> definitions(file).keys.filter { it in mapped }.map { "${folder.name}/${file.name}: $it" } }
        }

        assertEquals(emptyList<String>(), offenders.sorted())
    }

    @Test
    fun `the waiting, halted, help-link and privacy-link strings take the web's words through the key map (KP10-10, C197_2)`() {
        val expected = mapOf(
            "openverify_waiting_title" to "screen.waiting.title",
            "openverify_waiting_message" to "screen.waiting.message",
            "openverify_halted_title" to "screen.halted.title",
            "openverify_halted_message" to "screen.halted.message",
            "openverify_help_link" to "screen.helpLink",
            "openverify_privacy_link" to "screen.privacyLink",
        )
        val found = entries.filter { it.text("resource") in expected }
            .associate { it.text("resource")!! to Triple(it.text("flowKey"), it.text("catalogKey"), it.text("legal")) }

        assertEquals(expected.mapValues { (_, key) -> Triple(key, key, null) }, found)
    }

    @Test
    fun `every locale's catalog holds exactly the key-mapped strings, in the web's words (C199_1)`() {
        val problems = LOCALES.flatMap { (folder, locale) ->
            val catalog = File(resources, "$folder/strings_catalog.xml")
            if (!catalog.isFile) return@flatMap listOf("$folder/strings_catalog.xml is missing")
            val defined = definitions(catalog)
            val messages = OpenVerifyJson.parseToJsonElement(Fixtures.read("i18n/$locale.json")).jsonObject.getValue("messages").jsonObject
            (if (defined.keys.toList() == mapped) emptyList() else listOf("$folder: ${defined.keys} is not the key map's ${mapped.size} strings in its order")) +
                entries.mapNotNull { entry ->
                    val words = entry.text("catalogKey")!!.split('.').fold<String, JsonElement?>(messages) { node, part -> (node as? JsonObject)?.get(part) }
                    val resource = entry.text("resource")!!
                    val expected = words?.jsonPrimitive?.content ?: return@mapNotNull "$locale: no catalog text ${entry.text("catalogKey")}"
                    if (defined[resource] == expected) null else "$folder/$resource is not the catalog's text"
                }
        }

        assertEquals(emptyList<String>(), problems)
    }

    @Test
    fun `a key-mapped string's legal mark is its flow key's in COPY_KEYS (C199_7, H16)`() {
        val copyKeys = ContractSources.matches(COPY_KEYS, Regex("""'([A-Za-z0-9.-]+)':\s*(consentText|noticeText|text)\("""))
            .associate { it.groupValues[1] to mapOf("consentText" to "consent", "noticeText" to "notice", "text" to null)[it.groupValues[2]] }
        val problems = entries.mapNotNull { entry ->
            val flowKey = entry.text("flowKey") ?: return@mapNotNull null
            when {
                flowKey !in copyKeys -> "${entry.text("resource")}: $flowKey is not a COPY_KEYS key"
                copyKeys[flowKey] != entry.text("legal") -> "${entry.text("resource")}: legal ${entry.text("legal")} for ${copyKeys[flowKey]}"
                else -> null
            }
        }

        assertEquals(emptyList<String>(), problems)
        assertEquals(mapped.size, mapped.toSet().size, "each resource once")
    }

    @Test
    fun `the review status lists every SDK string with its file, every non-English locale machine-drafted (C199_1)`() {
        val status = OpenVerifyJson.parseToJsonElement(File("i18n/review-status.json").readText()).jsonObject
        val listed = status.getValue("keys").jsonObject.mapValues { it.value.jsonObject.text("file") }
        val defined = File(resources, "values").listFiles { file -> file.extension == "xml" }.orEmpty()
            .flatMap { file -> definitions(file).keys.map { it to file.name } }
            .toMap()

        assertEquals(defined.toSortedMap(), listed.toSortedMap())
        assertEquals(
            mapOf("en" to "source", "es" to "machine-drafted", "fr" to "machine-drafted", "de" to "machine-drafted", "ar" to "machine-drafted"),
            status.getValue("locales").jsonObject.mapValues { it.value.jsonObject.text("status") },
        )
    }

    private companion object {
        const val COPY_KEYS = "packages/flow-spec/src/v2/copy-keys.ts"

        /** Each SDK locale folder with the web catalog its generated `strings_catalog.xml` is written from. */
        val LOCALES = listOf("values" to "en", "values-es" to "es", "values-fr" to "fr", "values-de" to "de", "values-ar" to "ar")
    }
}
