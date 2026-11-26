package dev.openverify.sdk.flow.logic

import dev.openverify.sdk.fixtures.readContractFixture
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.boolean
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * C196.4 (decision 9; reviews F10, V12): the Kotlin evaluator passes every case of
 * `contracts/fixtures/flow-spec/visibility-vectors.json`, which api-android-10a's assert-only test
 * writes from Phase 9's `evaluateVisibility`; each refusal there (`VisibilityRuleError`) is a
 * [VisibilityRuleRefused] here. Read through [readContractFixture], so it runs on the iOS simulator
 * in the next release too.
 */
internal class VisibilityVectorsTest {

    private val vectors = Json.parseToJsonElement(readContractFixture("flow-spec/visibility-vectors.json")).jsonObject

    private fun JsonObject.rule(): JsonObject? = get("rule")?.takeUnless { it is JsonNull }?.jsonObject

    private fun JsonObject.values(): Map<String, kotlinx.serialization.json.JsonElement?> = getValue("values").jsonObject

    private fun JsonObject.name(): String = getValue("name").jsonPrimitive.content

    @Test
    fun everyCaseGivesTheServersAnswer() {
        val cases = vectors.getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 40, "the exported cases: ${cases.size}")
        val wrong = cases.mapNotNull { case ->
            val expected = case.getValue("result").jsonPrimitive.boolean
            val answer = runCatching { evaluateVisibility(case.rule(), case.values()) }
            if (answer.getOrNull() == expected) null else "${case.name()}: $answer, expected $expected"
        }
        assertEquals(emptyList(), wrong)
    }

    @Test
    fun everyRefusalIsRefused() {
        val refusals = vectors.getValue("refusals").jsonArray.map { it.jsonObject }
        assertTrue(refusals.size >= 20, "the exported refusals: ${refusals.size}")
        val accepted = refusals.mapNotNull { case ->
            val answer = runCatching { evaluateVisibility(case.rule(), case.values()) }
            if (answer.exceptionOrNull() is VisibilityRuleRefused) null else "${case.name()}: $answer"
        }
        assertEquals(emptyList(), accepted)
    }
}
