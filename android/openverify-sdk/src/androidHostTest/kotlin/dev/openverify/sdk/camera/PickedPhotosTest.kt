package dev.openverify.sdk.camera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.ExifInterface
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.io.InputStream
import java.util.zip.CRC32
import java.util.zip.DeflaterOutputStream

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PickedPhotosTest {

    private fun encoded(width: Int, height: Int, format: Bitmap.CompressFormat): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GRAY) }
        return ByteArrayOutputStream().also { bitmap.compress(format, 90, it) }.toByteArray()
    }

    /** A grey PNG written by hand: a few kilobytes on disk, however many pixels it declares. */
    private fun blankPng(width: Int, height: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val data = DataOutputStream(out)
        fun chunk(type: String, body: ByteArray) {
            val typed = type.toByteArray(Charsets.US_ASCII) + body
            data.writeInt(body.size)
            data.write(typed)
            data.writeInt(CRC32().apply { update(typed) }.value.toInt())
        }
        data.write(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))
        val header = ByteArrayOutputStream()
        DataOutputStream(header).apply {
            writeInt(width)
            writeInt(height)
            // 8-bit grey, deflate, adaptive filtering, not interlaced.
            write(byteArrayOf(8, 0, 0, 0, 0))
        }
        chunk("IHDR", header.toByteArray())
        val pixels = ByteArrayOutputStream()
        DeflaterOutputStream(pixels).use { deflate ->
            // Each row is its filter type (none) and then its grey pixels.
            val row = ByteArray(1 + width) { if (it == 0) 0 else 0x80.toByte() }
            repeat(height) { deflate.write(row) }
        }
        chunk("IDAT", pixels.toByteArray())
        chunk("IEND", ByteArray(0))
        return out.toByteArray()
    }

    /**
     * A JPEG with the EXIF metadata a phone photo carries: the camera's make and model, and where
     * it was taken (synthetic values, written by the platform's own EXIF writer).
     */
    private fun jpegWithMetadata(): ByteArray {
        val file = File.createTempFile("picked", ".jpg")
        try {
            file.writeBytes(encoded(60, 40, Bitmap.CompressFormat.JPEG))
            ExifInterface(file.absolutePath).apply {
                setAttribute(ExifInterface.TAG_MAKE, CAMERA_MAKE)
                setAttribute(ExifInterface.TAG_MODEL, CAMERA_MODEL)
                // 12.3456 N, 32.1098 W, as degrees, minutes and seconds.
                setAttribute(ExifInterface.TAG_GPS_LATITUDE, "12/1,20/1,4416/100")
                setAttribute(ExifInterface.TAG_GPS_LATITUDE_REF, "N")
                setAttribute(ExifInterface.TAG_GPS_LONGITUDE, "32/1,6/1,3528/100")
                setAttribute(ExifInterface.TAG_GPS_LONGITUDE_REF, "W")
                saveAttributes()
            }
            return file.readBytes()
        } finally {
            file.delete()
        }
    }

    private fun ByteArray.containsAscii(text: String): Boolean = String(this, Charsets.ISO_8859_1).contains(text)

    @Test
    fun `a picked PNG is re-encoded as a JPEG of the same size`() {
        val photo = PickedPhotos.toUpload(encoded(60, 40, Bitmap.CompressFormat.PNG))!!

        assertEquals("image/jpeg", photo.mimeType)
        val decoded = BitmapFactory.decodeByteArray(photo.bytes, 0, photo.bytes.size)
        assertEquals(60 to 40, decoded.width to decoded.height)
    }

    @Test
    fun `a picked photo's metadata, where it was taken and the camera, never leaves the device (2D F023)`() {
        val picked = jpegWithMetadata()
        // The input really carries the metadata.
        val input = ExifInterface(ByteArrayInputStream(picked))
        assertEquals(CAMERA_MAKE, input.getAttribute(ExifInterface.TAG_MAKE))
        assertEquals(CAMERA_MODEL, input.getAttribute(ExifInterface.TAG_MODEL))
        assertNotNull(input.getAttribute(ExifInterface.TAG_GPS_LATITUDE))
        val where = FloatArray(2)
        assertTrue(input.getLatLong(where))
        assertEquals(LATITUDE, where[0], 0.0001f)
        assertEquals(LONGITUDE, where[1], 0.0001f)
        assertTrue(picked.containsAscii(CAMERA_MODEL))

        val photo = PickedPhotos.toUpload(picked)!!

        val output = ExifInterface(ByteArrayInputStream(photo.bytes))
        assertNull(output.getAttribute(ExifInterface.TAG_MAKE))
        assertNull(output.getAttribute(ExifInterface.TAG_MODEL))
        assertNull(output.getAttribute(ExifInterface.TAG_GPS_LATITUDE))
        assertNull(output.getAttribute(ExifInterface.TAG_GPS_LONGITUDE))
        assertFalse(output.getLatLong(FloatArray(2)))
        assertFalse(photo.bytes.containsAscii(CAMERA_MAKE))
        assertFalse(photo.bytes.containsAscii(CAMERA_MODEL))
        val decoded = BitmapFactory.decodeByteArray(photo.bytes, 0, photo.bytes.size)
        assertEquals(60 to 40, decoded.width to decoded.height)
    }

    @Test
    fun `a large photo is scaled down like a camera frame`() {
        val photo = PickedPhotos.toUpload(encoded(4200, 1000, Bitmap.CompressFormat.JPEG))!!

        val decoded = BitmapFactory.decodeByteArray(photo.bytes, 0, photo.bytes.size)
        assertEquals(ImageEncoding.MAX_DIMENSION, maxOf(decoded.width, decoded.height))
    }

    @Test
    fun `a picked photo is decoded with its longest side from the upload size to under twice it (2D F017)`() {
        val max = ImageEncoding.MAX_DIMENSION
        assertEquals(1, PickedPhotos.sampleSize(60, 40))
        assertEquals(1, PickedPhotos.sampleSize(2 * max - 1, 10))
        assertEquals(2, PickedPhotos.sampleSize(2 * max, 10))
        // 40 megapixels: decoded at 4095 x 2441 (about 40 MB), not in full (about 160 MB).
        assertEquals(2, PickedPhotos.sampleSize(8191, 4883))
        // Phase 12A K2: the upload size is 4096 px now, and the decode stays within its budget.
        assertEquals(4096, max)
        assertEquals(2, PickedPhotos.sampleSize(8000, 5000))
        assertTrue(8000L / 2 * (5000 / 2) <= PickedPhotos.MAX_DECODE_PIXELS)
        // Decoded at 4000 x 4000, not 8000 x 8000 (about 256 MB).
        assertEquals(4, PickedPhotos.sampleSize(16_000, 16_000))
        for (longest in listOf(max, 2 * max - 1, 2 * max, 5000, 8191, 8192, 16_000, 65_535, 100_000)) {
            val sample = PickedPhotos.sampleSize(longest, 1)
            assertEquals("$longest is sampled by a power of two", 0, sample and (sample - 1))
            assertTrue("$longest / $sample", longest / sample in max until 2 * max)
            assertEquals(sample, PickedPhotos.sampleSize(1, longest))
        }
    }

    @Test
    fun `a photo of more than 40 megapixels is refused, however small its file (2D F017)`() {
        val atTheLimit = blankPng(8000, 5000)
        val overTheLimit = blankPng(8000, 5001)
        assertTrue(overTheLimit.size < PickedPhotos.MAX_FILE_BYTES / 100)

        assertNull(PickedPhotos.toUpload(overTheLimit))
        val photo = PickedPhotos.toUpload(atTheLimit)!!
        val decoded = BitmapFactory.decodeByteArray(photo.bytes, 0, photo.bytes.size)
        // Phase 12A K2: decoded at half size, 4000 x 2500, within the decode budget; never scaled up.
        assertEquals(4000 to 2500, decoded.width to decoded.height)
    }

    @Test
    fun `a long, thin photo is used, not lost to an error in the encoder (2D F017)`() {
        val photo = PickedPhotos.toUpload(blankPng(1, 5000))!!

        val decoded = BitmapFactory.decodeByteArray(photo.bytes, 0, photo.bytes.size)
        assertEquals(1 to ImageEncoding.MAX_DIMENSION, decoded.width to decoded.height)
    }

    @Test
    fun `a picked file is loaded as an upload`() {
        val png = encoded(60, 40, Bitmap.CompressFormat.PNG)

        assertEquals("image/jpeg", PickedPhotos.load { ByteArrayInputStream(png) }?.mimeType)
        assertNull(PickedPhotos.load { null })
    }

    @Test
    fun `running out of memory while loading a picked photo gives no photo, not a crash (2D F017)`() {
        val exhausted = object : InputStream() {
            override fun read(): Int = throw OutOfMemoryError("Failed to allocate a 268435456 byte allocation")
        }

        assertNull(PickedPhotos.load { exhausted })
    }

    @Test
    fun `any other failure while loading a picked photo gives no photo, not a crash (2D F017)`() {
        assertNull(PickedPhotos.load { throw IllegalStateException("the provider failed") })
    }

    @Test
    fun `bytes that are not an image give no photo`() {
        assertNull(PickedPhotos.toUpload("not an image".toByteArray()))
        assertNull(PickedPhotos.toUpload(ByteArray(0)))
    }

    @Test
    fun `a file is read up to the limit, and a larger one gives nothing`() {
        val bytes = ByteArray(10) { it.toByte() }

        assertArrayEquals(bytes, PickedPhotos.read(maxBytes = 10) { ByteArrayInputStream(bytes) })
        assertNull(PickedPhotos.read(maxBytes = 9) { ByteArrayInputStream(bytes) })
        assertNull(PickedPhotos.read(maxBytes = 10) { null })
    }

    @Test
    fun `a file that cannot be read gives nothing`() {
        val broken = object : InputStream() {
            override fun read(): Int = throw java.io.IOException("gone")
        }

        assertNull(PickedPhotos.read(maxBytes = 10) { broken })
        assertNull(PickedPhotos.read(maxBytes = 10) { throw SecurityException("no access") })
    }

    private companion object {
        // Synthetic metadata: no real camera, and a point in the open ocean.
        const val CAMERA_MAKE = "OpenVerifySyntheticMake"
        const val CAMERA_MODEL = "OpenVerifySyntheticModel 1"
        const val LATITUDE = 12.3456f
        const val LONGITUDE = -32.1098f
    }
}
