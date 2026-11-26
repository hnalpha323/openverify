package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.camera.captureMethodOf
import dev.openverify.sdk.capture.selfie.SelfieCaptureWindow
import dev.openverify.sdk.capture.selfie.SelfieExtensionOutcome
import dev.openverify.sdk.flow.FakeFlowApi.Companion.DEFAULT_FLOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.SelfieStep
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.testTimeSource
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * Workflow 10B Stage 1b (foundation-10b, review F05): the capture hooks in `FlowCoordinator`.
 * - C206: the client-reported `capture-trigger` the capture screen gives a photo, and the `capture-method`
 *   `camera/CaptureTrigger.kt` decides for it, reach that photo's upload, an ID side's and a selfie pose's
 *   alike; with neither decided (the stubs), every upload is today's.
 * - C204.5: the open selfie capture's id and expiry are exposed for `capture/selfie/Extension.kt`, and an
 *   extension it reports moves the capture's expiry on this device, so a pose taken after the old expiry
 *   still goes to the same capture.
 */
internal class CaptureHooksTest {

    private val idStep = DEFAULT_FLOW.steps[1] as GovernmentIdStep
    private val selfieStep = DEFAULT_FLOW.steps[2] as SelfieStep
    private val passedId = verification("ver_01M5CJZC301G4JHXZQ3PZBYH3P", VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED)
    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)

    private fun image(n: Int) = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), n.toByte()), "image/jpeg")

    /** A consented inquiry, whose next submitted verification passes. */
    private fun consented(vararg verifications: dev.openverify.sdk.model.FlowVerification) =
        FakeFlowServer(inquiryStatus = InquiryStatus.PENDING, consent = FlowConsent(NOW), verifications = verifications.toList())
            .also { it.decide(VerificationStatus.PASSED, InquiryStatus.PENDING) }

    private suspend fun TestScope.coordinator(
        api: FlowApi,
        extension: suspend (FlowApi, SelfieCaptureWindow) -> SelfieCaptureWindow = { _, window -> window.copy(extension = SelfieExtensionOutcome.FAILED) },
    ) = FlowCoordinator(api, INQUIRY_ID, settings.copy(timeSource = testTimeSource), selfieExtension = extension)
        .also { it.cameraReady() }

    // C206 -----------------------------------------------------------------------------------------

    @Test
    fun `each ID side's upload carries the trigger its capture was given and the method the hook decides`() = runTest {
        val api = consented()
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.capture(image(1), null, CaptureTrigger.AUTO)
        coordinator.confirmCapture()
        coordinator.capture(image(2), null, CaptureTrigger.MANUAL)
        coordinator.confirmCapture()

        val method = captureMethodOf(idStep, picked = false)
        assertEquals(listOf(method to CaptureTrigger.AUTO, method to CaptureTrigger.MANUAL), api.uploadMetadata)
        assertEquals(listOf("upload:front", "upload:back"), api.calls.filter { it.startsWith("upload") })
    }

    @Test
    fun `a selfie pose's upload carries the trigger its capture was given`() = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.capture(image(1), null, CaptureTrigger.AUTO)
        coordinator.confirmCapture()

        assertEquals(listOf(captureMethodOf(selfieStep, picked = false) to CaptureTrigger.AUTO), api.uploadMetadata)
    }

    @Test
    fun `a photo retaken before it is kept carries the retake's trigger`() = runTest {
        val api = consented()
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.capture(image(1), null, CaptureTrigger.AUTO)
        coordinator.retake()
        coordinator.capture(image(2), null, CaptureTrigger.MANUAL)
        coordinator.confirmCapture()
        coordinator.capture(image(3), null, CaptureTrigger.MANUAL)
        coordinator.confirmCapture()

        assertEquals(listOf(CaptureTrigger.MANUAL, CaptureTrigger.MANUAL), api.uploadMetadata.map { it.second })
    }

    @Test
    fun `with no trigger given, each upload names the method the hook decides and no trigger`() = runTest {
        val api = consented()
        val coordinator = coordinator(api)
        coordinator.start()

        coordinator.capture(image(1))
        coordinator.confirmCapture()
        coordinator.capture(image(2))
        coordinator.confirmCapture()

        val method = captureMethodOf(idStep, picked = false)
        assertEquals(listOf<Pair<CaptureMethod?, CaptureTrigger?>>(method to null, method to null), api.uploadMetadata)
        assertEquals(listOf(image(1), image(2)), api.uploads.map { it.image })
    }

    // C204.5 ---------------------------------------------------------------------------------------

    @Test
    fun `the open selfie capture's id and expiry are exposed, and nothing before it opens or after it is submitted`() = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api)
        assertNull(coordinator.selfieCapture.value)
        val opened = testTimeSource.markNow()

        coordinator.start()

        val window = checkNotNull(coordinator.selfieCapture.value)
        assertEquals(api.captures.single().id, window.id)
        assertEquals(SelfieCaptureProtocol.CAPTURE_TTL, window.expiresAt - opened)
        repeat(3) { n ->
            coordinator.capture(image(n))
            coordinator.confirmCapture()
        }
        assertNull(coordinator.selfieCapture.value)
    }

    @Test
    fun `a capture replaced after a refusal exposes the new capture`() = runTest {
        val api = consented(passedId)
        val coordinator = coordinator(api)
        coordinator.start()
        coordinator.capture(image(1))
        coordinator.confirmCapture()
        api.failNext("upload:selfie-right", FakeFlowApi.conflict("selfie_capture_invalid"))

        coordinator.capture(image(2))
        coordinator.confirmCapture()

        assertEquals(api.captures.last().id, coordinator.selfieCapture.value?.id)
    }

    @Test
    fun `an extension moves the capture's expiry, so a pose taken after the old expiry goes to the same capture`() = runTest {
        val api = consented(passedId)
        val asked = mutableListOf<SelfieCaptureWindow>()
        val coordinator = coordinator(api) { _, window ->
            asked += window
            window.copy(expiresAt = window.expiresAt + SelfieCaptureProtocol.CAPTURE_TTL, extension = SelfieExtensionOutcome.EXTENDED)
        }
        coordinator.start()
        val first = coordinator.selfieCapture.value!!

        coordinator.extendSelfieCapture()
        delay(SelfieCaptureProtocol.CAPTURE_TTL + 1.seconds)
        coordinator.capture(image(1))
        coordinator.confirmCapture()

        assertEquals(listOf(first), asked)
        assertEquals(first.expiresAt + SelfieCaptureProtocol.CAPTURE_TTL, coordinator.selfieCapture.value?.expiresAt)
        assertEquals(1, api.captures.size)
        assertEquals(listOf(image(1)), api.uploadsOf(first.id).map { it.image })
    }

    @Test
    fun `an extension that was not granted keeps the capture's expiry, and none is asked for without an open capture`() = runTest {
        val api = consented()
        val asked = mutableListOf<SelfieCaptureWindow>()
        val coordinator = coordinator(api) { _, window -> asked += window; window.copy(extension = SelfieExtensionOutcome.FAILED) }
        coordinator.start()

        coordinator.extendSelfieCapture()

        assertEquals(emptyList<SelfieCaptureWindow>(), asked)
        assertNull(coordinator.selfieCapture.value)

        val selfie = coordinator(consented(passedId)) { _, window -> asked += window; window.copy(extension = SelfieExtensionOutcome.FAILED) }
        selfie.start()
        val window = selfie.selfieCapture.value
        selfie.extendSelfieCapture()

        assertEquals(listOf(window), asked)
        // KP10-25: the expiry is as it was, and the window says the request was not granted.
        assertEquals(window?.copy(extension = SelfieExtensionOutcome.FAILED), selfie.selfieCapture.value)
    }
}
