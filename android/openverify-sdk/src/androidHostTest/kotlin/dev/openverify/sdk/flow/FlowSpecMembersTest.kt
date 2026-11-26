package dev.openverify.sdk.flow

import dev.openverify.sdk.model.FlowComponentSerializer
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * C194.4 (review H03): every member of every client view in Phase 9's export
 * (`contracts/fixtures/flow-spec/client-view-members.json`, asserted from the zod schemas by
 * `packages/contracts`) has exactly one Android treatment in `flow-spec-members.json`, and every
 * step type and component kind of the export is one the SDK decodes and registers.
 */
internal class FlowSpecMembersTest {

    private val export = OpenVerifyJson.parseToJsonElement(Fixtures.read("flow-spec/client-view-members.json")).jsonObject
    private val members = OpenVerifyJson.parseToJsonElement(File("flow-spec-members.json").readText()).jsonObject

    private fun names(element: kotlinx.serialization.json.JsonElement?): List<String> =
        element?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty().sorted()

    private fun problemsOf(entry: JsonObject, where: String): List<String> = buildList {
        val treatment = entry["treatment"]?.jsonPrimitive?.content
        if (treatment !in setOf("honoured", "ignored", "server-only")) add("$where: treatment $treatment")
        if (entry["contract"]?.jsonPrimitive?.content.isNullOrBlank()) add("$where: no contract")
        if (treatment != "honoured" && entry["reason"]?.jsonPrimitive?.content.isNullOrBlank()) add("$where: no reason")
        if (entry["addedAfterSpec2"]?.jsonPrimitive?.boolean == true &&
            (entry["appearanceOnly"] == null || entry["appearanceReason"] == null)
        ) {
            add("$where: added after spec 2 without its appearance-only classification")
        }
    }

    @Test
    fun `every session member is treated, with an object member's own members (C194_4)`() {
        val exported = export.getValue("session").jsonObject
        val listed = members.getValue("session").jsonObject

        assertEquals(exported.keys.sorted(), listed.keys.sorted())
        val problems = exported.flatMap { (member, nested) ->
            val entry = listed.getValue(member).jsonObject
            val own = entry["members"]?.jsonObject
            problemsOf(entry, member) +
                (if (names(nested) == own?.keys.orEmpty().sorted()) emptyList() else listOf("$member: members ${own?.keys} for ${names(nested)}")) +
                own.orEmpty().flatMap { (inner, value) -> problemsOf(value.jsonObject, "$member.$inner") }
        }
        assertEquals(emptyList<String>(), problems)
    }

    @Test
    fun `every member of every step type and component kind is treated (C194_4)`() {
        val problems = listOf("steps", "components").flatMap { group ->
            val exported = export.getValue(group).jsonObject
            val listed = members.getValue(group).jsonObject
            (if (exported.keys == listed.keys) emptyList() else listOf("$group: ${listed.keys} for ${exported.keys}")) +
                exported.flatMap { (name, nested) ->
                    val entries = listed[name]?.jsonObject.orEmpty()
                    (if (names(nested) == entries.keys.sorted()) emptyList() else listOf("$group.$name: ${entries.keys} for ${names(nested)}")) +
                        entries.flatMap { (member, value) -> problemsOf(value.jsonObject, "$group.$name.$member") }
                }
        }
        assertEquals(emptyList<String>(), problems)
    }

    @Test
    fun `every exported step type is registered and every component kind decodes (C194_1, C194_3)`() {
        assertEquals(export.getValue("steps").jsonObject.keys.sorted(), CLIENT_STEP_TYPES.sorted())
        assertEquals(CLIENT_STEP_TYPES.toSet(), StepRegistry.renderers.keys)
        assertEquals(export.getValue("components").jsonObject.keys.sorted(), FlowComponentSerializer.kinds.sorted())
    }

    @Test
    fun `no component has a style member while K9-4 keeps overrides dormant (10A decision 4)`() {
        assertTrue(export.getValue("components").jsonObject.values.none { "style" in names(it) })
    }
}
