package dev.openverify.sdk.camera

import android.graphics.PixelFormat
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import dev.openverify.sdk.log.SdkLog
import kotlinx.coroutines.runBlocking

/**
 * C201.2 (decision 17): the `ImageAnalysis` analyzer. CameraX calls it on the camera's analysis
 * thread with each frame it keeps (`STRATEGY_KEEP_ONLY_LATEST`). A frame the [sampler] does not take,
 * or that no guidance reads ([sink]), is closed at once without a copy; a sampled one is copied, rows
 * packed, into [buffers]' reused buffer for its size, the `ImageProxy` is closed (always, in a
 * `finally`), and the copy is handed to [sink], which returns once the guidance's callback did. A
 * buffer the guidance still held then is given up, never written again. The frame is the raw sensor
 * image, never mirrored (C201.4); nothing of it is logged or kept.
 */
internal class FrameAnalyzer(
    private val sampler: FrameSampler,
    private val buffers: FrameBuffers,
    private val sink: FrameSink,
) : ImageAnalysis.Analyzer {

    override fun analyze(image: ImageProxy) {
        val frame = try {
            read(image)
        } catch (_: RuntimeException) {
            // A plane CameraX could not give, or a frame that breaks AnalysisFrame's rules: dropped.
            SdkLog.log("camera.analysis_frame_dropped")
            null
        } finally {
            image.close()
        }
        if (frame != null && runBlocking { sink.deliver(frame) } == FrameDelivery.HELD) buffers.abandon()
    }

    private fun read(image: ImageProxy): AnalysisFrame? {
        val info = image.imageInfo
        if (!sampler.take(info.timestamp) || !sink.wanted() || image.format != PixelFormat.RGBA_8888) return null
        val plane = image.planes.singleOrNull() ?: return null
        val bytes = buffers.take(image.width, image.height)
        if (!RgbaFrames.copy(plane.buffer, plane.rowStride, plane.pixelStride, image.width, image.height, bytes)) return null
        return AnalysisFrame(image.width, image.height, info.rotationDegrees, PixelLayout.RGBA_8888, bytes, info.timestamp)
    }
}
