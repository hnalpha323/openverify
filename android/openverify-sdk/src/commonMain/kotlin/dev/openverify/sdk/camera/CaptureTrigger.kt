package dev.openverify.sdk.camera

import dev.openverify.sdk.model.CaptureMethod
import dev.openverify.sdk.model.CaptureTrigger
import dev.openverify.sdk.model.DocumentStep
import dev.openverify.sdk.model.FlowStep
import dev.openverify.sdk.model.GovernmentIdStep
import dev.openverify.sdk.model.SelfieStep

/*
 * C206 (Workflow 10B): what an upload reports about how its photo was taken. Both values are
 * client-reported: the server stores and serves them as the device said, and cannot prove either
 * (C206.3). The hooks are foundation-10b's: the capture screen's still action asks [captureTriggerOf]
 * for the trigger it hands to the coordinator, and the coordinator asks [captureMethodOf] for the method
 * of each photo it uploads. This file is `capture-pipeline`'s, which decides both (C206.1, C206.2).
 */

/**
 * C206.2: the `capture-trigger` of a still the capture screen took: `auto` when the auto-capture took
 * it (the guidance's gates held for `hold-ms`, C202.4, C204.3), else `manual`, the person's shutter.
 */
internal fun captureTriggerOf(auto: Boolean): CaptureTrigger? = if (auto) CaptureTrigger.AUTO else CaptureTrigger.MANUAL

/**
 * C206.1 (decision 26): the `capture-method` of a photo for [step], as it was really taken: `upload` when
 * it was [picked] from the device's files (a sandbox only, C19), else `camera`, the live camera, which
 * is where every production photo comes from. A step that takes no photo has none. Which methods a step
 * offers on this device is [nativeCaptureMethods]; what is reported is what happened, never a guess.
 */
internal fun captureMethodOf(step: FlowStep, picked: Boolean): CaptureMethod? = when (step) {
    is GovernmentIdStep, is DocumentStep, is SelfieStep -> if (picked) CaptureMethod.UPLOAD else CaptureMethod.CAMERA
    else -> null
}

/**
 * C206.1 (Phase 9 C153.2): the capture methods [step] offers on this device, an SDK's: its
 * `captureMethodsByDevice.native` when it names them, else its `captureMethods`. A selfie names none
 * (its capture's own method decides, C40.2), nor does a step that takes no photo.
 */
internal fun nativeCaptureMethods(step: FlowStep): List<CaptureMethod> = when (step) {
    is GovernmentIdStep -> step.captureMethodsByDevice?.native ?: step.captureMethods
    is DocumentStep -> step.captureMethodsByDevice?.native ?: step.captureMethods
    else -> emptyList()
}
