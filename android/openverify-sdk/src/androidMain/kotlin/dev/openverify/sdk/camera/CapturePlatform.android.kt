package dev.openverify.sdk.camera

internal actual fun isOutOfMemory(error: Throwable): Boolean = error is OutOfMemoryError

/** CameraX hands over the sensor's frame unmirrored; `ImageEncodingTest` checks it on the pixels. */
internal actual val CAPTURE_MIRRORS_IMAGES: Boolean = ImageEncoding.MIRRORS_IMAGES
