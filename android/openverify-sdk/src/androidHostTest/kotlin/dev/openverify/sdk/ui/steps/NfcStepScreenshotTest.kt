package dev.openverify.sdk.ui.steps

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.nfc.Dg1Details
import dev.openverify.sdk.nfc.NfcAccessKind
import dev.openverify.sdk.nfc.NfcEntryError
import dev.openverify.sdk.nfc.NfcNotice
import dev.openverify.sdk.nfc.NfcPhase
import dev.openverify.sdk.nfc.NfcUnable
import dev.openverify.sdk.nfc.NfcView
import dev.openverify.sdk.testing.GoldenOwner
import dev.openverify.sdk.testing.ScreenshotTests
import dev.openverify.sdk.testing.verifyGolden
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.RecordingActions
import dev.openverify.sdk.ui.screen.ScreenGoldens
import dev.openverify.sdk.ui.screen.ScreenGoldens.Look
import org.junit.Rule
import org.junit.Test
import org.junit.experimental.categories.Category
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * C219.3, C207.5: nfc-sdk's goldens, from synthetic content only (ICAO's Utopia specimen; no
 * portrait is ever drawn). Each state in English, light, at font scale 1.0; one state per screen in
 * Arabic, dark, at 2.0; one state per screen in an operator's palette, light and dark. Every golden
 * also runs the accessibility checks (`verifyGolden`).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w360dp-h900dp-mdpi")
internal class NfcStepScreenshotTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = object : FlowActions by RecordingActions() {}
    private val step = NfcStep("chip")
    private val tap = NfcView.Tap(NfcPhase.READY, reader = true)
    private val review = NfcView.Review(Dg1Details("ERIKSSON, ANNA MARIA", "L898902C3", "UTO", "740812", "120415"))
    private val entry = NfcView.Entry(NfcAccessKind.MRZ)
    private val off = NfcView.CannotRead(NfcUnable.NFC_DISABLED, fallback = true)

    private fun golden(name: String, view: NfcView, language: String = "en", scale: Float = 1f, look: Look = Look.BUILT_IN_LIGHT) {
        rule.setContent {
            ScreenGoldens.Golden(language, scale, look, ScreenGoldens.environment(language)) { NfcStepScreen(FlowState.Nfc(step, view), actions) }
        }
        rule.onRoot().verifyGolden(GoldenOwner.NFC_SDK, name)
    }

    // Each state, in English, light, at 1.0 -------------------------------------------------------

    @Test fun `the MRZ entry`() = golden("nfc-entry-mrz", entry)

    @Test fun `the MRZ entry the chip refused, with the test chip offered`() =
        golden("nfc-entry-mrz-refused-sandbox", NfcView.Entry(NfcAccessKind.MRZ, NfcEntryError.REFUSED_BY_CHIP, sandbox = true))

    @Test fun `the CAN entry`() = golden("nfc-entry-can", NfcView.Entry(NfcAccessKind.CAN))

    @Test fun `the tap screen at I'm ready`() = golden("nfc-tap-ready", tap.copy(editable = true))

    @Test fun `the tap screen with only the test chip`() = golden("nfc-tap-ready-sandbox", NfcView.Tap(NfcPhase.READY, reader = false, sandbox = true))

    @Test fun `the tap screen after the challenge expired`() = golden("nfc-tap-expired", tap.copy(notice = NfcNotice.CHALLENGE_EXPIRED))

    @Test fun `the tap screen waiting for the document`() = golden("nfc-tap-waiting", tap.copy(phase = NfcPhase.WAITING))

    @Test fun `the tap screen after the document moved`() = golden("nfc-tap-keep-still", tap.copy(phase = NfcPhase.WAITING, notice = NfcNotice.KEEP_STILL))

    @Test fun `the tap screen reading a file`() = golden("nfc-tap-reading", tap.copy(phase = NfcPhase.READING, file = FileKind.CHIP_DG2, percent = 60))

    @Test fun `the tap screen signing the check code`() = golden("nfc-tap-signing", tap.copy(phase = NfcPhase.SIGNING))

    @Test fun `the tap screen once read`() = golden("nfc-tap-read", tap.copy(phase = NfcPhase.READ))

    @Test fun `the DG1 review`() = golden("nfc-review", review)

    @Test fun `the DG1 review after the new read`() = golden("nfc-review-again", review.copy(again = true))

    @Test fun `the troubleshooting tips`() = golden("nfc-tips", NfcView.Tips)

    @Test fun `this app cannot read document chips`() = golden("nfc-unable-reader", NfcView.CannotRead(NfcUnable.READER_NOT_INSTALLED, fallback = true))

    @Test fun `this phone cannot read document chips`() = golden("nfc-unable-phone", NfcView.CannotRead(NfcUnable.NFC_UNAVAILABLE, fallback = false))

    @Test fun `NFC is off`() = golden("nfc-unable-off", off)

    @Test fun `the challenges are spent`() = golden("nfc-unable-spent", NfcView.CannotRead(NfcUnable.CHALLENGES_SPENT, fallback = true, busy = true))

    // One state per screen in an operator's palette, light and dark (C198.8) -------------------------

    @Test fun `the entry in an operator's light palette`() = golden("nfc-entry-mrz-operator-light", entry, look = Look.OPERATOR_LIGHT)

    @Test fun `the entry in an operator's dark palette`() = golden("nfc-entry-mrz-operator-dark", entry, look = Look.OPERATOR_DARK)

    @Test fun `the tap screen in an operator's light palette`() = golden("nfc-tap-ready-operator-light", tap, look = Look.OPERATOR_LIGHT)

    @Test fun `the tap screen in an operator's dark palette`() = golden("nfc-tap-ready-operator-dark", tap, look = Look.OPERATOR_DARK)

    @Test fun `the review in an operator's light palette`() = golden("nfc-review-operator-light", review, look = Look.OPERATOR_LIGHT)

    @Test fun `the review in an operator's dark palette`() = golden("nfc-review-operator-dark", review, look = Look.OPERATOR_DARK)

    @Test fun `the tips in an operator's light palette`() = golden("nfc-tips-operator-light", NfcView.Tips, look = Look.OPERATOR_LIGHT)

    @Test fun `the tips in an operator's dark palette`() = golden("nfc-tips-operator-dark", NfcView.Tips, look = Look.OPERATOR_DARK)

    @Test fun `NFC off in an operator's light palette`() = golden("nfc-unable-off-operator-light", off, look = Look.OPERATOR_LIGHT)

    @Test fun `NFC off in an operator's dark palette`() = golden("nfc-unable-off-operator-dark", off, look = Look.OPERATOR_DARK)
}

