package dev.openverify.sdk.camera

import androidx.camera.core.CameraSelector
import dev.openverify.sdk.model.FacingMode
import dev.openverify.sdk.model.Fixtures
import dev.openverify.sdk.model.OpenVerifyJson
import dev.openverify.sdk.model.SelfieDeviceCapabilities
import dev.openverify.sdk.model.SelfieDeviceSettings
import dev.openverify.sdk.model.SelfieDeviceSnapshot
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource

/**
 * C40.4: Android maps its CameraX facts onto the device snapshot's members. The camera id goes
 * into `label`, the lens facing into `settings.facing-mode`, the resolution into
 * `settings.width`/`height`, and the frame rate into `settings.frame-rate`. Every value stays within
 * the bounds the server enforces, and a value outside them is left out rather than sent.
 */
internal class CameraFactsTest {

    private val front = CameraFacts(
        cameraIds = listOf("1"),
        lensFacing = CameraSelector.LENS_FACING_FRONT,
        width = 1440,
        height = 1920,
        frameRate = 30,
        frameRateMax = 60,
    )

    @Test
    fun `a front camera's facts become the snapshot's label, settings and capabilities`() {
        assertEquals(
            SelfieDeviceSnapshot(
                label = "1",
                settings = SelfieDeviceSettings(width = 1440, height = 1920, frameRate = 30.0, facingMode = FacingMode.USER),
                capabilities = SelfieDeviceCapabilities(frameRateMax = 60.0),
                imageMirrored = false,
            ),
            front.toDeviceSnapshot(),
        )
    }

    @ParameterizedTest(name = "lens facing {0}")
    @CsvSource("0, USER", "1, ENVIRONMENT", "2, ", "-1, ")
    fun `the lens facing becomes the web's facing mode, and an external or unknown lens names none`(lens: Int, expected: FacingMode?) {
        assertEquals(expected, front.copy(lensFacing = lens).toDeviceSnapshot().settings?.facingMode)
    }

    @Test
    fun `a logical camera's ids are listed together`() {
        assertEquals("0,2,3", front.copy(cameraIds = listOf("0", "2", "3")).toDeviceSnapshot().label)
    }

    @Test
    fun `no camera id means no label`() {
        assertNull(front.copy(cameraIds = emptyList()).toDeviceSnapshot().label)
    }

    @Test
    fun `a label is cleaned of control and direction characters and kept to 200 characters, as the server keeps it`() {
        val label = front.copy(cameraIds = listOf("ca\u0000m‮era" + "x".repeat(300))).toDeviceSnapshot().label!!

        assertEquals(200, label.length)
        assertTrue(label.startsWith("camerax"), label)
    }

    @ParameterizedTest
    @ValueSource(ints = [0, -1, 16_385])
    fun `a resolution outside 1 to 16,384 pixels is left out`(pixels: Int) {
        val settings = front.copy(width = pixels, height = pixels).toDeviceSnapshot().settings

        assertNull(settings?.width)
        assertNull(settings?.height)
    }

    @ParameterizedTest
    @ValueSource(ints = [0, -5, 1_001])
    fun `a frame rate outside 1 to 1,000 is left out`(rate: Int) {
        val snapshot = front.copy(frameRate = rate, frameRateMax = rate).toDeviceSnapshot()

        assertNull(snapshot.settings?.frameRate)
        assertNull(snapshot.capabilities)
    }

    @Test
    fun `without camera facts the snapshot still says how the photo is stored`() {
        assertEquals(SelfieDeviceSnapshot(imageMirrored = false), (null as CameraFacts?).toDeviceSnapshot())
        assertEquals(SelfieDeviceSnapshot(imageMirrored = false), CameraFacts().toDeviceSnapshot())
    }

    @Test
    fun `the snapshot uses only members of the golden submit body`() {
        val golden = OpenVerifyJson.parseToJsonElement(Fixtures.read("flow/selfie-capture-submit.json"))
            .let { (it as JsonObject).getValue("capture") as JsonObject }.getValue("device")
        val written = OpenVerifyJson.encodeToJsonElement(SelfieDeviceSnapshot.serializer(), front.toDeviceSnapshot())

        assertTrue(memberPaths(golden).containsAll(memberPaths(written)), memberPaths(written).toString())
    }

    private fun memberPaths(element: JsonElement, prefix: String = ""): Set<String> =
        if (element is JsonObject) {
            element.flatMap { (key, value) -> memberPaths(value, "$prefix/$key") + "$prefix/$key" }.toSet()
        } else {
            emptySet()
        }
}
