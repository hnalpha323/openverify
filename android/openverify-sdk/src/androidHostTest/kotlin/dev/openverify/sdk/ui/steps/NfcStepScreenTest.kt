package dev.openverify.sdk.ui.steps

import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.SandboxChipScenario
import dev.openverify.sdk.nfc.Dg1Details
import dev.openverify.sdk.nfc.NfcAccessKind
import dev.openverify.sdk.nfc.NfcEntryError
import dev.openverify.sdk.nfc.NfcEvent
import dev.openverify.sdk.nfc.NfcNotice
import dev.openverify.sdk.nfc.NfcPhase
import dev.openverify.sdk.nfc.NfcUnable
import dev.openverify.sdk.nfc.NfcView
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.RecordingActions
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.screen.LocalPlatformApiLevel
import dev.openverify.sdk.ui.screen.ObscuredTouchesFiltered
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * C207.5, C207.9, C208.2 (Workflow 10C nfc-sdk): the NFC step's screens, state by state: what each
 * shows, the event each control sends, the tap screen's phases in a polite live region announced
 * once per change, the screen kept on, the reader's resume and pause, and C213.1's protections and
 * C195.2's keyboard and autofill flags on the MRZ and CAN entry and the DG1 review. The data shown
 * is ICAO's Utopia specimen.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h1800dp")
