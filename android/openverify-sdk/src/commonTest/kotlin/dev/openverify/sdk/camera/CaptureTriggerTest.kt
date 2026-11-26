package dev.openverify.sdk.camera

import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CaptureMethodsByDevice
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.DocumentClass
import dev.openverify.sdk.model.DocumentSides
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.Liveness
import dev.openverify.sdk.model.ScreenStep
import dev.openverify.sdk.model.SelfiePose
import dev.openverify.sdk.model.SelfieStep
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * C206.1, C206.2 (decision 26): what an upload reports about how its photo was taken, client-reported
 * and true to the device: the auto-capture or the shutter, the live camera or a picked file. Which
 * methods a step offers on this device is `captureMethodsByDevice.native` when the step names it,
 * else its `captureMethods`.
 */
class CaptureTriggerTest {

    private val id = GovernmentIdStep("id", DocumentSides.BOTH, maxAttempts = 3, captureMethods = listOf(CaptureMethod.CAMERA, CaptureMethod.UPLOAD))
    private val document = DocumentStep("bill", listOf(DocumentClass.UTILITY_BILL), captureMethods = listOf(CaptureMethod.UPLOAD))
    private val selfie = SelfieStep("selfie", listOf(SelfiePose.CENTER), Liveness.PASSIVE, maxAttempts = 3)

    @Test
    fun theAutoCaptureReportsAutoAndTheShutterManual() {
        assertEquals(CaptureTrigger.AUTO, captureTriggerOf(auto = true))
        assertEquals(CaptureTrigger.MANUAL, captureTriggerOf(auto = false))
    }

    @Test
    fun aPhotoFromTheLiveCameraIsCameraAndAPickedOneIsUpload() {
        listOf(id, document, selfie).forEach { step ->
            assertEquals(CaptureMethod.CAMERA, captureMethodOf(step, picked = false), step.id)
            assertEquals(CaptureMethod.UPLOAD, captureMethodOf(step, picked = true), step.id)
        }
    }

    @Test
    fun aStepThatTakesNoPhotoHasNoMethod() {
        assertNull(captureMethodOf(ScreenStep("intro", emptyList()), picked = false))
    }

    @Test
    fun theMethodsOfferedOnThisDeviceAreTheNativeOnesWhenTheStepNamesThem() {
        assertEquals(listOf(CaptureMethod.CAMERA, CaptureMethod.UPLOAD), nativeCaptureMethods(id))
        val nativeOnly = id.copy(captureMethodsByDevice = CaptureMethodsByDevice(mobileWeb = listOf(CaptureMethod.UPLOAD), native = listOf(CaptureMethod.CAMERA)))
        assertEquals(listOf(CaptureMethod.CAMERA), nativeCaptureMethods(nativeOnly))
        val webOnly = document.copy(captureMethodsByDevice = CaptureMethodsByDevice(desktopWeb = listOf(CaptureMethod.CAMERA)))
        assertEquals(listOf(CaptureMethod.UPLOAD), nativeCaptureMethods(webOnly))
        assertEquals(emptyList(), nativeCaptureMethods(selfie))
    }
}
