package dev.openverify.sdk.capture.document

import dev.openverify.sdk.fixtures.readContractFixture
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.milliseconds
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/**
 * C202.2: the SDK applies exactly the client constants of `contracts/fixtures/flow/document-capture.json`,
 * which Python reads too (`test_android_document_calibration.py`); calibrated on synthetic renders
 * only (the file's `calibration.covers`).
 */
class DocumentCaptureConstantsTest {
    private val document: JsonObject = Json.parseToJsonElement(readContractFixture("flow/document-capture.json")).jsonObject
    private val client = document.getValue("client").jsonObject

    private fun number(key: String): Double = client.getValue(key).jsonPrimitive.double

    @Test
    fun theTimesAndRatesAreTheSharedFiles() {
        assertEquals(client.getValue("hold-ms").jsonPrimitive.long.milliseconds, DocumentCaptureConstants.HOLD)
        assertEquals(client.getValue("manual-shutter-after-ms").jsonPrimitive.long.milliseconds, DocumentCaptureConstants.MANUAL_SHUTTER_AFTER)
        assertEquals(10_000.milliseconds, DocumentCaptureConstants.MANUAL_SHUTTER_AFTER)
        assertEquals(client.getValue("guidance-hz").jsonPrimitive.int, DocumentCaptureConstants.GUIDANCE_HZ)
        assertEquals(client.getValue("analysis-width-px").jsonPrimitive.int, DocumentCaptureConstants.ANALYSIS_WIDTH_PX)
        assertEquals(client.getValue("barcode-analysis-width-px").jsonPrimitive.int, DocumentCaptureConstants.BARCODE_ANALYSIS_WIDTH_PX)
    }

    @Test
    fun theThresholdsAreTheSharedFiles() {
        assertEquals(number("sharpness-laplacian-variance-min"), DocumentCaptureConstants.SHARPNESS_LAPLACIAN_VARIANCE_MIN)
        assertEquals(number("sharpness-tenengrad-min"), DocumentCaptureConstants.SHARPNESS_TENENGRAD_MIN)
        assertEquals(number("glare-share-max"), DocumentCaptureConstants.GLARE_SHARE_MAX)
        assertEquals(number("brightness-mean-min"), DocumentCaptureConstants.BRIGHTNESS_MEAN_MIN)
        assertEquals(number("brightness-mean-max"), DocumentCaptureConstants.BRIGHTNESS_MEAN_MAX)
        assertEquals(number("framing-edge-ratio-min"), DocumentCaptureConstants.FRAMING_EDGE_RATIO_MIN)
        assertEquals(number("mrz-band-edge-density-min"), DocumentCaptureConstants.MRZ_BAND_EDGE_DENSITY_MIN)
    }

    @Test
    fun theFileSaysItCoversSyntheticRendersOnly() {
        assertEquals("synthetic renders only", document.getValue("calibration").jsonObject.getValue("covers").jsonPrimitive.content)
        assertEquals(client.keys, document.getValue("basis").jsonObject.keys)
    }
}
