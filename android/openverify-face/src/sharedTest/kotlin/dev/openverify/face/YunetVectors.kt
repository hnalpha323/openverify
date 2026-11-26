package dev.openverify.face

import dev.openverify.sdk.face.YunetOutputs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import java.util.Base64
import kotlin.math.abs

private fun JsonArray.doubles(): DoubleArray = DoubleArray(size) { this[it].jsonPrimitive.double }

private fun JsonArray.faces(): List<ReferenceFace> = map { element ->
    val face = element.jsonObject
    ReferenceFace(
        face.getValue("score").jsonPrimitive.double,
        face.getValue("box").jsonArray.doubles(),
        face.getValue("landmarks").jsonArray.flatMap { it.jsonArray.doubles().asList() }.toDoubleArray(),
    )
}

/**
 * `contracts/fixtures/flow/yunet-face-frame-vectors.json` (C205, C219.5): what the server's own
 * runtime finds on the public-domain fixture frame, and how closely another platform must agree.
 * Written by `services/vision/tests/test_android_yunet_vectors.py`.
 */
class FaceFrameVectors(text: String) {
    private val root: JsonObject = Json.parseToJsonElement(text).jsonObject
    private val frame = root.getValue("frame").jsonObject
    private val input = root.getValue("input").jsonObject
    private val tolerance = root.getValue("tolerance").jsonObject

    val frameFile: String = frame.getValue("filename").jsonPrimitive.content
    val frameSha256: String = frame.getValue("sha256").jsonPrimitive.content
    val frameWidth: Int = frame.getValue("width").jsonPrimitive.int
    val frameHeight: Int = frame.getValue("height").jsonPrimitive.int
    val inputWidth: Int = input.getValue("width").jsonPrimitive.int
    val inputHeight: Int = input.getValue("height").jsonPrimitive.int
    val paddedWidth: Int = input.getValue("padded-width").jsonPrimitive.int
    val paddedHeight: Int = input.getValue("padded-height").jsonPrimitive.int
    val scoreThreshold: Double = root.getValue("score-threshold").jsonPrimitive.double
    val nmsThreshold: Double = root.getValue("nms-threshold").jsonPrimitive.double
    val expected: List<ReferenceFace> = root.getValue("expected").jsonArray.faces()
    val expectedYawRatios: List<Double> = root.getValue("expected").jsonArray.map { it.jsonObject.getValue("yaw-ratio").jsonPrimitive.double }
    val pixels: Double = tolerance.getValue("pixels").jsonPrimitive.double
    val score: Double = tolerance.getValue("score").jsonPrimitive.double
    val yawRatio: Double = tolerance.getValue("yaw-ratio").jsonPrimitive.double

    /**
     * Holds [faces] to the expected ones, within the file's tolerance: the same number of faces, and
     * for each its score, box, five landmarks and yaw ratio.
     */
    fun assertMatches(faces: List<ReferenceFace>) {
        assertEquals("faces", expected.size, faces.size)
        expected.forEachIndexed { index, want ->
            val have = faces[index]
            assertEquals("score of face $index", want.score, have.score, score)
            for (k in 0 until 4) assertEquals("box[$k] of face $index", want.box[k], have.box[k], pixels)
            for (k in 0 until 10) assertEquals("landmark value $k of face $index", want.landmarks[k], have.landmarks[k], pixels)
            assertEquals("yaw ratio of face $index", expectedYawRatios[index], have.yawRatio, yawRatio)
        }
    }

    /** The largest differences of [faces] from the expected ones: pixels, score, yaw ratio. For the record of a run. */
    fun largestDifferences(faces: List<ReferenceFace>): Triple<Double, Double, Double> {
        var pixel = 0.0
        var scored = 0.0
        var ratio = 0.0
        expected.forEachIndexed { index, want ->
            val have = faces[index]
            for (k in 0 until 4) pixel = maxOf(pixel, abs(want.box[k] - have.box[k]))
            for (k in 0 until 10) pixel = maxOf(pixel, abs(want.landmarks[k] - have.landmarks[k]))
            scored = maxOf(scored, abs(want.score - have.score))
            ratio = maxOf(ratio, abs(expectedYawRatios[index] - have.yawRatio))
        }
        return Triple(pixel, scored, ratio)
    }
}

/**
 * `contracts/fixtures/vision/yunet-decode.json` (C46.1): a drawn, synthetic face as a PNG, the model's
 * raw outputs on it as the vision service's onnxruntime gave them (six significant digits), and the
 * faces OpenCV found. A PNG decodes to the same pixels everywhere, so the raw outputs of another
 * ONNX Runtime build can be held to these directly.
 */
