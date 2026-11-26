package dev.openverify.sdk.camera

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

class CapturedImageTest {

    @Test
    fun `images are equal when their bytes and type are`() {
        val a = CapturedImage(byteArrayOf(1, 2, 3), "image/jpeg")

        assertEquals(a, CapturedImage(byteArrayOf(1, 2, 3), "image/jpeg"))
        assertEquals(a.hashCode(), CapturedImage(byteArrayOf(1, 2, 3), "image/jpeg").hashCode())
        assertNotEquals(a, CapturedImage(byteArrayOf(1, 2, 4), "image/jpeg"))
        assertNotEquals(a, CapturedImage(byteArrayOf(1, 2, 3), "image/png"))
        assertFalse(a.equals("image/jpeg"))
    }

    @Test
    fun `toString describes the image without its bytes`() {
        val image = CapturedImage(byteArrayOf(42, 43, 44), "image/png")

        assertEquals("CapturedImage(image/png, 3 bytes)", image.toString())
        assertFalse(image.toString().contains("42"))
    }

    @ParameterizedTest
    @ValueSource(strings = ["image/gif", "application/octet-stream", ""])
    fun `only the formats the flow API accepts are allowed`(mimeType: String) {
        assertThrows<IllegalArgumentException> { CapturedImage(byteArrayOf(1), mimeType) }
    }

    @Test
    fun `an empty image is refused`() {
        assertThrows<IllegalArgumentException> { CapturedImage(ByteArray(0), "image/jpeg") }
    }

    @Test
    fun `an image over the 10 MiB upload limit is refused`() {
        CapturedImage(ByteArray(CapturedImage.MAX_BYTES), "image/webp")

        assertThrows<IllegalArgumentException> { CapturedImage(ByteArray(CapturedImage.MAX_BYTES + 1), "image/jpeg") }
    }
}
