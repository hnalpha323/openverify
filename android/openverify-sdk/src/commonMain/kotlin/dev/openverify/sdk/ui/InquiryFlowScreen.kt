package dev.openverify.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import dev.openverify.sdk.camera.CaptureCamera
import dev.openverify.sdk.capture.selfie.SelfieCaptureExtension
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.ShareConsentState
import dev.openverify.sdk.model.AamvaStep
import dev.openverify.sdk.model.BusinessWebsiteStep
import dev.openverify.sdk.model.DatabaseBusinessStep
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.SelfieStep
import dev.openverify.sdk.ui.scaffold.StepScaffold
import dev.openverify.sdk.ui.screen.ScreenStepScreen
import dev.openverify.sdk.ui.steps.NfcStepScreen
import dev.openverify.sdk.ui.steps.AamvaStepScreen
import dev.openverify.sdk.ui.steps.BusinessWebsiteStepScreen
import dev.openverify.sdk.ui.steps.CryptoWalletStepScreen
import dev.openverify.sdk.ui.steps.DatabaseBusinessStepScreen
import dev.openverify.sdk.ui.steps.DatabaseStepScreen
import dev.openverify.sdk.ui.steps.DocumentStepScreen
import dev.openverify.sdk.ui.steps.OtpStepScreen
import dev.openverify.sdk.ui.steps.ProvideShareConsentWithdrawals
import dev.openverify.sdk.ui.steps.ShareConsentStepScreen
import kotlin.time.Clock

/**
 * Renders the screen for [state]. Capture screens, and the selfie step waiting for the camera
 * before its capture is created (4B H014), sit behind the camera permission. A sandbox
 * session (C19) shows its banner above every screen, and its captures can use [photoPicker].
 */
@Composable
internal fun InquiryFlowScreen(
    state: FlowState,
    camera: CaptureCamera,
    actions: FlowActions,
    modifier: Modifier = Modifier,
    sandbox: Boolean = false,
    photoPicker: PhotoPicker? = null,
    /** C64.2: how a document step's file is chosen; without one, only its camera path is offered. */
    documentPicker: DocumentPicker? = null,
    /** C64.2: what the user typed into a Phase 5 screen; the view model keeps it across rotations. */
    drafts: InputDrafts = remember { InputDrafts() },
    /** The phone and wallet steps count down to the server's times with it. */
    clock: Clock = Clock.System,
) {
    Surface(modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
            if (sandbox) {
                SandboxBanner()
            }
            Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
                // Review F04: every step's content is wrapped once (the help slot, the selector, C197.4).
                // C237.6 (Workflow 11A): the withdrawals the scaffold offers under every screen.
                ProvideShareConsentWithdrawals(actions) {
                    StepScaffold(state) {
                        FlowScreen(state, camera, actions, photoPicker, documentPicker, drafts, clock)
                    }
                }
            }
        }
    }
}

@Composable
private fun FlowScreen(
    state: FlowState,
    camera: CaptureCamera,
    actions: FlowActions,
    photoPicker: PhotoPicker?,
    documentPicker: DocumentPicker?,
    drafts: InputDrafts,
    clock: Clock,
) {
    val content = Modifier
    when (state) {
        FlowState.Loading -> LoadingScreen(content)
        is FlowState.Consent -> ConsentScreen(state, actions::acceptConsent, actions::cancel, content)
        is FlowState.Capture -> CameraPermissionGate(onCancel = actions::cancel) {
            Box(modifier = Modifier.fillMaxSize()) {
                CaptureScreen(
                    state = state,
                    camera = camera,
                    onCaptured = actions::capture,
                    onPicked = actions::pick,
                    onRetake = actions::retake,
                    onConfirm = actions::confirmCapture,
                    onCancel = actions::cancel,
                    modifier = content,
                    photoPicker = photoPicker,
                    // C64.2: a document's camera goes back to the document step.
                    onBack = if (state.step is DocumentStep) actions::backToDocument else null,
                )
                // C204.5 (Workflow 10B, foundation-10b's hook): the 2.2.1 warning and "more time" over a
                // selfie's capture screen (`capture/selfie/Extension.kt`, `selfie-guidance`'s).
                if (state.isSelfie) {
                    val window by actions.selfieCapture.collectAsState()
                    SelfieCaptureExtension(window, actions::extendSelfieCapture)
                }
            }
        }
        // The selfie capture is created only once the camera can be shown (4B H014).
        is FlowState.AwaitingCamera -> CameraPermissionGate(onCancel = actions::cancel) {
            LaunchedEffect(Unit) { actions.cameraReady() }
            LoadingScreen(content)
        }
        is FlowState.Processing -> ProcessingScreen(content, photos = state.step is GovernmentIdStep || state.step is SelfieStep)
        is FlowState.Completed -> CompletionScreen(state, actions::finish, content)
        is FlowState.Failed -> FailureScreen(state, actions::finish, content)
        FlowState.Expired -> ExpiredScreen(actions::finish, content)
        is FlowState.SessionEnded -> SessionEndedScreen(state, actions::finish, content)
        FlowState.Redacted -> RedactedScreen(actions::finish, content)
        FlowState.LinkRefused -> LinkRefusedScreen(actions::finish, content)
        is FlowState.Error -> ErrorScreen(state, actions::retry, actions::finish, content)
        is FlowState.Unsupported -> UnsupportedScreen(actions::finish, content, reason = state.reason)
        // C64.2: the Phase 5 steps (ui/steps/).
        is FlowState.Otp -> OtpStepScreen(state, drafts, actions, clock, content)
        is FlowState.Form -> when (state.step) {
            is AamvaStep -> AamvaStepScreen(state, drafts, actions, content)
            is DatabaseBusinessStep -> DatabaseBusinessStepScreen(state, drafts, actions, content)
            is BusinessWebsiteStep -> BusinessWebsiteStepScreen(state, drafts, actions, content)
            else -> DatabaseStepScreen(state, drafts, actions, content)
        }
        is FlowState.CryptoWallet -> CryptoWalletStepScreen(state, drafts, actions, clock, content)
        is FlowState.Document -> DocumentStepScreen(state, actions, documentPicker, content)
        // Workflow 10A (C195, C197.1, C197.2): the screen step (android-screens), the wait and the
        // halted state (android-driver).
        is FlowState.Screen -> ScreenStepScreen(state, actions, content)
        is FlowState.Waiting -> WaitingScreen(state, actions::cancel, content)
        // Workflow 10C (C207): the NFC step's screens (nfc-sdk's, ui/steps/NfcStepScreen.kt).
        is FlowState.Nfc -> NfcStepScreen(state, actions, content)
        // Workflow 11A (C238.7): the share-consent screen (clients-connect's, ui/steps/ShareConsentStep.kt).
        is ShareConsentState -> ShareConsentStepScreen(state.view, actions, content)
        FlowState.Halted -> HaltedScreen(actions::finish, content)
    }
}
