package dev.openverify.sdk.flow

import dev.openverify.sdk.api.FlowApi
import dev.openverify.sdk.api.FlowApiException
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.camera.captureMethodOf
import dev.openverify.sdk.camera.nativeCaptureMethods
import dev.openverify.sdk.camera.toDeviceSnapshot
import dev.openverify.sdk.capture.selfie.SelfieCaptureWindow
import dev.openverify.sdk.capture.selfie.SelfieExtensionOutcome
import dev.openverify.sdk.capture.selfie.extendCapture
import dev.openverify.sdk.consent.CONSENT_AGREEMENT_KEY
import dev.openverify.sdk.consent.ConsentText
import dev.openverify.sdk.consent.ConsentValues
import dev.openverify.sdk.consent.consentEvidence
import dev.openverify.sdk.consent.consentText
import dev.openverify.sdk.flow.logic.normalisesDigits
import dev.openverify.sdk.flow.logic.normalizeDigits
import dev.openverify.sdk.i18n.SDK_DEFAULT_LANGUAGE
import dev.openverify.sdk.i18n.SDK_LANGUAGES
import dev.openverify.sdk.i18n.canonicalLanguageTag
import dev.openverify.sdk.i18n.lookupLanguage
import dev.openverify.sdk.log.SdkLog
import dev.openverify.sdk.model.AamvaSource
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.BusinessWebsiteStep
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.ConsentStep
import dev.openverify.sdk.model.CryptoChains
import dev.openverify.sdk.model.CryptoLimits
import dev.openverify.sdk.model.CryptoSigningMethod
import dev.openverify.sdk.model.CryptoWalletStep
import dev.openverify.sdk.model.DatabaseBusinessInputs
import dev.openverify.sdk.model.DatabaseBusinessStep
import dev.openverify.sdk.model.DatabaseStep
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.EmailOtpStep
import dev.openverify.sdk.model.EnvironmentKind
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.FlowCryptoSubmit
import dev.openverify.sdk.model.FlowSelfieCapture
import dev.openverify.sdk.model.FlowSession
import dev.openverify.sdk.model.FlowSessionSignals
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.FlowSubmitCapture
import dev.openverify.sdk.model.FlowTheme
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.FlowVerification
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.InputProblem
import dev.openverify.sdk.model.InputRules
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.OtpLimits
import dev.openverify.sdk.model.PersonField
import dev.openverify.sdk.model.PhoneOtpStep
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.model.SelfieCaptureUpload
import dev.openverify.sdk.model.SelfiePose
import dev.openverify.sdk.model.SelfieStep
import dev.openverify.sdk.model.SessionCanceledReason
import dev.openverify.sdk.model.VerificationInputs
import dev.openverify.sdk.model.VerificationStatus
import dev.openverify.sdk.model.VerificationType
import dev.openverify.sdk.signals.DeviceSignals
import dev.openverify.sdk.signals.IntegrityVerdictRequest
import dev.openverify.sdk.model.NfcStep
import dev.openverify.sdk.nfc.NfcEnvironment
import dev.openverify.sdk.nfc.NfcEvent
import dev.openverify.sdk.nfc.NfcStepController
import dev.openverify.sdk.nfc.NfcStepHost
import dev.openverify.sdk.ui.theme.SessionTheme
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.ComparableTimeMark
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex

/**
 * The server-position driver (C193, ADR 0008): renders the step the session's `position` names from
 * its client view (`step`), through [StepRegistry], and runs that step's own work: consent, a
 * government ID's sides, selfie poses, a phone or email code, a form, a document, a wallet signature,
 * a screen's values. It is plain Kotlin: the UI renders [state] and calls the actions, and every
 * server call goes through [api].
 *
 * The server stays the authority and decides every path. After each exit the SDK reports (consent
 * recorded, a verification submitted and decided, a screen submitted), it reads the session again,
 * or takes the session the route answered, and renders the new position; it never advances on its
 * own: no list order, no transition and no attempt count decides the next step (C151.12). A decided
 * inquiry (finished, failed or expired) goes straight to its end screen, as in the web flow, and a
 * server before flow-spec 2 shows the unsupported screen (C193.2). Actions called while another is
 * running are ignored.
 */
