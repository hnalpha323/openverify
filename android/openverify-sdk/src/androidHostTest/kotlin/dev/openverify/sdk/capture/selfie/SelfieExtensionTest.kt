package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowApi.Companion.verification
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.SelfieCaptureProtocol
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentLinkedQueue
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TestTimeSource
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.testTimeSource
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import mockwebserver3.SocketEffect
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * C204.5 (Phase 9 C171.4, WCAG 2.2.1): more time on a selfie capture. A granted extension moves the
 * capture's expiry on this device by the capture's lifetime, as the server moves it; ten in a row keep
 * the capture open on a frozen clock, and the next pose still goes to it. A refusal after submit is
 * answered by reading the session and reported as already sent (C193.5: a single-use POST is never
 * repeated by the SDK); any other refusal or failure keeps the expiry and is reported as failed.
 */
internal class SelfieExtensionTest {

    private val passedId = verification("ver_01M5CJZC301G4JHXZQ3PZBYH3P", VerificationType.GOVERNMENT_ID, VerificationStatus.PASSED)

    private fun image(n: Int) = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), n.toByte()), "image/jpeg")

    /** A consented inquiry at its selfie step, whose next submitted verification passes. */
    private fun atSelfie() = FakeFlowServer(inquiryStatus = InquiryStatus.PENDING, consent = FlowConsent(NOW), verifications = listOf(passedId))
        .also { it.decide(VerificationStatus.PASSED, InquiryStatus.PENDING) }

    private suspend fun TestScope.started(api: FlowApi) =
        FlowCoordinator(api, INQUIRY_ID, FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3, timeSource = testTimeSource))
            .also { it.cameraReady() }
            .also { it.start() }

    @Test
    fun `no production source keeps extension outcomes in a process-wide object (KP10-25)`() {
        // The outcome of a request for more time belongs to one launch's capture: it travels with the
        // window the coordinator publishes, so two inquiries in one process cannot see each other's,
        // and no launch has to reset anything.
        val root = File("src")
        val naming = listOf("commonMain", "androidMain", "iosMain")
            .flatMap { set -> File(root, set).walkTopDown().filter { it.extension == "kt" }.toList() }
            .filter { Regex("""\bSelfieExtensions\b""").containsMatchIn(it.readText()) }
            .map { it.relativeTo(root).invariantSeparatorsPath }
            .sorted()

        assertEquals(emptyList<String>(), naming)
    }

    @Test
    fun `a granted extension moves the window by the capture's lifetime and says so`() = runTest {
        val api = atSelfie()
        val window = checkNotNull(started(api).selfieCapture.value)

        val extended = extendCapture(api, window)

        assertEquals(window.copy(expiresAt = window.expiresAt + SelfieCaptureProtocol.CAPTURE_TTL, extension = SelfieExtensionOutcome.EXTENDED), extended)
        assertEquals(1, api.calls.count { it == "extendSelfieCapture" })
    }

    @Test
    fun `a launch's window carries its own outcome, and another launch in the same process starts with none`() = runTest {
        val refusing = atSelfie().let { api ->
            object : FlowApi by api {
                override suspend fun extendSelfieCapture(captureId: String) = throw FakeFlowApi.conflict("selfie_capture_not_extendable")
            }
        }
        val first = started(refusing)
        first.extendSelfieCapture()
        val second = started(atSelfie())

        assertEquals(SelfieExtensionOutcome.FAILED, first.selfieCapture.value?.extension)
        // Both fake servers name their capture alike: with one process-wide record the second launch
        // would have shown the first one's "could not add more time".
        assertEquals(first.selfieCapture.value?.id, second.selfieCapture.value?.id)
        assertNull(second.selfieCapture.value?.extension)
    }

    @Test
    fun `ten extensions in a row on a frozen clock keep the capture open, and the next pose goes to it`() = runTest {
        val api = atSelfie()
        val coordinator = started(api)
        val first = checkNotNull(coordinator.selfieCapture.value)

        repeat(10) { coordinator.extendSelfieCapture() }
        delay(SelfieCaptureProtocol.CAPTURE_TTL * 10)
        coordinator.capture(image(1))
        coordinator.confirmCapture()

        assertEquals(10, api.calls.count { it == "extendSelfieCapture" })
        assertEquals(first.expiresAt + SelfieCaptureProtocol.CAPTURE_TTL * 10, coordinator.selfieCapture.value?.expiresAt)
        assertEquals(1, api.captures.size)
        assertEquals(listOf(image(1)), api.uploadsOf(first.id).map { it.image })
    }

    @Test
    fun `a refusal after the photos were submitted reads the session and says they were already sent`() = runTest {
        val api = atSelfie()
        val coordinator = started(api)
        val window = checkNotNull(coordinator.selfieCapture.value)
        repeat(3) {
            coordinator.capture(image(it))
            coordinator.confirmCapture()
        }
        val reads = api.calls.count { it == "getSession" }

        assertEquals(window.copy(extension = SelfieExtensionOutcome.ALREADY_SENT), extendCapture(api, window))

        assertEquals(reads + 1, api.calls.count { it == "getSession" })
    }

    @Test
    fun `a refusal while the capture is open keeps its expiry and says more time could not be added`() = runTest {
        val api = atSelfie()
        val window = checkNotNull(started(api).selfieCapture.value)
        val refusing = object : FlowApi by api {
            override suspend fun extendSelfieCapture(captureId: String) = throw FakeFlowApi.conflict("selfie_capture_not_extendable")
        }

        assertEquals(window.copy(extension = SelfieExtensionOutcome.FAILED), extendCapture(refusing, window))
    }

    @Test
    fun `a call that fails is not repeated and says more time could not be added`() = runTest {
        val api = atSelfie()
        val window = checkNotNull(started(api).selfieCapture.value)
        var asked = 0
        val offline = object : FlowApi by api {
            override suspend fun extendSelfieCapture(captureId: String): Nothing {
                asked += 1
                throw FlowApiException.Network(IOException("synthetic"))
            }
        }

        assertEquals(window.copy(extension = SelfieExtensionOutcome.FAILED), extendCapture(offline, window))

        assertEquals(1, asked)
    }

    @Test
    fun `an answer for another capture is not taken`() = runTest {
        val api = atSelfie()
        val window = checkNotNull(started(api).selfieCapture.value)
        val other = window.copy(id = "self_01M5CJXHG07XPHF3HRM6NREDH0")

        assertEquals(other.copy(extension = SelfieExtensionOutcome.FAILED), extendCapture(api, other))
    }

    @Test
    fun `over the real client, an extension whose answer was lost and whose resend got 409 after submit reads the session`() = runTest {
        val server = MockWebServer().also { it.start() }
        try {
            val requests = ConcurrentLinkedQueue<String>()
            var landed = false
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val route = "${request.method} ${request.url.encodedPath}"
                    requests += route
                    return when (route) {
                        "POST /api/v1/flow/selfie-captures/$CAPTURE/extend" ->
                            if (!landed) {
                                landed = true
                                // The extension lands; the connection drops after its body, before the answer.
                                MockResponse.Builder().code(200).onResponseStart(SocketEffect.ShutdownConnection).build()
                            } else {
                                problem(409, "selfie_capture_not_extendable")
                            }
                        "GET /api/v1/flow/session" -> json(submittedSelfieSession())
                        else -> MockResponse.Builder().code(404).build()
                    }
                }
            }
            val window = SelfieCaptureWindow(CAPTURE, TestTimeSource().markNow() + SelfieCaptureProtocol.CAPTURE_TTL)
            val client = FlowApiClient(server.url("/").toString(), TOKEN)
            // The flow has read its session before, so the extension goes over a pooled connection, which
            // OkHttp resends a request on when it drops (C193.5); the SDK itself never sends it again.
            client.getSession()

            assertEquals(window.copy(extension = SelfieExtensionOutcome.ALREADY_SENT), extendCapture(client, window))

            assertEquals(
                listOf(
                    "GET /api/v1/flow/session",
                    "POST /api/v1/flow/selfie-captures/$CAPTURE/extend",
                    "POST /api/v1/flow/selfie-captures/$CAPTURE/extend",
                    "GET /api/v1/flow/session",
                ),
                requests.toList(),
            )
        } finally {
            server.close()
        }
    }

    private fun submittedSelfieSession(): String =
        """{"inquiry":{"id":"$INQUIRY_ID","status":"pending"},"flow":{"metadata":{"specVersion":1,"id":"selfie","version":1,"name":"Selfie"},""" +
            """"steps":[],"transitions":[]},"verifications":[{"type":"verification/selfie","id":"ver_01M5CK16P0D13FXHZSS4TCFB00",""" +
            """"attributes":{"status":"submitted","retry-hints":[],"created-at":"2026-10-20T12:01:00.000Z","updated-at":"2026-10-20T12:01:30.000Z"}}],""" +
            """"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"}}"""

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private fun problem(status: Int, code: String) = MockResponse.Builder().code(status).addHeader("Content-Type", "application/problem+json")
        .body("""{"type":"about:blank","title":"Conflict","status":$status,"code":"$code"}""").build()

    private companion object {
        const val CAPTURE = "self_01M5CJXHG07XPHF3HRM6NREDH9"
        val TOKEN = "ovs_" + "t".repeat(43)
    }
}
