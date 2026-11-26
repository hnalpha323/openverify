package dev.openverify.sdk.events

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.CaptureFailureReason
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.InquiryResultKind
import dev.openverify.sdk.OpenVerifyEvent
import dev.openverify.sdk.OpenVerifyEventListener
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.AnalysisTarget
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CameraLens
import dev.openverify.sdk.camera.CaptureCamera
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.camera.isOutOfMemory
import dev.openverify.sdk.consent.ConsentEvidence
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowChipSubmit
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FlowVerification
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow

/**
 * C192 (decision 5): delivers [OpenVerifyEvent]s to the host's [listener] through [deliver], which
 * runs a delivery on the main thread (Android's is `MainThreadDelivery`). With no listener no event
 * is built; an exception the listener throws is caught and dropped (with a constant log code), so it
 * never stops the flow. Events are for UI coordination and may be missed (process death, a crash):
 * the server is the source of truth.
 */
internal class FlowEvents(
    private val listener: OpenVerifyEventListener?,
    private val deliver: (() -> Unit) -> Unit = { it() },
) {
    /** Builds the event with [build] and delivers it, only when a listener is installed. */
    fun emit(build: () -> OpenVerifyEvent) {
        val target = listener ?: return
        val event = build()
        deliver {
            try {
                target.onEvent(event)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                SdkLog.log("events.listener_failed")
            }
        }
    }
}

/**
 * C192.2: turns what the flow does on this device into events: [started] once; [onState] for each
 * state the coordinator shows, naming a step by its flow-spec type only when a new step is shown (its
 * id is compared here and never leaves this object, Phase 9 C151.8), and one `Waiting` per wait while
 * the server decides; [submitted] after a step's submission was accepted; the camera's answer once;
 * a failed photo by its closed reason; and [ended] once, by the result's kind only.
 */
internal class FlowEventTracker(private val inquiryId: String, private val events: FlowEvents) {
    private var startedTold = false
    private var endedTold = false
    private var cameraTold = false
    private var shownStepId: String? = null
    private var waiting = false

    fun started() {
        if (startedTold) return
        startedTold = true
        events.emit { OpenVerifyEvent.Started(inquiryId) }
    }

    fun onState(state: FlowState) {
        if (state == FlowState.Loading) return
        if (state is FlowState.Waiting || state is FlowState.Processing) {
            if (!waiting) events.emit { OpenVerifyEvent.Waiting }
            waiting = true
            return
        }
        waiting = false
        val step = shownStepOf(state) ?: return
        if (step.id == shownStepId) return
        shownStepId = step.id
        val type = step.type
        events.emit { OpenVerifyEvent.StepShown(type) }
    }

    /** A submission of the step [state] shows or works on was accepted by the server. */
    fun submitted(state: FlowState) {
        val type = stepTypeOf(state) ?: return
        events.emit { OpenVerifyEvent.Submitted(type) }
    }

    /** The camera can be shown: the person granted its permission (or had granted it before). */
    fun cameraGranted() {
        if (cameraTold) return
        cameraTold = true
        events.emit { OpenVerifyEvent.CameraPermission(granted = true) }
    }

    /**
     * KP10-14: the person refused the camera at the system prompt. Told once per refusal (each is its
     * own answer); the grant is told once, by [cameraGranted].
     */
    fun cameraDenied() = events.emit { OpenVerifyEvent.CameraPermission(granted = false) }

    fun captureFailed(reason: CaptureFailureReason) = events.emit { OpenVerifyEvent.CaptureFailed(reason) }

    fun ended(result: InquiryResult) {
        if (endedTold) return
        endedTold = true
        val kind = when (result) {
            is InquiryResult.Completed -> InquiryResultKind.COMPLETED
            is InquiryResult.Failed -> InquiryResultKind.FAILED
            is InquiryResult.Canceled -> InquiryResultKind.CANCELED
        }
        events.emit { OpenVerifyEvent.Ended(kind) }
    }
}

