// :openverify-sdk:exportConsentTexts (C200.1, C200.3; review F07), owned by api-android-10a.
//
// Appends the SDK's consent and notice texts, unfilled, to the server's append-only table
// contracts/fixtures/i18n/consent-texts.json, as rows {catalog-version, client: "android", key,
// locale, text}, so the server's digest check (C162.9) reads them as it reads the web's. The texts
// are the key map's legal consent and notice strings that have a flow key (every key ConsentTexts
// shows, the notice keys among them), in each of the five locales, read from the generated
// strings_catalog.xml of the locale folder, Compose's resource escapes undone; their {{name}}
// placeholders are the table's form already (android-i18n keeps the web's), and a positional one
// (%1$s) fails the task rather than be given a name it may not have. A text that is not NFC fails
// too (C200.2).
//
// catalog-version is android-<SDK version>-<the first 16 hex digits of a SHA-256 over the consent
// texts only>, the lines "<locale>\t<key>\t<SHA-256 of the NFC text>\n" in locale (en, es, fr, de,
// ar) then key order, as the web's version is taken, so a change to any other string makes no new
// version. A row already in the table for its version, client, key and locale is never added
// again, and no row is changed or removed, whatever its client. The file is written as
// apps/flow/scripts/export-flow-locales.ts writes it (JSON.stringify with two spaces, then
// Prettier, which leaves that form as it is), and only when it changes.
//
// Run it whenever a consent or notice text changes, and commit the table in the same commit:
// (cd android && ./gradlew --no-daemon :openverify-sdk:exportConsentTexts). Then re-run the digest
// vectors: UPDATE_CONTRACT_FIXTURES=1 pnpm --filter @openverify/api exec vitest run
// src/services/templates/consent-texts.android.test.ts --coverage.enabled=false.
//
// Applied by the exportConsentTexts task that foundation-10a registers in build.gradle.kts. The
// action reads only the files and values captured below, so the configuration cache can store it.

import groovy.json.JsonSlurper
import java.security.MessageDigest
import java.text.Normalizer
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/** Each SDK locale (the table's name) with its folder under composeResources, in the table's order. */
val consentLocales: List<Pair<String, String>> = listOf(
    "en" to "values",
    "es" to "values-es",
    "fr" to "values-fr",
    "de" to "values-de",
    "ar" to "values-ar",
)

val consentKeyMap: File = file("i18n/key-map.json")
val consentCatalogs: Map<String, File> = consentLocales.associate { (locale, folder) -> locale to file("src/commonMain/composeResources/$folder/strings_catalog.xml") }
val consentTable: File = rootProject.file("../contracts/fixtures/i18n/consent-texts.json")
val sdkVersion: Provider<String> = providers.gradleProperty("openverifyVersion")

