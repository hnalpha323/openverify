package dev.openverify.sdk.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * The review photo's decoding seam (KMP plan K3) on iOS, where Skia decodes it. It compiles on
 * Linux and runs on the iOS simulator from Phase 10, beside the Android `PreviewBitmapTest`.
 */
class IosPreviewBitmapTest {

    @Test
    fun aPngDecodesToABitmapOfItsSize() {
        val bitmap = assertNotNull(decodePreviewBitmap(TWO_BY_THREE_PNG))

        assertEquals(2, bitmap.width)
        assertEquals(3, bitmap.height)
    }

    @Test
    fun bytesThatAreNotAnImageDecodeToNothing() {
        assertNull(decodePreviewBitmap(byteArrayOf(1, 2, 3)))
    }
}
