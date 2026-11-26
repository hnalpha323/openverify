package dev.openverify.sdk.ui.steps

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.openverify.sdk.flow.ShareConsentView
import dev.openverify.sdk.flow.ShareConsentWithdrawals
import dev.openverify.sdk.model.FlowWithdrawableShareConsent
import dev.openverify.sdk.model.ShareConsentBiometric
import dev.openverify.sdk.model.ShareConsentSide
import dev.openverify.sdk.model.ShareConsentStep
import dev.openverify.sdk.model.ShareConsentText
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.RecordingActions
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * C238.7, C237.6 (Phase 11, Workflow 11A; `clients-connect`): the share-consent screen shows the
 * text the server composed as it was served, the recipient, the source and the categories in words
 * (the web's words, through the key map), and the separate biometric text as the label of its own
 * box, unticked; its two buttons report the person's choice and the tick. A missing tick is said in
 * a live region, and while the choice is sent nothing can be pressed. The withdrawal affordance
 * offers one withdrawal per accepted share, naming its recipient, and says what became of it.
 * Values are synthetic.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h1800dp")
internal class ShareConsentStepScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val ticks = mutableListOf<Boolean>()
    private var declined = 0
    private val actions = object : FlowActions by RecordingActions() {
        override fun acceptShareConsent(biometricTicked: Boolean) {
            ticks += biometricTicked
        }

        override fun declineShareConsent() {
            declined += 1
        }
    }
    private val body = "Example Source asks for your agreement to share the details it verified about you with Example Partner.\n\nTo withdraw, email privacy@example.com."
    private val biometricBody = "I agree that Example Source shares my biometric data with Example Partner."
    private val step = ShareConsentStep(
        id = "share_back",
        side = ShareConsentSide.SOURCE,
        recipientName = "Example Partner",
        sourceName = "Example Source",
        categories = listOf("identity-fields", "biometric"),
        text = ShareConsentText("en", body, "a".repeat(64), listOf("share.consent.source")),
        biometric = ShareConsentBiometric(biometricBody, "b".repeat(64)),
    )

    private fun show(view: ShareConsentView) {
        rule.setContent { ShareConsentStepScreen(view, actions) }
        rule.waitForIdle()
    }

    private fun showWithdrawals(withdrawals: ShareConsentWithdrawals, withdrawn: MutableList<String> = mutableListOf()) {
        rule.setContent { ShareConsentWithdrawalsCard(withdrawals, onWithdraw = { withdrawn += it }) }
        rule.waitForIdle()
    }

    private val live = SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion)

    /** A value inside a sentence, isolated as the SDK displays it (C199.5). */
    private fun iso(value: String) = "\u2068$value\u2069"

    @Test
    fun `the screen shows the served text, the names and the categories in words`() {
        show(ShareConsentView(step))

        rule.onNodeWithText("Share your verified details with ${iso("Example Partner")}").assertIsDisplayed()
        rule.onNodeWithTag(ShareConsentTags.TEXT).performScrollTo().assertTextEquals(body)
        rule.onNodeWithText("Example Source").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("your identity details, such as your name and date of birth").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("biometric data: photos of your face and the results of comparing them").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `the biometric text is its own box, unticked, and the choice carries the tick`() {
        show(ShareConsentView(step))

        rule.onNodeWithTag(ShareConsentTags.BIOMETRIC).performScrollTo()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.ToggleableState, ToggleableState.Off))
        rule.onNodeWithText(biometricBody).assertIsDisplayed()
        rule.onNodeWithTag(ShareConsentTags.ACCEPT).performScrollTo().performClick()
        rule.onNodeWithTag(ShareConsentTags.BIOMETRIC).performScrollTo().performClick()
        rule.onNodeWithTag(ShareConsentTags.ACCEPT).performScrollTo().performClick()

        assertEquals(listOf(false, true), ticks)
    }

    @Test
    fun `a share without biometric data has no box, and do not share declines`() {
        show(ShareConsentView(step.copy(categories = listOf("identity-fields"), biometric = null)))

        rule.onNodeWithTag(ShareConsentTags.BIOMETRIC).assertDoesNotExist()
        rule.onNodeWithTag(ShareConsentTags.DECLINE).performScrollTo().assertTextEquals("Do not share").performClick()
        rule.onNodeWithTag(ShareConsentTags.ACCEPT).assertTextEquals("I agree")

        assertEquals(1, declined)
    }

    @Test
    fun `a missing tick is said in a live region`() {
        show(ShareConsentView(step, tickMissing = true))

        rule.onNodeWithTag(ShareConsentTags.TICK_MISSING).performScrollTo()
            .assertTextEquals("Tick the box to agree to share your biometric data, or choose not to share.")
            .assert(live)
    }

    @Test
    fun `nothing can be pressed while the choice is sent, and the wait is announced`() {
        show(ShareConsentView(step, submitting = true))

        rule.onNodeWithTag(ShareConsentTags.ACCEPT).assertIsNotEnabled()
        rule.onNodeWithTag(ShareConsentTags.DECLINE).assertIsNotEnabled()
        rule.onNodeWithTag(ShareConsentTags.BIOMETRIC).assertIsNotEnabled()
        rule.onNodeWithTag(ShareConsentTags.SAVING).performScrollTo().assertTextEquals("Saving your choice…").assert(live)
    }

    @Test
    fun `the withdrawal affordance offers one withdrawal per accepted share, naming its recipient`() {
        val withdrawn = mutableListOf<String>()
        val entries = listOf(
            FlowWithdrawableShareConsent("share_back", ShareConsentSide.SOURCE, "Example Partner"),
            FlowWithdrawableShareConsent("share_other", ShareConsentSide.DESTINATION, "Example Other"),
        )
        showWithdrawals(ShareConsentWithdrawals(entries), withdrawn)

        rule.onNodeWithText("Your agreement to share").assertIsDisplayed()
        rule.onNodeWithTag(ShareConsentTags.withdraw("share_back")).performScrollTo()
            .assertTextEquals("Withdraw my agreement to share with ${iso("Example Partner")}").assertIsEnabled().performClick()
        rule.onNodeWithTag(ShareConsentTags.withdraw("share_other")).performScrollTo().performClick()

        assertEquals(listOf("share_back", "share_other"), withdrawn)
    }

    @Test
    fun `a withdrawal on its way, done or refused is said in a live region`() {
        val entry = FlowWithdrawableShareConsent("share_back", ShareConsentSide.SOURCE, "Example Partner")
        showWithdrawals(ShareConsentWithdrawals(listOf(entry), busyStepId = "share_back"))
        rule.onNodeWithTag(ShareConsentTags.withdraw("share_back")).assertIsNotEnabled()
        rule.onNodeWithTag(ShareConsentTags.WITHDRAWING).assertTextEquals("Withdrawing your agreement…").assert(live)
    }

    @Test
    fun `a withdrawal that was made says so, with nothing left to withdraw`() {
        showWithdrawals(ShareConsentWithdrawals(withdrawnRecipient = "Example Partner"))

        rule.onNodeWithTag(ShareConsentTags.WITHDRAWN).assertTextEquals("You withdrew your agreement to share with ${iso("Example Partner")}.").assert(live)
    }

    @Test
    fun `a refused withdrawal says so and is offered again`() {
        val entry = FlowWithdrawableShareConsent("share_back", ShareConsentSide.SOURCE, "Example Partner")
        showWithdrawals(ShareConsentWithdrawals(listOf(entry), failed = true))

        rule.onNodeWithTag(ShareConsentTags.WITHDRAW_FAILED).assert(live)
        rule.onNodeWithTag(ShareConsentTags.withdraw("share_back")).assertIsEnabled()
    }

    @Test
    fun `nothing is shown while the session lists no share consent`() {
        showWithdrawals(ShareConsentWithdrawals.NONE)

        rule.onNodeWithTag(ShareConsentTags.WITHDRAWALS).assertDoesNotExist()
    }
}
