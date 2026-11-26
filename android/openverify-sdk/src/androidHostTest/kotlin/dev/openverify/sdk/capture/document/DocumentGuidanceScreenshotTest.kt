package dev.openverify.sdk.capture.document

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
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
import org.junit.Rule
import org.junit.Test
import org.junit.experimental.categories.Category
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * C219.3, C202.3: document-guidance's goldens, from synthetic content only: a plain dark box with a
 * card outline stands for the preview (no camera frame, no document, no face). One golden per
 * guidance state in English, light, font scale 1.0, and one state in Arabic, dark, at 2.0; every
 * golden also runs the accessibility checks (`verifyGolden`).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w320dp-h400dp-xhdpi")
internal class DocumentGuidanceScreenshotTest {
    @get:Rule
    val rule = createComposeRule()

    private fun show(hint: DocumentHint?, passport: Boolean = false, appearance: Appearance = Appearance.LIGHT, locale: String? = null) {
        rule.setContent {
            OpenVerifyTheme(appearance = appearance, requestedLocale = locale) {
                Box(modifier = Modifier.fillMaxSize().background(Color(0xFF26282C))) {
                    Canvas(modifier = Modifier.fillMaxSize()) {
                        val width = size.width * 0.9f
                        val height = width / DocumentGuide.CARD_ASPECT.toFloat()
                        drawRect(Color.White, Offset((size.width - width) / 2, (size.height - height) / 2), Size(width, height), style = Stroke(6f))
                    }
                    DocumentGuidanceOverlay(hint, passport)
                }
            }
        }
    }

    @Test
    fun noHint() {
        show(null)
        rule.onRoot().verifyGolden(GoldenOwner.DOCUMENT_GUIDANCE, "document-guidance-no-hint")
    }

    @Test
    fun moveCloser() {
        show(DocumentHint.MOVE_CLOSER)
        rule.onRoot().verifyGolden(GoldenOwner.DOCUMENT_GUIDANCE, "document-guidance-move-closer")
    }

    @Test
    fun holdStill() {
        show(DocumentHint.HOLD_STILL)
        rule.onRoot().verifyGolden(GoldenOwner.DOCUMENT_GUIDANCE, "document-guidance-hold-still")
    }

    @Test
    fun tiltAway() {
        show(DocumentHint.TILT_AWAY)
        rule.onRoot().verifyGolden(GoldenOwner.DOCUMENT_GUIDANCE, "document-guidance-tilt-away")
    }

    @Test
    fun moreLight() {
        show(DocumentHint.MORE_LIGHT)
        rule.onRoot().verifyGolden(GoldenOwner.DOCUMENT_GUIDANCE, "document-guidance-more-light")
    }

    @Test
    fun fitCard() {
        show(DocumentHint.FIT_CARD)
        rule.onRoot().verifyGolden(GoldenOwner.DOCUMENT_GUIDANCE, "document-guidance-fit-card")
    }

    @Test
    fun showMrzOnAPassportPage() {
        show(DocumentHint.SHOW_MRZ, passport = true)
        rule.onRoot().verifyGolden(GoldenOwner.DOCUMENT_GUIDANCE, "document-guidance-show-mrz")
    }

    @Test
    @Config(qualifiers = "ar-w320dp-h400dp-xhdpi", fontScale = 2.0f)
    fun arabicDarkAtTwiceTheFontSize() {
        show(DocumentHint.TILT_AWAY, appearance = Appearance.DARK, locale = "ar")
        rule.onRoot().verifyGolden(GoldenOwner.DOCUMENT_GUIDANCE, "document-guidance-ar-dark-large")
    }
}
