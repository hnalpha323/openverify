package dev.openverify.sdk.events

import dev.openverify.sdk.CaptureFailureReason
import dev.openverify.sdk.FailureReason
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.InquiryResultKind
import dev.openverify.sdk.OpenVerifyEvent
import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FlowError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.ScreenStep
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

/**
 * C192 (decision 5): the events the flow tells an installed listener, for UI coordination only. With
 * no listener no event object is built; a listener's exception is caught and dropped; a step is named
 * by its flow-spec type, never its id (Phase 9 C151.8: step ids can reveal a path).
 */
internal class FlowEventsTest {

    private val received = mutableListOf<OpenVerifyEvent>()
    private val tracker = FlowEventTracker(INQUIRY_ID, FlowEvents({ received += it }))

    private val consent = ConsentStep("intro-consent-7", listOf("consent.biometric"), required = true)
    private val id = (DEFAULT_FLOW.steps[1] as GovernmentIdStep).copy(id = "id-route-b")

    @Test
    fun `with no listener no event object is built`() {
        var built = 0
        val events = FlowEvents(listener = null)

        events.emit {
            built += 1
            OpenVerifyEvent.Waiting
        }

        assertEquals(0, built)
    }

    @Test
    fun `an installed listener receives each event once, through the delivery`() {
        val deliveries = mutableListOf<() -> Unit>()
        val events = FlowEvents({ received += it }, deliver = { deliveries += it })

        events.emit { OpenVerifyEvent.Started(INQUIRY_ID) }

        assertEquals(emptyList<OpenVerifyEvent>(), received)
        deliveries.single()()
        assertEquals(listOf<OpenVerifyEvent>(OpenVerifyEvent.Started(INQUIRY_ID)), received)
    }

    @Test
    fun `a listener's exception is caught and dropped, and the next event still reaches it`() {
        var calls = 0
        val events = FlowEvents({
            calls += 1
            if (calls == 1) throw IllegalStateException("the host's own bug")
        })

        events.emit { OpenVerifyEvent.Waiting }
        events.emit { OpenVerifyEvent.Waiting }

        assertEquals(2, calls)
    }

    @Test
    fun `the flow starts once`() {
        tracker.started()
        tracker.started()

        assertEquals(listOf<OpenVerifyEvent>(OpenVerifyEvent.Started(INQUIRY_ID)), received)
    }

    @Test
    fun `each step shown is named by its type once, however many states it shows`() {
        listOf(
            FlowState.Loading,
            FlowState.Consent(consent),
            FlowState.Consent(consent, submitting = true),
            FlowState.Loading,
            FlowState.Capture(id, FileKind.FRONT, index = 0, count = 2),
            FlowState.Capture(id, FileKind.BACK, index = 1, count = 2),
            FlowState.Screen(ScreenStep("about-you", emptyList())),
            FlowState.Screen(ScreenStep("contact-details", emptyList())),
            FlowState.Completed(CompletionStep("done-path-a"), InquiryStatus.COMPLETED),
        ).forEach(tracker::onState)

        assertEquals(
            listOf("consent", "government_id", "screen", "screen", "completion").map(OpenVerifyEvent::StepShown),
            received,
        )
    }

    @Test
    fun `the server deciding is one Waiting per wait`() {
        listOf(
            FlowState.Processing(id),
            FlowState.Processing(id),
            FlowState.Capture(id, FileKind.FRONT, index = 0, count = 2),
            FlowState.Waiting(retryAfterMs = 2_000),
            FlowState.Waiting(retryAfterMs = 2_000),
        ).forEach(tracker::onState)

        assertEquals(listOf(OpenVerifyEvent.Waiting, OpenVerifyEvent.StepShown("government_id"), OpenVerifyEvent.Waiting), received)
    }

    @Test
    fun `a failure step is shown by its type, a failed inquiry without one and the error screens are not steps`() {
        listOf(
            FlowState.Failed(null, InquiryStatus.FAILED),
            FlowState.Error(FlowError.NETWORK, canRetry = true),
            FlowState.Unsupported("step nfc"),
            FlowState.Failed(FailureStep("declined-route"), InquiryStatus.FAILED),
        ).forEach(tracker::onState)

        assertEquals(listOf<OpenVerifyEvent>(OpenVerifyEvent.StepShown("failure")), received)
    }

    @Test
    fun `a submission the server accepted names the step's type`() {
        tracker.submitted(FlowState.Consent(consent, submitting = true))
        tracker.submitted(FlowState.Processing(id))
        tracker.submitted(FlowState.Loading)

        assertEquals(listOf("consent", "government_id").map(OpenVerifyEvent::Submitted), received)
    }

    @Test
    fun `the camera's answer is told once, and a failed photo by its closed reason`() {
        tracker.cameraGranted()
        tracker.cameraGranted()
        tracker.captureFailed(CaptureFailureReason.OUT_OF_MEMORY)

        assertEquals(
            listOf(OpenVerifyEvent.CameraPermission(granted = true), OpenVerifyEvent.CaptureFailed(CaptureFailureReason.OUT_OF_MEMORY)),
            received,
        )
    }

    @Test
    fun `the flow ends once, by the result's kind only`() {
        tracker.ended(InquiryResult.Failed(INQUIRY_ID, FailureReason.FLOW_HALTED))
        tracker.ended(InquiryResult.Canceled(INQUIRY_ID))

        assertEquals(listOf<OpenVerifyEvent>(OpenVerifyEvent.Ended(InquiryResultKind.FAILED)), received)
    }

    @Test
    fun `each result maps onto its kind`() {
        val kinds = listOf(
            InquiryResult.Completed(INQUIRY_ID, InquiryStatus.NEEDS_REVIEW),
            InquiryResult.Failed(null, FailureReason.INVALID_REQUEST),
            InquiryResult.Canceled(null),
        ).map { result ->
            val events = mutableListOf<OpenVerifyEvent>()
            FlowEventTracker(INQUIRY_ID, FlowEvents({ events += it })).ended(result)
            events.single()
        }

        assertEquals(listOf(InquiryResultKind.COMPLETED, InquiryResultKind.FAILED, InquiryResultKind.CANCELED).map(OpenVerifyEvent::Ended), kinds)
    }

    @Test
    fun `no event names a step id`() {
        tracker.started()
        listOf(FlowState.Consent(consent), FlowState.Capture(id, FileKind.FRONT, 0, 2), FlowState.Screen(ScreenStep("about-you", emptyList())))
            .forEach { tracker.onState(it); tracker.submitted(it) }

        val text = received.joinToString()
        listOf("intro-consent-7", "id-route-b", "about-you").forEach { assertFalse(it in text, text) }
    }

    @Test
    fun `the step type of each state that shows or works on a step`() {
        assertEquals("consent", stepTypeOf(FlowState.Consent(consent)))
        assertEquals("government_id", stepTypeOf(FlowState.AwaitingCamera(id)))
        assertEquals("government_id", stepTypeOf(FlowState.Processing(id)))
        assertEquals("screen", stepTypeOf(FlowState.Screen(ScreenStep("about-you", emptyList()))))
        assertEquals(null, stepTypeOf(FlowState.Loading))
        assertEquals(null, stepTypeOf(FlowState.Completed(null, InquiryStatus.COMPLETED)))
    }

    private companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
    }
}
