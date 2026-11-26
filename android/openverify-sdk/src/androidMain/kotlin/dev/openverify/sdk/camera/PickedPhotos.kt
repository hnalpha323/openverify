package dev.openverify.sdk.camera

import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

/**
 * Photos the user picks instead of taking them, in a sandbox (C19). A picked file is decoded and
 * encoded again as a JPEG, exactly like a camera frame: this checks that it is an image, bounds
 * its size, and drops its metadata (such as where it was taken) before anything is uploaded.
 */
internal object PickedPhotos {
    /** Largest file read. Larger files are refused before decoding, to bound memory. */
    const val MAX_FILE_BYTES: Int = 25 * 1024 * 1024

    /**
     * Largest image decoded, in pixels (width x height), as the vision service's default
     * `MAX_IMAGE_PIXELS`. A small, highly compressible file can declare far more pixels than its
     * size suggests. Larger images are refused from their header, before any pixel is decoded.
     */
    const val MAX_SOURCE_PIXELS: Long = 40_000_000L

    /**
     * Largest bitmap decoded, in pixels: the upload size squared (about 64 MB). Phase 12A K2 raised
     * the upload size to 4096 px, under which a 40-megapixel photo would otherwise decode in full.
     */
    const val MAX_DECODE_PIXELS: Long = ImageEncoding.MAX_DIMENSION.toLong() * ImageEncoding.MAX_DIMENSION

    /** Reads at most [maxBytes] from [open]; `null` when it cannot be read or is larger. */
    fun read(maxBytes: Int = MAX_FILE_BYTES, open: () -> InputStream?): ByteArray? = try {
        open()?.use { input ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(BUFFER_BYTES)
            var total = 0
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                if (total > maxBytes) return null
                out.write(buffer, 0, count)
            }
            out.toByteArray()
        }
    } catch (_: IOException) {
        null
    } catch (_: SecurityException) {
        // The picker's grant was revoked, or the provider refused.
        null
    }

    /**
     * The picker's background work: reads the file [open] gives, then turns it into an upload.
     * Any failure on the way, running out of memory included, gives `null`, so the user is told the
     * photo cannot be used instead of the host app's process ending, as [takePictureOrNull] does
     * for the camera. It does not suspend, so no coroutine cancellation passes through it.
     */
    fun load(open: () -> InputStream?): CapturedImage? = try {
        read(open = open)?.let(::toUpload)
    } catch (_: Exception) {
        null
    } catch (_: OutOfMemoryError) {
        null
    }

    /** The upload for a picked file, or `null` when it is not an image this device can decode. */
    fun toUpload(bytes: ByteArray): CapturedImage? {
        if (bytes.isEmpty()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        if (bounds.outWidth.toLong() * bounds.outHeight > MAX_SOURCE_PIXELS) return null
        val options = BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight) }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
        return try {
            ImageEncoding.uprightJpeg(bitmap, rotationDegrees = 0, kind = StillKind.DOCUMENT)
        } finally {
            bitmap.recycle()
        }
    }

    /**
     * The `inSampleSize` a picked image of [width] x [height] pixels is decoded at: the largest
     * power of two that keeps its longest side at the upload size or more, so the decoded bitmap
     * stays under twice the upload size and the encoder scales it down precisely; then halved again
     * while the decoded bitmap would hold more than [MAX_DECODE_PIXELS].
     */
    fun sampleSize(width: Int, height: Int): Int {
        var sample = 1
        while (maxOf(width, height) / (sample * 2) >= ImageEncoding.MAX_DIMENSION) {
            sample *= 2
        }
        while ((width / sample).toLong() * (height / sample) > MAX_DECODE_PIXELS) {
            sample *= 2
        }
        return sample
    }

    private const val BUFFER_BYTES = 64 * 1024
}
