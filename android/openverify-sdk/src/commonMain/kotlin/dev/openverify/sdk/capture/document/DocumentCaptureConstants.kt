package dev.openverify.sdk.capture.document

import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds

/**
 * C202.2: the client constants of `contracts/fixtures/flow/document-capture.json`, which
 * `DocumentCaptureConstantsTest` reads and Python reads too (`test_android_document_calibration.py`).
 * Every one is provisional, with its basis in the file. The thresholds were calibrated on synthetic
 * renders only (`docs/calibration/android-document-guidance.md`), by a rule fixed before measuring,
 * never on a test's expected answer; they say nothing about real camera frames, lenses or light
 * (review H21). Guidance only: they decide when the photo is taken and which hint is shown (C202.5).
 */
internal object DocumentCaptureConstants {
    /** `hold-ms`: every gate holds this long before the still is taken; also how long a hint holds before it is shown. */
    val HOLD: Duration = 500.milliseconds

    /** `guidance-hz`: frames are sampled at this rate (C201.2). */
    const val GUIDANCE_HZ: Int = 8

    /** `analysis-width-px`: the analysis frame's width in the sensor's orientation (C201.2). */
    const val ANALYSIS_WIDTH_PX: Int = 640

    /**
     * `barcode-analysis-width-px`: asked on a barcode-bearing side (C201.2, review F11). KP10-23: the
     * one statement of this width; `AnalysisTarget.BARCODE` and `Pdf417Guidance.ANALYSIS_WIDTH_PX` read it.
     */
    const val BARCODE_ANALYSIS_WIDTH_PX: Int = 1280

    /** `manual-shutter-after-ms` (decision 19): the shutter becomes the primary action after this. */
    val MANUAL_SHUTTER_AFTER: Duration = 10_000.milliseconds

    /** `sharpness-laplacian-variance-min`: the guide's crop is sharp from this variance of the Laplacian. */
    const val SHARPNESS_LAPLACIAN_VARIANCE_MIN: Double = 102.0

    /** `sharpness-tenengrad-min`: and from this Tenengrad. */
    const val SHARPNESS_TENENGRAD_MIN: Double = 3500.0

    /** `glare-share-max`: at most this share of the crop is glare. */
    const val GLARE_SHARE_MAX: Double = 0.0202

    /** `brightness-mean-min`: the crop's mean grey (0 to 1) is at least this. */
    const val BRIGHTNESS_MEAN_MIN: Double = 0.357

    /** `brightness-mean-max`: and at most this. */
    const val BRIGHTNESS_MEAN_MAX: Double = 0.825

    /** `framing-edge-ratio-min`: the document fills the guide from this framing ratio. */
    const val FRAMING_EDGE_RATIO_MIN: Double = 19.0

    /** `mrz-band-edge-density-min`: a passport page's machine-readable band is in view from this density. */
    const val MRZ_BAND_EDGE_DENSITY_MIN: Double = 0.172
}
