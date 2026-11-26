package dev.openverify.sdk.camera

/** C201.1: how an [AnalysisFrame]'s bytes are laid out. One layout today: four bytes a pixel, R, G, B, A, rows packed. */
internal enum class PixelLayout {
    /** CameraX's `OUTPUT_IMAGE_FORMAT_RGBA_8888`, copied row by row with no padding: `width * 4` bytes a row. */
    RGBA_8888,
}

/**
 * C201.1 (decision 17): one camera frame for on-device guidance, never a photo and never uploaded
 * (C201.6). [bytes] belongs to the producer, which reuses one buffer per frame size: a consumer reads
 * it inside the callback that received the frame and keeps nothing (C204.8, rule 11). The frame is the
 * raw sensor image, unmirrored (C201.4); [rotationDegrees] (0, 90, 180 or 270) turns it upright;
 * [timestampNanos] is the camera's monotonic clock. Not a data class: no `equals`, `hashCode` or
 * `toString` reads the pixels.
 */
internal class AnalysisFrame(
    val width: Int,
    val height: Int,
    val rotationDegrees: Int,
    val layout: PixelLayout,
    val bytes: ByteArray,
    val timestampNanos: Long,
) {
    init {
        require(width > 0 && height > 0) { "AnalysisFrame: a frame has a size" }
        require(rotationDegrees in ROTATIONS) { "AnalysisFrame: the rotation is 0, 90, 180 or 270" }
        require(bytes.size >= width * height * BYTES_PER_PIXEL) { "AnalysisFrame: the buffer is smaller than the frame" }
    }

    override fun toString(): String = "AnalysisFrame(${width}x$height, rotation=$rotationDegrees, $layout)"

    internal companion object {
        /** RGBA_8888's bytes a pixel. */
        internal const val BYTES_PER_PIXEL: Int = 4

        private val ROTATIONS = setOf(0, 90, 180, 270)
    }
}
