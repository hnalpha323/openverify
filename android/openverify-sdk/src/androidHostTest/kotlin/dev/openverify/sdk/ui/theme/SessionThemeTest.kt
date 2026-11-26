package dev.openverify.sdk.ui.theme

import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.log.HostDebuggable
import dev.openverify.sdk.model.FlowCopy
import dev.openverify.sdk.model.FlowLinks
import dev.openverify.sdk.model.FlowLocales
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowTheme
import android.app.Application
import android.content.pm.ApplicationInfo
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

/**
 * C198.1: the session's theme is decoded and used only when every palette value is `#rrggbb` (lower
 * case) for exactly the twelve tokens of C160.3, the dark palette too when sent, and the radius is 0
 * to 24; otherwise the built-in theme is used for the whole session, and the SDK logs one PII-free
 * constant code, never a value. The coordinator publishes what [SessionTheme.of] answers.
 */
@RunWith(RobolectricTestRunner::class)
internal class SessionThemeTest {

    private val base: FlowSession = runBlocking { FakeFlowApi().getSession() }

    private fun session(theme: FlowTheme?): FlowSession = base.copy(theme = theme)

    @Before
    fun debuggableHost() {
        HostDebuggable.forget()
        val application = ApplicationProvider.getApplicationContext<Application>()
        application.applicationInfo.flags = application.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
        HostDebuggable.read(application)
        ShadowLog.clear()
    }

    @After
    fun forget() {
        HostDebuggable.forget()
        ShadowLog.clear()
    }

    private fun logged(): List<String> = ShadowLog.getLogsForTag("OpenVerify").map { it.msg }

    @Test
    fun `a theme that meets its contract is the theme the SDK applies`() {
        val theme = ThemeFixtures.theme()

        assertSame(theme, SessionTheme.of(session(theme)))
        assertEquals(emptyList<String>(), logged())
    }

    @Test
    fun `a session without a theme takes the built-in theme and logs nothing`() {
        assertNull(SessionTheme.of(session(null)))
        assertEquals(emptyList<String>(), logged())
    }

    @Test
    fun `a light theme without a dark palette is applied`() {
        val theme = ThemeFixtures.theme(mode = "light", dark = null)

        assertSame(theme, SessionTheme.of(session(theme)))
    }

    @Test
    fun `a theme outside its contract takes the built-in theme for the whole session, with one constant code`() {
        val broken = listOf(
            "an upper-case colour" to ThemeFixtures.theme(light = ThemeFixtures.LIGHT + ("primary" to "#0B6E4F")),
            "a colour with alpha" to ThemeFixtures.theme(light = ThemeFixtures.LIGHT + ("surface" to "#ffffffff")),
            "a named colour" to ThemeFixtures.theme(light = ThemeFixtures.LIGHT + ("ink" to "black")),
            "an unknown token" to ThemeFixtures.theme(light = ThemeFixtures.LIGHT + ("accent" to "#123456")),
            "a missing token" to ThemeFixtures.theme(light = ThemeFixtures.LIGHT - "focus"),
            "a broken dark palette" to ThemeFixtures.theme(dark = ThemeFixtures.DARK + ("primary" to "#5dd6a")),
            "a radius above 24" to ThemeFixtures.theme(radius = 25),
            "a negative radius" to ThemeFixtures.theme(radius = -1),
        )
        for ((why, theme) in broken) {
            ShadowLog.clear()
            assertNull(why, SessionTheme.of(session(theme)))
            assertEquals(why, listOf(SessionTheme.REFUSED), logged())
        }
    }

    @Test
    fun `the same refused theme read again is not logged again`() {
        val theme = ThemeFixtures.theme(radius = 99)

        SessionTheme.of(session(theme))
        SessionTheme.of(session(theme))

        assertEquals(listOf(SessionTheme.REFUSED), logged())
    }

    @Test
    fun `the refusal names no value of the theme`() {
        SessionTheme.of(session(ThemeFixtures.theme(light = ThemeFixtures.LIGHT + ("primary" to "#ABCDEF"))))

        val all = ShadowLog.getLogs().joinToString(" ") { "${it.tag} ${it.msg}" }
        assertEquals(false, all.contains("ABCDEF", ignoreCase = true) || all.contains("tset_synthetic"))
    }

    @Test
    fun `the coordinator publishes the session theme the SDK applies`() = runBlocking {
        val theme = ThemeFixtures.theme()
        val api = object : FakeFlowApi() {
            override fun sessionAnswer(): FlowSession = super.sessionAnswer().copy(theme = theme)
        }
        val coordinator = FlowCoordinator(api, FakeFlowApi.INQUIRY_ID)

        coordinator.start()

        assertSame(theme, coordinator.theme.value)
    }

    @Test
    fun `the session look carries the theme applied, the languages, the links, the name and the copy`() {
        val copy = FlowCopy(mapOf("en" to mapOf("screen.helpLink" to "Help from {organization}")))
        val session = base.copy(
            theme = ThemeFixtures.theme(radius = 30),
            locales = FlowLocales(listOf("en", "ar"), "en"),
            links = FlowLinks("https://help.example.com/flow", "https://example.com/privacy"),
            organizationDisplayName = "Synthetic Org",
            copy = copy,
        )

        val look = SessionLook.of(session)

        assertEquals(
            SessionLook(null, FlowLocales(listOf("en", "ar"), "en"), FlowLinks("https://help.example.com/flow", "https://example.com/privacy"), "Synthetic Org", copy),
            look,
        )
        assertEquals(SessionLook.NONE, SessionLook.of(null))
    }
}
