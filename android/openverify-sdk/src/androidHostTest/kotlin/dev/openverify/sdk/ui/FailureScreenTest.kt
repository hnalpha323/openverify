package dev.openverify.sdk.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.isolated
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FlowContestRoute
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.ui.screen.LocalScreenEnvironment
import dev.openverify.sdk.ui.screen.RecordingUriHandler
import dev.openverify.sdk.ui.screen.ScreenTags
import dev.openverify.sdk.ui.screen.screenEnvironment
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C197.3 (Workflow 10A, android-screens): the failed inquiry's screen, with the decision's contest
 * route when the server sends one (C128.7). The route is synthetic: an `https:` address at
 * example.com and a made-up contact.
 */
@RunWith(RobolectricTestRunner::class)
internal class FailureScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val uris = RecordingUriHandler()
    private var done = 0

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private val isHeading = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)

    private fun show(route: FlowContestRoute?, step: FailureStep? = FailureStep("failed", "flow.failure")) {
        rule.setContent {
            CompositionLocalProvider(
                LocalScreenEnvironment provides screenEnvironment(emptyMap(), contestRoute = route),
                LocalUriHandler provides uris,
            ) {
                FailureScreen(FlowState.Failed(step, InquiryStatus.DECLINED), onDone = { done++ })
            }
        }
    }

    @Test
    fun `without a contest route the failure screen is as before`() {
        show(route = null)

        rule.onNodeWithText(text(Res.string.openverify_failure_title)).assertIsDisplayed()
        rule.onNode(hasText(text(Res.string.openverify_contest_heading)) and isHeading).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        assertEquals(1, done)
    }

    @Test
    fun `a contest route shows its words, the host before the link, the link in the system browser and the contact (C197_3)`() {
        show(FlowContestRoute(url = "https://review.example.com/contest", host = "review.example.com", contact = "Synthetic review desk"))

        rule.onNode(hasText(text(Res.string.openverify_contest_heading)) and isHeading).assertIsDisplayed()
        rule.onNodeWithText(text(Res.string.openverify_contest_intro)).assertIsDisplayed()
        rule.onNodeWithText(text(Res.string.openverify_contest_host).replace("{{host}}", isolated("review.example.com"))).assertIsDisplayed()
        rule.onNodeWithText(text(Res.string.openverify_contest_contact).replace("{{contact}}", isolated("Synthetic review desk"))).assertIsDisplayed()
        rule.onNodeWithTag(ScreenTags.CONTEST_LINK).performClick()

        assertEquals(listOf("https://review.example.com/contest"), uris.opened)
        assertEquals(0, done)
    }

    @Test
    fun `a contact alone is shown without a link`() {
        show(FlowContestRoute(url = null, host = null, contact = "Synthetic review desk"))

        rule.onNodeWithTag(ScreenTags.CONTEST_CONTACT).assertIsDisplayed()
        rule.onNodeWithTag(ScreenTags.CONTEST_LINK).assertDoesNotExist()
    }

    @Test
    fun `a route whose address is not https offers no link, and with no contact no route at all`() {
        show(FlowContestRoute(url = "http://review.example.com/contest", host = "review.example.com", contact = null))

        rule.onNodeWithTag(ScreenTags.CONTEST_LINK).assertDoesNotExist()
        rule.onNode(hasText(text(Res.string.openverify_contest_heading)) and isHeading).assertDoesNotExist()
        assertTrue(uris.opened.isEmpty())
    }

    @Test
    fun `an inquiry failed without a failure step shows the general failure message, with its route`() {
        show(FlowContestRoute(url = "https://review.example.com/contest", host = "review.example.com", contact = null), step = null)

        rule.onNodeWithText(text(Res.string.openverify_flow_failure)).assertIsDisplayed()
        rule.onNodeWithTag(ScreenTags.CONTEST_LINK).assertIsDisplayed()
    }
}
