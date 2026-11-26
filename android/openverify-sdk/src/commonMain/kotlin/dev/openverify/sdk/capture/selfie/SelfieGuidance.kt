package dev.openverify.sdk.capture.selfie

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.capture.AutoCapture
import dev.openverify.sdk.capture.CaptureGuidance
import dev.openverify.sdk.face.FaceDetector
import dev.openverify.sdk.face.FaceDetectorFactory
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.model.SelfiePose
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_hold_still
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_look_straight
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_manual
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_multiple_faces
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_no_face
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_off_centre
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_starting
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_too_close
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_too_far
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_turn_left
import dev.openverify.sdk.generated.resources.openverify_selfie_guidance_turn_right
import dev.openverify.sdk.ui.text.Text
import kotlin.concurrent.Volatile
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.TimeSource
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.jetbrains.compose.resources.StringResource

/**
 * What the selfie guidance shows: the [message] on screen now, the settled [announcement] a screen reader
 * hears (C212.2: once per change, never at the frame rate), and whether the shutter is primary.
 */
internal data class SelfieGuidanceView(
    val message: GuidanceMessage,
    val announcement: GuidanceMessage?,
    val shutterPrimary: Boolean,
    /** The prompt's first message, heard until an announcement settles. */
    val initial: GuidanceMessage = message,
)

/**
 * The yaw ratio of the person's own centre frame (C40.11), shared by one capture's prompts: the centre
 * prompt writes the ratio of its latest judged frame, which is the one its photo was taken from when it
 * fires and the last one seen before a manual shutter; the side prompts read it when they start. NaN when
 * unknown (a picked photo, no face), and the side poses are then left to the shutter. A ratio, never a box
 * or landmark (C204.8).
 */
internal class CentreYawRatio {
    @Volatile
    var ratio: Double = Double.NaN
}

/**
 * C204.3 (decision 19): one selfie prompt's guidance, through the capture screen's slots
 * (`capture/CaptureSlots.kt`). With the host's [FaceDetector] (`openverify-face`, C204.2), each
 * analysis frame is turned upright and scaled to the preview width ([YunetTensor]), detected, decoded
 * ([YunetDecoder]) and judged ([GuidanceMachine]) inside its callback; when the pose held for `hold-ms`,
 * the still is requested through [AutoCapture] from that same callback, with no added wait. The analysis
 * frame is 320 px and never uploaded: the upload is the `ImageCapture` still (C201.6), and the server
 * re-judges every photo (C204.7), so the web's rule of uploading the judged frame (KP10-3) does not port.
 *
 * The shutter is always on screen and becomes primary after `manual-shutter-after-ms`, at once when the
 * detector cannot run or the camera gives no frames (C201.3), and after a failed auto-capture, which is
 * not tried again. Time comes from [timeSource].
 *
 * C204.8: frames are read only while this prompt's screen runs it; the tensor, the decoded boxes and the
 * landmarks are wiped before each callback returns, and only the machine's pose state outlives it. Nothing
 * is stored, logged or sent: guidance is never a liveness verdict (C204.7).
 */
