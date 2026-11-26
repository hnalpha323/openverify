package dev.openverify.sdk.ui.a11y

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.capture.AutoCapture
import dev.openverify.sdk.capture.CaptureGuidance
import dev.openverify.sdk.capture.CaptureGuidanceFactory
import dev.openverify.sdk.capture.barcode.BarcodeHint
import dev.openverify.sdk.capture.barcode.BarcodeOverlay
import dev.openverify.sdk.capture.document.DocumentGuidanceOverlay
import dev.openverify.sdk.capture.document.DocumentHint
import dev.openverify.sdk.capture.selfie.GuidanceMessage
import dev.openverify.sdk.capture.selfie.SelfieCaptureWindow
import dev.openverify.sdk.capture.selfie.SelfieExtensionOutcome
import dev.openverify.sdk.capture.selfie.SelfieGuidanceOverlay
import dev.openverify.sdk.capture.selfie.SelfieGuidanceView
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.OtpChannel
import dev.openverify.sdk.flow.OtpCode
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.nfc.NfcPhase
import dev.openverify.sdk.nfc.NfcView
import dev.openverify.sdk.ui.InquiryFlowScreen
import dev.openverify.sdk.ui.LocalCaptureGuidance
import dev.openverify.sdk.ui.TestTags
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * C212.2 (Workflow 10D, android-a11y-audit): capture prompts, NFC phases, the waiting screen and
 * the selfie's time warning are announced once per change, never at the rate the screen updates. Each
 * test updates one screen in place many times and counts what its live regions would have a screen
 * reader say ([Announcements]).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w360dp-h800dp-mdpi")
internal class A11yAnnouncementsTest {

    @get:Rule
    val rule = createComposeRule()

    private val stage by lazy { A11yStageDriver(rule) }
    private val heard by lazy { Announcements(stage) }

    private val selfieStep = FakeFlowApi.DEFAULT_FLOW.steps[2]
    private val idStep = FakeFlowApi.DEFAULT_FLOW.steps[1]

    /** A screen drawn from [flow], which the test changes in place. */
    private fun screen(flow: MutableState<FlowState>, manualClock: Boolean = false, arrange: (A11yFixture) -> Unit = {}) =
        A11yState(A11yScreen.STATUS, "in-place", manualClock = manualClock, arrange = arrange) { fixture ->
            InquiryFlowScreen(flow.value, fixture.camera, fixture.actions, clock = fixture.clock)
        }

    private fun <T> update(holder: MutableState<T>, value: T) {
        holder.value = value
        stage.settle()
        heard.listen()
    }

    private fun words(tag: String): String = stage.nodes(merged = true).first { it.tag == tag }.spokenWithin

    @Test
    fun `an NFC read announces each phase once, however often its progress moves`() {
        val tap = NfcView.Tap(NfcPhase.REQUESTING, reader = true)
        val flow = mutableStateOf<FlowState>(FlowState.Nfc(NfcStep("chip"), tap))
        stage.show(screen(flow))
        heard.listen()

        var updates = 0
        fun show(view: NfcView.Tap) {
            update(flow, FlowState.Nfc(NfcStep("chip"), view))
            updates++
        }
        show(tap.copy(phase = NfcPhase.WAITING))
        show(tap.copy(phase = NfcPhase.CONNECTING))
        for (file in listOf(FileKind.CHIP_COM, FileKind.CHIP_SOD, FileKind.CHIP_DG1, FileKind.CHIP_DG2)) {
            for (percent in 0..100 step 5) show(tap.copy(phase = NfcPhase.READING, file = file, percent = percent))
        }
        show(tap.copy(phase = NfcPhase.SIGNING))
        show(tap.copy(phase = NfcPhase.READ))

        assertTrue("the read was not updated often", updates > 80)
        // Requesting, waiting, connecting, reading, signing, read.
        assertEquals(heard.said.toString(), 6, heard.said.size)
        assertEquals(heard.said.distinct(), heard.said)
    }

    @Test
    fun `the waiting screen is announced once, whatever the server answers while it waits`() {
        val flow = mutableStateOf<FlowState>(FlowState.Waiting(retryAfterMs = 2_000))
        stage.show(screen(flow))
        heard.listen()

        for (poll in 1..20) update(flow, FlowState.Waiting(retryAfterMs = 1_000L + poll))

        assertEquals(heard.said.toString(), 1, heard.said.size)
        assertEquals(words(TestTags.WAITING_MESSAGE), heard.said.single())
    }

    /** A capture screen whose guidance draws what [overlay] holds. */
    private fun guided(state: FlowState.Capture, overlay: @androidx.compose.runtime.Composable (Modifier) -> Unit) =
        A11yState(A11yScreen.CAPTURE, "guided-in-place", flowState = state) { fixture ->
            val guidance = object : CaptureGuidance {
                override val shutterPrimary: StateFlow<Boolean> = MutableStateFlow(false)

                override suspend fun run(frames: Flow<AnalysisFrame>, autoCapture: AutoCapture) = Unit

                @androidx.compose.runtime.Composable
                override fun Overlay(modifier: Modifier) = overlay(modifier)

                override fun close() = Unit
            }
            CompositionLocalProvider(LocalCaptureGuidance provides CaptureGuidanceFactory { guidance }) {
                InquiryFlowScreen(state, fixture.camera, fixture.actions, clock = fixture.clock)
            }
        }

