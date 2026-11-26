package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.model.SelfieCaptureGuidance
import dev.openverify.sdk.model.SelfiePose
import kotlin.math.abs

/**
 * C204.1, C204.3: the web flow's `guidance-machine.ts` in Kotlin. Each event (a guidance frame's faces,
 * the detector becoming unavailable, or time passing) moves the machine: the message to show, whether
 * the pose is held, whether to capture now, and whether the shutter is the primary action. It checks a
 * face is found, there is one face, it is centred and at a usable distance, and the pose: the centre
 * once `|yaw ratio|` is at most `center-trigger-factor` × the server's `max-center-yaw-ratio`; a side
 * pose once the yaw ratio changed from the person's own centre frame by `side-trigger-factor` × the
 * server's `min-side-yaw-ratio-change`, in the prompted direction. The pose holds for `hold-ms`. The
 * machine never decides anything: the server re-measures every photo (C204.7).
 *
 * Unlike the web's immutable state, the machine is one mutable object per prompt, so a frame allocates
 * nothing (rule 19); [yawRatio], [centreYawRatio] and [heldSince] use NaN and [NO_TIME] for "none".
 */
internal enum class GuidanceMessage(
    /** The web machine's name for it. */
    val wireName: String,
) {
    /** The detector is still loading. */
    STARTING("starting"),

    /** The detector cannot run: the person takes the photo with the shutter. */
    MANUAL("manual"),
    NO_FACE("no-face"),
    MULTIPLE_FACES("multiple-faces"),
    TOO_FAR("too-far"),
    TOO_CLOSE("too-close"),
    OFF_CENTRE("off-centre"),
    LOOK_STRAIGHT("look-straight"),

    /** The person's own left, never mirrored (C204.3). */
    TURN_LEFT("turn-left"),

    /** The person's own right, never mirrored (C204.3). */
    TURN_RIGHT("turn-right"),

    /** Every check passes: the pose is being held. */
    HOLD_STILL("hold-still"),
}

internal enum class DetectorStatus { LOADING, READY, UNAVAILABLE }

/** The thresholds of one capture: the server's `guidance` (C40.2) with the client constants (C40.11). */
internal class GuidanceThresholds(
    val maxCenterYawRatio: Double,
    val minSideYawRatioChange: Double,
    val holdMs: Long,
    val sideTriggerFactor: Double = SelfieGuidanceConstants.SIDE_TRIGGER_FACTOR,
    val centerTriggerFactor: Double = SelfieGuidanceConstants.CENTER_TRIGGER_FACTOR,
    val manualShutterAfterMs: Long = SelfieGuidanceConstants.MANUAL_SHUTTER_AFTER_MS,
) {
    /** The largest `|yaw ratio|` at which the centre auto-captures. */
    val centreTrigger: Double get() = centerTriggerFactor * maxCenterYawRatio

    /** The smallest yaw-ratio change from the centre frame at which a side pose auto-captures. */
    val sideTrigger: Double get() = sideTriggerFactor * minSideYawRatioChange

    internal companion object {
        /** The thresholds of a capture whose server sent [guidance]. */
        fun of(guidance: SelfieCaptureGuidance): GuidanceThresholds =
            GuidanceThresholds(guidance.maxCenterYawRatio, guidance.minSideYawRatioChange, guidance.holdMs.toLong())
    }
}

