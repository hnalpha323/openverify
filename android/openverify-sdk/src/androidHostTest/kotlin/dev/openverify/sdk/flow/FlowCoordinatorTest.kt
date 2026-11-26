package dev.openverify.sdk.flow

import androidx.camera.core.CameraSelector
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CameraLens
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.camera.toDeviceSnapshot
import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.EnvironmentKind
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.Flow
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowEnvironment
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.FlowTransition
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.Liveness
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.Problem
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.model.SelfiePose
import dev.openverify.sdk.model.SelfieStep
import dev.openverify.sdk.model.SessionCanceledReason
import dev.openverify.sdk.model.UnsupportedStep
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.testTimeSource
import kotlinx.serialization.SerializationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.EnumSource
import org.junit.jupiter.params.provider.MethodSource
import org.junit.jupiter.params.provider.ValueSource
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
internal class FlowCoordinatorTest {

    private val consentStep = DEFAULT_FLOW.steps[0] as ConsentStep
    private val idStep = DEFAULT_FLOW.steps[1] as GovernmentIdStep
    private val selfieStep = DEFAULT_FLOW.steps[2] as SelfieStep
    private val completionStep = DEFAULT_FLOW.steps[3] as CompletionStep
    private val failureStep = DEFAULT_FLOW.steps[4] as FailureStep
    private val blurry = RetryHint("id_blur_detection", listOf("image_blurry"))

    /** C42.3: the consent step with the session's face template retention days. */
    private val consentState = FlowState.Consent(consentStep, retentionDays = FakeFlowApi.RETENTION_DAYS)

    /** The selfie poses in the order the fake server draws them (C40.2): centre, then right, then left. */
    private val selfieKinds = listOf(FileKind.SELFIE_CENTER, FileKind.SELFIE_RIGHT, FileKind.SELFIE_LEFT)
    private fun selfiePrompt(index: Int) = FlowState.Capture(selfieStep, selfieKinds[index], index, selfieKinds.size)
    private val firstSelfie = selfiePrompt(0)

