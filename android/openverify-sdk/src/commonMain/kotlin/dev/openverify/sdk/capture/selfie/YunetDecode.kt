package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.face.YunetOutputs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * C204.1, C204.2: the web flow's `yunet-decode.ts` in Kotlin: the anchor grid of each stride, the face
 * score (the geometric mean of the class and objectness scores, each clamped to 0..1), the box and the
 * five landmarks, then greedy non-maximum suppression, best first. It reads [YunetOutputs]' twelve
 * row-major tensors as the web reads its record (review F17), each value widened from float to double,
 * and a value past a tensor's end reads 0, as the web's `?? 0` reads it.
 */

/** YuNet's five landmarks. */
private const val LANDMARKS = 5

/** How many anchors the three strides hold for a [paddedWidth] × [paddedHeight] input. */
internal fun anchorCount(paddedWidth: Int, paddedHeight: Int): Int {
    var anchors = 0
    for (level in 0 until STRIDE_COUNT) {
        val stride = strideAt(level)
        anchors += (paddedWidth / stride) * (paddedHeight / stride)
    }
    return anchors
}

/** YuNet's strides by level, 8, 16 and 32, without a list per frame. */
private const val STRIDE_COUNT = 3

private fun strideAt(level: Int): Int = 8 shl level

/** Output [head] (0 `cls`, 1 `obj`, 2 `bbox`, 3 `kps`) at stride level [level], read by property, never by a built name. */
private fun YunetOutputs.head(head: Int, level: Int): FloatArray = when (head * STRIDE_COUNT + level) {
    0 -> cls8
    1 -> cls16
    2 -> cls32
    3 -> obj8
    4 -> obj16
    5 -> obj32
    6 -> bbox8
    7 -> bbox16
    8 -> bbox32
    9 -> kps8
    10 -> kps16
    else -> kps32
}

/**
 * Decoded faces, in buffers reused across frames (rule 19). A face is `[x, y, width, height]` in the
 * input's pixels, a score, and five landmarks in YuNet order: right eye, left eye, nose tip, right mouth
 * corner, left mouth corner (the subject's sides). [clear] zeroes what it held, so no box or landmark
 * outlives the frame callback (C204.8).
 */
internal class FaceBuffer {
    private var boxes = DoubleArray(0)
    private var scores = DoubleArray(0)
    private var points = DoubleArray(0)

    /** How many faces it holds. */
    var count: Int = 0
        private set

    /** How many faces it can hold before its buffers grow. */
    val capacity: Int get() = scores.size

    fun x(index: Int): Double = boxes[checked(index) * 4]

    fun y(index: Int): Double = boxes[checked(index) * 4 + 1]

    fun width(index: Int): Double = boxes[checked(index) * 4 + 2]

    fun height(index: Int): Double = boxes[checked(index) * 4 + 3]

    fun score(index: Int): Double = scores[checked(index)]

    /** Landmark [landmark] (0-4) of face [index]. */
    fun landmarkX(index: Int, landmark: Int): Double = points[checked(index) * 2 * LANDMARKS + 2 * landmark]

    fun landmarkY(index: Int, landmark: Int): Double = points[checked(index) * 2 * LANDMARKS + 2 * landmark + 1]

    /** The box's area. */
    fun area(index: Int): Double = width(index) * height(index)

    /** Adds a face with its box and score, growing the buffers only past their capacity; returns its index. */
    fun add(x: Double, y: Double, width: Double, height: Double, score: Double): Int {
        if (count == capacity) reserve(max(4, capacity * 2))
        val index = count++
        boxes[index * 4] = x
        boxes[index * 4 + 1] = y
        boxes[index * 4 + 2] = width
        boxes[index * 4 + 3] = height
        scores[index] = score
        return index
    }

    /** Sets landmark [landmark] (0-4) of face [index]. */
    fun setLandmark(index: Int, landmark: Int, x: Double, y: Double) {
        require(landmark in 0 until LANDMARKS) { "YuNet gives five landmarks" }
        val at = checked(index) * 2 * LANDMARKS + 2 * landmark
        points[at] = x
        points[at + 1] = y
    }

    /** Makes room for [faces] faces at once: one allocation for a frame size, never one per frame. */
    fun reserve(faces: Int) {
        if (faces <= capacity) return
        boxes = boxes.copyOf(faces * 4)
        scores = scores.copyOf(faces)
        points = points.copyOf(faces * 2 * LANDMARKS)
    }

    /** Copies face [index] of [from] to the end of this buffer. */
    fun copyFrom(from: FaceBuffer, index: Int) {
        val to = add(from.x(index), from.y(index), from.width(index), from.height(index), from.score(index))
        for (k in 0 until LANDMARKS) setLandmark(to, k, from.landmarkX(index, k), from.landmarkY(index, k))
    }

