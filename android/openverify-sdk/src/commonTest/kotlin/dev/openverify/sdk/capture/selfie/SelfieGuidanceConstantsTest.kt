package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.fixtures.readContractFixture
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * C40.11, C204.1: the guidance's client constants are `contracts/fixtures/flow/selfie-capture.json`'s
 * `client` block, the file TypeScript, Python and Kotlin each read.
 */
internal class SelfieGuidanceConstantsTest {

    private val client = Json.parseToJsonElement(readContractFixture("flow/selfie-capture.json")).jsonObject.getValue("client").jsonObject

    @Test
    fun theClientConstantsAreTheSharedFiles() {
        assertEquals(client.getValue("side-trigger-factor").jsonPrimitive.double, SelfieGuidanceConstants.SIDE_TRIGGER_FACTOR)
        assertEquals(client.getValue("center-trigger-factor").jsonPrimitive.double, SelfieGuidanceConstants.CENTER_TRIGGER_FACTOR)
        assertEquals(client.getValue("guidance-hz").jsonPrimitive.int, SelfieGuidanceConstants.GUIDANCE_HZ)
        assertEquals(client.getValue("preview-width-px").jsonPrimitive.int, SelfieGuidanceConstants.PREVIEW_WIDTH_PX)
        assertEquals(client.getValue("manual-shutter-after-ms").jsonPrimitive.long, SelfieGuidanceConstants.MANUAL_SHUTTER_AFTER_MS)
    }

    @Test
    fun theTriggersAreTheFactorsTimesTheServersThresholds() {
        val thresholds = GuidanceThresholds(maxCenterYawRatio = 0.05, minSideYawRatioChange = 0.1, holdMs = 800)

        assertEquals(0.04, thresholds.centreTrigger, 1e-12)
        assertEquals(0.125, thresholds.sideTrigger, 1e-12)
        assertEquals(800L, thresholds.holdMs)
        assertEquals(SelfieGuidanceConstants.MANUAL_SHUTTER_AFTER_MS, thresholds.manualShutterAfterMs)
    }
}
