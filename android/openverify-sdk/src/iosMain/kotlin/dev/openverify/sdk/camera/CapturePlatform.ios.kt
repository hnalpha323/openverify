package dev.openverify.sdk.camera

/** Kotlin/Native's own `kotlin.OutOfMemoryError`; common Kotlin does not declare the type. */
internal actual fun isOutOfMemory(error: Throwable): Boolean = error is OutOfMemoryError

/**
 * There is no iOS capture yet (Phase 10). Like CameraX on Android, the AVFoundation capture is to
 * upload the sensor's frame unmirrored (the preview alone may be mirrored for the user), and a pixel
 * test like `ImageEncodingTest` is to pin it.
 */
internal actual val CAPTURE_MIRRORS_IMAGES: Boolean = false
