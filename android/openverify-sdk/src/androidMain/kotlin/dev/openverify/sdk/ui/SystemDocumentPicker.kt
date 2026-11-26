package dev.openverify.sdk.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.PickedDocument
import dev.openverify.sdk.model.DocumentFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

/**
 * The system document picker for a document step (C64.2): it needs no storage permission and offers
 * the files of the step's media types. The picked file is read off the main thread, as it is
 * ([PickedDocuments]), and never stored; its display name is read to show the user, never sent.
 */
internal object SystemDocumentPicker : DocumentPicker {
    @Composable
    override fun rememberLauncher(onPicked: (DocumentPick) -> Unit): (mediaTypes: List<String>) -> Unit {
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        val deliver by rememberUpdatedState(onPicked)
        val accepted = remember { mutableStateOf(DocumentFile.MIME_TYPES) }
        val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) {
                scope.launch {
                    val pick = withContext(Dispatchers.IO) {
                        PickedDocuments.load(displayName(context, uri), accepted.value) { context.contentResolver.openInputStream(uri) }
                    }
                    deliver(pick)
                }
            }
        }
        return { mediaTypes ->
            accepted.value = mediaTypes
            launcher.launch(mediaTypes.toTypedArray())
        }
    }

    /** The file's own name, as its provider gives it; `null` when it gives none. */
    private fun displayName(context: Context, uri: Uri): String? = try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    } catch (_: RuntimeException) {
        // A provider that refuses the query still lets the file be read.
        null
    }
}

/**
 * Reads a document the user picked (C52.4, C64.2), as it is: never decoded or re-encoded, so a PDF
 * stays a PDF and a photo keeps the bytes the server's document checks read. At most
 * [DocumentFile.MAX_BYTES] are read; the type comes from the bytes, never the file name.
 */
internal object PickedDocuments {
    /**
     * The pick of the file [open] gives, named [name]: the document when it is a PDF or an image of
     * [mediaTypes], else why not. It does not suspend, so no coroutine cancellation passes through it.
     */
    fun load(name: String?, mediaTypes: List<String>, open: () -> InputStream?): DocumentPick {
        val bytes = try {
            read(open) ?: return DocumentPick.Refused(DocumentError.UNREADABLE)
        } catch (_: TooLarge) {
            return DocumentPick.Refused(DocumentError.TOO_LARGE)
        }
        if (bytes.isEmpty()) return DocumentPick.Refused(DocumentError.EMPTY)
        val type = DocumentFile.sniff(bytes)
        if (type == null || type !in mediaTypes) return DocumentPick.Refused(DocumentError.UNSUPPORTED_TYPE)
        return DocumentPick.Picked(PickedDocument(DocumentFile(bytes, type), name, bytes.size.toLong()))
    }

    private class TooLarge : Exception()

    /** At most [DocumentFile.MAX_BYTES] from [open]; `null` when it cannot be read. */
    private fun read(open: () -> InputStream?): ByteArray? = try {
        open()?.use { input ->
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(BUFFER_BYTES)
            var total = 0
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                if (total > DocumentFile.MAX_BYTES) throw TooLarge()
                out.write(buffer, 0, count)
            }
            out.toByteArray()
        }
    } catch (_: IOException) {
        null
    } catch (_: SecurityException) {
        // The picker's grant was revoked, or the provider refused.
        null
    } catch (_: OutOfMemoryError) {
        null
    }

    private const val BUFFER_BYTES = 64 * 1024
}
