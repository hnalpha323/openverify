package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.flow.FakeFlowServer.Position
import dev.openverify.sdk.flow.FakeFlowServer.State
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.ProblemFieldError
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.SelfieStep
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.TextInputComponent
import dev.openverify.sdk.model.UnsupportedStep
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.time.Duration.Companion.seconds

/**
 * C193.2-C193.6 (ADR 0008, 0009): the driver renders the step the server's position names from its
 * client view and reads the session after every exit it reports; it never advances on its own (no
 * list order, no transition, no attempt count decides the next step). The cases below also replace
 * Phase 9's `FlowCoordinatorProjectionTest` (decision 73), over the same projection fixtures'
 * positions: a linear flow, a branch to a screen or to completion, an exhausted government ID with
 * its fallback, a step without a v1 form.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class FlowDriverTest {

    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)
    private val photo = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg")
    private val pdf = PickedDocument(DocumentFile("%PDF-1.7\n%synthetic\n".encodeToByteArray(), "application/pdf"), "proof.pdf", 20)

    private val consent = DEFAULT_FLOW.steps[0] as ConsentStep
    private val idCard = GovernmentIdStep("id_card", DocumentSides.FRONT, maxAttempts = 1, captureMethods = listOf(CaptureMethod.CAMERA))
    private val face = SelfieStep("face", listOf(dev.openverify.sdk.model.SelfiePose.CENTER), dev.openverify.sdk.model.Liveness.PASSIVE, 1)
    private val proof = DocumentStep("proof", listOf(DocumentClass.UTILITY_BILL), listOf(CaptureMethod.UPLOAD), maxAttempts = 1)
    private val done = CompletionStep("done")
    private val details = ScreenStep(
        "extra_details",
        listOf(
            TextComponent("intro", "body", "extra_details.intro.text"),
            TextInputComponent("nickname", "nickname", "extra_details.nickname.label"),
            ButtonComponent("go", "extra_details.go.label", "submit"),
        ),
    )

    private suspend fun coordinator(api: FlowApi) = FlowCoordinator(api, INQUIRY_ID, settings).also { it.cameraReady() }

    /** What the test saw, in order: each session answer with the position served, and each state. */
    private sealed interface Seen {
        data class Read(val stepId: String?) : Seen
        data class Shown(val state: FlowState) : Seen
    }

    /** The server, recording each session it answers (a read or a screen submission's answer). */
    private fun watched(server: FakeFlowServer, seen: MutableList<Seen>) = object : FlowApi by server {
        override suspend fun getSession(): FlowSession = server.getSession().also { seen += Seen.Read(it.position?.stepId) }

        override suspend fun submitScreen(stepId: String, values: Map<String, FlowValue>, button: String?): FlowSession =
            server.submitScreen(stepId, values, button).also { seen += Seen.Read(it.position?.stepId) }
    }

    private fun TestScope.record(coordinator: FlowCoordinator, seen: MutableList<Seen>) {
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { coordinator.state.collect { seen += Seen.Shown(it) } }
    }

    private val List<Seen>.states get() = filterIsInstance<Seen.Shown>().map { it.state }

    /** Every `Completed` follows an answer whose position was [completion], and there is one. */
    private fun assertCompletedOnlyAt(seen: List<Seen>, completion: String) {
        val log = seen.joinToString("\n")
        var position: String? = null
        var completed = 0
        for (entry in seen) {
            when (entry) {
                is Seen.Read -> position = entry.stepId
                is Seen.Shown -> if (entry.state is FlowState.Completed) {
                    completed += 1
                    assertEquals(completion, position, "Completed before the server's completion:\n$log")
                }
            }
        }
        assertTrue(completed > 0, "never Completed:\n$log")
    }

    // The requirement (C193.2) -----------------------------------------------------------------

    @Test
    fun `a server before flow-spec 2 shows the unsupported screen that names it, and nothing is created or recorded`() = runTest {
        val api = FakeFlowApi()
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Unsupported(ServerPosition.SERVER_BEFORE_SPEC_2), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    // The position, never the list (C193.3) -------------------------------------------------------

    @Test
    fun `after consent the session is read again and the step its position names is shown, not the next in the list`() = runTest {
        val server = FakeFlowServer(routes = mapOf(consent.id to DEFAULT_FLOW.steps[2].id))
        val coordinator = coordinator(server)
        coordinator.start()

        coordinator.acceptConsent()

        assertEquals(listOf("getSession", "acceptConsent", "getSession", "createVerification:selfie", "createSelfieCapture:camera"), server.calls)
        assertEquals(FileKind.SELFIE_CENTER, (coordinator.state.value as FlowState.Capture).kind)
    }

    @Test
    fun `a relaunch renders the server's position, whatever the verifications would suggest (C193_6)`() = runTest {
        val server = FakeFlowServer(inquiryStatus = InquiryStatus.PENDING, consent = FlowConsent(NOW))
        server.scripted = Position(DEFAULT_FLOW.steps[2].id, State.ACTIVE, previousStepId = consent.id)
        val coordinator = coordinator(server)

        coordinator.start()

        assertEquals(DEFAULT_FLOW.steps[2], (coordinator.state.value as FlowState.Capture).step)
        assertEquals(0, server.calls.count { it == "createVerification:government-id" })
    }

    @Test
    fun `a decided verification whose position has not moved yet is read again, never advanced past by the SDK`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, idCard, done), inquiryStatus = InquiryStatus.PENDING, consent = FlowConsent(NOW))
        server.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(server)
        val seen = mutableListOf<Seen>().also { record(coordinator, it) }
        coordinator.start()
        // The server answers two more reads at the ID before its position moves on.
        repeat(2) { server.upcoming += Position(idCard.id, State.ACTIVE, previousStepId = consent.id) }

        coordinator.capture(photo)
        coordinator.confirmCapture()

        assertEquals(FlowState.Completed(done, InquiryStatus.PENDING), coordinator.state.value)
        assertEquals(1, server.calls.count { it == "createVerification:government-id" })
        assertEquals(listOf(idCard.id, idCard.id, done.id), server.served.map { it.stepId }.drop(1))
        // The ID's camera opened once: after its decision the SDK waited for the position, not a new attempt.
        assertEquals(1, seen.states.filterIsInstance<FlowState.Capture>().count { it.image == null }, seen.toString())
    }

    @Test
    fun `a step the position names that this SDK cannot render is the unsupported screen, and nothing is created`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, UnsupportedStep("continue-1", "server-continuation"), done), consent = FlowConsent(NOW))
        val coordinator = coordinator(server)

        coordinator.start()

        assertEquals(FlowState.Unsupported("step server-continuation"), coordinator.state.value)
        assertEquals(listOf("getSession"), server.calls)
    }

    // Screens (C195.7, C148.5) ----------------------------------------------------------------------

    @Test
    fun `a screen the position names is shown with the values the session binds on it`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, details, done), consent = FlowConsent(NOW))
        server.screenValues[details.id] = mapOf("nickname" to FlowValue.Text("Sam"))
        val coordinator = coordinator(server)

        coordinator.start()

        assertEquals(FlowState.Screen(details, mapOf("nickname" to FlowValue.Text("Sam"))), coordinator.state.value)
    }

    @Test
    fun `a submitted screen sends its values and button and renders the session the route answered, with no other read`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, details, done), inquiryStatus = InquiryStatus.PENDING, consent = FlowConsent(NOW))
        val coordinator = coordinator(server)
        val states = mutableListOf<Seen>().also { record(coordinator, it) }
        coordinator.start()

        coordinator.submitScreen(mapOf("nickname" to FlowValue.Text("Sam")), button = null)

        assertEquals(listOf(FakeFlowApi.ScreenSubmit(details.id, mapOf("nickname" to FlowValue.Text("Sam")), null)), server.screenSubmits)
        assertEquals(listOf("getSession", "submitScreen"), server.calls)
        assertTrue(FlowState.Screen(details, submitting = true) in states.states, states.toString())
        assertEquals(FlowState.Completed(done, InquiryStatus.PENDING), coordinator.state.value)
    }

    @Test
    fun `a screen the server refuses at its fields comes back with them, and keeps no server words`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, details, done), consent = FlowConsent(NOW))
        val refusal = Problem(
            title = "Unprocessable Content",
            status = 422,
            errors = listOf(ProblemFieldError("body", "/values/nickname", "synthetic: too short"), ProblemFieldError("body", "/button", "synthetic: no such button")),
        )
        server.failNext("submitScreen", FlowApiException.Rejected(422, refusal, null))
        val coordinator = coordinator(server)
        coordinator.start()

        coordinator.submitScreen(mapOf("nickname" to FlowValue.Text("S")), button = "skip")

        assertEquals(FlowState.Screen(details, refusedFields = setOf("nickname"), refused = true), coordinator.state.value)
        assertEquals(emptyList<FakeFlowApi.ScreenSubmit>(), server.screenSubmits)
    }

    @Test
    fun `a value the server holds masked is never sent back, and a screen is sent only from its own state`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, details, done), consent = FlowConsent(NOW))
        val coordinator = coordinator(server)

        coordinator.submitScreen(mapOf("nickname" to FlowValue.Text("Sam")), button = null)
        coordinator.start()
        coordinator.submitScreen(mapOf("nickname" to FlowValue.Text("Sam"), "tax_number" to FlowValue.Set), button = "go")

        assertEquals(listOf(FakeFlowApi.ScreenSubmit(details.id, mapOf("nickname" to FlowValue.Text("Sam")), "go")), server.screenSubmits)
    }

    // The projection fixtures' positions (Phase 9 decision 73, replacing FlowCoordinatorProjectionTest) --

    @Test
    fun `(a) a linear flow completes only at the server's completion position (linear-1 to linear-4)`() = runTest {
        val seen = mutableListOf<Seen>()
        val server = FakeFlowServer(steps = listOf(consent, idCard, face, done))
        val coordinator = coordinator(watched(server, seen))
        record(coordinator, seen)

        coordinator.start()
        coordinator.acceptConsent()
        server.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        coordinator.capture(photo)
        coordinator.confirmCapture()
        server.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        coordinator.capture(photo)
        coordinator.confirmCapture()

        assertCompletedOnlyAt(seen, done.id)
        assertEquals(listOf(consent.id, idCard.id, face.id, done.id), seen.filterIsInstance<Seen.Read>().map { it.stepId }.distinct())
        assertEquals(1, server.calls.count { it == "createVerification:selfie" })
    }

    @Test
    fun `(b) a branch that routes to a screen shows the screen there, never the unsupported screen (branch-3-screen)`() = runTest {
        val seen = mutableListOf<Seen>()
        val server = FakeFlowServer(steps = listOf(consent, idCard, done, details), routes = mapOf(idCard.id to details.id))
        val coordinator = coordinator(watched(server, seen))
        record(coordinator, seen)

        coordinator.start()
        coordinator.acceptConsent()
        server.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        coordinator.capture(photo)
        coordinator.confirmCapture()

        assertEquals(FlowState.Screen(details), coordinator.state.value)
        assertEquals(Seen.Read(details.id), seen.filterIsInstance<Seen.Read>().last())
        assertTrue(seen.states.none { it is FlowState.Unsupported || it is FlowState.Completed }, seen.toString())
    }

    @Test
    fun `(b) a branch whose route leads to completion completes only there (branch-3-done)`() = runTest {
        val seen = mutableListOf<Seen>()
        val server = FakeFlowServer(steps = listOf(consent, idCard, details, done), routes = mapOf(idCard.id to done.id))
        val coordinator = coordinator(watched(server, seen))
        record(coordinator, seen)

        coordinator.start()
        coordinator.acceptConsent()
        server.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        coordinator.capture(photo)
        coordinator.confirmCapture()

        assertCompletedOnlyAt(seen, done.id)
        assertTrue(seen.states.none { it is FlowState.Screen }, seen.toString())
    }

    @Test
    fun `(c) a government ID whose attempts are used up follows the server to its exhausted fallback, never waiting for a failure (V02)`() = runTest {
        val seen = mutableListOf<Seen>()
        val server = FakeFlowServer(steps = listOf(consent, idCard, proof, done), routes = mapOf(proof.id to done.id), fallbacks = mapOf(idCard.id to proof.id))
        val coordinator = coordinator(watched(server, seen))
        record(coordinator, seen)

        coordinator.start()
        coordinator.acceptConsent()
        // A failure without a retry hint uses up the step: the server takes its exhausted edge.
        server.decide(VerificationStatus.FAILED, InquiryStatus.PENDING)
        coordinator.capture(photo)
        coordinator.confirmCapture()

        assertEquals(proof, (coordinator.state.value as FlowState.Document).step)
        assertTrue(seen.states.none { it is FlowState.Error }, seen.toString())
        server.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        coordinator.pickDocument(pdf)
        coordinator.submitDocument()
        assertCompletedOnlyAt(seen, done.id)
    }

    @Test
    fun `(c) a fresh start after the fallback was taken on another client runs the fallback and completes only at completion`() = runTest {
        val seen = mutableListOf<Seen>()
        val failedId = verification("ver_01M5CK16P0D13FXHZSS4TCFB90", VerificationType.GOVERNMENT_ID, VerificationStatus.FAILED)
        val server = FakeFlowServer(
            steps = listOf(consent, idCard, proof, done),
            inquiryStatus = InquiryStatus.PENDING,
            consent = FlowConsent(NOW),
            verifications = listOf(failedId),
            routes = mapOf(proof.id to done.id),
            fallbacks = mapOf(idCard.id to proof.id),
        )
        val coordinator = coordinator(watched(server, seen))
        record(coordinator, seen)
        server.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)

        coordinator.start()
        coordinator.pickDocument(pdf)
        coordinator.submitDocument()

        assertCompletedOnlyAt(seen, done.id)
        assertEquals(0, server.calls.count { it == "createVerification:government-id" })
    }

    @Test
    fun `a screen after consent is shown, where Phase 9's projection stopped on the unsupported screen (step-screen)`() = runTest {
        val server = FakeFlowServer(steps = listOf(consent, details, done))
        val coordinator = coordinator(server)

        coordinator.start()
        coordinator.acceptConsent()

        assertEquals(FlowState.Screen(details), coordinator.state.value)
        assertEquals(0, server.calls.count { it.startsWith("createVerification") })
    }
}
