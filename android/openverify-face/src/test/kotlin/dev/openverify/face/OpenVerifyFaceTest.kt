package dev.openverify.face

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import dev.openverify.sdk.face.FaceDetectorFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * C205: the public factory, over the model the build packaged and the host JVM's ONNX Runtime. What a
 * host installs is the SDK's seam; asked for a detector, it makes one that runs the packaged model.
 */
@RunWith(RobolectricTestRunner::class)
class OpenVerifyFaceTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `the factory is the SDK's seam, the same for any context of the app`() {
        val factory: FaceDetectorFactory = OpenVerifyFace.detectorFactory(context)

        assertSame(factory, OpenVerifyFace.detectorFactory(context.applicationContext))
    }

    @Test
    fun `the factory makes a detector over the packaged model, which finds the drawn face and closes`() {
        HostOrt.first
        val vectors = HostFiles.drawnFace()
        val tensor = HostFiles.drawnTensor(vectors)

        val outputs = OpenVerifyFace.detectorFactory(context).create().use { detector ->
            runBlocking { detector.detect(tensor.data, tensor.paddedWidth, tensor.paddedHeight) }
        }

        vectors.assertRawOutputs(outputs)
        val faces = YunetReference.decode(outputs, tensor.paddedWidth, tensor.paddedHeight)
        assertEquals(1, faces.size)
    }

    @Test
    fun `installing the factory loads nothing of ONNX Runtime`() {
        // The entry point's own class names no ONNX Runtime type: the native library loads with the first detector.
        val referenced = OpenVerifyFace::class.java.declaredFields.map { it.type.name } +
            OpenVerifyFace::class.java.declaredMethods.flatMap { method -> method.parameterTypes.map { it.name } + method.returnType.name }

        assertEquals(emptyList<String>(), referenced.filter { it.startsWith("ai.onnxruntime") })
    }
}
