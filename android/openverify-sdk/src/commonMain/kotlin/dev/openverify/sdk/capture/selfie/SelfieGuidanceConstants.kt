package dev.openverify.sdk.capture.selfie

/**
 * C204.1, C40.11: the selfie guidance's constants. The client ones are `contracts/fixtures/flow/
 * selfie-capture.json`'s `client` block, and the rest are the web flow's own (`apps/flow/src/guidance/`:
 * `face-detector.ts`, `guidance-machine.ts`), as `contracts/fixtures/flow/selfie-guidance-vectors.json`
 * exports them; `SelfieGuidanceConstantsTest` holds each to its file. Every value is provisional,
 * with the basis the web module gives it, and guidance only: the server re-measures every photo
 * (C204.7).
 */
internal object SelfieGuidanceConstants {
    /** `side-trigger-factor`: a side pose auto-captures once its yaw-ratio change is this × the server's minimum. */
    const val SIDE_TRIGGER_FACTOR: Double = 1.25

    /** `center-trigger-factor`: the centre auto-captures once `|yaw ratio|` is at most this × the server's maximum. */
    const val CENTER_TRIGGER_FACTOR: Double = 0.8

    /** `guidance-hz`: guidance frames a second. */
    const val GUIDANCE_HZ: Int = 8

    /** `preview-width-px`: the guidance frame's width, which YuNet reads. */
    const val PREVIEW_WIDTH_PX: Int = 320

    /** `manual-shutter-after-ms`: the shutter becomes the primary action this long after a prompt appears. */
    const val MANUAL_SHUTTER_AFTER_MS: Long = 10_000

    /** The web detector's candidate threshold (`face-detector.ts`): decoded faces scoring less are dropped. */
    const val CANDIDATE_SCORE_THRESHOLD: Double = 0.6

    /** The web detector's NMS threshold: a face overlapping a better one by more than this IoU is dropped. */
    const val NMS_THRESHOLD: Double = 0.3

    /** A face counts once scored at least this: the vision service's own `face_score_threshold`. */
    const val FACE_SCORE_THRESHOLD: Double = 0.9

    /** Face box height over frame height: the server's 0.2 (C39.3) with a quarter of margin. */
    const val MIN_FACE_HEIGHT_RATIO: Double = 0.25

    /** Closer than this, the oval (78% of the preview's height) no longer holds the face. */
    const val MAX_FACE_HEIGHT_RATIO: Double = 0.8

    /** Largest offset of the face centre from the frame centre, as a share of each dimension. */
    const val MAX_CENTRE_OFFSET: Double = 0.15

    /** A second face counts once its box is at least this share of the person's: the server's C39.3 ratio. */
    const val MIN_SECONDARY_FACE_AREA_RATIO: Double = 0.25

    /** A message is announced once it has stayed on screen this long: 8 Hz would be noise (C212.2). */
    const val ANNOUNCE_AFTER_MS: Long = 1_500

    /** YuNet's three output strides. */
    val STRIDES: List<Int> = listOf(8, 16, 32)
}