/** The guidance of one prompt, from when it appears at [startedAt] (milliseconds on the guidance's clock). */
internal class GuidanceMachine(
    val pose: SelfiePose,
    val startedAt: Long,
    detector: DetectorStatus,
    /** The yaw ratio of the person's own centre frame, which the side poses are judged against; NaN when unknown. */
    val centreYawRatio: Double,
    private val thresholds: GuidanceThresholds,
) {
    var detector: DetectorStatus = detector
        private set

    var message: GuidanceMessage = when (detector) {
        DetectorStatus.UNAVAILABLE -> GuidanceMessage.MANUAL
        DetectorStatus.LOADING -> GuidanceMessage.STARTING
        DetectorStatus.READY -> instruction(pose)
    }
        private set

    /** When [message] last changed. */
    var messageSince: Long = startedAt
        private set

    /** The message a screen reader hears: one that has stayed on screen for a while. */
    var announcement: GuidanceMessage? = null
        private set

    /** Since when every check has passed, or [NO_TIME]. */
    var heldSince: Long = NO_TIME
        private set

    /** The yaw ratio of the latest well-placed single face, or NaN. */
    var yawRatio: Double = Double.NaN
        private set

    var manualShutter: Boolean = detector == DetectorStatus.UNAVAILABLE
        private set

    /** The pose was held for `hold-ms`: take the photo. Once true, it stays. */
    var autoCapture: Boolean = false
        private set

    /** Time passed. */
    fun tick(now: Long) {
        settle(message, now)
        updateManualShutter(now)
    }

    /** The detector became ready or unavailable. */
    fun detectorChanged(now: Long, status: DetectorStatus) {
        detector = status
        settle(if (status == DetectorStatus.UNAVAILABLE) GuidanceMessage.MANUAL else message, now)
        updateManualShutter(now)
    }

    /** The faces of one guidance frame of [frameWidth] × [frameHeight], as the decoder left them. */
    fun faces(now: Long, faces: FaceBuffer, frameWidth: Int, frameHeight: Int) {
        val judged = judge(faces, frameWidth, frameHeight)
        val ok = judged == GuidanceMessage.HOLD_STILL
        heldSince = if (!ok) NO_TIME else if (heldSince == NO_TIME) now else heldSince
        yawRatio = judgedYaw
        autoCapture = autoCapture || (heldSince != NO_TIME && now - heldSince >= thresholds.holdMs)
        settle(judged, now)
        updateManualShutter(now)
    }

    /** The yaw ratio [judge] read from a single, well-placed face, whatever its pose; NaN otherwise. */
    private var judgedYaw: Double = Double.NaN

    /** Judges one guidance frame's faces, in the order the person should fix things; sets [judgedYaw]. */
    private fun judge(faces: FaceBuffer, frameWidth: Int, frameHeight: Int): GuidanceMessage {
        judgedYaw = Double.NaN
        // The person is the largest face the server would also find (the first, among equals).
        var primary = -1
        for (i in 0 until faces.count) {
            if (faces.score(i) >= SelfieGuidanceConstants.FACE_SCORE_THRESHOLD && (primary < 0 || faces.area(i) > faces.area(primary))) {
                primary = i
            }
        }
        if (primary < 0 || frameWidth <= 0 || frameHeight <= 0) return GuidanceMessage.NO_FACE
        for (i in 0 until faces.count) {
            if (i != primary &&
                faces.score(i) >= SelfieGuidanceConstants.FACE_SCORE_THRESHOLD &&
                faces.area(i) >= SelfieGuidanceConstants.MIN_SECONDARY_FACE_AREA_RATIO * faces.area(primary)
            ) {
                return GuidanceMessage.MULTIPLE_FACES
            }
        }
        val heightRatio = faces.height(primary) / frameHeight
        if (heightRatio < SelfieGuidanceConstants.MIN_FACE_HEIGHT_RATIO) return GuidanceMessage.TOO_FAR
        if (heightRatio > SelfieGuidanceConstants.MAX_FACE_HEIGHT_RATIO) return GuidanceMessage.TOO_CLOSE
        val offsetX = abs(faces.x(primary) + faces.width(primary) / 2 - frameWidth / 2.0) / frameWidth
        val offsetY = abs(faces.y(primary) + faces.height(primary) / 2 - frameHeight / 2.0) / frameHeight
        if (offsetX > SelfieGuidanceConstants.MAX_CENTRE_OFFSET || offsetY > SelfieGuidanceConstants.MAX_CENTRE_OFFSET) {
            return GuidanceMessage.OFF_CENTRE
        }
        val yaw = faces.yawRatioOf(primary)
        if (yaw.isNaN()) return GuidanceMessage.NO_FACE
        judgedYaw = yaw
        return poseMessage(yaw) ?: GuidanceMessage.HOLD_STILL
    }

    /** The pose check: is the face turned as prompted? Null when it is. */
    private fun poseMessage(yaw: Double): GuidanceMessage? {
        if (pose == SelfiePose.CENTER) {
            return if (abs(yaw) <= thresholds.centreTrigger) null else GuidanceMessage.LOOK_STRAIGHT
        }
        val prompt = instruction(pose)
        // Without the person's own centre frame the turn cannot be judged: the shutter decides.
        if (centreYawRatio.isNaN()) return prompt
        // A turn to the person's own left raises the yaw ratio in the unmirrored frame (C41.1).
        val change = if (pose == SelfiePose.LEFT) yaw - centreYawRatio else centreYawRatio - yaw
        return if (change >= thresholds.sideTrigger) null else prompt
    }

    /** Moves to [next] at [now], settling the announcement. */
    private fun settle(next: GuidanceMessage, now: Long) {
        if (next != message) {
            message = next
            messageSince = now
        }
        if (now - messageSince >= SelfieGuidanceConstants.ANNOUNCE_AFTER_MS) announcement = message
    }

    /** The manual shutter, once shown, stays. */
    private fun updateManualShutter(now: Long) {
        manualShutter = manualShutter || detector == DetectorStatus.UNAVAILABLE || now - startedAt >= thresholds.manualShutterAfterMs
    }

    internal companion object {
        /** "No time": [heldSince] while the pose is not held. */
        const val NO_TIME: Long = Long.MIN_VALUE

        /** What a prompt asks for before the first frame is judged. */
        fun instruction(pose: SelfiePose): GuidanceMessage = when (pose) {
            SelfiePose.CENTER -> GuidanceMessage.LOOK_STRAIGHT
            SelfiePose.LEFT -> GuidanceMessage.TURN_LEFT
            SelfiePose.RIGHT -> GuidanceMessage.TURN_RIGHT
        }
    }
}
