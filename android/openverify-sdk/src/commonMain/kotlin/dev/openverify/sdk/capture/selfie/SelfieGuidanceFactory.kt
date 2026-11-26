package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.capture.CaptureGuidance
import dev.openverify.sdk.capture.CaptureGuidanceFactory
import dev.openverify.sdk.face.FaceDetectorFactory
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.SelfieCaptureGuidance
import dev.openverify.sdk.model.SelfiePose
import kotlin.time.TimeSource

/**
 * C204.3, C204.6: the selfie owner's [CaptureGuidanceFactory]. A selfie pose's prompt, while its preview
 * is shown, gets a [SelfieGuidance] when the host installed a [FaceDetectorFactory] (`openverify-face`)
 * and the open capture's server [guidance] (C40.2) is known; every other state goes to [next] (the
 * document and barcode guidance), and without a detector a selfie keeps today's manual shutter with the
 * server's prompts. One factory serves one launch, so the person's centre yaw ratio passes from the
 * centre prompt to the side prompts of the same capture ([CentreYawRatio]).
 */
internal class SelfieGuidanceFactory(
    private val detectors: FaceDetectorFactory?,
    /** The open capture's thresholds: [SelfieCaptureWindow.guidance] of the coordinator's window. */
    private val guidance: () -> SelfieCaptureGuidance?,
    private val next: CaptureGuidanceFactory? = null,
    private val timeSource: TimeSource = TimeSource.Monotonic,
) : CaptureGuidanceFactory {
    private val centre = CentreYawRatio()

    override fun create(state: FlowState.Capture): CaptureGuidance? {
        if (!state.isSelfie) return next?.create(state)
        if (state.image != null) return null
        val factory = detectors ?: return null
        val thresholds = guidance()?.let(GuidanceThresholds::of) ?: return null
        val pose = when (state.kind) {
            FileKind.SELFIE_LEFT -> SelfiePose.LEFT
            FileKind.SELFIE_RIGHT -> SelfiePose.RIGHT
            else -> SelfiePose.CENTER
        }
        return SelfieGuidance(pose, thresholds, factory, centre, timeSource)
    }
}