    /** Zeroes every face held and empties the buffer. */
    fun clear() {
        boxes.fill(0.0, 0, count * 4)
        scores.fill(0.0, 0, count)
        points.fill(0.0, 0, count * 2 * LANDMARKS)
        count = 0
    }

    /** True when nothing is held: no face, and every value zero (C204.8's check). */
    fun isWiped(): Boolean = count == 0 && boxes.all { it == 0.0 } && scores.all { it == 0.0 } && points.all { it == 0.0 }

    private fun checked(index: Int): Int {
        if (index < 0 || index >= count) throw IndexOutOfBoundsException("no face $index")
        return index
    }
}

/** Decodes YuNet's raw outputs into faces, keeping its buffers between frames of the same size. */
internal class YunetDecoder {
    private val candidates = FaceBuffer()
    private var order = IntArray(0)

    /**
     * Decodes [outputs] of a [paddedWidth] × [paddedHeight] input into [into], best first, dropping
     * faces below [scoreThreshold] and those overlapping a better one by more than [nmsThreshold].
     * [into] is emptied first.
     */
    fun decode(
        outputs: YunetOutputs,
        paddedWidth: Int,
        paddedHeight: Int,
        into: FaceBuffer,
        scoreThreshold: Double = SelfieGuidanceConstants.CANDIDATE_SCORE_THRESHOLD,
        nmsThreshold: Double = SelfieGuidanceConstants.NMS_THRESHOLD,
    ) {
        into.clear()
        candidates.clear()
        val anchors = anchorCount(paddedWidth, paddedHeight)
        candidates.reserve(anchors)
        into.reserve(anchors)
        for (level in 0 until STRIDE_COUNT) {
            val stride = strideAt(level)
            val cols = paddedWidth / stride
            val rows = paddedHeight / stride
            val cls = outputs.head(0, level)
            val obj = outputs.head(1, level)
            val bbox = outputs.head(2, level)
            val kps = outputs.head(3, level)
            for (index in 0 until rows * cols) {
                val score = sqrt(unit(cls.at(index)) * unit(obj.at(index)))
                if (score < scoreThreshold) continue
                val row = index / cols
                val col = index % cols
                val width = exp(bbox.at(index * 4 + 2)) * stride
                val height = exp(bbox.at(index * 4 + 3)) * stride
                val cx = (col + bbox.at(index * 4)) * stride
                val cy = (row + bbox.at(index * 4 + 1)) * stride
                val face = candidates.add(cx - width / 2, cy - height / 2, width, height, score)
                for (k in 0 until LANDMARKS) {
                    candidates.setLandmark(face, k, (col + kps.at(index * 10 + 2 * k)) * stride, (row + kps.at(index * 10 + 2 * k + 1)) * stride)
                }
            }
        }
        suppress(nmsThreshold, into)
        candidates.clear()
    }

    /** Greedy NMS, best first (a stable order, as the web's sort is), each face kept unless it overlaps a kept one by more than [threshold]. */
    private fun suppress(threshold: Double, into: FaceBuffer) {
        val count = candidates.count
        if (order.size < count) order = IntArray(candidates.capacity)
        for (i in 0 until count) order[i] = i
        // Insertion sort by score, descending: stable, and in place.
        for (i in 1 until count) {
            val face = order[i]
            var j = i - 1
            while (j >= 0 && candidates.score(order[j]) < candidates.score(face)) {
                order[j + 1] = order[j]
                j -= 1
            }
            order[j + 1] = face
        }
        for (i in 0 until count) {
            val face = order[i]
            var kept = true
            for (other in 0 until into.count) {
                if (iou(candidates, face, into, other) > threshold) {
                    kept = false
                    break
                }
            }
            if (kept) into.copyFrom(candidates, face)
        }
        order.fill(0, 0, count)
    }

    /** Zeroes the candidates kept between calls. */
    fun wipe() {
        candidates.clear()
    }

    /** True when no candidate value is left (C204.8's check). */
    fun isWiped(): Boolean = candidates.isWiped() && order.all { it == 0 }

    private companion object {
        fun unit(value: Double): Double = min(max(value, 0.0), 1.0)

        fun FloatArray.at(offset: Int): Double = if (offset < size) this[offset].toDouble() else 0.0

        /** The intersection over union of two `[x, y, width, height]` boxes. */
        fun iou(a: FaceBuffer, i: Int, b: FaceBuffer, j: Int): Double {
            val width = max(0.0, min(a.x(i) + a.width(i), b.x(j) + b.width(j)) - max(a.x(i), b.x(j)))
            val height = max(0.0, min(a.y(i) + a.height(i), b.y(j) + b.height(j)) - max(a.y(i), b.y(j)))
            val intersection = width * height
            val union = a.width(i) * a.height(i) + b.width(j) * b.height(j) - intersection
            return if (union > 0) intersection / union else 0.0
        }
    }
}
