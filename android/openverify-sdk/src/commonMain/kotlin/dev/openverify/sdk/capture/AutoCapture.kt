package dev.openverify.sdk.capture

import dev.openverify.sdk.camera.captureTriggerOf
import dev.openverify.sdk.model.CaptureTrigger

/**
 * C202.4, C204.3 (decision 19): the capture screen's auto-capture action, which the document and
 * selfie guidance call through [AutoCapture] when their gates held. [takeStill] is the screen's own
 * still action, the one its shutter runs (`ui/CaptureScreen.kt`): it takes the `ImageCapture` still
 * (C201.6), hands it to the review as today with the trigger `camera/CaptureTrigger.kt` decides for an
 * auto-capture (`auto`, C206.2), and answers false when the camera could not take it (or a shutter
 * photo was already being taken), so the guidance makes the shutter the primary action.
 *
 * The contract for the guidance: call [AutoCapture.takeStill] from the frame callback in which the
 * gates held (10B decisions item 6: the photo is the still, not the analysis frame, with no added wait);
 * after `true`, stop reading frames (the review follows and the guidance is closed); after `false`,
 * promote the shutter and take no further still by itself (C202.4).
 */
internal fun screenAutoCapture(takeStill: suspend (CaptureTrigger?) -> Boolean): AutoCapture =
    AutoCapture { takeStill(captureTriggerOf(auto = true)) }
