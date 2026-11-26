package dev.openverify.sdk.capture

import dev.openverify.sdk.model.CaptureTrigger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest

/**
 * C202.4, C204.3 (decision 19): the auto-capture the guidance calls takes the still through the
 * screen's own action, reported as `auto` (C206.2), and answers false when the camera could not take
 * it, so the guidance promotes the shutter.
 */
class AutoCaptureTest {

    @Test
    fun anAutoCaptureTakesTheStillThroughTheScreensActionAsAuto() = runTest {
        val triggers = mutableListOf<CaptureTrigger?>()

        val taken = screenAutoCapture { trigger -> triggers += trigger; true }.takeStill()

        assertTrue(taken)
        assertEquals(listOf<CaptureTrigger?>(CaptureTrigger.AUTO), triggers)
    }

    @Test
    fun aStillTheCameraCouldNotTakeIsAFailedAutoCapture() = runTest {
        assertFalse(screenAutoCapture { false }.takeStill())
    }
}
