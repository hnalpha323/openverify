package dev.openverify.sdk.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.height
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import dev.openverify.sdk.camera.CameraXCaptureCamera
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.GovernmentIdStep
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * C212.2 (Workflow 10D, android-a11y-audit): the capture screen's scrolling frame over the real
 * CameraX preview. The host tests draw it over a fake camera (`A11ySweepTest`, `A11yShutterTest`);
 * only a device shows that the real viewfinder can be laid out in it. At the device's own font size
 * the preview has a height and the shutter is wholly on screen; at twice the font size the screen
 * is still laid out, with the shutter on its page.
 */
@RunWith(AndroidJUnit4::class)
class CaptureScreenLayoutDeviceTest {

    @get:Rule
    val permission: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.CAMERA)

    @get:Rule
    val compose = createComposeRule()

    private val front = FlowState.Capture(
        GovernmentIdStep("id", DocumentSides.BOTH, maxAttempts = 3, captureMethods = listOf(CaptureMethod.CAMERA)),
        FileKind.FRONT,
        index = 0,
        count = 2,
    )

    private fun show(fontScale: Float?) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val camera = CameraXCaptureCamera(context)
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale ?: density.fontScale)) {
                Surface {
                    CaptureScreen(front, camera, onCaptured = { _, _, _ -> }, onPicked = {}, onRetake = {}, onConfirm = {}, onCancel = {})
                }
            }
        }
        compose.waitForIdle()
    }

    private fun hasCamera(): Boolean =
        InstrumentationRegistry.getInstrumentation().targetContext.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

    @Test
    fun theRealPreviewIsLaidOutWithTheShutterOnScreen() {
        assertTrue("this device has no camera", hasCamera())
        show(fontScale = null)

        val root = compose.onRoot().getUnclippedBoundsInRoot()
        val preview = compose.onNodeWithTag(TestTags.PREVIEW).getUnclippedBoundsInRoot()
        val shutter = compose.onNodeWithTag(TestTags.CAPTURE_SHUTTER).assertIsEnabled().getUnclippedBoundsInRoot()

        assertTrue("the preview is ${preview.height} high", preview.height >= 120.dp)
        assertTrue("the shutter ends at ${shutter.bottom} in a window of ${root.height}", shutter.top >= 0.dp && shutter.bottom <= root.height)
        assertTrue("the preview at ${preview.top} to ${preview.bottom} is not above the shutter at ${shutter.top}", preview.bottom <= shutter.top)
    }

    @Test
    fun atTwiceTheFontSizeTheRealPreviewIsStillLaidOutAndTheShutterIsOnThePage() {
        assertTrue("this device has no camera", hasCamera())
        show(fontScale = 2f)

        val preview = compose.onNodeWithTag(TestTags.PREVIEW).getUnclippedBoundsInRoot()
        val shutter = compose.onNodeWithTag(TestTags.CAPTURE_SHUTTER).assertIsEnabled().getUnclippedBoundsInRoot()

        assertTrue("the preview is ${preview.height} high", preview.height >= 120.dp)
        assertTrue("the shutter is ${shutter.height} high", shutter.height >= 40.dp && preview.bottom <= shutter.top)
    }
}