// Configured lazily by name, so the order of the task's registration and this script's application
// does not matter.
tasks.matching { it.name == "exportConsentTexts" }.configureEach {
    group = "openverify"
    description = "Appends the SDK's consent and notice texts to contracts/fixtures/i18n/consent-texts.json as client android rows (C200.3)."
    val keyMap = consentKeyMap
    val catalogs = consentCatalogs
    val table = consentTable
    val version = sdkVersion.orElse("")
    val locales = consentLocales.map { it.first }
    inputs.file(keyMap)
    inputs.files(catalogs.values)
    inputs.property("openverifyVersion", version)
    outputs.file(table)
    doLast {
        fun fail(message: String): Nothing = throw GradleException("exportConsentTexts: $message")

        fun sha256(text: String): String =
            MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

        /** The legal consent and notice strings with a flow key: resource name to flow key, by flow key. */
        val consentKeys: List<Pair<String, String>> = ((JsonSlurper().parse(keyMap) as Map<*, *>)["entries"] as List<*>)
            .map { it as Map<*, *> }
            .filter { it["flowKey"] is String && (it["legal"] == "consent" || it["legal"] == "notice") }
            .map { (it["resource"] as String) to (it["flowKey"] as String) }
            .sortedBy { it.second }
        if (consentKeys.isEmpty()) fail("the key map holds no consent or notice text")

        /** [raw] with Compose's resource escapes undone: \n, \t and \\; any other escape fails the task. */
        fun unescaped(raw: String, where: String): String = buildString {
            var index = 0
            while (index < raw.length) {
                val character = raw[index]
                if (character != '\\') {
                    append(character)
                    index += 1
                    continue
                }
                when (raw.getOrNull(index + 1)) {
                    'n' -> append('\n')
                    't' -> append('\t')
                    '\\' -> append('\\')
                    else -> fail("$where holds an escape the table cannot keep")
                }
                index += 2
            }
        }

        /** Every <string> of [file], by name, with its text as the SDK shows it. */
        fun strings(file: File, locale: String): Map<String, String> {
            if (!file.isFile) fail("$locale has no ${file.name}")
            val factory = DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = false
                setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
            }
            val nodes = factory.newDocumentBuilder().parse(file).documentElement.getElementsByTagName("string")
            return (0 until nodes.length).associate { index ->
                val element = nodes.item(index) as Element
                val name = element.getAttribute("name")
                name to unescaped(element.textContent, "$locale $name")
            }
        }

        /** The rows of the current texts: locale order, then flow key order. */
        val current: List<Triple<String, String, String>> = locales.flatMap { locale ->
            val defined = strings(catalogs.getValue(locale), locale)
            consentKeys.map { (resource, key) ->
                val text = defined[resource] ?: fail("$locale has no $resource")
                if (Regex("%[0-9]+\\$[a-z]").containsMatchIn(text)) fail("$locale $key has a positional placeholder; the table holds {{name}}")
                if (!Normalizer.isNormalized(text, Normalizer.Form.NFC)) fail("$locale $key is not NFC")
                Triple(locale, key, text)
            }
        }
        val sdk = version.get().ifEmpty { fail("the openverifyVersion property is not set") }
        if (!Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(sdk)) fail("openverifyVersion is not major.minor.patch")
        val digest = sha256(current.joinToString("") { (locale, key, text) -> "$locale\t$key\t${sha256(text)}\n" })
        val catalogVersion = "android-$sdk-${digest.take(16)}"

        val parsed = JsonSlurper().parse(table) as Map<*, *>
        val description = parsed["description"] as? String ?: fail("the table has no description")
        val entries: MutableList<List<String>> = ((parsed["entries"] as? List<*>) ?: fail("the table has no entries")).map { entry ->
            val fields = entry as Map<*, *>
            listOf("catalog-version", "client", "key", "locale", "text").map { member ->
                fields[member] as? String ?: fail("a row has no $member")
            }
        }.toMutableList()
        val known = entries.map { it.take(4) }.toMutableSet()
        for ((locale, key, text) in current) {
            val row = listOf(catalogVersion, "android", key, locale, text)
            if (known.add(row.take(4))) entries.add(row)
        }

        /** [text] as JSON.stringify writes a string: the short escapes, \u00XX below a space, lone surrogates escaped. */
        fun jsonString(text: String): String = buildString {
            append('"')
            var index = 0
            while (index < text.length) {
                val character = text[index]
                val paired = character.isHighSurrogate() && text.getOrNull(index + 1)?.isLowSurrogate() == true
                when {
                    paired -> {
                        append(character).append(text[index + 1])
                        index += 1
                    }
                    character == '"' -> append("\\\"")
                    character == '\\' -> append("\\\\")
                    character == '\b' -> append("\\b")
                    character == '\u000C' -> append("\\f")
                    character == '\n' -> append("\\n")
                    character == '\r' -> append("\\r")
                    character == '\t' -> append("\\t")
                    character < ' ' || character.isSurrogate() -> append("\\u%04x".format(character.code))
                    else -> append(character)
                }
                index += 1
            }
            append('"')
        }

        val members = listOf("catalog-version", "client", "key", "locale", "text")
        val json = buildString {
            append("{\n  \"format\": 1,\n  \"description\": ").append(jsonString(description)).append(",\n  \"entries\": ")
            if (entries.isEmpty()) {
                append("[]")
            } else {
                append("[\n")
                append(entries.joinToString(",\n") { row ->
                    members.zip(row).joinToString(",\n", prefix = "    {\n", postfix = "\n    }") { (member, value) ->
                        "      ${jsonString(member)}: ${jsonString(value)}"
                    }
                })
                append("\n  ]")
            }
            append("\n}\n")
        }
        if (table.readText() != json) table.writeText(json)
    }
}
