package dev.openverify.face

import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import javax.imageio.ImageIO

/** What the host tests read from the repository and how they decode an image (the device uses its own decoder). */
internal object HostFiles {
    val repositoryRoot: File = File(System.getProperty("openverify.repositoryRoot") ?: error("the build passes openverify.repositoryRoot"))

    fun repository(path: String): File = File(repositoryRoot, path)

    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /** The fetched YuNet model. Absent, the test fails with the command that fetches it; it never skips. */
    fun model(): File = repository("models/${YunetModel.NAME}").also {
        check(it.isFile) { "${it.name} is absent: python3 -I scripts/fetch_models.py --only face_detection_yunet" }
    }

    /** A [ModelSource] over the fetched model file, with the digest the shipped source pins. */
    fun modelSource(): ModelSource = object : ModelSource {
        override val name: String = YunetModel.NAME
        override val sha256: String = YunetModel.SHA256
        override fun open(): InputStream = model().inputStream()
    }

    fun drawnFace(): DrawnFaceVectors = DrawnFaceVectors(repository("contracts/fixtures/vision/yunet-decode.json").readText())

    fun faceFrame(): FaceFrameVectors = FaceFrameVectors(repository("contracts/fixtures/flow/yunet-face-frame-vectors.json").readText())

    /** An image's pixels as an upright frame, four bytes a pixel in R, G, B, A order. */
    fun frame(image: ByteArray): ReferenceFrame {
        val decoded: BufferedImage = ImageIO.read(ByteArrayInputStream(image)) ?: error("the image did not decode")
        val width = decoded.width
        val height = decoded.height
        val argb = IntArray(width)
        val rgba = ByteArray(width * height * 4)
        for (y in 0 until height) {
            decoded.getRGB(0, y, width, 1, argb, 0, width)
            for (x in 0 until width) {
                val at = (y * width + x) * 4
                rgba[at] = (argb[x] shr 16).toByte()
                rgba[at + 1] = (argb[x] shr 8).toByte()
                rgba[at + 2] = argb[x].toByte()
                rgba[at + 3] = (argb[x] ushr 24).toByte()
            }
        }
        return ReferenceFrame(width, height, 0, rgba)
    }

    /** The drawn face as the detector's input. */
    fun drawnTensor(vectors: DrawnFaceVectors = drawnFace()): ReferenceTensor = YunetReference.tensor(frame(vectors.png))
}

/** An [OrtAccess] that does what [OrtPlatform] does and writes down each call, in order. */
internal class RecordingAccess(private val real: OrtAccess = OrtPlatform) : OrtAccess {
    val calls = ArrayList<String>()

    override fun setVariable(name: String, value: String) {
        calls += "setVariable $name=$value"
        real.setVariable(name, value)
    }

    override fun createEnvironment() = real.createEnvironment().also { calls += "createEnvironment" }

    override fun existingEnvironment() = real.existingEnvironment().also { calls += "existingEnvironment" }

    override fun disableTelemetry(environment: ai.onnxruntime.OrtEnvironment) {
        calls += "disableTelemetry"
        real.disableTelemetry(environment)
    }

    override fun createSession(environment: ai.onnxruntime.OrtEnvironment, model: ByteArray, threads: Int) =
        real.createSession(environment, model, threads).also { calls += "createSession threads=$threads" }
}

/**
 * ONNX Runtime keeps one environment per process, so the host tests share it: the first one of this
 * test JVM is made here, through this module's own class, with each call written down. Every test that
 * reaches ONNX Runtime asks for [first] before anything else, so "who created the environment" does not
 * depend on the order the test classes run in.
 */
internal object HostOrt {
    val access = RecordingAccess()
    val environments = OrtEnvironments(access)

    /** What [access] had recorded when the first environment had just been made. */
    lateinit var callsAtCreation: List<String>
        private set

    val first: ai.onnxruntime.OrtEnvironment by lazy {
        environments.environment().also { callsAtCreation = access.calls.toList() }
    }
}
