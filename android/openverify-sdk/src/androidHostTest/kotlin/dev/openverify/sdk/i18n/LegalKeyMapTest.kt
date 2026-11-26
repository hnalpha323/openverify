package dev.openverify.sdk.i18n

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
 * C199.1 and C199.7 (review H16): a legal text is never drafted for the SDK. Every legal-marked
 * copy key that `contracts/fixtures/i18n/copy-keys.json` exports from COPY_KEYS (a consent, notice,
 * decision or retention text) is mapped by `i18n/key-map.json` to the SDK string that shows it, with
 * the same mark, so its words come from the web catalogs in every locale; and every flow key the
 * key map names is a copy key with that mark. A legal key added to COPY_KEYS fails here until the
 * SDK maps it (an operator's override of an unmapped legal key renders the step unsupported).
 */
internal class LegalKeyMapTest {

    /** A copy key or a key-map entry's flow key, with its legal mark (`null` for none). */
    internal data class Marked(val key: String, val legal: String?)

    private fun JsonObject.text(key: String): String? = (get(key) as? JsonElement)?.takeUnless { it is JsonNull }?.jsonPrimitive?.content

    private val copyKeys: List<Marked> = OpenVerifyJson.parseToJsonElement(Fixtures.read("i18n/copy-keys.json")).jsonObject
        .getValue("keys").jsonObject.map { (key, rules) -> Marked(key, rules.jsonObject.text("legal")) }

    private val keyMap: JsonObject = OpenVerifyJson.parseToJsonElement(File("i18n/key-map.json").readText()).jsonObject

    /**
     * Workflow 11A (C238.3, C238.7; orchestrator decision 18): the legal keys whose texts the server
     * composes into a step's client view. They are mapped by kind, with their mark, and need no SDK
     * string: the SDK shows the served text.
     */
    private val serverComposed: List<Marked> = (keyMap["serverComposed"]?.jsonArray ?: emptyList())
        .map { it.jsonObject }.map { entry -> Marked(entry.getValue("flowKey").jsonPrimitive.content, entry.text("legal")) }

    private val mapped: List<Marked> = keyMap.getValue("entries").jsonArray.map { it.jsonObject }
        .mapNotNull { entry -> entry.text("flowKey")?.let { Marked(it, entry.text("legal")) } } + serverComposed

    @Test
    fun `every legal copy key is mapped to an SDK string with its mark, and every mapped flow key is a copy key (C199_1, C199_7)`() {
        assertEquals(true, copyKeys.any { it.legal != null }, "copy-keys.json names no legal key")
        assertEquals(emptyList<String>(), legalKeyProblems(copyKeys, mapped))
    }

    @Test
    fun `the server-composed keys are the SDK's own list, legal, and never an SDK string (C238_3, C238_7)`() {
        assertEquals(SERVER_COMPOSED_COPY_KEYS.sorted(), serverComposed.map { it.key }.sorted())
        assertEquals(true, serverComposed.all { it.legal != null }, "every server-composed key is legal")
        val entries = keyMap.getValue("entries").jsonArray.mapNotNull { it.jsonObject.text("flowKey") }.toSet()
        assertEquals(emptyList<String>(), serverComposed.map { it.key }.filter { it in entries }, "none has an SDK string")
    }

    @Test
    fun `the check finds an unmapped legal key, a mapped key with another mark and a flow key that is not a copy key`() {
        val keys = listOf(Marked("consent.a", "consent"), Marked("notice.b", "notice"), Marked("screen.c", null), Marked("retention.d", "retention"))
        val entries = listOf(Marked("consent.a", "consent"), Marked("notice.b", "consent"), Marked("screen.z", null))

        assertEquals(
            listOf(
                "notice.b: mapped as consent, but its copy key is notice",
                "retention.d: a retention copy key the key map does not map",
                "screen.z: not a copy key",
            ),
            legalKeyProblems(keys, entries),
        )
        assertEquals(emptyList<String>(), legalKeyProblems(keys, keys.filter { it.legal != null }))
    }

    internal companion object {
        /**
         * What is wrong between the exported copy keys and the key map's flow keys, each line naming
         * a key, sorted: a legal copy key no entry maps, an entry whose mark is not its copy key's,
         * and an entry whose flow key is not a copy key.
         */
        fun legalKeyProblems(copyKeys: List<Marked>, mapped: List<Marked>): List<String> {
            val marks = copyKeys.associate { it.key to it.legal }
            val mappedKeys = mapped.map { it.key }.toSet()
            val unmapped = copyKeys.filter { it.legal != null && it.key !in mappedKeys }
                .map { "${it.key}: a ${it.legal} copy key the key map does not map" }
            val wrong = mapped.mapNotNull { entry ->
                when {
                    entry.key !in marks -> "${entry.key}: not a copy key"
                    marks[entry.key] != entry.legal -> "${entry.key}: mapped as ${entry.legal}, but its copy key is ${marks[entry.key]}"
                    else -> null
                }
            }
            return (unmapped + wrong).sorted()
        }
    }
}
