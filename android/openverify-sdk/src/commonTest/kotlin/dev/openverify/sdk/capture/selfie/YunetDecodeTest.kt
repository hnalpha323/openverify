package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.face.YunetOutputs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * C204.1, C204.8, rule 19: the decoder reads [YunetOutputs] by name and order, keeps its buffers between
 * frames, and its buffers and the faces it wrote are zeroed on request, so nothing of a frame's faces is
 * left once its callback returns.
 */
internal class YunetDecodeTest {

    @Test
    fun theAnchorGridHoldsEveryStride() {
        // 64 x 64: 8 x 8 at stride 8, 4 x 4 at 16, 2 x 2 at 32.
        assertEquals(64 + 16 + 4, anchorCount(64, 64))
        assertEquals(40 * 32 + 20 * 16 + 10 * 8, anchorCount(320, 256))
    }

    @Test
    fun aFaceTheFakeDetectorEncodesDecodesBackWithinFloatPrecision() {
        val face = testFace(yaw = 0.03)
        val faces = FaceBuffer()

        YunetDecoder().decode(yunetOutputsOf(listOf(face), 320, 256), 320, 256, faces)

        assertEquals(1, faces.count)
        assertEquals(face.x, faces.x(0), 1e-3)
        assertEquals(face.height, faces.height(0), 1e-3)
        assertEquals(face.landmarks[2].first, faces.landmarkX(0, 2), 1e-3)
        assertEquals(0.03, faces.yawRatioOf(0), 1e-4)
    }

    @Test
    fun aShortTensorReadsZeroBeyondItsEndAsTheWebDoes() {
        val empty = FloatArray(0)
        val outputs = YunetOutputs(empty, empty, empty, empty, empty, empty, empty, empty, empty, empty, empty, empty)
        val faces = FaceBuffer()

        YunetDecoder().decode(outputs, 64, 64, faces)

        assertEquals(0, faces.count)
    }

    @Test
    fun clearingZeroesEveryFaceValue() {
        val decoder = YunetDecoder()
        val faces = FaceBuffer()
        decoder.decode(yunetOutputsOf(listOf(testFace(), testFace(cx = 40.0, cy = 40.0, height = 0.2)), 320, 256), 320, 256, faces)
        assertEquals(2, faces.count)
        assertFalse(faces.isWiped())
        assertTrue(decoder.isWiped(), "the decoder keeps no candidate once decode returns")

        faces.clear()
        decoder.wipe()

        assertEquals(0, faces.count)
        assertTrue(faces.isWiped())
        assertTrue(decoder.isWiped())
    }

    @Test
    fun theBuffersGrowOnceAndAreReusedForFramesOfTheSameSize() {
        val decoder = YunetDecoder()
        val faces = FaceBuffer()
        val outputs = yunetOutputsOf(listOf(testFace()), 320, 256)
        decoder.decode(outputs, 320, 256, faces)
        val capacity = faces.capacity
        faces.clear()

        repeat(5) {
            decoder.decode(outputs, 320, 256, faces)
            faces.clear()
        }

        assertEquals(capacity, faces.capacity)
    }
}
