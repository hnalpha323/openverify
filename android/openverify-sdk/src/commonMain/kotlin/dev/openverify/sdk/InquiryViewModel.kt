package dev.openverify.sdk

import dev.openverify.sdk.nfc.NfcEvent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.capture.selfie.SelfieCaptureWindow
import dev.openverify.sdk.flow.DocumentError
import dev.openverify.sdk.flow.FlowCoordinator
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.PickedDocument
import dev.openverify.sdk.flow.ShareConsentWithdrawals
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.FlowTheme
import dev.openverify.sdk.model.FlowValue
import dev.openverify.sdk.model.InputField
import dev.openverify.sdk.model.OtpDestination
import dev.openverify.sdk.model.PersonField
import dev.openverify.sdk.ui.FlowActions
import dev.openverify.sdk.ui.InputDrafts
import dev.openverify.sdk.ui.screen.ScreenDrafts
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Keeps the [FlowCoordinator] across configuration changes and turns UI events into calls. */
internal class InquiryViewModel(
    private val coordinator: FlowCoordinator,
    private val inquiryId: String,
) : ViewModel(), FlowActions {

    val state: StateFlow<FlowState> = coordinator.state

    /** Whether the session runs in a sandbox (C19). */
    val sandbox: StateFlow<Boolean> = coordinator.sandbox

    /** C198.1: the session's theme (`null`: the built-in theme), for `android-theme`'s `OpenVerifyTheme`. */
    val theme: StateFlow<FlowTheme?> = coordinator.theme

    /** C204.5 (Workflow 10B hook): the open selfie capture's id and expiry, for `capture/selfie/Extension.kt`. */
    override val selfieCapture: StateFlow<SelfieCaptureWindow?> = coordinator.selfieCapture

    private val mutableResult = MutableStateFlow<InquiryResult?>(null)

    /** Set once, when the flow ends; the host screen (on Android, the activity) finishes with it. */
    val result: StateFlow<InquiryResult?> = mutableResult.asStateFlow()

    /**
     * C64.2: what the user typed into a phone, email, form or wallet screen. It lives here, so a
     * rotation keeps it without writing personal data to saved state, and is forgotten as soon as
     * the flow leaves the step's screens (C53.8).
     */
    val drafts: InputDrafts = InputDrafts()

    /**
     * C195.5: what the person typed into a `screen` step, kept here in memory only, so a rotation keeps
     * it without saved state (C213.2); the activity hands it to the screens through
     * `LocalScreenEnvironment` (Workflow 10A integration hook).
     */
    val screenDrafts: ScreenDrafts = ScreenDrafts()

    init {
        viewModelScope.launch { coordinator.start() }
        // The drafts stay while one step's screens, or a retry of one of their requests, are shown;
        // another step's screen, or any other state, forgets them. The state flow may skip the state
        // between two steps' screens, so the step is compared too.
        viewModelScope.launch {
            var shownStep: String? = null
            coordinator.state.collect { state ->
                val step = when (state) {
                    is FlowState.Otp -> state.step.id
                    is FlowState.Form -> state.step.id
                    is FlowState.CryptoWallet -> state.step.id
                    is FlowState.Screen -> state.step.id
                    else -> null
                }
                val retrying = state is FlowState.Error || state == FlowState.Loading
                if (step != null && step != shownStep || step == null && !retrying) {
                    drafts.clear()
                    screenDrafts.clear()
                }
                if (step != null || !retrying) shownStep = step
            }
        }
    }

    override fun acceptConsent(optionalTextKeys: Set<String>, locale: String?) {
        viewModelScope.launch { coordinator.acceptConsent(optionalTextKeys, locale) }
    }

    override fun cameraReady() {
        viewModelScope.launch { coordinator.cameraReady() }
    }

    override fun capture(image: CapturedImage, camera: CameraFacts?, trigger: CaptureTrigger?) = coordinator.capture(image, camera, trigger)

    override fun pick(image: CapturedImage) = coordinator.pick(image)

    override fun retake() = coordinator.retake()

    override fun confirmCapture() {
        viewModelScope.launch { coordinator.confirmCapture() }
    }

    override fun extendSelfieCapture() {
        viewModelScope.launch { coordinator.extendSelfieCapture() }
    }

    override fun nfc(event: NfcEvent) {
        viewModelScope.launch { coordinator.nfc(event) }
    }

    // C238.7, C237.6 (Workflow 11A, clients-connect's hook): the share-consent exits and the withdrawals.
    override val shareConsentWithdrawals: StateFlow<ShareConsentWithdrawals> = coordinator.shareConsentWithdrawals

    override fun acceptShareConsent(biometricTicked: Boolean) {
        viewModelScope.launch { coordinator.acceptShareConsent(biometricTicked) }
    }

    override fun declineShareConsent() {
        viewModelScope.launch { coordinator.declineShareConsent() }
    }

    override fun withdrawShareConsent(stepId: String) {
        viewModelScope.launch { coordinator.withdrawShareConsent(stepId) }
    }

    override fun retry() {
        viewModelScope.launch { coordinator.retry() }
    }

    override fun sendOtp(destination: OtpDestination) {
        viewModelScope.launch { coordinator.sendOtp(destination) }
    }

    override fun resendOtp() {
        viewModelScope.launch { coordinator.resendOtp() }
    }

    override fun confirmOtp(code: String) {
        viewModelScope.launch { coordinator.confirmOtp(code) }
    }

    override fun changeOtpDestination() = coordinator.changeOtpDestination()

    override fun continueAfterLimit() {
        viewModelScope.launch { coordinator.continueAfterLimit() }
    }

    override fun submitInputs(values: Map<InputField, String>, persons: List<Map<PersonField, String>>) {
        viewModelScope.launch { coordinator.submitInputs(values, persons) }
    }

    override fun pickDocument(document: PickedDocument) = coordinator.pickDocument(document)

    override fun refuseDocument(error: DocumentError) = coordinator.refuseDocument(error)

    override fun discardDocument() = coordinator.discardDocument()

    override fun submitDocument() {
        viewModelScope.launch { coordinator.submitDocument() }
    }

    override fun takeDocumentPhoto() = coordinator.takeDocumentPhoto()

    override fun backToDocument() = coordinator.backToDocument()

    override fun createCryptoChallenge(chainId: String, walletAddress: String) {
        viewModelScope.launch { coordinator.createCryptoChallenge(chainId, walletAddress) }
    }

    override fun submitCryptoSignature(signature: String, signedMessage: String?) {
        viewModelScope.launch { coordinator.submitCryptoSignature(signature, signedMessage) }
    }

    override fun changeCryptoWallet() = coordinator.changeCryptoWallet()

    override fun renewCryptoChallenge(walletAddress: String) {
        viewModelScope.launch { coordinator.renewCryptoChallenge(walletAddress) }
    }

    override fun submitScreen(values: Map<String, FlowValue>, button: String?) {
        viewModelScope.launch { coordinator.submitScreen(values, button) }
    }

    override fun finish() = end(InquiryOutcomes.forFinish(state.value, inquiryId))

    override fun cancel() = end(InquiryResult.Canceled(inquiryId))

    /** System back: a terminal screen reports its outcome; any other screen cancels. */
    fun back() = finish()

    private fun end(result: InquiryResult) {
        mutableResult.compareAndSet(null, result)
    }

    /** Each platform's factories extend it: Android's is in `InquiryViewModelFactory.kt` (androidMain). */
    companion object
}
