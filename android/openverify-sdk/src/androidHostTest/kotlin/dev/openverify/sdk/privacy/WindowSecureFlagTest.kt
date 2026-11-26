package dev.openverify.sdk.privacy

import android.Manifest
import android.app.Application
import android.os.Looper
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.OpenVerifyAndroid
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.OpenVerifyInquiryActivity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** One window of [PrivacyScreens.ALL]: the screen it is on and the entry that opens it. */
internal class WindowRow(val screen: PrivacyScreen, val entry: PrivacyEntry) {
    override fun toString(): String = "${screen.name}: ${entry.kind} (${entry.tag})"

    internal companion object {
        /** Every dialog and menu of the table, in its order. */
        val ALL: List<WindowRow> = PrivacyScreens.ALL.flatMap { screen ->
            screen.entries.filter { it is PrivacyEntry.Dialog || it is PrivacyEntry.Menu }.map { WindowRow(screen, it) }
        }
    }
}

/**
 * C213.1 (review P19): dialogs, pickers, popups and bottom sheets are windows of their own, and each
 * must keep its content out of screenshots, screen recordings and the recents thumbnail as the flow's
 * activity does. The real activity is launched on each screen of [PrivacyScreens.ALL]; each dialog and
 * menu is opened, and every window the process then has, the new one among them, carries
 * `FLAG_SECURE`. The SDK relies on Compose's `SecureFlagPolicy.Inherit`, so this fails if a window is
 * ever made another way. `WindowSitesScanTest` holds the table to the sources.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h2400dp")
internal class WindowSecureFlagTest(private val row: WindowRow) {

    @get:Rule
    val compose = createEmptyComposeRule()

    private val server = PrivacyFlowServer()

    @After
    fun stop() {
        server.close()
        OpenVerifyAndroid.install(OpenVerifyComponents())
    }

    @Test
    fun `the window it opens carries FLAG_SECURE, as every window of the flow does`() {
        server.session = row.screen.session
        row.screen.setup()
        ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(server.launchIntent()).use {
            row.screen.path.forEach { tag ->
                compose.waitUntil(timeoutMillis = 10_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithTag(tag).performScrollTo().performClick()
            }
            compose.waitUntil(timeoutMillis = 10_000) { compose.onAllNodesWithTag(row.screen.ready).fetchSemanticsNodes().isNotEmpty() }
            val before = ProcessWindows.params()
            assertEquals("the flow's own window", 1, before.size)
            assertTrue("the flow's own window is secure", before.all(ProcessWindows::secure))

            // The chrome's language menu sits outside the step's scrolling column.
            val opener = compose.onNodeWithTag(row.entry.tag)
            if (compose.onAllNodes(hasTestTag(row.entry.tag) and hasAnyAncestor(hasScrollAction())).fetchSemanticsNodes().isNotEmpty()) opener.performScrollTo()
            opener.performClick()
            compose.waitUntil(timeoutMillis = 10_000) { ProcessWindows.params().size > before.size }

            val open = ProcessWindows.params()
            assertEquals("$row: every window is secure", open.map { true }, open.map(ProcessWindows::secure))
            when (val entry = row.entry) {
                is PrivacyEntry.Dialog -> assertTrue("$row: a dialog window", open.any { it.type == WindowManager.LayoutParams.TYPE_APPLICATION })
                is PrivacyEntry.Menu -> {
                    // The menu is in a window of its own: its option is on screen only once that window is.
                    compose.onNodeWithTag(entry.option).performClick()
                    compose.waitUntil(timeoutMillis = 10_000) { ProcessWindows.params().size == before.size }
                }
                else -> error("not a window: $entry")
            }
            assertEquals(emptyList<String>(), server.otherPaths.toList())
        }
    }

    internal companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun rows(): List<Array<Any>> = WindowRow.ALL.map { arrayOf<Any>(it) }
    }
}

/**
 * The control for [WindowSecureFlagTest] and the rest of C213.1 at the activity: a dialog over an
 * activity that is not secure is seen as not secure, so the test above can fail; and the flow's
 * activity hides other apps' overlays while it is resumed, and only then (API 31+).
 */
@RunWith(RobolectricTestRunner::class)
internal class WindowChecksTest {

    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun `a dialog over a window that is not secure is seen as not secure`() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        controller.get().setContent { Dialog(onDismissRequest = {}) { Text("Synthetic dialog") } }
        shadowOf(Looper.getMainLooper()).idle()

        val windows = ProcessWindows.params()

        assertEquals(2, windows.size)
        assertEquals(listOf(false, false), windows.map(ProcessWindows::secure))
        controller.pause().stop().destroy()
    }

    @Test
    fun `a dialog over a secure window inherits the flag`() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        controller.get().window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        controller.get().setContent { Dialog(onDismissRequest = {}) { Text("Synthetic dialog") } }
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(listOf(true, true), ProcessWindows.params().map(ProcessWindows::secure))
        controller.pause().stop().destroy()
    }

    @Test
    fun `the flow hides other apps' overlays while it is resumed, and only then`() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.HIDE_OVERLAY_WINDOWS)
        PrivacyFlowServer().use { server ->
            server.session = PrivacyScreens.ALL.first().session
            ActivityScenario.launchActivityForResult<OpenVerifyInquiryActivity>(server.launchIntent()).use { scenario ->
                scenario.onActivity { assertTrue("resumed", hidesOverlays(it.window.attributes)) }

                scenario.moveToState(Lifecycle.State.STARTED)
                scenario.onActivity { assertFalse("paused", hidesOverlays(it.window.attributes)) }

                scenario.moveToState(Lifecycle.State.RESUMED)
                scenario.onActivity { assertTrue("resumed again", hidesOverlays(it.window.attributes)) }
            }
        }
    }

    /** `Window.setHideOverlayWindows` sets the hidden private flag `SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS`. */
    private fun hidesOverlays(params: WindowManager.LayoutParams): Boolean {
        val flag = WindowManager.LayoutParams::class.java.getField("SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS").getInt(null)
        return WindowManager.LayoutParams::class.java.getField("privateFlags").getInt(params) and flag != 0
    }
}
