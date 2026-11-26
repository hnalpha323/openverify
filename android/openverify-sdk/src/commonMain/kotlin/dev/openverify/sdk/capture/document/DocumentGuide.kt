package dev.openverify.sdk.capture.document

import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep

/**
 * C202.1: where the guide lies in an analysis frame. The capture screen draws its guide at 90% of
 * the preview's limiting side, centred (`ui/CaptureScreen.kt`'s `drawCardFrame`); the analysis frame
 * places it the same way in the upright frame, then maps it back to the frame as the sensor wrote it.
 * The preview may crop the camera's image to fill its box, so the two guides agree in shape and
 * centre, not to the pixel: guidance, never a measurement (C202.6).
 */
internal object DocumentGuide {
    /** ID-1 (85.60 x 53.98 mm), the card guide the capture screen draws. */
    const val CARD_ASPECT: Double = 85.60 / 53.98

    /** A TD3 data page (125 x 88 mm). */
    const val PASSPORT_ASPECT: Double = 125.0 / 88.0

    /** The guide's share of the frame's limiting side. */
    const val GUIDE_SHARE: Double = 0.9

    private const val PASSPORT = "passport"

    /** C202.3: a passport-only step's front, the only side the band hint applies to. */
    fun isPassportPage(state: FlowState.Capture): Boolean {
        val classes = (state.step as? GovernmentIdStep)?.allowedIdClasses ?: return false
        return state.kind == FileKind.FRONT && classes.isNotEmpty() && classes.all { it == PASSPORT }
    }

    /** The guide's shape for [state]: a TD3 page for a passport page, else the ID-1 card. */
    fun aspectOf(state: FlowState.Capture): Double = if (isPassportPage(state)) PASSPORT_ASPECT else CARD_ASPECT

    /**
     * The guide of [aspect] in a [width] x [height] frame that [rotationDegrees] turns upright: 90% of
     * the upright frame's limiting side, centred, truncated to whole pixels (the tool's `guide_in_frame`),
     * then mapped back to the frame's own pixels.
     */
    fun inFrame(width: Int, height: Int, rotationDegrees: Int, aspect: Double): FrameRect {
        val sideways = rotationDegrees == 90 || rotationDegrees == 270
        val uprightWidth = if (sideways) height else width
        val uprightHeight = if (sideways) width else height
        val guideWidth = minOf(uprightWidth * GUIDE_SHARE, uprightHeight * GUIDE_SHARE * aspect).toInt()
        val guideHeight = (guideWidth / aspect).toInt()
        val left = (uprightWidth - guideWidth) / 2
        val top = (uprightHeight - guideHeight) / 2
        val right = left + guideWidth
        val bottom = top + guideHeight
        return when (rotationDegrees) {
            0 -> FrameRect(left, top, right, bottom)
            90 -> FrameRect(top, height - right, bottom, height - left)
            180 -> FrameRect(width - right, height - bottom, width - left, height - top)
            270 -> FrameRect(width - bottom, left, width - top, right)
            else -> throw IllegalArgumentException("DocumentGuide: the rotation is 0, 90, 180 or 270")
        }
    }
}
