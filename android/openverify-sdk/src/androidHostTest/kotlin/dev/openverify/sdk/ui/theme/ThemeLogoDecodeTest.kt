package dev.openverify.sdk.ui.theme

import android.graphics.Bitmap
import android.graphics.Color
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream

/**
 * C198.3 on the device's decoder: a synthetic logo in each format the rendition emits passes the
 * header checks and decodes at its size; bytes that pass the magic-byte check but are not an image
 * show no logo and do not fail the flow; an oversized header never reaches the decoder.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
internal class ThemeLogoDecodeTest {

    private fun encoded(format: Bitmap.CompressFormat, width: Int, height: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.rgb(11, 110, 79)) }
        return ByteArrayOutputStream().also { bitmap.compress(format, 90, it) }.toByteArray()
    }

    @Test
    fun `a synthetic PNG and JPEG pass the checks and decode at their size`() {
        for ((format, expected) in listOf(Bitmap.CompressFormat.PNG to LogoFormat.PNG, Bitmap.CompressFormat.JPEG to LogoFormat.JPEG)) {
            val bytes = encoded(format, 40, 20)

            assertEquals(LogoCheck.Accepted(LogoHeader(expected, 40, 20)), checkLogo(bytes))
            val image = runBlocking { loadLogo({ bytes }, "tas_synthetic", ::decodeLogo) }
            assertEquals(40, image?.width)
            assertEquals(20, image?.height)
        }
    }

    @Test
    fun `bytes with a PNG header but no image show no logo`() {
        val bytes = encoded(Bitmap.CompressFormat.PNG, 8, 8).copyOf(40)

        assertTrue(checkLogo(bytes) is LogoCheck.Accepted)
        assertNull(runBlocking { loadLogo({ bytes }, "tas_synthetic", ::decodeLogo) })
    }

    @Test
    fun `a real PNG whose header claims 4096 px a side never reaches the decoder`() {
        val bytes = encoded(Bitmap.CompressFormat.PNG, 8, 8)
        // IHDR's width and height are bytes 16 to 23 (big-endian); 4096 is 0x1000.
        for (at in listOf(16, 20)) {
            bytes[at] = 0; bytes[at + 1] = 0; bytes[at + 2] = 0x10; bytes[at + 3] = 0
        }
        var decoded = false

        assertEquals(LogoCheck.Refused(LogoRefusal.TOO_MANY_PIXELS), checkLogo(bytes))
        assertNull(runBlocking { loadLogo({ bytes }, "tas_synthetic") { decoded = true; decodeLogo(it) } })
        assertEquals(false, decoded)
    }
}
