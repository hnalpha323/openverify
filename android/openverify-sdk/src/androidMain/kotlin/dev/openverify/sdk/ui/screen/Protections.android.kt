package dev.openverify.sdk.ui.screen

import android.os.Build
import android.view.MotionEvent
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput

internal actual fun platformApiLevel(): Int = Build.VERSION.SDK_INT

/**
 * As `View.filterTouchesWhenObscured`: an event whose window was obscured by another visible window
 * (`MotionEvent.FLAG_WINDOW_IS_OBSCURED`) is consumed before the control sees it, so a tap through an
 * overlay never presses it. A keyboard or an accessibility action is not a touch and still works.
 */
internal actual fun Modifier.dropObscuredTouches(): Modifier = pointerInput(Unit) {
    awaitPointerEventScope {
        while (true) {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val flags = event.motionEvent?.flags ?: 0
            if (flags and MotionEvent.FLAG_WINDOW_IS_OBSCURED != 0) event.changes.forEach { it.consume() }
        }
    }
}
