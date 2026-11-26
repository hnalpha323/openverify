package dev.openverify.sdk.ui.a11y

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.CameraCaptureException
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
import dev.openverify.sdk.flow.CryptoChallenge
import dev.openverify.sdk.flow.CryptoError
import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FlowError
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.OtpChannel
import dev.openverify.sdk.flow.OtpCode
import dev.openverify.sdk.flow.OtpError
import dev.openverify.sdk.flow.PickedDocument
import dev.openverify.sdk.flow.ServerPosition
import dev.openverify.sdk.flow.SessionEndReason
import dev.openverify.sdk.model.AamvaSource
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.BusinessWebsiteStep
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CompletionStep
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.CryptoSigningMethod
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.DatabaseBusinessStep
import dev.openverify.sdk.model.DatabaseField
import dev.openverify.sdk.model.DatabaseStep
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentFile
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.FailureStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowContestRoute
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.InputProblem
import dev.openverify.sdk.model.InquiryStatus
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.nfc.Dg1Details
import dev.openverify.sdk.nfc.NfcAccessKind
import dev.openverify.sdk.nfc.NfcEntryError
import dev.openverify.sdk.nfc.NfcNotice
import dev.openverify.sdk.nfc.NfcPhase
import dev.openverify.sdk.nfc.NfcUnable
import dev.openverify.sdk.nfc.NfcView
import dev.openverify.sdk.ui.CameraPermission
import dev.openverify.sdk.ui.CameraPermissionGate
import dev.openverify.sdk.ui.DocumentPick
import dev.openverify.sdk.ui.DocumentPicker
import dev.openverify.sdk.ui.FakePhotoPicker
import dev.openverify.sdk.ui.InquiryFlowScreen
import dev.openverify.sdk.ui.LocalCaptureGuidance
import dev.openverify.sdk.ui.TestTags
import dev.openverify.sdk.ui.help.ChromeTags
import dev.openverify.sdk.ui.screen.ScreenGoldens
import dev.openverify.sdk.ui.screen.ScreenTags
import dev.openverify.sdk.ui.testJpeg
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * C212.1, C212.2 (Workflow 10D, android-a11y-audit): the inventory of the SDK's screens and states,
 * as code. Every accessibility test of this package runs over [A11yCatalog.STATES], the audit
 * document's table is printed from it, and `A11yInventoryTest` fails when a state has no golden, when
 * a golden on disk belongs to no state, or when a `FlowState`, an NFC view or a message the screens
 * can show has no entry. Synthetic content only (rule 9: no face, no real person).
 */
internal enum class A11yScreen(internal val title: String) {
    CHROME("The chrome: brand header, sandbox banner, help slot, language selector"),
    STATUS("Loading and processing"),
    CONSENT("Consent"),
    CAMERA_PERMISSION("Camera permission"),
    CAPTURE("Capture: the preview with its guide and the shutter"),
    CAPTURE_REVIEW("Capture: the photo's review"),
    DOCUMENT_GUIDANCE("Capture guidance: an ID's side"),
    BARCODE_GUIDANCE("Capture guidance: the PDF417 side"),
    SELFIE_GUIDANCE("Capture guidance: a selfie pose, and the 2.2.1 time warning"),
    OTP("Phone and email codes"),
    FORM("Entered values: database, AAMVA, business registry, website"),
    DOCUMENT("Supporting document"),
    WALLET("Crypto wallet"),
    SCREEN("The screen step and its components"),
    NFC("NFC: access entry, tap, progress, review, tips, cannot read"),
    SHARE_CONSENT("Share consent: the server's text, the biometric box, the choice"),
    WAITING("Waiting for the server"),
    COMPLETION("Completion (final)"),
    FAILURE("Failure with the contest route (final)"),
    CLOSED("Expired, session ended, redacted, link refused, halted, unsupported"),
    ERROR("Error with retry"),
}

/** What a state is drawn with: the fakes its content reads. */
internal class A11yFixture {
    val recording = dev.openverify.sdk.ui.RecordingActions()
    val selfie = MutableStateFlow<SelfieCaptureWindow?>(null)

    /** C237.6 (Workflow 11A, clients-connect): the withdrawals the scaffold offers under every screen. */
    val shareConsents = MutableStateFlow(dev.openverify.sdk.flow.ShareConsentWithdrawals.NONE)
    val actions: dev.openverify.sdk.ui.FlowActions = object : dev.openverify.sdk.ui.FlowActions by recording {
        override val selfieCapture: StateFlow<SelfieCaptureWindow?> get() = selfie
        override val shareConsentWithdrawals: StateFlow<dev.openverify.sdk.flow.ShareConsentWithdrawals> get() = shareConsents
    }
    val camera = dev.openverify.sdk.ui.FakeCaptureCamera()
    /** The wall clock the countdowns read; it moves only when a test moves it. */
    var now: kotlin.time.Instant = A11yCatalog.NOW
    val clock: kotlin.time.Clock = object : kotlin.time.Clock {
        override fun now(): kotlin.time.Instant = this@A11yFixture.now
    }
    val time = kotlin.time.TestTimeSource()
}

/**
 * One state of one screen. [goldens] are its goldens of C219.3's budget as `<owner folder>/<name>`;
 * a state with none names in [variantOf] the state whose layout it shares (the same screen with
 * another message), which carries the golden. [announced] are the test tags of its status nodes,
 * each of which must be a live region that carries text. [partial] marks a part shown inside a
 * capture screen, [popup] a state with a menu open; [arrange] runs before the content is drawn and
 * [act] after it.
 */
internal class A11yState(
    val screen: A11yScreen,
    val name: String,
    val goldens: List<String> = emptyList(),
    val variantOf: String? = null,
    val announced: List<String> = emptyList(),
    val contestRoute: FlowContestRoute? = null,
    val popup: Boolean = false,
    /** The state reads a clock for ever (the selfie's time warning), so the test clock is moved by hand. */
    val manualClock: Boolean = false,
    /** The flow state the screen is drawn from; null for a part drawn alone (the camera permission). */
    val flowState: FlowState? = null,
    /** What else the state shows that the inventory counts: a guidance hint, a time warning's outcome, a permission's state. */
    val shows: List<Any> = emptyList(),
    val arrange: (A11yFixture) -> Unit = {},
    val act: (ComposeContentTestRule.() -> Unit)? = null,
    val content: @Composable (A11yFixture) -> Unit,
) {
    override fun toString(): String = name
}

/** A guidance that shows [overlay] and never reads a frame. */
private class ShownGuidance(primary: Boolean, private val overlay: @Composable (Modifier) -> Unit) : CaptureGuidance {
    override val shutterPrimary: StateFlow<Boolean> = MutableStateFlow(primary)

    override suspend fun run(frames: Flow<AnalysisFrame>, autoCapture: AutoCapture) = Unit

