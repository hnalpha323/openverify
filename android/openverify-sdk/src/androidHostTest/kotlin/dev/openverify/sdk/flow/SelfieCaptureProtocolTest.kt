package dev.openverify.sdk.flow

import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.FlowSelfieCaptureDocument
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.SelfieCaptureGuidance
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * C40.11: the shared selfie capture constants (`contracts/fixtures/flow/selfie-capture.json`), which
 * TypeScript, Python and Kotlin each read. The SDK uses the capture lifetime and keeps the camera
 * open for the whole capture; on-device guidance, which would use the rest, waits for Phase 10.
 */
class SelfieCaptureProtocolTest {

    private val shared: JsonObject = OpenVerifyJson.parseToJsonElement(Fixtures.read("flow/selfie-capture.json")).jsonObject
    private val server = shared.getValue("server").jsonObject
    private val client = shared.getValue("client").jsonObject

    @Test
    fun `a capture lives as long as the shared server constant says`() {
        assertEquals(server.getValue("capture-ttl-seconds").jsonPrimitive.long, SelfieCaptureProtocol.CAPTURE_TTL.inWholeSeconds)
    }

    @Test
    fun `the camera stays open for the whole capture, as the shared client constant says`() {
        assertEquals(client.getValue("camera-stays-open").jsonPrimitive.boolean, SelfieCaptureProtocol.CAMERA_STAYS_OPEN)
    }

    @Test
    fun `the golden capture's guidance is the shared server thresholds and hold time`() {
        val created = OpenVerifyJson.decodeFromString<FlowSelfieCaptureDocument>(Fixtures.read("flow/selfie-capture-created.json"))

        assertEquals(
            SelfieCaptureGuidance(
                maxCenterYawRatio = server.getValue("max-center-yaw-ratio").jsonPrimitive.double,
                minSideYawRatioChange = server.getValue("min-side-yaw-ratio-change").jsonPrimitive.double,
                holdMs = client.getValue("hold-ms").jsonPrimitive.int,
            ),
            created.data.attributes.guidance,
        )
    }
}