    @Test
    fun `a selfie prompt is heard once per settled change, never per frame`() {
        val view = mutableStateOf(SelfieGuidanceView(GuidanceMessage.STARTING, null, false))
        stage.show(guided(FlowState.Capture(selfieStep, FileKind.SELFIE_CENTER, 0, 3)) { SelfieGuidanceOverlay(view.value, it) })
        heard.listen()
        val before = heard.said.size

        // Eight frames a second for ten seconds: the hint on screen follows every frame.
        val flicker = listOf(GuidanceMessage.NO_FACE, GuidanceMessage.TOO_FAR, GuidanceMessage.OFF_CENTRE, GuidanceMessage.HOLD_STILL)
        repeat(40) { frame -> update(view, SelfieGuidanceView(flicker[frame % flicker.size], null, false, initial = GuidanceMessage.STARTING)) }
        val unsettled = heard.said.size - before
        repeat(40) { frame -> update(view, SelfieGuidanceView(flicker[frame % flicker.size], GuidanceMessage.TOO_FAR, false, initial = GuidanceMessage.STARTING)) }
        repeat(40) { frame -> update(view, SelfieGuidanceView(flicker[frame % flicker.size], GuidanceMessage.HOLD_STILL, false, initial = GuidanceMessage.STARTING)) }

        assertEquals("heard while nothing had settled: ${heard.said}", 0, unsettled)
        assertEquals("heard over 120 frames: ${heard.said}", 2, heard.said.size - before)
    }

    @Test
    fun `a document hint and the barcode hint are heard once per change`() {
        val hint = mutableStateOf<DocumentHint?>(null)
        val barcode = mutableStateOf(BarcodeHint.SEARCHING)
        stage.show(
            guided(FlowState.Capture(idStep, FileKind.BACK, 1, 2)) {
                Box(it) {
                    DocumentGuidanceOverlay(hint.value, passport = false)
                    BarcodeOverlay(barcode.value, Modifier.fillMaxSize())
                }
            },
        )
        heard.listen()
        val before = heard.said.size

        repeat(30) { update(hint, DocumentHint.MOVE_CLOSER) }
        repeat(30) { update(hint, DocumentHint.HOLD_STILL) }
        repeat(30) { update(barcode, BarcodeHint.FOUND) }
        repeat(30) { update(hint, null) }

        // Move closer, hold still, barcode found; the hint going away says nothing.
        assertEquals(heard.said.toString(), 3, heard.said.size - before)
    }

    @Test
    fun `the selfie's time warning says its count once while the clock runs on, and each outcome once`() {
        val flow = mutableStateOf<FlowState>(FlowState.Capture(selfieStep, FileKind.SELFIE_CENTER, 0, 3))
        val fixture = stage.show(
            screen(flow, manualClock = true) { fixture ->
                fixture.selfie.value = SelfieCaptureWindow(CAPTURE, fixture.time.markNow() + 30.seconds)
            },
        )
        heard.listen()
        val before = heard.said.size

        // Thirty seconds, read every second: the warning shows from twenty seconds left.
        repeat(25) {
            fixture.time += 1.seconds
            stage.advance(1_000)
            heard.listen()
        }
        val warned = heard.said.drop(before)
        fixture.selfie.value = fixture.selfie.value?.copy(extension = SelfieExtensionOutcome.FAILED)
        repeat(3) {
            stage.advance(1_000)
            heard.listen()
        }

        assertEquals("the warning over 25 seconds: $warned", 1, warned.size)
        assertTrue(warned.single(), warned.single().contains("20"))
        assertEquals("with the refusal: ${heard.said.drop(before)}", 2, heard.said.size - before)
    }

    @Test
    fun `a code's countdowns move every second and announce nothing`() {
        val code = OtpCode("•••• ••00", A11yCatalog.NOW + 10.minutes, A11yCatalog.NOW + 30.seconds, sendsRemaining = 4, attemptsRemaining = 5)
        val flow = mutableStateOf<FlowState>(FlowState.Otp(PhoneOtpStep("phone", listOf("US")), OtpChannel.PHONE, listOf("US"), codeLength = 6, code = code))
        val fixture = stage.show(screen(flow, manualClock = true))
        heard.listen()
        val before = heard.said.size
        val shownAtFirst = stage.nodes(merged = false).map { it.spoken }

        repeat(20) {
            fixture.now += 1.seconds
            stage.advance(1_000)
            heard.listen()
        }

        assertTrue("the countdown did not move", stage.nodes(merged = false).map { it.spoken } != shownAtFirst)
        assertEquals(heard.said.drop(before).toString(), 0, heard.said.size - before)
    }

    @Test
    fun `a capture's title is announced once per photo asked for`() {
        val front = FlowState.Capture(idStep, FileKind.FRONT, 0, 2)
        val flow = mutableStateOf<FlowState>(front)
        stage.show(screen(flow))
        heard.listen()
        val before = heard.said.size

        repeat(10) { update(flow, front.copy(retryHints = emptyList())) }
        update(flow, FlowState.Capture(idStep, FileKind.BACK, 1, 2))
        repeat(10) { update(flow, FlowState.Capture(idStep, FileKind.BACK, 1, 2)) }

        assertEquals(heard.said.drop(before).toString(), 1, heard.said.size - before)
    }

    private companion object {
        const val CAPTURE = "self_01M5CJXHG07XPHF3HRM6NREDH9"
    }
}
