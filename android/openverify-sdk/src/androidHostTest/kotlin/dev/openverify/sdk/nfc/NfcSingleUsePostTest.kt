@file:OptIn(ExperimentalOpenVerifyApi::class)

package dev.openverify.sdk.nfc

import dev.openverify.sdk.ExperimentalOpenVerifyApi
import dev.openverify.sdk.api.FlowApiClient
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowProblemCodes
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.SandboxChipScenario
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
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
import java.util.concurrent.CopyOnWriteArrayList

/**
 * C193.5 (review P26) for the NFC step's three single-use POSTs: the chip submit, client-unable and
 * sandbox-chip. Over the real [FlowApiClient] and OkHttp, MockWebServer drops the connection after
 * it read each route's first body; OkHttp sends it again on a new connection and the server answers
 * that resend 409. The step answers that 409 by reading the session and rendering its position,
 * before any error screen. Real time (`runBlocking`): the requests run on OkHttp's threads.
 */
internal class NfcSingleUsePostTest {

    private lateinit var server: MockWebServer
    private val requests = ConcurrentLinkedQueue<String>()
    private val states = CopyOnWriteArrayList<FlowState>()
    private val watching = CoroutineScope(Dispatchers.Unconfined)

    @BeforeEach
    fun start() {
        server = MockWebServer().also { it.start() }
    }

    @AfterEach
    fun stop() {
        watching.cancel()
        server.close()
    }

