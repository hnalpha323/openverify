package dev.openverify.demo

import androidx.lifecycle.SavedStateHandle
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.FailureReason
import dev.openverify.sdk.InquiryResult
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.OpenVerifyEvent
import dev.openverify.sdk.OpenVerifyInquiry
import dev.openverify.sdk.SandboxSignalOutcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * 1B F026: the demo's form lives in a ViewModel, so a rotation keeps it. The inquiry ID and API
 * URL also go to saved state; the session token and the one-time link, which are secrets, live
 * in memory only and are never written to saved state (which the system may persist).
 */
@RunWith(RobolectricTestRunner::class)
class DemoViewModelTest {

    private fun filled(saved: SavedStateHandle = SavedStateHandle()) = DemoViewModel(saved).apply {
        onInquiryIdChange(DemoFormTest.INQUIRY_ID)
        onSessionTokenChange(DemoFormTest.TOKEN)
        onApiBaseUrlChange(API_URL)
        onOneTimeLinkChange(LINK)
    }

    @Test
    fun `the pasted values make a session request and a one-time link`() {
        val viewModel = filled()

        assertEquals(OpenVerifyInquiry.Request(DemoFormTest.INQUIRY_ID, DemoFormTest.TOKEN, API_URL), viewModel.request())
        assertEquals(OpenVerifyInquiry.fromOneTimeLink(LINK, API_URL), viewModel.oneTimeLink())
    }

    @Test
    fun `missing or malformed values make no request`() {
        val viewModel = DemoViewModel(SavedStateHandle())

        assertNull(viewModel.request())
        assertNull(viewModel.oneTimeLink())
        viewModel.onOneTimeLinkChange("https://example.com/#inquiry-id=inq_123")
        assertNull(viewModel.oneTimeLink())
    }

    @Test
    fun `secrets are never written to saved state`() {
        val saved = SavedStateHandle()

        filled(saved)

        val stored = saved.keys().joinToString("\n") { "$it=${saved.get<Any?>(it)}" }
        assertTrue(stored, stored.contains(DemoFormTest.INQUIRY_ID))
        assertTrue(stored, !stored.contains(DemoFormTest.TOKEN))
        assertTrue(stored, !stored.contains("ovo_"))
    }

    @Test
    fun `after the process is recreated, the inquiry ID and URL return but the secrets do not`() {
        val saved = SavedStateHandle()
        filled(saved)

        val restored = DemoViewModel(SavedStateHandle(saved.keys().associateWith { saved.get<Any?>(it) }))

        assertEquals(DemoFormTest.INQUIRY_ID, restored.inquiryId.value)
        assertEquals(API_URL, restored.apiBaseUrl.value)
        assertEquals("", restored.sessionToken.value)
        assertEquals("", restored.oneTimeLinkText.value)
    }

    @Test
    fun `a new form starts with the emulator's API URL`() {
        assertEquals(DemoForm.DEFAULT_API_BASE_URL, DemoViewModel(SavedStateHandle()).apiBaseUrl.value)
    }

    @Test
    fun `the last result is described`() {
        val viewModel = DemoViewModel(SavedStateHandle())

        viewModel.onResult(InquiryResult.Failed(DemoFormTest.INQUIRY_ID, FailureReason.LINK_INVALID))

        assertEquals(
            ResultMessage(R.string.result_failed, listOf(DemoFormTest.INQUIRY_ID, "LINK_INVALID")),
            viewModel.result.value,
        )
    }

    // C218.1: the pickers -------------------------------------------------------------------

    @Test
    fun `the picked language and appearance ride on both launches`() {
        val viewModel = filled()

        viewModel.onLocaleChange(LocaleChoice.FR)
        viewModel.onAppearanceChange(Appearance.LIGHT)

        assertEquals(LaunchOptions(LocaleChoice.FR, Appearance.LIGHT), viewModel.options())
        assertEquals("fr", viewModel.request()?.locale)
        assertEquals(Appearance.LIGHT, viewModel.request()?.appearance)
        assertEquals("fr", viewModel.oneTimeLink()?.locale)
        assertEquals(Appearance.LIGHT, viewModel.oneTimeLink()?.appearance)
    }

