package dev.openverify.sdk.ui

import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.PickedDocument
import dev.openverify.sdk.model.DocumentFile
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

/**
 * C52.4, C64.2: a document picked with the system picker is read as it is (never re-encoded, so a
 * PDF stays a PDF and a photo keeps what the server's checks read), bounded at 10 MiB, typed by its
 * bytes, and refused when empty, too large, of a type the step does not accept, or unreadable.
 */
class PickedDocumentsTest {

    private val all = DocumentFile.MIME_TYPES
    private val pdf = "%PDF-1.7\n%synthetic\n".encodeToByteArray()

    private fun stream(bytes: ByteArray): () -> InputStream = { ByteArrayInputStream(bytes) }

    @Test
    fun `a PDF is read as it is, with its own name and size`() {
        assertEquals(
            DocumentPick.Picked(PickedDocument(DocumentFile(pdf, "application/pdf"), "statement.pdf", pdf.size.toLong())),
            PickedDocuments.load("statement.pdf", all, stream(pdf)),
        )
    }

    @Test
    fun `a photo keeps its own bytes, and a file without a name keeps none`() {
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE1.toByte(), 1, 2, 3)

        val picked = PickedDocuments.load(null, all, stream(jpeg)) as DocumentPick.Picked

        assertEquals(DocumentFile(jpeg, "image/jpeg"), picked.document.file)
        assertEquals(null, picked.document.name)
    }

    @Test
    fun `a file is refused when empty, over 10 MiB, of a type the step does not accept, or unreadable`() {
        assertEquals(DocumentPick.Refused(DocumentError.EMPTY), PickedDocuments.load("a.pdf", all, stream(ByteArray(0))))
        assertEquals(
            DocumentPick.Refused(DocumentError.TOO_LARGE),
            PickedDocuments.load("big.pdf", all, stream(pdf + ByteArray(DocumentFile.MAX_BYTES))),
        )
        assertEquals(
            DocumentPick.Refused(DocumentError.UNSUPPORTED_TYPE),
            PickedDocuments.load("notes.pdf", all, stream("just text".encodeToByteArray())),
        )
        assertEquals(DocumentPick.Refused(DocumentError.UNSUPPORTED_TYPE), PickedDocuments.load("a.pdf", listOf("image/png"), stream(pdf)))
        assertEquals(DocumentPick.Refused(DocumentError.UNREADABLE), PickedDocuments.load("a.pdf", all) { null })
        assertEquals(
            DocumentPick.Refused(DocumentError.UNREADABLE),
            PickedDocuments.load("a.pdf", all) { object : InputStream() { override fun read(): Int = throw IOException("gone") } },
        )
        assertEquals(DocumentPick.Refused(DocumentError.UNREADABLE), PickedDocuments.load("a.pdf", all) { throw SecurityException("revoked") })
    }

    @Test
    fun `exactly 10 MiB is accepted`() {
        val limit = pdf + ByteArray(DocumentFile.MAX_BYTES - pdf.size)

        assertEquals(true, PickedDocuments.load("limit.pdf", all, stream(limit)) is DocumentPick.Picked)
    }
}
