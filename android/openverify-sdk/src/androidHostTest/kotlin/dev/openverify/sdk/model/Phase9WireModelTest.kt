package dev.openverify.sdk.model

import dev.openverify.sdk.flow.withPublishedCopy
import dev.openverify.sdk.InquiryOutcomes
import dev.openverify.sdk.FailureReason
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.StepRegistry
import dev.openverify.sdk.flow.StepRendering
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * Phase 9's session members as the SDK decodes them (C151.5-C151.8, C160.7, C162.3, C162.6;
 * Workflow 10A Stage 1a (R)), over the golden `api/flow-session-v2.json` and the screen of
 * `flows/v2/every-step.json`, which holds every kind of the catalogue.
 */
internal class Phase9WireModelTest {

    private val session = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session-v2.json"))

    @Test
    fun `the golden v2 session decodes its position, client view, values, theme, copy and locales`() {
        assertEquals(FlowPosition("extra_details", FlowPositionState.ACTIVE, previousStepId = "id_card"), session.position)
        assertEquals(2, session.specVersion)
        val screen = session.step as ScreenStep
        assertEquals("extra_details", screen.id)
        assertEquals(listOf("text", "text_input", "masked_text", "button"), screen.components.map { it.kind })
        assertEquals(FlowValue.Text("Sam"), session.values?.get("nickname"))
        assertEquals(FlowValue.Set, session.values?.get("tax_number"))
        assertEquals("auto", session.theme?.mode)
        assertEquals("#1f4fd1", session.theme?.light?.get("primary"))
        assertEquals(FlowThemeFont("system", platforms = listOf("web", "android")), session.theme?.font)
        assertEquals("A few more details", session.copy?.messages?.get("en")?.get("extra_details.title.body"))
        assertEquals(FlowLocales(listOf("en", "es"), "en"), session.locales)
        assertEquals(FlowCompletion(null), session.completion)
    }

    @Test
    fun `a session from before Phase 9 decodes with none of them (C193_2)`() {
        val old = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session.json"))

        assertEquals(null, old.position)
        assertEquals(null, old.step)
        assertEquals(null, old.specVersion)
    }

    @Test
    fun `every component of the every-step screen decodes as its own kind (C148, C194_3)`() {
        val flow = OpenVerifyJson.parseToJsonElement(Fixtures.read("flows/v2/every-step.json")).jsonObject
        val screens = flow.getValue("steps").jsonArray.map { it.jsonObject }.filter { it["type"].toString() == "\"screen\"" }
        val components = screens.flatMap {
            OpenVerifyJson.decodeFromJsonElement(ListSerializer(FlowComponent.serializer()), it.getValue("components"))
        }
        fun all(list: List<FlowComponent>): List<FlowComponent> =
            list.flatMap { c -> listOf(c) + all((c as? ContainerComponent)?.children ?: (c as? FooterComponent)?.children.orEmpty()) }

        assertTrue(all(components).none { it is UnsupportedComponent }, all(components).toString())
        assertEquals(FlowComponentSerializer.kinds, all(components).map { it.kind }.toSet())
    }

    @Test
    fun `a component kind or a member value this SDK cannot use is unsupported, never an error (C194_3)`() {
        val list = OpenVerifyJson.decodeFromString(
            ListSerializer(FlowComponent.serializer()),
            """[{"id":"x","kind":"signature_pad"},{"id":"y","kind":"stepper","labelKeys":"not-a-list","current":0}]""",
        )

        assertEquals(listOf(UnsupportedComponent("x", "signature_pad"), UnsupportedComponent("y", "stepper")), list)
    }

    @Test
    fun `a value never shows itself, and the server's set marker is never sent (C151_5, P16)`() {
        assertFalse("Sam" in session.values.toString(), session.values.toString())
        assertThrows<SerializationException> { OpenVerifyJson.encodeToString(FlowValue.serializer(), FlowValue.Set) }
        assertEquals("[\"a\",\"b\"]", OpenVerifyJson.encodeToString(FlowValue.serializer(), FlowValue.Texts(listOf("a", "b"))))
    }

    @Test
    fun `a position state from a newer server is unknown, not an error`() {
        val position = OpenVerifyJson.decodeFromString<FlowPosition>("""{"step-id":null,"state":"paused","previous-step-id":null}""")

        assertEquals(FlowPositionState.UNKNOWN, position.state)
    }

    @Test
    fun `the registry renders the session's screen with its values, and no view as unsupported, naming the type only (C194_1)`() {
        // Workflow 10A android-driver: the skeleton's screen is now rendered (C195); StepRegistryTest has the rest.
        assertEquals(StepRendering.Shown(FlowState.Screen(session.step as dev.openverify.sdk.model.ScreenStep, session.values.orEmpty())), StepRegistry.render(session.step, session.withPublishedCopy()))
        assertEquals(StepRendering.Shown(FlowState.Unsupported("step none")), StepRegistry.render(null, session))
    }

    @Test
    fun `a halted flow ends as FLOW_HALTED, and a wait or a screen left early is canceled (C197)`() {
        val id = session.inquiry.id

        assertEquals(InquiryResult.Failed(id, FailureReason.FLOW_HALTED), InquiryOutcomes.forFinish(FlowState.Halted, id))
        assertEquals(InquiryResult.Canceled(id), InquiryOutcomes.forFinish(FlowState.Waiting(2000), id))
        assertEquals(InquiryResult.Canceled(id), InquiryOutcomes.forFinish(FlowState.Screen(session.step as ScreenStep), id))
    }

    @Test
    fun `the session's organization display name decodes, and earlier sessions have none (C200_2, C221_12)`() {
        val named = OpenVerifyJson.decodeFromString<FlowSession>(Fixtures.read("api/flow-session-organization.json"))

        assertEquals("Example Org", named.organizationDisplayName)
        assertEquals(null, session.organizationDisplayName)
    }
}
