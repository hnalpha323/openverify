package dev.openverify.face

import android.content.Context
import android.content.pm.ApplicationInfo
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.face.FaceDetector
import dev.openverify.sdk.face.YunetOutputs
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog
import java.io.ByteArrayInputStream
import java.io.InputStream

/**
 * C204.2, C205.4, C204.8 over the real ONNX Runtime of the host JVM and the fetched model: the twelve
 * outputs by name and shape, the raw values the vision service's runtime recorded for the drawn
 * synthetic face, the buffers' reuse and wiping, and the detector's life.
 */
@RunWith(RobolectricTestRunner::class)
class OrtFaceDetectorTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val made = ArrayList<FaceDetector>()

    private fun detector(source: ModelSource = HostFiles.modelSource(), environments: OrtEnvironments = HostOrt.environments): OrtFaceDetector =
        (OrtFaceDetectorFactory(source, environments).create() as OrtFaceDetector).also { made += it }

    private fun FaceDetector.on(tensor: ReferenceTensor): YunetOutputs = runBlocking { detect(tensor.data.copyOf(), tensor.paddedWidth, tensor.paddedHeight) }

    private fun written(): List<String> = ShadowLog.getLogsForTag("OpenVerifyFace").map { it.msg }

    @Before
    fun firstEnvironmentAndDebuggableHost() {
        HostOrt.first
        ShadowLog.clear()
        context.applicationInfo.flags = context.applicationInfo.flags or ApplicationInfo.FLAG_DEBUGGABLE
        FaceLog.attach(context)
    }

    @After
    fun closeDetectors() = made.forEach { it.close() }

    @Test
    fun `the drawn face gives the raw outputs the vision service's runtime recorded, each under its own name`() {
        val vectors = HostFiles.drawnFace()

        val outputs = detector().on(HostFiles.drawnTensor(vectors))

        vectors.assertRawOutputs(outputs)
        // The record of this run, for docs/tdd/phase10-face-onnx.tdd.md.
        println("OrtFaceDetectorTest: largest raw difference from the vision runtime: ${vectors.largestRawDifference(outputs)}")
    }

    @Test
    fun `each output is flattened row-major with an anchor per stride pixel and 1, 4 or 10 values an anchor`() {
        val tensor = HostFiles.drawnTensor()

        val outputs = detector().on(tensor)

        for (stride in listOf(8, 16, 32)) {
            val anchors = (tensor.paddedWidth / stride) * (tensor.paddedHeight / stride)
            assertEquals(anchors, outputs.tensor("cls_$stride")!!.size)
            assertEquals(anchors, outputs.tensor("obj_$stride")!!.size)
            assertEquals(anchors * 4, outputs.tensor("bbox_$stride")!!.size)
            assertEquals(anchors * 10, outputs.tensor("kps_$stride")!!.size)
        }
    }

    @Test
    fun `decoded by the common rules, the drawn face is the face OpenCV found`() {
        val vectors = HostFiles.drawnFace()

        val faces = YunetReference.decode(detector().on(HostFiles.drawnTensor(vectors)), vectors.paddedWidth, vectors.paddedHeight, vectors.scoreThreshold, vectors.nmsThreshold)

        assertEquals(vectors.expected.size, faces.size)
        vectors.expected.forEachIndexed { index, want ->
            assertEquals(want.score, faces[index].score, 1e-3)
            for (k in 0 until 4) assertEquals(want.box[k], faces[index].box[k], 0.05)
            for (k in 0 until 10) assertEquals(want.landmarks[k], faces[index].landmarks[k], 0.05)
        }
    }

    @Test
    fun `nothing of a frame is left in the detector once detect has returned`() {
        val detector = detector()
        assertTrue(detector.holdsNoFrame())

        val outputs = detector.on(HostFiles.drawnTensor())

        // The outputs did hold a face, so the wipe below is a wipe of something.
        assertTrue(outputs.tensor("kps_8")!!.any { it != 0f })
        assertTrue(detector.holdsNoFrame())
    }

    @Test
    fun `the arrays handed back are new for each frame and the detector keeps none of them`() {
        val detector = detector()
        val tensor = HostFiles.drawnTensor()

        val first = detector.on(tensor)
        val kept = YunetOutputs.NAMES.associateWith { first.tensor(it)!!.copyOf() }
        val second = detector.on(tensor)

        YunetOutputs.NAMES.forEach { name ->
            assertNotSame(name, first.tensor(name), second.tensor(name))
            // The first frame's arrays are the caller's alone: the second frame did not write into them.
            assertTrue(name, kept.getValue(name).contentEquals(first.tensor(name)!!))
        }
    }

    @Test
    fun `the native buffers are reused while the frame size stays the same and replaced when it changes`() {
        val detector = detector()
        val tensor = HostFiles.drawnTensor()
        val wider = ReferenceTensor(FloatArray(3 * 320 * 448), 320, 427, 320, 448)

        detector.on(tensor)
        val buffers = detector.bufferIdentity()
        detector.on(tensor)
        assertSame(buffers, detector.bufferIdentity())

        val other = detector.on(wider)
        assertNotSame(buffers, detector.bufferIdentity())
        assertEquals((320 / 8) * (448 / 8) * 10, other.tensor("kps_8")!!.size)
        assertTrue(detector.holdsNoFrame())
    }

    @Test
    fun `an input that is not three planes of a size in multiples of 32 is refused with a fixed message`() {
        val detector = detector()

        val size = assertThrows(IllegalArgumentException::class.java) { runBlocking { detector.detect(FloatArray(3 * 160 * 120), 160, 120) } }
        val planes = assertThrows(IllegalArgumentException::class.java) { runBlocking { detector.detect(FloatArray(7), 160, 128) } }

        assertEquals("openverify-face: the input's sides are multiples of 32", size.message)
        assertEquals("openverify-face: the input holds three planes of its size", planes.message)
        assertTrue(detector.holdsNoFrame())
    }

    @Test
    fun `a closed detector refuses a frame, and closing twice is harmless`() {
        val detector = detector()
        val tensor = HostFiles.drawnTensor()
        detector.on(tensor)

        detector.close()
        detector.close()

        val refused = assertThrows(IllegalStateException::class.java) { detector.on(tensor) }
        assertEquals("openverify-face: the detector is closed", refused.message)
        assertNull(refused.cause)
        assertTrue(detector.holdsNoFrame())
        assertNull(detector.bufferIdentity())
    }

    @Test
    fun `each detector has a session of its own, opened with telemetry switched off first`() {
        val from = HostOrt.access.calls.size

        val one = detector()
        val two = detector()

        assertNotSame(one, two)
        assertEquals(
            listOf("disableTelemetry", "createSession threads=2", "disableTelemetry", "createSession threads=2"),
            HostOrt.access.calls.drop(from),
        )
        // One closed, the other still detects.
        one.close()
        HostFiles.drawnFace().assertRawOutputs(two.on(HostFiles.drawnTensor()))
    }

    @Test
    fun `a model with another digest never reaches ONNX Runtime`() {
        val tampered = HostFiles.model().readBytes().also { it[100] = (it[100] + 1).toByte() }
        val source = object : ModelSource {
            override val name: String = YunetModel.NAME
            override val sha256: String = YunetModel.SHA256
            override fun open(): InputStream = ByteArrayInputStream(tampered)
        }
        val from = HostOrt.access.calls.size

        val refused = assertThrows(IllegalStateException::class.java) { OrtFaceDetectorFactory(source, HostOrt.environments).create() }

        assertEquals("openverify-face: the model does not have its pinned SHA-256", refused.message)
        assertEquals(emptyList<String>(), HostOrt.access.calls.drop(from))
        assertEquals(listOf("face.model_digest_mismatch"), written())
        assertFalse(written().any { "ebafce" in it })
    }
}
