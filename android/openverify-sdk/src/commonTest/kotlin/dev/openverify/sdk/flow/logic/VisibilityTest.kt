package dev.openverify.sdk.flow.logic

import dev.openverify.sdk.model.FlowValue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * C196.1 (Phase 9 C148.4): hand cases from Phase 9's own rules (`visibility.ts` and its test),
 * written before the exported vectors land; [VisibilityVectorsTest] runs those.
 */
internal class VisibilityTest {

    private fun rule(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

    private val values: Map<String, JsonElement?> = mapOf(
        "country" to JsonPrimitive("US"),
        "has_middle_name" to JsonPrimitive(false),
        "interests" to JsonArray(listOf(JsonPrimitive("music"), JsonPrimitive("art"))),
        "age" to JsonPrimitive(0),
    )

    private fun holds(json: String): Boolean = evaluateVisibility(rule(json), values)

    private fun refusal(json: String): String = assertFailsWith<VisibilityRuleRefused> { holds(json) }.code

    @Test
    fun anAbsentRuleHolds() {
        assertTrue(evaluateVisibility(null, emptyMap()))
    }

    @Test
    fun comparesStrictlyWithDoubleEqualsReadAsTripleEquals() {
        assertTrue(holds("""{"===": [{"var": "screen.country"}, "US"]}"""))
        assertFalse(holds("""{"==": [{"var": "screen.age"}, "0"]}"""))
        assertTrue(holds("""{"==": [{"var": "screen.age"}, 0]}"""))
        assertTrue(holds("""{"===": [{"var": "screen.age"}, 0.0]}"""), "a number is its value, 0 and 0.0 alike")
        assertTrue(holds("""{"!==": [{"var": "screen.country"}, "CA"]}"""))
        assertFalse(holds("""{"===": [{"var": "screen.interests"}, ["music", "art"]]}"""), "two lists are never equal")
        assertTrue(holds("""{"!==": [{"var": "screen.interests"}, ["music", "art"]]}"""))
        assertFalse(holds("""{"===": [true, "true"]}"""), "a boolean is not its text")
        assertTrue(holds("""{"===": [null, null]}"""))
    }

    @Test
    fun readsAFieldWithNoValueAsNullNeverAsAnotherField() {
        assertTrue(holds("""{"===": [{"var": "screen.missing"}, null]}"""))
        assertTrue(holds("""{"!": [{"var": "screen.missing"}]}"""))
        assertTrue(holds("""{"===": [{"var": "screen.constructor"}, null]}"""))
        assertTrue(evaluateVisibility(rule("""{"===": [{"var": "screen.age"}, null]}"""), mapOf("age" to null)))
        assertTrue(evaluateVisibility(rule("""{"===": [{"var": "screen.age"}, null]}"""), mapOf("age" to JsonNull)))
    }

    @Test
    fun usesJsonLogicTruthinessAnEmptyListIsFalse() {
        assertFalse(holds("""{"!!": [{"var": "screen.has_middle_name"}]}"""))
        assertTrue(holds("""{"!": {"var": "screen.age"}}"""))
        assertFalse(holds("""{"!!": [[]]}"""))
        assertTrue(holds("""{"!!": [["x"]]}"""))
        assertTrue(holds("""{"and": [true, {"var": "screen.country"}]}"""))
        assertFalse(holds("""{"and": [{"var": "screen.age"}, true]}"""))
        assertTrue(holds("""{"or": [false, "", {"var": "screen.country"}]}"""))
        assertFalse(holds("""{"or": [false, 0]}"""))
        assertFalse(holds("""{"!!": [""]}"""))
        assertTrue(holds("""{"!!": ["0"]}"""), "a non-empty string is true")
        assertFalse(holds("""{"!!": [null]}"""))
    }

    @Test
    fun testsMembershipWithInOverAListOrInsideAString() {
        assertTrue(holds("""{"in": ["music", {"var": "screen.interests"}]}"""))
        assertFalse(holds("""{"in": ["sport", {"var": "screen.interests"}]}"""))
        assertTrue(holds("""{"in": [{"var": "screen.country"}, ["US", "CA"]]}"""))
        assertTrue(holds("""{"in": ["S", {"var": "screen.country"}]}"""))
        assertFalse(holds("""{"in": [1, {"var": "screen.country"}]}"""))
        assertFalse(holds("""{"in": ["x", {"var": "screen.missing"}]}"""))
        assertTrue(holds("""{"in": [1, [1, 2]]}"""))
        assertFalse(holds("""{"in": ["1", [1, 2]]}"""), "membership is strict")
        assertFalse(holds("""{"in": [{"var": "screen.interests"}, ["music", "art"]]}"""), "a list is never a member")
        assertEquals(VisibilityRuleRefused.RULE_INVALID, refusal("""{"in": ["music", [["music"]]]}"""), "a literal list holds scalars only")
    }

    @Test
    fun refusesEveryOperatorOutsideTheSubsetAndEveryMalformedNode() {
        val invalid = listOf(
            """{"!=": [{"var": "screen.age"}, 1]}""",
            """{"<": [{"var": "screen.age"}, 18]}""",
            """{"if": [true, true, false]}""",
            """{"var": ["screen.age", 3]}""",
            """{"var": 7}""",
            """{"===": [{"var": "screen.age"}]}""",
            """{"!": [true, false]}""",
            """{"and": []}""",
            """{"in": [{"var": "screen.age"}, {"!!": true}]}""",
            """{"===": [{"a": 1}, 1]}""",
            """{"===": [{"var": "screen.age"}, 1], "!": [true]}""",
            """{"in": ["a", [{"var": "screen.age"}]]}""",
            """{}""",
        )
        for (json in invalid) {
            assertEquals(VisibilityRuleRefused.RULE_INVALID, refusal(json), json)
        }
    }

    @Test
    fun refusesAPathOutsideTheScreenAndEveryServerFact() {
        for (path in listOf(
            "verifications.id_card.status",
            "signals.inquiry/bot_score",
            "inquiry.fields.country",
            "inquiry.status",
            "screen",
            "screen.country.length",
            "screen.Country",
            "screen.1st",
            "screen.country\n",
            "screen." + "a".repeat(65),
            "country",
        )) {
            val json = buildJsonObject { put("!!", buildJsonObject { put("var", path) }) }
            val refused = assertFailsWith<VisibilityRuleRefused>(path) { evaluateVisibility(JsonObject(mapOf("and" to JsonArray(listOf(JsonPrimitive(true), json)))), values) }
            assertEquals(VisibilityRuleRefused.SCOPE_INVALID, refused.code, path)
        }
        assertTrue(evaluateVisibility(rule("""{"===": [{"var": "screen.${"a".repeat(64)}"}, null]}"""), emptyMap()), "64 characters is the longest field key")
    }

    @Test
    fun refusesARulePastItsDepthOrSizeLimit() {
        var deep = """{"!!": {"var": "screen.age"}}"""
        repeat(VisibilityRuleLimits.DEPTH) { deep = """{"!": [$deep]}""" }
        assertEquals(VisibilityRuleRefused.RULE_INVALID, refusal(deep))
        var fits = """{"!!": {"var": "screen.age"}}"""
        repeat(VisibilityRuleLimits.DEPTH - 2) { fits = """{"!": [$fits]}""" }
        holds(fits)
        val wide = """{"or": [${List(VisibilityRuleLimits.NODES) { "true" }.joinToString(",")}]}"""
        assertEquals(VisibilityRuleRefused.RULE_INVALID, refusal(wide))
        val narrow = """{"or": [${List(VisibilityRuleLimits.NODES - 1) { "false" }.joinToString(",")}]}"""
        assertFalse(holds(narrow))
    }

    @Test
    fun theRefusalNamesNoPartOfTheRule() {
        val refused = assertFailsWith<VisibilityRuleRefused> { holds("""{"<": [{"var": "screen.secret_field"}, "canary-synthetic"]}""") }
        assertEquals("Visibility rule refused: visibility_rule_invalid", refused.message)
    }

    @Test
    fun aScreenValueReadsAsTheWebFlowReadsIt() {
        assertEquals(JsonPrimitive("US"), visibilityValueOf(FlowValue.Text("US")))
        assertEquals(JsonNull, visibilityValueOf(FlowValue.Text("")), "an empty text reads null, as the web's visibilityValues")
        assertEquals(JsonPrimitive(3.5), visibilityValueOf(FlowValue.Number(3.5)))
        assertEquals(JsonPrimitive(true), visibilityValueOf(FlowValue.Bool(true)))
        assertEquals(JsonArray(listOf(JsonPrimitive("a"))), visibilityValueOf(FlowValue.Texts(listOf("a"))))
        assertEquals(JsonNull, visibilityValueOf(FlowValue.Empty))
        assertEquals(JsonNull, visibilityValueOf(null))
        assertEquals(buildJsonObject { put("set", true) }, visibilityValueOf(FlowValue.Set))
        val set = mapOf("ssn" to visibilityValueOf(FlowValue.Set))
        assertTrue(evaluateVisibility(rule("""{"!!": {"var": "screen.ssn"}}"""), set), "a value the server holds is truthy")
        assertFalse(evaluateVisibility(rule("""{"===": [{"var": "screen.ssn"}, true]}"""), set), "and never equal to a literal")
    }
}
