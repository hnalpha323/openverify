package dev.openverify.sdk.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.sdkString
import dev.openverify.sdk.ui.text.Text

/**
 * Shows [content] once the camera [permission] is granted. Before asking, it explains why the
 * camera is needed; the system prompt only appears when the user taps Allow. After a denial,
 * it also offers the app's Settings page. Where the platform has no camera capture yet, it says
 * the camera is not available and only lets the user stop.
 */
@Composable
internal fun CameraPermissionGate(
    onCancel: () -> Unit,
    permission: CameraPermission = rememberCameraPermission(),
    content: @Composable () -> Unit,
) {
    if (permission.available && permission.granted) {
        content()
        return
    }
    val message = when {
        !permission.available -> Res.string.openverify_camera_unavailable
        permission.denied -> Res.string.openverify_camera_denied
        else -> Res.string.openverify_camera_rationale
    }
    StatusLayout(title = sdkString(Res.string.openverify_camera_title), message = sdkString(message)) {
        if (permission.available) {
            Button(onClick = permission::request, modifier = Modifier.fillMaxWidth()) {
                Text(sdkString(Res.string.openverify_camera_allow))
            }
        }
        if (permission.available && permission.denied) {
            OutlinedButton(onClick = permission::openSettings, modifier = Modifier.fillMaxWidth()) {
                Text(sdkString(Res.string.openverify_camera_open_settings))
            }
        }
        TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
            Text(sdkString(Res.string.openverify_cancel))
        }
    }
}
