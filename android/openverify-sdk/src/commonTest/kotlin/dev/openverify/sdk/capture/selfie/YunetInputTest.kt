package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * C204.1, C201.4, rule 19: the guidance frame is the raw (unmirrored) analysis frame turned upright by
 * its rotation, sampled to the preview width, written as YuNet's padded BGR planes into one buffer reused
 * per size, and wiped before the callback returns.
 */
internal class YunetInputTest {

    /** A [width] × [height] RGBA frame whose pixel (x, y) is R = x, G = y, B = 7. */
    private fun frame(width: Int, height: Int, rotation: Int = 0): AnalysisFrame {
        val bytes = ByteArray(width * height * 4)
        for (y in 0 until height) for (x in 0 until width) {
            val at = (y * width + x) * 4
            bytes[at] = x.toByte()
            bytes[at + 1] = y.toByte()
            bytes[at + 2] = 7
            bytes[at + 3] = -1
        }
        return AnalysisFrame(width, height, rotation, PixelLayout.RGBA_8888, bytes, 0L)
    }

    /** The (R, G) the tensor holds at upright (x, y): the raw pixel it was sampled from. */
    private fun YunetTensor.rawAt(x: Int, y: Int): Pair<Int, Int> {
        val plane = paddedWidth * paddedHeight
        val at = y * paddedWidth + x
        assertEquals(7f, data[at], "B plane first")
        return data[2 * plane + at].toInt() to data[plane + at].toInt()
    }

    @Test
    fun sizesRoundUpToMultiplesOf32() {
        assertEquals(listOf(0, 32, 32, 64, 320), listOf(0, 1, 32, 33, 300).map(::paddedSize))
    }

    @Test
    fun anUprightFrameAtThePreviewWidthIsCopiedAsTheWebCopiesIt() {
        val tensor = YunetTensor()
        assertTrue(tensor.fill(frame(4, 3)))

        assertEquals(listOf(4, 3, 32, 32), listOf(tensor.width, tensor.height, tensor.paddedWidth, tensor.paddedHeight))
        assertEquals(3 to 2, tensor.rawAt(3, 2))
        assertEquals(0f, tensor.data[4], "right padding is zero")
    }

    @Test
    fun aQuarterTurnIsUndoneBeforeSampling() {
        // A raw 4 x 2 frame rotated 90 degrees clockwise is upright 2 x 4: the upright top-right pixel
        // was the raw top-left one, and the upright bottom-left the raw bottom-right one.
        val tensor = YunetTensor()
        assertTrue(tensor.fill(frame(4, 2, rotation = 90)))

        assertEquals(2 to 4, tensor.width to tensor.height)
        assertEquals(0 to 0, tensor.rawAt(1, 0))
        assertEquals(3 to 1, tensor.rawAt(0, 3))
    }

    @Test
    fun aHalfTurnAndAThreeQuarterTurnAreUndoneToo() {
        val tensor = YunetTensor()
        assertTrue(tensor.fill(frame(4, 2, rotation = 180)))
        assertEquals(3 to 1, tensor.rawAt(0, 0))
        assertEquals(0 to 0, tensor.rawAt(3, 1))

        assertTrue(tensor.fill(frame(4, 2, rotation = 270)))
        assertEquals(2 to 4, tensor.width to tensor.height)
        // Turned 270 degrees clockwise, the raw top-left pixel lands bottom-left.
        assertEquals(0 to 0, tensor.rawAt(0, 3))
        assertEquals(3 to 0, tensor.rawAt(0, 0))
    }

    @Test
    fun aWideFrameIsSampledDownToThePreviewWidth() {
        val tensor = YunetTensor()
        assertTrue(tensor.fill(frame(640, 480), previewWidth = 320))

        assertEquals(listOf(320, 240, 320, 256), listOf(tensor.width, tensor.height, tensor.paddedWidth, tensor.paddedHeight))
        // Nearest pixel: upright x maps to raw 2x + 1 (the centre of its two source pixels).
        assertEquals((2 * 10 + 1) and 0xFF to (2 * 5 + 1), tensor.rawAt(10, 5))
    }

    @Test
    fun theBufferIsReusedWhileTheSizeHoldsAndWipedOnRequest() {
        val tensor = YunetTensor()
        tensor.fill(frame(8, 8))
        val first = tensor.data
        tensor.wipe()
        assertTrue(first.all { it == 0f })

        tensor.fill(frame(8, 8))
        assertSame(first, tensor.data)
    }

    @Test
    fun aFrameThatScalesToNoRowsGivesNoInput() {
        val tensor = YunetTensor()

        assertFalse(tensor.fill(frame(1000, 1), previewWidth = 320))
    }
}
