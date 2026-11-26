package dev.openverify.face

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtException
import ai.onnxruntime.OrtSession
import dev.openverify.sdk.face.FaceDetector
import dev.openverify.sdk.face.FaceDetectorFactory
import dev.openverify.sdk.face.YunetOutputs
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * `openverify-face`'s [FaceDetectorFactory] (C205.4): each detector it makes owns one `OrtSession`
 * over the YuNet model, opened when the detector is created and closed with it. The SDK creates one
 * detector per selfie prompt, off the main thread, and closes it with the prompt (Workflow 10B Stage 2
 * amendment 5). The model's bytes come from [model] and are checked against its pinned SHA-256 before
 * the session is created, every time.
 *
 * A detector that cannot be made is refused with a fixed message, and the SDK's selfie screen then
 * keeps the manual shutter, as without this artifact (C204.6).
 */
internal class OrtFaceDetectorFactory(
    private val model: ModelSource,
    private val environments: OrtEnvironments,
) : FaceDetectorFactory {
    override fun create(): FaceDetector {
        val bytes = model.verifiedBytes()
        val session = environments.openSession(bytes)
        return OrtFaceDetector(environments.environment(), session)
    }
}

/**
 * YuNet through ONNX Runtime on the CPU (C204.2, C205.4). [detect] takes the SDK's letterboxed tensor
 * (`1 x 3 x height x width`, BGR, 0-255) and returns the model's twelve outputs **by their names**
 * (`cls_8` ... `kps_32`), each flattened row-major, never by position, so this class and the SDK's
 * common decoder cannot disagree on an order (review F17).
 *
 * Buffers. The native input buffer and the twelve native output buffers are allocated once per frame
 * size and reused; ONNX Runtime writes its outputs straight into them. They are zeroed before [detect]
 * returns. The arrays handed to the SDK are new for each frame and this class keeps no reference to
 * them, so nothing of a frame (no pixel, no box, no landmark) is reachable from this module once the
 * frame's callback has returned (C204.8). Nothing is stored, logged or sent.
 */
internal class OrtFaceDetector(
    private val environment: OrtEnvironment,
    private val session: OrtSession,
) : FaceDetector {
    private var buffers: FrameBuffers? = null
    private var closed = false

    override suspend fun detect(input: FloatArray, width: Int, height: Int): YunetOutputs = run(input, width, height)

    @Synchronized
    private fun run(input: FloatArray, width: Int, height: Int): YunetOutputs {
        check(!closed) { "openverify-face: the detector is closed" }
        require(width > 0 && height > 0 && width % ALIGNMENT == 0 && height % ALIGNMENT == 0) { "openverify-face: the input's sides are multiples of 32" }
        require(input.size == CHANNELS * width * height) { "openverify-face: the input holds three planes of its size" }
        val frame = buffersFor(width, height)
        try {
            frame.input.clear()
            frame.input.put(input)
            frame.input.rewind()
            // The twelve outputs are pinned: ONNX Runtime writes them into this frame size's own buffers.
            session.run(frame.inputs, frame.pinned).use { }
            return frame.read()
        } catch (_: OrtException) {
            FaceLog.log("face.inference_failed")
            throw IllegalStateException("openverify-face: ONNX Runtime did not run the model")
        } finally {
            frame.wipe()
        }
    }

    /** The buffers of a [width] x [height] input: the same ones while the frame size stays the same. */
    private fun buffersFor(width: Int, height: Int): FrameBuffers {
        buffers?.let { if (it.width == width && it.height == height) return it }
        buffers?.close()
        buffers = null
        return try {
            FrameBuffers(environment, session.inputNames.single(), width, height).also { buffers = it }
        } catch (_: OrtException) {
            FaceLog.log("face.inference_failed")
            throw IllegalStateException("openverify-face: ONNX Runtime did not take the input")
        }
    }

    /** Whether no frame data is left in this detector's buffers (C204.8's check). */
    @Synchronized
    internal fun holdsNoFrame(): Boolean = buffers?.isWiped() ?: true

    /** The identity of the current native buffers, for the test that they are reused per frame size. */
    @Synchronized
    internal fun bufferIdentity(): Any? = buffers

    @Synchronized
    override fun close() {
        if (closed) return
        closed = true
        buffers?.close()
        buffers = null
        try {
            session.close()
        } catch (_: OrtException) {
            FaceLog.log("face.session_close_failed")
        }
    }

    private companion object {
        const val CHANNELS = 3
        const val ALIGNMENT = 32
    }
}

