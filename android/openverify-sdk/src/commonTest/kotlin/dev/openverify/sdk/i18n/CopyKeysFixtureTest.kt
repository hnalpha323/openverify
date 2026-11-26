package dev.openverify.sdk.i18n

import dev.openverify.sdk.fixtures.readContractFixture
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * C199.7 (decision 13; review H16): every `COPY_KEYS` entry, exported by api-android-10a to
 * `contracts/fixtures/i18n/copy-keys.json`, runs through the mapping. The SDK's rules are the
 * server's (placeholders and legal mark), each key is placed by the key map, ignored, or (a legal
 * key the key map does not place) renders the step unsupported, and the component attributes and
 * their placeholder are the server's.
 */
internal class CopyKeysFixtureTest {

    private val fixture = Json.parseToJsonElement(readContractFixture("i18n/copy-keys.json")).jsonObject
    private val keys = fixture.getValue("keys").jsonObject

    @Test
    fun theSdksRulesAreTheExportedCopyKeys() {
        val exported = keys.mapValues { (_, entry) ->
            val rule = entry.jsonObject
            CopyKeyRule(
                placeholders = rule.getValue("placeholders").jsonArray.map { it.jsonPrimitive.content },
                legal = rule.getValue("legal").takeUnless { it is JsonNull }?.jsonPrimitive?.content?.let { wire -> LegalKind.entries.single { it.wire == wire } },
            )
        }
        assertEquals(exported, COPY_KEY_RULES, "the same keys and rules, in any order")
        assertEquals(fixture.getValue("legalKinds").jsonArray.map { it.jsonPrimitive.content }, LegalKind.entries.map { it.wire })
        assertEquals(fixture.getValue("componentAttributes").jsonArray.map { it.jsonPrimitive.content }, COMPONENT_COPY_ATTRIBUTES)
    }

    @Test
    fun everyExportedKeyIsPlacedIgnoredOrUnsupportedByItsLegalMark() {
        val wrong = keys.keys.mapNotNull { key ->
            val placement = placeCopyKey(key)
            val mapped = SDK_COPY_KEYS.filterValues { it == key }.keys.sorted()
            val expected = when {
                // C238.3, C238.7 (Workflow 11A): the server composes these into the view.
                key.startsWith("share.consent.") -> CopyKeyPlacement.ServerComposed
                mapped.isNotEmpty() -> CopyKeyPlacement.Placed(mapped)
                COPY_KEY_RULES.getValue(key).legal != null -> CopyKeyPlacement.Unsupported(COPY_KEY_RULES.getValue(key).legal!!)
                else -> CopyKeyPlacement.Ignored
            }
            if (placement == expected) null else "$key: $placement, expected $expected"
        }
        assertEquals(emptyList(), wrong)
        assertEquals(emptyList(), keys.keys.filter { placeCopyKey(it) is CopyKeyPlacement.Unsupported }, "today every legal key is placed")
    }
}