    @Composable
    override fun Overlay(modifier: Modifier) = overlay(modifier)

    override fun close() = Unit
}

private class FixedPermission(override val available: Boolean, override val granted: Boolean, override val denied: Boolean) : CameraPermission {
    override fun request() = Unit

    override fun openSettings() = Unit
}

private object NoPicker : DocumentPicker {
    @Composable
    override fun rememberLauncher(onPicked: (DocumentPick) -> Unit): (List<String>) -> Unit = {}
}

internal object A11yCatalog {

    internal val NOW: kotlin.time.Instant = kotlin.time.Instant.parse("2026-10-20T12:00:30Z")

    private const val SELFIE_CAPTURE = "self_01M5CJXHG07XPHF3HRM6NREDH9"
    private const val EVM = "eip155:1"
    private const val SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
    private const val ADDRESS = "0x000000000000000000000000000000000000dEaD"

    private val idStep = FakeFlowApi.DEFAULT_FLOW.steps[1]
    private val selfieStep = FakeFlowApi.DEFAULT_FLOW.steps[2]
    private val consentStep = ConsentStep("consent", listOf("consent.biometric", "consent.processing"), required = true)
    private val documentStep = DocumentStep("proof", listOf(DocumentClass.UTILITY_BILL, DocumentClass.LEASE, DocumentClass.TAX_DOCUMENT), listOf(CaptureMethod.UPLOAD, CaptureMethod.CAMERA))
    private val nfcStep = NfcStep("chip")
    private val blurry = listOf(RetryHint("image_quality", listOf("image_blurry", "glare_present")))

    // Builders ------------------------------------------------------------------------------------

    private fun flow(
        screen: A11yScreen,
        name: String,
        state: FlowState,
        goldens: List<String> = emptyList(),
        variantOf: String? = null,
        announced: List<String> = emptyList(),
        contestRoute: FlowContestRoute? = null,
        popup: Boolean = false,
        sandbox: Boolean = false,
        picker: Boolean = false,
        manualClock: Boolean = false,
        shows: List<Any> = emptyList(),
        arrange: (A11yFixture) -> Unit = {},
        act: (ComposeContentTestRule.() -> Unit)? = null,
    ) = A11yState(screen, name, goldens, variantOf, announced, contestRoute, popup, manualClock, state, shows, arrange, act) { fixture ->
        InquiryFlowScreen(
            state,
            fixture.camera,
            fixture.actions,
            sandbox = sandbox,
            photoPicker = if (picker) FakePhotoPicker() else null,
            documentPicker = if (picker) NoPicker else null,
            clock = fixture.clock,
        )
    }

    /** A capture screen whose guidance shows [overlay]. */
    private fun guided(
        screen: A11yScreen,
        name: String,
        state: FlowState.Capture,
        goldens: List<String> = emptyList(),
        variantOf: String? = null,
        announced: List<String> = emptyList(),
        primary: Boolean = false,
        shows: List<Any> = emptyList(),
        arrange: (A11yFixture) -> Unit = {},
        overlay: @Composable (Modifier) -> Unit,
    ) = A11yState(screen, name, goldens, variantOf, announced, flowState = state, shows = shows, arrange = arrange) { fixture ->
        CompositionLocalProvider(LocalCaptureGuidance provides CaptureGuidanceFactory { ShownGuidance(primary, overlay) }) {
            InquiryFlowScreen(state, fixture.camera, fixture.actions, clock = fixture.clock)
        }
    }

    private fun mine(vararg names: String): List<String> = names.map { "android-a11y-audit/$it" }

    private fun of(folder: String, vararg names: String): List<String> = names.map { "$folder/$it" }

    /** Presses the control tagged [tag], scrolled into view first when it sits in a scrolling screen. */
    private fun click(tag: String): ComposeContentTestRule.() -> Unit = {
        val control = onNode(hasTestTag(tag))
        try {
            control.performScrollTo()
        } catch (_: AssertionError) {
            // Not inside a scrolling container (the chrome): it is on screen already.
        }
        control.performClick()
    }

    // The states ----------------------------------------------------------------------------------

    private val front = FlowState.Capture(idStep, FileKind.FRONT, index = 0, count = 2)
    private val back = FlowState.Capture(idStep, FileKind.BACK, index = 1, count = 2)
    private val selfie = FlowState.Capture(selfieStep, FileKind.SELFIE_CENTER, index = 0, count = 3)
    private val page = FlowState.Capture(documentStep, FileKind.DOCUMENT, index = 0, count = 1)

    private val chrome: List<A11yState> = listOf(
        flow(A11yScreen.CHROME, "chrome", FlowState.Loading, of("android-theme", "chrome-builtin-light", "chrome-builtin-dark-ar", "chrome-operator-light", "chrome-operator-dark", "chrome-operator-light-ar", "chrome-operator-dark-ar")),
        flow(A11yScreen.CHROME, "chrome-sandbox-banner", FlowState.Expired, mine("chrome-sandbox-banner"), sandbox = true),
        flow(A11yScreen.CHROME, "chrome-language-menu", FlowState.Expired, mine("chrome-language-menu"), popup = true, act = click(ChromeTags.LANGUAGE_SELECTOR)),
    )

    private val status: List<A11yState> = listOf(
        flow(A11yScreen.STATUS, "loading", FlowState.Loading, mine("status-loading", "status-loading-ar-dark-2x", "status-loading-operator-light", "status-loading-operator-dark")),
        flow(A11yScreen.STATUS, "awaiting-camera", FlowState.AwaitingCamera(selfieStep), variantOf = "loading"),
        flow(A11yScreen.STATUS, "processing-photos", FlowState.Processing(idStep), mine("status-processing")),
        flow(A11yScreen.STATUS, "processing-verification", FlowState.Processing(DatabaseStep("db", listOf(DatabaseField.NAME_FIRST))), variantOf = "processing-photos"),
        flow(A11yScreen.STATUS, "nfc-checking", FlowState.Nfc(nfcStep, NfcView.Checking), variantOf = "processing-photos"),
    )

    private val consent: List<A11yState> = listOf(
        flow(
            A11yScreen.CONSENT,
            "consent",
            FlowState.Consent(consentStep.copy(optionalTextKeys = listOf("consent.biometric-matching")), retentionDays = 365),
            mine(
                "consent", "consent-es", "consent-fr", "consent-de", "consent-ar", "consent-en-2x", "consent-es-2x", "consent-fr-2x", "consent-de-2x",
                "consent-ar-2x", "consent-ar-dark-2x", "consent-operator-light", "consent-operator-dark",
            ),
        ),
        flow(A11yScreen.CONSENT, "consent-submitting", FlowState.Consent(consentStep, submitting = true), mine("consent-submitting"), announced = listOf(A11yTags.CONSENT_SAVING)),
        flow(A11yScreen.CONSENT, "consent-text-changed", FlowState.Consent(consentStep, textChanged = true), mine("consent-text-changed"), announced = listOf(dev.openverify.sdk.ui.CONSENT_TEXT_CHANGED_TAG)),
    )

