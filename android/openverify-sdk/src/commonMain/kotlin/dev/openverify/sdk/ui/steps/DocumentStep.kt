package dev.openverify.sdk.ui.steps

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkPluralText
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.i18n.sdkText
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.ui.DocumentPick
import dev.openverify.sdk.ui.DocumentPicker
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.screen.submitProtection
import dev.openverify.sdk.ui.text.Text
import kotlin.math.roundToLong
import org.jetbrains.compose.resources.StringResource

/**
 * C60, C64.2: the document step. It names each accepted document with the window the guidance
 * gives (a lease that is in force, a tax document of the latest tax year), the formats and the
 * page limit; then the user chooses a file of the accepted media types through the host's
 * [documentPicker], or takes a photo with the camera when the step allows it. A picked file shows
 * by its own name and size only (a PDF is never rendered), to upload or to replace; each refusal
 * says what to do. Without a picker or a camera, the screen says the device cannot help here.
 */
@Composable
internal fun DocumentStepScreen(
    state: FlowState.Document,
    actions: FlowActions,
    documentPicker: DocumentPicker?,
    modifier: Modifier = Modifier,
) {
    val launch = documentPicker?.rememberLauncher { pick ->
        when (pick) {
            is DocumentPick.Picked -> actions.pickDocument(pick.document)
            is DocumentPick.Refused -> actions.refuseDocument(pick.error)
        }
    }
    val chooseFile: (() -> Unit)? = if (state.upload && launch != null) ({ launch(state.mediaTypes) }) else null
    val separator = sdkString(Res.string.openverify_decimal_separator)

    StepLayout(title = sdkString(Res.string.openverify_document_title), modifier = modifier) {
        Paragraph(sdkString(Res.string.openverify_document_intro))
        AttemptHints(state.retryHints)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text = sdkString(Res.string.openverify_document_accepted), style = MaterialTheme.typography.titleSmall)
            state.acceptedTypes.forEach { type ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // The bullet is layout only: each item is read as its words.
                    Text(text = "•", modifier = Modifier.clearAndSetSemantics { })
                    Text(text = documentTypeText(type, state.maxAgeDays), style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
        Paragraph(
            sdkText(
                Res.string.openverify_document_formats,
                state.mediaTypes.mapNotNull(FORMAT_NAMES::get).joinToString(", "),
                DocumentFile.MAX_BYTES / BYTES_PER_MB,
            ).text,
        )
        val maxPages = state.maxPages
        if (PDF in state.mediaTypes && maxPages != null) {
            Paragraph(sdkPluralText(Res.plurals.openverify_document_pages, maxPages, maxPages).text)
        }
        state.error?.let { ErrorMessage(sdkString(documentErrorWords(it))) }
        val picked = state.picked
        if (picked == null) {
            if (chooseFile != null) {
                Button(onClick = chooseFile, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag(TestTags.DOCUMENT_CHOOSE).submitProtection()) {
                    Text(sdkString(Res.string.openverify_document_choose))
                }
            }
            // KP10-36 (C213.1): the pickers open like the capture screen's, so they drop obscured touches too.
            if (state.camera) {
                val photo: @Composable () -> Unit = { Text(sdkString(Res.string.openverify_document_photo)) }
                val tagged = Modifier.fillMaxWidth().testTag(TestTags.DOCUMENT_PHOTO)
                if (chooseFile != null) {
                    OutlinedButton(onClick = actions::takeDocumentPhoto, enabled = !state.busy, modifier = tagged.submitProtection()) { photo() }
                } else {
                    Button(onClick = actions::takeDocumentPhoto, enabled = !state.busy, modifier = tagged.submitProtection()) { photo() }
                }
            }
            if (chooseFile == null && !state.camera) Paragraph(sdkString(Res.string.openverify_document_unavailable))
        } else {
            Text(
                // C199.5: the file's name keeps its own order inside the sentence.
                text = sdkText(
                    Res.string.openverify_document_picked,
                    picked.name ?: sdkString(Res.string.openverify_document_unnamed),
                    fileSizeText(picked.size, separator),
                ),
                style = MaterialTheme.typography.titleMedium,
                // Read out as soon as a file is chosen.
                modifier = Modifier.testTag(TestTags.DOCUMENT_PICKED).semantics { liveRegion = LiveRegionMode.Polite },
            )
            Paragraph(sdkString(Res.string.openverify_document_picked_hint))
            Button(onClick = actions::submitDocument, enabled = !state.busy, modifier = Modifier.fillMaxWidth().submitProtection()) {
                Text(sdkString(Res.string.openverify_document_upload))
            }
            OutlinedButton(onClick = chooseFile ?: actions::discardDocument, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
                Text(sdkString(Res.string.openverify_document_choose_another))
            }
        }
        if (state.busy) BusyRow(sdkString(Res.string.openverify_document_uploading))
        TextButton(onClick = actions::cancel, modifier = Modifier.fillMaxWidth()) {
            Text(sdkString(Res.string.openverify_cancel))
        }
    }
}

/** An accepted document's words: with the guidance's window of [days] when known (C60.6). */
@Composable
private fun documentTypeText(type: DocumentClass, days: Int?): String = when {
    days == null -> sdkString(
        when (type) {
            DocumentClass.UTILITY_BILL -> Res.string.openverify_document_name_utility_bill
            DocumentClass.BANK_STATEMENT -> Res.string.openverify_document_name_bank_statement
            DocumentClass.LEASE -> Res.string.openverify_document_name_lease
            DocumentClass.PAY_STUB -> Res.string.openverify_document_name_pay_stub
            DocumentClass.TAX_DOCUMENT -> Res.string.openverify_document_name_tax_document
        },
    )
    type == DocumentClass.UTILITY_BILL -> sdkPluralText(Res.plurals.openverify_document_type_utility_bill, days, days).text
    type == DocumentClass.BANK_STATEMENT -> sdkPluralText(Res.plurals.openverify_document_type_bank_statement, days, days).text
    type == DocumentClass.PAY_STUB -> sdkPluralText(Res.plurals.openverify_document_type_pay_stub, days, days).text
    type == DocumentClass.LEASE -> sdkString(Res.string.openverify_document_type_lease)
    else -> sdkString(Res.string.openverify_document_type_tax_document)
}

/** What a refused document's words say to do. */
internal fun documentErrorWords(error: DocumentError): StringResource = when (error) {
    DocumentError.EMPTY -> Res.string.openverify_document_error_empty
    DocumentError.TOO_LARGE -> Res.string.openverify_document_error_too_large
    DocumentError.UNSUPPORTED_TYPE -> Res.string.openverify_document_error_unsupported
    DocumentError.UNREADABLE -> Res.string.openverify_document_error_unreadable
}

private const val PDF = "application/pdf"

/** The formats' own names, the same in every language. */
private val FORMAT_NAMES = mapOf(PDF to "PDF", "image/jpeg" to "JPEG", "image/png" to "PNG", "image/webp" to "WebP")

private const val BYTES_PER_KB = 1024L
private const val BYTES_PER_MB = 1024 * 1024

/**
 * A file size in SI symbols, the same in every language: bytes (`B`) under 1 KiB, else kilobytes
 * (`kB`) or megabytes (`MB`) with one decimal, if any, written with [decimalSeparator].
 */
internal fun fileSizeText(bytes: Long, decimalSeparator: String): String {
    if (bytes < BYTES_PER_KB) return "$bytes B"
    val megabytes = bytes >= BYTES_PER_MB
    val tenths = (bytes * 10.0 / if (megabytes) BYTES_PER_MB.toDouble() else BYTES_PER_KB.toDouble()).roundToLong()
    val number = if (tenths % 10 == 0L) "${tenths / 10}" else "${tenths / 10}$decimalSeparator${tenths % 10}"
    return "$number ${if (megabytes) "MB" else "kB"}"
}
