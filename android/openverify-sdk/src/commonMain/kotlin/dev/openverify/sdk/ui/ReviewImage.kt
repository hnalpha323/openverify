package dev.openverify.sdk.ui

import androidx.compose.ui.graphics.ImageBitmap

/**
 * The photo under review as a bitmap the capture screen can show, or `null` when [bytes] are not
 * an image this platform decodes. It decodes the whole image, so callers keep it off the main thread.
 */
internal expect fun decodePreviewBitmap(bytes: ByteArray): ImageBitmap?
