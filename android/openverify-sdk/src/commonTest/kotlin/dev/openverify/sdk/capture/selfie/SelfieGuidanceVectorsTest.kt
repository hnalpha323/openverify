package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import dev.openverify.sdk.face.YunetOutputs
import dev.openverify.sdk.fixtures.readContractFixture
import dev.openverify.sdk.model.SelfiePose
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * C204.1 (decision 21; C221.8): the port passes every case of `contracts/fixtures/flow/
 * selfie-guidance-vectors.json`, which the web flow's assert-only test writes from its own modules
 * (`apps/flow/src/guidance/export-vectors.test.ts`). Boxes and landmarks agree within 1e-9 pixels and
 * yaw ratios within 1e-12 (exp and the trigonometry may differ in their last bit across platforms);
 * sizes, messages and the capture step exactly.
 */
internal class SelfieGuidanceVectorsTest {

    private val vectors: JsonObject = Json.parseToJsonElement(readContractFixture("flow/selfie-guidance-vectors.json")).jsonObject
    private val constants = vectors.getValue("constants").jsonObject

    private fun constant(name: String): Double = constants.getValue(name).jsonPrimitive.double

    private fun cases(section: String): List<JsonObject> = vectors.getValue(section).jsonArray.map { it.jsonObject }

    private fun JsonObject.name(): String = getValue("name").jsonPrimitive.content

    private fun JsonElement.doubleOrNaN(): Double = if (this is JsonNull) Double.NaN else jsonPrimitive.double

    @Test
    fun theConstantsAreTheWebModulesOwn() {
        assertEquals(SelfieGuidanceConstants.STRIDES, constants.getValue("strides").jsonArray.map { it.jsonPrimitive.int })
        assertEquals(SelfieGuidanceConstants.CANDIDATE_SCORE_THRESHOLD, constant("candidate-score-threshold"))
        assertEquals(SelfieGuidanceConstants.NMS_THRESHOLD, constant("nms-threshold"))
        assertEquals(SelfieGuidanceConstants.FACE_SCORE_THRESHOLD, constant("face-score-threshold"))
        assertEquals(SelfieGuidanceConstants.MIN_FACE_HEIGHT_RATIO, constant("min-face-height-ratio"))
        assertEquals(SelfieGuidanceConstants.MAX_FACE_HEIGHT_RATIO, constant("max-face-height-ratio"))
        assertEquals(SelfieGuidanceConstants.MAX_CENTRE_OFFSET, constant("max-centre-offset"))
        assertEquals(SelfieGuidanceConstants.MIN_SECONDARY_FACE_AREA_RATIO, constant("min-secondary-face-area-ratio"))
        assertEquals(SelfieGuidanceConstants.ANNOUNCE_AFTER_MS, constants.getValue("announce-after-ms").jsonPrimitive.long)
        assertEquals(SelfieGuidanceConstants.PREVIEW_WIDTH_PX, constants.getValue("preview-width-px").jsonPrimitive.int)
        assertEquals(SelfieGuidanceConstants.SIDE_TRIGGER_FACTOR, constant("side-trigger-factor"))
        assertEquals(SelfieGuidanceConstants.CENTER_TRIGGER_FACTOR, constant("center-trigger-factor"))
        assertEquals(SelfieGuidanceConstants.MANUAL_SHUTTER_AFTER_MS, constants.getValue("manual-shutter-after-ms").jsonPrimitive.long)
    }

