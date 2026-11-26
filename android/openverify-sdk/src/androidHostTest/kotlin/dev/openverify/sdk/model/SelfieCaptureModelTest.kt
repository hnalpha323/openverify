package dev.openverify.sdk.model

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

/**
 * The C40 selfie capture wire models against the golden fixtures that both clients read
 * (`contracts/fixtures/flow/selfie-capture-created.json`, `selfie-capture-submit.json`, C40.11).
 */
class SelfieCaptureModelTest {

    private val created: FlowSelfieCaptureDocument =
        OpenVerifyJson.decodeFromString(Fixtures.read("flow/selfie-capture-created.json"))
    private val submitJson: JsonObject = OpenVerifyJson.parseToJsonElement(Fixtures.read("flow/selfie-capture-submit.json")).jsonObject

    // The golden capture --------------------------------------------------------------------------

    @Test
    fun `the golden created capture decodes with the server's prompt order, its nonce and its guidance`() {
        val capture = created.data

        assertEquals("selfie", capture.type)
        assertEquals(CAPTURE_ID, capture.id)
        assertEquals(listOf(SelfiePose.CENTER, SelfiePose.RIGHT, SelfiePose.LEFT), capture.attributes.prompts)
        assertEquals(NONCE, capture.attributes.nonce)
        assertEquals(SelfieCaptureGuidance(maxCenterYawRatio = 0.021, minSideYawRatioChange = 0.077, holdMs = 500), capture.attributes.guidance)
    }

    @Test
    fun `the golden submit body decodes into every member the SDK has`() {
        val body = OpenVerifyJson.decodeFromJsonElement(FlowSubmitVerificationBody.serializer(), submitJson)

        assertEquals(
            FlowSubmitVerificationBody(
                FlowSubmitCapture(
                    id = CAPTURE_ID,
                    nonce = NONCE,
                    device = SelfieDeviceSnapshot(
                        label = "Synthetic Test Camera",
                        settings = SelfieDeviceSettings(640, 480, 30.0, FacingMode.USER, ResizeMode.NONE),
                        capabilities = SelfieDeviceCapabilities(1280, 720, 30.0, listOf(FacingMode.USER)),
                        frameStats = SelfieFrameStats(delivered = 240, discarded = 2, total = 242),
                        webdriver = false,
                        imageMirrored = false,
                    ),
                ),
            ),
            body,
        )
    }

    @Test
    fun `the SDK writes the submit body with exactly the golden member names`() {
        val body = OpenVerifyJson.decodeFromJsonElement(FlowSubmitVerificationBody.serializer(), submitJson)

        val written = OpenVerifyJson.encodeToJsonElement(FlowSubmitVerificationBody.serializer(), body)

        assertEquals(memberPaths(submitJson), memberPaths(written))
    }

    // Validation ------------------------------------------------------------------------------

    @ParameterizedTest
    @ValueSource(longs = [0, 1, 179_999, 600_000])
    fun `an upload's elapsed time may be 0 to 600,000 ms (C40_3)`(elapsed: Long) {
        assertEquals(elapsed, SelfieCaptureUpload(CAPTURE_ID, NONCE, elapsed).clientElapsedMs)
        assertEquals(600_000L, SelfieCaptureUpload.MAX_CLIENT_ELAPSED_MS)
    }

    @ParameterizedTest
    @ValueSource(longs = [-1, 600_001, Long.MAX_VALUE])
    fun `an upload's elapsed time outside 0 to 600,000 ms is refused`(elapsed: Long) {
        assertThrows<IllegalArgumentException> { SelfieCaptureUpload(CAPTURE_ID, NONCE, elapsed) }
    }

    @ParameterizedTest
    @ValueSource(strings = ["ver_01M5CJXHG07XPHF3HRM6NREDH9", "self_01M5CJXHG07XPHF3HRM6NREDHU", "self_", ""])
    fun `an upload or a submit naming something other than a self_ ULID is refused`(id: String) {
        assertThrows<IllegalArgumentException> { SelfieCaptureUpload(id, NONCE, 0) }
        assertThrows<IllegalArgumentException> { FlowSubmitCapture(id, NONCE) }
    }

    @ParameterizedTest
    @ValueSource(strings = ["E2eSyntheticNonce0000", "E2eSyntheticNonce000000", "E2eSyntheticNonce0000/", "E2eSyntheticNonce0000="])
    fun `an upload or a submit with a nonce that is not 22 base64url characters is refused`(nonce: String) {
        assertThrows<IllegalArgumentException> { SelfieCaptureUpload(CAPTURE_ID, nonce, 0) }
        assertThrows<IllegalArgumentException> { FlowSubmitCapture(CAPTURE_ID, nonce) }
    }

    // Nothing secret is printed -------------------------------------------------------------------

    @Test
    fun `no model prints the nonce or the camera label`() {
        val submit = OpenVerifyJson.decodeFromJsonElement(FlowSubmitVerificationBody.serializer(), submitJson)
        val texts = listOf(
            created.toString(),
            submit.toString(),
            SelfieCaptureUpload(CAPTURE_ID, NONCE, 10).toString(),
        )

        texts.forEach { text ->
            assertFalse(text.contains(NONCE), text)
            assertFalse(text.contains("Synthetic Test Camera"), text)
        }
    }

    /** Every member's path, such as `/capture/device/settings/frame-rate`, in any order. */
    private fun memberPaths(element: JsonElement, prefix: String = ""): Set<String> =
        if (element is JsonObject) {
            element.flatMap { (key, value) -> memberPaths(value, "$prefix/$key") + "$prefix/$key" }.toSet()
        } else {
            emptySet()
        }

    private companion object {
        val CAPTURE_ID: String = OpenVerifyJson.parseToJsonElement(Fixtures.read("flow/selfie-capture-created.json"))
            .jsonObject.getValue("data").jsonObject.getValue("id").jsonPrimitive.content
        const val NONCE = "E2eSyntheticNonce00000"
    }
}
