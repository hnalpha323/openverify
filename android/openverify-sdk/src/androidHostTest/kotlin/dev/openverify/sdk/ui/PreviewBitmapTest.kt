package dev.openverify.sdk.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/** The review photo's decoding seam (KMP plan K3) on Android, where BitmapFactory decodes it. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PreviewBitmapTest {

    @Test
    fun `a JPEG photo decodes to a bitmap of its size`() {
        val bitmap = decodePreviewBitmap(testJpeg(width = 32, height = 20).bytes)

        assertEquals(32 to 20, bitmap?.let { it.width to it.height })
    }

    @Test
    fun `a PNG decodes to a bitmap of its size`() {
        val bitmap = decodePreviewBitmap(TWO_BY_THREE_PNG)

        assertEquals(2 to 3, bitmap?.let { it.width to it.height })
    }

    @Test
    fun `bytes that are not an image decode to nothing`() {
        assertNull(decodePreviewBitmap(byteArrayOf(1, 2, 3)))
    }
}