    @Test
    fun everyLetterboxCaseGivesTheWebSizesAndTensor() {
        val letterbox = cases("letterbox")
        assertTrue(letterbox.size >= 10, "the exported letterbox cases: ${letterbox.size}")
        val tensor = YunetTensor()
        val wrong = letterbox.mapNotNull { case ->
            val source = case.getValue("source").jsonObject
            val input = case.getValue("input").jsonObject
            val width = source.getValue("width").jsonPrimitive.int
            val height = source.getValue("height").jsonPrimitive.int
            val previewWidth = SelfieGuidanceConstants.PREVIEW_WIDTH_PX
            val expectedWidth = input.getValue("width").jsonPrimitive.int
            val expectedHeight = input.getValue("height").jsonPrimitive.int
            val sizes = listOf(
                previewWidthOf(width, height, previewWidth),
                previewHeightOf(width, height, previewWidth),
                paddedSize(expectedWidth),
                paddedSize(expectedHeight),
            )
            val expectedSizes = listOf("width", "height", "padded-width", "padded-height").map { input.getValue(it).jsonPrimitive.int }
            if (sizes != expectedSizes) return@mapNotNull "${case.name()}: $sizes, not $expectedSizes"
            val rgba = input["rgba"]?.jsonArray ?: return@mapNotNull null
            val bytes = ByteArray(rgba.size) { rgba[it].jsonPrimitive.int.toByte() }
            assertTrue(tensor.fill(AnalysisFrame(expectedWidth, expectedHeight, 0, PixelLayout.RGBA_8888, bytes, 0L)), case.name())
            val nonZero = tensor.data.withIndex().filter { it.value != 0f }.map { listOf(it.index.toDouble(), it.value.toDouble()) }
            val expected = input.getValue("tensor-nonzero").jsonArray.map { pair -> pair.jsonArray.map { it.jsonPrimitive.double } }
            when {
                tensor.data.size != input.getValue("tensor-length").jsonPrimitive.int -> "${case.name()}: tensor length ${tensor.data.size}"
                nonZero != expected -> "${case.name()}: tensor values differ"
                else -> null
            }.also { tensor.wipe() }
        }
        assertEquals(emptyList(), wrong)
    }

    private fun outputsOf(json: JsonObject): YunetOutputs {
        fun tensor(name: String): FloatArray = json.getValue(name).jsonArray.let { values -> FloatArray(values.size) { values[it].jsonPrimitive.double.toFloat() } }
        return YunetOutputs(
            cls8 = tensor("cls_8"), cls16 = tensor("cls_16"), cls32 = tensor("cls_32"),
            obj8 = tensor("obj_8"), obj16 = tensor("obj_16"), obj32 = tensor("obj_32"),
            bbox8 = tensor("bbox_8"), bbox16 = tensor("bbox_16"), bbox32 = tensor("bbox_32"),
            kps8 = tensor("kps_8"), kps16 = tensor("kps_16"), kps32 = tensor("kps_32"),
        )
    }

    private fun close(actual: Double, expected: Double, tolerance: Double): Boolean =
        if (expected.isNaN()) actual.isNaN() else abs(actual - expected) <= tolerance

    @Test
    fun everyDecodeCaseGivesTheWebDetectorsFaces() {
        val decode = cases("decode")
        assertTrue(decode.size >= 10, "the exported decode cases: ${decode.size}")
        val decoder = YunetDecoder()
        val faces = FaceBuffer()
        val wrong = decode.flatMap { case ->
            val paddedWidth = paddedSize(case.getValue("input-width").jsonPrimitive.int)
            val paddedHeight = paddedSize(case.getValue("input-height").jsonPrimitive.int)
            decoder.decode(outputsOf(case.getValue("outputs").jsonObject), paddedWidth, paddedHeight, faces)
            val expected = case.getValue("faces").jsonArray.map { it.jsonObject }
            val problems = mutableListOf<String>()
            if (faces.count != expected.size) {
                problems += "${case.name()}: ${faces.count} faces, not ${expected.size}"
            } else {
                expected.forEachIndexed { i, face ->
                    val box = face.getValue("box").jsonArray.map { it.jsonPrimitive.double }
                    val actualBox = listOf(faces.x(i), faces.y(i), faces.width(i), faces.height(i))
                    val landmarks = face.getValue("landmarks").jsonArray.flatMap { point -> point.jsonArray.map { it.jsonPrimitive.double } }
                    val actualLandmarks = (0 until 5).flatMap { k -> listOf(faces.landmarkX(i, k), faces.landmarkY(i, k)) }
                    val score = face.getValue("score").jsonPrimitive.double
                    if (box.indices.any { !close(actualBox[it], box[it], 1e-9) }) problems += "${case.name()} face $i: box $actualBox, not $box"
                    if (landmarks.indices.any { !close(actualLandmarks[it], landmarks[it], 1e-9) }) problems += "${case.name()} face $i: landmarks"
                    if (!close(faces.score(i), score, 1e-12)) problems += "${case.name()} face $i: score ${faces.score(i)}, not $score"
                }
            }
            faces.clear()
            problems
        }
        assertEquals(emptyList(), wrong)
    }

