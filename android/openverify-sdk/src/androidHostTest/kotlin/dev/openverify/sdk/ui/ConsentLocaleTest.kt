package dev.openverify.sdk.ui

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.openverify.sdk.InquiryViewModel
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FakeFlowServer
import dev.openverify.sdk.flow.FlowCoordinator
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Consent is recorded with the language its texts were shown in (C37, C42.3): the consent screen
 * reads the language with its texts and sends it with the agreement, on every platform. The view
 * model survives a change of the app's language, so the language the flow started in does not
 * count. The labels are written out, so each test shows which language the screen was in.
 */
@RunWith(RobolectricTestRunner::class)
class ConsentLocaleTest {

    @get:Rule
    val rule = createComposeRule()

    private val api = FakeFlowServer()

    /** The whole flow on its consent step; its view model was created while the app used [startedIn]. */
    private fun showConsent(startedIn: String) {
        val settings = FlowCoordinator.Settings(locale = startedIn, consentTextKeys = ConsentTexts.keys)
        val viewModel = InquiryViewModel(FlowCoordinator(api, FakeFlowApi.INQUIRY_ID, settings), FakeFlowApi.INQUIRY_ID)
        rule.setContent {
            val state by viewModel.state.collectAsState()
            InquiryFlowScreen(state, FakeCaptureCamera(), viewModel)
        }
    }

    private fun agreeAndPress(button: String) {
        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX).performScrollTo().performClick()
        rule.onNodeWithText(button).performScrollTo().performClick()
    }

    /** The language of the consent the server recorded. */
    private fun recordedLocale(): String? {
        // The view model calls the server on the main looper, which waitForIdle runs; waitUntil does not.
        rule.waitForIdle()
        return api.consentRequest?.second
    }

    @Test
    @Config(qualifiers = "es")
    fun `a Spanish consent screen records the consent in es, though the flow started in en`() {
        showConsent(startedIn = "en")

        rule.onNodeWithText("Consentimiento para usar tus datos biométricos").assertExists()
        agreeAndPress("Continuar")

        assertEquals("es", recordedLocale())
    }

    @Test
    fun `an English consent screen records the consent in en, though the flow started in es`() {
        showConsent(startedIn = "es")

        rule.onNodeWithText("Consent to use your biometric data").assertExists()
        agreeAndPress("Continue")

        assertEquals("en", recordedLocale())
    }

    @Test
    @Config(qualifiers = "es")
    fun `a consent sent again after an error keeps the language its texts were shown in`() {
        api.failNext("acceptConsent", FlowApiException.ServerError(503, null, null))
        showConsent(startedIn = "en")

        agreeAndPress("Continuar")
        rule.onNodeWithText("Volver a intentarlo").performClick()

        assertEquals("es", recordedLocale())
    }
}
