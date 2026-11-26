package dev.openverify.sdk.flow

import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.FlowPosition
import dev.openverify.sdk.model.FlowPositionState
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.ScreenStep
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource

/**
 * C193.2, C193.3: what the server's position names. The SDK requires `spec-version: 2` and a
 * `position`; a decided inquiry shows its end whatever the position says, as the web flow does;
 * otherwise `active` renders the client view through the registry, `waiting` waits, `halted` stops
 * and `ended` shows the inquiry's end. Nothing here walks `flow.steps` or evaluates a transition.
 */
internal class ServerPositionTest {

    private val v2: FlowSession = OpenVerifyJson.decodeFromString(Fixtures.read("api/flow-session-v2.json"))
    private val v1: FlowSession = OpenVerifyJson.decodeFromString(Fixtures.read("api/flow-session.json"))
    private val pending = v2.copy(inquiry = v2.inquiry.copy(status = InquiryStatus.PENDING))

    private fun at(state: FlowPositionState, step: dev.openverify.sdk.model.FlowStep?, retryAfterMs: Int? = null) =
        pending.copy(position = FlowPosition(step?.id, state, "consent", retryAfterMs), step = step)

    @Test
    fun `a session with spec 2 and a position is driven by it`() {
        assertTrue(ServerPosition.drives(v2))
        assertFalse(ServerPosition.drives(v1))
        assertFalse(ServerPosition.drives(v2.copy(position = null)))
        assertFalse(ServerPosition.drives(v2.copy(specVersion = 1)))
    }

    @Test
    fun `an answer without spec 2 and a position is the unsupported screen that names the older server (C193_2)`() {
        val expected = PositionRendering.Shown(FlowState.Unsupported(ServerPosition.SERVER_BEFORE_SPEC_2))

        assertEquals(expected, ServerPosition.render(v1.copy(inquiry = v1.inquiry.copy(status = InquiryStatus.PENDING))))
        assertEquals(expected, ServerPosition.render(pending.copy(position = null)))
        assertEquals(expected, ServerPosition.render(pending.copy(specVersion = 1)))
    }

    @Test
    fun `an active position runs consent and the verification steps in the coordinator`() {
        val consent = ConsentStep("consent", listOf("consent.biometric"), true)
        val id = GovernmentIdStep(id = "id_card", sides = dev.openverify.sdk.model.DocumentSides.FRONT, maxAttempts = 3, captureMethods = listOf(dev.openverify.sdk.model.CaptureMethod.CAMERA))

        assertEquals(PositionRendering.Run(consent), ServerPosition.render(at(FlowPositionState.ACTIVE, consent)))
        assertEquals(PositionRendering.Run(id), ServerPosition.render(at(FlowPositionState.ACTIVE, id)))
    }

    @Test
    fun `an active screen is shown with its values`() {
        val screen = v2.step as ScreenStep

        assertEquals(PositionRendering.Shown(FlowState.Screen(screen, v2.values.orEmpty())), ServerPosition.render(pending.withPublishedCopy()))
    }

    @Test
    fun `an active position without a client view is unsupported, never skipped`() {
        assertEquals(PositionRendering.Shown(FlowState.Unsupported("step none")), ServerPosition.render(at(FlowPositionState.ACTIVE, null)))
    }

    @Test
    fun `a wait polls after the server's retry-after-ms, and names no step (C197_1)`() {
        assertEquals(PositionRendering.Wait(1500), ServerPosition.render(at(FlowPositionState.WAITING, null, retryAfterMs = 1500)))
        assertEquals(PositionRendering.Wait(null), ServerPosition.render(at(FlowPositionState.WAITING, null)))
    }

    @Test
    fun `a halted position is the halted screen (C197_2)`() {
        assertEquals(PositionRendering.Shown(FlowState.Halted), ServerPosition.render(at(FlowPositionState.HALTED, v2.step)))
    }

