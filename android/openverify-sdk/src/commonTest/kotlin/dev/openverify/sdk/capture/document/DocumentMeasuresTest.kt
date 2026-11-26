package dev.openverify.sdk.capture.document

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * C202.1, C202.3: the measures' arithmetic on constructed frames, beside the shared vectors
 * (`DocumentQualityVectorsTest`). The band-density numbers are the ones
 * `services/vision/tests/test_document_quality_vectors.py` asserts of the Python reference.
 */
class DocumentMeasuresTest {
    private val width = 96
    private val height = 60
    private val whole = FrameRect(0, 0, width, height)

    /** White, with rows 30 to 59 striped in columns of two: black, black, white, white. */
    private fun stripes(): IntArray = IntArray(width * height) { index ->
        val x = index % width
        val y = index / width
        if (y >= 30 && x % 4 < 2) 0 else 255
    }

    private fun energyOf(grey: IntArray, w: Int, h: Int): IntArray = IntArray(w * h).also { DocumentMeasures.sobelEnergy(grey, w, h, it) }

    /** The upright frame turned a quarter counter-clockwise: the sensor frame a 90 degree rotation makes upright. */
    private fun quarterCounterClockwise(grey: IntArray, w: Int, h: Int): IntArray = IntArray(w * h) { index ->
        val x = index % h
        val y = index / h
        grey[x * w + (w - 1 - y)]
    }

    private fun quarterClockwise(grey: IntArray, w: Int, h: Int): IntArray = IntArray(w * h) { index ->
        val x = index % h
        val y = index / h
        grey[(h - 1 - x) * w + y]
    }

    @Test
    fun theBandDensityOfConstructedStripesIsThePythonReferences() {
        val energy = energyOf(stripes(), width, height)
        assertEquals(188.0 / 192.0, DocumentMeasures.mrzBandEdgeDensity(energy, width, height, whole, 0))
        assertEquals(0.0, DocumentMeasures.mrzBandEdgeDensity(energy, width, height, whole, 180))
        assertEquals(0.0, DocumentMeasures.mrzBandEdgeDensity(energyOf(IntArray(width * height) { 255 }, width, height), width, height, whole, 0))
    }

    @Test
    fun theBandFollowsTheRotationToTheUprightBottom() {
        val upright = stripes()
        val expected = DocumentMeasures.mrzBandEdgeDensity(energyOf(upright, width, height), width, height, whole, 0)
        val sensor = FrameRect(0, 0, height, width)
        val quarter = energyOf(quarterCounterClockwise(upright, width, height), height, width)
        val threeQuarters = energyOf(quarterClockwise(upright, width, height), height, width)
        assertEquals(expected, DocumentMeasures.mrzBandEdgeDensity(quarter, height, width, sensor, 90))
        assertEquals(expected, DocumentMeasures.mrzBandEdgeDensity(threeQuarters, height, width, sensor, 270))
        assertFailsWith<IllegalArgumentException> { DocumentMeasures.mrzBandEdgeDensity(quarter, height, width, sensor, 45) }
    }

    @Test
    fun theGreyIsOpenCvsFixedPointConversion() {
        // OpenCV 5.0.0 COLOR_BGR2GRAY of these colours, where a 14-bit conversion is one lower.
        val rgba = byteArrayOf(106, 15, 0, -1, -40, 22, 0, -1, 0, 0, 0, -1, -1, -1, -1, -1)
        val grey = IntArray(4)
        DocumentMeasures.grey(rgba, 4, 1, grey)
        assertEquals(listOf(41, 78, 0, 255), grey.toList())
    }

    @Test
    fun glareIsValueAtLeast250AndSaturationAtMost40OnOpenCvsScale() {
        // V 250 with a low of 211 is S 40 (glare); with 210, S 41 (not glare); V 249 is never glare.
        val rgba = byteArrayOf(-6, -45, -26, -1, -6, -46, -26, -1, -7, -7, -7, -1, -1, -1, -1, -1)
        assertEquals(0.5, DocumentMeasures.glareShare(rgba, 4, 1, FrameRect(0, 0, 4, 1)))
        assertEquals(0.5, DocumentMeasures.glareShare(rgba, 2, 2, FrameRect(0, 0, 2, 2)))
    }

    @Test
    fun aRegionIsMeasuredAsItsOwnImage() {
        val grey = IntArray(width * height) { (it * 37 + (it / width) * 11) % 256 }
        val rgba = ByteArray(width * height * 4) { (it * 13 % 256).toByte() }
        val region = FrameRect(10, 7, 70, 41)
        val cropGrey = IntArray(region.width * region.height) { grey[(region.top + it / region.width) * width + region.left + it % region.width] }
        val cropRgba = ByteArray(region.width * region.height * 4) { index ->
            val pixel = index / 4
            rgba[((region.top + pixel / region.width) * width + region.left + pixel % region.width) * 4 + index % 4]
        }
        val all = FrameRect(0, 0, region.width, region.height)
        assertEquals(DocumentMeasures.laplacianVariance(cropGrey, region.width, region.height, all), DocumentMeasures.laplacianVariance(grey, width, height, region))
        assertEquals(DocumentMeasures.tenengrad(cropGrey, region.width, region.height, all), DocumentMeasures.tenengrad(grey, width, height, region))
        assertEquals(DocumentMeasures.brightnessMean(cropGrey, region.width, region.height, all), DocumentMeasures.brightnessMean(grey, width, height, region))
        assertEquals(DocumentMeasures.glareShare(cropRgba, region.width, region.height, all), DocumentMeasures.glareShare(rgba, width, height, region))
    }

    @Test
    fun aFlatFrameHasNoSharpnessAndNoFraming() {
        val grey = IntArray(width * height) { 90 }
        assertEquals(0.0, DocumentMeasures.laplacianVariance(grey, width, height, whole))
        assertEquals(0.0, DocumentMeasures.tenengrad(grey, width, height, whole))
        assertEquals(90.0 / 255.0, DocumentMeasures.brightnessMean(grey, width, height, whole))
        assertEquals(0.0, DocumentMeasures.framingEdgeRatio(energyOf(grey, width, height), width, height, FrameRect(8, 7, 88, 53)))
        assertFailsWith<IllegalArgumentException> { DocumentMeasures.framingEdgeRatio(IntArray(width * height), width, height, FrameRect(0, 0, width + 1, height)) }
    }

    @Test
    fun aShrunkGuideIsCentredInWholePixels() {
        assertEquals(FrameRect(121, 245, 359, 395), DocumentMeasures.shrunkGuide(FrameRect(24, 184, 456, 456), 55))
        assertEquals(FrameRect(1, 1, 2, 2), DocumentMeasures.shrunkGuide(FrameRect(0, 0, 3, 3), 10))
    }

    @Test
    fun theGuideLiesWhereTheCaptureScreenDrawsItInEveryRotation() {
        val card = DocumentGuide.CARD_ASPECT
        assertEquals(FrameRect(24, 184, 456, 456), DocumentGuide.inFrame(480, 640, 0, card))
        assertEquals(FrameRect(24, 184, 456, 456), DocumentGuide.inFrame(480, 640, 180, card))
        assertEquals(FrameRect(184, 24, 456, 456), DocumentGuide.inFrame(640, 480, 90, card))
        assertEquals(FrameRect(184, 24, 456, 456), DocumentGuide.inFrame(640, 480, 270, card))
        assertEquals(FrameRect(8, 7, 88, 53).width, 80)
    }
}
