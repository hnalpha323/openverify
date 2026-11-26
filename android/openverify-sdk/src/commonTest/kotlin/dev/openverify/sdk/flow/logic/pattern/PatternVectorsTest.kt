package dev.openverify.sdk.flow.logic.pattern

import dev.openverify.sdk.fixtures.readContractFixture
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * C196.4 (decision 9; reviews F10, V12): the Kotlin matcher passes every vector of
 * `contracts/fixtures/flow-spec/pattern-vectors.json`, which api-android-10a's assert-only test
 * writes from Phase 9's `compilePattern` and `matchPattern`. The pathological vectors are held to
 * the VM's step budget, linear in the input and the program (rule 6: a step count, never the
 * clock). Read through [readContractFixture], so it runs on the iOS simulator in the next release.
 */
internal class PatternVectorsTest {

    private val vectors = Json.parseToJsonElement(readContractFixture("flow-spec/pattern-vectors.json")).jsonObject

    private fun JsonObject.text(key: String): String? = get(key)?.jsonPrimitive?.content

    /** `input`, or `prefix` + `repeat.text` x `repeat.count` + `suffix` (the schema's two forms). */
    private fun JsonObject.input(): String {
        text("input")?.let { return it }
        val repeat = getValue("repeat").jsonObject
        return text("prefix").orEmpty() + repeat.getValue("text").jsonPrimitive.content.repeat(repeat.getValue("count").jsonPrimitive.int) + text("suffix").orEmpty()
    }

    private val matches = vectors.getValue("matches").jsonArray.map { it.jsonObject }

    @Test
    fun everyMatchVectorGivesTheServersAnswer() {
        assertTrue(matches.size > 500, "the exported match vectors: ${matches.size}")
        val wrong = matches.mapNotNull { vector ->
            val source = vector.getValue("pattern").jsonPrimitive.content
            val expected = vector.getValue("matches").jsonPrimitive.boolean
            when (val compiled = compilePattern(source)) {
                is PatternCompilation.Refused -> "$source: refused ${compiled.reason}"
                is PatternCompilation.Compiled ->
                    if (matchPattern(compiled.pattern, vector.input()) == expected) null else "$source on ${vector.input().take(40)}: expected $expected"
            }
        }
        assertEquals(emptyList(), wrong)
    }

    @Test
    fun everyRefusalVectorIsRefusedWithItsReason() {
        val refusals = vectors.getValue("refusals").jsonArray.map { it.jsonObject }
        assertTrue(refusals.size >= 40, "the exported refusals: ${refusals.size}")
        val answers = refusals.map { vector ->
            when (val compiled = compilePattern(vector.getValue("pattern").jsonPrimitive.content)) {
                is PatternCompilation.Compiled -> "compiled"
                is PatternCompilation.Refused -> compiled.reason
            }
        }
        val reasons = refusals.map { it.getValue("reason").jsonPrimitive.content }
        assertEquals(reasons, answers)
        assertEquals(emptyList(), reasons.filter { it !in PATTERN_REFUSAL_REASONS })
    }

    @Test
    fun thePathologicalVectorsStayWithinTheStepBudget() {
        val pathological = matches.filter { it["pathological"]?.jsonPrimitive?.booleanOrNull == true }
        assertTrue(pathological.size >= 6, "the pathological vectors: ${pathological.size}")
        val over = pathological.mapNotNull { vector ->
            val pattern = (compilePattern(vector.getValue("pattern").jsonPrimitive.content) as PatternCompilation.Compiled).pattern
            val input = vector.input()
            val run = runPattern(pattern, input)
            val budget = 4L * (input.length + 1) * (programLength(pattern) + 1)
            if (run.steps <= budget) null else "${pattern.source}: ${run.steps} steps over $budget"
        }
        assertEquals(emptyList(), over)
    }
}
