package dev.openverify.sdk.ui

import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import java.util.WeakHashMap

/**
 * C201.5: sets `keepScreenOn` on the composition's view while this is composed. Each view counts its
 * holders, so a screen that leaves composition while another holder is shown (a transition, or a
 * capture screen's own holder) does not release the screen under the other.
 */
@Composable
internal actual fun KeepScreenOn() {
    val view = LocalView.current
    DisposableEffect(view) {
        ScreenOnHolders.hold(view)
        onDispose { ScreenOnHolders.release(view) }
    }
}

/** The holders of each view's `keepScreenOn`; touched only on the main thread, as composition is. */
private object ScreenOnHolders {
    private val holders = WeakHashMap<View, Int>()

    fun hold(view: View) {
        holders[view] = (holders[view] ?: 0) + 1
        view.keepScreenOn = true
    }

    fun release(view: View) {
        val left = (holders[view] ?: 1) - 1
        if (left > 0) {
            holders[view] = left
        } else {
            holders.remove(view)
            view.keepScreenOn = false
        }
    }
}