    /** The calls that open the selfie step (C40.2): its verification, then a camera capture. */
    private val selfieStart = listOf("createVerification:selfie", "createSelfieCapture:camera")

    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)

    /**
     * A coordinator the UI has already told that the camera can be shown, unless [cameraReady] is
     * false: its selfie step then creates its capture as soon as the step is reached, as after the
     * user's first selfie start (Workflow 4B H014). The tests of the camera wait pass false.
     */
    private suspend fun coordinator(
        api: FakeFlowApi,
        settings: FlowCoordinator.Settings = this.settings,
        cameraReady: Boolean = true,
    ) = FlowCoordinator(api, INQUIRY_ID, settings).also { if (cameraReady) it.cameraReady() }

    private fun image(n: Int) = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), n.toByte()), "image/jpeg")

    private suspend fun FlowCoordinator.keep(image: CapturedImage) {
        capture(image)
        confirmCapture()
    }

    private fun TestScope.recordStates(coordinator: FlowCoordinator): List<FlowState> {
        val states = mutableListOf<FlowState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { coordinator.state.collect { states += it } }
        return states
    }

    /** A pending inquiry whose consent was already given. */
    private fun consented(vararg verifications: dev.openverify.sdk.model.FlowVerification, status: InquiryStatus = InquiryStatus.PENDING) =
        FakeFlowServer(inquiryStatus = status, consent = FlowConsent(NOW), verifications = verifications.toList())

    private fun flowOf(vararg steps: dev.openverify.sdk.model.FlowStep, transitions: List<FlowTransition> = emptyList()) =
        DEFAULT_FLOW.copy(steps = steps.toList(), transitions = transitions)

    // Start and consent ----------------------------------------------------------------------

    @Test
    fun `a new inquiry starts at its consent step`() = runTest {
        val coordinator = coordinator(FakeFlowServer())
        assertEquals(FlowState.Loading, coordinator.state.value)

        coordinator.start()

        assertEquals(consentState, coordinator.state.value)
    }

    @Test
    fun `accepting consent records the texts shown and their language, then opens the ID front`() = runTest {
        val api = FakeFlowServer()
        val coordinator = coordinator(api, settings.copy(locale = "es"))
        val states = recordStates(coordinator)
        coordinator.start()

        coordinator.acceptConsent()

        assertEquals(listOf("consent.biometric", "consent.processing", "notice.session-integrity") to "es", api.consentRequest)
        assertTrue(consentState.copy(submitting = true) in states, states.toString())
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, index = 0, count = 2), coordinator.state.value)
    }

    @Test
    fun `a session with consent already given starts at the ID`() = runTest {
        val coordinator = coordinator(consented())

        coordinator.start()

        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
        assertEquals(CameraLens.BACK, (coordinator.state.value as FlowState.Capture).lens)
    }

    @Test
    fun `consent to a text the UI cannot show is never recorded`() = runTest {
        val api = FakeFlowServer(flow = flowOf(ConsentStep("consent", listOf("consent.marketing"), true), completionStep))
        val coordinator = coordinator(api)

        coordinator.start()
        coordinator.acceptConsent()

        assertEquals(FlowState.Unsupported("consent text consent.marketing"), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    // Matching consent (C42.3) ----------------------------------------------------------------

    @Test
    fun `consent sends the step's text keys as they are and only the optional keys the user ticked`() = runTest {
        val api = FakeFlowServer()
        val coordinator = coordinator(api)
        coordinator.start()

        // A key the step does not offer is never sent, whatever the screen passes.
        coordinator.acceptConsent(setOf("consent.biometric-matching", "consent.marketing", "consent.biometric"))

        assertEquals(listOf("consent.biometric", "consent.processing", "notice.session-integrity") to "en", api.consentRequest)
        assertEquals(listOf("consent.biometric-matching"), api.optionalConsent)
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
    }

    @Test
    fun `declining the optional consent sends none, and the user still verifies`() = runTest {
        val api = FakeFlowServer()
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.acceptConsent()

        assertEquals(emptyList<String>(), api.optionalConsent)
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
    }

    @Test
    fun `an optional text the SDK cannot show is never sent, and the step stays supported`() = runTest {
        val step = consentStep.copy(optionalTextKeys = listOf("consent.marketing"))
        val api = FakeFlowServer(flow = flowOf(step, completionStep))
        val coordinator = coordinator(api)
        coordinator.start()
        assertEquals(FlowState.Consent(step, retentionDays = FakeFlowApi.RETENTION_DAYS), coordinator.state.value)

        coordinator.acceptConsent(setOf("consent.marketing"))

        assertEquals(emptyList<String>(), api.optionalConsent)
    }

    @Test
    fun `the consent step shows the session's face template retention days, and none from an older server`() = runTest {
        val older = coordinator(FakeFlowServer(faceTemplateRetentionDays = null))
        val current = coordinator(FakeFlowServer(faceTemplateRetentionDays = 30))

        older.start()
        current.start()

        assertEquals(FlowState.Consent(consentStep), older.state.value)
        assertEquals(FlowState.Consent(consentStep, retentionDays = 30), current.state.value)
    }

    @Test
    fun `a session for another inquiry is refused`() = runTest {
        val coordinator = coordinator(FakeFlowServer(inquiryId = "inq_01M5CJXHG07XPHF3HRM6NREDH8"))

        coordinator.start()

        assertEquals(FlowState.Error(FlowError.INQUIRY_MISMATCH, canRetry = false), coordinator.state.value)
    }

    // Capture -------------------------------------------------------------------------------

    @Test
    fun `a photo is reviewed before it is kept, and can be retaken`() = runTest {
        val coordinator = coordinator(consented())
        coordinator.start()

        coordinator.capture(image(1))
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2, image = image(1)), coordinator.state.value)
        coordinator.retake()
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
        coordinator.keep(image(2))

        assertEquals(FlowState.Capture(idStep, FileKind.BACK, 1, 2), coordinator.state.value)
    }

    @Test
    fun `capture, retake and confirm are ignored when there is nothing to act on`() = runTest {
        val api = FakeFlowServer()
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.capture(image(1))
        coordinator.confirmCapture()
        assertEquals(consentState, coordinator.state.value)

        coordinator.acceptConsent()
        coordinator.retake()
        coordinator.confirmCapture()
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)

        coordinator.acceptConsent()
        // C193.3: the one consent is followed by the session read that names the next position.
        assertEquals(listOf("getSession", "acceptConsent", "getSession"), api.calls)
    }

    @Test
    fun `the happy path uploads both sides, then each selfie pose under its capture, and completes`() = runTest {
        val api = FakeFlowServer()
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)

        coordinator.start()
        coordinator.acceptConsent()
        coordinator.keep(image(1))
        coordinator.keep(image(2))
        val selfie = coordinator.state.value as FlowState.Capture
        repeat(3) { n -> coordinator.keep(image(3 + n)) }

        assertEquals(firstSelfie, selfie)
        assertEquals(CameraLens.FRONT, selfie.lens)
        assertEquals(FlowState.Completed(completionStep, InquiryStatus.COMPLETED), coordinator.state.value)
        assertTrue(FlowState.Processing(idStep) in states, states.toString())
        assertTrue(FlowState.Processing(selfieStep) in states, states.toString())
        assertEquals(
            listOf(
                // C193.3: the consent answer names no position, so the session is read after it.
                "getSession", "acceptConsent", "getSession",
                "createVerification:government-id", "upload:front", "upload:back", "submit", "getVerification", "getSession",
            ) + selfieStart + listOf(
                "upload:selfie-center", "upload:selfie-right", "upload:selfie-left", "submit", "getVerification", "getSession",
            ),
            api.calls,
        )
        val (idVerification, selfieVerification) = api.verifications.map { it.id }
        assertEquals(
            listOf(
                FakeFlowApi.Upload(idVerification, FileKind.FRONT, image(1)),
                FakeFlowApi.Upload(idVerification, FileKind.BACK, image(2)),
            ),
            api.uploads.filter { it.verificationId == idVerification },
        )
        val capture = api.captures.single()
        assertEquals(selfieVerification, capture.verificationId)
        assertEquals(selfieKinds.zip(listOf(image(3), image(4), image(5))), api.uploadsOf(capture.id).map { it.kind to it.image })
    }

    @Test
    fun `a failed attempt with attempts left shows retry hints, and the retry is a new verification`() = runTest {
        val api = consented()
        api.decide(VerificationStatus.FAILED, InquiryStatus.PENDING, blurry)
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.keep(image(1))
        coordinator.keep(image(2))
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2, retryHints = listOf(blurry)), coordinator.state.value)
        coordinator.keep(image(3))
        assertEquals(FlowState.Capture(idStep, FileKind.BACK, 1, 2, retryHints = listOf(blurry)), coordinator.state.value)
        coordinator.keep(image(4))

        assertEquals(firstSelfie, coordinator.state.value)
        assertEquals(2, api.calls.count { it == "createVerification:government-id" })
        assertEquals(listOf(image(3), image(4)), api.uploads.filter { it.verificationId == api.verifications[1].id }.map { it.image })
    }

    @Test
    fun `a failed last attempt ends on the failed screen where the server's position ends the flow`() = runTest {
        val api = consented()
        api.decide(VerificationStatus.FAILED, InquiryStatus.FAILED)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.keep(image(1))
        coordinator.keep(image(2))

        // C193.3, C197.3: the engine ends the flow on the step it failed on (engine.ts, C50.5 kept), so
        // the failed screen has no failure step's message: today's failure screen.
        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    @Test
    fun `a front-only ID takes one photo`() = runTest {
        val frontOnly = idStep.copy(sides = DocumentSides.FRONT)
        val api = FakeFlowServer(flow = flowOf(frontOnly, completionStep), consent = FlowConsent(NOW))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        assertEquals(FlowState.Capture(frontOnly, FileKind.FRONT, 0, 1), coordinator.state.value)
        coordinator.keep(image(1))

        assertEquals(listOf(FileKind.FRONT), api.uploads.map { it.kind })
        assertEquals(FlowState.Completed(completionStep, InquiryStatus.COMPLETED), coordinator.state.value)
    }

    @Test
    fun `a back-only ID takes the back`() = runTest {
        val backOnly = idStep.copy(sides = DocumentSides.BACK)
        val coordinator = coordinator(FakeFlowServer(flow = flowOf(backOnly, completionStep), consent = FlowConsent(NOW)))

        coordinator.start()

        assertEquals(FlowState.Capture(backOnly, FileKind.BACK, 0, 1), coordinator.state.value)
    }

    // The selfie capture protocol (C40) ----------------------------------------------------------

    /** A government ID verification that passed: the flow starts at the selfie step. */
    private val passedId = verification("ver_01M5CJZC301G4JHXZQ3PZBYH3P", VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED)

    /** The selfie verification the selfie step created. */
    private fun selfieOf(api: FakeFlowApi): String = api.verifications.last { it.verificationType == VerificationType.SELFIE }.id

    private val frontCamera = CameraFacts(listOf("1"), CameraSelector.LENS_FACING_FRONT, width = 1440, height = 1920, frameRate = 30, frameRateMax = 60)

    @Test
    fun `the selfie step creates its verification and a capture before the first prompt, then prompts in the server's order (C40_2)`() = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)

        coordinator.start()
        assertEquals(listOf("getSession") + selfieStart, api.calls)
        assertEquals(firstSelfie, coordinator.state.value)
        coordinator.keep(image(1))
        assertEquals(selfiePrompt(1), coordinator.state.value)
        coordinator.keep(image(2))
        assertEquals(selfiePrompt(2), coordinator.state.value)

        // The step lists left before right; the server drew right first, and the prompts follow it.
        assertEquals(listOf(SelfiePose.CENTER, SelfiePose.LEFT, SelfiePose.RIGHT), selfieStep.poses)
        assertTrue(states.filterIsInstance<FlowState.Capture>().all { it.lens == CameraLens.FRONT }, states.toString())
        assertEquals(selfieOf(api), api.captures.single().verificationId)
        assertEquals(CaptureMethod.CAMERA, api.captures.single().method)
    }

    @Test
    fun `the selfie step creates nothing until the camera can be shown, so a slow camera permission does not use up the capture's lifetime (4B H014)`() = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api, settings.copy(timeSource = testTimeSource), cameraReady = false)

        coordinator.start()
        assertEquals(FlowState.AwaitingCamera(selfieStep), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
        // The user reads why the camera is needed, denies it, allows it in Settings and comes back.
        delay(10.minutes)
        coordinator.cameraReady()
        assertEquals(firstSelfie, coordinator.state.value)
        assertEquals(listOf("getSession") + selfieStart, api.calls)
        delay(1_500)
        coordinator.keep(image(1))

        assertEquals(selfiePrompt(1), coordinator.state.value)
        val capture = api.captures.single()
        assertEquals(listOf(SelfieCaptureUpload(capture.id, capture.nonce, 1_500)), api.uploads.map { it.capture })
    }

    @Test
    fun `once the camera was shown, a new capture starts at once, without waiting for the camera again (4B H014)`() = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api, cameraReady = false)
        coordinator.start()
        coordinator.cameraReady()
        coordinator.keep(image(1))
        api.failNext("upload:selfie-right", FakeFlowApi.conflict("selfie_capture_invalid"))

        coordinator.keep(image(2))

        assertEquals(firstSelfie.copy(restarted = true), coordinator.state.value)
        assertEquals(2, api.captures.size)
    }

    @Test
    fun `a government ID step does not wait for the camera, since it creates nothing before its photos (4B H014)`() = runTest {
        val api = consented()
        val coordinator = coordinator(api, cameraReady = false)

        coordinator.start()

        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `a camera reported ready on another screen changes nothing there (4B H014)`() = runTest {
        val api = FakeFlowServer()
        val coordinator = coordinator(api, cameraReady = false)
        coordinator.start()

        coordinator.cameraReady()

        assertEquals(consentState, coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `each pose is sent with its capture's id and nonce and the time from the capture to the shutter, before the next prompt (C40_3)`() = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api, settings.copy(timeSource = testTimeSource))
        val states = recordStates(coordinator)
        coordinator.start()

        delay(1_500)
        coordinator.capture(image(1))
        delay(4_000)
        coordinator.confirmCapture()
        assertEquals(listOf("upload:selfie-center"), api.calls.filter { it.startsWith("upload") })
        assertEquals(selfiePrompt(1), coordinator.state.value)
        delay(2_000)
        coordinator.keep(image(2))

        val capture = api.captures.single()
        assertEquals(
            listOf(
                FakeFlowApi.Upload(selfieOf(api), FileKind.SELFIE_CENTER, image(1), SelfieCaptureUpload(capture.id, capture.nonce, 1_500)),
                FakeFlowApi.Upload(selfieOf(api), FileKind.SELFIE_RIGHT, image(2), SelfieCaptureUpload(capture.id, capture.nonce, 7_500)),
            ),
            api.uploads,
        )
        assertTrue(firstSelfie.copy(image = image(1), sending = true) in states, states.toString())
    }

    @Test
    fun `submit names the capture and its nonce, with the camera's device snapshot (C40_4)`() = runTest {
        val api = consented(passedId)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        repeat(3) { n ->
            coordinator.capture(image(n), frontCamera)
            coordinator.confirmCapture()
        }

        val capture = api.captures.single()
        assertEquals(
            listOf(FakeFlowApi.Submit(selfieOf(api), FlowSubmitCapture(capture.id, capture.nonce, frontCamera.toDeviceSnapshot()))),
            api.submits,
        )
        assertEquals(false, api.submits.single().capture?.device?.imageMirrored)
        assertEquals("submitted", capture.status)
        assertEquals(FlowState.Completed(completionStep, InquiryStatus.COMPLETED), coordinator.state.value)
    }

    @Test
    fun `a centre-only passive step prompts once, under its own capture`() = runTest {
        val passive = SelfieStep("selfie", listOf(SelfiePose.CENTER), Liveness.PASSIVE, 3)
        val api = FakeFlowServer(flow = flowOf(passive, completionStep), consent = FlowConsent(NOW))
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()

        assertEquals(FlowState.Capture(passive, FileKind.SELFIE_CENTER, 0, 1), coordinator.state.value)
        coordinator.keep(image(1))

        assertEquals(FlowState.Completed(completionStep, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(listOf(FileKind.SELFIE_CENTER), api.uploadsOf(api.captures.single().id).map { it.kind })
    }

    @Test
    fun `a pose refused with selfie_capture_invalid starts a new capture and its prompts again, saying so (C40_4)`() = runTest {
        val api = consented(passedId)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.keep(image(1))
        api.failNext("upload:selfie-right", FakeFlowApi.conflict("selfie_capture_invalid"))

        coordinator.keep(image(2))

        assertEquals(firstSelfie.copy(restarted = true), coordinator.state.value)
        assertEquals(listOf("getSession", "createSelfieCapture:camera"), api.calls.takeLast(2))
        val (old, new) = api.captures
        assertEquals("errored", old.status)
        repeat(3) { n -> coordinator.keep(image(10 + n)) }
        assertEquals(listOf(image(10), image(11), image(12)), api.uploadsOf(new.id).map { it.image })
        assertEquals(FlowState.Completed(completionStep, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createVerification:selfie" })
    }

    @Test
    fun `a pose sent after the server expired the capture starts a new capture (C40_4)`() = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.keep(image(1))
        api.expireOpenCapture()

        coordinator.keep(image(2))

        assertEquals(firstSelfie.copy(restarted = true), coordinator.state.value)
        assertEquals(2, api.captures.size)
    }

    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = ["selfie_capture_invalid", "selfie_capture_incomplete"])
    fun `a submit refused with a capture problem starts a new capture (C40_4)`(code: String) = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("submit", FakeFlowApi.conflict(code))

        repeat(3) { n -> coordinator.keep(image(n)) }

        assertEquals(firstSelfie.copy(restarted = true), coordinator.state.value)
        assertEquals(2, api.captures.size)
        assertEquals(listOf("submit", "getSession", "createSelfieCapture:camera"), api.calls.takeLast(3))
    }

    @Test
    fun `a capture older than its lifetime is replaced before any photo is sent to it`() = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api, settings.copy(timeSource = testTimeSource))
        coordinator.start()
        coordinator.keep(image(1))

        delay(SelfieCaptureProtocol.CAPTURE_TTL)
        coordinator.keep(image(2))

        assertEquals(firstSelfie.copy(restarted = true), coordinator.state.value)
        assertEquals(listOf("upload:selfie-center"), api.calls.filter { it.startsWith("upload") })
        assertEquals(2, api.captures.size)
    }

    @Test
    fun `a pose that could not be sent is sent again on retry, then the next prompt shows`() = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("upload:selfie-center", FlowApiException.Network(IOException("offline")))

        coordinator.keep(image(1))
        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)
        coordinator.retry()

        assertEquals(selfiePrompt(1), coordinator.state.value)
        assertEquals(listOf(image(1)), api.uploadsOf(api.captures.single().id).map { it.image })
    }

    @Test
    fun `a submit whose answer was lost is repeated with the same capture, which the server takes again (C40_4)`() = runTest {
        val api = consented(passedId)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        api.loseAnswerOfNext("submit", FlowApiException.Network(SocketTimeoutException("timeout")))
        val coordinator = coordinator(api)
        coordinator.start()
        repeat(3) { n -> coordinator.keep(image(n)) }
        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)

        coordinator.retry()

        assertEquals(FlowState.Completed(completionStep, InquiryStatus.COMPLETED), coordinator.state.value)
        assertEquals(2, api.calls.count { it == "submit" })
        assertEquals(1, api.captures.size)
        assertEquals(1, api.submits.size)
    }

    @Test
    fun `when the capture cap cancels the verification, the session is re-read and a new attempt starts (C40_2)`() = runTest {
        val api = consented(passedId)
        api.captureLimit = 1
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.keep(image(1))
        api.failNext("upload:selfie-right", FakeFlowApi.conflict("selfie_capture_invalid"))

        coordinator.keep(image(2))

        assertEquals(firstSelfie.copy(restarted = true), coordinator.state.value)
        val selfies = api.verifications.filter { it.verificationType == VerificationType.SELFIE }
        assertEquals(listOf(VerificationStatus.CANCELED, VerificationStatus.INITIATED), selfies.map { it.attributes.status })
        assertEquals(selfies.last().id, api.captures.last().verificationId)
    }

    @Test
    fun `a failed selfie attempt with attempts left is retried on a new verification and capture, with its hints on each prompt (C43)`() = runTest {
        // The cascade: an insufficient turn alone fails only the pose check, which is retryable.
        val turn = RetryHint("selfie_pose_detection", listOf("pose_not_left"))
        val api = consented(passedId)
        api.decide(VerificationStatus.FAILED, InquiryStatus.PENDING, turn)
        val coordinator = coordinator(api)
        coordinator.start()

        repeat(3) { n -> coordinator.keep(image(n)) }
        assertEquals(firstSelfie.copy(retryHints = listOf(turn)), coordinator.state.value)
        coordinator.keep(image(10))

        assertEquals(selfiePrompt(1).copy(retryHints = listOf(turn)), coordinator.state.value)
        assertEquals(2, api.calls.count { it == "createVerification:selfie" })
        assertEquals(selfieOf(api), api.captures.last().verificationId)
        assertEquals(listOf(image(10)), api.uploadsOf(api.captures.last().id).map { it.image })
    }

    @Test
    fun `a capture create that failed on the network is retried without creating the verification twice`() = runTest {
        val api = consented(passedId)
        api.failNext("createSelfieCapture:camera", FlowApiException.Network(IOException("offline")))
        val coordinator = coordinator(api)
        coordinator.start()
        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)

        coordinator.retry()

        assertEquals(firstSelfie, coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createVerification:selfie" })
        assertEquals(listOf("createSelfieCapture:camera", "createSelfieCapture:camera"), api.calls.filter { it.startsWith("createSelfie") })
    }

    @Test
    fun `a move to an upload capture that failed on the network is made again on retry`() = runTest {
        val api = consented(passedId)
        api.environment = FlowEnvironment(EnvironmentKind.SANDBOX)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("createSelfieCapture:upload", FlowApiException.Network(IOException("offline")))
        coordinator.pick(image(1))
        coordinator.confirmCapture()
        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)

        coordinator.retry()

        assertEquals(selfiePrompt(1).copy(uploadAllowed = true), coordinator.state.value)
        assertEquals(listOf(image(1)), api.uploadsOf(api.captures.last().id).map { it.image })
        assertEquals(CaptureMethod.UPLOAD, api.captures.last().method)
    }

    @Test
    fun `resuming an initiated selfie verification makes it a new capture, since a nonce lives in memory only`() = runTest {
        val existing = "ver_01M5CK3190XEVBM5ZXA76E1JSM"
        val api = consented(passedId, verification(existing, VerificationType.SELFIE, VerificationStatus.INITIATED))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(listOf("getSession", "createSelfieCapture:camera"), api.calls)
        assertEquals(existing, api.captures.single().verificationId)
        assertEquals(firstSelfie, coordinator.state.value)
    }

    @Test
    fun `a photo picked in a sandbox for the first prompt moves to an upload capture, which sends no device snapshot (C19, C40_2)`() = runTest {
        val api = consented(passedId)
        api.environment = FlowEnvironment(EnvironmentKind.SANDBOX)
        api.decide(VerificationStatus.PASSED, InquiryStatus.COMPLETED)
        val coordinator = coordinator(api)
        coordinator.start()
        assertEquals(firstSelfie.copy(uploadAllowed = true), coordinator.state.value)

        coordinator.pick(image(1))
        coordinator.confirmCapture()
        assertEquals(selfiePrompt(1).copy(uploadAllowed = true), coordinator.state.value)
        coordinator.capture(image(2), frontCamera)
        coordinator.confirmCapture()
        coordinator.pick(image(3))
        coordinator.confirmCapture()

        val (camera, upload) = api.captures
        assertEquals(CaptureMethod.CAMERA to "errored", camera.method to camera.status)
        assertEquals(CaptureMethod.UPLOAD, upload.method)
        assertEquals(listOf(image(1), image(2), image(3)), api.uploadsOf(upload.id).map { it.image })
        assertEquals(listOf(FakeFlowApi.Submit(selfieOf(api), FlowSubmitCapture(upload.id, upload.nonce))), api.submits)
    }

    @Test
    fun `a photo picked for a later prompt starts the upload capture's prompts again`() = runTest {
        val api = consented(passedId)
        api.environment = FlowEnvironment(EnvironmentKind.SANDBOX)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.keep(image(1))

        coordinator.pick(image(2))
        coordinator.confirmCapture()

        assertEquals(firstSelfie.copy(uploadAllowed = true, restarted = true), coordinator.state.value)
        assertEquals(listOf(CaptureMethod.CAMERA, CaptureMethod.UPLOAD), api.captures.map { it.method })
        assertEquals(emptyList<FakeFlowApi.Upload>(), api.uploads.filter { it.verificationId == selfieOf(api) })
    }

    @Test
    fun `outside a sandbox a picked photo is ignored`() = runTest {
        val coordinator = coordinator(consented(passedId))
        coordinator.start()

        coordinator.pick(image(1))

        assertEquals(firstSelfie, coordinator.state.value)
    }

    // Attempts ------------------------------------------------------------------------------

    /** An earlier government ID attempt that failed; [n] makes its ID unique. */
    private fun failedId(n: Char) =
        verification("ver_01M5CJZC301G4JHXZQ3PZBYH3$n", VerificationType.GOVERNMENT_ID, VerificationStatus.FAILED)

    private fun retriedId(n: Char) =
        verification("ver_01M5CJZC301G4JHXZQ3PZBYH3$n", VerificationType.GOVERNMENT_ID, VerificationStatus.FAILED, blurry)

    @Test
    fun `when the last attempt fails, the server's position ends the flow and nothing asks for photos it refuses`() = runTest {
        // The two earlier failures offered a retry (K7A-6: one without a hint never does).
        val api = consented(retriedId('A'), retriedId('B'))
        api.decide(VerificationStatus.FAILED, InquiryStatus.PENDING, blurry)
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)
        coordinator.start()

        coordinator.keep(image(1))
        coordinator.keep(image(2))

        // C193.4 (V02): the engine ends the flow on the step and fails the inquiry in the same
        // transaction; the SDK renders that position and never waits for a failure on its own.
        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createVerification:government-id" })
        // Only the resumed third attempt showed its hints; nothing asks for photos after it failed.
        val failed = states.indexOfFirst { it is FlowState.Failed }
        assertTrue(failed >= 0, states.toString())
        assertTrue(states.drop(failed).none { it is FlowState.Capture }, states.toString())
    }

    @Test
    fun `a failed attempt with no retry hints is never retried, the server's position ends the flow, with attempts left (K7A-6, C30_1)`() = runTest {
        val api = consented(failedId('A'))
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)

        coordinator.start()

        assertTrue(states.none { it is FlowState.Capture }, states.toString())
        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    @Test
    fun `resuming with every attempt used shows the end the server's position names`() = runTest {
        val api = consented(failedId('A'), failedId('B'), failedId('C'))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `an inquiry whose position has not moved when waiting stops can be checked again`() = runTest {
        val api = consented(failedId('A'), failedId('B'), failedId('C'))
        // The server keeps the position on the used-up ID for every read of the wait.
        repeat(1 + settings.pollAttempts) { api.upcoming += FakeFlowServer.Position(idStep.id, FakeFlowServer.State.ACTIVE, consentStep.id) }
        val coordinator = coordinator(api)
        coordinator.start()
        assertEquals(FlowState.Error(FlowError.STILL_PROCESSING, canRetry = true), coordinator.state.value)
        assertEquals(1 + settings.pollAttempts, api.calls.count { it == "getSession" })
        api.inquiry = api.inquiry.copy(status = InquiryStatus.FAILED)

        coordinator.retry()

        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
        assertEquals(0, api.calls.count { it.startsWith("createVerification") })
    }

    @Test
    fun `a network error while waiting for the position re-reads the session on retry`() = runTest {
        val api = consented(failedId('A'), failedId('B'), failedId('C'))
        repeat(2) { api.upcoming += FakeFlowServer.Position(idStep.id, FakeFlowServer.State.ACTIVE, consentStep.id) }
        val coordinator = coordinator(api)
        launch { coordinator.start() }
        runCurrent()
        api.failNext("getSession", FlowApiException.Network(IOException("offline")))
        advanceUntilIdle()
        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)
        api.inquiry = api.inquiry.copy(status = InquiryStatus.FAILED)

        coordinator.retry()

        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    // Resuming ------------------------------------------------------------------------------

    @Test
    fun `resuming a failed inquiry goes straight to the failed screen`() = runTest {
        val api = consented(
            verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", VerificationType.GOVERNMENT_ID, VerificationStatus.FAILED),
            status = InquiryStatus.FAILED,
        )
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    @Test
    fun `an ID sent to review counts as done, so the selfie opens without retry hints (C30_6)`() = runTest {
        val api = consented()
        api.decide(VerificationStatus.NEEDS_REVIEW, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.keep(image(1))
        coordinator.keep(image(2))

        assertEquals(firstSelfie, coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createVerification:government-id" })
    }

    @ParameterizedTest(name = "ID {0}, selfie {1}")
    @CsvSource("NEEDS_REVIEW, PASSED", "PASSED, NEEDS_REVIEW")
    fun `a verification sent to review ends the flow on the normal completion, never on a retry (C30_6)`(
        idStatus: VerificationStatus,
        selfieStatus: VerificationStatus,
    ) = runTest {
        val api = consented()
        api.decide(idStatus, InquiryStatus.PENDING)
        // C30.5: the inquiry is completed, then marked for review in the same transaction.
        api.decide(selfieStatus, InquiryStatus.NEEDS_REVIEW)
        val coordinator = coordinator(api)
        val states = recordStates(coordinator)
        coordinator.start()

        repeat(5) { n -> coordinator.keep(image(n)) }

        assertEquals(FlowState.Completed(completionStep, InquiryStatus.NEEDS_REVIEW), coordinator.state.value)
        val captures = states.filterIsInstance<FlowState.Capture>().filter { it.image == null }
        assertEquals(listOf(FileKind.FRONT, FileKind.BACK) + selfieKinds, captures.map { it.kind })
        assertTrue(captures.all { it.retryHints.isEmpty() }, states.toString())
        assertTrue(states.none { it is FlowState.Error || it is FlowState.Failed }, states.toString())
        assertEquals(listOf("createVerification:government-id") + selfieStart, api.calls.filter { it.startsWith("create") })
    }

    @Test
    fun `resuming after an ID in review opens the selfie (C30_6)`() = runTest {
        val coordinator = coordinator(
            consented(verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", VerificationType.GOVERNMENT_ID, VerificationStatus.NEEDS_REVIEW)),
        )

        coordinator.start()

        assertEquals(firstSelfie, coordinator.state.value)
    }

    @Test
    fun `resuming after a passed ID opens the selfie`() = runTest {
        val coordinator = coordinator(
            consented(verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED)),
        )

        coordinator.start()

        assertEquals(firstSelfie, coordinator.state.value)
    }

    @Test
    fun `resuming a submitted verification waits for its decision instead of asking for photos`() = runTest {
        val api = consented(verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", VerificationType.GOVERNMENT_ID, VerificationStatus.SUBMITTED))
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(listOf("getSession", "getVerification", "getSession") + selfieStart, api.calls)
        assertEquals(firstSelfie, coordinator.state.value)
    }

    @Test
    fun `resuming an initiated verification reuses it`() = runTest {
        val existing = "ver_01M5CJZC301G4JHXZQ3PZBYH3Q"
        val api = consented(verification(existing, VerificationType.GOVERNMENT_ID, VerificationStatus.INITIATED))
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.keep(image(1))
        coordinator.keep(image(2))

        assertEquals(0, api.calls.count { it == "createVerification:government-id" })
        assertEquals(listOf(existing, existing), api.uploads.map { it.verificationId })
    }

    @ParameterizedTest(name = "{0}")
    @EnumSource(value = VerificationType::class, names = ["GOVERNMENT_ID", "SELFIE"])
    fun `an UNKNOWN status on the latest attempt is unsupported and never starts a new attempt (3B follow-up)`(
        type: VerificationType,
    ) = runTest {
        // A status added by a newer server: the attempt may still be running, or decided in a way
        // this SDK cannot read. Either way a new attempt would use up one the user may need.
        val passedId = verification("ver_01M5CJZC301G4JHXZQ3PZBYH3P", VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED)
        val unknown = verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", type, VerificationStatus.UNKNOWN)
        val api = if (type == VerificationType.SELFIE) consented(passedId, unknown) else consented(unknown)
        val coordinator = coordinator(api)

        coordinator.start()
        repeat(3) { n -> coordinator.keep(image(n)) }

        assertEquals(FlowState.Unsupported("verification status unknown"), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `resuming a failed attempt shows its retry hints`() = runTest {
        val coordinator = coordinator(
            consented(verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", VerificationType.GOVERNMENT_ID, VerificationStatus.FAILED, blurry)),
        )

        coordinator.start()

        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2, retryHints = listOf(blurry)), coordinator.state.value)
    }

    @Test
    fun `resuming a completed inquiry shows completion`() = runTest {
        val coordinator = coordinator(
            consented(
                verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED),
                verification("ver_01M5CK3190XEVBM5ZXA76E1JSM", VerificationType.SELFIE, VerificationStatus.PASSED),
                status = InquiryStatus.COMPLETED,
            ),
        )

        coordinator.start()

        assertEquals(FlowState.Completed(completionStep, InquiryStatus.COMPLETED), coordinator.state.value)
    }

    // Decided inquiries ---------------------------------------------------------------------

    @ParameterizedTest(name = "{0}")
    @EnumSource(InquiryStatus::class, names = ["COMPLETED", "APPROVED", "DECLINED", "NEEDS_REVIEW"])
    fun `a finished inquiry shows completion without walking its steps`(status: InquiryStatus) = runTest {
        val api = FakeFlowServer(inquiryStatus = status)
        val coordinator = coordinator(api)

        coordinator.start()

        // A decided inquiry shows its end whatever its position, and names no completion step it never reached.
        assertEquals(FlowState.Completed(null, status), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `an expired inquiry ends the flow without asking for consent or photos`() = runTest {
        val api = FakeFlowServer(inquiryStatus = InquiryStatus.EXPIRED)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Expired, coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `an inquiry that expires during the flow ends there once the conflict is re-read`() = runTest {
        val api = FakeFlowServer()
        api.failNext("acceptConsent", FlowApiException.Conflict(Problem(title = "Conflict"), null))
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.acceptConsent()
        api.inquiry = api.inquiry.copy(status = InquiryStatus.EXPIRED)

        coordinator.retry()

        assertEquals(FlowState.Expired, coordinator.state.value)
    }

    @Test
    fun `a failed inquiry in a flow without a failure step still ends as failed`() = runTest {
        val api = FakeFlowServer(flow = flowOf(consentStep, idStep, completionStep), inquiryStatus = InquiryStatus.FAILED)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    @Test
    fun `a failed inquiry ends on the failed screen the server's position names, with no transition read`() = runTest {
        val noTransitions = flowOf(consentStep, idStep, selfieStep, completionStep, failureStep)
        val api = FakeFlowServer(
            flow = noTransitions,
            inquiryStatus = InquiryStatus.FAILED,
            consent = FlowConsent(NOW),
            verifications = listOf(failedId('A')),
        )
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Failed(null, InquiryStatus.FAILED), coordinator.state.value)
    }

    // Flow shapes the SDK cannot run ----------------------------------------------------------

    @Test
    fun `a step the SDK cannot render stops the flow as unsupported`() = runTest {
        val api = FakeFlowServer(flow = flowOf(consentStep, UnsupportedStep("details", "form"), completionStep), consent = FlowConsent(NOW))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Unsupported("step form"), coordinator.state.value)
    }

    @Test
    fun `an ID step that does not allow the camera is unsupported`() = runTest {
        val uploadOnly = idStep.copy(captureMethods = listOf(CaptureMethod.UPLOAD))
        val coordinator = coordinator(FakeFlowServer(flow = flowOf(uploadOnly, completionStep)))

        coordinator.start()

        assertEquals(FlowState.Unsupported("government_id without camera capture"), coordinator.state.value)
    }

    @Test
    fun `a capture step without photos to take is unsupported`() = runTest {
        val noPoses = SelfieStep("selfie", emptyList(), Liveness.PASSIVE, 3)
        val coordinator = coordinator(FakeFlowServer(flow = flowOf(noPoses, completionStep), consent = FlowConsent(NOW)))

        coordinator.start()

        assertEquals(FlowState.Unsupported("selfie without photos"), coordinator.state.value)
    }

    @Test
    fun `a flow without a terminal step completes after its last step`() = runTest {
        val coordinator = coordinator(FakeFlowServer(flow = flowOf(consentStep), consent = FlowConsent(NOW)))

        coordinator.start()

        assertEquals(FlowState.Completed(null, InquiryStatus.PENDING), coordinator.state.value)
    }

    // Errors and retries ----------------------------------------------------------------------

    @Test
    fun `a network error during upload resumes without repeating finished work`() = runTest {
        val api = consented()
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        api.failNext("upload:back", FlowApiException.Network(IOException("connection reset")))
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.keep(image(1))
        coordinator.keep(image(2))
        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)

        coordinator.retry()

        assertEquals(firstSelfie, coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createVerification:government-id" })
        assertEquals(listOf(FileKind.FRONT, FileKind.BACK), api.uploads.map { it.kind })
        assertEquals(listOf(image(1), image(2)), api.uploads.map { it.image })
    }

    // A create whose answer was lost (Workflow 2D F018) ---------------------------------------

    private val governmentIds: (FakeFlowApi) -> List<String> = { api ->
        api.verifications.filter { it.verificationType == VerificationType.GOVERNMENT_ID }.map { it.id }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("lostAnswers")
    fun `a create whose answer was lost reuses the verification the server made, without using up an attempt`(
        cause: IOException,
    ) = runTest {
        val api = consented()
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        api.loseAnswerOfNext("createVerification:government-id", FlowApiException.Network(cause))
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.keep(image(1))
        coordinator.keep(image(2))

        assertEquals(firstSelfie, coordinator.state.value)
        val created = governmentIds(api)
        assertEquals(1, created.size)
        assertEquals(listOf(created.single(), created.single()), api.uploads.map { it.verificationId })
        assertEquals(
            listOf(
                "getSession", "createVerification:government-id", "getSession",
                "upload:front", "upload:back", "submit", "getVerification", "getSession",
            ) + selfieStart,
            api.calls,
        )
    }

    @Test
    fun `when the session cannot be read after a lost create either, each retry reads it first and never creates twice`() = runTest {
        val api = consented()
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()
        api.loseAnswerOfNext("createVerification:government-id", FlowApiException.Network(SocketTimeoutException("timeout")))
        api.failNext("getSession", FlowApiException.Network(IOException("offline")))
        api.failNext("getSession", FlowApiException.Network(IOException("still offline")))
        coordinator.keep(image(1))
        coordinator.keep(image(2))
        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)

        coordinator.retry()

        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createVerification:government-id" })

        coordinator.retry()

        assertEquals(firstSelfie, coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createVerification:government-id" })
        assertEquals(1, governmentIds(api).size)
        assertEquals(governmentIds(api) + governmentIds(api), api.uploads.map { it.verificationId })
    }

    @Test
    fun `a create that never reached the server is made again on retry, after the session shows it is missing`() = runTest {
        val previous = verification("ver_01M5CJZC301G4JHXZQ3PZBYH3Q", VerificationType.GOVERNMENT_ID, VerificationStatus.FAILED, blurry)
        val api = consented(previous)
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("createVerification:government-id", FlowApiException.Network(ConnectException("refused")))
        coordinator.keep(image(1))
        coordinator.keep(image(2))
        assertEquals(FlowState.Error(FlowError.NETWORK, canRetry = true), coordinator.state.value)

        coordinator.retry()

        assertEquals(firstSelfie, coordinator.state.value)
        assertEquals(2, governmentIds(api).size)
        assertEquals(VerificationStatus.PASSED, api.verifications.last { it.verificationType == VerificationType.GOVERNMENT_ID }.attributes.status)
    }

    @Test
    fun `an answered refusal of the create is not taken for a lost answer`() = runTest {
        val api = consented()
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("createVerification:government-id", FlowApiException.ServerError(503, null, null))

        coordinator.keep(image(1))
        coordinator.keep(image(2))

        assertEquals(FlowState.Error(FlowError.SERVER, canRetry = true), coordinator.state.value)
        assertEquals(listOf("getSession", "createVerification:government-id"), api.calls)
    }

    @Test
    fun `a session found ended while a lost create is checked ends the flow on its screen`() = runTest {
        val api = consented()
        val coordinator = coordinator(api)
        coordinator.start()
        api.loseAnswerOfNext("createVerification:government-id", FlowApiException.Network(SocketTimeoutException("timeout")))
        api.failNext("getSession", canceled(SessionCanceledReason.INQUIRY_EXPIRED))

        coordinator.keep(image(1))
        coordinator.keep(image(2))

        assertEquals(FlowState.Expired, coordinator.state.value)
    }

    // A create answered 2xx with an unexpected body (2E follow-up) ------------------------------

    private fun unexpectedBody() = FlowApiException.InvalidResponse(SerializationException("unexpected body"))

    @Test
    fun `a create answered with an unexpected body is taken as made, and the verification the session shows is reused`() = runTest {
        val api = consented()
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        api.loseAnswerOfNext("createVerification:government-id", unexpectedBody())
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.keep(image(1))
        coordinator.keep(image(2))

        assertEquals(firstSelfie, coordinator.state.value)
        val created = governmentIds(api)
        assertEquals(1, created.size)
        assertEquals(listOf(created.single(), created.single()), api.uploads.map { it.verificationId })
        assertEquals(
            listOf(
                "getSession", "createVerification:government-id", "getSession",
                "upload:front", "upload:back", "submit", "getVerification", "getSession",
            ) + selfieStart,
            api.calls,
        )
    }

    @Test
    fun `when the session cannot be read after an unreadable create either, the retry reads it first and never creates twice`() = runTest {
        val api = consented()
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()
        api.loseAnswerOfNext("createVerification:government-id", unexpectedBody())
        api.failNext("getSession", FlowApiException.Network(IOException("offline")))
        coordinator.keep(image(1))
        coordinator.keep(image(2))
        assertEquals(FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = true), coordinator.state.value)

        coordinator.retry()

        assertEquals(firstSelfie, coordinator.state.value)
        assertEquals(1, api.calls.count { it == "createVerification:government-id" })
        assertEquals(1, governmentIds(api).size)
    }

    @Test
    fun `an unreadable create the session does not show is made again on retry, after the session is read`() = runTest {
        val api = consented()
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()
        api.failNext("createVerification:government-id", unexpectedBody())
        coordinator.keep(image(1))
        coordinator.keep(image(2))
        assertEquals(FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = true), coordinator.state.value)

        coordinator.retry()

        assertEquals(firstSelfie, coordinator.state.value)
        assertEquals(1, governmentIds(api).size)
        assertEquals(
            listOf("getSession", "createVerification:government-id", "getSession", "getSession", "createVerification:government-id"),
            api.calls.take(5),
        )
    }

    @Test
    fun `a verification still processing when polling stops can be checked again`() = runTest {
        val api = consented()
        api.undecidedPolls = settings.pollAttempts
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.keep(image(1))
        coordinator.keep(image(2))
        assertEquals(FlowState.Error(FlowError.STILL_PROCESSING, canRetry = true), coordinator.state.value)

        coordinator.retry()

        assertEquals(1, api.calls.count { it == "submit" })
        assertEquals(firstSelfie, coordinator.state.value)
    }

    @Test
    fun `an expired session cannot be retried`() = runTest {
        val api = FakeFlowServer()
        api.failNext("getSession", FlowApiException.Unauthorized(null, null))
        val coordinator = coordinator(api)

        coordinator.start()
        coordinator.retry()

        assertEquals(FlowState.Error(FlowError.SESSION_EXPIRED, canRetry = false), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    // Sessions that end (C19) -----------------------------------------------------------------

    private fun inactive(code: String) =
        FlowApiException.Unauthorized(Problem(title = "Unauthorized", status = 401, code = code), null)

    @ParameterizedTest(name = "{0}")
    @CsvSource("session_expired, EXPIRED", "session_canceled, CANCELED")
    fun `an inactive session ends on its own screen, which no retry leaves`(code: String, reason: SessionEndReason) = runTest {
        val api = FakeFlowServer()
        api.failNext("getSession", inactive(code))
        val coordinator = coordinator(api)

        coordinator.start()
        coordinator.retry()

        assertEquals(FlowState.SessionEnded(reason), coordinator.state.value)
        assertEquals(listOf("getSession"), api.calls)
    }

    @Test
    fun `a session canceled while consent is sent ends the flow`() = runTest {
        val api = FakeFlowServer()
        api.failNext("acceptConsent", inactive("session_canceled"))
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.acceptConsent()

        assertEquals(FlowState.SessionEnded(SessionEndReason.CANCELED), coordinator.state.value)
    }

    private fun canceled(reason: SessionCanceledReason?) = FlowApiException.Unauthorized(
        Problem(title = "Unauthorized", status = 401, code = "session_canceled", reason = reason),
        null,
    )

    @ParameterizedTest(name = "{0}")
    @MethodSource("canceledSessions")
    fun `a canceled session ends on the screen its reason names, which no retry leaves (C25)`(
        reason: SessionCanceledReason?,
        expected: FlowState,
    ) = runTest {
        val api = FakeFlowServer()
        api.failNext("acceptConsent", canceled(reason))
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.acceptConsent()
        coordinator.retry()

        assertEquals(expected, coordinator.state.value)
        assertEquals(listOf("getSession", "acceptConsent"), api.calls)
    }

    @TestFactory
    fun `each golden canceled-session problem ends the flow on its screen (C25)`(): List<DynamicTest> = mapOf(
        "problems/session-canceled-inquiry-expired.json" to FlowState.Expired,
        "problems/session-canceled-inquiry-finished.json" to FlowState.SessionEnded(SessionEndReason.CANCELED),
        "problems/session-canceled-inquiry-redacted.json" to FlowState.Redacted,
    ).map { (path, expected) ->
        dynamicTest(path) {
            runTest {
                val problem = OpenVerifyJson.decodeFromString<Problem>(Fixtures.read(path))
                val api = FakeFlowServer()
                api.failNext("getSession", FlowApiException.Unauthorized(problem, problem.requestId))
                val coordinator = coordinator(api)

                coordinator.start()

                assertEquals(expected, coordinator.state.value)
            }
        }
    }

    @Test
    fun `a redacted inquiry ends the flow when a photo is sent (410)`() = runTest {
        val api = consented()
        api.failNext("upload:front", FlowApiException.Redacted(Problem(title = "Redacted", status = 410), null))
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.keep(image(1))
        coordinator.keep(image(2))
        coordinator.retry()

        assertEquals(FlowState.Redacted, coordinator.state.value)
        assertEquals(emptyList<FakeFlowApi.Upload>(), api.uploads)
    }

    @Test
    fun `a refused one-time link ends on the used-link screen`() = runTest {
        val api = FakeFlowServer()
        api.failNext("getSession", FlowApiException.LinkRefused(null, null))
        val coordinator = coordinator(api)

        coordinator.start()
        coordinator.retry()

        assertEquals(FlowState.LinkRefused, coordinator.state.value)
    }

    @Test
    fun `a 401 with another code is still the expired-session error`() = runTest {
        val api = FakeFlowServer()
        api.failNext("getSession", inactive("invalid_token"))
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Error(FlowError.SESSION_EXPIRED, canRetry = false), coordinator.state.value)
    }

    // Sandbox (C19) --------------------------------------------------------------------------

    @Test
    fun `a sandbox session is reported, and allows uploads for the selfie and an ID that takes them`() = runTest {
        val api = consented()
        api.environment = FlowEnvironment(EnvironmentKind.SANDBOX)
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        assertEquals(false, coordinator.sandbox.value)

        coordinator.start()

        assertEquals(true, coordinator.sandbox.value)
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2, uploadAllowed = true), coordinator.state.value)
        coordinator.keep(image(1))
        coordinator.keep(image(2))
        assertEquals(
            firstSelfie.copy(uploadAllowed = true),
            coordinator.state.value,
        )
    }

    @Test
    fun `a sandbox ID step that takes only the camera allows no upload`() = runTest {
        val cameraOnly = idStep.copy(captureMethods = listOf(CaptureMethod.CAMERA))
        val api = FakeFlowServer(
            flow = flowOf(cameraOnly, completionStep),
            consent = FlowConsent(NOW),
            environment = FlowEnvironment(EnvironmentKind.SANDBOX),
        )
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(FlowState.Capture(cameraOnly, FileKind.FRONT, 0, 2, uploadAllowed = false), coordinator.state.value)
    }

    @ParameterizedTest(name = "{0}")
    @EnumSource(value = EnvironmentKind::class, names = ["PRODUCTION", "UNKNOWN"])
    fun `outside the sandbox photos come from the camera only`(kind: EnvironmentKind) = runTest {
        val api = consented()
        api.environment = FlowEnvironment(kind)
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)

        coordinator.start()
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2, uploadAllowed = false), coordinator.state.value)
        coordinator.keep(image(1))
        coordinator.keep(image(2))

        assertEquals(false, coordinator.sandbox.value)
        assertEquals(firstSelfie, coordinator.state.value)
    }

    @Test
    fun `a failed start can be retried`() = runTest {
        val api = FakeFlowServer()
        api.failNext("getSession", FlowApiException.Network(IOException("offline")))
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.retry()

        assertEquals(consentState, coordinator.state.value)
    }

    @Test
    fun `a failed consent can be sent again`() = runTest {
        val api = FakeFlowServer()
        api.failNext("acceptConsent", FlowApiException.ServerError(503, null, null))
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.acceptConsent()
        assertEquals(FlowState.Error(FlowError.SERVER, canRetry = true), coordinator.state.value)

        coordinator.retry()

        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
    }

    @Test
    fun `a conflict re-reads the session on retry`() = runTest {
        val api = FakeFlowServer()
        api.failNext("acceptConsent", FlowApiException.Conflict(Problem(title = "Conflict"), null))
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.acceptConsent()
        assertEquals(FlowState.Error(FlowError.OUT_OF_SYNC, canRetry = true), coordinator.state.value)
        api.consent = FlowConsent(NOW)

        coordinator.retry()

        assertEquals(listOf("getSession", "acceptConsent", "getSession"), api.calls)
        assertEquals(FlowState.Capture(idStep, FileKind.FRONT, 0, 2), coordinator.state.value)
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("errorMappings")
    fun `call failures map to flow errors`(error: Exception, expected: FlowState.Error) = runTest {
        val api = FakeFlowServer()
        api.failNext("getSession", error)
        val coordinator = coordinator(api)

        coordinator.start()

        assertEquals(expected, coordinator.state.value)
    }

    @Test
    fun `actions are ignored while another is running`() = runTest {
        val api = consented()
        api.decide(VerificationStatus.PASSED, InquiryStatus.PENDING)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.keep(image(1))
        coordinator.capture(image(2))

        launch { coordinator.confirmCapture() }
        launch { coordinator.confirmCapture() }
        launch { coordinator.retry() }
        advanceUntilIdle()

        assertEquals(1, api.calls.count { it == "createVerification:government-id" })
        assertEquals(1, api.calls.count { it == "submit" })
    }

    companion object {
        /** How OkHttp reports an answer that never arrived: read timeout, call timeout, dropped connection. */
        @JvmStatic
        fun lostAnswers(): List<IOException> = listOf(
            SocketTimeoutException("timeout"),
            InterruptedIOException("timeout"),
            IOException("unexpected end of stream"),
        )

        @JvmStatic
        fun canceledSessions(): List<Arguments> = listOf(
            Arguments.of(SessionCanceledReason.INQUIRY_EXPIRED, FlowState.Expired),
            Arguments.of(SessionCanceledReason.INQUIRY_REDACTED, FlowState.Redacted),
            Arguments.of(SessionCanceledReason.INQUIRY_FINISHED, FlowState.SessionEnded(SessionEndReason.CANCELED)),
            // A reason added by a newer server, and a server that sends none (before Workflow 2E).
            Arguments.of(SessionCanceledReason.UNKNOWN, FlowState.SessionEnded(SessionEndReason.CANCELED)),
            Arguments.of(null, FlowState.SessionEnded(SessionEndReason.CANCELED)),
        )

        @JvmStatic
        fun errorMappings(): List<Arguments> = listOf(
            Arguments.of(FlowApiException.RateLimited(null, null, 30), FlowState.Error(FlowError.NETWORK, true)),
            Arguments.of(FlowApiException.ServerError(500, null, null), FlowState.Error(FlowError.SERVER, true)),
            Arguments.of(FlowApiException.UnexpectedStatus(302, null, null), FlowState.Error(FlowError.SERVER, true)),
            Arguments.of(FlowApiException.InvalidResponse(null), FlowState.Error(FlowError.INVALID_RESPONSE, true)),
            Arguments.of(FlowApiException.Rejected(422, null, null), FlowState.Error(FlowError.REJECTED, false)),
            Arguments.of(FlowApiException.Forbidden(null, null), FlowState.Error(FlowError.REJECTED, false)),
            Arguments.of(FlowApiException.NotFound(null, null), FlowState.Error(FlowError.REJECTED, false)),
            Arguments.of(FlowApiException.StillProcessing("ver_01M5CJZC301G4JHXZQ3PZBYH3Q"), FlowState.Error(FlowError.STILL_PROCESSING, true)),
            Arguments.of(IllegalArgumentException("Not a verification ID"), FlowState.Error(FlowError.INVALID_RESPONSE, false)),
        )
    }
}
