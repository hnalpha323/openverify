package dev.openverify.sdk.ui

import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap

/** BitmapFactory decodes the photo; it returns `null` for bytes that are not an image. */
internal actual fun decodePreviewBitmap(bytes: ByteArray): ImageBitmap? =
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