    private val permission: List<A11yState> = listOf(
        A11yState(A11yScreen.CAMERA_PERMISSION, "camera-rationale", mine("camera-rationale", "camera-rationale-ar-dark-2x", "camera-rationale-operator-light", "camera-rationale-operator-dark")) {
            CameraPermissionGate(onCancel = {}, permission = FixedPermission(available = true, granted = false, denied = false)) {}
        },
        A11yState(A11yScreen.CAMERA_PERMISSION, "camera-denied", mine("camera-denied")) {
            CameraPermissionGate(onCancel = {}, permission = FixedPermission(available = true, granted = false, denied = true)) {}
        },
        A11yState(A11yScreen.CAMERA_PERMISSION, "camera-unavailable", mine("camera-unavailable")) {
            CameraPermissionGate(onCancel = {}, permission = CameraPermission.Unavailable) {}
        },
    )

    private val capture: List<A11yState> = listOf(
        flow(A11yScreen.CAPTURE, "capture-id-front", front, mine("capture-id-front", "capture-id-front-ar-dark-2x", "capture-id-front-operator-light", "capture-id-front-operator-dark")),
        flow(A11yScreen.CAPTURE, "capture-id-back", back, variantOf = "capture-id-front"),
        flow(A11yScreen.CAPTURE, "capture-id-retry-hints", front.copy(retryHints = blurry), mine("capture-id-retry-hints")),
        flow(A11yScreen.CAPTURE, "capture-id-upload-offered", front.copy(uploadAllowed = true), mine("capture-id-upload-offered"), sandbox = true, picker = true),
        flow(
            A11yScreen.CAPTURE,
            "capture-failed",
            front,
            mine("capture-failed"),
            announced = listOf(A11yTags.CAPTURE_PROBLEM),
            arrange = { it.camera.nextPhoto = { throw CameraCaptureException("synthetic", null) } },
            act = click(A11yTags.CAPTURE_SHUTTER),
        ),
        flow(A11yScreen.CAPTURE, "capture-selfie", selfie, mine("capture-selfie")),
        flow(A11yScreen.CAPTURE, "capture-selfie-left", selfie.copy(kind = FileKind.SELFIE_LEFT, index = 1), variantOf = "capture-selfie"),
        flow(A11yScreen.CAPTURE, "capture-selfie-right", selfie.copy(kind = FileKind.SELFIE_RIGHT, index = 2), variantOf = "capture-selfie"),
        flow(A11yScreen.CAPTURE, "capture-selfie-restarted", selfie.copy(restarted = true), mine("capture-selfie-restarted"), announced = listOf(A11yTags.CAPTURE_RESTARTED)),
        flow(A11yScreen.CAPTURE, "capture-document-page", page, mine("capture-document-page")),
        flow(A11yScreen.CAPTURE_REVIEW, "capture-review", front.copy(image = testJpeg(320, 200)), mine("capture-review", "capture-review-ar-dark-2x", "capture-review-operator-light", "capture-review-operator-dark")),
        flow(A11yScreen.CAPTURE_REVIEW, "capture-review-sending", selfie.copy(image = testJpeg(240, 320), sending = true), mine("capture-review-sending"), announced = listOf(A11yTags.CAPTURE_SENDING)),
    )

    private val documentGuidance: List<A11yState> = buildList {
        val folder = "document-guidance"
        add(guided(A11yScreen.DOCUMENT_GUIDANCE, "document-guidance-no-hint", front, of(folder, "document-guidance-no-hint")) { DocumentGuidanceOverlay(null, passport = false, it) })
        val named = mapOf(
            DocumentHint.MOVE_CLOSER to "move-closer", DocumentHint.HOLD_STILL to "hold-still", DocumentHint.TILT_AWAY to "tilt-away",
            DocumentHint.MORE_LIGHT to "more-light", DocumentHint.FIT_CARD to "fit-card", DocumentHint.SHOW_MRZ to "show-mrz",
        )
        for (hint in DocumentHint.entries) {
            val golden = named.getValue(hint)
            val extra = if (hint == DocumentHint.HOLD_STILL) of(folder, "document-guidance-ar-dark-large") else emptyList()
            add(
                guided(
                    A11yScreen.DOCUMENT_GUIDANCE,
                    "document-guidance-$golden",
                    front,
                    of(folder, "document-guidance-$golden") + extra + (if (hint == DocumentHint.HOLD_STILL) mine("capture-id-guided", "capture-id-guided-ar-dark-2x") else emptyList()),
                    announced = listOf(dev.openverify.sdk.capture.document.DocumentGuidanceTags.HINT),
                    shows = listOf(hint),
                ) {
                    DocumentGuidanceOverlay(hint, passport = false, it)
                },
            )
        }
        add(
            guided(A11yScreen.DOCUMENT_GUIDANCE, "document-guidance-fit-page", front, variantOf = "document-guidance-fit-card", announced = listOf(dev.openverify.sdk.capture.document.DocumentGuidanceTags.HINT)) {
                DocumentGuidanceOverlay(DocumentHint.FIT_CARD, passport = true, it)
            },
        )
    }

    private val barcodeGuidance: List<A11yState> = listOf(
        guided(A11yScreen.BARCODE_GUIDANCE, "barcode-searching", back, of("pdf417-guidance", "barcode-guide-searching") + mine("capture-id-barcode"), announced = listOf(dev.openverify.sdk.capture.barcode.BarcodeTags.HINT), shows = listOf(BarcodeHint.SEARCHING)) {
            Box(it) {
                DocumentGuidanceOverlay(null, passport = false)
                BarcodeOverlay(BarcodeHint.SEARCHING, Modifier.fillMaxSize())
            }
        },
        guided(A11yScreen.BARCODE_GUIDANCE, "barcode-found", back, of("pdf417-guidance", "barcode-guide-found", "barcode-guide-found-ar-dark"), announced = listOf(dev.openverify.sdk.capture.barcode.BarcodeTags.HINT), shows = listOf(BarcodeHint.FOUND)) {
            Box(it) {
                DocumentGuidanceOverlay(null, passport = false)
                BarcodeOverlay(BarcodeHint.FOUND, Modifier.fillMaxSize())
            }
        },
    )

    private fun warning(name: String, outcome: SelfieExtensionOutcome?, goldens: List<String>, variantOf: String? = null, left: Int = 18, tags: List<String>) =
        flow(
            A11yScreen.SELFIE_GUIDANCE,
            name,
            selfie,
            goldens,
            variantOf,
            announced = tags,
            manualClock = true,
            shows = listOfNotNull(outcome),
            arrange = { fixture ->
                fixture.selfie.value = SelfieCaptureWindow(SELFIE_CAPTURE, fixture.time.markNow() + left.seconds, extension = outcome)
            },
        )

