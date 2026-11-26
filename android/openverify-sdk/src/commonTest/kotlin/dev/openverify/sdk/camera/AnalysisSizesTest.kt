package dev.openverify.sdk.camera

import dev.openverify.sdk.model.FileKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.test.runTest

/**
 * KP10-21 (C201.2, review F11; CI run 42762952128): the analysis size a camera runs beside the
 * preview and a full-size still, as CameraX 1.6.2 grants it: among the sizes the camera offers, only
 * those inside the preview class (the display's area, at most 1080p, and never under 640 x 480),
 * the still's 4:3 shape first, the closest at or above the target and else the closest below. On the
 * CI emulator that is 640 x 480 where 1,280 x 960 was asked; the SDK then knows, from the frame it
 * gets, what a barcode read on it can carry, and never assumes the size it asked for.
 */
class AnalysisSizesTest {
    private fun sizes(vararg pairs: Pair<Int, Int>) = pairs.map { FrameSize(it.first, it.second) }

    /** The CI emulator's back camera, as CameraX logged its sizes (run 42762952128, `SupportedOutputSizesCollector`). */
    private val emulator = sizes(1856 to 1392, 1280 to 720, 1024 to 768, 640 to 480, 320 to 240, 176 to 144, 160 to 120)

    /** A phone's back camera: synthetic, the sizes phones commonly list. */
    private val phone = sizes(4000 to 3000, 1920 to 1440, 1920 to 1080, 1440 to 1080, 1280 to 960, 1280 to 720, 1024 to 768, 640 to 480, 320 to 240)

    @Test
    fun thePreviewClassIsTheDisplaysAreaAtMost1080pAndNeverATinyDisplays() {
        assertEquals(FrameSize(320, 640), AnalysisSizes.previewBound(FrameSize(320, 640)))
        assertEquals(FrameSize(1920, 1080), AnalysisSizes.previewBound(FrameSize(1080, 2340)))
        assertEquals(FrameSize(1920, 1080), AnalysisSizes.previewBound(FrameSize(1080, 1920)))
        assertEquals(FrameSize(720, 1600), AnalysisSizes.previewBound(FrameSize(720, 1600)))
        assertEquals(FrameSize(640, 480), AnalysisSizes.previewBound(FrameSize(200, 200)))
    }

    @Test
    fun onTheCiEmulatorTheBarcodeSideGets640By480AsTheRunShowed() {
        val bound = AnalysisSizes.previewBound(FrameSize(320, 640))

        assertEquals(FrameSize(640, 480), AnalysisSizes.beside(AnalysisTarget.BARCODE, emulator, bound))
        assertEquals(FrameSize(640, 480), AnalysisSizes.beside(AnalysisTarget.DOCUMENT, emulator, bound))
        assertEquals(FrameSize(320, 240), AnalysisSizes.beside(AnalysisTarget.SELFIE, emulator, bound))
    }

    @Test
    fun onALargeDisplayTheEmulatorsCameraStillHasNoFourByThreeSizeOf1280InsideThePreviewClass() {
        val bound = AnalysisSizes.previewBound(FrameSize(1080, 2340))

        assertEquals(FrameSize(1024, 768), AnalysisSizes.beside(AnalysisTarget.BARCODE, emulator, bound))
    }

    @Test
    fun aPhoneThatListsTheSizeGetsTheBarcodeWidthAndOneThatDoesNotGetsTheClosestAbove() {
        val bound = AnalysisSizes.previewBound(FrameSize(1080, 2400))

        assertEquals(FrameSize(1280, 960), AnalysisSizes.beside(AnalysisTarget.BARCODE, phone, bound))
        assertEquals(FrameSize(1440, 1080), AnalysisSizes.beside(AnalysisTarget.BARCODE, phone - FrameSize(1280, 960), bound))
        assertEquals(FrameSize(640, 480), AnalysisSizes.beside(AnalysisTarget.DOCUMENT, phone, bound))
    }

    @Test
    fun aSmallerDisplayBoundsTheBarcodeSideBelowItsWidth() {
        val bound = AnalysisSizes.previewBound(FrameSize(720, 1600))

        assertEquals(FrameSize(1024, 768), AnalysisSizes.beside(AnalysisTarget.BARCODE, phone, bound))
    }

    @Test
    fun aCameraWithoutTheStillsShapeGivesTheSameRuleOverItsOtherSizesAndNoneInsideTheClassGivesNothing() {
        val wide = sizes(1920 to 1080, 1280 to 720, 640 to 360)

        assertEquals(FrameSize(1280, 720), AnalysisSizes.beside(AnalysisTarget.BARCODE, wide, FrameSize(1920, 1080)))
        assertEquals(FrameSize(640, 360), AnalysisSizes.beside(AnalysisTarget.BARCODE, wide, FrameSize(320, 640)))
        assertNull(AnalysisSizes.beside(AnalysisTarget.BARCODE, sizes(1856 to 1392), FrameSize(320, 640)))
        assertNull(AnalysisSizes.beside(AnalysisTarget.BARCODE, emptyList(), FrameSize(1920, 1080)))
    }