/** The step a state shows the person, or `null` for a state that shows none (loading, an error, an end without a step). */
private fun shownStepOf(state: FlowState): FlowStep? = when (state) {
    is FlowState.Consent -> state.step
    is FlowState.Capture -> state.step
    is FlowState.AwaitingCamera -> state.step
    is FlowState.Screen -> state.step
    is FlowState.Otp -> state.step
    is FlowState.Form -> state.step
    is FlowState.Document -> state.step
    is FlowState.CryptoWallet -> state.step
    is FlowState.Nfc -> state.step
    is FlowState.Completed -> state.step
    is FlowState.Failed -> state.step
    else -> null
}

/** The flow-spec type of the step [state] shows or works on, or `null` for a state that shows none. */
internal fun stepTypeOf(state: FlowState): String? = when (state) {
    is FlowState.Processing -> state.step.type
    else -> shownStepOf(state)?.type
}

/**
 * The [FlowApi] the coordinator talks to, observed for the chrome and the events: [onSession] sees
 * every session the server answers (a read, a screen submission's), and [onSubmitted] each submission
 * the server accepted (a consent, a verification submit, a wallet signature, a chip submit, a screen). A call that
 * fails is not one. It changes no call or answer, and no failure but a consent's mismatch
 * ([acceptConsent]).
 */
internal class ObservedFlowApi(
    private val api: FlowApi,
    private val onSession: (FlowSession) -> Unit,
    private val onSubmitted: () -> Unit,
) : FlowApi by api {
    override suspend fun getSession(): FlowSession = api.getSession().also(onSession)

    /**
     * An accepted consent is a submission (C192.2). A refused one (C200.5's 422
     * `consent_text_mismatch` among them) reaches the coordinator as it is, which shows the consent
     * again with its changed-text notice (KP10-6).
     */
    override suspend fun acceptConsent(textKeys: List<String>, locale: String, optionalTextKeys: List<String>, evidence: ConsentEvidence): FlowConsent =
        api.acceptConsent(textKeys, locale, optionalTextKeys, evidence).also { onSubmitted() }

    override suspend fun submitVerification(verificationId: String, capture: FlowSubmitCapture?): FlowVerification =
        api.submitVerification(verificationId, capture).also { onSubmitted() }

    override suspend fun submitCryptoSignature(verificationId: String, crypto: FlowCryptoSubmit): FlowVerification =
        api.submitCryptoSignature(verificationId, crypto).also { onSubmitted() }

    /** C207.1 (Workflow 10C): an accepted chip submit is a submission, as every other step's (C192.2). */
    override suspend fun submitChip(verificationId: String, chip: FlowChipSubmit): FlowVerification =
        api.submitChip(verificationId, chip).also { onSubmitted() }

    override suspend fun submitScreen(stepId: String, values: Map<String, FlowValue>, button: String?): FlowSession =
        api.submitScreen(stepId, values, button).also {
            onSession(it)
            onSubmitted()
        }
}

/**
 * The camera the capture screens use, reporting a photo it could not take to [tracker] (C192.2's
 * `CaptureFailed`: out of memory, or any other camera error), and a preview that could bind no use
 * case at all (`CAMERA_UNAVAILABLE`, KP10-14), once per failed bind. The failure itself goes on
 * unchanged; a cancellation is no failure.
 */
internal class EventingCaptureCamera(private val camera: CaptureCamera, private val tracker: FlowEventTracker) : CaptureCamera {
    init {
        camera.reportUnavailableTo { tracker.captureFailed(CaptureFailureReason.CAMERA_UNAVAILABLE) }
    }

    @Composable
    override fun Preview(lens: CameraLens, modifier: Modifier) = camera.Preview(lens, modifier)

    @Composable
    override fun Preview(lens: CameraLens, analysis: AnalysisTarget, modifier: Modifier) = camera.Preview(lens, analysis, modifier)

    /** C201.1: the wrapped camera's analysis frames, unchanged (the events never read a frame). */
    override fun frames(): Flow<AnalysisFrame> = camera.frames()

    override suspend fun takePicture(): CapturedImage = try {
        camera.takePicture()
    } catch (failure: Throwable) {
        when {
            failure is CancellationException -> Unit
            isOutOfMemory(failure) -> tracker.captureFailed(CaptureFailureReason.OUT_OF_MEMORY)
            failure is Exception -> tracker.captureFailed(CaptureFailureReason.CAMERA_ERROR)
        }
        throw failure
    }

    override fun deviceFacts(): CameraFacts? = camera.deviceFacts()
}
