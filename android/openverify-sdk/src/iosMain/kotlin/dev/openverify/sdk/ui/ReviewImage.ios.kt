package dev.openverify.sdk.ui

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import org.jetbrains.skia.Image

/**
 * Skia, which draws Compose Multiplatform on iOS, decodes the photo. It throws for bytes it cannot
 * decode, which become `null` as on Android.
 */
internal actual fun decodePreviewBitmap(bytes: ByteArray): ImageBitmap? = try {
    Image.makeFromEncoded(bytes).toComposeImageBitmap()
} catch (_: Exception) {
    null
}
