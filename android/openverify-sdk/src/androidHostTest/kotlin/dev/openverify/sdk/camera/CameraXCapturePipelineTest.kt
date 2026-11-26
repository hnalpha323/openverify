package dev.openverify.sdk.camera

import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.lifecycle.LifecycleOwner
import dev.openverify.sdk.events.EventingCaptureCamera
import dev.openverify.sdk.events.FlowEventTracker
import dev.openverify.sdk.events.FlowEvents
import android.util.Size
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C201.2, C201.3 (decision 17), the host twins of the camera's device tests: the preview binds
 * `Preview`, `ImageCapture` and `ImageAnalysis` in one call, the analysis at its target's size, RGBA,
 * keeping only the latest frame; when the three cannot be bound together (or the test hook says so),
 * preview and capture are bound alone and [CaptureCamera.frames] completes empty, so the step keeps
 * the manual shutter. The fake [CameraBinder] stands in for the camera stack the host does not have.
 */
@RunWith(RobolectricTestRunner::class)
internal class CameraXCapturePipelineTest {

    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    /** A camera stack that binds at most [most] use cases in one call; it records each call's use cases. */
    private class FakeBinder(private val most: Int) : CameraBinder {
        val calls = mutableListOf<List<UseCase>>()

        override fun bind(owner: LifecycleOwner, selector: CameraSelector, vararg useCases: UseCase): CameraFacts {
            calls += useCases.toList()
            if (useCases.size > most) throw IllegalArgumentException("No supported surface combination")
            return CameraFacts(lensFacing = LensFacing.BACK)
        }

        override fun unbind(vararg useCases: UseCase) = Unit

        override fun unbindAll() = Unit
    }

    /** Shows [camera]'s preview of an ID's back and answers whether its frames completed (with what). */
    private fun framesAfterBinding(
        camera: CaptureCamera,
        analysis: AnalysisTarget = AnalysisTarget.BARCODE,
        lens: CameraLens = CameraLens.BACK,
    ): CompletableDeferred<List<AnalysisFrame>> {
        val frames = CompletableDeferred<List<AnalysisFrame>>()
        CoroutineScope(Dispatchers.Unconfined).launch { frames.complete(camera.frames().toList()) }
        rule.setContent { camera.Preview(lens, analysis, Modifier.size(320.dp, 240.dp)) }
        rule.waitForIdle()
        return frames
    }

    private fun camera(binder: FakeBinder, forceTwoUseCases: Boolean = false) =
        CameraXCaptureCamera(rule.activity.applicationContext, forceTwoUseCases, binderOf = { binder })

    @Test
    fun `preview, the still and analysis are bound in one call, and frames keep coming`() {
        val binder = FakeBinder(most = 3)

        val frames = framesAfterBinding(camera(binder))

        assertEquals(listOf(3), binder.calls.map { it.size })
        val analysis = binder.calls.single().filterIsInstance<ImageAnalysis>().single()
        assertEquals(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888, analysis.outputImageFormat)
        assertEquals(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST, analysis.backpressureStrategy)
        assertFalse("the guidance keeps reading while the preview shows", frames.isCompleted)
        frames.cancel()
    }

    @Test
    fun `when three cannot be bound together, preview and the still are, and frames complete empty`() {
        val binder = FakeBinder(most = 2)

        val frames = framesAfterBinding(camera(binder))

        assertEquals(listOf(3, 2), binder.calls.map { it.size })
        assertTrue(binder.calls.last().none { it is ImageAnalysis })
        assertTrue(frames.isCompleted)
        assertEquals(emptyList<AnalysisFrame>(), frames.getCompleted())
    }

    @Test
    fun `the test hook forces the two-use-case fallback on a camera that could run three`() {
        val binder = FakeBinder(most = 3)

        val frames = framesAfterBinding(camera(binder, forceTwoUseCases = true))

        assertEquals(listOf(2), binder.calls.map { it.size })
        assertEquals(emptyList<AnalysisFrame>(), frames.getCompleted())
    }

    @Test
    fun `no camera at all gives no frames either`() {
        val frames = framesAfterBinding(camera(FakeBinder(most = 0)))

        assertEquals(emptyList<AnalysisFrame>(), frames.getCompleted())
    }

