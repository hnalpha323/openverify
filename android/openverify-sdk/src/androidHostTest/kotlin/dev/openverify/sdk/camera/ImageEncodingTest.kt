package dev.openverify.sdk.camera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.camera.core.CameraSelector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ImageEncodingTest {

    private fun bitmap(width: Int, height: Int): Bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)

    private fun size(image: CapturedImage): Pair<Int, Int> {
        val decoded = BitmapFactory.decodeByteArray(image.bytes, 0, image.bytes.size)
        return decoded.width to decoded.height
    }

    @Test
    fun `the result is a JPEG`() {
        val image = ImageEncoding.uprightJpeg(bitmap(40, 20), rotationDegrees = 0)

        assertEquals("image/jpeg", image.mimeType)
        assertEquals(0xFF.toByte(), image.bytes[0])
        assertEquals(0xD8.toByte(), image.bytes[1])
    }

    @Test
    fun `quarter turns swap width and height`() {
        assertEquals(40 to 20, size(ImageEncoding.uprightJpeg(bitmap(40, 20), 0)))
        assertEquals(20 to 40, size(ImageEncoding.uprightJpeg(bitmap(40, 20), 90)))
        assertEquals(40 to 20, size(ImageEncoding.uprightJpeg(bitmap(40, 20), 180)))
        assertEquals(20 to 40, size(ImageEncoding.uprightJpeg(bitmap(40, 20), 270)))
    }

    @Test
    fun `large frames are scaled down to the maximum, keeping the aspect ratio`() {
        assertEquals(100 to 50, size(ImageEncoding.uprightJpeg(bitmap(400, 200), 0, maxDimension = 100)))
        assertEquals(50 to 100, size(ImageEncoding.uprightJpeg(bitmap(400, 200), 90, maxDimension = 100)))
    }

    @Test
    fun `small frames are never scaled up`() {
        assertEquals(40 to 20, size(ImageEncoding.uprightJpeg(bitmap(40, 20), 0)))
    }

    /**
     * C40.4, C41.1: the server reads the head turn's direction from the image as stored, so the
     * snapshot's `image-mirrored` must say how the uploaded JPEG actually is. A frame with a red
     * top-left, a blue top-right and a green bottom-left quadrant goes through the encoder at
     * every quarter turn; a rotation keeps the markers' winding order and a mirror reverses it.
     */
    @Test
    fun `the uploaded JPEG is never mirrored at any quarter turn, and the device snapshot says so`() {
        val frame = quadrants(width = 80, height = 40)

        for (rotation in listOf(0, 90, 180, 270)) {
            val decoded = ImageEncoding.uprightJpeg(frame, rotation).let { BitmapFactory.decodeByteArray(it.bytes, 0, it.bytes.size) }
            val red = locate(decoded, Color.RED)
            val blue = locate(decoded, Color.BLUE)
            val green = locate(decoded, Color.GREEN)
            // The z component of (blue - red) x (green - red): positive in the frame as captured.
            val winding = (blue.first - red.first) * (green.second - red.second) - (blue.second - red.second) * (green.first - red.first)
            val mirrored = winding < 0

            assertEquals("rotation $rotation", false, mirrored)
            assertEquals("rotation $rotation", mirrored, CameraFacts(lensFacing = CameraSelector.LENS_FACING_FRONT).toDeviceSnapshot().imageMirrored)
        }
    }

    /** Red, blue, green and black quadrants: top-left, top-right, bottom-left, bottom-right. */
    private fun quadrants(width: Int, height: Int): Bitmap {
        val pixels = IntArray(width * height) { index ->
            val left = index % width < width / 2
            val top = index / width < height / 2
            when {
                top && left -> Color.RED
                top -> Color.BLUE
                left -> Color.GREEN
                else -> Color.BLACK
            }
        }
        return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    }

    /** The centre of the quadrant of [image] whose centre pixel is closest to [color]. */
    private fun locate(image: Bitmap, color: Int): Pair<Int, Int> {
        val centres = listOf(1, 3).flatMap { y -> listOf(1, 3).map { x -> x * image.width / 4 to y * image.height / 4 } }
        return centres.minBy { (x, y) ->
            val pixel = image.getPixel(x, y)
            listOf(Color::red, Color::green, Color::blue).sumOf { channel -> abs(channel(pixel) - channel(color)) }
        }
    }

    @Test
    fun `only quarter turns are accepted`() {
        assertThrows(IllegalArgumentException::class.java) { ImageEncoding.uprightJpeg(bitmap(40, 20), 45) }
    }

    /**
     * The quality the encoder used, read back from the JPEG's luminance quantization table: the
     * libjpeg base table scaled for quality q (the IJG formula Skia's encoder applies) that matches it.
     */
    private fun jpegQuality(bytes: ByteArray): Int {
        var offset = 2
        while (offset + 4 < bytes.size) {
            val marker = bytes[offset + 1].toInt() and 0xFF
            val length = ((bytes[offset + 2].toInt() and 0xFF) shl 8) or (bytes[offset + 3].toInt() and 0xFF)
            if (marker == 0xDB) {
                // Pq and Tq, then 64 eight-bit entries in zigzag order; the first table is luminance.
                val table = (0 until 64).map { bytes[offset + 5 + it].toInt() and 0xFF }.sorted()
                return (1..100).single { quality ->
                    val scale = if (quality < 50) 5000 / quality else 200 - 2 * quality
                    LUMINANCE_BASE.map { ((it * scale + 50) / 100).coerceIn(1, 255) }.sorted() == table
                }
            }
            offset += 2 + length
        }
        error("No quantization table")
    }

    /** Pixels that do not compress: an encoded size that tracks the quality and the dimensions. */
    private fun noise(width: Int, height: Int): Bitmap {
        val random = java.util.Random(12)
        val pixels = IntArray(width * height) { Color.rgb(random.nextInt(256), random.nextInt(256), random.nextInt(256)) }
        return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    }

    @Test
    fun `a document photo keeps a 4032 x 3024 still at full size, at quality 92 (Phase 12A K2)`() {
        val image = ImageEncoding.uprightJpeg(bitmap(4032, 3024), 0, StillKind.DOCUMENT)

        assertEquals(4032 to 3024, size(image))
        assertEquals(92, jpegQuality(image.bytes))
        assertEquals(4096, StillKind.DOCUMENT.maxDimension)
        assertEquals(4096, ImageEncoding.MAX_DIMENSION)
    }

    @Test
    fun `a selfie keeps its 2048 px cap and quality 90`() {
        val image = ImageEncoding.uprightJpeg(bitmap(4032, 3024), 90, StillKind.SELFIE)

        assertEquals(1536 to 2048, size(image))
        assertEquals(90, jpegQuality(image.bytes))
    }

    @Test
    fun `a document photo over the upload limit is encoded again at 85, then smaller, until it fits`() {
        val frame = noise(400, 300)
        val at92 = ImageEncoding.uprightJpeg(frame, 0, maxDimension = 400, quality = 92).bytes.size
        val at85 = ImageEncoding.uprightJpeg(frame, 0, maxDimension = 400, quality = 85).bytes.size
        assertTrue("noise at 85 is smaller than at 92", at85 < at92)

        val requalified = ImageEncoding.uprightJpeg(frame, 0, StillKind.DOCUMENT, maxBytes = at85)
        assertEquals(400 to 300, size(requalified))
        assertEquals(85, jpegQuality(requalified.bytes))

        val shrunk = ImageEncoding.uprightJpeg(frame, 0, StillKind.DOCUMENT, maxBytes = at85 - 1)
        assertEquals(85, jpegQuality(shrunk.bytes))
        assertTrue(shrunk.bytes.size < at85)
        assertTrue(size(shrunk).first < 400)
    }

    @Test
    fun `a photo that fits at no size tried is refused, as the camera's other failures are`() {
        assertThrows(CameraCaptureException::class.java) {
            ImageEncoding.uprightJpeg(noise(200, 150), 0, StillKind.DOCUMENT, maxBytes = 10)
        }
    }

    private companion object {
        /** The IJG luminance base table (ITU-T T.81 Annex K), in natural order. */
        val LUMINANCE_BASE = listOf(
            16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
            14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
            18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
            49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
        )
    }
}