    private val selfieGuidance: List<A11yState> = buildList {
        val folder = "selfie-guidance"
        val hintTag = listOf(dev.openverify.sdk.capture.selfie.SelfieGuidanceTags.HINT)
        val goldens = mapOf(
            GuidanceMessage.HOLD_STILL to of(folder, "selfie-guidance-hold-still") + mine("capture-selfie-guided", "capture-selfie-guided-ar-dark-2x"),
            GuidanceMessage.TURN_LEFT to of(folder, "selfie-guidance-turn-left"),
            GuidanceMessage.MANUAL to of(folder, "selfie-guidance-manual"),
        )
        for (message in GuidanceMessage.entries) {
            val own = goldens[message].orEmpty()
            add(
                guided(
                    A11yScreen.SELFIE_GUIDANCE,
                    "selfie-guidance-${message.wireName}",
                    selfie,
                    own,
                    variantOf = if (own.isEmpty()) "selfie-guidance-hold-still" else null,
                    announced = hintTag,
                    primary = message == GuidanceMessage.MANUAL,
                    shows = listOf(message),
                ) { SelfieGuidanceOverlay(SelfieGuidanceView(message, null, message == GuidanceMessage.MANUAL), it) },
            )
        }
        val warningTag = dev.openverify.sdk.capture.selfie.SelfieExtensionTags.WARNING
        val statusTag = dev.openverify.sdk.capture.selfie.SelfieExtensionTags.STATUS
        add(warning("selfie-time-warning", null, of(folder, "selfie-guidance-time-warning", "selfie-guidance-ar-dark-large") + mine("capture-selfie-time-warning"), tags = listOf(warningTag)))
        add(warning("selfie-time-extending", SelfieExtensionOutcome.EXTENDING, emptyList(), variantOf = "selfie-time-warning", tags = listOf(warningTag)))
        add(warning("selfie-time-extended", SelfieExtensionOutcome.EXTENDED, mine("capture-selfie-time-extended"), left = 170, tags = listOf(statusTag)))
        add(warning("selfie-time-failed", SelfieExtensionOutcome.FAILED, of(folder, "selfie-guidance-more-time-failed"), tags = listOf(warningTag, statusTag)))
        add(warning("selfie-time-already-sent", SelfieExtensionOutcome.ALREADY_SENT, emptyList(), variantOf = "selfie-time-failed", tags = listOf(statusTag)))
    }

    private val phone = FlowState.Otp(PhoneOtpStep("phone", listOf("US", "GB")), OtpChannel.PHONE, listOf("US", "GB"), codeLength = 6)
    private val email = FlowState.Otp(EmailOtpStep("email"), OtpChannel.EMAIL, emptyList(), codeLength = 6)
    private val code = OtpCode("•••• ••00", NOW + 10.minutes, NOW + 30.seconds, sendsRemaining = 4, attemptsRemaining = 5)

    private val otp: List<A11yState> = buildList {
        add(flow(A11yScreen.OTP, "otp-phone-entry", phone, mine("otp-phone-entry", "otp-phone-entry-ar-dark-2x", "otp-phone-entry-operator-light", "otp-phone-entry-operator-dark")))
        add(flow(A11yScreen.OTP, "otp-phone-country-menu", phone, mine("otp-phone-country-menu"), popup = true, act = click(TestTags.OTP_COUNTRY)))
        add(flow(A11yScreen.OTP, "otp-email-entry", email, mine("otp-email-entry")))
        add(flow(A11yScreen.OTP, "otp-entry-retry-hints", phone.copy(retryHints = listOf(RetryHint("otp"))), mine("otp-entry-retry-hints")))
        add(flow(A11yScreen.OTP, "otp-entry-sending", phone.copy(busy = true), mine("otp-entry-sending"), announced = listOf(A11yTags.BUSY)))
        add(flow(A11yScreen.OTP, "otp-code-entry", phone.copy(code = code), mine("otp-code-entry")))
        add(flow(A11yScreen.OTP, "otp-code-resent", email.copy(code = code.copy(resent = true, resendAvailableAt = NOW)), mine("otp-code-resent")))
        add(flow(A11yScreen.OTP, "otp-code-expired", phone.copy(code = code.copy(expiresAt = NOW, resendAvailableAt = NOW)), mine("otp-code-expired"), announced = listOf(A11yTags.ERROR)))
        add(flow(A11yScreen.OTP, "otp-code-no-sends-left", phone.copy(code = code.copy(sendsRemaining = 0, attemptsRemaining = 0)), mine("otp-code-no-sends-left")))
        add(flow(A11yScreen.OTP, "otp-code-checking", phone.copy(code = code, busy = true), variantOf = "otp-entry-sending", announced = listOf(A11yTags.BUSY)))
        add(flow(A11yScreen.OTP, "otp-limited", phone.copy(limited = true), mine("otp-limited")))
        add(flow(A11yScreen.OTP, "otp-limited-refused", phone.copy(limited = true, error = OtpError.CONTINUE_REFUSED), variantOf = "otp-limited", announced = listOf(A11yTags.ERROR)))
        for (error in OtpError.entries) {
            val entryError = error in setOf(OtpError.DESTINATION_INVALID, OtpError.DESTINATION_NOT_ALLOWED, OtpError.DELIVERY_FAILED, OtpError.DESTINATION_TOO_LONG)
            if (error == OtpError.CONTINUE_REFUSED) continue
            for (channel in listOf(phone, email)) {
                val state = if (entryError) channel.copy(error = error) else channel.copy(code = code, error = error)
                val first = error == OtpError.DESTINATION_INVALID && channel === phone
                add(
                    flow(
                        A11yScreen.OTP,
                        "otp-error-${error.name.lowercase().replace('_', '-')}-${channel.channel.name.lowercase()}",
                        state,
                        if (first) mine("otp-entry-error") else emptyList(),
                        variantOf = if (first) null else "otp-error-destination-invalid-phone",
                        announced = listOf(A11yTags.ERROR),
                    ),
                )
            }
        }
    }