    @Test
    fun aFrameOfTheBarcodeWidthIsAStreamWhateverItsRotation() {
        listOf(0, 90, 180, 270).forEach { rotation ->
            assertEquals(BarcodeRead.STREAM, AnalysisSizes.barcodeRead(1280, 960, rotation))
            assertEquals(BarcodeRead.STREAM, AnalysisSizes.barcodeRead(1440, 1080, rotation))
        }
    }

    @Test
    fun aSmallerFrameIsNarrowWhileItsGuideStillHoldsTheCalibratedSymbolAndNoneBelow() {
        // The guide is 90% of the upright frame's width; the calibration reads from 512 px across the symbol.
        assertEquals(BarcodeRead.NARROW, AnalysisSizes.barcodeRead(1024, 768, 90)) // 691 px
        assertEquals(BarcodeRead.NARROW, AnalysisSizes.barcodeRead(1024, 768, 0)) // 921 px
        assertEquals(BarcodeRead.NARROW, AnalysisSizes.barcodeRead(640, 480, 0)) // 576 px
        assertEquals(BarcodeRead.NARROW, AnalysisSizes.barcodeRead(640, 480, 180))
        // The CI emulator's frame, held upright as a phone is: 432 px across the guide.
        assertEquals(BarcodeRead.NONE, AnalysisSizes.barcodeRead(640, 480, 90))
        assertEquals(BarcodeRead.NONE, AnalysisSizes.barcodeRead(640, 480, 270))
        assertEquals(BarcodeRead.NONE, AnalysisSizes.barcodeRead(320, 240, 0))
    }

    /** A sink that takes every frame. */
    private class Taking : FrameSink {
        val frames = mutableListOf<AnalysisFrame>()

        override fun wanted(): Boolean = true

        override suspend fun deliver(frame: AnalysisFrame): FrameDelivery {
            frames += frame
            return FrameDelivery.RELEASED
        }
    }

    private fun frame(width: Int, height: Int, rotation: Int = 90) =
        AnalysisFrame(width, height, rotation, PixelLayout.RGBA_8888, ByteArray(width * height * AnalysisFrame.BYTES_PER_PIXEL), 0)

    @Test
    fun theFirstFrameOfABarcodeSideTellsWhatItCanCarryOnceAndEveryFramePassesOn() = runTest {
        val next = Taking()
        val told = mutableListOf<BarcodeRead>()
        val sink = BarcodeReadSink(AnalysisTarget.BARCODE, next, told::add)

        assertEquals(true, sink.wanted())
        assertEquals(FrameDelivery.RELEASED, sink.deliver(frame(640, 480)))
        assertEquals(FrameDelivery.RELEASED, sink.deliver(frame(640, 480)))

        assertEquals(listOf(BarcodeRead.NONE), told)
        assertEquals(2, next.frames.size)
    }

    @Test
    fun aStreamOfTheBarcodeWidthIsToldTooAndAnotherTargetTellsNothing() = runTest {
        val told = mutableListOf<BarcodeRead>()

        BarcodeReadSink(AnalysisTarget.BARCODE, Taking(), told::add).deliver(frame(1280, 960))
        BarcodeReadSink(AnalysisTarget.DOCUMENT, Taking(), told::add).deliver(frame(640, 480))
        BarcodeReadSink(AnalysisTarget.SELFIE, Taking(), told::add).deliver(frame(320, 240))

        assertEquals(listOf(BarcodeRead.STREAM), told)
    }

    @Test
    fun onlyTheSideTheServerMarksBarcodeBearingIsReadAtTheBarcodeWidth() {
        assertEquals(AnalysisTarget.BARCODE, AnalysisTarget.of(FileKind.BACK, barcodeBearing = true))
        assertEquals(AnalysisTarget.BARCODE, AnalysisTarget.of(FileKind.FRONT, barcodeBearing = true))
        assertEquals(AnalysisTarget.DOCUMENT, AnalysisTarget.of(FileKind.BACK, barcodeBearing = false))
        assertEquals(AnalysisTarget.DOCUMENT, AnalysisTarget.of(FileKind.FRONT, barcodeBearing = false))
        assertEquals(AnalysisTarget.SELFIE, AnalysisTarget.of(FileKind.SELFIE_CENTER, barcodeBearing = false))
    }
}
