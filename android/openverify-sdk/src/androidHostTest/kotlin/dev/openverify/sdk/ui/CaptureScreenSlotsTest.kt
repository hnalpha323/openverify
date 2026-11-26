package dev.openverify.sdk.ui

import android.view.View
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.AnalysisTarget
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CameraLens
import dev.openverify.sdk.camera.CaptureCamera
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.camera.PixelLayout
import dev.openverify.sdk.capture.AutoCapture
import dev.openverify.sdk.capture.CaptureGuidance
import dev.openverify.sdk.capture.CaptureGuidanceFactory
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.RetryHint
import dev.openverify.sdk.ui.screen.LocalPlatformApiLevel
import dev.openverify.sdk.ui.screen.ObscuredTouchesFiltered
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The capture screen's slots (Workflow 10B Stage 1a's `CaptureSlots.kt`), wired by capture-pipeline:
 * the guidance a [CaptureGuidanceFactory] gives for the state reads the camera's analysis frames (C201),
 * draws its overlay over the preview, takes the still through [AutoCapture] as `auto` (C206.2) with the
 * review shown as today, and says when the shutter is the primary action (C202.4); the preview binds the
 * analysis size of the photo it takes (C201.2). Every capture screen keeps the screen on (C201.5), and
 * on API 26 to 30 the controls that take, pick or keep a photo drop touches through an overlay (C213.1).
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w360dp-h1400dp")
class CaptureScreenSlotsTest {

    @get:Rule
    val rule = createComposeRule()

    private val idStep = FakeFlowApi.DEFAULT_FLOW.steps[1]
    private val selfieStep = FakeFlowApi.DEFAULT_FLOW.steps[2]
    private val documentStep = DocumentStep("bill", listOf(DocumentClass.UTILITY_BILL), captureMethods = listOf(CaptureMethod.CAMERA))
    private val front = FlowState.Capture(idStep, FileKind.FRONT, index = 0, count = 2)
    private val back = front.copy(kind = FileKind.BACK, index = 1)
    private val selfie = FlowState.Capture(selfieStep, FileKind.SELFIE_CENTER, index = 0, count = 3)
    private val page = FlowState.Capture(documentStep, FileKind.DOCUMENT, index = 0, count = 1)

    private fun text(res: StringResource) = runBlocking { getString(res) }

    /** A camera whose analysis gives [frames]; it records the analysis size each preview asked for. */
    private class AnalysingCamera(private val frames: Flow<AnalysisFrame> = flowOf(frame())) : CaptureCamera {
        val targets = mutableListOf<AnalysisTarget>()
        var picturesTaken = 0
        var failing = false

        @Composable
        override fun Preview(lens: CameraLens, modifier: Modifier) = Box(modifier)

        @Composable
        override fun Preview(lens: CameraLens, analysis: AnalysisTarget, modifier: Modifier) {
            androidx.compose.runtime.LaunchedEffect(analysis) { targets += analysis }
            Box(modifier)
        }

        override suspend fun takePicture(): CapturedImage {
            picturesTaken += 1
            if (failing) throw dev.openverify.sdk.camera.CameraCaptureException("no frame")
            return testJpeg()
        }

        override fun frames(): Flow<AnalysisFrame> = frames
    }

    /** A guidance that records what it reads, auto-captures on its first frame when [autoOnFirstFrame], and draws a tagged overlay. */
    private class FakeGuidance(private val autoOnFirstFrame: Boolean, primary: Boolean = false) : CaptureGuidance {
        val read = mutableListOf<Long>()
        val autoResults = mutableListOf<Boolean>()
        var closed = 0
        val primaryState = MutableStateFlow(primary)

        override suspend fun run(frames: Flow<AnalysisFrame>, autoCapture: AutoCapture) {
            frames.collect { frame ->
                read += frame.timestampNanos
                if (autoOnFirstFrame && autoResults.isEmpty()) {
                    val taken = autoCapture.takeStill()
                    autoResults += taken
                    if (!taken) primaryState.value = true
                }
            }
        }

        override val shutterPrimary: StateFlow<Boolean> get() = primaryState.asStateFlow()