    private val databaseFields = listOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.ADDRESS_COUNTRY_CODE, InputField.EMAIL_ADDRESS)
    private val database = FlowState.Form(
        DatabaseStep("db", listOf(DatabaseField.NAME_FIRST, DatabaseField.NAME_LAST, DatabaseField.BIRTHDATE, DatabaseField.ADDRESS_COUNTRY_CODE, DatabaseField.EMAIL_ADDRESS)),
        databaseFields,
        setOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.ADDRESS_COUNTRY_CODE),
    )
    private val aamva = FlowState.Form(
        AamvaStep("aamva", AamvaSource.FORM),
        listOf(
            InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.IDENTIFICATION_NUMBER,
            InputField.ISSUING_AUTHORITY, InputField.ISSUE_DATE, InputField.EXPIRATION_DATE, InputField.ADDRESS_POSTAL_CODE,
        ),
        setOf(InputField.NAME_FIRST, InputField.NAME_LAST, InputField.BIRTHDATE, InputField.IDENTIFICATION_NUMBER, InputField.ISSUING_AUTHORITY),
    )
    private val business = FlowState.Form(
        DatabaseBusinessStep("business", collectAssociatedPersons = true),
        listOf(InputField.BUSINESS_NAME, InputField.COUNTRY_CODE, InputField.REGISTRATION_NUMBER, InputField.ADDRESS_STREET_1, InputField.ADDRESS_CITY, InputField.ADDRESS_POSTAL_CODE),
        setOf(InputField.BUSINESS_NAME, InputField.COUNTRY_CODE),
        collectsPersons = true,
    )
    private val website = FlowState.Form(BusinessWebsiteStep("website"), listOf(InputField.WEBSITE_URL, InputField.BUSINESS_NAME), setOf(InputField.WEBSITE_URL))

    private val form: List<A11yState> = listOf(
        flow(A11yScreen.FORM, "form-database", database, mine("form-database", "form-database-ar-dark-2x", "form-database-operator-light", "form-database-operator-dark")),
        flow(
            A11yScreen.FORM,
            "form-database-errors",
            database.copy(errors = mapOf(InputField.NAME_FIRST to InputProblem.MISSING, InputField.BIRTHDATE to InputProblem.INVALID), refused = true),
            mine("form-database-errors"),
            announced = listOf(A11yTags.ERROR),
        ),
        flow(A11yScreen.FORM, "form-database-retry-hints", database.copy(retryHints = listOf(RetryHint("database"))), mine("form-database-retry-hints")),
        flow(A11yScreen.FORM, "form-database-submitting", database.copy(submitting = true), mine("form-database-submitting"), announced = listOf(A11yTags.BUSY)),
        flow(A11yScreen.FORM, "form-country-menu", database, mine("form-country-menu"), popup = true, act = click(TestTags.input(InputField.ADDRESS_COUNTRY_CODE))),
        flow(A11yScreen.FORM, "form-aamva", aamva, mine("form-aamva")),
        flow(A11yScreen.FORM, "form-business-with-person", business, mine("form-business-with-person"), act = click(TestTags.PERSON_ADD)),
        flow(A11yScreen.FORM, "form-website", website, mine("form-website")),
    )

    private val guidedDocument = FlowState.Document(documentStep, documentStep.documentTypes, maxAgeDays = 90, maxPages = 50, mediaTypes = DocumentFile.MIME_TYPES, upload = true, camera = true)
    private val pdf = PickedDocument(DocumentFile("%PDF-1.7\n%synthetic\n".encodeToByteArray(), "application/pdf"), "statement.pdf", 20)

    private val document: List<A11yState> = buildList {
        add(flow(A11yScreen.DOCUMENT, "document-choose", guidedDocument, mine("document-choose", "document-choose-ar-dark-2x", "document-choose-operator-light", "document-choose-operator-dark"), picker = true))
        add(flow(A11yScreen.DOCUMENT, "document-camera-only", guidedDocument.copy(upload = false), variantOf = "document-choose"))
        add(flow(A11yScreen.DOCUMENT, "document-unavailable", guidedDocument.copy(upload = false, camera = false, maxAgeDays = null), mine("document-unavailable")))
        add(flow(A11yScreen.DOCUMENT, "document-picked", guidedDocument.copy(picked = pdf), mine("document-picked"), announced = listOf(TestTags.DOCUMENT_PICKED), picker = true))
        add(flow(A11yScreen.DOCUMENT, "document-uploading", guidedDocument.copy(picked = pdf, busy = true), mine("document-uploading"), announced = listOf(A11yTags.BUSY), picker = true))
        add(flow(A11yScreen.DOCUMENT, "document-retry-hints", guidedDocument.copy(retryHints = listOf(RetryHint("document"))), mine("document-retry-hints"), picker = true))
        for (error in DocumentError.entries) {
            val first = error == DocumentError.entries.first()
            add(
                flow(
                    A11yScreen.DOCUMENT,
                    "document-error-${error.name.lowercase().replace('_', '-')}",
                    guidedDocument.copy(error = error),
                    if (first) mine("document-error") else emptyList(),
                    variantOf = if (first) null else "document-error-${DocumentError.entries.first().name.lowercase().replace('_', '-')}",
                    announced = listOf(A11yTags.ERROR),
                    picker = true,
                ),
            )
        }
    }

    private val walletStep = CryptoWalletStep("wallet", listOf(EVM, SOLANA), listOf(CryptoSigningMethod.PASTE))
    private val walletEntry = FlowState.CryptoWallet(walletStep, listOf(EVM, SOLANA))
    private val challenge = CryptoChallenge("cwc_01M5CK16P0D13FXHZSS4TCFB01", EVM, "openverify.test wants you to sign in with your account:\n$ADDRESS", NOW + 10.minutes)

    private val wallet: List<A11yState> = buildList {
        add(flow(A11yScreen.WALLET, "wallet-entry", walletEntry, mine("wallet-entry", "wallet-entry-ar-dark-2x", "wallet-entry-operator-light", "wallet-entry-operator-dark")))
        add(flow(A11yScreen.WALLET, "wallet-entry-restarted", walletEntry.copy(restarted = true, retryHints = listOf(RetryHint("crypto_wallet_address_comparison", listOf("signature_address_mismatch")))), mine("wallet-entry-restarted")))
        add(flow(A11yScreen.WALLET, "wallet-entry-busy", walletEntry.copy(busy = true), variantOf = "wallet-message-busy", announced = listOf(A11yTags.BUSY)))
        add(flow(A11yScreen.WALLET, "wallet-message", walletEntry.copy(challenge = challenge), mine("wallet-message")))
        add(flow(A11yScreen.WALLET, "wallet-message-solana", walletEntry.copy(challenge = challenge.copy(chainId = SOLANA)), mine("wallet-message-solana")))
        add(flow(A11yScreen.WALLET, "wallet-message-expired", walletEntry.copy(challenge = challenge.copy(expiresAt = NOW)), mine("wallet-message-expired")))
        add(flow(A11yScreen.WALLET, "wallet-message-busy", walletEntry.copy(challenge = challenge, busy = true), mine("wallet-message-busy"), announced = listOf(A11yTags.BUSY)))
        for (error in CryptoError.entries) {
            val entryError = error in setOf(CryptoError.CHAIN_NOT_OFFERED, CryptoError.ADDRESS_INVALID, CryptoError.EXPECTED_ADDRESS_MISMATCH)
            val first = error == CryptoError.entries.first()
            add(
                flow(
                    A11yScreen.WALLET,
                    "wallet-error-${error.name.lowercase().replace('_', '-')}",
                    if (entryError) walletEntry.copy(error = error) else walletEntry.copy(challenge = challenge, error = error),
                    if (first) mine("wallet-error") else emptyList(),
                    variantOf = if (first) null else "wallet-error-${CryptoError.entries.first().name.lowercase().replace('_', '-')}",
                    announced = listOf(A11yTags.ERROR),
                ),
            )
        }
    }

    private val submit = click(ScreenTags.component("next"))
    private val screens = "android-screens"

    private val screen: List<A11yState> = listOf(
        flow(A11yScreen.SCREEN, "screen-content", ScreenGoldens.state(ScreenGoldens.contentScreen), of(screens, "screen-content")),
        flow(A11yScreen.SCREEN, "screen-form-empty", ScreenGoldens.state(ScreenGoldens.formScreen), of(screens, "screen-form-empty")),
        flow(A11yScreen.SCREEN, "screen-form-filled", ScreenGoldens.state(ScreenGoldens.formScreen, ScreenGoldens.filled), of(screens, "screen-form-filled")),
        flow(
            A11yScreen.SCREEN,
            "screen-form-errors",
            ScreenGoldens.state(ScreenGoldens.formScreen),
            of(screens, "screen-form-errors", "screen-form-errors-ar-dark-2x", "screen-form-errors-operator-light", "screen-form-errors-operator-dark"),
            announced = listOf(ScreenTags.SUMMARY),
            act = submit,
        ),
        flow(A11yScreen.SCREEN, "screen-form-submitting", ScreenGoldens.state(ScreenGoldens.formScreen, ScreenGoldens.filled, submitting = true), of(screens, "screen-form-submitting"), announced = listOf(ScreenTags.SAVING)),
        flow(
            A11yScreen.SCREEN,
            "screen-form-refused",
            ScreenGoldens.state(ScreenGoldens.matrixScreen, ScreenGoldens.filled, refusedFields = setOf("nickname"), refused = true),
            of(screens, "screen-form-refused"),
            announced = listOf(ScreenTags.REFUSED),
        ),
        flow(
            A11yScreen.SCREEN,
            "screen-form-matrix",
            ScreenGoldens.state(ScreenGoldens.matrixScreen),
            of(screens, *listOf("en", "es", "fr", "de", "ar").flatMap { listOf("screen-form-matrix-$it", "screen-form-matrix-$it-2x") }.toTypedArray()),
            announced = listOf(ScreenTags.SUMMARY),
            act = submit,
        ),
        flow(A11yScreen.SCREEN, "screen-cancel-confirm", ScreenGoldens.state(ScreenGoldens.contentScreen), of(screens, "screen-cancel-confirm"), act = click(ScreenTags.component("stop"))),
    )

    private val tap = NfcView.Tap(NfcPhase.READY, reader = true)
    private val review = NfcView.Review(Dg1Details("ERIKSSON, ANNA MARIA", "L898902C3", "UTO", "740812", "120415"))
    private val nfcFolder = "nfc-sdk"

    private fun nfc(name: String, view: NfcView, goldens: List<String> = emptyList(), variantOf: String? = null, announced: List<String> = emptyList(), popup: Boolean = false, act: (ComposeContentTestRule.() -> Unit)? = null) =
        flow(A11yScreen.NFC, name, FlowState.Nfc(nfcStep, view), goldens, variantOf, announced, popup = popup, act = act)

    private val nfc: List<A11yState> = buildList {
        val notice = listOf(dev.openverify.sdk.ui.steps.NfcStepTags.NOTICE)
        val phase = listOf(dev.openverify.sdk.ui.steps.NfcStepTags.PHASE)
        add(nfc("nfc-entry-mrz", NfcView.Entry(NfcAccessKind.MRZ), of(nfcFolder, "nfc-entry-mrz", "nfc-entry-mrz-operator-light", "nfc-entry-mrz-operator-dark")))
        add(nfc("nfc-entry-can", NfcView.Entry(NfcAccessKind.CAN), of(nfcFolder, "nfc-entry-can")))
        for (error in NfcEntryError.entries) {
            val kind = if (error == NfcEntryError.CAN) NfcAccessKind.CAN else NfcAccessKind.MRZ
            val goldens = when (error) {
                NfcEntryError.REFUSED_BY_CHIP -> of(nfcFolder, "nfc-entry-mrz-refused-sandbox")
                NfcEntryError.BIRTH_DATE -> of(nfcFolder, "nfc-entry-mrz-ar-dark-2x")
                else -> emptyList()
            }
            add(
                nfc(
                    "nfc-entry-error-${error.name.lowercase().replace('_', '-')}",
                    NfcView.Entry(kind, error, sandbox = error == NfcEntryError.REFUSED_BY_CHIP),
                    goldens,
                    variantOf = if (goldens.isEmpty()) "nfc-entry-error-refused-by-chip" else null,
                    announced = listOf(A11yTags.ERROR),
                ),
            )
        }
        add(nfc("nfc-entry-retry-hints", NfcView.Entry(NfcAccessKind.MRZ, hints = listOf(RetryHint("chip"))), mine("nfc-entry-retry-hints")))
        add(nfc("nfc-sandbox-scenario-menu", NfcView.Tap(NfcPhase.READY, reader = false, sandbox = true), mine("nfc-sandbox-scenario-menu"), popup = true, act = click(dev.openverify.sdk.ui.steps.NfcStepTags.SANDBOX_SCENARIO)))
        add(nfc("nfc-tap-ready", tap.copy(editable = true), of(nfcFolder, "nfc-tap-ready", "nfc-tap-ready-operator-light", "nfc-tap-ready-operator-dark")))
        add(nfc("nfc-tap-ready-sandbox", NfcView.Tap(NfcPhase.READY, reader = false, sandbox = true), of(nfcFolder, "nfc-tap-ready-sandbox")))
        val noticeGoldens = mapOf(NfcNotice.CHALLENGE_EXPIRED to "nfc-tap-expired")
        for (shown in NfcNotice.entries) {
            val golden = noticeGoldens[shown]
            add(
                nfc(
                    "nfc-tap-notice-${shown.name.lowercase().replace('_', '-')}",
                    tap.copy(notice = shown),
                    if (golden != null) of(nfcFolder, golden) else emptyList(),
                    variantOf = if (golden == null) "nfc-tap-notice-challenge-expired" else null,
                    announced = notice,
                ),
            )
        }
        add(nfc("nfc-tap-requesting", tap.copy(phase = NfcPhase.REQUESTING), variantOf = "nfc-tap-waiting", announced = phase))
        add(nfc("nfc-tap-waiting", tap.copy(phase = NfcPhase.WAITING), of(nfcFolder, "nfc-tap-waiting"), announced = phase))
        add(nfc("nfc-tap-keep-still", tap.copy(phase = NfcPhase.WAITING, notice = NfcNotice.KEEP_STILL), of(nfcFolder, "nfc-tap-keep-still"), announced = phase + notice))
        add(nfc("nfc-tap-connecting", tap.copy(phase = NfcPhase.CONNECTING), variantOf = "nfc-tap-signing", announced = phase))
        for (file in listOf(FileKind.CHIP_DG1, FileKind.CHIP_DG2, FileKind.CHIP_COM, FileKind.CHIP_SOD)) {
            val goldens = when (file) {
                FileKind.CHIP_DG2 -> of(nfcFolder, "nfc-tap-reading")
                FileKind.CHIP_DG1 -> of(nfcFolder, "nfc-tap-reading-ar-dark-2x")
                else -> emptyList()
            }
            add(
                nfc(
                    "nfc-tap-reading-${file.name.lowercase().replace('_', '-')}",
                    tap.copy(phase = NfcPhase.READING, file = file, percent = 60),
                    goldens,
                    variantOf = if (goldens.isEmpty()) "nfc-tap-reading-chip-dg2" else null,
                    announced = phase,
                ),
            )
        }
        add(nfc("nfc-tap-signing", tap.copy(phase = NfcPhase.SIGNING), of(nfcFolder, "nfc-tap-signing"), announced = phase))
        add(nfc("nfc-tap-read", tap.copy(phase = NfcPhase.READ), of(nfcFolder, "nfc-tap-read"), announced = phase))
        add(nfc("nfc-review", review, of(nfcFolder, "nfc-review", "nfc-review-ar-dark-2x", "nfc-review-operator-light", "nfc-review-operator-dark")))
        add(nfc("nfc-review-again", review.copy(again = true), of(nfcFolder, "nfc-review-again")))
        add(nfc("nfc-tips", NfcView.Tips, of(nfcFolder, "nfc-tips", "nfc-tips-ar-dark-2x", "nfc-tips-operator-light", "nfc-tips-operator-dark")))
        add(nfc("nfc-unable-reader", NfcView.CannotRead(NfcUnable.READER_NOT_INSTALLED, fallback = true), of(nfcFolder, "nfc-unable-reader")))
        add(nfc("nfc-unable-phone", NfcView.CannotRead(NfcUnable.NFC_UNAVAILABLE, fallback = false), of(nfcFolder, "nfc-unable-phone")))
        add(nfc("nfc-unable-off", NfcView.CannotRead(NfcUnable.NFC_DISABLED, fallback = true), of(nfcFolder, "nfc-unable-off", "nfc-unable-off-ar-dark-2x", "nfc-unable-off-operator-light", "nfc-unable-off-operator-dark")))
        add(nfc("nfc-unable-spent", NfcView.CannotRead(NfcUnable.CHALLENGES_SPENT, fallback = true, busy = true), of(nfcFolder, "nfc-unable-spent"), announced = listOf(A11yTags.BUSY)))
    }

    // C238.7, C237.6 (Workflow 11A, clients-connect): the share-consent screen and the withdrawal under
    // the completion screen; synthetic organisations and texts, digests as served.
    private val shareFolder = "clients-connect"
    private val shareBody = "Example Source asks for your agreement to share the details it verified about you with Example Partner, so that " +
        "Example Partner can reuse this verification.\n\nTo withdraw your agreement, email privacy@example.com."
    private val shareBiometric = "I agree that Example Source shares my biometric data with Example Partner."
    private val shareStep = dev.openverify.sdk.model.ShareConsentStep(
        id = "share_back",
        side = dev.openverify.sdk.model.ShareConsentSide.SOURCE,
        recipientName = "Example Partner",
        sourceName = "Example Source",
        categories = listOf("identity-fields", "document-images", "biometric", "check-results"),
        text = dev.openverify.sdk.model.ShareConsentText("en", shareBody, dev.openverify.sdk.flow.logic.Sha256.hexOfUtf8(shareBody), listOf("share.consent.source")),
        biometric = dev.openverify.sdk.model.ShareConsentBiometric(shareBiometric, dev.openverify.sdk.flow.logic.Sha256.hexOfUtf8(shareBiometric)),
    )
    private val shareWithdrawable = listOf(dev.openverify.sdk.model.FlowWithdrawableShareConsent("share_back", dev.openverify.sdk.model.ShareConsentSide.SOURCE, "Example Partner"))
    private val shareCompleted = FlowState.Completed(CompletionStep("done", "flow.completion"), InquiryStatus.COMPLETED)

    private fun share(name: String, view: dev.openverify.sdk.flow.ShareConsentView, goldens: List<String> = emptyList(), variantOf: String? = null, announced: List<String> = emptyList()) =
        flow(A11yScreen.SHARE_CONSENT, name, dev.openverify.sdk.flow.ShareConsentState(view), goldens, variantOf, announced)

    private fun withdrawal(name: String, withdrawals: dev.openverify.sdk.flow.ShareConsentWithdrawals, goldens: List<String> = emptyList(), variantOf: String? = null, announced: List<String> = emptyList()) =
        flow(A11yScreen.COMPLETION, name, shareCompleted, goldens, variantOf, announced, shows = listOf(withdrawals), arrange = { it.shareConsents.value = withdrawals })

    private val shareConsent: List<A11yState> = buildList {
        val view = dev.openverify.sdk.flow.ShareConsentView(shareStep)
        val tags = dev.openverify.sdk.ui.steps.ShareConsentTags
        add(share("share-consent", view, of(shareFolder, "share-consent", "share-consent-ar-dark-2x", "share-consent-operator-light", "share-consent-operator-dark")))
        add(share("share-consent-no-biometric", view.copy(step = shareStep.copy(categories = listOf("identity-fields"), biometric = null)), variantOf = "share-consent"))
        add(share("share-consent-tick-missing", view.copy(tickMissing = true), of(shareFolder, "share-consent-tick-missing", "share-consent-tick-missing-ar-dark-2x"), announced = listOf(tags.TICK_MISSING)))
        add(share("share-consent-submitting", view.copy(submitting = true), of(shareFolder, "share-consent-submitting", "share-consent-submitting-ar-dark-2x"), announced = listOf(tags.SAVING)))
        val offered = dev.openverify.sdk.flow.ShareConsentWithdrawals(shareWithdrawable)
        add(withdrawal("completed-share-withdraw", offered, of(shareFolder, "completed-share-withdraw", "completed-share-withdraw-ar-dark-2x")))
        add(withdrawal("completed-share-withdrawing", offered.copy(busyStepId = "share_back"), variantOf = "completed-share-withdraw", announced = listOf(tags.WITHDRAWING)))
        add(withdrawal("completed-share-withdraw-failed", offered.copy(failed = true), variantOf = "completed-share-withdraw", announced = listOf(tags.WITHDRAW_FAILED)))
        add(withdrawal("completed-share-withdrawn", dev.openverify.sdk.flow.ShareConsentWithdrawals(withdrawnRecipient = "Example Partner"), of(shareFolder, "completed-share-withdrawn", "completed-share-withdrawn-ar-dark-2x"), announced = listOf(tags.WITHDRAWN)))
    }

    private val failed = FlowState.Failed(FailureStep("failed", "flow.failure"), InquiryStatus.DECLINED)

    private val ends: List<A11yState> = buildList {
        add(flow(A11yScreen.WAITING, "waiting", FlowState.Waiting(), mine("waiting", "waiting-ar-dark-2x", "waiting-operator-light", "waiting-operator-dark"), announced = listOf(A11yTags.WAITING_MESSAGE)))
        add(flow(A11yScreen.COMPLETION, "completed", FlowState.Completed(CompletionStep("done", "flow.completion"), InquiryStatus.COMPLETED), mine("completed", "completed-ar-dark-2x", "completed-operator-light", "completed-operator-dark")))
        add(flow(A11yScreen.FAILURE, "failed", failed, of(screens, "failure-plain")))
        add(
            flow(
                A11yScreen.FAILURE,
                "failed-contest-link",
                failed,
                of(
                    screens,
                    *listOf("en", "es", "fr", "de", "ar").flatMap { listOf("failure-contest-link-$it", "failure-contest-link-$it-2x") }.toTypedArray(),
                    "failure-contest-link-ar-dark-2x", "failure-contest-link-operator-light", "failure-contest-link-operator-dark",
                ),
                contestRoute = ScreenGoldens.contestLink,
            ),
        )
        add(flow(A11yScreen.FAILURE, "failed-contest-contact", failed, of(screens, "failure-contest-contact"), contestRoute = ScreenGoldens.contestContact))
        add(flow(A11yScreen.CLOSED, "expired", FlowState.Expired, mine("closed-expired", "closed-expired-ar-dark-2x", "closed-expired-operator-light", "closed-expired-operator-dark")))
        add(flow(A11yScreen.CLOSED, "session-expired", FlowState.SessionEnded(SessionEndReason.EXPIRED), variantOf = "expired"))
        add(flow(A11yScreen.CLOSED, "session-canceled", FlowState.SessionEnded(SessionEndReason.CANCELED), variantOf = "expired"))
        add(flow(A11yScreen.CLOSED, "redacted", FlowState.Redacted, variantOf = "expired"))
        add(flow(A11yScreen.CLOSED, "link-refused", FlowState.LinkRefused, variantOf = "expired"))
        add(flow(A11yScreen.CLOSED, "halted", FlowState.Halted, variantOf = "expired"))
        add(flow(A11yScreen.CLOSED, "unsupported", FlowState.Unsupported("synthetic"), variantOf = "expired"))
        add(flow(A11yScreen.CLOSED, "unsupported-server", FlowState.Unsupported(ServerPosition.SERVER_BEFORE_SPEC_2), variantOf = "expired"))
        for (error in FlowError.entries) {
            val first = error == FlowError.entries.first()
            add(
                flow(
                    A11yScreen.ERROR,
                    "error-${error.name.lowercase().replace('_', '-')}",
                    FlowState.Error(error, canRetry = true),
                    if (first) mine("error-retry", "error-retry-ar-dark-2x", "error-retry-operator-light", "error-retry-operator-dark") else emptyList(),
                    variantOf = if (first) null else "error-${FlowError.entries.first().name.lowercase().replace('_', '-')}",
                ),
            )
        }
        add(flow(A11yScreen.ERROR, "error-final", FlowState.Error(FlowError.REJECTED, canRetry = false), mine("error-final")))
    }

    /** Every state, in the order of the audit's table. */
    internal val STATES: List<A11yState> = chrome + status + consent + permission + capture + documentGuidance + barcodeGuidance + selfieGuidance + otp + form + document + wallet + screen + nfc + shareConsent + ends

    internal fun state(name: String): A11yState = STATES.first { it.name == name }

    /**
     * The screen a [FlowState] belongs to. It has no `else`: a new state does not compile until it is
     * placed here, and `A11yInventoryTest` then asks for its entry in [STATES].
     */
    internal fun screenOf(state: FlowState): A11yScreen = when (state) {
        FlowState.Loading, is FlowState.AwaitingCamera, is FlowState.Processing -> A11yScreen.STATUS
        is FlowState.Consent -> A11yScreen.CONSENT
        is FlowState.Capture -> if (state.image == null) A11yScreen.CAPTURE else A11yScreen.CAPTURE_REVIEW
        is FlowState.Completed -> A11yScreen.COMPLETION
        is FlowState.Failed -> A11yScreen.FAILURE
        FlowState.Expired, is FlowState.SessionEnded, FlowState.Redacted, FlowState.LinkRefused, FlowState.Halted, is FlowState.Unsupported -> A11yScreen.CLOSED
        is FlowState.Error -> A11yScreen.ERROR
        is FlowState.Waiting -> A11yScreen.WAITING
        is FlowState.Nfc -> if (state.view == NfcView.Checking) A11yScreen.STATUS else A11yScreen.NFC
        is FlowState.Screen -> A11yScreen.SCREEN
        is FlowState.Otp -> A11yScreen.OTP
        is FlowState.Form -> A11yScreen.FORM
        is FlowState.Document -> A11yScreen.DOCUMENT
        is FlowState.CryptoWallet -> A11yScreen.WALLET
        // Workflow 11A (clients-connect): the share-consent screen (C238.7).
        is dev.openverify.sdk.flow.ShareConsentState -> A11yScreen.SHARE_CONSENT
    }
}

/**
 * Test tags the accessibility tests find status nodes by. The SDK's own tags are used where they
 * exist; these name the nodes that had none before Workflow 10D.
 */
internal object A11yTags {
    const val ERROR: String = dev.openverify.sdk.ui.TestTags.ERROR_MESSAGE
    const val BUSY: String = dev.openverify.sdk.ui.TestTags.BUSY
    const val CONSENT_SAVING: String = dev.openverify.sdk.ui.TestTags.CONSENT_SAVING
    const val CAPTURE_PROBLEM: String = dev.openverify.sdk.ui.TestTags.CAPTURE_PROBLEM
    const val CAPTURE_SHUTTER: String = dev.openverify.sdk.ui.TestTags.CAPTURE_SHUTTER
    const val CAPTURE_RESTARTED: String = dev.openverify.sdk.ui.TestTags.CAPTURE_RESTARTED
    const val CAPTURE_SENDING: String = dev.openverify.sdk.ui.TestTags.CAPTURE_SENDING
    const val WAITING_MESSAGE: String = dev.openverify.sdk.ui.TestTags.WAITING_MESSAGE
}
