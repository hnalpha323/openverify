package dev.openverify.sdk.flow

import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ComponentOption
import dev.openverify.sdk.model.ContainerComponent
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.FlowComponent
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FooterComponent
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.SelectComponent
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.UnsupportedComponent
import dev.openverify.sdk.model.UnsupportedStep
import dev.openverify.sdk.ui.screen.screenUnsupportedReason
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

/**
 * C194.1, C194.2 (decision 8): the registry renders every client-view type of flow-spec 2. Consent
 * and the verification steps run in the coordinator; a screen, a completion and a failure are shown
 * from their client views; `nfc` (10C) and `device_handoff` (skipped by the server for an SDK
 * session) are the unsupported screen, as is any type outside the registry. A screen the screen
 * model cannot render whole is unsupported as a whole (C194.3, C195.9).
 */
internal class StepRegistryTest {

    private val session: FlowSession = OpenVerifyJson.decodeFromString(Fixtures.read("api/flow-session-v2.json"))

    private fun text(id: String) = TextComponent(id, "body", "$id.text")

    private fun screen(vararg components: FlowComponent) = ScreenStep("details", components.toList())

    @ParameterizedTest
    @ValueSource(
        strings = [
            "consent", "government_id", "selfie", "document", "phone_otp", "email_otp", "database", "aamva",
            "crypto_wallet", "database_business", "business_website",
            // Workflow 10C (C207): the nfc step runs in the coordinator too (NfcStepHooksTest).
            "nfc",
        ],
    )
    fun `consent and every verification step run in the coordinator (C193_4)`(type: String) {
        assertEquals(StepRendering.Run, StepRegistry.renderers.getValue(type).render(UnsupportedStep("step", type), session))
    }

    @ParameterizedTest
    @ValueSource(strings = ["device_handoff"])
    fun `a device_handoff step served anyway is the unsupported screen, naming the type only`(type: String) {
        assertEquals(StepRendering.Shown(FlowState.Unsupported("step $type")), StepRegistry.renderers.getValue(type).render(UnsupportedStep("step", type), session))
    }

    @Test
    fun `a type outside the registry, a view that failed to decode, and no view are the unsupported screen`() {
        assertEquals(StepRendering.Shown(FlowState.Unsupported("step form")), StepRegistry.render(UnsupportedStep("details", "form"), session))
        assertEquals(StepRendering.Shown(FlowState.Unsupported("step selfie")), StepRegistry.render(UnsupportedStep("face", "selfie"), session))
        assertEquals(StepRendering.Shown(FlowState.Unsupported("step none")), StepRegistry.render(null, session))
    }

    @Test
    fun `a screen is shown with the values the session binds on it (C151_5)`() {
        val step = screen(text("intro"))
        val values = mapOf("name_first" to FlowValue.Text("Alex"), "tax_id" to FlowValue.Set)

        assertEquals(StepRendering.Shown(FlowState.Screen(step, values)), StepRegistry.render(step, session.copy(step = step, values = values).withPublishedCopy()))
        assertEquals(StepRendering.Shown(FlowState.Screen(step)), StepRegistry.render(step, session.copy(step = step, values = null).withPublishedCopy()))
    }

    @Test
    fun `a completion or failure step the position names is shown with the inquiry's status`() {
        val done = CompletionStep("done", "flow.completion")
        val failed = FailureStep("failed", "flow.failure")
        val pending = session.copy(inquiry = session.inquiry.copy(status = InquiryStatus.PENDING))

        assertEquals(StepRendering.Shown(FlowState.Completed(done, InquiryStatus.PENDING)), StepRegistry.render(done, pending))
        assertEquals(StepRendering.Shown(FlowState.Failed(failed, InquiryStatus.PENDING)), StepRegistry.render(failed, pending))
    }

    @Test
    fun `a screen the SDK cannot render whole is unsupported as a whole, for the screen model's reason (C194_3, C195_9)`() {
        // android-screens' screenUnsupportedReason judges a screen (a later kind, C148.6's caps, a
        // refused visibility rule); the registry turns its reason into the state, so leaving ends
        // UNSUPPORTED_FLOW and no part of the screen is ever shown.
        val screens = listOf(
            screen(text("intro"), ButtonComponent("go", "go.label", action = "submit")),
            screen(text("intro"), UnsupportedComponent("rating", "star_rating")),
            screen(ContainerComponent("box", "vertical", listOf(FooterComponent("foot", listOf(UnsupportedComponent("x", "later")))))),
            screen(*Array(41) { text("t$it") }),
            screen(box(box(box(box(text("leaf")))))),
            screen(select(1_001)),
            screen(select(1_000)),
        )

        for (step in screens) {
            val expected = screenUnsupportedReason(step)?.let(FlowState::Unsupported) ?: FlowState.Screen(step)
            assertEquals(StepRendering.Shown(expected), StepRegistry.render(step, session.copy(values = null).withPublishedCopy(listOf(step))), step.components.toString())
        }
    }

    @Test
    fun `the registry holds exactly the client-view step types`() {
        assertEquals(CLIENT_STEP_TYPES.toSet(), StepRegistry.renderers.keys)
    }

    private fun box(vararg children: FlowComponent): FlowComponent = ContainerComponent("box${children.size}${children.hashCode()}", "vertical", children.toList())

    private fun select(count: Int) = SelectComponent(
        id = "pick",
        field = "pick",
        labelKey = "pick.label",
        options = List(count) { ComponentOption("o$it", "v$it", "pick.o$it") },
    )
}
