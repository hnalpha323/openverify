package dev.openverify.sdk.capture.selfie

import dev.openverify.sdk.camera.AnalysisFrame
import dev.openverify.sdk.camera.PixelLayout
import dev.openverify.sdk.capture.AutoCapture
import dev.openverify.sdk.face.FaceDetector
import dev.openverify.sdk.face.FaceDetectorFactory
import dev.openverify.sdk.face.YunetOutputs
import dev.openverify.sdk.model.SelfiePose
import java.lang.reflect.Modifier
import java.util.IdentityHashMap
import kotlin.coroutines.EmptyCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.testTimeSource
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * C204.8 (review P24): the detector's boxes and landmarks live for one frame callback. After each
 * callback returns, everything reachable from the guidance (its fields, followed through every SDK object
 * and array they hold) holds no detector output, no frame, and no non-zero number of a box, a landmark
 * or a pixel; only the machine's pose state (its message, hold time and yaw ratio) outlives it.
 */
internal class SelfieGuidanceReachabilityTest {

    private val thresholds = GuidanceThresholds(maxCenterYawRatio = 0.021, minSideYawRatioChange = 0.077, holdMs = 500)

    /** What is reachable from [root] through fields, within the SDK's own classes, collections and arrays. */
    private fun reachable(root: Any): List<Any> {
        val seen = IdentityHashMap<Any, Unit>()
        val queue = ArrayDeque<Any>().apply { add(root) }
        while (queue.isNotEmpty()) {
            val next = queue.removeFirst()
            if (seen.put(next, Unit) != null) continue
            // The host's detector and its factory are the host's component (`openverify-face`), not the guidance's state.
            if (next is FaceDetector || next is FaceDetectorFactory) continue
            when (next) {
                is Array<*> -> next.filterNotNull().forEach(queue::add)
                is Iterable<*> -> next.filterNotNull().forEach(queue::add)
                else -> {
                    var type: Class<*>? = next.javaClass
                    while (type != null && type.name.startsWith("dev.openverify.sdk")) {
                        for (field in type.declaredFields) {
                            if (Modifier.isStatic(field.modifiers) || field.type.isPrimitive) continue
                            field.isAccessible = true
                            field.get(next)?.let(queue::add)
                        }
                        type = type.superclass
                    }
                }
            }
        }
        return seen.keys.toList()
    }

    @Test
    fun `after each frame callback no box, landmark, frame or detector output is reachable from the guidance`() = runTest {
        val outputs = mutableListOf<YunetOutputs>()
        val detector = object : FaceDetector {
            private val fake = FakeFaceDetector { listOf(testFace(yaw = 0.2), testFace(cx = 60.0, height = 0.3)) }

            override suspend fun detect(input: FloatArray, width: Int, height: Int): YunetOutputs =
                fake.detect(input, width, height).also { outputs += it }

            override fun close() = fake.close()
        }
        val factory = object : FaceDetectorFactory {
            override fun create(): FaceDetector = detector
        }
        val frame = AnalysisFrame(320, 240, 0, PixelLayout.RGBA_8888, ByteArray(320 * 240 * 4) { 77 }, 0L)
        lateinit var guidance: SelfieGuidance
        val leaks = mutableListOf<String>()
        guidance = SelfieGuidance(SelfiePose.CENTER, thresholds, factory, CentreYawRatio(), testTimeSource, analysis = EmptyCoroutineContext)
        val frames = flow {
            repeat(4) {
                emit(frame)
                val held = reachable(guidance)
                held.filter { candidate -> outputs.any { it === candidate } }.forEach { leaks += "detector output after frame $it" }
                if (held.any { it === frame || it === frame.bytes }) leaks += "the frame after frame $it"
                held.filterIsInstance<DoubleArray>().filter { array -> array.any { it != 0.0 } }.forEach { leaks += "box or landmark values after frame $it" }
                held.filterIsInstance<FloatArray>().filter { array -> array.any { it != 0f } }.forEach { leaks += "pixels after frame $it" }
                delay(125)
            }
        }

        guidance.run(frames, AutoCapture { true })

        assertEquals(4, outputs.size)
        assertEquals(emptyList<String>(), leaks)
        assertTrue(guidance.holdsNoFrame())
    }
}
