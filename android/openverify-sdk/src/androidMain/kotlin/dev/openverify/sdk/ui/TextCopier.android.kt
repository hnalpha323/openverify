package dev.openverify.sdk.ui

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/** Puts the text on the system clipboard as plain text. */
@Composable
internal actual fun rememberTextCopier(): ((String) -> Unit)? {
    val context = LocalContext.current
    return remember(context) {
        { text: String ->
            context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(CLIP_LABEL, text))
        }
    }
}

/** The clip's label, which some keyboards show; never its content. */
private const val CLIP_LABEL = "OpenVerify"
