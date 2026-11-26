package dev.openverify.sdk.camera

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.ByteBuffer

/** C201.1: CameraX's RGBA plane, padded rows or not, becomes an [AnalysisFrame]'s packed rows. */
class RgbaFramesTest {

    /** A [width] x [height] RGBA plane with [padding] extra bytes a row, each pixel byte its own value. */
    private fun plane(width: Int, height: Int, padding: Int): ByteBuffer {
        val rowStride = width * 4 + padding
        val bytes = ByteArray(rowStride * (height - 1) + width * 4) { index ->
            val x = index % rowStride
            if (x < width * 4) pixelByte(index / rowStride, x) else PAD
        }
        return ByteBuffer.wrap(bytes)
    }

    private fun pixelByte(y: Int, x: Int): Byte = ((y * 31 + x) % 251).toByte()

    private fun packed(width: Int, height: Int) = ByteArray(width * height * 4) { pixelByte(it / (width * 4), it % (width * 4)) }

    @Test
    fun `packed rows are copied as they are`() {
        val into = ByteArray(6 * 4 * 4)

        assertTrue(RgbaFrames.copy(plane(6, 4, 0), 24, 4, 6, 4, into))

        assertArrayEquals(packed(6, 4), into)
    }

    @Test
    fun `padded rows lose their padding, the last row included`() {
        val into = ByteArray(6 * 4 * 4)
        val buffer = plane(6, 4, padding = 40)

        assertTrue(RgbaFrames.copy(buffer, 64, 4, 6, 4, into))

        assertArrayEquals(packed(6, 4), into)
        assertFalse(into.contains(PAD))
        assertEquals(0, buffer.position(), "the plane's position is left as it was")
    }

    @Test
    fun `a plane that is not four bytes a pixel, or too short, is refused and nothing is copied`() {
        val into = ByteArray(6 * 4 * 4)

        assertFalse(RgbaFrames.copy(plane(6, 4, 0), 24, 3, 6, 4, into))
        assertFalse(RgbaFrames.copy(plane(6, 4, 0), 20, 4, 6, 4, into))
        assertFalse(RgbaFrames.copy(plane(6, 3, 0), 24, 4, 6, 4, into))
        assertFalse(RgbaFrames.copy(plane(6, 4, 0), 24, 4, 6, 4, ByteArray(10)))
        assertTrue(into.all { it == 0.toByte() })
    }

    private companion object {
        const val PAD: Byte = -1
    }
}
