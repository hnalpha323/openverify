package dev.openverify.sdk.ui.screen

import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.ButtonComponent
import dev.openverify.sdk.model.EmailComponent
import dev.openverify.sdk.model.MaskedTextComponent
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.TextComponent
import dev.openverify.sdk.model.TextInputComponent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * C213.1 (decision 70; review V03), android-screens' part: on API 34+ the typed-value fields are
 * accessibility-data-sensitive; on API 26-30 the submit controls drop touches delivered through an
 * obscuring window. The API level is the device's, injected here through [LocalPlatformApiLevel]:
 * Robolectric's only offline platform jar is API 36 (rule 9 forbids fetching others in a test), so
 * the levels are covered by the injected level, the platform's own mapping on API 36 by the real one.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h1400dp")
internal class ScreenProtectionsTest {

    @get:Rule
    val rule = createComposeRule()

    private val copy = mapOf(
        "about.title.title" to "About you",
        "about.nickname.label" to "Nickname",
        "about.email.label" to "Email",
        "about.secret.label" to "Passphrase",
        "about.next.button" to "Continue",
    )

    private fun show(apiLevel: Int) {
        val step = ScreenStep(
            "about",
            listOf(
                TextComponent("title", "title", "about.title.title"),
                TextInputComponent("nickname", "nickname", "about.nickname.label"),
                EmailComponent("email", "email", "about.email.label"),
                MaskedTextComponent("secret", "secret", "about.secret.label"),
                ButtonComponent("next", "about.next.button", "submit"),
            ),
        )
        rule.setContent {
            CompositionLocalProvider(LocalScreenEnvironment provides screenEnvironment(copy), LocalPlatformApiLevel provides apiLevel) {
                ScreenStepScreen(FlowState.Screen(step), ScreenActions())
            }
        }
    }

    @Test
    fun `the protections by API level`() {
        assertEquals((26..30).toList(), (21..36).filter(::filtersObscuredTouches))
        assertEquals((34..36).toList(), (21..36).filter(::marksDataSensitive))
    }

    @Test
    fun `on API 34 and later every typed field is accessibility-data-sensitive, and only the typed fields`() {
        show(apiLevel = 34)

        listOf("nickname", "email", "secret").forEach {
            rule.onNodeWithTag(ScreenTags.field(it)).assert(SemanticsMatcher.expectValue(SemanticsProperties.IsSensitiveData, true))
        }
        rule.onNodeWithTag(ScreenTags.component("next")).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.IsSensitiveData))
        rule.onNodeWithTag(ScreenTags.HEADING).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.IsSensitiveData))
    }

    @Test
    fun `below API 34 no field is marked`() {
        show(apiLevel = 33)

        rule.onNodeWithTag(ScreenTags.field("nickname")).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.IsSensitiveData))
    }

    @Test
    fun `on API 26 to 30 the submit control drops obscured touches, from API 31 the platform does`() {
        show(apiLevel = 28)
        rule.onNodeWithTag(ScreenTags.component("next")).assert(SemanticsMatcher.expectValue(ObscuredTouchesFiltered, true))
    }

    @Test
    fun `from API 31 the submit control leaves obscured touches to the platform`() {
        show(apiLevel = 31)
        rule.onNodeWithTag(ScreenTags.component("next")).assert(SemanticsMatcher.keyNotDefined(ObscuredTouchesFiltered))
    }

    private lateinit var view: View

    private fun tapButton(apiLevel: Int, obscured: Boolean): Int {
        var clicks = 0
        rule.setContent {
            view = LocalView.current
            CompositionLocalProvider(LocalPlatformApiLevel provides apiLevel) {
                Box(Modifier.size(200.dp)) {
                    Button(onClick = { clicks++ }, modifier = Modifier.testTag("submit").submitProtection()) { Text("Continue") }
                }
            }
        }
        val bounds = rule.onNodeWithTag("submit").getBoundsInRoot()
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
        return clicks
    }

    @Test
    fun `on API 28 a tap through an obscuring window never presses a submit control, an unobscured one does`() {
        assertEquals(0, tapButton(apiLevel = 28, obscured = true))
    }

    @Test
    fun `on API 28 an unobscured tap presses it`() {
        assertEquals(1, tapButton(apiLevel = 28, obscured = false))
    }

    @Test
    fun `on API 36 the control does not filter, the platform blocks untrusted overlays itself`() {
        assertEquals(1, tapButton(apiLevel = 36, obscured = true))
    }

    @Test
    fun `the device's own level on the host is Robolectric's API 36, which marks data and leaves touches to the platform`() {
        assertTrue(marksDataSensitive(platformApiLevel()))
        assertFalse(filtersObscuredTouches(platformApiLevel()))
    }
}
