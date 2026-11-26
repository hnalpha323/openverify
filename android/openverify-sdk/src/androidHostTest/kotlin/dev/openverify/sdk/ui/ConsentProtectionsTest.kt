package dev.openverify.sdk.ui

import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.ui.screen.LocalPlatformApiLevel
import dev.openverify.sdk.ui.screen.ObscuredTouchesFiltered
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.getString
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * C213.1 (decision 70; review P08, V03), android-sdk-api's part on the consent screen: on API 26 to
 * 30, where the platform does not yet block touches through untrusted overlays, the agreement, each
 * optional consent and Continue drop a touch delivered while another window obscured them
 * (`filterTouchesWhenObscured`). From API 31 the platform blocks them itself and the flow's window
 * hides other apps' overlays (`OverlayWindowsTest`). Robolectric runs API 36 only offline (rule 9),
 * so the level is injected through [LocalPlatformApiLevel].
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h1400dp")
internal class ConsentProtectionsTest {

    @get:Rule
    val rule = createComposeRule()

    private val step = ConsentStep(
        "consent",
        listOf("consent.biometric", "consent.processing"),
        required = true,
        optionalTextKeys = listOf("consent.device-recognition"),
    )

    private lateinit var view: View
    private var apiLevel by mutableIntStateOf(0)
    private var shown = false

    /** Shows the screen on [level]; a second call changes the level of the screen already shown. */
    private fun show(level: Int) {
        apiLevel = level
        if (shown) {
            rule.waitForIdle()
            return
        }
        shown = true
        rule.setContent {
            view = LocalView.current
            CompositionLocalProvider(LocalPlatformApiLevel provides apiLevel) {
                ConsentScreen(FlowState.Consent(step), onAccept = { _, _ -> }, onCancel = {})
            }
        }
    }

    private fun continueButton(): SemanticsNodeInteraction =
        rule.onNodeWithText(runBlocking { getString(Res.string.openverify_consent_continue) })

    private fun controls(): List<SemanticsNodeInteraction> = listOf(
        rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX),
        rule.onNodeWithTag(TestTags.optionalConsent("consent.device-recognition")),
        continueButton(),
    )

    @Test
    fun `on API 26 to 30 the agreement, the optional consent and Continue drop obscured touches`() {
        (26..30).forEach { level ->
            show(level)
            controls().forEach { it.assert(SemanticsMatcher.expectValue(ObscuredTouchesFiltered, true)) }
        }
    }

    @Test
    fun `from API 31 they leave obscured touches to the platform`() {
        show(31)

        controls().forEach { it.assert(SemanticsMatcher.keyNotDefined(ObscuredTouchesFiltered)) }
    }

    private fun tap(node: SemanticsNodeInteraction, obscured: Boolean) {
        node.performScrollTo()
        val bounds = node.getBoundsInRoot()
        val density = view.resources.displayMetrics.density
        val x = (bounds.left.value + bounds.right.value) / 2 * density
        val y = (bounds.top.value + bounds.bottom.value) / 2 * density
        val flags = if (obscured) MotionEvent.FLAG_WINDOW_IS_OBSCURED else 0
        rule.runOnIdle {
            val now = SystemClock.uptimeMillis()
            listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP).forEach { action ->
                val properties = arrayOf(MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER })
                val coords = arrayOf(MotionEvent.PointerCoords().apply { this.x = x; this.y = y })
                val event = MotionEvent.obtain(now, now + 10, action, 1, properties, coords, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, flags)
                view.dispatchTouchEvent(event)
                event.recycle()
            }
        }
        rule.waitForIdle()
    }

    @Test
    fun `on API 28 a tap through an obscuring window never ticks the agreement`() {
        show(28)
        val agreement = rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX)

        tap(agreement, obscured = true)

        agreement.assertIsOff()
    }

    @Test
    fun `on API 28 an unobscured tap ticks it`() {
        show(28)
        val agreement = rule.onNodeWithTag(TestTags.CONSENT_CHECKBOX)

        tap(agreement, obscured = false)

        agreement.assertIsOn()
    }
}
