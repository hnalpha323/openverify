package dev.openverify.sdk.ui

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.ConsentStep
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ConsentScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val step = ConsentStep("consent", listOf("consent.biometric", "consent.processing"), required = true)

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private var accepted = 0
    private val acceptedOptional = mutableListOf<Set<String>>()
    private var canceled = 0

    private fun show(state: FlowState.Consent) {
        rule.setContent {
            ConsentScreen(
                state,
                onAccept = { optional, _ ->
                    accepted++
                    acceptedOptional += optional
                },
                onCancel = { canceled++ },
            )
        }
    }

    @Test
    fun `shows the title and every consent text of the step`() {
        show(FlowState.Consent(step))

        rule.onNodeWithText(text(Res.string.openverify_consent_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_consent_biometric)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_consent_processing)).assertExists()
    }

    @Test
    fun `shows only the texts the step lists`() {
        show(FlowState.Consent(step.copy(textKeys = listOf("consent.biometric"))))

        rule.onNodeWithText(text(Res.string.openverify_consent_biometric)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_consent_processing)).assertDoesNotExist()
    }

    @Test
    fun `continue is enabled only after the user agrees`() {
        show(FlowState.Consent(step))
        val continueButton = rule.onNodeWithText(text(Res.string.openverify_consent_continue))

        continueButton.performScrollTo().assertIsNotEnabled()
        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX).performScrollTo().performClick()
        continueButton.assertIsEnabled().performClick()

        assertEquals(1, accepted)
    }

    @Test
    fun `while consent is being saved it cannot be sent twice`() {
        show(FlowState.Consent(step, submitting = true))

        rule.onNodeWithText(text(Res.string.openverify_consent_saving)).assertExists()
        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX).performScrollTo().performClick()
        rule.onNodeWithText(text(Res.string.openverify_consent_continue)).performScrollTo().assertIsNotEnabled()
    }

    // The optional matching consent (C42.3) ---------------------------------------------------------

    private val matching = step.copy(optionalTextKeys = listOf("consent.biometric-matching"))
    private val matchingBox = TestTags.optionalConsent("consent.biometric-matching")
    private val matchingTemplate get() = text(Res.string.openverify_consent_biometric_matching)

    @Test
    fun `each optional text shows with its own unticked checkbox and the session's retention days`() {
        show(FlowState.Consent(matching, retentionDays = 365))

        // C199.5: the filled value is isolated in the displayed text (U+2068, U+2069), never in the digest's.
        rule.onNodeWithText(matchingTemplate.replace("{{days}}", "\u2068365\u2069")).performScrollTo().assertExists()
        rule.onNodeWithText(matchingTemplate).assertDoesNotExist()
        rule.onNodeWithTag(matchingBox).performScrollTo().assertIsOff()
        rule.onNodeWithText(text(Res.string.openverify_consent_biometric_matching_checkbox)).assertExists()
    }

    @Test
    fun `a ticked optional box sends its key with the agreement`() {
        show(FlowState.Consent(matching, retentionDays = 365))

        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX).performScrollTo().performClick()
        rule.onNodeWithTag(matchingBox).performScrollTo().performClick().assertIsOn()
        rule.onNodeWithText(text(Res.string.openverify_consent_continue)).performScrollTo().performClick()

        assertEquals(listOf(setOf("consent.biometric-matching")), acceptedOptional)
    }

    @Test
    fun `an optional box left unticked sends no key, and the user still continues`() {
        show(FlowState.Consent(matching, retentionDays = 365))

        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX).performScrollTo().performClick()
        rule.onNodeWithText(text(Res.string.openverify_consent_continue)).performScrollTo().performClick()

        assertEquals(listOf(emptySet<String>()), acceptedOptional)
    }

    @Test
    fun `the optional box alone does not let the user continue`() {
        show(FlowState.Consent(matching, retentionDays = 365))

        rule.onNodeWithTag(matchingBox).performScrollTo().performClick()

        rule.onNodeWithText(text(Res.string.openverify_consent_continue)).performScrollTo().assertIsNotEnabled()
    }

    @Test
    fun `an optional text whose retention days the session does not give is not offered`() {
        show(FlowState.Consent(matching, retentionDays = null))

        rule.onNodeWithTag(matchingBox).assertDoesNotExist()
        rule.onNodeWithText(matchingTemplate).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_consent_biometric)).assertExists()
    }

    @Test
    fun `cancel reports that the user stopped`() {
        show(FlowState.Consent(step))

        rule.onNodeWithText(text(Res.string.openverify_cancel)).performScrollTo().performClick()

        assertEquals(1, canceled)
        assertEquals(0, accepted)
    }
}
