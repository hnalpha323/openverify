package dev.openverify.sdk.ui

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.openverify.sdk.camera.CameraCaptureException
import dev.openverify.sdk.camera.CameraFacts
import dev.openverify.sdk.camera.CapturedImage
import dev.openverify.sdk.camera.captureTriggerOf
import dev.openverify.sdk.flow.FakeFlowApi
import dev.openverify.sdk.flow.FlowState
import dev.openverify.sdk.generated.resources.*
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.FileKind
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C206.2, C202.4, C204.3 (Workflow 10B Stage 1b, foundation-10b's hook): the capture screen takes its
 * still through one action, [takeStill], which the shutter runs with the trigger `camera/CaptureTrigger.kt`
 * decides for a shutter, and the auto-capture (`capture/AutoCapture.kt`) with the one it decides for an
 * auto-capture. The action hands the photo on with what the camera reported and that trigger.
 */
@RunWith(RobolectricTestRunner::class)
class CaptureActionHookTest {

    @get:Rule
    val rule = createComposeRule()

    private val facts = CameraFacts(listOf("0"), 1, width = 1920, height = 1080, frameRate = 30, frameRateMax = 30)

    @Test
    fun `the still action hands on the photo, the camera's facts and the trigger it was given`() {
        val camera = FakeCaptureCamera().also { it.facts = facts }
        val received = mutableListOf<Triple<CapturedImage, CameraFacts?, CaptureTrigger?>>()

        val taken = runBlocking { takeStill(camera, CaptureTrigger.AUTO) { image, cameraFacts, trigger -> received += Triple(image, cameraFacts, trigger) } }

        assertTrue(taken)
        assertEquals(1, camera.picturesTaken)
        assertEquals(listOf(facts to CaptureTrigger.AUTO), received.map { it.second to it.third })
    }

    @Test
    fun `a still the camera could not take hands on nothing`() {
        val camera = FakeCaptureCamera(nextPhoto = { throw CameraCaptureException("no frame") })
        val received = mutableListOf<CaptureTrigger?>()

        val taken = runBlocking { takeStill(camera, CaptureTrigger.MANUAL) { _, _, trigger -> received += trigger } }

        assertFalse(taken)
        assertEquals(emptyList<CaptureTrigger?>(), received)
    }

    @Test
    fun `the shutter takes the still with the trigger decided for a shutter`() {
        val camera = FakeCaptureCamera()
        val triggers = mutableListOf<CaptureTrigger?>()
        val step = FakeFlowApi.DEFAULT_FLOW.steps[1]
        rule.setContent {
            CaptureScreen(
                state = FlowState.Capture(step, FileKind.FRONT, index = 0, count = 2),
                camera = camera,
                onCaptured = { _, _, trigger -> triggers += trigger },
                onPicked = {},
                onRetake = {},
                onConfirm = {},
                onCancel = {},
            )
        }

        rule.onNodeWithText(runBlocking { getString(Res.string.openverify_capture_take) }).performClick()
        rule.waitForIdle()

        assertEquals(listOf(captureTriggerOf(auto = false)), triggers)
    }
}