    @Test
    fun everyYawCaseGivesTheWebRatio() {
        val yaw = cases("yaw")
        assertTrue(yaw.size >= 20, "the exported yaw cases: ${yaw.size}")
        val wrong = yaw.mapNotNull { case ->
            val points = case.getValue("landmarks").jsonArray.map { point -> point.jsonArray.map { it.jsonPrimitive.double } }
            val expected = case.getValue("ratio").doubleOrNaN()
            val actual = yawRatio(points[0][0], points[0][1], points[1][0], points[1][1], points[2][0], points[2][1])
            if (close(actual, expected, 1e-12)) null else "${case.name()}: $actual, not $expected"
        }
        assertEquals(emptyList(), wrong)
    }

    @Test
    fun everyMachineCaseGivesTheWebMessagesAndCapture() {
        val machine = cases("machine")
        assertTrue(machine.size >= 10, "the exported machine cases: ${machine.size}")
        val thresholds = GuidanceThresholds(
            maxCenterYawRatio = constant("max-center-yaw-ratio"),
            minSideYawRatioChange = constant("min-side-yaw-ratio-change"),
            holdMs = constants.getValue("hold-ms").jsonPrimitive.long,
            sideTriggerFactor = constant("side-trigger-factor"),
            centerTriggerFactor = constant("center-trigger-factor"),
            manualShutterAfterMs = constants.getValue("manual-shutter-after-ms").jsonPrimitive.long,
        )
        val frameWidth = constants.getValue("machine-frame-width").jsonPrimitive.int
        val frameHeight = constants.getValue("machine-frame-height").jsonPrimitive.int
        val faces = FaceBuffer()
        val wrong = machine.mapNotNull { case ->
            val pose = when (case.getValue("prompt").jsonPrimitive.content) {
                "center" -> SelfiePose.CENTER
                "left" -> SelfiePose.LEFT
                else -> SelfiePose.RIGHT
            }
            val centre = if (pose == SelfiePose.CENTER) Double.NaN else constant("machine-centre-yaw-ratio")
            val state = GuidanceMachine(pose, 0L, DetectorStatus.READY, centre, thresholds)
            val steps = case.getValue("steps").jsonArray.map { it.jsonObject }
            val actual = steps.map { step ->
                val fired = state.autoCapture
                val ratio = step.getValue("ratio").doubleOrNaN()
                if (!ratio.isNaN()) {
                    faces.addFace(testFace(yaw = ratio, cx = frameWidth / 2.0, cy = frameHeight / 2.0, frameHeight = frameHeight))
                }
                state.faces(step.getValue("t-ms").jsonPrimitive.long, faces, frameWidth, frameHeight)
                faces.clear()
                state.message.wireName to (state.autoCapture && !fired)
            }
            val expected = steps.map { step ->
                step.getValue("state").jsonPrimitive.content to (step["captures"]?.jsonPrimitive?.boolean ?: false)
            }
            if (actual == expected) null else "${case.name()}: $actual, not $expected"
        }
        assertEquals(emptyList(), wrong)
    }
}
