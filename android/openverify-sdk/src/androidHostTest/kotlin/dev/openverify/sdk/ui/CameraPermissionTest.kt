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
import androidx.lifecycle.Lifecycle
import dev.openverify.sdk.generated.resources.*
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * The camera permission seam (KMP plan K3): on Android, [rememberCameraPermission] asks for CAMERA
 * through the Activity Result API, sees a refusal, opens the app's settings, and re-reads the
 * permission when the screen comes back. A platform without a capture yet never shows one.
 */
@RunWith(RobolectricTestRunner::class)
class CameraPermissionTest {

    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private lateinit var permission: CameraPermission

    private fun text(res: StringResource) = runBlocking { getString(res) }

    private fun show() {
        rule.setContent { permission = rememberCameraPermission() }
        rule.waitForIdle()
    }

    private fun granted() = rule.runOnIdle { permission.granted }

    private fun denied() = rule.runOnIdle { permission.denied }

    private fun answerRequest(granted: Boolean) {
        val request = shadowOf(rule.activity).lastRequestedPermission
        if (granted) shadowOf(rule.activity.application).grantPermissions(Manifest.permission.CAMERA)
        val result = if (granted) PackageManager.PERMISSION_GRANTED else PackageManager.PERMISSION_DENIED
        rule.runOnIdle {
            @Suppress("DEPRECATION")
            rule.activity.onRequestPermissionsResult(request.requestCode, request.requestedPermissions, intArrayOf(result))
        }
    }

    @Test
    fun `before it is asked for, the camera is neither granted nor refused, and nothing is requested`() {
        show()

        assertTrue(rule.runOnIdle { permission.available })
        assertFalse(granted())
        assertFalse(denied())
        assertNull(shadowOf(rule.activity).lastRequestedPermission)
    }

    @Test
    fun `request asks the system for the CAMERA permission only`() {
        show()

        rule.runOnIdle { permission.request() }

        assertArrayEquals(arrayOf(Manifest.permission.CAMERA), shadowOf(rule.activity).lastRequestedPermission.requestedPermissions)
    }

    @Test
    fun `a granted request grants the camera`() {
        show()
        rule.runOnIdle { permission.request() }

        answerRequest(granted = true)

        assertTrue(granted())
        assertFalse(denied())
    }

    @Test
    fun `a refused request is denied`() {
        show()
        rule.runOnIdle { permission.request() }

        answerRequest(granted = false)

        assertFalse(granted())
        assertTrue(denied())
    }

    @Test
    fun `openSettings opens this app's page in the system settings`() {
        show()

        rule.runOnIdle { permission.openSettings() }

        val started: Intent = shadowOf(rule.activity).nextStartedActivity
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, started.action)
        assertEquals(Uri.fromParts("package", rule.activity.packageName, null), started.data)
    }

    @Test
    fun `a permission granted before the screen opens is granted at once`() {
        shadowOf(rule.activity.application).grantPermissions(Manifest.permission.CAMERA)

        show()

        assertTrue(granted())
    }

    @Test
    fun `a permission granted in Settings is seen when the screen comes back`() {
        show()
        rule.activityRule.scenario.moveToState(Lifecycle.State.STARTED)
        shadowOf(rule.activity.application).grantPermissions(Manifest.permission.CAMERA)

        rule.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)

        assertTrue(granted())
    }

    @Test
    fun `on a platform without a camera the gate says so, never shows the camera and only lets the user stop`() {
        var canceled = 0
        rule.setContent {
            CameraPermissionGate(onCancel = { canceled++ }, permission = CameraPermission.Unavailable) { Text("camera content") }
        }

        rule.onNodeWithText(text(Res.string.openverify_camera_unavailable)).assertExists()
        rule.onNodeWithText("camera content").assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_camera_allow)).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_cancel)).performClick()
        assertEquals(1, canceled)
        assertNull(shadowOf(rule.activity).lastRequestedPermission)
    }
}
