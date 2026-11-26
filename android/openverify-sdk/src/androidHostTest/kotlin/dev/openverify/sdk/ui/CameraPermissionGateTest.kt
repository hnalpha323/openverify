package dev.openverify.sdk.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.openverify.sdk.generated.resources.*
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class CameraPermissionGateTest {

    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private var canceled = 0

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private fun show() {
        rule.setContent {
            CameraPermissionGate(onCancel = { canceled++ }) { Text("camera content") }
        }
    }

    private fun answerPermissionRequest(granted: Boolean) {
        val request = shadowOf(rule.activity).lastRequestedPermission
        if (granted) shadowOf(rule.activity.application).grantPermissions(Manifest.permission.CAMERA)
        val result = if (granted) PackageManager.PERMISSION_GRANTED else PackageManager.PERMISSION_DENIED
        rule.runOnIdle {
            @Suppress("DEPRECATION")
            rule.activity.onRequestPermissionsResult(request.requestCode, request.requestedPermissions, intArrayOf(result))
        }
    }

    @Test
    fun `without permission it explains why before asking`() {
        show()

        rule.onNodeWithText(text(Res.string.openverify_camera_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_camera_rationale)).assertExists()
        rule.onNodeWithText("camera content").assertDoesNotExist()
        assertEquals(null, shadowOf(rule.activity).lastRequestedPermission)
    }

    @Test
    fun `allowing requests only the CAMERA permission`() {
        show()

        rule.onNodeWithText(text(Res.string.openverify_camera_allow)).performClick()

        assertArrayEquals(arrayOf(Manifest.permission.CAMERA), shadowOf(rule.activity).lastRequestedPermission.requestedPermissions)
    }

    @Test
    fun `once granted the camera content is shown`() {
        show()
        rule.onNodeWithText(text(Res.string.openverify_camera_allow)).performClick()

        answerPermissionRequest(granted = true)

        rule.onNodeWithText("camera content").assertExists()
        rule.onNodeWithText(text(Res.string.openverify_camera_rationale)).assertDoesNotExist()
    }

    @Test
    fun `an already granted permission goes straight to the camera`() {
        shadowOf(rule.activity.application).grantPermissions(Manifest.permission.CAMERA)

        show()

        rule.onNodeWithText("camera content").assertExists()
    }

    @Test
    fun `after a denial it points to Settings`() {
        show()
        rule.onNodeWithText(text(Res.string.openverify_camera_allow)).performClick()

        answerPermissionRequest(granted = false)
        rule.onNodeWithText(text(Res.string.openverify_camera_denied)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_camera_open_settings)).performClick()

        val started: Intent = shadowOf(rule.activity).nextStartedActivity
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, started.action)
        assertEquals(Uri.fromParts("package", rule.activity.packageName, null), started.data)
    }

    @Test
    fun `the user can stop instead`() {
        show()

        rule.onNodeWithText(text(Res.string.openverify_cancel)).performClick()

        assertEquals(1, canceled)
    }
}