internal class SelfieGuidance(
    private val pose: SelfiePose,
    private val thresholds: GuidanceThresholds,
    private val detectors: FaceDetectorFactory,
    /** The capture's centre yaw ratio, shared with its other prompts. */
    internal val centreRatio: CentreYawRatio,
    private val timeSource: TimeSource = TimeSource.Monotonic,
    private val previewWidth: Int = SelfieGuidanceConstants.PREVIEW_WIDTH_PX,
    /** Where a frame's detection runs, off the main thread, inside the frame's callback. */
    private val analysis: CoroutineContext = Dispatchers.Default,
) : CaptureGuidance {
    private val tensor = YunetTensor()
    private val decoder = YunetDecoder()
    private val faces = FaceBuffer()
    private val lock = Mutex()
    private val primary = MutableStateFlow(false)
    private val shown = MutableStateFlow(SelfieGuidanceView(GuidanceMachine.instruction(pose), null, false))

    /** The message the prompt's machine started with. */
    private var initial = GuidanceMachine.instruction(pose)

    /** The machine of the prompt, made when [run] starts (null before). */
    private var machine: GuidanceMachine? = null

    /** Once the still was requested, frames are no longer judged. */
    private var fired = false

    /** The auto-capture took its still. */
    private var taken = false

    /** Set by [close]: a run that has not started yet runs nothing. */
    @Volatile
    private var closed = false

    /** What the overlay shows now. */
    val view: StateFlow<SelfieGuidanceView> = shown.asStateFlow()

    override val shutterPrimary: StateFlow<Boolean> = primary.asStateFlow()

    override suspend fun run(frames: Flow<AnalysisFrame>, autoCapture: AutoCapture) {
        if (closed) return
        val start = timeSource.markNow()
        val now = { start.elapsedNow().inWholeMilliseconds }
        // A detector may load its model on creation: off the main thread too.
        val detector = withContext(analysis) {
            try {
                detectors.create()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // C204.6: a detector that cannot start leaves the person the shutter, as without one.
                SdkLog.log("selfie.detector_unavailable")
                null
            }
        }
        val centreYaw = if (pose == SelfiePose.CENTER) Double.NaN else centreRatio.ratio
        val status = if (detector == null) DetectorStatus.UNAVAILABLE else DetectorStatus.READY
        val machine = GuidanceMachine(pose, now(), status, centreYaw, thresholds)
        lock.withLock {
            this.machine = machine
            initial = machine.message
            publish(machine)
        }
        if (detector == null) return
        try {
            coroutineScope {
                val ticker = launch {
                    // Time passes without frames too: the shutter's promotion and the announcements settle.
                    while (true) {
                        delay(TICK)
                        lock.withLock {
                            machine.tick(now())
                            publish(machine)
                        }
                    }
                }
                var seen = false
                frames.collect { frame ->
                    seen = true
                    onFrame(frame, detector, machine, now, autoCapture)
                }
                ticker.cancel()
                // C201.3: frames ended (none at all, or the camera stopped) before a still was taken: the
                // shutter decides.
                lock.withLock {
                    if (!seen) machine.detectorChanged(now(), DetectorStatus.UNAVAILABLE)
                    if (!taken) primary.value = true
                    publish(machine)
                }
            }
        } finally {
            lock.withLock { wipe() }
            detector.close()
        }
    }

    /** One frame's callback: detect, decode, judge, and request the still when the pose held. */
    private suspend fun onFrame(
        frame: AnalysisFrame,
        detector: FaceDetector,
        machine: GuidanceMachine,
        now: () -> Long,
        autoCapture: AutoCapture,
    ) {
        lock.withLock {
            if (fired || closed || machine.detector != DetectorStatus.READY) return
            // The frame is valid only inside this callback, so the work moves threads here, never the flow
            // (`FrameRelay.frames`); the callback waits for it.
            withContext(analysis) { judge(frame, detector, machine, now) }
            if (!machine.autoCapture) return
            fired = true
            // C204.3: the still from the callback in which the machine fired; a failed one promotes the shutter.
            taken = autoCapture.takeStill()
            if (!taken) {
                primary.value = true
                publish(machine)
            }
        }
    }

    /** Detects, decodes and judges one frame, and wipes everything of it before returning (C204.8). */
    private suspend fun judge(frame: AnalysisFrame, detector: FaceDetector, machine: GuidanceMachine, now: () -> Long) {
        try {
            if (!tensor.fill(frame, previewWidth)) {
                machine.tick(now())
                return
            }
            val outputs = try {
                detector.detect(tensor.data, tensor.paddedWidth, tensor.paddedHeight)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // The detector is not used again; the person takes the photo with the shutter.
                SdkLog.log("selfie.detector_failed")
                machine.detectorChanged(now(), DetectorStatus.UNAVAILABLE)
                return
            }
            tensor.wipe()
            decoder.decode(outputs, tensor.paddedWidth, tensor.paddedHeight, faces)
            machine.faces(now(), faces, tensor.width, tensor.height)
            if (pose == SelfiePose.CENTER) centreRatio.ratio = machine.yawRatio
        } finally {
            wipe()
            publish(machine)
        }
    }

    /** C204.8: nothing of the frame is left: the tensor, the candidates and the faces are zeroed. */
    private fun wipe() {
        tensor.wipe()
        decoder.wipe()
        faces.clear()
    }

    private fun publish(machine: GuidanceMachine) {
        if (machine.manualShutter) primary.value = true
        val next = SelfieGuidanceView(machine.message, machine.announcement, primary.value, initial)
        if (next != shown.value) shown.value = next
    }

    /** Whether no frame data is left in this guidance's buffers (C204.8's check). */
    internal fun holdsNoFrame(): Boolean =
        tensor.data.all { it == 0f } && decoder.isWiped() && faces.isWiped()

    @Composable
    override fun Overlay(modifier: Modifier) {
        val current by view.collectAsState()
        SelfieGuidanceOverlay(current, modifier)
    }

    override fun close() {
        closed = true
    }

    internal companion object {
        /** The ticker's period: one guidance frame's time at `guidance-hz`. */
        val TICK = (1_000 / SelfieGuidanceConstants.GUIDANCE_HZ).milliseconds
    }
}

