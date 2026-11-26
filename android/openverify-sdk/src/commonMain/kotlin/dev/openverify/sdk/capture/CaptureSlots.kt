package dev.openverify.sdk.capture

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.flow.FlowState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The capture screen's slots (Workflow 10B Stage 1a, review F05): `capture-pipeline` wires them into
 * `ui/CaptureScreen.kt`, and the document and selfie owners implement them in their own packages
 * (`capture/document/`, `capture/selfie/`), so neither edits the screen. Guidance only (ADR 0009,
 * C202.5, C204.4): nothing a guidance measures is sent or decides anything.
 */

/**
 * C202.4, C204.3 (decision 19): takes the still exactly as the shutter would (the `ImageCapture`
 * photo, C201.6), uploaded with the client-reported `capture-trigger` `auto` (C206.2), and shows the
 * review as today. False when the camera could not take it; the shutter then becomes the primary
 * action. `capture-pipeline` implements it (`capture/AutoCapture.kt`).
 */
internal fun interface AutoCapture {
    suspend fun takeStill(): Boolean
}

/**
 * One capture screen's guidance: reads its frames, shows its overlay and decides when the still is
 * taken. Created per screen state, closed when the screen leaves it.
 */
internal interface CaptureGuidance : AutoCloseable {
    /**
     * Reads [frames] while the screen is shown (C201.2: sampled at `guidance-hz`, each valid only inside
     * this callback) and calls [autoCapture] when every gate held for `hold-ms`; returns when the flow
     * ends (C201.3: at once, empty, when the camera has no analysis).
     */
    suspend fun run(frames: Flow<AnalysisFrame>, autoCapture: AutoCapture)

    /** Whether the shutter is the primary action now (C202.4: after `manual-shutter-after-ms`, at once without frames, after a failed auto-capture). */
    val shutterPrimary: StateFlow<Boolean>

    /** Drawn over the preview, inside the guide: the hint, announced once per change (C202.3, C204.3), and any overlay (C203.3). */
    @Composable
    fun Overlay(modifier: Modifier)
}

/** Chooses the guidance of a capture state: the document owner's for an ID side or a document, the selfie owner's for a pose; null keeps today's screen. */
internal fun interface CaptureGuidanceFactory {
    fun create(state: FlowState.Capture): CaptureGuidance?
}