    @Test
    fun `the pickers' choices return after the process is recreated`() {
        val saved = SavedStateHandle()
        DemoViewModel(saved).apply {
            onLocaleChange(LocaleChoice.AR)
            onAppearanceChange(Appearance.DARK)
            onSandboxOutcomeChange(SandboxOutcomeChoice.HUMAN)
        }

        val restored = DemoViewModel(SavedStateHandle(saved.keys().associateWith { saved.get<Any?>(it) }))

        assertEquals(LocaleChoice.AR, restored.locale.value)
        assertEquals(Appearance.DARK, restored.appearance.value)
        assertEquals(SandboxOutcomeChoice.HUMAN, restored.sandboxOutcome.value)
    }

    @Test
    fun `a saved choice this build does not know falls back to the default`() {
        val restored = DemoViewModel(SavedStateHandle(mapOf("locale" to "TLH", "appearance" to "SEPIA", "sandbox-outcome" to "CAT")))

        assertEquals(LocaleChoice.DEVICE, restored.locale.value)
        assertEquals(Appearance.SYSTEM, restored.appearance.value)
        assertEquals(SandboxOutcomeChoice.NONE, restored.sandboxOutcome.value)
    }

    // Phase 7 C90.9: the sandbox outcome ------------------------------------------------------

    @Test
    fun `the picked sandbox outcome is installed with the event log, and none installs none`() {
        val log = EventLog()
        val viewModel = DemoViewModel(SavedStateHandle(), log)
        try {
            viewModel.onSandboxOutcomeChange(SandboxOutcomeChoice.BOT)
            viewModel.installComponents()
            assertEquals(SandboxSignalOutcome.BOT, OpenVerifyAndroid.installed().sandboxSignalOutcome)
            assertTrue(OpenVerifyAndroid.installed().eventListener === log)

            viewModel.onSandboxOutcomeChange(SandboxOutcomeChoice.NONE)
            viewModel.installComponents()
            assertNull(OpenVerifyAndroid.installed().sandboxSignalOutcome)
        } finally {
            OpenVerifyAndroid.install(OpenVerifyComponents())
        }
    }

    // C218.1: the event log -------------------------------------------------------------------

    @Test
    fun `the screen's event names are the log's`() {
        val log = EventLog()
        val viewModel = DemoViewModel(SavedStateHandle(), log)

        log.onEvent(OpenVerifyEvent.Started(DemoFormTest.INQUIRY_ID))
        log.onEvent(OpenVerifyEvent.Waiting)

        assertEquals(listOf("Started", "Waiting"), viewModel.eventNames.value)
    }

    // C218.2: a link an intent carried ----------------------------------------------------------

    @Test
    fun `a link on the app's host waits for the screen to launch it, against the compiled-in API`() {
        val saved = SavedStateHandle()
        val viewModel = DemoViewModel(saved)
        viewModel.onApiBaseUrlChange("http://10.0.2.2:3000")
        viewModel.onLocaleChange(LocaleChoice.DE)

        viewModel.onAppLink(APP_LINK)

        val pending = viewModel.pendingAppLink.value
        assertEquals(DemoFormTest.INQUIRY_ID, pending?.inquiryId)
        assertEquals(AppLinks.API_BASE_URL, pending?.apiBaseUrl)
        assertEquals("de", pending?.locale)
        assertNull(viewModel.result.value)
        val stored = saved.keys().joinToString("\n") { "$it=${saved.get<Any?>(it)}" }
        assertTrue(stored, !stored.contains("ovo_"))

        viewModel.appLinkTaken()
        assertNull(viewModel.pendingAppLink.value)
    }

    @Test
    fun `a link on another host is refused with a line that does not repeat it`() {
        val viewModel = DemoViewModel(SavedStateHandle())

        viewModel.onAppLink(APP_LINK.replace("verify.example.com", "evil.example"))

        assertNull(viewModel.pendingAppLink.value)
        assertEquals(ResultMessage(R.string.app_link_refused, emptyList()), viewModel.result.value)
    }

    companion object {
        /** Synthetic, on the host compiled into the demo (AppLinks.HOST). */
        const val APP_LINK = "https://verify.example.com/#inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7&one-time-token=ovo_ooooooooooooooooooooooooooooooooooooooooooo"

        const val API_URL = "http://10.0.2.2:3000"

        /** Synthetic: the `ovo_` prefix plus 43 base64url characters. */
        const val LINK = "http://10.0.2.2:5173/#inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7&one-time-token=ovo_ooooooooooooooooooooooooooooooooooooooooooo"
    }
}
