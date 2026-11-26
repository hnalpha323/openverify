package dev.openverify.sdk.nfc

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState

/** C207.5 (rule 17): nothing is built for iOS in this release; the iOS actual follows composition only. */
@Composable
internal actual fun WhileResumed(onResumed: () -> Unit, onPaused: () -> Unit) {
    val resumed by rememberUpdatedState(onResumed)
    val paused by rememberUpdatedState(onPaused)
    DisposableEffect(Unit) {
        resumed()
        onDispose { paused() }
    }
}
