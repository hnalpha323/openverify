package dev.openverify.sdk.capture.barcode

import android.graphics.Bitmap
import android.graphics.Rect
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.log.SdkLog
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.nio.ByteBuffer
import zxingcpp.BarcodeReader as ZxingReader

/**
 * C203.2 (decision 20): zxing-cpp's PDF417 reader over analysis frames, the glue a host test cannot run
 * (its native library loads only on a device; `ZxingCppBarcodeReaderDeviceTest` covers it, and
 * `kover-excludes/pdf417-guidance.txt` names it). The RGBA_8888 frame is copied into one bitmap kept
 * per frame size (C201.1: nothing allocated per frame after the first of a size), read on
 * [dispatcher], and the first PDF417's raw bytes returned for the guidance to judge and wipe. The
 * native library loads on the first read; when it cannot (a host, a stripped ABI), the reader decodes
 * nothing from then on: guidance only, so a missing reader never ends a capture.
 */
internal class ZxingCppBarcodeReader(
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : BarcodeReader, AutoCloseable {
    private val lock = Mutex()
    private var zxing: ZxingReader? = null
    private var unavailable = false
    @Volatile
    private var closed = false
    private var bitmap: Bitmap? = null
    private var source: ByteArray? = null
    private var buffer: ByteBuffer? = null
    private val crop = Rect()

    override suspend fun readPdf417(frame: AnalysisFrame): ByteArray? = lock.withLock {
        if (closed) return@withLock null
        val reader = loaded() ?: return@withLock null
        try {
            withContext(dispatcher) {
                val image = bitmapOf(frame)
                crop.set(0, 0, frame.width, frame.height)
                firstPdf417(reader.read(image, crop, frame.rotationDegrees))
            }
        } finally {
            // Closed while this read ran: the read releases what close() could not.
            if (closed) release()
        }
    }

    private fun loaded(): ZxingReader? {
        zxing?.let { return it }
        if (unavailable) return null
        return try {
            ZxingReader(pdf417Options()).also { zxing = it }
        } catch (_: LinkageError) {
            unavailable = true
            SdkLog.log("barcode.reader_unavailable")
            null
        }
    }

    /** The frame's pixels in the bitmap kept for its size; the frame's buffer is wrapped once while the producer reuses it. */
    private fun bitmapOf(frame: AnalysisFrame): Bitmap {
        val kept = bitmap?.takeIf { it.width == frame.width && it.height == frame.height }
            ?: Bitmap.createBitmap(frame.width, frame.height, Bitmap.Config.ARGB_8888).also {
                bitmap?.recycle()
                bitmap = it
            }
        val wrapped = buffer?.takeIf { source === frame.bytes } ?: ByteBuffer.wrap(frame.bytes).also {
            source = frame.bytes
            buffer = it
        }
        wrapped.clear()
        wrapped.limit(frame.width * frame.height * AnalysisFrame.BYTES_PER_PIXEL)
        // ARGB_8888 is laid out R, G, B, A in memory, as RGBA_8888 frames are: a straight copy.
        kept.copyPixelsFromBuffer(wrapped)
        return kept
    }

    /** Releases the kept bitmap, at once or when the read in progress ends; a read after this decodes nothing. */
    override fun close() {
        closed = true
        if (!lock.tryLock()) return
        try {
            release()
        } finally {
            lock.unlock()
        }
    }

    private fun release() {
        bitmap?.recycle()
        bitmap = null
        source = null
        buffer = null
    }
}
