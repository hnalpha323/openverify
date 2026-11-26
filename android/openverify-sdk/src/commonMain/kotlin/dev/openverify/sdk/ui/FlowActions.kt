package dev.openverify.sdk.ui

import dev.openverify.sdk.nfc.NfcEvent
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.capture.selfie.SelfieCaptureWindow
import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.PickedDocument
import dev.openverify.sdk.flow.ShareConsentWithdrawals
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.PersonField
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What the flow screens can ask for. */
internal interface FlowActions {
    /**
     * Accepts the consent step, with the optional texts the user ticked (C42.3) and [locale], the
     * BCP 47 tag of the language the texts were shown in (C37). `null` records the flow's own.
     */
    fun acceptConsent(optionalTextKeys: Set<String>, locale: String? = null)

    /** The camera can be shown: its permission is granted (Workflow 4B H014). */
    fun cameraReady()

    /**
     * A camera photo, with what the camera reported about itself (C40.4) and the client-reported
     * [trigger] the capture screen gives it (C206.2: the shutter or the auto-capture; `null`: none).
     */
    fun capture(image: CapturedImage, camera: CameraFacts?, trigger: CaptureTrigger? = null)

    /** A photo the user picked from files instead (a sandbox, C19). */
    fun pick(image: CapturedImage)

    fun retake()

    fun confirmCapture()

    fun retry()

    /** Ends the flow from a terminal screen, reporting its outcome. */
    fun finish()

    /** The user stopped before the flow ended. */
    fun cancel()

    /** C55: sends a code to [destination]. */
    fun sendOtp(destination: OtpDestination)

    /** C55.6: sends a new code to the open code's destination. */
    fun resendOtp()

    /** C55.5: confirms the code the user typed. */
    fun confirmOtp(code: String)

    /** C64.1: back to the destination entry. */
    fun changeOtpDestination()

    /** C55.6: continues to review after a limit refusal. */
    fun continueAfterLimit()

    /**
     * C52.3: the values a database, AAMVA, business registry or website form entered; a business
     * form's [persons] are its associated persons, each by its fields.
     */
    fun submitInputs(values: Map<InputField, String>, persons: List<Map<PersonField, String>> = emptyList())

    /** C64.2: a document the user picked. */
    fun pickDocument(document: PickedDocument)

    /** C64.2: the picker could not use the chosen file. */
    fun refuseDocument(error: DocumentError)

    /** C64.2: forgets the picked document, to choose another. */
    fun discardDocument()

    /** C52.4: uploads the picked document and submits it. */
    fun submitDocument()

    /** C64.2: takes a photo of the document with the camera instead. */
    fun takeDocumentPhoto()

    /** C64.2: back from the document's camera to its screen. */
    fun backToDocument()

    /** C57.2: asks for the message to sign for [walletAddress] on [chainId]. */
    fun createCryptoChallenge(chainId: String, walletAddress: String)

    /** C57.3: the pasted signature, and the signed message a Solana wallet may show. */
    fun submitCryptoSignature(signature: String, signedMessage: String?)

    /** C64.1: back to the chain and address entry. */
    fun changeCryptoWallet()

    /**
     * C57.2: a new message for the same chain and [walletAddress], replacing the open one (the expired
     * message's own button; audit gap K9).
     */
    fun renewCryptoChallenge(walletAddress: String)

    /**
     * C148.5, C195.7: submits the shown screen's [values] by field key (personal data, kept in memory
     * only) through the pressed button's [button] key, `null` for the primary button (port `next`).
     * The default does nothing, for test doubles; the view model sends it through the driver.
     */
    fun submitScreen(values: Map<String, FlowValue>, button: String?) {}

    /**
     * C204.5 (Workflow 10B, foundation-10b's hook): the open selfie capture's id and expiry, `null` while
     * none is open; the selfie's capture screen shows `capture/selfie/Extension.kt`'s warning over it. The
     * default is never open, for test doubles.
     */
    val selfieCapture: StateFlow<SelfieCaptureWindow?> get() = NO_SELFIE_CAPTURE

    /** C204.5: asks for more time on the open selfie capture. The default does nothing, for test doubles. */
    fun extendSelfieCapture() {}

    /**
     * C207 (Workflow 10C, contracts-10c's hook): one event of the NFC step's screens, handled by
     * `nfc-sdk`'s `NfcStepController` through the coordinator. The default does nothing, for test doubles.
     */
    fun nfc(event: NfcEvent) {}

    /**
     * C238.7 (Workflow 11A, clients-connect's hook): accepts the `share_consent` step shown, with the
     * separate biometric tick. The default does nothing, for test doubles.
     */
    fun acceptShareConsent(biometricTicked: Boolean) {}

    /** C238.1: declines the `share_consent` step shown; the flow goes on. The default does nothing. */
    fun declineShareConsent() {}

    /** C237.6: withdraws this session's accepted share consent of [stepId]. The default does nothing. */
    fun withdrawShareConsent(stepId: String) {}

    /**
     * C237.6 (V02): this session's withdrawable share consents, which every later screen offers to
     * withdraw ([dev.openverify.sdk.ui.scaffold.StepScaffold]'s hook). The default lists none.
     */
    val shareConsentWithdrawals: StateFlow<ShareConsentWithdrawals> get() = NO_SHARE_CONSENT_WITHDRAWALS
}

private val NO_SHARE_CONSENT_WITHDRAWALS: StateFlow<ShareConsentWithdrawals> =
    MutableStateFlow(ShareConsentWithdrawals.NONE).asStateFlow()

private val NO_SELFIE_CAPTURE: StateFlow<SelfieCaptureWindow?> = MutableStateFlow<SelfieCaptureWindow?>(null).asStateFlow()
