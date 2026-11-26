package dev.openverify.sdk.nfc

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.compose.LifecycleResumeEffect

/** C207.5: the Android actual, over the activity's lifecycle (`ON_RESUME`, then `ON_PAUSE` or disposal). */
@Composable
internal actual fun WhileResumed(onResumed: () -> Unit, onPaused: () -> Unit) {
    val resumed by rememberUpdatedState(onResumed)
    val paused by rememberUpdatedState(onPaused)
    LifecycleResumeEffect(Unit) {
        resumed()
        onPauseOrDispose { paused() }
    }
}
