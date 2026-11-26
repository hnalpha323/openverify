package dev.openverify.sdk.capture.document

import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import kotlin.math.max

/**
 * C202.1, rule 19: measures one frame into a [DocumentMeasurement], with its grey and energy buffers
 * allocated once per frame size and reused, and its guides once per frame size, rotation and shape, so nothing is allocated per frame after the first of a
 * size. The frame's bytes are read inside the call only (C204.8's rule, here for documents) and
 * nothing measured outlives the next frame.
 */
internal class DocumentFrameAnalyzer {
    private var grey = IntArray(0)
    private var energy = IntArray(0)

    // The guide and its smaller copies for the last frame size, rotation and shape.
    private var guideKey: Long = -1
    private var guideAspect: Double = Double.NaN
    private var guide = FrameRect(0, 0, 1, 1)
    private var shrunk: Array<FrameRect> = emptyArray()

    fun measure(frame: AnalysisFrame, aspect: Double, into: DocumentMeasurement): DocumentMeasurement {
        check(frame.layout == PixelLayout.RGBA_8888) { "DocumentFrameAnalyzer: RGBA_8888 frames only" }
        val width = frame.width
        val height = frame.height
        val pixels = width * height
        if (grey.size != pixels) {
            grey = IntArray(pixels)
            energy = IntArray(pixels)
        }
        DocumentMeasures.grey(frame.bytes, width, height, grey)
        DocumentMeasures.sobelEnergy(grey, width, height, energy)
        val key = (width.toLong() shl 32) or (height.toLong() shl 9) or frame.rotationDegrees.toLong()
        if (key != guideKey || aspect != guideAspect) {
            guide = DocumentGuide.inFrame(width, height, frame.rotationDegrees, aspect)
            shrunk = Array(SHRINK_PERCENTS.size) { DocumentMeasures.shrunkGuide(guide, SHRINK_PERCENTS[it]) }
            guideKey = key
            guideAspect = aspect
        }
        into.laplacianVariance = DocumentMeasures.laplacianVariance(grey, width, height, guide)
        into.tenengrad = DocumentMeasures.tenengrad(grey, width, height, guide)
        into.glareShare = DocumentMeasures.glareShare(frame.bytes, width, height, guide)
        into.brightnessMean = DocumentMeasures.brightnessMean(grey, width, height, guide)
        into.framingEdgeRatio = DocumentMeasures.framingEdgeRatio(energy, width, height, guide)
        var shrunkBest = 0.0
        for (smaller in shrunk) shrunkBest = max(shrunkBest, DocumentMeasures.framingEdgeRatio(energy, width, height, smaller))
        into.framingShrunkBest = shrunkBest
        into.mrzBandEdgeDensity = DocumentMeasures.mrzBandEdgeDensity(energy, width, height, guide, frame.rotationDegrees)
        return into
    }

    internal companion object {
        /**
         * C202.3 (the tool's `FRAMING_SHRINK_PERCENTS`): smaller guides, in percent of the guide; a card
         * that frames one but not the guide is in view and too far ("move closer"). Steps of 5% keep a
         * card from half the guide to 90% of it within one of their bands.
         */
        internal val SHRINK_PERCENTS: IntArray = intArrayOf(50, 55, 60, 65, 70, 75, 80, 85, 90)
    }
}
