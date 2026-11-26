package dev.openverify.sdk.capture.barcode

import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import dev.openverify.sdk.ui.OpenVerifyTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C203.3 (behaviour M26): the barcode guide over the preview, with its hint in a polite live region, so
 * a change between "fit the barcode in the box" and "barcode found" is announced once, in the SDK's
 * chosen language (C199.5: the guide is never mirrored; the text follows the layout direction).
 */
@RunWith(RobolectricTestRunner::class)
class BarcodeOverlayTest {

    @get:Rule
    val rule = createComposeRule()

    private fun show(hint: BarcodeHint, locale: String? = "en") {
        rule.setContent {
            OpenVerifyTheme(requestedLocale = locale) { BarcodeOverlay(hint, Modifier.size(320.dp, 200.dp)) }
        }
    }

    private val polite = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)

    @Test
    fun searchingAsksForTheBarcodeInsideTheGuide() {
        show(BarcodeHint.SEARCHING)
        rule.onNodeWithTag(BarcodeTags.GUIDE).assertIsDisplayed()
        rule.onNodeWithTag(BarcodeTags.HINT).assertTextEquals("Fit the barcode in the box").assert(polite)
    }

    @Test
    fun aDecodedAamvaBarcodeSaysFoundNeverReadable() {
        show(BarcodeHint.FOUND)
        rule.onNodeWithTag(BarcodeTags.GUIDE).assertIsDisplayed()
        rule.onNodeWithTag(BarcodeTags.HINT).assertTextEquals("Barcode found").assert(polite)
    }

    @Test
    fun theHintIsInTheChosenLanguage() {
        var direction: LayoutDirection? = null
        rule.setContent {
            OpenVerifyTheme(requestedLocale = "ar") {
                direction = LocalLayoutDirection.current
                BarcodeOverlay(BarcodeHint.FOUND, Modifier.size(320.dp, 200.dp))
            }
        }
        rule.onNodeWithTag(BarcodeTags.HINT).assertTextEquals("تم العثور على الرمز الشريطي")
        assertEquals(LayoutDirection.Rtl, direction)
    }

    @Test
    fun theGuidancesOverlayFollowsItsHint() {
        val aamva = "@\n\u001e\rANSI 636014100002DL00410232".encodeToByteArray()
        var decoded: ByteArray? = null
        val guidance = BarcodeGuidance(object : BarcodeReader {
            override suspend fun readPdf417(frame: AnalysisFrame): ByteArray? = decoded?.copyOf()
        })
        // A 640 x 480 upright frame can carry a read, so the guide shows from the first one (KP10-35).
        val pixels = ByteArray(640 * 480 * 4)
        rule.setContent { OpenVerifyTheme(requestedLocale = "en") { guidance.Overlay(Modifier.size(320.dp, 200.dp)) } }
        runBlocking { guidance.onFrame(AnalysisFrame(640, 480, 0, PixelLayout.RGBA_8888, pixels, 0)) }
        rule.waitForIdle()
        rule.onNodeWithTag(BarcodeTags.HINT).assertTextEquals("Fit the barcode in the box")
        decoded = aamva
        runBlocking { guidance.onFrame(AnalysisFrame(640, 480, 0, PixelLayout.RGBA_8888, pixels, 1_000_000_000)) }
        rule.waitForIdle()
        rule.onNodeWithTag(BarcodeTags.HINT).assertTextEquals("Barcode found")
    }

    @Test
    fun theGuideIsDrawnOnlyWhileAFrameCanCarryARead() {
        // KP10-35: no guide before the first frame, none on a frame too narrow for a readable symbol.
        val guidance = BarcodeGuidance(object : BarcodeReader {
            override suspend fun readPdf417(frame: AnalysisFrame): ByteArray? = null
        })
        rule.setContent { OpenVerifyTheme(requestedLocale = "en") { guidance.Overlay(Modifier.size(320.dp, 200.dp)) } }
        rule.onNodeWithTag(BarcodeTags.HINT).assertDoesNotExist()
        rule.onNodeWithTag(BarcodeTags.GUIDE).assertDoesNotExist()

        runBlocking { guidance.onFrame(AnalysisFrame(1280, 960, 90, PixelLayout.RGBA_8888, ByteArray(1280 * 960 * 4), 0)) }
        rule.waitForIdle()
        rule.onNodeWithTag(BarcodeTags.HINT).assertTextEquals("Fit the barcode in the box")

        runBlocking { guidance.onFrame(AnalysisFrame(640, 480, 90, PixelLayout.RGBA_8888, ByteArray(640 * 480 * 4), 1_000_000_000)) }
        rule.waitForIdle()
        rule.onNodeWithTag(BarcodeTags.HINT).assertDoesNotExist()
    }
}
