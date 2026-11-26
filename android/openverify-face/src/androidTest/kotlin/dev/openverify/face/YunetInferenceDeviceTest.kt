package dev.openverify.face

import android.content.Context
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * C219.5, the acceptance of 10E (reviews H05, F14): YuNet through ONNX Runtime's Android library, on
 * the device's own processor, through the factory a host installs and the model the AAR carries.
 *
 * Host twins: `FaceFrameInferenceTest` and `OrtFaceDetectorTest` make the same comparisons on the host
 * JVM's ONNX Runtime, with the same reference tensor and decoder (`src/sharedTest`). What only a device
 * shows is the platform glue: the native library loads from the APK, the model is read from the
 * assets and passes its digest check, and this processor's arithmetic gives the server runtime's
 * numbers.
 */
@RunWith(AndroidJUnit4::class)
class YunetInferenceDeviceTest {

    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun theFixtureFrameGivesTheServerRuntimesBoxesLandmarksAndYawRatio() {
        val vectors = DeviceFiles.faceFrame(context)
        val image = DeviceFiles.asset(context, vectors.frameFile)
        assertEquals(vectors.frameSha256, DeviceFiles.sha256(image))
        // The public-domain fixture frame, as the SDK gives a camera frame: RGBA_8888, upright.
        val frame = DeviceFiles.frame(image)
        assertEquals(listOf(vectors.frameWidth, vectors.frameHeight), listOf(frame.width, frame.height))
        val tensor = YunetReference.tensor(frame)
        assertEquals(listOf(vectors.inputWidth, vectors.inputHeight, vectors.paddedWidth, vectors.paddedHeight), listOf(tensor.width, tensor.height, tensor.paddedWidth, tensor.paddedHeight))

        val faces = OpenVerifyFace.detectorFactory(context).create().use { detector ->
            val outputs = runBlocking { detector.detect(tensor.data, tensor.paddedWidth, tensor.paddedHeight) }
            YunetReference.decode(outputs, tensor.paddedWidth, tensor.paddedHeight, vectors.scoreThreshold, vectors.nmsThreshold)
        }

        vectors.assertMatches(faces)
        // The record of this run: sizes of differences only, never a pixel, a box or a landmark.
        val (pixels, score, ratio) = vectors.largestDifferences(faces)
        Log.i(TAG, "fixture frame: largest differences from the server runtime: pixels=$pixels score=$score yaw-ratio=$ratio")
    }

    @Test
    fun theDrawnFaceGivesTheRawOutputsTheVisionRuntimeRecordedEachUnderItsName() {
        val vectors = DeviceFiles.drawnFace(context)
        val tensor = DeviceFiles.drawnTensor(vectors)
        assertEquals(listOf(vectors.paddedWidth, vectors.paddedHeight), listOf(tensor.paddedWidth, tensor.paddedHeight))

        val outputs = OpenVerifyFace.detectorFactory(context).create().use { detector ->
            runBlocking { detector.detect(tensor.data, tensor.paddedWidth, tensor.paddedHeight) }
        }

        // A PNG decodes to the same pixels everywhere, so the raw tensors are compared directly, by name.
        vectors.assertRawOutputs(outputs)
        val faces = YunetReference.decode(outputs, tensor.paddedWidth, tensor.paddedHeight, vectors.scoreThreshold, vectors.nmsThreshold)
        assertEquals(vectors.expected.size, faces.size)
        assertTrue(faces.single().score > 0.6)
        Log.i(TAG, "drawn face: largest raw difference from the vision runtime: ${vectors.largestRawDifference(outputs)}")
    }

    private companion object {
        const val TAG = "OpenVerifyFaceTest"
    }
}
