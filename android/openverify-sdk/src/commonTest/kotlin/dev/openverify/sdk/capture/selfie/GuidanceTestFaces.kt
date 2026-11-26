package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.face.FaceDetector
import dev.openverify.sdk.face.YunetOutputs
import kotlin.math.ln

/** A face for the guidance tests: a box `[x, y, width, height]`, a score and five landmarks in YuNet order. */
internal class TestFace(
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val score: Double,
    /** Right eye, left eye, nose tip, right mouth corner, left mouth corner, each `x, y`. */
    val landmarks: List<Pair<Double, Double>>,
)

/**
 * A face in a [frameWidth] × [frameHeight] guidance frame whose landmarks read exactly [yaw]: the web
 * test's own face (`guidance-machine.test.ts`) and `selfie-guidance-vectors.json`'s machine face, centred
 * at ([cx], [cy]), [height] of the frame high and three quarters as wide, computed in the same order.
 */
internal fun testFace(
    yaw: Double = 0.0,
    cx: Double = 160.0,
    cy: Double = 120.0,
    height: Double = 0.5,
    score: Double = 0.95,
    frameHeight: Int = 240,
): TestFace {
    val h = height * frameHeight
    val w = h * 0.75
    val eye = w * 0.2
    return TestFace(
        x = cx - w / 2,
        y = cy - h / 2,
        width = w,
        height = h,
        score = score,
        landmarks = listOf(
            (cx - eye) to (cy - h * 0.1),
            (cx + eye) to (cy - h * 0.1),
            (cx + yaw * 2 * eye) to (cy + h * 0.05),
            (cx - eye * 0.8) to (cy + h * 0.25),
            (cx + eye * 0.8) to (cy + h * 0.25),
        ),
    )
}

/** Adds [face] to the buffer. */
internal fun FaceBuffer.addFace(face: TestFace) {
    val index = add(face.x, face.y, face.width, face.height, face.score)
    face.landmarks.forEachIndexed { k, (x, y) -> setLandmark(index, k, x, y) }
}

/** A buffer holding [faces], in order. */
internal fun faceBufferOf(vararg faces: TestFace): FaceBuffer = FaceBuffer().apply { faces.forEach { addFace(it) } }

/**
 * YuNet outputs for a [paddedWidth] × [paddedHeight] input that decode to [faces] (each rounded to float,
 * as ONNX Runtime returns them): each face on the stride-32 anchor under its centre, or at stride 16 when
 * that anchor is taken. The inverse of the decoder, for the fake detector.
 */
internal fun yunetOutputsOf(faces: List<TestFace>, paddedWidth: Int, paddedHeight: Int): YunetOutputs {
    val tensors = SelfieGuidanceConstants.STRIDES.associateWith { stride ->
        val anchors = (paddedWidth / stride) * (paddedHeight / stride)
        arrayOf(FloatArray(anchors), FloatArray(anchors), FloatArray(anchors * 4), FloatArray(anchors * 10))
    }
    val taken = mutableSetOf<Pair<Int, Int>>()
    for (face in faces) {
        val cx = face.x + face.width / 2
        val cy = face.y + face.height / 2
        val stride = listOf(32, 16, 8).first { stride ->
            val anchor = stride to ((cy / stride).toInt() * (paddedWidth / stride) + (cx / stride).toInt())
            taken.add(anchor)
        }
        val cols = paddedWidth / stride
        val col = (cx / stride).toInt().coerceIn(0, cols - 1)
        val row = (cy / stride).toInt().coerceIn(0, paddedHeight / stride - 1)
        val index = row * cols + col
        val (cls, obj, bbox, kps) = tensors.getValue(stride)
        cls[index] = face.score.toFloat()
        obj[index] = face.score.toFloat()
        bbox[index * 4] = (cx / stride - col).toFloat()
        bbox[index * 4 + 1] = (cy / stride - row).toFloat()
        bbox[index * 4 + 2] = ln(face.width / stride).toFloat()
        bbox[index * 4 + 3] = ln(face.height / stride).toFloat()
        face.landmarks.forEachIndexed { k, (x, y) ->
            kps[index * 10 + 2 * k] = (x / stride - col).toFloat()
            kps[index * 10 + 2 * k + 1] = (y / stride - row).toFloat()
        }
    }
    fun head(stride: Int, k: Int) = tensors.getValue(stride)[k]
    return YunetOutputs(
        cls8 = head(8, 0), cls16 = head(16, 0), cls32 = head(32, 0),
        obj8 = head(8, 1), obj16 = head(16, 1), obj32 = head(32, 1),
        bbox8 = head(8, 2), bbox16 = head(16, 2), bbox32 = head(32, 2),
        kps8 = head(8, 3), kps16 = head(16, 3), kps32 = head(32, 3),
    )
}

/**
 * C204.2: a fake [FaceDetector] for the guidance tests (no model, no image): call n answers the faces
 * [facesFor] gives n, as YuNet outputs of the tensor's size. It records the tensor sizes it was given,
 * never the pixels, and fails call [failOnCall] when set.
 */
internal class FakeFaceDetector(
    private val failOnCall: Int? = null,
    private val facesFor: (call: Int) -> List<TestFace> = { emptyList() },
) : FaceDetector {
    var calls: Int = 0
        private set
    var closed: Boolean = false
        private set
    val sizes: MutableList<Pair<Int, Int>> = mutableListOf()

    /** Whether the tensor held any non-zero value on the last call: the frame's pixels reached the detector. */
    var sawPixels: Boolean = false
        private set

    override suspend fun detect(input: FloatArray, width: Int, height: Int): YunetOutputs {
        check(!closed) { "detect after close" }
        check(input.size == 3 * width * height) { "the tensor is 3 x width x height" }
        sizes += width to height
        sawPixels = input.any { it != 0f }
        val call = calls++
        if (call == failOnCall) throw IllegalStateException("the fake detector failed")
        return yunetOutputsOf(facesFor(call), width, height)
    }

    override fun close() {
        closed = true
    }
}
