package dev.openverify.sdk.camera

/**
 * An encoded photo, held only in memory. It is biometric or identity data, so [toString] never
 * prints the bytes.
 *
 * @throws IllegalArgumentException if the image is empty, larger than [MAX_BYTES], or not one of
 *   [ACCEPTED_MIME_TYPES].
 */
internal class CapturedImage(
    public val bytes: ByteArray,
    /** `image/jpeg`, `image/png` or `image/webp`: the formats the flow API accepts. */
    public val mimeType: String,
) {
    init {
        require(mimeType in ACCEPTED_MIME_TYPES) { "Images must be JPEG, PNG or WebP" }
        require(bytes.isNotEmpty()) { "The image is empty" }
        require(bytes.size <= MAX_BYTES) { "The image is larger than the 10 MiB upload limit" }
    }

    override fun equals(other: Any?): Boolean =
        other is CapturedImage && mimeType == other.mimeType && bytes.contentEquals(other.bytes)

    override fun hashCode(): Int = 31 * mimeType.hashCode() + bytes.contentHashCode()

    override fun toString(): String = "CapturedImage($mimeType, ${bytes.size} bytes)"

    public companion object {
        /** The flow API's upload limit: 10 MiB. */
        public const val MAX_BYTES: Int = 10 * 1024 * 1024

        public val ACCEPTED_MIME_TYPES: Set<String> = setOf("image/jpeg", "image/png", "image/webp")
    }
}
