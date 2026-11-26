package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ContractFixturesTest
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.Flow
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowMetadata
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.FlowTransition
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.UnsupportedStep
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.time.Duration.Companion.seconds

/**
 * C60, C64.2: the document step in the flow engine. Its verification is made when the step opens,
 * so its guidance (the accepted classes, the window, the pages and media types) is read before the
 * user picks a file (C52.2). A picked document is shown by its name and size, uploaded as the
 * document kind and submitted; a refusal of the file comes back to the screen; a photo from the
 * camera is uploaded the same way. The NFC step stays unsupported until Phase 10.
 */
internal class FlowCoordinatorDocumentTest {

    private val step = DocumentStep(
        "proof",
        listOf(DocumentClass.UTILITY_BILL, DocumentClass.BANK_STATEMENT),
        listOf(CaptureMethod.UPLOAD, CaptureMethod.CAMERA),
    )
    private val uploadOnly = step.copy(captureMethods = listOf(CaptureMethod.UPLOAD))
    private val completion = CompletionStep("completion", "flow.completion")
    private val failure = FailureStep("failure", "flow.failure")
    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)
    private val tooOld = RetryHint("document_recency_detection", listOf("document_too_old"))

    /** A synthetic PDF: a header, then nothing a reader needs. */
    private val pdf = PickedDocument(DocumentFile("%PDF-1.7\n%synthetic\n".encodeToByteArray(), "application/pdf"), "statement.pdf", 20)
    private val png = PickedDocument(
        DocumentFile(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0), "image/png"),
        "bill.png",
        9,
    )

    /** The screen of [step] once its guidance is read: the fake's 90 days, 50 pages and every media type. */
    private fun guided(documentStep: DocumentStep = step, hints: List<RetryHint> = emptyList()) = FlowState.Document(
        documentStep,
        documentStep.documentTypes,
        maxAgeDays = 90,
        maxPages = 50,
        mediaTypes = DocumentFile.MIME_TYPES,
        upload = true,
        camera = CaptureMethod.CAMERA in documentStep.captureMethods,
        retryHints = hints,
    )

    private fun flowOf(vararg steps: FlowStep): Flow = Flow(
        FlowMetadata(specVersion = 1, id = "proof", version = 1, name = "Proof"),
        steps.toList() + completion + failure,
        steps.map { FlowTransition(it.id, failure.id, ContractFixturesTest.FAILED_CONDITION) },
    )

    private fun api(vararg steps: FlowStep, verifications: List<FlowVerification> = emptyList()) = FakeFlowServer(
        flow = flowOf(*steps),
        inquiryStatus = InquiryStatus.PENDING,
        consent = FlowConsent(NOW),
        verifications = verifications,
    )

    private fun coordinator(api: FakeFlowApi) = FlowCoordinator(api, INQUIRY_ID, settings)

    private fun document(state: FlowState): FlowState.Document = state as FlowState.Document

    @Test
    fun `a document step makes its verification on opening and shows its guidance's classes, window, pages and media types`() = runTest {
        val api = api(step)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(guided(), coordinator.state.value)
        assertEquals(listOf("getSession", "createVerification:document", "getSession"), api.calls)
        assertEquals(listOf(VerificationStatus.INITIATED), api.verifications.map { it.attributes.status })
    }

    @Test
    fun `without guidance the step's own classes are shown, with no window and every media type`() = runTest {
        val api = api(step)
        api.guidanceOf[VerificationType.DOCUMENT] = null
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(guided().copy(maxAgeDays = null, maxPages = null), coordinator.state.value)
    }

    @Test
    fun `a guidance that accepts PDFs only offers no camera, and one of an upload-only step offers no camera either`() = runTest {
        val pdfOnly = api(step)
        pdfOnly.guidanceOf[VerificationType.DOCUMENT] = buildJsonObject {
            putJsonArray("accepted-types") { add("utility_bill") }
            put("max-age-days", 30)
            put("max-pages", 4)
            putJsonArray("accepted-mime-types") { add("application/pdf") }
        }
        val first = coordinator(pdfOnly)
        first.start()
        val second = coordinator(api(uploadOnly))
        second.start()

        assertEquals(
            FlowState.Document(step, listOf(DocumentClass.UTILITY_BILL), 30, 4, listOf("application/pdf"), upload = true, camera = false),
            first.state.value,
        )
        assertFalse(document(second.state.value).camera)
        assertTrue(document(second.state.value).upload)
    }

    @Test
    fun `a picked document is shown by its name and size, and one of a type the step does not accept is refused`() = runTest {
        val api = api(step)
        api.guidanceOf[VerificationType.DOCUMENT] = buildJsonObject {
            putJsonArray("accepted-types") { add("utility_bill") }
            put("max-age-days", 90)
            put("max-pages", 50)
            putJsonArray("accepted-mime-types") { add("application/pdf") }
        }
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.pickDocument(png)
        assertEquals(DocumentError.UNSUPPORTED_TYPE, document(coordinator.state.value).error)
        assertEquals(null, document(coordinator.state.value).picked)

        coordinator.pickDocument(pdf)
        assertEquals(pdf, document(coordinator.state.value).picked)
        assertEquals(null, document(coordinator.state.value).error)

        coordinator.discardDocument()
        assertEquals(null, document(coordinator.state.value).picked)
        assertEquals(emptyList<Pair<String, DocumentFile>>(), api.documents)
    }

    @Test
    fun `the picker's refusal of a file is shown on the screen`() = runTest {
        val coordinator = coordinator(api(step))
        coordinator.start()
        coordinator.pickDocument(pdf)

        coordinator.refuseDocument(DocumentError.TOO_LARGE)

        assertEquals(guided().copy(error = DocumentError.TOO_LARGE), coordinator.state.value)
    }

    @Test
    fun `the picked document is uploaded as the document kind, submitted, and the decision awaited`() = runTest {
        val api = api(step)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.pickDocument(pdf)

        coordinator.submitDocument()

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        val id = api.verifications.single().id
        assertEquals(listOf(id to pdf.file), api.documents)
        assertEquals(listOf(id), api.submits.map { it.verificationId })
        assertEquals(1, api.calls.count { it == "createVerification:document" })
    }

    @Test
    fun `the server's refusal of the file comes back to the screen without it, saying why`() = runTest {
        val api = api(step)
        api.failNext("upload:document", FlowApiException.Rejected(413, Problem(status = 413), null))
        api.failNext("upload:document", FlowApiException.Rejected(415, Problem(status = 415), null))
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.pickDocument(pdf)
        coordinator.submitDocument()
        assertEquals(guided().copy(error = DocumentError.TOO_LARGE), coordinator.state.value)

        coordinator.pickDocument(pdf)
        coordinator.submitDocument()
        assertEquals(guided().copy(error = DocumentError.UNSUPPORTED_TYPE), coordinator.state.value)
        assertEquals(emptyList<String>(), api.submits.map { it.verificationId })
    }

    @Test
    fun `a failure after the upload is retried by submitting again, never by uploading again`() = runTest {
        val api = api(step)
        api.failNext("submit", FlowApiException.ServerError(503, null, null))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.pickDocument(pdf)

        coordinator.submitDocument()
        assertEquals(FlowState.Error(FlowError.SERVER, canRetry = true), coordinator.state.value)
        coordinator.retry()

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(1, api.calls.count { it == "upload:document" })
        assertEquals(1, api.submits.size)
    }

    @Test
    fun `a failed document asks again with its hints, the next attempt made on opening`() = runTest {
        val api = api(step)
        api.decide(VerificationStatus.FAILED, InquiryStatus.PENDING, tooOld)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.pickDocument(pdf)

        coordinator.submitDocument()

        assertEquals(guided(hints = listOf(tooOld)), coordinator.state.value)
        assertEquals(listOf(VerificationStatus.FAILED, VerificationStatus.INITIATED), api.verifications.map { it.attributes.status })
    }

    @Test
    fun `a canceled document attempt starts again, and an initiated one is resumed without making another`() = runTest {
        val canceled = verification("ver_01M5CK16P0D13FXHZSS4TCFBV0", VerificationType.DOCUMENT, VerificationStatus.CANCELED)
        val restarted = api(step, verifications = listOf(canceled))
        val first = coordinator(restarted)
        first.start()

        assertEquals(guided(), first.state.value)
        assertEquals(1, restarted.calls.count { it == "createVerification:document" })

        val resumed = api(step, verifications = restarted.verifications.toList())
        val second = coordinator(resumed)
        second.start()

        assertEquals(guided(), second.state.value)
        assertEquals(0, resumed.calls.count { it.startsWith("createVerification") })
    }

    @Test
    fun `taking a photo goes to the camera for the document, and back returns to its screen`() = runTest {
        val api = api(step)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.takeDocumentPhoto()
        assertEquals(FlowState.Capture(step, FileKind.DOCUMENT, 0, 1), coordinator.state.value)

        coordinator.backToDocument()
        assertEquals(guided(), coordinator.state.value)
    }

    @Test
    fun `a photo of the document is uploaded as the document kind and submitted`() = runTest {
        val api = api(step)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        val photo = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()), "image/jpeg")

        coordinator.takeDocumentPhoto()
        coordinator.capture(photo)
        coordinator.confirmCapture()

        assertEquals(FlowState.Completed(completion, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(listOf(FileKind.DOCUMENT), api.uploads.map { it.kind })
        assertEquals(listOf(photo), api.uploads.map { it.image })
    }

    @Test
    fun `a step that offers no camera never opens it`() = runTest {
        val coordinator = coordinator(api(uploadOnly))
        coordinator.start()

        coordinator.takeDocumentPhoto()

        assertEquals(guided(uploadOnly), coordinator.state.value)
    }

    @Test
    fun `the NFC step stays the unsupported screen until Phase 10 (C64_2)`() = runTest {
        val coordinator = coordinator(api(UnsupportedStep("chip", "nfc")))

        coordinator.start()

        assertEquals(FlowState.Unsupported("step nfc"), coordinator.state.value)
    }
}
