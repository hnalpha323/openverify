package dev.openverify.sdk.capture.document

import dev.openverify.sdk.fixtures.readContractFixture
import kotlin.io.encoding.Base64
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * C202.1 (review F10): the Kotlin measures reproduce `contracts/fixtures/flow/document-quality-vectors.json`,
 * which `services/vision/tests/test_document_quality_vectors.py` writes from the server's own
 * functions (`openverify_vision.quality`) and the framing reference, over small synthetic frames
 * (96 x 60, raw RGBA). Each measure within the file's tolerance (absolute). Read through
 * [readContractFixture], so it runs on the iOS simulator in the next release.
 */
class DocumentQualityVectorsTest {
    private val vectors: JsonObject = Json.parseToJsonElement(readContractFixture("flow/document-quality-vectors.json")).jsonObject
    private val tolerances = vectors.getValue("tolerances").jsonObject.mapValues { it.value.jsonPrimitive.double }
    private val cases = vectors.getValue("cases").jsonArray.map { it.jsonObject }

    private class Measured(val name: String, val values: Map<String, Double>, val expected: Map<String, Double>)

    private fun measured(): List<Measured> = cases.map { case ->
        val width = case.getValue("width").jsonPrimitive.int
        val height = case.getValue("height").jsonPrimitive.int
        val rgba = Base64.decode(case.getValue("rgba-base64").jsonPrimitive.content)
        val guideJson = case.getValue("guide").jsonObject
        val guide = FrameRect(
            guideJson.getValue("left").jsonPrimitive.int,
            guideJson.getValue("top").jsonPrimitive.int,
            guideJson.getValue("right").jsonPrimitive.int,
            guideJson.getValue("bottom").jsonPrimitive.int,
        )
        val whole = FrameRect(0, 0, width, height)
        val grey = IntArray(width * height)
        val energy = IntArray(width * height)
        DocumentMeasures.grey(rgba, width, height, grey)
        DocumentMeasures.sobelEnergy(grey, width, height, energy)
        Measured(
            name = case.getValue("name").jsonPrimitive.content,
            values = mapOf(
                "laplacian-variance" to DocumentMeasures.laplacianVariance(grey, width, height, whole),
                "tenengrad" to DocumentMeasures.tenengrad(grey, width, height, whole),
                "glare-share" to DocumentMeasures.glareShare(rgba, width, height, whole),
                "brightness-mean" to DocumentMeasures.brightnessMean(grey, width, height, whole),
                "framing-edge-ratio" to DocumentMeasures.framingEdgeRatio(energy, width, height, guide),
            ),
            expected = case.getValue("measures").jsonObject.mapValues { it.value.jsonPrimitive.double },
        )
    }

    @Test
    fun everyMeasureOfEveryCaseIsWithinItsTolerance() {
        val failures = measured().flatMap { case ->
            case.expected.mapNotNull { (measure, expected) ->
                val actual = case.values.getValue(measure)
                val tolerance = tolerances.getValue(measure)
                if (abs(actual - expected) <= tolerance) null else "${case.name} $measure: expected $expected, got $actual (tolerance $tolerance)"
            }
        }
        assertEquals(emptyList(), failures)
    }

    @Test
    fun theFileCoversEveryMeasureTheSdkTakesOverManyCases() {
        assertEquals(setOf("laplacian-variance", "tenengrad", "glare-share", "brightness-mean", "framing-edge-ratio"), tolerances.keys)
        assertTrue(cases.size >= 10, "at least ten frames")
        assertEquals("BORDER_REFLECT_101", vectors.getValue("conversions").jsonObject.getValue("border").jsonPrimitive.content)
    }
}
