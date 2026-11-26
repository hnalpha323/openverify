package dev.openverify.sdk.flow

import dev.openverify.sdk.FailureReason
import dev.openverify.sdk.InquiryOutcomes
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.flow.FakeFlowApi.Companion.INQUIRY_ID
import dev.openverify.sdk.i18n.ComponentText
import dev.openverify.sdk.i18n.FilledText
import dev.openverify.sdk.i18n.OperatorCopy
import dev.openverify.sdk.flow.FakeFlowApi.Companion.NOW
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.FlowConsent
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowLocales
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.TextComponent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.time.Duration.Companion.seconds

/**
 * KP10-8 (C194.1, C195; Workflow 10A Stage 3 android-screens 2): a screen whose component text neither
 * the session's copy nor a catalog holds, in a language the person could be shown, is the unsupported
 * screen from the driver, `Unsupported("screen copy")`, so closing it reports `Failed(UNSUPPORTED_FLOW)`,
 * not `Canceled`. The languages checked are every one the chooser could pick (the session's enabled
 * languages the SDK bundles, else all five), since the coordinator does not hold the person's choice.
 */
internal class ScreenCopyTest {

    private val settings = FlowCoordinator.Settings(pollInterval = 1.seconds, pollAttempts = 3)
    private val details = ScreenStep(
        "details",
        listOf(TextComponent("intro", "body", "details.intro.text"), ButtonComponent("go", "details.go.label", "submit")),
    )

    private fun server() = FakeFlowServer(steps = listOf(details, CompletionStep("done")), consent = FlowConsent(NOW))

    private suspend fun started(server: FakeFlowServer) = FlowCoordinator(server, INQUIRY_ID, settings).also { it.cameraReady(); it.start() }

    @Test
    fun `a screen whose text no copy holds is unsupported from the driver, so closing fails UNSUPPORTED_FLOW`() = runTest {
        val server = server().apply { copyOf = { FlowCopy(mapOf("en" to mapOf("details.go.label" to "Continue"))) } }

        val state = started(server).state.value

        assertEquals(FlowState.Unsupported("screen copy"), state)
        assertEquals(InquiryResult.Failed(INQUIRY_ID, FailureReason.UNSUPPORTED_FLOW), InquiryOutcomes.forFinish(state, INQUIRY_ID))
    }

    @Test
    fun `a text that cannot be filled in one enabled language is a gap too`() = runTest {
        val server = server().apply {
            copyOf = {
                FlowCopy(
                    mapOf(
                        "en" to mapOf("details.intro.text" to "Hello", "details.go.label" to "Continue"),
                        "es" to mapOf("details.intro.text" to "Hola {nombre}", "details.go.label" to "Continuar"),
                    ),
                )
            }
        }

        assertEquals(FlowState.Unsupported("screen copy"), started(server).state.value)
    }

    @Test
    fun `a gap in a language the session does not enable is not one the person can meet`() = runTest {
        val server = server().apply {
            copyOf = {
                FlowCopy(
                    mapOf(
                        "en" to mapOf("details.intro.text" to "Hello", "details.go.label" to "Continue"),
                        "es" to mapOf("details.intro.text" to "Hola {nombre}"),
                    ),
                )
            }
        }
        val englishOnly = object : FlowApi by server {
            override suspend fun getSession(): FlowSession = server.getSession().copy(locales = FlowLocales(listOf("en"), "en"))
        }
        val coordinator = FlowCoordinator(englishOnly, INQUIRY_ID, settings).also { it.cameraReady(); it.start() }

        assertTrue(coordinator.state.value is FlowState.Screen, "${coordinator.state.value}")
    }

    @Test
    fun `a screen whose texts the default language holds is shown, every other language falling back to it`() = runTest {
        assertTrue(started(server()).state.value is FlowState.Screen)
    }

    @Test
    fun `a button labelled with a built-in catalog key needs no operator copy, as on the web (C162_5)`() = runTest {
        val hello = ScreenStep("hello", listOf(TextComponent("heading", "title", "hello.heading.title"), ButtonComponent("go", "screen.continue", "submit")))
        val server = FakeFlowServer(steps = listOf(hello, CompletionStep("done")), consent = FlowConsent(NOW))
            .apply { copyOf = { FlowCopy(mapOf("en" to mapOf("hello.heading.title" to "Hello"))) } }

        assertTrue(started(server).state.value is FlowState.Screen, "${started(server).state.value}")
    }

    @Test
    fun `a built-in catalog key resolves to the SDK's own words in the chosen language, after the operator's`() {
        val none = OperatorCopy(null, "es", "en")
        val custom = OperatorCopy(FlowCopy(mapOf("es" to mapOf("screen.continue" to "Seguir"))), "es", "en")

        assertEquals(ComponentText(FilledText("Continuar", "Continuar"), "es"), none.component("screen.continue", emptyMap()))
        assertEquals(ComponentText(FilledText("Seguir", "Seguir"), "es"), custom.component("screen.continue", emptyMap()))
        assertEquals(null, none.component("hello.heading.title", emptyMap()))
    }
}
