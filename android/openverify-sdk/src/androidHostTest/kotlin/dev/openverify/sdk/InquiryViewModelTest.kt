package dev.openverify.sdk

import androidx.camera.core.CameraSelector
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.camera.toDeviceSnapshot
import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.PickedDocument
import dev.openverify.sdk.model.AamvaInputs
import dev.openverify.sdk.model.AamvaSource
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.AssociatedPersonInputs
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.CryptoSigningMethod
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.DatabaseBusinessInputs
import dev.openverify.sdk.model.DatabaseBusinessStep
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.EnvironmentKind
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowEnvironment
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.PersonField
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
internal class InquiryViewModelTest {

    private val dispatcher: TestDispatcher = StandardTestDispatcher()
    private val consentStep = FakeFlowApi.DEFAULT_FLOW.steps[0] as ConsentStep
    private val idStep = FakeFlowApi.DEFAULT_FLOW.steps[1]

    @BeforeEach
    fun setMain() = Dispatchers.setMain(dispatcher)

    @AfterEach
    fun resetMain() = Dispatchers.resetMain()

    private fun viewModel(api: FakeFlowApi) = InquiryViewModel(
        FlowCoordinator(api, INQUIRY_ID, FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 2)),
        INQUIRY_ID,
    )

    @Test
    fun `the flow starts when the view model is created`() = runTest(dispatcher) {
        val viewModel = viewModel(FakeFlowServer())
        advanceUntilIdle()

        assertEquals(FlowState.Consent(consentStep, retentionDays = FakeFlowApi.RETENTION_DAYS), viewModel.state.value)
        assertNull(viewModel.result.value)
    }

    @Test
    fun `screen actions drive the coordinator`() = runTest(dispatcher) {
        val api = FakeFlowServer()
        val viewModel = viewModel(api)
        advanceUntilIdle()

        viewModel.acceptConsent(emptySet())
        advanceUntilIdle()
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), viewModel.state.value)

        val photo = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg")
        viewModel.capture(photo, null)
        assertEquals(photo, (viewModel.state.value as FlowState.Capture).image)
        viewModel.retake()
        assertNull((viewModel.state.value as FlowState.Capture).image)
        viewModel.capture(photo, null)
        viewModel.confirmCapture()
        advanceUntilIdle()

        assertEquals(FlowState.Capture(idStep, FileKind.BACK, 1, 2), viewModel.state.value)
    }

    /** A consented, pending inquiry whose flow is [step], then the default completion and failure. */
    private fun phase5Api(step: FlowStep) = FakeFlowServer(
        flow = FakeFlowApi.DEFAULT_FLOW.copy(steps = listOf(step) + FakeFlowApi.DEFAULT_FLOW.steps.takeLast(2), transitions = emptyList()),
        inquiryStatus = InquiryStatus.PENDING,
        consent = FlowConsent(FakeFlowApi.NOW),
    )

    @Test
    fun `the phone and email screen's actions drive the coordinator (C64_2)`() = runTest(dispatcher) {
        val api = phase5Api(PhoneOtpStep("phone", listOf("US")))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val viewModel = viewModel(api)
        advanceUntilIdle()
        val phone = OtpDestination.Phone("+1 555 555 0100")

        viewModel.sendOtp(phone)
        advanceUntilIdle()
        viewModel.resendOtp()
        advanceUntilIdle()
        viewModel.changeOtpDestination()
        val changed = viewModel.state.value
        viewModel.sendOtp(phone)
        advanceUntilIdle()
        viewModel.confirmOtp("123456")
        advanceUntilIdle()

        assertEquals(null, (changed as FlowState.Otp).code)
        assertEquals(listOf<OtpDestination>(phone, phone, phone), api.otpDestinations)
        assertEquals(FlowState.Completed(FakeFlowApi.DEFAULT_FLOW.steps[3] as CompletionStep, InquiryStatus.COMPLETED), viewModel.state.value)
    }

    @Test
    fun `continuing after a limit refusal reaches the coordinator (C55_6)`() = runTest(dispatcher) {
        val api = phase5Api(EmailOtpStep("email"))
        api.decide(VerificationStatus.NEEDS_REVIEW, InquiryStatus.PENDING)
        val viewModel = viewModel(api)
        advanceUntilIdle()
        api.failNext("sendOtp", FlowApiException.RateLimited(Problem(status = 429, code = "otp_rate_limited"), null, 60))
        viewModel.sendOtp(OtpDestination.Email("jane@example.test"))
        advanceUntilIdle()
        api.otpLimited += api.verifications.single().id

        viewModel.continueAfterLimit()
        advanceUntilIdle()

        assertEquals(FlowState.Completed(FakeFlowApi.DEFAULT_FLOW.steps[3] as CompletionStep, InquiryStatus.PENDING), viewModel.state.value)
    }

    @Test
    fun `a form's values reach the coordinator (C64_2)`() = runTest(dispatcher) {
        val api = phase5Api(AamvaStep("aamva", AamvaSource.FORM))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val viewModel = viewModel(api)
        advanceUntilIdle()

        viewModel.submitInputs(
            mapOf(
                InputField.NAME_FIRST to "Jane",
                InputField.NAME_LAST to "Example",
                InputField.BIRTHDATE to "1990-04-23",
                InputField.IDENTIFICATION_NUMBER to "D1234567",
                InputField.ISSUING_AUTHORITY to "CA",
            ),
        )
        advanceUntilIdle()

        assertEquals(AamvaInputs("Jane", "Example", "1990-04-23", "D1234567", "CA"), api.entered.values.single())
        assertEquals(InquiryStatus.COMPLETED, (viewModel.state.value as FlowState.Completed).inquiryStatus)
    }

    @Test
    fun `the wallet screen's actions reach the coordinator (C64_2)`() = runTest(dispatcher) {
        val api = phase5Api(CryptoWalletStep("wallet", listOf("eip155:1"), listOf(CryptoSigningMethod.PASTE)))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val viewModel = viewModel(api)
        advanceUntilIdle()
        val address = "0x000000000000000000000000000000000000dEaD"

        viewModel.createCryptoChallenge("eip155:1", address)
        advanceUntilIdle()
        viewModel.changeCryptoWallet()
        viewModel.createCryptoChallenge("eip155:1", address)
        advanceUntilIdle()
        viewModel.submitCryptoSignature("0xsignature", null)
        advanceUntilIdle()

        assertEquals(2, api.challengeRequests.size)
        assertEquals(listOf("0xsignature"), api.cryptoSubmits.map { it.signature })
        assertEquals(InquiryStatus.COMPLETED, (viewModel.state.value as FlowState.Completed).inquiryStatus)
    }

    @Test
    fun `the document screen's actions reach the coordinator (C64_2)`() = runTest(dispatcher) {
        val api = phase5Api(DocumentStep("proof", listOf(DocumentClass.UTILITY_BILL), listOf(CaptureMethod.UPLOAD, CaptureMethod.CAMERA)))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val viewModel = viewModel(api)
        advanceUntilIdle()
        val pdf = PickedDocument(DocumentFile("%PDF-1.7\n%synthetic\n".encodeToByteArray(), "application/pdf"), "statement.pdf", 20)

        viewModel.takeDocumentPhoto()
        val photo = viewModel.state.value
        viewModel.backToDocument()
        viewModel.refuseDocument(DocumentError.EMPTY)
        val refused = viewModel.state.value
        viewModel.pickDocument(pdf)
        viewModel.discardDocument()
        val discarded = viewModel.state.value
        viewModel.pickDocument(pdf)
        viewModel.submitDocument()
        advanceUntilIdle()

        assertEquals(FileKind.DOCUMENT, (photo as FlowState.Capture).kind)
        assertEquals(DocumentError.EMPTY, (refused as FlowState.Document).error)
        assertEquals(null, (discarded as FlowState.Document).picked)
        assertEquals(listOf(pdf.file), api.documents.map { it.second })
        assertEquals(InquiryStatus.COMPLETED, (viewModel.state.value as FlowState.Completed).inquiryStatus)
    }

    @Test
    fun `a business form's people reach the coordinator (C64_2)`() = runTest(dispatcher) {
        val api = phase5Api(DatabaseBusinessStep("business", collectAssociatedPersons = true))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val viewModel = viewModel(api)
        advanceUntilIdle()

        viewModel.submitInputs(
            mapOf(InputField.BUSINESS_NAME to "Example Widgets Ltd", InputField.COUNTRY_CODE to "GB"),
            listOf(mapOf(PersonField.NAME_FIRST to "Robin", PersonField.NAME_LAST to "Sample")),
        )
        advanceUntilIdle()

        assertEquals(
            DatabaseBusinessInputs("Example Widgets Ltd", "GB", associatedPersons = listOf(AssociatedPersonInputs("Robin", "Sample"))),
            api.entered.values.single(),
        )
    }

    @Test
    fun `what the user typed is kept while they are on the step and forgotten once the flow leaves it (C53_8)`() = runTest(dispatcher) {
        val api = phase5Api(PhoneOtpStep("phone", listOf("US")))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val viewModel = viewModel(api)
        advanceUntilIdle()
        viewModel.drafts["phone:destination"] = "555 555 0100"

        viewModel.sendOtp(OtpDestination.Phone("+1 555 555 0100"))
        advanceUntilIdle()
        val whileOnTheStep = viewModel.drafts["phone:destination"]
        viewModel.drafts["phone:code"] = "123456"
        viewModel.confirmOtp("123456")
        advanceUntilIdle()

        assertEquals("555 555 0100", whileOnTheStep)
        assertEquals("", viewModel.drafts["phone:destination"])
        assertEquals("", viewModel.drafts["phone:code"])
    }

    @Test
    fun `the drafts of one step are forgotten as soon as another step's screen shows (C53_8)`() = runTest(dispatcher) {
        val phoneStep = PhoneOtpStep("phone", listOf("US"))
        val emailStep = EmailOtpStep("email")
        val api = FakeFlowServer(
            flow = FakeFlowApi.DEFAULT_FLOW.copy(steps = listOf(phoneStep, emailStep) + FakeFlowApi.DEFAULT_FLOW.steps.takeLast(2), transitions = emptyList()),
            inquiryStatus = InquiryStatus.PENDING,
            consent = FlowConsent(FakeFlowApi.NOW),
            verifications = listOf(FakeFlowApi.verification("ver_01M5CK16P0D13FXHZSS4TCFBVA", VerificationType.PHONE_NUMBER, VerificationStatus.PASSED)),
        )
        val viewModel = viewModel(api)
        viewModel.drafts["phone:destination"] = "555 555 0100"

        advanceUntilIdle()

        assertEquals(emailStep, (viewModel.state.value as FlowState.Otp).step)
        assertEquals("", viewModel.drafts["phone:destination"])
    }

    @Test
    fun `the optional consent keys the user ticked reach the server (C42_3)`() = runTest(dispatcher) {
        val api = FakeFlowServer()
        val viewModel = viewModel(api)
        advanceUntilIdle()

        viewModel.acceptConsent(setOf("consent.biometric-matching"))
        advanceUntilIdle()

        assertEquals(listOf("consent.biometric-matching"), api.optionalConsent)
    }

    @Test
    fun `outside a sandbox a picked photo is not taken (C19)`() = runTest(dispatcher) {
        val viewModel = viewModel(FakeFlowServer(consent = FlowConsent(FakeFlowApi.NOW)))
        advanceUntilIdle()

        viewModel.pick(CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg"))

        assertNull((viewModel.state.value as FlowState.Capture).image)
    }

    @Test
    fun `a camera photo's facts reach the selfie submit as its device snapshot (C40_4)`() = runTest(dispatcher) {
        val api = FakeFlowServer(
            consent = FlowConsent(FakeFlowApi.NOW),
            verifications = listOf(
                FakeFlowApi.verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", dev.openverify.sdk.model.VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED),
            ),
        )
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val viewModel = viewModel(api)
        advanceUntilIdle()
        viewModel.cameraReady()
        advanceUntilIdle()
        val facts = CameraFacts(listOf("1"), CameraSelector.LENS_FACING_FRONT, width = 1440, height = 1920, frameRate = 30)

        repeat(3) { n ->
            viewModel.capture(CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), n.toByte()), "image/jpeg"), facts)
            viewModel.confirmCapture()
            advanceUntilIdle()
        }

        assertEquals(facts.toDeviceSnapshot(), api.submits.single().capture?.device)
    }

    @Test
    fun `the selfie capture is created once the screen reports the camera ready (4B H014)`() = runTest(dispatcher) {
        val selfieStep = FakeFlowApi.DEFAULT_FLOW.steps[2]
        val api = FakeFlowServer(
            consent = FlowConsent(FakeFlowApi.NOW),
            verifications = listOf(
                FakeFlowApi.verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", dev.openverify.sdk.model.VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED),
            ),
        )
        val viewModel = viewModel(api)
        advanceUntilIdle()
        assertEquals(FlowState.AwaitingCamera(selfieStep), viewModel.state.value)
        assertEquals(emptyList<FakeFlowApi.Capture>(), api.captures)

        viewModel.cameraReady()
        advanceUntilIdle()

        assertEquals(FlowState.Capture(selfieStep, FileKind.SELFIE_CENTER, 0, 3), viewModel.state.value)
        assertEquals(1, api.captures.size)
    }

    @Test
    fun `retry repeats the failed call`() = runTest(dispatcher) {
        val api = FakeFlowServer()
        api.failNext("getSession", dev.openverify.sdk.api.FlowApiException.Network(java.io.IOException("offline")))
        val viewModel = viewModel(api)
        advanceUntilIdle()

        viewModel.retry()
        advanceUntilIdle()

        assertEquals(FlowState.Consent(consentStep, retentionDays = FakeFlowApi.RETENTION_DAYS), viewModel.state.value)
    }

    @Test
    fun `the sandbox flag follows the session (C19)`() = runTest(dispatcher) {
        val sandbox = viewModel(FakeFlowServer(environment = FlowEnvironment(EnvironmentKind.SANDBOX)))
        val production = viewModel(FakeFlowServer(environment = FlowEnvironment(EnvironmentKind.PRODUCTION)))
        advanceUntilIdle()

        assertEquals(true, sandbox.sandbox.value)
        assertEquals(false, production.sandbox.value)
    }

    @Test
    fun `cancel ends the flow as canceled`() = runTest(dispatcher) {
        val viewModel = viewModel(FakeFlowServer())
        advanceUntilIdle()

        viewModel.cancel()

        assertEquals(InquiryResult.Canceled(INQUIRY_ID), viewModel.result.value)
    }

    @Test
    fun `finish reports the terminal state`() = runTest(dispatcher) {
        val api = FakeFlowServer(
            inquiryStatus = InquiryStatus.COMPLETED,
            consent = FlowConsent(FakeFlowApi.NOW),
            verifications = listOf(
                FakeFlowApi.verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", dev.openverify.sdk.model.VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED),
                FakeFlowApi.verification("ver_01M5CK3190XEVBM5ZXA76E1JSM", dev.openverify.sdk.model.VerificationType.SELFIE, VerificationStatus.PASSED),
            ),
        )
        val viewModel = viewModel(api)
        advanceUntilIdle()

        viewModel.finish()

        assertEquals(InquiryResult.Completed(INQUIRY_ID, InquiryStatus.COMPLETED), viewModel.result.value)
    }

    @Test
    fun `back cancels a flow in progress`() = runTest(dispatcher) {
        val viewModel = viewModel(FakeFlowServer())
        advanceUntilIdle()

        viewModel.back()

        assertEquals(InquiryResult.Canceled(INQUIRY_ID), viewModel.result.value)
    }

    @Test
    fun `back on a terminal screen reports its outcome`() = runTest(dispatcher) {
        val api = FakeFlowServer()
        api.failNext("getSession", dev.openverify.sdk.api.FlowApiException.Unauthorized(null, null))
        val viewModel = viewModel(api)
        advanceUntilIdle()

        viewModel.back()

        assertEquals(InquiryResult.Failed(INQUIRY_ID, FailureReason.SESSION_EXPIRED), viewModel.result.value)
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(
        "problems/session-canceled-inquiry-expired.json, INQUIRY_EXPIRED",
        "problems/session-canceled-inquiry-redacted.json, INQUIRY_REDACTED",
        "problems/session-canceled-inquiry-finished.json, SESSION_CANCELED",
    )
    fun `a canceled session reports why to the host app (C25)`(fixture: String, reason: FailureReason) = runTest(dispatcher) {
        val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read(fixture))
        val api = FakeFlowServer()
        api.failNext("getSession", dev.openverify.sdk.api.FlowApiException.Unauthorized(problem, problem.requestId))
        val viewModel = viewModel(api)
        advanceUntilIdle()

        viewModel.finish()

        assertEquals(InquiryResult.Failed(INQUIRY_ID, reason), viewModel.result.value)
    }

    @Test
    fun `the first ending wins`() = runTest(dispatcher) {
        val viewModel = viewModel(FakeFlowServer())
        advanceUntilIdle()

        viewModel.cancel()
        viewModel.finish()

        assertEquals(InquiryResult.Canceled(INQUIRY_ID), viewModel.result.value)
    }
}