internal class FlowCoordinator(
    private val api: FlowApi,
    /** The inquiry the host app asked for; the session must belong to it. */
    private val inquiryId: String,
    private val settings: Settings = Settings(),
    /**
     * C94.7 (Phase 7): what the SDK reads about the device for signals, after consent and only under
     * the tiers the session reports. [DeviceSignals.None] (the default) reads and sends nothing.
     */
    private val deviceSignals: DeviceSignals = DeviceSignals.None,
    /**
     * C211.3 (Workflow 10B; `device-integrity-android`'s, `signals/Integrity.kt`): the Play Integrity
     * request, run after consent and on a consented load beside the flow. [IntegrityVerdictRequest.None]
     * (the default) requests nothing.
     */
    private val integrity: IntegrityVerdictRequest = IntegrityVerdictRequest.None,
    /**
     * C204.5 (Workflow 10B; `selfie-guidance`'s, `capture/selfie/Extension.kt`): asks the server for more
     * time on the open selfie capture and answers its new window, or `null` when it was not extended.
     */
    private val selfieExtension: suspend (FlowApi, SelfieCaptureWindow) -> SelfieCaptureWindow = ::extendCapture,
    /**
     * C207 (Workflow 10C; `nfc-sdk`'s, `nfc/NfcStepController.kt`): the reader the host installed and
     * the phone's NFC seam, for the `nfc` step. [NfcEnvironment.None] (the default) has neither.
     */
    nfcEnvironment: NfcEnvironment = NfcEnvironment.None,
) {
    data class Settings(
        /**
         * BCP 47 tag of the language consent is recorded in when [acceptConsent] is not told the
         * language its texts were shown in; the SDK's consent screen always tells it (C37).
         */
        val locale: String = "en",
        /** Consent text keys the UI can display. Consent to any other key is never recorded. */
        val consentTextKeys: Set<String> = setOf(
            "consent.biometric",
            "consent.processing",
            "consent.biometric-matching",
            // C94.6 (ADR 0006): the collection tiers' notices and the optional recognition consent.
            "notice.session-integrity",
            "notice.device-recognition",
            // C211.9, decision 66 (Workflow 10B): the notice that names Google, required beside the
            // session-integrity notice while a deviceIntegrity provider is bound.
            "notice.play-integrity",
            "consent.device-recognition",
            // C128.4: optional, offered with its own checkbox.
            "consent.automated-decision",
        ),
        val pollInterval: Duration = 2.seconds,
        val pollAttempts: Int = 60,
        /** The device's monotonic clock: a capture's age and its poses' `client-elapsed-ms` (C40.3). */
        val timeSource: TimeSource.WithComparableMarks = TimeSource.Monotonic,
    )

    private val mutableState = MutableStateFlow<FlowState>(FlowState.Loading)
    val state: StateFlow<FlowState> = mutableState.asStateFlow()

    private val mutableSandbox = MutableStateFlow(false)

    /** Whether the session runs in a sandbox (C19): the UI then shows a banner on every screen. */
    val sandbox: StateFlow<Boolean> = mutableSandbox.asStateFlow()

    private val mutableTheme = MutableStateFlow<FlowTheme?>(null)

    /** The theme the SDK applies (C198.1), from the theme hook ([SessionTheme]); `null` is the built-in theme. */
    val theme: StateFlow<FlowTheme?> = mutableTheme.asStateFlow()

    private val busy = Mutex()
    private var session: FlowSession? = null

    /** K10A-3: what this launch has already logged about its session's operator copy. */
    private val copyNotes = CopyNotes()

    /** The verification step being captured or processed. */
    private var work: StepWork? = null
        set(value) {
            field = value
            publishSelfieCapture()
        }

    /** What [retry] repeats after a retryable error. */
    private var retryAction: (suspend () -> Unit)? = null

    /** The UI has reported the camera ready ([cameraReady]); a selfie capture no longer waits for it. */
    private var cameraShown = false

    private val mutableSelfieCapture = MutableStateFlow<SelfieCaptureWindow?>(null)

    /**
     * C204.5 (Workflow 10B, foundation-10b's hook for `selfie-guidance`): the open selfie capture's id
     * and its expiry on [Settings.timeSource], `null` while none is open.
     */
    val selfieCapture: StateFlow<SelfieCaptureWindow?> = mutableSelfieCapture.asStateFlow()

    private fun publishSelfieCapture() {
        mutableSelfieCapture.value = work?.capture?.window()
    }

    /** Loads the session and moves to the first step that is not done yet. */
    suspend fun start(): Unit = exclusive { load() }

    /**
     * Records consent for the consent step's texts, then moves on. The required keys sent are
     * exactly the step's `textKeys`; of [optionalTextKeys], the ones the user ticked (C42.3), only
     * those the step offers and the SDK can show are sent. [locale] is the language the texts were
     * shown in (C37), sent as its base tag (C193.9); without it, [Settings.locale] is recorded.
     */
    suspend fun acceptConsent(optionalTextKeys: Set<String> = emptySet(), locale: String? = null): Unit = exclusive {
        val current = mutableState.value as? FlowState.Consent ?: return@exclusive
        val ticked = current.step.optionalTextKeys.filter { it in optionalTextKeys && it in settings.consentTextKeys }
        sendConsent(current, ticked, consentLanguage(locale))
    }

    /**
     * C193.9 (decision 71, the 10A decisions' D2): the consent body's `locale` is how the SDK tells
     * the server the language it chose, which sets the engine's `session.locale`: the base tag of one
     * of the SDK's languages (`es-MX` is `es`), else [Settings.locale]. Nothing rides on the session read.
     */
    private fun consentLanguage(locale: String?): String =
        canonicalLanguageTag(locale)?.let { lookupLanguage(it, SDK_LANGUAGES) } ?: settings.locale

    /**
     * The UI can show the camera: its permission is granted (Workflow 4B H014). A selfie step
     * waiting for it ([FlowState.AwaitingCamera]) creates its verification and capture now, and
     * later selfie captures no longer wait. The flag is set even while another action runs, so the
     * next selfie start sees it.
     */
    suspend fun cameraReady() {
        cameraShown = true
        exclusive {
            if (mutableState.value !is FlowState.AwaitingCamera) return@exclusive
            startCapture(work ?: return@exclusive)
        }
    }

    /**
     * Shows a camera photo for review; [camera] is what the camera reported about itself (C40.4), and
     * [trigger] the client-reported `capture-trigger` the capture screen gave it (C206.2).
     */
    fun capture(image: CapturedImage, camera: CameraFacts? = null, trigger: CaptureTrigger? = null) =
        review(image, picked = false, camera, trigger)

    /**
     * C204.5 (Workflow 10B, foundation-10b's hook): asks for more time on the open selfie capture through
     * `selfie-guidance`'s [extendCapture] ([selfieExtension]), and moves the capture's expiry to the window
     * it answers.
     */
    suspend fun extendSelfieCapture() {
        val capture = work?.capture ?: return
        // KP10-25: the outcome travels with this launch's window, so the warning reads nothing else.
        capture.extension = SelfieExtensionOutcome.EXTENDING
        publishSelfieCapture()
        val answered = try {
            // The hook takes the capture as the server knows it; the in-flight mark is this screen's.
            selfieExtension(api, capture.window().copy(extension = null))
        } catch (cancelled: CancellationException) {
            if (work?.capture === capture) {
                capture.extension = SelfieExtensionOutcome.FAILED
                publishSelfieCapture()
            }
            throw cancelled
        }
        // The capture may have been replaced or submitted while the server answered.
        if (work?.capture !== capture || answered.id != capture.id) return
        capture.expiresAt = answered.expiresAt
        capture.extension = answered.extension
        publishSelfieCapture()
    }

    /**
     * Shows a photo the user picked from files for review, where uploads are allowed (a sandbox,
     * C19). A selfie photo picked under a camera capture moves the attempt to an upload capture
     * when it is kept, so the capture never claims a camera it did not use (C40.2).
     */
    fun pick(image: CapturedImage) {
        val current = mutableState.value as? FlowState.Capture ?: return
        if (current.uploadAllowed) review(image, picked = true, camera = null, trigger = null)
    }

    private fun review(image: CapturedImage, picked: Boolean, camera: CameraFacts?, trigger: CaptureTrigger?) {
        val current = mutableState.value as? FlowState.Capture ?: return
        if (current.image != null || current.sending) return
        work?.shot = Shot(picked, camera, settings.timeSource.markNow(), trigger)
        mutableState.value = current.copy(image = image, restarted = false)
    }

    /** Discards the photo under review. */
    fun retake() {
        val current = mutableState.value as? FlowState.Capture ?: return
        if (current.image != null && !current.sending) {
            work?.shot = null
            mutableState.value = current.copy(image = null)
        }
    }

    /**
     * Keeps the photo under review. A selfie pose is sent at once, before the next prompt (C40.3);
     * a government ID's photos are sent with the step's last one. After the last photo, submits.
     */
    suspend fun confirmCapture(): Unit = exclusive {
        val current = mutableState.value as? FlowState.Capture ?: return@exclusive
        val image = current.image ?: return@exclusive
        val work = work ?: return@exclusive
        work.photos[current.kind] = image
        val shot = work.shot ?: Shot(picked = false, camera = null, settings.timeSource.markNow())
        // C206 (Workflow 10B hook): what the photo's upload reports about how it was taken.
        work.shots[current.kind] = shot
        val capture = work.capture
        if (capture == null) {
            val next = current.index + 1
            if (next < current.count) {
                mutableState.value = current.copy(kind = work.kinds[next], index = next, image = null)
            } else if (process(work)) {
                render()
            }
            return@exclusive
        }
        if (shot.picked && capture.method == CaptureMethod.CAMERA) {
            switchToUploads(work, current)
        } else {
            capture.keep(current.kind, shot)
            sendPose(work, current)
        }
    }

    /**
     * C55: sends a code to [destination], a phone number for a phone step or an email address for
     * an email one, creating the verification first. The destination stays in this object's memory
     * only, for a resend.
     */
    suspend fun sendOtp(destination: OtpDestination): Unit = exclusive {
        val shown = mutableState.value as? FlowState.Otp ?: return@exclusive
        if (shown.busy || shown.limited || !shown.channel.takes(destination)) return@exclusive
        // Workflow 5C review P028: a value longer than the server reads (a note pasted after the
        // number) is said on the entry, never sent; the API client's own check is the last guard.
        if (OtpLimits.tooLong(destination)) {
            mutableState.value = shown.copy(error = OtpError.DESTINATION_TOO_LONG)
            return@exclusive
        }
        // C196.3: a number typed on an Arabic keyboard goes out in ASCII digits; an address as typed.
        val ascii = if (destination is OtpDestination.Phone) OtpDestination.Phone(normalizeDigits(destination.phoneNumber)) else destination
        send(work ?: return@exclusive, shown, ascii)
    }

    /**
     * C55.6: sends a new code to the open code's destination. After a resume this process never
     * knew the destination, so the entry asks for it again.
     */
    suspend fun resendOtp(): Unit = exclusive {
        val shown = mutableState.value as? FlowState.Otp ?: return@exclusive
        if (shown.busy || shown.limited || shown.code == null) return@exclusive
        val work = work ?: return@exclusive
        val destination = work.destination
        if (destination == null) {
            mutableState.value = shown.copy(code = null, error = null)
        } else {
            send(work, shown, destination)
        }
    }

    /** C55.5: confirms [code], all its digits, then submits the verification at once (C50.7). */
    suspend fun confirmOtp(code: String): Unit = exclusive {
        val shown = mutableState.value as? FlowState.Otp ?: return@exclusive
        if (shown.busy || shown.limited || shown.code == null) return@exclusive
        // C196.3: a code typed in Arabic-Indic or Persian digits is still a code.
        val digits = normalizeDigits(code)
        if (digits.length != shown.codeLength || !digits.all { it in '0'..'9' }) return@exclusive
        confirm(work ?: return@exclusive, shown, digits)
    }

    /** C64.1: back to the destination entry; a code sent there supersedes the open one. */
    fun changeOtpDestination() {
        val shown = mutableState.value as? FlowState.Otp ?: return
        if (!shown.busy && !shown.limited && shown.code != null) {
            mutableState.value = shown.copy(code = null, error = null)
        }
    }

    /**
     * C55.6 (V11): after a limit refusal, submits the verification, which then goes to review
     * (`otp_delivery_unavailable`). The server records only some refusals; when it did not record
     * this one, the screen says the verification could not continue yet.
     */
    suspend fun continueAfterLimit(): Unit = exclusive {
        val shown = mutableState.value as? FlowState.Otp ?: return@exclusive
        if (shown.busy || !shown.limited) return@exclusive
        continueLimited(work ?: return@exclusive, shown)
    }

    /**
     * C64.2: shows the document the user picked, by its name and size, to upload. One of a media type
     * the step's guidance does not accept is refused instead (C52.4).
     */
    fun pickDocument(document: PickedDocument) {
        val shown = mutableState.value as? FlowState.Document ?: return
        if (shown.busy) return
        if (document.file.mimeType !in shown.mediaTypes) {
            mutableState.value = shown.copy(picked = null, error = DocumentError.UNSUPPORTED_TYPE)
            return
        }
        // A new file is uploaded anew: it replaces the verification's earlier one.
        work?.uploaded?.remove(FileKind.DOCUMENT)
        mutableState.value = shown.copy(picked = document, error = null)
    }

    /** C64.2: the picker could not use the file the user chose; the screen says why. */
    fun refuseDocument(error: DocumentError) {
        val shown = mutableState.value as? FlowState.Document ?: return
        if (!shown.busy) mutableState.value = shown.copy(picked = null, error = error)
    }

    /** C64.2: forgets the picked document, so the user can choose another. */
    fun discardDocument() {
        val shown = mutableState.value as? FlowState.Document ?: return
        if (!shown.busy) mutableState.value = shown.copy(picked = null)
    }

    /** C52.4: uploads the picked document as the document kind, submits it and waits for the decision. */
    suspend fun submitDocument(): Unit = exclusive {
        val shown = mutableState.value as? FlowState.Document ?: return@exclusive
        if (shown.busy || shown.picked == null) return@exclusive
        sendDocument(work ?: return@exclusive, shown)
    }

    /**
     * C64.2: takes a photo of the document with the camera instead of a file, where the step allows
     * it: the camera screen, whose kept photo is uploaded as the document kind.
     */
    fun takeDocumentPhoto() {
        val shown = mutableState.value as? FlowState.Document ?: return
        val work = work ?: return
        if (shown.busy || !shown.camera) return
        work.kinds = listOf(FileKind.DOCUMENT)
        work.documentShown = shown
        mutableState.value = FlowState.Capture(shown.step, FileKind.DOCUMENT, 0, 1)
    }

    /** C64.2: back from the document's camera to its screen, dropping any photo taken. */
    fun backToDocument() {
        val current = mutableState.value as? FlowState.Capture ?: return
        val work = work ?: return
        val shown = work.documentShown ?: return
        if (current.sending || current.step != shown.step) return
        work.kinds = emptyList()
        work.photos.clear()
        work.shot = null
        mutableState.value = shown
    }

    /**
     * C52.3: a form's [values], checked on the device first: a required field left blank, or a
     * value outside its contract, is shown on its field and nothing is sent. Only the form's own
     * fields are sent, trimmed, a blank one left out; then the verification is submitted. A business
     * form that collects them also sends [persons], its associated persons, each by its fields,
     * trimmed and checked the same way (at most ten).
     */
    suspend fun submitInputs(values: Map<InputField, String>, persons: List<Map<PersonField, String>> = emptyList()): Unit = exclusive {
        val shown = mutableState.value as? FlowState.Form ?: return@exclusive
        if (shown.submitting) return@exclusive
        val work = work ?: return@exclusive
        // C196.3: digits typed on an Arabic keyboard are ASCII before the rules read them and before they are sent.
        val entered = values.filterKeys { it in shown.fields }
            .mapValues { (field, value) -> (if (normalisesDigits(field)) normalizeDigits(value) else value).trim() }
            .filterValues { it.isNotEmpty() }
        val people = if (shown.collectsPersons) {
            persons.take(DatabaseBusinessInputs.MAX_ASSOCIATED_PERSONS).map { person -> person.mapValues { normalizeDigits(it.value).trim() } }
        } else {
            emptyList()
        }
        val inputs = formInputs(shown.step, entered, people)
        val problems = shown.required.filter { it !in entered }.associateWith { InputProblem.MISSING } +
            InputRules.problems(inputs).filterKeys { it in shown.fields }
        val personProblems = (inputs as? DatabaseBusinessInputs)?.let(InputRules::personProblems).orEmpty()
        if (problems.isNotEmpty() || personProblems.isNotEmpty()) {
            mutableState.value = shown.copy(errors = problems, personErrors = personProblems, refused = false)
            return@exclusive
        }
        enter(work, shown, inputs, entered.keys)
    }

    /**
     * C57.2: asks the server for the message to sign for [walletAddress], trimmed, on [chainId], one
     * of the chains offered; the verification is created first. A blank or overlong address is
     * never sent; an overlong one is no address of any chain, which the entry says (P028).
     */
    suspend fun createCryptoChallenge(chainId: String, walletAddress: String): Unit = exclusive {
        val shown = mutableState.value as? FlowState.CryptoWallet ?: return@exclusive
        if (shown.busy || shown.challenge != null || chainId !in shown.chains) return@exclusive
        val address = walletAddress.trim()
        if (address.isEmpty()) return@exclusive
        if (address.length > CryptoLimits.ADDRESS_MAX_LENGTH) {
            mutableState.value = shown.copy(error = CryptoError.ADDRESS_INVALID)
            return@exclusive
        }
        challenge(work ?: return@exclusive, shown, chainId, address)
    }

    /**
     * C57.3: submits the pasted [signature] over the open message and waits for the decision. On a
     * chain whose wallet wraps the message (Solana), [signedMessage] carries the bytes it signed;
     * elsewhere it is left out, as is a blank one. A paste over its C57.1 limit is never sent, and
     * the message screen says which (Workflow 5C review P028).
     */
    suspend fun submitCryptoSignature(signature: String, signedMessage: String?): Unit = exclusive {
        val shown = mutableState.value as? FlowState.CryptoWallet ?: return@exclusive
        val challenge = shown.challenge ?: return@exclusive
        if (shown.busy) return@exclusive
        val signed = signature.trim()
        if (signed.isEmpty()) return@exclusive
        val wrapped = signedMessage?.trim()?.takeIf { it.isNotEmpty() && CryptoChains.wrapsSignedMessage(challenge.chainId) }
        val tooLong = when {
            signed.length > CryptoLimits.SIGNATURE_MAX_LENGTH -> CryptoError.SIGNATURE_TOO_LONG
            wrapped != null && wrapped.encodeToByteArray().size > CryptoLimits.MESSAGE_MAX_BYTES -> CryptoError.SIGNED_MESSAGE_TOO_LONG
            else -> null
        }
        if (tooLong != null) {
            mutableState.value = shown.copy(error = tooLong)
            return@exclusive
        }
        val work = work ?: return@exclusive
        work.crypto = FlowCryptoSubmit(challenge.id, signed, wrapped)
        work.cryptoShown = shown.copy(error = null)
        if (process(work)) render()
    }

    /** C64.1: back to the chain and address entry; a new message supersedes the open one. */
    fun changeCryptoWallet() {
        val shown = mutableState.value as? FlowState.CryptoWallet ?: return
        if (!shown.busy && shown.challenge != null) {
            mutableState.value = shown.copy(challenge = null, error = null)
        }
    }

    /**
     * C57.2: a new message for the open message's chain and [walletAddress], replacing the open one
     * on the same verification (the expired message's own button; audit gap K9). The entry shows
     * while it is on its way and takes any refusal, as for a first message. The address is what this
     * process typed: without one (the message was open before a resume) the entry asks for it.
     */
    suspend fun renewCryptoChallenge(walletAddress: String): Unit = exclusive {
        val shown = mutableState.value as? FlowState.CryptoWallet ?: return@exclusive
        val open = shown.challenge ?: return@exclusive
        if (shown.busy) return@exclusive
        val entry = shown.copy(challenge = null, error = null)
        mutableState.value = entry
        val address = walletAddress.trim()
        if (address.isEmpty()) return@exclusive
        if (address.length > CryptoLimits.ADDRESS_MAX_LENGTH) {
            mutableState.value = entry.copy(error = CryptoError.ADDRESS_INVALID)
            return@exclusive
        }
        challenge(work ?: return@exclusive, entry, open.chainId, address)
    }

    /**
     * C148.5, C195.7: submits the shown screen's [values] by field key through [button] (`null`: the
     * primary button, port `next`), then renders the session the route answers. A value the server
     * holds as set ([FlowValue.Set]) is never sent back. A 422 brings its `/values/<field>` pointers
     * back to the screen's fields, keeping none of the server's words; the values stay in memory only.
     */
    suspend fun submitScreen(values: Map<String, FlowValue>, button: String?): Unit = exclusive {
        val shown = mutableState.value as? FlowState.Screen ?: return@exclusive
        if (shown.submitting) return@exclusive
        sendScreen(shown, values.filterValues { it !is FlowValue.Set }, button)
    }

    /** Repeats the work that failed, when the error state allows it. */
    suspend fun retry(): Unit = exclusive {
        if ((mutableState.value as? FlowState.Error)?.canRetry != true) return@exclusive
        val action = retryAction ?: return@exclusive
        retryAction = null
        action()
    }

    private suspend fun exclusive(action: suspend () -> Unit) {
        if (!busy.tryLock()) return
        try {
            action()
        } finally {
            busy.unlock()
        }
    }

    private suspend fun load() {
        mutableState.value = FlowState.Loading
        val loaded = call(retry = ::load) { api.getSession() } ?: return
        if (loaded.inquiry.id != inquiryId) {
            mutableState.value = FlowState.Error(FlowError.INQUIRY_MISMATCH, canRetry = false)
            return
        }
        adopt(loaded)
        // C94.6: a session that already has consent reports its tiers on this read, for the step its
        // position names. A decided inquiry only shows its end, and a server before flow-spec 2 only
        // the unsupported screen, so nothing about the device is read for either.
        val screen = loaded.position?.stepId
        if (loaded.consent != null && screen != null && ServerPosition.drives(loaded) && ServerPosition.decided(loaded) == null) {
            loaded.signals?.let { tiers -> sendSignalsBeside { tiers to screen } }
            requestIntegrityBeside(loaded)
        }
        render()
    }

    private suspend fun sendConsent(shown: FlowState.Consent, optionalTextKeys: List<String>, locale: String) {
        mutableState.value = shown.copy(submitting = true)
        // C200 hook (android-sdk-api): what the SDK reports it rendered, beside the keys.
        val evidence = consentEvidence(shown.step, optionalTextKeys, locale, checkNotNull(session))
        var textMismatch = false
        val consent = call(retry = { sendConsent(shown, optionalTextKeys, locale) }) {
            try {
                api.acceptConsent(shown.step.textKeys, locale, optionalTextKeys, evidence)
            } catch (refused: FlowApiException.Rejected) {
                if (refused.problem?.code != FlowProblemCodes.CONSENT_TEXT_MISMATCH) throw refused
                textMismatch = true
                null
            }
        }
        if (textMismatch) {
            showChangedConsent()
            return
        }
        if (consent == null) return
        session = checkNotNull(session).copy(consent = consent)
        // C193.3: the consent answer names no position, so the session is read for it; the same read
        // reports the tiers once consent is recorded (C94.6), and the body goes out beside the flow.
        val read = call(retry = ::load) { api.getSession() } ?: return
        adopt(read)
        read.signals?.let { tiers -> sendSignalsBeside { tiers to shown.step.id } }
        requestIntegrityBeside(read)
        render()
    }

    /**
     * C200.5 (KP10-6): the server refused the acceptance because the texts shown are not the version's
     * (422 `consent_text_mismatch`: the operator's copy changed since the session was read), so nothing
     * was recorded. The session is read again and its position rendered; when that is still the consent,
     * it is shown with [FlowState.Consent.textChanged], so the person reads the new words before agreeing.
     * The log code names no text.
     */
    private suspend fun showChangedConsent() {
        SdkLog.log("consent.text_mismatch")
        val read = call(retry = ::load) { api.getSession() } ?: return
        adopt(read)
        render()
        (mutableState.value as? FlowState.Consent)?.let { mutableState.value = it.copy(textChanged = true) }
    }

    /** Whether this coordinator has started its one signal body (C94.7). */
    private var signalsStarted = false

    /** How many signal bodies this coordinator sent, added to the session's `next-sequence` (C94.2). */
    private var signalSequence = 0

    /**
     * C94.6, C94.7: once the session may collect, sends one body for the tiers and screen [read]
     * gives, or nothing when it gives none. Nothing is read before, and only [deviceSignals] reads the
     * device, under those tiers.
     *
     * The work runs beside the flow, as a child of the action that started it: a slow or unreachable
     * server never holds the flow or its actions, and the work ends with the caller's scope (the view
     * model's). A failure is swallowed: the server then reads `collector_missing`, never a clean
     * device, and the flow goes on.
     */
    private suspend fun sendSignalsBeside(read: suspend () -> Pair<FlowSessionSignals, String>?) {
        if (deviceSignals === DeviceSignals.None || signalsStarted) return
        signalsStarted = true
        CoroutineScope(currentCoroutineContext()).launch {
            try {
                val (tiers, screen) = read() ?: return@launch
                // K7A-7: the server ignores a repeated sequence, so a later launch goes on from it.
                val sequence = (tiers.nextSequence ?: 0) + signalSequence
                val collected = deviceSignals.collect(tiers, screen, sequence) ?: return@launch
                // Phase 7 C90.9: the sandbox outcome rides only on a sandbox session's body; production
                // answers 422 sandbox_only_value and would lose the whole body (android-sdk-api).
                val body = if (session?.environment?.kind == EnvironmentKind.SANDBOX) collected else collected.copy(sandboxOutcome = null)
                signalSequence += 1
                api.sendSignals(body)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Swallowed by design (C94.7): signals never block or fail the flow.
            }
        }
    }

    /**
     * C211.3 (Workflow 10B, foundation-10b's hook for `device-integrity-android`): after consent, and on a
     * consented load, the integrity request ([integrity], `signals/Integrity.kt`) runs beside the flow as
     * the signals do: a child of the calling action, never awaited, its failure swallowed, so a server or a
     * host provider that never answers holds neither the flow nor its actions, and the work ends with the
     * caller's scope (the view model's). Whether the session asks for a token is the request's to read.
     */
    private suspend fun requestIntegrityBeside(session: FlowSession) {
        if (integrity === IntegrityVerdictRequest.None) return
        CoroutineScope(currentCoroutineContext()).launch {
            try {
                integrity.requestIntegrityVerdict(session)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Swallowed by design (C211.2): an integrity request never blocks or fails the flow.
            }
        }
    }

    /**
     * C193.3: renders the session's position. A step the coordinator runs ([PositionRendering.Run])
     * does its own work and reads the session again; a wait reads it again after its delay. When
     * [restarted], a selfie capture was just replaced, and its first prompt says so.
     */
    private suspend fun render(restarted: Boolean = false) {
        repeat(MAX_PROCESSING_ROUNDS) {
            when (val rendering = ServerPosition.render(checkNotNull(session), notes = copyNotes)) {
                is PositionRendering.Shown -> {
                    mutableState.value = rendering.state
                    return
                }
                is PositionRendering.Wait -> if (!waitForServer(rendering)) return
                is PositionRendering.Run -> when (val resolution = resolve(rendering.step, restarted)) {
                    is Resolution.Show -> {
                        mutableState.value = resolution.state
                        return
                    }
                    is Resolution.Process -> if (!process(resolution.work)) return
                    is Resolution.Open -> if (!open(resolution.work)) return
                    is Resolution.Await -> if (!awaitServer(resolution.step)) return
                    is Resolution.StartCapture -> {
                        // The capture's lifetime starts when the server creates it, so the time the
                        // user spends on the camera permission must come before that (4B H014).
                        if (cameraShown) {
                            startCapture(resolution.work)
                        } else {
                            mutableState.value = FlowState.AwaitingCamera(resolution.work.step)
                        }
                        return
                    }
                }
            }
        }
        // The server keeps answering a position this SDK has already worked through; start over later.
        retryAction = ::load
        mutableState.value = FlowState.Error(FlowError.STILL_PROCESSING, canRetry = true)
    }

    /**
     * What the position's [step] needs from this device, according to the current session: its
     * screen, the processing of a submitted attempt, or a wait for the server ([Resolution.Await])
     * when the step's own work is done (or used up) and the position has not moved yet. Only this
     * step's routes are ever called (C193.5).
     */
    private fun resolve(step: FlowStep, restarted: Boolean = false): Resolution {
        val session = checkNotNull(session)
        return when (step) {
            is ConsentStep -> if (session.consent == null) consentState(step) else Resolution.Await(step)
            is GovernmentIdStep -> {
                if (CaptureMethod.CAMERA !in nativeCaptureMethods(step)) return unsupported("government_id without camera capture")
                verificationState(session, step, VerificationType.GOVERNMENT_ID, documentKinds(step), step.maxAttempts, restarted)
            }
            is SelfieStep -> verificationState(session, step, VerificationType.SELFIE, selfieKinds(step), step.maxAttempts, restarted)
            is PhoneOtpStep -> otpResolution(session, step, VerificationType.PHONE_NUMBER)
            is EmailOtpStep -> otpResolution(session, step, VerificationType.EMAIL_ADDRESS)
            is DatabaseStep -> formResolution(session, step, VerificationType.DATABASE)
            is AamvaStep -> when (step.source) {
                AamvaSource.FORM -> formResolution(session, step, VerificationType.AAMVA)
                AamvaSource.GOVERNMENT_ID -> silentAamvaResolution(session, step)
            }
            is CryptoWalletStep -> cryptoResolution(session, step)
            is DocumentStep -> documentResolution(session, step)
            is DatabaseBusinessStep -> businessResolution(session, step)
            is BusinessWebsiteStep -> formResolution(session, step, VerificationType.BUSINESS_WEBSITE)
            // C207 (Workflow 10C, contracts-10c's hook): the nfc step's own work is nfc-sdk's controller's.
            is NfcStep -> Resolution.Show(nfcController.resolve(session, step))
            // The registry runs only the steps above; any other is shown, never run.
            else -> null
        } ?: Resolution.Await(step)
    }

    /**
     * Photos may be picked instead of taken only in a sandbox (C19): selfies, and ID steps that
     * allow uploads. Production photos always come from the live camera.
     */
    private fun uploadAllowed(session: FlowSession, step: FlowStep): Boolean =
        session.environment?.kind == EnvironmentKind.SANDBOX &&
            (step is SelfieStep || (step is GovernmentIdStep && CaptureMethod.UPLOAD in nativeCaptureMethods(step)))

    /**
     * The consent step, unless one of its required texts cannot be shown. An optional text the SDK
     * cannot show is simply not offered (C42.3). The session's face template retention fills the
     * matching text's `{{days}}`.
     *
     * C200.2, C199.7 (KP10-7): a required text, or the agreement's label, that cannot be shown as
     * written (an operator's placeholder outside the key's list or with no value in the session, a
     * stray brace) in any of the SDK's languages makes the step unsupported here, before the person
     * picks a language, so closing it reports `Failed(UNSUPPORTED_FLOW)`, never `Canceled`.
     */
    private fun consentState(step: ConsentStep): Resolution {
        val unknown = step.textKeys.firstOrNull { it !in settings.consentTextKeys }
        if (unknown != null) return unsupported("consent text $unknown")
        val current = checkNotNull(session)
        val values = ConsentValues.of(current)
        val defaultLanguage = current.locales?.default ?: SDK_DEFAULT_LANGUAGE
        val unshowable = (step.textKeys + CONSENT_AGREEMENT_KEY).firstOrNull { key ->
            SDK_LANGUAGES.any { language -> consentText(key, language, current.copy, defaultLanguage, values) is ConsentText.Unavailable }
        }
        if (unshowable != null) return unsupported("consent text $unshowable")
        return Resolution.Show(FlowState.Consent(step, retentionDays = checkNotNull(session).faceTemplateRetentionDays))
    }

    /**
     * `null` when the step is done; otherwise the capture, processing or wait it needs. Every
     * verification of [type] counts as an attempt, as on the server. A selfie first needs its
     * capture (C40.2).
     */
    private fun verificationState(
        session: FlowSession,
        step: FlowStep,
        type: VerificationType,
        kinds: List<FileKind>,
        maxAttempts: Int,
        restarted: Boolean,
    ): Resolution? {
        if (kinds.isEmpty()) return unsupported("${step.type} without photos")
        val attempts = session.verifications.filter { it.verificationType == type }
        val latest = attempts.lastOrNull()
        val status = latest?.attributes?.status
        return when {
            // C30.6: a verification an operator reviews is done for the user, without retry hints.
            status == VerificationStatus.PASSED || status == VerificationStatus.SKIPPED ||
                status == VerificationStatus.NEEDS_REVIEW -> null
            // A status newer than this SDK (3B follow-up): the attempt may still be running or may
            // be decided, so a new one could use up an attempt the user needs. Stop instead.
            status == VerificationStatus.UNKNOWN -> unsupported("verification status unknown")
            latest != null && (status == VerificationStatus.SUBMITTED || status == VerificationStatus.CONFIRMED) ->
                Resolution.Process(
                    StepWork(step, type, kinds, latest.id).apply {
                        uploaded += kinds
                        submitted = true
                    },
                )
            else -> {
                // C30.1, C50.5: a failure without a hint is never retryable, so that waits too.
                val reusable = latest?.id?.takeIf { status == VerificationStatus.INITIATED }
                // C193.4 (V02): the step's attempts are used up, or its failure is never retryable
                // (C30.1): the server moves the position (an exhausted fallback, or the end), so the
                // SDK makes no attempt the server refuses and reads the session until it has moved.
                if (reusable == null && attempts.size >= maxAttempts) return Resolution.Await(step)
                val failed = status == VerificationStatus.FAILED || status == VerificationStatus.REQUIRES_RETRY
                val hints = latest?.attributes?.retryHints?.takeIf { failed }.orEmpty()
                if (failed && hints.isEmpty()) return Resolution.Await(step)
                val work = StepWork(step, type, kinds, reusable, hints, uploadAllowed(session, step), restarted)
                this.work = work
                if (type == VerificationType.SELFIE) return Resolution.StartCapture(work)
                Resolution.Show(FlowState.Capture(step, kinds.first(), 0, kinds.size, hints, uploadAllowed = work.uploadAllowed))
            }
        }
    }

    /**
     * C64.1: `null` when a step the user types into is done; otherwise its [screen], the processing
     * of a submitted attempt, or the wait for the inquiry to fail. A confirmed code, and an initiated
     * attempt that [submitsAtOnce] (a form whose values the server holds), is submitted at once, so
     * resuming never strands it. A failed attempt with hints or a canceled attempt starts again, with
     * the failure's hints or saying it was [restarted][screen], while the step has attempts left. A
     * failure without a hint failed a fraud check, which is never retryable (C30.1, C50.5): the server
     * decides the verification before it settles the inquiry, so that waits, as the web flow does.
     */
    private fun entryResolution(
        session: FlowSession,
        step: FlowStep,
        type: VerificationType,
        submitsAtOnce: (FlowVerification) -> Boolean = { false },
        /** The screen needs its verification's guidance first (C52.2): a new attempt is made on opening. */
        opens: Boolean = false,
        screen: (verification: FlowVerification?, hints: List<RetryHint>, restarted: Boolean) -> FlowState,
    ): Resolution? {
        val attempts = session.verifications.filter { it.verificationType == type }
        val latest = attempts.lastOrNull()
        return when (latest?.attributes?.status) {
            VerificationStatus.PASSED, VerificationStatus.SKIPPED, VerificationStatus.NEEDS_REVIEW -> null
            VerificationStatus.UNKNOWN -> unsupported("verification status unknown")
            VerificationStatus.SUBMITTED -> Resolution.Process(StepWork(step, type, emptyList(), latest.id).apply { submitted = true })
            VerificationStatus.CONFIRMED -> Resolution.Process(StepWork(step, type, emptyList(), latest.id))
            VerificationStatus.INITIATED -> {
                if (submitsAtOnce(latest)) return Resolution.Process(StepWork(step, type, emptyList(), latest.id))
                // The same attempt after a re-read keeps what this process knew of it.
                val previous = work?.takeIf { it.verificationId == latest.id }
                val hints = previous?.hints.orEmpty()
                work = StepWork(step, type, emptyList(), latest.id, hints).apply { destination = previous?.destination }
                Resolution.Show(screen(latest, hints, false))
            }
            VerificationStatus.FAILED, VerificationStatus.REQUIRES_RETRY, VerificationStatus.CANCELED, null -> {
                // C193.4 (V02): used up, or never retryable (C30.1): the server moves the position.
                if (attempts.size >= checkNotNull(stepMaxAttempts(step))) return Resolution.Await(step)
                val canceled = latest?.attributes?.status == VerificationStatus.CANCELED
                val hints = latest?.attributes?.retryHints?.takeIf { !canceled }.orEmpty()
                if (latest != null && !canceled && hints.isEmpty()) return Resolution.Await(step)
                work = StepWork(step, type, emptyList(), null, hints)
                if (opens) Resolution.Open(checkNotNull(work)) else Resolution.Show(screen(null, hints, canceled))
            }
        }
    }

    /**
     * C60, C64.2: a document step. Its screen needs the guidance's window and media types before the
     * user picks a file, so a new attempt's verification is made on opening (C52.2).
     */
    private fun documentResolution(session: FlowSession, step: DocumentStep): Resolution? =
        entryResolution(session, step, VerificationType.DOCUMENT, opens = true) { verification, hints, _ ->
            documentState(step, verification, hints)
        }

    /**
     * C61, C64.2: a business registry step: its form needs the inputs every match group names, so a
     * new attempt's verification is made on opening (C52.2); values the server holds are submitted at once.
     */
    private fun businessResolution(session: FlowSession, step: DatabaseBusinessStep): Resolution? = entryResolution(
        session,
        step,
        VerificationType.DATABASE_BUSINESS,
        submitsAtOnce = { it.attributes.inputsReceived == true },
        opens = true,
    ) { verification, hints, _ -> formState(step, verification, hints) }

    /**
     * C52.2: makes [work]'s verification for a screen that needs its guidance, then reads the session,
     * whose initiated attempt then shows. Returns false when it stopped on an error, which a retry
     * resolves by making (or finding, F018) it again.
     */
    private suspend fun open(work: StepWork): Boolean {
        this.work = work
        mutableState.value = FlowState.Loading
        call(retry = { if (open(work)) render() }) {
            if (work.verificationId == null) work.verificationId = createVerification(work)
            adopt(api.getSession())
        } ?: return false
        return true
    }

    /**
     * C52.4: uploads the picked document as the document kind (once, so a retry submits only), then
     * submits and waits for the decision. The server's refusal of the file itself (413, 415, 422)
     * comes back to the screen without it; a 409 means the verification moved on.
     */
    private suspend fun sendDocument(work: StepWork, shown: FlowState.Document) {
        val picked = shown.picked ?: return
        mutableState.value = shown.copy(busy = true, error = null)
        try {
            val id = work.verificationId ?: createVerification(work).also { work.verificationId = it }
            if (FileKind.DOCUMENT !in work.uploaded) {
                api.uploadDocument(id, picked.file, captureMethodOf(work.step, picked = true))
                work.uploaded += FileKind.DOCUMENT
            }
        } catch (e: FlowApiException.Rejected) {
            val refusal = when (e.status) {
                413 -> DocumentError.TOO_LARGE
                415, 422 -> DocumentError.UNSUPPORTED_TYPE
                else -> null
            }
            if (refusal == null) return failed(e, retry = { sendDocument(work, shown) })
            mutableState.value = shown.copy(picked = null, busy = false, error = refusal)
            return
        } catch (_: FlowApiException.Conflict) {
            return movedOn(work.step)
        } catch (e: FlowApiException) {
            return failed(e, retry = { sendDocument(work, shown) })
        } catch (_: IllegalArgumentException) {
            retryAction = null
            mutableState.value = FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = false)
            return
        }
        if (process(work)) render()
    }

    /** C55: a phone or email step. */
    private fun otpResolution(session: FlowSession, step: FlowStep, type: VerificationType): Resolution? =
        entryResolution(session, step, type) { verification, hints, _ -> otpState(step, verification, hints) }

    /** C52.3: a database or AAMVA form step; values the server already holds are submitted at once. */
    private fun formResolution(session: FlowSession, step: FlowStep, type: VerificationType): Resolution? =
        entryResolution(session, step, type, submitsAtOnce = { it.attributes.inputsReceived == true }) { verification, hints, _ ->
            formState(step, verification, hints)
        }

    /**
     * C57, C64.2: a crypto wallet step. This SDK signs only by pasting, and sends only chains it
     * knows, so a step it would have to show without either is unsupported; an attempt already
     * submitted is still waited on. A canceled attempt (the challenge cap, C57.2) starts again.
     */
    private fun cryptoResolution(session: FlowSession, step: CryptoWalletStep): Resolution? {
        val resolution = entryResolution(session, step, VerificationType.CRYPTO_WALLET) { verification, hints, restarted ->
            cryptoState(step, verification, hints, restarted)
        } ?: return null
        val shown = (resolution as? Resolution.Show)?.state as? FlowState.CryptoWallet ?: return resolution
        return when {
            CryptoSigningMethod.PASTE !in step.signing -> unsupported("crypto_wallet without paste signing")
            shown.chains.isEmpty() -> unsupported("crypto_wallet without a chain this SDK knows")
            else -> resolution
        }
    }

    /** C57.2: asks for the message to sign, creating the verification first, and shows it. */
    private suspend fun challenge(work: StepWork, shown: FlowState.CryptoWallet, chainId: String, address: String) {
        mutableState.value = shown.copy(busy = true, error = null)
        val created = try {
            val id = work.verificationId ?: createVerification(work).also { work.verificationId = it }
            api.createCryptoChallenge(id, chainId, address)
        } catch (e: FlowApiException) {
            val refused = shown.copy(busy = false)
            when ((e as? FlowApiException.Http)?.problem?.code) {
                FlowProblemCodes.CRYPTO_CHAIN_NOT_OFFERED -> mutableState.value = refused.copy(error = CryptoError.CHAIN_NOT_OFFERED)
                FlowProblemCodes.CRYPTO_ADDRESS_INVALID -> mutableState.value = refused.copy(error = CryptoError.ADDRESS_INVALID)
                FlowProblemCodes.CRYPTO_EXPECTED_ADDRESS_MISMATCH -> mutableState.value = refused.copy(error = CryptoError.EXPECTED_ADDRESS_MISMATCH)
                // C57.2: the eleventh challenge canceled the attempt; the session says what is left.
                FlowProblemCodes.CRYPTO_CHALLENGE_INVALID -> movedOn(work.step)
                else -> failed(e, retry = ::load)
            }
            return
        } catch (_: IllegalArgumentException) {
            retryAction = null
            mutableState.value = FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = false)
            return
        }
        mutableState.value = shown.copy(
            challenge = CryptoChallenge(created.id, chainId, created.message, parseInstant(created.expiresAt)),
            busy = false,
            error = null,
        )
    }

    /** C57.3: the message expired or was replaced; back to the entry for a new one, on the same attempt. */
    private fun cryptoRefused(work: StepWork) {
        work.crypto = null
        val shown = work.cryptoShown ?: return
        mutableState.value = shown.copy(challenge = null, busy = false, error = CryptoError.CHALLENGE_INVALID)
    }

    /**
     * C50.5, C59.6: a silent AAMVA step, which the client never creates or submits. It is done once
     * the server's attempt is decided or skipped; a submitted one is waited on; a failure has no
     * retry, so the inquiry is about to fail; anything else waits for the server to create it.
     */
    private fun silentAamvaResolution(session: FlowSession, step: AamvaStep): Resolution? {
        val latest = session.verifications.lastOrNull { it.verificationType == VerificationType.AAMVA }
        return when (latest?.attributes?.status) {
            VerificationStatus.PASSED, VerificationStatus.SKIPPED, VerificationStatus.NEEDS_REVIEW -> null
            VerificationStatus.UNKNOWN -> unsupported("verification status unknown")
            VerificationStatus.FAILED, VerificationStatus.REQUIRES_RETRY -> Resolution.Await(step)
            VerificationStatus.SUBMITTED, VerificationStatus.CONFIRMED ->
                Resolution.Process(StepWork(step, VerificationType.AAMVA, emptyList(), latest.id).apply { submitted = true })
            VerificationStatus.INITIATED, VerificationStatus.CANCELED, null -> Resolution.Await(step)
        }
    }

    /**
     * The position names [step], whose work on this device is done (decided, used up, or the
     * server's to create, as the silent AAMVA step, C59.6): re-reads the session, [Settings.pollInterval]
     * apart, until the position has moved or the step needs this device again (C193.3: the SDK never
     * advances on its own). Returns false when it stopped on an error, which a retry resolves by
     * reloading.
     */
    private suspend fun awaitServer(step: FlowStep): Boolean {
        mutableState.value = FlowState.Processing(step)
        repeat(settings.pollAttempts) {
            delay(settings.pollInterval)
            adopt(call(retry = ::load) { api.getSession() } ?: return false)
            val next = ServerPosition.render(checkNotNull(session), notes = copyNotes)
            if (next !is PositionRendering.Run || next.step.id != step.id || resolve(next.step) !is Resolution.Await) return true
        }
        retryAction = ::load
        mutableState.value = FlowState.Error(FlowError.STILL_PROCESSING, canRetry = true)
        return false
    }

    /**
     * C150.5, C197.1: the server is deciding (a wait on facts, a workflow). Shows the waiting screen,
     * which names nothing of what is awaited, and reads the session again after the position's
     * `retry-after-ms` (or [Settings.pollInterval], 2 s by default) until the position is no longer
     * waiting. Returns false when it stopped on an error, which a retry resolves by reloading.
     */
    private suspend fun waitForServer(wait: PositionRendering.Wait): Boolean {
        var current = wait
        repeat(settings.pollAttempts) {
            mutableState.value = FlowState.Waiting(current.retryAfterMs?.toLong())
            delay(current.retryAfterMs?.milliseconds ?: settings.pollInterval)
            adopt(call(retry = ::load) { api.getSession() } ?: return false)
            current = ServerPosition.render(checkNotNull(session), notes = copyNotes) as? PositionRendering.Wait ?: return true
        }
        retryAction = ::load
        mutableState.value = FlowState.Error(FlowError.STILL_PROCESSING, canRetry = true)
        return false
    }

    /**
     * C148.5, C195.7: sends [shown]'s [values] through [button] and renders the session the route
     * answers. A 422 brings each `/values/<field>` pointer back to its field; a 409 the server answers
     * because the screen is no longer current reads the session instead (C193.5).
     */
    private suspend fun sendScreen(shown: FlowState.Screen, values: Map<String, FlowValue>, button: String?) {
        mutableState.value = shown.copy(submitting = true, refusedFields = emptySet(), refused = false)
        val answered = try {
            api.submitScreen(shown.step.id, values, button)
        } catch (e: FlowApiException.Conflict) {
            // C193.5 (P26): the screen is no longer current, or a resend of a submission that landed.
            return readAndRender()
        } catch (e: FlowApiException.Rejected) {
            if (e.status != 422) return failed(e, retry = { sendScreen(shown, values, button) })
            val pointers = e.problem?.errors.orEmpty().map { it.pointer }
            val fields = pointers.mapNotNull { pointer -> pointer?.takeIf { it.startsWith(SCREEN_VALUE_POINTER) }?.removePrefix(SCREEN_VALUE_POINTER)?.takeIf { it.isNotEmpty() } }
            mutableState.value = shown.copy(
                submitting = false,
                refusedFields = fields.toSet(),
                refused = pointers.isEmpty() || pointers.any { it == null || !it.startsWith(SCREEN_VALUE_POINTER) },
            )
            return
        } catch (e: FlowApiException) {
            return failed(e, retry = { sendScreen(shown, values, button) })
        } catch (_: IllegalArgumentException) {
            retryAction = null
            mutableState.value = FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = false)
            return
        }
        if (answered.inquiry.id != inquiryId) {
            mutableState.value = FlowState.Error(FlowError.INQUIRY_MISMATCH, canRetry = false)
            return
        }
        adopt(answered)
        render()
    }

    /**
     * C52.3: enters a form's values, creating the verification first, then submits it. A 422 brings
     * each JSON Pointer back to its field, or to its associated person; on a business form, a member
     * the user left out ([entered] holds the ones they filled) is asked for. A retry after any other
     * failure sends the same values, which replace the earlier ones while the verification is initiated.
     */
    private suspend fun enter(work: StepWork, shown: FlowState.Form, inputs: VerificationInputs, entered: Set<InputField>) {
        mutableState.value = shown.copy(submitting = true, errors = emptyMap(), personErrors = emptyMap(), refused = false)
        val retry: suspend () -> Unit = { enter(work, shown, inputs, entered) }
        val id = work.verificationId ?: (call(retry) { createVerification(work) } ?: return).also { work.verificationId = it }
        try {
            api.enterInputs(id, inputs)
        } catch (e: FlowApiException.Rejected) {
            if (e.status != 422) return failed(e, retry)
            val pointers = e.problem?.errors.orEmpty().map { it.pointer }
            val fields = pointers.mapNotNull(::inputFieldAt).filter { it in shown.fields }
            val people = pointers.mapNotNull(::personInputAt)
                .filter { shown.collectsPersons && it.index < ((inputs as? DatabaseBusinessInputs)?.associatedPersons?.size ?: 0) }
            // C52.2: a business member every match group needs, left out, is asked for.
            val business = shown.step is DatabaseBusinessStep
            mutableState.value = shown.copy(
                errors = fields.associateWith { if (business && it !in entered) InputProblem.MISSING else InputProblem.REFUSED },
                personErrors = people.associateWith { InputProblem.REFUSED },
                refused = fields.isEmpty() && people.isEmpty(),
            )
            return
        } catch (e: FlowApiException) {
            return failed(e, retry)
        }
        if (process(work)) render()
    }

    /** C55: sends a code, creating the verification first, and opens the code entry on it. */
    private suspend fun send(work: StepWork, shown: FlowState.Otp, destination: OtpDestination) {
        mutableState.value = shown.copy(busy = true, error = null)
        val sent = otpRequest(work, shown) {
            val id = work.verificationId ?: createVerification(work).also { work.verificationId = it }
            api.sendOtp(id, destination)
        } ?: return
        work.destination = destination
        val next = otpState(shown.step, sent, shown.retryHints)
        mutableState.value = next.copy(code = (next.code ?: UNDESCRIBED_CODE).copy(resent = shown.code != null))
    }

    /** C55.5: confirms the code; a confirmed verification is submitted at once (C50.7). */
    private suspend fun confirm(work: StepWork, shown: FlowState.Otp, code: String) {
        val id = work.verificationId ?: return
        mutableState.value = shown.copy(busy = true, error = null)
        otpRequest(work, shown) { api.confirmOtp(id, code) } ?: return
        if (process(work)) render()
    }

    /**
     * Runs a send or confirm. A refusal the screen explains comes back to [shown] with its reason
     * (C52.7); a limit refusal lets the user continue (C55.6); a verification the server confirmed
     * or submitted itself is re-read and continued from where it stands. Any other failure is the
     * error screen, whose retry re-reads the session rather than repeating a send that may have
     * gone out. `null` on failure.
     */
    private suspend fun <T> otpRequest(work: StepWork, shown: FlowState.Otp, request: suspend () -> T): T? = try {
        request()
    } catch (e: FlowApiException) {
        val problem = (e as? FlowApiException.Http)?.problem
        val refused = shown.copy(busy = false)
        val code = shown.code
        when (problem?.code) {
            FlowProblemCodes.OTP_DESTINATION_INVALID -> mutableState.value = refused.copy(code = null, error = OtpError.DESTINATION_INVALID)
            FlowProblemCodes.OTP_DESTINATION_NOT_ALLOWED -> mutableState.value = refused.copy(code = null, error = OtpError.DESTINATION_NOT_ALLOWED)
            // C64.1: back to the entry, where the user can check the destination.
            FlowProblemCodes.OTP_DELIVERY_FAILED -> mutableState.value = refused.copy(code = null, error = OtpError.DELIVERY_FAILED)
            FlowProblemCodes.OTP_INCORRECT -> mutableState.value = refused.copy(
                code = code?.copy(attemptsRemaining = problem.attemptsRemaining ?: code.attemptsRemaining?.let { (it - 1).coerceAtLeast(0) }),
                error = OtpError.CODE_INCORRECT,
            )
            FlowProblemCodes.OTP_EXPIRED -> mutableState.value = refused.copy(error = OtpError.CODE_EXPIRED)
            FlowProblemCodes.OTP_CODE_EXHAUSTED -> mutableState.value = refused.copy(code = code?.copy(attemptsRemaining = 0), error = OtpError.CODE_EXHAUSTED)
            FlowProblemCodes.OTP_NOT_SENT -> mutableState.value = refused.copy(code = null, error = OtpError.CODE_NOT_SENT)
            FlowProblemCodes.OTP_RESEND_TOO_SOON -> mutableState.value = refused.copy(
                code = code?.copy(resendAvailableAt = parseInstant(problem.resendAvailableAt) ?: code.resendAvailableAt),
                error = OtpError.RESEND_TOO_SOON,
            )
            // C55.7: a 429, or the 503 of the limit store being down.
            FlowProblemCodes.OTP_RATE_LIMITED -> mutableState.value = refused.copy(limited = true, error = null)
            // C55.4-C55.6: the verification was confirmed, or submitted after its last code or try.
            FlowProblemCodes.OTP_ALREADY_CONFIRMED, FlowProblemCodes.OTP_NOT_CONFIRMED, FlowProblemCodes.OTP_ATTEMPTS_EXHAUSTED -> movedOn(work.step)
            else -> failed(e, retry = ::load)
        }
        null
    } catch (_: IllegalArgumentException) {
        // A server value the client refused to use, such as a malformed verification ID.
        retryAction = null
        mutableState.value = FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = false)
        null
    }

    /**
     * The step moved on without this request (the server confirmed or submitted the verification
     * itself, or a 409 answered a call the server no longer takes): re-reads the session and renders
     * its position (C193.5).
     */
    private suspend fun movedOn(step: FlowStep) {
        mutableState.value = FlowState.Processing(step)
        adopt(call(retry = ::load) { api.getSession() } ?: return)
        render()
    }

    /** C55.6: submits a verification a limit refused, for review; see [continueAfterLimit]. */
    private suspend fun continueLimited(work: StepWork, shown: FlowState.Otp) {
        val id = work.verificationId ?: return
        mutableState.value = shown.copy(busy = true, error = null)
        try {
            api.submitVerification(id)
        } catch (_: FlowApiException.Conflict) {
            val session = call(retry = ::load) { api.getSession() } ?: return
            adopt(session)
            if (session.verifications.lastOrNull { it.id == id }?.attributes?.status == VerificationStatus.INITIATED) {
                mutableState.value = shown.copy(busy = false, error = OtpError.CONTINUE_REFUSED)
            } else {
                render()
            }
            return
        } catch (e: FlowApiException) {
            failed(e, retry = ::load)
            return
        }
        work.submitted = true
        if (process(work)) render()
    }

    /**
     * C40.2: creates (or reuses) the selfie verification, then a camera capture, and shows its
     * first prompt; the prompts come in the capture's order. It runs once the camera can be shown
     * (4B H014). A create that hits the capture cap (the verification was canceled) re-reads the
     * session.
     */
    private suspend fun startCapture(work: StepWork) {
        this.work = work
        mutableState.value = FlowState.Loading
        val created = call(
            retry = { startCapture(work) },
            restartOn = SelfieCaptureProtocol.CAPTURE_LIMIT_CODES,
            restart = { restartCapture(work) },
        ) {
            val id = work.verificationId ?: createVerification(work).also { work.verificationId = it }
            api.createSelfieCapture(id, CaptureMethod.CAMERA)
        } ?: return
        val capture = ActiveCapture(created, CaptureMethod.CAMERA, settings.timeSource.markNow())
        work.capture = capture
        mutableState.value = FlowState.Capture(
            work.step,
            capture.kinds.first(),
            0,
            capture.kinds.size,
            work.hints,
            uploadAllowed = work.uploadAllowed,
            restarted = work.restarted,
        )
    }

    /**
     * C40.3: sends the pose under review to its capture, before the next prompt shows; after the
     * last one, submits. A capture the device's clock says has expired gets no photo: a new capture
     * starts instead, as after a 409 that refuses the capture.
     */
    private suspend fun sendPose(work: StepWork, pose: FlowState.Capture) {
        val capture = checkNotNull(work.capture)
        if (capture.expired()) return restartCapture(work)
        mutableState.value = pose.copy(sending = true)
        call(
            retry = { sendPose(work, pose) },
            restartOn = SelfieCaptureProtocol.CAPTURE_REFUSED_CODES,
            restart = { restartCapture(work) },
        ) {
            val shot = work.shots[pose.kind]
            api.uploadFile(
                checkNotNull(work.verificationId),
                pose.kind,
                work.photos.getValue(pose.kind),
                capture.upload(pose.kind),
                captureMethodOf(work.step, picked = shot?.picked == true),
                shot?.trigger,
            )
        } ?: return
        val next = pose.index + 1
        if (next < capture.kinds.size) {
            mutableState.value = pose.copy(kind = capture.kinds[next], index = next, image = null, sending = false)
        } else if (process(work)) {
            render()
        }
    }

    /**
     * C19, C40.2: a photo picked from files cannot go to a camera capture. A new `upload` capture
     * replaces it (the server deletes the old capture's photos). Every capture prompts for `center`
     * first, so a photo picked for the first prompt is kept; on a later prompt they start again.
     */
    private suspend fun switchToUploads(work: StepWork, pose: FlowState.Capture) {
        mutableState.value = pose.copy(sending = true)
        val created = call(
            retry = { switchToUploads(work, pose) },
            restartOn = SelfieCaptureProtocol.CAPTURE_LIMIT_CODES,
            restart = { restartCapture(work) },
        ) {
            api.createSelfieCapture(checkNotNull(work.verificationId), CaptureMethod.UPLOAD)
        } ?: return
        val capture = ActiveCapture(created, CaptureMethod.UPLOAD, settings.timeSource.markNow())
        work.capture = capture
        if (pose.index == 0 && capture.kinds.first() == pose.kind) {
            capture.keep(pose.kind, checkNotNull(work.shot))
            sendPose(work, pose.copy(count = capture.kinds.size))
        } else {
            work.photos.clear()
            mutableState.value = FlowState.Capture(
                work.step,
                capture.kinds.first(),
                0,
                capture.kinds.size,
                pose.retryHints,
                uploadAllowed = pose.uploadAllowed,
                restarted = true,
            )
        }
    }

    /**
     * C40.4: the capture can take no more photos (a 409 such as `selfie_capture_invalid`, its
     * lifetime ran out, or the capture cap canceled the verification). Its photos are dropped, the
     * session says where the verification stands, and an initiated one gets a new capture whose
     * first prompt says why the photos are taken again.
     */
    private suspend fun restartCapture(work: StepWork) {
        work.photos.clear()
        work.capture = null
        mutableState.value = FlowState.Loading
        adopt(call(retry = ::load) { api.getSession() } ?: return)
        render(restarted = true)
    }

    /**
     * Creates (or reuses) the verification, uploads the photos not uploaded yet, submits, waits
     * for the decision and reloads the session. Each stage runs once, so a retry after an error
     * continues where the error happened. Returns false when it stopped on an error. A selfie's
     * poses are already with its capture, which the submit names (C40.4).
     */
    private suspend fun process(work: StepWork): Boolean {
        this.work = work
        mutableState.value = FlowState.Processing(work.step)
        val capture = work.capture
        val crypto = work.crypto
        val restartOn = when {
            capture != null -> SelfieCaptureProtocol.CAPTURE_REFUSED_CODES
            // C57.3: one 409 for a challenge that is unknown, used, superseded or expired.
            crypto != null -> setOf(FlowProblemCodes.CRYPTO_CHALLENGE_INVALID)
            else -> emptySet()
        }
        var resent = false
        val finished = call(
            retry = { if (process(work)) render() },
            restartOn = restartOn,
            restart = { if (crypto != null) cryptoRefusedUnlessLanded(work) else restartCapture(work) },
        ) {
            val id = work.verificationId ?: createVerification(work).also { work.verificationId = it }
            for (kind in work.kinds) {
                if (capture == null && kind !in work.uploaded) {
                    val shot = work.shots[kind]
                    api.uploadFile(
                        id,
                        kind,
                        work.photos.getValue(kind),
                        captureMethod = captureMethodOf(work.step, picked = shot?.picked == true),
                        captureTrigger = shot?.trigger,
                    )
                    work.uploaded += kind
                }
            }
            if (!work.submitted) {
                try {
                    if (crypto != null) api.submitCryptoSignature(id, crypto) else api.submitVerification(id, capture?.submission())
                } catch (conflict: FlowApiException.Conflict) {
                    if (conflict.problem?.code in restartOn) throw conflict
                    // C193.5 (P26): OkHttp may have resent a submit that landed; the session says.
                    resent = true
                    return@call false
                }
                work.submitted = true
            }
            api.pollVerification(id, settings.pollInterval, settings.pollAttempts)
            adopt(api.getSession())
            true
        }
        if (resent) {
            readAndRender()
            return false
        }
        if (finished == true) {
            // The photos are identity and biometric data: keep them no longer than needed.
            work.photos.clear()
            this.work = null
        }
        return finished == true
    }

    /**
     * C57.3, C193.5: a wallet submit answered `crypto_challenge_invalid`. When the session shows the
     * attempt submitted, an earlier send landed and its answer was lost, so the position is rendered;
     * otherwise the message expired or was replaced, and the entry asks for a new one.
     */
    private suspend fun cryptoRefusedUnlessLanded(work: StepWork) {
        val read = call(retry = ::load) { api.getSession() } ?: return
        adopt(read)
        val status = read.verifications.lastOrNull { it.id == work.verificationId }?.attributes?.status
        if (status != null && status != VerificationStatus.INITIATED) render() else cryptoRefused(work)
    }

    /**
     * Creates the verification of [work], at most once (Workflow 2D F018, as the web flow's
     * `submitVerification` does). The flow API has no idempotency key, so when the create's
     * outcome cannot be read, a second create would use up another attempt, and the session says
     * whether the first one was made. That is the case when the answer was lost
     * ([FlowApiException.Network]: no connection, an OkHttp timeout or a dropped connection), and
     * when it came back 2xx with a body the contract does not describe
     * ([FlowApiException.InvalidResponse], the 2E follow-up). When the session cannot be read
     * either, the original error stands and the next attempt reads it first. An answer that ends
     * the flow (C19) still ends it.
     */
    private suspend fun createVerification(work: StepWork): String {
        if (work.createUnconfirmed) {
            val created = initiatedVerification(work.type)
            work.createUnconfirmed = false
            if (created != null) return created
        }
        return try {
            api.createVerification(work.type).id
        } catch (unread: FlowApiException) {
            if (unread !is FlowApiException.Network && unread !is FlowApiException.InvalidResponse) throw unread
            work.createUnconfirmed = true
            val created = try {
                initiatedVerification(work.type)
            } catch (sessionError: FlowApiException) {
                throw if (endingFor(sessionError) != null) sessionError else unread
            }
            if (created == null) throw unread
            work.createUnconfirmed = false
            created
        }
    }

    /**
     * The newest verification of [type] when it is `initiated`: after a create whose answer was
     * lost or unreadable, the one that request made (one that existed before would have been
     * reused from the start, see [verificationState]).
     */
    private suspend fun initiatedVerification(type: VerificationType): String? =
        api.getSession().verifications
            .lastOrNull { it.verificationType == type }
            ?.takeIf { it.attributes.status == VerificationStatus.INITIATED }
            ?.id

    /**
     * Runs [request]; on failure shows the error and remembers [retry]. A 409 whose problem code
     * is in [restartOn] runs [restart] instead. `null` on failure.
     */
    private suspend fun <T> call(
        retry: suspend () -> Unit,
        restartOn: Set<String> = emptySet(),
        restart: suspend () -> Unit = {},
        request: suspend () -> T,
    ): T? = try {
        request()
    } catch (e: FlowApiException) {
        if (e is FlowApiException.Conflict && e.problem?.code in restartOn) restart() else failed(e, retry)
        null
    } catch (_: IllegalArgumentException) {
        // A server value the client refused to use, such as a malformed verification ID.
        retryAction = null
        mutableState.value = FlowState.Error(FlowError.INVALID_RESPONSE, canRetry = false)
        null
    }

    /**
     * C207 (Workflow 10C, contracts-10c's hook): the `nfc` step's work is `nfc-sdk`'s
     * [NfcStepController]; this is the coordinator's side of it. Its single-use routes follow
     * [failed] and [readAndRender], as every other step's (C193.5).
     */
    private val nfcController = NfcStepController(
        object : NfcStepHost {
            override val api: FlowApi get() = this@FlowCoordinator.api
            override val timeSource: TimeSource.WithComparableMarks get() = settings.timeSource

            override fun show(state: FlowState) {
                mutableState.value = state
            }

            override suspend fun readAndRender() = this@FlowCoordinator.readAndRender()

            override suspend fun failed(error: FlowApiException, retry: suspend () -> Unit) = this@FlowCoordinator.failed(error, retry)
        },
        nfcEnvironment,
    )

    /** C207: one event of the NFC step's screens (`FlowActions.nfc`), handled by `nfc-sdk`'s controller. */
    suspend fun nfc(event: NfcEvent) = nfcController.handle(event)

    /**
     * C238.7, C237.6 (Workflow 11A, clients-connect's hook): the `share_consent` step's exits and the
     * withdrawal affordance are `clients-connect`'s [ShareConsentController] (flow/ShareConsent.kt);
     * this is the coordinator's side of it. Its exits follow [failed] and [readAndRender], as every
     * other step's (C193.5).
     */
    private val shareConsents = ShareConsentController(
        object : ShareConsentHost {
            override val api: FlowApi get() = this@FlowCoordinator.api
            override val shown: FlowState get() = mutableState.value

            override fun show(state: FlowState) {
                mutableState.value = state
            }

            override suspend fun answered(session: FlowSession) {
                if (session.inquiry.id != inquiryId) {
                    retryAction = null
                    mutableState.value = FlowState.Error(FlowError.INQUIRY_MISMATCH, canRetry = false)
                    return
                }
                adopt(session)
                render()
            }

            override fun adopt(session: FlowSession) {
                if (session.inquiry.id == inquiryId) this@FlowCoordinator.adopt(session)
            }

            override suspend fun readAndRender() = this@FlowCoordinator.readAndRender()

            override suspend fun failed(error: FlowApiException, retry: suspend () -> Unit) = this@FlowCoordinator.failed(error, retry)
        },
    )

    /** C237.6 (V02): this session's withdrawable share consents, offered on every later screen. */
    val shareConsentWithdrawals: StateFlow<ShareConsentWithdrawals> get() = shareConsents.withdrawals

    /** C238.4: accepts the `share_consent` step shown, with the separate biometric tick. */
    suspend fun acceptShareConsent(biometricTicked: Boolean): Unit = exclusive { shareConsents.accept(biometricTicked) }

    /** C238.1: declines the `share_consent` step shown; the flow goes on. */
    suspend fun declineShareConsent(): Unit = exclusive { shareConsents.decline() }

    /** C237.6: withdraws the accepted share consent of [stepId]; the position never moves. */
    suspend fun withdrawShareConsent(stepId: String): Unit = exclusive { shareConsents.withdraw(stepId) }

    /**
     * C193.5: a 409 `flow_step_not_current` means the server's position moved on without this device
     * (another device, a wait that ended): the session is read and its position rendered, never an
     * error screen and never a retry of the call. Any other failure is [showError]'s.
     */
    private suspend fun failed(error: FlowApiException, retry: suspend () -> Unit) {
        if (error is FlowApiException.Conflict && error.problem?.code == FlowProblemCodes.FLOW_STEP_NOT_CURRENT) {
            readAndRender()
        } else {
            showError(error, retry)
        }
    }

    /** Reads the session and renders its position (C193.3, C193.5). */
    private suspend fun readAndRender() {
        mutableState.value = FlowState.Loading
        adopt(call(retry = ::load) { api.getSession() } ?: return)
        render()
    }

    private fun showError(error: FlowApiException, retry: suspend () -> Unit) {
        endingFor(error)?.let { ending ->
            retryAction = null
            mutableState.value = ending
            return
        }
        val (kind, canRetry) = when (error) {
            // LinkRefused and Redacted always end the flow above; listed for an exhaustive `when`.
            is FlowApiException.Unauthorized, is FlowApiException.LinkRefused, is FlowApiException.Redacted ->
                FlowError.SESSION_EXPIRED to false
            is FlowApiException.Forbidden, is FlowApiException.NotFound, is FlowApiException.Rejected ->
                FlowError.REJECTED to false
            is FlowApiException.Conflict -> FlowError.OUT_OF_SYNC to true
            is FlowApiException.RateLimited, is FlowApiException.Network -> FlowError.NETWORK to true
            is FlowApiException.ServerError, is FlowApiException.UnexpectedStatus -> FlowError.SERVER to true
            is FlowApiException.InvalidResponse -> FlowError.INVALID_RESPONSE to true
            is FlowApiException.StillProcessing -> FlowError.STILL_PROCESSING to true
        }
        retryAction = when {
            !canRetry -> null
            // The inquiry changed under us: re-read the session instead of repeating the call.
            error is FlowApiException.Conflict -> ::load
            else -> retry
        }
        mutableState.value = FlowState.Error(kind, canRetry)
    }

    /**
     * The final screen for an answer after which nothing can continue (C19), whatever call got
     * it; `null` for errors the error screen handles.
     */
    private fun endingFor(error: FlowApiException): FlowState? = when (error) {
        is FlowApiException.LinkRefused -> FlowState.LinkRefused
        is FlowApiException.Redacted -> FlowState.Redacted
        is FlowApiException.Unauthorized -> when (error.problem?.code) {
            SESSION_EXPIRED_CODE -> FlowState.SessionEnded(SessionEndReason.EXPIRED)
            SESSION_CANCELED_CODE -> canceledEnding(error.problem.reason)
            else -> null
        }
        else -> null
    }

    /**
     * The screen of a session canceled for [reason] (C25.8), as in the web flow: its inquiry
     * expired (the expired screen) or was redacted (the redacted screen). A finished inquiry, a
     * server that sends no reason, and a reason newer than this SDK show the ended screen.
     */
    private fun canceledEnding(reason: SessionCanceledReason?): FlowState = when (reason) {
        SessionCanceledReason.INQUIRY_EXPIRED -> FlowState.Expired
        SessionCanceledReason.INQUIRY_REDACTED -> FlowState.Redacted
        SessionCanceledReason.INQUIRY_FINISHED, SessionCanceledReason.UNKNOWN, null ->
            FlowState.SessionEnded(SessionEndReason.CANCELED)
    }

    private fun adopt(session: FlowSession) {
        this.session = session
        // C237.6 (Workflow 11A, clients-connect's hook): the session's withdrawable share consents.
        shareConsents.adopt(session)
        mutableSandbox.value = session.environment?.kind == EnvironmentKind.SANDBOX
        // C198.1 hook (android-theme): the theme the SDK applies for this session.
        mutableTheme.value = SessionTheme.of(session)
    }

    private fun unsupported(reason: String) = Resolution.Show(FlowState.Unsupported(reason))

    private fun documentKinds(step: GovernmentIdStep): List<FileKind> = when (step.sides) {
        DocumentSides.FRONT -> listOf(FileKind.FRONT)
        DocumentSides.BACK -> listOf(FileKind.BACK)
        DocumentSides.BOTH -> listOf(FileKind.FRONT, FileKind.BACK)
    }

    private fun selfieKinds(step: SelfieStep): List<FileKind> = step.poses.map(::fileKindOf)

    private sealed interface Resolution {
        data class Show(val state: FlowState) : Resolution
        class Process(val work: StepWork) : Resolution

        /**
         * [step]'s work on this device is done (decided or used up), or the server creates its
         * attempt itself (the silent AAMVA step, C59.6): read the session until the position moves.
         */
        data class Await(val step: FlowStep) : Resolution

        /** A selfie attempt needs its capture before the first prompt (C40.2). */
        class StartCapture(val work: StepWork) : Resolution

        /** A screen that needs its verification's guidance first: make the verification, then show it (C52.2). */
        class Open(val work: StepWork) : Resolution
    }

    /** Photos and server progress for one verification of a capture step. */
    private inner class StepWork(
        val step: FlowStep,
        val type: VerificationType,
        /** The photos to upload; a document step takes one only when the user chooses the camera. */
        var kinds: List<FileKind>,
        var verificationId: String?,
        /** Why the previous attempt failed, shown until the user leaves the step. */
        val hints: List<RetryHint> = emptyList(),
        /** Photos may be picked from files (C19). */
        val uploadAllowed: Boolean = false,
        /** The selfie capture before this one was replaced (C40.4). */
        val restarted: Boolean = false,
    ) {
        val photos = mutableMapOf<FileKind, CapturedImage>()
        val uploaded = mutableSetOf<FileKind>()
        var submitted = false

        /** A create got no answer, and the session has not shown yet whether it happened. */
        var createUnconfirmed = false

        /** The selfie capture the poses go to (C40.2); its window is published while this is the coordinator's work. */
        var capture: ActiveCapture? = null
            set(value) {
                field = value
                if (work === this) publishSelfieCapture()
            }

        /** C206: how each kept photo was taken (picked or the camera's, and its trigger), by kind. */
        val shots = mutableMapOf<FileKind, Shot>()

        /** The photo under review. */
        var shot: Shot? = null

        /** C55: where this attempt's last code went, for a resend; in memory only. */
        var destination: OtpDestination? = null

        /** C57.3: the pasted signature to submit, and the screen it came from. */
        var crypto: FlowCryptoSubmit? = null
        var cryptoShown: FlowState.CryptoWallet? = null

        /** C64.2: the document's screen the camera was opened from, to go back to. */
        var documentShown: FlowState.Document? = null
    }

    /**
     * The photo under review: picked from files or taken, what the camera reported, when, and the
     * client-reported trigger the capture screen gave it (C206.2).
     */
    private class Shot(val picked: Boolean, val camera: CameraFacts?, val takenAt: ComparableTimeMark, val trigger: CaptureTrigger? = null)

    /**
     * A selfie capture this coordinator created (C40.2). Its nonce lives here, in memory only: a
     * new process creates a new capture.
     */
    private class ActiveCapture(created: FlowSelfieCapture, val method: CaptureMethod, private val createdAt: ComparableTimeMark) {
        val id = created.id
        private val nonce = created.attributes.nonce

        /** The server's pose thresholds, which the selfie guidance reads (C204). */
        private val guidance = created.attributes.guidance

        /** The poses to take, in the server's order. */
        val kinds: List<FileKind> = created.attributes.prompts.map(::fileKindOf)

        private val takenAt = mutableMapOf<FileKind, ComparableTimeMark>()

        /** What the camera reported at its latest photo of this capture. */
        private var camera: CameraFacts? = null

        /**
         * When the server expires it, on this device's clock, which started after the server's: its
         * creation plus its lifetime, moved by each extension the server granted (C204.5).
         */
        var expiresAt: ComparableTimeMark = createdAt + SelfieCaptureProtocol.CAPTURE_TTL

        /** Whether the server has expired it. */
        fun expired(): Boolean = expiresAt.hasPassedNow()

        /** C204.5: what the coordinator exposes of it. */
        fun window(): SelfieCaptureWindow = SelfieCaptureWindow(id, expiresAt, guidance, extension)

        /** KP10-25: what became of the last request for more time on this capture; `null` when none was asked. */
        var extension: SelfieExtensionOutcome? = null

        /** Records when [kind]'s photo was taken, and what its camera reported. */
        fun keep(kind: FileKind, shot: Shot) {
            takenAt[kind] = shot.takenAt
            if (!shot.picked) camera = shot.camera ?: camera
        }

        /** C40.3: [kind]'s capture fields, with the time from the capture's creation to its shutter. */
        fun upload(kind: FileKind): SelfieCaptureUpload {
            val elapsed = (takenAt.getValue(kind) - createdAt).inWholeMilliseconds
            return SelfieCaptureUpload(id, nonce, elapsed.coerceIn(0, SelfieCaptureUpload.MAX_CLIENT_ELAPSED_MS))
        }

        /** C40.4: what submit names; a camera capture adds its device snapshot. */
        fun submission(): FlowSubmitCapture =
            FlowSubmitCapture(id, nonce, camera.toDeviceSnapshot().takeIf { method == CaptureMethod.CAMERA })
    }

    private companion object {
        /** Bounds how often one [render] works through a position the session does not move past. */
        const val MAX_PROCESSING_ROUNDS = 3

        /** The file kind a pose is uploaded as (C40.3 `SELFIE_POSE_FILE_KINDS`). */
        fun fileKindOf(pose: SelfiePose): FileKind = when (pose) {
            SelfiePose.CENTER -> FileKind.SELFIE_CENTER
            SelfiePose.LEFT -> FileKind.SELFIE_LEFT
            SelfiePose.RIGHT -> FileKind.SELFIE_RIGHT
        }

        /** C148.5: a screen submission's 422 names each refused value at `/values/<field>`. */
        const val SCREEN_VALUE_POINTER = "/values/"

        /** `code` of the 401 of an inactive session (C10 `FLOW_SESSION_INACTIVE_CODES`). */
        const val SESSION_EXPIRED_CODE = "session_expired"
        const val SESSION_CANCELED_CODE = "session_canceled"
    }
}
