package dev.openverify.sdk.flow.logic

import dev.openverify.sdk.fixtures.readContractFixture
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * C196.4 (decision 9; reviews F10, V12): [normalizeDigits] gives Phase 9's answer for every case of
 * `contracts/fixtures/flow-spec/digits-vectors.json`, which api-android-10a's assert-only test
 * writes from `normalizeDigits` in `packages/flow-spec`.
 */
internal class DigitsVectorsTest {

    @Test
    fun everyCaseGivesTheServersAnswer() {
        val cases = Json.parseToJsonElement(readContractFixture("flow-spec/digits-vectors.json")).jsonObject.getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 15, "the exported cases: ${cases.size}")
        val wrong = cases.mapIndexedNotNull { index, case ->
            val input = case.getValue("input").jsonPrimitive.content
            val output = case.getValue("output").jsonPrimitive.content
            if (normalizeDigits(input) == output) null else case["name"]?.jsonPrimitive?.content ?: "case $index"
        }
        assertEquals(emptyList(), wrong)
    }
}
