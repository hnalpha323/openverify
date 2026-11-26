package dev.openverify.sdk.i18n

import dev.openverify.sdk.OPENVERIFY_SDK_VERSION
import dev.openverify.sdk.fixtures.readContractFixture
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.ui.ConsentTexts
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.w3c.dom.Element
import java.io.File
import java.security.MessageDigest
import java.text.Normalizer
import javax.xml.parsers.DocumentBuilderFactory

/**
 * C200.1, C200.3 (Workflow 10A, api-android-10a; review F07): the SDK's consent and notice texts are
 * rows of the server's append-only table `contracts/fixtures/i18n/consent-texts.json` (client
 * `android`), which `:openverify-sdk:exportConsentTexts` appends. Every text the consent screen
 * shows (`ConsentTexts`) is one of the key map's legal consent or notice strings, and each of those
 * has a row in all five locales under the SDK's current catalog version, in the words the SDK holds
 * now: a changed text without a new row fails here, and the table never loses or changes a row
 * (`apps/flow/src/i18n/locale-export.test.ts` reads every committed revision of it, whatever the
 * client). The catalog version is `android-<SDK version>-<16 hex>`, the SDK version the generated
 * `OPENVERIFY_SDK_VERSION` (`openverifyVersion`, which the export reads), the hex the first 16 digits
 * of a SHA-256 over the lines `<locale>\t<key>\t<SHA-256 of the text>\n` of the consent texts only,
 * in locale (en, es, fr, de, ar) then key order, as the export takes it.
 */
internal class ConsentTextsTableTest {

    private val locales = listOf("en" to "values", "es" to "values-es", "fr" to "values-fr", "de" to "values-de", "ar" to "values-ar")

    private val keyMapEntries = OpenVerifyJson.parseToJsonElement(File("i18n/key-map.json").readText()).jsonObject
        .getValue("entries").jsonArray.map { it.jsonObject }

    private fun JsonObject.text(member: String): String? = get(member)?.jsonPrimitive?.takeIf { it.isString }?.content

    /** The legal consent and notice strings with a flow key, by flow key: resource name to flow key. */
    private val consentKeys: List<Pair<String, String>> = keyMapEntries
        .filter { it.text("flowKey") != null && it.text("legal") in setOf("consent", "notice") }
        .map { it.text("resource")!! to it.text("flowKey")!! }
        .sortedBy { it.second }

    private data class Row(val catalogVersion: String, val client: String, val key: String, val locale: String, val text: String)

    private val rows: List<Row> = OpenVerifyJson.parseToJsonElement(readContractFixture("i18n/consent-texts.json")).jsonObject
        .getValue("entries").jsonArray.map { it.jsonObject }
        .map { Row(it.text("catalog-version")!!, it.text("client")!!, it.text("key")!!, it.text("locale")!!, it.text("text")!!) }

    /** [raw] with Compose's resource escapes undone (\n, \t, \\), as the export reads a text. */
    private fun unescaped(raw: String): String = raw.replace(Regex("""\\(.)""")) { match ->
        when (match.groupValues[1]) {
            "n" -> "\n"
            "t" -> "\t"
            "\\" -> "\\"
            else -> error("an escape the table cannot keep: ${match.value}")
        }
    }

    /** Each locale's text of every consent key as the SDK holds it now: locale, flow key, text. */
    private fun currentTexts(): List<Triple<String, String, String>> = locales.flatMap { (locale, folder) ->
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/commonMain/composeResources/$folder/strings_catalog.xml"))
        val nodes = document.documentElement.getElementsByTagName("string")
        val defined = (0 until nodes.length).associate { index ->
            val element = nodes.item(index) as Element
            element.getAttribute("name") to unescaped(element.textContent)
        }
        consentKeys.map { (resource, key) -> Triple(locale, key, defined[resource] ?: error("$locale has no $resource")) }
    }

    private fun sha256(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun catalogVersion(texts: List<Triple<String, String, String>>): String =
        "android-$OPENVERIFY_SDK_VERSION-" + sha256(texts.joinToString("") { (locale, key, text) -> "$locale\t$key\t${sha256(text)}\n" }).take(16)

    @Test
    fun `every text the consent screen shows is a legal consent or notice string of the key map (C200_3)`() {
        assertEquals(emptyList<String>(), ConsentTexts.keys.filter { key -> consentKeys.none { it.second == key } })
        assertTrue(consentKeys.map { it.second }.containsAll(listOf("notice.session-integrity", "notice.device-recognition")))
    }

    @Test
    fun `the current consent texts have their rows under the current catalog version, in all five locales (C200_3)`() {
        val texts = currentTexts()
        val version = catalogVersion(texts)
        val android = rows.filter { it.client == "android" && it.catalogVersion == version }
        val missing = texts.filter { (locale, key, text) ->
            android.none { it.locale == locale && it.key == key && it.text == text }
        }.map { (locale, key) -> "$locale $key" }
        assertEquals(emptyList<String>(), missing, "rows missing under $version: run :openverify-sdk:exportConsentTexts")
        assertEquals(texts.size, android.size, "rows under $version that the SDK no longer shows")
    }

    @Test
    fun `every Android row is NFC, names its version form and holds only the placeholders the server fills (C200_1, C200_2)`() {
        val android = rows.filter { it.client == "android" }
        assertTrue(android.isNotEmpty())
        val placeholder = Regex("""\{\{([a-z_]+)\}\}""")
        for (row in android) {
            assertTrue(Regex("""android-[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{16}""").matches(row.catalogVersion), row.catalogVersion)
            assertTrue(Normalizer.isNormalized(row.text, Normalizer.Form.NFC), "${row.locale} ${row.key}")
            val names = placeholder.findAll(row.text).map { it.groupValues[1] }.toSet()
            assertTrue(names.all { it in setOf("days", "organization") }, "${row.locale} ${row.key}: $names")
            assertTrue(!Regex("""%[0-9]+\$[a-z]""").containsMatchIn(row.text), "${row.locale} ${row.key}")
        }
    }

    @Test
    fun `the catalog version changes when a consent text changes, and is the same for the same texts (C200_1, F07)`() {
        val texts = currentTexts()
        val changed = texts.mapIndexed { index, text -> if (index == 0) text.copy(third = text.third + " ") else text }
        assertTrue(catalogVersion(changed) != catalogVersion(texts))
        assertEquals(catalogVersion(texts), catalogVersion(texts.toList()))
    }
}
