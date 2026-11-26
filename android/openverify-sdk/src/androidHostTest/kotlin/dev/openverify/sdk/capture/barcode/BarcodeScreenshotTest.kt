package dev.openverify.sdk.capture.barcode

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
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
 * C219.3, C203.3: pdf417-guidance's goldens, from synthetic content only: the barcode guide and its hint
 * over a plain grey stand-in for the camera preview (no document, barcode or face). C219.3's budget:
 * each state in English, light, at font scale 1.0, and one state in Arabic, dark, at 2.0. Every golden
 * also runs the accessibility checks (`verifyGolden`).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w320dp-h240dp-xhdpi")
internal class BarcodeScreenshotTest {

    @get:Rule
    val rule = createComposeRule()

    private fun golden(name: String, hint: BarcodeHint, appearance: Appearance, locale: String) {
        rule.setContent {
            OpenVerifyTheme(appearance = appearance, requestedLocale = locale) {
                Box(Modifier.size(320.dp, 240.dp).background(PREVIEW_STAND_IN)) {
                    BarcodeOverlay(hint, Modifier.fillMaxSize())
                }
            }
        }
        rule.onRoot().verifyGolden(GoldenOwner.PDF417_GUIDANCE, name)
    }

    @Test
    fun `the guide while it searches`() = golden("barcode-guide-searching", BarcodeHint.SEARCHING, Appearance.LIGHT, "en")

    @Test
    fun `the guide once an AAMVA barcode is found`() = golden("barcode-guide-found", BarcodeHint.FOUND, Appearance.LIGHT, "en")

    @Test
    @Config(qualifiers = "w320dp-h240dp-xhdpi", fontScale = 2.0f)
    fun `the guide once found, in Arabic, dark, at twice the font size`() =
        golden("barcode-guide-found-ar-dark", BarcodeHint.FOUND, Appearance.DARK, "ar")

    private companion object {
        /** A plain mid-dark grey where the camera preview would be: synthetic, no image content. */
        val PREVIEW_STAND_IN = Color(0xFF3A3F47)
    }
}
