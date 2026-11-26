package dev.openverify.sdk.ui

import android.Manifest
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.LifecycleResumeEffect
import dev.openverify.sdk.InquiryLaunchScope

/**
 * The CAMERA permission through the Activity Result API. A refusal survives a rotation, and the
 * permission is read again each time the screen resumes, since the user may grant it in Settings
 * and come back. KP10-14 (C192.2): inside a flow launch, each refusal at the system prompt is told
 * as `CameraPermission(granted = false)` through the launch's events; elsewhere nothing is told.
 */
@Composable
internal actual fun rememberCameraPermission(): CameraPermission {
    val context = LocalContext.current
    val grantedState = remember { mutableStateOf(context.hasCameraPermission()) }
    val deniedState = rememberSaveable { mutableStateOf(false) }
    val events = remember(context) { context.launchOwner()?.let(InquiryLaunchScope::of)?.events }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        grantedState.value = allowed
        deniedState.value = !allowed
        if (!allowed) events?.cameraDenied()
    }
    LifecycleResumeEffect(Unit) {
        grantedState.value = context.hasCameraPermission()
        onPauseOrDispose {}
    }
    return remember(context, launcher) {
        object : CameraPermission {
            override val available: Boolean = true
            override val granted: Boolean get() = grantedState.value
            override val denied: Boolean get() = deniedState.value

            override fun request() = launcher.launch(Manifest.permission.CAMERA)

            override fun openSettings() = context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
            )
        }
    }
}

/** The activity this composition runs in, as the owner of its view models; `null` outside one. */
private tailrec fun Context.launchOwner(): ViewModelStoreOwner? = when (this) {
    is ViewModelStoreOwner -> this
    is ContextWrapper -> baseContext.launchOwner()
    else -> null
}

private fun Context.hasCameraPermission(): Boolean =
    checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
