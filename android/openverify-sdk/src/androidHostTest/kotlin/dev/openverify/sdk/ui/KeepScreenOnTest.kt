package dev.openverify.sdk.ui

import android.view.View
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.junit4.v2.createComposeRule
import dev.openverify.sdk.flow.FlowState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C201.5 (review H20; KP10-13, Workflow 10B foundation-10b): the waiting screen polls the server for as
 * long as the server decides, so it keeps the device's screen on while it is shown, and releases it when
 * the flow moves on. [KeepScreenOn] is the one way the SDK's screens do it (the capture screens'
 * holders are `capture-pipeline`'s), so two holders keep it on until the last one leaves.
 */
@RunWith(RobolectricTestRunner::class)
class KeepScreenOnTest {

    @get:Rule
    val rule = createComposeRule()

    @Test
    fun `the waiting screen keeps the screen on while it is shown, and releases it when the state moves on`() {
        var waiting by mutableStateOf(true)
        lateinit var view: View
        rule.setContent {
            view = LocalView.current
            if (waiting) WaitingScreen(FlowState.Waiting(retryAfterMs = 2_000), onCancel = {}) else LoadingScreen()
        }
        rule.waitForIdle()
        assertTrue(view.keepScreenOn)

        waiting = false
        rule.waitForIdle()

        assertFalse(view.keepScreenOn)
    }

    @Test
    fun `the screen stays on until the last of two holders leaves`() {
        var first by mutableStateOf(true)
        var second by mutableStateOf(true)
        lateinit var view: View
        rule.setContent {
            view = LocalView.current
            if (first) KeepScreenOn()
            if (second) KeepScreenOn()
        }
        rule.waitForIdle()
        assertTrue(view.keepScreenOn)

        first = false
        rule.waitForIdle()
        assertTrue(view.keepScreenOn)

        second = false
        rule.waitForIdle()
        assertFalse(view.keepScreenOn)
    }
}
