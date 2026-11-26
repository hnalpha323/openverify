package dev.openverify.sdk.capture.selfie

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import dev.openverify.sdk.flow.SelfieCaptureProtocol
import dev.openverify.sdk.ui.OpenVerifyTheme
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TestTimeSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C204.3, C204.5, C212.2 (WCAG 2.2.1): what a person and a screen reader get from the selfie guidance
 * and the capture's time limit. The hint's spoken text is the settled announcement in a polite live
 * region, so a message that changes with every frame is announced once per settled change; left is the
 * person's own left in every language and direction. Twenty seconds before the capture ends, a polite
 * warning offers more time, and says what became of the request.
 */
@RunWith(RobolectricTestRunner::class)
class SelfieGuidanceUiTest {

    @get:Rule
    val rule = createComposeRule()

    private fun spoken(tag: String): String? =
        rule.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString()

    private fun liveRegion(tag: String): LiveRegionMode? =
        rule.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(SemanticsProperties.LiveRegion)

    @Test
    fun `the hint is heard as its settled announcement, once per settled change, never per frame`() {
        var view by mutableStateOf(SelfieGuidanceView(GuidanceMessage.LOOK_STRAIGHT, null, false))
        rule.setContent { OpenVerifyTheme(requestedLocale = "en") { SelfieGuidanceOverlay(view) } }
        val heard = mutableListOf(spoken(SelfieGuidanceTags.HINT))
        assertEquals(LiveRegionMode.Polite, liveRegion(SelfieGuidanceTags.HINT))

        // 40 frames whose message flickers, then one settles, then another.
        for (frame in 0 until 40) {
            view = view.copy(message = if (frame % 2 == 0) GuidanceMessage.NO_FACE else GuidanceMessage.TOO_FAR)
            rule.waitForIdle()
            spoken(SelfieGuidanceTags.HINT).let { if (it != heard.last()) heard += it }
        }
        view = view.copy(message = GuidanceMessage.TOO_FAR, announcement = GuidanceMessage.TOO_FAR)
        rule.waitForIdle()
        spoken(SelfieGuidanceTags.HINT).let { if (it != heard.last()) heard += it }
        view = view.copy(message = GuidanceMessage.HOLD_STILL, announcement = GuidanceMessage.HOLD_STILL)
        rule.waitForIdle()
        spoken(SelfieGuidanceTags.HINT).let { if (it != heard.last()) heard += it }

        assertEquals(listOf("Look straight at the camera.", "Move closer to the camera.", "Hold still…"), heard)
    }

    @Test
    fun `left is the person's own left in a right-to-left language`() {
        rule.setContent {
            OpenVerifyTheme(requestedLocale = "ar") {
                SelfieGuidanceOverlay(SelfieGuidanceView(GuidanceMessage.TURN_LEFT, GuidanceMessage.TURN_LEFT, false))
            }
        }

        val heard = checkNotNull(spoken(SelfieGuidanceTags.HINT))
        assertTrue(heard, heard.contains("اليسار"))
        assertFalse(heard, heard.contains("اليمين"))
    }

    private val clock = TestTimeSource()

    private fun window(left: Int) = SelfieCaptureWindow(CAPTURE, clock.markNow() + left.seconds)

    /** A change of the window as the coordinator publishes one: applied, and drawn in the next frame. */
    private fun tell(change: () -> Unit) {
        change()
        Snapshot.sendApplyNotifications()
        rule.mainClock.advanceTimeByFrame()
        rule.waitForIdle()
    }

    /** Moves the device's clock and lets the warning read it. */
    private fun pass(seconds: Int) {
        clock += seconds.seconds
        rule.mainClock.advanceTimeBy(1_000)
        rule.waitForIdle()
    }

