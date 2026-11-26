package dev.openverify.sdk.capture.selfie

import kotlin.math.hypot

/**
 * C204.1, C41.1: the web flow's `head-pose.ts` in Kotlin. The yaw ratio of a face is the nose tip's
 * offset from the eye midpoint along the eye line, divided by the inter-ocular distance; rolling the
 * head does not change it. In the raw, unmirrored camera image (C201.4) a turn to the person's own
 * left moves the nose toward the image's right, so the ratio grows.
 */

/** Below this inter-ocular distance (pixels) the eyes count as coinciding. */
internal const val EYE_DISTANCE_EPSILON: Double = 1e-6

/** The yaw ratio of a face's right eye, left eye and nose tip, or NaN when the eyes coincide. */
internal fun yawRatio(
    rightEyeX: Double,
    rightEyeY: Double,
    leftEyeX: Double,
    leftEyeY: Double,
    noseX: Double,
    noseY: Double,
): Double {
    val dx = leftEyeX - rightEyeX
    val dy = leftEyeY - rightEyeY
    val distance = hypot(dx, dy)
    if (distance < EYE_DISTANCE_EPSILON) return Double.NaN
    // The nose's offset from the eye midpoint, projected on the eye line (the de-rolled x axis).
    val mx = (rightEyeX + leftEyeX) / 2
    val my = (rightEyeY + leftEyeY) / 2
    return ((noseX - mx) * dx + (noseY - my) * dy) / (distance * distance)
}

/** The yaw ratio of face [index], or NaN when its eyes coincide. */
internal fun FaceBuffer.yawRatioOf(index: Int): Double =
    yawRatio(landmarkX(index, 0), landmarkY(index, 0), landmarkX(index, 1), landmarkY(index, 1), landmarkX(index, 2), landmarkY(index, 2))
