package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.InquiryStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import mockwebserver3.SocketEffect
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.ConcurrentLinkedQueue
import kotlin.time.Duration.Companion.milliseconds

/**
 * C193.5 (review P26): the shared OkHttp client resends a POST whose answer was lost
 * (`retryOnConnectionFailure`), and flow calls carry no idempotency key, so a single-use POST that
 * landed the first time is refused with a 409 the second time. Over the real [FlowApiClient] and
 * OkHttp, MockWebServer drops the connection after it read each route's first body; OkHttp sends it
 * again on a new connection and the server answers that resend 409. The driver answers that 409 by
 * reading the session and rendering its position, before any error screen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class SingleUsePostTest {

    private lateinit var server: MockWebServer

    /** Every request the server read: its method and path. */
    private val requests = ConcurrentLinkedQueue<String>()

    @BeforeEach
    fun start() {
        server = MockWebServer().also { it.start() }
    }

    @AfterEach
    fun stop() = server.close()

    /**
     * Answers [answer] by method and path. A path in [singleUse] lands on its first send, whose
     * connection is then dropped before the answer, and is refused 409 [conflictCode] on the resend.
     */
    private fun serve(singleUse: String, conflictCode: String, answer: (String, Boolean) -> MockResponse) {
        var landed = false
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val route = "${request.method} ${request.url.encodedPath}"
                requests += route
                if (route == singleUse) {
                    if (!landed) {
                        landed = true
                        return MockResponse.Builder().code(200).onResponseStart(SocketEffect.ShutdownConnection).build()
                    }
                    return problem(409, conflictCode)
                }
                return answer(route, landed)
            }
        }
    }

    private fun coordinator() = FlowCoordinator(
        FlowApiClient(server.url("/").toString(), TOKEN),
        INQUIRY_ID,
        FlowCoordinator.Settings(pollInterval = 1.milliseconds, pollAttempts = 3),
    )

    @Test
    fun `a verification submit whose answer was lost and whose resend got a 409 reads the session and goes on`() = runTest {
        serve("POST /api/v1/flow/verifications/$VERIFICATION/submit", "verification_not_initiated") { route, landed ->
            when (route) {
                "GET /api/v1/flow/session" -> json(idSession(if (landed) "submitted" else null))
                "POST /api/v1/flow/verifications" -> json(verification("initiated"))
                "POST /api/v1/flow/verifications/$VERIFICATION/files" -> json(file())
                "GET /api/v1/flow/verifications/$VERIFICATION" -> json(verification("passed")).also { decided = true }
                else -> MockResponse.Builder().code(404).build()
            }
        }
        val coordinator = coordinator()
        val states = mutableListOf<FlowState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { coordinator.state.collect { states += it } }

        coordinator.start()
        coordinator.capture(PHOTO)
        coordinator.confirmCapture()

        assertTrue(states.none { it is FlowState.Error }, states.toString())
        assertEquals(
            listOf(
                "GET /api/v1/flow/session", "POST /api/v1/flow/verifications", "POST /api/v1/flow/verifications/$VERIFICATION/files",
                "POST /api/v1/flow/verifications/$VERIFICATION/submit", "POST /api/v1/flow/verifications/$VERIFICATION/submit",
                "GET /api/v1/flow/session",
            ),
            requests.take(6),
        )
        assertEquals(InquiryStatus.COMPLETED, (coordinator.state.value as FlowState.Completed).inquiryStatus)
    }

    @Test
    fun `a screen submission whose answer was lost and whose resend got flow_step_not_current reads the session`() = runTest {
        serve("POST /api/v1/flow/screens/extra_details/submit", FlowProblemCodes.FLOW_STEP_NOT_CURRENT) { route, landed ->
            when (route) {
                "GET /api/v1/flow/session" -> json(if (landed) endedSession() else screenSession())
                else -> MockResponse.Builder().code(404).build()
            }
        }
        val coordinator = coordinator()
        val states = mutableListOf<FlowState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { coordinator.state.collect { states += it } }

        coordinator.start()
        coordinator.submitScreen(mapOf("nickname" to FlowValue.Text("Sam")), null)

        assertTrue(states.none { it is FlowState.Error }, states.toString())
        assertEquals(
            listOf(
                "GET /api/v1/flow/session", "POST /api/v1/flow/screens/extra_details/submit",
                "POST /api/v1/flow/screens/extra_details/submit", "GET /api/v1/flow/session",
            ),
            requests.toList(),
        )
        assertTrue(coordinator.state.value is FlowState.Completed, coordinator.state.value.toString())
    }

    /** Set once the verification is decided, so the session read after it names the completion. */
    private var decided = false

    private fun idSession(latest: String?): String {
        val completion = """{"id":"done","type":"completion"}"""
        val id = """{"id":"id_card","type":"government_id","sides":"front","maxAttempts":1,"captureMethods":["camera"]}"""
        val verifications = when {
            decided -> "[${verification("passed").removePrefix("""{"data":""").removeSuffix("}")}]"
            latest != null -> "[${verification(latest).removePrefix("""{"data":""").removeSuffix("}")}]"
            else -> "[]"
        }
        val (position, step) = if (decided) """{"step-id":"done","state":"ended","previous-step-id":"id_card"}""" to completion else """{"step-id":"id_card","state":"active","previous-step-id":"consent"}""" to id
        val status = if (decided) "completed" else "pending"
        return """{"inquiry":{"id":"$INQUIRY_ID","status":"$status"},"flow":{"metadata":{"specVersion":1,"id":"single-use","version":1,"name":"Single use"},""" +
            """"steps":[$id,$completion],"transitions":[]},"verifications":$verifications,"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"},""" +
            """"spec-version":2,"position":$position,"step":$step}"""
    }

    private fun screenSession(): String =
        """{"inquiry":{"id":"$INQUIRY_ID","status":"pending"},"flow":{"metadata":{"specVersion":1,"id":"single-use","version":1,"name":"Single use"},"steps":[],"transitions":[]},""" +
            """"verifications":[],"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"},"spec-version":2,""" +
            """"position":{"step-id":"extra_details","state":"active","previous-step-id":"consent"},""" +
            """"step":{"id":"extra_details","type":"screen","components":[{"id":"go","kind":"button","labelKey":"extra_details.go.label","action":"submit"}]},""" +
            """"copy":{"messages":{"en":{"extra_details.go.label":"Continue"}}}}"""

    private fun endedSession(): String =
        """{"inquiry":{"id":"$INQUIRY_ID","status":"pending"},"flow":{"metadata":{"specVersion":1,"id":"single-use","version":1,"name":"Single use"},"steps":[],"transitions":[]},""" +
            """"verifications":[],"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"},"spec-version":2,""" +
            """"position":{"step-id":"done","state":"ended","previous-step-id":"extra_details"},"step":{"id":"done","type":"completion"}}"""

    private fun verification(status: String): String =
        """{"data":{"type":"verification/government-id","id":"$VERIFICATION","attributes":{"status":"$status","retry-hints":[],""" +
            """"created-at":"2026-10-20T12:01:00.000Z","updated-at":"2026-10-20T12:01:30.000Z"}}}"""

    private fun file(): String =
        """{"data":{"type":"file","id":"file_01M5CK3288G5K9T8DC51K68D01","attributes":{"kind":"front","mime-type":"image/jpeg","byte-size":3,""" +
            """"created-at":"2026-10-20T12:01:00.000Z"},"relationships":{"verification":{"data":{"type":"verification/government-id","id":"$VERIFICATION"}}}}}"""

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private fun problem(status: Int, code: String) = MockResponse.Builder().code(status).addHeader("Content-Type", "application/problem+json")
        .body("""{"type":"about:blank","title":"Conflict","status":$status,"code":"$code"}""").build()

    private companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
        const val VERIFICATION = "ver_01M5CK16P0D13FXHZSS4TCFB00"
        val TOKEN = "ovs_" + "t".repeat(43)
        val PHOTO = CapturedImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1), "image/jpeg")
    }
}