/** The string of a guidance [message]. Left and right are the person's own sides, whatever the layout direction (C204.3). */
internal fun guidanceText(message: GuidanceMessage): StringResource = when (message) {
    GuidanceMessage.STARTING -> Res.string.openverify_selfie_guidance_starting
    GuidanceMessage.MANUAL -> Res.string.openverify_selfie_guidance_manual
    GuidanceMessage.NO_FACE -> Res.string.openverify_selfie_guidance_no_face
    GuidanceMessage.MULTIPLE_FACES -> Res.string.openverify_selfie_guidance_multiple_faces
    GuidanceMessage.TOO_FAR -> Res.string.openverify_selfie_guidance_too_far
    GuidanceMessage.TOO_CLOSE -> Res.string.openverify_selfie_guidance_too_close
    GuidanceMessage.OFF_CENTRE -> Res.string.openverify_selfie_guidance_off_centre
    GuidanceMessage.LOOK_STRAIGHT -> Res.string.openverify_selfie_guidance_look_straight
    GuidanceMessage.TURN_LEFT -> Res.string.openverify_selfie_guidance_turn_left
    GuidanceMessage.TURN_RIGHT -> Res.string.openverify_selfie_guidance_turn_right
    GuidanceMessage.HOLD_STILL -> Res.string.openverify_selfie_guidance_hold_still
}

/** Test tags of the selfie guidance's overlay. */
internal object SelfieGuidanceTags {
    const val HINT: String = "openverify_selfie_guidance_hint"
}

/**
 * C204.3, C212.2: the hint over the preview, at the bottom of the oval. The text follows every frame,
 * but what a screen reader hears is the settled [SelfieGuidanceView.announcement] (the prompt's first
 * message until one settles), in a polite live region, so each change is announced once and never
 * at 8 Hz. The text never mirrors: the front camera's preview is mirrored for display only (C201.4).
 */
@Composable
internal fun SelfieGuidanceOverlay(view: SelfieGuidanceView, modifier: Modifier = Modifier) {
    val text = sdkString(guidanceText(view.message))
    val heard = sdkString(guidanceText(view.announcement ?: view.initial))
    Box(modifier = modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.BottomCenter) {
        Text(
            text = text,
            color = Color.White,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier
                .background(Color.Black.copy(alpha = 0.66f), RoundedCornerShape(12.dp))
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .testTag(SelfieGuidanceTags.HINT)
                .clearAndSetSemantics {
                    contentDescription = heard
                    liveRegion = LiveRegionMode.Polite
                },
        )
    }
}
