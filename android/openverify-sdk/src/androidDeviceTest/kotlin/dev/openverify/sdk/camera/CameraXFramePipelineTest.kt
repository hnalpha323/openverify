package dev.openverify.sdk.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Point
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.display.DisplayManager
import android.os.Debug
import android.util.Log
import android.view.Display
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
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

/**
 * C201.2, C201.3, C219.5 (a device or an emulator only: the build host has none): the CameraX glue of the frame pipeline
 * on a real camera stack. The SDK logic each test relies on has its host twin over a fake binder
 * (`CameraXCapturePipelineTest`, `FrameAnalyzerTest`, `FrameSamplerTest`, `UseCaseBindingTest`); these
 * check only what needs the platform: three use cases bind together and frames arrive at the sampled
 * rate, the forced two-use-case fallback still takes the photo, and the barcode side's analysis size
 * with the copy cost of the review F11 alternative, measured on the device.
 */
@RunWith(AndroidJUnit4::class)
class CameraXFramePipelineTest {

    @get:Rule
    val permission: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.CAMERA)

    @get:Rule
    val compose = createComposeRule()

    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun backLens(): CameraLens {
        val back = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA)
        assumeTrue("This device has no back camera", back)
        return CameraLens.BACK
    }

    /** One received frame's facts; its pixels are read inside the callback only, as the guidance must. */
    private class Seen(val width: Int, val height: Int, val rotationDegrees: Int, val timestampNanos: Long, val bytesHeld: Int)

    /** Collects [camera]'s frames in the background until [stop]; each frame's facts, never its pixels. */
    private fun collect(camera: CaptureCamera, stop: AtomicBoolean, done: AtomicBoolean): CopyOnWriteArrayList<Seen> {
        val seen = CopyOnWriteArrayList<Seen>()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                camera.frames().collect { frame ->
                    if (!stop.get()) seen += Seen(frame.width, frame.height, frame.rotationDegrees, frame.timestampNanos, frame.bytes.size)
                }
            } finally {
                done.set(true)
            }
        }
        return seen
    }

    @Test
    fun threeUseCasesBindTogetherAndFramesArriveAtTheSampledRate() {
        val lens = backLens()
        val camera = CameraXCaptureCamera(context)
        val stop = AtomicBoolean(false)
        val done = AtomicBoolean(false)
        val seen = collect(camera, stop, done)

        compose.setContent { camera.Preview(lens, AnalysisTarget.DOCUMENT, Modifier.size(320.dp, 240.dp)) }
        compose.waitUntil(timeoutMillis = FIRST_FRAME_TIMEOUT_MS) { seen.isNotEmpty() || done.get() }
        assertTrue("analysis was not bound beside preview and capture: no frame arrived", seen.isNotEmpty())
        val start = seen.first().timestampNanos
        compose.waitUntil(timeoutMillis = WINDOW_MS + FIRST_FRAME_TIMEOUT_MS) { seen.last().timestampNanos - start >= WINDOW_MS * 1_000_000 }
        stop.set(true)

        val window = seen.filter { it.timestampNanos - start < WINDOW_MS * 1_000_000 }
        val seconds = WINDOW_MS / 1000
        Log.i(TAG, "frames in ${seconds}s: ${window.size}; size ${window.first().width}x${window.first().height}")
        assertTrue("at most guidance-hz a second: ${window.size} in $seconds s", window.size <= FrameSampler.GUIDANCE_HZ * seconds + 1)
        assertTrue("frames keep coming: ${window.size} in $seconds s", window.size >= seconds)
        window.zipWithNext { a, b -> b.timestampNanos - a.timestampNanos }.forEach { gap ->
            assertTrue("sampled frames are spaced by the interval: $gap ns", gap >= MIN_GAP_NANOS)
        }
        window.forEach { frame ->
            assertTrue("about 640 px wide: ${frame.width}x${frame.height}", maxOf(frame.width, frame.height) >= AnalysisTarget.DOCUMENT.longSidePx)
            assertTrue("RGBA, rows packed", frame.bytesHeld >= frame.width * frame.height * AnalysisFrame.BYTES_PER_PIXEL)
        }
    }

    @Test
    fun theForcedTwoUseCaseFallbackGivesNoFramesAndStillTakesThePhoto() {
        val lens = backLens()
        val camera = CameraXCaptureCamera(context, forceTwoUseCases = true)
        val stop = AtomicBoolean(false)
        val done = AtomicBoolean(false)
        val seen = collect(camera, stop, done)

        compose.setContent { camera.Preview(lens, AnalysisTarget.DOCUMENT, Modifier.size(320.dp, 240.dp)) }
        compose.waitUntil(timeoutMillis = FIRST_FRAME_TIMEOUT_MS) { done.get() }
        assertEquals("frames complete empty without analysis", 0, seen.size)

        // The manual shutter still works: captures fail until the preview has bound the camera, hence
        // the retries; CI emulators render the camera in software, hence the generous timeout.
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
        assertNotNull("The photo does not decode", BitmapFactory.decodeByteArray(image.bytes, 0, image.bytes.size))
    }

    /**
     * Review F11: a barcode-bearing side is read at 1,280 px or more, or at a full-resolution crop of
     * the guide area, whichever is cheaper. This binds the barcode analysis on the device, records the
     * size the camera gives, and measures on this device's CPU the copy of that frame against the copy
     * of the guide-area crop (90 % of the width at the card's shape) of the largest analysis size the
     * camera offers.
     *
     * KP10-21 (CI run 42762952128: 640 x 480 on the emulator, and no figure logged): every fact goes to
     * the log before any assertion about the size, so a run that fails still records them: the frame,
     * the sizes the camera offers, the display, the size CameraX's preview class allows there
     * ([AnalysisSizes.beside]), what the SDK knows a read on the frame can carry, and both copy costs.
     * The 1,280 px requirement is unchanged. The SDK must also know what it got: its [BarcodeRead] is
     * the frame's, and the frame is no smaller than the preview class allows.
     */
    @Test
    fun theBarcodeSideIsReadAtLeast1280WideAndItsCopyIsMeasuredAgainstAFullResolutionCrop() {
        val lens = backLens()
        val camera = CameraXCaptureCamera(context)
        val stop = AtomicBoolean(false)
        val done = AtomicBoolean(false)
        val seen = collect(camera, stop, done)

        compose.setContent { camera.Preview(lens, AnalysisTarget.BARCODE, Modifier.size(320.dp, 240.dp)) }
        compose.waitUntil(timeoutMillis = FIRST_FRAME_TIMEOUT_MS) { seen.isNotEmpty() || done.get() }
        stop.set(true)
        assertTrue("analysis was not bound for the barcode side", seen.isNotEmpty())
        val frame = seen.first()
        val offered = analysisSizes()
        val largest = offered.maxBy { it.area }
        val display = displaySize()
        val allowed = AnalysisSizes.beside(AnalysisTarget.BARCODE, offered, AnalysisSizes.previewBound(display))
        val known = camera.barcodeRead
        val longSide = maxOf(frame.width, frame.height)

        val cropWidth = (largest.width * GUIDE_WIDTH_SHARE).toInt()
        val cropHeight = (cropWidth / ID_CARD_ASPECT).toInt()
        val frameMs = copyCpuMs(frame.width, frame.height)
        val cropMs = copyCpuMs(cropWidth, cropHeight)
        Log.i(TAG, "barcode analysis ${frame.width}x${frame.height} rotation ${frame.rotationDegrees}: $frameMs ms a copy; guide crop ${cropWidth}x$cropHeight of $largest: $cropMs ms")
        Log.i(TAG, "barcode side: offered $offered; display $display; the preview class allows $allowed; the SDK knows $known")

        assertTrue("both copies were measured", frameMs > 0.0 && cropMs > 0.0)
        assertEquals("the SDK knows what a read on this frame can carry", AnalysisSizes.barcodeRead(frame.width, frame.height, frame.rotationDegrees), known)
        assertTrue(
            "the frame is no smaller than the preview class allows: ${frame.width}x${frame.height}, allowed $allowed",
            allowed == null || longSide >= minOf(AnalysisTarget.BARCODE.longSidePx, allowed.longSide),
        )
        assertTrue(
            "the barcode side is read at 1,280 px when the camera has it: ${frame.width}x${frame.height}, largest $largest",
            longSide >= minOf(AnalysisTarget.BARCODE.longSidePx, largest.longSide),
        )
        assertEquals("a frame of the barcode width is a stream", BarcodeRead.STREAM, known)
    }

    /** The YUV output sizes (the analysis stream's source) of the back camera, in the sensor's orientation. */
    private fun analysisSizes(): List<FrameSize> {
        val manager = context.getSystemService(CameraManager::class.java)
        val back = manager.cameraIdList.first { manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK }
        val map = checkNotNull(manager.getCameraCharacteristics(back).get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP))
        return map.getOutputSizes(ImageFormat.YUV_420_888).map { FrameSize(it.width, it.height) }
    }

    /** The default display's real size in pixels, as CameraX reads it for its preview class. */
    private fun displaySize(): FrameSize {
        val display = context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        val size = Point()
        @Suppress("DEPRECATION")
        display.getRealSize(size)
        return FrameSize(size.x, size.y)
    }

    /** This thread's CPU time for one [RgbaFrames.copy] of a [width] x [height] frame with padded rows, averaged over 30. */
    private fun copyCpuMs(width: Int, height: Int): Double {
        val rowStride = width * AnalysisFrame.BYTES_PER_PIXEL + 64
        val plane = ByteBuffer.allocateDirect(rowStride * height)
        val into = ByteArray(width * height * AnalysisFrame.BYTES_PER_PIXEL)
        repeat(5) { RgbaFrames.copy(plane, rowStride, AnalysisFrame.BYTES_PER_PIXEL, width, height, into) }
        val start = Debug.threadCpuTimeNanos()
        repeat(COPIES) { assertTrue(RgbaFrames.copy(plane, rowStride, AnalysisFrame.BYTES_PER_PIXEL, width, height, into)) }
        return (Debug.threadCpuTimeNanos() - start) / 1e6 / COPIES
    }

    private companion object {
        const val TAG = "OpenVerifyCameraTest"
        const val FIRST_FRAME_TIMEOUT_MS = 60_000L
        const val CAPTURE_TIMEOUT_MS = 120_000L
        const val RETRY_DELAY_MS = 250L
        const val WINDOW_MS = 4_000L
        const val COPIES = 30

        /** The 125 ms interval less one frame of a 15 fps camera, the slowest the sampler's schedule allows for. */
        const val MIN_GAP_NANOS = 125_000_000L - 66_666_667L

        /** The capture screen's card guide: 90 % of the width, at ID-1's shape (85.60 x 53.98 mm). */
        const val GUIDE_WIDTH_SHARE = 0.9
        const val ID_CARD_ASPECT = 85.60 / 53.98
    }
}
