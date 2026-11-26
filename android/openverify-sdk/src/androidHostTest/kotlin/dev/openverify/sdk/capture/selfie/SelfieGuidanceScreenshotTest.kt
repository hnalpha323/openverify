package dev.openverify.sdk.capture.selfie

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import dev.openverify.sdk.Appearance
import dev.openverify.sdk.testing.GoldenOwner
import dev.openverify.sdk.testing.ScreenshotTests
import dev.openverify.sdk.testing.verifyGolden
import dev.openverify.sdk.ui.OpenVerifyTheme
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TestTimeSource
import org.junit.Rule
import org.junit.Test
import org.junit.experimental.categories.Category
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * C219.3, C204.3, C204.5: selfie-guidance's goldens, from synthetic content only: a plain dark box with
 * an oval outline stands for the preview (no camera frame, no face, rule 3). Three hint states and two of
 * the time-limit warning's in English, light, font scale 1.0, and the warning in Arabic, dark, at 2.0;
 * every golden also runs the accessibility checks (`verifyGolden`).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w320dp-h400dp-xhdpi")
internal class SelfieGuidanceScreenshotTest {
    @get:Rule
    val rule = createComposeRule()

    @Composable
    private fun preview(content: @Composable () -> Unit) {
        Box(modifier = Modifier.fillMaxSize().background(Color(0xFF26282C))) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val width = size.width * 0.62f
                val height = width / 0.78f
                drawOval(Color.White, Offset((size.width - width) / 2, (size.height - height) / 2), Size(width, height), style = Stroke(6f))
            }
            content()
        }
    }

    private fun showHint(message: GuidanceMessage) {
        rule.setContent {
            OpenVerifyTheme(appearance = Appearance.LIGHT, requestedLocale = "en") {
                preview { SelfieGuidanceOverlay(SelfieGuidanceView(message, null, false)) }
            }
        }
    }

    private fun showWarning(outcome: SelfieExtensionOutcome?, appearance: Appearance = Appearance.LIGHT, locale: String = "en") {
        val window = SelfieCaptureWindow(CAPTURE, TestTimeSource().markNow() + 18.seconds, extension = outcome)
        // The warning reads the clock once a second, for ever: the test clock moves only when told.
        rule.mainClock.autoAdvance = false
        rule.setContent {
            OpenVerifyTheme(appearance = appearance, requestedLocale = locale) {
                preview { SelfieCaptureExtension(window, onExtend = {}) }
            }
        }
        rule.mainClock.advanceTimeBy(100)
        rule.waitForIdle()
    }

    @Test
    fun holdStill() {
        showHint(GuidanceMessage.HOLD_STILL)
        rule.onRoot().verifyGolden(GoldenOwner.SELFIE_GUIDANCE, "selfie-guidance-hold-still")
    }

    @Test
    fun turnLeft() {
        showHint(GuidanceMessage.TURN_LEFT)
        rule.onRoot().verifyGolden(GoldenOwner.SELFIE_GUIDANCE, "selfie-guidance-turn-left")
    }

    @Test
    fun manual() {
        showHint(GuidanceMessage.MANUAL)
        rule.onRoot().verifyGolden(GoldenOwner.SELFIE_GUIDANCE, "selfie-guidance-manual")
    }

    @Test
    fun timeWarning() {
        showWarning(outcome = null)
        rule.onRoot().verifyGolden(GoldenOwner.SELFIE_GUIDANCE, "selfie-guidance-time-warning")
    }

    @Test
    fun moreTimeFailed() {
        showWarning(outcome = SelfieExtensionOutcome.FAILED)
        rule.onRoot().verifyGolden(GoldenOwner.SELFIE_GUIDANCE, "selfie-guidance-more-time-failed")
    }

    @Test
    @Config(qualifiers = "ar-w320dp-h400dp-xhdpi", fontScale = 2.0f)
    fun arabicDarkAtTwiceTheFontSize() {
        showWarning(outcome = null, appearance = Appearance.DARK, locale = "ar")
        rule.onRoot().verifyGolden(GoldenOwner.SELFIE_GUIDANCE, "selfie-guidance-ar-dark-large")
    }

    private companion object {
        const val CAPTURE = "self_01M5CJXHG07XPHF3HRM6NREDH9"
    }
}
