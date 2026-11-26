package dev.openverify.face

import dev.openverify.sdk.face.YunetOutputs
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * A camera frame as the SDK's analysis gives one (its `AnalysisFrame`, which is internal to the SDK):
 * the raw image, four bytes a pixel in R, G, B, A order, rows packed, and the rotation that turns it
 * upright. Test code only.
 */
class ReferenceFrame(val width: Int, val height: Int, val rotationDegrees: Int, val rgba: ByteArray) {
    init {
        require(rgba.size >= width * height * 4) { "the buffer is smaller than the frame" }
    }
}

/** The model input of a frame: `3 x paddedHeight x paddedWidth` values, the B plane, then G, then R. */
class ReferenceTensor(val data: FloatArray, val width: Int, val height: Int, val paddedWidth: Int, val paddedHeight: Int)

/** A decoded face: `[x, y, width, height]`, a score, and five landmarks as `x0, y0 ... x4, y4`. */
class ReferenceFace(val score: Double, val box: DoubleArray, val landmarks: DoubleArray) {
    /** `head-pose.ts`: the nose's offset from the eye midpoint along the eye line, over the inter-ocular distance. */
    val yawRatio: Double
        get() {
            val dx = landmarks[2] - landmarks[0]
            val dy = landmarks[3] - landmarks[1]
            val distance = hypot(dx, dy)
            val mx = (landmarks[0] + landmarks[2]) / 2
            val my = (landmarks[1] + landmarks[3]) / 2
            return ((landmarks[4] - mx) * dx + (landmarks[5] - my) * dy) / (distance * distance)
        }
}

/**
 * The SDK's path from a frame to faces, written out again for this module's tests, because the SDK's
 * own `YunetTensor`, `YunetDecoder` and `yawRatio` are internal to it: the tensor as `YunetInput.kt`
 * fills it (upright, nearest pixel, 320 wide, BGR 0-255, zero-padded to multiples of 32) and the
 * decoding as `YunetDecode.kt` and the web's `yunet-decode.ts` do it. Compiled into the host tests and
 * the device tests alike. The host tests hold this decoder to `contracts/fixtures/vision/yunet-decode.json`
 * (OpenCV's faces) and the tensor to `yunet-face-frame-vectors.json` (the server runtime's result).
 */
object YunetReference {
    const val PREVIEW_WIDTH_PX: Int = 320
    const val SCORE_THRESHOLD: Double = 0.6
    const val NMS_THRESHOLD: Double = 0.3

    fun padded(size: Int): Int = (size + 31) / 32 * 32

    fun tensor(frame: ReferenceFrame, previewWidth: Int = PREVIEW_WIDTH_PX): ReferenceTensor {
        val quarter = frame.rotationDegrees == 90 || frame.rotationDegrees == 270
        val uprightWidth = if (quarter) frame.height else frame.width
        val uprightHeight = if (quarter) frame.width else frame.height
        val width = min(previewWidth, uprightWidth)
        val height = (width.toDouble() * uprightHeight / uprightWidth).roundToInt()
        val paddedWidth = padded(width)
        val paddedHeight = padded(height)
        val plane = paddedWidth * paddedHeight
        val data = FloatArray(3 * plane)
        for (y in 0 until height) {
            val uy = ((2 * y + 1) * uprightHeight) / (2 * height)
            for (x in 0 until width) {
                val ux = ((2 * x + 1) * uprightWidth) / (2 * width)
                val source = when (frame.rotationDegrees) {
                    90 -> (frame.height - 1 - ux) * frame.width + uy
                    180 -> (frame.height - 1 - uy) * frame.width + (frame.width - 1 - ux)
                    270 -> ux * frame.width + (frame.width - 1 - uy)
                    else -> uy * frame.width + ux
                } * 4
                val target = y * paddedWidth + x
                data[target] = (frame.rgba[source + 2].toInt() and 0xFF).toFloat()
                data[plane + target] = (frame.rgba[source + 1].toInt() and 0xFF).toFloat()
                data[2 * plane + target] = (frame.rgba[source].toInt() and 0xFF).toFloat()
            }
        }
        return ReferenceTensor(data, width, height, paddedWidth, paddedHeight)
    }

    /** Faces from the twelve named outputs, best first, after greedy non-maximum suppression. */
    fun decode(
        outputs: YunetOutputs,
        paddedWidth: Int,
        paddedHeight: Int,
        scoreThreshold: Double = SCORE_THRESHOLD,
        nmsThreshold: Double = NMS_THRESHOLD,
    ): List<ReferenceFace> {
        val candidates = ArrayList<ReferenceFace>()
        for (stride in intArrayOf(8, 16, 32)) {
            val cols = paddedWidth / stride
            val rows = paddedHeight / stride
            val cls = outputs.tensor("cls_$stride")!!
            val obj = outputs.tensor("obj_$stride")!!
            val bbox = outputs.tensor("bbox_$stride")!!
            val kps = outputs.tensor("kps_$stride")!!
            for (index in 0 until rows * cols) {
                val score = sqrt(unit(cls[index]) * unit(obj[index]))
                if (score < scoreThreshold) continue
                val row = index / cols
                val col = index % cols
                val width = exp(bbox[index * 4 + 2].toDouble()) * stride
                val height = exp(bbox[index * 4 + 3].toDouble()) * stride
                val cx = (col + bbox[index * 4].toDouble()) * stride
                val cy = (row + bbox[index * 4 + 1].toDouble()) * stride
                val landmarks = DoubleArray(10) { k ->
                    val anchor = if (k % 2 == 0) col else row
                    (anchor + kps[index * 10 + k].toDouble()) * stride
                }
                candidates += ReferenceFace(score, doubleArrayOf(cx - width / 2, cy - height / 2, width, height), landmarks)
            }
        }
        val kept = ArrayList<ReferenceFace>()
        for (face in candidates.sortedByDescending { it.score }) {
            if (kept.all { iou(face.box, it.box) <= nmsThreshold }) kept += face
        }
        return kept
    }

    private fun unit(value: Float): Double = min(max(value.toDouble(), 0.0), 1.0)

    private fun iou(a: DoubleArray, b: DoubleArray): Double {
        val width = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
        val height = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
        val intersection = width * height
        val union = a[2] * a[3] + b[2] * b[3] - intersection
        return if (union > 0) intersection / union else 0.0
    }
}