    @Test
    fun `the events wrapper passes the analysis size and the frames on`() {
        val binder = FakeBinder(most = 2)
        val wrapped = EventingCaptureCamera(camera(binder), FlowEventTracker("inq_01J9Z3V6Q8M1R2S3T4V5W6X7Y8", FlowEvents(null)))

        val frames = framesAfterBinding(wrapped)

        assertEquals(listOf(3, 2), binder.calls.map { it.size })
        assertEquals(emptyList<AnalysisFrame>(), frames.getCompleted())
    }

    @Test
    fun `each analysis target is asked for at its size, at the still's 4 to 3 shape`() {
        AnalysisTarget.entries.forEach { target ->
            val selector = checkNotNull(CameraXCaptureCamera.analysisUseCase(target).resolutionSelector) { "${target.name}: no resolution selector" }
            val strategy = checkNotNull(selector.resolutionStrategy)
            assertEquals(target.name, Size(target.longSidePx, target.shortSidePx), strategy.boundSize)
            assertEquals(target.name, AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY, selector.aspectRatioStrategy)
        }
    }

    /**
     * Phase 12A K1 (Workflow 12A capture-12a): a document's still is the sensor's largest 4:3 size up
     * to 4096 x 3072 (a 12-megapixel class still; a 50-megapixel one would be a 200 MB bitmap for an
     * upload capped at 4096 px), taken in quality mode; the live test uploaded 1920 x 1440 stills
     * taken in latency mode.
     */
    @Test
    fun `a document still is the largest 4 to 3 size up to 4096 x 3072, in quality mode`() {
        val still = CameraXCaptureCamera.stillUseCase(StillKind.DOCUMENT)

        assertEquals(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY, still.captureMode)
        val selector = checkNotNull(still.resolutionSelector)
        val strategy = checkNotNull(selector.resolutionStrategy)
        assertEquals(Size(4096, 3072), strategy.boundSize)
        assertEquals(ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER, strategy.fallbackRule)
        assertEquals(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY, selector.aspectRatioStrategy)
    }

    @Test
    fun `a selfie still keeps its 1920 x 1440 size in latency mode`() {
        val still = CameraXCaptureCamera.stillUseCase(StillKind.SELFIE)

        assertEquals(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY, still.captureMode)
        val strategy = checkNotNull(checkNotNull(still.resolutionSelector).resolutionStrategy)
        assertEquals(Size(1920, 1440), strategy.boundSize)
        assertEquals(ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER, strategy.fallbackRule)
    }

    @Test
    fun `each preview binds the still of what it shows - a card or a back the document's, a selfie its own`() {
        val modes = listOf(
            Triple(AnalysisTarget.DOCUMENT, CameraLens.BACK, ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY),
            Triple(AnalysisTarget.BARCODE, CameraLens.BACK, ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY),
            Triple(AnalysisTarget.SELFIE, CameraLens.FRONT, ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY),
        )
        val target = mutableStateOf(modes.first())
        val binder = FakeBinder(most = 3)
        val camera = camera(binder)
        rule.setContent {
            val (analysis, lens, _) = target.value
            camera.Preview(lens, analysis, Modifier.size(320.dp, 240.dp))
        }

        modes.forEach { mode ->
            rule.runOnIdle { target.value = mode }
            rule.waitForIdle()
            val still = binder.calls.last().filterIsInstance<ImageCapture>().single()
            assertEquals(mode.first.name, mode.third, still.captureMode)
            val analysis = binder.calls.last().filterIsInstance<ImageAnalysis>().single()
            assertEquals(mode.first.name, Size(mode.first.longSidePx, mode.first.shortSidePx), analysis.resolutionSelector?.resolutionStrategy?.boundSize)
        }
    }

    @Test
    fun `the still kind follows the analysis target`() {
        assertEquals(StillKind.DOCUMENT, StillKind.of(AnalysisTarget.DOCUMENT))
        assertEquals(StillKind.DOCUMENT, StillKind.of(AnalysisTarget.BARCODE))
        assertEquals(StillKind.SELFIE, StillKind.of(AnalysisTarget.SELFIE))
    }
}