internal class NfcStepScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val events = mutableListOf<NfcEvent>()
    private var canceled = 0
    private val actions = object : FlowActions by RecordingActions() {
        override fun nfc(event: NfcEvent) {
            events += event
        }

        override fun cancel() {
            canceled += 1
        }
    }
    private val step = NfcStep("chip")
    private var shown by mutableStateOf<NfcView>(NfcView.Checking)
    private lateinit var view: View

    private val ready = NfcView.Tap(NfcPhase.READY, reader = true)
    private val details = Dg1Details("ERIKSSON, ANNA MARIA", "L898902C3", "UTO", "740812", "120415")

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private fun show(first: NfcView, apiLevel: Int = 36) {
        shown = first
        rule.setContent {
            view = LocalView.current
            CompositionLocalProvider(LocalPlatformApiLevel provides apiLevel) { NfcStepScreen(FlowState.Nfc(step, shown), actions) }
        }
        rule.waitForIdle()
    }

    private fun typed(): List<String> = events.filterIsInstance<NfcEvent.MrzEntered>().flatMap { listOf(it.documentNumber, it.birthDate, it.expiryDate) }

    // The access entry (C207.2) ------------------------------------------------------------------

    @Test
    fun `the MRZ entry takes the three values and sends them as typed, once all are filled`() {
        show(NfcView.Entry(NfcAccessKind.MRZ))

        rule.onNodeWithText(text(Res.string.openverify_nfc_mrz_title)).assertIsDisplayed()
        rule.onNodeWithTag(NfcStepTags.CONTINUE).assertIsNotEnabled()
        rule.onNodeWithTag(NfcStepTags.DOCUMENT_NUMBER).performTextInput("L898902C3")
        rule.onNodeWithTag(NfcStepTags.BIRTH_DATE).performTextInput("740812")
        rule.onNodeWithTag(NfcStepTags.CONTINUE).assertIsNotEnabled()
        rule.onNodeWithTag(NfcStepTags.EXPIRY_DATE).performTextInput("120415")
        rule.onNodeWithTag(NfcStepTags.CONTINUE).assertIsEnabled().performClick()

        assertEquals(listOf("L898902C3", "740812", "120415"), typed())

        rule.onNodeWithTag(NfcStepTags.SWITCH_ACCESS).performScrollTo().performClick()
        assertEquals(NfcEvent.ChooseAccess(NfcAccessKind.CAN), events.last())
        rule.onNodeWithText(text(Res.string.openverify_cancel)).performScrollTo().performClick()
        assertEquals(1, canceled)
    }

    @Test
    fun `the CAN entry takes six digits and can go back to the document details`() {
        show(NfcView.Entry(NfcAccessKind.CAN))

        rule.onNodeWithText(text(Res.string.openverify_nfc_can_title)).assertIsDisplayed()
        rule.onNodeWithTag(NfcStepTags.CAN).performTextInput("123456")
        rule.onNodeWithTag(NfcStepTags.CONTINUE).performClick()

        assertEquals("123456", (events.single() as NfcEvent.CanEntered).can)
        rule.onNodeWithTag(NfcStepTags.SWITCH_ACCESS).performScrollTo().performClick()
        assertEquals(NfcEvent.ChooseAccess(NfcAccessKind.MRZ), events.last())
    }

    @Test
    fun `each entry error has its own words, in a live region`() {
        val words = mapOf(
            NfcEntryError.DOCUMENT_NUMBER to Res.string.openverify_nfc_error_document_number,
            NfcEntryError.BIRTH_DATE to Res.string.openverify_nfc_error_birth_date,
            NfcEntryError.EXPIRY_DATE to Res.string.openverify_nfc_error_expiry_date,
            NfcEntryError.CAN to Res.string.openverify_nfc_error_can,
            NfcEntryError.REFUSED_BY_CHIP to Res.string.openverify_nfc_error_refused,
        )
        assertEquals(NfcEntryError.entries.toSet(), words.keys)
        show(NfcView.Entry(NfcAccessKind.MRZ))

        words.forEach { (error, res) ->
            shown = NfcView.Entry(if (error == NfcEntryError.CAN) NfcAccessKind.CAN else NfcAccessKind.MRZ, error)
            rule.onNodeWithText(text(res)).performScrollTo()
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
        }
    }

    @Test
    fun `the previous attempt's hints and the sandbox test chip are shown on the entry when the state has them`() {
        show(NfcView.Entry(NfcAccessKind.MRZ, hints = listOf(RetryHint("chip")), sandbox = true))

        rule.onNodeWithText(text(Res.string.openverify_retry_title_attempt)).assertIsDisplayed()
        rule.onNodeWithTag(NfcStepTags.SANDBOX_LABEL).performScrollTo().assertTextEquals("Test chip (sandbox)")
        rule.onNodeWithTag(NfcStepTags.SANDBOX).performScrollTo().performClick()
        assertEquals(NfcEvent.Ready(SandboxChipScenario.MATCH), events.last())
    }

    // C195.2: secrets on a plain keyboard, with no autofill content type ---------------------------

    @Test
    fun `the document number is a secret on a plain text keyboard with autocorrect off and no autofill content type`() {
        show(NfcView.Entry(NfcAccessKind.MRZ))

        rule.onNodeWithTag(NfcStepTags.DOCUMENT_NUMBER).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentType)).performClick()
        val info = rule.runOnIdle { EditorInfo().also { view.onCreateInputConnection(it) } }

        // Not the password variation: Compose 1.11 would declare ContentType.Password for it (FieldInput.kt).
        assertEquals(InputType.TYPE_CLASS_TEXT, info.inputType and (InputType.TYPE_MASK_CLASS or InputType.TYPE_MASK_VARIATION))
        assertEquals(0, info.inputType and InputType.TYPE_TEXT_FLAG_AUTO_CORRECT)
    }

    @Test
    fun `the dates and the CAN are secrets on a plain number keyboard with no autofill content type`() {
        show(NfcView.Entry(NfcAccessKind.MRZ))
        for (tag in listOf(NfcStepTags.BIRTH_DATE, NfcStepTags.EXPIRY_DATE)) {
            rule.onNodeWithTag(tag).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentType)).performClick()
            assertEquals(InputType.TYPE_CLASS_NUMBER, rule.runOnIdle { EditorInfo().also { view.onCreateInputConnection(it) } }.inputType)
        }

        shown = NfcView.Entry(NfcAccessKind.CAN)
        rule.onNodeWithTag(NfcStepTags.CAN).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentType)).performClick()
        assertEquals(InputType.TYPE_CLASS_NUMBER, rule.runOnIdle { EditorInfo().also { view.onCreateInputConnection(it) } }.inputType)
    }

    // C213.1: the protections, per API level --------------------------------------------------------

    @Test
    fun `on API 34 the MRZ and CAN fields and the DG1 review are accessibility-data-sensitive`() {
        show(NfcView.Entry(NfcAccessKind.MRZ), apiLevel = 34)
        listOf(NfcStepTags.DOCUMENT_NUMBER, NfcStepTags.BIRTH_DATE, NfcStepTags.EXPIRY_DATE).forEach { rule.onNodeWithTag(it).assert(SensitiveData) }

        shown = NfcView.Entry(NfcAccessKind.CAN)
        rule.onNodeWithTag(NfcStepTags.CAN).assert(SensitiveData)

        shown = NfcView.Review(details)
        rule.onNodeWithTag(NfcStepTags.REVIEW).assert(SensitiveData)
    }

    @Test
    fun `on API 33 nothing is marked data-sensitive, since the platform has no such mark`() {
        show(NfcView.Entry(NfcAccessKind.MRZ), apiLevel = 33)
        rule.onNodeWithTag(NfcStepTags.DOCUMENT_NUMBER).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.IsSensitiveData))

        shown = NfcView.Review(details)
        rule.onNodeWithTag(NfcStepTags.REVIEW).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.IsSensitiveData))
    }

    @Test
    fun `on API 28 the entry's and the review's controls drop touches that came through another window`() {
        show(NfcView.Entry(NfcAccessKind.MRZ, sandbox = true), apiLevel = 28)
        listOf(NfcStepTags.CONTINUE, NfcStepTags.SWITCH_ACCESS, NfcStepTags.SANDBOX).forEach { rule.onNodeWithTag(it).assert(Filtered) }

        shown = NfcView.Entry(NfcAccessKind.CAN)
        rule.onNodeWithTag(NfcStepTags.CONTINUE).assert(Filtered)

        shown = NfcView.Review(details)
        listOf(NfcStepTags.CONFIRM, NfcStepTags.REFUSE).forEach { rule.onNodeWithTag(it).assert(Filtered) }

        shown = ready
        rule.onNodeWithTag(NfcStepTags.READY).assert(Filtered)
    }

    @Test
    fun `on API 31 the platform blocks such touches itself, so the controls carry no filter`() {
        show(NfcView.Entry(NfcAccessKind.MRZ), apiLevel = 31)
        rule.onNodeWithTag(NfcStepTags.CONTINUE).assert(SemanticsMatcher.keyNotDefined(ObscuredTouchesFiltered))

        shown = NfcView.Review(details)
        rule.onNodeWithTag(NfcStepTags.CONFIRM).assert(SemanticsMatcher.keyNotDefined(ObscuredTouchesFiltered))
    }

    // The tap screen (C207.2, C207.5, C201.5) ---------------------------------------------------------

    @Test
    fun `the tap screen shows the hint for passports and for cards and sends I'm ready`() {
        show(ready)

        rule.onNodeWithText(text(Res.string.openverify_nfc_tap_title)).assertIsDisplayed()
        rule.onNodeWithText(text(Res.string.openverify_nfc_tap_hint_passport)).assertIsDisplayed()
        rule.onNodeWithText(text(Res.string.openverify_nfc_tap_hint_card)).assertIsDisplayed()
        rule.onAllNodesWithTag(NfcStepTags.CHANGE_DETAILS).assertCountEquals(0)
        rule.onAllNodesWithTag(NfcStepTags.SANDBOX).assertCountEquals(0)
        rule.onNodeWithTag(NfcStepTags.READY).assertTextEquals(text(Res.string.openverify_nfc_ready)).performClick()

        assertEquals(NfcEvent.Ready(), events.last())
    }

    @Test
    fun `typed details can be changed, and the sandbox test chip is labelled and reads its chosen scenario`() {
        show(ready.copy(editable = true, sandbox = true))

        rule.onNodeWithTag(NfcStepTags.CHANGE_DETAILS).performScrollTo().performClick()
        assertEquals(NfcEvent.ChooseAccess(NfcAccessKind.MRZ), events.last())

        rule.onNodeWithTag(NfcStepTags.SANDBOX_LABEL).performScrollTo().assertTextEquals("Test chip (sandbox)")
        rule.onNodeWithTag(NfcStepTags.SANDBOX_SCENARIO).performScrollTo().performClick()
        rule.onNodeWithTag(TestTags.option("tampered-dg1")).performClick()
        rule.onNodeWithTag(NfcStepTags.SANDBOX).performScrollTo().performClick()
        assertEquals(NfcEvent.Ready(SandboxChipScenario.TAMPERED_DG1), events.last())
    }

    @Test
    fun `without an installed reader the tap screen offers the test chip alone`() {
        show(NfcView.Tap(NfcPhase.READY, reader = false, sandbox = true))

        rule.onAllNodesWithTag(NfcStepTags.READY).assertCountEquals(0)
        rule.onNodeWithTag(NfcStepTags.SANDBOX).assertIsDisplayed()
    }

    @Test
    fun `the tap screen keeps the screen on, and releases it when the step moves on (C201_5)`() {
        show(ready.copy(phase = NfcPhase.WAITING))
        assertTrue(view.keepScreenOn)

        shown = NfcView.Review(details)
        rule.waitForIdle()

        assertFalse(view.keepScreenOn)
    }

    @Test
    fun `the reader is told when the tap screen is resumed and when it is left`() {
        show(ready)
        assertEquals(listOf<NfcEvent>(NfcEvent.Resumed), events)

        shown = NfcView.Review(details)
        rule.waitForIdle()

        assertEquals(listOf(NfcEvent.Resumed, NfcEvent.Paused), events)
    }

    @Test
    fun `each phase has its words in a polite live region, announced once per change and never per file or percent`() {
        val words = mapOf(
            NfcPhase.REQUESTING to Res.string.openverify_nfc_phase_requesting,
            NfcPhase.WAITING to Res.string.openverify_nfc_phase_waiting,
            NfcPhase.CONNECTING to Res.string.openverify_nfc_phase_connecting,
            NfcPhase.READING to Res.string.openverify_nfc_phase_reading,
            NfcPhase.SIGNING to Res.string.openverify_nfc_phase_signing,
            NfcPhase.READ to Res.string.openverify_nfc_phase_read,
        )
        val read = listOf(
            ready.copy(phase = NfcPhase.REQUESTING),
            ready.copy(phase = NfcPhase.WAITING),
            ready.copy(phase = NfcPhase.CONNECTING),
            ready.copy(phase = NfcPhase.READING, file = FileKind.CHIP_SOD, percent = 40),
            ready.copy(phase = NfcPhase.READING, file = FileKind.CHIP_SOD, percent = 100),
            ready.copy(phase = NfcPhase.READING, file = FileKind.CHIP_DG1, percent = 50),
            ready.copy(phase = NfcPhase.READING, file = FileKind.CHIP_DG2, percent = 10),
            ready.copy(phase = NfcPhase.READING, file = FileKind.CHIP_DG2, percent = 90),
            ready.copy(phase = NfcPhase.SIGNING),
            ready.copy(phase = NfcPhase.READ),
        )
        show(ready)
        rule.onAllNodesWithTag(NfcStepTags.PHASE).assertCountEquals(0)

        val announced = mutableListOf<String>()
        for (state in read) {
            shown = state
            rule.waitForIdle()
            val node = rule.onNodeWithTag(NfcStepTags.PHASE).assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
            node.assertTextEquals(text(words.getValue(state.phase)))
            // What a screen reader announces: the live region's text, when it changes.
            val said = node.fetchSemanticsNode().config[SemanticsProperties.Text].joinToString { it.text }
            if (announced.lastOrNull() != said) announced += said
            if (state.phase == NfcPhase.READING) {
                rule.onNodeWithTag(NfcStepTags.FILE).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.LiveRegion))
                rule.onNodeWithTag(NfcStepTags.PROGRESS).assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.LiveRegion))
            }
        }

        assertEquals(NfcPhase.entries.toSet() - NfcPhase.READY, words.keys)
        assertEquals(6, announced.size)
    }

    @Test
    fun `the file being read is named and its progress drawn`() {
        show(ready.copy(phase = NfcPhase.READING, file = FileKind.CHIP_DG1, percent = 50))

        rule.onNodeWithTag(NfcStepTags.FILE).assertTextEquals(text(Res.string.openverify_nfc_file_details))
        val progress = rule.onNodeWithTag(NfcStepTags.PROGRESS).fetchSemanticsNode().config[SemanticsProperties.ProgressBarRangeInfo]
        assertEquals(0.5f, progress.current, 0.001f)
    }

    @Test
    fun `each notice has its own words, in a live region`() {
        val words = mapOf(
            NfcNotice.CHALLENGE_EXPIRED to Res.string.openverify_nfc_notice_expired,
            NfcNotice.KEEP_STILL to Res.string.openverify_nfc_notice_keep_still,
            NfcNotice.LIFTED to Res.string.openverify_nfc_notice_lifted,
            NfcNotice.UNSUPPORTED_DOCUMENT to Res.string.openverify_nfc_notice_unsupported,
            NfcNotice.TIMEOUT to Res.string.openverify_nfc_notice_timeout,
            NfcNotice.READER_BUSY to Res.string.openverify_nfc_notice_busy,
            NfcNotice.READ_FAILED to Res.string.openverify_nfc_notice_failed,
            NfcNotice.ONE_MORE_TAP to Res.string.openverify_nfc_notice_one_more_tap,
            NfcNotice.READING_AGAIN to Res.string.openverify_nfc_notice_again,
        )
        assertEquals(NfcNotice.entries.toSet(), words.keys)
        show(ready)

        words.forEach { (notice, res) ->
            shown = ready.copy(phase = if (notice == NfcNotice.KEEP_STILL || notice == NfcNotice.READING_AGAIN) NfcPhase.WAITING else NfcPhase.READY, notice = notice)
            rule.onNodeWithTag(NfcStepTags.NOTICE).assertTextEquals(text(res))
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
        }
    }

    @Test
    fun `a read can be stopped while it runs, and nothing marks success before the server decides`() {
        show(ready.copy(phase = NfcPhase.WAITING))
        rule.onNodeWithTag(NfcStepTags.STOP).performScrollTo().performClick()
        assertEquals(NfcEvent.StopRead, events.last())

        shown = ready.copy(phase = NfcPhase.READ)
        rule.waitForIdle()
        rule.onAllNodesWithTag(NfcStepTags.STOP).assertCountEquals(0)
        // No image, icon or check mark on the "read" phase (C207.5): the server has not decided.
        rule.onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Image)).assertCountEquals(0)
        rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ContentDescription)).assertCountEquals(0)
    }

    // The DG1 review (C207.5) --------------------------------------------------------------------------

    @Test
    fun `the review shows what DG1 says and no portrait, and confirming sends it`() {
        show(NfcView.Review(details))

        listOf("ERIKSSON, ANNA MARIA", "L898902C3", "UTO", "74-08-12", "12-04-15").forEach { rule.onNodeWithText(it).assertIsDisplayed() }
        rule.onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Image)).assertCountEquals(0)
        rule.onAllNodesWithTag(TestTags.REVIEW_PHOTO).assertCountEquals(0)
        rule.onNodeWithTag(NfcStepTags.CONFIRM).performScrollTo().performClick()

        assertEquals(NfcEvent.ReviewConfirmed, events.last())
        assertEquals(0, canceled)
    }

    @Test
    fun `this is not my data asks for the new read the first time, and the second time also cancels`() {
        show(NfcView.Review(details))
        rule.onNodeWithTag(NfcStepTags.REFUSE).performScrollTo().performClick()
        assertEquals(NfcEvent.ReviewRefused, events.last())
        assertEquals(0, canceled)

        shown = NfcView.Review(details, again = true)
        rule.onNodeWithText(text(Res.string.openverify_nfc_review_again)).assertIsDisplayed()
        rule.onNodeWithTag(NfcStepTags.REFUSE).performScrollTo().performClick()

        assertEquals(2, events.count { it == NfcEvent.ReviewRefused })
        assertEquals(1, canceled)
    }

    // The tips and the "cannot read document chips" screens (C207.5, C207.9) ---------------------------

    @Test
    fun `the tips offer another try or continuing later`() {
        show(NfcView.Tips)

        listOf(
            Res.string.openverify_nfc_tips_title, Res.string.openverify_nfc_tip_cover, Res.string.openverify_nfc_tip_case,
            Res.string.openverify_nfc_tip_move, Res.string.openverify_nfc_tip_still,
        ).forEach { rule.onNodeWithText(text(it)).assertIsDisplayed() }
        rule.onNodeWithTag(NfcStepTags.TRY_AGAIN).performClick()
        assertEquals(NfcEvent.TryAgain, events.last())
        rule.onNodeWithTag(NfcStepTags.CONTINUE_LATER).performClick()
        assertEquals(1, canceled)
    }

    @Test
    fun `each reason the device cannot read has its own message`() {
        val titles = mapOf(
            NfcUnable.READER_NOT_INSTALLED to Res.string.openverify_nfc_unable_reader_title,
            NfcUnable.NFC_UNAVAILABLE to Res.string.openverify_nfc_unable_phone_title,
            NfcUnable.NFC_DISABLED to Res.string.openverify_nfc_unable_off_title,
            NfcUnable.CHALLENGES_SPENT to Res.string.openverify_nfc_unable_spent_title,
        )
        assertEquals(NfcUnable.entries.toSet(), titles.keys)
        show(NfcView.CannotRead(NfcUnable.READER_NOT_INSTALLED, fallback = false))

        titles.forEach { (reason, res) ->
            shown = NfcView.CannotRead(reason, fallback = false)
            rule.onNodeWithText(text(res)).assertIsDisplayed()
        }
        assertEquals("This app cannot read document chips", text(Res.string.openverify_nfc_unable_reader_title))
        assertEquals("This phone cannot read document chips", text(Res.string.openverify_nfc_unable_phone_title))
    }

    @Test
    fun `use another way is offered only with a fallback, and never says where it leads`() {
        show(NfcView.CannotRead(NfcUnable.READER_NOT_INSTALLED, fallback = false))
        rule.onAllNodesWithTag(NfcStepTags.ANOTHER_WAY).assertCountEquals(0)
        rule.onNodeWithText(text(Res.string.openverify_nfc_later_note)).assertIsDisplayed()
        rule.onNodeWithTag(NfcStepTags.CONTINUE_LATER).performClick()
        assertEquals(1, canceled)

        shown = NfcView.CannotRead(NfcUnable.READER_NOT_INSTALLED, fallback = true)
        rule.onNodeWithText(text(Res.string.openverify_nfc_fallback_note)).assertIsDisplayed()
        rule.onNodeWithTag(NfcStepTags.ANOTHER_WAY).performClick()
        assertEquals(NfcEvent.UseAnotherWay, events.last())

        shown = NfcView.CannotRead(NfcUnable.READER_NOT_INSTALLED, fallback = true, busy = true)
        rule.onNodeWithTag(NfcStepTags.ANOTHER_WAY).assertIsNotEnabled()
        rule.onNodeWithText(text(Res.string.openverify_nfc_sending)).assertIsDisplayed()
    }

    @Test
    fun `with NFC off the screen opens the settings, reads the phone again on return, and offers the rest`() {
        show(NfcView.CannotRead(NfcUnable.NFC_DISABLED, fallback = true, sandbox = true))
        // Shown while resumed (also after the person comes back from the settings): the phone is read again.
        assertEquals(listOf<NfcEvent>(NfcEvent.Recheck), events)

        rule.onNodeWithTag(NfcStepTags.OPEN_SETTINGS).performClick()
        assertEquals(NfcEvent.OpenNfcSettings, events.last())
        rule.onNodeWithTag(NfcStepTags.RECHECK).performClick()
        assertEquals(2, events.count { it == NfcEvent.Recheck })
        rule.onNodeWithTag(NfcStepTags.ANOTHER_WAY).performScrollTo().assertIsEnabled()
        rule.onNodeWithTag(NfcStepTags.SANDBOX).performScrollTo().assertIsDisplayed()

        shown = NfcView.CannotRead(NfcUnable.NFC_UNAVAILABLE, fallback = false)
        rule.onAllNodesWithTag(NfcStepTags.OPEN_SETTINGS).assertCountEquals(0)
    }

    @Test
    fun `the checking screen asks once for the server's decision`() {
        show(NfcView.Checking)

        assertEquals(listOf<NfcEvent>(NfcEvent.Check), events)
        rule.onNodeWithText(text(Res.string.openverify_processing_message)).assertIsDisplayed()
    }

    private companion object {
        val SensitiveData = SemanticsMatcher.expectValue(SemanticsProperties.IsSensitiveData, true)
        val Filtered = SemanticsMatcher.expectValue(ObscuredTouchesFiltered, true)
    }
}
