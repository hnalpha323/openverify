package dev.openverify.sdk.camera

import android.graphics.PixelFormat
import android.graphics.Rect
import android.media.Image
import androidx.camera.core.ImageInfo
import androidx.camera.core.ImageProxy
import androidx.camera.core.impl.TagBundle
import androidx.camera.core.impl.utils.ExifData
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotSame
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.lang.management.ManagementFactory
import java.nio.ByteBuffer

/**
 * C201.2 (decision 17; rule 11): the `ImageAnalysis` analyzer closes every frame, copies only the
 * sampled frames a guidance reads, into one reused buffer per size, as the raw unmirrored frame with
 * its rotation, and gives a buffer up when its reader held it too long. Its cost per frame is measured
 * in thread CPU time (rule 6).
 */
class FrameAnalyzerTest {

    /** A guidance that reads frames: it records each one it is handed, as [answer] says. */
    private class RecordingSink(var reading: Boolean = true, var answer: FrameDelivery = FrameDelivery.RELEASED) : FrameSink {
        val frames = mutableListOf<AnalysisFrame>()
        val firstBytes = mutableListOf<Byte>()

        override fun wanted(): Boolean = reading

        override suspend fun deliver(frame: AnalysisFrame): FrameDelivery {
            frames += frame
            firstBytes += frame.bytes[0]
            return answer
        }
    }

    private class Info(private val timestamp: Long, private val rotation: Int) : ImageInfo {
        override fun getTagBundle(): TagBundle = throw UnsupportedOperationException()

        override fun getTimestamp(): Long = timestamp

        override fun getRotationDegrees(): Int = rotation

        override fun populateExifData(exifBuilder: ExifData.Builder) = Unit
    }

    private class Plane(private val buffer: ByteBuffer, private val rowStride: Int, private val pixelStride: Int) : ImageProxy.PlaneProxy {
        override fun getRowStride(): Int = rowStride

        override fun getPixelStride(): Int = pixelStride

        override fun getBuffer(): ByteBuffer = buffer
    }

    /** A CameraX frame without a camera; [planesRead] counts each read of its pixels. */
    private class Frame(
        private val width: Int,
        private val height: Int,
        timestamp: Long,
        rotation: Int = 90,
        private val format: Int = PixelFormat.RGBA_8888,
        fill: Byte = 7,
        padding: Int = 0,
        private val failing: Boolean = false,
        /** The pixels, when frames share one plane (the cost measurement); else a plane of [fill]. */
        pixels: ByteBuffer? = null,
    ) : ImageProxy {
        private val info = Info(timestamp, rotation)
        private val plane = Plane(pixels ?: ByteBuffer.wrap(ByteArray((width * 4 + padding) * height) { fill }), width * 4 + padding, 4)
        var closed = 0
        var planesRead = 0

        override fun close() {
            closed += 1
        }

        override fun getCropRect(): Rect = throw UnsupportedOperationException()

        override fun setCropRect(rect: Rect?) = throw UnsupportedOperationException()

        override fun getFormat(): Int = format

        override fun getHeight(): Int = height

        override fun getWidth(): Int = width

        override fun getPlanes(): Array<ImageProxy.PlaneProxy> {
            planesRead += 1
            if (failing) throw IllegalStateException("Image is already closed")
            return arrayOf(plane)
        }

        override fun getImageInfo(): ImageInfo = info

        override fun getImage(): Image? = null
    }

    private val sink = RecordingSink()
    private val buffers = FrameBuffers()
    private val analyzer = FrameAnalyzer(FrameSampler(8), buffers, sink)

    /** A 30 fps camera's [count] frames from [start]. */
    private fun frames(count: Int, start: Int = 0, width: Int = 64, height: Int = 48) =
        (start until start + count).map { Frame(width, height, timestamp = it * NANOS / 30, fill = it.toByte()) }

    @Test
    fun `every frame is closed, and only the sampled ones are read`() {
        val camera = frames(30)

        camera.forEach(analyzer::analyze)

        assertTrue(camera.all { it.closed == 1 }, "each frame closed once")
        assertEquals(8, sink.frames.size)
        assertEquals(8, camera.count { it.planesRead > 0 })
    }

