package dev.openverify.sdk.flow

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.openverify.sdk.InquiryViewModel
import dev.openverify.sdk.i18n.sdkStringTable
import dev.openverify.sdk.ui.ConsentTexts
import dev.openverify.sdk.ui.FakeCaptureCamera
import dev.openverify.sdk.ui.InquiryFlowScreen
import dev.openverify.sdk.ui.OpenVerifyTheme
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.theme.LanguageSelection
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * C193.9 (decision 71, the 10A decisions' D2): the SDK tells the server the base tag of the language
 * it chose through Phase 9's mechanism, the consent body's `locale`, which sets the engine's
 * `session.locale` (`flow-engine/scope.ts`); nothing new rides on the session read. The chosen
 * language is the composition's (C199.2): the host's `Request.locale`, the person's choice in the
 * selector before consent, then the device. A choice made after consent is not reported, as on the
 * hosted flow.
 */
@RunWith(RobolectricTestRunner::class)
class SessionLanguageTest {

    @get:Rule
    val rule = createComposeRule()

    private val api = FakeFlowServer()
    private val selection = LanguageSelection()

    private fun showConsent(requestedLocale: String?) {
        val settings = FlowCoordinator.Settings(consentTextKeys = ConsentTexts.keys)
        val viewModel = InquiryViewModel(FlowCoordinator(api, FakeFlowApi.INQUIRY_ID, settings), FakeFlowApi.INQUIRY_ID)
        rule.setContent {
            val state by viewModel.state.collectAsState()
            OpenVerifyTheme(requestedLocale = requestedLocale, language = selection) {
                InquiryFlowScreen(state, FakeCaptureCamera(), viewModel)
            }
        }
    }

    private fun agree(language: String) {
        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX).performScrollTo().performClick()
        val button = checkNotNull(sdkStringTable(language)).strings.getValue("openverify_consent_continue")
        rule.onNodeWithText(button).performScrollTo().performClick()
        rule.waitForIdle()
    }

    @Test
    @Config(qualifiers = "en")
    fun `the host's requested language is the consent's locale, its base tag only, in a process of another locale`() {
        showConsent(requestedLocale = "fr-CA")

        agree("fr")

        assertEquals("fr", api.consentRequest?.second)
    }

    @Test
    @Config(qualifiers = "de")
    fun `a choice in the selector before consent is the consent's locale`() {
        showConsent(requestedLocale = null)
        rule.runOnIdle { selection.selected = "es" }

        agree("es")

        assertEquals("es", api.consentRequest?.second)
    }

    @Test
    @Config(qualifiers = "ar-rEG")
    fun `the device's language is the consent's locale when nothing else chose one, Arabic included`() {
        showConsent(requestedLocale = null)

        agree("ar")

        assertEquals("ar", api.consentRequest?.second)
    }
}

/** C193.9 at the coordinator: whatever tag it is told, the consent body carries its base language. */
internal class ConsentLocaleBaseTagTest {

    @org.junit.jupiter.api.Test
    fun `a regional tag is sent as its base language, and a malformed one as the coordinator's own`() = runTest {
        for ((told, sent) in listOf("es-MX" to "es", "ar-EG" to "ar", "FR" to "fr", "de" to "de", "not a tag" to "en", "" to "en")) {
            val api = FakeFlowServer()
            val coordinator = FlowCoordinator(api, FakeFlowApi.INQUIRY_ID)
            coordinator.start()

            coordinator.acceptConsent(locale = told)

            org.junit.jupiter.api.Assertions.assertEquals(sent, api.consentRequest?.second, told)
        }
    }
}
