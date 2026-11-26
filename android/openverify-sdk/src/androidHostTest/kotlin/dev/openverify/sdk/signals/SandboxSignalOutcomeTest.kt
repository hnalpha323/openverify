package dev.openverify.sdk.signals

import dev.openverify.sdk.SandboxSignalOutcome
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.model.EnvironmentKind
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowEnvironment
import dev.openverify.sdk.model.FlowSessionSignals
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource

/**
 * Phase 7 C90.9 (owner decisions after Workflow 7A, "Later phases"): a host may install the
 * bot-detection outcome a **sandbox** session asks for (`OpenVerifyComponents.sandboxSignalOutcome`).
 * The body carries `sandbox-outcome` beside whichever tier applies, only when the session's
 * environment is a sandbox: production answers 422 `sandbox_only_value` and would lose the whole
 * body. Under no tier nothing is read or sent, outcome or not.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal class SandboxSignalOutcomeTest {

    private class Facts : AndroidDeviceFacts {
        val reads = mutableListOf<String>()

        override fun debuggerConnected(): Boolean = false.also { reads += "debugger" }

        override fun appDebuggable(): Boolean = true.also { reads += "debuggable" }

        override fun androidId(): String? = "0f1e2d3c4b5a6978".also { reads += "android-id" }

        override fun smallestScreenWidthDp(): Int = 411.also { reads += "smallest-width" }
    }

    @ParameterizedTest
    @CsvSource("BOT, true, false, bot", "HUMAN, true, false, human", "BOT, false, true, bot", "HUMAN, true, true, human")
    fun `the installed outcome rides with whichever tier applies`(outcome: SandboxSignalOutcome, integrity: Boolean, recognition: Boolean, wire: String) = runTest {
        val body = AndroidDeviceSignals(Facts(), outcome).collect(FlowSessionSignals(integrity, recognition), "government_id", 0)

        assertNotNull(body)
        assertEquals(wire, body!!.sandboxOutcome)
    }

    @Test
    fun `under no tier nothing is read and nothing is sent, outcome or not`() = runTest {
        val facts = Facts()

        val body = AndroidDeviceSignals(facts, SandboxSignalOutcome.BOT).collect(FlowSessionSignals(integrity = false, recognition = false), "consent", 0)

        assertNull(body)
        assertEquals(emptyList<String>(), facts.reads)
    }

    @Test
    fun `with no outcome installed the body carries none`() = runTest {
        val body = AndroidDeviceSignals(Facts()).collect(FlowSessionSignals(integrity = true, recognition = false), "consent", 0)

        assertNotNull(body)
        assertNull(body!!.sandboxOutcome)
    }

    private val integrity = FlowSessionSignals(integrity = true, recognition = false)

    /** A consented session in [kind] (or none), driven by a coordinator whose device signals carry [outcome]. */
    private suspend fun kotlinx.coroutines.test.TestScope.sent(kind: EnvironmentKind?, outcome: SandboxSignalOutcome?): FakeFlowServer {
        val server = FakeFlowServer(
            consent = FlowConsent(NOW),
            environment = kind?.let(::FlowEnvironment),
            signals = integrity,
        )
        // The reads run on the test's scheduler, so advanceUntilIdle waits for them (C210.3: off the main thread).
        FlowCoordinator(server, INQUIRY_ID, deviceSignals = AndroidDeviceSignals(Facts(), outcome, dispatcher = StandardTestDispatcher(testScheduler))).start()
        advanceUntilIdle()
        return server
    }

    @Test
    fun `a sandbox session sends the outcome`() = runTest {
        assertEquals(listOf("bot"), sent(EnvironmentKind.SANDBOX, SandboxSignalOutcome.BOT).sentSignals.map { it.sandboxOutcome })
        assertEquals(listOf("human"), sent(EnvironmentKind.SANDBOX, SandboxSignalOutcome.HUMAN).sentSignals.map { it.sandboxOutcome })
    }

    @Test
    fun `a production session sends its body without the outcome, both outcomes alike`() = runTest {
        listOf(SandboxSignalOutcome.BOT, SandboxSignalOutcome.HUMAN).forEach { outcome ->
            val bodies = sent(EnvironmentKind.PRODUCTION, outcome).sentSignals

            assertEquals(1, bodies.size)
            assertNull(bodies.single().sandboxOutcome)
            assertNotNull(bodies.single().androidIntegrity)
        }
    }

    @Test
    fun `a session that names no environment is not a sandbox`() = runTest {
        assertEquals(listOf<String?>(null), sent(null, SandboxSignalOutcome.BOT).sentSignals.map { it.sandboxOutcome })
    }
}
