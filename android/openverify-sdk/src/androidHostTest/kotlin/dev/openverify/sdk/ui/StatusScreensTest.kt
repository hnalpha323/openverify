package dev.openverify.sdk.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.openverify.sdk.flow.FlowError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.ServerPosition
import dev.openverify.sdk.flow.SessionEndReason
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.InquiryStatus
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class StatusScreensTest {

    @get:Rule
    val rule = createComposeRule()

    private val events = mutableListOf<String>()

    private fun text(res: StringResource) = runBlocking { getString(res) }

    @Test
    fun `loading shows progress`() {
        rule.setContent { LoadingScreen() }

        rule.onNodeWithText(text(Res.string.openverify_loading)).assertExists()
        rule.onNodeWithTag(TestTags.PROGRESS).assertExists()
    }

    @Test
    fun `processing says the photos are being checked`() {
        rule.setContent { ProcessingScreen() }

        rule.onNodeWithText(text(Res.string.openverify_processing_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_processing_message)).assertExists()
        rule.onNodeWithTag(TestTags.PROGRESS).assertExists()
    }

    @Test
    fun `completion shows the step's message and finishes on Done`() {
        rule.setContent {
            CompletionScreen(
                FlowState.Completed(CompletionStep("done", "flow.completion"), InquiryStatus.COMPLETED),
                onDone = { events += "done" },
            )
        }

        rule.onNodeWithText(text(Res.string.openverify_completion_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_flow_completion)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_done)).performClick()
        assertEquals(listOf("done"), events)
    }

    @Test
    fun `an inquiry in review ends on the normal completion, with nothing to retry (C30_6)`() {
        rule.setContent {
            CompletionScreen(
                FlowState.Completed(CompletionStep("done", "flow.completion"), InquiryStatus.NEEDS_REVIEW),
                onDone = { events += "done" },
            )
        }

        rule.onNodeWithText(text(Res.string.openverify_completion_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_flow_completion)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_try_again)).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_retry_title)).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_done)).performClick()
        assertEquals(listOf("done"), events)
    }

    @Test
    fun `completion without a known message key still thanks the user`() {
        rule.setContent { CompletionScreen(FlowState.Completed(null, InquiryStatus.PENDING), onDone = {}) }

        rule.onNodeWithText(text(Res.string.openverify_flow_completion)).assertExists()
    }

    @Test
    fun `failure shows the step's message and closes`() {
        rule.setContent {
            FailureScreen(
                FlowState.Failed(FailureStep("failure", "flow.failure"), InquiryStatus.FAILED),
                onDone = { events += "done" },
            )
        }

        rule.onNodeWithText(text(Res.string.openverify_failure_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_flow_failure)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        assertEquals(listOf("done"), events)
    }

    @Test
    fun `failure without a failure step shows the default message`() {
        rule.setContent { FailureScreen(FlowState.Failed(null, InquiryStatus.FAILED), onDone = {}) }

        rule.onNodeWithText(text(Res.string.openverify_flow_failure)).assertExists()
    }

    @Test
    fun `an expired inquiry says so and closes`() {
        rule.setContent { ExpiredScreen(onClose = { events += "close" }) }

        rule.onNodeWithText(text(Res.string.openverify_expired_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_expired_message)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        assertEquals(listOf("close"), events)
    }

    @Test
    fun `a retryable error offers Try again and Close`() {
        rule.setContent {
            ErrorScreen(
                FlowState.Error(FlowError.NETWORK, canRetry = true),
                onRetry = { events += "retry" },
                onClose = { events += "close" },
            )
        }

        rule.onNodeWithText(text(Res.string.openverify_error_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_error_network)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_try_again)).performClick()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        assertEquals(listOf("retry", "close"), events)
    }

    @Test
    fun `an error that cannot be retried only closes`() {
        rule.setContent {
            ErrorScreen(FlowState.Error(FlowError.SESSION_EXPIRED, canRetry = false), onRetry = {}, onClose = {})
        }

        rule.onNodeWithText(text(Res.string.openverify_error_session_expired)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_try_again)).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_close)).assertExists()
    }

    @Test
    fun `an unsupported flow explains it and closes`() {
        rule.setContent { UnsupportedScreen(onClose = { events += "close" }) }

        rule.onNodeWithText(text(Res.string.openverify_unsupported_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_unsupported_message)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        assertEquals(listOf("close"), events)
    }

    @Test
    fun `a server older than flow-spec 2 is named on the unsupported screen, and any other reason is not (C193_2)`() {
        var reason by mutableStateOf<String?>(ServerPosition.SERVER_BEFORE_SPEC_2)
        rule.setContent { UnsupportedScreen(onClose = { events += "close" }, reason = reason) }

        rule.onNodeWithText(text(Res.string.openverify_unsupported_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_unsupported_server_message)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_unsupported_message)).assertDoesNotExist()

        reason = "step nfc"
        rule.onNodeWithText(text(Res.string.openverify_unsupported_message)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_unsupported_server_message)).assertDoesNotExist()
        // Diagnostics only: the reason itself never reaches the person.
        rule.onNodeWithText("step nfc", substring = true).assertDoesNotExist()
    }

    // C197.1, C197.2 ---------------------------------------------------------------------

    @Test
    fun `a wait says one moment in a polite live region, names nothing of what is awaited, and offers cancel (C197_1)`() {
        rule.setContent { WaitingScreen(FlowState.Waiting(retryAfterMs = 2_000), onCancel = { events += "cancel" }) }

        rule.onNodeWithText(text(Res.string.openverify_waiting_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_waiting_message))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
        rule.onNodeWithTag(TestTags.PROGRESS).assertExists()
        rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion)).assertCountEquals(1)
        rule.onNodeWithText(text(Res.string.openverify_cancel)).performClick()
        assertEquals(listOf("cancel"), events)
    }

    @Test
    fun `a halted flow says it cannot continue on this device and that the organization can resume it, and closes (C197_2)`() {
        rule.setContent { HaltedScreen(onClose = { events += "close" }) }

        rule.onNodeWithText(text(Res.string.openverify_halted_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_halted_message)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_unsupported_title)).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        assertEquals(listOf("close"), events)
    }

    // C19 --------------------------------------------------------------------------------

    @Test
    fun `an expired session explains itself and only closes, with no retry`() {
        rule.setContent { SessionEndedScreen(FlowState.SessionEnded(SessionEndReason.EXPIRED), onClose = { events += "close" }) }

        rule.onNodeWithText(text(Res.string.openverify_session_expired_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_session_expired_message)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_try_again)).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        assertEquals(listOf("close"), events)
    }

    @Test
    fun `a canceled session has its own message`() {
        rule.setContent { SessionEndedScreen(FlowState.SessionEnded(SessionEndReason.CANCELED), onClose = {}) }

        rule.onNodeWithText(text(Res.string.openverify_session_canceled_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_session_canceled_message)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_try_again)).assertDoesNotExist()
    }

    @Test
    fun `a redacted inquiry says the verification is gone`() {
        rule.setContent { RedactedScreen(onClose = { events += "close" }) }

        rule.onNodeWithText(text(Res.string.openverify_redacted_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_redacted_message)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_try_again)).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        assertEquals(listOf("close"), events)
    }

    @Test
    fun `a refused one-time link says it was used`() {
        rule.setContent { LinkRefusedScreen(onClose = { events += "close" }) }

        rule.onNodeWithText(text(Res.string.openverify_link_refused_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_link_refused_message)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_try_again)).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_close)).performClick()
        assertEquals(listOf("close"), events)
    }

    @Test
    fun `the sandbox banner names the sandbox`() {
        rule.setContent { SandboxBanner() }

        rule.onNodeWithTag(TestTags.SANDBOX_BANNER).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_sandbox_label), substring = true).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_sandbox_message), substring = true).assertExists()
    }
}