/**
 * C219.3: one state per screen in Arabic (right to left), dark, at font scale 2.0, on a taller
 * window so nothing is cut off.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Category(ScreenshotTests::class)
@Config(qualifiers = "w360dp-h2200dp-mdpi")
internal class NfcStepArabicScreenshotTest {

    @get:Rule
    val rule = createComposeRule()

    private val actions = object : FlowActions by RecordingActions() {}
    private val step = NfcStep("chip")

    private fun golden(name: String, view: NfcView) {
        rule.setContent {
            ScreenGoldens.Golden("ar", 2f, Look.BUILT_IN_DARK, ScreenGoldens.environment("ar")) { NfcStepScreen(FlowState.Nfc(step, view), actions) }
        }
        rule.onRoot().verifyGolden(GoldenOwner.NFC_SDK, name)
    }

    @Test fun `the MRZ entry in Arabic, dark, at twice the font size`() = golden("nfc-entry-mrz-ar-dark-2x", NfcView.Entry(NfcAccessKind.MRZ, NfcEntryError.BIRTH_DATE))

    @Test fun `the tap screen in Arabic, dark, at twice the font size`() =
        golden("nfc-tap-reading-ar-dark-2x", NfcView.Tap(NfcPhase.READING, reader = true, file = FileKind.CHIP_DG1, percent = 40))

    @Test fun `the review in Arabic, dark, at twice the font size`() =
        golden("nfc-review-ar-dark-2x", NfcView.Review(Dg1Details("ERIKSSON, ANNA MARIA", "L898902C3", "UTO", "740812", "120415")))

    @Test fun `the tips in Arabic, dark, at twice the font size`() = golden("nfc-tips-ar-dark-2x", NfcView.Tips)

    @Test fun `NFC off in Arabic, dark, at twice the font size`() = golden("nfc-unable-off-ar-dark-2x", NfcView.CannotRead(NfcUnable.NFC_DISABLED, fallback = true))
}
