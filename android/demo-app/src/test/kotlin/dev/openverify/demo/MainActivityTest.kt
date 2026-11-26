package dev.openverify.demo

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.OpenVerifyEvent
import dev.openverify.sdk.SandboxSignalOutcome
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * The demo's one screen: the pasted session survives a rotation (1B F026); the pickers, the event
 * log, the sandbox outcome and the App Links example of C218.
 */
@RunWith(RobolectricTestRunner::class)
class MainActivityTest {

    @get:Rule
    val compose = createEmptyComposeRule()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun text(id: Int) = context.getString(id)

    @After
    fun reset() {
        EventLog.shared.clear()
        OpenVerifyAndroid.install(OpenVerifyComponents())
    }

    private fun pasteSession() {
        compose.onNodeWithText(text(R.string.field_inquiry_id)).performTextInput(DemoFormTest.INQUIRY_ID)
        compose.onNodeWithText(text(R.string.field_session_token)).performTextInput(DemoFormTest.TOKEN)
    }

    private fun tap(label: String) {
        compose.onNodeWithText(label).performScrollTo().performClick()
        compose.waitForIdle()
    }

    /** The class the next started activity names, or `null` when none was started. */
    private fun ActivityScenario<MainActivity>.startedActivity(): String? {
        var started: String? = null
        onActivity { started = shadowOf(it).nextStartedActivity?.component?.className }
        return started
    }

    private fun appLink(host: String) =
        Intent(Intent.ACTION_VIEW, Uri.parse(DemoViewModelTest.APP_LINK.replace("verify.example.com", host)), context, MainActivity::class.java)

    @Test
    fun `a pasted session survives a rotation`() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            pasteSession()
            compose.onNodeWithText(text(R.string.start_verification_button)).assertIsEnabled()

            scenario.recreate()

            compose.onNodeWithText(text(R.string.start_verification_button)).assertIsEnabled()
        }
    }

    @Test
    fun `a pasted one-time link survives a rotation`() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            compose.onNodeWithText(text(R.string.field_one_time_link)).performTextInput(DemoViewModelTest.LINK)
            compose.onNodeWithText(text(R.string.start_one_time_link_button)).assertIsEnabled()

            scenario.recreate()

            compose.onNodeWithText(text(R.string.start_one_time_link_button)).assertIsEnabled()
        }
    }

    // C218.4 --------------------------------------------------------------------------------------

    @Test
    fun `the screen says it is a test harness for sandbox inquiries and which modules it holds`() {
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.onNodeWithText(text(R.string.harness_notice)).assertExists()
            compose.onNodeWithText(text(DemoArtifacts.description(DemoArtifacts.included))).assertExists()
        }
    }

    // C218.1: the pickers and the sandbox outcome (Phase 7 C90.9) -------------------------------------

    @Test
    fun `the app installs its event log when the process starts`() {
        assertSame(EventLog.shared, OpenVerifyAndroid.installed().eventListener)
        assertNull(OpenVerifyAndroid.installed().sandboxSignalOutcome)
    }

    @Test
    fun `the picked sandbox outcome is installed before the session launch`() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            pasteSession()
            tap(text(R.string.sandbox_outcome_bot))

            tap(text(R.string.start_verification_button))

            assertEquals(SandboxSignalOutcome.BOT, OpenVerifyAndroid.installed().sandboxSignalOutcome)
            assertSame(EventLog.shared, OpenVerifyAndroid.installed().eventListener)
            assertEquals(SDK_ACTIVITY, scenario.startedActivity())
        }
    }

    @Test
    fun `the picked sandbox outcome is installed before the one-time-link launch too`() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            compose.onNodeWithText(text(R.string.field_one_time_link)).performTextInput(DemoViewModelTest.LINK)
            tap(text(R.string.sandbox_outcome_human))

            tap(text(R.string.start_one_time_link_button))

            assertEquals(SandboxSignalOutcome.HUMAN, OpenVerifyAndroid.installed().sandboxSignalOutcome)
            assertEquals(SDK_ACTIVITY, scenario.startedActivity())
        }
    }

    @Test
    fun `with no outcome picked a launch asks for none`() {
        OpenVerifyAndroid.install(OpenVerifyComponents(sandboxSignalOutcome = SandboxSignalOutcome.BOT))
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            pasteSession()

            tap(text(R.string.start_verification_button))

            assertNull(OpenVerifyAndroid.installed().sandboxSignalOutcome)
            assertEquals(SDK_ACTIVITY, scenario.startedActivity())
        }
    }

    @Test
    fun `a picked language, appearance and outcome survive a rotation`() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            tap("ar")
            tap(text(R.string.appearance_dark))
            tap(text(R.string.sandbox_outcome_human))

            scenario.recreate()

            compose.onNodeWithText("ar").assertIsSelected()
            compose.onNodeWithText(text(R.string.appearance_dark)).assertIsSelected()
            compose.onNodeWithText(text(R.string.sandbox_outcome_human)).assertIsSelected()
        }
    }

    // C218.1: the event log -------------------------------------------------------------------------

    @Test
    fun `the screen lists event names, and nothing an event carries`() {
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.onNodeWithText(text(R.string.event_log_empty)).assertExists()

            EventLog.shared.onEvent(OpenVerifyEvent.Started(DemoFormTest.INQUIRY_ID))
            EventLog.shared.onEvent(OpenVerifyEvent.StepShown("government_id"))
            compose.waitForIdle()

            compose.onNodeWithText("Started").assertExists()
            compose.onNodeWithText("StepShown").assertExists()
            compose.onAllNodesWithText(DemoFormTest.INQUIRY_ID, substring = true).assertCountEquals(0)
            compose.onAllNodesWithText("government_id", substring = true).assertCountEquals(0)
            compose.onAllNodesWithText(text(R.string.event_log_empty)).assertCountEquals(0)
        }
    }

    // C218.2: the App Links example -------------------------------------------------------------------

    @Test
    fun `a one-time link on the app's own host starts the flow`() {
        ActivityScenario.launch<MainActivity>(appLink("verify.example.com")).use { scenario ->
            compose.waitForIdle()

            assertEquals(SDK_ACTIVITY, scenario.startedActivity())
        }
    }

    @Test
    fun `a link on another host starts nothing and is refused on the screen`() {
        ActivityScenario.launch<MainActivity>(appLink("evil.example")).use { scenario ->
            compose.waitForIdle()

            assertNull(scenario.startedActivity())
            compose.onNodeWithText(text(R.string.app_link_refused)).assertExists()
        }
    }

    @Test
    fun `a rotation does not open the link a second time`() {
        ActivityScenario.launch<MainActivity>(appLink("verify.example.com")).use { scenario ->
            compose.waitForIdle()
            assertEquals(SDK_ACTIVITY, scenario.startedActivity())

            scenario.recreate()
            compose.waitForIdle()

            assertNull(scenario.startedActivity())
        }
    }

    @Test
    fun `a link that arrives while the screen is open starts the flow`() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { it.onNewIntent(appLink("verify.example.com")) }
            compose.waitForIdle()

            assertEquals(SDK_ACTIVITY, scenario.startedActivity())
        }
    }

    private companion object {
        const val SDK_ACTIVITY = "dev.openverify.sdk.OpenVerifyInquiryActivity"
    }
}
