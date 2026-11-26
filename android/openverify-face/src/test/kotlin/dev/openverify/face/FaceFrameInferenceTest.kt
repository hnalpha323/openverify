package dev.openverify.face

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * The host twin of `YunetInferenceDeviceTest` (C219.5; Acceptance of 10E; reviews H05, F14): the
 * public-domain fixture frame, given as the SDK gives a camera frame, through this module's detector
 * on the host JVM's ONNX Runtime (the Android AAR's version), decoded by the common rules, against the
 * boxes, landmarks and yaw ratio the server's own runtime found (`yunet-face-frame-vectors.json`).
 *
 * The frame is fetched, never committed: absent, this test fails with the command that fetches it.
 */
@RunWith(RobolectricTestRunner::class)
class FaceFrameInferenceTest {

    private val vectors = HostFiles.faceFrame()

    private fun fetchedFrame(): ByteArray {
        val file: File = HostFiles.repository("fixtures/faces/${vectors.frameFile}")
        check(file.isFile) { "${file.name} is absent: python3 -I scripts/fetch_fixtures.py --only person_a_id" }
        return file.readBytes().also { assertEquals(vectors.frameSha256, HostFiles.sha256(it)) }
    }

    @Before
    fun firstEnvironment() {
        HostOrt.first
    }

    @Test
    fun `the fixture frame gives the server runtime's boxes, landmarks and yaw ratio, within the vectors' tolerance`() {
        val frame = HostFiles.frame(fetchedFrame())
        assertEquals(vectors.frameWidth, frame.width)
        assertEquals(vectors.frameHeight, frame.height)
        val tensor = YunetReference.tensor(frame)
        assertEquals(listOf(vectors.inputWidth, vectors.inputHeight, vectors.paddedWidth, vectors.paddedHeight), listOf(tensor.width, tensor.height, tensor.paddedWidth, tensor.paddedHeight))

        val faces = OrtFaceDetectorFactory(HostFiles.modelSource(), HostOrt.environments).create().use { detector ->
            val outputs = runBlocking { detector.detect(tensor.data, tensor.paddedWidth, tensor.paddedHeight) }
            YunetReference.decode(outputs, tensor.paddedWidth, tensor.paddedHeight, vectors.scoreThreshold, vectors.nmsThreshold)
        }

        vectors.assertMatches(faces)
        // The record of this run, for docs/tdd/phase10-face-onnx.tdd.md: sizes of differences, no pixel or landmark.
        val (pixels, score, ratio) = vectors.largestDifferences(faces)
        println("FaceFrameInferenceTest: largest differences from the server runtime: pixels=$pixels score=$score yaw-ratio=$ratio")
    }
}