    @Test
    fun `a sampled frame arrives packed, with its size, rotation and timestamp, as the camera gave it`() {
        val camera = Frame(6, 4, timestamp = 123_456, rotation = 270, fill = 9, padding = 8)

        analyzer.analyze(camera)

        val frame = sink.frames.single()
        assertEquals(listOf(6, 4, 270), listOf(frame.width, frame.height, frame.rotationDegrees))
        assertEquals(123_456L, frame.timestampNanos)
        assertEquals(PixelLayout.RGBA_8888, frame.layout)
        assertArrayEquals(ByteArray(6 * 4 * 4) { 9 }, frame.bytes.copyOf(6 * 4 * 4))
    }

    @Test
    fun `frames of one size share one buffer, released frame after frame`() {
        frames(90).forEach(analyzer::analyze)

        val first = sink.frames.first().bytes
        assertTrue(sink.frames.all { it.bytes === first })
        assertEquals(1, buffers.allocations)
        val indices = sink.frames.map { Math.round(it.timestampNanos * 30.0 / NANOS).toByte() }
        assertEquals(indices, sink.firstBytes, "each frame's own pixels when it was read")
    }

    @Test
    fun `a buffer its reader held too long is never written again`() {
        sink.answer = FrameDelivery.HELD
        frames(4).forEach(analyzer::analyze)
        val held = sink.frames.single().bytes

        sink.answer = FrameDelivery.RELEASED
        frames(4, start = 4).forEach(analyzer::analyze)

        assertNotSame(held, sink.frames.last().bytes)
        assertEquals(0.toByte(), held[0], "the held frame keeps its own pixels")
    }

    @Test
    fun `with no guidance reading, frames are closed and never copied`() {
        sink.reading = false
        val camera = frames(30)

        camera.forEach(analyzer::analyze)

        assertTrue(camera.all { it.closed == 1 && it.planesRead == 0 })
        assertEquals(0, buffers.allocations)
    }

    @Test
    fun `a frame that is not RGBA, or whose pixels cannot be read, is dropped and still closed`() {
        val yuv = Frame(64, 48, timestamp = 0, format = PixelFormat.TRANSLUCENT)
        val broken = Frame(64, 48, timestamp = NANOS, failing = true)

        analyzer.analyze(yuv)
        analyzer.analyze(broken)

        assertEquals(listOf(1, 1), listOf(yuv.closed, broken.closed))
        assertEquals(emptyList<AnalysisFrame>(), sink.frames)
    }

    @Test
    fun `a new frame size gets its own buffer`() {
        frames(1, width = 64, height = 48).forEach(analyzer::analyze)
        analyzer.analyze(Frame(128, 96, timestamp = NANOS))

        assertEquals(2, buffers.allocations)
        assertSame(sink.frames.last().bytes, buffers.take(128, 96))
    }

    /**
     * C201.2, rule 6: the analyzer's thread CPU time per sampled frame, at the document and barcode
     * analysis sizes (640 x 480 and 1280 x 960, padded rows), measured over 120 frames after a warm-up.
     * The budget is a bound against a regression (a per-frame allocation or a pixel-by-pixel copy), far
     * above the measured cost and far below the 125 ms between sampled frames; the measured figures go
     * to the TDD record.
     */
    @Test
    fun `a sampled frame costs the analyzer well under its 125 ms interval, in thread CPU time`() {
        val threads = ManagementFactory.getThreadMXBean()
        listOf(AnalysisTarget.DOCUMENT, AnalysisTarget.BARCODE).forEach { target ->
            val width = target.longSidePx
            val height = target.shortSidePx
            val pixels = ByteBuffer.wrap(ByteArray((width * 4 + 64) * height) { (it % 251).toByte() })
            val camera = (0 until 2 * FRAMES).asSequence().map { Frame(width, height, timestamp = it * NANOS / 8, padding = 64, pixels = pixels) }
            camera.take(FRAMES).forEach(analyzer::analyze)
            val start = threads.currentThreadCpuTime
            camera.drop(FRAMES).forEach(analyzer::analyze)
            val perFrameMs = (threads.currentThreadCpuTime - start) / 1e6 / FRAMES
            println("FrameAnalyzer CPU per sampled frame at ${width}x$height: ${"%.3f".format(perFrameMs)} ms")
            assertTrue(perFrameMs < BUDGET_MS, "${width}x$height: $perFrameMs ms a frame")
        }
    }

    private companion object {
        const val NANOS = 1_000_000_000L
        const val FRAMES = 120

        /** A regression bound, not the measurement: a twentieth of the 125 ms sampling interval. */
        const val BUDGET_MS = 6.0
    }
}
