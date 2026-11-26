package dev.openverify.sdk.ui.steps

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.PickedDocument
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.isolated
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.ui.DocumentPick
import dev.openverify.sdk.ui.DocumentPicker
import dev.openverify.sdk.ui.RecordingActions
import dev.openverify.sdk.ui.TestTags
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.PluralStringResource
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getPluralString
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C60, C64.2: the document step's screen. It names the accepted documents with the guidance's
 * window, the formats and the page limit; the file picker gets the accepted media types, and a
 * photo can be taken when the step allows it; a picked file shows by its name and size only, and
 * each refusal says what to do.
 */
@RunWith(RobolectricTestRunner::class)
class DocumentStepScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = RecordingActions()
    private val step = DocumentStep(
        "proof",
        listOf(DocumentClass.UTILITY_BILL, DocumentClass.LEASE, DocumentClass.TAX_DOCUMENT),
        listOf(CaptureMethod.UPLOAD, CaptureMethod.CAMERA),
    )
    private val guided = FlowState.Document(
        step,
        step.documentTypes,
        maxAgeDays = 90,
        maxPages = 50,
        mediaTypes = DocumentFile.MIME_TYPES,
        upload = true,
        camera = true,
    )
    private val pdf = PickedDocument(DocumentFile("%PDF-1.7\n%synthetic\n".encodeToByteArray(), "application/pdf"), "statement.pdf", 20)

    /** A picker without a system UI: each launch records its media types and hands over [next]. */
    private inner class FakeDocumentPicker(var next: DocumentPick? = DocumentPick.Picked(pdf)) : DocumentPicker {
        val launches = mutableListOf<List<String>>()

        @Composable
        override fun rememberLauncher(onPicked: (DocumentPick) -> Unit): (List<String>) -> Unit = { mediaTypes ->
            launches += mediaTypes
            next?.let(onPicked)
        }
    }

    /** [res] as a screen shows it: each value isolated (C199.5, K10A-2). */
    private fun text(res: StringResource, vararg args: Any) = runBlocking { getString(res, *args.map { isolated(it.toString()) }.toTypedArray()) }

    private fun plural(res: PluralStringResource, n: Int) = runBlocking { getPluralString(res, n, isolated(n.toString())) }

    @Test
    fun `it names each accepted document with the guidance's window, the formats and the page limit`() {
        rule.setContent { DocumentStepScreen(guided, actions, FakeDocumentPicker()) }

        rule.onNodeWithText(text(Res.string.openverify_document_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_document_accepted)).assertExists()
        rule.onNodeWithText(plural(Res.plurals.openverify_document_type_utility_bill, 90)).assertExists()
        rule.onNodeWithText("A utility bill dated within the last ${isolated("90")} days").assertExists()
        rule.onNodeWithText(text(Res.string.openverify_document_type_lease)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_document_type_tax_document)).assertExists()
        rule.onNodeWithText("Upload it in one of these formats: ${isolated("PDF, JPEG, PNG, WebP")}, of up to ${isolated("10")} MB.").assertExists()
        rule.onNodeWithText(plural(Res.plurals.openverify_document_pages, 50)).assertExists()
    }

    @Test
    fun `without the guidance's window it names the step's own documents`() {
        rule.setContent { DocumentStepScreen(guided.copy(maxAgeDays = null, maxPages = null), actions, FakeDocumentPicker()) }

        rule.onNodeWithText(text(Res.string.openverify_document_name_utility_bill)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_document_name_lease)).assertExists()
        rule.onNodeWithText(plural(Res.plurals.openverify_document_pages, 50)).assertDoesNotExist()
    }

    @Test
    fun `the file picker opens for the accepted media types, and its document or refusal goes to the actions`() {
        val picker = FakeDocumentPicker()
        rule.setContent { DocumentStepScreen(guided.copy(mediaTypes = listOf("application/pdf")), actions, picker) }

        rule.onNodeWithTag(TestTags.DOCUMENT_CHOOSE).performScrollTo().performClick()
        picker.next = DocumentPick.Refused(DocumentError.TOO_LARGE)
        rule.onNodeWithTag(TestTags.DOCUMENT_CHOOSE).performScrollTo().performClick()

        assertEquals(listOf(listOf("application/pdf"), listOf("application/pdf")), picker.launches)
        assertEquals(listOf("pickDocument", "refuseDocument"), actions.calls)
        assertEquals(listOf<Any?>(pdf, DocumentError.TOO_LARGE), actions.sent)
    }

    @Test
    fun `a photo can be taken when the step allows the camera, and not otherwise`() {
        rule.setContent { DocumentStepScreen(guided, actions, FakeDocumentPicker()) }

        rule.onNodeWithTag(TestTags.DOCUMENT_PHOTO).performScrollTo().assertTextEquals(text(Res.string.openverify_document_photo)).performClick()

        assertEquals(listOf("takeDocumentPhoto"), actions.calls)
    }

    @Test
    fun `an upload-only step offers no camera`() {
        rule.setContent { DocumentStepScreen(guided.copy(camera = false), actions, FakeDocumentPicker()) }

        rule.onNodeWithTag(TestTags.DOCUMENT_PHOTO).assertDoesNotExist()
        rule.onNodeWithTag(TestTags.DOCUMENT_CHOOSE).assertExists()
    }

    @Test
    fun `a picked file shows by its name and size only, to upload or to replace`() {
        val picker = FakeDocumentPicker()
        rule.setContent { DocumentStepScreen(guided.copy(picked = pdf), actions, picker) }

        rule.onNodeWithTag(TestTags.DOCUMENT_PICKED).assertTextEquals(text(Res.string.openverify_document_picked, "statement.pdf", "20 B"))
        rule.onNodeWithText(text(Res.string.openverify_document_upload)).performScrollTo().performClick()
        rule.onNodeWithText(text(Res.string.openverify_document_choose_another)).performScrollTo().performClick()

        assertEquals(listOf("submitDocument", "pickDocument"), actions.calls)
        assertEquals(1, picker.launches.size)
    }

    private fun showsRefusal(error: DocumentError, words: StringResource) {
        rule.setContent { DocumentStepScreen(guided.copy(error = error), actions, FakeDocumentPicker()) }
        rule.onNodeWithText(text(words)).assertExists()
    }

    @Test
    fun `an empty file is refused with what to do`() = showsRefusal(DocumentError.EMPTY, Res.string.openverify_document_error_empty)

    @Test
    fun `a file over 10 MB is refused with what to do`() = showsRefusal(DocumentError.TOO_LARGE, Res.string.openverify_document_error_too_large)

    @Test
    fun `a file of another type is refused with what to do`() =
        showsRefusal(DocumentError.UNSUPPORTED_TYPE, Res.string.openverify_document_error_unsupported)

    @Test
    fun `a file that cannot be read is refused with what to do`() =
        showsRefusal(DocumentError.UNREADABLE, Res.string.openverify_document_error_unreadable)

    @Test
    fun `while the document is on its way the screen says so and nothing can be pressed`() {
        rule.setContent { DocumentStepScreen(guided.copy(picked = pdf, busy = true), actions, FakeDocumentPicker()) }

        rule.onNodeWithText(text(Res.string.openverify_document_uploading)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_document_upload)).assertIsNotEnabled()
        rule.onNodeWithText(text(Res.string.openverify_document_choose_another)).assertIsNotEnabled()
    }

    @Test
    fun `the previous attempt's hints show above the documents`() {
        val hinted = guided.copy(retryHints = listOf(RetryHint("document_recency_detection", listOf("document_too_old"))))
        rule.setContent { DocumentStepScreen(hinted, actions, FakeDocumentPicker()) }

        rule.onNodeWithText(text(Res.string.openverify_retry_title_attempt)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_retry_document_too_old)).assertExists()
    }

    @Test
    fun `a device with no file picker and no camera says it cannot provide a document here`() {
        rule.setContent { DocumentStepScreen(guided.copy(camera = false), actions, null) }

        rule.onNodeWithText(text(Res.string.openverify_document_unavailable)).assertExists()
        rule.onNodeWithTag(TestTags.DOCUMENT_CHOOSE).assertDoesNotExist()
    }
}