class DrawnFaceVectors(text: String) {
    private val root: JsonObject = Json.parseToJsonElement(text).jsonObject
    private val input = root.getValue("input").jsonObject

    val png: ByteArray = Base64.getDecoder().decode(root.getValue("image_png_base64").jsonPrimitive.content)
    val width: Int = input.getValue("width").jsonPrimitive.int
    val height: Int = input.getValue("height").jsonPrimitive.int
    val paddedWidth: Int = input.getValue("padded_width").jsonPrimitive.int
    val paddedHeight: Int = input.getValue("padded_height").jsonPrimitive.int
    val scoreThreshold: Double = root.getValue("score_threshold").jsonPrimitive.double
    val nmsThreshold: Double = root.getValue("nms_threshold").jsonPrimitive.double
    val outputs: Map<String, DoubleArray> = root.getValue("outputs").jsonObject.mapValues { it.value.jsonArray.doubles() }
    val expected: List<ReferenceFace> = root.getValue("expected").jsonArray.faces()

    /** The committed outputs as the SDK's type, for the reference decoder's own test. */
    fun committedOutputs(): YunetOutputs {
        fun of(name: String): FloatArray = outputs.getValue(name).let { values -> FloatArray(values.size) { values[it].toFloat() } }
        return YunetOutputs(
            of("cls_8"), of("cls_16"), of("cls_32"), of("obj_8"), of("obj_16"), of("obj_32"),
            of("bbox_8"), of("bbox_16"), of("bbox_32"), of("kps_8"), of("kps_16"), of("kps_32"),
        )
    }

    /**
     * Holds [found], another runtime's raw outputs on the drawn face, to the committed ones, tensor by
     * its name and value by value. A detector that returned a tensor under another name fails here.
     */
    fun assertRawOutputs(found: YunetOutputs) {
        for (name in YunetOutputs.NAMES) {
            val want = outputs.getValue(name)
            val have = found.tensor(name)!!
            assertEquals("values of $name", want.size, have.size)
            for (index in want.indices) assertEquals("$name[$index]", want[index], have[index].toDouble(), RAW_TOLERANCE)
        }
    }

    /** The largest difference of [found] from the committed outputs. For the record of a run. */
    fun largestRawDifference(found: YunetOutputs): Double =
        YunetOutputs.NAMES.maxOf { name ->
            val want = outputs.getValue(name)
            val have = found.tensor(name)!!
            want.indices.maxOf { abs(want[it] - have[it]) }
        }

    companion object {
        /**
         * How closely another ONNX Runtime build's raw outputs must match the committed ones.
         * Provisional: the committed values keep six significant digits, and builds for other
         * processors order their float arithmetic differently. Measured on 2026-11-11: at most
         * 0.000006 on the host JVM (x86-64) and on a Pixel 9 (arm64-v8a); the bound is some
         * twenty times that.
         */
        const val RAW_TOLERANCE: Double = 1e-4
    }
}

/**
 * ONNX Runtime's telemetry classes in its Android AAR (1.31.0), by binary name: the content provider
 * its manifest declares and the `ai.onnxruntime.telemetry` package. The device test asserts none of
 * them was loaded; a host test holds this list to the AAR's own class list.
 */
object OrtTelemetryClasses {
    const val PROVIDER: String = "ai.onnxruntime.TelemetryInitializer"
    const val PACKAGE_PREFIX: String = "ai.onnxruntime.telemetry."

    val NAMES: List<String> = listOf(
        PROVIDER,
        "ai.onnxruntime.telemetry.ConnectivityCallback",
        "ai.onnxruntime.telemetry.HttpClient",
        "ai.onnxruntime.telemetry.HttpClient\$Configuration",
        "ai.onnxruntime.telemetry.HttpClient\$Configuration\$Default",
        "ai.onnxruntime.telemetry.HttpClient\$FutureShim",
        "ai.onnxruntime.telemetry.HttpClientRequest",
        "ai.onnxruntime.telemetry.HttpClientRequest\$Factory",
        "ai.onnxruntime.telemetry.HttpClientRequest\$Factory\$AndroidUrlConnection",
        "ai.onnxruntime.telemetry.HttpClientRequest\$HeaderEntry",
        "ai.onnxruntime.telemetry.HttpClientRequest\$Headers",
        "ai.onnxruntime.telemetry.PowerInfoReceiver",
        "ai.onnxruntime.telemetry.Request",
    )
}
