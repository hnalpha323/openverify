package dev.openverify.sdk.ui

import androidx.compose.runtime.Composable
import dev.openverify.sdk.camera.CapturedImage

/**
 * Lets the user pick a photo instead of taking one: the sandbox upload fallback (C19). The host
 * passes it in: the system photo picker on Android (`SystemPhotoPicker` in androidMain), PHPicker
 * on iOS from Phase 10; tests use a fake.
 */
internal interface PhotoPicker {
    /**
     * A function that opens the picker. [onPicked] gets the photo, ready to upload, or `null` when
     * the file cannot be used. Nothing is called when the user backs out.
     */
    @Composable
    fun rememberLauncher(onPicked: (CapturedImage?) -> Unit): () -> Unit
}
