package dev.openverify.sdk.capture.document

import dev.openverify.sdk.capture.document.DocumentCaptureConstants as C

/**
 * C202.3: the hints, in their fixed order: the first whose condition holds is the one shown, one at
 * a time. The machine-readable band's comes last, and only on a passport page.
 */
internal enum class DocumentHint {
    /** The card frames a smaller guide inside the guide: it is in view, too far away. */
    MOVE_CLOSER,

    /** A lit, glare-free, framed card that is not sharp. */
    HOLD_STILL,

    /** Glare, or a frame brighter than the maximum. */
    TILT_AWAY,

    /** A frame darker than the minimum. */
    MORE_LIGHT,

    /** The card does not fill the guide. */
    FIT_CARD,

    /** A passport page whose lower third shows no machine-readable lines. */
    SHOW_MRZ,
}

/**
 * One frame's measures: the four quality measures over the guide's crop, framing over the guide and
 * the best smaller guide, and the band density. Reused frame after frame by its analyzer (rule 19:
 * nothing allocated per frame); valid only inside the frame callback that filled it.
 */
internal class DocumentMeasurement {
    var laplacianVariance: Double = 0.0
    var tenengrad: Double = 0.0
    var glareShare: Double = 0.0
    var brightnessMean: Double = 0.0
    var framingEdgeRatio: Double = 0.0
    var framingShrunkBest: Double = 0.0
    var mrzBandEdgeDensity: Double = 0.0
}

/**
 * C202.3: the hint a frame's measures call for, mirrored for the calibration report by
 * `services/vision/tools/android_document_guidance.py`'s `hint_of`. A value at its threshold holds.
 * "Hold still" is asked only of a lit, glare-free, framed card, since darkness, glare and a missing
 * card also lower the sharpness measures; the order stays fixed.
 */
internal object DocumentHints {
    fun hintOf(measurement: DocumentMeasurement, passport: Boolean): DocumentHint? {
        val framed = measurement.framingEdgeRatio >= C.FRAMING_EDGE_RATIO_MIN
        val sharp = measurement.laplacianVariance >= C.SHARPNESS_LAPLACIAN_VARIANCE_MIN && measurement.tenengrad >= C.SHARPNESS_TENENGRAD_MIN
        val lit = measurement.brightnessMean >= C.BRIGHTNESS_MEAN_MIN
        val clear = measurement.glareShare <= C.GLARE_SHARE_MAX && measurement.brightnessMean <= C.BRIGHTNESS_MEAN_MAX
        return when {
            !framed && measurement.framingShrunkBest >= C.FRAMING_EDGE_RATIO_MIN -> DocumentHint.MOVE_CLOSER
            !sharp && lit && clear && framed -> DocumentHint.HOLD_STILL
            !clear -> DocumentHint.TILT_AWAY
            !lit -> DocumentHint.MORE_LIGHT
            !framed -> DocumentHint.FIT_CARD
            passport && measurement.mrzBandEdgeDensity < C.MRZ_BAND_EDGE_DENSITY_MIN -> DocumentHint.SHOW_MRZ
            else -> null
        }
    }
}
