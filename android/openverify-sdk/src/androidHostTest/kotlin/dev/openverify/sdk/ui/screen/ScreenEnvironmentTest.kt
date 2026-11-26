package dev.openverify.sdk.ui.screen

import dev.openverify.sdk.fixtures.readContractFixture
import dev.openverify.sdk.model.FlowContestRoute
import dev.openverify.sdk.model.FlowLinks
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.OpenVerifyJson
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/**
 * The screen environment built from a session the server answers (Phase 9's golden session
 * fixtures): component texts in the chosen language with C162.5's fallback to the default locale, the
 * links, the screen's values and the decision's contest route (C195, C197.3, C199.6).
 */
internal class ScreenEnvironmentTest {

    private fun session(fixture: String): FlowSession = OpenVerifyJson.decodeFromString<FlowSession>(readContractFixture("api/$fixture"))

    @Test
    fun `a component text comes in the chosen language, else the default locale's, never a raw key`() {
        val session = session("flow-session-organization.json")

        val spanish = screenEnvironmentOf(session, "es")
        assertEquals("Algunos datos más", spanish.text("extra_details.title.body")?.text?.logical)
        assertEquals("es", spanish.text("extra_details.title.body")?.language)

        val french = screenEnvironmentOf(session, "fr")
        assertEquals("A few more details", french.text("extra_details.title.body")?.text?.logical)
        assertEquals("en", french.text("extra_details.title.body")?.language)
        assertNull(french.text("extra_details.unknown.label"))
    }

    @Test
    fun `the screen's values and the version's links reach the screens`() {
        val session = session("flow-session-links.json")

        val environment = screenEnvironmentOf(session, "en")
        assertEquals(mapOf("nickname" to FlowValue.Text("Sam"), "tax_number" to FlowValue.Set), environment.values)
        assertEquals(FlowLinks("https://help.example.test/verify", null), environment.links)
        assertNull(environment.contestRoute)
    }

    @Test
    fun `a declined inquiry's contest route reaches the failure screen`() {
        val environment = screenEnvironmentOf(session("flow-session-declined.json"), "en")

        assertEquals(FlowContestRoute("https://example.com/contest", "example.com", "review@example.test"), environment.contestRoute)
        assertEquals(emptyMap<String, FlowValue>(), environment.values)
    }

    @Test
    fun `no environment has no text, and the environment never shows what it holds`() {
        assertNull(ScreenEnvironment.NONE.text("extra_details.title.body"))
        assertFalse(screenEnvironmentOf(session("flow-session-links.json"), "en").toString().contains("Sam"))
    }

    @Test
    fun `drafts are kept by step and forgotten when the flow leaves the step`() {
        val drafts = ScreenDrafts()
        val state = ScreenFormState(mapOf("nickname" to ScreenValue.Text("Sam")), emptySet())

        drafts["about"] = state
        drafts["other"] = state
        drafts.forget("about")
        assertNull(drafts["about"])
        assertEquals(state, drafts["other"])
        assertFalse(drafts.toString().contains("Sam"))
        drafts.clear()
        assertNull(drafts["other"])
    }
}
