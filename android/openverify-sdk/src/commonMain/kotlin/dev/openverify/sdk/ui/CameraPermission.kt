package dev.openverify.sdk.ui

import androidx.compose.runtime.Composable

/**
 * The camera permission, as the capture screens need it (KMP plan K3). Each platform asks in its
 * own way: Android through the Activity Result API, iOS through AVCaptureDevice from Phase 10.
 * [CameraPermissionGate] explains why the camera is needed before [request] shows the system prompt.
 */
internal interface CameraPermission {
    /** Whether this platform can take photos at all; `false` only where there is no capture yet. */
    val available: Boolean

    /** The camera can be used. */
    val granted: Boolean

    /** The user refused the last request, so only the system settings can grant it now. */
    val denied: Boolean

    /** Shows the system prompt for the camera permission. */
    fun request()

    /** Opens this app's page in the system settings, where a refused permission can be granted. */
    fun openSettings()

    /**
     * A platform with no camera capture yet (iOS until Phase 10). It is never granted nor denied,
     * so the gate says the camera is not available and never shows a capture screen.
     */
    object Unavailable : CameraPermission {
        override val available: Boolean = false
        override val granted: Boolean = false
        override val denied: Boolean = false

        override fun request() = Unit

        override fun openSettings() = Unit
    }
}

/** This platform's camera permission, kept across recompositions and re-read when the screen resumes. */
@Composable
internal expect fun rememberCameraPermission(): CameraPermission
