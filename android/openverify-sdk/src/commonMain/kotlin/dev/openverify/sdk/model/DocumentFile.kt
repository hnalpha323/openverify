package dev.openverify.sdk.model

/**
 * A document to upload to a document verification (C52.4): a PDF, or a JPEG, PNG or WebP image,
 * typed by its bytes, at most [MAX_BYTES]. It is held in memory only and never printed: it can hold
 * the user's name and address. Its own file name is never sent.
 *
 * @throws IllegalArgumentException if the bytes are empty, larger than [MAX_BYTES], or not of
 *   [mimeType] as their content says.
 */
internal class DocumentFile(
    public val bytes: ByteArray,
    /** One of [MIME_TYPES], as [sniff] reads the bytes. */
    public val mimeType: String,
) {
    init {
        require(bytes.isNotEmpty()) { "The document is empty" }
        require(bytes.size <= MAX_BYTES) { "The document is larger than the 10 MiB upload limit" }
        require(mimeType in MIME_TYPES) { "Documents must be PDF, JPEG, PNG or WebP" }
        require(sniff(bytes) == mimeType) { "The document's bytes are not of its type" }
    }

    override fun equals(other: Any?): Boolean =
        other is DocumentFile && mimeType == other.mimeType && bytes.contentEquals(other.bytes)

    override fun hashCode(): Int = 31 * mimeType.hashCode() + bytes.contentHashCode()

    override fun toString(): String = "DocumentFile($mimeType, ${bytes.size} bytes)"

    public companion object {
        /** C52.4 `maxUploadBytes('document')`: 10 MiB. */
        public const val MAX_BYTES: Int = 10 * 1024 * 1024

        /** C52.4 `DOCUMENT_MIME_TYPES`, a PDF first. */
        public val MIME_TYPES: List<String> = listOf("application/pdf", "image/jpeg", "image/png", "image/webp")

        /**
         * C52.4 `detectUploadMimeType('document', …)`: the media type [bytes] are as a document, by
         * their content: a JPEG, PNG or WebP image by its signature, else a PDF whose `%PDF-`
         * header lies within the first 1,024 bytes; `null` for anything else.
         */
        public fun sniff(bytes: ByteArray): String? = when {
            bytes.startsWith(0, JPEG) -> "image/jpeg"
            bytes.startsWith(0, PNG) -> "image/png"
            bytes.startsWith(0, RIFF) && bytes.startsWith(8, WEBP) -> "image/webp"
            (0..minOf(bytes.size, PDF_HEADER_WINDOW) - PDF_HEADER.size).any { bytes.startsWith(it, PDF_HEADER) } -> "application/pdf"
            else -> null
        }

        private val JPEG = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())
        private val PNG = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        private val RIFF = "RIFF".encodeToByteArray()
        private val WEBP = "WEBP".encodeToByteArray()
        private val PDF_HEADER = "%PDF-".encodeToByteArray()

        /** C52.4: the PDF header must lie within the first 1,024 bytes, as PDF readers look for it. */
        private const val PDF_HEADER_WINDOW = 1024

        private fun ByteArray.startsWith(offset: Int, signature: ByteArray): Boolean =
            size >= offset + signature.size && signature.indices.all { this[offset + it] == signature[it] }
    }
}
