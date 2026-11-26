package dev.openverify.sdk.camera

import android.graphics.Bitmap
import android.graphics.Matrix
import java.io.ByteArrayOutputStream
import kotlin.math.max

/** Turns camera frames into the JPEG the flow API receives. */
internal object ImageEncoding {
    /**
     * Longest side of an uploaded photo, in pixels: a document's (Phase 12A K2; [StillKind.SELFIE]
     * keeps 2048). Picked photos use it too.
     */
    const val MAX_DIMENSION = 4096

    /** A document photo's JPEG quality (Phase 12A K2; [StillKind.SELFIE] keeps 90). */
    const val JPEG_QUALITY = 92

    /** The quality a photo over the upload limit is encoded at again, before it is made smaller. */
    const val FALLBACK_JPEG_QUALITY = 85

    /** How much each further try shrinks a photo still over the limit, and how many tries there are. */
    private const val SHRINK_STEP = 0.8f
    private const val MAX_SHRINKS = 4

    /**
     * Whether an uploaded photo is a mirror image of the scene (C40.4 `image-mirrored`). It never
     * is: CameraX's in-memory `ImageCapture` hands over the sensor's frame unmirrored (its mirror
     * mode is not supported in CameraX 1.6, and `ImageProxy.toBitmap` applies no transform), and
     * [uprightJpeg] only scales and rotates. `ImageEncodingTest` checks this on the pixels. The
     * preview may be mirrored for the user; the photo is not.
     */
    const val MIRRORS_IMAGES: Boolean = false

    /** [uprightJpeg] at [kind]'s size and quality. */
    fun uprightJpeg(
        source: Bitmap,
        rotationDegrees: Int,
        kind: StillKind,
        maxBytes: Int = CapturedImage.MAX_BYTES,
    ): CapturedImage = uprightJpeg(source, rotationDegrees, kind.maxDimension, kind.jpegQuality, maxBytes)

    /**
     * Rotates [source] upright by [rotationDegrees], scales it down so neither side exceeds
     * [maxDimension], and encodes it as a JPEG at [quality]. A JPEG over [maxBytes] (the upload
     * limit) is encoded again at [FALLBACK_JPEG_QUALITY], then smaller, step by step. Encoding a
     * bitmap writes no EXIF metadata, so nothing such as a location leaves the device with the photo.
     *
     * @throws CameraCaptureException when the photo fits [maxBytes] at no size tried.
     */
    fun uprightJpeg(
        source: Bitmap,
        rotationDegrees: Int,
        maxDimension: Int = MAX_DIMENSION,
        quality: Int = JPEG_QUALITY,
        maxBytes: Int = CapturedImage.MAX_BYTES,
    ): CapturedImage {
        require(rotationDegrees % 90 == 0) { "Rotation must be a multiple of 90 degrees" }
        var scale = minOf(1f, maxDimension.toFloat() / max(source.width, source.height))
        var level = quality
        var shrinks = 0
        while (shrinks <= MAX_SHRINKS) {
            val bytes = encode(source, rotationDegrees, scale, level)
            if (bytes.size <= maxBytes) return CapturedImage(bytes, "image/jpeg")
            if (level > FALLBACK_JPEG_QUALITY) {
                level = FALLBACK_JPEG_QUALITY
            } else {
                scale *= SHRINK_STEP
                shrinks += 1
            }
        }
        throw CameraCaptureException("The photo does not fit the upload limit")
    }

    private fun encode(source: Bitmap, rotationDegrees: Int, scale: Float, quality: Int): ByteArray {
        val matrix = Matrix().apply {
            postScale(scale, scale)
            postRotate(rotationDegrees.toFloat())
        }
        val upright = if (matrix.isIdentity) {
            source
        } else {
            Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
        }
        val out = ByteArrayOutputStream()
        upright.compress(Bitmap.CompressFormat.JPEG, quality, out)
        if (upright !== source) upright.recycle()
        return out.toByteArray()
    }
}
