package dev.openverify.sdk.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * C198.7: the activity's window draws edge to edge, so the bars sit over the SDK's surface; their
 * icons are dark over a light surface and light over a dark one. Set on every composition that
 * changes the answer; outside an activity (a preview) nothing is set.
 */
@Composable
internal actual fun SystemBarIcons(lightBackground: Boolean) {
    val view = LocalView.current
    if (view.isInEditMode) return
    val activity = view.context.activity() ?: return
    SideEffect {
        val controller = WindowCompat.getInsetsController(activity.window, view)
        controller.isAppearanceLightStatusBars = lightBackground
        controller.isAppearanceLightNavigationBars = lightBackground
    }
}

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}
