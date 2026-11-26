package dev.openverify.sdk.camera

import java.nio.Buffer
import java.nio.ByteBuffer

/** C201.1, C201.2: CameraX's `OUTPUT_IMAGE_FORMAT_RGBA_8888` plane into an [AnalysisFrame]'s packed rows. */
internal object RgbaFrames {
    /**
     * Copies a [width] by [height] RGBA plane ([buffer], [rowStride] bytes a row, [pixelStride] bytes a
     * pixel) into [into], rows packed (`width * 4` bytes a row, no padding). Answers false and copies
     * nothing when the plane is not four bytes a pixel or is shorter than the frame, or [into] is.
     * The plane's position is left as it was.
     */
    fun copy(buffer: ByteBuffer, rowStride: Int, pixelStride: Int, width: Int, height: Int, into: ByteArray): Boolean {
        val row = width * AnalysisFrame.BYTES_PER_PIXEL
        if (width <= 0 || height <= 0 || pixelStride != AnalysisFrame.BYTES_PER_PIXEL || rowStride < row) return false
        if (into.size < row * height || buffer.remaining().toLong() < rowStride.toLong() * (height - 1) + row) return false
        // Buffer.position(Int), not ByteBuffer's covariant override, which API 26 to 33 lack.
        val plane: Buffer = buffer
        val start = plane.position()
        try {
            if (rowStride == row) {
                buffer.get(into, 0, row * height)
            } else {
                for (y in 0 until height) {
                    plane.position(start + y * rowStride)
                    buffer.get(into, y * row, row)
                }
            }
        } finally {
            plane.position(start)
        }
        return true
    }
}
