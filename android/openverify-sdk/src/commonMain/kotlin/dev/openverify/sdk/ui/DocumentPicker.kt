package dev.openverify.sdk.ui

import androidx.compose.runtime.Composable
import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.PickedDocument

/**
 * Lets the user choose a document file for a document step (C64.2): a PDF or an image of the
 * media types the step accepts. The host passes it in: the system document picker on Android
 * (`SystemDocumentPicker` in androidMain), a document picker on iOS from Phase 10; tests use a fake.
 * The file is read as it is, never re-encoded, and never stored.
 */
internal interface DocumentPicker {
    /**
     * A function that opens the picker for the given media types. [onPicked] gets the document, or
     * why the chosen file cannot be used. Nothing is called when the user backs out.
     */
    @Composable
    fun rememberLauncher(onPicked: (DocumentPick) -> Unit): (mediaTypes: List<String>) -> Unit
}

/** What the document picker gave: a document to show and upload, or why the file is refused. */
internal sealed interface DocumentPick {
    data class Picked(val document: PickedDocument) : DocumentPick

    data class Refused(val error: DocumentError) : DocumentPick
}
