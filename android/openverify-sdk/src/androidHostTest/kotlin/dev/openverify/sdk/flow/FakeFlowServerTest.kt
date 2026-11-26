package dev.openverify.sdk.flow

import dev.openverify.sdk.flow.FakeFlowServer.Position
import dev.openverify.sdk.flow.FakeFlowServer.State
import dev.openverify.sdk.model.DeviceHandoffStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowSessionSignals
import dev.openverify.sdk.model.FlowSignals
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import dev.openverify.sdk.camera.CapturedImage
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * The fake Phase 9 server (review F03): a step list in, the positions and client views a Phase 9
 * server serves out after each exit, so a coordinator test changes its fixture line, not its
 * assertions. Its rules are the engine's for a linear flow (`apps/api/src/flow-engine/exits.ts`): a
 * consent exits when it is recorded; a verification step when its verification is decided passed,
 * skipped or in review; one that ended without passing ends the flow there when the inquiry fails;
 * a terminal step is `ended`; a `device_handoff` step is skipped for an SDK session (C221.13).
 */
internal class FakeFlowServerTest {

    private val steps = FakeFlowApi.DEFAULT_FLOW.steps
    private val consent = steps[0].id
    private val id = steps[1].id
    private val selfie = steps[2].id
    private val done = steps.last().id

    @Test
    fun `the default flow moves from consent through each verification to its completion`() = runTest {
        val server = FakeFlowServer()

        server.getSession()
        assertEquals(Position(consent, State.ACTIVE, previousStepId = null), server.served.last())
        assertEquals(steps[0], server.currentStep())

        server.acceptConsent(listOf("consent.biometric"), "en")
        server.getSession()
        assertEquals(Position(id, State.ACTIVE, previousStepId = consent), server.served.last())

        val ver = server.createVerification(VerificationType.GOVERNMENT_ID)
        server.uploadFile(ver.id, FileKind.FRONT, CapturedImage(byteArrayOf(1, 2, 3), "image/jpeg"))
        server.submitVerification(ver.id)
        server.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        server.getVerification(ver.id)
        server.getSession()
        assertEquals(Position(selfie, State.ACTIVE, previousStepId = id), server.served.last())
    }

    @Test
    fun `a failed verification that fails the inquiry ends the flow on its step`() = runTest {
        val server = FakeFlowServer(consent = dev.openverify.sdk.model.FlowConsent(FakeFlowApi.NOW))
        val ver = server.createVerification(VerificationType.GOVERNMENT_ID)
        server.uploadFile(ver.id, FileKind.FRONT, CapturedImage(byteArrayOf(1, 2, 3), "image/jpeg"))
        server.submitVerification(ver.id)
        server.decide(VerificationStatus.FAILED, InquiryStatus.FAILED)
        server.getVerification(ver.id)

        server.getSession()

        assertEquals(Position(id, State.ENDED, previousStepId = consent), server.served.last())
    }

    @Test
    fun `a completed inquiry is ended on its completion step`() = runTest {
        val server = FakeFlowServer(steps = listOf(steps[0], steps.last()), consent = dev.openverify.sdk.model.FlowConsent(FakeFlowApi.NOW))

        server.getSession()

        assertEquals(Position(done, State.ENDED, previousStepId = consent), server.served.last())
        assertEquals(steps.last(), server.currentStep())
    }

    @Test
    fun `an SDK session passes a device_handoff step, as a Phase 10 server does (C221_13)`() = runTest {
        val server = FakeFlowServer(steps = listOf(steps[0], DeviceHandoffStep("handoff")) + steps.drop(1))
        server.acceptConsent(listOf("consent.biometric"), "en")

        server.getSession()

        assertEquals(Position(id, State.ACTIVE, previousStepId = consent), server.served.last())
    }

    @Test
    fun `a scripted wait or halt is served as it is`() = runTest {
        val server = FakeFlowServer()
        server.scripted = Position("check", State.WAITING, previousStepId = consent, retryAfterMs = 2000)

        server.getSession()

        assertEquals(Position("check", State.WAITING, previousStepId = consent, retryAfterMs = 2000), server.served.last())
        assertNull(server.currentStep())
    }

    @Test
    fun `the tiers are served only once consent is recorded, and signal bodies are recorded`() = runTest {
        val tiers = FlowSessionSignals(integrity = true, recognition = false)
        val server = FakeFlowServer(signals = tiers)

        assertNull(server.getSession().signals)
        server.acceptConsent(listOf("consent.biometric"), "en")
        assertEquals(tiers, server.getSession().signals)

        val body = FlowSignals(collectorVersion = 1, screen = consent, sequence = 0)
        server.sendSignals(body)
        assertEquals(listOf(body), server.sentSignals)
        assertEquals("sendSignals", server.calls.last())
    }

    @Test
    fun `the session carries the position, the client view and spec 2, as a Phase 9 server serves a spec-2 client`() = runTest {
        val server = FakeFlowServer()
        server.handoffContext = dev.openverify.sdk.model.FlowHandoffContext("Example Org", listOf("selfie"), FakeFlowApi.NOW)

        val session = server.getSession()

        assertEquals(dev.openverify.sdk.model.FlowPosition(consent, dev.openverify.sdk.model.FlowPositionState.ACTIVE, null), session.position)
        assertEquals(steps[0], session.step)
        assertEquals(2, session.specVersion)
        assertEquals("Example Org", session.handoffContext?.organizationDisplayName)
    }
}
