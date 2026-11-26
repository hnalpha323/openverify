package dev.openverify.sdk.camera

/**
 * C201.1 (rule 19): the pixel buffer analysis frames are copied into, one per frame size and reused
 * for every frame of that size, so the pipeline allocates no pixels per frame after the first of a
 * size. A buffer a consumer may still hold ([abandon]) is never written again. Not thread-safe: one
 * analyzer thread calls it.
 */
internal class FrameBuffers {
    private var buffer: ByteArray? = null

    /** How many buffers were made: one per frame size, plus one after each [abandon]. */
    var allocations: Int = 0
        private set

    /** The buffer for an RGBA frame of [width] by [height]: the last one when it has that size. */
    fun take(width: Int, height: Int): ByteArray {
        val size = width * height * AnalysisFrame.BYTES_PER_PIXEL
        buffer?.let { if (it.size == size) return it }
        allocations += 1
        return ByteArray(size).also { buffer = it }
    }

    /** The last buffer may still be read (its consumer did not release it in time): the next frame gets a new one. */
    fun abandon() {
        buffer = null
    }
}
