package dev.openverify.sdk.camera

import dev.openverify.sdk.capture.document.DocumentCaptureConstants
import dev.openverify.sdk.model.FileKind

/**
 * C201.2 (review F11): the analysis resolution a capture's frames are asked at, as the long side of
 * the sensor's frame in pixels; the camera picks the closest size it has at or above it, at the
 * photo's 4:3 shape, so a frame shows what the photo will.
 * - [DOCUMENT]: about 640 px wide for a card or a page (C202.2's `analysis-width-px`).
 * - [BARCODE]: 1,280 px on the side the server marks barcode-bearing, the one that carries a
 *   licence's PDF417: at 640 px a 290-module AAMVA row falls near 1.5 pixels a module (review F11).
 *   It is what is asked, not what every camera gives (KP10-21): beside the preview and a full-size
 *   still CameraX holds the analysis stream to the preview class, which follows the display, so a
 *   camera may give less ([AnalysisSizes]); the SDK judges each barcode side by the frame it gets
 *   ([BarcodeRead]).
 * - [SELFIE]: the fixture's `preview-width-px`, 320 (C40.11), what the face guidance reads.
 */
internal enum class AnalysisTarget(val longSidePx: Int) {
    /** `analysis-width-px` of `document-capture.json` (KP10-23: stated once, in [DocumentCaptureConstants]). */
    DOCUMENT(DocumentCaptureConstants.ANALYSIS_WIDTH_PX),

    /** `barcode-analysis-width-px` of the same file. */
    BARCODE(DocumentCaptureConstants.BARCODE_ANALYSIS_WIDTH_PX),
    SELFIE(320),
    ;

    /** The short side at the photo's 4:3 shape. */
    val shortSidePx: Int get() = longSidePx * 3 / 4

    internal companion object {
        /**
         * The analysis of a photo of [kind]: a selfie pose's, the barcode width on the side the server
         * marks [barcodeBearing] (`isBarcodeBearing`, C203.3), a card's or a page's on any other, so a
         * back without a barcode hint is not read at four times the pixels for nothing (KP10-21).
         */
        fun of(kind: FileKind, barcodeBearing: Boolean): AnalysisTarget = when {
            kind == FileKind.SELFIE_CENTER || kind == FileKind.SELFIE_LEFT || kind == FileKind.SELFIE_RIGHT -> SELFIE
            barcodeBearing -> BARCODE
            else -> DOCUMENT
        }

        /** The analysis a preview of [lens] gets when its caller names none: the front camera is the selfie's. */
        fun of(lens: CameraLens): AnalysisTarget = if (lens == CameraLens.FRONT) SELFIE else DOCUMENT
    }
}
