package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * C204.1: the web flow's `yunet-input.ts` in Kotlin. The guidance frame is the camera frame turned
 * upright and scaled to [SelfieGuidanceConstants.PREVIEW_WIDTH_PX] wide (never wider than the frame),
 * and YuNet takes it as a float NCHW tensor of BGR values in 0-255, zero-padded right and bottom to
 * multiples of 32, as OpenCV's `FaceDetectorYN` pads its input.
 */
internal const val YUNET_ALIGNMENT: Int = 32

/** [size] rounded up to a multiple of 32. */
internal fun paddedSize(size: Int): Int = (size + YUNET_ALIGNMENT - 1) / YUNET_ALIGNMENT * YUNET_ALIGNMENT

/** The guidance frame's width for a [width] × [height] upright frame: [previewWidth], never wider than the frame. */
internal fun previewWidthOf(width: Int, height: Int, previewWidth: Int): Int =
    if (width <= 0 || height <= 0) 0 else min(previewWidth, width)

/**
 * The guidance frame's height for a [width] × [height] upright frame at [previewWidthOf], same aspect
 * ratio, rounded as the web's `Math.round` rounds (halves up).
 */
internal fun previewHeightOf(width: Int, height: Int, previewWidth: Int): Int {
    val scaled = previewWidthOf(width, height, previewWidth)
    return if (scaled == 0) 0 else (scaled.toDouble() * height / width).roundToInt()
}

/**
 * The model input of one guidance frame, in one buffer reused while the frame size stays the same
 * (rule 19): [fill] writes it from an [AnalysisFrame], the detector reads it, and [wipe] clears it before
 * the frame callback returns, so no pixel outlives the callback (C204.8, rule 11).
 */
internal class YunetTensor {
    /** `3 × paddedHeight × paddedWidth` values: the B plane, then G, then R. */
    var data: FloatArray = FloatArray(0)
        private set

    /** The guidance frame's size, before padding. */
    var width: Int = 0
        private set
    var height: Int = 0
        private set

    /** The tensor's size, padded to multiples of 32. */
    var paddedWidth: Int = 0
        private set
    var paddedHeight: Int = 0
        private set

    /** Whether [data] holds anything since the last [wipe]. */
    private var written = false

    /**
     * Writes [frame], turned upright by its rotation and sampled (nearest pixel) to [previewWidth]
     * wide. False when the frame gives no guidance frame (a zero height after scaling). The frame's
     * bytes are read here and nowhere else; nothing of them is kept but the tensor, which [wipe] clears.
     */
    fun fill(frame: AnalysisFrame, previewWidth: Int = SelfieGuidanceConstants.PREVIEW_WIDTH_PX): Boolean {
        check(frame.layout == PixelLayout.RGBA_8888) { "YunetTensor reads RGBA_8888 frames" }
        val quarter = frame.rotationDegrees == 90 || frame.rotationDegrees == 270
        val uprightWidth = if (quarter) frame.height else frame.width
        val uprightHeight = if (quarter) frame.width else frame.height
        val targetWidth = previewWidthOf(uprightWidth, uprightHeight, previewWidth)
        val targetHeight = previewHeightOf(uprightWidth, uprightHeight, previewWidth)
        if (targetWidth == 0 || targetHeight == 0) return false
        wipe()
        resize(targetWidth, targetHeight)
        val plane = paddedWidth * paddedHeight
        val bytes = frame.bytes
        val rawWidth = frame.width
        val rawHeight = frame.height
        for (y in 0 until targetHeight) {
            // Nearest pixel: the centre of the target pixel, in upright source pixels.
            val uy = ((2 * y + 1) * uprightHeight) / (2 * targetHeight)
            for (x in 0 until targetWidth) {
                val ux = ((2 * x + 1) * uprightWidth) / (2 * targetWidth)
                val source = when (frame.rotationDegrees) {
                    90 -> (rawHeight - 1 - ux) * rawWidth + uy
                    180 -> (rawHeight - 1 - uy) * rawWidth + (rawWidth - 1 - ux)
                    270 -> ux * rawWidth + (rawWidth - 1 - uy)
                    else -> uy * rawWidth + ux
                } * AnalysisFrame.BYTES_PER_PIXEL
                val target = y * paddedWidth + x
                data[target] = (bytes[source + 2].toInt() and 0xFF).toFloat()
                data[plane + target] = (bytes[source + 1].toInt() and 0xFF).toFloat()
                data[2 * plane + target] = (bytes[source].toInt() and 0xFF).toFloat()
            }
        }
        written = true
        return true
    }

    /** Clears every value written. */
    fun wipe() {
        if (written) {
            data.fill(0f)
            written = false
        }
    }

    /** Sizes the tensor for a [targetWidth] × [targetHeight] guidance frame, allocating only for a new padded size. */
    private fun resize(targetWidth: Int, targetHeight: Int) {
        width = targetWidth
        height = targetHeight
        val newPaddedWidth = paddedSize(targetWidth)
        val newPaddedHeight = paddedSize(targetHeight)
        if (newPaddedWidth != paddedWidth || newPaddedHeight != paddedHeight) {
            paddedWidth = newPaddedWidth
            paddedHeight = newPaddedHeight
            data = FloatArray(3 * newPaddedWidth * newPaddedHeight)
        }
    }
}