    /** As `SingleUsePostTest.serve`: [singleUse] lands once, its connection dropped, then answers 409 [conflictCode]. */
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
                    return problem(conflictCode)
                }
                return answer(route, landed)
            }
        }
    }

    private fun coordinator(reader: FakeChipReader?): FlowCoordinator {
        val coordinator = FlowCoordinator(
            FlowApiClient(server.url("/").toString(), TOKEN),
            INQUIRY_ID,
            FlowCoordinator.Settings(pollInterval = 1.milliseconds, pollAttempts = 3),
            nfcEnvironment = NfcEnvironment(reader, phone = FakeNfcPhone()),
        )
        watching.launch { coordinator.state.collect { states += it } }
        return coordinator
    }

    private fun common(route: String): MockResponse? = when (route) {
        "POST /api/v1/flow/verifications" -> json(verification("initiated"))
        "POST $BASE/chip-challenges" -> json("""{"id":"$CHALLENGE","nonce":"0123456789abcdef","expires-at":"2026-10-20T12:06:00.000Z"}""")
        "POST $BASE/files" -> json(
            """{"data":{"type":"file","id":"file_01M5CK3288G5K9T8DC51K68D01","attributes":{"kind":"chip-sod","mime-type":"application/octet-stream",""" +
                """"byte-size":7,"created-at":"2026-10-20T12:01:00.000Z"},"relationships":{"verification":{"data":{"type":"verification/government-id-nfc","id":"$VERIFICATION"}}}}}""",
        )
        else -> null
    }

    @Test
    fun `a chip submit whose answer was lost and whose resend got a 409 reads the session and goes on`() = runBlocking {
        serve("POST $BASE/submit", FlowProblemCodes.CHIP_CHALLENGE_INVALID) { route, landed ->
            common(route) ?: when (route) {
                "GET /api/v1/flow/session" -> json(if (landed) ended() else chipSession())
                else -> MockResponse.Builder().code(404).build()
            }
        }
        val reader = FakeChipReader().apply { succeeds() }
        val coordinator = coordinator(reader)

        coordinator.start()
        coordinator.nfc(NfcEvent.Ready())
        coordinator.nfc(NfcEvent.ReviewConfirmed)

        assertTrue(states.none { it is FlowState.Error }, states.toString())
        assertEquals(
            listOf("GET /api/v1/flow/session", "POST /api/v1/flow/verifications", "POST $BASE/chip-challenges") +
                List(5) { "POST $BASE/files" } + listOf("POST $BASE/submit", "POST $BASE/submit", "GET /api/v1/flow/session", "GET /api/v1/flow/session"),
            requests.toList(),
        )
        assertTrue(coordinator.state.value is FlowState.Completed, coordinator.state.value.toString())
        // Whatever followed, the files are gone from memory (C207.4).
        assertTrue(reader.handedOut.all { bytes -> bytes.all { it == 0.toByte() } })
    }

    @Test
    fun `a client-unable report whose answer was lost and whose resend got a 409 reads the session and goes on`() = runBlocking {
        serve("POST $BASE/client-unable", FlowProblemCodes.CLIENT_UNABLE_NOT_ALLOWED) { route, landed ->
            common(route) ?: when (route) {
                "GET /api/v1/flow/session" -> json(if (landed) ended() else chipSession())
                else -> MockResponse.Builder().code(404).build()
            }
        }
        val coordinator = coordinator(reader = null)

        coordinator.start()
        assertEquals(NfcView.CannotRead(NfcUnable.READER_NOT_INSTALLED, fallback = true, sandbox = false), (coordinator.state.value as FlowState.Nfc).view)
        coordinator.nfc(NfcEvent.UseAnotherWay)

        assertTrue(states.none { it is FlowState.Error }, states.toString())
        assertEquals(
            listOf(
                "GET /api/v1/flow/session", "POST /api/v1/flow/verifications", "POST $BASE/client-unable", "POST $BASE/client-unable",
                "GET /api/v1/flow/session",
            ),
            requests.toList(),
        )
        assertTrue(coordinator.state.value is FlowState.Completed, coordinator.state.value.toString())
    }

    @Test
    fun `a sandbox-chip request whose answer was lost and whose resend got a 409 reads the session and shows its position`() = runBlocking {
        serve("POST $BASE/sandbox-chip", FlowProblemCodes.CHIP_CHALLENGE_INVALID) { route, landed ->
            common(route) ?: when (route) {
                "GET /api/v1/flow/session" -> json(chipSession(sandbox = true, verification = if (landed) "initiated" else null))
                else -> MockResponse.Builder().code(404).build()
            }
        }
        val coordinator = coordinator(reader = null)

        coordinator.start()
        coordinator.nfc(NfcEvent.Ready(SandboxChipScenario.MATCH))

        assertTrue(states.none { it is FlowState.Error }, states.toString())
        assertEquals(
            listOf(
                "GET /api/v1/flow/session", "POST /api/v1/flow/verifications", "POST $BASE/chip-challenges", "POST $BASE/sandbox-chip",
                "POST $BASE/sandbox-chip", "GET /api/v1/flow/session",
            ),
            requests.toList(),
        )
        // The session still names the nfc step with its attempt open: the tap screen again, never an error.
        assertEquals(NfcView.Tap(NfcPhase.READY, reader = false, sandbox = true), (coordinator.state.value as FlowState.Nfc).view)
    }

    private fun chipSession(sandbox: Boolean = false, verification: String? = null): String {
        val chip = """{"id":"chip","type":"nfc","androidOnly":true,"fallbackAvailable":true,"sandboxChipAvailable":$sandbox,""" +
            """"prefillMrz":{"documentNumber":"L898902C3","birthDate":"740812","expiryDate":"120415"}}"""
        val verifications = verification?.let { "[${verification(it).removePrefix("""{"data":""").removeSuffix("}")}]" } ?: "[]"
        return """{"inquiry":{"id":"$INQUIRY_ID","status":"pending"},"flow":$FLOW,"verifications":$verifications,""" +
            """"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"},"spec-version":2,""" +
            """"position":{"step-id":"chip","state":"active","previous-step-id":"consent"},"step":$chip}"""
    }

    private fun ended(): String =
        """{"inquiry":{"id":"$INQUIRY_ID","status":"completed"},"flow":$FLOW,"verifications":[],"consent":{"accepted-at":"2026-10-20T12:00:30.000Z"},""" +
            """"spec-version":2,"position":{"step-id":"done","state":"ended","previous-step-id":"chip"},"step":{"id":"done","type":"completion"}}"""

    private fun verification(status: String): String =
        """{"data":{"type":"verification/government-id-nfc","id":"$VERIFICATION","attributes":{"status":"$status","retry-hints":[],""" +
            """"created-at":"2026-10-20T12:01:00.000Z","updated-at":"2026-10-20T12:01:30.000Z"}}}"""

    private fun json(body: String) = MockResponse.Builder().code(200).addHeader("Content-Type", "application/json").body(body).build()

    private fun problem(code: String) = MockResponse.Builder().code(409).addHeader("Content-Type", "application/problem+json")
        .body("""{"type":"about:blank","title":"Conflict","status":409,"code":"$code"}""").build()

    private companion object {
        const val INQUIRY_ID = "inq_01M5CJXHG07XPHF3HRM6NREDH7"
        const val VERIFICATION = "ver_01M5CK16P0D13FXHZSS4TCFB00"
        const val CHALLENGE = "chc_01M5CK3190XEVBM5ZXA76E1JS0"
        const val BASE = "/api/v1/flow/verifications/$VERIFICATION"
        const val FLOW = """{"metadata":{"specVersion":1,"id":"single-use","version":1,"name":"Single use"},"steps":[],"transitions":[]}"""
        val TOKEN = "ovs_" + "syntheticS".repeat(5).take(43)
    }
}
