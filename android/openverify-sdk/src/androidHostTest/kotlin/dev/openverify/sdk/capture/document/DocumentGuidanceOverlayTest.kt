package dev.openverify.sdk.capture.document

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import dev.openverify.sdk.ui.OpenVerifyTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C202.3, C212.2: the overlay shows the guidance's one hint in a polite live region that stays in
 * place, so a screen reader hears each change once; the note says the photo is taken by itself and
 * can be taken by hand at any time. The words are the SDK's own (strings_document.xml).
 */
@RunWith(RobolectricTestRunner::class)
internal class DocumentGuidanceOverlayTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun eachHintIsShownInOnePoliteLiveRegionThatStaysInPlace() {
        var hint by mutableStateOf<DocumentHint?>(null)
        rule.setContent { OpenVerifyTheme { DocumentGuidanceOverlay(hint, passport = false) } }
        val region = rule.onNodeWithTag(DocumentGuidanceTags.HINT)
        region.assertTextEquals("")
        val expected = mapOf(
            DocumentHint.MOVE_CLOSER to "Move closer",
            DocumentHint.HOLD_STILL to "Hold still",
            DocumentHint.TILT_AWAY to "Tilt away from the light",
            DocumentHint.MORE_LIGHT to "Find more light",
            DocumentHint.FIT_CARD to "Fit the card in the frame",
            DocumentHint.SHOW_MRZ to "Show the lines of code at the bottom of the page",
        )
        for ((shown, words) in expected) {
            hint = shown
            rule.waitForIdle()
            region.assertTextEquals(words)
            assertEquals(LiveRegionMode.Polite, region.fetchSemanticsNode().config.getOrNull(SemanticsProperties.LiveRegion))
        }
        hint = null
        rule.waitForIdle()
        region.assertTextEquals("")
    }

    @Test
    fun aPassportPageIsFittedAsAPage() {
        rule.setContent { OpenVerifyTheme { DocumentGuidanceOverlay(DocumentHint.FIT_CARD, passport = true) } }
        rule.onNodeWithTag(DocumentGuidanceTags.HINT).assertTextEquals("Fit the page in the frame")
    }

    @Test
    fun theNoteSaysThePhotoIsTakenByItselfAndTheShutterStillWorks() {
        rule.setContent { OpenVerifyTheme { DocumentGuidanceOverlay(null, passport = false) } }
        rule.onNodeWithTag(DocumentGuidanceTags.NOTE)
            .assertTextEquals("The photo is taken by itself when your ID is clear. You can also take it yourself at any time.")
    }

    @Test
    fun theGuidancesOverlayShowsItsCurrentHint() {
        val guidance = DocumentGuidance(passport = false, aspect = DocumentGuide.CARD_ASPECT)
        rule.setContent { OpenVerifyTheme { guidance.Overlay(androidx.compose.ui.Modifier) } }
        rule.onNodeWithTag(DocumentGuidanceTags.HINT).assertTextEquals("")
        guidance.close()
    }
}