        @Composable
        override fun Overlay(modifier: Modifier) = Box(modifier.testTag(OVERLAY))

        override fun close() {
            closed += 1
        }
    }

    private class Factory(private val guidance: () -> CaptureGuidance?) : CaptureGuidanceFactory {
        val asked = mutableListOf<FlowState.Capture>()

        override fun create(state: FlowState.Capture): CaptureGuidance? {
            asked += state
            return guidance()
        }
    }

    private val triggers = mutableListOf<CaptureTrigger?>()
    private val captured = mutableListOf<CapturedImage>()

    @Composable
    private fun Screen(state: FlowState.Capture, camera: CaptureCamera, factory: CaptureGuidanceFactory?, photoPicker: PhotoPicker? = null) {
        CaptureScreen(
            state = state,
            camera = camera,
            onCaptured = { image, _: CameraFacts?, trigger ->
                captured += image
                triggers += trigger
            },
            onPicked = {},
            onRetake = {},
            onConfirm = {},
            onCancel = {},
            photoPicker = photoPicker,
            guidance = factory,
        )
    }

    private fun shutter() = rule.onNodeWithText(text(Res.string.openverify_capture_take))

    @Test
    fun `the guidance reads the camera's frames and draws its overlay over the preview`() {
        val guidance = FakeGuidance(autoOnFirstFrame = false)
        val factory = Factory { guidance }

        rule.setContent { Screen(front, AnalysingCamera(), factory) }
        rule.waitForIdle()

        assertEquals(listOf(front), factory.asked)
        assertEquals(listOf(FRAME_TIME), guidance.read)
        rule.onNodeWithTag(OVERLAY).assertExists()
    }

    @Test
    fun `an auto-capture takes the still, reported as auto, and the review shows as today`() {
        val guidance = FakeGuidance(autoOnFirstFrame = true)
        val camera = AnalysingCamera()

        rule.setContent { Screen(front, camera, Factory { guidance }) }
        rule.waitForIdle()

        assertEquals(listOf(true), guidance.autoResults)
        assertEquals(1, camera.picturesTaken)
        assertEquals(listOf<CaptureTrigger?>(CaptureTrigger.AUTO), triggers)
        assertEquals(1, captured.size)
    }

    @Test
    fun `a failed auto-capture answers false, says so, and the guidance promotes the shutter`() {
        val guidance = FakeGuidance(autoOnFirstFrame = true)
        val camera = AnalysingCamera().also { it.failing = true }

        rule.setContent { Screen(front, camera, Factory { guidance }) }
        rule.waitForIdle()

        assertEquals(listOf(false), guidance.autoResults)
        assertEquals(emptyList<CaptureTrigger?>(), triggers)
        rule.onNodeWithText(text(Res.string.openverify_capture_failed)).assertExists()
        shutter().assert(SemanticsMatcher.expectValue(CaptureShutterPrimary, true))
    }

    @Test
    fun `the shutter is always on screen, secondary while the guidance works and primary when it says so`() {
        val guidance = FakeGuidance(autoOnFirstFrame = false)
        rule.setContent { Screen(front, AnalysingCamera(), Factory { guidance }) }

        shutter().assert(SemanticsMatcher.expectValue(CaptureShutterPrimary, false))
        guidance.primaryState.value = true
        rule.waitForIdle()
        shutter().assert(SemanticsMatcher.expectValue(CaptureShutterPrimary, true))

        shutter().performClick()
        rule.waitForIdle()
        assertEquals(listOf<CaptureTrigger?>(CaptureTrigger.MANUAL), triggers)
    }

    @Test
    fun `without a guidance the screen is today's, with the shutter primary`() {
        rule.setContent { Screen(front, AnalysingCamera(), factory = null) }

        shutter().assert(SemanticsMatcher.expectValue(CaptureShutterPrimary, true))
        rule.onNodeWithTag(OVERLAY).assertDoesNotExist()
    }

