package dev.openverify.sdk.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotSame
import kotlin.test.assertSame

/** C201.1 (rule 19): one pixel buffer per frame size, reused, and never written again once given up. */
class FrameBuffersTest {

    @Test
    fun framesOfOneSizeShareOneBuffer() {
        val buffers = FrameBuffers()

        val first = buffers.take(640, 480)
        repeat(100) { assertSame(first, buffers.take(640, 480)) }

        assertEquals(640 * 480 * 4, first.size)
        assertEquals(1, buffers.allocations)
    }

    @Test
    fun aNewSizeGetsItsOwnBuffer() {
        val buffers = FrameBuffers()
        val small = buffers.take(320, 240)

        val large = buffers.take(1280, 960)

        assertNotSame(small, large)
        assertEquals(1280 * 960 * 4, large.size)
        assertSame(large, buffers.take(1280, 960))
        assertEquals(2, buffers.allocations)
    }

    @Test
    fun aBufferGivenUpIsNeverHandedOutAgain() {
        val buffers = FrameBuffers()
        val held = buffers.take(640, 480)

        buffers.abandon()
        val next = buffers.take(640, 480)

        assertNotSame(held, next)
        assertEquals(2, buffers.allocations)
    }
}
