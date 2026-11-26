package dev.openverify.sdk.camera

/**
 * Whether [error] is the platform's out-of-memory error. Common Kotlin has no `OutOfMemoryError`
 * type, and a frame too large for the heap is dropped like any other capture failure
 * ([takePictureOrNull]).
 */
internal expect fun isOutOfMemory(error: Throwable): Boolean

/**
 * Whether the photos this platform's capture uploads are mirror images of the scene: the C40.4
 * device snapshot's `image-mirrored`, which says how the uploaded JPEG actually is.
 */
internal expect val CAPTURE_MIRRORS_IMAGES: Boolean