    @Test
    fun `the guidance ends with its state, is closed, and none runs over the review`() {
        val made = mutableListOf<FakeGuidance>()
        val factory = Factory { FakeGuidance(autoOnFirstFrame = false).also { made += it } }
        var state by mutableStateOf(front)
        rule.setContent { Screen(state, AnalysingCamera(), factory) }
        rule.waitForIdle()
        assertEquals(1, made.size)

        state = front.copy(image = testJpeg())
        rule.waitForIdle()
        assertEquals(1, made.single().closed)
        assertEquals("no guidance for the review", 1, factory.asked.size)

        state = back
        rule.waitForIdle()
        assertEquals(listOf(front, back), factory.asked)
        assertEquals(listOf(1, 0), made.map { it.closed })
    }

    @Test
    fun `each preview asks for the analysis size of the photo it takes`() {
        val camera = AnalysingCamera()
        var state by mutableStateOf(front)
        rule.setContent { Screen(state, camera, factory = null) }
        rule.waitForIdle()
        // KP10-21 (C201.2): only the side the server marks barcode-bearing (a retry after
        // `barcode_not_found`) is read at the barcode width; any other back is a card.
        val barcodeBack = back.copy(retryHints = listOf(RetryHint("id_barcode_detection", listOf("barcode_not_found"))))
        listOf(barcodeBack, back, selfie, page).forEach {
            state = it
            rule.waitForIdle()
        }

        // The camera records a target each time it changes: front, the barcode back, the plain back, ...
        assertEquals(
            listOf(AnalysisTarget.DOCUMENT, AnalysisTarget.BARCODE, AnalysisTarget.DOCUMENT, AnalysisTarget.SELFIE, AnalysisTarget.DOCUMENT),
            camera.targets,
        )
    }

    /** C201.5: [state]'s capture screen keeps the screen on while it is shown, and lets it go after. */
    private fun keepsTheScreenOn(state: FlowState.Capture) {
        lateinit var view: View
        var shown by mutableStateOf(true)
        rule.setContent {
            view = LocalView.current
            if (shown) Screen(state, AnalysingCamera(), factory = null)
        }
        rule.waitForIdle()
        assertTrue("${state.kind} keeps the screen on", rule.runOnIdle { view.keepScreenOn })

        shown = false
        rule.waitForIdle()
        assertFalse("${state.kind} lets it go", rule.runOnIdle { view.keepScreenOn })
    }

    @Test
    fun `an ID side's capture screen keeps the screen on`() = keepsTheScreenOn(front)

    @Test
    fun `a selfie pose's capture screen keeps the screen on`() = keepsTheScreenOn(selfie)

    @Test
    fun `a document page's capture screen keeps the screen on`() = keepsTheScreenOn(page)

    @Test
    fun `the review of a photo keeps the screen on`() = keepsTheScreenOn(front.copy(image = testJpeg()))

    @Test
    fun `on API 26 to 30 the controls that take, pick or keep a photo drop obscured touches`() {
        var level by mutableIntStateOf(26)
        var state by mutableStateOf(front)
        rule.setContent {
            CompositionLocalProvider(LocalPlatformApiLevel provides level) {
                Screen(state, AnalysingCamera(), factory = null, photoPicker = FakePhotoPicker())
            }
        }
        val filtered = SemanticsMatcher.expectValue(ObscuredTouchesFiltered, true)
        val upload = { rule.onNodeWithText(text(Res.string.openverify_capture_upload)) }
        val keep = { rule.onNodeWithText(text(Res.string.openverify_capture_use)) }
        (26..30).forEach { api ->
            level = api
            state = front.copy(uploadAllowed = true)
            rule.waitForIdle()
            shutter().assert(filtered)
            upload().assert(filtered)
            state = front.copy(image = testJpeg())
            rule.waitForIdle()
            keep().assert(filtered)
        }
        level = 31
        state = front.copy(uploadAllowed = true)
        rule.waitForIdle()
        shutter().assert(SemanticsMatcher.keyNotDefined(ObscuredTouchesFiltered))
        upload().assert(SemanticsMatcher.keyNotDefined(ObscuredTouchesFiltered))
    }

    private companion object {
        const val OVERLAY = "test:guidance-overlay"
        const val FRAME_TIME = 7L

        fun frame() = AnalysisFrame(4, 4, 0, PixelLayout.RGBA_8888, ByteArray(64), FRAME_TIME)
    }
}
