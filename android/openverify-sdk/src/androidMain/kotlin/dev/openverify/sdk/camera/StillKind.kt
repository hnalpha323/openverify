package dev.openverify.sdk.camera

/**
 * Phase 12A K1, K2 (Workflow 12A capture-12a): what a still is of, which sets how it is taken and
 * encoded. A document (a card, a page, an ID's back) is taken at the sensor's largest 4:3 size up
 * to [ImageEncoding.MAX_DIMENSION] in quality mode and encoded at [ImageEncoding.MAX_DIMENSION] and
 * [ImageEncoding.JPEG_QUALITY]: the live test of 2026-11-22 uploaded 1920 x 1440 stills at quality 90,
 * on which the vision service found no barcode. A selfie keeps the C201.2 still of 1920 x 1440 in
 * latency mode, encoded at 2048 px and quality 90.
 */
internal enum class StillKind(val maxDimension: Int, val jpegQuality: Int) {
    DOCUMENT(ImageEncoding.MAX_DIMENSION, ImageEncoding.JPEG_QUALITY),
    SELFIE(SELFIE_MAX_DIMENSION, SELFIE_JPEG_QUALITY),
    ;

    internal companion object {
        /** The still a preview analysing for [target] takes: a selfie's, or a document's for a card, a page or a back. */
        fun of(target: AnalysisTarget): StillKind = if (target == AnalysisTarget.SELFIE) SELFIE else DOCUMENT
    }
}

private const val SELFIE_MAX_DIMENSION = 2048
private const val SELFIE_JPEG_QUALITY = 90
