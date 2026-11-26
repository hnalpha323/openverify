package dev.openverify.sdk.camera

internal actual fun outOfMemoryError(): Throwable = OutOfMemoryError("a frame too large for the heap")