/**
 * The native buffers of one frame size: the input tensor and the twelve output tensors, which ONNX
 * Runtime fills in place. Each output's shape follows from the input's: an anchor per `stride` pixels
 * each way, and 1 (`cls`, `obj`), 4 (`bbox`) or 10 (`kps`) values an anchor.
 */
private class FrameBuffers(environment: OrtEnvironment, inputName: String, val width: Int, val height: Int) {
    val input: FloatBuffer = direct(3 * width * height)
    private val inputTensor: OnnxTensor = OnnxTensor.createTensor(environment, input, longArrayOf(1, 3, height.toLong(), width.toLong()))
    val inputs: Map<String, OnnxTensor> = mapOf(inputName to inputTensor)
    private val outputs: Map<String, FloatBuffer>
    val pinned: Map<String, OnnxTensor>

    init {
        val made = LinkedHashMap<String, FloatBuffer>()
        val tensors = LinkedHashMap<String, OnnxTensor>()
        for (name in YunetOutputs.NAMES) {
            val anchors = (width / strideOf(name)) * (height / strideOf(name))
            val values = valuesOf(name)
            val buffer = direct(anchors * values)
            made[name] = buffer
            tensors[name] = OnnxTensor.createTensor(environment, buffer, longArrayOf(1, anchors.toLong(), values.toLong()))
        }
        outputs = made
        pinned = tensors
    }

    /** The twelve outputs, copied by name into arrays of their own. */
    fun read(): YunetOutputs = YunetOutputs(
        cls8 = copy("cls_8"), cls16 = copy("cls_16"), cls32 = copy("cls_32"),
        obj8 = copy("obj_8"), obj16 = copy("obj_16"), obj32 = copy("obj_32"),
        bbox8 = copy("bbox_8"), bbox16 = copy("bbox_16"), bbox32 = copy("bbox_32"),
        kps8 = copy("kps_8"), kps16 = copy("kps_16"), kps32 = copy("kps_32"),
    )

    private fun copy(name: String): FloatArray {
        val buffer = outputs.getValue(name)
        val values = FloatArray(buffer.capacity())
        buffer.rewind()
        buffer.get(values)
        return values
    }

    /** Zeroes the input and every output. */
    fun wipe() {
        zero(input)
        outputs.values.forEach { zero(it) }
    }

    fun isWiped(): Boolean = allZero(input) && outputs.values.all { allZero(it) }

    fun close() {
        wipe()
        inputTensor.close()
        pinned.values.forEach { it.close() }
    }

    private companion object {
        fun direct(values: Int): FloatBuffer =
            ByteBuffer.allocateDirect(values * Float.SIZE_BYTES).order(ByteOrder.nativeOrder()).asFloatBuffer()

        fun strideOf(name: String): Int = name.substringAfter('_').toInt()

        fun valuesOf(name: String): Int = when (name.substringBefore('_')) {
            "bbox" -> 4
            "kps" -> 10
            else -> 1
        }

        fun zero(buffer: FloatBuffer) {
            buffer.clear()
            while (buffer.hasRemaining()) buffer.put(0f)
            buffer.clear()
        }

        fun allZero(buffer: FloatBuffer): Boolean {
            for (index in 0 until buffer.capacity()) if (buffer.get(index) != 0f) return false
            return true
        }
    }
}
