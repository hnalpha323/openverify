package dev.openverify.sdk.camera

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import androidx.camera.core.CameraSelector
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

/**
 * Runs CameraX on a real device or emulator (CI only: there is no local emulator). JVM tests use
 * FakeCaptureCamera, so this is the only test of the CameraX glue itself.
 */
@RunWith(AndroidJUnit4::class)
class CameraXCaptureCameraTest {

    @get:Rule
    val permission: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.CAMERA)

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun takesAnUprightJpegAfterThePreviewStarts() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val packageManager = context.packageManager
        val lens = when {
            packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA) -> CameraLens.BACK
            packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FRONT) -> CameraLens.FRONT
            else -> null
        }
        assumeTrue("This device has no camera", lens != null)
        val camera = CameraXCaptureCamera(context)

        compose.setContent { camera.Preview(lens!!, Modifier.size(320.dp, 240.dp)) }
        // The v2 compose rule advances composition only while it waits, so the capture runs in the
        // background and waitUntil only polls: blocking inside the condition hung the run until the
        // job timed out (run 39410603628). Captures fail until the preview has bound the camera,
        // hence the retries. CI emulators render the camera in software, hence the generous timeout.
        val photo = AtomicReference<CapturedImage?>(null)
        val capture = CoroutineScope(Dispatchers.Default).launch {
            while (photo.get() == null) {
                try {
                    photo.set(camera.takePicture())
                } catch (_: CameraCaptureException) {
                    delay(RETRY_DELAY_MS)
                }
            }
        }
        try {
            compose.waitUntil(timeoutMillis = CAPTURE_TIMEOUT_MS) { photo.get() != null }
        } finally {
            capture.cancel()
        }
        val image = checkNotNull(photo.get())

        assertEquals("image/jpeg", image.mimeType)
        assertTrue(image.bytes.size <= CapturedImage.MAX_BYTES)
        val decoded = BitmapFactory.decodeByteArray(image.bytes, 0, image.bytes.size)
        assertNotNull("The photo does not decode", decoded)
        assertTrue(maxOf(decoded.width, decoded.height) <= ImageEncoding.MAX_DIMENSION)

        // C40.4: the bound camera's facts, as the selfie submit sends them.
        val facts = checkNotNull(camera.deviceFacts()) { "No camera facts after a photo" }
        val expectedFacing = if (lens == CameraLens.FRONT) CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK
        assertEquals(expectedFacing, facts.lensFacing)
        val (width, height) = checkNotNull(facts.width) to checkNotNull(facts.height)
        assertTrue(width > 0 && height > 0)
        assertEquals("the photo's orientation", decoded.width > decoded.height, width > height)
    }

    private companion object {
        const val CAPTURE_TIMEOUT_MS = 120_000L
        const val RETRY_DELAY_MS = 250L
    }
}
