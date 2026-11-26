package dev.openverify.sdk.camera

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.UseCase
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ViewModelProvider
import dev.openverify.sdk.CaptureFailureReason
import dev.openverify.sdk.InquiryLaunchScope
import dev.openverify.sdk.OpenVerifyComponents
import dev.openverify.sdk.OpenVerifyEvent
import dev.openverify.sdk.events.EventingCaptureCamera
import dev.openverify.sdk.events.FlowEventTracker
import dev.openverify.sdk.events.FlowEvents
import dev.openverify.sdk.generated.resources.Res
import dev.openverify.sdk.generated.resources.openverify_camera_unavailable
import dev.openverify.sdk.ui.CameraPermission
import dev.openverify.sdk.ui.rememberCameraPermission
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * KP10-14 (C192.2; Workflow 10A Stage 3 android-sdk-api 11): the two camera events nothing emitted in
 * 10A. A refused camera permission tells `CameraPermission(granted = false)`, and a preview that could
 * bind no use case at all tells `CaptureFailed(CAMERA_UNAVAILABLE)`, each once per occurrence, through
 * the launch's events (the activity's [InquiryLaunchScope]), with nothing beyond the event's members.
 * A fallback to preview and capture without analysis (C201.3) is not a failure.
 */
@RunWith(RobolectricTestRunner::class)
internal class CameraEventsTest {

    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val received = mutableListOf<OpenVerifyEvent>()

    /** The launch's scope, as the flow activity makes it, holding a listener that records. */
    private fun launchScope(): InquiryLaunchScope = rule.runOnIdle {
        ViewModelProvider(rule.activity, InquiryLaunchScope.factory(INQUIRY_ID, OpenVerifyComponents(eventListener = { received += it })))[
            InquiryLaunchScope::class.java,
        ]
    }

    private lateinit var permission: CameraPermission

    private fun showPermission() {
        rule.setContent { permission = rememberCameraPermission() }
        rule.waitForIdle()
    }

    private fun refuseRequest() {
        rule.runOnIdle { permission.request() }
        val request = shadowOf(rule.activity).lastRequestedPermission
        rule.runOnIdle {
            @Suppress("DEPRECATION")
            rule.activity.onRequestPermissionsResult(request.requestCode, request.requestedPermissions, intArrayOf(PackageManager.PERMISSION_DENIED))
        }
        rule.waitForIdle()
    }

    @Test
    fun `a refused camera permission tells CameraPermission(false) once, through the launch's events`() {
        launchScope()
        showPermission()

        refuseRequest()

        assertEquals(listOf<OpenVerifyEvent>(OpenVerifyEvent.CameraPermission(granted = false)), received)
    }

    @Test
    fun `each refusal is its own occurrence`() {
        launchScope()
        showPermission()

        refuseRequest()
        refuseRequest()

        assertEquals(List<OpenVerifyEvent>(2) { OpenVerifyEvent.CameraPermission(granted = false) }, received)
    }

    @Test
    fun `a granted request tells no refusal`() {
        launchScope()
        showPermission()
        rule.runOnIdle { permission.request() }
        val request = shadowOf(rule.activity).lastRequestedPermission
        shadowOf(rule.activity.application).grantPermissions(Manifest.permission.CAMERA)

        rule.runOnIdle {
            @Suppress("DEPRECATION")
            rule.activity.onRequestPermissionsResult(request.requestCode, request.requestedPermissions, intArrayOf(PackageManager.PERMISSION_GRANTED))
        }
        rule.waitForIdle()

        assertEquals(emptyList<OpenVerifyEvent>(), received)
    }

    @Test
    fun `outside a flow launch a refusal builds no event and still shows as refused`() {
        showPermission()

        refuseRequest()

        assertEquals(true, rule.runOnIdle { permission.denied })
        assertEquals(emptyList<OpenVerifyEvent>(), received)
    }

    /** A camera stack that binds at most [most] use cases in one call, or none at all. */
    private class FakeBinder(private val most: Int) : CameraBinder {
        val bound = mutableListOf<Int>()

        override fun bind(owner: LifecycleOwner, selector: CameraSelector, vararg useCases: UseCase): CameraFacts {
            if (useCases.size > most) throw IllegalArgumentException("No supported surface combination")
            bound += useCases.size
            return CameraFacts(lensFacing = LensFacing.BACK)
        }

        override fun unbind(vararg useCases: UseCase) = Unit

        override fun unbindAll() = Unit
    }

    private fun showPreview(binder: FakeBinder) {
        val tracker = FlowEventTracker(INQUIRY_ID, FlowEvents({ received += it }))
        val camera = EventingCaptureCamera(CameraXCaptureCamera(rule.activity.applicationContext, binderOf = { binder }), tracker)
        rule.setContent { camera.Preview(CameraLens.BACK, Modifier.size(320.dp, 240.dp)) }
        rule.waitForIdle()
    }

    @Test
    fun `a preview that could bind no use case tells CaptureFailed(CAMERA_UNAVAILABLE) once, and says so`() {
        showPreview(FakeBinder(most = 0))

        assertEquals(listOf<OpenVerifyEvent>(OpenVerifyEvent.CaptureFailed(CaptureFailureReason.CAMERA_UNAVAILABLE)), received)
        rule.onNodeWithText(runBlocking { getString(Res.string.openverify_camera_unavailable) }).assertExists()
    }

    @Test
    fun `a fallback to preview and capture without analysis is not a failure`() {
        val binder = FakeBinder(most = 2)

        showPreview(binder)

        assertEquals(2, binder.bound.last())
        assertEquals(emptyList<OpenVerifyEvent>(), received)
    }

    private companion object {
        const val INQUIRY_ID = "inq_01J9Z3V6Q8M1R2S3T4V5W6X7Y8"
    }
}
