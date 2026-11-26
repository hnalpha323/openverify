package dev.openverify.sdk.ui

import androidx.camera.core.CameraSelector
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.openverify.sdk.camera.CameraCaptureException
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CameraLens
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.flow.SelfieCaptureProtocol
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.i18n.isolated
import dev.openverify.sdk.model.FileKind
import dev.openverify.sdk.model.RetryHint
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getPluralString
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CaptureScreenTest {

    @get:Rule
    val rule = createComposeRule()

    private val idStep = FakeFlowApi.DEFAULT_FLOW.steps[1]
    private val selfieStep = FakeFlowApi.DEFAULT_FLOW.steps[2]
    private val front = FlowState.Capture(idStep, FileKind.FRONT, index = 0, count = 2)
    private val camera = FakeCaptureCamera()
    private val events = mutableListOf<String>()
    private val captured = mutableListOf<CapturedImage>()
    private val cameraFacts = mutableListOf<CameraFacts?>()
    private val picked = mutableListOf<CapturedImage>()

    /** [res] as a screen shows it: each value isolated (C199.5, K10A-2). */
    private fun text(res: StringResource, vararg args: Any) = runBlocking { getString(res, *args.map { isolated(it.toString()) }.toTypedArray()) }

    private fun show(state: FlowState.Capture, photoPicker: PhotoPicker? = null) {
        rule.setContent { Screen(state, photoPicker) }
    }

    @Composable
    private fun Screen(state: FlowState.Capture, photoPicker: PhotoPicker? = null) {
        CaptureScreen(
            state = state,
            camera = camera,
            onCaptured = { image, facts, _ ->
                captured += image
                cameraFacts += facts
            },
            onPicked = { picked += it },
            onRetake = { events += "retake" },
            onConfirm = { events += "confirm" },
            onCancel = { events += "cancel" },
            photoPicker = photoPicker,
        )
    }

    @Test
    fun `the ID front shows the back camera preview, a document guide, its title and progress`() {
        show(front)

        rule.onNodeWithTag(TestTags.PREVIEW).assertExists()
        rule.onNodeWithTag(TestTags.DOCUMENT_GUIDE).assertExists()
        rule.onNodeWithTag(TestTags.OVAL_GUIDE).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_id_front_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_id_front_instruction)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_capture_progress, 1, 2)).assertExists()
        rule.waitForIdle()
        assertEquals(listOf(CameraLens.BACK), camera.previewedLenses)
    }

    @Test
    fun `the back of the ID has its own instructions`() {
        show(front.copy(kind = FileKind.BACK, index = 1))

        rule.onNodeWithText(text(Res.string.openverify_id_back_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_capture_progress, 2, 2)).assertExists()
    }

    @Test
    fun `taking a photo hands it to the flow`() {
        val photo = testJpeg()
        camera.nextPhoto = { photo }
        show(front)

        rule.onNodeWithText(text(Res.string.openverify_capture_take)).performClick()
        rule.waitForIdle()

        assertEquals(listOf(photo), captured)
    }

    @Test
    fun `a failed capture says so and keeps the preview`() {
        camera.nextPhoto = { throw CameraCaptureException("camera closed") }
        show(front)

        rule.onNodeWithText(text(Res.string.openverify_capture_take)).performClick()

        rule.onNodeWithText(text(Res.string.openverify_capture_failed)).assertExists()
        rule.onNodeWithTag(TestTags.PREVIEW).assertExists()
        assertEquals(emptyList<CapturedImage>(), captured)
    }

    @Test
    fun `a capture that fails in any other way says so instead of crashing the app (1B F025)`() {
        camera.nextPhoto = { throw IllegalStateException("use case not bound") }
        show(front)

        rule.onNodeWithText(text(Res.string.openverify_capture_take)).performClick()

        rule.onNodeWithText(text(Res.string.openverify_capture_failed)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_capture_take)).assertIsEnabled()
        assertEquals(emptyList<CapturedImage>(), captured)
    }

    @Test
    fun `after a failed capture the next one can succeed`() {
        val photo = testJpeg()
        var attempts = 0
        camera.nextPhoto = { if (attempts++ == 0) throw RuntimeException("camera error") else photo }
        show(front)

        rule.onNodeWithText(text(Res.string.openverify_capture_take)).performClick()
        rule.onNodeWithText(text(Res.string.openverify_capture_failed)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_capture_take)).performClick()
        rule.waitForIdle()

        assertEquals(listOf(photo), captured)
        rule.onNodeWithText(text(Res.string.openverify_capture_failed)).assertDoesNotExist()
    }

    // Sandbox upload fallback (C19) -------------------------------------------------------------

    @Test
    fun `a capture that allows uploads offers one, and the photo goes to the flow as picked`() {
        val photo = testJpeg()
        show(front.copy(uploadAllowed = true), FakePhotoPicker { photo })

        rule.onNodeWithText(text(Res.string.openverify_capture_upload)).performClick()
        rule.waitForIdle()

        assertEquals(listOf(photo), picked)
        assertEquals(emptyList<CapturedImage>(), captured)
    }

    @Test
    fun `a picked file that is not a usable photo says so`() {
        show(front.copy(uploadAllowed = true), FakePhotoPicker { null })

        rule.onNodeWithText(text(Res.string.openverify_capture_upload)).performClick()

        rule.onNodeWithText(text(Res.string.openverify_capture_upload_failed)).assertExists()
        assertEquals(emptyList<CapturedImage>(), captured)
    }

    @Test
    fun `no upload is offered when the capture does not allow it, or there is no picker`() {
        show(front.copy(uploadAllowed = false), FakePhotoPicker())

        rule.onNodeWithText(text(Res.string.openverify_capture_upload)).assertDoesNotExist()
    }

    @Test
    fun `no upload is offered without a picker`() {
        show(front.copy(uploadAllowed = true))

        rule.onNodeWithText(text(Res.string.openverify_capture_upload)).assertDoesNotExist()
    }

    @Test
    fun `a photo under review replaces the preview and can be retaken or used`() {
        show(front.copy(image = testJpeg()))

        rule.onNodeWithTag(TestTags.PREVIEW).assertDoesNotExist()
        rule.onNodeWithTag(TestTags.REVIEW_PHOTO).assertContentDescriptionEquals(text(Res.string.openverify_id_front_photo))
        rule.onNodeWithText(text(Res.string.openverify_capture_check)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_capture_retake)).performClick()
        rule.onNodeWithText(text(Res.string.openverify_capture_use)).performClick()

        assertEquals(listOf("retake", "confirm"), events)
    }

    @Test
    fun `retry hints explain what to fix before the next photo`() {
        show(front.copy(retryHints = listOf(RetryHint("id_glare_detection", listOf("glare_present")))))

        rule.onNodeWithText(text(Res.string.openverify_retry_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_retry_glare_present)).assertExists()
    }

    @Test
    fun `the selfie uses the front camera and an oval guide`() {
        show(FlowState.Capture(selfieStep, FileKind.SELFIE_CENTER, 0, 1))

        rule.onNodeWithTag(TestTags.OVAL_GUIDE).assertExists()
        rule.onNodeWithTag(TestTags.DOCUMENT_GUIDE).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_selfie_center_title)).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_selfie_center_instruction)).assertExists()
        rule.waitForIdle()
        assertEquals(listOf(CameraLens.FRONT), camera.previewedLenses)
    }

    // The selfie capture protocol (C40, C46.2) --------------------------------------------------

    private val selfiePrompt = FlowState.Capture(selfieStep, FileKind.SELFIE_CENTER, 0, 3)

    @Test
    fun `a camera photo goes to the flow with what the camera reported about itself (C40_4)`() {
        val facts = CameraFacts(listOf("1"), CameraSelector.LENS_FACING_FRONT, width = 1440, height = 1920)
        camera.facts = facts
        show(selfiePrompt)

        rule.onNodeWithText(text(Res.string.openverify_capture_take)).performClick()
        rule.waitForIdle()

        assertEquals(listOf<CameraFacts?>(facts), cameraFacts)
        assertEquals(emptyList<CapturedImage>(), picked)
    }

    @Test
    fun `while a pose is sent its photo stays, the screen says so, and no button can be pressed`() {
        show(selfiePrompt.copy(image = testJpeg(), sending = true))

        rule.onNodeWithText(text(Res.string.openverify_capture_sending)).assertExists()
        rule.onNodeWithTag(TestTags.REVIEW_PHOTO).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_capture_retake)).assertIsNotEnabled()
        rule.onNodeWithText(text(Res.string.openverify_capture_use)).assertIsNotEnabled()
    }

    @Test
    fun `a photo under review is not being sent until the user keeps it`() {
        show(selfiePrompt.copy(image = testJpeg()))

        rule.onNodeWithText(text(Res.string.openverify_capture_sending)).assertDoesNotExist()
        rule.onNodeWithText(text(Res.string.openverify_capture_use)).assertIsEnabled()
    }

    @Test
    fun `the first prompt of a new capture says why the selfies are taken again (C40_4)`() {
        show(selfiePrompt.copy(restarted = true))

        rule.onNodeWithText(text(Res.string.openverify_selfie_capture_restarted)).assertExists()
    }

    /** The selfie time-limit notice for the capture's lifetime in whole minutes (C40.2, 4B H015). */
    private fun timeLimit(): String {
        val minutes = SelfieCaptureProtocol.CAPTURE_TTL.inWholeMinutes.toInt()
        return runBlocking { getPluralString(Res.plurals.openverify_selfie_time_limit, minutes, isolated(minutes.toString())) }
    }

    @Test
    fun `each selfie prompt says how long the user has to take the selfies, and what happens after (4B H015)`() {
        var state by mutableStateOf(selfiePrompt)
        rule.setContent { Screen(state) }

        rule.onNodeWithText(timeLimit()).assertExists()
        state = selfiePrompt.copy(kind = FileKind.SELFIE_RIGHT, index = 1)
        rule.onNodeWithText(timeLimit()).assertExists()
        state = selfiePrompt.copy(restarted = true)
        rule.onNodeWithText(timeLimit()).assertExists()
        rule.onNodeWithText(text(Res.string.openverify_selfie_capture_restarted)).assertExists()
        assertEquals(
            "Take all your selfies within ${isolated("3")} minutes. If the time runs out, we start again from the first photo.",
            timeLimit(),
        )
    }

    @Test
    fun `a document prompt and a photo under review say nothing about the selfie time limit (4B H015)`() {
        var state by mutableStateOf(front)
        rule.setContent { Screen(state) }

        rule.onNodeWithText(timeLimit()).assertDoesNotExist()
        state = selfiePrompt.copy(image = testJpeg())
        rule.onNodeWithText(timeLimit()).assertDoesNotExist()
    }

    @Test
    fun `a prompt that is not a restart says nothing about one`() {
        show(selfiePrompt)

        rule.onNodeWithText(text(Res.string.openverify_selfie_capture_restarted)).assertDoesNotExist()
    }

    @Test
    fun `each prompt's title is a live region, so a screen reader announces the next pose`() {
        show(selfiePrompt.copy(kind = FileKind.SELFIE_RIGHT, index = 1))

        rule.onNodeWithText(text(Res.string.openverify_selfie_right_title))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
    }

    @Test
    fun `the camera stays open across a selfie's prompts and their review (C40_11)`() {
        var state by mutableStateOf(selfiePrompt)
        rule.setContent { Screen(state) }
        rule.waitForIdle()

        state = selfiePrompt.copy(image = testJpeg())
        rule.waitForIdle()
        state = state.copy(sending = true)
        rule.waitForIdle()
        state = selfiePrompt.copy(kind = FileKind.SELFIE_RIGHT, index = 1)
        rule.waitForIdle()

        // One preview start for the whole capture: the camera was never closed and reopened.
        assertEquals(listOf(CameraLens.FRONT), camera.previewedLenses)
        rule.onNodeWithTag(TestTags.PREVIEW).assertExists()
    }

    @Test
    fun `a selfie photo under review hides the live preview from screen readers`() {
        show(selfiePrompt.copy(image = testJpeg()))

        rule.onNodeWithTag(TestTags.PREVIEW).assertDoesNotExist()
        rule.onNodeWithTag(TestTags.REVIEW_PHOTO).assertExists()
    }

    @Test
    fun `cancel reports that the user stopped`() {
        show(front)

        rule.onNodeWithText(text(Res.string.openverify_cancel)).performClick()

        assertEquals(listOf("cancel"), events)
    }
}