    @Test
    fun `an ended position shows the end it names, with the inquiry's status`() {
        val done = CompletionStep("done", "flow.completion")
        val failed = FailureStep("failed", "flow.failure")

        assertEquals(PositionRendering.Shown(FlowState.Completed(done, InquiryStatus.PENDING)), ServerPosition.render(at(FlowPositionState.ENDED, done)))
        assertEquals(PositionRendering.Shown(FlowState.Failed(failed, InquiryStatus.PENDING)), ServerPosition.render(at(FlowPositionState.ENDED, failed)))
        // The person's part ended elsewhere (a step the inquiry ended on): completion, which reveals no decision.
        assertEquals(PositionRendering.Shown(FlowState.Completed(null, InquiryStatus.PENDING)), ServerPosition.render(at(FlowPositionState.ENDED, v2.step)))
    }

    @ParameterizedTest
    @EnumSource(InquiryStatus::class, names = ["COMPLETED", "APPROVED", "DECLINED", "NEEDS_REVIEW"])
    fun `a finished inquiry shows completion whatever the position says, and never reveals the decision`(status: InquiryStatus) {
        val done = CompletionStep("done", "flow.completion")
        val finished = { s: FlowSession -> s.copy(inquiry = s.inquiry.copy(status = status)) }

        assertEquals(PositionRendering.Shown(FlowState.Completed(done, status)), ServerPosition.render(finished(at(FlowPositionState.ENDED, done))))
        assertEquals(PositionRendering.Shown(FlowState.Completed(null, status)), ServerPosition.render(finished(pending)))
        // A decided inquiry the engine never positioned has no position: its end, not the older-server screen.
        assertEquals(PositionRendering.Shown(FlowState.Completed(null, status)), ServerPosition.render(finished(pending.copy(position = null, step = null))))
    }

    @Test
    fun `a failed inquiry shows the failed screen, with the failure step when the position names one`() {
        val failed = FailureStep("failed", "flow.failure")
        val failedInquiry = { s: FlowSession -> s.copy(inquiry = s.inquiry.copy(status = InquiryStatus.FAILED)) }

        assertEquals(PositionRendering.Shown(FlowState.Failed(failed, InquiryStatus.FAILED)), ServerPosition.render(failedInquiry(at(FlowPositionState.ENDED, failed))))
        assertEquals(PositionRendering.Shown(FlowState.Failed(null, InquiryStatus.FAILED)), ServerPosition.render(failedInquiry(at(FlowPositionState.ENDED, v2.step))))
    }

    @Test
    fun `an expired inquiry is the expired screen`() {
        assertEquals(PositionRendering.Shown(FlowState.Expired), ServerPosition.render(pending.copy(inquiry = pending.inquiry.copy(status = InquiryStatus.EXPIRED))))
    }

    @Test
    fun `operator copy with a legal key the SDK cannot place renders the step unsupported, never the SDK's own words (C199_7)`() {
        val copy = dev.openverify.sdk.model.FlowCopy(mapOf("en" to mapOf("retention.notice" to "synthetic operator text", "screen.continue" to "Go")))
        val rules = dev.openverify.sdk.i18n.COPY_KEY_RULES + ("retention.notice" to dev.openverify.sdk.i18n.CopyKeyRule(emptyList(), dev.openverify.sdk.i18n.LegalKind.RETENTION))
        val review = { c: dev.openverify.sdk.model.FlowCopy? -> dev.openverify.sdk.i18n.reviewCopy(c, rules) }

        assertEquals(PositionRendering.Shown(FlowState.Unsupported("copy retention.notice")), ServerPosition.render(pending.copy(copy = copy), review))
        // With the default rules every legal key is placed, so the same session renders.
        assertEquals(PositionRendering.Shown(FlowState.Screen(v2.step as ScreenStep, v2.values.orEmpty())), ServerPosition.render(pending.copy(copy = copy).withPublishedCopy()))
    }

    @Test
    fun `a position state from a newer server is unsupported`() {
        assertEquals(PositionRendering.Shown(FlowState.Unsupported("position unknown")), ServerPosition.render(at(FlowPositionState.UNKNOWN, v2.step)))
    }
}
