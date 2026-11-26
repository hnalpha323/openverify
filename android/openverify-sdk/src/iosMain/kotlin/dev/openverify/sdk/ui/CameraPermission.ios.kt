package dev.openverify.sdk.ui

import androidx.compose.runtime.Composable

/**
 * There is no iOS camera capture before Phase 10, so the camera is reported as not available: the
 * gate says so and never shows a capture, and nothing claims a permission. Phase 10 asks
 * AVCaptureDevice for `.video` access here and opens `UIApplication.openSettingsURLString`.
 */
@Composable
internal actual fun rememberCameraPermission(): CameraPermission = CameraPermission.Unavailable
