package dev.openverify.demo

import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.SandboxSignalOutcome
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

/**
 * C218.1 and Phase 7 C90.9: what the demo installs. The sandbox outcome is the host's switch (the
 * SDK sends it with a sandbox session's signals only). Before the application has attached the
 * optional artifacts (`DemoComponents.attach`; `DemoArtifactComponentsTest` covers each configuration)
 * there is no chip reader and no face detector, and there is never an integrity token provider
 * (Phase 10 P3 declined).
 */
class DemoComponentsTest {

    private val log = EventLog()

    @AfterEach
    fun uninstall() = OpenVerifyAndroid.install(OpenVerifyComponents())

    @Test
    fun `the picker's choices are none, bot and human`() {
        assertEquals(listOf("NONE", "BOT", "HUMAN"), SandboxOutcomeChoice.entries.map { it.name })
        assertEquals(
            listOf(null, SandboxSignalOutcome.BOT, SandboxSignalOutcome.HUMAN),
            SandboxOutcomeChoice.entries.map { it.outcome },
        )
    }

    @Test
    fun `the picked outcome and the event log are installed`() {
        SandboxOutcomeChoice.entries.forEach { choice ->
            val components = DemoComponents.of(choice, log)

            assertEquals(choice.outcome, components.sandboxSignalOutcome)
            assertSame(log, components.eventListener)
        }
    }

    @Test
    fun `before the artifacts are attached, no chip reader, face detector, integrity provider or transport is installed`() {
        val components = DemoComponents.of(SandboxOutcomeChoice.BOT, log)

        assertNull(components.chipReader)
        assertNull(components.faceDetectorFactory)
        assertNull(components.integrityTokenProvider)
        assertNull(components.transport)
    }

    @Test
    fun `installing replaces what the process had installed`() {
        DemoComponents.install(SandboxOutcomeChoice.HUMAN, log)
        assertEquals(SandboxSignalOutcome.HUMAN, OpenVerifyAndroid.installed().sandboxSignalOutcome)
        assertSame(log, OpenVerifyAndroid.installed().eventListener)

        DemoComponents.install(SandboxOutcomeChoice.NONE, log)
        assertNull(OpenVerifyAndroid.installed().sandboxSignalOutcome)
        assertSame(log, OpenVerifyAndroid.installed().eventListener)
    }
}