    @Test
    fun `twenty seconds before the end a polite warning offers more time, and nothing earlier`() {
        rule.mainClock.autoAdvance = false
        var asked = 0
        val open = window(left = 25)
        rule.setContent { OpenVerifyTheme(requestedLocale = "en") { SelfieCaptureExtension(open, onExtend = { asked += 1 }) } }
        rule.mainClock.advanceTimeBy(1_000)
        rule.waitForIdle()
        assertEquals(0, count(SelfieExtensionTags.WARNING))

        pass(6)

        assertEquals("About 19 seconds left to take your photos. Need more time?", spoken(SelfieExtensionTags.WARNING))
        assertEquals(LiveRegionMode.Polite, liveRegion(SelfieExtensionTags.WARNING))
        rule.onNodeWithTag(SelfieExtensionTags.MORE_TIME).assertIsEnabled().performClick()
        assertEquals(1, asked)

        // The count is said once: it does not tick down with every second.
        pass(3)
        assertEquals("About 19 seconds left to take your photos. Need more time?", spoken(SelfieExtensionTags.WARNING))
    }

    @Test
    fun `while more time is asked the button waits, and a granted extension says so and ends the warning`() {
        rule.mainClock.autoAdvance = false
        var open by mutableStateOf(window(left = 15))
        rule.setContent { OpenVerifyTheme(requestedLocale = "en") { SelfieCaptureExtension(open, onExtend = {}) } }
        pass(0)

        tell { open = open.copy(extension = SelfieExtensionOutcome.EXTENDING) }
        pass(0)
        rule.onNodeWithTag(SelfieExtensionTags.MORE_TIME).assertIsNotEnabled()

        tell { open = open.copy(expiresAt = open.expiresAt + SelfieCaptureProtocol.CAPTURE_TTL, extension = SelfieExtensionOutcome.EXTENDED) }
        pass(0)

        assertEquals(0, count(SelfieExtensionTags.WARNING))
        assertEquals("You have more time.", spoken(SelfieExtensionTags.STATUS))
        assertEquals(LiveRegionMode.Polite, liveRegion(SelfieExtensionTags.STATUS))
    }

    @Test
    fun `a refusal after submit says the photos were already sent, and offers nothing more`() {
        rule.mainClock.autoAdvance = false
        var open by mutableStateOf(window(left = 10))
        rule.setContent { OpenVerifyTheme(requestedLocale = "en") { SelfieCaptureExtension(open, onExtend = {}) } }
        tell { open = open.copy(extension = SelfieExtensionOutcome.ALREADY_SENT) }
        pass(0)

        assertEquals("Your photos were already sent, so no more time is needed.", spoken(SelfieExtensionTags.STATUS))
        assertEquals(0, count(SelfieExtensionTags.MORE_TIME))
    }

    @Test
    fun `a failed request says so and still lets the person ask again`() {
        rule.mainClock.autoAdvance = false
        var asked = 0
        var open by mutableStateOf(window(left = 10))
        rule.setContent { OpenVerifyTheme(requestedLocale = "en") { SelfieCaptureExtension(open, onExtend = { asked += 1 }) } }
        tell { open = open.copy(extension = SelfieExtensionOutcome.FAILED) }
        pass(0)

        assertEquals(
            "We could not add more time. Take your photos now, or start again if the time runs out.",
            spoken(SelfieExtensionTags.STATUS),
        )
        rule.onNodeWithTag(SelfieExtensionTags.MORE_TIME).performClick()
        assertEquals(1, asked)
    }

    @Test
    fun `a capture with no outcome, an ended capture and no capture show nothing`() {
        rule.mainClock.autoAdvance = false
        var open by mutableStateOf<SelfieCaptureWindow?>(window(left = 10).copy(id = "self_01M5CJXHG07XPHF3HRM6NREDH0"))
        rule.setContent { OpenVerifyTheme(requestedLocale = "en") { SelfieCaptureExtension(open, onExtend = {}) } }
        // KP10-25: an outcome lives on its own capture's window, so this window has none to show.
        pass(0)
        assertEquals(0, count(SelfieExtensionTags.STATUS))

        pass(11)
        assertEquals(0, count(SelfieExtensionTags.WARNING))

        open = null
        pass(0)
        assertEquals(0, count(SelfieExtensionTags.WARNING))
    }

    private fun count(tag: String): Int = rule.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().size

    private companion object {
        const val CAPTURE = "self_01M5CJXHG07XPHF3HRM6NREDH9"
    }
}
